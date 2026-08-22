import type { EstadoOrden } from '@/generated/prisma/client'
import { Badge } from '@/components/ui/badge'
import { ESTADO_VISUAL, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'

/**
 * El chip de la columna ESTADO del tablero (design/arandano.pen, celdas
 * "Chip · <Estado>" — p. ej. `FCfVM`, `CYnvx`, `Z6e5KX`, `XHX97`, `nzBrY`,
 * `gJNcu`): pastilla con ícono, un color por estado. El color y el ícono
 * salen de `ESTADO_VISUAL` (lib/ordenes-de-trabajo/estados.ts), que es el
 * único lugar que los declara — así la fila, el chip del tablero y, en un
 * ciclo posterior, la bitácora de la ficha no repiten la paleta.
 */
export function ChipEstadoFila({ estado }: { estado: EstadoOrden }) {
  const { Icono, clase } = ESTADO_VISUAL[estado]
  return (
    <Badge className={`h-auto gap-[5px] border-transparent px-[9px] py-[3px] text-[11px] font-semibold ${clase}`}>
      <Icono aria-hidden="true" className="size-[11px]" />
      {NOMBRE_ESTADO[estado]}
    </Badge>
  )
}
