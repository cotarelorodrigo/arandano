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

export type Par = { texto: string; fondo: string; minimo: number }

/**
 * Los pares que importan, con el mínimo que les corresponde.
 *
 * 4.5 es el mínimo de WCAG 2.1 para texto normal (1.4.3). El 3.0 del borde de
 * un control sale de 1.4.11, que es otra regla: no habla de texto sino de qué
 * hace falta para identificar un componente.
 */
export const PARES: Par[] = [
  { texto: '--foreground', fondo: '--background', minimo: 4.5 },
  { texto: '--foreground', fondo: '--muted', minimo: 4.5 },
  { texto: '--muted-foreground', fondo: '--background', minimo: 4.5 },
  { texto: '--muted-foreground', fondo: '--muted', minimo: 4.5 },
  { texto: '--primary-foreground', fondo: '--primary', minimo: 4.5 },
  { texto: '--primary', fondo: '--background', minimo: 4.5 },
  { texto: '--primary', fondo: '--accent', minimo: 4.5 },
  { texto: '--primary-foreground', fondo: '--destructive', minimo: 4.5 },
  { texto: '--destructive', fondo: '--background', minimo: 4.5 },
  { texto: '--input', fondo: '--background', minimo: 3.0 },
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
    'el borde de un control pide 3:1 (WCAG 1.4.11) y da 1.26. Se conserva el look ' +
    'liviano de shadcn a conciencia: todo campo lleva <Label> asociado y anillo de ' +
    'foco de marca, así que el borde no es el único indicio de que ahí hay un input. ' +
    'Revisar ante un reporte real de gente que no encuentra los campos, o ante una ' +
    'auditoría de accesibilidad formal.',
}

export const nombreDelPar = (p: Par) => `${p.texto} sobre ${p.fondo}`

/** Los tokens del bloque :root, tal como están en el CSS. */
export function tokensDelCss(): Map<string, string> {
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

/** oklch(L C H) → sRGB lineal. */
function aRgbLineal(valor: string): [number, number, number] {
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
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ]
}

/** Luminancia relativa (WCAG 2.1), sobre los componentes lineales clampeados. */
function luminancia(valor: string): number {
  const [r, g, b] = aRgbLineal(valor).map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
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
    const a = luminancia(tokens.get(p.texto)!)
    const b = luminancia(tokens.get(p.fondo)!)
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    return {
      nombre: nombreDelPar(p),
      ratio,
      minimo: p.minimo,
      // Redondeado a dos decimales antes de comparar: es lo que se publica en
      // el documento, y un par que da 4.4996 no puede figurar como 4.50 "ok".
      llega: Number(ratio.toFixed(2)) >= p.minimo,
    }
  })
}

// Sólo cuando se corre como comando, no cuando lo importa el test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
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
