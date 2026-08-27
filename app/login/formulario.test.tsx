import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo criterio que app/(app)/inventario/formularios.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real. Acá sólo importa qué renderiza el formulario.
vi.mock('./acciones', () => ({ entrar: vi.fn() }))

async function render() {
  const { FormularioLogin } = await import('./formulario')
  return renderToStaticMarkup(<FormularioLogin dominio="flor.arandano.app" />)
}

describe('FormularioLogin', () => {
  it('el título "Entrar" y su subtítulo (design/arandano.pen, nodo M6mNY)', async () => {
    const html = await render()
    expect(html).toContain('Entrar')
    expect(html).toContain('Usuario y contraseña del local.')
  })

  it('el mail lleva el placeholder de ejemplo', async () => {
    const html = await render()
    expect(html).toContain('placeholder="flor@celularesflor.com.ar"')
  })

  it('arranca con la contraseña oculta: type="password" y el ícono "eye"', async () => {
    const html = await render()
    expect(html).toContain('type="password"')
    expect(html).not.toContain('type="text"')
  })

  // I6 de la review final: la versión anterior sólo afirmaba `<svg` (que
  // aporta el ícono del OJO de CampoClave) y `Entrar` (que aporta el <h1> del
  // título) — ninguna de las dos tocaba el botón, así que sacarle el
  // `<ArrowRight>` de verdad no lo ponía en rojo. Se acota al `<button>` que
  // contiene el texto "Entrar" (el submit, no el botón del ojo) y se busca la
  // clase real del ícono (`lucide-arrow-right`) adentro de ESE recorte.
  it('el botón lleva el ícono arrow-right junto al texto "Entrar"', async () => {
    const html = await render()
    const inicio = html.lastIndexOf('<button', html.lastIndexOf('>Entrar<'))
    const boton = html.slice(inicio, html.indexOf('</button>', inicio))
    expect(boton).toContain('lucide-arrow-right')
  })

  // El texto de ayuda tiene que decir la VERDAD del producto: no hay
  // proveedor de mail (CLAUDE.md), así que un mail de recupero sería mentira.
  it('la ayuda dice que resetea el dueño y que no se mandan mails de recupero', async () => {
    const html = await render()
    expect(html).toContain('Te la resetea el dueño del local desde Usuarios')
    expect(html).toContain('No mandamos')
    expect(html).toContain('mails de recupero')
  })
})

// I4 de la review final del cierre: los dos <Input>, el botón "Entrar" y los
// dos <Label> no pagaban la geometría/tipografía de design/arandano.pen (el
// barrido de la Task 6 buscaba `text-xs|text-\[1[0-9]px\]`, y estos campos no
// declaraban NINGÚN tamaño, así que el grep no los encontraba). Valores
// consultados en vivo con el MCP de Pencil (nodos `Wz7cZ`/`GmOfQ` los
// inputs, `E5gfx` el botón, `aSxqO`/`UiPiY` los rótulos).
describe('geometría contra design/arandano.pen (I4 de la review final)', () => {
  // Task 11 del ciclo móvil: los dos <Input> miden 50px/r11 en el teléfono
  // (nodos vSgDl/Sl8Lu, frame `Móvil / Login`) y vuelven a 44px/r9 en
  // escritorio (nodos Wz7cZ/GmOfQ, el valor de siempre) — mobile-first.
  it('los dos <Input> miden 50px/r11 en el teléfono, 44px/r9 en escritorio (I4 + Task 11)', async () => {
    const html = await render()
    const inputs = [...html.matchAll(/<input[^>]*class="([^"]*)"[^>]*>/g)].map((m) => m[1])
    expect(inputs).toHaveLength(2)
    for (const clases of inputs) {
      expect(clases).toContain('h-[50px]')
      expect(clases).toContain('rounded-[11px]')
      expect(clases).toContain('lg:h-11')
      expect(clases).toContain('lg:rounded-[9px]')
    }
  })

  // Menor de la Ronda de arreglos 1 sobre la Task 11: el padding horizontal
  // de los dos <Input> es 13px en el teléfono (nodos vSgDl/Sl8Lu), 11px
  // desde escritorio (nodos Wz7cZ/GmOfQ, el valor de siempre) — antes
  // quedaba fijo en 11 en los dos anchos. Dos casos separados y no uno
  // genérico: cada campo usa un prefijo Tailwind distinto (pl- en el de
  // contraseña, por el ícono del ojo a la derecha; px- en el de mail), y una
  // negación genérica contra "[11px]" pegaría también con "rounded-[11px]",
  // que no tiene nada que ver con este padding.
  it('el padding izquierdo del campo de contraseña es 13px en el teléfono, 11px en escritorio', async () => {
    const html = await render()
    // El <Input> de shadcn arma class ANTES de esparcir el resto de las
    // props (components/ui/input.tsx: `className={cn(...)} {...props}`), así
    // que en el DOM real el atributo `class` sale ANTES que `name` — no al
    // revés. Se busca la etiqueta completa y se filtra por contenido, no por
    // orden de atributos.
    const clave = [...html.matchAll(/<input[^>]*>/g)]
      .map((m) => m[0])
      .find((tag) => tag.includes('name="clave"'))
    expect(clave, 'no se encontró el <input name="clave">').toBeTruthy()
    expect(clave).toContain('pl-[13px]')
    expect(clave).toContain('lg:pl-[11px]')
    // Negación explícita: "pl-[11px]" SIN el prefijo lg: no puede sobrevivir
    // — es exactamente el bug que este caso corrige.
    expect(clave).not.toMatch(/(?<!lg:)pl-\[11px\]/)
  })

  it('el padding horizontal del campo de mail es 13px en el teléfono, 11px en escritorio', async () => {
    const html = await render()
    const mail = [...html.matchAll(/<input[^>]*>/g)]
      .map((m) => m[0])
      .find((tag) => tag.includes('name="email"'))
    expect(mail, 'no se encontró el <input name="email">').toBeTruthy()
    expect(mail).toContain('px-[13px]')
    expect(mail).toContain('lg:px-[11px]')
    expect(mail).not.toMatch(/(?<!lg:)px-\[11px\]/)
  })

  // Task 11: el botón "Entrar" mide 52px/r12/gap8 en el teléfono (nodo
  // yh21O) y vuelve a 48px/r11/gap7/pad-x15 en escritorio (nodo E5gfx, el
  // valor de siempre).
  it('el botón "Entrar" mide 52px/r12/gap8 en el teléfono, 48px/r11/gap7/pad-x15 en escritorio (I4 + Task 11)', async () => {
    const html = await render()
    const boton = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0]
    expect(boton, 'no se encontró el <button type="submit">').toBeTruthy()
    expect(boton).toContain('h-[52px]')
    expect(boton).toContain('gap-2')
    expect(boton).toContain('rounded-[12px]')
    expect(boton).toContain('px-[15px]')
    expect(boton).toContain('lg:h-12')
    expect(boton).toContain('lg:gap-[7px]')
    expect(boton).toContain('lg:rounded-[11px]')
  })

  it('los rótulos "Mail" y "Contraseña" son 11px/600 en --foreground-soft (nodos aSxqO/UiPiY)', async () => {
    const html = await render()
    const rotulos = [...html.matchAll(/<label[^>]*class="([^"]*)"[^>]*>([^<]*)<\/label>/g)]
    const textos = rotulos.map((m) => m[2])
    expect(textos).toEqual(['Mail', 'Contraseña'])
    for (const [, clases] of rotulos) {
      expect(clases).toContain('text-[11px]')
      expect(clases).toContain('font-semibold')
      expect(clases).toContain('text-foreground-soft')
    }
  })

  // Minor 11 de la review final, consultado en vivo (nodos wxmdz/r70Sp/PK27T/
  // frBAX/vXQs2): la Caja mide 360px fijos (no max-w-sm=384), el gap del
  // Título es 5px (no 4), el de Campos 14px (no 16) y el de cada campo
  // individual 5px (no 8).
  it('la Caja mide 360px; los gaps de Título/Campos/cada campo son 5/14/5', async () => {
    const html = await render()
    expect(html).toContain('w-[360px]')
    expect(html).not.toContain('max-w-sm')
    // Título, el campo Mail y el campo Contraseña: los tres con gap-[5px].
    expect(html.match(/gap-\[5px\]/g)).toHaveLength(3)
    expect(html).toContain('gap-[14px]')
  })

  // Task 11 del ciclo móvil: el <form> pasa a ocupar el ancho completo en el
  // teléfono (nodo `TyIWX`, frame `Móvil / Login`, fill_container) y sólo en
  // escritorio vuelve a los 360px fijos de siempre. El gap externo (Título,
  // Campos, Botón, Ayuda) también es mobile-first: 18px en el teléfono, 20px
  // (gap-5) en escritorio.
  it('el <form> es w-full en el teléfono y w-[360px] recién desde escritorio', async () => {
    const html = await render()
    const form = html.match(/<form[^>]*class="([^"]*)"/)?.[1]
    expect(form, 'no se encontró el <form>').toBeTruthy()
    expect(form).toContain('w-full')
    expect(form).toContain('lg:w-[360px]')
    expect(form).toContain('gap-[18px]')
    expect(form).toContain('lg:gap-5')
  })
})

// Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Login`,
// `Kp4Eg`): el pie con la URL del tenant se muda al fondo del formulario en
// el teléfono (nodo `eY0BS`), empujado por un espaciador `flex-1` (nodo
// `i4g4a`) — con otro color que el de escritorio (ink, no marca: acá el fondo
// es claro, no el paño violeta). En escritorio esta mitad se oculta
// (`lg:hidden`) porque el pie real vive dentro del paño (ver page.tsx).
describe('FormularioLogin — el pie del teléfono (dominio del tenant)', () => {
  it('muestra el dominio recibido por prop, con la nota de siempre', async () => {
    const html = await render()
    expect(html).toContain('flor.arandano.app')
    expect(html).toContain('Cada local entra por su propia dirección.')
  })

  it('el bloque del pie es lg:hidden (sólo existe en el teléfono)', async () => {
    const html = await render()
    const idx = html.indexOf('flor.arandano.app')
    // El <div> que envuelve el pie es el ÚLTIMO abierto antes del dominio; se
    // busca hacia atrás el primer class= que lleve lg:hidden.
    const antes = html.slice(0, idx)
    const ultimaAperturaDeDiv = antes.lastIndexOf('<div class="')
    const clases = antes.slice(ultimaAperturaDeDiv).match(/^<div class="([^"]*)"/)?.[1]
    expect(clases, 'no se encontró el <div> del pie').toBeTruthy()
    expect(clases).toContain('lg:hidden')
  })
})

describe('tipoDelCampoClave — la regla pura detrás del ojo', () => {
  it('mostrar=false da password; mostrar=true da text', async () => {
    const { tipoDelCampoClave } = await import('./formulario')
    expect(tipoDelCampoClave(false)).toBe('password')
    expect(tipoDelCampoClave(true)).toBe('text')
  })
})

describe('CampoClave — los dos estados del ojo, renderizados directo', () => {
  // Este harness no simula clicks (sin jsdom), así que los dos estados se
  // ejercitan pasando `mostrar` directo, en vez de intentar togglear uno
  // solo — la ÚNICA forma de que un test afirme sobre lo RENDERIZADO en cada
  // caso, no sobre la forma del código.
  it('mostrar=false: type="password", ícono "eye", aria-pressed="false"', async () => {
    const { CampoClave } = await import('./formulario')
    const html = renderToStaticMarkup(
      <CampoClave mostrar={false} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    expect(html).toContain('type="password"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Mostrar la contraseña"')
    // "lucide-eye " (con el espacio) y no "lucide-eye-off": el segundo
    // contiene al primero como prefijo si sólo se busca "lucide-eye".
    expect(html).toContain('lucide-eye ')
    expect(html).not.toContain('lucide-eye-off')
  })

  it('mostrar=true: type="text", ícono "eye-off", aria-pressed="true"', async () => {
    const { CampoClave } = await import('./formulario')
    const html = renderToStaticMarkup(
      <CampoClave mostrar={true} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    expect(html).toContain('type="text"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Ocultar la contraseña"')
    expect(html).toContain('lucide-eye-off ')
  })

  it('los dos estados rinden HTML distinto entre sí', async () => {
    const { CampoClave } = await import('./formulario')
    const oculto = renderToStaticMarkup(
      <CampoClave mostrar={false} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    const visible = renderToStaticMarkup(
      <CampoClave mostrar={true} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    expect(oculto).not.toBe(visible)
  })
})
