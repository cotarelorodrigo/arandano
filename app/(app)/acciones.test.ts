import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

// Mismo patrón que app/login/acciones.test.ts: los mocks se hoistean por sobre
// los imports, y el tenant (y la cookie) recién existen en beforeAll, así que
// leen de un estado mutable.
const estado = vi.hoisted(() => ({
  tenantId: '',
  subdominio: '',
  cabeceras: new Headers(),
}))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Salir test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

vi.mock('next/headers', () => ({ headers: async () => estado.cabeceras }))

let salir: typeof import('./acciones').salir
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

let owner: Client
const MAIL = 'sale@ejemplo.test'
const CLAVE = 'clave-para-salir-larga'
let usuarioId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'
  ;({ salir } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  estado.subdominio = `salir-${Date.now()}`
  estado.tenantId = await crearTenant(owner, estado.subdominio)

  const origen = await origenDelRequest(estado.subdominio)
  const alta = await authParaTenant(estado.tenantId, origen).api.signUpEmail({
    body: { email: MAIL, password: CLAVE, name: 'Quien se va' },
  })
  usuarioId = alta.user.id
})

afterAll(async () => {
  await owner.end()
})

describe('salir', () => {
  it('borra la sesión del lado del servidor, no sólo la cookie', async () => {
    // Que la cookie se borre no alcanza: quien se quedó con el token seguiría
    // entrando. Lo que tiene que desaparecer es la fila.
    const origen = await origenDelRequest(estado.subdominio)
    const r = await authParaTenant(estado.tenantId, origen).api.signInEmail({
      body: { email: MAIL, password: CLAVE },
      asResponse: true,
    })
    estado.cabeceras = new Headers({ cookie: r.headers.get('set-cookie')!.split(';')[0] })

    const antes = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [usuarioId])
    expect(antes.rows[0].n, 'el login no dejó sesión; el test no probaría nada').toBeGreaterThan(0)

    // redirect() tira la excepción de control de Next, así que salir() SIEMPRE
    // termina así: lo que importa es lo que dejó hecho antes.
    await expect(salir()).rejects.toThrow(/NEXT_REDIRECT/)

    const despues = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [usuarioId])
    expect(despues.rows[0].n, 'la sesión sobrevivió al logout').toBe(0)
  })

  it('sin sesión que cerrar, igual manda al login', async () => {
    // Una cookie vencida, o alguien a quien acaban de desactivar (que le borra
    // las sesiones), no puede dejar el botón trabado.
    estado.cabeceras = new Headers()
    await expect(salir()).rejects.toThrow(/NEXT_REDIRECT/)
  })
})
