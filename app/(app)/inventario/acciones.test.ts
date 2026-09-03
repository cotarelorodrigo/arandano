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
let exportarHistorialCsv: typeof import('./acciones').exportarHistorialCsv
// Task 8 del ciclo de unidades por IMEI: las tres acciones nuevas.
let prenderSerieAccion: typeof import('./acciones').prenderSerieAccion
let apagarSerieAccion: typeof import('./acciones').apagarSerieAccion
let darDeBajaUnidadAccion: typeof import('./acciones').darDeBajaUnidadAccion
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest
// Dinámico y no estático, como el resto de este archivo: `lib/inventario/
// unidades.ts` arrastra `lib/db.ts` (vía `lib/tenant/transaccion.ts`), que arma
// su Pool leyendo `DATABASE_URL` al importarse — un `import` estático de este
// módulo correría ANTES de que `beforeAll` fije esa variable, y el Pool
// quedaría apuntando a la base equivocada (o a ninguna).
let unidadesLibres: typeof import('@/lib/inventario/unidades').unidadesLibres
let prenderSerie: typeof import('@/lib/inventario/unidades').prenderSerie

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-inventario@ejemplo.test'
const MAIL_DUENO = 'duenia-inventario@ejemplo.test'
// Dos empleados más, para el blindaje de COSTOS por efecto (I5 de la review
// final): uno con ARTICULOS_CREAR pero sin COSTOS —para probar altaArticulo
// sin colisionar con el `cookieEmpleado` de arriba, que ni siquiera pasa el
// primer guard— y uno con COSTOS, para el par positivo.
const MAIL_EMPLEADO_ALTA_SIN_COSTOS = 'empleado-alta-sin-costos@ejemplo.test'
const MAIL_EMPLEADO_CON_COSTOS = 'empleado-con-costos@ejemplo.test'
// Uno más, para I1: ARTICULOS_EDITAR sin CATEGORIAS, el bypass que la review
// encontró en `guardarArticulo`.
const MAIL_EMPLEADO_EDITAR_SIN_CATEGORIAS = 'empleado-editar-sin-categorias@ejemplo.test'

let owner: Client
let empleadoId: string
let articuloId: string
let cookieEmpleado: string
let cookieDuenio: string
let cookieEmpleadoAltaSinCostos: string
let cookieEmpleadoConCostos: string
let cookieEmpleadoEditarSinCategorias: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({
    altaArticulo, guardarArticulo, bajaArticulo,
    reactivarArticuloAccion, ingresarMercaderia, corregirPorConteo,
    exportarHistorialCsv, prenderSerieAccion, apagarSerieAccion, darDeBajaUnidadAccion,
  } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  ;({ unidadesLibres, prenderSerie } = await import('@/lib/inventario/unidades'))
  const administrar = await import('@/lib/usuarios/administrar')
  const { otorgar } = await import('@/lib/permisos/administrar')

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

  const empleadoAltaSinCostos = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Empleado con alta, sin costos',
    email: MAIL_EMPLEADO_ALTA_SIN_COSTOS, clave: CLAVE, rol: 'EMPLEADO',
  })
  await otorgar({
    tenantId: estado.tenantId, usuarioId: empleadoAltaSinCostos.id, permiso: 'ARTICULOS_CREAR',
  })

  const empleadoConCostos = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Empleado con costos',
    email: MAIL_EMPLEADO_CON_COSTOS, clave: CLAVE, rol: 'EMPLEADO',
  })
  await otorgar({ tenantId: estado.tenantId, usuarioId: empleadoConCostos.id, permiso: 'COSTOS' })

  const empleadoEditarSinCategorias = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Empleado con editar, sin categorías',
    email: MAIL_EMPLEADO_EDITAR_SIN_CATEGORIAS, clave: CLAVE, rol: 'EMPLEADO',
  })
  await otorgar({
    tenantId: estado.tenantId, usuarioId: empleadoEditarSinCategorias.id, permiso: 'ARTICULOS_EDITAR',
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
  cookieEmpleadoAltaSinCostos = await cookieDe(MAIL_EMPLEADO_ALTA_SIN_COSTOS)
  cookieEmpleadoConCostos = await cookieDe(MAIL_EMPLEADO_CON_COSTOS)
  cookieEmpleadoEditarSinCategorias = await cookieDe(MAIL_EMPLEADO_EDITAR_SIN_CATEGORIAS)
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
 * Parsea una fila de CSV (RFC 4180): entiende comillas y comillas dobles
 * escapadas. La usan las aserciones de `exportarHistorialCsv` de más abajo
 * para mirar una COLUMNA exacta (I4 de la review): la fila también trae
 * "DD/MM · HH:MM", así que buscar un número por `toContain` sobre la fila
 * entera puede coincidir por casualidad con el día, el mes, la hora o el
 * minuto en vez de con el saldo.
 */
function celdasDe(fila: string): string[] {
  const celdas: string[] = []
  let actual = ''
  let entreComillas = false
  for (let i = 0; i < fila.length; i++) {
    const c = fila[i]
    if (entreComillas) {
      if (c === '"') {
        if (fila[i + 1] === '"') {
          actual += '"'
          i++
        } else {
          entreComillas = false
        }
      } else {
        actual += c
      }
    } else if (c === '"') {
      entreComillas = true
    } else if (c === ',') {
      celdas.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  celdas.push(actual)
  return celdas
}

let contadorSku = 0

/** Un artículo propio por test: evita que los casos de guardar/dar de baja/
 *  reactivar/corregir se pisen entre sí o con `articuloId`, que ya usan otros
 *  casos de este describe. */
async function crearArticuloDePrueba(nombre: string, stock = '0'): Promise<string> {
  contadorSku += 1
  const { rows } = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 'PRODUCTO', 1000.00, $4, now(), now())
     RETURNING id`,
    [estado.tenantId, `ACC-TEST-${contadorSku}`, nombre, stock],
  )
  return rows[0].id
}

/** Corre `fn` con la sesión de un EMPLEADO sin ningún permiso otorgado — el
 *  caso base para los tests que prueban el rechazo (Task 8).
 *
 *  `try/finally` y no una asignación pelada: sin restaurar `estado.cookie` al
 *  salir, un caso que se ejecute después de éste heredaría en silencio la
 *  cookie del empleado sin permisos — la misma clase de dependencia de orden
 *  que ya obligó a darle un fixture propio al caso de `apagarSerieAccion con
 *  unidades libres` más abajo. */
async function comoEmpleadoSinPermisos<T>(fn: () => Promise<T>): Promise<T> {
  const cookieAnterior = estado.cookie
  estado.cookie = cookieEmpleado
  try {
    return await fn()
  } finally {
    estado.cookie = cookieAnterior
  }
}

/** El artículo recién creado por `altaArticulo`, leído directo con `owner`
 *  (sin RLS, así que ve la verdad tal cual quedó guardada). `stock` viaja
 *  envuelto en `Prisma.Decimal` porque `pg` devuelve la columna numérica como
 *  string ("2.000"), y lo que los tests quieren comparar es "2". */
async function buscarPorNombre(
  nombre: string,
): Promise<{ id: string; llevaSerie: boolean; stock: Prisma.Decimal } | null> {
  const { rows } = await owner.query(
    `SELECT id, lleva_serie AS "llevaSerie", stock FROM articulos
      WHERE nombre = $1 AND tenant_id = $2`,
    [nombre, estado.tenantId],
  )
  if (rows.length === 0) return null
  return { id: rows[0].id, llevaSerie: rows[0].llevaSerie, stock: new Prisma.Decimal(rows[0].stock) }
}

/** Una rama del árbol de este tenant, creada directo por SQL de dueño. Devuelve
 *  su id, que es lo que la pantalla manda desde que la categoría se elige. */
async function crearCategoriaDePrueba(nombre: string, padreId: string | null = null): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, now(), now())
     RETURNING id`,
    [estado.tenantId, nombre, padreId],
  )
  return rows[0].id
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

  // El input inválido no puede adelantarse al guard: si `aDecimal` tirara
  // antes de `exigirSesion()`, un llamador sin sesión recibiría un cartel rojo
  // en vez de irse al login.
  it('sin sesión, un input inválido igual manda al login', async () => {
    estado.cookie = ''
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    datos.set('cantidad', 'abc')
    await expect(ingresarMercaderia(INICIAL, datos)).rejects.toThrow('REDIRECT')
  })

  it('un EMPLEADO corrige el conteo: el stock queda en lo contado y firmado', async () => {
    estado.cookie = cookieEmpleado
    const id = await crearArticuloDePrueba('Para corregir', '10')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('stockContado', '7')
    const r = await corregirPorConteo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT stock FROM articulos WHERE id = $1`,
      [id],
    )
    expect(new Prisma.Decimal(rows[0].stock).toString()).toBe('7')

    const movimiento = await owner.query(
      `SELECT usuario_id, delta FROM movimientos_stock WHERE articulo_id = $1
        ORDER BY creado_en DESC LIMIT 1`,
      [id],
    )
    expect(movimiento.rows[0].usuario_id).toBe(empleadoId)
    expect(new Prisma.Decimal(movimiento.rows[0].delta).toString()).toBe('-3')
  })

  it('un DUEÑO da de alta y el aviso trae el código generado', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Cable USB-C')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '4.500,50')
    datos.set('moneda', 'ARS')
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
    datos.set('moneda', 'ARS')
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

  /**
   * De punta a punta con el contrato NUEVO: desde que existe el árbol, el
   * formulario manda `categoriaId`/`marcaId` en vez del texto que se tipeaba.
   * La columna de texto se sigue llenando —hasta el deploy del contract— pero
   * derivada de la rama, no de lo que alguien escribió.
   */
  it('el alta cuelga el artículo de la rama elegida y deriva el texto', async () => {
    const rubro = await owner.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Accesorios', now(), now()) RETURNING id`,
      [estado.tenantId],
    )
    const marca = await owner.query(
      `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Protección', $2, now(), now()) RETURNING id`,
      [estado.tenantId, rubro.rows[0].id],
    )

    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Con categoría')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '5000')
    datos.set('moneda', 'ARS')
    datos.set('categoriaId', rubro.rows[0].id)
    datos.set('marcaId', marca.rows[0].id)
    await altaArticulo(INICIAL, datos)

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE nombre = 'Con categoría' AND tenant_id = $1`,
      [estado.tenantId],
    )
    expect(rows[0].categoria).toBe('Accesorios · Protección')
    // La MARCA gana sobre el rubro: es la rama más específica de las dos que
    // el formulario manda, y es la que el artículo tiene que ocupar.
    expect(rows[0].categoria_id).toBe(marca.rows[0].id)
  })

  // Con el rubro solo —un rubro sin marcas, o alguien que no eligió una— el
  // artículo cuelga del rubro. Es un caso normal, no un dato a medio cargar.
  it('con el rubro solo, el artículo cuelga del rubro', async () => {
    const rubro = await owner.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Cables', now(), now()) RETURNING id`,
      [estado.tenantId],
    )
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Cable sin marca')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '900')
    datos.set('moneda', 'ARS')
    datos.set('categoriaId', rubro.rows[0].id)
    datos.set('marcaId', '')
    await altaArticulo(INICIAL, datos)

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE nombre = 'Cable sin marca' AND tenant_id = $1`,
      [estado.tenantId],
    )
    expect(rows[0].categoria).toBe('Cables')
    expect(rows[0].categoria_id).toBe(rubro.rows[0].id)
  })

  // Un artículo sin categoría no puede romper nada (CLAUDE.md): el alta sin
  // mandar el campo tiene que dejar la columna en null, no en ''.
  it('el alta sin categoría no rompe nada y la deja en null', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Sin categoría del todo')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '5000')
    datos.set('moneda', 'ARS')
    const r = await altaArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria FROM articulos WHERE nombre = 'Sin categoría del todo' AND tenant_id = $1`,
      [estado.tenantId],
    )
    expect(rows[0].categoria).toBeNull()
  })

  // Las cuatro actions de dueño hasta acá sólo se probaron rechazando al rol
  // equivocado (o, para altaArticulo, dando de alta). Falta el camino feliz de
  // las otras tres: que la DUEÑA efectivamente hace lo suyo. Se verifica
  // leyendo la base con `owner`, no confiando en el `aviso` de la action.
  it('un DUEÑO guarda los cambios de un artículo', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Antes de editar')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Después de editar')
    datos.set('sku', 'ACC-EDITADO')
    datos.set('precio', '2500')
    datos.set('moneda', 'ARS')
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT nombre, sku, precio FROM articulos WHERE id = $1`,
      [id],
    )
    expect(rows[0].nombre).toBe('Después de editar')
    expect(rows[0].sku).toBe('ACC-EDITADO')
    expect(new Prisma.Decimal(rows[0].precio).toString()).toBe('2500')
  })

  // `editarArticulo` pide `moneda` REQUERIDA (Task 6). Desde la Task 7 ya no
  // hay bridge que la lea del artículo actual: el `<SelectorDeMoneda>` de la
  // ficha la manda siempre, precargada con la moneda vigente. Este caso ya no
  // prueba un bridge —no queda ninguno— sino que guardar en la MISMA moneda
  // que ya tenía el artículo la deja intacta, y no la resetea a pesos por
  // descuido de algún llamador.
  it('guardar la ficha no resetea a pesos un artículo cargado en dólares', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('En dólares')
    await owner.query(`UPDATE articulos SET moneda = 'USD' WHERE id = $1`, [id])

    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'En dólares')
    datos.set('sku', 'ACC-USD-1')
    datos.set('precio', '300')
    datos.set('moneda', 'USD')
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(`SELECT moneda FROM articulos WHERE id = $1`, [id])
    expect(rows[0].moneda).toBe('USD')
  })

  // Desde la Task 7, `guardarArticulo` ya no hace su propio `findUnique` —el
  // bridge de la Task 6 desapareció, y con él la ventana TOCTOU que dejaba
  // anotada—, así que ya no necesita un guard de `esUuid` propio: un id sin
  // forma de uuid llega crudo hasta `editarArticulo`, cuyo `updateMany` lo
  // tira como P2023 y lo traduce el propio catch de esa función
  // (`traducirErrorDeBase`) a ARTICULO_INEXISTENTE. Este caso verifica que la
  // traducción sigue viva sin el guard de este archivo: el cartel rojo, no un
  // 500.
  it('un articuloId sin forma de uuid es artículo inexistente, no un 500', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('articuloId', 'no-es-uuid')
    datos.set('nombre', 'X')
    datos.set('sku', 'X-1')
    datos.set('precio', '100')
    datos.set('moneda', 'ARS')
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toMatch(/no existe/)
  })

  it('un DUEÑO mueve un artículo a la rama elegida, y se escriben las dos columnas', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para editar categoría')
    const rubro = await crearCategoriaDePrueba('Repuestos')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Para editar categoría')
    datos.set('sku', 'ACC-CAT-1')
    datos.set('precio', '2500')
    datos.set('moneda', 'ARS')
    datos.set('categoriaId', rubro)
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [id],
    )
    expect(rows[0].categoria).toBe('Repuestos')
    expect(rows[0].categoria_id).toBe(rubro)
  })

  // La misma regla que ya tiene el alta: la rama más específica es la que el
  // artículo tiene que ocupar. Sin esto, elegir "Fundas" y después "Apple"
  // dejaría el artículo colgado del rubro y la marca elegida se perdería.
  it('la marca gana sobre el rubro cuando llegan las dos', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Rubro y marca')
    const rubro = await crearCategoriaDePrueba('Fundas')
    const marca = await crearCategoriaDePrueba('Apple', rubro)
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Rubro y marca')
    datos.set('sku', 'ACC-CAT-2')
    datos.set('precio', '2500')
    datos.set('moneda', 'ARS')
    datos.set('categoriaId', rubro)
    datos.set('marcaId', marca)
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [id],
    )
    expect(rows[0].categoria_id).toBe(marca)
    expect(rows[0].categoria).toBe('Fundas · Apple')
  })

  it('los dos campos vacíos dejan el artículo sin categoría', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Se queda sin rama')
    // 'Insumos' y no 'Cables': ese nombre ya lo usa, como raíz, el caso 'con el
    // rubro solo, el artículo cuelga del rubro' más arriba en este mismo
    // describe, y el índice único parcial de raíces por tenant lo rechazaría.
    const rubro = await crearCategoriaDePrueba('Insumos')
    await owner.query(
      `UPDATE articulos SET categoria = 'Insumos', categoria_id = $2 WHERE id = $1`,
      [id, rubro],
    )
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Se queda sin rama')
    datos.set('sku', 'ACC-CAT-3')
    datos.set('precio', '2500')
    datos.set('moneda', 'ARS')
    datos.set('categoriaId', '')
    datos.set('marcaId', '')
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [id],
    )
    expect(rows[0].categoria).toBeNull()
    expect(rows[0].categoria_id).toBeNull()
  })

  /**
   * Este par reemplaza al caso que probaba lo contrario, y la inversión es
   * deliberada (spec 2026-08-28): elegir una rama que YA existe es editar el
   * artículo, no administrar el árbol. `CATEGORIAS` pasa a significar sólo lo
   * segundo — que es lo que su descripción en lib/permisos/catalogo.ts ya
   * decía.
   *
   * El bypass que motivó la guarda vieja era tipear texto libre y que
   * `asegurarCategoria` creara las ramas al vuelo. Con selectores no hay nada
   * que crear, y el caso de abajo lo fija: la mitad positiva sin la negativa
   * sería exactamente el agujero.
   */
  it('un EMPLEADO con ARTICULOS_EDITAR y sin CATEGORIAS SÍ puede mover el artículo a una rama existente', async () => {
    const id = await crearArticuloDePrueba('Lo mueve un empleado')
    const rubro = await crearCategoriaDePrueba('Ya existía')

    estado.cookie = cookieEmpleadoEditarSinCategorias
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Lo mueve un empleado')
    datos.set('sku', 'ACC-SIN-CAT-1')
    datos.set('precio', '2500')
    datos.set('moneda', 'ARS')
    datos.set('categoriaId', rubro)
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(`SELECT categoria_id FROM articulos WHERE id = $1`, [id])
    expect(rows[0].categoria_id).toBe(rubro)
  })

  // La mitad negativa NO se escribe acá: `acciones-categorias.test.ts` ya
  // tiene el caso 'las cuatro exigen el permiso CATEGORIAS, no sólo sesión',
  // que cubre `crearCategoriaAccion`, `renombrarCategoriaAccion`,
  // `moverCategoriaAccion` y `borrarCategoriaAccion` de una. Duplicarlo acá
  // con otro mecanismo sería dos casos que pueden llegar a afirmar cosas
  // distintas sobre el mismo permiso — que es peor que tener uno solo.

  it('un DUEÑO desactiva un artículo', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para desactivar')
    const datos = new FormData()
    datos.set('articuloId', id)
    const r = await bajaArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT desactivado_en FROM articulos WHERE id = $1`,
      [id],
    )
    expect(rows[0].desactivado_en).not.toBeNull()
  })

  it('un DUEÑO reactiva un artículo desactivado', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para reactivar')
    await owner.query(`UPDATE articulos SET desactivado_en = now() WHERE id = $1`, [id])

    const datos = new FormData()
    datos.set('articuloId', id)
    const r = await reactivarArticuloAccion(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT desactivado_en FROM articulos WHERE id = $1`,
      [id],
    )
    expect(rows[0].desactivado_en).toBeNull()
  })
})

describe('exportarHistorialCsv (Task 5 del rediseño)', () => {
  it('trae el encabezado y una fila por movimiento, con el saldo reconstruido', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para exportar', '10')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '5')
    datos.set('costoUnitario', '100')
    datos.set('nota', 'Factura A 0001')
    await ingresarMercaderia(INICIAL, datos)

    const { csv, nombreArchivo } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(filas[0]).toBe('Fecha,Motivo,Detalle,Cambio,Queda,Usuario')
    expect(filas).toHaveLength(2) // encabezado + el único movimiento
    expect(filas[1]).toContain('Ingreso')
    expect(filas[1]).toContain('Factura A 0001')
    expect(filas[1]).toContain('+5')
    // 10 (stock inicial de la fixture) + 5 (el ingreso) = 15: el saldo
    // reconstruido tiene que cerrar contra el stock real de la base. Columna
    // "Queda" exacta (índice 4) y no `toContain('15')` sobre la fila entera:
    // la fila también trae "DD/MM · HH:MM", así que un "15" en el día, el mes,
    // la hora o el minuto de la corrida hacía pasar el test aunque el saldo
    // fuera otro (mutación probada: un saldo constante "115" también
    // contiene "15" como substring).
    expect(celdasDe(filas[1])[4]).toBe('15')
    // I6 de la review: la pantalla dejó de mostrar quién hizo el movimiento
    // (la maqueta lo pide así), pero el CSV es "el historial completo" y ahí
    // el "quién" no se puede perder — se agrega como columna propia.
    expect(celdasDe(filas[1])[5]).toBe('La dueña')
    // I7 de la review: el CSV no tiene el límite de filas de la tabla en
    // pantalla ("el sentido de exportar es llevarse TODO el historial"), así
    // que un artículo con años de movimientos exporta fechas sin año que no
    // alcanzan para conciliar. La columna "Fecha" tiene que traer los 4
    // dígitos, a diferencia de la tabla (formatearFechaMovimiento, sin año).
    expect(celdasDe(filas[1])[0]).toMatch(/^\d{2}\/\d{2}\/\d{4} · \d{2}:\d{2}$/)
    expect(nombreArchivo).toMatch(/^historial-.*\.csv$/)
  })

  // El caso que el brief pide explícitamente: una nota con coma y comillas
  // —el estilo real de una factura— no puede partir la fila.
  it('escapa las comas y las comillas de las notas', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Con nota con coma', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '1')
    datos.set('nota', 'Factura A, 0001-00023145 "urgente"')
    await ingresarMercaderia(INICIAL, datos)

    const { csv } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(filas).toHaveLength(2)
    // La celda entera queda entre comillas, con las comillas internas
    // dobladas — RFC 4180. Sin esto, la coma de la nota partiría esta fila
    // en dos columnas de más.
    expect(filas[1]).toContain('"Factura A, 0001-00023145 ""urgente"""')
  })

  // I4 de la review: el caso de arriba sólo prueba la nota con COMA Y
  // COMILLAS A LA VEZ, así que una regla de quoting rota que sólo mirara una
  // de las dos condiciones (p. ej. `/[,]/` sin las comillas, o al revés)
  // hubiera pasado igual. Estos dos casos aíslan cada condición.
  it('una nota con coma pero sin comillas también se encierra entre comillas', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Con nota con coma sola', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '1')
    datos.set('nota', 'Sin comillas, con coma')
    await ingresarMercaderia(INICIAL, datos)

    const { csv } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(filas).toHaveLength(2)
    expect(celdasDe(filas[1])[2]).toContain('Sin comillas, con coma')
    expect(filas[1]).toContain('"Sin comillas, con coma')
  })

  it('una nota con comillas pero sin coma también dobla las comillas internas', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Con nota con comillas sola', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '1')
    datos.set('nota', 'Nota "con comillas" sin coma')
    await ingresarMercaderia(INICIAL, datos)

    const { csv } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(filas).toHaveLength(2)
    expect(filas[1]).toContain('"Nota ""con comillas"" sin coma')
    expect(celdasDe(filas[1])[2]).toContain('Nota "con comillas" sin coma')
  })

  // Minor de la review: inyección de fórmulas (CSV injection, OWASP).
  // `celdaCsv` cumplía RFC 4180 pero no neutralizaba una celda que arranca
  // con `=`, `+`, `-` o `@` — Excel y Google Sheets abren esos cuatro
  // caracteres iniciales como el comienzo de una fórmula. No hace falta una
  // nota manipulada a propósito: la columna "Cambio" de CUALQUIER ingreso ya
  // emite "+5" literal, así que se prueba primero ese caso, sin necesidad de
  // ninguna nota especial.
  it('la columna "Cambio" (siempre "+N" en un ingreso) sale neutralizada con un apóstrofe adelante', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para probar Cambio', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '5')
    await ingresarMercaderia(INICIAL, datos)

    const { csv } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(celdasDe(filas[1])[3]).toBe("'+5")
  })

  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1:A9)'])(
    'una nota que arranca con "%s" (fórmula) se neutraliza con un apóstrofe adelante',
    async (nota) => {
      estado.cookie = cookieDuenio
      const id = await crearArticuloDePrueba(`Con nota ${nota}`, '0')
      const datos = new FormData()
      datos.set('articuloId', id)
      datos.set('cantidad', '1')
      datos.set('nota', nota)
      await ingresarMercaderia(INICIAL, datos)

      const { csv } = await exportarHistorialCsv(id)
      const filas = csv.split('\r\n')
      // El Detalle de un AJUSTE ni siquiera aplica acá: es un INGRESO, y
      // detalleDeMovimiento antepone la nota tal cual, sin nada delante.
      expect(celdasDe(filas[1])[2].startsWith("'")).toBe(true)
      expect(celdasDe(filas[1])[2]).toContain(nota)
    },
  )

  it('una nota que NO arranca con ninguno de los cuatro caracteres no se toca', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Con nota normal', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '1')
    datos.set('nota', 'Factura A 0001')
    await ingresarMercaderia(INICIAL, datos)

    const { csv } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(celdasDe(filas[1])[2]).toBe('Factura A 0001')
  })

  // Minor de la review: `creado_en` es la hora de INICIO de transacción, así
  // que dos movimientos de la misma transacción comparten timestamp y quedan
  // sin orden definido si sólo se ordena por esa columna. Se simula con dos
  // filas insertadas a mano con el MISMO `creado_en` — el orden de inserción
  // en Postgres no garantiza nada por sí solo, así que si el resultado sale
  // determinístico es porque el `id` (uuid v7, ordenable por tiempo) lo
  // desempata, no por casualidad.
  it('desempata por id cuando dos movimientos comparten el mismo creadoEn', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Con movimientos simultáneos', '10')
    const ts = new Date()
    const menor = '00000000-0000-7000-8000-00000000000a'
    const mayor = '00000000-0000-7000-8000-00000000000b'
    await owner.query(
      `INSERT INTO movimientos_stock (id, tenant_id, articulo_id, delta, motivo, nota, creado_en, usuario_id)
       VALUES ($1, $2, $3, -1, 'AJUSTE', 'Primero por id', $4, $5)`,
      [menor, estado.tenantId, id, ts, empleadoId],
    )
    await owner.query(
      `INSERT INTO movimientos_stock (id, tenant_id, articulo_id, delta, motivo, nota, creado_en, usuario_id)
       VALUES ($1, $2, $3, -2, 'AJUSTE', 'Segundo por id', $4, $5)`,
      [mayor, estado.tenantId, id, ts, empleadoId],
    )

    const { csv } = await exportarHistorialCsv(id)
    const filas = csv.split('\r\n')
    expect(filas).toHaveLength(3) // encabezado + los dos movimientos
    // `id` desc: el de id mayor ("…b") va primero, sin importar el orden de
    // inserción — los dos comparten el mismo creadoEn.
    expect(celdasDe(filas[1])[2]).toContain('Segundo por id')
    expect(celdasDe(filas[2])[2]).toContain('Primero por id')
  })

  it('un EMPLEADO también puede exportar: es de sólo lectura, sin restricción de dueño', async () => {
    estado.cookie = cookieEmpleado
    const { csv } = await exportarHistorialCsv(articuloId)
    expect(csv.split('\r\n')[0]).toBe('Fecha,Motivo,Detalle,Cambio,Queda,Usuario')
  })

  it('sin sesión, manda al login en vez de exportar', async () => {
    estado.cookie = ''
    await expect(exportarHistorialCsv(articuloId)).rejects.toThrow('REDIRECT')
  })

  it('un artículo que no existe en este tenant es un error de dominio, no un CSV vacío', async () => {
    estado.cookie = cookieDuenio
    await expect(
      exportarHistorialCsv('00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/no existe/)
  })
})

describe('los permisos del ABM de artículos', () => {
  const CASOS = [
    ['altaArticulo', 'ARTICULOS_CREAR'],
    ['guardarArticulo', 'ARTICULOS_EDITAR'],
    ['bajaArticulo', 'ARTICULOS_EDITAR'],
    ['reactivarArticuloAccion', 'ARTICULOS_EDITAR'],
  ] as const

  it('cada acción pide su permiso', () => {
    for (const [accion, permiso] of CASOS) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no pide ${permiso}`).toContain(`comoPuede('${permiso}'`)
    }
  })

  // Crear y editar son permisos distintos a propósito: cargar un producto nuevo
  // y cambiarle el precio a uno que se viene vendiendo hace meses no tienen el
  // mismo riesgo.
  it('crear y editar no son el mismo permiso', () => {
    // Acotado a SU propio cuerpo, no al resto del archivo: sin el corte al
    // próximo `export async function`, el slice se comía también
    // `guardarArticulo` y las demás — que sí piden ARTICULOS_EDITAR más abajo
    // en este mismo archivo — y la aserción no probaba nada.
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function altaArticulo'))
    const alta = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
    expect(alta).not.toContain("comoPuede('ARTICULOS_EDITAR'")
  })

  // Ingresar mercadería y corregir por conteo siguen siendo de cualquiera: es
  // operación del día, la hace quien está atendiendo.
  it('ingresar y corregir siguen siendo de cualquiera con sesión', () => {
    for (const accion of ['ingresarMercaderia', 'corregirPorConteo']) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} dejó de ser de cualquiera`).toContain('conSesion(')
    }
  })
})

describe('el costo detrás del permiso, en el servidor', () => {
  // Los dos campos son un <input name="costoUnitario"> que un curl puede
  // mandar aunque la pantalla no lo dibuje. Esconderlo en la UI no es la
  // defensa: la defensa es que el servidor lo ignore.
  it('el alta y el ingreso consultan el permiso antes de leer el costo', () => {
    for (const accion of ['altaArticulo', 'ingresarMercaderia']) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no consulta COSTOS`).toContain("puede('COSTOS')")
    }
  })

  // El CSV es el mismo dato que la tabla, en otro formato: si la pantalla
  // esconde el costo y el CSV lo lleva, el permiso no sirve de nada.
  it('el CSV pasa el permiso a detalleDeMovimiento', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function exportarHistorialCsv'))
    expect(cuerpo).toContain("puede('COSTOS')")
    expect(cuerpo).toContain('detalleDeMovimiento(m, conCostos)')
  })
})

// I5 de la review final: los dos tests de arriba (`toContain("puede('COSTOS')")`)
// prueban que el string está escrito, no que el costo se descarte de verdad —
// un `puede('COSTOS')` que se llame y se IGNORE los dejaría en verde igual.
// Estos casos verifican el efecto contra la base, con `owner.query` (que
// lee sin RLS, así que ve la verdad tal cual quedó guardada).
describe('el blindaje de COSTOS, por efecto y no por texto (I5 de la review final)', () => {
  it('un EMPLEADO sin COSTOS que ingresa mercadería con costo: el movimiento queda sin costo', async () => {
    estado.cookie = cookieEmpleado
    const id = await crearArticuloDePrueba('Ingreso sin costo, empleado sin permiso', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '5')
    datos.set('costoUnitario', '500')
    const r = await ingresarMercaderia(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT costo_unitario FROM movimientos_stock WHERE articulo_id = $1
        ORDER BY creado_en DESC LIMIT 1`,
      [id],
    )
    expect(rows[0].costo_unitario).toBeNull()
  })

  it('un EMPLEADO con ARTICULOS_CREAR pero sin COSTOS que da de alta con costo: nace sin costo', async () => {
    estado.cookie = cookieEmpleadoAltaSinCostos
    const datos = new FormData()
    datos.set('nombre', 'Alta con costo, empleado sin permiso')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '1000')
    datos.set('moneda', 'ARS')
    datos.set('stockInicial', '3')
    datos.set('costoUnitario', '700')
    const r = await altaArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT m.costo_unitario FROM movimientos_stock m
        JOIN articulos a ON a.id = m.articulo_id
       WHERE a.nombre = 'Alta con costo, empleado sin permiso' AND a.tenant_id = $1`,
      [estado.tenantId],
    )
    expect(rows[0].costo_unitario).toBeNull()
  })

  // El par positivo: sin este caso, un `costoUnitario: null` a secas (sin
  // consultar el permiso en absoluto) también dejaría pasar los tres tests de
  // arriba, y "blindado" y "roto" se verían idénticos.
  it('un EMPLEADO CON COSTOS sí guarda el costo al ingresar mercadería', async () => {
    estado.cookie = cookieEmpleadoConCostos
    const id = await crearArticuloDePrueba('Ingreso con costo, empleado autorizado', '0')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('cantidad', '2')
    datos.set('costoUnitario', '650')
    const r = await ingresarMercaderia(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT costo_unitario FROM movimientos_stock WHERE articulo_id = $1
        ORDER BY creado_en DESC LIMIT 1`,
      [id],
    )
    expect(new Prisma.Decimal(rows[0].costo_unitario).toString()).toBe('650')
  })

  it('un EMPLEADO sin COSTOS que exporta el CSV de un artículo con costo cargado no ve el número', async () => {
    const id = await crearArticuloDePrueba('Con costo cargado, exportado sin permiso', '0')
    estado.cookie = cookieDuenio
    const ingreso = new FormData()
    ingreso.set('articuloId', id)
    ingreso.set('cantidad', '4')
    ingreso.set('costoUnitario', '473,25')
    await ingresarMercaderia(INICIAL, ingreso)

    estado.cookie = cookieEmpleado
    const { csv } = await exportarHistorialCsv(id)
    expect(csv).not.toContain('473')
  })
})

// Task 7 del ciclo de unidades por IMEI (design/superpowers/specs/
// 2026-09-02-unidades-por-imei-design.md): el alta carga las unidades cuando
// el switch viene prendido.
describe('altaArticulo con unidades por IMEI', () => {
  it('el alta con serie crea el artículo, sus unidades y el stock que corresponde', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'iPhone 13 128GB')
    datos.set('precio', '500000')
    datos.set('tipo', 'PRODUCTO')
    datos.set('moneda', 'ARS')
    datos.set('llevaSerie', 'on')
    datos.append('imeis', '355000000000001')
    datos.append('imeis', '355000000000002')

    const estadoAlta = await altaArticulo(INICIAL, datos)
    expect(estadoAlta.error).toBeNull()

    const a = await buscarPorNombre('iPhone 13 128GB')
    expect(a, 'no se encontró el artículo recién creado').not.toBeNull()
    expect(a!.llevaSerie).toBe(true)
    expect(a!.stock.toString()).toBe('2')
    expect((await unidadesLibres(estado.tenantId, a!.id)).map((u) => u.imei)).toEqual([
      '355000000000001',
      '355000000000002',
    ])
  })

  it('el alta con serie y cero IMEI crea el artículo con stock 0 y sin unidades', async () => {
    // Es el caso normal: se carga el modelo antes de que llegue la mercadería.
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'iPhone 14 128GB')
    datos.set('precio', '600000')
    datos.set('tipo', 'PRODUCTO')
    datos.set('moneda', 'ARS')
    datos.set('llevaSerie', 'on')

    await altaArticulo(INICIAL, datos)
    const a = await buscarPorNombre('iPhone 14 128GB')
    expect(a, 'no se encontró el artículo recién creado').not.toBeNull()
    expect(a!.llevaSerie).toBe(true)
    expect(a!.stock.toString()).toBe('0')
  })

  it('un SERVICIO no puede llevar serie', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Cambio de módulo')
    datos.set('precio', '80000')
    datos.set('tipo', 'SERVICIO')
    datos.set('moneda', 'ARS')
    datos.set('llevaSerie', 'on')

    const estadoAlta = await altaArticulo(INICIAL, datos)
    expect(estadoAlta.error).toContain('servicio')
    // Consistente con su hermano de más abajo (IMEI repetido): los dos
    // rechazan el alta entera, así que los dos aseveran lo mismo.
    await expect(buscarPorNombre('Cambio de módulo')).resolves.toBeNull()
  })

  it('dos IMEI iguales en el alta se rechazan y no crean el artículo', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'iPhone 15 repetido')
    datos.set('precio', '700000')
    datos.set('tipo', 'PRODUCTO')
    datos.set('moneda', 'ARS')
    datos.set('llevaSerie', 'on')
    datos.append('imeis', '355111111111111')
    datos.append('imeis', '355111111111111')

    const estadoAlta = await altaArticulo(INICIAL, datos)
    expect(estadoAlta.error).not.toBeNull()
    await expect(buscarPorNombre('iPhone 15 repetido')).resolves.toBeNull()
  })
})

// Task 8 del ciclo de unidades por IMEI: la ficha administra las unidades. Las
// tres acciones nuevas — prender el switch, apagarlo, dar de baja una unidad.
describe('las acciones de unidades por IMEI', () => {
  let articuloConStock: { id: string }
  let articuloConStock3: { id: string }
  let conSerie: { id: string }
  let unidadLibre: { id: string; imei: string | null }

  beforeAll(async () => {
    articuloConStock = {
      id: await crearArticuloDePrueba('Con stock, para probar el permiso del switch', '5'),
    }
    articuloConStock3 = {
      id: await crearArticuloDePrueba('Con stock 3, para el conteo de IMEI', '3'),
    }

    const idConSerie = await crearArticuloDePrueba('Ya con serie, para dar de baja', '1')
    // Se prende con el motor DIRECTO, no con la acción: lo que este describe
    // prueba es la acción de BAJA, no el alta de la serie, y pasar por
    // `prenderSerieAccion` exigiría además una sesión con permiso sólo para
    // preparar el fixture.
    // `prenderSerie` ya no acepta `imeis` (Task 2 del ciclo "unidades sin
    // identificar"): con stock 1 y ninguna unidad libre todavía, crea 1 sin
    // identificar — alcanza igual para lo que este describe necesita, una
    // unidad libre a la que darle de baja.
    await prenderSerie({ tenantId: estado.tenantId, articuloId: idConSerie, usuarioId: empleadoId })
    conSerie = { id: idConSerie }
    const libres = await unidadesLibres(estado.tenantId, idConSerie)
    unidadLibre = libres[0]
  })

  it('prenderSerieAccion exige ARTICULOS_EDITAR', async () => {
    // Se delega por lo que la acción mueve: el switch mueve UN artículo, igual
    // que su precio y su moneda. Mismo permiso, ninguno nuevo.
    await comoEmpleadoSinPermisos(async () => {
      const datos = new FormData()
      datos.set('articuloId', articuloConStock.id)
      await expect(prenderSerieAccion(INICIAL, datos)).rejects.toThrow()
    })
  })

  it('apagarSerieAccion exige ARTICULOS_EDITAR', async () => {
    await comoEmpleadoSinPermisos(async () => {
      const datos = new FormData()
      datos.set('articuloId', conSerie.id)
      await expect(apagarSerieAccion(INICIAL, datos)).rejects.toThrow()
    })
  })

  it('darDeBajaUnidadAccion la puede hacer cualquiera con sesión', async () => {
    // Mismo lugar que ingresarMercaderia y corregirPorConteo: es operación del
    // día, la hace quien está atendiendo, y queda firmada con su usuarioId.
    await comoEmpleadoSinPermisos(async () => {
      const datos = new FormData()
      datos.set('articuloId', conSerie.id)
      datos.set('unidadId', unidadLibre.id)
      datos.set('nota', 'se rompió')
      const estadoResultado = await darDeBajaUnidadAccion(INICIAL, datos)
      expect(estadoResultado.error).toBeNull()

      const { rows } = await owner.query(
        `SELECT baja_en, baja_nota, baja_por_id FROM unidades_articulo WHERE id = $1`,
        [unidadLibre.id],
      )
      expect(rows[0].baja_en).not.toBeNull()
      expect(rows[0].baja_nota).toBe('se rompió')
      expect(rows[0].baja_por_id).toBe(empleadoId)
    })
  })

  // Este test cubría el conteo estricto que `prenderSerie` exigía ANTES del
  // ciclo "unidades sin identificar" (menos IMEI tipeados que stock era un
  // error). Con la Task 2 de ese ciclo, `prenderSerieAccion` ya no lee
  // `imeis` en absoluto (ver el comentario de la propia acción, en
  // `acciones.ts`) y `prenderSerie` crea sola la diferencia sin identificar,
  // así que este conteo ya no puede fallar — es exactamente el
  // comportamiento nuevo, no una regresión. Ajustado para decir eso; la
  // Task 6 de ese ciclo trae su propio caso equivalente
  // ("prenderSerieAccion ya no lee imeis...").
  it('prenderSerieAccion ya no exige que las IMEI tipeadas coincidan con el stock', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('articuloId', articuloConStock3.id)
    datos.append('imeis', 'AB1')
    const estadoResultado = await prenderSerieAccion(INICIAL, datos)
    expect(estadoResultado.error).toBeNull()
  })

  it('prenderSerieAccion con el conteo exacto prende el switch y crea las unidades', async () => {
    estado.cookie = cookieDuenio
    const idParaPrender = await crearArticuloDePrueba('Para prender bien', '2')
    const datos = new FormData()
    datos.set('articuloId', idParaPrender)
    datos.append('imeis', '355800000000001')
    datos.append('imeis', '355800000000002')
    const estadoResultado = await prenderSerieAccion(INICIAL, datos)
    expect(estadoResultado.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT lleva_serie AS "llevaSerie" FROM articulos WHERE id = $1`,
      [idParaPrender],
    )
    expect(rows[0].llevaSerie).toBe(true)
  })

  it('apagarSerieAccion con unidades libres devuelve el error, no un 500', async () => {
    // Con un artículo PROPIO, y no `conSerie`: ese ya se quedó sin unidades
    // libres en el caso de la baja, más arriba en este mismo describe —
    // reusarlo dejaría este caso dependiendo del orden de ejecución.
    estado.cookie = cookieDuenio
    const idConLibres = await crearArticuloDePrueba('Con serie y unidades libres, para apagar', '1')
    // Ídem: sin `imeis`, crea la unidad libre sin identificar — sigue siendo
    // una unidad libre, que es lo único que `apagarSerieAccion` necesita para
    // rechazar.
    await prenderSerie({ tenantId: estado.tenantId, articuloId: idConLibres, usuarioId: empleadoId })
    const datos = new FormData()
    datos.set('articuloId', idConLibres)
    const estadoResultado = await apagarSerieAccion(INICIAL, datos)
    expect(estadoResultado.error).not.toBeNull()
  })

  // ingresarMercaderia aprende a leer `imeis` (el hueco asignado a esta
  // task): el motor ya los acepta (Task 3), pero nada en el medio se los
  // pasaba hasta ahora.
  it('ingresarMercaderia con imeis carga las unidades en vez de una cantidad suelta', async () => {
    estado.cookie = cookieDuenio
    const idConSerie2 = await crearArticuloDePrueba('Con serie, para ingresar mercadería', '0')
    await prenderSerie({ tenantId: estado.tenantId, articuloId: idConSerie2, usuarioId: empleadoId })

    const datos = new FormData()
    datos.set('articuloId', idConSerie2)
    datos.append('imeis', '355700000000001')
    datos.append('imeis', '355700000000002')
    const estadoResultado = await ingresarMercaderia(INICIAL, datos)
    expect(estadoResultado.error).toBeNull()

    const libres = await unidadesLibres(estado.tenantId, idConSerie2)
    expect(libres.map((u) => u.imei)).toEqual(['355700000000001', '355700000000002'])

    const { rows } = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [idConSerie2])
    expect(new Prisma.Decimal(rows[0].stock).toString()).toBe('2')
  })
})
