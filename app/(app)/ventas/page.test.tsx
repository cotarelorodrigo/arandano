// Puro: importa sólo las funciones exportadas de page.tsx, nunca el
// componente de página en sí —es un Server Component async que abre sesión y
// consulta Prisma, y este repo no tiene el arnés para montarlo fuera de un
// request real (mismo criterio que ya documentan las funciones puras de
// app/(app)/vender/punto-de-venta.tsx: se prueba la REGLA, no el cableado
// completo de principio a fin, que queda cubierto por scripts/smoke.sh).
//
// `Listado`, en cambio, SÍ es un componente y SÍ se renderiza acá
// (renderToStaticMarkup): a diferencia de `Ventas`, no abre sesión ni toca
// Prisma — recibe sus filas ya resueltas a texto — así que puede afirmarse
// sobre el HTML real y no por grep, que es lo que una review anterior de
// este ciclo marcó como preferible cuando el render lo permite. Lo que NO se
// puede renderizar (los cambios de layout que viven directo en `Ventas`,
// como el `hidden lg:flex` del formulario de fechas) se verifica sobre el
// fuente, igual que ya lo hacen otras pantallas de este repo
// (app/(app)/servicio-tecnico/page.test.tsx).
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  rangoDeChip, chipActivo, pieDeCobradas, pieDeAnuladas, rotuloDeMedios, ventanaDePaginas, Listado, Tile,
} from './page'

const HOY = '2026-08-21'

describe('rangoDeChip', () => {
  it('"hoy" es un solo día', () => {
    expect(rangoDeChip('hoy', HOY)).toEqual({ desde: HOY, hasta: HOY })
  })

  it('"7dias" son los últimos 7 días, HOY incluido', () => {
    // Del 15 al 21 son 7 días (21, 20, 19, 18, 17, 16, 15), no 6 ni 8: por eso
    // resta 6 días y no 7.
    expect(rangoDeChip('7dias', HOY)).toEqual({ desde: '2026-08-15', hasta: HOY })
  })

  it('"estemes" arranca el día 1 del mes de hoy', () => {
    expect(rangoDeChip('estemes', HOY)).toEqual({ desde: '2026-08-01', hasta: HOY })
  })

  it('"7dias" cruza el borde de mes sin perderse', () => {
    expect(rangoDeChip('7dias', '2026-09-02')).toEqual({ desde: '2026-08-27', hasta: '2026-09-02' })
  })
})

describe('chipActivo', () => {
  it('reconoce el rango que arma cada chip', () => {
    expect(chipActivo(HOY, HOY, HOY)).toBe('hoy')
    expect(chipActivo('2026-08-15', HOY, HOY)).toBe('7dias')
    expect(chipActivo('2026-08-01', HOY, HOY)).toBe('estemes')
  })

  it('ningún chip para un rango tipeado a mano', () => {
    expect(chipActivo('2026-08-10', '2026-08-12', HOY)).toBeNull()
  })
})

describe('pieDeCobradas', () => {
  it('calcula el promedio sobre lo cobrado', () => {
    // Los mismos números que design/arandano.pen, nodo `nINsZ`: 44 ventas
    // cobradas por $ 1.284.500,00 en total dan $ 29.193,18 de promedio. Sin
    // el string exacto (el espacio entre "$" y el número es NBSP, cosa de
    // ICU, no del formateador) — mismo criterio que lib/formato/mostrar.test.ts.
    const pie = pieDeCobradas('1284500', 44, false)
    expect(pie).toMatch(/^promedio \$/)
    expect(pie).toContain('29.193,18')
  })

  it('sin ninguna venta cobrada no hay promedio que mostrar, y no NaN', () => {
    // Todo el período pudo haberse anulado entero: 0 cobradas es un estado
    // real, no un caso imposible. "promedio $ NaN" es peor que ningún pie.
    expect(pieDeCobradas('0', 0, false)).toBeUndefined()
  })

  // Ola final del ciclo del precio en dólares: el local que pidió la feature
  // carga TODO su catálogo en dólares, así que todas sus ventas tienen
  // `total = 0` y `recargo = 0`. El pie decía `promedio $ 0,00` justo debajo
  // de un tile que decía `US$ 3.000,00` — no omitía, AFIRMABA, y afirmaba lo
  // contrario de lo que la pantalla mostraba dos centímetros más arriba.
  it('con lo cobrado en pesos en cero y dólares en el período, no hay pie', () => {
    expect(pieDeCobradas('0', 10, true)).toBeUndefined()
  })

  // El otro lado de la misma condición, para que la guarda no se vuelva un
  // "nunca muestres el pie con dólares en el período": un local mixto sí
  // tiene un promedio en pesos que decir.
  it('con dólares en el período pero algo cobrado en pesos, el pie sigue estando', () => {
    expect(pieDeCobradas('20000', 2, true)).toContain('10.000,00')
  })

  // Y el caso en que el cero es cierto: sin dólares, `promedio $ 0,00` no
  // miente, así que se muestra igual que siempre.
  it('cero en pesos SIN dólares sigue mostrando el promedio, que ahí es cierto', () => {
    expect(pieDeCobradas('0', 3, false)).toContain('0,00')
  })

  // Minor 3 de la review de Task 8: `Number(sumaCobradas) / cobradas` seguido
  // de `.toFixed(2)` es aritmética de punto flotante sobre plata, contra la
  // regla del ciclo ("plata en Decimal, nunca number con decimales"). No es un
  // caso de laboratorio: 2010 / 2000 = 1,005 EXACTO en decimal (redondea a
  // 1,01 con ROUND_HALF_UP, la regla que usa el resto del motor), pero el
  // double más cercano a 1.005 es un poquito MENOR, así que
  // `(2010/2000).toFixed(2)` da "1.00" en JS — confirmado en el propio
  // intérprete node antes de este fix. Con Decimal.div + redondearDinero (la
  // MISMA función que usa el resto de lib/ventas/totales.ts) el promedio
  // redondea para el lado correcto.
  it('redondea el promedio con la MISMA regla que el resto de la plata (ROUND_HALF_UP), no con Number().toFixed()', () => {
    const pie = pieDeCobradas('2010', 2000, false)
    expect(pie).toContain('1,01')
    expect(pie).not.toContain('1,00')
  })
})

describe('pieDeAnuladas', () => {
  it('formatea lo devuelto, no el total del período', () => {
    const pie = pieDeAnuladas('61200', false)
    expect(pie).toContain('61.200,00')
    expect(pie).toContain('devueltos')
  })

  it('sin anuladas, devuelve $ 0,00 y no rompe', () => {
    expect(pieDeAnuladas('0', false)).toContain('0,00')
  })

  // El espejo de la guarda de `pieDeCobradas`: una venta anulada de US$ 300
  // devolvió dólares, y `$ 0,00 devueltos` dice que no se devolvió nada.
  it('con lo devuelto en pesos en cero y dólares entre las anuladas, no hay pie', () => {
    expect(pieDeAnuladas('0', true)).toBeUndefined()
  })
})

describe('rotuloDeMedios', () => {
  it('un solo medio en pesos', () => {
    expect(rotuloDeMedios([{ medio: 'EFECTIVO', moneda: 'ARS' }])).toBe('Efectivo')
  })

  it('un medio con algún pago en dólares lo marca', () => {
    // La fila #1040 del relevamiento: "Efectivo · US$" — dos pagos en
    // efectivo, uno en pesos y otro en dólares, es UN medio con la marca.
    expect(
      rotuloDeMedios([
        { medio: 'EFECTIVO', moneda: 'ARS' },
        { medio: 'EFECTIVO', moneda: 'USD' },
      ]),
    ).toBe('Efectivo · US$')
  })

  it('dos medios distintos se listan los dos, en el orden de los pagos', () => {
    expect(
      rotuloDeMedios([
        { medio: 'TRANSFERENCIA', moneda: 'ARS' },
        { medio: 'EFECTIVO', moneda: 'ARS' },
      ]),
    ).toBe('Transferencia + Efectivo')
  })

  it('sin pagos, una raya y no una cadena vacía', () => {
    expect(rotuloDeMedios([])).toBe('—')
  })

  it('rotula en castellano, nunca el nombre del enum', () => {
    expect(rotuloDeMedios([{ medio: 'TARJETA_CREDITO', moneda: 'ARS' }])).not.toContain('TARJETA')
  })
})

describe('ventanaDePaginas', () => {
  it('sin páginas, ventana vacía', () => {
    expect(ventanaDePaginas(1, 0)).toEqual([])
  })

  it('con pocas páginas, las muestra todas', () => {
    expect(ventanaDePaginas(1, 3)).toEqual([1, 2, 3])
  })

  it('centra la ventana en la página actual', () => {
    expect(ventanaDePaginas(5, 10)).toEqual([3, 4, 5, 6, 7])
  })

  it('no se pasa del límite inferior', () => {
    expect(ventanaDePaginas(1, 10)).toEqual([1, 2, 3, 4, 5])
  })

  it('no se pasa del límite superior', () => {
    expect(ventanaDePaginas(10, 10)).toEqual([6, 7, 8, 9, 10])
  })
})

// Task 8 (las ventas muestran el recargo): mismo criterio que el bloque de
// regresión de app/(app)/ventas/[id]/page.test.tsx — la pantalla es un Server
// Component async que abre sesión y consulta Prisma, así que lo que un test
// puro no puede aserverar (que la columna Total y el tile de arriba usen
// `totalCobrado()`, y que el select pida `recargo`) se cablea leyendo el
// fuente como texto.
describe('la columna Total y el tile del período muestran lo cobrado', () => {
  const fuente = readFileSync('app/(app)/ventas/page.tsx', 'utf8')

  it('el select del listado pide recargo', () => {
    expect(fuente).toContain(
      'id: true, numero: true, total: true, recargo: true, creadoEn: true, anuladaEn: true,',
    )
  })

  // El ciclo del cobrado por moneda: la celda deja de leer `total + recargo`
  // (que ignora lo que entró en dólares) y pasa a comparar las dos magnitudes.
  // Positivo + negativo, para que no alcance con que la cadena nueva aparezca
  // en cualquier lado del archivo.
  it('la celda Total compara lo vendido contra lo cobrado de los pagos', () => {
    expect(fuente).toContain(
      'totalLineas: lineasDeImporte(vendidoDeVenta(v), cobradoDePagos(v.pagos), v.recargo),',
    )
    expect(fuente).not.toContain('formatearPrecio(totalCobrado(v).toString())')
  })

  // Sin `monto` en el select, `cobradoDePagos` recibiría filas sin el número
  // que suma: TypeScript lo atajaría, pero el caso deja escrito POR QUÉ esa
  // columna está en un select que existía para la celda "Medios".
  it('el select del listado pide el monto de cada pago', () => {
    expect(fuente).toContain('pagos: { select: { medio: true, moneda: true, monto: true }')
  })

  it('el tile "Total del período" recibe las dos magnitudes del período', () => {
    const posTile = fuente.indexOf('rotulo="Total del período"')
    const posLineas = fuente.indexOf(
      'lineas={lineasDeImporte(vendidoPeriodo, cobradoPeriodo, recargoPeriodo)}',
      posTile,
    )
    expect(posTile).toBeGreaterThan(-1)
    expect(posLineas).toBeGreaterThan(posTile)
  })

  // Los dos pies pasan a hablar de lo COBRADO en pesos, no de `total +
  // recargo`: sin esto, un período que cobró $148.500 cubriendo una venta en
  // dólares seguiría diciendo "promedio $ 0,00" o, peor, omitiendo el pie.
  it('el pie de "Ventas cobradas" recibe el cobrado en pesos del período', () => {
    expect(fuente).toContain(
      'pieDeCobradas(cobradoPeriodo.ars.toString(), cobradas, !cobradoPeriodo.usd.isZero())',
    )
    expect(fuente).not.toContain('pieDeCobradas(sumaCobrada.toString()')
  })

  it('el pie de "Anuladas" recibe lo devuelto en pesos, de los pagos de las anuladas', () => {
    expect(fuente).toContain(
      'pieDeAnuladas(devueltoPeriodo.ars.toString(), !devueltoPeriodo.usd.isZero())',
    )
    expect(fuente).not.toContain('pieDeAnuladas(devueltoCobrado.toString()')
  })

  // La regla "una venta anulada no es plata que entró" vive ahora en DOS
  // agregados. `pagosDelPeriodo` es la mitad nueva, y está exportada
  // justamente para que test/ventas.test.ts la pueda correr contra la base:
  // el `groupBy` inline del panel de medios no se puede llamar desde ningún
  // test, que es lo que el hallazgo I3 dejó como lección.
  it('las dos mitades del cobrado del período salen de pagosDelPeriodo', () => {
    expect(fuente).toContain('pagosDelPeriodo(prisma, donde, false)')
    expect(fuente).toContain('pagosDelPeriodo(prisma, donde, true)')
  })
})

// Task 11 (precio en dólares): el tile "Total del período" y la columna
// Total muestran los dos números sin convertir. Mismo criterio de fuente que
// el bloque de arriba — el resto lo cubren los tests de componente/función
// de más abajo (Tile, y el desglose Vendido/Cobrado de `describe('Listado: el
// patrón grid + display:contents', ...)`, que reemplazó a `totalesFormateados`
// en el ciclo del cobrado por moneda, Task 2).
describe('el tile "Total del período" y la columna Total muestran dólares sin convertir', () => {
  const fuente = readFileSync('app/(app)/ventas/page.tsx', 'utf8')

  it('el aggregate de totalDelPeriodo suma totalUsd', () => {
    expect(fuente).toContain('_sum: { total: true, recargo: true, totalUsd: true }')
  })

  it('el select del listado pide totalUsd', () => {
    expect(fuente).toContain('anuladaEn: true, totalUsd: true,')
  })

  it('el tile no arma sus líneas a mano: se las pide a lineasDeImporte', () => {
    expect(fuente).toContain('lineas={lineasDeImporte(vendidoPeriodo, cobradoPeriodo, recargoPeriodo)}')
    expect(fuente).not.toContain('valorUsd=')
  })

  it('la columna Total no convierte nada: ninguna cotización en el armado de la fila', () => {
    const posMap = fuente.indexOf('filas={ventas.map((v) => ({')
    const posCierre = fuente.indexOf('anulada: v.anuladaEn !== null,', posMap)
    expect(posMap).toBeGreaterThan(-1)
    expect(fuente.slice(posMap, posCierre)).not.toContain('cotizacion')
  })
})

// El tile de marca ("Total del período"): con una sola línea se ve
// exactamente como antes de este ciclo —un local que no usa planes ni dólares
// no puede notarlo—, y con dos aparecen los rótulos, Vendido arriba.
describe('Tile: una línea o el desglose Vendido/Cobrado', () => {
  it('con una sola línea sin rótulo, el tile de marca no dibuja ningún rótulo de línea', () => {
    const html = renderToStaticMarkup(
      <Tile marca rotulo="Total del período" lineas={[{ valor: '$ 1.284.500,00' }]} pie="sin contar las anuladas" />,
    )
    expect(html).toContain('$ 1.284.500,00')
    expect(html).not.toContain('Vendido')
    expect(html).not.toContain('Cobrado')
  })

  it('con dos líneas, Vendido va ARRIBA de Cobrado', () => {
    const html = renderToStaticMarkup(
      <Tile
        marca
        rotulo="Total del período"
        lineas={[
          { rotulo: 'Vendido', valor: 'US$ 300,00' },
          { rotulo: 'Cobrado', valor: '$ 148.500,00 + US$ 200,00' },
        ]}
        pie="sin contar las anuladas"
      />,
    )
    const posVendido = html.indexOf('Vendido')
    const posCobrado = html.indexOf('Cobrado')
    expect(posVendido).toBeGreaterThan(-1)
    expect(posCobrado).toBeGreaterThan(posVendido)
  })

  it('los tiles chicos (un conteo, sin rótulo de línea) se dibujan igual que siempre', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="Ventas cobradas" lineas={[{ valor: '12' }]} pie="promedio $ 1.000,00" />,
    )
    expect(html).toContain('12')
    expect(html).toContain('promedio $ 1.000,00')
  })
})

/** Una fila mínima, ya resuelta a texto — la forma que `Listado` recibe de
 *  verdad, sin ningún `Decimal` de Prisma cruzando a un fixture de test. */
const FILA: Parameters<typeof Listado>[0]['filas'][number] = {
  id: 'v1',
  numero: 1042,
  horaFormateada: '14:32',
  clienteNombre: 'Consumidor final',
  itemsLabel: '3 artículos',
  mediosLabel: 'Efectivo',
  totalLineas: [{ valor: '$ 103.900,00' }],
  anulada: false,
}

function renderListado(props: Partial<Parameters<typeof Listado>[0]> = {}) {
  return renderToStaticMarkup(
    <Listado
      filas={[FILA]}
      total={1}
      pagina={1}
      paginas={1}
      porPagina={50}
      conPagina={(n) => `/ventas?p=${n}`}
      {...props}
    />,
  )
}

// Ronda de arreglos 1 (Menor 2): el pie de los tiles chicos ("Ventas
// cobradas"/"Anuladas") había quedado en 11px en los dos anchos — la única
// medida de `Tile` sin su par mobile-first, entre varias que sí lo tienen.
// La maqueta pide 10px/1.3 en el teléfono (`HvuAw`/`KSKKW`) y 11px/normal en
// escritorio (`nINsZ`/`W3w2l`, sin cambios).
describe('Tile: el pie mobile-first de los tiles chicos', () => {
  it('el pie es 10px/1.3 en el teléfono y 11px/normal en escritorio', () => {
    const html = renderToStaticMarkup(<Tile rotulo="Ventas cobradas" lineas={[{ valor: '44' }]} pie="promedio $ 29.193,18" />)
    const pie = html.match(/<div class="([^"]*)">promedio \$ 29\.193,18<\/div>/)
    expect(pie, `no se encontró el <div> del pie en: ${html}`).not.toBeNull()
    const clases = pie![1]
    for (const c of ['text-[10px]', 'leading-[1.3]', 'lg:text-[11px]', 'lg:leading-normal']) {
      expect(clases, `falta "${c}" en "${clases}"`).toContain(c)
    }
  })

  it('el tile de marca ("Total del período") no cambia: su pie sigue en 11px en los dos anchos', () => {
    const html = renderToStaticMarkup(<Tile marca rotulo="Total del período" lineas={[{ valor: '$ 1.284.500,00' }]} pie="sin contar las anuladas" />)
    expect(html).toMatch(/class="text-\[11px\]"[^>]*>sin contar las anuladas/)
  })
})

// Task 4 del ciclo móvil: el patrón de listado que copian las tasks 6, 8 y
// 10 — grid en escritorio, tarjetas apiladas en el teléfono, resuelto con
// `display:contents` sobre el MISMO árbol (design/arandano.pen, frame
// `nwW2V`, spec §3).
describe('Listado: el patrón grid + display:contents', () => {
  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 6 en escritorio', () => {
    const html = renderListado()
    expect(html).toContain('role="table"')
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[84px_110px_1fr_168px_280px_104px\]/)
  })

  it('el encabezado está oculto en el teléfono y se disuelve en escritorio', () => {
    const html = renderListado()
    expect(html).toContain('role="row" class="hidden lg:contents"')
  })

  it('hay tantos role="columnheader" como columnas declara el grid (6)', () => {
    const html = renderListado()
    expect(html.match(/role="columnheader"/g)).toHaveLength(6)
  })

  it('toda fila de datos lleva lg:contents y role="row"', () => {
    const html = renderListado({ filas: [FILA, { ...FILA, id: 'v2', numero: 1041 }], total: 2 })
    // El encabezado + las dos filas de datos: las tres son role="row" y las
    // tres llevan lg:contents — es lo que hace que, en escritorio, el mismo
    // árbol vuelva a ser una tabla de verdad.
    const filas = html.match(/role="row" class="[^"]*"/g) ?? []
    expect(filas).toHaveLength(3)
    for (const fila of filas) expect(fila).toContain('lg:contents')
  })

  it('cada fila de datos tiene 6 celdas con role="cell", tantas como columnheader', () => {
    const html = renderListado()
    expect(html.match(/role="cell"/g)).toHaveLength(6)
  })

  // Ronda de arreglos 1 (Importante 1): `TableRow` traía `hover:bg-muted/50`
  // por default (components/ui/table.tsx) y se perdió al pasar a `<div
  // role="row">`. `display:contents` no genera caja pero sigue en la cadena
  // de ancestros para `:hover`, así que `group` en la fila +
  // `lg:group-hover:bg-muted/50` en cada celda lo recupera en escritorio —
  // el patrón que las tasks 6, 8 y 10 tienen que copiar.
  it('la fila resalta al pasar el mouse en escritorio (group + group-hover en las 6 celdas)', () => {
    const html = renderListado()
    expect(html).toContain('role="row" class="group ')
    // La etiqueta de apertura completa de cada celda, sin asumir que
    // `class` viene inmediatamente después de `role` (la celda de Medios
    // tiene un `title` en el medio).
    const celdasDeDatos = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdasDeDatos).toHaveLength(6)
    for (const celda of celdasDeDatos) expect(celda).toContain('lg:group-hover:bg-muted/50')
  })

  it('muestra número, hora, cliente, medios, total y estado', () => {
    const html = renderListado()
    expect(html).toContain('#1042')
    expect(html).toContain('14:32')
    expect(html).toContain('Consumidor final')
    expect(html).toContain('3 artículos')
    expect(html).toContain('Efectivo')
    expect(html).toContain('$ 103.900,00')
    expect(html).toContain('Cobrada')
  })

  it('en el teléfono, Medios deja de ser columna y se funde en la línea de meta', () => {
    const html = renderListado()
    // La línea fluida del teléfono ("3 artículos · Efectivo") y la celda de
    // Medios de escritorio, oculta abajo de 1024 (`hidden ... lg:block`),
    // conviven en el mismo árbol. `truncate` se mudó al envoltorio de
    // centrado interno (Ronda de arreglos 1), así que ya no vive en la
    // apertura de la celda misma — se comprueba más abajo, junto con el
    // resto de ese envoltorio.
    expect(html).toContain('3 artículos · Efectivo')
    expect(html).toMatch(/class="hidden[^"]*\blg:block\b/)
  })

  it('sin ventas en el período, lo dice — y no confunde ese vacío con una página fuera de rango', () => {
    expect(renderListado({ filas: [], total: 0 })).toContain('No hay ventas en ese período.')
  })

  it('con la página fuera de rango, ofrece volver a la primera', () => {
    const html = renderListado({ filas: [], total: 5, pagina: 9 })
    expect(html).toContain('Esa página no tiene ventas.')
    expect(html).toContain('/ventas?p=1')
  })

  // --- Ronda de arreglos 1: tres defectos de familia `<TableRow>`/
  // `<TableCell>` que `display:contents` se lleva puestos, y que las tasks
  // 6, 8 y 10 iban a copiar tal cual si no se arreglaban acá. ---

  // Importante 1: `border-b`/`last:border-b-0` en la FILA no pintan nada en
  // escritorio (`display:contents` no genera caja). Cada celda lleva su
  // propio `lg:border-b`, y `lg:group-last:border-b-0` apaga el de la
  // ÚLTIMA fila — sin depender de que la fila (que sigue en el DOM, sólo sin
  // caja) resuelva el `:last-child` por su cuenta.
  it('el borde entre filas vive en cada celda, no en la fila (escritorio)', () => {
    const html = renderListado({ filas: [FILA, { ...FILA, id: 'v2', numero: 1041 }], total: 2 })
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(12) // 6 columnas × 2 filas
    for (const celda of celdas) expect(celda).toContain('lg:border-b')
    // Sólo la última fila apaga su borde — comprobado por conteo: 12 celdas,
    // 12 veces `lg:group-last:border-b-0` (todas lo llevan; el selector CSS,
    // no un cálculo en el render, es lo que decide cuál pinta 0 de verdad —
    // ver el probe de compilación que dejó la review, `:is(:where(.group)
    // :last-child *)`).
    const conGroupLast = celdas.filter((c) => c.includes('lg:group-last:border-b-0'))
    expect(conGroupLast).toHaveLength(12)
  })

  // Menor 3: `<TableRow>` traía `transition-colors` de fábrica; al mudar el
  // hover a cada celda (Task 4) se copió el color pero no la transición.
  it('el hover funde el color: transition-colors en cada celda', () => {
    const html = renderListado()
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(6)
    for (const celda of celdas) expect(celda).toContain('lg:transition-colors')
  })

  // Importante 2: sin `align-items` explícito el default de Grid es
  // `stretch`, así que cada celda se estira a la altura de la fila más
  // alta — pero el contenido de una celda de una sola línea queda pegado
  // ARRIBA de esa caja. Se centra con un envoltorio interno
  // (`lg:flex lg:h-full lg:items-center`), no achicando la celda
  // (`self-center` desalinearía su borde del resto de la fila — Importante
  // 1, arriba). Las 4 celdas más cortas que "Cliente" (que siempre muestra
  // dos líneas) llevan el envoltorio; "Cliente" no lo necesita. "Total" ya
  // no cuenta acá desde el ciclo del cobrado por moneda (Task 2): con dos
  // renglones posibles (Vendido/Cobrado) pasa a `flex flex-col items-end
  // lg:h-full lg:justify-center` — sigue centrando con un envoltorio interno
  // y sin achicar la celda, pero ya no calza con este patrón horizontal.
  it('las celdas más cortas que "Cliente" centran su contenido con un envoltorio interno, no achicando la celda', () => {
    const html = renderListado()
    const envoltorios = [...html.matchAll(/class="lg:flex lg:h-full lg:items-center[^"]*"/g)]
    expect(envoltorios, 'Número, Hora, Medios y Estado: 4 celdas más cortas que Cliente').toHaveLength(4)
    // Ninguna celda se achica para centrarse — `self-center` desalinearía
    // el borde inferior del resto de la fila (Importante 1).
    expect(html).not.toContain('self-center')
  })

  // El ciclo del cobrado por moneda (Task 2): con un solo renglón —toda
  // venta en pesos sin plan, la inmensa mayoría— la celda Total se ve
  // EXACTAMENTE como antes de este ciclo, sin ningún rótulo de por medio.
  it('con una sola línea, la celda Total no dibuja ningún rótulo', () => {
    const html = renderListado()
    expect(html).toContain('$ 103.900,00')
    expect(html).not.toContain('Vendido')
    expect(html).not.toContain('Cobrado')
  })

  // La columna Total medía 140px y el desglose no entraba: "$ 155.000,00 +
  // US$ 200,00" se partía en dos renglones, y con el rótulo ENCIMA de cada
  // importe la fila terminaba midiendo el doble que las demás. `Cliente` es
  // `1fr` y se quedaba con ~1.150px vacíos al lado, así que el ancho estaba
  // ahí para tomarlo.
  it('en escritorio el rótulo va en LÍNEA con su importe, no encima', () => {
    const html = renderListado({
      filas: [{
        ...FILA,
        totalLineas: [
          { rotulo: 'Vendido', valor: 'US$ 300,00' },
          { rotulo: 'Cobrado', valor: '$ 155.000,00 + US$ 200,00' },
        ],
      }],
    })
    // `lg:flex-row` es lo que los pone en la misma línea, y `lg:ml-auto` en el
    // importe es lo que lo empuja al borde derecho — con `justify-between` no
    // alcanzaría: una línea SIN rótulo tiene un solo hijo y quedaría a la
    // izquierda, que es justo el caso común de esta columna.
    expect(html).toContain('lg:flex-row')
    expect(html).toContain('lg:ml-auto')
  })

  it('en el teléfono el rótulo sigue APILADO sobre su importe', () => {
    const html = renderListado({
      filas: [{ ...FILA, totalLineas: [{ rotulo: 'Cobrado', valor: '$ 1,00' }] }],
    })
    // Mobile-first: el valor sin prefijo es el del teléfono. `flex-col` +
    // `items-end` sin `lg:` es la pila alineada a la derecha de 390px, que es
    // lo único que entra a ese ancho.
    const celda = html.match(/class="flex flex-col items-end[^"]*"/g) ?? []
    expect(celda.length).toBeGreaterThan(0)
    for (const c of celda) expect(c).not.toMatch(/(^|\s)flex-row/)
  })

  it('con dos líneas, dibuja los rótulos y Vendido va ARRIBA de Cobrado', () => {
    const html = renderListado({
      filas: [{
        ...FILA,
        totalLineas: [
          { rotulo: 'Vendido', valor: 'US$ 300,00' },
          { rotulo: 'Cobrado', valor: '$ 148.500,00 + US$ 200,00' },
        ],
      }],
    })
    const posVendido = html.indexOf('Vendido')
    const posCobrado = html.indexOf('Cobrado')
    expect(posVendido).toBeGreaterThan(-1)
    expect(posCobrado).toBeGreaterThan(posVendido)
    expect(html).toContain('$ 148.500,00 + US$ 200,00')
  })
})

describe('la consulta del panel de horarios', () => {
  const fuente = readFileSync('app/(app)/ventas/page.tsx', 'utf8')

  it('excluye las anuladas, como el panel de medios', () => {
    // Una venta anulada no fue una venta a esa hora. Si esta consulta se
    // escribiera con `donde` a secas, el panel contaría ventas que el tile de
    // arriba ya descuenta.
    //
    // Se afirma con un regex tolerante al formato —`\s+` entre las dos
    // propiedades— y no con el string literal: prettier decide dónde parte la
    // línea, y un test que se rompa al reformatear el archivo es un test que
    // se termina ignorando.
    expect(fuente).toMatch(/where:\s*\{\s*\.\.\.donde,\s*anuladaEn:\s*null\s*\},\s*select:\s*\{\s*creadoEn:\s*true\s*\}/)
  })

  it('preserva la vista en los links de rango, de página, de moneda y en el filtro de fechas', () => {
    // Sin esto, tocar "7 días", pasar de página, cambiar de moneda o filtrar
    // por fecha devuelve a la vista Hora sin que nadie lo haya pedido. Cuatro
    // apariciones, una por sitio: `conPagina`, `hrefRango`, `hrefDeMoneda`
    // (Task 3 del ciclo del dashboard) y el campo oculto de
    // `FormularioDeFechas` (Hallazgo 4 de la review final — el filtro de
    // fechas era el único de los tres caminos que todavía perdía la vista, en
    // su momento). Se cuentan las CUATRO y no se afirma "al menos una" —
    // gatear una sola y dejar las otras sueltas es exactamente el modo de
    // falla que este repo ya pagó con las dos copias de un botón.
    expect(fuente.match(/vista !== 'hora'/g) ?? []).toHaveLength(4)
  })

  it('preserva la moneda en el filtro de fechas, sin escribirla cuando es la default', () => {
    // El mismo argumento que ya vale para `vista` (Task 3 del ciclo del
    // dashboard): un local mirando el panel en US$ que filtra por fecha no
    // puede volver a pesos sin que nadie lo pida.
    expect(fuente).toContain("moneda !== 'ars' && <input type=\"hidden\" name=\"moneda\" value={moneda} />")
  })
})

// El resto de los cambios del ciclo móvil viven directo en `Ventas` (un
// Server Component async que no se puede montar fuera de un request real,
// ver el comentario de arriba de todo), así que se verifican sobre el
// fuente — mismo criterio que ya usa
// app/(app)/servicio-tecnico/page.test.tsx.
describe('page.tsx: los cambios de layout del ciclo móvil (Task 4)', () => {
  const FUENTE = readFileSync('app/(app)/ventas/page.tsx', 'utf8')

  it('no queda ningún import de @/components/ui/table', () => {
    expect(FUENTE).not.toMatch(/@\/components\/ui\/table/)
  })

  it('el formulario de fechas es hidden lg:flex en escritorio', () => {
    expect(FUENTE).toContain("hidden items-end gap-[10px] lg:flex")
  })

  it('hay un botón de 38px, lg:hidden, que abre el Sheet con las fechas', () => {
    expect(FUENTE).toMatch(/size-\[38px\][^`]*lg:hidden/)
    expect(FUENTE).toContain('<Sheet>')
    expect(FUENTE).toContain('<SheetTrigger')
  })

  it('los chips de rango son flex-1 lg:flex-none', () => {
    expect(FUENTE).toContain('flex-1 rounded-lg bg-card')
    expect(FUENTE).toContain('lg:flex-none')
  })

  it('los tiles se apilan en el teléfono y vuelven a una fila en escritorio', () => {
    expect(FUENTE).toContain('flex flex-col gap-3 lg:flex-row lg:gap-4')
  })
})
