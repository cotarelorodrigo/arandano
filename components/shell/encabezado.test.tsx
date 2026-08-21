import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Encabezado } from './encabezado'

describe('el encabezado de pantalla', () => {
  it('el título es el h1 de la pantalla', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Inventario" />)
    expect(html).toMatch(/<h1[^>]*>Inventario<\/h1>/)
  })

  it('sin subtítulo no deja un párrafo vacío', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Vender" />)
    expect(html).not.toContain('<p')
  })

  it('el subtítulo va debajo del título', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Ventas" subtitulo="47 ventas" />)
    expect(html.indexOf('Ventas')).toBeLessThan(html.indexOf('47 ventas'))
  })

  // Cuatro de las diez pantallas ya tienen su botón en la fila del título.
  it('las acciones van a la derecha', () => {
    const html = renderToStaticMarkup(
      <Encabezado titulo="Inventario" acciones={<button>Artículo nuevo</button>} />,
    )
    expect(html).toContain('Artículo nuevo')
    expect(html.indexOf('Inventario')).toBeLessThan(html.indexOf('Artículo nuevo'))
  })

  // Un solo h1 por documento: el cartel del sidebar es <span> justamente por
  // esto, y el encabezado no puede romperlo por el otro lado.
  it('nunca hay más de un h1', () => {
    const html = renderToStaticMarkup(
      <Encabezado titulo="Usuarios" subtitulo="4 personas" acciones={<button>Agregar</button>} />,
    )
    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
  })
})
