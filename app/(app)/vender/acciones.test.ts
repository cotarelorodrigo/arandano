import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Vender acciones test', estado: 'TRIAL' },
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

let cobrar: typeof import('./acciones').cobrar
let buscarArticulos: typeof import('./acciones').buscarArticulos
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, venta: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-vender@ejemplo.test'
const MAIL_DUENO = 'duenia-vender@ejemplo.test'

let owner: Client
let articuloId: string
let precioArticulo: string
let cookieEmpleado: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ cobrar, buscarArticulos } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `vender-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un empleado',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })

  // El artículo del punto de venta. `precioArticulo` es el mismo texto que
  // Postgres guardó en `precio`: así el pago del `formulario` cierra contra el
  // total exacto de una unidad y `crearVenta` no lo rechaza con
  // PAGOS_NO_CIERRAN.
  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'VEN-1', 'Artículo de prueba', 'PRODUCTO', 1000.00, 10, now(), now())
     RETURNING id, precio`,
    [estado.tenantId],
  )
  articuloId = a.rows[0].id
  precioArticulo = a.rows[0].precio

  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
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

/** Un carrito válido de una unidad del artículo de prueba. `precioArticulo` se
 *  lee en el beforeAll para que el pago cierre contra el total exacto. */
function formulario({ clave }: { clave: string }): FormData {
  const datos = new FormData()
  datos.set('items', JSON.stringify([{ articuloId, cantidad: '1' }]))
  datos.set('pagos', JSON.stringify([
    { medio: 'EFECTIVO', moneda: 'ARS', monto: precioArticulo, cotizacion: '1' },
  ]))
  datos.set('clave', clave)
  return datos
}

describe('cobrar', () => {
  it('un EMPLEADO puede cobrar: es la operación del mostrador', async () => {
    estado.cookie = cookieEmpleado
    const r = await cobrar(INICIAL, formulario({ clave: `e-${Date.now()}` }))
    expect(r.error).toBeNull()
    expect(r.venta?.numero).toBeGreaterThan(0)
  })

  it('sin sesión manda al login, aunque el carrito sea inválido', async () => {
    // El guard no puede depender de que lo que mandaron sea parseable.
    estado.cookie = ''
    const datos = new FormData()
    datos.set('items', 'no es json')
    datos.set('pagos', '[]')
    await expect(cobrar(INICIAL, datos)).rejects.toThrow('REDIRECT')
  })

  // El caso central del ciclo, de punta a punta: dos submits idénticos.
  it('el mismo submit dos veces cobra una sola vez', async () => {
    estado.cookie = cookieEmpleado
    const clave = `doble-${Date.now()}`
    const primera = await cobrar(INICIAL, formulario({ clave }))
    const segunda = await cobrar(INICIAL, formulario({ clave }))

    expect(segunda.venta?.id).toBe(primera.venta?.id)
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM ventas WHERE clave_idempotencia = $1`, [clave],
    )
    expect(rows[0].n).toBe(1)
  })

  it('un carrito que no es JSON vuelve como error, no como 500', async () => {
    estado.cookie = cookieEmpleado
    const datos = new FormData()
    datos.set('items', '{roto')
    datos.set('pagos', '[]')
    datos.set('clave', `roto-${Date.now()}`)
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/no se entendió/)
  })

  it('un medio de pago inventado vuelve como error, no como 500', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `medio-${Date.now()}` })
    datos.set('pagos', JSON.stringify([
      { medio: 'CRIPTO', moneda: 'ARS', monto: '1000', cotizacion: '1' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/medio de pago desconocido/)
  })

  it('los pagos que no cierran vuelven como error entendible', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `nocierra-${Date.now()}` })
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', monto: '1', cotizacion: '1' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/pagos suman/)
  })
})

describe('buscarArticulos', () => {
  it('no devuelve nada sin sesión', async () => {
    estado.cookie = ''
    await expect(buscarArticulos('rem')).rejects.toThrow('REDIRECT')
  })

  it('con sesión, encuentra lo del propio tenant', async () => {
    estado.cookie = cookieEmpleado
    const r = await buscarArticulos('VEN-1')
    expect(r.map((a) => a.sku)).toContain('VEN-1')
  })
})
