// Puro: importa las funciones y componentes exportados de page.tsx, nunca el
// componente de página en sí — es un Server Component async que abre sesión
// y consulta Prisma, y este repo no tiene el arnés para montarlo fuera de un
// request real (mismo criterio que app/(app)/inventario/page.test.tsx y
// app/(app)/ventas/page.test.tsx). El bloque final lee el FUENTE como texto
// para cablear detalles que ningún test puro puede ejercitar sin una sesión
// real (mismo criterio que esos dos archivos).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { EstadoOrden } from '@/generated/prisma/client'
import { NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import {
  esEstado,
  hrefTablero,
  contarAbiertas,
  rotuloAntiguedad,
  subtituloDelTablero,
  etiquetaDelConjunto,
  rotuloDeRango,
  notaDelConjunto,
  ventanaDePaginas,
  FilaDeChips,
  ChipDeFiltroMovil,
  CeldaDeEstado,
  Listado,
} from './page'

describe('esEstado', () => {
  it('reconoce cualquiera de los nueve estados', () => {
    expect(esEstado('RECIBIDO')).toBe(true)
    expect(esEstado('ENTREGADO')).toBe(true)
  })

  it('cualquier otra cosa NO es un estado: un query string a mano no puede colarse', () => {
    expect(esEstado(undefined)).toBe(false)
    expect(esEstado('')).toBe(false)
    expect(esEstado('CUALQUIER_COSA')).toBe(false)
  })
})

describe('hrefTablero', () => {
  it('sin nada, apunta a /servicio-tecnico pelado', () => {
    expect(hrefTablero({ busqueda: '', estado: null })).toBe('/servicio-tecnico')
  })

  it('preserva la búsqueda', () => {
    expect(hrefTablero({ busqueda: 'motorola', estado: null })).toBe('/servicio-tecnico?q=motorola')
  })

  it('agrega el estado cuando hay uno', () => {
    expect(hrefTablero({ busqueda: '', estado: 'LISTO' })).toContain('estado=LISTO')
  })

  it('la página sólo aparece si es mayor a 1', () => {
    expect(hrefTablero({ busqueda: '', estado: null, pagina: 1 })).toBe('/servicio-tecnico')
    expect(hrefTablero({ busqueda: '', estado: null, pagina: 2 })).toContain('p=2')
  })

  it('combina los tres a la vez', () => {
    const href = hrefTablero({ busqueda: 'iphone', estado: 'EN_REPARACION', pagina: 3 })
    expect(href).toContain('q=iphone')
    expect(href).toContain('estado=EN_REPARACION')
    expect(href).toContain('p=3')
  })
})

describe('contarAbiertas', () => {
  it('suma todos los estados abiertos', () => {
    const cuenta = new Map<EstadoOrden, number>([
      ['RECIBIDO', 4],
      ['EN_DIAGNOSTICO', 3],
      ['PRESUPUESTADO', 2],
      ['APROBADO', 1],
      ['EN_REPARACION', 5],
      ['LISTO', 3],
    ])
    expect(contarAbiertas(cuenta)).toBe(4 + 3 + 2 + 1 + 5 + 3)
  })

  // La decisión ya tomada del módulo, que el brief pide explícitamente no
  // tocar: "Abiertas" nunca cuenta las entregadas.
  it('NO suma ENTREGADO, aunque tenga el número más grande de todos', () => {
    const cuenta = new Map<EstadoOrden, number>([
      ['RECIBIDO', 4],
      ['ENTREGADO', 999_999],
    ])
    expect(contarAbiertas(cuenta)).toBe(4)
  })

  it('un estado sin entrada en el Map cuenta como 0, no como undefined', () => {
    expect(contarAbiertas(new Map())).toBe(0)
  })
})

describe('rotuloAntiguedad', () => {
  it('0 días es "hoy"', () => {
    expect(rotuloAntiguedad(0)).toBe('hoy')
  })

  it('1 día es singular', () => {
    expect(rotuloAntiguedad(1)).toBe('hace 1 día')
  })

  it('el ejemplo de la maqueta: 23 días', () => {
    expect(rotuloAntiguedad(23)).toBe('hace 23 días')
  })
})

describe('subtituloDelTablero', () => {
  it('sin ninguna abierta, no dice nada: media verdad es peor que nada', () => {
    expect(subtituloDelTablero(0, 23)).toBeUndefined()
  })

  it('sin fecha de la más vieja (masViejo nulo), no dice nada', () => {
    expect(subtituloDelTablero(18, null)).toBeUndefined()
  })

  it('el ejemplo de la maqueta: "18 equipos en el local · el más viejo hace 23 días"', () => {
    expect(subtituloDelTablero(18, 23)).toBe('18 equipos en el local · el más viejo hace 23 días')
  })

  it('1 equipo es singular', () => {
    expect(subtituloDelTablero(1, 5)).toBe('1 equipo en el local · el más viejo hace 5 días')
  })

  it('el más viejo entrando hoy no dice "hace 0 días"', () => {
    expect(subtituloDelTablero(3, 0)).toBe('3 equipos en el local · el más viejo, hoy')
  })
})

describe('etiquetaDelConjunto', () => {
  it('el default (sin chip, sin buscar) es "órdenes abiertas"', () => {
    expect(etiquetaDelConjunto(null, false, 18)).toBe('órdenes abiertas')
  })

  it('singular con una sola abierta', () => {
    expect(etiquetaDelConjunto(null, false, 1)).toBe('orden abierta')
  })

  it('con un chip puntual, nombra el estado', () => {
    expect(etiquetaDelConjunto('LISTO', false, 3)).toBe('órdenes «Listo»')
  })

  it('buscando en todas, no dice "abiertas": ya no lo son todas', () => {
    expect(etiquetaDelConjunto(null, true, 7)).toBe('órdenes')
  })
})

describe('rotuloDeRango', () => {
  it('el texto exacto de la maqueta: "1–18 de 18 órdenes abiertas"', () => {
    expect(rotuloDeRango(1, 18, 18, null, false)).toBe('1–18 de 18 órdenes abiertas')
  })
})

describe('notaDelConjunto', () => {
  it('el texto exacto de la maqueta, en el default', () => {
    expect(notaDelConjunto(null, false)).toBe('Las entregadas no se listan por defecto')
  })

  it('con un chip puntual, no hay nota: dejaría de ser cierta', () => {
    expect(notaDelConjunto('LISTO', false)).toBeNull()
  })

  it('buscando en todas, tampoco: ya se están viendo entregadas', () => {
    expect(notaDelConjunto(null, true)).toBeNull()
  })
})

describe('ventanaDePaginas', () => {
  it('centra la ventana en la página actual', () => {
    expect(ventanaDePaginas(5, 10)).toEqual([3, 4, 5, 6, 7])
  })

  it('sin páginas, ventana vacía', () => {
    expect(ventanaDePaginas(1, 0)).toEqual([])
  })
})

/**
 * El bloque de `<a ...>...</a>` de UN chip, ubicado por su rótulo — nunca por
 * su conteo, porque dos chips en cero comparten "0" y el rótulo es lo único
 * que no se repite (mismo criterio que `claseDelLink` en
 * app/(app)/inventario/page.test.tsx, adaptado: acá el ancla se abre con
 * `<a ` en vez de cerrarse, porque el conteo va DESPUÉS del rótulo).
 */
function bloqueDelChip(html: string, rotulo: string): string {
  const idx = html.indexOf(`>${rotulo}<`)
  expect(idx, `no se encontró el chip "${rotulo}"`).toBeGreaterThan(-1)
  const desde = html.lastIndexOf('<a ', idx)
  expect(desde, `no se encontró el <a> que envuelve "${rotulo}"`).toBeGreaterThan(-1)
  const hasta = html.indexOf('</a>', idx) + '</a>'.length
  return html.slice(desde, hasta)
}

/**
 * Sólo la etiqueta `<a ...>` de apertura de un chip —el `class` del RÓTULO—,
 * sin el `<span>` del conteo que `bloqueDelChip` también incluye. Hace falta
 * aparte: el rótulo y el conteo tienen su propio ternario `cero ? … : …`
 * cada uno (ver ChipDeFiltro), y un chip que pintara bien el conteo pero mal
 * el rótulo pasaría desapercibido si sólo se mirara el bloque entero.
 */
function aperturaDelChip(html: string, rotulo: string): string {
  const bloque = bloqueDelChip(html, rotulo)
  return bloque.slice(0, bloque.indexOf('>') + 1)
}

describe('FilaDeChips', () => {
  const CUENTA_COMPLETA: Partial<Record<EstadoOrden, number>> = {
    RECIBIDO: 4,
    EN_DIAGNOSTICO: 3,
    PRESUPUESTADO: 2,
    APROBADO: 1,
    EN_REPARACION: 5,
    LISTO: 3,
    ENTREGADO: 212,
    SIN_REPARACION: 0,
    RECHAZADO: 0,
  }

  // El requisito explícito de la task: recorrer los nueve, uno por uno — no
  // sólo comprobar que "algún chip" muestra "algún número".
  it('cada uno de los nueve chips de estado muestra el conteo que le corresponde, no otro', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={CUENTA_COMPLETA} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    for (const [estado, cuenta] of Object.entries(CUENTA_COMPLETA)) {
      const bloque = bloqueDelChip(html, NOMBRE_ESTADO[estado as EstadoOrden])
      expect(bloque, `el chip de ${estado} no muestra ${cuenta}`).toContain(`>${cuenta}<`)
    }
  })

  it('"Abiertas" muestra lo que se le pasa, no la suma de `cuenta`', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={999} cuenta={{ RECIBIDO: 1 }} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    expect(bloqueDelChip(html, 'Abiertas')).toContain('>999<')
  })

  it('un chip en cero se pinta muted, en el RÓTULO y en el conteo', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips
        abiertas={5}
        cuenta={{ SIN_REPARACION: 0 }}
        filtro={null}
        buscandoEnTodas={false}
        busqueda=""
      />,
    )
    // El bloque entero (rótulo + conteo): alcanza para saber que ALGO ahí
    // adentro es muted.
    expect(bloqueDelChip(html, 'Sin reparación')).toContain('text-muted-foreground')
    // Y la apertura sola —sin el <span> del conteo—: el RÓTULO en sí tiene
    // que ser muted, no sólo el número. Ver el comentario de
    // aperturaDelChip: son dos ternarios independientes en el código.
    expect(aperturaDelChip(html, 'Sin reparación')).toContain('text-muted-foreground')
  })

  it('un chip con conteo > 0 NO se pinta muted, ni en el rótulo ni en el conteo: se distingue del vacío', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={5} cuenta={{ RECIBIDO: 4 }} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    expect(bloqueDelChip(html, 'Recibido')).not.toContain('text-muted-foreground')
    expect(aperturaDelChip(html, 'Recibido')).not.toContain('text-muted-foreground')
  })

  it('con filtro null y sin buscar en todas, "Abiertas" es el seleccionado (bg-primary)', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    const abiertas = bloqueDelChip(html, 'Abiertas')
    expect(abiertas).toContain('aria-current')
    expect(abiertas).toContain('bg-primary')
  })

  // Hallazgo M9 de la review final: "page" es más específico que "true", y es
  // el mismo valor que ya usa el número de página actual de la paginación.
  it('el chip seleccionado usa aria-current="page", no "true"', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    const abiertas = bloqueDelChip(html, 'Abiertas')
    expect(abiertas).toContain('aria-current="page"')
  })

  it('con un chip de estado elegido, ESE queda seleccionado y "Abiertas" no', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={5} cuenta={{ LISTO: 3 }} filtro="LISTO" buscandoEnTodas={false} busqueda="" />,
    )
    const abiertas = bloqueDelChip(html, 'Abiertas')
    expect(abiertas).not.toContain('aria-current')
    expect(abiertas).toContain('bg-card')

    const listo = bloqueDelChip(html, 'Listo')
    expect(listo).toContain('aria-current')
    expect(listo).toContain('bg-primary')
  })

  it('buscando en todas, ningún chip queda seleccionado (ni siquiera "Abiertas")', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={true} busqueda="motorola" />,
    )
    expect(bloqueDelChip(html, 'Abiertas')).not.toContain('aria-current')
  })

  it('el href de "Abiertas" nunca arrastra la búsqueda vigente', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={true} busqueda="motorola" />,
    )
    const abiertas = bloqueDelChip(html, 'Abiertas')
    expect(abiertas).toContain('href="/servicio-tecnico"')
    expect(abiertas).not.toContain('q=motorola')
  })

  it('el href de un chip de estado SÍ preserva la búsqueda vigente', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={true} busqueda="motorola" />,
    )
    expect(bloqueDelChip(html, 'Listo')).toContain('q=motorola')
  })

  // Task 8 del ciclo móvil: FilaDeChips ahora renderiza los mismos diez
  // chips DOS veces — una con ChipDeFiltro (pastilla, sólo escritorio) y
  // otra con ChipDeFiltroMovil (card, sólo teléfono). `bloqueDelChip`
  // encuentra siempre la PRIMERA ocurrencia de cada rótulo, que tiene que
  // seguir siendo la pastilla de escritorio (por eso los tests de arriba no
  // cambiaron) — y estos dos tests nuevos cierran el resto: que el bloque
  // del teléfono exista, y que quede oculto por CSS en cada ancho.
  it('el bloque de escritorio queda oculto por default (hidden) y visible a partir de lg (lg:flex)', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    expect(html).toContain('hidden flex-wrap items-center gap-2 lg:flex')
  })

  it('el bloque del teléfono es una grilla de 3 columnas, oculta a partir de lg (lg:hidden)', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{}} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    expect(html).toContain('grid grid-cols-3 gap-2 lg:hidden')
  })

  it('cada rótulo aparece dos veces: una en la pastilla de escritorio, otra en la card del teléfono', () => {
    const html = renderToStaticMarkup(
      <FilaDeChips abiertas={18} cuenta={{ RECIBIDO: 4 }} filtro={null} buscandoEnTodas={false} busqueda="" />,
    )
    expect(html.match(/>Recibido</g)).toHaveLength(2)
    expect(html.match(/>Abiertas</g)).toHaveLength(2)
  })
})

/**
 * Task 8 del ciclo móvil: la card de un chip de filtro en el teléfono. Ver
 * el docblock de `ChipDeFiltroMovil` en page.tsx para el porqué de no
 * compartir árbol con `ChipDeFiltro`.
 */
describe('ChipDeFiltroMovil (Task 8 del ciclo móvil)', () => {
  it('muestra el conteo formateado y el rótulo', () => {
    const html = renderToStaticMarkup(
      <ChipDeFiltroMovil href="/servicio-tecnico?estado=ENTREGADO" rotulo="Entregado" cuenta={1234} seleccionado={false} />,
    )
    expect(html).toContain('1.234')
    expect(html).toContain('Entregado')
  })

  it('seleccionado: fondo bg-primary y aria-current="page"', () => {
    const html = renderToStaticMarkup(
      <ChipDeFiltroMovil href="/servicio-tecnico" rotulo="Abiertas" cuenta={18} seleccionado={true} />,
    )
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('bg-primary')
  })

  it('no seleccionado: sin aria-current, fondo bg-card', () => {
    const html = renderToStaticMarkup(
      <ChipDeFiltroMovil href="/servicio-tecnico?estado=RECIBIDO" rotulo="Recibido" cuenta={4} seleccionado={false} />,
    )
    expect(html).not.toContain('aria-current')
    expect(html).toContain('bg-card')
  })

  /** El `<span>` que envuelve `texto`, ubicado por su contenido — para poder
   *  mirar SU className en particular, sin confundirlo con el otro `<span>`
   *  de la misma card (mismo criterio que `bloqueDelChip`/`aperturaDelChip`
   *  de más arriba, adaptado a un solo elemento). */
  function spanDe(html: string, texto: string): string {
    const idx = html.indexOf(`>${texto}<`)
    expect(idx, `no se encontró "${texto}" en: ${html}`).toBeGreaterThan(-1)
    const desde = html.lastIndexOf('<span', idx)
    expect(desde, `no se encontró el <span> de "${texto}"`).toBeGreaterThan(-1)
    return html.slice(desde, idx + `>${texto}<`.length)
  }

  // La divergencia a propósito con el chip de escritorio (ver el docblock):
  // acá el conteo NUNCA se apaga a muted, tenga cero o no.
  it('con conteo en cero, el CONTEO no se pinta muted — a diferencia del chip de escritorio', () => {
    const html = renderToStaticMarkup(
      <ChipDeFiltroMovil href="/servicio-tecnico?estado=SIN_REPARACION" rotulo="Sin reparación" cuenta={0} seleccionado={false} />,
    )
    expect(spanDe(html, '0')).not.toContain('text-muted-foreground')
  })

  it('con conteo > 0, el RÓTULO igual se pinta muted — a diferencia del chip de escritorio', () => {
    const html = renderToStaticMarkup(
      <ChipDeFiltroMovil href="/servicio-tecnico?estado=RECIBIDO" rotulo="Recibido" cuenta={4} seleccionado={false} />,
    )
    expect(spanDe(html, 'Recibido')).toContain('text-muted-foreground')
  })
})

/** Una fila mínima, ya resuelta a texto — la forma que `Listado` recibe de
 *  verdad, sin ningún `Date` de Prisma cruzando a un fixture de test (mismo
 *  criterio que `FILA` en app/(app)/ventas/page.test.tsx). */
const FILA_ORDEN: Parameters<typeof Listado>[0]['filas'][number] = {
  id: 'o1',
  numero: 221,
  estado: 'EN_REPARACION',
  anulada: false,
  equipoLabel: 'Samsung A54',
  imeiLabel: 'IMEI 356938035643809',
  clienteNombre: 'Marcos Vera',
  clienteTelefono: '11 5412-9087',
  fechaFormateada: '29/07/2026',
  antiguedadLabel: 'hace 23 días',
}

function renderListado(props: Partial<Parameters<typeof Listado>[0]> = {}) {
  return renderToStaticMarkup(
    <Listado
      filas={[FILA_ORDEN]}
      total={1}
      pagina={1}
      paginas={1}
      porPagina={50}
      filtro={null}
      buscandoEnTodas={false}
      busqueda=""
      {...props}
    />,
  )
}

/**
 * Task 8 del ciclo móvil: el patrón de listado de la Task 4 — grid en
 * escritorio, tarjetas apiladas en el teléfono, resuelto con
 * `display:contents` sobre el MISMO árbol (design/arandano.pen, frame
 * `F9BzV`). Ver el docblock de `Listado` en page.tsx.
 */
describe('Listado (Task 8 del ciclo móvil): el patrón grid + display:contents', () => {
  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 5 en escritorio', () => {
    const html = renderListado()
    expect(html).toContain('role="table"')
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[78px_1fr_190px_150px_170px\]/)
  })

  it('el encabezado está oculto en el teléfono y se disuelve en escritorio', () => {
    const html = renderListado()
    expect(html).toContain('role="row" class="hidden lg:contents"')
  })

  it('hay tantos role="columnheader" como columnas declara el grid (5)', () => {
    const html = renderListado()
    expect(html.match(/role="columnheader"/g)).toHaveLength(5)
  })

  it('toda fila de datos lleva lg:contents y role="row"', () => {
    const html = renderListado({ filas: [FILA_ORDEN, { ...FILA_ORDEN, id: 'o2', numero: 228 }], total: 2 })
    // El encabezado + las dos filas de datos: las tres son role="row" y las
    // tres llevan lg:contents.
    const filas = html.match(/role="row" class="[^"]*"/g) ?? []
    expect(filas).toHaveLength(3)
    for (const fila of filas) expect(fila).toContain('lg:contents')
  })

  it('cada fila de datos tiene 5 celdas con role="cell", tantas como columnheader', () => {
    const html = renderListado()
    expect(html.match(/role="cell"/g)).toHaveLength(5)
  })

  it('la fila resalta al pasar el mouse en escritorio (group + group-hover en las 5 celdas)', () => {
    const html = renderListado()
    expect(html).toContain('role="row" class="group ')
    const celdasDeDatos = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdasDeDatos).toHaveLength(5)
    for (const celda of celdasDeDatos) expect(celda).toContain('lg:group-hover:bg-muted/50')
  })

  it('el borde entre filas vive en cada celda, no en la fila (escritorio)', () => {
    const html = renderListado({ filas: [FILA_ORDEN, { ...FILA_ORDEN, id: 'o2', numero: 228 }], total: 2 })
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(10) // 5 columnas × 2 filas
    for (const celda of celdas) expect(celda).toContain('lg:border-b')
    const conGroupLast = celdas.filter((c) => c.includes('lg:group-last:border-b-0'))
    expect(conGroupLast).toHaveLength(10)
  })

  it('el hover funde el color: transition-colors en cada celda', () => {
    const html = renderListado()
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    for (const celda of celdas) expect(celda).toContain('lg:transition-colors')
  })

  it('las celdas más cortas que "Equipo" y "Cliente" centran su contenido con un envoltorio interno, no achicando la celda', () => {
    const html = renderListado()
    // Orden y Estado son las dos celdas de una sola línea; Equipo, Cliente e
    // Ingresó siempre muestran dos (no necesitan el envoltorio).
    const envoltorios = [...html.matchAll(/class="lg:flex lg:h-full lg:items-center[^"]*"/g)]
    expect(envoltorios).toHaveLength(2)
    expect(html).not.toContain('self-center')
  })

  it('muestra número, equipo, cliente, teléfono, fecha, antigüedad y el chip de estado', () => {
    const html = renderListado()
    expect(html).toContain('#221')
    expect(html).toContain('Samsung A54')
    expect(html).toContain('Marcos Vera')
    expect(html).toContain('11 5412-9087')
    expect(html).toContain('29/07/2026')
    expect(html).toContain('hace 23 días')
    expect(html).toContain('IMEI 356938035643809')
  })

  // Ronda de arreglos 1 (Menor, calibrado por el revisor): la primera
  // versión de este test afirmaba sobre un contenedor "línea 1" con
  // `lg:hidden` que ya no existe — Orden, Equipo y Cliente pasaron a ser las
  // MISMAS celdas en los dos anchos (ver el docblock de Listado), así que lo
  // que hay que afirmar ahora es que esas celdas siguen presentes (no
  // `display:none`) y que sus piezas aparecen en el orden esperado, más las
  // dos piezas que sí quedaron duplicadas (chip y meta).
  it('en el teléfono: Orden+Equipo+chip fluyen en una línea, Cliente+teléfono se funden, y la Meta (IMEI+ingreso) es una línea aparte', () => {
    const html = renderListado()
    // Orden, Equipo y Cliente son celdas reales (role="cell"), no divs
    // `lg:hidden` — la fila SIGUE teniendo owned elements válidos en el
    // teléfono, a diferencia de la primera versión de este código.
    const numero = html.indexOf('>#221<')
    const equipo = html.indexOf('Samsung A54')
    const chip = html.indexOf('En reparación')
    const cliente = html.indexOf('Marcos Vera')
    const separador = html.indexOf('lg:hidden">· ')
    const telefono = html.indexOf('11 5412-9087')
    for (const idx of [numero, equipo, chip, cliente, separador, telefono]) {
      expect(idx).toBeGreaterThan(-1)
    }
    // El orden de flujo: número, luego equipo, luego el chip duplicado, y
    // recién después el teléfono (Cliente es su propia celda con
    // `basis-full`, forzando su propio renglón).
    expect(numero).toBeLessThan(equipo)
    expect(equipo).toBeLessThan(chip)
    expect(chip).toBeLessThan(cliente)
    expect(cliente).toBeLessThan(separador)
    expect(separador).toBeLessThan(telefono)
    // La Meta: IMEI + fecha + antigüedad, combinados — datos que en
    // escritorio viven en celdas DISTINTAS (Equipo e Ingresó).
    expect(html).toContain('IMEI 356938035643809 · ingresó 29/07/2026 · hace 23 días')
  })

  // El hallazgo puntual de la review: antes NINGUNA celda real sobrevivía en
  // el teléfono (las cinco eran `hidden lg:block`), así que la fila se
  // quedaba sin ningún `role="cell"` alcanzable ahí —sin *owned elements*
  // válidos para `role="row"`—. Ahora Orden, Equipo y Cliente son las
  // MISMAS celdas en los dos anchos: siguen ahí.
  it('Orden, Equipo y Cliente son celdas reales en el teléfono (no `display:none`): la fila no se queda sin owned elements', () => {
    const html = renderListado()
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(5)
    const [orden, equipo, cliente, ingreso, estado] = celdas
    for (const celda of [orden, equipo, cliente]) {
      expect(celda).not.toContain('hidden')
    }
    // Ingresó y Estado SÍ siguen ocultas en el teléfono: sus datos ya salen
    // duplicados en la línea 1 (chip) y en la Meta (fecha/antigüedad).
    for (const celda of [ingreso, estado]) {
      expect(celda).toContain('hidden')
    }
  })

  it('sin IMEI, la meta del teléfono y la celda de escritorio dicen "Sin IMEI"', () => {
    const html = renderListado({ filas: [{ ...FILA_ORDEN, imeiLabel: 'Sin IMEI' }] })
    expect(html).toContain('Sin IMEI · ingresó 29/07/2026 · hace 23 días')
  })

  it('una orden anulada usa CeldaDeEstado (neutro, "Anulada (…)") en las dos líneas de estado', () => {
    const html = renderListado({ filas: [{ ...FILA_ORDEN, anulada: true }] })
    expect(html.match(/Anulada \(En reparación\)/g)).toHaveLength(2) // línea 1 (teléfono) + celda Estado (escritorio)
  })

  it('sin equipos, lo dice — y no confunde ese vacío con una página fuera de rango', () => {
    expect(renderListado({ filas: [], total: 0 })).toContain('No hay equipos que mostrar con estos filtros.')
  })

  it('buscando en todas sin resultados, lo dice con la búsqueda entre comillas', () => {
    const html = renderListado({ filas: [], total: 0, buscandoEnTodas: true, busqueda: 'motorola' })
    expect(html).toContain('No apareció ninguna orden con «motorola».')
  })

  // Hallazgo M8 del barrido final (ver el historial de este archivo): con
  // `total > 0` la página quedó fuera de rango, y ese vacío tiene que ofrecer
  // un link de vuelta — distinto del mensaje de "no hay nada" a secas.
  it('con la página fuera de rango, ofrece volver a la primera', () => {
    const html = renderListado({ filas: [], total: 5, pagina: 9 })
    expect(html).toContain('Esta página no tiene equipos.')
    expect(html).toContain('href="/servicio-tecnico"')
    expect(html).not.toContain('href="/servicio-tecnico?p=9"')
  })

  it('con un filtro de estado activo, "volver a la primera" preserva ese filtro', () => {
    const html = renderListado({ filas: [], total: 5, pagina: 9, filtro: 'LISTO' })
    expect(html).toContain('href="/servicio-tecnico?estado=LISTO"')
  })
})

/**
 * Hallazgo I5 de la review final: el test viejo prometía "una fila anulada NO
 * usa el chip de color del estado" y su cuerpo sólo comprobaba
 * `toContain('o.anuladaEn ?')` — una mutación que igualaba las dos ramas del
 * ternario seguía en verde. `CeldaDeEstado` se extrajo a un componente
 * EXPORTADO para poder renderizarlo de verdad con `renderToStaticMarkup` y
 * comprobar QUÉ se pinta, no que el código tenga forma de ternario.
 */
describe('CeldaDeEstado (hallazgo I5 de la review final)', () => {
  it('anulada: se pinta neutro con "Anulada (Estado)", sin el color de ESTADO_VISUAL', () => {
    const html = renderToStaticMarkup(<CeldaDeEstado estado="LISTO" anulada={true} />)
    expect(html).toContain('Anulada (Listo)')
    // LISTO se pinta bg-ok-soft/text-ok en ESTADO_VISUAL: una fila anulada no
    // puede llevar ese color, porque mentiría sobre una orden que ya no está
    // viva.
    expect(html).not.toContain('bg-ok-soft')
    expect(html).not.toContain('text-ok')
  })

  it('viva: usa el chip de color e ícono de ESTADO_VISUAL, y no dice "Anulada"', () => {
    const html = renderToStaticMarkup(<CeldaDeEstado estado="LISTO" anulada={false} />)
    expect(html).toContain('bg-ok-soft')
    expect(html).not.toContain('Anulada')
  })

  // Un segundo estado, para no atar el caso a un solo color/ícono.
  it('recorre otro estado: EN_REPARACION anulada tampoco lleva su color (warn)', () => {
    const html = renderToStaticMarkup(<CeldaDeEstado estado="EN_REPARACION" anulada={true} />)
    expect(html).toContain('Anulada (En reparación)')
    expect(html).not.toContain('bg-warn-soft')
  })
})

describe('el listado pide y usa lo que la fila del rediseño necesita (Task 2 del ciclo)', () => {
  const FUENTE = readFileSync('app/(app)/servicio-tecnico/page.tsx', 'utf8')

  it('el select trae el IMEI del equipo y el teléfono del cliente', () => {
    expect(FUENTE).toMatch(/equipoSerie:\s*true/)
    expect(FUENTE).toMatch(/telefono:\s*true/)
  })

  it('el listado usa CeldaDeEstado para pintar la columna ESTADO', () => {
    expect(FUENTE).toContain('<CeldaDeEstado')
  })

  it('el buscador muestra la ayuda permanente, no sólo el aviso de después de buscar', () => {
    expect(FUENTE).toContain('Buscar alcanza también a las entregadas y anuladas')
  })

  // Ronda de arreglos 1 (Importante): el Step 1 del brief pedía explícitamente
  // "el buscador ocupa el ancho y conserva su nota" entre los casos que
  // tienen que fallar primero, y se implementó sin que ningún test lo
  // cubriera. Sin esto, una edición futura que devuelva el buscador a una
  // sola fila en el teléfono pasa `npm test` sin que nada chiste.
  it('el buscador apila en columna en el teléfono (input a lo ancho, nota debajo) y vuelve a una fila en escritorio', () => {
    expect(FUENTE).toContain('flex flex-col gap-[6px] lg:flex-row lg:items-center lg:gap-[10px]')
    // El campo ocupa el ancho completo del teléfono.
    expect(FUENTE).toContain('h-10 w-full rounded-[9px] border-input bg-card pl-9 text-sm')
    // La nota permanente, junto al campo: sólo se encoge (no se corta ni se
    // arrastra a otra fila) a partir de escritorio.
    expect(FUENTE).toContain('text-[11px] text-muted-foreground lg:shrink-0')
  })

  // Task 8 del ciclo móvil: el <Table> de shadcn se reemplazó por el patrón
  // grid + display:contents (ver describe('Listado') más abajo), así que
  // esta aserción se dio vuelta — ahora afirma que NO queda ningún rastro
  // de la tabla vieja, no que siga estando.
  it('el listado ya no usa <Table> de shadcn: el patrón grid + display:contents lo reemplazó', () => {
    expect(FUENTE).not.toMatch(/@\/components\/ui\/table/)
    expect(FUENTE).toContain('role="table"')
  })
})
