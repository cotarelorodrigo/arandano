import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runChecks } from '@/lib/health/runChecks'

// El check de postgres habla con el pool real; acá sólo interesa qué hace con
// la respuesta, no que haya una base levantada.
const query = vi.fn()
vi.mock('@/lib/db', () => ({ pool: { query: (...a: unknown[]) => query(...a) } }))

async function correrPostgresCheck() {
  const { checks } = await import('@/lib/health/checks')
  return runChecks(checks)
}

describe('check de postgres', () => {
  const entornoOriginal = process.env.NGF_DB_ESPERADA

  beforeEach(() => {
    query.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    if (entornoOriginal === undefined) delete process.env.NGF_DB_ESPERADA
    else process.env.NGF_DB_ESPERADA = entornoOriginal
  })

  it('pasa y reporta la base cuando la identidad coincide', async () => {
    process.env.NGF_DB_ESPERADA = 'ngf_prod'
    query.mockResolvedValue({ rows: [{ db: 'ngf_prod' }] })

    const report = await correrPostgresCheck()

    expect(report.status).toBe('ok')
    expect(report.checks[0].detail).toBe('db=ngf_prod')
  })

  it('falla cuando responde una base distinta de la esperada', async () => {
    // El escenario real: una app de prod con DATABASE_URL apuntando al
    // Postgres de dev. Con `SELECT 1` esto devolvía 200 y sano.
    process.env.NGF_DB_ESPERADA = 'ngf_prod'
    query.mockResolvedValue({ rows: [{ db: 'ngf_dev' }] })

    const report = await correrPostgresCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].ok).toBe(false)
    expect(report.checks[0].detail).toContain('ngf_dev')
    expect(report.checks[0].detail).toContain('ngf_prod')
  })

  it('falla si NGF_DB_ESPERADA no está definida, en vez de asumir que está bien', async () => {
    delete process.env.NGF_DB_ESPERADA
    query.mockResolvedValue({ rows: [{ db: 'ngf_prod' }] })

    const report = await correrPostgresCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toContain('NGF_DB_ESPERADA')
  })
})
