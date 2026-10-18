import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant, crearUsuario } from '@/test/datos'

/**
 * La cotización del dólar del local: la action que la carga, las lecturas que
 * la muestran, y que el cobro siga guardando lo que se tipeó.
 *
 * Spec: docs/superpowers/specs/2026-10-18-cotizacion-del-dolar-design.md.
 * Contra el Postgres efímero, con login real de Better Auth: el permiso se
 * decide con la sesión, y un mock de la guarda no probaría la guarda.
 */

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Cotización test', estado: 'TRIAL' },
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

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (r: string, t?: string) => revalidatePath(r, t) }))

let cargar: typeof import('./acciones').cargarCotizacionDesdeVender
let cobrar: typeof import('./acciones').cobrar
let cotizacionVigente: typeof import('@/lib/cotizacion/consultar').cotizacionVigente
let historialDeCotizaciones: typeof import('@/lib/cotizacion/consultar').historialDeCotizaciones
let cargarCotizacion: typeof import('@/lib/cotizacion/administrar').cargarCotizacion
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test: acciones.ts es 'use server' y sólo exporta funciones async.
const INICIAL = { error: null, confirmar: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-cotizacion@ejemplo.test'
const MAIL_EMPLEADO_CON_PERMISO = 'encargado-cotizacion@ejemplo.test'
const MAIL_DUENO = 'duenia-cotizacion@ejemplo.test'

let owner: Client
let cookieEmpleado: string
let cookieEncargado: string
let cookieDuenia: string
let otroTenantId: string
let articuloUsdId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ cargarCotizacionDesdeVender: cargar, cobrar } = await import('./acciones'))
  ;({ cotizacionVigente, historialDeCotizaciones } = await import('@/lib/cotizacion/consultar'))
  ;({ cargarCotizacion } = await import('@/lib/cotizacion/administrar'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')
  const { otorgar } = await import('@/lib/permisos/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `cotizacion-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio
  otroTenantId = await crearTenant(owner, `cotizacion-otro-${Date.now()}`)

  const origen = await origenDelRequest(subdominio)
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un vendedor',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  const encargado = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'El encargado',
    email: MAIL_EMPLEADO_CON_PERMISO, clave: CLAVE, rol: 'EMPLEADO',
  })
  await otorgar({ tenantId: estado.tenantId, usuarioId: encargado.id, permiso: 'COTIZACION' })
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })

  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
  cookieEncargado = await cookieDe(MAIL_EMPLEADO_CON_PERMISO)
  cookieDuenia = await cookieDe(MAIL_DUENO)

  const u = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'COT-USD', 'iPhone en dólares', 'PRODUCTO', 300.00, 'USD', 10, now(), now())
     RETURNING id`,
    [estado.tenantId],
  )
  articuloUsdId = u.rows[0].id
})

afterAll(async () => {
  await owner.end()
})

// Como owner: la app no puede borrar filas de esta tabla, y eso es justamente
// lo que la hace un historial.
beforeEach(async () => {
  await owner.query('DELETE FROM cotizaciones_del_dolar WHERE tenant_id = ANY($1)', [[estado.tenantId, otroTenantId]])
  revalidatePath.mockClear()
  forbidden.mockClear()
})

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

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData()
  for (const [k, v] of Object.entries(campos)) datos.set(k, v)
  return datos
}

describe('quién carga la cotización: el permiso COTIZACION', () => {
  it('la dueña la carga sin ningún permiso otorgado', async () => {
    estado.cookie = cookieDuenia
    const r = await cargar(INICIAL, formulario({ valor: '1450' }))
    expect(r).toEqual({ error: null, confirmar: null, aviso: expect.stringContaining('1.450') })
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450')
  })

  it('un empleado CON el permiso la carga', async () => {
    estado.cookie = cookieEncargado
    const r = await cargar(INICIAL, formulario({ valor: '1450,50' }))
    expect(r.error).toBeNull()
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450.5')
  })

  it('un empleado SIN el permiso recibe forbidden y no se escribe nada', async () => {
    estado.cookie = cookieEmpleado
    await expect(cargar(INICIAL, formulario({ valor: '1450' }))).rejects.toThrow('FORBIDDEN')
    expect(forbidden).toHaveBeenCalled()
    expect(await cotizacionVigente(estado.tenantId)).toBeNull()
  })

  // Cada pantalla que usa la vigente tiene que dejar de mostrar la vieja.
  it('revalida las tres pantallas que la leen', async () => {
    estado.cookie = cookieDuenia
    await cargar(INICIAL, formulario({ valor: '1450' }))
    const rutas = revalidatePath.mock.calls.map((c) => c[0])
    expect(rutas).toEqual(expect.arrayContaining(['/vender', '/inventario', '/plan-canje']))
  })
})

describe('el historial', () => {
  it('cada carga queda con quién y cuándo, la más nueva primero, y la vigente es la última', async () => {
    estado.cookie = cookieDuenia
    await cargar(INICIAL, formulario({ valor: '1400' }))
    estado.cookie = cookieEncargado
    await cargar(INICIAL, formulario({ valor: '1450' }))

    const historial = await historialDeCotizaciones(estado.tenantId)
    expect(historial.map((h) => [h.valor, h.cargadaPor])).toEqual([
      ['1450', 'El encargado'],
      ['1400', 'La dueña'],
    ])
    expect(historial[0].creadaEn).toBeInstanceOf(Date)
    expect(historial[0].creadaEn.getTime()).toBeGreaterThanOrEqual(historial[1].creadaEn.getTime())
    expect(await cotizacionVigente(estado.tenantId)).toEqual({
      valor: '1450',
      creadaEn: historial[0].creadaEn,
    })
  })

  // `creada_en` es la hora de inicio de la transacción: dos cargas con el
  // mismo instante se ordenan por id (uuid(7)), y la vigente es la última.
  it('con dos cargas del mismo instante, desempata por id', async () => {
    const usuario = await crearUsuario(owner, estado.tenantId, `mismo-instante-${Date.now()}@ejemplo.test`)
    await owner.query(
      `INSERT INTO cotizaciones_del_dolar (id, tenant_id, valor, cargada_por_id, creada_en) VALUES
         ('01900000-0000-7000-8000-000000000001', $1, 1400, $2, '2026-10-18T12:00:00Z'),
         ('01900000-0000-7000-8000-000000000002', $1, 1450, $2, '2026-10-18T12:00:00Z')`,
      [estado.tenantId, usuario],
    )
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450')
  })

  it('muestra las últimas diez', async () => {
    estado.cookie = cookieDuenia
    for (let i = 0; i < 12; i++) {
      const r = await cargar(INICIAL, formulario({ valor: String(1400 + i) }))
      expect(r.error).toBeNull()
    }
    const historial = await historialDeCotizaciones(estado.tenantId)
    expect(historial).toHaveLength(10)
    expect(historial[0].valor).toBe('1411')
  })

  it('cada local ve sólo su cotización y su historial', async () => {
    estado.cookie = cookieDuenia
    await cargar(INICIAL, formulario({ valor: '1450' }))
    expect(await cotizacionVigente(otroTenantId)).toBeNull()
    expect(await historialDeCotizaciones(otroTenantId)).toEqual([])

    const ajeno = await crearUsuario(owner, otroTenantId, `ajeno-${Date.now()}@ejemplo.test`)
    await cargarCotizacion({ tenantId: otroTenantId, usuarioId: ajeno, texto: '9999', confirmada: true })
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450')
    expect((await historialDeCotizaciones(estado.tenantId)).map((h) => h.valor)).toEqual(['1450'])
  })

  // La FK a users no pasa por RLS: sin la red de `exigirUsuario`, un usuario
  // de otro local podría firmar una carga de éste.
  it('un usuario de otro local no puede firmar una carga', async () => {
    const ajeno = await crearUsuario(owner, otroTenantId, `firma-ajena-${Date.now()}@ejemplo.test`)
    await expect(
      cargarCotizacion({ tenantId: estado.tenantId, usuarioId: ajeno, texto: '1450', confirmada: false }),
    ).rejects.toThrow(/no existe en este tenant/)
    expect(await cotizacionVigente(estado.tenantId)).toBeNull()
  })
})

describe('las validaciones', () => {
  it.each([
    ['', 'Falta la cotización.'],
    ['0', 'mayor que cero'],
    ['abc', 'no es un número'],
    ['1450,555', 'ambigua o con tres decimales'],
    ['1450,5555', 'hasta dos decimales'],
    ['99999999999', 'no entra'],
  ])('rechaza "%s" con un cartel y sin escribir', async (valor, fragmento) => {
    estado.cookie = cookieDuenia
    const r = await cargar(INICIAL, formulario({ valor }))
    expect(r.error, `"${valor}" pasó`).not.toBeNull()
    // "1450,555" es ambiguo para la gramática compartida (¿miles o
    // decimales?): el mensaje es el de lib/formato, no el de esta tabla.
    if (fragmento !== 'ambigua o con tres decimales') expect(r.error).toContain(fragmento)
    expect(await cotizacionVigente(estado.tenantId)).toBeNull()
  })

  // La gramática de cotización (`aCotizacionCanonica`): la compartida, salvo
  // que "1.450" es mil cuatrocientos cincuenta — "uno con cuatrocientos
  // cincuenta pesos por dólar" no existe (hallazgo de la review). Un precio de
  // "1.450" sigue siendo ambiguo; eso lo cubre lib/formato/numeros.test.ts.
  it('"1.450" es mil cuatrocientos cincuenta, y "1.450,50" también se entiende', async () => {
    estado.cookie = cookieDuenia
    expect((await cargar(INICIAL, formulario({ valor: '1.450' }))).error).toBeNull()
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450')
    expect((await cargar(INICIAL, formulario({ valor: '1.450,50' }))).error).toBeNull()
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450.5')
  })

  it('"1,450" (coma y tres dígitos) se sigue rechazando por ambiguo', async () => {
    estado.cookie = cookieDuenia
    expect((await cargar(INICIAL, formulario({ valor: '1,450' }))).error).toContain('sin separador de miles')
  })
})

describe('el tope de cordura: más de la mitad de diferencia pide confirmar', () => {
  it('un cero de más no se carga sin confirmar, y confirmado sí', async () => {
    estado.cookie = cookieDuenia
    await cargar(INICIAL, formulario({ valor: '1450' }))

    const pregunta = await cargar(INICIAL, formulario({ valor: '14500' }))
    expect(pregunta.error).toBeNull()
    expect(pregunta.confirmar).toContain('14.500')
    expect(pregunta.confirmar).toContain('1.450')
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('1450')

    // Sólo "1" confirma: cualquier otra cosa sigue siendo la pregunta.
    expect((await cargar(INICIAL, formulario({ valor: '14500', confirmada: 'true' }))).confirmar).not.toBeNull()

    const confirmada = await cargar(INICIAL, formulario({ valor: '14500', confirmada: '1' }))
    expect(confirmada.confirmar).toBeNull()
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('14500')
  })

  it('la primera carga dentro de lo verosímil no pregunta nada', async () => {
    estado.cookie = cookieDuenia
    expect((await cargar(INICIAL, formulario({ valor: '14500' }))).confirmar).toBeNull()
  })

  // Sin vigente no hay salto que medir: la red de la primera carga es un rango
  // verosímil ($ 100 a $ 100.000 por dólar), con la misma pregunta.
  it('la primera carga fuera de $ 100–$ 100.000 pide confirmar, y confirmada se carga', async () => {
    estado.cookie = cookieDuenia
    const pregunta = await cargar(INICIAL, formulario({ valor: '14,50' }))
    expect(pregunta.error).toBeNull()
    expect(pregunta.confirmar).toContain('fuera de lo esperable')
    expect(await cotizacionVigente(estado.tenantId)).toBeNull()

    const muyAlta = await cargar(INICIAL, formulario({ valor: '1450000' }))
    expect(muyAlta.confirmar).toContain('fuera de lo esperable')

    const confirmada = await cargar(INICIAL, formulario({ valor: '14,50', confirmada: '1' }))
    expect(confirmada.confirmar).toBeNull()
    expect((await cotizacionVigente(estado.tenantId))?.valor).toBe('14.5')
  })
})

// `Pago.cotizacion` no cambia de significado: es a cuánto se cobró ESE pago.
// La del local sólo arranca el campo; lo que se guarda es lo que quedó tipeado.
describe('el cobro guarda la cotización tipeada, no la del local', () => {
  it('con la del local en 1450, un pago tipeado a 1485 queda a 1485', async () => {
    estado.cookie = cookieDuenia
    await cargar(INICIAL, formulario({ valor: '1450' }))

    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `tipeada-${Date.now()}` })
    datos.set('items', JSON.stringify([{ articuloId: articuloUsdId, cantidad: '1' }]))
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: '300', cotizacion: '1485' },
    ]))
    const r = await cobrar({ error: null, venta: null }, datos)
    expect(r.error).toBeNull()
    const { rows } = await owner.query('SELECT cotizacion, monto FROM pagos WHERE venta_id = $1', [r.venta?.id])
    expect(rows[0].cotizacion).toBe('1485.0000')
    expect(Number(rows[0].monto)).toBe(445_500)
  })

  // El campo "Cotización" del cobro usa la misma gramática que el chip: un
  // "1.485" tipeado en el mostrador es mil cuatrocientos ochenta y cinco
  // también en el servidor.
  it('"1.485" tipeado en el cobro se guarda como 1485', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `con-punto-${Date.now()}` })
    datos.set('items', JSON.stringify([{ articuloId: articuloUsdId, cantidad: '1' }]))
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: '300', cotizacion: '1.485' },
    ]))
    const r = await cobrar({ error: null, venta: null }, datos)
    expect(r.error).toBeNull()
    const { rows } = await owner.query('SELECT cotizacion FROM pagos WHERE venta_id = $1', [r.venta?.id])
    expect(rows[0].cotizacion).toBe('1485.0000')
  })
})
