import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo criterio que app/(app)/vender/caja.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real. Acá sólo importa qué renderiza cada formulario.
vi.mock('./acciones', () => ({
  altaArticulo: vi.fn(),
  guardarArticulo: vi.fn(),
  bajaArticulo: vi.fn(),
  reactivarArticuloAccion: vi.fn(),
  ingresarMercaderia: vi.fn(),
  corregirPorConteo: vi.fn(),
}))

async function renderAlta() {
  const { FormularioDeAlta } = await import('./formularios')
  return renderToStaticMarkup(<FormularioDeAlta />)
}

async function renderEdicion(categoria: string | null) {
  const { FormularioDeEdicion } = await import('./formularios')
  return renderToStaticMarkup(
    <FormularioDeEdicion
      articuloId="a1"
      nombre="Vidrio templado 9H"
      sku="000412"
      precio="12000"
      categoria={categoria}
    />,
  )
}

describe('FormularioDeAlta', () => {
  // Task 1 del rediseño: Articulo.categoria existe en el schema y nadie la
  // escribe todavía. La maqueta la muestra en el listado y en la ficha pero
  // no en este formulario — a propósito se aparta acá: un campo que se
  // muestra y no se puede cargar nace siempre vacío.
  it('tiene un campo de categoría, y es opcional', () => {
    return renderAlta().then((html) => {
      expect(html).toContain('name="categoria"')
      expect(html).not.toMatch(/name="categoria"[^>]*required/)
    })
  })
})

describe('FormularioDeEdicion', () => {
  it('tiene un campo de categoría prellenado con el valor actual', async () => {
    const html = await renderEdicion('Accesorios · Protección')
    expect(html).toContain('name="categoria"')
    expect(html).toContain('value="Accesorios · Protección"')
  })

  // Nullable en el schema: un artículo sin categoría no puede romper el
  // formulario de edición.
  it('sin categoría, el campo queda vacío y no revienta', async () => {
    const html = await renderEdicion(null)
    expect(html).toContain('name="categoria"')
    expect(html).not.toContain('value="null"')
  })
})
