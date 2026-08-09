import { describe, it, expect, vi, beforeEach } from 'vitest'

// Este archivo vive fuera de lib/ a propósito: además de cubrir el endpoint,
// es la prueba de que el include de vitest alcanza todo el repo. Con el glob
// viejo ('lib/**/*.test.ts') estos tests no fallaban — directamente no
// existían para el gate de deploy.

const query = vi.fn()
const clienteQuery = vi.fn()
const release = vi.fn()
vi.mock('@/lib/db', () => ({
  pool: {
    query: (...a: unknown[]) => query(...a),
    // El check de tenant abre su propia conexión (ver lib/health/checks.test.ts):
    // set_config(..., true) es local a la transacción, así que necesita el
    // mismo cliente para las dos mitades.
    connect: async () => ({
      query: (...a: unknown[]) => clienteQuery(...a),
      release: () => release(),
    }),
  },
}))

describe('GET /api/health', () => {
  beforeEach(() => {
    query.mockReset()
    clienteQuery.mockReset()
    release.mockReset()
    vi.resetModules()
    process.env.ARANDANO_DB_ESPERADA = 'arandano_test'
    process.env.TENANT_CANARIO_SUBDOMINIO = 'canario'
    // Estos casos verifican el detalle, así que necesitan el token puesto
    // y mandado en cada request.
    process.env.ARANDANO_SALUD_TOKEN = 'token-de-prueba'
  })

  // Helper local: una request con o sin el header, para no repetir el
  // constructor en cada caso.
  const pedir = (token?: string) =>
    new Request('http://localhost/api/health', {
      headers: token ? { 'X-Arandano-Salud': token } : {},
    })

  // Los tres checks en verde, para que el veredicto sea 'ok' y lo único que
  // varíe entre casos sea el nivel de detalle.
  const todoSano = () => {
    process.env.GIT_SHA = 'abc1234'
    // Despachado por SQL, porque los tres checks corren en paralelo contra el
    // mismo mock: postgres pregunta la base, rol pregunta pg_roles, y tenant
    // resuelve el canario por resolver_tenant().
    query.mockImplementation((sql: string) => {
      if (/pg_roles/.test(sql)) {
        return Promise.resolve({
          rows: [{ rol: 'arandano_test_role', super: false, bypassrls: false, es_dueno: false }],
        })
      }
      if (/resolver_tenant/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 'id-del-canario' }] })
      }
      return Promise.resolve({ rows: [{ db: 'arandano_test' }] })
    })
    // Las dos mitades de la comprobación de RLS: con el tenant_id del canario
    // ve su propia fila (n=1), con uno inventado no ve ninguna (n=0).
    let llamadasCount = 0
    clienteQuery.mockImplementation((sql: string) => {
      if (/count/.test(sql)) {
        llamadasCount += 1
        return Promise.resolve({ rows: [{ n: llamadasCount === 1 ? 1 : 0 }] })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  it('devuelve 200 y reporta el SHA como info, no como check', async () => {
    todoSano()

    const { GET } = await import('./route')
    const res = await GET(pedir('token-de-prueba'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.info.sha).toBe('abc1234')
    expect(typeof body.info.uptimeS).toBe('number')
    // El SHA es contexto, no un check verde que infle la cuenta.
    expect(body.checks.map((c: { name: string }) => c.name)).not.toContain('app')
  })

  it('devuelve 503 cuando un check falla', async () => {
    query.mockRejectedValue(new Error('connect ECONNREFUSED'))

    const { GET } = await import('./route')
    const res = await GET(pedir('token-de-prueba'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('degraded')
    // Aun degradado sigue diciendo qué código está sirviendo: es el dato que
    // se mira primero para saber si hay que rollbackear.
    expect(body.info).toBeDefined()
  })

  describe('niveles de respuesta', () => {
    beforeEach(() => {
      process.env.ARANDANO_SALUD_TOKEN = 'token-de-prueba'
      process.env.GIT_SHA = 'abc1234'
      todoSano()
    })

    it('sin header devuelve sólo el veredicto', async () => {
      const { GET } = await import('./route')
      const res = await GET(pedir())
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ status: 'ok' })
      // Lo que este endpoint filtraba a internet: nombre de base, nombre de
      // rol, subdominio de un tenant real, y el commit exacto corriendo.
      expect(body.checks).toBeUndefined()
      expect(body.info).toBeUndefined()
    })

    it('con el token devuelve los checks y el sha', async () => {
      const { GET } = await import('./route')
      const res = await GET(pedir('token-de-prueba'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.status).toBe('ok')
      expect(body.checks.length).toBeGreaterThan(0)
      expect(body.info.sha).toBe('abc1234')
    })

    // Un 401 confirmaría que existe un modo autenticado. El anónimo no
    // confirma nada, que es el punto.
    it('con un token incorrecto responde como anónimo, no 401', async () => {
      const { GET } = await import('./route')
      const res = await GET(pedir('token-equivocado'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ status: 'ok' })
    })

    it('sin ARANDANO_SALUD_TOKEN configurada responde como anónimo', async () => {
      delete process.env.ARANDANO_SALUD_TOKEN
      const { GET } = await import('./route')
      const res = await GET(pedir('token-de-prueba'))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ status: 'ok' })
    })

    // El veredicto sale de todos los checks también en el nivel anónimo: es
    // lo que le permite al uptime check externo seguir detectando una base
    // caída sin ver un solo detalle.
    it('un check caído da 503 y degraded también sin token', async () => {
      query.mockImplementation(() => {
        throw new Error('postgres no responde')
      })
      const { GET } = await import('./route')
      const res = await GET(pedir())
      const body = await res.json()

      expect(res.status).toBe(503)
      expect(body).toEqual({ status: 'degraded' })
    })
  })
})
