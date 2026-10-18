import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant, crearUsuario } from '@/test/datos'

/**
 * El historial de cierres de /caja: el filtro por fecha de cierre, sólo las
 * cerradas, los movimientos de cada una y el aislamiento por tenant. Las cajas
 * se insertan crudas con el owner para fijar las fechas a mano.
 */

let owner: Client
let tenantA: string
let tenantB: string
let usuarioA: string
let usuarioB: string
let cierresDelPeriodo: typeof import('@/lib/caja/historial').cierresDelPeriodo

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'historial-a')
  tenantB = await crearTenant(owner, 'historial-b')
  usuarioA = await crearUsuario(owner, tenantA, 'flor@historial-a.test')
  usuarioB = await crearUsuario(owner, tenantB, 'ruben@historial-b.test')
  process.env.DATABASE_URL = urlApp()
  ;({ cierresDelPeriodo } = await import('@/lib/caja/historial'))
})

afterAll(async () => {
  await owner.end()
})

beforeEach(async () => {
  const ts = [tenantA, tenantB]
  await owner.query('DELETE FROM movimientos_de_caja WHERE tenant_id = ANY($1)', [ts])
  await owner.query('DELETE FROM cajas WHERE tenant_id = ANY($1)', [ts])
})

/** Una caja cerrada el `dia` (YYYY-MM-DD, hora argentina) a las 20, con
 *  arqueo si se le pasa el contado. */
async function cajaCerrada(
  tenantId: string,
  usuarioId: string,
  dia: string,
  arqueo: { esperado: string; contado: string; retirado: string } | null,
): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO cajas (id, tenant_id, abierta_en, abierta_por_id, saldo_inicial, cerrada_en, cerrada_por_id,
                        esperado_ars, contado_ars, retirado_ars, esperado_usd, contado_usd, retirado_usd, creado_en)
     VALUES (gen_random_uuid(), $1, ($3 || 'T09:00:00-03:00')::timestamptz, $2, 1000,
             ($3 || 'T20:00:00-03:00')::timestamptz, $2, $4, $5, $6, $7, $7, $7, now())
     RETURNING id`,
    [tenantId, usuarioId, dia, arqueo?.esperado ?? null, arqueo?.contado ?? null, arqueo?.retirado ?? null,
      arqueo ? 0 : null],
  )
  return rows[0].id
}

const periodo = (desde: string, hasta: string) => ({
  desde: new Date(`${desde}T00:00:00-03:00`),
  hasta: new Date(`${hasta}T00:00:00-03:00`),
})

describe('el historial de cierres', () => {
  it('trae las cerradas del período, de la más reciente a la más vieja', async () => {
    await cajaCerrada(tenantA, usuarioA, '2026-10-01', { esperado: '1000', contado: '1000', retirado: '0' })
    await cajaCerrada(tenantA, usuarioA, '2026-10-10', { esperado: '1000', contado: '800', retirado: '500' })
    await cajaCerrada(tenantA, usuarioA, '2026-10-20', null)
    const { cierres } = await cierresDelPeriodo(tenantA, periodo('2026-10-05', '2026-10-21'))
    expect(cierres.map((c) => c.cerradaEn.toISOString())).toEqual([
      '2026-10-20T23:00:00.000Z',
      '2026-10-10T23:00:00.000Z',
    ])
    expect(cierres[1].arqueo).toMatchObject({
      esperado: { ars: '1000.00', usd: '0.00' },
      contado: { ars: '800.00' },
      retirado: { ars: '500.00' },
    })
    // La de antes del arqueo, sin arqueo: no se le inventa ninguno.
    expect(cierres[0].arqueo).toBeNull()
  })

  it('la caja abierta no aparece: todavía no tiene cierre', async () => {
    await owner.query(
      `INSERT INTO cajas (id, tenant_id, abierta_en, abierta_por_id, saldo_inicial, creado_en)
       VALUES (gen_random_uuid(), $1, now(), $2, 0, now())`,
      [tenantA, usuarioA],
    )
    const { cierres } = await cierresDelPeriodo(tenantA, periodo('2000-01-01', '2100-01-01'))
    expect(cierres).toHaveLength(0)
  })

  it('cada cierre trae sus movimientos y no los de otro', async () => {
    const una = await cajaCerrada(tenantA, usuarioA, '2026-10-10', { esperado: '1', contado: '1', retirado: '0' })
    const otra = await cajaCerrada(tenantA, usuarioA, '2026-10-11', { esperado: '1', contado: '1', retirado: '0' })
    await owner.query(
      `INSERT INTO movimientos_de_caja (id, tenant_id, caja_id, tipo, moneda, monto, nota, usuario_id)
       VALUES (gen_random_uuid(), $1, $2, 'EGRESO', 'ARS', 5000, 'Delivery', $3),
              (gen_random_uuid(), $1, $4, 'INGRESO', 'USD', 100, NULL, $3)`,
      [tenantA, una, usuarioA, otra],
    )
    const { cierres } = await cierresDelPeriodo(tenantA, periodo('2026-10-01', '2026-10-31'))
    const deUna = cierres.find((c) => c.id === una)!
    const deOtra = cierres.find((c) => c.id === otra)!
    expect(deUna.movimientos.map((m) => m.nota)).toEqual(['Delivery'])
    expect(deUna.conDolares).toBe(false)
    expect(deOtra.movimientos.map((m) => m.moneda)).toEqual(['USD'])
    // Un movimiento en dólares es "este cierre tuvo dólares".
    expect(deOtra.conDolares).toBe(true)
  })

  it('es del local: los cierres de otro tenant no aparecen', async () => {
    await cajaCerrada(tenantB, usuarioB, '2026-10-10', { esperado: '9', contado: '9', retirado: '0' })
    const { cierres } = await cierresDelPeriodo(tenantA, periodo('2026-10-01', '2026-10-31'))
    expect(cierres).toHaveLength(0)
  })
})
