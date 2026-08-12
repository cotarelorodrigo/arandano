import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Formulario } from './formulario'

// El action no se ejercita acá —tiene su propio archivo, contra la base—: lo
// que este test cuida es el contrato del FORMULARIO con el action, que es el
// que se rompe en silencio si alguien renombra un campo.
vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const html = () => renderToStaticMarkup(<Formulario whatsapp="5491155555555" />)

describe('formulario de la landing', () => {
  it('emite los cinco campos con los nombres que el action lee', () => {
    const markup = html()
    for (const campo of ['nombre', 'email', 'whatsapp', 'rubro', 'mensaje']) {
      expect(markup).toContain(`name="${campo}"`)
    }
  })

  // El honeypot tiene que existir Y estar escondido de la gente: si lo ve un
  // lector de pantalla, alguien lo completa y su lead se pierde para siempre.
  it('el honeypot existe, no se ve y no lo lee un lector de pantalla', () => {
    const markup = html()
    expect(markup).toContain('name="sitio-web"')
    expect(markup).toContain('tabindex="-1"')
    expect(markup).toContain('aria-hidden="true"')
    // No 'autocomplete="off"': a diferencia de tabIndex, que sí se emite en
    // minúsculas, renderToStaticMarkup de React 19.2.4 deja autoComplete tal
    // cual está escrito en el JSX. Es el mismo caso que ya advierte el brief
    // para tabindex, pero para un atributo distinto: el HTML es
    // case-insensitive para nombres de atributo, así que el navegador lo
    // interpreta igual — sólo cambia la grafía del string estático.
    expect(markup).toContain('autoComplete="off"')
  })

  it('ofrece el WhatsApp como salida directa', () => {
    expect(html()).toContain('https://wa.me/5491155555555')
  })

  it('todos los campos visibles tienen su etiqueta asociada', () => {
    const markup = html()
    for (const campo of ['nombre', 'email', 'whatsapp', 'rubro', 'mensaje']) {
      expect(markup).toContain(`for="${campo}"`)
      expect(markup).toContain(`id="${campo}"`)
    }
  })
})
