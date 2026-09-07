import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ANCHO_MINIMO_DOS_COLUMNAS,
  NOMBRE_DEL_CONTENEDOR,
  hayLugarParaDosColumnas,
} from '@/hooks/use-dos-columnas'

const GLOBALS = readFileSync('app/globals.css', 'utf8')

describe('el umbral de las dos columnas', () => {
  // 48 del p-6 + 392 (el mínimo del carrito que declara hooks/use-mobile.ts)
  // + 18 del gap + 384 del panel = 842, redondeado a 850. Ver el spec, §4.
  it('vale 850 y la cuenta de la que sale está escrita', () => {
    expect(ANCHO_MINIMO_DOS_COLUMNAS).toBe(850)
  })

  it('el ancho justo alcanza, y uno menos no', () => {
    expect(hayLugarParaDosColumnas(850)).toBe(true)
    expect(hayLugarParaDosColumnas(849)).toBe(false)
    expect(hayLugarParaDosColumnas(960)).toBe(true)
    expect(hayLugarParaDosColumnas(0)).toBe(false)
  })

  // EN LAS DOS DIRECCIONES, y es el punto del caso: el número vive en dos
  // lenguajes —TypeScript lo usa para medir, el CSS para consultar— y ninguno
  // lee al otro en runtime. No porque no se pueda: Tailwind emite
  // `--container-cobro` como custom property real en `@layer theme`, pero sólo
  // mientras alguna utilidad la use, así que leerla con `getComputedStyle`
  // costaría una lectura por montaje y dependería de que la última clase
  // `@cobro/venta:` no se borre nunca. Con las dos escritas a mano, mover una
  // y olvidarse de la otra deja la pantalla con el JavaScript decidiendo en un
  // ancho y el CSS en otro, sin que nada falle — este caso es lo que lo
  // impide.
  it('el CSS declara exactamente el mismo número', () => {
    const declarada = GLOBALS.match(/--container-cobro:\s*(\d+)px\s*;/)
    expect(declarada, 'falta --container-cobro en app/globals.css').toBeTruthy()
    expect(Number(declarada![1])).toBe(ANCHO_MINIMO_DOS_COLUMNAS)
  })

  it('la variable vive adentro del bloque @theme, o Tailwind no genera la variante', () => {
    const tema = GLOBALS.slice(GLOBALS.indexOf('@theme inline'))
    expect(tema.slice(0, tema.indexOf('\n}'))).toContain('--container-cobro')
  })

  // El nombre es contrato del módulo, no un detalle: las variantes le apuntan
  // por nombre (`@cobro/venta:`) justamente para no resolver contra el
  // contenedor más cercano, que hoy podría ser el `@container/card-header` de
  // components/ui/card.tsx.
  it('el contenedor se llama venta', () => {
    expect(NOMBRE_DEL_CONTENEDOR).toBe('venta')
  })
})

const HOOK = readFileSync('hooks/use-dos-columnas.ts', 'utf8')

describe('el hook que mide el contenedor', () => {
  it('mide con ResizeObserver y no con el viewport', () => {
    expect(HOOK).toContain('ResizeObserver')
    expect(
      HOOK,
      'medir el viewport es exactamente lo que este hook existe para no hacer',
    ).not.toMatch(/matchMedia|innerWidth/)
  })

  // Una sola definición del corte: el hook tiene que preguntarle a la función
  // pura, no repetir la comparación. Con la comparación escrita dos veces,
  // mover el `>=` a `>` en un lado deja el otro decidiendo distinto.
  it('el hook decide con hayLugarParaDosColumnas y no con su propia comparación', () => {
    const cuerpo = HOOK.slice(HOOK.indexOf('export function useDosColumnas'))
    expect(cuerpo).toContain('hayLugarParaDosColumnas')
    expect(cuerpo).not.toContain('ANCHO_MINIMO_DOS_COLUMNAS')
  })

  // El servidor no tiene ancho que medir. Arranca en "hay lugar" —o sea el
  // layout ancho— que es EXACTAMENTE lo que hoy devuelve el
  // `getServerSnapshot()` de useIsMobile (`false`, "no es mobile"). Es paridad
  // con el comportamiento actual, no una decisión nueva.
  it('sin medición todavía asume que hay lugar, igual que useIsMobile hoy', () => {
    expect(HOOK).toMatch(/useState\(true\)/)
  })
})
