import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
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
  } catch {
    // Better Auth tira ante credenciales inválidas según la forma de llamada;
    // cualquiera de las dos cuenta como "no entró".
    return 401
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
    expect(await entrar(tenantA, CLAVE_B)).not.toBe(200)
  })

  it('NO entra en el local B con la clave de A', async () => {
    expect(await entrar(tenantB, CLAVE_A)).not.toBe(200)
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
