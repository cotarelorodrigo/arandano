import { KeyRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/**
 * El chip de la columna ROL (design/arandano.pen, nodos `Sx19U`/`dP6UM`
 * "Chip · Dueño/a" y `G3OZ5`/`clB9U` "Chip · Empleado/a"): un dueño lleva
 * ícono `key-round` sobre `$ar-primary-soft`/`$ar-primary` (--accent/
 * --primary), un empleado no lleva ícono y se pinta con `$ar-sunken`/
 * `$ar-ink-2` (--muted/--foreground-soft) — el mismo par que usa el chip de
 * "Desactivado" en chip-estado.tsx, y no es un problema: nunca aparecen en la
 * misma columna, así que no hay ambigüedad para quien mira la fila.
 */
export function ChipRol({ rol }: { rol: 'DUENO' | 'EMPLEADO' }) {
  if (rol === 'DUENO') {
    return (
      // [&>svg]:size-[11px]! pisa el size-3! con !important que trae
      // badgeVariants por default — mismo hallazgo que ya dejó documentado
      // app/(app)/servicio-tecnico/chip-estado.tsx (hallazgo M7 de esa
      // review): sin este mismo modificador en el propio <Badge>,
      // tailwind-merge no tiene con qué descartar el size-3! de base.
      <Badge className="h-auto gap-[5px] border-transparent bg-accent px-[9px] py-[3px] text-[11px] font-semibold text-primary [&>svg]:size-[11px]!">
        <KeyRound aria-hidden="true" />
        Dueño
      </Badge>
    )
  }
  return (
    <Badge className="h-auto gap-[5px] border-transparent bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-foreground-soft">
      Empleado
    </Badge>
  )
}
