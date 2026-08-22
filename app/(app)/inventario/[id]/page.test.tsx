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
  //
  // I1 de la review: `orderBy: { creadoEn: 'desc' }` sin más contexto también
  // aparece en la consulta de "movimientos" de más abajo, así que esa sola
  // aserción quedaba satisfecha por CUALQUIERA de las dos consultas — una
  // mutación que cambiara el orden de ÉSTA a 'asc' (el tile mostraría el
  // costo más VIEJO) seguía en verde. La aserción ahora ata el `orderBy` al
  // mismo bloque `findFirst` que trae `costoUnitario: { not: null } }`, así
  // que sólo esa consulta puede satisfacerla.
  it('la consulta de "Último costo" filtra por costoUnitario no nulo y ordena por fecha descendente', () => {
    expect(FUENTE).toContain(
      "where: { articuloId: id, costoUnitario: { not: null } },\n          orderBy: { creadoEn: 'desc' },",
    )
  })

  it('sin costo cargado, el tile muestra "—" y no un número inventado', () => {
    expect(FUENTE).toContain("ultimoCosto ? formatearPrecio(ultimoCosto.toString()) : '—'")
  })

  // I3 de la review: ningún caso verificaba que el valor mostrado saliera del
  // artículo — un `valor={formatearCantidad('0')}` fijo pasaba los 22/22
  // tests igual. Éstas atan cada tile a la columna real que lo alimenta.
  it('el tile "En stock" muestra articulo.stock, no un valor fijo', () => {
    expect(FUENTE).toContain('valor={formatearCantidad(articulo.stock.toString())}')
  })

  it('el tile "Precio de venta" muestra articulo.precio, no un valor fijo', () => {
    expect(FUENTE).toContain('valor={formatearPrecio(articulo.precio.toString())}')
  })
})

describe('el historial de la ficha (Task 5 del rediseño)', () => {
  // La columna "Queda" se reconstruye contra el STOCK ACTUAL del artículo,
  // no contra ningún número guardado — calcularSaldos ya lo prueba a fondo
  // en historial.test.tsx; esto sólo verifica que page.tsx la llame con los
  // datos reales (el stock del artículo, no un valor fijo o el de otro).
  it('calcularSaldos se llama con los deltas de los movimientos y el stock real del artículo', () => {
    expect(FUENTE).toContain('calcularSaldos(\n    movimientos.map((m) => m.delta),\n    articulo.stock,\n  )')
  })

  it('cada fila del historial usa el saldo reconstruido, indexado por fila (saldos[i])', () => {
    expect(FUENTE).toContain('{formatearCantidad(saldos[i].toString())}')
  })

  it('la consulta de movimientos ahora trae costoUnitario, que detalleDeMovimiento necesita', () => {
    expect(FUENTE).toMatch(/select:\s*{\s*id: true, delta: true, motivo: true, nota: true, creadoEn: true, costoUnitario: true,/)
  })

  it('el motivo se ve con ChipMotivo, no como texto plano', () => {
    expect(FUENTE).toContain('<ChipMotivo motivo={m.motivo} />')
  })

  it('"Exportar CSV" vive en el encabezado de la card de historial', () => {
    const posHistorial = FUENTE.indexOf('Historial de movimientos')
    const posBoton = FUENTE.indexOf('<BotonExportarCsv')
    expect(posHistorial).toBeGreaterThan(-1)
    expect(posBoton).toBeGreaterThan(posHistorial)
  })

  // Cambio positivo en --ok, negativo en --destructive — la maqueta pinta
  // los dos, no sólo el negativo (que era todo lo que hacía el código viejo).
  it('la celda "Cambio" distingue positivo (ok) de negativo (destructive)', () => {
    expect(FUENTE).toContain("m.delta.lessThan(0) ? 'text-destructive' : 'text-ok'")
  })
})

describe('"Cómo se movió" en la ficha (Task 5 del rediseño)', () => {
  it('sólo se arma para un producto: un servicio no vende con movimiento de stock', () => {
    expect(FUENTE).toContain(
      'columnaDerechaExtra={esProducto ? <GraficoDeRotacion meses={meses} /> : undefined}',
    )
  })

  it('la consulta de ventas por mes filtra por motivo VENTA', () => {
    expect(FUENTE).toContain("where: { articuloId: id, motivo: 'VENTA', creadoEn: { gte: SIETE_MESES_ATRAS } }")
  })
})
