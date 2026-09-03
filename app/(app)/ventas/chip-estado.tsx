import { Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * Los dos rótulos del chip, exportados: `app/(app)/dashboard/csv.ts` los usa
 * para la columna "Estado" del CSV, y necesita el string real —no sólo el
 * componente— porque un CSV es texto plano, sin JSX. Antes eran dos
 * literales repetidos a mano en los dos archivos, con un docblock en csv.ts
 * que afirmaba que eran "los MISMOS dos rótulos" sin que nada lo garantizara
 * (review final de rama): renombrar uno acá no habría tocado el otro.
 */
export const ROTULO_ANULADA = 'Anulada'
export const ROTULO_COBRADA = 'Cobrada'

/**
 * El chip de estado de una venta (design/arandano.pen, nodos `FALdN`/`d0yrQ`
 * en el listado y `p8qMyl` en el panel Resumen del detalle): la misma
 * pastilla en las dos pantallas, así que vive en un solo lugar y no
 * duplicada en `page.tsx` y en `[id]/page.tsx`.
 */
export function ChipEstado({ anulada }: { anulada: boolean }) {
  if (anulada) {
    return (
      <Badge className="h-auto gap-[5px] border-transparent bg-destructive-soft px-[9px] py-[3px] text-[11px] font-semibold text-destructive">
        <Undo2 aria-hidden="true" className="size-[11px]" />
        {ROTULO_ANULADA}
      </Badge>
    )
  }
  return (
    <Badge className="h-auto border-transparent bg-ok-soft px-[9px] py-[3px] text-[11px] font-semibold text-ok">
      {ROTULO_COBRADA}
    </Badge>
  )
}
