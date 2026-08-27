import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Formas de pago test', estado: 'TRIAL' },
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

let altaDePlan: typeof import('./acciones').altaDePlan
let edicionDePlan: typeof import('./acciones').edicionDePlan
let bajaDePlan: typeof import('./acciones').bajaDePlan
let reactivacionDePlan: typeof import('./acciones').reactivacionDePlan
let planesDelTenant: typeof import('@/lib/planes/consultar').planesDelTenant
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-planes@ejemplo.test'
const MAIL_EMPLEADO_CON_PERMISO = 'empleado-con-planes@ejemplo.test'
const MAIL_DUENO = 'duenia-planes@ejemplo.test'

let owner: Client
let cookieEmpleado: string
let cookieEmpleadoConPermiso: string
let cookieDuenio: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ altaDePlan, edicionDePlan, bajaDePlan, reactivacionDePlan } = await import('./acciones'))
  ;({ planesDelTenant } = await import('@/lib/planes/consultar'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')
  const { otorgar } = await import('@/lib/permisos/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `formas-de-pago-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un empleado',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  const conPermiso = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Empleado con planes',
    email: MAIL_EMPLEADO_CON_PERMISO, clave: CLAVE, rol: 'EMPLEADO',
  })
  await otorgar({ tenantId: estado.tenantId, usuarioId: conPermiso.id, permiso: 'PLANES_PAGO' })
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })

  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
  cookieEmpleadoConPermiso = await cookieDe(MAIL_EMPLEADO_CON_PERMISO)
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

let contador = 0

/** Un alta válida. El nombre es único por llamada: la tabla tiene
 *  `@@unique([tenantId, medio, nombre])` y todos los casos comparten tenant. */
function formularioDePlan(campos: Record<string, string> = {}): FormData {
  const datos = new FormData()
  datos.set('nombre', `Plan ${++contador}`)
  datos.set('medio', 'TARJETA_CREDITO')
  datos.set('cuotas', '3')
  datos.set('porcentaje', '40')
  for (const [k, v] of Object.entries(campos)) datos.set(k, v)
  return datos
}

/** Crea un plan como dueña y devuelve su id, para los casos de edición y baja. */
async function unPlan(): Promise<string> {
  estado.cookie = cookieDuenio
  const nombre = `Base ${++contador}`
  const r = await altaDePlan(INICIAL, formularioDePlan({ nombre }))
  expect(r.error, 'el plan de apoyo no se pudo crear').toBeNull()
  const planes = await planesDelTenant(estado.tenantId, { incluirDesactivados: true })
  const creado = planes.find((p) => p.nombre === nombre)
  if (!creado) throw new Error('el plan de apoyo no quedó en la base')
  return creado.id
}

describe('el permiso PLANES_PAGO', () => {
  // Que la pantalla no se muestre no es una defensa: una action es un endpoint
  // y se puede invocar sin pasar por la pantalla.
  it('un empleado sin PLANES_PAGO no puede tocar ninguna de las cuatro', async () => {
    const id = await unPlan()
    estado.cookie = cookieEmpleado
    const soloId = new FormData()
    soloId.set('id', id)
    await expect(altaDePlan(INICIAL, formularioDePlan())).rejects.toThrow('FORBIDDEN')
    await expect(
      edicionDePlan(INICIAL, formularioDePlan({ id, orden: '3' })),
    ).rejects.toThrow('FORBIDDEN')
    await expect(bajaDePlan(INICIAL, soloId)).rejects.toThrow('FORBIDDEN')
    await expect(reactivacionDePlan(INICIAL, soloId)).rejects.toThrow('FORBIDDEN')
  })

  it('un empleado CON PLANES_PAGO sí puede', async () => {
    estado.cookie = cookieEmpleadoConPermiso
    const antes = (await planesDelTenant(estado.tenantId, { incluirDesactivados: true })).length
    const r = await altaDePlan(INICIAL, formularioDePlan())
    expect(r.error).toBeNull()
    const despues = await planesDelTenant(estado.tenantId, { incluirDesactivados: true })
    expect(despues).toHaveLength(antes + 1)
  })

  // El dueño pasa sin fila en usuario_permisos: lo garantiza puedeConSesion, y
  // esto lo comprueba de punta a punta.
  it('el dueño puede sin ninguna fila de permiso', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan())
    expect(r.error).toBeNull()
  })

  it('sin sesión manda al login', async () => {
    estado.cookie = ''
    await expect(altaDePlan(INICIAL, formularioDePlan())).rejects.toThrow('REDIRECT')
  })
})

describe('altaDePlan', () => {
  it('deja el plan disponible y lo dice en el aviso', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ nombre: 'Crédito 6 cuotas' }))
    expect(r.error).toBeNull()
    expect(r.aviso).toContain('Crédito 6 cuotas')
    const planes = await planesDelTenant(estado.tenantId)
    expect(planes.map((p) => p.nombre)).toContain('Crédito 6 cuotas')
  })

  // El orden del mostrador sale de las cuotas: sin esto, 12 cuotas quedaría
  // antes que 3 y alguien tendría que ordenarlas a mano.
  it('el orden sale de las cuotas, sin que nadie lo escriba', async () => {
    estado.cookie = cookieDuenio
    const nombre = `Orden ${++contador}`
    await altaDePlan(INICIAL, formularioDePlan({ nombre, cuotas: '12' }))
    const plan = (await planesDelTenant(estado.tenantId)).find((p) => p.nombre === nombre)
    expect(plan?.orden).toBe(12)
  })

  /**
   * El caso que la decisión 5 del spec pide y que la gramática compartida de
   * `lib/formato` NO deja pasar: `aDecimalCanonico` rechaza el signo por
   * diseño, así que un descuento por pago contado era inentrable. Ver
   * `porcentajeDe` en acciones.ts.
   */
  it('un recargo negativo —el descuento por pago contado— se guarda con su signo', async () => {
    estado.cookie = cookieDuenio
    const nombre = `Contado ${++contador}`
    const r = await altaDePlan(
      INICIAL,
      formularioDePlan({ nombre, medio: 'EFECTIVO', cuotas: '1', porcentaje: '-10' }),
    )
    expect(r.error).toBeNull()
    const plan = (await planesDelTenant(estado.tenantId)).find((p) => p.nombre === nombre)
    expect(plan?.porcentaje).toBe('-10')
  })

  // Tres decimales entran: es exactamente lo que Decimal(6,3) existe para
  // guardar, y la gramática compartida los rechazaría por ambiguos.
  it('un recargo con tres decimales, escrito con coma, se guarda', async () => {
    estado.cookie = cookieDuenio
    const nombre = `Financiero ${++contador}`
    await altaDePlan(INICIAL, formularioDePlan({ nombre, porcentaje: '13,755' }))
    const plan = (await planesDelTenant(estado.tenantId)).find((p) => p.nombre === nombre)
    expect(plan?.porcentaje).toBe('13.755')
  })

  it('un recargo que no es un número vuelve como error corregible', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ porcentaje: 'cuarenta' }))
    expect(r.error).toMatch(/no es un número/)
  })

  /**
   * El signo que la propia tabla muestra tiene que volver a entrar:
   * `formatearPorcentaje` renderiza `+40%`, así que quien retipee lo que está
   * leyendo escribe `+40`. Rechazárselo sería castigarlo por copiar lo que la
   * pantalla le mostró.
   */
  it('un recargo escrito con + —como lo muestra la tabla— se guarda', async () => {
    estado.cookie = cookieDuenio
    const nombre = `Con mas ${++contador}`
    const r = await altaDePlan(INICIAL, formularioDePlan({ nombre, porcentaje: '+40' }))
    expect(r.error).toBeNull()
    const plan = (await planesDelTenant(estado.tenantId)).find((p) => p.nombre === nombre)
    // Normalizado por Prisma.Decimal: se guarda como 40, no como "+40".
    expect(plan?.porcentaje).toBe('40')
  })

  /**
   * Un espacio en el medio del número es un error de tipeo, no otro número.
   * Con `replace(/\s/g, '')` en vez de `trim()`, `4 0` entraba como cuarenta:
   * el local terminaba recargando 40 % donde alguien quiso escribir otra cosa,
   * sin que nada avisara. Es la misma regla que `lib/formato/gramatica.ts`
   * aplica a la plata: rechazar en vez de adivinar.
   */
  it('un espacio en el medio del recargo se rechaza, no se borra', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ porcentaje: '4 0' }))
    expect(r.error).toMatch(/no es un número/)
  })

  // Y los espacios de los BORDES sí se sacan: pegar un valor desde otro lado
  // suele traerlos, y ahí no hay ninguna ambigüedad que resolver.
  it('los espacios de los bordes no molestan', async () => {
    estado.cookie = cookieDuenio
    const nombre = `Con espacios ${++contador}`
    const r = await altaDePlan(INICIAL, formularioDePlan({ nombre, porcentaje: '  25  ' }))
    expect(r.error).toBeNull()
    const plan = (await planesDelTenant(estado.tenantId)).find((p) => p.nombre === nombre)
    expect(plan?.porcentaje).toBe('25')
  })

  // Lo que la persona puede corregir tipeando distinto tiene que volver como
  // cartel, no como 500.
  it('un porcentaje inválido vuelve como error corregible', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ porcentaje: '-100' }))
    expect(r.error).toMatch(/recargo va de/i)
  })

  /**
   * `3,5` es el error realista, no `3 cuotas`. Y el mensaje tiene que hablar de
   * lo que ESTE guard mira: decirle "van de 1 a 120" a quien escribió un
   * decimal lo manda a arreglar lo que no está mal. El rango sigue siendo de
   * `lib/planes/administrar.ts`, y el caso de abajo lo comprueba.
   */
  it('unas cuotas que no son un entero lo dicen así, no hablan del rango', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ cuotas: '3,5' }))
    expect(r.error).toMatch(/número entero/i)
    expect(r.error).not.toMatch(/1 a 120/)
  })

  it('unas cuotas fuera del rango sí hablan del rango, desde lib/planes', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ cuotas: '200' }))
    expect(r.error).toMatch(/1 a 120/)
  })

  // Primer lanzador de MEDIO_INVALIDO: el medio llega por FormData, así que es
  // texto de afuera hasta que se lo reconoce.
  it('un medio inventado vuelve como error corregible, no como 500', async () => {
    estado.cookie = cookieDuenio
    const r = await altaDePlan(INICIAL, formularioDePlan({ medio: 'CRIPTO' }))
    expect(r.error).toMatch(/forma de pago no existe/i)
  })

  it('un nombre repetido en el mismo medio vuelve como error corregible', async () => {
    estado.cookie = cookieDuenio
    const nombre = `Repetido ${++contador}`
    await altaDePlan(INICIAL, formularioDePlan({ nombre }))
    const r = await altaDePlan(INICIAL, formularioDePlan({ nombre }))
    expect(r.error).toMatch(/Ya hay un plan/)
  })
})

describe('edicionDePlan', () => {
  it('cambia nombre, cuotas, porcentaje y orden', async () => {
    const id = await unPlan()
    estado.cookie = cookieDuenio
    const nombre = `Editado ${++contador}`
    const r = await edicionDePlan(
      INICIAL,
      formularioDePlan({ id, nombre, cuotas: '6', porcentaje: '55.5', orden: '2' }),
    )
    expect(r.error).toBeNull()
    const plan = (await planesDelTenant(estado.tenantId)).find((p) => p.id === id)
    expect(plan?.nombre).toBe(nombre)
    expect(plan?.cuotas).toBe(6)
    expect(plan?.porcentaje).toBe('55.5')
    expect(plan?.orden).toBe(2)
  })

  // Sin el guard, Prisma tira un error sin `codigo` —un 500— en vez del error
  // de dominio que el resto de este archivo usa.
  it('un id que no es uuid vuelve como error corregible, no como 500', async () => {
    estado.cookie = cookieDuenio
    const r = await edicionDePlan(INICIAL, formularioDePlan({ id: 'no-es-un-uuid', orden: '1' }))
    expect(r.error).toMatch(/no está en este local/)
  })

  // Sin guard, un `orden` que no parsea llega a Prisma como NaN y vuelve como
  // 500 en vez de como cartel.
  it('un orden que no es un entero vuelve como error corregible, no como 500', async () => {
    const id = await unPlan()
    estado.cookie = cookieDuenio
    const r = await edicionDePlan(INICIAL, formularioDePlan({ id, orden: 'primero' }))
    expect(r.error).toMatch(/orden/i)
  })
})

describe('bajaDePlan y reactivacionDePlan', () => {
  it('la baja es lógica: el plan sigue existiendo, desactivado', async () => {
    const id = await unPlan()
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('id', id)
    const r = await bajaDePlan(INICIAL, datos)
    expect(r.error).toBeNull()

    expect((await planesDelTenant(estado.tenantId)).find((p) => p.id === id)).toBeUndefined()
    const conBajas = await planesDelTenant(estado.tenantId, { incluirDesactivados: true })
    expect(conBajas.find((p) => p.id === id)?.desactivadoEn).not.toBeNull()
  })

  it('la reactivación lo devuelve al mostrador', async () => {
    const id = await unPlan()
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('id', id)
    await bajaDePlan(INICIAL, datos)
    const r = await reactivacionDePlan(INICIAL, datos)
    expect(r.error).toBeNull()
    expect((await planesDelTenant(estado.tenantId)).find((p) => p.id === id)).toBeDefined()
  })

  it('un id que no es uuid vuelve como error corregible en las dos', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('id', 'no-es-un-uuid')
    expect((await bajaDePlan(INICIAL, datos)).error).toMatch(/no está en este local/)
    expect((await reactivacionDePlan(INICIAL, datos)).error).toMatch(/no está en este local/)
  })
})

// Sin revalidar, la pantalla sigue mostrando la tabla vieja después de crear o
// dar de baja un plan: es un Server Component cacheado.
describe('las cuatro revalidan la pantalla', () => {
  it('cada acción exitosa revalida /formas-de-pago', async () => {
    const id = await unPlan()
    estado.cookie = cookieDuenio
    const soloId = new FormData()
    soloId.set('id', id)

    for (const [nombre, correr] of [
      ['altaDePlan', () => altaDePlan(INICIAL, formularioDePlan())],
      ['edicionDePlan', () => edicionDePlan(INICIAL, formularioDePlan({ id, orden: '3' }))],
      ['bajaDePlan', () => bajaDePlan(INICIAL, soloId)],
      ['reactivacionDePlan', () => reactivacionDePlan(INICIAL, soloId)],
    ] as const) {
      revalidatePath.mockClear()
      const r = await correr()
      expect(r.error, `${nombre} falló y el caso no probaría nada`).toBeNull()
      expect(revalidatePath, `${nombre} no revalida`).toHaveBeenCalledWith('/formas-de-pago')
    }
  })
})
