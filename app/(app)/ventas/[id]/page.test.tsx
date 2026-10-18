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
  seOfreceCorregir, baseDePagoGuardado, hayPagoSinPorcentaje, type EdicionVisible,
} from './page'
import { CONSUMIDOR_FINAL } from '@/lib/ventas/medios'
import { formatearPrecio, formatearCantidad } from '@/lib/formato/mostrar'
// Las MISMAS funciones con las que el motor arma y valida una venta: el caso
// del ida y vuelta de `baseDePagoGuardado` no puede reimplementarlas, porque
// entonces probaría su propia copia en vez de la aritmética que corre.
import { montoEntregado, recargoDePago, totalesDePagos } from '@/lib/ventas/totales'

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

/** Lo que el diálogo de corrección necesita para precargarse. Un juego mínimo
 *  y consistente con `PAGO_ARS`: la venta cierra con un solo pago en pesos. */
const CORRECCION: Parameters<typeof Detalle>[0]['correccion'] = {
  totalArs: '94000.00',
  totalUsd: '0',
  pagos: [
    { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: '94000.00', cotizacion: '1', planId: null },
  ],
  planes: [],
  hayPagoSinPorcentaje: false,
}

/** Una corrección de la bitácora: los pagos de ANTES, con sus `Decimal`
 *  crudos —`Detalle` no cruza a un componente cliente, así que los formatea
 *  ella misma con las mismas funciones que ya usa "Cómo se pagó", en vez de
 *  recibirlos ya resueltos a texto como el resto de las props. Consistente
 *  con `PAGO_ARS`: un pago en efectivo, sin plan. */
const EDICION: EdicionVisible = {
  id: 'e1',
  nota: 'era transferencia',
  creadoEn: new Date('2026-09-14T12:00:00Z'),
  usuario: { nombre: 'Flor' },
  pagos: [
    { id: 'p1', medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', monto: d('1000'), cotizacion: d('1'), recargo: d('0'), plan: null },
  ],
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
      ofreceCorregir={false}
      correccion={CORRECCION}
      ventaId="v1"
      detalle={null}
      // El caso común, y el que tiene que verse EXACTAMENTE como antes de la
      // Task 8: una venta que nunca se corrigió no dibuja la card.
      ediciones={[]}
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

  // Ciclo "unidades sin identificar": una unidad que se vendió sin número no
  // le presta nada a ninguna línea, y —lo que importa— tampoco le come el
  // turno a la que sí lo tiene. Con la unidad sin identificar PRIMERA en la
  // lista, que es el orden que rompería un reparto que la consumiera.
  it('una unidad sin identificar no ocupa el turno de la que sí tiene IMEI', () => {
    const resultado = imeisPorItem(
      [{ id: 'i1', articuloId: 'a1' }, { id: 'i2', articuloId: 'a1' }],
      [{ articuloId: 'a1', imei: null }, { articuloId: 'a1', imei: 'A1' }],
    )
    expect(resultado.size).toBe(1)
    expect(resultado.get('i1')).toBe('A1')
  })

  it('con todas sin identificar, ningún ítem tiene IMEI', () => {
    const resultado = imeisPorItem(
      [{ id: 'i1', articuloId: 'a1' }],
      [{ articuloId: 'a1', imei: null }],
    )
    expect(resultado.size).toBe(0)
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

  // order-5 (Correcciones) queda reservado para cuando hubo alguna — sin
  // ediciones no aparece ninguna card con ese número (ver "la card de
  // correcciones", más abajo, para el caso con corrección).
  it('Resumen es order-1, Qué se vendió order-2, Cómo se pagó order-3, Detalles order-4, Zona de riesgo order-6 (sin correcciones) — todas lg:order-none', () => {
    const html = renderDetalle()
    for (const orden of ['order-1', 'order-2', 'order-3', 'order-4', 'order-6']) {
      expect(html).toContain(`${orden} flex flex-col`)
    }
    expect(html).not.toContain('order-5')
    expect(html.match(/lg:order-none/g)).toHaveLength(5)
  })
})

describe('Detalle: el botón de corregir cómo se pagó', () => {
  /**
   * En las DOS direcciones y CONTANDO apariciones, que es lo que un
   * `not.toContain` solo no puede dar: con el permiso tiene que estar, sin el
   * permiso no tiene que estar ninguna. El encabezado de "Cómo se pagó" se
   * renderiza igual en los dos anchos —no lleva `hidden lg:flex`—, así que hay
   * UNA sola copia; el día que alguien duplique el botón para el teléfono, este
   * conteo se pone rojo y obliga a gatear las dos (la lección de "Anular orden"
   * en el merge del ciclo móvil).
   */
  const disparadores = (html: string) => [...html.matchAll(/>Corregir</g)]

  it('con VENTAS_EDITAR aparece, una sola vez', () => {
    expect(disparadores(renderDetalle({ ofreceCorregir: true }))).toHaveLength(1)
  })

  it('sin VENTAS_EDITAR no aparece ninguna vez', () => {
    expect(disparadores(renderDetalle({ ofreceCorregir: false }))).toHaveLength(0)
  })

  /**
   * El cableado, que el render no puede ver: `Detalle` recibe `ofreceCorregir`
   * ya resuelto, así que un llamador que le pasara el PERMISO pelado ofrecería
   * corregir una venta anulada — que el motor rechaza con `VENTA_ANULADA`, o
   * sea un botón que siempre falla. Mismo mecanismo y mismo motivo que el caso
   * gemelo de `ofreceAnular`, más abajo.
   */
  it('la pantalla combina el permiso con anuladaEn antes de pasarlo a Detalle', () => {
    const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')
    expect(fuente).toContain('ofreceCorregir={seOfreceCorregir(puedeEditarVenta, datos.anuladaEn)}')
    expect(fuente).not.toContain('ofreceCorregir={puedeEditarVenta}')
  })
})

describe('seOfreceCorregir', () => {
  it('pide el permiso Y que la venta siga cobrada', () => {
    expect(seOfreceCorregir(true, null)).toBe(true)
    expect(seOfreceCorregir(false, null)).toBe(false)
    // Anulada: no hay nada que corregir sobre cómo se pagó algo que se dio de
    // baja, y el motor la rechaza con VENTA_ANULADA.
    expect(seOfreceCorregir(true, new Date('2026-09-10T12:00:00Z'))).toBe(false)
  })
})

describe('baseDePagoGuardado: la vuelta del monto guardado a la base', () => {
  const d = (v: string) => new Prisma.Decimal(v)

  it('un pago en pesos contra el total en pesos: la base es el monto menos el recargo', () => {
    const base = baseDePagoGuardado({
      moneda: 'ARS', cubre: 'ARS', monto: d('14000'), cotizacion: d('1'), recargo: d('4000'),
    })
    expect(base.toString()).toBe('10000')
  })

  it('sin plan el recargo es cero, así que la base es el monto', () => {
    const base = baseDePagoGuardado({
      moneda: 'ARS', cubre: 'ARS', monto: d('94000'), cotizacion: d('1'), recargo: d('0'),
    })
    expect(base.toString()).toBe('94000')
  })

  // Un pago ENTREGADO en dólares no puede llevar plan (PLAN_EN_DOLARES), así
  // que su recargo es siempre 0 y la cotización no entra en la cuenta: la base
  // son los mismos dólares del monto, sin dividir.
  it('un pago en dólares no divide por su cotización', () => {
    const base = baseDePagoGuardado({
      moneda: 'USD', cubre: 'USD', monto: d('300'), cotizacion: d('1485'), recargo: d('0'),
    })
    expect(base.toString()).toBe('300')
  })

  it('dólares entregados contra el total en pesos tampoco dividen', () => {
    const base = baseDePagoGuardado({
      moneda: 'USD', cubre: 'ARS', monto: d('20'), cotizacion: d('1485'), recargo: d('0'),
    })
    expect(base.toString()).toBe('20')
  })

  /**
   * El único caso que divide, y el que justifica que esta función exista: el
   * iPhone de US$ 300 pagado en pesos en doce cuotas al 40 %. `Pago.monto`
   * guarda los $623.700 que entraron, de los cuales $178.200 son recargo; los
   * $445.500 que quedan son 300 dólares a 1485. El campo del diálogo se rotula
   * "Cubre US$", así que tiene que decir 300.
   */
  it('pesos entregados contra el total en dólares vuelven a los dólares que cubren', () => {
    const base = baseDePagoGuardado({
      moneda: 'ARS', cubre: 'USD', monto: d('623700'), cotizacion: d('1485'), recargo: d('178200'),
    })
    expect(base.toString()).toBe('300')
  })
})

/**
 * El ida y vuelta COMPLETO, que es la propiedad que de verdad importa.
 *
 * Los casos de arriba prueban un pago suelto con números elegidos para que
 * salgan redondos. Lo que sostiene la pantalla es otra cosa: que las bases
 * reconstruidas de una venta ENTERA vuelvan a sumar exactamente `total` y
 * `totalUsd` — si no, abrir el diálogo sobre una venta perfectamente válida
 * muestra "Faltan US$ 0,01" sin que nadie haya tocado nada, y el botón de
 * guardar arranca apagado.
 *
 * Sin este caso, lo único que sostiene esa propiedad es la prosa del docblock:
 * cambiar el modo de redondeo de `redondearDinero`, o el `ROUND_HALF_UP` de
 * `baseDePagoGuardado`, o permitir tres decimales en `base`, la rompe con los
 * cinco casos de arriba en verde.
 *
 * Se arma como la arma el motor —`montoEntregado` + `recargoDePago` son las
 * MISMAS funciones que usa `resolverPagosConRecargo`— y se cierra con
 * `totalesDePagos`, la misma con la que `exigirQueCierren` acepta o rechaza.
 */
describe('baseDePagoGuardado: las bases reconstruidas de una venta vuelven a cerrar', () => {
  const d = (v: string) => new Prisma.Decimal(v)

  /** Lo que el motor guardaría para este pago: `monto` (con el recargo
   *  adentro) y `recargo`, que es lo único que la fila de `Pago` conserva. */
  function comoLoGuardaElMotor(p: {
    moneda: 'ARS' | 'USD'
    cubre: 'ARS' | 'USD'
    base: Prisma.Decimal
    cotizacion: Prisma.Decimal
    porcentaje?: Prisma.Decimal
  }) {
    const entregado = montoEntregado(p)
    const recargo = p.porcentaje ? recargoDePago(entregado, p.porcentaje) : d('0')
    return {
      moneda: p.moneda,
      cubre: p.cubre,
      cotizacion: p.cotizacion,
      monto: entregado.add(recargo),
      recargo,
    }
  }

  it('una venta MIXTA con plan y cotización de cuatro decimales cierra exacto', () => {
    // Tres pagos, uno de cada forma que puede tomar una fila:
    //  - efectivo en pesos contra el total en pesos, sin plan;
    //  - pesos entregados contra el total en dólares, con un plan del 40 %
    //    (el único caso que hace DIVIDIR a la reconstrucción);
    //  - dólares entregados contra el total en dólares.
    // La cotización lleva sus cuatro decimales a propósito: es la escala real
    // de la columna, y es donde un redondeo mal puesto se nota.
    const COTIZACION = d('1485.1234')
    const entrada = [
      { moneda: 'ARS' as const, cubre: 'ARS' as const, base: d('15000.35'), cotizacion: d('1') },
      {
        moneda: 'ARS' as const, cubre: 'USD' as const, base: d('137.77'),
        cotizacion: COTIZACION, porcentaje: d('40'),
      },
      { moneda: 'USD' as const, cubre: 'USD' as const, base: d('162.23'), cotizacion: COTIZACION },
    ]

    // Los dos totales de la venta: lo que el motor exigió al cobrarla.
    const totales = totalesDePagos(entrada)
    expect(totales.ars.toString()).toBe('15000.35')
    expect(totales.usd.toString()).toBe('300')

    // Ida y vuelta: guardar como guarda el motor, y reconstruir.
    const reconstruidas = entrada.map((p) => {
      const guardado = comoLoGuardaElMotor(p)
      return { ...guardado, base: baseDePagoGuardado(guardado) }
    })

    // 1) Cada base vuelve idéntica a la que se cobró.
    expect(reconstruidas.map((p) => p.base.toString())).toEqual([
      '15000.35',
      '137.77',
      '162.23',
    ])

    // 2) Y —lo que de verdad decide si el diálogo abre cerrado— el juego
    //    reconstruido sigue cerrando contra los MISMOS dos totales, por la
    //    misma función con la que `exigirQueCierren` acepta o rechaza.
    const vueltos = totalesDePagos(reconstruidas)
    expect(vueltos.ars.equals(totales.ars)).toBe(true)
    expect(vueltos.usd.equals(totales.usd)).toBe(true)
  })

  /**
   * **La frontera, afirmada y no sólo descrita en prosa**: con `cotizacion < 1`
   * la identidad SE ROMPE. Base `0,03` a cotización `0,5` entrega `0,02`
   * (0,015 → ROUND_HALF_UP) y vuelve como `0,04`.
   *
   * El docblock de `baseDePagoGuardado` lo descarta por económicamente
   * imposible —una cotización menor que 1 significaría un dólar que vale menos
   * que un peso—, y está bien descartado, pero el motor **no lo rechaza**:
   * `normalizarPagos` sólo exige `cotizacion > 0`. Este caso deja el límite
   * escrito donde se puede ver: el día que alguien lo corra hacia abajo, lo
   * primero que tiene que leer es esto.
   */
  it('con una cotización MENOR que 1 la vuelta ya no es exacta, y eso está aceptado', () => {
    const guardado = comoLoGuardaElMotor({
      moneda: 'ARS', cubre: 'USD', base: d('0.03'), cotizacion: d('0.5'),
    })
    expect(guardado.monto.toString()).toBe('0.02')
    expect(baseDePagoGuardado(guardado).toString()).toBe('0.04')
  })
})

describe('hayPagoSinPorcentaje: sólo cuenta un pago CON plan al que le falta el dato', () => {
  it('un pago sin plan no tiene porcentaje que recuperar', () => {
    expect(hayPagoSinPorcentaje([{ planDePagoId: null, porcentaje: null }])).toBe(false)
  })

  it('un pago con plan y con porcentaje congelado tampoco', () => {
    expect(
      hayPagoSinPorcentaje([{ planDePagoId: 'p1', porcentaje: new Prisma.Decimal('40') }]),
    ).toBe(false)
  })

  it('un pago con plan y sin porcentaje sí: se cobró antes de que la columna existiera', () => {
    expect(hayPagoSinPorcentaje([{ planDePagoId: 'p1', porcentaje: null }])).toBe(true)
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

describe('la card de detalles', () => {
  it('precarga el detalle guardado', () => {
    const html = renderDetalle({ detalle: 'Retira Ana, martes de 10 a 12' })
    expect(html).toContain('Detalles')
    expect(html).toContain('Retira Ana, martes de 10 a 12')
  })

  // La card se dibuja SIEMPRE, con o sin dato: es el lugar donde el detalle se
  // carga cuando aparece después, así que esconderla vacía sería esconder
  // justamente el caso que este ciclo existe para atender.
  it('se dibuja también sin detalle, con el textarea vacío', () => {
    const html = renderDetalle({ detalle: null })
    expect(html).toContain('Detalles')
    expect(html).toMatch(/<textarea[^>]*id="detalle-de-la-venta"[^>]*>\s*<\/textarea>/)
  })

  it('el maxLength es el tope del servidor', async () => {
    const { TOPE_DETALLE } = await import('@/lib/ventas/detalle')
    const html = renderDetalle({ detalle: null })
    expect(html).toMatch(new RegExp(`<textarea[^>]*maxlength="${TOPE_DETALLE}"`, 'i'))
  })

  // Editable también anulada: es la decisión del ciclo, y el caso la fija para
  // que nadie la "arregle" más adelante creyendo que es un descuido.
  it('se ofrece igual sobre una venta anulada', () => {
    const html = renderDetalle({ detalle: null, anulada: true, notaDeAnulacionTexto: 'Anulada por X' })
    expect(html).toMatch(/<textarea[^>]*id="detalle-de-la-venta"/)
  })

  // El orden de la pila del teléfono: Detalles va cuarta y la Zona de riesgo
  // queda última. Si alguien inserta la card sin renumerar, la acción
  // destructiva se le mete en el medio — y eso sólo lo atrapa un caso que ate
  // cada `order-N` a SU card. La versión anterior de este caso sólo
  // confirmaba que las dos cadenas "order-4"/"order-5" estaban en algún lado
  // del HTML, así que intercambiar los dos números en la pantalla lo hubiera
  // dejado en verde igual (hallazgo Important de la review de esta task).
  it('en el teléfono va cuarta, con la zona de riesgo última', () => {
    const html = renderDetalle({ detalle: null })
    // La card de Detalles: el bloque cuyo <h2> dice "Detalles" lleva order-4.
    const bloqueDetalles = html.match(/<div class="(order-\d)[^"]*"><div class="border-b[^"]*"><h2[^>]*>Detalles<\/h2>/)
    expect(bloqueDetalles?.[1]).toBe('order-4')
    // La Zona de riesgo (sin anular, es el bloque con bg-destructive-soft):
    // lleva order-6 — le cedió el order-5 a Correcciones, que sin ediciones
    // no se dibuja (ver "la card de correcciones", más abajo).
    const bloqueRiesgo = html.match(/<div class="(order-\d)[^"]* bg-destructive-soft[^"]*"/)
    expect(bloqueRiesgo?.[1]).toBe('order-6')
    // Y en POSICIÓN, que es lo que de verdad ordena la pila del teléfono:
    // Detalles aparece antes que "Anular la venta" en el HTML final.
    expect(html.indexOf('>Detalles<')).toBeLessThan(html.indexOf('Anular la venta'))
  })
})

describe('la card de correcciones', () => {
  // A diferencia de "Detalles", que se dibuja vacía a propósito porque es el
  // lugar donde el dato se carga: acá no hay nada que cargar, así que un
  // local que nunca corrigió una venta no ve ninguna diferencia.
  it('no dibuja la card cuando la venta nunca se corrigió', () => {
    const html = renderDetalle({ ediciones: [] })
    expect(html).not.toContain('Correcciones')
  })

  it('dibuja quién, cuándo, la nota y cómo estaban los pagos antes', () => {
    const html = renderDetalle({ ediciones: [EDICION] })
    expect(html).toContain('Correcciones')
    expect(html).toContain('Flor')
    expect(html).toContain('era transferencia')
    expect(html).toContain('Efectivo')
    // El monto del pago archivado, formateado con la misma función que ya
    // usa "Cómo se pagó" — nunca "1000" a secas.
    expect(html).toContain(formatearPrecio('1000'))
  })

  it('sin nota no dibuja ningún párrafo de más', () => {
    const html = renderDetalle({ ediciones: [{ ...EDICION, nota: null }] })
    expect(html).not.toContain('era transferencia')
  })

  it('cada pago con plan suma su rótulo, con el mismo rotuloDePlan de la tabla de al lado', () => {
    const html = renderDetalle({
      ediciones: [
        {
          ...EDICION,
          pagos: [
            { ...EDICION.pagos[0], plan: { nombre: 'Crédito 3 cuotas', cuotas: 3 } },
          ],
        },
      ],
    })
    expect(html).toContain(rotuloDePlan({ nombre: 'Crédito 3 cuotas', cuotas: 3 })!)
  })

  // El orden de la pila del teléfono: entre Detalles (order-4) y la Zona de
  // riesgo (order-6), nunca al final ni al principio.
  it('en el teléfono va entre Detalles y la Zona de riesgo: order-5', () => {
    const html = renderDetalle({ ediciones: [EDICION] })
    const bloque = html.match(/<div class="(order-\d)[^"]*"><div class="border-b[^"]*"><h2[^>]*>Correcciones<\/h2>/)
    expect(bloque?.[1]).toBe('order-5')
    expect(html.indexOf('>Detalles<')).toBeLessThan(html.indexOf('>Correcciones<'))
    expect(html.indexOf('>Correcciones<')).toBeLessThan(html.indexOf('Anular la venta'))
  })
})

// El ciclo de la solapa Clientes: la fila "Cliente" del Resumen enlaza a la
// ficha y ofrece asignar o cambiar el cliente de una venta ya cobrada.
describe('Detalle: el cliente de la venta', () => {
  it('sin la prop, la fila es el texto de siempre, sin controles', () => {
    const html = renderDetalle()
    expect(html).toContain(CONSUMIDOR_FINAL)
    expect(html).not.toContain('Asignar')
  })

  it('en consumidor final ofrece "Asignar"', () => {
    const html = renderDetalle({ cliente: null })
    expect(html).toContain(CONSUMIDOR_FINAL)
    expect(html).toContain('Asignar')
    expect(html).not.toContain('href="/clientes/')
  })

  it('con cliente, su nombre enlaza a la ficha y ofrece "Cambiar"', () => {
    const html = renderDetalle({
      cliente: { id: 'c1', nombre: 'Martín Sosa' },
      resumen: { fecha: '21/08/2026 · 14:28', vendio: 'Florencia Díaz', cliente: 'Martín Sosa', comprobante: 'Sin factura ARCA' },
    })
    expect(html).toMatch(/<a[^>]*href="\/clientes\/c1"[^>]*>Martín Sosa<\/a>/)
    expect(html).toContain('Cambiar')
  })
})
