import { describe, it, expect } from 'vitest'
import { runChecks } from '@/lib/health/runChecks'
import type { HealthCheck } from '@/lib/health/types'

const check = (
  name: string,
  run: HealthCheck['run'],
  timeoutMs = 50,
): HealthCheck => ({ name, timeoutMs, run })

describe('runChecks', () => {
  it('reporta ok cuando todos los checks pasan', async () => {
    const report = await runChecks([
      check('a', async () => {}),
      check('b', async () => 'sha=abc123'),
    ])

    expect(report.status).toBe('ok')
    expect(report.checks.map((c) => c.name)).toEqual(['a', 'b'])
    expect(report.checks[1].detail).toBe('sha=abc123')
  })

  it('reporta degraded y el motivo cuando un check lanza', async () => {
    const report = await runChecks([
      check('postgres', async () => {
        throw new Error('conexión rechazada')
      }),
    ])

    expect(report.status).toBe('degraded')
    expect(report.checks[0].ok).toBe(false)
    expect(report.checks[0].detail).toBe('conexión rechazada')
  })

  it('corta un check colgado en su timeout en vez de esperarlo', async () => {
    const report = await runChecks([
      check('colgado', () => new Promise(() => {}), 20),
    ])

    expect(report.checks[0].ok).toBe(false)
    expect(report.checks[0].detail).toMatch(/timeout/)
  })

  it('aísla la falla: un check roto no impide reportar los demás', async () => {
    const report = await runChecks([
      check('roto', async () => {
        throw new Error('boom')
      }),
      check('sano', async () => {}),
    ])

    expect(report.status).toBe('degraded')
    expect(report.checks).toHaveLength(2)
    expect(report.checks[1].ok).toBe(true)
  })

  it('aplana un AggregateError en sus submensajes en vez de dejar el detail vacío', async () => {
    const report = await runChecks([
      check('postgres', async () => {
        throw new AggregateError(
          [
            new Error('connect ECONNREFUSED ::1:5432'),
            new Error('connect ECONNREFUSED 127.0.0.1:5432'),
          ],
          '',
        )
      }),
    ])

    expect(report.status).toBe('degraded')
    expect(report.checks[0].ok).toBe(false)
    expect(report.checks[0].detail).toMatch(/ECONNREFUSED/)
    expect(report.checks[0].detail).not.toBe('')
  })
})
