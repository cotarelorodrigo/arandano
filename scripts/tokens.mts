/**
 * Los tokens de `app/globals.css`, leídos del archivo real.
 *
 * Es lo que queda de `scripts/contraste.mts`, que se borró junto con la paleta
 * oscura: aquel script medía los ratios de una tabla de pares declarada a mano,
 * y esa tabla resultó ser la parte del mecanismo que más costaba mantener y
 * menos atrapaba — sólo medía los pares que alguien se acordó de escribir, así
 * que el bug real de ese ciclo (dos utilidades usando `--primary-foreground`
 * como "el color claro") lo encontró un grep, no el script.
 *
 * Lo que sí era load-bearing y por eso sobrevive: el parser del `:root`, que
 * exige un único bloque de primer nivel, y la conversión a los bytes que de
 * verdad se pintan, que usa `test/opengraph.test.ts` para comparar la tarjeta
 * social contra la paleta. Las dos tenían una sola implementación a propósito
 * —dos copias se desincronizan— y la siguen teniendo.
 */
import { readFileSync } from 'node:fs'

const CSS = 'app/globals.css'

/**
 * Los tokens del bloque `:root`, tal como están en el CSS.
 *
 * **Exige que haya exactamente un `:root` y que no viva adentro de un `@media`.**
 * No es prolijidad: la versión anterior agarraba el primero con un regex y
 * dejaba ciego a todo el mecanismo. Un segundo bloque al final del archivo
 * —`:root { --primary: … }`, o un `@media (prefers-color-scheme: dark) { :root
 * { … } }`— gana en la cascada, o sea que es el color que el usuario ve, y sin
 * embargo el parser no lo miraba: los tests quedaban en verde con la aplicación
 * sirviendo otra paleta.
 */
export function tokensDelCss(): Map<string, string> {
  const texto = readFileSync(CSS, 'utf8')
  // Los comentarios se sacan primero: un `:root` mencionado adentro de uno no
  // define nada, y hacerlo contar sería un rojo que no corresponde.
  const sinComentarios = texto.replace(/\/\*[\s\S]*?\*\//g, '')
  const apariciones = [...sinComentarios.matchAll(/:root\b/g)]
  if (apariciones.length === 0) {
    throw new Error(`${CSS} no tiene un bloque :root que se pueda leer`)
  }
  if (apariciones.length !== 1) {
    throw new Error(
      `${CSS} tiene ${apariciones.length} bloques :root y tiene que tener exactamente 1. ` +
        `Con más de uno, el que gana en la cascada es el último, y este parser —y ` +
        `con él la comparación contra docs/sistema-de-diseno.md— mira sólo el primero: ` +
        `la aplicación serviría colores que ningún test comprueba.`,
    )
  }
  const desde = apariciones[0].index
  const anidado = [...sinComentarios.slice(0, desde)].reduce(
    (nivel, c) => nivel + (c === '{' ? 1 : c === '}' ? -1 : 0),
    0,
  )
  if (anidado !== 0) {
    throw new Error(
      `${CSS} tiene el bloque :root anidado adentro de otra regla (un @media, ` +
        `probablemente). Los tokens tienen que estar en un :root de primer nivel: ` +
        `adentro de un @media se aplican sólo a veces, y este parser los leería como ` +
        `si fueran los de siempre.`,
    )
  }
  const bloque = sinComentarios.slice(desde).match(/^:root\s*\{([\s\S]*?)^\}/m)
  if (!bloque) throw new Error(`${CSS} no tiene un bloque :root que se pueda leer`)
  const tokens = new Map<string, string>()
  for (const linea of bloque[1].split('\n')) {
    const m = linea.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/)
    if (m) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

/** Un color ya pintado: los tres bytes 0–255 que terminan en la pantalla. */
export type Rgb = [number, number, number]

/** sRGB lineal → el byte que se pinta (transferencia sRGB + redondeo). */
function aByte(lineal: number): number {
  const v = Math.min(1, Math.max(0, lineal))
  const codificado = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(codificado * 255)
}

/**
 * Un valor de color del CSS → los tres bytes de sRGB.
 *
 * Acepta hex de seis dígitos y `oklch(L C H)`. La paleta se escribe **en hex**
 * desde el rediseño, y no es una preferencia estética: los mismos valores están
 * en `design/arandano.pen`, que es donde se diseñan las pantallas, y ahí el
 * formato es hex. Dos representaciones del mismo color son dos lugares donde el
 * redondeo puede diferir; una sola no.
 *
 * El redondeo a 8 bits no es un detalle de implementación: es lo que hace que
 * el número sea el mismo que reportan axe y Lighthouse.
 */
export function aRgb(valor: string): Rgb {
  const hex = valor.trim().match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const n = hex[1]
    return [
      parseInt(n.slice(0, 2), 16),
      parseInt(n.slice(2, 4), 16),
      parseInt(n.slice(4, 6), 16),
    ]
  }
  const m = valor.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!m) throw new Error(`no es un hex de seis dígitos ni un oklch de tres componentes: ${valor}`)
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    aByte(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
    aByte(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
    aByte(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
  ]
}

/**
 * Un token de la paleta, como los seis dígitos hex que necesitan Satori y
 * cualquier estilo inline.
 *
 * Vive acá y no en un test porque tiene tres consumidores —la tarjeta social,
 * los íconos de la PWA y la pantalla sin conexión—, y una copia por consumidor
 * es exactamente el defecto que estos tests existen para impedir.
 */
export function hexDelToken(nombre: string): string {
  const valor = tokensDelCss().get(nombre)
  if (!valor) throw new Error(`app/globals.css no define ${nombre}`)
  return '#' + aRgb(valor).map((b) => b.toString(16).padStart(2, '0')).join('')
}
