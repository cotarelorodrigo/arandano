import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantA: string
let tenantB: string
let prismaParaTenant: typeof import('@/lib/tenant/prisma').prismaParaTenant
let prismaBase: typeof import('@/lib/db').prisma

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'ext-a')
  tenantB = await crearTenant(owner, 'ext-b')

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import, no después.
  process.env.DATABASE_URL = urlApp()
  ;({ prismaParaTenant } = await import('@/lib/tenant/prisma'))
  ;({ prisma: prismaBase } = await import('@/lib/db'))
})

afterAll(async () => {
  await owner.end()
})

describe('prismaParaTenant', () => {
  it('autocompleta tenant_id al crear', async () => {
    const db = prismaParaTenant(tenantA)
    // @ts-expect-error el tipo generado exige tenantId (o la relación tenant);
    // acá se lo omite a propósito porque lo completa la extensión en runtime.
    const cliente = await db.cliente.create({ data: { nombre: 'Sin tenant explícito' } })
    expect(cliente.tenantId).toBe(tenantA)
  })

  it('no devuelve filas de otro tenant', async () => {
    // @ts-expect-error idem: tenantId lo completa prismaParaTenant, no quien llama.
    await prismaParaTenant(tenantB).cliente.create({ data: { nombre: 'De B' } })
    const deA = await prismaParaTenant(tenantA).cliente.findMany()
    expect(deA.map((c) => c.nombre)).not.toContain('De B')
  })

  it('no se contamina entre operaciones consecutivas sobre el mismo pool', async () => {
    // Este es el test que atrapa el bug que arruinaría todo lo demás: si la GUC
    // sobreviviera a la transacción, la segunda llamada leería con el tenant de
    // la primera.
    for (let i = 0; i < 10; i++) {
      const deA = await prismaParaTenant(tenantA).cliente.findMany()
      expect(deA.every((c) => c.tenantId === tenantA)).toBe(true)
      const deB = await prismaParaTenant(tenantB).cliente.findMany()
      expect(deB.every((c) => c.tenantId === tenantB)).toBe(true)
    }
  })

  it('el cliente sin extender no ve nada: falla cerrado', async () => {
    expect(await prismaBase.cliente.findMany()).toHaveLength(0)
  })

  it('rechaza crear con el tenant_id de otro', async () => {
    await expect(
      prismaParaTenant(tenantA).cliente.create({
        data: { nombre: 'Infiltrado', tenantId: tenantB },
      }),
    ).rejects.toThrow()
  })
})
