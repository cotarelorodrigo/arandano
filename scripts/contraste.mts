/**
 * Los ratios de contraste WCAG 2.1 de la paleta, calculados desde los tokens
 * REALES de app/globals.css.
 *
 * Existe porque la tabla del documento se escribió a mano una vez y se
 * desincronizó: cuatro de diez ratios no correspondían a los tokens que estaban
 * en el CSS, en una sección cuya propia prosa dice "medido, no estimado a ojo".
 * Corregir los números no arreglaba la causa. test/contraste.test.ts compara
 * esta salida contra la tabla, así que ahora "medido" es una afirmación que el
 * gate sostiene.
 *
 * Correr a mano: `npm run contraste`.
 */
import { readFileSync } from 'node:fs'

const CSS = 'app/globals.css'

export type Par = {
  texto: string
  fondo: string
  /** Opacidad del texto, como la escribe Tailwind (`text-destructive/90` → 0.9). */
  alfaTexto?: number
  /** Opacidad del fondo (`hover:bg-primary/80` → 0.8). */
  alfaFondo?: number
  minimo: number
}

/**
 * Los pares que importan, con el mínimo que les corresponde.
 *
 * 4.5 es el mínimo de WCAG 2.1 para texto normal (1.4.3). El 3.0 del borde de
 * un control sale de 1.4.11, que es otra regla: no habla de texto sino de qué
 * hace falta para identificar un componente.
 *
 * **Los pares con opacidad son los que el usuario mira de verdad.** Un fondo
 * `bg-destructive/10` no es `--destructive`: es otro color, y puede caerse del
 * mínimo sin que ningún par opaco se entere. Un fondo translúcido se compone
 * sobre `--background`; con la paleta oscura `--card` y `--popover` ya NO son
 * ese mismo color — son un violeta apenas más claro (`oklch(0.245 0.028 287)`
 * contra `oklch(0.214 0.025 287)` de `--background`) — así que ese simplismo
 * ya importa: ningún par de PARES compone hoy un `alfaFondo` contra `--card`,
 * pero el que lo haga necesita una base explícita en vez de asumir
 * `--background`.
 */
export const PARES: Par[] = [
  { texto: '--foreground', fondo: '--background', minimo: 4.5 },
  { texto: '--foreground', fondo: '--muted', minimo: 4.5 },
  { texto: '--muted-foreground', fondo: '--background', minimo: 4.5 },
  { texto: '--muted-foreground', fondo: '--muted', minimo: 4.5 },
  // La fila seleccionada y el hover de las pantallas que vienen: --accent es
  // más oscuro que --muted, así que este par es más filoso que el de arriba.
  { texto: '--muted-foreground', fondo: '--accent', minimo: 4.5 },
  { texto: '--primary-foreground', fondo: '--primary', minimo: 4.5 },
  // El hover del botón de acción — el "Entrar" del login (components/ui/button.tsx).
  // Es un token y no una opacidad desde el ciclo de la paleta oscura: sobre
  // fondo oscuro `bg-primary/80` acercaba el botón al fondo, o sea que el
  // control retrocedía al apuntarlo, y el par daba 4.08.
  { texto: '--primary-foreground', fondo: '--primary-hover', minimo: 4.5 },
  // El paño de la persiana del login. El nombre del local va opaco; el
  // subdominio arriba va al 70%, y esa opacidad es justamente la que ningún
  // par opaco vigila — es texto chico sobre un fondo oscuro, o sea el caso
  // donde una opacidad "que se ve bien" se cae del mínimo sin avisar.
  { texto: '--foreground', fondo: '--marca', minimo: 4.5 },
  { texto: '--foreground', fondo: '--marca', alfaTexto: 0.7, minimo: 4.5 },
  { texto: '--primary', fondo: '--background', minimo: 4.5 },
  { texto: '--primary', fondo: '--accent', minimo: 4.5 },
  // El rótulo de los tiles de /ventas, que van sobre --card y no sobre el
  // fondo. Es texto chico (10 px), así que el par vale más que de costumbre.
  { texto: '--primary', fondo: '--card', minimo: 4.5 },
  { texto: '--primary-foreground', fondo: '--destructive', minimo: 4.5 },
  { texto: '--destructive', fondo: '--background', minimo: 4.5 },
  // La descripción del error de login, que vive en una Alert con bg-card
  // (components/ui/alert.tsx).
  { texto: '--destructive', fondo: '--card', alfaTexto: 0.9, minimo: 4.5 },
  // El botón "Desactivar artículo" (app/(app)/inventario/formularios.tsx), que
  // es `bg-destructive/10 text-destructive` en components/ui/button.tsx. Existía
  // desde el ciclo de inventario y ningún par lo cubría: con la paleta clara
  // zafaba, y con una nueva merece medirse en vez de suponerse.
  { texto: '--destructive', fondo: '--destructive', alfaFondo: 0.1, minimo: 4.5 },
  { texto: '--input', fondo: '--background', minimo: 3.0 },
  // El anillo de foco de las pestañas de navegación (components/navegacion.tsx),
  // opaco desde la revisión final de "el cartel en el shell". Mismo mínimo que
  // el borde de --input y por la misma regla (WCAG 1.4.11): no es texto, es lo
  // que identifica un control.
  { texto: '--ring', fondo: '--background', minimo: 3.0 },
]

/**
 * Los pares que NO llegan a su mínimo y se aceptan igual, cada uno con su razón.
 *
 * Escrita a mano a propósito: una excepción de accesibilidad tiene que ser una
 * decisión visible en el diff, no algo que el script deduzca solo. Mismo patrón
 * que RUTAS_SIN_SMOKE en scripts/lib/rutas-comun.sh y SIN_TENANT_ID en
 * test/rls-cobertura.test.ts.
 */
export const EXCEPCIONES: Record<string, string> = {
  '--input sobre --background':
    'el borde de un control pide 3:1 (WCAG 1.4.11) y da 1.77 — mejor que el 1.26 ' +
    'de la paleta clara, pero todavía corto. Se conserva el borde tenue que usa la ' +
    'maqueta a conciencia: todo campo lleva <Label> asociado y anillo de foco de ' +
    'marca, así que el borde no es el único indicio de que ahí hay un input. ' +
    'Revisar ante un reporte real de gente que no encuentra los campos, o ante una ' +
    'auditoría de accesibilidad formal.',
}

const conAlfa = (token: string, alfa?: number) =>
  alfa === undefined ? token : `${token}/${Math.round(alfa * 100)}`

export const nombreDelPar = (p: Par) =>
  `${conAlfa(p.texto, p.alfaTexto)} sobre ${conAlfa(p.fondo, p.alfaFondo)}`

/**
 * Los tokens del bloque `:root`, tal como están en el CSS.
 *
 * **Exige que haya exactamente un `:root` y que no viva adentro de un `@media`.**
 * No es prolijidad: la versión anterior agarraba el primero con un regex y
 * dejaba ciego a todo el mecanismo. Un segundo bloque al final del archivo
 * —`:root { --primary: … }`, o un `@media (prefers-color-scheme: dark) { :root
 * { … } }`— gana en la cascada, o sea que es el color que el usuario ve, y sin
 * embargo estos parsers no lo miraban: los tests quedaban en verde con la app
 * sirviendo otra paleta. El modo oscuro que este ciclo declara cerrado volvía
 * por esa misma puerta.
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
        `si fueran los de siempre. El modo oscuro se borró a propósito; si vuelve, ` +
        `es su propio ciclo.`,
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
type Rgb = [number, number, number]

/** sRGB lineal → el byte que se pinta (transferencia sRGB + redondeo). */
function aByte(lineal: number): number {
  const v = Math.min(1, Math.max(0, lineal))
  const codificado = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  return Math.round(codificado * 255)
}

/** Byte 0–255 → sRGB lineal. */
function aLineal(byte: number): number {
  const v = byte / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/**
 * Exportada desde el ciclo de la paleta oscura: test/opengraph.test.ts la usa
 * para comparar los hexes que Satori necesita contra los tokens reales.
 *
 * oklch(L C H) → los tres bytes de sRGB.
 *
 * El redondeo a 8 bits no es un detalle de implementación: es lo que hace que
 * este número sea el mismo que reportan axe y Lighthouse. Midiendo en continuo,
 * `--muted-foreground` sobre `--muted` daba 4.51 y pasaba; sobre los bytes que
 * de verdad se pintan daba 4.48 y no llegaba al mínimo. Un cálculo que difiere
 * del auditor no sirve para lo único que este script existe para hacer.
 */
export function aRgb(valor: string): Rgb {
  const m = valor.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!m) throw new Error(`no es un color oklch de tres componentes: ${valor}`)
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
 * Compone un color con opacidad sobre el que tiene abajo.
 *
 * Sobre los bytes y no sobre los componentes lineales, porque es lo que hace el
 * navegador: el compositing de CSS ocurre en el espacio del dispositivo, y es
 * también lo que hace axe para medir contraste. La prueba más barata de que es
 * así: `rgba(0,0,0,.5)` sobre blanco se ve `#808080`. Mezclando en lineal daría
 * `#bcbcbc`, que no es lo que nadie vio nunca en una pantalla. Con la mezcla
 * lineal, el hover del botón de acción da 3.49 en vez de 5.76 — o sea que el
 * modelo equivocado no es un decimal de diferencia, es otra respuesta.
 */
function componer(frente: Rgb, alfa: number, fondo: Rgb): Rgb {
  return frente.map((c, i) => Math.round(alfa * c + (1 - alfa) * fondo[i])) as Rgb
}

/** Luminancia relativa (WCAG 2.1) de un color ya pintado. */
function luminancia([r, g, b]: Rgb): number {
  return 0.2126 * aLineal(r) + 0.7152 * aLineal(g) + 0.0722 * aLineal(b)
}

export type Resultado = {
  nombre: string
  ratio: number
  minimo: number
  llega: boolean
}

export function ratios(): Resultado[] {
  const tokens = tokensDelCss()
  return PARES.map((p) => {
    for (const t of [p.texto, p.fondo]) {
      if (!tokens.has(t)) throw new Error(`${CSS} no define ${t}, que PARES nombra`)
    }
    // El orden importa: primero se pinta el fondo sobre el lienzo, y recién
    // sobre ESE color se compone el texto. Un texto translúcido no se mezcla
    // con --background sino con lo que tenga abajo.
    const lienzo = aRgb(tokens.get('--background')!)
    const fondo =
      p.alfaFondo === undefined
        ? aRgb(tokens.get(p.fondo)!)
        : componer(aRgb(tokens.get(p.fondo)!), p.alfaFondo, lienzo)
    const texto =
      p.alfaTexto === undefined
        ? aRgb(tokens.get(p.texto)!)
        : componer(aRgb(tokens.get(p.texto)!), p.alfaTexto, fondo)
    const a = luminancia(texto)
    const b = luminancia(fondo)
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    return {
      nombre: nombreDelPar(p),
      ratio,
      minimo: p.minimo,
      // Sin redondear antes de comparar, y esto costó un hallazgo: con
      // `Number(ratio.toFixed(2)) >= minimo`, un par que da 4.4996 se publicaba
      // como 4.50 y pasaba, mientras el comentario de acá afirmaba lo contrario.
      // El documento sigue publicando el valor redondeado —es lo legible—, pero
      // el veredicto se decide sobre el número entero, que es el lado que falla
      // cerrado.
      llega: ratio >= p.minimo,
    }
  })
}

// Sólo cuando se corre como comando, no cuando lo importa el test. La
// comparación es contra la ruta completa —la misma forma que crear-tenant.mts y
// definir-clave.mts— y no contra el basename: comparar el último segmento da
// verdadero para cualquier otro `contraste.mts` del árbol, y un falso positivo
// acá significa un process.exit() como efecto de un import.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  let fallan = 0
  for (const r of ratios()) {
    const exceptuado = !r.llega && EXCEPCIONES[r.nombre]
    if (!r.llega && !exceptuado) fallan++
    const estado = r.llega ? 'ok' : exceptuado ? 'excepción declarada' : 'NO LLEGA'
    console.log(
      `${r.nombre.padEnd(46)} ${r.ratio.toFixed(2).padStart(6)}  (mín ${r.minimo})  ${estado}`,
    )
  }
  process.exit(fallan === 0 ? 0 : 1)
}
