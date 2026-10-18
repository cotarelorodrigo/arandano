import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Plan canje test', estado: 'TRIAL' },
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
vi.mock('next/cache', () => ({ revalidatePath: (r: string) => revalidatePath(r) }))

let acciones: typeof import('./acciones')
let buscarEquipos: typeof import('../acciones').buscarEquipos
let tablaDeCanje: typeof import('@/lib/canje/consultar').tablaDeCanje
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-canje@ejemplo.test'
const MAIL_EMPLEADO_CON_PERMISO = 'empleado-con-canje@ejemplo.test'
const MAIL_DUENO = 'duenia-canje@ejemplo.test'

let owner: Client
let cookieEmpleado: string
let cookieEmpleadoConPermiso: string
let cookieDuenio: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  acciones = await import('./acciones')
  ;({ buscarEquipos } = await import('../acciones'))
  ;({ tablaDeCanje } = await import('@/lib/canje/consultar'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')
  const { otorgar } = await import('@/lib/permisos/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `plan-canje-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un vendedor',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  const conPermiso = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'El encargado',
    email: MAIL_EMPLEADO_CON_PERMISO, clave: CLAVE, rol: 'EMPLEADO',
  })
  await otorgar({ tenantId: estado.tenantId, usuarioId: conPermiso.id, permiso: 'CANJE_VALORES' })
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })

  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
  cookieEmpleadoConPermiso = await cookieDe(MAIL_EMPLEADO_CON_PERMISO)
  cookieDuenio = await cookieDe(MAIL_DUENO)

  await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'IP16', 'iPhone 16 128 GB', 'PRODUCTO', 1000.00, 'USD', 2, now(), now())`,
    [estado.tenantId],
  )
})

afterAll(async () => {
  await owner.end()
})

beforeEach(async () => {
  for (const t of ['valores_de_canje', 'modelos_de_canje', 'rangos_de_bateria', 'configuraciones_de_canje']) {
    await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [estado.tenantId])
  }
})

/** Login real contra Better Auth; mismo extracto que formas-de-pago. */
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

/** Un rango cargado como dueña, para los casos que necesitan uno. */
async function unRango(minimo = '0', maximo = '100'): Promise<string> {
  estado.cookie = cookieDuenio
  const r = await acciones.altaDeRango(INICIAL, formulario({ minimo, maximo }))
  expect(r.error, 'el rango de apoyo no se pudo crear').toBeNull()
  const tabla = await tablaDeCanje(estado.tenantId)
  return tabla.rangos.find((x) => x.minimo === Number(minimo))!.id
}

describe('el permiso CANJE_VALORES', () => {
  // La calculadora es de cualquiera del local: buscar el equipo que se vende
  // no pide ningún permiso.
  it('un empleado sin CANJE_VALORES usa la calculadora: busca equipos', async () => {
    estado.cookie = cookieEmpleado
    const encontrados = await buscarEquipos('iphone 16')
    expect(encontrados.map((a) => a.nombre)).toEqual(['iPhone 16 128 GB'])
    expect(encontrados[0]).toMatchObject({ precio: '1000', moneda: 'USD' })
  })

  // Que la pantalla no se muestre no es una defensa: una action es un
  // endpoint y se puede invocar sin pasar por la pantalla. Las siete.
  it('un empleado sin CANJE_VALORES no puede tocar ninguna action de la tabla', async () => {
    const rangoId = await unRango()
    estado.cookie = cookieEmpleado
    const soloId = formulario({ id: rangoId })
    await expect(acciones.altaDeRango(INICIAL, formulario({ minimo: '1', maximo: '2' }))).rejects.toThrow('FORBIDDEN')
    await expect(acciones.edicionDeRango(INICIAL, formulario({ id: rangoId, minimo: '0', maximo: '99' }))).rejects.toThrow('FORBIDDEN')
    await expect(acciones.bajaDeRango(INICIAL, soloId)).rejects.toThrow('FORBIDDEN')
    await expect(acciones.usoDeRangosSugeridos(INICIAL, new FormData())).rejects.toThrow('FORBIDDEN')
    await expect(acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iPhone 14' }))).rejects.toThrow('FORBIDDEN')
    await expect(acciones.bajaDeModelo(INICIAL, soloId)).rejects.toThrow('FORBIDDEN')
    await expect(acciones.cambioDeMoneda(INICIAL, formulario({ moneda: 'ARS' }))).rejects.toThrow('FORBIDDEN')
    // Y no escribió nada.
    const tabla = await tablaDeCanje(estado.tenantId)
    expect(tabla.rangos).toHaveLength(1)
    expect(tabla.modelos).toHaveLength(0)
    expect(tabla.moneda).toBe('USD')
  })

  it('un empleado CON CANJE_VALORES puede editar la tabla', async () => {
    estado.cookie = cookieEmpleadoConPermiso
    expect((await acciones.usoDeRangosSugeridos(INICIAL, new FormData())).error).toBeNull()
    expect((await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iPhone 14' }))).error).toBeNull()
    expect((await acciones.cambioDeMoneda(INICIAL, formulario({ moneda: 'ARS' }))).error).toBeNull()
    const tabla = await tablaDeCanje(estado.tenantId)
    expect(tabla.rangos).toHaveLength(5)
    expect(tabla.modelos.map((m) => m.nombre)).toEqual(['iPhone 14'])
    expect(tabla.moneda).toBe('ARS')
  })

  // El dueño pasa sin fila en usuario_permisos: lo garantiza puedeConSesion.
  it('el dueño puede sin ninguna fila de permiso', async () => {
    estado.cookie = cookieDuenio
    expect((await acciones.altaDeRango(INICIAL, formulario({ minimo: '90', maximo: '99' }))).error).toBeNull()
  })

  it('sin sesión manda al login, también desde la calculadora', async () => {
    estado.cookie = ''
    await expect(acciones.altaDeRango(INICIAL, formulario({ minimo: '1', maximo: '2' }))).rejects.toThrow('REDIRECT')
    await expect(buscarEquipos('iphone')).rejects.toThrow('REDIRECT')
  })
})

describe('los rangos', () => {
  beforeEach(() => {
    estado.cookie = cookieDuenio
  })

  it('un rango que se solapa vuelve como cartel, no como 500', async () => {
    await unRango('90', '99')
    const r = await acciones.altaDeRango(INICIAL, formulario({ minimo: '85', maximo: '90' }))
    expect(r.error).toMatch(/se pisa con el rango 90–99 %/)
  })

  it('acepta "85 %" con el signo: es lo que la cabecera muestra', async () => {
    const r = await acciones.altaDeRango(INICIAL, formulario({ minimo: '85 %', maximo: '89%' }))
    expect(r.error).toBeNull()
  })

  it.each([
    [{ minimo: '85,5', maximo: '89' }, /enteros/],
    [{ minimo: '', maximo: '89' }, /Falta/],
    [{ minimo: '90', maximo: '80' }, /el de abajo primero/],
  ])('%o vuelve como cartel', async (campos, mensaje) => {
    const r = await acciones.altaDeRango(INICIAL, formulario(campos))
    expect(r.error).toMatch(mensaje)
  })

  it('un id que no es uuid vuelve como cartel, no como 500', async () => {
    const r = await acciones.edicionDeRango(INICIAL, formulario({ id: 'no-es-uuid', minimo: '1', maximo: '2' }))
    expect(r.error).toMatch(/Recargá/)
  })

  it('los sugeridos sobre una tabla con rangos vuelven como cartel', async () => {
    await unRango()
    const r = await acciones.usoDeRangosSugeridos(INICIAL, new FormData())
    expect(r.error).toMatch(/ya tiene rangos/)
  })

  it('cada escritura revalida las dos pantallas', async () => {
    revalidatePath.mockClear()
    await unRango()
    expect(revalidatePath).toHaveBeenCalledWith('/plan-canje/valores')
    expect(revalidatePath).toHaveBeenCalledWith('/plan-canje')
  })
})

describe('guardadoDeModelo', () => {
  beforeEach(() => {
    estado.cookie = cookieDuenio
  })

  it('guarda la fila entera, leyendo cada valor con la gramática de la plata', async () => {
    const alto = await unRango('90', '100')
    const bajo = await unRango('0', '89')
    const r = await acciones.guardadoDeModelo(
      INICIAL,
      formulario({ nombre: 'iPhone 14', [`valor:${alto}`]: '1.250,50', [`valor:${bajo}`]: '' }),
    )
    expect(r).toEqual({ error: null, aviso: '"iPhone 14" quedó en la tabla.' })
    expect((await tablaDeCanje(estado.tenantId)).modelos[0].valores).toEqual({ [alto]: '1250.5' })
  })

  it('un nombre repetido con otras mayúsculas vuelve como cartel', async () => {
    await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iPhone 14' }))
    const r = await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'IPHONE 14' }))
    expect(r.error).toBe('Ya hay un modelo que se llama "iPhone 14".')
  })

  // "850.000" es ambiguo para la gramática compartida: puede ser miles o
  // decimales. Se rechaza en vez de adivinar, igual que en un precio.
  it.each([['850.000'], ['-10'], ['diez']])('un valor "%s" vuelve como cartel', async (valor) => {
    const rango = await unRango()
    const r = await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iPhone 13', [`valor:${rango}`]: valor }))
    expect(r.error).not.toBeNull()
    expect((await tablaDeCanje(estado.tenantId)).modelos).toHaveLength(0)
  })

  it('una celda con un rango que no es uuid vuelve como cartel', async () => {
    const r = await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iPhone 13', 'valor:xyz': '10' }))
    expect(r.error).toMatch(/Recargá/)
  })

  it('editar con id cambia la misma fila', async () => {
    await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iphone 12' }))
    const { id } = (await tablaDeCanje(estado.tenantId)).modelos[0]
    const r = await acciones.guardadoDeModelo(INICIAL, formulario({ id, nombre: 'iPhone 12' }))
    expect(r.aviso).toBe('"iPhone 12" quedó actualizado.')
    expect((await tablaDeCanje(estado.tenantId)).modelos).toEqual([{ id, nombre: 'iPhone 12', valores: {} }])
  })

  it('bajaDeModelo lo saca de la tabla', async () => {
    await acciones.guardadoDeModelo(INICIAL, formulario({ nombre: 'iPhone 8' }))
    const { id } = (await tablaDeCanje(estado.tenantId)).modelos[0]
    expect((await acciones.bajaDeModelo(INICIAL, formulario({ id }))).error).toBeNull()
    expect((await tablaDeCanje(estado.tenantId)).modelos).toHaveLength(0)
  })
})

describe('cambioDeMoneda', () => {
  it('una moneda inventada vuelve como cartel, no llega al enum de Postgres', async () => {
    estado.cookie = cookieDuenio
    const r = await acciones.cambioDeMoneda(INICIAL, formulario({ moneda: 'EUR' }))
    expect(r.error).toMatch(/no existe/)
  })

  it('el aviso dice que los números no se convirtieron', async () => {
    estado.cookie = cookieDuenio
    const r = await acciones.cambioDeMoneda(INICIAL, formulario({ moneda: 'ARS' }))
    expect(r.aviso).toMatch(/pesos.*no se convirtieron/)
  })
})
