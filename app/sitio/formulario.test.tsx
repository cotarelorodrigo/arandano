import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Formulario, PantallaDeGracias } from './formulario'

// El action no se ejercita acá —tiene su propio archivo, contra la base—: lo
// que este test cuida es el contrato del FORMULARIO con el action, que es el
// que se rompe en silencio si alguien renombra el campo.
vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

function html(props: { whatsapp?: string; textoBoton?: string; variante?: 'clara' | 'oscura' } = {}) {
  return renderToStaticMarkup(
    <Formulario
      whatsapp={props.whatsapp ?? '5491155555555'}
      textoBoton={props.textoBoton}
      variante={props.variante}
    />,
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

  // El .pen pone un texto de botón DISTINTO en el Hero ("Quiero probarlo")
  // y en el Cierre ("Empezar", el default de esta prop) — mismo campo, mismo
  // action, invitación distinta según dónde aparece.
  it('el botón dice "Empezar" por default', () => {
    expect(html()).toContain('Empezar')
    expect(html()).not.toContain('Quiero probarlo')
  })

  it('el botón dice lo que le pasen, cuando se lo pasan', () => {
    const markup = html({ textoBoton: 'Quiero probarlo' })
    expect(markup).toContain('Quiero probarlo')
    expect(markup).not.toContain('>Empezar<')
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
  // mezcla translúcida que ya tenía (sin tocar).
  it('el marco de "clara" pinta --background; el de "oscura" sigue con su mezcla translúcida', () => {
    expect(html({ variante: 'clara' })).toContain('background-color:var(--background)')
    expect(html({ variante: 'oscura' })).toContain(
      'background-color:color-mix(in srgb, var(--marca-foreground) 8%, transparent)',
    )
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
