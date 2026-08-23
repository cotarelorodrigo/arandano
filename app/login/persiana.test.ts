import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * `persiana.module.css` es un módulo CSS: bajo vitest resuelve a un proxy
 * identidad (mismo motivo que `retrato.test.tsx` verifica `estilos.importe`
 * leyendo el FUENTE en vez del valor en runtime), así que la única forma de
 * atar una propiedad de una regla a la maqueta es leer el archivo como texto.
 *
 * I4 de la review final del cierre: `.arandano` (el "Arándano" chico sobre el
 * nombre del local) tenía los cuatro valores no-color mal —12px/500, tracking
 * 0.18em, uppercase— porque se diseñó leyendo "la firma" del archivo viejo en
 * vez del nodo real. Consultado en vivo con el MCP de Pencil, `EqVux` es
 * 14px/600, caja mixta, sin tracking: la maqueta dice "Arándano", no
 * "A R Á N D A N O". El color (`--marca-soft`) ya estaba bien desde el ciclo
 * anterior y no se toca acá.
 */
describe('.arandano — 14px/600, sin tracking ni mayúsculas (I4 de la review final)', () => {
  const css = readFileSync('app/login/persiana.module.css', 'utf8')
  const bloque = css.match(/\n\.arandano\s*\{([^}]*)\}/)?.[1]

  it('existe el bloque .arandano', () => {
    expect(bloque, 'no se encontró la regla .arandano en persiana.module.css').toBeTruthy()
  })

  it('paga 14px/600 (design/arandano.pen, nodo EqVux)', () => {
    expect(bloque).toContain('font-size: 0.875rem')
    expect(bloque).toContain('font-weight: 600')
  })

  it('no lleva tracking ni mayúsculas: el .pen no los pide', () => {
    expect(bloque).not.toMatch(/letter-spacing/)
    expect(bloque).not.toMatch(/text-transform/)
  })

  it('sigue pintando con --marca-soft (esto no cambió en este hallazgo)', () => {
    expect(bloque).toContain('color: var(--marca-soft)')
  })
})

/**
 * El ancho del paño en escritorio — Minor 2 de la review final: el `.pen`
 * (frame `App / Login`, consultado en vivo) fija el lado "Formulario"
 * (`cwd1V`) en 600px sobre un frame de 1440 y deja el `Paño` (`mLbTM`) como
 * `fill_container`, o sea 840/1440 = 58,33% — no el 50/50 que el código
 * tenía.
 */
describe('el paño mide 58.33% en escritorio (840/1440, Minor 2 de la review final)', () => {
  const css = readFileSync('app/login/persiana.module.css', 'utf8')

  it('el media query de escritorio fija 58.3333%, no 50%', () => {
    const bloque = css.match(/@media \(min-width: 768px\) \{\s*\.pano \{([^}]*)\}/)?.[1]
    expect(bloque, 'no se encontró el media query de .pano').toBeTruthy()
    expect(bloque).toContain('58.3333%')
  })
})

/**
 * El halo del paño — hallazgo (b) de la review final del cierre: la
 * aproximación anterior (`color-mix(in srgb, var(--marca-foreground) 30%,
 * var(--primary))`, un color-mix ANIDADO adentro del radial-gradient) daba
 * `#806AC0` contra el `#6B45D9` del `.pen`. Se declaró como token propio
 * (`--marca-halo`, app/globals.css) para que `test/maqueta.test.ts` pueda
 * atarlo —un color enterrado en un color-mix anidado es invisible para ese
 * mecanismo, que sólo mira el bloque de variables—, y para que este archivo
 * pueda confirmar que `.pano` de verdad lo usa.
 */
describe('el halo de .pano usa el token --marca-halo, no un color-mix anidado a mano', () => {
  const css = readFileSync('app/login/persiana.module.css', 'utf8')
  const bloque = css.match(/\n\.pano\s*\{([^}]*)\}/)?.[1]

  it('existe el bloque .pano', () => {
    expect(bloque, 'no se encontró la regla .pano en persiana.module.css').toBeTruthy()
  })

  it('el radial-gradient referencia var(--marca-halo)', () => {
    expect(bloque).toContain('var(--marca-halo)')
  })

  it('no quedó la mezcla anidada vieja (--marca-foreground 30%, --primary)', () => {
    expect(bloque).not.toMatch(/--marca-foreground\)\s*30%,\s*var\(--primary\)/)
  })
})

