import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraficoDeHorarios } from './horarios'
import { agregarPorTiempo } from '@/lib/ventas/horarios'

const href = (v: string) => `/ventas?desde=2026-08-21&hasta=2026-08-21&vista=${v}`

const CON_PICO = agregarPorTiempo(
  [
    new Date('2026-08-21T21:00:00Z'),
    new Date('2026-08-21T21:30:00Z'),
    new Date('2026-08-21T15:00:00Z'),
  ],
  'hora',
)

describe('GraficoDeHorarios', () => {
  it('dibuja el título, los rótulos y el pie', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('Cuándo vende el local')
    expect(html).toContain('El pico es a las 18 h, con 2 ventas.')
  })

  it('sólo la barra del pico pinta con --primary', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    // Una sola barra en bg-primary; las demás en bg-accent. Si el color
    // saliera de otra cuenta que la del pie, este caso lo vería.
    expect(html.match(/bg-primary/g) ?? []).toHaveLength(1)
    expect((html.match(/bg-accent/g) ?? []).length).toBe(CON_PICO.barras.length - 1)
  })

  it('el segmentado marca la vista activa y linkea a la otra', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('vista=dia')
    expect(html).toContain('aria-current="page"')
  })

  it('una hora sin ventas es una barra de altura cero, no una barra ausente', () => {
    // El hueco con su rótulo es lo que dice "a esta hora no vendés". Sacar la
    // columna correría las demás y el eje dejaría de ser el reloj.
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('height:0')
  })
})
