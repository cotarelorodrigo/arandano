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
let exportarHistorialCsv: typeof import('./acciones').exportarHistorialCsv
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
    exportarHistorialCsv,
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

  // De punta a punta: el campo nuevo del formulario de alta (Task 1 del
  // rediseño) tiene que llegar tal cual hasta la columna.
  it('el alta guarda la categoría cuando se la manda', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Con categoría')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '5000')
    datos.set('categoria', 'Accesorios · Protección')
    await altaArticulo(INICIAL, datos)

    const { rows } = await owner.query(
      `SELECT categoria FROM articulos WHERE nombre = 'Con categoría' AND tenant_id = $1`,
      [estado.tenantId],
    )
    expect(rows[0].categoria).toBe('Accesorios · Protección')
  })

  // Un artículo sin categoría no puede romper nada (CLAUDE.md): el alta sin
  // mandar el campo tiene que dejar la columna en null, no en ''.
  it('el alta sin categoría no rompe nada y la deja en null', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Sin categoría del todo')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '5000')
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

  it('un DUEÑO edita la categoría de un artículo, y la ficha la deja editar', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para editar categoría')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Para editar categoría')
    datos.set('sku', 'ACC-CAT-1')
    datos.set('precio', '2500')
    datos.set('categoria', 'Repuestos')
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [id])
    expect(rows[0].categoria).toBe('Repuestos')
  })

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
