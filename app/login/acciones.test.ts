import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

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
