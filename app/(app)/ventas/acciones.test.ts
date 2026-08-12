import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Ventas acciones test', estado: 'TRIAL' },
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

let anular: typeof import('./acciones').anular
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-ventas@ejemplo.test'
const MAIL_DUENO = 'duenia-ventas@ejemplo.test'

let owner: Client
let duenioId: string
let articuloId: string
let ventaId: string
let cookieEmpleado: string
let cookieDuenio: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ anular } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')
  const { crearVenta } = await import('@/lib/ventas/crear')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `ventas-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  const empleado = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un empleado',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  const duenio = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })
  duenioId = duenio.id

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'VEN-1', 'Artículo de prueba', 'PRODUCTO', 1000.00, 10, now(), now())
     RETURNING id`,
    [estado.tenantId],
  )
  articuloId = a.rows[0].id

  // Una venta real vía el motor, no un INSERT a mano: es la única forma de que
  // `MovimientoStock` (motivo VENTA) exista para que `anularVenta` tenga algo
  // que compensar.
  const venta = await crearVenta({
    tenantId: estado.tenantId,
    usuarioId: empleado.id,
    items: [{ articuloId, cantidad: new Prisma.Decimal('2') }],
    // El monto tiene que cerrar EXACTO contra el total (2 * 1000 = 2000), o
    // `crearVenta` rechaza el pago con PAGOS_NO_CIERRAN y el test entero falla
    // por el motivo equivocado.
    pagos: [{
      medio: 'EFECTIVO', moneda: 'ARS',
      monto: new Prisma.Decimal('2000'), cotizacion: new Prisma.Decimal('1'),
    }],
  })
  ventaId = venta.id

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

describe('anular', () => {
  it('un EMPLEADO no puede, aunque invoque la action directo', async () => {
    estado.cookie = cookieEmpleado
    const datos = new FormData()
    datos.set('ventaId', ventaId)
    await expect(anular(INICIAL, datos)).rejects.toThrow('FORBIDDEN')

    // Y no alcanza con que tire: la venta tiene que seguir viva.
    const { rows } = await owner.query(`SELECT anulada_en FROM ventas WHERE id = $1`, [ventaId])
    expect(rows[0].anulada_en).toBeNull()
  })

  it('un DUEÑO sí, y el stock vuelve', async () => {
    const antes = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [articuloId])
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('ventaId', ventaId)
    const r = await anular(INICIAL, datos)
    expect(r.error).toBeNull()

    const marcada = await owner.query(`SELECT anulada_en, anulada_por_id FROM ventas WHERE id = $1`, [ventaId])
    expect(marcada.rows[0].anulada_en).not.toBeNull()
    expect(marcada.rows[0].anulada_por_id).toBe(duenioId)

    const despues = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [articuloId])
    expect(Number(despues.rows[0].stock)).toBeGreaterThan(Number(antes.rows[0].stock))
  })

  it('anular dos veces no devuelve el stock dos veces', async () => {
    // `anularVenta` ya es idempotente; esto fija que la action no lo rompa.
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('ventaId', ventaId)
    const antes = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [articuloId])
    await anular(INICIAL, datos)
    const despues = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [articuloId])
    expect(despues.rows[0].stock).toBe(antes.rows[0].stock)
  })
})
