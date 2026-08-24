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
    // `[&>svg]:size-[11px]!` (hallazgo M7 de la review final): `badgeVariants`
    // trae `[&>svg]:size-3!` con `!important` (components/ui/badge.tsx), que
    // gana por especificidad de selector aunque el ícono tenga su propia
    // clase `size-[11px]` — los dos `!important` empatan y el descendiente
    // `.badge > svg` es más específico que la clase sola del ícono. La
    // maqueta pide 11px (`llAWC`, `NGgBM`, `sWJPB`, `d8731p`, `DLCmh`,
    // `hSZqj`), no 12. Puesta en el propio `<Badge>` y no en el `<Icono>`:
    // `cn()` (Badge) usa `tailwind-merge`, que reconoce el conflicto sobre la
    // misma variante `[&>svg]` y descarta el `size-3!` de `badgeVariants` —
    // repetirla en el ícono no alcanzaría, porque ahí compite contra el
    // selector del padre, no contra otra clase del mismo elemento.
    <Badge
      className={`h-auto gap-[5px] border-transparent px-[9px] py-[3px] text-[11px] font-semibold [&>svg]:size-[11px]! ${clase}`}
    >
      <Icono aria-hidden="true" />
      {NOMBRE_ESTADO[estado]}
    </Badge>
  )
}
