// Puro: sin DOM ni base — renderToStaticMarkup alcanza porque ChipEstado no
// tiene estado ni efectos, sólo dos variantes según una prop.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChipEstado } from './chip-estado'

describe('ChipEstado', () => {
  it('una venta cobrada se ve como Cobrada', () => {
    const html = renderToStaticMarkup(<ChipEstado anulada={false} />)
    expect(html).toContain('Cobrada')
    expect(html).not.toContain('Anulada')
  })

  it('una venta anulada se ve como Anulada, con su ícono', () => {
    const html = renderToStaticMarkup(<ChipEstado anulada={true} />)
    expect(html).toContain('Anulada')
    expect(html).not.toContain('Cobrada')
    // El ícono undo-2 (design/arandano.pen, nodo `rOsTY`): lucide lo emite
    // como <svg class="lucide lucide-undo-2 ...">.
    expect(html).toContain('lucide-undo-2')
  })
})
