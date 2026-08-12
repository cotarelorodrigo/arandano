import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

// Las dos funciones que el componente importa viven en un archivo 'use server'.
// Su contrato ya lo fija app/(app)/vender/acciones.test.ts; acá sólo importa qué
// renderiza la pantalla, así que se mockean.
vi.mock('./acciones', () => ({
  cobrar: vi.fn(),
  buscarArticulos: vi.fn(async () => []),
}))

async function render() {
  const { PuntoDeVenta } = await import('./punto-de-venta')
  return renderToStaticMarkup(<PuntoDeVenta cotizacionInicial={null} />)
}

describe('el punto de venta', () => {
  it('renderiza con el carrito vacío', async () => {
    expect(await render()).toContain('Buscar artículo')
  })

  // El ancla de la pantalla. Está desde el carrito vacío y no sólo cuando hay
  // algo que cobrar: un ancla que aparece y desaparece no es un ancla — la
  // vista aprende dónde mirar porque el número está SIEMPRE en el mismo lugar.
  it('el pie de la cinta está desde el carrito vacío, en cero', async () => {
    const html = await render()
    expect(html).toMatch(/class="[^"]*total[^"]*"[^>]*>[^<]*0,00/)
  })

  // El tratamiento de display de la plata. A diferencia del cartel de
  // app/(app)/layout.test.tsx (sin `composes`), acá el harness SÍ procesa el
  // CSS module, y `estilos.total` compone `estilos.importe` — pero el
  // resultado en el HTML es un único hash por clase (p. ej. "_total_f2d38c"),
  // sin conservar el nombre "importe" en el string. Comprobado corriendo el
  // import de components/importe.module.css bajo este mismo runner: el
  // `composes` no aparece en el className renderizado. Por eso este caso mira
  // el FUENTE en vez del HTML — sigue atrapando que el pie deje de usar
  // `estilos.total` en un refactor, que es lo único que el nombre del caso
  // promete.
  it('el total lleva el tratamiento de importe', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8').replace(/\s+/g, '')
    expect(fuente).toContain('estilos.total}')
  })
})
