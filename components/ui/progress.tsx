"use client"

import * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      // `value` se destructura arriba para calcular el ancho del indicador a
      // mano, y por eso YA NO viaja en `...props` — hay que reenviarlo acá
      // explícito. Sin esto, Radix nunca ve un valor real: se queda en su
      // default `null` (`data-state="indeterminate"`, sin `aria-valuenow`), y
      // un lector de pantalla anuncia "cargando, sin valor" en vez del
      // porcentaje real de cada barra (hallazgo de la review final del
      // rediseño de /ventas, el primer consumidor real de este componente).
      value={value}
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 bg-primary transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
