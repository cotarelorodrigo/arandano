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
  CeldaDeEstado,
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

  it('el listado usa <Table>, no el <ul> plano de antes del rediseño', () => {
    expect(FUENTE).toMatch(/<Table\b/)
  })
})

describe('el vacío por página fuera de rango ofrece una salida (hallazgo M8 del barrido final)', () => {
  const FUENTE = readFileSync('app/(app)/servicio-tecnico/page.tsx', 'utf8')

  // El <nav> de paginación vive DENTRO de la rama `ordenes.length > 0` (más
  // abajo en el mismo archivo), así que una página fuera de rango con
  // `total > 0` mostraba el mensaje de "no hay equipos" SIN ningún control
  // para volver — indistinguible de un filtro sin resultados de verdad.
  it('con total > 0 ofrece un link "Volver a la primera", distinto del mensaje de cero resultados', () => {
    const inicio = FUENTE.indexOf('{ordenes.length === 0 ? (')
    const fin = FUENTE.indexOf('</p>', inicio)
    expect(inicio, 'no se encontró la rama ordenes.length === 0').toBeGreaterThan(-1)
    const bloque = FUENTE.slice(inicio, fin)
    expect(bloque).toMatch(/total > 0 \? \(/)
    expect(bloque).toContain('Volver a la primera')
    // pagina: 1 y no `pagina` a secas: el link tiene que apuntar SIEMPRE a la
    // primera página, no a la página fuera de rango que causó el vacío.
    expect(bloque).toMatch(/hrefTablero\(\{[^}]*pagina:\s*1[^}]*\}\)/)
  })
})
