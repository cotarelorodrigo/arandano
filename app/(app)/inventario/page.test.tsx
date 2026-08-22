// Whitebox sobre el FUENTE, mismo criterio que
// app/(app)/ventas/[id]/page.test.tsx: page.tsx es un Server Component async
// que abre sesión y consulta Prisma, y este repo no tiene el arnés para
// montarlo fuera de un request real. La cobertura de comportamiento real de
// `categoria` de punta a punta ya la dan test/inventario.test.ts (la
// columna) y acciones.test.ts (el alta/edición contra la base); esto sólo
// cablea que la pantalla PIDE y MUESTRA el dato, que es lo que un refactor
// silencioso podría perder sin que ningún otro test lo note.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FUENTE = readFileSync('app/(app)/inventario/page.tsx', 'utf8')

describe('el listado pide y muestra la categoría (Task 1 del rediseño)', () => {
  it('el select de Prisma trae la columna categoria', () => {
    expect(FUENTE).toMatch(/select:\s*\{[\s\S]*?categoria:\s*true/)
  })

  it('la fila muestra a.categoria bajo el nombre, sólo si existe', () => {
    // `a.categoria &&` y no un acceso directo: un artículo sin categoría (la
    // mayoría, hoy) no puede romper la fila ni mostrar un "null" en pantalla.
    expect(FUENTE).toContain('{a.categoria &&')
  })
})
