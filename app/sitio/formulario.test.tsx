import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { Formulario, PantallaDeGracias } from './formulario'

// El action no se ejercita acá —tiene su propio archivo, contra la base—: lo
// que este test cuida es el contrato del FORMULARIO con el action, que es el
// que se rompe en silencio si alguien renombra el campo.
vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

function html(props: { whatsapp?: string; variante?: 'clara' | 'oscura' } = {}) {
  return renderToStaticMarkup(
    <Formulario whatsapp={props.whatsapp ?? '5491155555555'} variante={props.variante} />,
  )
}

// PantallaDeGracias es la rama de estado.enviado === true, a la que
// renderToStaticMarkup no puede llegar renderizando <Formulario> (no hay
// jsdom ni testing-library en este repo para disparar la transición de
// useActionState) — por eso se afirma directamente sobre el componente
// exportado, que es la razón por la que existe separado.
const gracias = (whatsapp: string) => renderToStaticMarkup(<PantallaDeGracias whatsapp={whatsapp} />)

/**
 * Reescrito para la Task 5 del cierre del rediseño: el formulario pasó de
 * cinco campos (nombre, mail, whatsapp, rubro, mensaje) a uno solo
 * ("contacto"), design/arandano.pen. `enviarLead` clasifica ese único valor
 * en email o whatsapp — este archivo sólo cuida el contrato del FORM con el
 * action (el nombre del campo, el honeypot), no la clasificación en sí, que
 * tiene su propio archivo (`acciones.test.ts`).
 */
describe('formulario de la landing', () => {
  it('emite un solo campo, "contacto" — ninguno de los cinco viejos sigue existiendo', () => {
    const markup = html()
    expect(markup).toContain('name="contacto"')
    for (const campoViejo of ['nombre', 'email', 'rubro', 'mensaje']) {
      expect(markup).not.toContain(`name="${campoViejo}"`)
    }
  })

  it('el placeholder del campo es el de la maqueta, literal', () => {
    expect(html()).toContain('Tu WhatsApp o tu mail')
  })

  // El id sale de useId() y no está escrito a mano (Critical C2 de la review
  // final): landing.tsx renderiza <Formulario> dos veces, así que un id fijo
  // "contacto" chocaba con el id="contacto" de la propia <section> del
  // Cierre. Acá se afirma la ASOCIACIÓN —el id que sea, pero el mismo en el
  // <label> y en el <input>— y no el literal "contacto", que dejó de ser el
  // id real. La cobertura de que la landing entera no repite ningún id vive
  // en landing.test.tsx, que es donde el choque de las tres piezas es visible.
  it('el campo es accesible: su etiqueta apunta al MISMO id que el input, sea cual sea', () => {
    const markup = html()
    const inputTag = markup.match(/<input[^>]*name="contacto"[^>]*>/)?.[0]
    expect(inputTag, 'no se encontró el <input name="contacto"> en el markup').toBeTruthy()
    const idInput = inputTag!.match(/id="([^"]+)"/)?.[1]
    expect(idInput, 'el <input> de contacto no tiene id').toBeTruthy()
    expect(markup).toContain(`for="${idInput}"`)
    // Y ya no es el literal fijo que generaba el choque de ids.
    expect(idInput).not.toBe('contacto')
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

  /**
   * UN SOLO TEXTO PARA LAS DOS INSTANCIAS. El `.pen` ponía uno distinto en
   * cada lugar —"Quiero probarlo" en el Hero, "Empezar" en el Cierre— y este
   * componente lo recibía por prop. La página terminaba con tres verbos para
   * una acción sola (más "Probar 5 días" en el Nav y en los planes), y una
   * interfaz que llama distinto a lo mismo obliga a averiguar si son lo mismo.
   * La prop se fue para que no se pueda volver a divergir por descuido.
   */
  it('el botón dice qué pasa al apretarlo, y siempre lo mismo', () => {
    const claro = html({ variante: 'clara' })
    const oscuro = html({ variante: 'oscura' })
    expect(claro).toContain('Que me escriban')
    expect(oscuro).toContain('Que me escriban')
    expect(claro).not.toContain('Quiero probarlo')
    expect(claro).not.toContain('>Empezar<')
  })

  it('ofrece el WhatsApp como salida directa', () => {
    expect(html()).toContain('https://wa.me/5491155555555')
  })

  // Ruling del controlador (Task 6): sin número real todavía, un wa.me vacío
  // mandaría a la nada. Sin whatsapp, el link no se dibuja en ningún lado.
  it('sin whatsapp, no hay link a wa.me', () => {
    expect(html({ whatsapp: '' })).not.toContain('wa.me')
  })

  // Fix de review de la Task 6: el caso de arriba sólo cubre el pie del
  // formulario (estado.enviado === false). La pantalla de gracias es la otra
  // mitad del ruling, y necesita su propio par de casos.
  it('la pantalla de gracias, con whatsapp, sí trae el wa.me', () => {
    expect(gracias('5491155555555')).toContain('https://wa.me/5491155555555')
  })

  it('la pantalla de gracias, sin whatsapp, no trae el wa.me', () => {
    expect(gracias('')).not.toContain('wa.me')
  })

  // 'clara' es el default (Hero); 'oscura' es el Cierre, sobre --marca. Las
  // dos pintan el input con un fondo sólido PROPIO —no `bg-transparent`, el
  // default de shadcn— para que se lea como su propia pieza y no se confunda
  // con lo que tenga detrás: --marca-foreground en 'oscura' (contra la franja
  // oscura, nodo `V9xSVB`), --card en 'clara' (divergencia "hermana" de I5 de
  // la review final: el .pen pinta el marco con $ar-bg y el input con
  // $ar-surface — nodos `P2ZVg6`/`EtDRA` — y antes de este fix ninguno de los
  // dos se pintaba, así que el campo y su marco quedaban del mismo color que
  // la página de fondo, sea cual sea ese color).
  it('el input pinta --marca-foreground en "oscura" y --card en "clara" — nunca transparente', () => {
    expect(html({ variante: 'oscura' })).toContain('background-color:var(--marca-foreground)')
    expect(html({ variante: 'clara' })).toContain('background-color:var(--card)')
    expect(html({ variante: 'clara' })).not.toContain('background-color:var(--marca-foreground)')
  })

  // El marco (el <form> en sí) también pinta un fondo propio en 'clara' —
  // --background, el mismo $ar-bg del nodo P2ZVg6— para que el input en
  // --card se distinga de su marco. En 'oscura' el marco sigue con la
  // mezcla translúcida que ya tenía.
  //
  // Fix de la Ronda de arreglos 1 sobre la Task 11 del ciclo móvil: el marco
  // dejó de pintarse con `style={{ backgroundColor: ... }}` (un inline no
  // puede quedar detrás de una media query) y pasó a un CSS Module
  // (formulario.module.css, `.marcoClara`/`.marcoOscura`) — acá sólo se
  // afirma que el <form> queda atado a la clase correcta según la variante
  // (bajo vitest un módulo CSS es un proxy identidad: `estilos.marcoClara`
  // resuelve al string "marcoClara"); el color y la media query en sí los
  // cuida la describe de abajo, que LEE el CSS real.
  it('el <form> lleva la clase del marco según la variante, y ya no un style inline', () => {
    const clara = html({ variante: 'clara' })
    const oscura = html({ variante: 'oscura' })
    const formClara = clara.match(/<form[^>]*class="([^"]*)"/)?.[1]
    const formOscura = oscura.match(/<form[^>]*class="([^"]*)"/)?.[1]
    expect(formClara).toContain('marcoClara')
    expect(formClara).not.toContain('marcoOscura')
    expect(formOscura).toContain('marcoOscura')
    expect(formOscura).not.toContain('marcoClara')
    // El <form> ya no lleva ningún style: el color del marco vive entero en
    // el CSS Module.
    expect(formClara).toBeTruthy()
    expect(clara).not.toMatch(/<form[^>]*style=/)
    expect(oscura).not.toMatch(/<form[^>]*style=/)
  })

  // Minor 10 de la review final: el .pen pide 46px en el Hero (nodos
  // EtDRA/HfYKR) y 48px en el Cierre (nodos V9xSVB/sUETx) — el código tenía
  // 46 en los dos. Se afirma sobre el <input> Y el botón, en las dos
  // variantes.
  it('mide 46px en "clara" (Hero) y 48px en "oscura" (Cierre) desde escritorio — input y botón', () => {
    const clara = html({ variante: 'clara' })
    const oscura = html({ variante: 'oscura' })
    expect(clara).toContain('h-[46px]')
    expect(clara).not.toContain('h-[48px]')
    expect(oscura).toContain('h-[48px]')
    expect(oscura).not.toContain('h-[46px]')
    // Las dos piezas (input y botón) de CADA variante, no sólo una de las dos.
    expect(clara.match(/h-\[46px\]/g)).toHaveLength(2)
    expect(oscura.match(/h-\[48px\]/g)).toHaveLength(2)
  })

  // Task 11 del ciclo móvil: en el teléfono las dos variantes miden 50px —
  // el Lead del Hero (nodos Wc1DB/MJENr) y el Formulario del Cierre (nodos
  // YBpWb/myteL), frame `Móvil / Sitio · Landing` — y recién en escritorio
  // (`lg:`) se separan en 46/48 como antes. Mobile-first: el valor sin
  // prefijo es el del teléfono.
  it('mide 50px en el teléfono, en las dos variantes — input y botón', () => {
    const clara = html({ variante: 'clara' })
    const oscura = html({ variante: 'oscura' })
    expect(clara.match(/h-\[50px\]/g)).toHaveLength(2)
    expect(oscura.match(/h-\[50px\]/g)).toHaveLength(2)
    expect(clara.match(/lg:h-\[46px\]/g)).toHaveLength(2)
    expect(oscura.match(/lg:h-\[48px\]/g)).toHaveLength(2)
  })

  // El corte viejo de este archivo (sm:, que miraba el viewport) migra al
  // único corte del ciclo (lg:, 1024) — ver CLAUDE.md / el brief de la Task
  // 11. Ningún sm:/md:/xl: puede sobrevivir acá.
  it('el marco pasa de sm: a lg: — el corte viejo no sobrevive', () => {
    const markup = html()
    // Se acota al <form> propio: shadcn trae de fábrica un `md:text-sm` en
    // el <Input> (components/ui/input.tsx) que no es de este archivo y no
    // corresponde migrar acá.
    const form = markup.match(/<form[^>]*class="([^"]*)"/)?.[1]
    expect(form, 'no se encontró el <form>').toBeTruthy()
    expect(form).not.toMatch(/\bsm:/)
    expect(form).not.toMatch(/\bmd:/)
    expect(form).not.toMatch(/\bxl:/)
    expect(form).toContain('lg:flex-row')
    expect(form).toContain('lg:flex-wrap')
    expect(form).toContain('lg:items-center')
  })
})

/**
 * `formulario.module.css` — el marco compartido de `<Formulario>`, sólo de
 * escritorio (Fix de la Ronda de arreglos 1 sobre la Task 11 del ciclo
 * móvil). Se lee el archivo como texto, mismo mecanismo que
 * `app/login/persiana.test.ts` usa para `persiana.module.css`: bajo vitest
 * un módulo CSS es un proxy identidad, así que la única forma de atar una
 * propiedad de una regla real es leer el CSS.
 *
 * Lo que este archivo cuida no es sólo que el color de escritorio esté bien
 * (ya lo hace el test de arriba, indirectamente, comparando contra el HTML
 * de antes de este fix) — es que la ausencia en el teléfono sea EXPLÍCITA:
 * afirmar sólo que existe la clase que la cancela pasaría igual si alguien
 * reintrodujera un `style` inline al lado de la clase (el inline gana
 * siempre, la clase quedaría de adorno). Por eso las dos primeras
 * aserciones son un `not.toMatch` contra el bloque BASE, sin media query.
 */
describe('formulario.module.css — el marco es sólo de escritorio (Fix Ronda 1, Task 11)', () => {
  const css = readFileSync('app/sitio/formulario.module.css', 'utf8')

  // El bloque base es todo lo que hay ANTES de la media query real (no
  // basta con buscar la SUBCADENA "@media": el propio comentario de este
  // archivo la menciona en prosa) — ahí no puede aparecer ninguna propiedad
  // de caja.
  const inicioMedia = css.indexOf('@media (min-width: 1024px)')
  const bloqueBase = css.slice(0, inicioMedia)
  const bloqueMedia = css.slice(inicioMedia)

  // Se lee el CUERPO de la regla, no el bloque base entero: el propio
  // docblock de este archivo menciona "padding" y "backgroundColor" en
  // prosa (explicando POR QUÉ el marco no está acá), así que buscar esas
  // palabras contra el bloque base completo daría un falso positivo — el
  // comentario, no una declaración real, es lo que las contendría.
  const cuerpoClaraBase = bloqueBase.match(/\.marcoClara\s*\{([^}]*)\}/)?.[1]
  const cuerpoOscuraBase = bloqueBase.match(/\.marcoOscura\s*\{([^}]*)\}/)?.[1]

  it('.marcoClara y .marcoOscura existen, y su CUERPO está vacío en el teléfono', () => {
    expect(cuerpoClaraBase, 'no se encontró .marcoClara en el bloque base').toBeDefined()
    expect(cuerpoOscuraBase, 'no se encontró .marcoOscura en el bloque base').toBeDefined()
    // trim() y no una regex de "está vacío": una sola declaración colada
    // (aunque fuera "border: none") tiene que poner esto en rojo.
    expect(cuerpoClaraBase?.trim()).toBe('')
    expect(cuerpoOscuraBase?.trim()).toBe('')
  })

  it('el CUERPO de las dos reglas en el teléfono no tiene ni borde, ni fondo, ni padding, ni radio', () => {
    for (const cuerpo of [cuerpoClaraBase, cuerpoOscuraBase]) {
      expect(cuerpo).not.toMatch(/border/)
      expect(cuerpo).not.toMatch(/background/)
      expect(cuerpo).not.toMatch(/padding/)
      expect(cuerpo).not.toMatch(/border-radius/)
    }
  })

  it('desde 1024px, las dos comparten radio 14px, borde de 1px y padding de 7px', () => {
    expect(bloqueMedia).toContain('border-radius: 14px')
    expect(bloqueMedia).toContain('border-width: 1px')
    expect(bloqueMedia).toContain('padding: 7px')
  })

  it('.marcoClara pinta --background con border-color --border, desde escritorio', () => {
    // Última coincidencia y no la primera: ".marcoClara" también aparece en
    // el selector compartido ("`.marcoClara,\n  .marcoOscura {`"), y la
    // regla específica con el color va DESPUÉS de esa, no antes.
    const bloque = [...bloqueMedia.matchAll(/\.marcoClara\s*\{([^}]*)\}/g)].at(-1)?.[1]
    expect(bloque, 'no se encontró .marcoClara adentro del @media').toBeTruthy()
    expect(bloque).toContain('background-color: var(--background)')
    expect(bloque).toContain('border-color: var(--border)')
  })

  it('.marcoOscura pinta la mezcla translúcida de --marca-foreground, desde escritorio', () => {
    // Misma razón que arriba: ".marcoOscura" cierra el selector compartido
    // ("`.marcoClara,\n  .marcoOscura {`"), así que la PRIMERA coincidencia
    // sería esa regla genérica y no la específica con el color.
    const bloque = [...bloqueMedia.matchAll(/\.marcoOscura\s*\{([^}]*)\}/g)].at(-1)?.[1]
    expect(bloque, 'no se encontró .marcoOscura adentro del @media').toBeTruthy()
    expect(bloque).toContain(
      'background-color: color-mix(in srgb, var(--marca-foreground) 8%, transparent)',
    )
    expect(bloque).toContain(
      'border-color: color-mix(in srgb, var(--marca-foreground) 15%, transparent)',
    )
  })
})
