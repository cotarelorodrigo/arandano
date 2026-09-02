import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

// Import DINÁMICO: `lib/ventas/buscar.ts` arrastra `lib/tenant/prisma.ts`, que
// arrastra `lib/db.ts`, que construye su Pool de pg AL IMPORTARSE leyendo
// DATABASE_URL — no seteada globalmente en el repo. Mismo patrón que
// test/unidades.test.ts y test/ventas.test.ts.
let buscarArticulosVendibles: typeof import('@/lib/ventas/buscar').buscarArticulosVendibles
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant
let unidadesLibres: typeof import('@/lib/inventario/unidades').unidadesLibres
let prenderSerie: typeof import('@/lib/inventario/unidades').prenderSerie
let desactivarArticulo: typeof import('@/lib/inventario/articulos').desactivarArticulo

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
// Correlativo local para `numero`, que en la base real lo asigna
// `proximoNumero` — acá se inserta directo por Prisma, así que hace falta un
// valor único por venta a mano. Mismo patrón que test/unidades.test.ts.
let siguienteNumero = 1

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ buscarArticulosVendibles } = await import('@/lib/ventas/buscar'))
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ unidadesLibres, prenderSerie } = await import('@/lib/inventario/unidades'))
  ;({ desactivarArticulo } = await import('@/lib/inventario/articulos'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `buscar-imei-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, 'duenio@buscar-imei.test')
})

afterAll(async () => {
  await owner.end()
})

/** Inserta un artículo PRODUCTO con el stock y precio dados. Firma posicional
 *  propia de este archivo — mismo patrón que el describe de unidades de
 *  test/ventas.test.ts, que tampoco reusa `crearArticulo` de
 *  lib/inventario/articulos.ts porque esa pide tenantId/usuarioId. */
async function crearArticulo(nombre: string, stock: string, precio: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.create({
      data: {
        tenantId,
        sku: `SKU-${crypto.randomUUID()}`,
        nombre,
        tipo: 'PRODUCTO',
        precio: d(precio),
        stock: d(stock),
      },
    }),
  )
}

/** Un artículo que YA lleva serie, con una unidad libre por cada IMEI de la
 *  lista. Pasa por el camino real (`prenderSerie`) y no por SQL a mano: así
 *  además de fixture confirma que ese camino deja el artículo en el estado que
 *  estos tests dan por sentado. */
async function crearArticuloConSerie(nombre: string, imeis: string[], precio: string) {
  const a = await crearArticulo(nombre, imeis.length.toString(), precio)
  await prenderSerie({ tenantId, articuloId: a.id, imeis, usuarioId })
  return a
}

/** Arma una venta mínima a la que apuntar. Mismo patrón que
 *  test/unidades.test.ts. */
async function crearVenta() {
  const numero = siguienteNumero++
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.venta.create({
      data: { tenantId, numero, usuarioId, total: d('0') },
    }),
  )
}

/** Deja una unidad vendida: le cuelga una venta, que es lo que la saca de la
 *  vitrina (`ventaId === null` es parte de la definición de "libre"). */
async function marcarVendida(unidadId: string) {
  const venta = await crearVenta()
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.update({
      where: { id: unidadId },
      data: { ventaId: venta.id },
    }),
  )
}

describe('buscarArticulosVendibles: búsqueda por IMEI', () => {
  it('escanear un IMEI devuelve el artículo con esa unidad ya elegida', async () => {
    const a = await crearArticuloConSerie('iPhone 13', ['355123456789012'], '500000')
    const [r] = await buscarArticulosVendibles(tenantId, '355123456789012')
    expect(r?.id).toBe(a.id)
    expect(r?.unidad?.imei).toBe('355123456789012')
  })

  it('el match del IMEI es EXACTO: un prefijo no trae media vitrina', async () => {
    // Con `contains`, tipear "355" traería todas las unidades del local, y el
    // índice no se podría usar. Un IMEI se escanea entero.
    await crearArticuloConSerie('iPhone 14', ['355999888777666'], '500000')
    expect(await buscarArticulosVendibles(tenantId, '355')).toHaveLength(0)
  })

  it('un IMEI ya vendido NO lo encuentra: no está en la vitrina', async () => {
    const a = await crearArticuloConSerie('iPhone 15', ['111222333444555'], '500000')
    const [u] = await unidadesLibres(tenantId, a.id)
    await marcarVendida(u!.id)
    expect(await buscarArticulosVendibles(tenantId, '111222333444555')).toHaveLength(0)
  })

  // Rider de Task 6: el `where` de la búsqueda por IMEI excluye
  // `articulo: { desactivadoEn: null }`, pero eso nunca se probó. Sin este
  // caso, un futuro cambio que borre esa condición pasaría en silencio y el
  // mostrador podría agregar al carrito un artículo invendible — que el motor
  // rechaza recién al cobrar, con ARTICULO_DESACTIVADO, con el cliente ya en
  // la caja.
  it('el IMEI de una unidad libre de un artículo DESACTIVADO no encuentra nada', async () => {
    const a = await crearArticuloConSerie('iPhone 16', ['222333444555666'], '500000')
    await desactivarArticulo({ tenantId, articuloId: a.id })
    expect(await buscarArticulosVendibles(tenantId, '222333444555666')).toHaveLength(0)
  })

  it('buscar por nombre sigue funcionando y marca llevaSerie', async () => {
    const a = await crearArticuloConSerie('iPhone 12 azul', ['999888777666555'], '500000')
    const [r] = await buscarArticulosVendibles(tenantId, 'iPhone 12 azul')
    expect(r?.id).toBe(a.id)
    expect(r?.llevaSerie).toBe(true)
    // Sin escaneo NO hay unidad elegida: el carrito la tiene que pedir.
    expect(r?.unidad).toBeUndefined()
  })

  it('un artículo sin serie sale con llevaSerie en false y sin unidad', async () => {
    await crearArticulo('Funda transparente', '5', '10000')
    const [r] = await buscarArticulosVendibles(tenantId, 'Funda transparente')
    expect(r?.llevaSerie).toBe(false)
    expect(r?.unidad).toBeUndefined()
  })

  it('EL BOT NO VE IMEIS: con porPalabras, un IMEI no encuentra nada', async () => {
    // La defensa no es el prompt del agente: es que no hay camino de código.
    // `lib/bot/catalogo.ts` llama con porPalabras y nunca sin él.
    await crearArticuloConSerie('iPhone 11', ['123456789012345'], '500000')
    expect(
      await buscarArticulosVendibles(tenantId, '123456789012345', { porPalabras: true }),
    ).toHaveLength(0)
  })
})
