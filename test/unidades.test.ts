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
let normalizarLista: typeof import('@/lib/inventario/unidades').normalizarLista
let unidadesLibres: typeof import('@/lib/inventario/unidades').unidadesLibres
let prenderSerie: typeof import('@/lib/inventario/unidades').prenderSerie
let apagarSerie: typeof import('@/lib/inventario/unidades').apagarSerie
let crearUnidadesEnTx: typeof import('@/lib/inventario/unidades').crearUnidadesEnTx
let identificarUnidad: typeof import('@/lib/inventario/unidades').identificarUnidad
let darDeBajaUnidad: typeof import('@/lib/inventario/stock').darDeBajaUnidad
let ingresarStock: typeof import('@/lib/inventario/stock').ingresarStock
// El motor de ventas, para la secuencia del hallazgo C1 (vender → apagar →
// anular → prender). Con nombre distinto del helper local `crearVenta` de más
// abajo, que arma una fila de venta pelada a la que apuntar y no ejercita
// ninguna regla.
let crearVentaDelMotor: typeof import('@/lib/ventas/crear').crearVenta
let anularVenta: typeof import('@/lib/ventas/anular').anularVenta

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
// Correlativo local para `numero`, que en la base real lo asigna
// `proximoNumero` — acá se inserta directo por Prisma, así que hace falta un
// valor único por venta a mano. Mismo patrón que test/schema-usd.test.ts.
// Arranca ALTO a propósito: desde que este archivo también crea ventas con el
// motor real (la secuencia del hallazgo C1), `proximoNumero` reparte los
// números desde 1 sobre el mismo tenant, y un correlativo local que arrancara
// ahí chocaría contra `@@unique([tenantId, numero])`.
let siguienteNumero = 1_000_000

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({
    normalizarImei, normalizarLista, unidadesLibres, prenderSerie, apagarSerie, crearUnidadesEnTx,
    identificarUnidad,
  } = await import('@/lib/inventario/unidades'))
  ;({ darDeBajaUnidad, ingresarStock } = await import('@/lib/inventario/stock'))
  ;({ crearVenta: crearVentaDelMotor } = await import('@/lib/ventas/crear'))
  ;({ anularVenta } = await import('@/lib/ventas/anular'))

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

/** Un artículo que YA lleva serie, con una unidad libre IDENTIFICADA por cada
 *  IMEI de la lista. Ya NO pasa por `prenderSerie` —que desde este ciclo no
 *  acepta ningún IMEI puntual, sólo crea unidades sin identificar—, así que
 *  arma el mismo estado con la pieza que `prenderSerie` usa por dentro:
 *  `crearUnidadesEnTx` más el `llevaSerie: true` que dejaría el switch. */
async function crearArticuloConSerie(nombre: string, imeis: string[]) {
  const a = await crearArticulo(nombre, imeis.length.toString())
  await enTransaccionDeTenant(tenantId, async (tx) => {
    await crearUnidadesEnTx(tx, { tenantId, articuloId: a.id, imeis, usuarioId })
    await tx.articulo.update({ where: { id: a.id }, data: { llevaSerie: true } })
  })
  return a
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

/** Los movimientos de un artículo, tal como quedaron. */
async function movimientosDe(articuloId: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.movimientoStock.findMany({ where: { articuloId } }),
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

async function leerUnidad(unidadId: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.findUniqueOrThrow({ where: { id: unidadId } }),
  )
}

/** Inserta una unidad libre "suelta", sin pasar por `crearUnidadesEnTx`: sirve
 *  para simular a mano el estado huérfano del hallazgo C1 (una unidad libre en
 *  un artículo cuyo switch está apagado) sin recorrer todo el camino real de
 *  vender, apagar y anular. */
async function crearUnidadSuelta(articuloId: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.create({
      data: { tenantId, articuloId, ingresadaPorId: usuarioId },
    }),
  )
}

/** Da de baja TODAS las unidades libres del artículo y apaga el switch: el
 *  atajo de "me arrepentí, todavía no cargué nada" sin pasar por el flujo
 *  completo de vender y anular una venta. */
async function apagarSerieForzado(articuloId: string) {
  const libres = await unidadesLibres(tenantId, articuloId)
  for (const libre of libres) {
    await darDeBajaUnidad({ tenantId, unidadId: libre.id, usuarioId, nota: 'forzado por el test' })
  }
  await apagarSerie({ tenantId, articuloId })
}

/** Un artículo con MÁS unidades libres que stock: el estado huérfano al que
 *  `prenderSerie` no le puede responder con una cantidad no negativa de
 *  unidades a crear. */
async function crearArticuloConLibresDeMas() {
  const a = await crearArticulo('Vidrio templado libre', '1')
  await crearUnidadSuelta(a.id)
  await crearUnidadSuelta(a.id)
  return a
}

/** Vende la unidad por el motor real de ventas, para que quede atada a una
 *  venta viva (`ventaId` no nulo) y no sólo marcada a mano — es lo que hace
 *  que su IMEI tenga que quedar congelado. */
async function venderUnidad(articuloId: string, unidadId: string) {
  await crearVentaDelMotor({
    tenantId,
    usuarioId,
    items: [{ articuloId, cantidad: d('1'), unidadId }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
  })
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

describe('normalizarLista', () => {
  // `prenderSerie` ya no la llama (dejó de recibir `imeis` en este mismo
  // ciclo), así que sin este caso la rama de repetidos de `normalizarLista`
  // se queda sin ningún test que la ejercite: sus otros dos llamadores
  // (`crearArticulo` en lib/inventario/articulos.ts, `ingresarStock` en
  // lib/inventario/stock.ts) no tienen ninguno que pase una lista con un
  // repetido. Restaurado acá, sobre la función directamente, en vez de sobre
  // uno de esos dos llamadores: es donde vive la regla y donde menos
  // maquinaria hace falta para probarla.
  it('rechaza dos IMEI iguales en la misma lista', () => {
    expect(() => normalizarLista(['E1', 'E1'])).toThrow(
      expect.objectContaining({ codigo: 'IMEI_REPETIDO' }),
    )
  })

  it('normaliza cada elemento igual que normalizarImei', () => {
    expect(normalizarLista(['  355123456789012  ', 'SN-A45-9931'])).toEqual([
      '355123456789012',
      'SN-A45-9931',
    ])
  })
})

describe('prenderSerie', () => {
  it('con stock 0 prende sin crear ninguna unidad', async () => {
    const a = await crearArticulo('Cargador', '0')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const despues = await leerArticulo(a.id)
    expect(despues.llevaSerie).toBe(true)
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(0)
  })

  it('rechaza un stock fraccionario: medio iPhone no existe', async () => {
    const a = await crearArticulo('Harina', '2.5')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_STOCK_NO_ENTERO' }))
  })

  it('rechaza un stock negativo: "-2 unidades libres" no se puede construir', async () => {
    // El motor permite stock negativo a propósito (vender no valida que
    // alcance), así que este caso llega de verdad.
    const a = await crearArticulo('Vidrio templado', '-2')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_STOCK_NO_ENTERO' }))
  })

  it('rechaza prender lo que ya está prendido', async () => {
    const a = await crearArticulo('iPhone 11', '0')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_YA_PRENDIDA' }))
  })

  it('rechaza un servicio: un servicio no lleva stock ni unidades', async () => {
    const s = await crearServicio('Cambio de módulo')
    await expect(
      prenderSerie({ tenantId, articuloId: s.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERVICIO_SIN_STOCK' }))
  })

  // Hallazgo C1 de la review de rama del ciclo anterior. La secuencia entera,
  // con el motor real y no simulada, porque lo que la hace posible es cómo
  // interactúan tres funciones distintas: `apagarSerie` sólo mira las
  // unidades LIBRES, y una atada a una venta viva no lo es — así que vendido
  // todo el stock el switch se puede apagar; después `anularVenta` devuelve
  // esa unidad a la vitrina, y el artículo queda SIN serie y CON una unidad
  // libre.
  it('vender, apagar, anular y volver a prender REUSA la unidad en vez de duplicarla', async () => {
    const a = await crearArticuloConSerie('iPhone 13 devuelto', ['DEV1'])
    const [unidad] = await unidadesLibres(tenantId, a.id)
    const venta = await crearVentaDelMotor({
      tenantId,
      usuarioId,
      items: [{ articuloId: a.id, cantidad: d('1'), unidadId: unidad.id }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
    })
    // Con todo vendido no quedan libres, así que el switch se apaga.
    expect((await leerArticulo(a.id)).stock.toString()).toBe('0')
    await apagarSerie({ tenantId, articuloId: a.id })

    // El cliente devuelve el equipo: la unidad vuelve a la vitrina de un
    // artículo que ya no lleva serie.
    await anularVenta({ tenantId, ventaId: venta.id, usuarioId })
    expect((await leerArticulo(a.id)).llevaSerie).toBe(false)
    expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(1)

    // La unidad libre que quedó se cuenta y se reusa: `faltan` da 0 y prender
    // no crea nada nuevo — no hay ningún IMEI que pedir de nuevo.
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })

    const libres = await unidadesLibres(tenantId, a.id)
    expect(libres.map((u) => u.imei)).toEqual(['DEV1'])
    expect((await leerArticulo(a.id)).llevaSerie).toBe(true)
    // EL invariante del ciclo, dicho en un solo renglón.
    expect((await leerArticulo(a.id)).stock.toString()).toBe(String(libres.length))
  })
})

describe('prenderSerie sin IMEIs', () => {
  it('con stock 30 crea 30 unidades sin identificar y no pide nada', async () => {
    const a = await crearArticulo('iPhone 13', '30')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const libres = await unidadesLibres(tenantId, a.id)
    expect(libres).toHaveLength(30)
    expect(libres.every((u) => u.imei === null)).toBe(true)
    expect((await leerArticulo(a.id)).llevaSerie).toBe(true)
  })

  it('crea sólo la DIFERENCIA cuando ya hay unidades libres', async () => {
    // El caso que la review de rama del ciclo anterior encontró como C1: una
    // unidad vuelve por una anulación mientras el switch está apagado.
    const a = await crearArticulo('iPhone 14', '3')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    await apagarSerieForzado(a.id) // helper local: baja las 3 y apaga
    await ingresarStock({ tenantId, articuloId: a.id, cantidad: d('2'), usuarioId })
    await crearUnidadSuelta(a.id) // helper local: una libre, sin serie prendida
    // stock 2, libres 1 -> crea 1
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(2)
    expect((await leerArticulo(a.id)).stock.toString()).toBe('2')
  })

  it('NO toca el stock: prender sigue sin ser un movimiento', async () => {
    const a = await crearArticulo('iPhone 15', '4')
    const antes = await contarMovimientos(a.id)
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    expect((await leerArticulo(a.id)).stock.toString()).toBe('4')
    expect(await contarMovimientos(a.id)).toBe(antes)
  })

  it('rechaza si el stock quedó por DEBAJO de las unidades libres', async () => {
    // No se puede crear una cantidad negativa. La salida es dar de baja las
    // sobrantes desde la card, que ahora se muestra con el switch apagado.
    const a = await crearArticuloConLibresDeMas() // helper local
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_CONTEO_NO_COINCIDE' }))
  })
})

describe('apagarSerie', () => {
  it('apaga cuando no quedan unidades libres', async () => {
    const a = await crearArticulo('Cable USB', '0')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    await apagarSerie({ tenantId, articuloId: a.id })
    expect((await leerArticulo(a.id)).llevaSerie).toBe(false)
  })

  it('rechaza apagar con unidades libres: cinco identidades no se vuelven un 5', async () => {
    const a = await crearArticuloConSerie('iPhone SE', ['F1'])
    await expect(apagarSerie({ tenantId, articuloId: a.id })).rejects.toThrow(
      expect.objectContaining({ codigo: 'SERIE_CON_UNIDADES_LIBRES' }),
    )
  })
})

describe('apagarSerie no cambia', () => {
  it('una unidad SIN identificar también frena el apagado: es una unidad libre', async () => {
    // El spec lo dice explícito y ninguna task lo tocaba, así que sin este
    // caso nadie nota si alguien "simplifica" el conteo a las identificadas.
    const a = await crearArticulo('iPhone 13 mini', '3')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    await expect(apagarSerie({ tenantId, articuloId: a.id })).rejects.toThrow(
      expect.objectContaining({ codigo: 'SERIE_CON_UNIDADES_LIBRES' }),
    )
  })
})

describe('unidadesLibres', () => {
  it('no devuelve las vendidas ni las dadas de baja', async () => {
    const a = await crearArticuloConSerie('iPhone X', ['G1', 'G2', 'G3'])
    const [g1, g2] = await unidadesLibres(tenantId, a.id)
    await marcarVendida(g1.id)
    await marcarDadaDeBaja(g2.id)
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['G3'])
  })

  it('dentro de UNA tanda, con timestamp idéntico, desempata por id (uuid v7)', async () => {
    // `ingresadaEn` sale de CURRENT_TIMESTAMP, que en Postgres es la hora de
    // INICIO de la transacción: las tres unidades de esta única tanda
    // comparten el mismo valor exacto, así que si el resultado sale ['H1',
    // 'H2', 'H3'] es porque el `id` (uuid v7, time-ordered) las desempató en
    // el orden real de inserción — no porque el orden por timestamp ya las
    // distinguiera.
    const a = await crearArticuloConSerie('iPhone XR', ['H1', 'H2', 'H3'])
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['H1', 'H2', 'H3'])
  })

  it('entre DOS tandas, la primera sigue antes de la segunda', async () => {
    // Simula el caso real de un artículo ya prendido que recibe una entrada
    // de mercadería posterior (`ingresarStock`, Task 3): dos transacciones
    // separadas, cada una con su propia hora de inicio, así que acá el
    // criterio que ordena es `ingresadaEn` y no el desempate por `id`.
    const a = await crearArticuloConSerie('iPhone 12 mini', ['I1'])
    await enTransaccionDeTenant(tenantId, (tx) =>
      crearUnidadesEnTx(tx, { tenantId, articuloId: a.id, imeis: ['I2'], usuarioId }),
    )
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['I1', 'I2'])
  })
})

describe('darDeBajaUnidad', () => {
  it('baja la unidad, descuenta el stock y deja su movimiento con la nota', async () => {
    const a = await crearArticuloConSerie('iPhone 11', ['M1', 'M2'])
    const [m1] = await unidadesLibres(tenantId, a.id)
    await darDeBajaUnidad({ tenantId, unidadId: m1.id, usuarioId, nota: 'se rompió en el mostrador' })

    expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['M2'])

    const movimientos = await movimientosDe(a.id)
    const baja = movimientos.find((m) => m.unidadId === m1.id)
    expect(baja?.motivo).toBe('AJUSTE')
    expect(baja?.delta.toString()).toBe('-1')
    expect(baja?.nota).toBe('se rompió en el mostrador')
  })

  it('dar de baja dos veces la misma unidad no descuenta dos veces', async () => {
    // El doble click es más probable que la mala intención, y la condición
    // viaja DENTRO del UPDATE: la segunda pasada no encuentra fila que mover.
    const a = await crearArticuloConSerie('iPhone SE', ['N1'])
    const [n1] = await unidadesLibres(tenantId, a.id)
    await darDeBajaUnidad({ tenantId, unidadId: n1.id, usuarioId })
    await expect(
      darDeBajaUnidad({ tenantId, unidadId: n1.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_NO_DISPONIBLE' }))
    expect((await leerArticulo(a.id)).stock.toString()).toBe('0')
  })

  it('una unidad inexistente da UNIDAD_INEXISTENTE y no un 500', async () => {
    await expect(
      darDeBajaUnidad({ tenantId, unidadId: crypto.randomUUID(), usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_INEXISTENTE' }))
  })
})

describe('identificarUnidad', () => {
  it('carga el IMEI de una unidad sin identificar', async () => {
    const a = await crearArticulo('iPhone 12', '2')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const [u] = await unidadesLibres(tenantId, a.id)
    await identificarUnidad({ tenantId, unidadId: u.id, imei: '355000000000001', usuarioId })
    const despues = await unidadesLibres(tenantId, a.id)
    expect(despues.find((x) => x.id === u.id)?.imei).toBe('355000000000001')
  })

  it('CORRIGE el IMEI de una unidad que ya tenía uno, mientras esté libre', async () => {
    const a = await crearArticuloConSerie('iPhone 11', ['355111111111111'])
    const [u] = await unidadesLibres(tenantId, a.id)
    await identificarUnidad({ tenantId, unidadId: u.id, imei: '355222222222222', usuarioId })
    expect((await leerUnidad(u.id)).imei).toBe('355222222222222')
  })

  it('NO deja corregir una unidad ya vendida', async () => {
    // La otra mitad, que es la que se olvida.
    const a = await crearArticuloConSerie('iPhone X', ['355333333333333'])
    const [u] = await unidadesLibres(tenantId, a.id)
    await venderUnidad(a.id, u.id) // helper local, por el motor
    await expect(
      identificarUnidad({ tenantId, unidadId: u.id, imei: '355444444444444', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_NO_DISPONIBLE' }))
  })

  it('rechaza un IMEI que ya tiene otra unidad libre', async () => {
    const a = await crearArticuloConSerie('iPhone SE', ['355555555555555'])
    // Una segunda unidad, sin identificar, sobre el mismo artículo — el mismo
    // estado que dejaría `ingresarStock({ cantidad })` sobre un artículo con
    // serie (Task 3, todavía no aterrizada acá): se arma con la pieza que esa
    // función usa por dentro, `crearUnidadesEnTx` con un `null`.
    await enTransaccionDeTenant(tenantId, (tx) =>
      crearUnidadesEnTx(tx, { tenantId, articuloId: a.id, imeis: [null], usuarioId }),
    )
    const sinId = (await unidadesLibres(tenantId, a.id)).find((u) => u.imei === null)!
    await expect(
      identificarUnidad({ tenantId, unidadId: sinId.id, imei: '355555555555555', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEI_REPETIDO' }))
  })

  it('rechaza un IMEI vacío', async () => {
    const a = await crearArticulo('iPhone XR', '1')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const [u] = await unidadesLibres(tenantId, a.id)
    await expect(
      identificarUnidad({ tenantId, unidadId: u.id, imei: '   ', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEI_VACIO' }))
  })

  it('una unidad inexistente da UNIDAD_INEXISTENTE y no un 500', async () => {
    await expect(
      identificarUnidad({ tenantId, unidadId: crypto.randomUUID(), imei: '355999999999999', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_INEXISTENTE' }))
  })
})
