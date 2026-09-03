import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

// Import DINÁMICO: `lib/tenant/transaccion.ts` arrastra `lib/db.ts`, que
// construye su Pool de pg AL IMPORTARSE leyendo DATABASE_URL — no seteada
// globalmente en el repo. Mismo patrón que test/schema-usd.test.ts.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant
let unidadesLibres: typeof import('@/lib/inventario/unidades').unidadesLibres

let owner: Client
let tenantId: string
let usuarioId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ unidadesLibres } = await import('@/lib/inventario/unidades'))
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `unidades-schema-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, 'duenio@unidades-schema.test')
})

afterAll(async () => {
  await owner.end()
})

async function crearArticulo(nombre: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.create({
      data: {
        tenantId,
        sku: `SKU-${crypto.randomUUID()}`,
        nombre,
        tipo: 'PRODUCTO',
        precio: new Prisma.Decimal('1000'),
      },
    }),
  )
}

async function crearUnidad(articuloId: string, imei: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.create({
      data: { tenantId, articuloId, imei, ingresadaPorId: usuarioId },
    }),
  )
}

describe('schema de unidades', () => {
  it('un artículo nace sin serie: el default de lleva_serie es false', async () => {
    const a = await crearArticulo('Funda genérica')
    expect(a.llevaSerie).toBe(false)
  })

  it('una unidad nace libre: sin venta y sin baja', async () => {
    const a = await crearArticulo('iPhone 13')
    const u = await crearUnidad(a.id, `IMEI-${crypto.randomUUID()}`)
    expect(u.ventaId).toBeNull()
    expect(u.bajaEn).toBeNull()
  })

  it('dos unidades LIBRES con el mismo IMEI chocan contra el índice parcial', async () => {
    const a = await crearArticulo('iPhone 14')
    const imei = `IMEI-${crypto.randomUUID()}`
    await crearUnidad(a.id, imei)
    await expect(crearUnidad(a.id, imei)).rejects.toThrow()
  })

  it('el mismo IMEI vuelve a entrar si la unidad anterior ya salió', async () => {
    // El caso real: el local recompra el equipo que vendió. Dos filas con el
    // mismo IMEI en el historial son el mismo teléfono pasando dos veces.
    const a = await crearArticulo('iPhone 15')
    const imei = `IMEI-${crypto.randomUUID()}`
    const vieja = await crearUnidad(a.id, imei)
    await enTransaccionDeTenant(tenantId, (tx) =>
      tx.unidadDeArticulo.update({
        where: { id: vieja.id },
        data: { bajaEn: new Date(), bajaNota: 'se vendió afuera', bajaPorId: usuarioId },
      }),
    )
    const nueva = await crearUnidad(a.id, imei)
    expect(nueva.id).not.toBe(vieja.id)
  })

  it('el índice parcial existe en la base con la condición exacta', async () => {
    // Sin este caso, borrar el WHERE del índice dejaría los cuatro de arriba
    // en verde salvo uno, y la regresión sería justo la que más cuesta: el
    // local no podría recomprar un equipo que vendió.
    const { rows } = await owner.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'unidades_articulo'
          AND indexname = 'unidades_articulo_imei_libre'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].indexdef).toContain('venta_id IS NULL')
    expect(rows[0].indexdef).toContain('baja_en IS NULL')
  })

  it('una unidad puede nacer sin IMEI', async () => {
    const a = await crearArticulo('iPhone sin identificar')
    const u = await enTransaccionDeTenant(tenantId, (tx) =>
      tx.unidadDeArticulo.create({
        data: { tenantId, articuloId: a.id, ingresadaPorId: usuarioId },
      }),
    )
    expect(u.imei).toBeNull()
  })

  it('MUCHAS unidades sin identificar conviven: los NULL no chocan entre sí', async () => {
    // Es la propiedad de la que depende todo el ciclo. Si alguien "arreglara" el
    // índice agregándole AND imei IS NOT NULL creyendo que hace falta, este caso
    // seguiría pasando — por eso abajo va también la mitad que sí discrimina.
    const a = await crearArticulo('iPhone 13 lote')
    for (let i = 0; i < 5; i++) {
      await enTransaccionDeTenant(tenantId, (tx) =>
        tx.unidadDeArticulo.create({
          data: { tenantId, articuloId: a.id, ingresadaPorId: usuarioId },
        }),
      )
    }
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(5)
  })

  it('y el índice SIGUE frenando dos libres con el mismo IMEI real', async () => {
    const a = await crearArticulo('iPhone 14 lote')
    const imei = `IMEI-${crypto.randomUUID()}`
    await crearUnidad(a.id, imei)
    await expect(crearUnidad(a.id, imei)).rejects.toThrow()
  })
})
