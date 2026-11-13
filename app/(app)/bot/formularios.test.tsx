import { describe, it, expect } from 'vitest'
import { clasesDePastilla } from './formularios'

const clases = (...args: Parameters<typeof clasesDePastilla>) => clasesDePastilla(...args).split(' ')

/**
 * El segmentado del modo, en sus dos momentos: en reposo (`OiQLY`, nodo
 * `DE1zR`) y con la confirmación de «Todos» armada (variante `Gmg0q`, entradas
 * 26 y 38 de docs/correcciones-pendientes-del-pen.md).
 *
 * Se prueba la función de clases y no el componente: lo armado es estado de
 * cliente (`useState`), así que un render del servidor nunca lo vería.
 */
describe('las pastillas del modo del bot', () => {
  it('en reposo, la elegida va en card y semibold, y ninguna se pinta de ámbar', () => {
    for (const m of ['APAGADO', 'PRUEBA', 'TODOS'] as const) {
      const c = clases(m, false)
      expect(c).toContain('data-[state=on]:bg-card')
      expect(c).toContain('data-[state=on]:font-semibold')
      expect(c).toContain('data-[state=on]:text-foreground')
      expect(c).not.toContain('bg-warn-soft')
      expect(c).not.toContain('text-warn')
    }
  })

  it('con «Todos» armado, «Todos» se pinta con el par --warn/--warn-soft, en semibold', () => {
    const c = clases('TODOS', true)
    expect(c).toContain('bg-warn-soft')
    expect(c).toContain('text-warn')
    expect(c).toContain('font-semibold')
    expect(c).not.toContain('text-muted-foreground')
    // Sin esto el hover del Toggle (`hover:bg-muted hover:text-foreground`)
    // le saca el ámbar justo a la pastilla que se está por tocar.
    expect(c).toContain('hover:bg-warn-soft')
    expect(c).toContain('hover:text-warn')
  })

  it('con «Todos» armado, la del modo actual conserva el fondo pero apaga el texto', () => {
    const c = clases('PRUEBA', true)
    expect(c).toContain('data-[state=on]:bg-card')
    expect(c).not.toContain('data-[state=on]:font-semibold')
    expect(c).not.toContain('data-[state=on]:text-foreground')
    expect(c).toContain('text-muted-foreground')
    expect(c).toContain('font-medium')
    expect(c).not.toContain('bg-warn-soft')
  })
})
