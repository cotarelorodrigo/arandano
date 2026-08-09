import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantA: string
let tenantB: string
let enTransaccionDeTenant: typeof import('./transaccion').enTransaccionDeTenant
let prisma: typeof import('@/lib/db').prisma

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, `tx-a-${Date.now()}`)
  tenantB = await crearTenant(owner, `tx-b-${Date.now()}`)
  // Un cliente por tenant, para tener algo que contar.
  await owner.query(
    `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'de A', now(), now()),
            (gen_random_uuid(), $2, 'de B', now(), now())`,
    [tenantA, tenantB],
  )

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import, no después (mismo patrón que
  // lib/tenant/prisma.test.ts).
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('./transaccion'))
  ;({ prisma } = await import('@/lib/db'))
})

afterAll(async () => {
  await owner.end()
})

describe('enTransaccionDeTenant', () => {
  it('adentro sólo se ven las filas del tenant', async () => {
    const nombres = await enTransaccionDeTenant(tenantA, async (tx) =>
      (await tx.cliente.findMany()).map((c) => c.nombre),
    )
    expect(nombres).toEqual(['de A'])
  })

  it('devuelve lo que devuelve el callback', async () => {
    const r = await enTransaccionDeTenant(tenantA, async () => 42)
    expect(r).toBe(42)
  })

  // Sin esto, media transacción escrita se queda: es la razón de existir del
  // helper.
  it('revierte todo si el callback lanza', async () => {
    const antes = await enTransaccionDeTenant(tenantA, async (tx) =>
      tx.cliente.count(),
    )

    await expect(
      enTransaccionDeTenant(tenantA, async (tx) => {
        await tx.cliente.create({
          data: { tenantId: tenantA, nombre: 'no debería quedar' },
        })
        throw new Error('falla a propósito')
      }),
    ).rejects.toThrow('falla a propósito')

    const despues = await enTransaccionDeTenant(tenantA, async (tx) =>
      tx.cliente.count(),
    )
    expect(despues).toBe(antes)
  })

  // El WITH CHECK de la policy es lo que atrapa un tenant_id ajeno. Sin esta
  // prueba, un bug de la app podría escribir en el tenant de otro.
  it('no deja escribir una fila de otro tenant', async () => {
    await expect(
      enTransaccionDeTenant(tenantA, async (tx) => {
        await tx.cliente.create({
          data: { tenantId: tenantB, nombre: 'invasor' },
        })
      }),
    ).rejects.toThrow()
  })

  // EL TEST DE SEGURIDAD. El set_config va con el tercer argumento en true, o
  // sea local a la transacción. Si alguien lo sacara, la GUC sobreviviría en la
  // conexión, volvería al pool con el tenant anterior puesto, y el request
  // siguiente leería datos de otro negocio. Sin esta prueba, ese cambio pasa
  // desapercibido: todos los demás tests seguirían en verde.
  it('la GUC no sobrevive a la transacción', async () => {
    await enTransaccionDeTenant(tenantA, async (tx) => {
      await tx.cliente.count()
    })

    const [{ guc }] = await prisma.$queryRaw<{ guc: string }[]>`
      SELECT current_setting('arandano.tenant_id', true) AS guc
    `
    expect(guc ?? '').toBe('')
  })
})
