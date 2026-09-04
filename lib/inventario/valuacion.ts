import { Prisma } from '@/generated/prisma/client'
import { redondearDinero } from '@/lib/ventas/totales'

type Decimal = Prisma.Decimal

const CERO = new Prisma.Decimal(0)

/**
 * Cuánto costó la mercadería que queda de un artículo.
 *
 * `null` y CERO son dos respuestas distintas, y la diferencia es todo el
 * diseño de esta función:
 *
 * - `null` es **no se sabe**: ningún ingreso de este artículo cargó costo. El
 *   tile no se dibuja y el total del local no lo suma (pero sí lo cuenta como
 *   faltante, ver `valuacionDelTenant`). Mismo criterio que `textoDeMargen`
 *   en app/(app)/inventario/[id]/page.tsx y `margenDe` en
 *   lib/dashboard/metricas.ts: sin con qué calcular, no se inventa un número.
 * - CERO es **no hay mercadería**: stock en cero, o negativo. Con costo
 *   cargado se puede afirmar que lo que queda no vale nada, y es verdad.
 *
 * El clamp del negativo vive acá y en ningún otro lado. Vender sin stock no
 * está frenado (`lib/ventas/crear.ts`: "el stock puede quedar negativo y eso
 * no frena"), así que un artículo puede decir −2 — y eso es un error de carga
 * que `/inventario` ya avisa por su cuenta, no plata negativa que haya que
 * restarle al total del local.
 *
 * `costo` va siempre en PESOS, sea cual sea `Articulo.moneda`:
 * `MovimientoStock.costoUnitario` no distingue moneda (deuda del costo,
 * CLAUDE.md). Por eso esta función no recibe la moneda y no podría depender
 * de ella aunque quisiera — a diferencia del margen, que compara el costo
 * CONTRA EL PRECIO y por eso sí tiene que devolver null en dólares. Acá el
 * costo se multiplica por una cantidad, y una cantidad no tiene moneda.
 */
export function costoTotalDeArticulo(stock: Decimal, costo: Decimal | null): Decimal | null {
  if (costo === null) return null
  if (stock.lessThanOrEqualTo(0)) return CERO
  return redondearDinero(stock.mul(costo))
}
