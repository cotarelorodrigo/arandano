import { Undo2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

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
        Anulada
      </Badge>
    )
  }
  return (
    <Badge className="h-auto border-transparent bg-ok-soft px-[9px] py-[3px] text-[11px] font-semibold text-ok">
      Cobrada
    </Badge>
  )
}
