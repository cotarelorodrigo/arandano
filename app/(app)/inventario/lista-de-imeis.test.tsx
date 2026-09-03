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
 *
 * **Task 5 del ciclo "unidades sin identificar" le sacó `filasFijas`.** El
 * modo de N campos de una —pensado para el diálogo de prender el switch— es
 * justo lo que este ciclo vino a borrar: la carga progresiva reemplaza a la
 * exigencia de escanear todo de una sentada. Con él se fue `avanzarFoco`, el
 * ref `contenedor` y el indexado por `querySelectorAll('input')[i + 1]`, que
 * sólo funcionaba porque una fila tenía exactamente un input.
 */
describe('ListaDeImeis: estructura (render estático)', () => {
  it('arranca con una sola fila, vacía', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect([...html.matchAll(/name="imeis"/g)]).toHaveLength(1)
  })

  it('hay botón "Agregar otro"', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect(html).toContain('Agregar otro')
  })

  it('con una sola fila, no hay botón para quitarla', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect(html).not.toMatch(/aria-label="Quitar/)
  })

  it('la etiqueta custom se usa en el aria-label de la fila', () => {
    const html = renderToStaticMarkup(<ListaDeImeis etiqueta="Número de serie" />)
    expect(html).toContain('aria-label="Número de serie 1"')
  })

  // La nota vive en el componente y no en cada pantalla que lo instancia
  // (design/arandano.pen, frame `B4O7t`, nodo `afXki`). Hasta el 2026-09-03
  // estaba escrita dos veces en formularios.tsx —el alta y el ingreso de
  // mercadería—, que es la forma exacta en que el alta y la ficha se
  // desincronizaron con la categoría en el ciclo del 2026-08-28.
  it('la nota de "cargá los que tengas a mano" viaja adentro del componente', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect(html).toContain('Cargá los que tengas a mano')
    expect(html).toContain('se completa desde la ficha cuando aparezca cada equipo')
  })

  it('la nota aparece UNA sola vez', () => {
    const html = renderToStaticMarkup(<ListaDeImeis />)
    expect(html.split('Cargá los que tengas a mano').length - 1).toBe(1)
  })
})

describe('ListaDeImeis: comportamiento (cableado, no ejercitable sin DOM)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/lista-de-imeis.tsx', 'utf8')

  it('Enter previene el submit del form antes que cualquier otra cosa', () => {
    expect(FUENTE).toMatch(/if \(e\.key !== 'Enter'\) return\s*\n\s*e\.preventDefault\(\)/)
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

  it('no queda ningún rastro del modo de filas fijas', () => {
    // Lo borró el ciclo de unidades sin identificar: ya no hay ningún lugar del
    // producto donde se pidan N campos de una. Con él se fue el avance de foco
    // por índice, que dependía de que la fila tuviera exactamente un input.
    expect(FUENTE).not.toContain('filasFijas')
    expect(FUENTE).not.toContain('querySelectorAll')
  })
})
