import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
let conversacionId: string
let limites: typeof import('@/lib/bot/limites')

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'bot-limites')
  process.env.DATABASE_URL = urlApp()
  limites = await import('@/lib/bot/limites')
})

afterAll(async () => {
  await owner.end()
})

beforeEach(async () => {
  await owner.query('DELETE FROM conversaciones_bot WHERE tenant_id = $1', [tenantId])
  const { rows } = await owner.query(
    `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
     VALUES (gen_random_uuid(), $1, '+5491155550000', now(), now()) RETURNING id`,
    [tenantId],
  )
  conversacionId = rows[0].id
})

async function entrante(motivo: string | null, creadoEn = 'now()') {
  await owner.query(
    `INSERT INTO mensajes_bot (id, tenant_id, conversacion_id, direccion, texto, wamid, motivo, creado_en)
     VALUES (gen_random_uuid(), $1, $2, 'ENTRANTE', 'hola', gen_random_uuid()::text, $3, ${creadoEn})`,
    [tenantId, conversacionId, motivo],
  )
}

describe('los clientes que escribieron durante la prueba', () => {
  it('cuenta sólo los entrantes con MODO_PRUEBA del mes', async () => {
    await entrante('MODO_PRUEBA')
    await entrante('MODO_PRUEBA')
    await entrante('BOT_APAGADO')
    await entrante(null)
    await entrante('MODO_PRUEBA', "now() - interval '40 days'")
    expect(await limites.sinRespuestaEnPruebaDelMes(tenantId)).toBe(2)
  })

  it('sin mensajes da cero', async () => {
    expect(await limites.sinRespuestaEnPruebaDelMes(tenantId)).toBe(0)
  })
})
