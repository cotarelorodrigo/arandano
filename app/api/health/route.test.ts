import { describe, it, expect, vi, beforeEach } from 'vitest'

// Este archivo vive fuera de lib/ a propósito: además de cubrir el endpoint,
// es la prueba de que el include de vitest alcanza todo el repo. Con el glob
// viejo ('lib/**/*.test.ts') estos tests no fallaban — directamente no
// existían para el gate de deploy.

const query = vi.fn()
vi.mock('@/lib/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }))

describe('GET /api/health', () => {
  beforeEach(() => {
    query.mockReset()
    vi.resetModules()
    process.env.ARANDANO_DB_ESPERADA = 'arandano_test'
  })

  it('devuelve 200 y reporta el SHA como info, no como check', async () => {
    process.env.GIT_SHA = 'abc1234'
    query.mockResolvedValue({ rows: [{ db: 'arandano_test' }] })

    const { GET } = await import('./route')
    const res = await GET()
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
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('degraded')
    // Aun degradado sigue diciendo qué código está sirviendo: es el dato que
    // se mira primero para saber si hay que rollbackear.
    expect(body.info).toBeDefined()
  })
})
