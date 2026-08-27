import { Prisma } from '@/generated/prisma/client'

type Decimal = Prisma.Decimal

// Las escalas EXACTAS de las columnas que guardan cada cosa. Están acá y no
// repartidas por el motor porque son lo mismo que ya usa `redondearDinero`:
// el número de decimales que Postgres conserva. Si una migración cambia una
// columna, este archivo es el que hay que tocar.
/** Los decimales en los que se guarda la plata: `Decimal(12, 2)`. */
export const ESCALA_DINERO = 2
/** Cantidades y stock: `Decimal(12, 3)` — medio kilo de harina no es entero. */
export const ESCALA_CANTIDAD = 3
/** La cotización de la moneda: `Decimal(12, 4)`. */
export const ESCALA_COTIZACION = 4
/** El porcentaje de un plan de pago: `Decimal(6, 3)`. */
export const ESCALA_PORCENTAJE = 3

/**
 * Si `v` tiene más decimales de los que la columna va a conservar.
 *
 * Existe porque validar sobre un valor que Postgres después redondea deja una
 * venta que no explica su propio total: `cantidad = 1.0005` a $1000 cerraba
 * contra un pago de 1000,50 y la fila guardada terminaba diciendo
 * `1.001 × 1000 = 1001`. El motor reportaba éxito.
 *
 * Se RECHAZA en vez de recortar en silencio, y es una decisión, no una
 * omisión. Recortar es lo que suena amable y es lo que hace daño: cambia la
 * cantidad que sale del inventario y la plata que entra a la caja sin que el
 * llamador se entere, y el que después mira el ticket no tiene forma de saber
 * que lo que pidió no fue lo que pasó. Rechazar deja la decisión donde está la
 * información: el que arma la venta sabe si quiso 1.0005 o 1.001, el motor no.
 * Redondear explícitamente antes de llamar sigue estando disponible; lo que ya
 * no está disponible es que pase sin que nadie lo elija.
 *
 * `decimalPlaces()` normaliza los ceros de cola —`1.000` da 0—, así que un
 * valor que se escribió con la escala de la columna nunca se rechaza.
 */
export function excedeEscala(v: Decimal, escala: number): boolean {
  return v.decimalPlaces() > escala
}

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

/**
 * Lo que un plan le suma (o le resta) a la parte de la venta que ese pago cubre.
 *
 * Con signo: un plan de -10 % devuelve un negativo, y el llamador lo suma igual.
 *
 * Redondea ACÁ, por pago, antes de que nadie sume — misma regla y mismo motivo
 * que `subtotalItem`: el total del navegador y el del servidor se comparan por
 * igualdad, así que los dos tienen que redondear en el mismo momento.
 */
export function recargoDePago(baseEnPesos: Decimal, porcentaje: Decimal): Decimal {
  return redondearDinero(baseEnPesos.mul(porcentaje).div(100))
}
