import { Prisma } from '@/generated/prisma/client'

type Decimal = Prisma.Decimal

/** Los decimales en los que se guarda la plata: `Decimal(12, 2)`. */
const ESCALA_DINERO = 2

/**
 * Todo producto se redondea ACÁ, antes de entrar en cualquier suma.
 *
 * Sumar primero y redondear al final da un resultado distinto en los bordes, y
 * "distinto en los bordes" acá significa una venta rechazada por un centavo:
 * el total de los ítems y el total de los pagos se comparan por igualdad, así
 * que los dos tienen que redondear en el mismo momento y de la misma forma.
 *
 * ROUND_HALF_UP y no el default de la librería: es la regla que la gente espera
 * cuando ve el vuelto, y la que usa el resto del comercio.
 */
export function redondearDinero(v: Decimal): Decimal {
  return v.toDecimalPlaces(ESCALA_DINERO, Prisma.Decimal.ROUND_HALF_UP)
}

export function subtotalItem(cantidad: Decimal, precioUnitario: Decimal): Decimal {
  return redondearDinero(cantidad.mul(precioUnitario))
}

export function totalDeItems(
  items: { cantidad: Decimal; precioUnitario: Decimal }[],
): Decimal {
  return items.reduce(
    (acc, i) => acc.add(subtotalItem(i.cantidad, i.precioUnitario)),
    new Prisma.Decimal(0),
  )
}

/** Un pago en pesos lleva cotización 1; uno en dólares, los ARS que valía el
 *  dólar en ese momento. */
export function montoEnPesos(monto: Decimal, cotizacion: Decimal): Decimal {
  return redondearDinero(monto.mul(cotizacion))
}

export function totalDePagos(
  pagos: { monto: Decimal; cotizacion: Decimal }[],
): Decimal {
  return pagos.reduce(
    (acc, p) => acc.add(montoEnPesos(p.monto, p.cotizacion)),
    new Prisma.Decimal(0),
  )
}
