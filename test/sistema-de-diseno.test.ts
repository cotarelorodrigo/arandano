import { describe, it, expect, beforeAll } from 'vitest'
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

const DOC = 'docs/sistema-de-diseno.md'
const INICIO = '<!-- tokens:inicio -->'
const FIN = '<!-- tokens:fin -->'

/**
 * Los tokens que DECLARA la tabla normativa del documento.
 *
 * Entre marcadores y no "la primera tabla del archivo": el doc tiene además la
 * tabla de contraste y la de espaciado, y un parser que agarre la que venga
 * primero se rompe el día que alguien reordene secciones.
 */
function tokensDelDoc(): Map<string, string> {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(
      `${DOC} no tiene los marcadores ${INICIO} … ${FIN} alrededor de la tabla ` +
        `normativa, o están al revés. Sin ellos no hay nada contra qué comparar el CSS.`,
    )
  }
  const tokens = new Map<string, string>()
  for (const linea of texto.slice(desde, hasta).split('\n')) {
    const m = linea.match(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|/)
    if (m) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

/** Los tokens que DEFINE el bloque :root de globals.css. */
function tokensDelCss(): Map<string, string> {
  const texto = readFileSync(CSS, 'utf8')
  const bloque = texto.match(/^:root\s*\{([\s\S]*?)^\}/m)
  if (!bloque) throw new Error(`${CSS} no tiene un bloque :root que se pueda leer`)
  const tokens = new Map<string, string>()
  for (const linea of bloque[1].split('\n')) {
    const m = linea.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/)
    if (m) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

describe('el documento y el CSS declaran lo mismo', () => {
  // En un beforeAll y no en el cuerpo del describe: un .md faltante o
  // ilegible tiene que tumbar sólo estos 4 casos, no la collection del
  // archivo entero. Con las llamadas acá arriba, ese throw se llevaba puesto
  // el describe anterior (Task 1) — los 3 cables trampa del CSS dejaban de
  // correr, ni en verde ni en rojo, en vez de seguir cuidando lo suyo.
  let doc: Map<string, string>
  let css: Map<string, string>

  beforeAll(() => {
    doc = tokensDelDoc()
    css = tokensDelCss()
  })

  // Las dos mitades que hacen que esto no sea decorativo. Un parser que no
  // encuentra nada devuelve un Map vacío, y dos Maps vacíos son iguales: el
  // test daría verde sobre un documento roto. Es el mismo modo de falla que ya
  // cerraron rutas_autenticadas y test/boundaries-app.test.ts.
  it('la tabla del documento no está vacía', () => {
    expect(
      doc.size,
      `no se parseó ningún token de la tabla normativa de ${DOC}. O la tabla ` +
        `quedó vacía, o cambió el formato de las filas y el regex dejó de matchear.`,
    ).toBeGreaterThan(0)
  })

  it('el bloque :root del CSS no está vacío', () => {
    expect(css.size, `no se parseó ningún token del :root de ${CSS}`).toBeGreaterThan(0)
  })

  it('todo token del documento existe en el CSS, con el mismo valor', () => {
    for (const [nombre, valor] of doc) {
      expect(
        css.get(nombre),
        `${DOC} declara ${nombre}: ${valor}, y ${CSS} ${
          css.has(nombre) ? `tiene ${css.get(nombre)}` : 'no lo define'
        }. El documento es la fuente de verdad: si el color cambió, cambialo en los dos.`,
      ).toBe(valor)
    }
  })

  it('todo token del CSS está documentado', () => {
    const sinDocumentar = [...css.keys()].filter((n) => !doc.has(n))
    expect(
      sinDocumentar,
      `${CSS} define tokens que ${DOC} no declara: ${sinDocumentar.join(', ')}. ` +
        `Un color que no está escrito en ningún lado es exactamente lo que este ` +
        `documento existe para impedir.`,
    ).toEqual([])
  })
})
