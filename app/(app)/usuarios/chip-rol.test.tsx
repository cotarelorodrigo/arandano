import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChipRol } from './chip-rol'

/**
 * Mismo criterio que app/(app)/servicio-tecnico/chip-estado.test.tsx: se
 * recorren los DOS casos y se afirma sobre el HTML renderizado, no sobre la
 * forma del código — un test que sólo mirara "el chip existe" dejaría pasar
 * un chip vacío o con el color equivocado.
 */
describe('ChipRol', () => {
  it('DUENO muestra "Dueño" con ícono', () => {
    const html = renderToStaticMarkup(<ChipRol rol="DUENO" />)
    expect(html).toContain('Dueño')
    expect(html).toContain('<svg')
  })

  it('EMPLEADO muestra "Empleado" sin ícono', () => {
    const html = renderToStaticMarkup(<ChipRol rol="EMPLEADO" />)
    expect(html).toContain('Empleado')
    expect(html).not.toContain('<svg')
  })

  it('DUENO pinta con --accent de fondo y --primary de texto', () => {
    const html = renderToStaticMarkup(<ChipRol rol="DUENO" />)
    expect(html).toMatch(/bg-accent\b/)
    expect(html).toMatch(/text-primary\b/)
  })

  it('EMPLEADO pinta con --muted de fondo y --foreground-soft de texto', () => {
    const html = renderToStaticMarkup(<ChipRol rol="EMPLEADO" />)
    expect(html).toMatch(/bg-muted\b/)
    expect(html).toMatch(/text-foreground-soft\b/)
  })

  // Un dueño y un empleado no pueden terminar indistinguibles en el HTML: si
  // alguien rompiera el ternario de rol y devolviera siempre la misma rama,
  // este caso lo atrapa aunque los dos anteriores (que miran contenido y
  // clases por separado) pasaran por casualidad.
  it('los dos roles rinden HTML distinto entre sí', () => {
    const dueno = renderToStaticMarkup(<ChipRol rol="DUENO" />)
    const empleado = renderToStaticMarkup(<ChipRol rol="EMPLEADO" />)
    expect(dueno).not.toBe(empleado)
  })
})
