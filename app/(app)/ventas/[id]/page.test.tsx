// Puro: importa sólo las funciones exportadas de page.tsx y `Detalle`. La
// pantalla en sí (`DetalleDeVenta`, el default export) NO se renderiza acá:
// es un Server Component async que abre sesión y consulta Prisma, y este
// repo no tiene el arnés para montarlo fuera de un request real (mismo
// criterio que documenta app/(app)/ventas/page.test.tsx).
//
// `Detalle`, en cambio, SÍ es un componente y SÍ se renderiza acá
// (renderToStaticMarkup): no abre sesión ni toca Prisma — recibe todo ya
// resuelto a texto — así que puede afirmarse sobre el HTML real y no por
// grep, que es lo que una review anterior de este ciclo marcó como
// preferible cuando el render lo permite. Lo que NO se puede renderizar (el
// `select` de Prisma en `DetalleDeVenta`) se verifica sobre el fuente, igual
// que ya lo hace el resto de este archivo.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  seOfreceAnular, cotizacionVisible, subtituloDeItem, metaDeItem, metaDePago, filasDeResumen,
  notaDeAnulacion, Detalle, type ItemVendido, type PagoRecibido,
  lineasDeRecargo, rotuloDePlan, seMuestraCubre, ROTULO_CUBRE, imeisPorItem,
} from './page'
import { CONSUMIDOR_FINAL } from '@/lib/ventas/medios'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'

const d = (v: string) => new Prisma.Decimal(v)

describe('seOfreceAnular', () => {
  it('con el permiso, se ofrece anular una venta cobrada', () => {
    expect(seOfreceAnular(true, null)).toBe(true)
  })

  it('sin el permiso no se ofrece el botón, sin importar el estado de la venta', () => {
    expect(seOfreceAnular(false, null)).toBe(false)
  })

  it('nadie anula una venta ya anulada, ni con el permiso', () => {
    expect(seOfreceAnular(true, new Date())).toBe(false)
  })
})

describe('cotizacionVisible', () => {
  it('un pago en pesos no tiene cotización que mostrar', () => {
    expect(cotizacionVisible({ moneda: 'ARS', cotizacion: '1' })).toBe('—')
  })

  it('un pago en dólares muestra la cotización con la que se tomó', () => {
    const salida = cotizacionVisible({ moneda: 'USD', cotizacion: '1485' })
    expect(salida).toContain('1.485,00')
  })

  // Corrección de la review de la Task 3 (Task 11): un pago en PESOS que
  // CRUZA a cubrir el total en DÓLARES sí se tomó a una cotización real —es
  // el dato que explica de dónde salió el monto—, y la versión vieja lo
  // escondía detrás de un "—" por mirar sólo `moneda`.
  it('un pago en pesos que cruza a cubrir el total en dólares SÍ muestra su cotización', () => {
    const salida = cotizacionVisible({ moneda: 'ARS', cubre: 'USD', cotizacion: '1485' })
    expect(salida).toContain('1.485,00')
  })

  it('un pago en pesos que cubre pesos sigue sin cotización, aunque se pase cubre explícito', () => {
    expect(cotizacionVisible({ moneda: 'ARS', cubre: 'ARS', cotizacion: '1' })).toBe('—')
  })
})

describe('subtituloDeItem', () => {
  it('un producto muestra su SKU', () => {
    expect(subtituloDeItem({ sku: '000412', tipo: 'PRODUCTO' })).toBe('SKU 000412')
  })

  it('un servicio no tiene SKU de stock: dice "Servicio"', () => {
    expect(subtituloDeItem({ sku: '999999', tipo: 'SERVICIO' })).toBe('Servicio')
  })
})

const pagoArs = (monto: string) => ({ moneda: 'ARS' as const, monto: d(monto) })
const pagoUsd = (monto: string) => ({ moneda: 'USD' as const, monto: d(monto) })

describe('lineasDeRecargo', () => {
  it('null cuando no hay nada que desglosar: el renglón único "Total" de siempre', () => {
    expect(
      lineasDeRecargo({ total: d('50000'), recargo: d('0'), totalUsd: d('0'), pagos: [pagoArs('50000')] }),
    ).toBeNull()
  })

  // Una venta en dólares pagada en dólares pasa de DOS renglones ("Total
  // $ 0,00" + "Total en dólares US$ 300,00") a uno solo.
  it('null también con una venta en dólares pagada en dólares', () => {
    expect(
      lineasDeRecargo({ total: d('0'), recargo: d('0'), totalUsd: d('300'), pagos: [pagoUsd('300')] }),
    ).toBeNull()
  })

  it('en pesos con recargo: Vendido / Recargo / Cobrado, y la banda es Cobrado', () => {
    const lineas = lineasDeRecargo({
      total: d('50000'), recargo: d('20000'), totalUsd: d('0'), pagos: [pagoArs('70000')],
    })
    expect(lineas?.map((l) => l.rotulo)).toEqual(['Vendido', 'Recargo', 'Cobrado'])
    expect(lineas?.map((l) => l.destacada)).toEqual([false, false, true])
    expect(lineas?.[2].valor).toContain('70.000,00')
  })

  it('con recargo negativo la palabra es Descuento y el importe va sin signo', () => {
    const lineas = lineasDeRecargo({
      total: d('50000'), recargo: d('-5000'), totalUsd: d('0'), pagos: [pagoArs('45000')],
    })
    expect(lineas?.[1].rotulo).toBe('Descuento')
    expect(lineas?.[1].valor).not.toContain('-')
    expect(lineas?.[1].valor).toContain('5.000,00')
  })

  // El caso canónico del proyecto: el iPhone de lista US$ 300 cobrado en pesos
  // a 1485 con un plan de 12 cuotas al 40 %. Antes de este ciclo el pie decía
  // "Mercadería $ 0,00 / Recargo $ 178.200 / Cobrado $ 178.200 / Total en
  // dólares US$ 300" — cuatro renglones donde el "Cobrado" no era lo cobrado.
  it('el caso canónico: Vendido en dólares, Recargo y Cobrado en pesos', () => {
    const lineas = lineasDeRecargo({
      total: d('0'), recargo: d('178200'), totalUsd: d('300'), pagos: [pagoArs('623700')],
    })
    expect(lineas?.map((l) => l.rotulo)).toEqual(['Vendido', 'Recargo', 'Cobrado'])
    expect(lineas?.[0].valor).toContain('US$')
    expect(lineas?.[0].valor).toContain('300,00')
    expect(lineas?.[1].valor).toContain('178.200,00')
    expect(lineas?.[2].valor).toContain('623.700,00')
    // Una sola banda, no dos: el renglón "Cobrado" ya lleva las dos monedas
    // cuando hace falta, así que no hay una segunda banda por moneda.
    expect(lineas?.filter((l) => l.destacada)).toHaveLength(1)
  })

  // El caso del feedback: US$ 300 cobrados US$ 200 en billetes + el resto en
  // pesos. Sin recargo, pero las dos magnitudes difieren.
  it('el caso del feedback: sin recargo, pero Vendido y Cobrado difieren', () => {
    const lineas = lineasDeRecargo({
      total: d('0'), recargo: d('0'), totalUsd: d('300'),
      pagos: [pagoUsd('200'), pagoArs('148500')],
    })
    expect(lineas?.map((l) => l.rotulo)).toEqual(['Vendido', 'Cobrado'])
    expect(lineas?.[0].valor).toContain('300,00')
    expect(lineas?.[1].valor).toContain('148.500,00')
    expect(lineas?.[1].valor).toContain('US$')
  })
})

describe('rotuloDePlan', () => {
  it('sin plan, no hay nada que mostrar', () => {
    expect(rotuloDePlan(null)).toBeNull()
  })

  it('con una cuota (débito, contado), sólo el nombre', () => {
    expect(rotuloDePlan({ nombre: 'Débito', cuotas: 1 })).toBe('Débito')
  })

  it('con más de una cuota, el nombre más cuántas', () => {
    expect(rotuloDePlan({ nombre: 'Crédito 3 cuotas', cuotas: 3 })).toBe('Crédito 3 cuotas · 3 cuotas')
  })
})

describe('metaDeItem', () => {
  // `formatearPrecio`/`formatearCantidad` usan `Intl.NumberFormat`, que en
  // Node emite un espacio NO separable (` `) entre "$" y el número —
  // no el espacio normal que se tipea a mano. Comparar contra el resultado
  // REAL de esas funciones evita el mismo problema que ya evitaba
  // `cotizacionVisible` de más arriba, comparando sólo desde el número.
  it('funde subtítulo, cantidad y precio en una sola línea', () => {
    const meta = metaDeItem({ subtitulo: 'SKU 000412', cantidad: '1', precioUnitario: '12000' })
    expect(meta).toBe(`SKU 000412 · ${formatearCantidad('1')} × ${formatearPrecio('12000')}`)
    expect(meta).toContain('SKU 000412 · 1 ×')
    expect(meta).toContain('12.000,00')
  })

  it('funciona igual para un servicio, sin SKU', () => {
    const meta = metaDeItem({ subtitulo: 'Servicio', cantidad: '1', precioUnitario: '45000' })
    expect(meta).toBe(`Servicio · ${formatearCantidad('1')} × ${formatearPrecio('45000')}`)
    expect(meta).toContain('45.000,00')
  })

  // Task 11: un ítem en dólares muestra su precio con "US$", sin convertirlo.
  it('un ítem en dólares muestra su precio con US$, no convertido a pesos', () => {
    const meta = metaDeItem({ subtitulo: 'SKU 000900', cantidad: '1', precioUnitario: '300', moneda: 'USD' })
    expect(meta).toContain('US$')
    expect(meta).toContain('300,00')
  })
})

describe('metaDePago', () => {
  it('un pago en pesos sólo dice la moneda', () => {
    expect(metaDePago({ moneda: 'ARS', cotizacion: '1' })).toBe('Pesos')
  })

  it('un pago en dólares suma la cotización con la que se tomó', () => {
    const meta = metaDePago({ moneda: 'USD', cotizacion: '1485' })
    expect(meta).toBe(`Dólares · cotización ${formatearPrecio('1485')}`)
    expect(meta).toContain('1.485,00')
  })

  // Task 11: un pago en pesos que CRUZA a cubrir dólares también suma su
  // cotización — mismo criterio que cotizacionVisible.
  it('un pago en pesos que cruza a cubrir dólares también suma su cotización', () => {
    const meta = metaDePago({ moneda: 'ARS', cubre: 'USD', cotizacion: '1485' })
    expect(meta).toBe(`Pesos · cotización ${formatearPrecio('1485')}`)
  })

  it('cubreLabel se agrega al final, cuando corresponde', () => {
    const meta = metaDePago({
      moneda: 'ARS', cubre: 'USD', cotizacion: '1485', cubreLabel: ROTULO_CUBRE.USD,
    })
    expect(meta).toBe(`Pesos · cotización ${formatearPrecio('1485')} · ${ROTULO_CUBRE.USD}`)
  })

  it('sin cubreLabel, la línea queda exactamente como antes', () => {
    expect(metaDePago({ moneda: 'ARS', cotizacion: '1', cubreLabel: null })).toBe('Pesos')
  })
})

describe('seMuestraCubre', () => {
  it('un pago que cubre dólares siempre lo dice, sin importar la venta', () => {
    expect(seMuestraCubre('USD', { total: d('0'), totalUsd: d('300') })).toBe(true)
    expect(seMuestraCubre('USD', { total: d('100'), totalUsd: d('0') })).toBe(true)
  })

  it('un pago que cubre pesos, en una venta sólo en pesos, no lo dice (caso común)', () => {
    expect(seMuestraCubre('ARS', { total: d('100000'), totalUsd: d('0') })).toBe(false)
  })

  it('un pago que cubre pesos SÍ lo dice cuando la venta tiene los dos totales', () => {
    expect(seMuestraCubre('ARS', { total: d('15000'), totalUsd: d('300') })).toBe(true)
  })

  it('una venta sólo en dólares tampoco lo necesita para un pago que cubre dólares... salvo que ya es true por cubre', () => {
    // total=0 y totalUsd>0: no tiene "los dos totales", pero cubre='USD'
    // ya alcanza por la primera mitad de la regla.
    expect(seMuestraCubre('USD', { total: d('0'), totalUsd: d('300') })).toBe(true)
  })
})

describe('filasDeResumen', () => {
  it('arma fecha, vendió, cliente y comprobante (estado va aparte, en ChipEstado)', () => {
    // 20:28 UTC son las 17:28 en Buenos Aires (UTC-3) — no coinciden con el
    // ejemplo del relevamiento a propósito, para no depender de que alguien
    // reafirme el mismo número dos veces sin mirar el huso.
    const filas = filasDeResumen({
      creadoEn: new Date('2026-08-21T20:28:00Z'),
      usuario: { nombre: 'Florencia Díaz' },
      cliente: null,
    })
    expect(filas.vendio).toBe('Florencia Díaz')
    expect(filas.cliente).toBe(CONSUMIDOR_FINAL)
    expect(filas.comprobante).toBe('Sin factura ARCA')
    expect(filas.fecha).toBe('21/08/2026 · 17:28')
  })

  it('con cliente identificado, muestra su nombre y no "Consumidor final"', () => {
    const filas = filasDeResumen({
      creadoEn: new Date(),
      usuario: { nombre: 'Alguien' },
      cliente: { nombre: 'Martín Sosa' },
    })
    expect(filas.cliente).toBe('Martín Sosa')
  })
})

describe('notaDeAnulacion', () => {
  it('dice quién y cuándo', () => {
    const texto = notaDeAnulacion({
      anuladaEn: new Date('2026-08-20T15:00:00Z'),
      anuladaPor: { nombre: 'Rodrigo Cotarelo' },
    })
    expect(texto).toMatch(/^Anulada el/)
    expect(texto).toContain('Rodrigo Cotarelo')
    expect(texto.endsWith('.')).toBe(true)
  })

  it('sin anuladaPor no inventa un nombre: sólo dice la fecha', () => {
    const texto = notaDeAnulacion({
      anuladaEn: new Date('2026-08-20T15:00:00Z'),
      anuladaPor: null,
    })
    expect(texto).toMatch(/^Anulada el/)
    expect(texto).not.toContain(' por ')
  })
})

// Regresión concreta que motivó este bloque (hallazgo Critical de la review
// final del rediseño): un diff anterior sacó `anuladaPor` del `select` y
// borró el bloque que lo mostraba, y NADA lo notó — sólo quedó un chip que
// dice QUE la venta está anulada, no quién ni cuándo. `notaDeAnulacion` de
// arriba prueba el TEXTO; esto prueba que `DetalleDeVenta` todavía lo PIDE y
// lo CALCULA. Leer el fuente como texto es el mismo criterio que ya usa
// app/(app)/vender/caja.test.tsx para cablear algo que ni jsdom ni una
// sesión real de este repo pueden ejercitar — acá además porque el `select`
// de Prisma no tiene ningún componente puro que lo represente.
describe('el dato de quién anuló no se vuelve a perder', () => {
  const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')

  it('el select sigue pidiendo anuladaPor', () => {
    expect(fuente).toContain('anuladaPor: { select: { nombre: true } }')
  })

  it('la pantalla llama a notaDeAnulacion con el dato real de la venta', () => {
    expect(fuente).toContain(
      'notaDeAnulacion({ anuladaEn: venta.anuladaEn, anuladaPor: venta.anuladaPor })',
    )
  })
})

// Hallazgo de la review (Ronda de arreglos 1): dos de los seis requisitos
// del Step 1 del brief no tenian ningun test — que el `Encabezado` reciba
// `atras="/ventas"` y que NO se le pase `accionMovil`. El codigo ya lo
// cumplia (nadie lo discute), pero nada lo protegia: alguien que copie el
// `<Encabezado>` de otra pantalla —que si trae `accionMovil`— o que borre
// el `atras` en un merge no rompe ningun test, y la pantalla queda con dos
// flechas de volver (el link del cuerpo YA muestra la suya en escritorio, si
// el Topbar sumara otra) o con ninguna. Mismo criterio que el bloque de
// arriba: `DetalleDeVenta` es un Server Component que no se puede montar sin
// sesion ni Prisma, asi que se verifica sobre el fuente.
describe('el Encabezado vuelve a /ventas por atras, nunca por accionMovil', () => {
  const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')
  // La etiqueta completa, no lineas sueltas: asi 'accionMovil' en un
  // comentario de mas arriba (hay varios, explicando la ranura vacia) no
  // puede colar como si estuviera en el JSX.
  const etiqueta = fuente.match(/<Encabezado[^>]*\/>/)?.[0]

  it('existe el <Encabezado> de esta pantalla', () => {
    expect(etiqueta, `no se encontro <Encabezado ... /> en: ${fuente}`).toBeTruthy()
  })

  it('recibe atras="/ventas"', () => {
    expect(etiqueta).toContain('atras="/ventas"')
  })

  it('NO recibe accionMovil — la ranura derecha queda vacia a proposito (spec Ss7, printer)', () => {
    expect(etiqueta).not.toContain('accionMovil')
  })
})

/** Un ítem mínimo, ya resuelto a texto — la forma que `Detalle` recibe de
 *  verdad, sin ningún `Decimal` de Prisma. */
const ITEM: ItemVendido = {
  id: 'i1',
  nombre: 'Vidrio templado 9H · iPhone 13',
  subtitulo: 'SKU 000412',
  meta: 'SKU 000412 · 1 × $ 12.000,00',
  cantidadFormateada: '1',
  precioFormateado: '$ 12.000,00',
  subtotalFormateado: '$ 12.000,00',
  // El caso común, y el que tiene que verse EXACTAMENTE como antes de la
  // Task 10: sin ninguna unidad identificada.
  imei: null,
}

/** Un pago mínimo en pesos: `esUsd: false`, sin la línea "entraron $X". */
const PAGO_ARS: PagoRecibido = {
  id: 'p1',
  medioLabel: 'Efectivo',
  // El plan va en el pago en PESOS y no en el de dólares: `PLAN_EN_DOLARES`
  // (lib/ventas/crear.ts) hace que un pago en dólares con plan no exista, y un
  // fixture se lee como documentación de qué estados son legales.
  planLabel: 'Crédito 3 cuotas · 3 cuotas',
  monedaLabel: 'Pesos',
  cotizacionFormateada: '—',
  montoFormateado: '$ 64.300,00',
  enPesosFormateado: '$ 64.300,00',
  meta: 'Crédito 3 cuotas · 3 cuotas · Pesos',
  esUsd: false,
}

/** Un pago en dólares: `esUsd: true`, con "entraron $X" en el teléfono. */
const PAGO_USD: PagoRecibido = {
  id: 'p2',
  medioLabel: 'Transferencia',
  planLabel: null,
  monedaLabel: 'Dólares',
  cotizacionFormateada: '$ 1.485,00',
  montoFormateado: 'US$ 20,00',
  enPesosFormateado: '$ 29.700,00',
  meta: 'Dólares · cotización $ 1.485,00',
  esUsd: true,
}

function renderDetalle(props: Partial<Parameters<typeof Detalle>[0]> = {}) {
  return renderToStaticMarkup(
    <Detalle
      resumen={{ fecha: '21/08/2026 · 14:28', vendio: 'Florencia Díaz', cliente: CONSUMIDOR_FINAL, comprobante: 'Sin factura ARCA' }}
      anulada={false}
      notaDeAnulacionTexto={null}
      items={[ITEM]}
      totalFormateado="$ 94.000,00"
      pagos={[PAGO_ARS]}
      ofreceAnular={false}
      ventaId="v1"
      {...props}
    />,
  )
}

// Task 4 del ciclo móvil (docblock de `Listado` en app/(app)/ventas/page.tsx,
// líneas 344-408): grid + `display:contents` sobre las dos tablas, tarjetas
// apiladas en el teléfono, las mismas anchuras de columna que hoy declaraban
// los `<TableHead>` en escritorio.
describe('Detalle: "Qué se vendió" — el patrón grid + display:contents', () => {
  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 4 en escritorio', () => {
    const html = renderDetalle()
    expect(html).toContain('role="table"')
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[1fr_100px_130px_140px\]/)
  })

  it('hay 4 role="columnheader": Artículo, Cantidad, Precio, Subtotal', () => {
    const html = renderDetalle()
    expect(html.match(/role="columnheader"/g)).toHaveLength(4 + 6) // + las 6 de "Cómo se pagó"
    expect(html).toContain('>Artículo<')
    expect(html).toContain('>Cantidad<')
    expect(html).toContain('>Precio<')
  })

  it('cada fila de ítem lleva lg:contents, role="row" y 4 celdas role="cell"', () => {
    const html = renderDetalle({ items: [ITEM, { ...ITEM, id: 'i2' }] })
    // `gap-[5px]` distingue las filas de ÍTEM (design/arandano.pen, nodo
    // `Vxkrb`: `gap:5`) de la fila de PAGO (`gap-1`, más abajo) — las dos
    // llevan `group ... lg:contents`, así que hay que separarlas para no
    // contar de más.
    const filas = html.match(/role="row" class="group flex flex-col gap-\[5px\][^"]*lg:contents[^"]*"/g) ?? []
    expect(filas).toHaveLength(2)
    // 4 celdas por ítem × 2 ítems, más las 6 de "Cómo se pagó" (1 pago).
    expect(html.match(/role="cell"/g)).toHaveLength(4 * 2 + 6)
  })

  it('la fila resalta al pasar el mouse en escritorio (group + lg:group-hover en las 4 celdas)', () => {
    const html = renderDetalle()
    const celdaArticulo = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    for (const celda of celdaArticulo) expect(celda).toContain('lg:group-hover:bg-muted/50')
  })

  it('en el teléfono, cantidad y precio se funden en la meta junto al subtítulo', () => {
    const html = renderDetalle()
    expect(html).toContain('SKU 000412 · 1 × $ 12.000,00')
  })

  it('el nombre y el subtotal se muestran (subtotal aparece dos veces: meta del teléfono y celda de escritorio)', () => {
    const html = renderDetalle()
    expect(html).toContain('Vidrio templado 9H · iPhone 13')
    expect(html.match(/\$ 12\.000,00/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('el subtítulo del artículo está oculto en el teléfono y visible en escritorio', () => {
    const html = renderDetalle()
    expect(html).toMatch(/class="hidden text-\[11px\] text-muted-foreground lg:block">SKU 000412</)
  })

  // Task 10: el IMEI de la unidad que se llevó la línea, cuando la hay.
  describe('el IMEI de la unidad (Task 10)', () => {
    it('con unidad identificada, muestra el IMEI', () => {
      const html = renderDetalle({ items: [{ ...ITEM, imei: '355000000000001' }] })
      expect(html).toContain('IMEI 355000000000001')
    })

    // El principio del ciclo entero: un local que no usa esto no ve ninguna
    // diferencia. `ITEM` ya lleva `imei: null` por default.
    it('sin unidad identificada, no dibuja nada — ni el rótulo "IMEI"', () => {
      const html = renderDetalle()
      expect(html).not.toContain('IMEI')
    })

    // A diferencia del subtítulo (SKU), que está `hidden` en el teléfono, el
    // IMEI se dibuja UNA sola vez para los dos anchos: un solo árbol, no dos
    // presentaciones (mismo criterio que dejó escrito el merge del ciclo
    // móvil para evitar las dos copias de un mismo dato).
    it('el IMEI no lleva "hidden": se ve en los dos anchos con el mismo nodo', () => {
      const html = renderDetalle({ items: [{ ...ITEM, imei: '355000000000001' }] })
      expect(html).toMatch(/<span class="text-\[11px\] text-muted-foreground">IMEI 355000000000001<\/span>/)
    })
  })

  it('la banda TOTAL pinta con --marca en el teléfono y con bg-muted en escritorio', () => {
    const html = renderDetalle({ totalFormateado: '$ 94.000,00' })
    expect(html).toMatch(/class="flex items-center justify-between bg-\[var\(--marca\)\][^"]*lg:bg-muted[^"]*"/)
    expect(html).toContain('$ 94.000,00')
  })

  // El renglón "Cobrado" lleva las dos monedas cuando hace falta, así que
  // desde el ciclo del cobrado por moneda hay UNA sola banda destacada y no
  // una por moneda. `Detalle` sigue soportando varias —el `destacada` es por
  // línea— pero `lineasDeRecargo` ya no genera dos.
  it('con las dos monedas, UNA sola banda destacada y las dos en el mismo renglón', () => {
    const html = renderDetalle({
      lineasDeTotal: [
        { rotulo: 'Vendido', montoFormateado: 'US$ 300,00', destacada: false },
        { rotulo: 'Cobrado', montoFormateado: '$ 148.500,00 + US$ 200,00', destacada: true },
      ],
    })
    const bandas = html.match(/class="flex items-center justify-between bg-\[var\(--marca\)\][^"]*lg:bg-muted[^"]*"/g) ?? []
    expect(bandas).toHaveLength(1)
    expect(html).toContain('$ 148.500,00 + US$ 200,00')
    expect(html).toContain('>Vendido<')
  })
})

describe('imeisPorItem', () => {
  it('sin unidades, ningún ítem tiene IMEI', () => {
    const resultado = imeisPorItem([{ id: 'i1', articuloId: 'a1' }], [])
    expect(resultado.size).toBe(0)
  })

  it('un artículo con una unidad se la asigna a su única línea', () => {
    const resultado = imeisPorItem(
      [{ id: 'i1', articuloId: 'a1' }],
      [{ articuloId: 'a1', imei: '355000000000001' }],
    )
    expect(resultado.get('i1')).toBe('355000000000001')
  })

  // Dos iPhones del mismo modelo son dos líneas (CANTIDAD_CON_SERIE en
  // crearVenta), y a cuál de las dos le toca cuál IMEI es irrelevante —dicen
  // exactamente lo mismo—, pero las dos tienen que aparecer, cada una con la
  // suya, sin repetir ni perder ninguna.
  it('dos líneas del mismo artículo se reparten un IMEI cada una', () => {
    const resultado = imeisPorItem(
      [{ id: 'i1', articuloId: 'a1' }, { id: 'i2', articuloId: 'a1' }],
      [{ articuloId: 'a1', imei: 'A1' }, { articuloId: 'a1', imei: 'A2' }],
    )
    expect(new Set(resultado.values())).toEqual(new Set(['A1', 'A2']))
    expect(resultado.size).toBe(2)
  })

  it('un artículo sin unidades en esta venta no aparece en el resultado', () => {
    const resultado = imeisPorItem(
      [{ id: 'i1', articuloId: 'sin-serie' }],
      [{ articuloId: 'otro-articulo', imei: 'X1' }],
    )
    expect(resultado.has('i1')).toBe(false)
  })
})

describe('Detalle: "Cómo se pagó" — el patrón grid + display:contents', () => {
  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 6 en escritorio', () => {
    const html = renderDetalle()
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[1fr_150px_110px_130px_130px_140px\]/)
  })

  it('hay 6 role="columnheader" para esta tabla: Medio, Plan, Moneda, Cotización, Monto, En pesos', () => {
    const html = renderDetalle()
    expect(html).toContain('>Medio<')
    expect(html).toContain('>Plan<')
    expect(html).toContain('>Moneda<')
    expect(html).toContain('>Cotización<')
    expect(html).toContain('>Monto<')
    expect(html).toContain('>En pesos<')
  })

  it('un pago en pesos NO muestra "entraron $" en el teléfono', () => {
    const html = renderDetalle({ pagos: [PAGO_ARS] })
    expect(html).not.toContain('entraron')
  })

  it('un pago en dólares SÍ muestra "entraron $" en el teléfono', () => {
    const html = renderDetalle({ pagos: [PAGO_USD] })
    expect(html).toContain('entraron $ 29.700,00')
    expect(html).toContain('Dólares · cotización $ 1.485,00')
  })

  it('la última fila de pagos no lleva borde en el teléfono (nada la sigue dentro de la card)', () => {
    const html = renderDetalle({ pagos: [PAGO_ARS, PAGO_USD] })
    const filas = html.match(/role="row" class="group [^"]*"/g) ?? []
    // La última tiene que declarar last:border-b-0 (sin prefijo: corta el
    // borde también en el teléfono, a diferencia de "Qué se vendió", donde
    // el Total sigue después y el borde se mantiene en todas las filas).
    const filaDePagos = filas.filter((f) => f.includes('gap-1'))
    expect(filaDePagos.length).toBeGreaterThan(0)
    for (const f of filaDePagos) expect(f).toContain('last:border-b-0')
  })

  // Task 11, Step 1 del brief: "el detalle dice qué total cubrió cada pago".
  // Un pago en pesos que cubre el total en dólares — el escenario de R3/R8
  // del brief — lleva `cubreLabel` ya resuelto por el llamador.
  it('un pago que cruza monedas dice qué total cubrió', () => {
    const pagoQueCruza: PagoRecibido = {
      ...PAGO_ARS,
      cubreLabel: ROTULO_CUBRE.USD,
      meta: metaDePago({ moneda: 'ARS', cubre: 'USD', cotizacion: '1485', cubreLabel: ROTULO_CUBRE.USD }),
    }
    const html = renderDetalle({ pagos: [pagoQueCruza] })
    expect(html).toContain('total en dólares')
  })

  it('el caso común —sin cubreLabel— no menciona qué total cubrió', () => {
    const html = renderDetalle({ pagos: [PAGO_ARS] })
    expect(html).not.toContain('Cubre el total')
  })
})

describe('Detalle: el panel Resumen — pares apilados con el mismo padding de siempre en escritorio', () => {
  it('cada fila tiene el padding mobile-first: 14px en el teléfono, 18px en escritorio', () => {
    const html = renderDetalle()
    expect(html).toMatch(/class="flex items-center justify-between gap-3 border-b px-\[14px\] py-\[11px\] last:border-b-0 lg:px-\[18px\]"/)
  })

  it('muestra fecha, vendió, cliente, estado (vía ChipEstado) y comprobante', () => {
    const html = renderDetalle()
    expect(html).toContain('21/08/2026 · 14:28')
    expect(html).toContain('Florencia Díaz')
    expect(html).toContain(CONSUMIDOR_FINAL)
    expect(html).toContain('Sin factura ARCA')
    expect(html).toContain('Cobrada')
  })

  it('con la venta anulada, el chip dice "Anulada"', () => {
    const html = renderDetalle({ anulada: true })
    expect(html).toContain('Anulada')
  })
})

describe('Detalle: el orden se invierte entre el teléfono y escritorio', () => {
  it('las dos columnas de escritorio se disuelven en el teléfono con contents lg:flex', () => {
    const html = renderDetalle()
    expect(html.match(/class="contents lg:flex lg:flex-1 lg:flex-col lg:gap-4"/g)).toHaveLength(1)
    expect(html.match(/class="contents lg:flex lg:w-\[324px\] lg:shrink-0 lg:flex-col lg:gap-4"/g)).toHaveLength(1)
  })

  it('Resumen es order-1, Qué se vendió order-2, Cómo se pagó order-3, Zona de riesgo order-4 — todas lg:order-none', () => {
    const html = renderDetalle()
    for (const orden of ['order-1', 'order-2', 'order-3', 'order-4']) {
      expect(html).toContain(`${orden} flex flex-col`)
    }
    expect(html.match(/lg:order-none/g)).toHaveLength(4)
  })
})

describe('Detalle: el link "Volver" del cuerpo sólo existe en escritorio', () => {
  it('lleva hidden lg:flex — en el teléfono esa función la cumple la flecha del Topbar', () => {
    const html = renderDetalle()
    expect(html).toMatch(/class="hidden w-fit items-center gap-\[6px\] text-\[12px\] font-semibold text-muted-foreground lg:flex"/)
  })
})

describe('Detalle: Zona de riesgo', () => {
  it('sin anular y sin permiso: muestra la advertencia, sin el botón', () => {
    const html = renderDetalle({ notaDeAnulacionTexto: null, ofreceAnular: false })
    expect(html).toContain('Anular la venta')
    expect(html).not.toContain('<form')
  })

  it('sin anular y con permiso: muestra el formulario de anulación', () => {
    const html = renderDetalle({ notaDeAnulacionTexto: null, ofreceAnular: true })
    expect(html).toContain('<form')
  })

  it('anulada: la nota vive dentro de un <Alert> (role="alert"), sin la advertencia ni el botón', () => {
    const html = renderDetalle({
      anulada: true,
      notaDeAnulacionTexto: 'Anulada el 20/08/2026 por Rodrigo Cotarelo.',
      ofreceAnular: true,
    })
    expect(html).toMatch(/role="alert"[^>]*>[\s\S]*Anulada el 20\/08\/2026 por Rodrigo Cotarelo\./)
    expect(html).not.toContain('Anular la venta')
    expect(html).not.toContain('<form')
  })

  /**
   * El cableado, que el render no puede ver: `Detalle` recibe `ofreceAnular`
   * ya resuelto, así que un llamador que le pasara el PERMISO pelado
   * (`puedeAnularVenta`) en vez de `seOfreceAnular(permiso, anuladaEn)`
   * ofrecería anular una venta ya anulada, con los tres casos de arriba en
   * verde. `DetalleDeVenta` es un Server Component async que abre sesión y
   * consulta Prisma, así que esto se verifica sobre el fuente — misma
   * excepción que el resto de este archivo ya usa para el `select`.
   */
  it('la pantalla combina el permiso con anuladaEn antes de pasarlo a Detalle', () => {
    const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')
    // Task 10: `anuladaEn` viaja en `datos` —lo que devuelve `datosDelDetalle`—
    // desde que la consulta se extrajo del Server Component, ya no en
    // `venta.anuladaEn` a secas.
    expect(fuente).toContain('ofreceAnular={seOfreceAnular(puedeAnularVenta, datos.anuladaEn)}')
    // Y al revés: el permiso pelado nunca llega solo al componente.
    expect(fuente).not.toContain('ofreceAnular={puedeAnularVenta}')
  })
})

// El cableado de Task 8 (precios por forma de pago): mismo criterio que el
// bloque de arriba — leer el fuente como texto porque la pantalla es un
// Server Component async que ni jsdom ni este arnés pueden montar (ver el
// comentario del encabezado del archivo).
describe('la pantalla pide y usa el recargo y el plan de cada pago', () => {
  const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')

  it('el select de la venta pide recargo', () => {
    expect(fuente).toContain('id: true, numero: true, total: true, recargo: true')
  })

  it('el select de los pagos pide el plan, sin filtrar por si está dado de baja', () => {
    // Sin `desactivadoEn` en el `where` del plan: la FK es Restrict y la baja
    // es lógica, así que la fila sigue estando — una venta vieja tiene que
    // seguir nombrando el plan aunque el local ya no lo ofrezca. Confirmado
    // contra la base en test/ventas.test.ts.
    expect(fuente).toContain('plan: { select: { nombre: true, cuotas: true } }')
  })

  it('el pie de "Qué se vendió" usa lineasDeRecargo(), no venta.total a secas', () => {
    expect(fuente).toContain('const lineasDeTotal = lineasDeRecargo(venta)')
  })

  it('el renglón único usa cobradoDePagos, no vendidoDeVenta: es la plata que entró', () => {
    // Task 10: se arma dentro de `datosDelDetalle` (objeto), no como prop
    // JSX de `Detalle` a secas — la extracción de esa función movió esta
    // línea sin cambiar qué calcula.
    expect(fuente).toContain('totalFormateado: formatearTotales(cobradoDePagos(venta.pagos)),')
    expect(fuente).not.toContain('totalFormateado: formatearPrecio(venta.total.toString())')
    expect(fuente).not.toContain('totalFormateado: formatearTotales(vendidoDeVenta(venta))')
  })

  it('la tabla "Cómo se pagó" tiene una columna Plan', () => {
    const posHeaders = fuente.indexOf('Cómo se pagó')
    const posPlan = fuente.indexOf('Plan', posHeaders)
    expect(posPlan).toBeGreaterThan(posHeaders)
  })

  it('cada fila de pago llama a rotuloDePlan con el plan de ESE pago', () => {
    expect(fuente).toContain('rotuloDePlan(p.plan)')
  })
})

// Task 11 (precio en dólares): mismo criterio que el bloque de arriba — leer
// el fuente porque la pantalla es un Server Component async.
describe('la pantalla pide y usa totalUsd, la moneda del ítem y qué cubrió cada pago', () => {
  const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')

  it('el select de la venta pide totalUsd', () => {
    expect(fuente).toContain('anuladaEn: true, totalUsd: true,')
  })

  it('el select de los ítems pide la moneda del ítem', () => {
    const posItems = fuente.indexOf('items: {')
    const posMoneda = fuente.indexOf('moneda: true,', posItems)
    expect(posMoneda).toBeGreaterThan(posItems)
  })

  it('el select de los pagos pide cubre', () => {
    expect(fuente).toContain('cubre: true,')
  })

  it('cada ítem se formatea con precioEnSuMoneda, no formatearPrecio a secas', () => {
    expect(fuente).toContain('precioFormateado: precioEnSuMoneda(precioUnitario, i.moneda)')
  })

  it('cada pago calcula cubreLabel con seMuestraCubre y ROTULO_CUBRE', () => {
    expect(fuente).toContain('seMuestraCubre(p.cubre, venta) ? ROTULO_CUBRE[p.cubre] : null')
  })
})
