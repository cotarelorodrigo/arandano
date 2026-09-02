import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'
import { aCentavos, deCentavos, deMilesimas } from '@/lib/ventas/centavos'

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
let unidadesDeArticulo: typeof import('./acciones').unidadesDeArticulo
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
let articuloUsdId: string
let precioArticulo: string
let cookieEmpleado: string
// El artículo con serie y quién lo carga, para los tests de unidadId.
let articuloSerieId: string
let precioArticuloSerie: string
let duenioId: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ cobrar, buscarArticulos, unidadesDeArticulo } = await import('./acciones'))
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
  const dueno = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })
  duenioId = dueno.id

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

  // Un artículo de lista EN DÓLARES, para el pago que cruza monedas: es el
  // único camino por el que el `cubre` que manda la pantalla llega al motor y
  // se puede afirmar sobre el resultado.
  const u = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'VEN-USD', 'Artículo en dólares', 'PRODUCTO', 300.00, 'USD', 10, now(), now())
     RETURNING id`,
    [estado.tenantId],
  )
  articuloUsdId = u.rows[0].id

  // Un artículo con serie, para los tests de unidadId. Sin stock inicial en la
  // columna: `crearVenta` no valida stock suficiente (decisión ya tomada), y
  // las unidades las inserta cada test por SQL con `crearUnidadLibre`, igual
  // que el resto de los fixtures de este archivo.
  const s = await owner.query(
    `INSERT INTO articulos
       (id, tenant_id, sku, nombre, tipo, precio, stock, lleva_serie, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'VEN-SERIE', 'iPhone de prueba', 'PRODUCTO', 500000.00, 0, true, now(), now())
     RETURNING id, precio`,
    [estado.tenantId],
  )
  articuloSerieId = s.rows[0].id
  precioArticuloSerie = s.rows[0].precio

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
    { medio: 'EFECTIVO', moneda: 'ARS', base: precioArticulo, cotizacion: '1' },
  ]))
  datos.set('clave', clave)
  return datos
}

/** Una unidad libre nueva de `articuloSerieId`, con un IMEI único por
 *  llamada — así cada test que necesita "una unidad libre" arranca con la
 *  suya propia, sin pisar la de otro test. */
async function crearUnidadLibre(): Promise<{ id: string; imei: string }> {
  const imei = `imei-${crypto.randomUUID()}`
  const r = await owner.query(
    `INSERT INTO unidades_articulo (id, tenant_id, articulo_id, imei, ingresada_por_id, creado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now())
     RETURNING id`,
    [estado.tenantId, articuloSerieId, imei, duenioId],
  )
  return { id: r.rows[0].id, imei }
}

/** El `venta_id` de una unidad tal como quedó en la base, para afirmar a
 *  quién se la llevó (o que sigue libre). */
async function leerUnidad(unidadId: string): Promise<{ ventaId: string | null }> {
  const r = await owner.query(
    `SELECT venta_id AS "ventaId" FROM unidades_articulo WHERE id = $1`,
    [unidadId],
  )
  return r.rows[0]
}

/** Un carrito de una unidad de `articuloSerieId`, con la unidad dada. */
function datosConUnidad(unidadId: string, clave: string): FormData {
  const datos = new FormData()
  datos.set('items', JSON.stringify([{ articuloId: articuloSerieId, cantidad: '1', unidadId }]))
  datos.set('pagos', JSON.stringify([
    { medio: 'EFECTIVO', moneda: 'ARS', base: precioArticuloSerie, cotizacion: '1' },
  ]))
  datos.set('clave', clave)
  return datos
}

/** Cobra una unidad con la cookie del empleado, como haría "la primera caja".
 *  Tira si la venta fixture no sale bien: un test que depende de esto no
 *  probaría nada si la propia venta fallara. */
async function venderLaUnidad(unidadId: string): Promise<void> {
  estado.cookie = cookieEmpleado
  const r = await cobrar(INICIAL, datosConUnidad(unidadId, `primera-caja-${crypto.randomUUID()}`))
  if (r.error) throw new Error(`fixture rota, no se pudo vender la unidad: ${r.error}`)
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
      { medio: 'CRIPTO', moneda: 'ARS', base: '1000', cotizacion: '1' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/medio de pago desconocido/)
  })

  // No llega desde la pantalla —los ids salen del buscador—, pero sí desde un
  // POST armado a mano, y sin el guard Prisma tiraba un error sin `codigo` que
  // `traducir` relanza: un 500 donde correspondía un error de dominio.
  it('un articuloId que no es uuid vuelve como error, no como 500', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `uuid-${Date.now()}` })
    datos.set('items', JSON.stringify([{ articuloId: 'no-es-un-uuid', cantidad: '1' }]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/no existe el artículo/)
  })

  // La cantidad que el punto de venta escribe solo al sumar unidades. Antes de
  // esta tanda `deMilesimas` emitía "2.000" y ESTE caso volvía como
  // NUMERO_AMBIGUO: la venta entera se caía por pasar dos veces el lector.
  it('dos unidades de la forma en que la pantalla las escribe se cobran', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `dos-${Date.now()}` })
    datos.set('items', JSON.stringify([{ articuloId, cantidad: deMilesimas(2000) }]))
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', base: deCentavos(aCentavos(precioArticulo) * 2), cotizacion: '1' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toBeNull()
    expect(r.venta?.numero).toBeGreaterThan(0)
  })

  // Mismo motivo que el caso del articuloId de arriba, un campo más abajo: sin
  // el guard, un uuid mal formado llega a Prisma y sale como error sin
  // `codigo`, o sea un 500 donde correspondía un cartel corregible.
  it('un planId que no es uuid se rechaza como error de dominio, no como 500', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `plan-uuid-${Date.now()}` })
    datos.set('pagos', JSON.stringify([
      { medio: 'TARJETA_CREDITO', moneda: 'ARS', base: precioArticulo, cotizacion: '1',
        planId: 'no-es-uuid' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/plan/i)
  })

  // El pago que este ciclo hizo posible: se entregan PESOS contra el total en
  // DÓLARES. La base va en dólares (300, el precio de lista) y la cotización
  // convierte; el motor no divide en ningún lado.
  it('un pago en pesos puede cubrir el total en dólares', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `cruce-${Date.now()}` })
    datos.set('items', JSON.stringify([{ articuloId: articuloUsdId, cantidad: '1' }]))
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: '300', cotizacion: '1485' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toBeNull()
    // Y en la base quedó lo que entró al cajón: 300 × 1485 pesos, con el
    // `cubre` que declaró la pantalla.
    const { rows } = await owner.query(
      `SELECT p.moneda, p.cubre, p.monto FROM pagos p WHERE p.venta_id = $1`,
      [r.venta?.id],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].cubre).toBe('USD')
    expect(rows[0].moneda).toBe('ARS')
    expect(Number(rows[0].monto)).toBe(445_500)
  })

  // Sin `cubre` en el JSON, el pago cubre el total en pesos: es lo que era
  // toda venta antes de este ciclo, y lo que sigue mandando una pestaña que
  // quedó abierta desde antes del deploy.
  it('un pago sin `cubre` cubre el total en pesos, como siempre', async () => {
    estado.cookie = cookieEmpleado
    const r = await cobrar(INICIAL, formulario({ clave: `sin-cubre-${Date.now()}` }))
    expect(r.error).toBeNull()
    const { rows } = await owner.query(
      `SELECT cubre FROM pagos WHERE venta_id = $1`, [r.venta?.id],
    )
    expect(rows[0].cubre).toBe('ARS')
  })

  // Mismo criterio que el medio y la moneda: contra lista blanca, para que un
  // enum inventado vuelva como error de dominio y no como un 500 de Prisma.
  it('un `cubre` inventado vuelve como error, no como 500', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `cubre-roto-${Date.now()}` })
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'EUR', base: precioArticulo, cotizacion: '1' },
    ]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toMatch(/moneda desconocida: EUR/)
  })

  it('los pagos que no cierran vuelven como error entendible', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `nocierra-${Date.now()}` })
    datos.set('pagos', JSON.stringify([
      { medio: 'EFECTIVO', moneda: 'ARS', base: '1', cotizacion: '1' },
    ]))
    const r = await cobrar(INICIAL, datos)
    // Task 3 (2026-08-29) partió el mensaje en dos invariantes, uno por
    // moneda: "los pagos EN PESOS suman…" y no "los pagos suman…" a secas.
    expect(r.error).toMatch(/pagos en pesos suman/)
  })

  it('cobrar pasa el unidadId al motor', async () => {
    estado.cookie = cookieEmpleado
    const u = await crearUnidadLibre()
    const r = await cobrar(INICIAL, datosConUnidad(u.id, `unidad-${crypto.randomUUID()}`))
    expect(r.error).toBeNull()
    expect((await leerUnidad(u.id)).ventaId).toBe(r.venta!.id)
  })

  // Mismo guard que el articuloId: desde la pantalla no llega otra cosa —los
  // ids salen del buscador o del selector de unidad—, pero un POST armado a
  // mano sí, y Prisma lo rechazaría con un código que `traducir` relanzaría
  // como 500.
  it('un unidadId que no es uuid da error de dominio y no un 500', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `unidad-uuid-${Date.now()}` })
    datos.set('items', JSON.stringify([{ articuloId, cantidad: '1', unidadId: 'pepe' }]))
    const r = await cobrar(INICIAL, datos)
    expect(r.error).toContain('equipo')
  })

  // El caso de la segunda caja: `UNIDAD_NO_DISPONIBLE` ya viaja como
  // `ErrorDeVenta`, y `traducir` lo muestra tal cual — este test fija que el
  // cartel del mostrador diga lo que pasó, no sólo que haya un error.
  it('si otra caja se llevó la unidad, el cartel dice qué pasó', async () => {
    const u = await crearUnidadLibre()
    await venderLaUnidad(u.id) // la primera caja cobra
    estado.cookie = cookieEmpleado
    const r = await cobrar(INICIAL, datosConUnidad(u.id, `segunda-caja-${crypto.randomUUID()}`))
    expect(r.error).toContain('se acaba de vender')
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

describe('unidadesDeArticulo', () => {
  it('no devuelve nada sin sesión', async () => {
    estado.cookie = ''
    await expect(unidadesDeArticulo(articuloSerieId)).rejects.toThrow('REDIRECT')
  })

  it('con sesión, trae las unidades libres de ese artículo', async () => {
    estado.cookie = cookieEmpleado
    const u = await crearUnidadLibre()
    const r = await unidadesDeArticulo(articuloSerieId)
    expect(r.map((x) => x.id)).toContain(u.id)
  })
})
