import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const FUENTE = readFileSync(new URL('./acciones.ts', import.meta.url), 'utf8')

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
let guardarDetalle: typeof import('./acciones').guardarDetalle
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
let ventaAjena: string
let cookieEmpleado: string
let cookieDuenio: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ anular, guardarDetalle } = await import('./acciones'))
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

  // Un segundo tenant con una venta suya, para el caso de aislamiento. La venta
  // va por SQL crudo y no por `crearVenta`: no hace falta que tenga
  // movimientos ni que cierre contra nada, sólo existir para que el `update`
  // tenga a qué NO llegar.
  const otro = await crearTenant(owner, `ventas-acciones-ajeno-${Date.now()}`)
  const ua = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Dueño del otro', 'duenio@otro.test', 'DUENO', now(), now())
     RETURNING id`,
    [otro],
  )
  const va = await owner.query(
    `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
     VALUES (gen_random_uuid(), $1, 1, $2, 1000.00, now())
     RETURNING id`,
    [otro, ua.rows[0].id],
  )
  ventaAjena = va.rows[0].id

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
      base: new Prisma.Decimal('2000'), cotizacion: new Prisma.Decimal('1'),
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

/**
 * Una venta cobrada propia de cada caso, sobre un artículo propio.
 *
 * No se reusa la `ventaId` del `beforeAll`: el describe de `anular` la anula, y
 * un caso que dependa de haber corrido antes o después de ése no prueba lo que
 * dice probar. Artículo nuevo por llamada para no competir por el stock del
 * que usan los otros casos.
 */
async function unaVentaCobrada(): Promise<string> {
  const { crearVenta } = await import('@/lib/ventas/crear')
  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, 'Artículo del detalle', 'PRODUCTO', 1000.00, 5, now(), now())
     RETURNING id`,
    [estado.tenantId, `DET-${crypto.randomUUID().slice(0, 8)}`],
  )
  const v = await crearVenta({
    tenantId: estado.tenantId,
    usuarioId: duenioId,
    items: [{ articuloId: a.rows[0].id, cantidad: new Prisma.Decimal('1') }],
    pagos: [{
      medio: 'EFECTIVO', moneda: 'ARS',
      base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1'),
    }],
  })
  return v.id
}

/** El detalle tal como quedó en la base. */
async function detalleDe(ventaId: string): Promise<string | null> {
  const r = await owner.query(`SELECT detalle FROM ventas WHERE id = $1`, [ventaId])
  return r.rows[0].detalle
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

describe('anular una venta', () => {
  // Anular devuelve el stock y borra plata cobrada del período: sigue siendo
  // peligroso, pero ahora es el dueño quien decide si lo delega, en vez de que
  // lo decida el código.
  it('exige VENTAS_ANULAR, no el rol', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function anular'))
    expect(cuerpo).toContain("exigirPermiso('VENTAS_ANULAR')")
    expect(cuerpo).not.toContain('exigirDuenio()')
  })
})

describe('guardarDetalle', () => {
  it('guarda el detalle saneado sobre una venta ya cobrada', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()

    const r = await guardarDetalle({ ventaId, detalle: '  Retira Ana, martes de 10 a 12  ' })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBe('Retira Ana, martes de 10 a 12')
  })

  // Un EMPLEADO también: no hay permiso propio, y el que atiende el mostrador
  // es justamente quien se entera de a quién hay que entregarle.
  it('un EMPLEADO puede, sin permiso propio', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()

    const r = await guardarDetalle({ ventaId, detalle: 'Pasa el martes' })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBe('Pasa el martes')
  })

  // Vaciar tiene que BORRAR el dato, no dejar una cadena vacía: es la única
  // forma de volver al estado "acá no se anotó nada".
  it('vaciar el campo lo deja en NULL', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()
    await guardarDetalle({ ventaId, detalle: 'algo' })

    const r = await guardarDetalle({ ventaId, detalle: '   ' })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBeNull()
  })

  it('corta en el tope en vez de rechazar', async () => {
    const { TOPE_DETALLE } = await import('@/lib/ventas/detalle')
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()

    const r = await guardarDetalle({ ventaId, detalle: 'y'.repeat(TOPE_DETALLE + 100) })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toHaveLength(TOPE_DETALLE)
  })

  // Decisión explícita del ciclo: una venta anulada SÍ se puede detallar. Es el
  // caso que más lo necesita — es justamente aquella sobre la que alguien va a
  // querer dejar escrito qué pasó.
  it('funciona sobre una venta anulada', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()
    await owner.query(`UPDATE ventas SET anulada_en = now() WHERE id = $1`, [ventaId])

    const r = await guardarDetalle({
      ventaId,
      detalle: 'El cliente devolvió el equipo con la caja abierta',
    })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBe('El cliente devolvió el equipo con la caja abierta')
  })

  // La venta de otro local no existe para esta sesión: RLS ya filtró, así que
  // el update no alcanza ninguna fila y la acción avisa en vez de romper.
  it('no toca la venta de otro tenant', async () => {
    estado.cookie = cookieEmpleado

    const r = await guardarDetalle({ ventaId: ventaAjena, detalle: 'no debería entrar' })
    expect(r.error).not.toBeNull()
    expect(await detalleDe(ventaAjena)).toBeNull()
  })

  // Un id inventado no puede salir como 500: sin este guard, Prisma rechaza el
  // uuid mal formado con un error que nadie traduce. Y tiene que dar el MISMO
  // mensaje que el de arriba — distinguirlos filtraría qué ids existen.
  it('un id que no es uuid avisa igual que uno ajeno, con el mismo mensaje', async () => {
    estado.cookie = cookieEmpleado

    const malFormado = await guardarDetalle({ ventaId: 'no-soy-un-uuid', detalle: 'x' })
    const ajena = await guardarDetalle({ ventaId: ventaAjena, detalle: 'x' })
    expect(malFormado.error).not.toBeNull()
    expect(malFormado.error).toBe(ajena.error)
  })

  // Sin sesión no se escribe nada: una server action es un endpoint que se
  // invoca sin pasar por ninguna pantalla.
  it('sin sesión, redirige y no escribe', async () => {
    estado.cookie = ''
    const ventaId = await unaVentaCobrada()

    await expect(guardarDetalle({ ventaId, detalle: 'x' })).rejects.toThrow('REDIRECT')
    expect(await detalleDe(ventaId)).toBeNull()
  })
})
