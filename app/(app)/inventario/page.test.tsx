// `Inventario` (el default export) NUNCA se importa ni se monta acá: es un
// Server Component async que abre sesión y consulta Prisma, y este repo no
// tiene el arnés para montarlo fuera de un request real (mismo criterio que
// app/(app)/ventas/page.test.tsx). Lo que SÍ se prueba de ese componente
// —el `<Encabezado>`, el `Sheet` de categorías, el chip de rama— se verifica
// leyendo el fuente con `readFileSync` (mismo criterio que
// app/(app)/ventas/[id]/page.test.tsx), porque no hay forma de renderizarlo
// sin una sesión real.
//
// `Listado`, en cambio, SÍ es un componente y SÍ se renderiza acá
// (`renderToStaticMarkup`): no abre sesión ni toca Prisma — recibe sus filas
// ya resueltas a texto — así que puede afirmarse sobre el HTML real y no por
// grep sobre el fuente. Se extrajo en la ronda de arreglos 1 de la Task 6
// (ciclo móvil) exactamente para esto: antes vivía embebido en `Inventario`
// y su cobertura entera era `readFileSync` + `toContain`, que no puede
// distinguir un `cn()` mal compuesto de uno bien puesto — sólo confirma que
// la substring existe en algún lugar del archivo.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  tipoDeQuery, construirDonde, hrefListado, ventanaDePaginas, FiltrosDeInventario,
  ramaDelArbol, nombreDeRama, Listado,
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

describe('el listado pide la columna categoria', () => {
  const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

  // Sólo esto queda sobre el fuente: es la forma del SELECT de Prisma en
  // `Inventario` (Server Component), que ningún test puro puede ejercitar
  // sin una sesión real. Que la fila la MUESTRE, más abajo, ya se prueba
  // renderizando `Listado` de verdad (Task 6, ronda de arreglos 1).
  it('el select de Prisma trae la columna categoria', () => {
    expect(FUENTE).toMatch(/select:\s*\{[\s\S]*?categoria:\s*true/)
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

    // Y CADA OPCIÓN, que es donde vivía el defecto: guardar sólo el contenedor
    // no alcanza porque su ancho intrínseco a ≥1024 lo fijan los ítems, y un
    // contenedor flex cuyos ítems son todos `flex: 1 1 0%` mide n × el ítem
    // más ancho. Las tres pastillas llevan `flex-1 … lg:flex-none` y
    // `text-center lg:text-left`; ninguna de las cuatro clases existía antes
    // de la rama del teléfono.
    const opciones = [...html.matchAll(/<a\b[^>]*class="([^"]*rounded-lg[^"]*)"/g)].map(
      (m) => m[1],
    )
    expect(opciones).toHaveLength(3)
    for (const clases of opciones) {
      expect(clases).toMatch(/\bflex-1\b/)
      expect(clases).toMatch(/\blg:flex-none\b/)
      expect(clases).toMatch(/\btext-center\b/)
      expect(clases).toMatch(/\blg:text-left\b/)
    }
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

/** Una fila mínima, ya resuelta a texto — la forma que `Listado` recibe de
 *  verdad, sin ningún `Decimal` de Prisma cruzando a un fixture de test.
 *  Mismo criterio que `FILA` en `app/(app)/ventas/page.test.tsx`. */
const FILA: Parameters<typeof Listado>[0]['filas'][number] = {
  id: 'a1',
  sku: 'A-0001',
  nombre: 'Vidrio templado 9H',
  categoria: 'Accesorios · Protección',
  tipo: 'PRODUCTO',
  precioFormateado: '$ 12.000,00',
  stockTexto: '48',
  estado: null,
  desactivado: false,
}

function renderListado(props: Partial<Parameters<typeof Listado>[0]> = {}) {
  return renderToStaticMarkup(
    <Listado
      filas={[FILA]}
      total={1}
      pagina={1}
      paginas={1}
      porPagina={50}
      busqueda=""
      verInactivos={false}
      tipo={null}
      cat={null}
      esDuenio
      {...props}
    />,
  )
}

// Ronda de arreglos 1 de la Task 6 (ciclo móvil): antes de esto, toda esta
// cobertura leía `page.tsx` con `readFileSync` y hacía `toContain` sobre el
// texto crudo — el propio comentario de cabecera de este archivo ya avisaba
// que el grep sobre el fuente debía ser "la única excepción", y acá no lo
// era: un `cn()` mal compuesto, un `lg:hidden` en el div equivocado o un
// anidamiento roto seguían pasando con que la substring existiera en algún
// lugar del archivo. `Listado` (arriba, en `page.tsx`) es un componente
// puro —sin Prisma, sin sesión— hecho para renderizarse, así que esta task
// lo extrajo del `articulos.map(...)` que vivía embebido en `Inventario`
// (Server Component async), mismo criterio que ya usa `Listado` en
// `app/(app)/ventas/page.test.tsx`.
describe('Listado: el patrón grid + display:contents (Task 6, ronda de arreglos 1)', () => {
  it('el contenedor es la tabla ARIA: 1 columna en el teléfono, 6 en escritorio', () => {
    const html = renderListado()
    expect(html).toContain('role="table"')
    // Las mismas seis anchuras que declaraban los <TableHead> de antes.
    expect(html).toMatch(/class="[^"]*\bgrid-cols-1\b[^"]*\blg:grid-cols-\[100px_1fr_110px_140px_110px_120px\]/)
  })

  it('el encabezado está oculto en el teléfono y se disuelve en escritorio', () => {
    expect(renderListado()).toContain('role="row" class="hidden lg:contents"')
  })

  it('hay tantos role="columnheader" como columnas declara el grid (6)', () => {
    expect(renderListado().match(/role="columnheader"/g)).toHaveLength(6)
  })

  it('toda fila de datos lleva lg:contents y role="row"', () => {
    const html = renderListado({ filas: [FILA, { ...FILA, id: 'a2', sku: 'A-0002' }], total: 2 })
    // El encabezado + las dos filas de datos: las tres son role="row" y las
    // tres llevan lg:contents.
    const filas = html.match(/role="row" class="[^"]*"/g) ?? []
    expect(filas).toHaveLength(3)
    for (const fila of filas) expect(fila).toContain('lg:contents')
  })

  it('cada fila de datos tiene 6 celdas con role="cell", tantas como columnheader', () => {
    expect(renderListado().match(/role="cell"/g)).toHaveLength(6)
  })

  /**
   * Deuda que el ciclo móvil dejó agendada y la ola final cerró: la línea de
   * meta del teléfono era un `<div>` SIN rol, hijo directo del `role="row"`
   * — y los hijos de una fila ARIA tienen que ser celdas. Se fundió en la
   * celda real de Stock, la misma técnica que `/servicio-tecnico` ya usa en
   * su celda "Ingresó".
   *
   * El caso cuenta los hijos DIRECTOS de la fila y exige que los seis sean
   * celdas. Cuenta hijos y no clases a propósito: un `<div>` nuevo sin rol
   * colado en la fila —que es exactamente lo que pasó— no cambia ninguna
   * clase existente, así que sólo un conteo estructural lo ve.
   */
  it('la fila del teléfono no tiene ningún hijo suelto: sus 6 hijos son celdas', () => {
    const html = renderListado()
    const marca = html.indexOf('role="row" class="group ')
    expect(marca, 'no se encontró la fila de datos').toBeGreaterThan(-1)
    // Desde la APERTURA del <div> de la fila, no desde el atributo: si no, el
    // recorrido arranca a mitad de la etiqueta y confunde profundidades.
    const desdeLaFila = html.slice(html.lastIndexOf('<div', marca))

    // Los hijos directos: se recorre el HTML llevando la profundidad de
    // <div>, y se anota cada apertura que esté en profundidad 1 respecto de
    // la fila. renderToStaticMarkup no emite <div> auto-cerrados, así que
    // abrir y cerrar alcanzan para llevar la cuenta.
    const hijos: string[] = []
    let profundidad = 0
    for (const m of desdeLaFila.matchAll(/<div\b[^>]*>|<\/div>/g)) {
      if (m[0] === '</div>') {
        profundidad -= 1
        if (profundidad === 0) break // se cerró la fila
      } else {
        if (profundidad === 1) hijos.push(m[0])
        profundidad += 1
      }
    }

    expect(hijos, `hijos directos de la fila: ${hijos.join('\n')}`).toHaveLength(6)
    for (const hijo of hijos) {
      expect(hijo, `un hijo de role="row" que no es celda: ${hijo}`).toContain('role="cell"')
    }
  })

  it('la fila resalta al pasar el mouse en escritorio (group + group-hover en las 6 celdas)', () => {
    const html = renderListado()
    expect(html).toContain('role="row" class="group ')
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(6)
    for (const celda of celdas) expect(celda).toContain('lg:group-hover:bg-muted/50')
  })

  it('muestra código, nombre, tipo, precio, stock y el chip de estado', () => {
    const html = renderListado({
      filas: [{ ...FILA, tipo: 'PRODUCTO', desactivado: false }],
    })
    expect(html).toContain('A-0001')
    expect(html).toContain('Vidrio templado 9H')
    expect(html).toContain('Producto')
    expect(html).toContain('$ 12.000,00')
    expect(html).toContain('48')
  })

  it('la categoría aparece bajo el nombre sólo si existe (desktop) y fundida en la meta (teléfono)', () => {
    const conCategoria = renderListado({ filas: [{ ...FILA, categoria: 'Accesorios · Protección' }] })
    expect(conCategoria).toContain('Accesorios · Protección')
    // La celda de escritorio de la categoría es "hidden lg:block", adentro
    // de la celda de Nombre.
    expect(conCategoria).toMatch(/class="hidden text-\[11px\] text-muted-foreground lg:block">Accesorios · Protección/)
    // En el teléfono se funde con el código en la línea de meta.
    expect(conCategoria).toContain('A-0001 · Accesorios · Protección')

    const sinCategoria = renderListado({ filas: [{ ...FILA, categoria: null }] })
    expect(sinCategoria).not.toContain('Accesorios · Protección')
  })

  it('un servicio muestra "—" de stock, tanto en la celda de escritorio como en la meta del teléfono', () => {
    const html = renderListado({
      filas: [{ ...FILA, tipo: 'SERVICIO', stockTexto: '—' }],
    })
    expect(html).toContain('Servicio')
    expect((html.match(/—/g) ?? []).length).toBe(2)
  })

  it('el chip de estado aparece en la meta del teléfono y en su propia celda de escritorio', () => {
    const html = renderListado({
      filas: [{ ...FILA, estado: 'NEGATIVO' }],
    })
    expect((html.match(/Stock negativo/g) ?? []).length).toBe(2)
  })

  it('en el teléfono, Código y Tipo dejan de ser columna propia y se funden en la línea de meta', () => {
    const html = renderListado()
    // La línea de meta del teléfono, con el código.
    expect(html).toContain('A-0001 · Accesorios · Protección')
    // Las celdas de escritorio de Código y Tipo, ocultas en el teléfono.
    const ocultas = html.match(/class="[^"]*\bhidden\b[^"]*\blg:block\b[^"]*"/g) ?? []
    expect(ocultas.length).toBeGreaterThanOrEqual(2)
  })

  it('el borde entre filas vive en cada celda, no en la fila (escritorio)', () => {
    const html = renderListado({ filas: [FILA, { ...FILA, id: 'a2', sku: 'A-0002' }], total: 2 })
    const celdas = html.match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(12) // 6 columnas × 2 filas
    for (const celda of celdas) expect(celda).toContain('lg:border-b')
    const conGroupLast = celdas.filter((c) => c.includes('lg:group-last:border-b-0'))
    expect(conGroupLast).toHaveLength(12)
  })

  it('el hover funde el color: transition-colors en cada celda', () => {
    const celdas = renderListado().match(/<div[^>]*\brole="cell"[^>]*>/g) ?? []
    expect(celdas).toHaveLength(6)
    for (const celda of celdas) expect(celda).toContain('lg:transition-colors')
  })

  // Nombre es la celda más alta de la fila cuando hay categoría (dos
  // líneas), así que no lleva el envoltorio de centrado que sí llevan las
  // otras cinco (Código, Tipo, Precio, Stock, Estado).
  it('las celdas más cortas que Nombre centran su contenido con un envoltorio interno, no achicando la celda', () => {
    const html = renderListado()
    // Se busca `lg:h-full` + `lg:items-center` EN CUALQUIER POSICIÓN del
    // atributo, y no como prefijo exacto: desde que la celda de Stock comparte
    // su caja con la línea de meta del teléfono (ola final), su envoltorio de
    // escritorio arranca con `hidden` y lleva además la tipografía que antes
    // vivía en la celda. Lo que este caso cuida es el MECANISMO de centrado,
    // no el orden en que Tailwind ordena las clases.
    const envoltorios = [...html.matchAll(/class="[^"]*\blg:h-full\b[^"]*"/g)].filter((m) =>
      m[0].includes('lg:items-center'),
    )
    expect(envoltorios, 'Código, Tipo, Precio, Stock y Estado: 5 celdas más cortas que Nombre').toHaveLength(5)
    expect(html).not.toContain('self-center')
  })

  describe('los vacíos', () => {
    it('sin nada cargado, el dueño ve la invitación a "Artículo nuevo"', () => {
      const html = renderListado({ filas: [], total: 0, esDuenio: true })
      expect(html).toContain('Todavía no cargaste ningún artículo. Empezá por «Artículo nuevo».')
    })

    it('sin nada cargado, un empleado ve el mensaje genérico', () => {
      const html = renderListado({ filas: [], total: 0, esDuenio: false })
      expect(html).toContain('Todavía no hay artículos cargados.')
      expect(html).not.toContain('Artículo nuevo')
    })

    it('una búsqueda sin resultados lo dice, sin ninguna rama activa', () => {
      const html = renderListado({ filas: [], total: 0, busqueda: 'zzz' })
      // &quot; y no ": React escapa las comillas del texto en el HTML servido.
      expect(html).toContain('No hay artículos que coincidan con &quot;zzz&quot;.')
    })

    // El caso de la rama se evalúa ANTES que el de la búsqueda: si fuera al
    // revés, una búsqueda sin resultados dentro de una rama caería en el
    // mensaje genérico y perdería la salida de "Buscar en todo el
    // inventario". Comprobado por comportamiento (con cat Y busqueda a la
    // vez) y no por el orden literal de un ternario en el fuente.
    it('con una rama activa Y una búsqueda sin resultados, el mensaje es el de la rama, no el genérico', () => {
      const html = renderListado({ filas: [], total: 0, cat: 'id-fundas', busqueda: 'zzz' })
      expect(html).toContain('No hay artículos que coincidan con &quot;zzz&quot; en esta categoría.')
      expect(html).not.toContain('No hay artículos que coincidan con &quot;zzz&quot;.</p>')
    })

    it('una rama activa sin búsqueda ofrece salir de la rama', () => {
      const html = renderListado({ filas: [], total: 0, cat: 'id-fundas' })
      expect(html).toContain('Esta categoría todavía no tiene artículos.')
      expect(html).toContain('Buscar en todo el inventario')
      expect(html).toMatch(/href="\/inventario"[^>]*>\s*Buscar en todo el inventario/)
    })

    // Hallazgo M8 del barrido final: el <nav> de paginación vive DENTRO de
    // la rama `filas.length > 0`, así que una página fuera de rango con
    // `total > 0` mostraba "no hay artículos" sin ningún control para
    // volver — indistinguible de una búsqueda sin resultados de verdad.
    it('con total > 0 (página fuera de rango) ofrece volver a la primera, distinto del mensaje de cero resultados', () => {
      const html = renderListado({ filas: [], total: 5, pagina: 9 })
      expect(html).toContain('Esta página no tiene artículos.')
      // pagina: 1 y no la página fuera de rango que causó el vacío.
      expect(html).toContain('/inventario"')
    })
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
