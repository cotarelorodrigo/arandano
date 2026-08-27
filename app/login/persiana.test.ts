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
 * vez del nodo real. Consultado en vivo con el MCP de Pencil, `EqVux` (el
 * nodo de ESCRITORIO) es 14px/600, caja mixta, sin tracking: la maqueta dice
 * "Arándano", no "A R Á N D A N O". El color (`--marca-soft`) ya estaba bien
 * desde el ciclo anterior y no se toca acá.
 *
 * Task 11 del ciclo móvil: 14px pasó a ser el valor de ESCRITORIO nada más
 * (media query `min-width: 1024px`) — el teléfono (nodo `AUcuM`) pide 13px, y
 * ese caso vive en persiana.test.ts, describe "tipografía mobile-first...".
 */
describe('.arandano — 14px/600 en escritorio, sin tracking ni mayúsculas (I4 de la review final)', () => {
  const css = readFileSync('app/login/persiana.module.css', 'utf8')
  const bloque = css.match(/\n\.arandano\s*\{([^}]*)\}/)?.[1]

  it('existe el bloque .arandano', () => {
    expect(bloque, 'no se encontró la regla .arandano en persiana.module.css').toBeTruthy()
  })

  it('paga 14px/600 en escritorio (design/arandano.pen, nodo EqVux)', () => {
    const desktop = css.match(/@media \(min-width: 1024px\) \{\s*\.arandano \{([^}]*)\}/)?.[1]
    expect(desktop, 'no se encontró el override de escritorio de .arandano').toBeTruthy()
    expect(desktop).toContain('font-size: 0.875rem')
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
 *
 * El corte de la Task 11 del ciclo móvil migró este media query de 768px a
 * 1024px (design/arandano.pen, frame `Móvil / Login`, `Kp4Eg`): abajo de
 * 1024 el paño es una franja de 300px de alto, arriba vuelve a ser esta
 * columna del 58.33%.
 */
describe('el paño mide 58.33% en escritorio (840/1440, Minor 2 de la review final)', () => {
  const css = readFileSync('app/login/persiana.module.css', 'utf8')

  it('el media query de escritorio es 1024px, no 768px (corte del ciclo móvil)', () => {
    expect(css).not.toMatch(/@media \(min-width: 768px\)/)
    expect(css).toContain('@media (min-width: 1024px)')
  })

  it('el media query de escritorio fija 58.3333%, no 50%', () => {
    const bloque = css.match(/@media \(min-width: 1024px\) \{\s*\.pano \{([^}]*)\}/)?.[1]
    expect(bloque, 'no se encontró el media query de .pano').toBeTruthy()
    expect(bloque).toContain('58.3333%')
  })
})

/**
 * Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Login`,
 * `Kp4Eg`): la tipografía del paño y del H1 "Entrar" miden distinto en el
 * teléfono, mobile-first — el valor sin media query es el del teléfono, el
 * de escritorio (idéntico al que ya había) queda detrás de
 * `@media (min-width: 1024px)`.
 */
describe('tipografía mobile-first del paño y del formulario (Task 11, ciclo móvil)', () => {
  const css = readFileSync('app/login/persiana.module.css', 'utf8')

  it('.arandano: 13px en el teléfono (nodo AUcuM), 14px en escritorio (nodo EqVux)', () => {
    const base = css.match(/\n\.arandano\s*\{([^}]*)\}/)?.[1]
    expect(base).toContain('font-size: 0.8125rem')
    const desktop = css.match(/@media \(min-width: 1024px\) \{\s*\.arandano \{([^}]*)\}/)?.[1]
    expect(desktop, 'no se encontró el override de escritorio de .arandano').toBeTruthy()
    expect(desktop).toContain('font-size: 0.875rem')
  })

  it('.logo: 22px en el teléfono (nodo rkk0s), 26px en escritorio (nodo K0PRd)', () => {
    const base = css.match(/\n\.logo\s*\{([^}]*)\}/)?.[1]
    expect(base).toContain('width: 22px')
    expect(base).toContain('height: 22px')
    const desktop = css.match(/@media \(min-width: 1024px\) \{\s*\.logo \{([^}]*)\}/)?.[1]
    expect(desktop, 'no se encontró el override de escritorio de .logo').toBeTruthy()
    expect(desktop).toContain('width: 26px')
    expect(desktop).toContain('height: 26px')
  })

  it('.bajada: 13px/1.45 en el teléfono (nodo a0SPO), 16px/1.55 en escritorio (nodo H3uyf9)', () => {
    const base = css.match(/\n\.bajada\s*\{([^}]*)\}/)?.[1]
    expect(base).toContain('font-size: 0.8125rem')
    expect(base).toContain('line-height: 1.45')
    const desktop = css.match(/@media \(min-width: 1024px\) \{\s*\.bajada \{([^}]*)\}/)?.[1]
    expect(desktop, 'no se encontró el override de escritorio de .bajada').toBeTruthy()
    expect(desktop).toContain('font-size: 1rem')
    expect(desktop).toContain('line-height: 1.55')
  })

  it('.nombre: 32px/1.15 sin tracking en el teléfono (nodo P2DdCo), clamp/1.02/-0.022em en escritorio (nodo A0YWO)', () => {
    const base = css.match(/\n\.nombre\s*\{([^}]*)\}/)?.[1]
    expect(base).toContain('font-size: 2rem')
    expect(base).toContain('line-height: 1.15')
    expect(base).not.toMatch(/letter-spacing/)
    const desktop = css.match(/@media \(min-width: 1024px\) \{\s*\.nombre \{([^}]*)\}/)?.[1]
    expect(desktop, 'no se encontró el override de escritorio de .nombre').toBeTruthy()
    expect(desktop).toContain('clamp(2.5rem, 7vw, 5.5rem)')
    expect(desktop).toContain('line-height: 1.02')
    expect(desktop).toContain('letter-spacing: -0.022em')
  })

  it('.tituloEntrar: 26px en el teléfono (nodo t4laN), 28px en escritorio (nodo M6mNY)', () => {
    const base = css.match(/\n\.tituloEntrar\s*\{([^}]*)\}/)?.[1]
    expect(base).toContain('font-size: 1.625rem')
    const desktop = css.match(/@media \(min-width: 1024px\) \{\s*\.tituloEntrar \{([^}]*)\}/)?.[1]
    expect(desktop, 'no se encontró el override de escritorio de .tituloEntrar').toBeTruthy()
    expect(desktop).toContain('font-size: 1.75rem')
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

