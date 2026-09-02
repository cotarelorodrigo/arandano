import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

// Import DINÁMICO: `lib/tenant/transaccion.ts` arrastra `lib/db.ts`, que
// construye su Pool de pg AL IMPORTARSE leyendo DATABASE_URL — no seteada
// globalmente en el repo. Mismo patrón que test/schema-unidades.test.ts.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant
let normalizarImei: typeof import('@/lib/inventario/unidades').normalizarImei
let unidadesLibres: typeof import('@/lib/inventario/unidades').unidadesLibres
let prenderSerie: typeof import('@/lib/inventario/unidades').prenderSerie
let apagarSerie: typeof import('@/lib/inventario/unidades').apagarSerie
let crearUnidadesEnTx: typeof import('@/lib/inventario/unidades').crearUnidadesEnTx

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
// Correlativo local para `numero`, que en la base real lo asigna
// `proximoNumero` — acá se inserta directo por Prisma, así que hace falta un
// valor único por venta a mano. Mismo patrón que test/schema-usd.test.ts.
let siguienteNumero = 1

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ normalizarImei, unidadesLibres, prenderSerie, apagarSerie, crearUnidadesEnTx } =
    await import('@/lib/inventario/unidades'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `unidades-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, 'duenio@unidades.test')
})

afterAll(async () => {
  await owner.end()
})

/** Inserta un artículo PRODUCTO con el stock dado. */
async function crearArticulo(nombre: string, stock: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.create({
      data: {
        tenantId,
        sku: `SKU-${crypto.randomUUID()}`,
        nombre,
        tipo: 'PRODUCTO',
        precio: d('1000'),
        stock: d(stock),
      },
    }),
  )
}

/** Inserta un artículo SERVICIO, que no lleva stock ni unidades. */
async function crearServicio(nombre: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.create({
      data: {
        tenantId,
        sku: `SKU-${crypto.randomUUID()}`,
        nombre,
        tipo: 'SERVICIO',
        precio: d('1000'),
      },
    }),
  )
}

async function leerArticulo(articuloId: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.findUniqueOrThrow({ where: { id: articuloId } }),
  )
}

async function contarMovimientos(articuloId: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.movimientoStock.count({ where: { articuloId } }),
  )
}

/** Arma una venta mínima a la que apuntar, igual que test/schema-usd.test.ts. */
async function crearVenta() {
  const numero = siguienteNumero++
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.venta.create({
      data: { tenantId, numero, usuarioId, total: d('0') },
    }),
  )
}

async function marcarVendida(unidadId: string) {
  const venta = await crearVenta()
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.update({
      where: { id: unidadId },
      data: { ventaId: venta.id },
    }),
  )
}

async function marcarDadaDeBaja(unidadId: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.update({
      where: { id: unidadId },
      data: { bajaEn: new Date(), bajaNota: 'se rompió', bajaPorId: usuarioId },
    }),
  )
}

describe('normalizarImei', () => {
  it('recorta espacios de los bordes', () => {
    expect(normalizarImei('  355123456789012  ')).toBe('355123456789012')
  })

  it('colapsa los espacios internos, que es como sale de un lector', () => {
    expect(normalizarImei('3551 2345 6789 012')).toBe('355123456789012')
  })

  it('NO exige quince dígitos: el mismo campo es el número de serie de otro rubro', () => {
    // Un IMEI de celular tiene quince dígitos; el número de serie de una
    // notebook tiene letras. Validar la forma del IMEI cerraría la puerta a la
    // generalización que el pedido original nombra.
    expect(normalizarImei('SN-A45-9931')).toBe('SN-A45-9931')
  })

  it('un IMEI vacío o de puros espacios se rechaza', () => {
    expect(() => normalizarImei('   ')).toThrow(
      expect.objectContaining({ codigo: 'IMEI_VACIO' }),
    )
  })
})

describe('prenderSerie', () => {
  it('con stock 0 prende sin pedir ningún IMEI', async () => {
    const a = await crearArticulo('Cargador', '0')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId })
    const despues = await leerArticulo(a.id)
    expect(despues.llevaSerie).toBe(true)
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(0)
  })

  it('con stock 3 exige exactamente 3 IMEI y crea las 3 unidades', async () => {
    const a = await crearArticulo('iPhone 13', '3')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['A1', 'A2', 'A3'], usuarioId })
    const libres = await unidadesLibres(tenantId, a.id)
    expect(libres.map((u) => u.imei).sort()).toEqual(['A1', 'A2', 'A3'])
  })

  it('con stock 3 y 2 IMEI se rechaza y no crea ninguna unidad', async () => {
    const a = await crearArticulo('iPhone 14', '3')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: ['B1', 'B2'], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_CONTEO_NO_COINCIDE' }))
    // La transacción entera se rollbackea: ni media unidad queda.
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(0)
    expect((await leerArticulo(a.id)).llevaSerie).toBe(false)
  })

  it('NO toca el stock: prender no es un movimiento del inventario', async () => {
    const a = await crearArticulo('iPhone 15', '2')
    const movimientosAntes = await contarMovimientos(a.id)
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['C1', 'C2'], usuarioId })
    expect((await leerArticulo(a.id)).stock.toString()).toBe('2')
    expect(await contarMovimientos(a.id)).toBe(movimientosAntes)
  })

  it('rechaza un stock fraccionario: medio iPhone no existe', async () => {
    const a = await crearArticulo('Harina', '2.5')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: ['D1', 'D2'], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_STOCK_NO_ENTERO' }))
  })

  it('rechaza un stock negativo: "-2 unidades libres" no se puede construir', async () => {
    // El motor permite stock negativo a propósito (vender no valida que
    // alcance), así que este caso llega de verdad.
    const a = await crearArticulo('Vidrio templado', '-2')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_STOCK_NO_ENTERO' }))
  })

  it('rechaza dos IMEI iguales en la misma lista', async () => {
    const a = await crearArticulo('iPhone 12', '2')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: ['E1', 'E1'], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEI_REPETIDO' }))
  })

  it('rechaza prender lo que ya está prendido', async () => {
    const a = await crearArticulo('iPhone 11', '0')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId })
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_YA_PRENDIDA' }))
  })

  it('rechaza un servicio: un servicio no lleva stock ni unidades', async () => {
    const s = await crearServicio('Cambio de módulo')
    await expect(
      prenderSerie({ tenantId, articuloId: s.id, imeis: [], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERVICIO_SIN_STOCK' }))
  })
})

describe('apagarSerie', () => {
  it('apaga cuando no quedan unidades libres', async () => {
    const a = await crearArticulo('Cable USB', '0')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId })
    await apagarSerie({ tenantId, articuloId: a.id })
    expect((await leerArticulo(a.id)).llevaSerie).toBe(false)
  })

  it('rechaza apagar con unidades libres: cinco identidades no se vuelven un 5', async () => {
    const a = await crearArticulo('iPhone SE', '1')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['F1'], usuarioId })
    await expect(apagarSerie({ tenantId, articuloId: a.id })).rejects.toThrow(
      expect.objectContaining({ codigo: 'SERIE_CON_UNIDADES_LIBRES' }),
    )
  })
})

describe('unidadesLibres', () => {
  it('no devuelve las vendidas ni las dadas de baja', async () => {
    const a = await crearArticulo('iPhone X', '3')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['G1', 'G2', 'G3'], usuarioId })
    const [g1, g2] = await unidadesLibres(tenantId, a.id)
    await marcarVendida(g1.id)
    await marcarDadaDeBaja(g2.id)
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['G3'])
  })

  it('dentro de UNA tanda, con timestamp idéntico, desempata por id (uuid v7)', async () => {
    // `ingresadaEn` sale de CURRENT_TIMESTAMP, que en Postgres es la hora de
    // INICIO de la transacción: las tres unidades de este único
    // `prenderSerie` comparten el mismo valor exacto, así que si el resultado
    // sale ['H1', 'H2', 'H3'] es porque el `id` (uuid v7, time-ordered) las
    // desempató en el orden real de inserción — no porque el orden por
    // timestamp ya las distinguiera.
    const a = await crearArticulo('iPhone XR', '3')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['H1', 'H2', 'H3'], usuarioId })
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['H1', 'H2', 'H3'])
  })

  it('entre DOS tandas, la primera sigue antes de la segunda', async () => {
    // Simula el caso real de un artículo ya prendido que recibe una entrada
    // de mercadería posterior (`ingresarStock`, Task 3): dos transacciones
    // separadas, cada una con su propia hora de inicio, así que acá el
    // criterio que ordena es `ingresadaEn` y no el desempate por `id`.
    const a = await crearArticulo('iPhone 12 mini', '1')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['I1'], usuarioId })
    await enTransaccionDeTenant(tenantId, (tx) =>
      crearUnidadesEnTx(tx, { tenantId, articuloId: a.id, imeis: ['I2'], usuarioId }),
    )
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['I1', 'I2'])
  })
})
