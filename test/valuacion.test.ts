import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
// Mismo patrón que test/inventario.test.ts y test/ventas.test.ts.
let ingresarStock: typeof import('@/lib/inventario/stock').ingresarStock
let desactivarArticulo: typeof import('@/lib/inventario/articulos').desactivarArticulo
let prismaParaTenant: typeof import('@/lib/tenant/prisma').prismaParaTenant
let valuacionDelTenant: typeof import('@/lib/inventario/valuacion').valuacionDelTenant

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client

/**
 * Un tenant nuevo con su usuario. **Cada caso usa el suyo**, sin excepción:
 * `valuacionDelTenant` suma TODO el catálogo, así que dos casos que compartan
 * tenant se rompen entre sí y un caso nuevo rompe a los viejos sin tocarlos.
 */
async function localNuevo(): Promise<{ tenantId: string; usuarioId: string }> {
  const tenantId = await crearTenant(owner, `valuacion-${crypto.randomUUID()}`)
  const { rows } = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor', $2, 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId, `v-${crypto.randomUUID()}@val.test`],
  )
  return { tenantId, usuarioId: rows[0].id }
}

/** Un artículo con SQL crudo contra el owner: este archivo prueba la LECTURA,
 *  no el alta, y `crearArticulo` arrastraría categorías, SKU y unidades que no
 *  tienen nada que ver con lo que se está midiendo. */
async function crearArticulo(
  tenantId: string,
  nombre: string,
  opciones: { tipo?: 'PRODUCTO' | 'SERVICIO'; moneda?: 'ARS' | 'USD' } = {},
): Promise<string> {
  const { tipo = 'PRODUCTO', moneda = 'ARS' } = opciones
  const { rows } = await owner.query(
    `INSERT INTO articulos
       (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 1000.00, $5, 0, now(), now())
     RETURNING id`,
    [tenantId, `SKU-${crypto.randomUUID()}`, nombre, tipo, moneda],
  )
  return rows[0].id
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ ingresarStock } = await import('@/lib/inventario/stock'))
  ;({ desactivarArticulo } = await import('@/lib/inventario/articulos'))
  ;({ prismaParaTenant } = await import('@/lib/tenant/prisma'))
  ;({ valuacionDelTenant } = await import('@/lib/inventario/valuacion'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
})

afterAll(async () => {
  await owner.end()
})

describe('valuacionDelTenant', () => {
  it('suma stock por último costo, elige el MÁS RECIENTE y cuenta los que no tienen', async () => {
    const { tenantId, usuarioId } = await localNuevo()

    const remera = await crearArticulo(tenantId, 'Remera')
    // Dos ingresos a costos distintos: el total tiene que salir del SEGUNDO.
    // Con el orden invertido daría 200.000 en vez de 90.000.
    await ingresarStock({
      tenantId, articuloId: remera, cantidad: d('10'), usuarioId, costoUnitario: d('2000'),
    })
    await ingresarStock({
      tenantId, articuloId: remera, cantidad: d('10'), usuarioId, costoUnitario: d('3000'),
    })
    // Un ingreso SIN costo no borra lo que se sabía: sigue valiendo 3.000.
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('10'), usuarioId })

    // Con mercadería y sin ningún costo: no suma, pero se cuenta.
    const funda = await crearArticulo(tenantId, 'Funda')
    await ingresarStock({ tenantId, articuloId: funda, cantidad: d('5'), usuarioId })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))

    // 30 unidades × $ 3.000
    expect(total.toString()).toBe('90000')
    expect(sinCosto).toBe(1)
  })

  it('un artículo en dólares entra igual: el costo está en pesos para todos', async () => {
    const { tenantId, usuarioId } = await localNuevo()
    const iphone = await crearArticulo(tenantId, 'iPhone', { moneda: 'USD' })
    await ingresarStock({
      tenantId, articuloId: iphone, cantidad: d('2'), usuarioId, costoUnitario: d('500000'),
    })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(total.toString()).toBe('1000000')
    expect(sinCosto).toBe(0)
  })

  it('un artículo desactivado no suma ni cuenta como faltante', async () => {
    const { tenantId, usuarioId } = await localNuevo()

    const conCosto = await crearArticulo(tenantId, 'Cargador viejo')
    await ingresarStock({
      tenantId, articuloId: conCosto, cantidad: d('4'), usuarioId, costoUnitario: d('1000'),
    })
    const sinCostoCargado = await crearArticulo(tenantId, 'Cable viejo')
    await ingresarStock({ tenantId, articuloId: sinCostoCargado, cantidad: d('3'), usuarioId })

    await desactivarArticulo({ tenantId, articuloId: conCosto })
    await desactivarArticulo({ tenantId, articuloId: sinCostoCargado })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(total.toString()).toBe('0')
    expect(sinCosto).toBe(0)
  })

  it('un servicio no suma ni cuenta: no tiene stock', async () => {
    const { tenantId } = await localNuevo()
    await crearArticulo(tenantId, 'Arreglo', { tipo: 'SERVICIO' })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(total.toString()).toBe('0')
    expect(sinCosto).toBe(0)
  })

  // El conteo dice cuántos artículos DISTORSIONAN el total. Uno sin mercadería
  // no distorsiona nada: contarlo inflaría el aviso con artículos que aportan
  // cero de todos modos.
  it('un artículo sin costo y sin stock no entra al conteo de faltantes', async () => {
    const { tenantId } = await localNuevo()
    await crearArticulo(tenantId, 'Sin nada')

    const { sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(sinCosto).toBe(0)
  })

  it('un stock negativo cuenta como cero y no le resta al total del local', async () => {
    const { tenantId, usuarioId } = await localNuevo()

    const bien = await crearArticulo(tenantId, 'Vidrio')
    await ingresarStock({
      tenantId, articuloId: bien, cantidad: d('10'), usuarioId, costoUnitario: d('1000'),
    })
    const roto = await crearArticulo(tenantId, 'Funda mal cargada')
    await ingresarStock({
      tenantId, articuloId: roto, cantidad: d('1'), usuarioId, costoUnitario: d('5000'),
    })
    // El stock negativo se fuerza con el owner: no hay camino de aplicación
    // que lo produzca sin cobrar una venta entera.
    await owner.query(`UPDATE articulos SET stock = -2 WHERE id = $1`, [roto])

    const { total } = await valuacionDelTenant(prismaParaTenant(tenantId))
    // 10 × 1.000, y el negativo aporta CERO — no −10.000.
    expect(total.toString()).toBe('10000')
  })
})
