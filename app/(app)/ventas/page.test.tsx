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
    const pie = pieDeCobradas('1284500', 44)
    expect(pie).toMatch(/^promedio \$/)
    expect(pie).toContain('29.193,18')
  })

  it('sin ninguna venta cobrada no hay promedio que mostrar, y no NaN', () => {
    // Todo el período pudo haberse anulado entero: 0 cobradas es un estado
    // real, no un caso imposible. "promedio $ NaN" es peor que ningún pie.
    expect(pieDeCobradas('0', 0)).toBeUndefined()
  })
})

describe('pieDeAnuladas', () => {
  it('formatea lo devuelto, no el total del período', () => {
    const pie = pieDeAnuladas('61200')
    expect(pie).toContain('61.200,00')
    expect(pie).toContain('devueltos')
  })

  it('sin anuladas, devuelve $ 0,00 y no rompe', () => {
    expect(pieDeAnuladas('0')).toContain('0,00')
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

/** Una fila mínima, ya resuelta a texto — la forma que `Listado` recibe de
 *  verdad, sin ningún `Decimal` de Prisma cruzando a un fixture de test. */
const FILA: Parameters<typeof Listado>[0]['filas'][number] = {
  id: 'v1',
  numero: 1042,
  horaFormateada: '14:32',
  clienteNombre: 'Consumidor final',
  itemsLabel: '3 artículos',
  mediosLabel: 'Efectivo',
  totalFormateado: '$ 103.900,00',
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
    const html = renderToStaticMarkup(<Tile rotulo="Ventas cobradas" valor="44" pie="promedio $ 29.193,18" />)
    const pie = html.match(/<div class="([^"]*)">promedio \$ 29\.193,18<\/div>/)
    expect(pie, `no se encontró el <div> del pie en: ${html}`).not.toBeNull()
    const clases = pie![1]
    for (const c of ['text-[10px]', 'leading-[1.3]', 'lg:text-[11px]', 'lg:leading-normal']) {
      expect(clases, `falta "${c}" en "${clases}"`).toContain(c)
    }
  })

  it('el tile de marca ("Total del período") no cambia: su pie sigue en 11px en los dos anchos', () => {
    const html = renderToStaticMarkup(<Tile marca rotulo="Total del período" valor="$ 1.284.500,00" pie="sin contar las anuladas" />)
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
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[84px_110px_1fr_168px_140px_104px\]/)
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
  // 1, arriba). Las 5 celdas más cortas que "Cliente" (que siempre muestra
  // dos líneas) llevan el envoltorio; "Cliente" no lo necesita.
  it('las celdas más cortas que "Cliente" centran su contenido con un envoltorio interno, no achicando la celda', () => {
    const html = renderListado()
    const envoltorios = [...html.matchAll(/class="lg:flex lg:h-full lg:items-center[^"]*"/g)]
    expect(envoltorios, 'Número, Hora, Medios, Total y Estado: 5 celdas más cortas que Cliente').toHaveLength(5)
    // Ninguna celda se achica para centrarse — `self-center` desalinearía
    // el borde inferior del resto de la fila (Importante 1).
    expect(html).not.toContain('self-center')
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
