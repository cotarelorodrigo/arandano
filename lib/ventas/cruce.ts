/**
 * La regla de la cotización cuando un pago cambia de cruce.
 *
 * **Vive acá y no en una pantalla desde que hay DOS pantallas que reparten
 * pagos**: el cobro (`app/(app)/vender/punto-de-venta.tsx`, que la re-exporta
 * para no romper a nadie que la importe de ahí) y la corrección
 * (`app/(app)/ventas/corregir-pagos.tsx`). Es exactamente el mismo movimiento
 * que hizo `lib/ventas/pagos.ts` con `PagoDeVenta` cuando aparecieron los dos
 * escritores del motor, y por el mismo motivo: la misma regla escrita dos
 * veces es el defecto que este repo ya pagó con las dos implementaciones del
 * selector de categoría, que se desincronizaron en silencio durante cuatro
 * días con el gate entero en verde.
 *
 * **Este archivo no importa NADA**, y esa es media razón de ser: lo consumen
 * dos módulos `'use client'`, y un import que llegara a `lib/db.ts`
 * arrastraría `pg` al bundle del navegador.
 */

/**
 * Qué cotización le corresponde a un pago que acaba de cambiar de `moneda` o
 * de `cubre`.
 *
 * **VACÍA cuando el pago CRUZA monedas**, y ésa es la regla del ciclo del
 * precio en dólares: la cotización no se precarga nunca, ni con la del local
 * ni con la del último pago. Un `'1'` heredado sobre un pago que pasó a cruzar
 * no es un default inocente —es un dólar a un peso, y una venta que cierra por
 * un número que nadie tipeó—.
 *
 * **Y `'1'` cuando NO cruza**, que es lo que el servidor necesita: con
 * `moneda === cubre` la cotización no entra en ninguna cuenta (ver
 * `aporteDePago`/`montoEntregado` en totales.ts), pero el motor la exige mayor
 * que cero igual y rechaza con COTIZACION_INVALIDA.
 *
 * Escribir el `'1'` acá es además lo que limpia una cotización MENTIROSA:
 * tipear 1485 con `cubre: 'USD'` y después volver el selector a pesos dejaba
 * ese 1485 pegado a un pago que ya no convierte nada, y como el servidor ni la
 * mira en ese caso, terminaba guardado en `Pago.cotizacion` —histórico e
 * inmutable— sin que ninguna cuenta de la pantalla lo notara.
 */
export function cotizacionParaElCruce(moneda: 'ARS' | 'USD', cubre: 'ARS' | 'USD'): string {
  return moneda === cubre ? '1' : ''
}
