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

/** Crea un cliente sin pasar tenantId: lo completa la extensión en runtime.
 *  El tipo generado exige tenantId (o la relación `tenant`) porque no tiene
 *  default en el schema, así que esto es un @ts-expect-error deliberado y
 *  centralizado acá para no repetirlo en cada test. */
function crearCliente(tenantId: string, nombre: string) {
  // @ts-expect-error ver el comentario de la función.
  return prismaParaTenant(tenantId).cliente.create({ data: { nombre } })
}

describe('prismaParaTenant', () => {
  it('autocompleta tenant_id al crear', async () => {
    const cliente = await crearCliente(tenantA, 'Sin tenant explícito')
    expect(cliente.tenantId).toBe(tenantA)
  })

  it('no devuelve filas de otro tenant', async () => {
    await crearCliente(tenantB, 'De B')
    const deA = await prismaParaTenant(tenantA).cliente.findMany()
    expect(deA.map((c) => c.nombre)).not.toContain('De B')
  })

  it('no se contamina entre operaciones consecutivas sobre el mismo pool', async () => {
    // Este es el test que atrapa el bug que arruinaría todo lo demás: si la GUC
    // sobreviviera a la transacción, la segunda llamada leería con el tenant de
    // la primera. PERO: como es secuencial (un `await` por vez), nunca hay dos
    // operaciones en vuelo — así que en realidad no distingue esta
    // implementación de la variante "clásica" rota (set_config a nivel de
    // sesión + $executeRaw suelto sin transacción), porque cada llamada vuelve
    // a fijar su propia GUC antes de leer. El test que sí atrapa esa variante
    // es el siguiente, con concurrencia real.
    for (let i = 0; i < 10; i++) {
      const deA = await prismaParaTenant(tenantA).cliente.findMany()
      expect(deA.every((c) => c.tenantId === tenantA)).toBe(true)
      const deB = await prismaParaTenant(tenantB).cliente.findMany()
      expect(deB.every((c) => c.tenantId === tenantB)).toBe(true)
    }
  })

  it('no se contamina entre operaciones CONCURRENTES sobre el mismo pool', async () => {
    // Este es el que de verdad prueba que set_config y la query comparten
    // transacción (y por lo tanto conexión). Disparamos más operaciones en
    // simultáneo (20) que conexiones tiene el pool (5, ver lib/db.ts), para
    // forzar que Postgres entregue conexiones recién liberadas por OTRA
    // operación mientras varias siguen en vuelo. Con set_config a nivel de
    // sesión (en vez de local a la transacción) y un $executeRaw suelto en vez
    // de un $transaction([...]) atómico, la query real de un tenant puede
    // caer en una conexión que otro tenant concurrente acaba de reconfigurar
    // — y este test lo detecta porque cada create() devuelve el tenantId con
    // el que Postgres efectivamente insertó la fila.
    const operaciones = Array.from({ length: 20 }, async (_, i) => {
      const tenantId = i % 2 === 0 ? tenantA : tenantB
      const cliente = await crearCliente(tenantId, `concurrente-${i}`)
      return { tenantId, cliente }
    })
    const resultados = await Promise.all(operaciones)
    for (const { tenantId, cliente } of resultados) {
      expect(cliente.tenantId).toBe(tenantId)
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

  it('rechaza $transaction(fn) interactivo: la atomicidad no está soportada todavía', () => {
    // Sin este guard, el uso se "resuelve" en silencio con atomicidad falsa
    // (ver el JSDoc de prismaParaTenant): las operaciones de `tx` correrían
    // en un batch DISTINTO al de esta transacción interactiva. El guard tira
    // sincrónicamente, así que se prueba con toThrow, no con rejects.
    expect(() =>
      // El guard tipa $transaction como (...args: unknown[]) => unknown —
      // a propósito, para no fingir que soporta la forma interactiva — así
      // que acá "tx" no tiene tipo inferible; no importa, nunca llega a
      // ejecutarse.
      prismaParaTenant(tenantA).$transaction(async (tx: { cliente: { findMany: () => unknown } }) => {
        await tx.cliente.findMany()
      }),
    ).toThrow(/\$transaction\(fn\)/)
  })
})
