import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

// Import DINÁMICO: `lib/tenant/transaccion.ts` arrastra `lib/db.ts`, que
// construye su Pool de pg AL IMPORTARSE leyendo DATABASE_URL — no seteada
// globalmente en el repo. Mismo patrón que test/ventas.test.ts.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
// Correlativo local para `numero`, que en la base real lo asigna
// `proximoNumero` — acá se inserta directo por Prisma, así que hace falta
// un valor único por venta a mano.
let siguienteNumero = 1

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `schema-usd-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, 'duenio@schema-usd.test')
})

afterAll(async () => {
  await owner.end()
})

/** Inserta un artículo por Prisma SIN pasar `moneda` — es exactamente lo que
 *  prueba el default de la columna nueva. */
async function crearArticuloCrudo(datos: { nombre: string; precio: string }) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.create({
      data: {
        tenantId,
        sku: `SKU-${crypto.randomUUID()}`,
        nombre: datos.nombre,
        tipo: 'PRODUCTO',
        precio: d(datos.precio),
      },
    }),
  )
}

/** Inserta una venta por Prisma SIN pasar `totalUsd`. */
async function crearVentaCruda(datos: { total: string }) {
  const numero = siguienteNumero++
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.venta.create({
      data: {
        tenantId,
        numero,
        usuarioId,
        total: d(datos.total),
      },
    }),
  )
}

/** Inserta un pago por Prisma SIN pasar `cubre`. Necesita una venta a la que
 *  colgarse: se crea una nueva en cada llamado para no compartir estado entre
 *  casos. */
async function crearPagoCrudo(datos: { monto: string; moneda: 'ARS' | 'USD'; cotizacion: string }) {
  const venta = await crearVentaCruda({ total: datos.monto })
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.pago.create({
      data: {
        tenantId,
        ventaId: venta.id,
        medio: 'EFECTIVO',
        moneda: datos.moneda,
        monto: d(datos.monto),
        cotizacion: d(datos.cotizacion),
      },
    }),
  )
}

describe('las columnas de moneda nacen con default', () => {
  it('un artículo creado sin moneda queda en ARS', async () => {
    const a = await crearArticuloCrudo({ nombre: 'Funda', precio: '15000' })
    expect(a.moneda).toBe('ARS')
  })

  it('una venta creada sin totalUsd queda en 0', async () => {
    const v = await crearVentaCruda({ total: '15000' })
    expect(v.totalUsd.toString()).toBe('0')
  })

  it('un pago creado sin cubre queda en ARS', async () => {
    const p = await crearPagoCrudo({ monto: '15000', moneda: 'ARS', cotizacion: '1' })
    expect(p.cubre).toBe('ARS')
  })
})

describe('la moneda del costo nace con default (ciclo del costo en dólares)', () => {
  // Las filas de `movimientos_stock` anteriores a la columna son todas pesos
  // —el costo era pesos por construcción—, y el default las describe sin
  // backfill. Si alguien cambiara el default (o lo sacara y dejara la columna
  // nullable), todo costo viejo pasaría a leerse en otra moneda o en ninguna.
  it('un movimiento creado sin monedaCosto queda en ARS', async () => {
    const a = await crearArticuloCrudo({ nombre: 'Cargador', precio: '9000' })
    const m = await enTransaccionDeTenant(tenantId, (tx) =>
      tx.movimientoStock.create({
        data: {
          tenantId,
          articuloId: a.id,
          delta: d('3'),
          motivo: 'INGRESO',
          costoUnitario: d('4500'),
          usuarioId,
        },
      }),
    )
    expect(m.monedaCosto).toBe('ARS')
  })
})
