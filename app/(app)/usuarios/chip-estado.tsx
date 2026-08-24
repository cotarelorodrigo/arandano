import { Badge } from '@/components/ui/badge'

/**
 * El chip de la columna ESTADO (design/arandano.pen, nodos `kW5J7`/`bxQPH`
 * "Chip · Activa/o" y `aKx6v` "Chip · Desactivado"): activo se pinta con
 * `$ar-ok-soft`/`$ar-ok` (--ok-soft/--ok), desactivado con `$ar-sunken`/
 * `$ar-ink-2` (--muted/--foreground-soft) — el mismo par que usa el chip de
 * rol "Empleado" (ver chip-rol.tsx), sin ambigüedad porque nunca comparten
 * columna.
 *
 * "Activo"/"Activa" en la maqueta cambia con el género de la persona, pero
 * `User` no tiene un campo de género —serían dos filas de ejemplo escritas a
 * mano, no un dato real—, así que este chip usa la forma genérica "Activo"
 * para cualquiera, igual que el código anterior a este rediseño.
 */
export function ChipEstadoUsuario({ desactivado }: { desactivado: boolean }) {
  if (desactivado) {
    return (
      <Badge className="h-auto gap-[5px] border-transparent bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-foreground-soft">
        Desactivado
      </Badge>
    )
  }
  return (
    <Badge className="h-auto gap-[5px] border-transparent bg-ok-soft px-[9px] py-[3px] text-[11px] font-semibold text-ok">
      Activo
    </Badge>
  )
}
