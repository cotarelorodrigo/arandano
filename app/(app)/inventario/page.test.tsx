// Puro: importa las funciones exportadas de page.tsx, nunca el componente de
// página en sí — es un Server Component async que abre sesión y consulta
// Prisma, y este repo no tiene el arnés para montarlo fuera de un request
// real (mismo criterio que app/(app)/ventas/page.test.tsx). La única
// excepción es el bloque final, que lee el FUENTE como texto (mismo criterio
// que app/(app)/ventas/[id]/page.test.tsx) para cablear la categoría, que
// ningún test puro puede ejercitar sin una sesión real.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  tipoDeQuery, construirDonde, hrefListado, ventanaDePaginas, FiltrosDeInventario,
  ramaDelArbol, nombreDeRama,
} from './page'
import { SIN_CATEGORIA } from './consulta'

describe('tipoDeQuery', () => {
  it('reconoce PRODUCTO y SERVICIO', () => {
    expect(tipoDeQuery('PRODUCTO')).toBe('PRODUCTO')
    expect(tipoDeQuery('SERVICIO')).toBe('SERVICIO')
  })

  it('cualquier otra cosa es "Todos": sin filtro, no un error', () => {
    expect(tipoDeQuery(undefined)).toBeNull()
    expect(tipoDeQuery('')).toBeNull()
    // Un query string escrito a mano no puede tirar un 500, mismo criterio
    // que el clamp de `?p`.
    expect(tipoDeQuery('CUALQUIER_COSA')).toBeNull()
  })
})

describe('construirDonde', () => {
  it('sin nada tildado, excluye los desactivados y no filtra por tipo', () => {
    const donde = construirDonde({ busqueda: '', verInactivos: false, tipo: null })
    expect(donde).toMatchObject({ desactivadoEn: null })
    expect(donde).not.toHaveProperty('tipo')
    expect(donde).not.toHaveProperty('OR')
  })

  // "Ver desactivados" tildado: el chip de Desactivado sólo puede aparecer en
  // el listado si esta rama es la que corre — es la otra mitad del contrato
  // que chip-estado.test.tsx no puede cablear solo.
  it('con "ver desactivados", no excluye nada por desactivadoEn', () => {
    const donde = construirDonde({ busqueda: '', verInactivos: true, tipo: null })
    expect(donde).not.toHaveProperty('desactivadoEn')
  })

  it('cada tab filtra por su tipo', () => {
    expect(construirDonde({ busqueda: '', verInactivos: false, tipo: 'PRODUCTO' })).toMatchObject({
      tipo: 'PRODUCTO',
    })
    expect(construirDonde({ busqueda: '', verInactivos: false, tipo: 'SERVICIO' })).toMatchObject({
      tipo: 'SERVICIO',
    })
  })

  it('la búsqueda arma el OR de nombre y sku', () => {
    const donde = construirDonde({ busqueda: 'vidrio', verInactivos: false, tipo: null })
    expect(donde).toMatchObject({
      OR: [
        { nombre: { contains: 'vidrio', mode: 'insensitive' } },
        { sku: { contains: 'vidrio', mode: 'insensitive' } },
      ],
    })
  })
})

describe('hrefListado', () => {
  it('sin ningún filtro, apunta a /inventario pelado', () => {
    expect(hrefListado({ busqueda: '', verInactivos: false, tipo: null })).toBe('/inventario')
  })

  // La tab activa tiene que sobrevivir a un recarga: como vive en la URL y no
  // en estado de cliente, "sobrevivir a recargar" es simplemente que esta
  // función la incluya en el href.
  it('la tab activa viaja en la URL', () => {
    const href = hrefListado({ busqueda: '', verInactivos: false, tipo: 'SERVICIO' })
    expect(href).toContain('tipo=SERVICIO')
  })

  it('preserva la búsqueda y "ver desactivados" al cambiar de tab', () => {
    const href = hrefListado({ busqueda: 'vidrio', verInactivos: true, tipo: 'PRODUCTO' })
    expect(href).toContain('q=vidrio')
    expect(href).toContain('inactivos=1')
    expect(href).toContain('tipo=PRODUCTO')
  })

  it('la página sólo aparece si es mayor a 1', () => {
    expect(hrefListado({ busqueda: '', verInactivos: false, tipo: null, pagina: 1 })).toBe('/inventario')
    // `conservarPagina` explícito: desde que existe el filtro por rama, cambiar
    // de filtro descarta la página y sólo la paginación la conserva.
    expect(
      hrefListado({ busqueda: '', verInactivos: false, tipo: null, pagina: 2, conservarPagina: true }),
    ).toContain('p=2')
    // Y sin el flag, no la lleva.
    expect(hrefListado({ busqueda: '', verInactivos: false, tipo: null, pagina: 2 })).toBe('/inventario')
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

/** Extrae el `class` del `<a>` cuyo `href` es exactamente `href` (SIN escapar:
 *  se pasa tal cual aparece en el atributo, p. ej. "/inventario?tipo=X") —
 *  para no depender de en qué orden React serializa los atributos. */
function claseDelLink(html: string, href: string): string {
  const escapada = href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  const re = new RegExp(`<a class="([^"]*)"[^>]*href="${escapada}"`)
  const m = html.match(re)
  expect(m, `no se encontró un <a> con href="${href}"`).not.toBeNull()
  return m![1]
}

describe('FiltrosDeInventario', () => {
  // I8 de la review: la versión anterior envolvía estos links en el `Tabs` de
  // shadcn (`role="tab"`, `aria-controls`, roving `tabindex`) sin ningún
  // `TabsContent` que ese `aria-controls` pudiera señalar, y las tres nacían
  // con `tabindex="-1"` — alcanzables con mouse, no con teclado y sin JS. El
  // segmentado es ahora tres <Link> a secas (mismo criterio que /ventas), así
  // que el activo se distingue por clase (bg-card), no por data-state, y
  // ninguno lleva rol de pestaña.
  it('la opción activa sale de la URL: "Productos" activo si tipo=PRODUCTO', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo="PRODUCTO" />,
    )
    expect(claseDelLink(html, '/inventario?tipo=PRODUCTO')).toContain('bg-card')
    // Y las otras dos, inactivas: sin bg-card en su clase.
    expect(claseDelLink(html, '/inventario')).not.toContain('bg-card')
    expect(claseDelLink(html, '/inventario?tipo=SERVICIO')).not.toContain('bg-card')
  })

  it('el segmentado de Tipo no reclama un rol de pestaña que no puede cumplir (sin TabsContent)', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo={null} />,
    )
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('aria-controls')
    expect(html).not.toContain('tabindex="-1"')
  })

  it('cada tab arma su propio href, preservando búsqueda y desactivados', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="vidrio" verInactivos={true} tipo={null} />,
    )
    expect(html).toContain('href="/inventario?q=vidrio&amp;inactivos=1&amp;tipo=SERVICIO"')
  })

  it('el tipo activo viaja como campo oculto, para que el buscador no lo pierda', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo="SERVICIO" />,
    )
    expect(html).toContain('type="hidden"')
    expect(html).toMatch(/name="tipo"\s+value="SERVICIO"/)
  })

  it('con "Todos" activo no hay ningún campo oculto de tipo que mandar', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo={null} />,
    )
    expect(html).not.toContain('name="tipo"')
  })

  // C1 de la review: "Ver desactivados" no aplicaba nada al clickearlo. El
  // `Checkbox` de shadcn es un `<button type="button" role="checkbox">` cuyo
  // toggle arma React — sin JavaScript no se puede ni tildar — y encima no
  // había ningún submit en el form, así que la única forma de aplicar el
  // filtro era poner el foco en el buscador y apretar Enter. La corrección es
  // un `<input type="checkbox">` nativo (tildable sin JS) más un botón
  // "Buscar" con submit real.
  it('"Ver desactivados" es un checkbox nativo, tildable y submiteable sin JavaScript', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo={null} />,
    )
    // Nativo y no el botón de shadcn: es lo que permite tildarlo con un click
    // de verdad cuando no hay React corriendo.
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="inactivos"[^>]*>/)
    expect(html).not.toMatch(/role="checkbox"/)
    // Con un submit real adentro del mismo form: sin esto, tildar el
    // checkbox no aplica nada hasta que alguien descubra que Enter en el
    // buscador también manda el form.
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>\s*Buscar\s*<\/button>/)
  })

  it('"Ver desactivados" nace tildado cuando verInactivos es true, para que sobreviva a un recargar', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={true} tipo={null} />,
    )
    const [entrada] = html.match(/<input[^>]*name="inactivos"[^>]*>/) ?? []
    expect(entrada).toBeDefined()
    expect(entrada).toContain('checked=""')
  })
})

describe('el listado pide y muestra la categoría (Task 1 del rediseño)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  it('el select de Prisma trae la columna categoria', () => {
    expect(FUENTE).toMatch(/select:\s*\{[\s\S]*?categoria:\s*true/)
  })

  it('la fila muestra a.categoria bajo el nombre, sólo si existe', () => {
    // `a.categoria &&` y no un acceso directo: un artículo sin categoría (la
    // mayoría, hoy) no puede romper la fila ni mostrar un "null" en pantalla.
    expect(FUENTE).toContain('{a.categoria &&')
  })
})

describe('el vacío por página fuera de rango ofrece una salida (hallazgo M8 del barrido final)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  // El <nav> de paginación vive DENTRO de la rama `articulos.length > 0`
  // (más abajo en el mismo archivo), así que una página fuera de rango con
  // `total > 0` mostraba el mensaje de "no hay artículos" SIN ningún control
  // para volver — indistinguible de una búsqueda sin resultados de verdad.
  it('con total > 0 ofrece un link "Volver a la primera", distinto del mensaje de cero resultados', () => {
    // El bloque entero del vacío, aislado del resto del archivo por sus dos
    // marcadores más cercanos: el comentario que lo antecede y el cierre del
    // <p>. Sin acotar así, un `toContain` de "Volver a la primera" pasaría
    // aunque el link estuviera en cualquier otro lugar del archivo.
    const inicio = FUENTE.indexOf('{articulos.length === 0 ? (')
    const fin = FUENTE.indexOf('</p>', inicio)
    expect(inicio, 'no se encontró la rama articulos.length === 0').toBeGreaterThan(-1)
    const bloque = FUENTE.slice(inicio, fin)
    expect(bloque).toMatch(/total > 0 \? \(/)
    expect(bloque).toContain('Volver a la primera')
    // pagina: 1 y no `pagina` a secas: el link tiene que apuntar SIEMPRE a la
    // primera página, no a la página fuera de rango que causó el vacío.
    expect(bloque).toMatch(/hrefListado\(\{[^}]*pagina:\s*1[^}]*\}\)/)
  })
})

describe('el filtro por categoría', () => {
  const ARBOL = [
    { id: 'id-cables', nombre: 'Cables', cuenta: 3, hijas: [] },
    {
      id: 'id-fundas', nombre: 'Fundas', cuenta: 12,
      hijas: [
        { id: 'id-apple', nombre: 'Apple', cuenta: 7 },
        { id: 'id-samsung', nombre: 'Samsung', cuenta: 4 },
      ],
    },
  ]

  it('sin categoría elegida no filtra', () => {
    const donde = construirDonde({ busqueda: '', verInactivos: false, tipo: null, categoria: null })
    expect(donde).not.toHaveProperty('categoriaId')
  })

  // Filtrar por un rubro tiene que traer también sus marcas: si no, elegir
  // "Fundas" mostraría sólo las que no tienen marca, que es casi ninguna.
  it('por un rubro trae el rubro Y sus marcas', () => {
    const donde = construirDonde({
      busqueda: '', verInactivos: false, tipo: null,
      categoria: ramaDelArbol(ARBOL, 'id-fundas'),
    })
    expect(donde.categoriaId).toEqual({ in: ['id-fundas', 'id-apple', 'id-samsung'] })
  })

  it('por una marca trae sólo esa marca', () => {
    const donde = construirDonde({
      busqueda: '', verInactivos: false, tipo: null,
      categoria: ramaDelArbol(ARBOL, 'id-samsung'),
    })
    expect(donde.categoriaId).toEqual({ in: ['id-samsung'] })
  })

  it('por un rubro sin marcas trae sólo el rubro', () => {
    const donde = construirDonde({
      busqueda: '', verInactivos: false, tipo: null,
      categoria: ramaDelArbol(ARBOL, 'id-cables'),
    })
    expect(donde.categoriaId).toEqual({ in: ['id-cables'] })
  })

  it('"sin categoría" filtra por categoriaId nulo', () => {
    const donde = construirDonde({
      busqueda: '', verInactivos: false, tipo: null,
      categoria: ramaDelArbol(ARBOL, SIN_CATEGORIA),
    })
    expect(donde.categoriaId).toBeNull()
  })

  // Un id bien formado que ya no existe —una categoría borrada, o de otro
  // tenant— cae en "Todos" en vez de filtrar a cero sin explicación.
  it('un id que no está en el árbol cae en "Todos"', () => {
    expect(ramaDelArbol(ARBOL, '0199c0d4-1f2b-7a3c-8d4e-5f6a7b8c9d0e')).toBeNull()
  })

  it('combina en AND con la búsqueda y el tipo', () => {
    const donde = construirDonde({
      busqueda: 'a54', verInactivos: false, tipo: 'PRODUCTO',
      categoria: ramaDelArbol(ARBOL, 'id-samsung'),
    })
    expect(donde.categoriaId).toEqual({ in: ['id-samsung'] })
    expect(donde.tipo).toBe('PRODUCTO')
    expect(donde).toHaveProperty('OR')
    expect(donde).toMatchObject({ desactivadoEn: null })
  })
})

describe('hrefListado con categoría', () => {
  it('lleva la categoría en el query string', () => {
    expect(hrefListado({ busqueda: '', verInactivos: false, tipo: null, cat: 'id-fundas' }))
      .toBe('/inventario?cat=id-fundas')
  })

  // Elegir una rama vuelve a la página 1: quedarse en la página 3 de un
  // listado que ahora tiene ocho artículos muestra un vacío que parece un error.
  it('cambiar de rama descarta la página', () => {
    const href = hrefListado({
      busqueda: 'funda', verInactivos: false, tipo: null, cat: 'id-apple', pagina: 4,
    })
    expect(href).not.toContain('p=4')
    expect(href).toContain('cat=id-apple')
    expect(href).toContain('q=funda')
  })

  it('la paginación sí conserva la rama activa', () => {
    const href = hrefListado({
      busqueda: '', verInactivos: false, tipo: null, cat: 'id-apple', pagina: 3, conservarPagina: true,
    })
    expect(href).toContain('p=3')
    expect(href).toContain('cat=id-apple')
  })
})

describe('el vacío con una rama activa', () => {
  const FUENTE = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')

  // Sin esta salida, buscar algo que existe pero está en otra rama se ve
  // exactamente igual que buscar algo que no existe.
  it('ofrece salir de la rama conservando la búsqueda', () => {
    expect(FUENTE).toContain('Buscar en todo el inventario')
    expect(FUENTE).toMatch(/hrefListado\(\{ busqueda, verInactivos, tipo, cat: null \}\)/)
  })

  // El caso de la rama va ANTES que el de búsqueda en la cadena de ternarios:
  // si fuera al revés, una búsqueda sin resultados dentro de una rama caería
  // en el mensaje genérico y perdería la salida.
  it('el caso de la rama se evalúa antes que el de la búsqueda', () => {
    expect(FUENTE.indexOf(') : cat ? (')).toBeGreaterThan(-1)
    expect(FUENTE.indexOf(') : cat ? (')).toBeLessThan(FUENTE.indexOf(') : busqueda ? ('))
  })
})

// ---------------------------------------------------------------------------
// Task 6 del ciclo móvil: el listado y el árbol de categorías en el teléfono.
// ---------------------------------------------------------------------------

describe('nombreDeRama', () => {
  const ARBOL = [
    { id: 'id-cables', nombre: 'Cables', cuenta: 3, hijas: [] },
    {
      id: 'id-fundas', nombre: 'Fundas', cuenta: 12,
      hijas: [{ id: 'id-apple', nombre: 'Apple', cuenta: 7 }],
    },
  ]

  it('resuelve el nombre de un rubro', () => {
    expect(nombreDeRama(ARBOL, 'id-fundas')).toBe('Fundas')
  })

  it('resuelve el nombre de una marca', () => {
    expect(nombreDeRama(ARBOL, 'id-apple')).toBe('Apple')
  })

  it('resuelve "Sin categoría" para el valor reservado', () => {
    expect(nombreDeRama(ARBOL, SIN_CATEGORIA)).toBe('Sin categoría')
  })

  it('null sin nada elegido', () => {
    expect(nombreDeRama(ARBOL, null)).toBeNull()
  })
})

describe('FiltrosDeInventario en el teléfono (Task 6)', () => {
  it('el segmentado de Tipo llena el ancho: el contenedor y cada opción llevan flex-1', () => {
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo={null} />,
    )
    // El contenedor del segmentado (antes "flex h-auto gap-0.5 rounded-[10px]
    // bg-muted p-[3px]", sin ningún flex-1): ahora ocupa el ancho disponible
    // en el teléfono y vuelve a su ancho natural en escritorio.
    expect(html).toMatch(/class="[^"]*\bflex-1\b[^"]*bg-muted p-\[3px\][^"]*lg:flex-initial/)
  })

  it('recibe el botón/Sheet de categorías del teléfono y lo ubica junto al segmentado', () => {
    const marcador = <span data-testid="marcador-panel">Categorías</span>
    const html = renderToStaticMarkup(
      <FiltrosDeInventario busqueda="" verInactivos={false} tipo={null} panelCategorias={marcador} />,
    )
    expect(html).toContain('data-testid="marcador-panel"')
  })

  it('sin panelCategorias no rompe (los tests existentes no lo pasan)', () => {
    expect(() =>
      renderToStaticMarkup(<FiltrosDeInventario busqueda="" verInactivos={false} tipo={null} />),
    ).not.toThrow()
  })
})

describe('el Contenido pasa a columna en el teléfono (Task 6)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  it('el envoltorio de PanelDeCategorias + Listado es flex-col lg:flex-row', () => {
    expect(FUENTE).toMatch(/flex-1 flex-col gap-4 lg:flex-row lg:items-stretch/)
  })

  // El mismo componente, sin copiarlo: se renderiza dos veces — la columna
  // de escritorio (hidden lg:block) y adentro del Sheet que abre el teléfono.
  it('PanelDeCategorias se renderiza exactamente dos veces', () => {
    const apariciones = (FUENTE.match(/<PanelDeCategorias/g) ?? []).length
    expect(apariciones).toBe(2)
  })

  it('la columna de escritorio queda hidden lg:block', () => {
    expect(FUENTE).toMatch(/hidden lg:block[\s\S]{0,60}<PanelDeCategorias/)
  })

  it('el Sheet envuelve a la segunda instancia, para el teléfono', () => {
    expect(FUENTE).toContain('<Sheet>')
    expect(FUENTE).toContain('<SheetTrigger')
    expect(FUENTE).toContain('<SheetContent')
  })
})

describe('el chip de la rama activa, sólo en el teléfono (Task 6)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  it('existe sólo si hay una rama elegida (cat && nombreRama), y es lg:hidden', () => {
    expect(FUENTE).toMatch(/\{cat && nombreRama[\s\S]{0,300}lg:hidden/)
  })

  it('muestra el conteo "N artículos en la rama"', () => {
    expect(FUENTE).toContain('artículos en la rama')
  })

  // El ✕ del chip limpia el filtro sin tocar el resto (misma búsqueda, mismo
  // tipo) — mismo mecanismo que "Buscar en todo el inventario".
  it('el chip limpia el filtro (cat: null) sin tocar búsqueda ni tipo', () => {
    const inicio = FUENTE.indexOf('nombreRama &&')
    expect(inicio).toBeGreaterThan(-1)
    const bloque = FUENTE.slice(inicio, FUENTE.indexOf('artículos en la rama', inicio))
    expect(bloque).toMatch(/hrefListado\(\{ busqueda, verInactivos, tipo, cat: null \}\)/)
  })
})

describe('el Encabezado gana su accionMovil en el teléfono (Task 6)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  it('plus a /inventario/nuevo, tono acción', () => {
    const inicio = FUENTE.indexOf('accionMovil={')
    expect(inicio).toBeGreaterThan(-1)
    const bloque = FUENTE.slice(inicio, inicio + 300)
    expect(bloque).toContain('icono: Plus')
    expect(bloque).toContain("href: '/inventario/nuevo'")
    expect(bloque).toContain("tono: 'accion'")
  })
})

describe('el listado sigue el patrón grid + display:contents de la Task 4 (Task 6)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  it('el contenedor declara las seis anchuras que hoy declaraban los TableHead', () => {
    expect(FUENTE).toContain('lg:grid-cols-[100px_1fr_110px_140px_110px_120px]')
  })

  it('ya no queda ningún <Table>/<TableRow>/<TableCell>', () => {
    expect(FUENTE).not.toContain('<Table')
    expect(FUENTE).not.toContain('<TableRow')
    expect(FUENTE).not.toContain('<TableCell')
    expect(FUENTE).not.toContain('<TableHead')
  })

  it('cada fila lleva role="row" y las celdas role="cell", al menos una por columna', () => {
    expect(FUENTE).toContain('role="row"')
    expect(FUENTE).toContain('role="columnheader"')
    const celdas = (FUENTE.match(/role="cell"/g) ?? []).length
    expect(celdas).toBeGreaterThanOrEqual(6)
  })

  it('el hover y la transición de escritorio viven en las celdas, con prefijo lg:', () => {
    expect(FUENTE).toContain('lg:group-hover:bg-muted/50')
    expect(FUENTE).toContain('lg:transition-colors')
  })

  it('el borde entre filas: lg:border-b y lg:group-last:border-b-0 en las celdas', () => {
    expect(FUENTE).toContain('lg:border-b')
    expect(FUENTE).toContain('lg:group-last:border-b-0')
  })

  it('la fila lleva "group" para que el hover de escritorio la reconozca', () => {
    expect(FUENTE).toMatch(/role="row"\s+className="group /)
  })
})

describe('el conteo del árbol NO cambia con ?q ni ?tipo (protegido, Task 6)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  // arbolDeCategorias sólo recibe verInactivos: si alguna vez alguien le
  // suma busqueda o tipo, cada rama que no matchee la búsqueda mostraría 0 y
  // el árbol dejaría de servir para navegar justo cuando más se lo necesita
  // (razón ya escrita en el propio archivo, más arriba).
  it('arbolDeCategorias se sigue llamando sólo con { verInactivos }', () => {
    expect(FUENTE).toMatch(/arbolDeCategorias\(sesion\.tenant\.id, \{ verInactivos \}\)/)
  })
})
