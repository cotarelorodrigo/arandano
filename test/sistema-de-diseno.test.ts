import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const CSS = 'app/globals.css'

describe('el CSS no arrastra tokens muertos', () => {
  const css = readFileSync(CSS, 'utf8')

  it('no hay bloque .dark', () => {
    // Se borró a propósito: definía 28 variables y nada aplicaba la clase.
    // `npx shadcn init` lo reinyecta, así que esto es un cable trampa y no una
    // aserción decorativa. Anclado a principio de línea para no confundirse con
    // el `.dark *` que vive adentro de @custom-variant, que SÍ se queda.
    expect(
      css,
      'volvió el bloque .dark a app/globals.css. Si es a propósito, es un ciclo ' +
        'propio: hace falta activador, persistencia y una paleta oscura completa.',
    ).not.toMatch(/^\.dark\s*\{/m)
  })

  it('@custom-variant dark sigue estando', () => {
    // La línea más filosa del ciclo. button.tsx e input.tsx traen 5 clases
    // `dark:`. Mientras esta línea exista, el variante queda atado a una clase
    // que nadie pone y esas reglas quedan inertes. Si se borra, `dark:` vuelve
    // al default de Tailwind v4 —prefers-color-scheme— y se activarían solas en
    // cualquier usuario con el sistema en oscuro, sobre la paleta clara.
    expect(
      css,
      'se borró @custom-variant dark. Sin esa línea las clases dark: de shadcn ' +
        'se activan por prefers-color-scheme sobre una paleta que no tiene ' +
        'ningún token oscuro definido.',
    ).toMatch(/@custom-variant\s+dark\s+\(&:is\(\.dark \*\)\)/)
  })

  it('no quedan tokens de sidebar ni de gráficos', () => {
    // Ningún componente ni pantalla los referencia — verificado por grep al
    // escribir el spec. Vuelven solos con `npx shadcn add sidebar` o con el
    // primer gráfico, y ahí se documentan.
    const muertos = [...css.matchAll(/--(?:color-)?(?:sidebar|chart)[a-z0-9-]*/g)].map(
      (m) => m[0],
    )
    expect(
      muertos,
      `app/globals.css declara tokens que ningún componente usa: ${muertos.join(', ')}. ` +
        `Si entró un componente que sí los usa, documentalos en docs/sistema-de-diseno.md ` +
        `y sacá este caso.`,
    ).toEqual([])
  })
})
