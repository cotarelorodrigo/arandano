import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { ListaDeImeis } from './lista-de-imeis'

/**
 * `ListaDeImeis` (Task 7) no tenía ninguna cobertura de su comportamiento
 * interactivo: ni el Enter que agrega fila, ni el avance de foco, ni quitar
 * una fila. Esta task la instancia en DOS lugares más (`MoverStock` y el
 * diálogo de `SwitchDeSerie`), lo que la convierte en el control compartido
 * de tres pantallas sin ninguna red — justo el modo de falla que ya costó una
 * divergencia de cuatro días con el gate en verde (ver CLAUDE.md, ciclo de la
 * categoría en la ficha).
 *
 * El render estático SÍ puede cubrir la estructura (cuántas filas, qué
 * `name`/`aria-label` llevan, cuándo aparece "Agregar otro" o el botón de
 * quitar). Lo que NO puede —`onKeyDown`, `onChange`, el foco real— se cablea
 * leyendo el FUENTE, mismo patrón que ya usa `formularios.test.tsx` para
 * "ocultar el stock inicial al elegir Servicio": vitest corre en entorno
 * "node", sin DOM, y este repo no suma jsdom sólo para esto.
 */
describe('ListaDeImeis: estructura (render estático)', () => {
  it('sin filasFijas arranca con una sola fila, vacía', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect([...html.matchAll(/name="imeis"/g)]).toHaveLength(1)
  })

  it('con filasFijas arranca con exactamente esa cantidad de filas', () => {
    const html = renderToStaticMarkup(<ListaDeImeis filasFijas={4} />)
    expect([...html.matchAll(/name="imeis"/g)]).toHaveLength(4)
  })

  it('con filasFijas no hay botón "Agregar otro": la cantidad la fija el stock', () => {
    const html = renderToStaticMarkup(<ListaDeImeis filasFijas={2} />)
    expect(html).not.toContain('Agregar otro')
  })

  it('sin filasFijas SÍ hay botón "Agregar otro"', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect(html).toContain('Agregar otro')
  })

  it('con una sola fila y sin filasFijas, no hay botón para quitarla', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect(html).not.toMatch(/aria-label="Quitar/)
  })

  it('con filasFijas nunca hay botón para quitar una fila: la cantidad es fija', () => {
    const html = renderToStaticMarkup(<ListaDeImeis filasFijas={3} />)
    expect(html).not.toMatch(/aria-label="Quitar/)
  })

  it('la etiqueta custom se usa en el aria-label de cada fila', () => {
    const html = renderToStaticMarkup(<ListaDeImeis filasFijas={2} etiqueta="Número de serie" />)
    expect(html).toContain('aria-label="Número de serie 1"')
    expect(html).toContain('aria-label="Número de serie 2"')
  })
})

describe('ListaDeImeis: comportamiento (cableado, no ejercitable sin DOM)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/lista-de-imeis.tsx', 'utf8')

  it('Enter previene el submit del form antes que cualquier otra cosa', () => {
    expect(FUENTE).toMatch(/if \(e\.key !== 'Enter'\) return\s*\n\s*e\.preventDefault\(\)/)
  })

  it('con filasFijas, Enter no agrega ninguna fila', () => {
    expect(FUENTE).toMatch(/e\.preventDefault\(\)\s*\n\s*if \(filasFijas !== undefined\) return/)
  })

  it('Enter en la última fila agrega una fila nueva', () => {
    expect(FUENTE).toMatch(
      /if \(i === valores\.length - 1\) setValores\(\(v\) => \[\.\.\.v, ''\]\)/,
    )
  })

  it('después de Enter, el foco avanza a la última fila', () => {
    expect(FUENTE).toContain('queueMicrotask(() => ultimo.current?.focus())')
  })

  it('quitar una fila filtra por índice, no por valor', () => {
    expect(FUENTE).toMatch(/setValores\(\(prev\) => prev\.filter\(\(_, j\) => j !== i\)\)/)
  })

  it('"Agregar otro" agrega una fila igual que Enter', () => {
    expect(FUENTE).toMatch(/onClick=\{\(\) => setValores\(\(v\) => \[\.\.\.v, ''\]\)\}/)
  })
})
