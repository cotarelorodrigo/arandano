import { Prisma } from '@/generated/prisma/client'
import { Badge } from '@/components/ui/badge'

/**
 * El chip de estado de una fila del listado (design/arandano.pen, nodos
 * `FHiGo`/`p8QDh`/`o5TRz6`): la 6ª columna, sin rótulo en el encabezado a
 * propósito (`BIcFE`), vacía en la mayoría de las filas.
 */
export type EstadoDeFila = 'DESACTIVADO' | 'NEGATIVO' | 'QUEDA_POCO' | null

/**
 * El umbral de "queda poco", fijo para todo el catálogo.
 *
 * El modelo no tiene ninguna columna de umbral por artículo
 * (`Articulo.stockMinimo` no existe, ver CLAUDE.md, decisiones abiertas del
 * modelo de datos) — agregarla es una migración y una decisión de producto
 * que este ciclo no toma. Un umbral fijo es la opción barata que el propio
 * relevamiento nombra como ejemplo ("menos de 5 unidades"), y es la que se
 * usa acá: no sirve igual para un artículo que rota 200/mes que para uno que
 * rota 2/mes, pero es mejor que no tener ningún aviso.
 */
export const STOCK_BAJO_UMBRAL = 5

/**
 * Qué chip, si alguno, le corresponde a una fila.
 *
 * El orden de los `if` es la prioridad de display: un artículo desactivado
 * muestra SIEMPRE "Desactivado", nunca "Stock negativo" ni "Queda poco" —
 * son datos históricos en ese punto, no una alerta de reponer. Un servicio
 * nunca lleva chip de stock: no tiene (lib/ventas/crear.ts no le descuenta).
 */
export function estadoDeFila(a: {
  tipo: 'PRODUCTO' | 'SERVICIO'
  stock: Prisma.Decimal
  desactivado: boolean
}): EstadoDeFila {
  if (a.desactivado) return 'DESACTIVADO'
  if (a.tipo === 'SERVICIO') return null
  if (a.stock.lessThan(0)) return 'NEGATIVO'
  // greaterThan(0) y no sólo lessThan(UMBRAL): un stock en 0 no es "queda
  // poco", ya no queda nada — son dos avisos distintos y este chip no cubre
  // el segundo.
  if (a.stock.greaterThan(0) && a.stock.lessThan(STOCK_BAJO_UMBRAL)) return 'QUEDA_POCO'
  return null
}

export function ChipEstado({ estado }: { estado: EstadoDeFila }) {
  if (estado === 'NEGATIVO') {
    return (
      <Badge className="h-auto border-transparent bg-destructive-soft px-[9px] py-[3px] text-[11px] font-semibold text-destructive">
        Stock negativo
      </Badge>
    )
  }
  if (estado === 'QUEDA_POCO') {
    return (
      <Badge className="h-auto border-transparent bg-warn-soft px-[9px] py-[3px] text-[11px] font-semibold text-warn">
        Queda poco
      </Badge>
    )
  }
  if (estado === 'DESACTIVADO') {
    return (
      <Badge className="h-auto border-transparent bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-foreground-soft">
        Desactivado
      </Badge>
    )
  }
  return null
}
