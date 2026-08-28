// AnularVenta usa useActionState, pero eso no impide renderizarlo con
// renderToStaticMarkup: es sólo el estado INICIAL el que importa acá (mismo
// criterio que app/(app)/inventario/abm-categorias.test.tsx, que ya
// renderiza componentes con useActionState fuera de jsdom). No hay sesión ni
// Prisma de por medio — `anular` sólo se referencia, nunca se invoca.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AnularVenta } from './formularios'

describe('AnularVenta: el botón en reposo, contra design/arandano.pen (WBV5G, nodo EtWF8)', () => {
  it('en el teléfono es de 44px, ancho completo, radio 10 y relleno de superficie', () => {
    const html = renderToStaticMarkup(<AnularVenta ventaId="v1" />)
    const boton = html.match(/<button[^>]*>[\s\S]*?Anular venta[\s\S]*?<\/button>/)?.[0]
    expect(boton, `no se encontró el botón en: ${html}`).toBeTruthy()
    for (const clase of ['h-11', 'w-full', 'gap-2', 'rounded-[10px]', 'bg-card']) {
      expect(boton).toContain(clase)
    }
  })

  it('en escritorio revierte a lo de siempre: h-8, ancho automático, rounded-lg, bg-destructive/10', () => {
    const html = renderToStaticMarkup(<AnularVenta ventaId="v1" />)
    const boton = html.match(/<button[^>]*>[\s\S]*?Anular venta[\s\S]*?<\/button>/)?.[0]
    for (const clase of ['lg:h-8', 'lg:w-auto', 'lg:gap-1.5', 'lg:rounded-lg', 'lg:bg-destructive/10', 'lg:hover:bg-destructive/20']) {
      expect(boton).toContain(clase)
    }
  })

  it('sigue siendo variant="destructive" (el color de texto no cambia entre anchos)', () => {
    const html = renderToStaticMarkup(<AnularVenta ventaId="v1" />)
    expect(html).toContain('data-variant="destructive"')
  })

  it('el ícono undo-2 sólo existe en el teléfono: lg:hidden, y no lo dibuja escritorio', () => {
    const html = renderToStaticMarkup(<AnularVenta ventaId="v1" />)
    expect(html).toMatch(/<svg[^>]*class="[^"]*\blg:hidden\b[^"]*"/)
  })

  it('el mecanismo de confirmación en dos pasos no se tocó: sigue siendo un solo <form>', () => {
    const html = renderToStaticMarkup(<AnularVenta ventaId="v1" />)
    expect(html.match(/<form/g)).toHaveLength(1)
    expect(html).toContain('Anular venta')
    expect(html).not.toContain('Sí, anular')
    expect(html).not.toContain('Cancelar')
  })
})
