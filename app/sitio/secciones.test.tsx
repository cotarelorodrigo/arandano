import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Nav, Hero, Modulos, Rubros, Planes, Cierre, Pie, MODULOS, RUBROS, PLANES } from './secciones'
import type { BaseDeTenant } from './entrar'

vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const BASE: BaseDeTenant = { protocolo: 'https', dominio: 'arandano.app', puerto: '' }

/**
 * Las secciones de la landing, probadas una por una y no sólo a través de
 * `landing.test.tsx`: la Task 4 del cierre del rediseño reescribió las siete
 * enteras contra design/arandano.pen (frame `Sitio / Landing`), con copy
 * LITERAL — este archivo lo ata para que nadie lo reescriba "mejorándolo".
 *
 * Todas las aserciones de copy comparan contra el TEXTO exacto, no contra un
 * fragmento cualquiera: un `toContain` demasiado corto (por ejemplo sólo
 * "instantánea") pasaría igual con una frase distinta que casualmente
 * comparta esa palabra.
 */

describe('Nav', () => {
  const html = () => renderToStaticMarkup(<Nav base={BASE} />)

  it('muestra la marca y los tres links de sección', () => {
    const markup = html()
    expect(markup).toContain('Arándano')
    expect(markup).toContain('Qué hace')
    expect(markup).toContain('Rubros')
    expect(markup).toContain('Precios')
  })

  it('el CTA es "Probar 5 días", no "Quiero que me muestren"', () => {
    expect(html()).toContain('Probar 5 días')
  })

  // design/arandano.pen (nodo `BEen9`) dibuja "Entrar a mi local" como texto
  // en reposo, no un campo de subdominio siempre visible — el click que lo
  // revela es interacción que la maqueta no puede dibujar (mismo criterio que
  // ya usa /usuarios con "Cambiar clave"), así que el reposo tiene que ser
  // SÓLO el texto, sin ningún campo de por medio.
  it('"Entrar a mi local" arranca como texto, sin el campo de subdominio visible', () => {
    const markup = html()
    expect(markup).toContain('Entrar a mi local')
    expect(markup).not.toContain('<input')
  })
})

describe('Hero', () => {
  const html = () => renderToStaticMarkup(<Hero whatsapp="5491155555555" />)

  it('el badge, el H1 y la bajada son los del .pen, literales', () => {
    const markup = html()
    expect(markup).toContain('Hecho para el mercado argentino')
    expect(markup).toContain('Todo el local en un solo lugar')
    expect(markup).toContain(
      'Ventas, stock, caja en pesos y dólares, facturación ARCA, catálogo público y un bot de',
    )
    expect(markup).toContain(
      'WhatsApp conectado a los datos reales del negocio. Sobre eso, cada rubro suma lo suyo.',
    )
  })

  it('la letra chica es la del .pen', () => {
    expect(html()).toContain('5 días gratis · sin tarjeta · el alta es instantánea')
  })

  // La Task 3 ya construyó el retrato nuevo; acá sólo importa que ESTÉ, con
  // la barra de navegador y el pie que aclara que no es una captura.
  it('muestra la barra de navegador con la URL de ejemplo y el retrato', () => {
    const markup = html()
    expect(markup).toContain('flor.arandano.app/vender')
    expect(markup).toContain(
      'No es una captura: es el mismo componente y el mismo formateo de plata que corre en el',
    )
    // El retrato en sí (role="img") viene de app/sitio/retrato.tsx y ya
    // tiene su propio test — acá sólo se comprueba que Hero lo renderiza.
    expect(markup).toContain('role="img"')
  })

  // Ruling del plan del cierre: la Task 4 NO toca el formulario. Tiene que
  // seguir siendo el de 5 campos que existe hoy (la Task 5 lo achica).
  it('incluye el <Formulario> tal cual existe hoy, sin tocarlo', () => {
    expect(html()).toContain('name="nombre"')
  })
})

describe('Modulos', () => {
  const html = () => renderToStaticMarkup(<Modulos />)

  it('el H2 y la bajada son los del .pen, literales', () => {
    const markup = html()
    expect(markup).toContain('Un núcleo, tres módulos, rubros ilimitados')
    expect(markup).toContain(
      'El núcleo solo ya cubre un comercio completo. Los módulos agregan comportamiento, y un',
    )
  })

  it('las ocho piezas del núcleo están, todas', () => {
    const markup = html()
    for (const pieza of [
      'Clientes', 'Catálogo', 'Inventario', 'Ventas', 'Caja ARS/USD',
      'Facturación ARCA', 'Catálogo público', 'Bot',
    ]) {
      expect(markup).toContain(pieza)
    }
  })

  // El requisito explícito de la Task 4: Órdenes de trabajo dice
  // "Disponible", Turnos y Gastronomía dicen "En camino" — y eso sale del
  // dato (MODULOS), no de tres bloques de JSX escritos a mano.
  it('las tres tarjetas de módulo muestran su estado real: uno Disponible, dos En camino', () => {
    expect(MODULOS.find((m) => m.titulo === 'Órdenes de trabajo')?.estado).toBe('Disponible')
    expect(MODULOS.find((m) => m.titulo === 'Turnos')?.estado).toBe('En camino')
    expect(MODULOS.find((m) => m.titulo === 'Gastronomía')?.estado).toBe('En camino')

    const markup = html()
    expect(markup.match(/Disponible/g)).toHaveLength(1)
    expect(markup.match(/En camino/g)).toHaveLength(2)
  })

  it('cada módulo muestra su detalle y sus rubros', () => {
    const markup = html()
    for (const modulo of MODULOS) {
      expect(markup).toContain(modulo.detalle)
      expect(markup).toContain(modulo.rubros)
    }
  })
})

describe('Rubros', () => {
  const html = () => renderToStaticMarkup(<Rubros />)

  it('el H2, la bajada y la nota son los del .pen, literales', () => {
    const markup = html()
    expect(markup).toContain('Tu rubro ya está adentro')
    expect(markup).toContain(
      'Un rubro no es código: es qué módulos vienen activados, qué datos demo se cargan y',
    )
    expect(markup).toContain('¿No está el tuyo? Se agrega sin desarrollo.')
  })

  it('la grilla lista los doce rubros, cada uno con los módulos que activa', () => {
    expect(RUBROS).toHaveLength(12)
    const markup = html()
    for (const rubro of RUBROS) {
      expect(markup).toContain(rubro.titulo)
      expect(markup).toContain(rubro.modulos)
    }
  })

  it('el que no prende ningún módulo dice "Sólo núcleo", no un string distinto', () => {
    const soloNucleo = RUBROS.filter((r) => r.modulos === 'Sólo núcleo')
    // Kiosco, Ropa, Ferretería, Pet shop y Dietética: los cinco que el .pen
    // no ata a ningún módulo.
    expect(soloNucleo).toHaveLength(5)
  })
})

describe('Planes', () => {
  const html = () => renderToStaticMarkup(<Planes />)

  it('el H2 y la bajada son los del .pen, literales', () => {
    const markup = html()
    expect(markup).toContain('Precios claros, en pesos')
    expect(markup).toContain(
      'Los módulos no se cobran aparte ni dependen del plan: activás los que necesites. El',
    )
  })

  // El requisito explícito de la Task 4: los precios son los reales de la
  // maqueta — antes esta sección no mostraba ningún precio.
  it('los precios de los planes son los de la maqueta', () => {
    expect(PLANES.map((p) => p.precio)).toEqual(['$ 24.900', '$ 44.900', '$ 79.900', 'A medida'])
    const markup = html()
    for (const precio of ['$ 24.900', '$ 44.900', '$ 79.900', 'A medida']) {
      expect(markup).toContain(precio)
    }
  })

  it('sólo Profesional lleva el badge "Más elegido"', () => {
    const markup = html()
    expect(markup.match(/Más elegido/g)).toHaveLength(1)
    expect(PLANES.filter((p) => p.destacado)).toHaveLength(1)
    expect(PLANES.find((p) => p.destacado)?.nombre).toBe('Profesional')
  })

  it('el botón de Premium dice "Hablemos"; el resto dice "Probar 5 días"', () => {
    expect(PLANES.filter((p) => p.nombre !== 'Premium').every((p) => p.accion === 'Probar 5 días')).toBe(true)
    expect(PLANES.find((p) => p.nombre === 'Premium')?.accion).toBe('Hablemos')
    const markup = html()
    expect(markup).toContain('Hablemos')
    expect(markup.match(/Probar 5 días/g)).toHaveLength(3)
  })
})

describe('Cierre', () => {
  const html = () => renderToStaticMarkup(<Cierre>{null}</Cierre>)

  it('el H2 es "El alta es instantánea", no "Contanos de tu negocio"', () => {
    const markup = html()
    expect(markup).toContain('El alta es instantánea')
    expect(markup).not.toContain('Contanos de tu negocio')
  })

  it('la bajada y la letra chica son las del .pen, literales', () => {
    const markup = html()
    expect(markup).toContain(
      'Dejás tu WhatsApp, elegís el rubro y en dos minutos tenés tu local cargado con datos de',
    )
    expect(markup).toContain('ejemplo para probarlo de verdad.')
    expect(markup).toContain('Sin tarjeta · exportás tus datos cuando quieras · soporte por WhatsApp')
  })

  it('renderiza lo que le pasen como children (el <Formulario>)', () => {
    const marcador = renderToStaticMarkup(<Cierre><p>marcador-de-formulario</p></Cierre>)
    expect(marcador).toContain('marcador-de-formulario')
  })
})

describe('Pie', () => {
  it('la marca y los links son los del .pen, literales', () => {
    const markup = renderToStaticMarkup(<Pie />)
    expect(markup).toContain('Arándano · Buenos Aires, Argentina')
    expect(markup).toContain('Términos · Privacidad · Estado del servicio')
  })
})
