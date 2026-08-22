// Whitebox sobre el FUENTE, mismo criterio que page.test.tsx del listado y
// que app/(app)/ventas/[id]/page.test.tsx: es un Server Component async con
// sesión y Prisma reales, sin arnés para montarlo en este repo.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FUENTE = readFileSync('app/(app)/inventario/[id]/page.tsx', 'utf8')

describe('la ficha muestra y deja editar la categoría (Task 1 del rediseño)', () => {
  it('el subtítulo la muestra cuando el artículo la tiene', () => {
    expect(FUENTE).toContain('articulo.categoria &&')
  })

  it('el formulario de edición la recibe para poder cambiarla', () => {
    expect(FUENTE).toContain('categoria={articulo.categoria}')
  })
})
