import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChipEstadoUsuario } from './chip-estado'

/** El brief de la Task 1 pide explícito "que el chip de estado distingue
 *  activo de desactivado" — se recorren los dos casos y se afirma sobre el
 *  HTML, no sobre la existencia del componente. */
describe('ChipEstadoUsuario', () => {
  it('activo muestra "Activo" en --ok sobre --ok-soft', () => {
    const html = renderToStaticMarkup(<ChipEstadoUsuario desactivado={false} />)
    expect(html).toContain('Activo')
    expect(html).not.toContain('Desactivado')
    expect(html).toMatch(/bg-ok-soft\b/)
    expect(html).toMatch(/text-ok\b/)
  })

  it('desactivado muestra "Desactivado" en --foreground-soft sobre --muted', () => {
    const html = renderToStaticMarkup(<ChipEstadoUsuario desactivado={true} />)
    expect(html).toContain('Desactivado')
    expect(html).toMatch(/bg-muted\b/)
    expect(html).toMatch(/text-foreground-soft\b/)
  })

  it('los dos estados rinden HTML distinto entre sí', () => {
    const activo = renderToStaticMarkup(<ChipEstadoUsuario desactivado={false} />)
    const desactivado = renderToStaticMarkup(<ChipEstadoUsuario desactivado={true} />)
    expect(activo).not.toBe(desactivado)
  })
})
