import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import type { MockedFunction } from 'vitest'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'
import { ErrorDeVenta } from '@/lib/ventas/errores'
import type { Permiso } from '@/lib/permisos/catalogo'

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

// Para `corregirPagos`, más abajo: `exigirSesion` y `permisosDe` se espían
// (autospy) en vez de reemplazarse del todo. Por default una spy LLAMA A LA
// IMPLEMENTACIÓN REAL, así que `anular`/`guardarDetalle` de arriba —que
// dependen del login real vía cookie— siguen exactamente igual; sólo el
// describe de `corregirPagos`, al final del archivo, les configura un valor
// de retorno propio.
vi.mock('@/lib/auth/sesion', { spy: true })
vi.mock('@/lib/permisos/consultar', { spy: true })

// El motor de la corrección, en cambio, se reemplaza ENTERO: a diferencia de
// `anular`/`guardarDetalle`, el describe de `corregirPagos` prueba sólo el
// CONTRATO de la action —el guard, la traducción de errores—, no el motor,
// que ya tiene su propio test contra la base en la Task 5
// (lib/ventas/editar.test.ts).
const reemplazarPagosMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ventas/editar', () => ({ reemplazarPagos: reemplazarPagosMock }))

let anular: typeof import('./acciones').anular
let guardarDetalle: typeof import('./acciones').guardarDetalle
let corregirPagos: typeof import('./acciones').corregirPagos
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest
// Las dos spies de `corregirPagos`. Se resuelven acá y no con un import
// estático de `@/lib/auth/sesion`/`@/lib/permisos/consultar` arriba del
// archivo por la misma razón que `anular`/`guardarDetalle`: esos módulos
// arrastran `lib/db.ts`, que arma su Pool leyendo `DATABASE_URL` al
// importarse, y esa variable recién se fija acá abajo.
let sesionMock: MockedFunction<typeof import('@/lib/auth/sesion').exigirSesion>
let permisosMock: MockedFunction<typeof import('@/lib/permisos/consultar').permisosDe>

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

  ;({ anular, guardarDetalle, corregirPagos } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  sesionMock = vi.mocked((await import('@/lib/auth/sesion')).exigirSesion)
  permisosMock = vi.mocked((await import('@/lib/permisos/consultar')).permisosDe)
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

/**
 * `corregirPagos` prueba sólo el CONTRATO de la action: el guard, y que lo
 * que llega mal formado de afuera salga como aviso y no como 500. El motor
 * (`reemplazarPagos`) está mockeado —tiene su propio test contra la base en
 * `lib/ventas/editar.test.ts` (Task 5)— así que estos casos no tocan Postgres
 * y no comparten fixtures con `anular`/`guardarDetalle` de arriba.
 *
 * Va AL FINAL del archivo a propósito: `sesionMock`/`permisosMock` son spies
 * sobre `exigirSesion`/`permisosDe` que este describe configura con un valor
 * fijo, pisando (mientras dure el archivo) el comportamiento real del que
 * dependen los describes de arriba. Corriendo después de ellos, no hay nada
 * que puedan romper.
 */
describe('corregirPagos', () => {
  // Dos uuid cualesquiera: estos tests no tocan la base, así que no hace
  // falta que `TENANT`/`USUARIO`/`VENTA` existan de verdad.
  const TENANT = '01920000-0000-7000-8000-0000000000aa'
  const USUARIO = '01920000-0000-7000-8000-0000000000bb'
  const VENTA = '01920000-0000-7000-8000-000000000001'
  const UN_PAGO = [
    { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: '1000', cotizacion: '1', planId: null },
  ]
  // El mismo texto que `NO_EXISTE` en acciones.ts (no se puede importar: ese
  // archivo es 'use server' y sólo puede exportar funciones async). Una sola
  // constante acá, para no repetir el literal entre el caso del id mal
  // formado y el del id ajeno/inexistente — son el mismo mensaje a propósito.
  const NO_EXISTE = 'Esa venta no existe.'

  // Sólo el HISTORIAL de llamadas: los `mockResolvedValue` de `sesionMock` y
  // `permisosMock` se dejan vivir de un test al otro a propósito, igual que
  // en el brief — cada test que necesita otro permiso lo vuelve a fijar.
  beforeEach(() => {
    reemplazarPagosMock.mockClear()
  })

  it('sin VENTAS_EDITAR no llega al motor', async () => {
    sesionMock.mockResolvedValue({
      tenant: { id: TENANT, nombre: 'Local de prueba', estado: 'TRIAL' },
      subdominio: 'local-de-prueba',
      usuario: { id: USUARIO, nombre: 'Un empleado', email: 'e@ejemplo.test', rol: 'EMPLEADO' },
    })
    permisosMock.mockResolvedValue(new Set<Permiso>())

    // `exigirPermiso` llama a `forbidden()` de next/navigation, que tira.
    await expect(corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '' })).rejects.toThrow()
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })

  it('con VENTAS_EDITAR llega al motor con los importes como Decimal', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))
    reemplazarPagosMock.mockResolvedValueOnce(undefined)

    const r = await corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '  era transferencia ' })

    expect(r.error).toBeNull()
    const arg = reemplazarPagosMock.mock.calls[0][0]
    expect(arg.pagos[0].base.toString()).toBe('1000')
    expect(arg.pagos[0].planId).toBeUndefined()
    // La nota viaja CRUDA: `reemplazarPagos` es quien la normaliza (trim,
    // tope, vacío → null). Normalizarla acá también sería la segunda
    // implementación de la misma regla.
    expect(arg.nota).toBe('  era transferencia ')
  })

  it('traduce un ErrorDeVenta a un aviso y no a un 500', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))
    reemplazarPagosMock.mockRejectedValueOnce(
      new ErrorDeVenta('PAGOS_NO_CIERRAN', 'los pagos en pesos suman 900 y el total en pesos es 1000'),
    )

    const r = await corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '' })

    expect(r.error).toContain('los pagos en pesos suman 900')
    expect(r.aviso).toBeNull()
  })

  it('un ventaId mal formado no llega a Prisma', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))

    const r = await corregirPagos({ ventaId: 'no-es-uuid', pagos: UN_PAGO, nota: '' })

    expect(r.error).toBe(NO_EXISTE)
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })

  // El camino que el guard de arriba NO frena: un uuid bien formado que
  // `reemplazarPagos` rechaza por `VENTA_INEXISTENTE` (ajeno, o inventado
  // pero con forma de uuid). Su mensaje real lleva el id y "no existe en
  // este tenant" —diagnóstico para el log del servidor—, y eso NO puede
  // salir por la action: le contaría el modelo de aislamiento a quien prueba
  // ids, y además, si no se tradujera, sería distinguible del caso de arriba
  // (id mal formado), que es justo lo que la constraint del brief prohíbe.
  // Los dos caminos tienen que dar el MISMO texto — comparado contra la
  // constante de este archivo, no contra un literal repetido.
  it('un ventaId ajeno/inexistente da el MISMO mensaje que uno mal formado, sin el uuid ni el detalle del tenant', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))
    reemplazarPagosMock.mockRejectedValueOnce(
      new ErrorDeVenta('VENTA_INEXISTENTE', `la venta ${VENTA} no existe en este tenant`),
    )

    const ajenoOInexistente = await corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '' })
    const malFormado = await corregirPagos({ ventaId: 'no-es-uuid', pagos: UN_PAGO, nota: '' })

    expect(ajenoOInexistente.error).toBe(NO_EXISTE)
    expect(ajenoOInexistente.error).toBe(malFormado.error)
  })

  it('un importe que no es un número sale como aviso, no como 500', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))

    const r = await corregirPagos({
      ventaId: VENTA,
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: 'mil', cotizacion: '1', planId: null }],
      nota: '',
    })

    expect(r.error).not.toBeNull()
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })

  // Los casts a `MedioPago`/`Moneda` no validan nada por sí solos: sin este
  // guard, un enum inventado lo rechazaría Prisma recién adentro de
  // `reemplazarPagos`, con un `PrismaClientValidationError` sin `codigo` — un
  // 500. Mismo guard, mismo motivo, que ya usa `cobrar`
  // (app/(app)/vender/acciones.ts) para el mismo problema.
  it('un medio de pago inventado sale como aviso, no como 500', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))

    const r = await corregirPagos({
      ventaId: VENTA,
      pagos: [{ medio: 'CRIPTO', moneda: 'ARS', cubre: 'ARS', base: '1000', cotizacion: '1', planId: null }],
      nota: '',
    })

    expect(r.error).not.toBeNull()
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })

  it('una moneda inventada sale como aviso, no como 500', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))

    const r = await corregirPagos({
      ventaId: VENTA,
      pagos: [{ medio: 'EFECTIVO', moneda: 'YENES', cubre: 'ARS', base: '1000', cotizacion: '1', planId: null }],
      nota: '',
    })

    expect(r.error).not.toBeNull()
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })

  it('un "cubre" inventado sale como aviso, no como 500', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))

    const r = await corregirPagos({
      ventaId: VENTA,
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'YENES', base: '1000', cotizacion: '1', planId: null }],
      nota: '',
    })

    expect(r.error).not.toBeNull()
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })

  // `planId` viaja como string suelta y no como uuid tipado: un `planId`
  // mal formado llegaría intacto hasta el `findMany({ where: { id: { in:
  // [...] } } })` de `resolverPagosConRecargo` (lib/ventas/pagos.ts) y
  // Prisma lo rechazaría ahí con un error sin `codigo` — el mismo riesgo que
  // ya blindan `ventaId` y el resto de esta action. Mismo guard que usa
  // `cobrar` para el mismo campo.
  it('un planId mal formado sale como aviso, no como 500', async () => {
    permisosMock.mockResolvedValue(new Set<Permiso>(['VENTAS_EDITAR']))

    const r = await corregirPagos({
      ventaId: VENTA,
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: '1000', cotizacion: '1', planId: 'no-es-uuid' },
      ],
      nota: '',
    })

    expect(r.error).not.toBeNull()
    expect(reemplazarPagosMock).not.toHaveBeenCalled()
  })
})
