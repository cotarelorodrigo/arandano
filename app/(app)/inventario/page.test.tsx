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
} from './page'

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
    expect(hrefListado({ busqueda: '', verInactivos: false, tipo: null, pagina: 2 })).toContain('p=2')
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
