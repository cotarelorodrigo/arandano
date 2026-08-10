import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { APIError } from 'better-auth'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import dinámico: `lib/auth/para-tenant.ts` arrastra lib/db.ts, que construye
// su Pool al importarse leyendo DATABASE_URL.
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant

const ORIGEN = 'http://flor.arandano.test'
const MAIL = 'compartido@ejemplo.test'
const CLAVE_A = 'clave-del-local-a'
const CLAVE_B = 'clave-del-local-b'

let owner: Client
let tenantA: string
let tenantB: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  const sufijo = Date.now()
  tenantA = await crearTenant(owner, `auth-a-${sufijo}`)
  tenantB = await crearTenant(owner, `auth-b-${sufijo}`)

  // El MISMO mail en los dos locales, con contraseñas distintas. Es todo el
  // punto del ciclo: `users` lleva @@unique([tenantId, email]), no un unique
  // global, así que esto es un estado legítimo del sistema.
  await authParaTenant(tenantA, ORIGEN).api.signUpEmail({
    body: { email: MAIL, password: CLAVE_A, name: 'Juan del local A' },
  })
  await authParaTenant(tenantB, ORIGEN).api.signUpEmail({
    body: { email: MAIL, password: CLAVE_B, name: 'Juan del local B' },
  })
})

afterAll(async () => {
  await owner.end()
})

async function entrar(tenantId: string, password: string) {
  try {
    const r = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: MAIL, password },
      asResponse: true,
    })
    return r.status
  } catch (error) {
    // Con `asResponse: true`, Better Auth devuelve las credenciales inválidas
    // como Response (status 401) en vez de tirarlas — medido contra la
    // versión instalada, ver el reporte de la task. Este catch en la
    // práctica no debería dispararse por una contraseña incorrecta; queda
    // como red ante un cambio de versión de la librería, pero acotada al
    // código puntual de "credenciales inválidas". Cualquier otra excepción
    // (un bug de setup, de red, de conexión) se relanza: un catch genérico
    // convertiría un test roto en un "no entró" indistinguible de un login
    // legítimamente rechazado, y eso es justo lo que el Step 6 necesita NO
    // que pase.
    if (error instanceof APIError && error.body?.code === 'INVALID_EMAIL_OR_PASSWORD') {
      return 401
    }
    throw error
  }
}

describe('aislamiento del login entre tenants', () => {
  it('el mismo mail existe como dos filas distintas, una por tenant', async () => {
    const { rows } = await owner.query(
      'SELECT tenant_id FROM users WHERE email = $1 ORDER BY tenant_id',
      [MAIL],
    )
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((f) => f.tenant_id))).toEqual(new Set([tenantA, tenantB]))
  })

  it('entra en el local A con la clave de A', async () => {
    expect(await entrar(tenantA, CLAVE_A)).toBe(200)
  })

  it('entra en el local B con la clave de B', async () => {
    expect(await entrar(tenantB, CLAVE_B)).toBe(200)
  })

  it('NO entra en el local A con la clave de B', async () => {
    // Éste es el test que justifica la arquitectura. Si la búsqueda por mail
    // dejara de estar acotada al tenant, Better Auth podría encontrar la fila
    // de B desde A y este login pasaría.
    //
    // toBe(401) y no un .not.toBe(200) más débil: con ese negativo, un 429
    // por rate limit o un setup roto satisfarían la aserción igual que un
    // login correctamente rechazado, y el Step 6 (ver más abajo) necesita
    // que esto tenga peso propio para significar algo.
    expect(await entrar(tenantA, CLAVE_B)).toBe(401)
  })

  it('NO entra en el local B con la clave de A', async () => {
    expect(await entrar(tenantB, CLAVE_A)).toBe(401)
  })
})

describe('aislamiento de la sesión', () => {
  it('la sesión creada en A no existe para B', async () => {
    const r = await authParaTenant(tenantA, ORIGEN).api.signInEmail({
      body: { email: MAIL, password: CLAVE_A },
      asResponse: true,
    })
    const cookie = r.headers.get('set-cookie')
    expect(cookie, 'el login no devolvió cookie').toBeTruthy()

    const cabeceras = new Headers({ cookie: cookie!.split(';')[0] })

    const enA = await authParaTenant(tenantA, ORIGEN).api.getSession({ headers: cabeceras })
    expect(enA?.user, 'la sesión no vale en su propio tenant').toBeTruthy()

    // Misma cookie, otro local. La fila de `sessions` existe, pero con el
    // tenant_id de A: la policy no la devuelve cuando el GUC dice B.
    const enB = await authParaTenant(tenantB, ORIGEN).api.getSession({ headers: cabeceras })
    expect(enB, 'la cookie de un local sirvió en otro').toBeFalsy()
  })

  it('las filas de sessions llevan el tenant_id que les puso la extensión', async () => {
    const { rows } = await owner.query(
      'SELECT DISTINCT tenant_id FROM sessions WHERE tenant_id = $1',
      [tenantA],
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})

/**
 * Step 6 de la task: no alcanza con que el resto de este archivo pase — hay
 * que confirmar que las aserciones DETECTAN el aislamiento roto, y no que
 * simplemente "no pasan por otra razón". Mutar el CLIENTE (cambiar
 * `prismaParaTenant(tenantId)` por el `prisma` base en para-tenant.ts, que es
 * lo que probé a mano para el reporte) no sirve para eso: sin la extensión el
 * `create` de `signUpEmail` ya no autocompleta `tenant_id`, así que
 * `beforeAll` explota ANTES de que corra ninguna aserción y los 7 tests
 * quedan `skipped` — lo mismo que hubiera pasado con un archivo lleno de
 * `expect(true).toBe(true)`.
 *
 * Esta prueba muta la POLICY en vez del cliente: afloja sólo el `USING` de
 * lectura de `users` —DESPUÉS de que `beforeAll` ya sembró los dos Juanes—,
 * dejando el `WITH CHECK` de escritura intacto. Es el modo de falla real que
 * este ciclo previene (una policy mal escrita, no un cliente mal armado), y
 * es justo lo que separa a un test con aserciones verificadas de uno que
 * nunca llegó a ejecutarlas.
 */
describe('el aislamiento roto se detecta (Step 6)', () => {
  it('con la policy de lectura de users aflojada, el login legítimo de B deja de entrar', async () => {
    await owner.query('ALTER POLICY "tenant_aislamiento" ON users USING (true)')
    try {
      // Sin el USING acotado por tenant, la búsqueda por mail de Better Auth
      // encuentra CUALQUIER fila con ese email — en la práctica, siempre la
      // de A, que es la que quedó insertada primero (sin ORDER BY, Postgres
      // devuelve la misma fila en ambos sentidos). El síntoma NO es el que
      // se podría suponer a primera vista ("B entra con la clave de A"):
      // Better Auth busca el usuario por mail y DESPUÉS busca su cuenta de
      // credenciales por userId, y esa segunda búsqueda —contra `accounts`,
      // cuya policy esta prueba no toca— sigue acotada al tenant de la
      // sesión. Como el usuario que encontró es el de A pero la sesión es de
      // B, esa cuenta no aparece nunca ("Credential account not found"), y
      // el resultado es 401 tanto con CLAVE_A como con CLAVE_B.
      //
      // La señal real y observable es la inversa: el login LEGÍTIMO de B dejó
      // de entrar. Con la policy intacta esto es 200 (ver el test "entra en
      // el local B con la clave de B", arriba); acá, con la policy floja,
      // es 401. Ese flip —200 a 401 para la MISMA llamada— es lo que prueba
      // que el aislamiento roto se detecta.
      expect(await entrar(tenantB, CLAVE_B)).toBe(401)
    } finally {
      // El ALTER de arriba tocó sólo USING; WITH CHECK no se mencionó, así
      // que sigue siendo el original y no hace falta restaurarlo. Alcanza
      // con devolverle a USING la expresión de
      // prisma/migrations/20260804205911_inicial/migration.sql. El finally
      // corre incluso si algún expect de arriba tira, así que la policy
      // vuelve a quedar cerrada para el resto de la suite pase lo que pase.
      await owner.query(
        `ALTER POLICY "tenant_aislamiento" ON users
           USING (tenant_id = nullif(current_setting('arandano.tenant_id', true), '')::uuid)`,
      )
    }
  })
})

describe('la sesión de un usuario desactivado', () => {
  it('deja de valer en el request siguiente', async () => {
    const auth = authParaTenant(tenantA, ORIGEN)

    const r = await auth.api.signInEmail({
      body: { email: MAIL, password: CLAVE_A },
      asResponse: true,
    })
    const cookie = r.headers.get('set-cookie')!.split(';')[0]
    const cabeceras = new Headers({ cookie })

    // Con la sesión viva, Better Auth la devuelve.
    const antes = await auth.api.getSession({ headers: cabeceras })
    expect(antes?.user).toBeTruthy()

    await owner.query(
      'UPDATE users SET desactivado_en = now() WHERE tenant_id = $1 AND email = $2',
      [tenantA, MAIL],
    )

    // El restore va en `finally`, igual que el `describe` vecino de arriba
    // ("el aislamiento roto se detecta"): si algún expect de abajo tira, el
    // usuario no puede quedar desactivado. Sin esto, el riesgo es chico
    // mientras este describe sea el último del archivo, pero deja de serlo
    // en cuanto la próxima task agregue tests debajo -mejor que el hábito
    // esté puesto desde ahora.
    try {
      // Better Auth NO sabe nada de desactivación: la sesión le sigue
      // pareciendo válida. Ésa es exactamente la razón por la que el guard
      // existe, y por la que el chequeo va en cada request y no sólo al
      // entrar: si se hiciera sólo al entrar, echar a un empleado no tendría
      // efecto hasta que se le venciera la sesión.
      const despues = await auth.api.getSession({ headers: cabeceras })
      expect(despues?.user, 'Better Auth ya no devuelve la sesión: el test no prueba nada')
        .toBeTruthy()
      expect((despues!.user as { desactivadoEn?: unknown }).desactivadoEn).toBeTruthy()
    } finally {
      await owner.query(
        'UPDATE users SET desactivado_en = NULL WHERE tenant_id = $1 AND email = $2',
        [tenantA, MAIL],
      )
    }
  })
})
