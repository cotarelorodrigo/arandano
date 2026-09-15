import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
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
})

async function conversacion(waId: string): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
     VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`,
    [tenantId, waId],
  )
  return rows[0].id
}

async function entrante(conversacionId: string, motivo: string | null, creadoEn = 'now()') {
  await owner.query(
    `INSERT INTO mensajes_bot (id, tenant_id, conversacion_id, direccion, texto, wamid, motivo, creado_en)
     VALUES (gen_random_uuid(), $1, $2, 'ENTRANTE', 'hola', gen_random_uuid()::text, $3, ${creadoEn})`,
    [tenantId, conversacionId, motivo],
  )
}

describe('los clientes que escribieron durante la prueba', () => {
  it('cuenta clientes distintos, no mensajes', async () => {
    // El mismo cliente escribe dos veces con MODO_PRUEBA, más dos mensajes que
    // no cuentan (otro motivo, sin motivo): sigue siendo UN cliente.
    const conv1 = await conversacion('+5491155550001')
    await entrante(conv1, 'MODO_PRUEBA')
    await entrante(conv1, 'MODO_PRUEBA')
    await entrante(conv1, 'BOT_APAGADO')
    await entrante(conv1, null)

    // Un segundo cliente, con un solo mensaje: cuenta.
    const conv2 = await conversacion('+5491155550002')
    await entrante(conv2, 'MODO_PRUEBA')

    // Un tercer cliente cuyo único mensaje MODO_PRUEBA es de hace 40 días: no
    // tiene ningún mensaje de ESTE mes, así que no cuenta — ni siquiera para
    // hacer que una conversación "vacía" (sin mensajes del mes) sume.
    const conv3 = await conversacion('+5491155550003')
    await entrante(conv3, 'MODO_PRUEBA', "now() - interval '40 days'")

    expect(await limites.sinRespuestaEnPruebaDelMes(tenantId)).toBe(2)
  })

  it('sin mensajes da cero', async () => {
    expect(await limites.sinRespuestaEnPruebaDelMes(tenantId)).toBe(0)
  })
})
