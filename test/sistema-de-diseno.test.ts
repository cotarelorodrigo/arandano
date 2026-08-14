import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// Una sola implementación del parser del :root, no dos idénticas. Estaba
// copiada acá y en el script, y la copia no es gratis: el arreglo que las obliga
// a exigir un único :root de primer nivel habría que hacerlo en dos lugares, y
// el día que alguien toque uno solo, el otro sigue midiendo la paleta vieja sin
// decir nada.
import { tokensDelCss } from '@/scripts/contraste.mts'

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
    // cualquier usuario con el sistema en oscuro. Que la paleta de :root ahora
    // SEA oscura no las vuelve correctas: se escribieron para otra paleta
    // oscura, la de shadcn, y pisarían estos tokens con los de ella.
    expect(
      css,
      'se borró @custom-variant dark. Sin esa línea las clases dark: de shadcn ' +
        'se activan por prefers-color-scheme y pisan los tokens de :root con los ' +
        'de la paleta oscura de shadcn, que no es ésta.',
    ).toMatch(/@custom-variant\s+dark\s+\(&:is\(\.dark \*\)\)/)
  })

  it('hay un solo bloque :root, y de primer nivel', () => {
    // El cable trampa que faltaba, y el más filoso de los cuatro: en CSS gana
    // el último, así que un segundo `:root` al final del archivo —o uno adentro
    // de `@media (prefers-color-scheme: dark)`— es la paleta que el usuario ve.
    // El parser viejo agarraba el primero con un regex y todo el mecanismo
    // quedaba ciego: 13 casos en verde con la aplicación sirviendo otros
    // colores, y el modo oscuro que este ciclo declara cerrado volviendo por
    // esa puerta. El mensaje lo trae el throw de tokensDelCss().
    expect(() => tokensDelCss()).not.toThrow()
  })

  it('no quedan tokens de sidebar', () => {
    // Ningún componente ni pantalla los referencia — verificado por grep al
    // escribir el spec. Vuelven solos con `npx shadcn add sidebar`, y ahí se
    // documentan.
    //
    // Los de gráfico SALIERON de esta lista el día que entró el panel "Cómo
    // entró la plata" de /ventas, que es exactamente lo que este caso pedía que
    // pasara: --chart-1 y --chart-2 los usa app/(app)/ventas/grafico.tsx y los
    // declara docs/sistema-de-diseno.md, con su contraste medido y sus dos
    // excepciones escritas. Lo que sigue cuidándolos es el par de casos de
    // abajo, que compara documento y CSS en las dos direcciones — un --chart-3
    // que aparezca sin documentar rompe igual.
    const muertos = [...css.matchAll(/--(?:color-)?sidebar[a-z0-9-]*/g)].map((m) => m[0])
    expect(
      muertos,
      `app/globals.css declara tokens que ningún componente usa: ${muertos.join(', ')}. ` +
        `Si entró un componente que sí los usa, documentalos en docs/sistema-de-diseno.md ` +
        `y sacá este caso.`,
    ).toEqual([])
  })

  it('declara color-scheme: dark', () => {
    // Sin esta declaración el navegador pinta de claro todo lo que la hoja de
    // estilos no controla: los scrollbars, el selector nativo de
    // <input type="date"> —que /ventas usa en Desde y Hasta— y el lienzo antes
    // del primer paint, que es un flash blanco en cada carga. Es un modo de
    // falla que sólo se ve en un navegador de verdad, nunca en jsdom, así que
    // el único lugar donde puede quedar atrapado es acá.
    expect(
      css,
      'app/globals.css no declara color-scheme: dark. La paleta es oscura, así ' +
        'que los controles nativos y el lienzo del primer paint quedan claros.',
    ).toMatch(/color-scheme:\s*dark/)
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

/**
 * Todo archivo de pantalla o de estilo donde nombrar `--primary-foreground`
 * sería sospechoso: `app/` entero y `components/` **salvo `components/ui/`**.
 *
 * El caso escaneaba sólo `app/`, mientras su propio mensaje de falla decía que
 * el token es legítimo "sólo … en components/ui/" — o sea que se presentaba
 * como una regla sobre todo el código propio y cubría la mitad.
 * `components/navegacion.tsx`, `components/cartel.module.css` y
 * `components/contexto.tsx` no los miraba nadie, y son exactamente la clase de
 * archivo donde alguien elige un token por su luminosidad.
 */
function archivosPropios(): string[] {
  const de = (raiz: string) =>
    readdirSync(raiz, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.module.css'))
      .map((f) => join(raiz, f))
  // components/ui/ queda afuera porque es el ÚNICO lugar donde el par
  // bg-primary + text-primary-foreground es legítimo: es el botón de acción.
  return [...de('app'), ...de('components').filter((f) => !f.startsWith(join('components', 'ui')))]
}

/**
 * Los consumidores de `--primary-foreground` que hay fuera de components/ui/,
 * por ruta completa desde la raíz del repo (`app/sitio/secciones.tsx`).
 *
 * Hoy está vacía, y ése es el estado sano. Si alguna vez una pantalla necesita
 * de verdad el par `bg-primary` + `text-primary-foreground` —que es legítimo, es
 * el botón de acción—, se anota acá con su razón en vez de aflojar el caso.
 * Mismo patrón que EXCEPCIONES en scripts/contraste.mts, RUTAS_SIN_SMOKE en
 * scripts/lib/rutas-comun.sh y SIN_TENANT_ID en test/rls-cobertura.test.ts.
 */
const CONSUMIDORES_LEGITIMOS: Record<string, string> = {}

describe('nadie toma --primary-foreground por "el color claro"', () => {
  // El bug que este caso existe para que no vuelva: al pasar a la paleta
  // oscura, --primary-foreground se dio vuelta de casi blanco a casi negro, y
  // dos utilidades de Tailwind en app/sitio/secciones.tsx lo usaban sobre el
  // paño de --marca porque era "el color claro". Quedaron en 1.39:1 sobre el
  // título que convierte, y ningún test lo vio: los dos colores seguían siendo
  // colores válidos, y la tabla de contraste sólo mide los pares que alguien se
  // acordó de declarar. Lo encontró un grep a mano.
  //
  // El token es legítimo SÓLO sobre --primary, que es el botón de acción, y ese
  // par vive en components/ui/. Fuera de ahí, nombrarlo es la señal de que
  // alguien lo eligió por su luminosidad y no por su rol — y la luminosidad es
  // exactamente lo que cambia cuando la paleta cambia.
  it('no aparece en ninguna pantalla ni componente fuera de components/ui/', () => {
    const archivos = archivosPropios()
      .filter((f) => readFileSync(f, 'utf8').includes('primary-foreground'))
      .filter((f) => !(f in CONSUMIDORES_LEGITIMOS))

    expect(
      archivos,
      `estos archivos nombran --primary-foreground: ${archivos.join(', ')}. ` +
        `El token es casi negro y sólo sirve sobre --primary (el botón de acción, ` +
        `en components/ui/). Si lo estás usando como "el color claro", el que ` +
        `querés es --foreground. Si de verdad es un botón de acción, anotalo en ` +
        `CONSUMIDORES_LEGITIMOS con su razón.`,
    ).toEqual([])
  })
})
