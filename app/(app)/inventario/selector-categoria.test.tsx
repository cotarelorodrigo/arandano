import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectorDeCategoria } from './selector-categoria'

const ARBOL = [
  { id: 'id-cables', nombre: 'Cables', cuenta: 3, hijas: [] },
  {
    id: 'id-fundas', nombre: 'Fundas', cuenta: 12,
    hijas: [{ id: 'id-apple', nombre: 'Apple', cuenta: 7 }],
  },
]

/**
 * Radix no renderiza `SelectContent` ni sus `SelectItem` en markup estático:
 * sale el `<button>` del trigger y un `<select>` oculto, nada más. Así que lo
 * que este archivo afirma NO son las opciones ofrecidas —no se puede— sino los
 * dos `<input type="hidden">` que el componente emite, que es lo que de verdad
 * viaja al servidor.
 */
function oculto(html: string, nombre: string): string | null {
  const m = html.match(
    new RegExp(`<input type="hidden" name="${nombre}" value="([^"]*)"`),
  )
  return m === null ? null : m[1]
}

function render(categoriaIdInicial: string | null = null) {
  return renderToStaticMarkup(
    <SelectorDeCategoria arbol={ARBOL} categoriaIdInicial={categoriaIdInicial} />,
  )
}

describe('SelectorDeCategoria', () => {
  it('sin rama inicial, los dos campos viajan vacíos', () => {
    const html = render(null)
    expect(oculto(html, 'categoriaId')).toBe('')
    expect(oculto(html, 'marcaId')).toBe('')
  })

  // El caso que la ficha necesita y el alta nunca tuvo: el artículo ya cuelga
  // de una HOJA, así que hay que precargar los DOS selectores — el rubro es el
  // padre de esa hoja, que el componente tiene que deducir del árbol.
  it('con una hoja, precarga el rubro padre y la marca', () => {
    const html = render('id-apple')
    expect(oculto(html, 'categoriaId')).toBe('id-fundas')
    expect(oculto(html, 'marcaId')).toBe('id-apple')
  })

  // "Cables" sin marca es una rama válida (CLAUDE.md, ciclo del modelo): un
  // artículo puede colgar de una RAÍZ, y ahí la marca queda vacía.
  it('con una raíz, precarga sólo el rubro', () => {
    const html = render('id-cables')
    expect(oculto(html, 'categoriaId')).toBe('id-cables')
    expect(oculto(html, 'marcaId')).toBe('')
  })

  // Defensivo, y no teórico: entre que la pantalla se dibuja y alguien la mira,
  // otra pestaña puede haber borrado la rama desde el panel. Un id que el árbol
  // no conoce no puede dejar los selectores en un estado imposible.
  it('un id que no está en el árbol queda como sin categoría', () => {
    const html = render('id-que-ya-no-existe')
    expect(oculto(html, 'categoriaId')).toBe('')
    expect(oculto(html, 'marcaId')).toBe('')
  })

  it('el selector de marca nace deshabilitado sin rubro elegido', () => {
    const html = render(null)
    // El `<button>` del trigger, no un selector de atributos en orden: Radix
    // emite `disabled` ANTES del `id`, así que un regex que los pida en ese
    // orden pasa por casualidad o falla por casualidad.
    const trigger = html.slice(html.lastIndexOf('<button', html.indexOf('id="marcaId"')))
    // El atributo real `disabled=""`, no la subcadena "disabled": el
    // className del SelectTrigger de shadcn trae siempre
    // `disabled:cursor-not-allowed disabled:opacity-50` (la variante de
    // Tailwind), así que "disabled" a secas está presente en el HTML pase lo
    // que pase — hay que pedir el atributo booleano puntual.
    expect(trigger).toContain('disabled=""')
  })

  // Con rubro elegido y marcas disponibles, el segundo selector se habilita.
  it('con un rubro que tiene marcas, el selector de marca se habilita', () => {
    const html = render('id-fundas')
    const trigger = html.slice(html.lastIndexOf('<button', html.indexOf('id="marcaId"')))
    const cierre = trigger.indexOf('>')
    // Mismo motivo que arriba: `disabled:cursor-not-allowed` vive en el
    // className siempre, así que `.not.toContain('disabled')` a secas fallaría
    // acá SIEMPRE, esté o no deshabilitado el trigger — no es lo que este caso
    // quiere afirmar.
    expect(trigger.slice(0, cierre)).not.toContain('disabled=""')
  })
})
