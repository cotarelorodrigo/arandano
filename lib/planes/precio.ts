import type { Prisma } from '@/generated/prisma/client'
import { recargoDePago } from '@/lib/ventas/totales'

type Decimal = Prisma.Decimal

/**
 * Lo que cuesta un artículo pagado con este plan.
 *
 * Se define COMO la suma del recargo y no con una fórmula propia
 * (`precio × (100 + pct) / 100`) a propósito: las dos dan lo mismo hoy, pero
 * dos fórmulas que tienen que coincidir para siempre es exactamente lo que se
 * separa en el primer cambio de redondeo. La ficha del artículo tiene que
 * decir el mismo número que después cobra el mostrador.
 */
export function precioConPlan(precio: Decimal, porcentaje: Decimal): Decimal {
  return precio.add(recargoDePago(precio, porcentaje))
}
