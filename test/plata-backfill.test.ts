import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

const INICIO = '-- >>> BACKFILL'
const FIN = '-- <<< BACKFILL'

/**
 * El UPDATE de `entregada_en`, extraído del archivo de migración REAL.
 *
 * La base de los tests arranca vacía, así que `migrate deploy` nunca corre este
 * SQL con filas adentro. Se lee del archivo y no se reescribe acá por lo mismo
 * que en categorias-backfill.test.ts: una copia puede diverger del SQL que se
 * deploya. Y es el mismo UPDATE que se vuelve a correr a mano si un rollback
 * deja órdenes entregadas sin fecha, así que la idempotencia también se prueba.
 */
function sqlDelBackfill(): string {
  const base = join(process.cwd(), 'prisma/migrations')
  const dir = readdirSync(base).find((d) => d.endsWith('_plata_de_la_orden'))
  expect(dir, 'no está la migración _plata_de_la_orden').toBeTruthy()
  const sql = readFileSync(join(base, dir!, 'migration.sql'), 'utf8')
  const desde = sql.indexOf(INICIO)
  const hasta = sql.indexOf(FIN)
  expect(desde, 'la migración no tiene el marcador de inicio del backfill').toBeGreaterThan(-1)
  expect(hasta, 'la migración no tiene el marcador de fin del backfill').toBeGreaterThan(desde)
  return sql.slice(desde + INICIO.length, hasta)
}

let owner: Client
let tenantId: string
let usuarioId: string
let clienteId: string
let numero = 0

async function orden(estado: string): Promise<string> {
  numero += 1
  const { rows } = await owner.query(
    `INSERT INTO ordenes_de_trabajo
       (id, tenant_id, numero, cliente_id, recibida_por_id, estado,
        equipo_marca, equipo_modelo, falla_declarada, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'Samsung', 'A54', 'no carga', now(), now())
     RETURNING id`,
    [tenantId, numero, clienteId, usuarioId, estado],
  )
  return rows[0].id
}

async function evento(ordenId: string, desde: string, hasta: string, creadoEn: string) {
  await owner.query(
    `INSERT INTO eventos_orden (id, tenant_id, orden_id, desde, hasta, usuario_id, creado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
    [tenantId, ordenId, desde, hasta, usuarioId, creadoEn],
  )
}

async function entregadaEn(ordenId: string): Promise<string | null> {
  const { rows } = await owner.query(
    `SELECT entregada_en FROM ordenes_de_trabajo WHERE id = $1`,
    [ordenId],
  )
  return rows[0].entregada_en === null ? null : (rows[0].entregada_en as Date).toISOString()
}

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  // Tenant propio: el UPDATE recorre la tabla entera, y las filas sembradas
  // acá no tienen que chocar con las de otro archivo.
  tenantId = await crearTenant(owner, `plata-backfill-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, 'backfill@ot.test', 'EMPLEADO')
  const c = await owner.query(
    `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Juan', now(), now()) RETURNING id`,
    [tenantId],
  )
  clienteId = c.rows[0].id
})

afterAll(async () => {
  await owner.end()
})

describe('el backfill de entregada_en', () => {
  it('fecha toda orden que pasó por ENTREGADO, también la reabierta, y es idempotente', async () => {
    // Entregada dos veces (garantía): vale la última entrega.
    const entregada = await orden('ENTREGADO')
    await evento(entregada, 'LISTO', 'ENTREGADO', '2026-09-10T15:00:00Z')
    await evento(entregada, 'ENTREGADO', 'EN_REPARACION', '2026-09-20T15:00:00Z')
    await evento(entregada, 'LISTO', 'ENTREGADO', '2026-10-05T15:00:00Z')

    // Reabierta por garantía y todavía en el taller: ya se entregó una vez.
    const reabierta = await orden('EN_REPARACION')
    await evento(reabierta, 'LISTO', 'ENTREGADO', '2026-10-12T15:00:00Z')
    await evento(reabierta, 'ENTREGADO', 'EN_REPARACION', '2026-10-15T15:00:00Z')

    const nunca = await orden('LISTO')
    await evento(nunca, 'EN_REPARACION', 'LISTO', '2026-10-20T15:00:00Z')

    await owner.query(sqlDelBackfill())

    expect(await entregadaEn(entregada)).toBe('2026-10-05T15:00:00.000Z')
    expect(await entregadaEn(reabierta)).toBe('2026-10-12T15:00:00.000Z')
    expect(await entregadaEn(nunca)).toBeNull()

    // Una segunda corrida no pisa nada: la fecha ya cargada manda, aunque un
    // evento posterior diga otra cosa.
    await owner.query(`UPDATE ordenes_de_trabajo SET entregada_en = '2026-10-31T12:00:00Z' WHERE id = $1`, [
      reabierta,
    ])
    await owner.query(sqlDelBackfill())
    expect(await entregadaEn(entregada)).toBe('2026-10-05T15:00:00.000Z')
    expect(await entregadaEn(reabierta)).toBe('2026-10-31T12:00:00.000Z')
    expect(await entregadaEn(nunca)).toBeNull()
  })
})
