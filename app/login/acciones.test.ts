import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'
import { REGLA_LOGIN } from '@/lib/auth/limite-de-intentos'

// El tenant real se crea recién en beforeAll, después de que vi.mock ya
// corrió (los mocks se hoistean por sobre los imports): por eso el mock lee
// de un estado mutable en vez de un objeto fijo, mismo patrón que
// lib/auth/sesion.test.ts.
const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Login test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

// Sin esto, tanto origenDelRequest como el propio entrar() explotan:
// next/headers no tiene contexto de request fuera de un render real de
// Next, y acá la action se llama directo, como una función cualquiera.
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))

let entrar: typeof import('./acciones').entrar
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

let owner: Client
const MAIL_EXISTENTE = 'existe@ejemplo.test'
const CLAVE_REAL = 'clave-correcta-de-sobra'

beforeAll(async () => {
  // Mismo motivo que test/auth.test.ts: lib/auth/para-tenant.ts (y por lo
  // tanto app/login/acciones.ts, que lo importa) arrastra lib/db.ts, que arma
  // su Pool leyendo DATABASE_URL al importarse. Hay que fijarla ANTES del
  // import, no después. DOMINIO_BASE es lo que origenDelRequest necesita para
  // armar el baseURL — no está seteada globalmente en vitest.config.mts como
  // BETTER_AUTH_SECRET, así que va acá.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ entrar } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `login-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  await authParaTenant(estado.tenantId, origen).api.signUpEmail({
    body: { email: MAIL_EXISTENTE, password: CLAVE_REAL, name: 'Usuario real' },
  })
})

afterAll(async () => {
  await owner.end()
})

function formulario(email: string, clave: string): FormData {
  const datos = new FormData()
  datos.set('email', email)
  datos.set('clave', clave)
  return datos
}

describe('entrar: el mensaje no distingue mail inexistente de contraseña incorrecta', () => {
  // No "un error truthy": el MISMO string, en los dos casos. Comparar sólo
  // contra la constante GENERICO de acciones.ts no alcanza si algún día
  // alguien duplica el literal en dos return distintos — por eso acá se
  // compara además contra el texto pegado, y los dos resultados entre sí:
  // el test tiene que caerse tanto si los mensajes divergen entre ellos como
  // si el texto cambia sin querer.
  it('mail que no existe en ningún tenant y contraseña incorrecta de un mail real dan EXACTAMENTE el mismo mensaje', async () => {
    const porMailInexistente = await entrar(
      { error: null },
      formulario('no-existe-en-ningun-lado@ejemplo.test', 'cualquier-cosa'),
    )
    const porClaveIncorrecta = await entrar(
      { error: null },
      formulario(MAIL_EXISTENTE, 'clave-equivocada-a-proposito'),
    )

    expect(porMailInexistente.error).toBe('Mail o contraseña incorrectos.')
    expect(porClaveIncorrecta.error).toBe('Mail o contraseña incorrectos.')
    expect(porMailInexistente.error).toBe(porClaveIncorrecta.error)
  })
})

describe('el mail vuelve en el estado; la contraseña nunca', () => {
  /**
   * React 19 resetea los inputs no controlados de un `<form action>` cuando la
   * action termina, así que un error de login vaciaba LOS DOS campos: quien se
   * equivocaba una letra de la contraseña tenía que volver a escribir también
   * el mail. En un mostrador, con un cliente esperando, eso es fricción real.
   *
   * La contraseña NO vuelve, y no es un olvido: el estado de una action viaja
   * al cliente en la carga RSC, así que devolverla la escribiría en el HTML.
   * Vaciar el campo de contraseña ante un error es además lo que corresponde.
   *
   * Tenant propio por test, por el mismo motivo que documenta el freno de
   * fuerza bruta más abajo: el contador de intentos se lleva por `(tenant, ip)`
   * y en test todas las llamadas comparten IP. Estos casos fallan el login a
   * propósito —es de lo que se tratan—, así que sobre el tenant compartido le
   * quemarían el bucket a cualquier test que venga después. Ya pasó al
   * escribirlos: el caso del usuario desactivado empezó a recibir "Demasiados
   * intentos".
   */
  const previo = { tenantId: '', subdominio: '' }

  beforeEach(async () => {
    previo.tenantId = estado.tenantId
    previo.subdominio = estado.subdominio
    const subdominio = `login-eco-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    estado.tenantId = await crearTenant(owner, subdominio)
    estado.subdominio = subdominio
  })

  afterEach(() => {
    estado.tenantId = previo.tenantId
    estado.subdominio = previo.subdominio
  })

  it('un login fallido devuelve el mail intentado', async () => {
    const r = await entrar({ error: null }, formulario(MAIL_EXISTENTE, 'clave-equivocada'))

    expect(r.error).toBe('Mail o contraseña incorrectos.')
    expect(r.email).toBe(MAIL_EXISTENTE)
  })

  it('el mail vuelve normalizado, que es el que la próxima vez se va a autenticar', async () => {
    const r = await entrar(
      { error: null },
      formulario(`  ${MAIL_EXISTENTE.toUpperCase()}  `, 'clave-equivocada'),
    )

    expect(r.email).toBe(MAIL_EXISTENTE)
  })

  it('ningún camino de error devuelve la contraseña, en ninguna clave del estado', async () => {
    // Contra el objeto entero y no contra `r.clave`: el modo de falla que
    // importa es que alguien sume un campo nuevo —`datos`, `intento`— y meta
    // la contraseña adentro sin darse cuenta de que eso la publica.
    const casos = [
      formulario(MAIL_EXISTENTE, 'clave-equivocada'),
      formulario('no-existe@ejemplo.test', 'otra-clave-secreta'),
      formulario('', ''),
    ]
    for (const datos of casos) {
      const r = await entrar({ error: null }, datos)
      expect(JSON.stringify(r)).not.toContain('clave-equivocada')
      expect(JSON.stringify(r)).not.toContain('otra-clave-secreta')
    }
  })
})

describe('el aviso de usuario desactivado', () => {
  /**
   * `signInEmail` normaliza el mail a minúsculas por su cuenta, así que un
   * empleado desactivado que escribe `Flor@Ejemplo.com` SE AUTENTICA igual. Lo
   * que se rompía era el chequeo de desactivación de acá abajo: consultaba con
   * el input crudo contra una columna sensible a mayúsculas, no encontraba
   * nada, y la persona terminaba en `/` — donde el guard la rebota a /login
   * sin explicación, con su fila de sesión sin borrar.
   *
   * Por eso el test usa una variante en mayúsculas: con el mail tal cual está
   * guardado, pasa igual con el bug puesto.
   */
  it('sale igual con el mail escrito en mayúsculas', async () => {
    const mail = 'desactivado@ejemplo.test'
    const origen = await origenDelRequest(estado.subdominio)
    await authParaTenant(estado.tenantId, origen).api.signUpEmail({
      body: { email: mail, password: CLAVE_REAL, name: 'Desactivado' },
    })
    await owner.query(
      'UPDATE users SET desactivado_en = now() WHERE tenant_id = $1 AND email = $2',
      [estado.tenantId, mail],
    )

    const r = await entrar({ error: null }, formulario('Desactivado@Ejemplo.TEST', CLAVE_REAL))

    expect(r.error).toBe('Tu usuario está desactivado. Pedile al dueño que lo reactive.')

    // Y la sesión que el login alcanzó a crear no queda viva: es la otra mitad
    // del hallazgo — con el chequeo salteado, nadie la borraba.
    const { rows } = await owner.query(
      `SELECT count(*)::int n FROM sessions s
        JOIN users u ON u.id = s.user_id
       WHERE u.tenant_id = $1 AND u.email = $2`,
      [estado.tenantId, mail],
    )
    expect(rows[0].n, 'quedó una sesión viva de alguien desactivado').toBe(0)
  })
})

describe('el freno de fuerza bruta', () => {
  /**
   * Test de COMPORTAMIENTO, no de configuración. `lib/auth/opciones.test.ts`
   * ya afirmaba que la regla del login dice `max: 5`, y esa aserción pasaba
   * perfecto mientras la regla no se aplicaba en ningún lado que el producto
   * usara: el limitador de Better Auth corre en el `onRequest` de su router y
   * esta action llama a `auth.api.signInEmail` directo. La única forma de que
   * el freno signifique algo es contar intentos a través de `entrar()`.
   *
   * Tenant propio, distinto del que usa el resto del archivo: el contador se
   * lleva por `(tenant, ip)` y en test todas las llamadas comparten IP, así
   * que correr esto sobre el tenant compartido dejaría el bucket quemado para
   * cualquier test que se sume después — y, peor, haría que este test
   * dependiera de cuántos intentos fallidos hizo el de más arriba.
   */
  it(`el intento ${REGLA_LOGIN.max + 1} deja de costar un hash y avisa que hay que esperar`, async () => {
    const previoTenant = estado.tenantId
    const previoSubdominio = estado.subdominio

    const subdominio = `login-limite-${Date.now()}`
    estado.tenantId = await crearTenant(owner, subdominio)
    estado.subdominio = subdominio

    try {
      const mensajes: (string | null)[] = []
      for (let i = 0; i <= REGLA_LOGIN.max; i++) {
        const r = await entrar({ error: null }, formulario(MAIL_EXISTENTE, 'clave-equivocada'))
        mensajes.push(r.error)
      }

      // Los primeros `max` llegan a Better Auth y salen por el mensaje
      // genérico...
      expect(mensajes.slice(0, REGLA_LOGIN.max)).toEqual(
        Array<string>(REGLA_LOGIN.max).fill('Mail o contraseña incorrectos.'),
      )
      // ...y el siguiente ya no: lo frena el contador antes de tocar el hash.
      expect(mensajes[REGLA_LOGIN.max], 'el intento de más pasó igual: no hay freno en este camino').toBe(
        'Demasiados intentos. Esperá un minuto y volvé a probar.',
      )
    } finally {
      estado.tenantId = previoTenant
      estado.subdominio = previoSubdominio
    }
  })
})
