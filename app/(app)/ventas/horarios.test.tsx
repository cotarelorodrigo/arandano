import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraficoDeHorarios } from './horarios'
import { agregarPorTiempo } from '@/lib/ventas/horarios'

const href = (v: string) => `/ventas?desde=2026-08-21&hasta=2026-08-21&vista=${v}`

/**
 * Extrae, en orden (de la primera hora a la última), la clase de color y el
 * alto en px de cada barra — para poder asertar CUÁL barra pinta con qué color
 * y CUÁNTO mide, en vez de sólo "el string bg-primary aparece en algún lado del
 * html". Si una mutación pintara siempre la última barra, o fijara una altura
 * equivocada, los números no coincidirían.
 */
function barrasDe(html: string): { clase: string; alto: number }[] {
  const re = /<div class="w-full rounded-t-\[6px\] (bg-primary|bg-accent)" style="height:(\d+)(?:px)?"><\/div>/g
  return [...html.matchAll(re)].map((m) => ({ clase: m[1], alto: Number(m[2]) }))
}

// Distribución no uniforme con el pico NO al final: hora 15 (1 venta), hora 18
// (2 ventas, el pico), hora 19 (1 venta). Máximo = 2. Si una mutación pintara
// siempre la última barra (19) en lugar de mirar b.pico (18), fallaría.
const CON_PICO = agregarPorTiempo(
  [
    new Date('2026-08-21T18:00:00Z'), // 15 en zona Argentina
    new Date('2026-08-21T21:00:00Z'), // 18 en zona Argentina
    new Date('2026-08-21T21:30:00Z'), // 18 en zona Argentina (es el pico, 2 ventas)
    new Date('2026-08-21T22:00:00Z'), // 19 en zona Argentina
  ],
  'hora',
)

describe('GraficoDeHorarios', () => {
  it('dibuja el título, rótulos reales y el pie', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('Cuándo vende el local')
    // Afirmar rótulos reales: 15, 18, 19 deben estar en el HTML
    expect(html).toContain('>15<')
    expect(html).toContain('>18<')
    expect(html).toContain('>19<')
    expect(html).toContain('El pico es a las 18 h, con 2 ventas.')
  })

  it('cada barra mide proporcional a sus ventas, con el pico en --primary', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    const barras = barrasDe(html)
    // Máximo = 2 ventas (hora 18), así que:
    // Hora 15 (1 venta) = round(1/2*70) = 35
    // Hora 18 (2 ventas, pico) = round(2/2*70) = 70
    // Hora 19 (1 venta) = round(1/2*70) = 35
    expect(barras).toHaveLength(5) // 15, 16, 17, 18, 19
    expect(barras.map((b) => b.alto)).toEqual([35, 0, 0, 70, 35])
    expect(barras.map((b) => b.clase)).toEqual([
      'bg-accent', 'bg-accent', 'bg-accent', 'bg-primary', 'bg-accent',
    ])
  })

  it('el segmentado marca el link de la vista activa (hora) con aria-current', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    // El link de "Hora" debe tener aria-current="page"; el de "Día" no.
    // Buscar que ambos links existen con sus vistas respectivas:
    expect(html).toContain('vista=hora')
    expect(html).toContain('vista=dia')
    // Extractar los dos links y verificar cuál tiene aria-current:
    const linkHora = html.match(/<a[^>]*href="[^"]*vista=hora[^"]*"[^>]*>/)
    const linkDia = html.match(/<a[^>]*href="[^"]*vista=dia[^"]*"[^>]*>/)
    expect(linkHora).toBeTruthy()
    expect(linkDia).toBeTruthy()
    // El link activo (hora) debe tener aria-current="page"
    expect(linkHora![0]).toContain('aria-current="page"')
    // El link inactivo (día) NO debe tener aria-current
    expect(linkDia![0]).not.toContain('aria-current')
  })

  it('una hora sin ventas renderiza barra de altura cero, no la omite', () => {
    // El fixture tiene horas 15, 18, 19 con ventas; 16 y 17 sin ventas.
    // Cada una debe renderizar con height:0.
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    const coincidencias = (html.match(/height:0/g) ?? []).length
    // Horas 16 y 17 tienen altura cero, así que debe haber al menos 2
    expect(coincidencias).toBeGreaterThanOrEqual(2)
  })
})
