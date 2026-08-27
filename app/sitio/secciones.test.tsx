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

  // Minor 8 de la review final: size="sm" daba 28px de alto; o0Cl42 (el .pen,
  // consultado en vivo) mide h=38, r=9, gap=7, pad-x=15.
  it('el botón "Probar 5 días" mide h=38/r=9/gap=7/pad-x=15 (nodo o0Cl42)', () => {
    const markup = html()
    const idx = markup.indexOf('>Probar 5 días<')
    const inicio = markup.lastIndexOf('<a', idx)
    const clasesA = markup.slice(inicio, markup.indexOf('>', inicio))
    // <Button asChild> pasa sus clases al <a> hijo (Slot de Radix).
    expect(clasesA).toContain('h-[38px]')
    expect(clasesA).toContain('gap-[7px]')
    expect(clasesA).toContain('rounded-[9px]')
    expect(clasesA).toContain('px-[15px]')
  })

  // El header en sí no lleva stroke (Minor 7 de la review final: el .pen,
  // nodo g3oxH, no dibuja uno acá — a diferencia del Pie, que sí lo lleva).
  it('el <header> no lleva border-b', () => {
    const markup = html()
    const inicio = markup.indexOf('<header')
    const cierre = markup.indexOf('>', inicio)
    expect(markup.slice(inicio, cierre)).not.toContain('border-b')
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

  // Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Sitio ·
  // Landing`, nodo `fI6bl`): el Nav baja de 76 a 60px en el teléfono.
  it('el Nav mide 60px en el teléfono y 76px desde escritorio (nodo fI6bl)', () => {
    const markup = html()
    expect(markup).toContain('h-[60px]')
    expect(markup).toContain('lg:h-[76px]')
  })

  // Los tres links de sección y "Entrar a mi local" siguen sin verse en el
  // teléfono (la maqueta sólo dibuja el ícono de menú, nodo `K60WPs`), pero
  // no pueden desaparecer sin más — regla del ciclo. Reaparecen dentro de un
  // `Sheet` que abre el ícono de menú.
  it('en el teléfono, los links y "Entrar a mi local" viven dentro del Sheet que abre el ícono de menú', () => {
    const markup = html()
    // Los tres <a> de sección siguen existiendo, pero SÓLO visibles desde
    // lg: (o adentro del Sheet, que tampoco los muestra por defecto en el
    // teléfono — están montados pero el propio Sheet arranca cerrado).
    expect(markup.match(/Qué hace/g)?.length).toBeGreaterThanOrEqual(1)
    // El ícono de menú (lucide "menu"), sólo visible abajo de 1024.
    expect(markup).toContain('lucide-menu')
    const clases = markup.match(/class="([^"]*lucide-menu[^"]*)"/)?.[1]
    expect(clases, 'no se encontró la clase del ícono lucide-menu').toBeTruthy()
    expect(clases).toContain('lg:hidden')
  })

  it('no se hace pasar por una página de tenant ni rompe con el ícono de menú montado', () => {
    // El Sheet no está abierto por defecto: no debería haber ningún rol de
    // diálogo visible en el HTML inicial más allá de lo que Radix monta
    // colapsado (data-state="closed").
    const markup = html()
    expect(markup).not.toContain('data-state="open"')
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

  // Task 11 del ciclo móvil: la grilla de dos columnas (7fr/9fr) es sólo de
  // escritorio — en el teléfono el Hero es una sola columna (design/arandano.pen,
  // frame `Móvil / Sitio · Landing`, nodo `Sv9VR`) y la "Muestra" (barra +
  // retrato) se oculta acá (se promueve a sección propia entre Hero y
  // Módulos, ver `landing.test.tsx`) — nunca desaparece sin más.
  it('la grilla de 7fr/9fr es lg:, no default — en el teléfono es una columna', () => {
    const html2 = renderToStaticMarkup(<Hero whatsapp="5491155555555" />)
    expect(html2).not.toMatch(/(?<!lg:)grid-cols-\[7fr_9fr\]/)
    expect(html2).toContain('lg:grid-cols-[7fr_9fr]')
  })

  it('la "Muestra" (barra + retrato) de acá adentro es hidden lg:block — sólo de escritorio', () => {
    const markup = html()
    const idx = markup.indexOf('flor.arandano.app/vender')
    const inicioDiv = markup.lastIndexOf('<div class="hidden ', idx)
    expect(inicioDiv, 'no se encontró un <div class="hidden ..."> antes de la Muestra').toBeGreaterThan(
      -1,
    )
    const clases = markup.slice(inicioDiv).match(/^<div class="([^"]*)"/)?.[1]
    expect(clases).toContain('hidden')
    expect(clases).toContain('lg:block')
  })

  // Minor 6 de la review final: el .pen (nodo udK1D) pide $ar-font para la
  // URL de la barra, no font-mono — el precedente que justificaba el
  // monoespaciado (la sección Direccion) se borró en este mismo ciclo.
  it('la URL de la barra NO es monoespaciada', () => {
    const markup = html()
    const idx = markup.indexOf('flor.arandano.app/vender')
    const inicio = markup.lastIndexOf('<span', idx)
    const clases = markup.slice(inicio, markup.indexOf('>', inicio))
    expect(clases).not.toContain('font-mono')
  })

  // Task 5: el formulario de un solo campo ya está en pie acá, con el texto
  // de botón que el .pen le pone a ESTE lugar en particular.
  it('incluye el <Formulario> de un solo campo, con "Quiero probarlo"', () => {
    const markup = html()
    expect(markup).toContain('name="contacto"')
    expect(markup).toContain('Quiero probarlo')
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

  // Task 11 del ciclo móvil: las tres tarjetas de módulo son una columna en
  // el teléfono (design/arandano.pen, frame `Móvil / Sitio · Landing`, nodo
  // `Csb0k`: Encabezado/Núcleo/Órdenes/Turnos/Gastronomía son 5 hermanos
  // apilados) y recién desde `lg:` pasan a 3 columnas.
  it('la grilla de módulos es una columna en el teléfono, 3 desde escritorio', () => {
    const markup = html()
    expect(markup).toContain('grid-cols-1')
    expect(markup).toContain('lg:grid-cols-3')
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

  // Task 11 del ciclo móvil: a diferencia de Módulos y Planes (una columna),
  // el .pen (frame `Móvil / Sitio · Landing`, nodo `dDugH`) arma Rubros en
  // PARES — seis filas de a dos tarjetas — así que en el teléfono son 2
  // columnas, no 1. Recién desde `lg:` pasa a las 4 de siempre. Verificado en
  // vivo con el MCP de Pencil: contradice la prosa del brief de esta task
  // ("pasan a una columna"), y manda el .pen.
  it('la grilla de rubros es 2 columnas en el teléfono (nodo dDugH), 4 desde escritorio', () => {
    const markup = html()
    expect(markup).toContain('grid-cols-2')
    expect(markup).toContain('lg:grid-cols-4')
  })

  // Fix de la Ronda de arreglos 1 sobre la Task 11 del ciclo móvil: en
  // escritorio la nota vive al lado del encabezado (nodo `bHS71`); en el
  // teléfono el .pen (`EKea9`) la pone DESPUÉS de la grilla, como hermano
  // aparte, no del encabezado. Dos copias, una por ancho — ninguna
  // desaparece, y cada una se afirma con su ausencia en el ancho contrario,
  // no sólo con la presencia de la clase que la cancela (eso pasaría igual
  // si alguien reintrodujera la nota sin `hidden`/`lg:hidden` al lado de una
  // copia vieja que ya la mostraba siempre).
  it('la nota "¿No está el tuyo?" aparece dos veces: oculta en escritorio dentro del encabezado, oculta en el teléfono después de la grilla', () => {
    const markup = html()
    const apariciones = [...markup.matchAll(/¿No está el tuyo\? Se agrega sin desarrollo\./g)]
    expect(apariciones).toHaveLength(2)

    // La primera (la del encabezado) es la de escritorio: hidden lg:block.
    const idxHeader = apariciones[0].index!
    const inicioHeader = markup.lastIndexOf('<p class="', idxHeader)
    const clasesHeader = markup.slice(inicioHeader).match(/^<p class="([^"]*)"/)?.[1]
    expect(clasesHeader, 'no se encontró el <p> de la nota en el encabezado').toBeTruthy()
    expect(clasesHeader).toContain('hidden')
    expect(clasesHeader).toContain('lg:block')
    // Negación explícita: esta copia NO puede ser la que se ve en el
    // teléfono (lg:hidden) — si alguien le cambia la clase por error, esto
    // tiene que quedar en rojo, no sólo "existe algo con hidden".
    expect(clasesHeader).not.toContain('lg:hidden')

    // La segunda (después de la grilla) es la del teléfono: lg:hidden, y sin
    // "hidden" a secas (que la sacaría también de escritorio: ahí es donde
    // tiene que reaparecer).
    const idxDespuesDeGrilla = apariciones[1].index!
    const inicioDespuesDeGrilla = markup.lastIndexOf('<p class="', idxDespuesDeGrilla)
    const clasesDespuesDeGrilla = markup
      .slice(inicioDespuesDeGrilla)
      .match(/^<p class="([^"]*)"/)?.[1]
    expect(
      clasesDespuesDeGrilla,
      'no se encontró el <p> de la nota después de la grilla',
    ).toBeTruthy()
    expect(clasesDespuesDeGrilla).toContain('lg:hidden')
    expect(clasesDespuesDeGrilla).not.toContain('hidden lg:block')
    // Y en escritorio esta segunda copia tiene que desaparecer de verdad: no
    // alcanza con "lg:hidden" en la clase si en algún momento se le suma un
    // "lg:block" que lo cancele — se niega esa combinación explícitamente.
    expect(clasesDespuesDeGrilla).not.toMatch(/\blg:block\b/)

    // Y la que aparece DESPUÉS de la grilla en el DOM tiene que ser,
    // justamente, la segunda — no una tercera copia suelta en otro lado.
    const idxGrilla = markup.indexOf('grid-cols-2')
    expect(idxDespuesDeGrilla).toBeGreaterThan(idxGrilla)
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

  // Minor 9 de la review final: variant="outline" sólo pinta bg-background +
  // border-border; uYEg4 (el .pen, consultado en vivo) pide $ar-surface
  // (--card) + $ar-line-strong (--input) para el botón NO destacado. El
  // destacado (Profesional) es un <a> con `style` inline propio (background
  // var(--marca-foreground)) — filtrar por su AUSENCIA aísla los botones
  // <Button asChild> sin depender de qué texto o qué posición tienen.
  it('el botón de cada plan NO destacado pinta bg-card y border-input (nodo uYEg4)', () => {
    const markup = html()
    const anchors = [...markup.matchAll(/<a href="#contacto"[^>]*>/g)].map((m) => m[0])
    const noDestacados = anchors.filter((a) => !a.includes('style='))
    // Básico, Negocio y Premium: los tres planes sin destacado.
    expect(noDestacados).toHaveLength(3)
    for (const a of noDestacados) {
      expect(a).toContain('bg-card')
      expect(a).toContain('border-input')
    }
  })

  // Task 11 del ciclo móvil: los cuatro planes son una columna en el
  // teléfono (design/arandano.pen, frame `Móvil / Sitio · Landing`, nodo
  // `IvCnb`: Básico/Negocio/Profesional/Premium son 4 hermanos apilados) y
  // recién desde `lg:` pasan a las 4 columnas de siempre.
  it('la grilla de planes es una columna en el teléfono, 4 desde escritorio', () => {
    const markup = html()
    expect(markup).toContain('grid-cols-1')
    expect(markup).toContain('lg:grid-cols-4')
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

  // Task 11 del ciclo móvil: el Pie apila la marca sobre los links en el
  // teléfono (design/arandano.pen, frame `Móvil / Sitio · Landing`, nodo
  // `itZnH`: layout vertical) y recién en escritorio vuelve a la fila con
  // justify-between de siempre.
  it('apila en el teléfono (flex-col) y vuelve a fila desde escritorio (lg:flex-row)', () => {
    const markup = renderToStaticMarkup(<Pie />)
    const inicio = markup.indexOf('<div class="')
    const clases = markup.slice(inicio).match(/^<div class="([^"]*)"/)?.[1]
    expect(clases).toContain('flex-col')
    expect(clases).toContain('lg:flex-row')
  })
})
