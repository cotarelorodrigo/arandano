import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Inventario acciones test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(estado.cookie ? { cookie: estado.cookie } : undefined),
}))

const forbidden = vi.fn(() => {
  throw new Error('FORBIDDEN')
})
const redirect: (a: string) => never = vi.fn(() => {
  throw new Error('REDIRECT')
})
vi.mock('next/navigation', () => ({
  forbidden: () => forbidden(),
  redirect: (a: string) => redirect(a),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let altaArticulo: typeof import('./acciones').altaArticulo
let guardarArticulo: typeof import('./acciones').guardarArticulo
let bajaArticulo: typeof import('./acciones').bajaArticulo
let reactivarArticuloAccion: typeof import('./acciones').reactivarArticuloAccion
let ingresarMercaderia: typeof import('./acciones').ingresarMercaderia
let corregirPorConteo: typeof import('./acciones').corregirPorConteo
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-inventario@ejemplo.test'
const MAIL_DUENO = 'duenia-inventario@ejemplo.test'

let owner: Client
let empleadoId: string
let articuloId: string
let cookieEmpleado: string
let cookieDuenio: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({
    altaArticulo, guardarArticulo, bajaArticulo,
    reactivarArticuloAccion, ingresarMercaderia, corregirPorConteo,
  } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `inventario-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  const empleado = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un empleado',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  empleadoId = empleado.id
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'ACC-1', 'Artículo de prueba', 'PRODUCTO', 1000.00, 0, now(), now())
     RETURNING id`,
    [estado.tenantId],
  )
  articuloId = a.rows[0].id

  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
  cookieDuenio = await cookieDe(MAIL_DUENO)
})

afterAll(async () => {
  await owner.end()
})

/** Login real contra Better Auth; devuelve la cookie lista para que el mock
 *  de next/headers la sirva. Mismo extracto que test/auth.test.ts. */
async function cookieDe(email: string): Promise<string> {
  const origen = await origenDelRequest(estado.subdominio)
  const r = await authParaTenant(estado.tenantId, origen).api.signInEmail({
    body: { email, password: CLAVE },
    asResponse: true,
  })
  const cookie = r.headers.get('set-cookie')
  if (!cookie) throw new Error('el login no devolvió cookie; el test no probaría nada')
  return cookie.split(';')[0]
}

describe('el rol de cada action de inventario', () => {
  it('un EMPLEADO no puede dar de alta, editar, ni desactivar', async () => {
    estado.cookie = cookieEmpleado
    for (const [nombre, accion] of [
      ['altaArticulo', altaArticulo],
      ['guardarArticulo', guardarArticulo],
      ['bajaArticulo', bajaArticulo],
      ['reactivarArticuloAccion', reactivarArticuloAccion],
    ] as const) {
      const datos = new FormData()
      datos.set('nombre', 'Intento')
      datos.set('precio', '100')
      datos.set('articuloId', articuloId)
      await expect(accion(INICIAL, datos), `${nombre} dejó pasar a un empleado`).rejects.toThrow(
        'FORBIDDEN',
      )
    }
  })

  it('un EMPLEADO SÍ puede mover stock: es operación del día y queda firmada', async () => {
    estado.cookie = cookieEmpleado
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    datos.set('cantidad', '3')
    const r = await ingresarMercaderia(INICIAL, datos)
    expect(r.error).toBeNull()

    // Firmado con QUIEN lo hizo, que es la trazabilidad que reemplaza al
    // permiso denegado.
    const { rows } = await owner.query(
      `SELECT usuario_id FROM movimientos_stock WHERE articulo_id = $1
        ORDER BY creado_en DESC LIMIT 1`,
      [articuloId],
    )
    expect(rows[0].usuario_id).toBe(empleadoId)
  })

  it('sin sesión, mover stock manda al login en vez de escribir', async () => {
    estado.cookie = ''
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    datos.set('cantidad', '3')
    await expect(ingresarMercaderia(INICIAL, datos)).rejects.toThrow('REDIRECT')
  })

  it('un DUEÑO da de alta y el aviso trae el código generado', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Cable USB-C')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '4.500,50')
    const r = await altaArticulo(INICIAL, datos)
    expect(r.error).toBeNull()
    expect(r.aviso).toMatch(/A-\d{4}/)
  })

  // El formato argentino tiene que llegar entero hasta la base: es el camino
  // completo, no sólo el parser.
  it('el precio escrito con coma llega bien a la base', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Con coma')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '85.000,75')
    await altaArticulo(INICIAL, datos)

    const { rows } = await owner.query(
      `SELECT precio FROM articulos WHERE nombre = 'Con coma' AND tenant_id = $1`,
      [estado.tenantId],
    )
    expect(new Prisma.Decimal(rows[0].precio).toString()).toBe('85000.75')
  })

  it('un número ambiguo no se adivina: vuelve como error para la pantalla', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Ambiguo')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '850.000')
    const r = await altaArticulo(INICIAL, datos)
    expect(r.error).toMatch(/no se entiende/)
  })
})
