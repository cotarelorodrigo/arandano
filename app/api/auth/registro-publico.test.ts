import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

/**
 * El par que impide que el arreglo del registro público se revierta sin que
 * nadie se entere.
 *
 * A diferencia de `ruta.test.ts`, que mockea `authParaTenant` para probar la
 * resolución de tenant, acá el handler es el REAL: la instancia de Better Auth
 * de un tenant de verdad, contra la base efímera. Es la única forma de que el
 * 404 signifique algo — `disabledPaths` lo aplica el `onRequest` del router de
 * la librería, así que un test con el router mockeado no lo ejercitaría nunca.
 *
 * Las dos mitades van juntas a propósito: sin la segunda, "sacar el registro"
 * se podría implementar apagando `emailAndPassword` entero, y el alta de
 * empleados —que llama a `signUpEmail` DIRECTO, sin pasar por el router— se
 * caería con él.
 */

const ORIGEN = 'http://registro.arandano.test'
const MAIL_DE_AFUERA = 'intruso@ejemplo.test'

let POST: (request: Request) => Promise<Response>
let crearEmpleado: typeof import('@/lib/usuarios/administrar').crearEmpleado

let owner: Client
let tenantId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `registro-${Date.now()}`)

  // El mock tiene que estar puesto ANTES de importar la ruta, y el tenant
  // recién existe acá: por eso el import es dinámico, mismo patrón que el
  // resto de los tests con base de este repo.
  const { vi } = await import('vitest')
  vi.doMock('@/lib/tenant/desde-request', () => ({
    tenantDelRequest: async () => ({
      tipo: 'tenant',
      tenant: { id: tenantId, nombre: 'Registro', estado: 'TRIAL' },
      subdominio: 'registro',
    }),
  }))
  vi.doMock('@/lib/auth/origen', () => ({ origenDelRequest: async () => ORIGEN }))

  ;({ POST } = await import('./[...all]/route'))
  ;({ crearEmpleado } = await import('@/lib/usuarios/administrar'))
})

afterAll(async () => {
  await owner.end()
})

function altaPorHTTP(email: string): Request {
  // Sin header Cookie a propósito: es exactamente el request que el review
  // usó para entrar. El chequeo de origen de Better Auth se saltea cuando no
  // hay cookie, así que si el endpoint estuviera montado, esto pasaría.
  return new Request(`${ORIGEN}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'clave-de-un-desconocido', name: 'Intruso' }),
  })
}

describe('el registro público no existe', () => {
  it('POST /api/auth/sign-up/email da 404 y no crea ningún usuario', async () => {
    const r = await POST(altaPorHTTP(MAIL_DE_AFUERA))
    expect(r.status, 'el registro público sigue montado: cualquiera se crea una cuenta adentro del local').toBe(404)

    const { rows } = await owner.query('SELECT id FROM users WHERE tenant_id = $1 AND email = $2', [
      tenantId,
      MAIL_DE_AFUERA,
    ])
    expect(rows, 'el 404 llegó tarde: la fila ya estaba escrita').toHaveLength(0)
  })

  it('el alta que hace el dueño desde adentro sigue funcionando', async () => {
    // La otra mitad: `disabledPaths` corta la ruta HTTP, no la llamada
    // directa a auth.api.signUpEmail que usa crearEmpleado. Si esta aserción
    // se cae, el arreglo se pasó de largo y la administración de usuarios
    // quedó rota.
    const { id } = await crearEmpleado({
      tenantId,
      origen: ORIGEN,
      nombre: 'Empleada de adentro',
      email: 'adentro@ejemplo.test',
      clave: 'clave-larga-de-sobra',
      rol: 'EMPLEADO',
    })

    const { rows } = await owner.query('SELECT email FROM users WHERE id = $1', [id])
    expect(rows[0].email).toBe('adentro@ejemplo.test')
  })
})
