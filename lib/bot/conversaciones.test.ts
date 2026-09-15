import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
let conversaciones: typeof import('@/lib/bot/conversaciones')

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'bot-conversaciones')
  process.env.DATABASE_URL = urlApp()
  conversaciones = await import('@/lib/bot/conversaciones')
})

afterAll(async () => {
  await owner.end()
})

describe('el historial que ve el modelo', () => {
  /**
   * El invariante que hace seguro el rollback (spec, *Deploy*): la imagen
   * anterior no conoce `MODO_PRUEBA`, y su Prisma fallaría al deserializar una
   * fila con ese valor. `historialDe` las filtra en el WHERE y selecciona sólo
   * dirección y texto, así que nunca las lee. Si alguien cambia esa consulta
   * para traer la fila entera sin filtrar el motivo, este caso tiene que
   * avisar.
   */
  it('excluye los mensajes de clientes reales durante la prueba sin leerlos', async () => {
    const { rows } = await owner.query(
      `INSERT INTO conversaciones_bot (id, tenant_id, wa_id, creado_en, ultimo_mensaje_en)
       VALUES (gen_random_uuid(), $1, '+5491155550000', now(), now()) RETURNING id`,
      [tenantId],
    )
    const conversacionId = rows[0].id
    await owner.query(
      `INSERT INTO mensajes_bot (id, tenant_id, conversacion_id, direccion, texto, wamid, motivo, creado_en)
       VALUES (gen_random_uuid(), $1, $2, 'ENTRANTE', 'durante la prueba', 'wamid.p', 'MODO_PRUEBA', now() - interval '1 minute'),
              (gen_random_uuid(), $1, $2, 'ENTRANTE', 'con el bot contestando', 'wamid.t', NULL, now())`,
      [tenantId, conversacionId],
    )

    const historial = await conversaciones.historialDe(tenantId, conversacionId)
    expect(historial).toEqual([{ rol: 'cliente', texto: 'con el bot contestando' }])
  })
})
