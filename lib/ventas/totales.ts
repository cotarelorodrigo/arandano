import { Prisma } from '@/generated/prisma/client'
import type { Moneda } from '@/generated/prisma/client'

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

/**
 * **Sin ningún consumidor de producción: sobrevive como ancla de test.** Suma
 * TODOS los ítems en una sola pila, sin mirar `moneda`, así que desde el ciclo
 * del precio en dólares ya no describe el dominio — una venta tiene dos
 * totales. El motor usa el plural, `totalesDeItems`. Ésta se conserva porque
 * es contra ella que `lib/ventas/centavos.test.ts` fija el espejo de la
 * aritmética en enteros del navegador; no se la llama desde ninguna pantalla
 * ni desde `crearVenta`, y llamarla sería ignorar la mitad en dólares en
 * silencio.
 */
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

/**
 * **Sin ningún consumidor de producción: sobrevive como ancla de test**, igual
 * que `totalDeItems` y por la misma razón. Suma todo en pesos multiplicando
 * siempre por la cotización, que desde este ciclo son dos supuestos rotos a la
 * vez: los pagos van a dos pilas según `cubre`, y un pago EN pesos que cubre
 * dólares no se multiplica (ver `pesosEntregados`, más abajo). El motor usa
 * el plural, `totalesDePagos`.
 */
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

/**
 * Lo que entró a la caja por una venta: la mercadería más el recargo (o menos
 * el descuento, si vino en negativo).
 *
 * Existe porque `Venta.total` NO cambió de significado con los planes de
 * pago (Task 1, `docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`):
 * sigue siendo la mercadería a precio de lista, y ninguna venta ya grabada
 * pasó a decir algo distinto de lo que decía antes. `Venta.recargo` es un
 * CACHÉ aparte —la suma de los recargos de sus pagos, con el mismo criterio
 * que `Articulo.stock` contra sus movimientos—, así que lo cobrado no es un
 * campo que se pueda leer directo: hay que sumar los dos. Una sola función
 * para esa suma, y no `venta.total.add(venta.recargo)` a mano en cada
 * pantalla, es lo que hace que `/ventas` (la columna Total y el tile "Total
 * del período") y `/ventas/[id]` (el desglose del pie) nunca puedan
 * desacordar en qué es "lo cobrado".
 *
 * **Con `totalUsd !== 0`, este número DEJA DE SER "todo lo que entró".**
 * Un iPhone de US$300 cobrado en pesos con un plan del 40 % da `total = 0`,
 * `totalUsd = 300` y `recargo = 178.200` — `totalCobrado` devuelve $178.200,
 * aunque al cajón hayan entrado $623.700 (los $445.500 que cubrieron los
 * dólares, más el recargo). No es un bug: el spec de este ciclo fija que
 * `/ventas` muestra DOS números y no convierte nada, y los pesos que
 * cubrieron la mitad en dólares son precisamente una conversión — mezclarlos
 * acá volvería a convertir lo que el resto del ciclo se cuidó de no
 * convertir. El par que sí describe la venta sin convertir es `totalUsd`
 * (la mercadería en dólares) de un lado, y este número —TODO peso que no es
 * esa mercadería: mercadería en pesos + recargo— del otro. Quien mire
 * `totalCobrado` sin leer este comentario y encuentre un número bajo al lado
 * de un `totalUsd` alto va a creer que es un bug: no lo es.
 */
export function totalCobrado(v: { total: Decimal; recargo: Decimal }): Decimal {
  return v.total.add(v.recargo)
}

/** Los dos totales de una venta: la mercadería en pesos y la que está en dólares. */
export type Totales = { ars: Decimal; usd: Decimal }

/** Una fila de pago, en la forma mínima que estas funciones necesitan. */
type FilaDePago = { moneda: Moneda; cubre: Moneda; base: Decimal; cotizacion: Decimal }

/**
 * Si la `base` de un pago se expresa en dólares.
 *
 * Es LA regla del ciclo, y está en una función propia porque de ella depende
 * que nada divida: `base` va en dólares si el pago toca dólares de algún lado
 * —la moneda que entra o el total que cubre—, y `cotizacion` multiplica
 * siempre DESDE ese lado. La alternativa —definir `base` siempre en la moneda
 * del pago, o siempre en la del total— deja uno de los dos cruces necesitando
 * `base / cotizacion`, y una división acá produce ventas que no cierran por un
 * centavo y que la persona del mostrador no tiene forma de arreglar. Es el
 * mismo motivo por el que el ciclo de precios por forma de pago prohibió el
 * plan sobre un pago en dólares.
 */
export function baseEnDolares(p: { moneda: Moneda; cubre: Moneda }): boolean {
  return p.moneda === 'USD' || p.cubre === 'USD'
}

/**
 * Lo que un pago le aporta al total que declara cubrir, en la moneda de ESE
 * total.
 *
 * Las cuatro combinaciones, y ninguna divide:
 *
 * | moneda | cubre | base en | aporta                |
 * |--------|-------|---------|-----------------------|
 * | ARS    | ARS   | pesos   | base                  |
 * | USD    | ARS   | dólares | base × cotizacion     |
 * | USD    | USD   | dólares | base                  |
 * | ARS    | USD   | dólares | base                  |
 *
 * O sea: sólo se multiplica cuando la base está en dólares y el total que se
 * cubre está en pesos. En todo lo demás la base ya está en la unidad correcta.
 */
export function aporteDePago(p: FilaDePago): Decimal {
  if (p.cubre === 'ARS' && baseEnDolares(p)) return montoEnPesos(p.base, p.cotizacion)
  return redondearDinero(p.base)
}

/**
 * Lo que la persona entrega por este pago, en `p.moneda` — lo que va a
 * `Pago.monto` (antes de sumarle el recargo del plan).
 *
 * Es el reflejo de `aporteDePago`: cuando la base está en dólares y el pago se
 * entrega en pesos, acá es donde se multiplica.
 */
export function montoEntregado(p: FilaDePago): Decimal {
  if (p.moneda === 'ARS' && baseEnDolares(p)) return montoEnPesos(p.base, p.cotizacion)
  return redondearDinero(p.base)
}

/** La mercadería del carrito, partida por la moneda de cada ítem. */
export function totalesDeItems(
  items: { cantidad: Decimal; precioUnitario: Decimal; moneda: Moneda }[],
): Totales {
  return items.reduce<Totales>(
    (acc, i) => {
      const sub = subtotalItem(i.cantidad, i.precioUnitario)
      return i.moneda === 'USD' ? { ...acc, usd: acc.usd.add(sub) } : { ...acc, ars: acc.ars.add(sub) }
    },
    { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
  )
}

/** Lo que los pagos cubren, acumulado contra el total que cada uno declara. */
export function totalesDePagos(pagos: FilaDePago[]): Totales {
  return pagos.reduce<Totales>(
    (acc, p) => {
      const a = aporteDePago(p)
      return p.cubre === 'USD' ? { ...acc, usd: acc.usd.add(a) } : { ...acc, ars: acc.ars.add(a) }
    },
    { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
  )
}

/**
 * Cuántos pesos entregó un pago YA GUARDADO, leído desde su fila.
 *
 * Distinta de `montoEnPesos`, y la diferencia es un bug real que este ciclo
 * destapa: `montoEnPesos(monto, cotizacion)` multiplica siempre, y eso era
 * correcto mientras todo pago en pesos llevara cotización 1. Un pago en pesos
 * que cubre el total en dólares lleva la cotización de verdad (1485) y `monto`
 * YA en pesos, así que multiplicarlo otra vez da un número mil quinientas
 * veces más grande. Toda lectura de un pago guardado pasa por acá.
 */
export function pesosEntregados(p: {
  moneda: Moneda
  monto: Decimal
  cotizacion: Decimal
}): Decimal {
  return p.moneda === 'ARS' ? redondearDinero(p.monto) : montoEnPesos(p.monto, p.cotizacion)
}
