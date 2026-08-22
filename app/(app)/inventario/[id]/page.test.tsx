// Whitebox sobre el FUENTE, mismo criterio que page.test.tsx del listado y
// que app/(app)/ventas/[id]/page.test.tsx: es un Server Component async con
// sesión y Prisma reales, sin arnés para montarlo en este repo. Las funciones
// puras (textoDeMargen, actualizadoHace) sí se importan y se prueban directo.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Prisma } from '@/generated/prisma/client'
import { textoDeMargen, actualizadoHace } from './page'

const FUENTE = readFileSync('app/(app)/inventario/[id]/page.tsx', 'utf8')
const d = (v: string) => new Prisma.Decimal(v)

describe('la ficha muestra y deja editar la categoría (Task 1 del rediseño)', () => {
  it('el subtítulo la muestra cuando el artículo la tiene', () => {
    expect(FUENTE).toContain('articulo.categoria &&')
  })

  it('el formulario de edición la recibe para poder cambiarla', () => {
    expect(FUENTE).toContain('categoria={articulo.categoria}')
  })
})

describe('textoDeMargen (Task 4 del rediseño: el tile "Último costo")', () => {
  // Cuenta verificada contra el relevamiento: precio $12.000, costo $7.400,
  // (12000 - 7400) / 12000 = 0,38333... → "38,3 %", el mismo número que
  // muestra design/arandano.pen. NO es (precio - costo) / costo, que daría
  // 62,2 % — un número distinto que confirma que la fórmula usa el precio
  // como base y no el costo.
  it('se calcula contra el PRECIO DE VENTA, no contra el costo', () => {
    expect(textoDeMargen(d('12000'), d('7400'))).toBe('margen 38,3 %')
    expect(textoDeMargen(d('12000'), d('7400'))).not.toContain('62,2')
  })

  // El caso que CLAUDE.md pide explícitamente: sin costo cargado, no se
  // inventa un margen.
  it('sin costo cargado (null) no muestra un margen falso', () => {
    expect(textoDeMargen(d('12000'), null)).toBeNull()
  })

  // Guarda de NaN/Infinity: un precio en cero (permitido por exigirPrecio,
  // que sólo prohíbe negativo) divide por cero si nadie lo ataja.
  it('con precio en cero no divide por cero', () => {
    expect(textoDeMargen(d('0'), d('100'))).toBeNull()
  })

  it('un costo mayor al precio da un margen negativo, no null', () => {
    expect(textoDeMargen(d('100'), d('150'))).toBe('margen -50,0 %')
  })
})

describe('actualizadoHace (Task 4 del rediseño: el pie del tile "Precio de venta")', () => {
  const AHORA = new Date('2026-08-22T15:00:00Z')

  it('el mismo día calendario de Buenos Aires dice "hoy"', () => {
    expect(actualizadoHace(new Date('2026-08-22T14:00:00Z'), AHORA)).toBe('actualizado hoy')
  })

  it('un día antes dice "hace 1 día", en singular', () => {
    expect(actualizadoHace(new Date('2026-08-21T14:00:00Z'), AHORA)).toBe('actualizado hace 1 día')
  })

  it('varios días antes dice "hace N días", en plural', () => {
    expect(actualizadoHace(new Date('2026-08-16T14:00:00Z'), AHORA)).toBe('actualizado hace 6 días')
  })
})

describe('los tiles de la ficha (Task 4 del rediseño)', () => {
  it('"En stock" pinta con --marca, el ancla que docs/sistema-de-diseno.md ya documenta', () => {
    expect(FUENTE).toContain("backgroundColor: 'var(--marca)'")
  })

  // El test que el brief pide explícitamente: un servicio no tiene stock
  // (lib/ventas/crear.ts no le descuenta), así que su ficha no puede mostrar
  // un tile "En stock" — ni con marca ni sin ella.
  it('el tile "En stock" está condicionado a esProducto, no siempre visible', () => {
    expect(FUENTE).toMatch(/esProducto && \(\s*<Tile\s*\n\s*marca\s*\n\s*rotulo="EN STOCK"/)
  })

  it('el tile "Último costo" también está condicionado a esProducto', () => {
    expect(FUENTE).toMatch(/esProducto && \(\s*<Tile\s*\n\s*rotulo="ÚLTIMO COSTO"/)
  })

  // El último costo sale del movimiento más reciente CON costo cargado, no
  // del ingreso más reciente a secas (que puede no tenerlo, CLAUDE.md).
  it('la consulta de "Último costo" filtra por costoUnitario no nulo y ordena por fecha descendente', () => {
    expect(FUENTE).toContain('where: { articuloId: id, costoUnitario: { not: null } }')
    expect(FUENTE).toContain("orderBy: { creadoEn: 'desc' }")
  })

  it('sin costo cargado, el tile muestra "—" y no un número inventado', () => {
    expect(FUENTE).toContain("ultimoCosto ? formatearPrecio(ultimoCosto.toString()) : '—'")
  })
})
