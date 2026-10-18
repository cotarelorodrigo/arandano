# Spec: el costo de un artículo en dólares se carga en dólares

**Fecha**: 2026-10-18

**Origen**: pedido de un cliente (local que vende iPhones), audios de WhatsApp del
7 y 8 de octubre de 2026, pasado por el dueño del producto como "Tarea 1". Al
cargar el costo de un iPhone —artículo con precio en USD— el sistema lo guarda
en pesos y después muestra *"el costo está en pesos: sin margen para un
artículo en dólares"*. El cliente quiere cargar el costo directamente en
dólares.

**Cómo se decidió**: el dueño del producto pidió que el ciclo se resuelva de
noche sin preguntas y que revisa las decisiones a la mañana. Todo lo que sigue
marcado como **decisión** es una llamada de quien implementó, no algo que el
dueño haya confirmado.

## El problema

`MovimientoStock.costoUnitario` no tiene moneda: es pesos por construcción. El
ciclo del precio en USD (2026-08-29) lo dejó escrito como costura —*"es ese ciclo
el que le devuelve el margen a estos artículos"*— y ésta es esa deuda. Para un
local que compra los equipos en dólares, cargar el costo en pesos obliga a hacer
una conversión que nadie quiere hacer y que además envejece con la cotización:
exactamente la queja que motivó el precio en dólares, ahora del lado del costo.

## El principio

**El costo tiene moneda igual que el precio, y nunca se convierte.** Ningún
número de este ciclo se calcula cruzando monedas, porque el sistema no tiene una
cotización guardada en la que confiar: la decisión del 2026-08-29 es que la
cotización se tipea en cada venta, no que se fija una para el local.

## Las decisiones

### 1. Una columna `monedaCosto` en `MovimientoStock`, con default `ARS`

`monedaCosto Moneda @default(ARS) @map("moneda_costo")`. No nullable: todas las
filas existentes con costo son pesos, y el default las describe sin backfill.
En una fila sin costo la columna no significa nada (mismo criterio que
`VentaItem.moneda`, que ya existe con default `ARS`).

Se descartó guardar la moneda en el artículo ("el costo está en la moneda del
artículo"): un artículo puede pasar de pesos a dólares y los ingresos viejos
tienen que seguir diciendo en qué moneda se pagaron. El costo es del evento de
recepción, y su moneda también.

La migración es puramente aditiva y su default reproduce el comportamiento
anterior. **Riesgo de rollback, declarado**: si después de este deploy alguien
carga un costo en dólares y la imagen se revierte, la imagen vieja leería ese
costo como pesos (en el tile y al congelarlo en una venta en pesos). No se pierde
ningún dato —la columna sigue ahí— y vuelve a leerse bien al re-deployar.

### 2. El formulario propone la moneda del artículo, y se puede cambiar

En "Ingresar mercadería" (ficha del artículo) y en el alta del artículo, al lado
del costo aparece un selector `$ / US$` que arranca en la moneda del artículo
(en el alta, en la moneda que se eligió para el precio, y la sigue si se cambia
el precio de moneda mientras el usuario no tocó la del costo). Sólo se muestra
con el permiso `COSTOS`, igual que el campo del costo.

**Decisión**: si la acción recibe un costo sin moneda (un formulario viejo
cacheado en el navegador durante un deploy), lo toma como **pesos**, que es lo
que ese formulario quería decir. `ingresarStock` y `crearArticulo` reciben
`monedaCosto` con default `ARS` por la misma razón.

### 3. El margen se calcula sólo en la misma moneda

`textoDeMargen(precio, monedaPrecio, costo, monedaCosto)`:

- misma moneda → `margen 38,3 %`, la misma cuenta de siempre;
- monedas distintas → `null`, y el pie del tile dice cuál es el cruce:
  *"el costo está en pesos: sin margen para un artículo en dólares"* (el texto
  de hoy, que se mantiene) o *"el costo está en dólares: sin margen para un
  artículo en pesos"*.

Se mantiene el comportamiento actual para monedas distintas (pedido explícito
de la tarea): no hay cotización guardada, así que no hay margen.

### 4. Cada costo se muestra en su moneda

El tile "Último costo", el tile "Costo total" (stock × último costo, en la moneda
de ese costo) y la columna de detalle del historial ("US$ 450 c/u") usan
`precioEnSuMoneda`. El "último costo" sigue siendo el ingreso más reciente con
costo cargado, **sea cual sea su moneda**: un ingreso en dólares posterior a uno
en pesos es el costo que vale hoy.

### 5. Las ventas siguen congelando sólo costos en pesos

`VentaItem.costoUnitario` está documentado como pesos y el margen del dashboard
(`Venta.costoArs`, `vendidoConCosto`) es una cuenta en pesos. Este ciclo **no**
cambia eso: se congela el costo sólo cuando el ítem es en pesos **y** el último
costo es en pesos. Un ítem en pesos cuyo último costo está en dólares queda en
`NULL` —antes del ciclo, imposible; sin este filtro, un costo en dólares
entraría al margen en pesos como si fuera pesos—. Un ítem en dólares sigue en
`NULL` como hoy.

**Queda para un ciclo siguiente**: el margen de las ventas en dólares en el
dashboard (exige `costoUsd`/`vendidoConCostoUsd` en `Venta`).

### 6. "Costo del stock" del dashboard se parte por moneda

`valuacionDelTenant` devuelve `{ total, totalUsd, sinCosto }`: cada artículo suma
a la moneda de su último costo. El tile muestra los pesos como valor y, si hay
dólares, los suma al lado con el mismo formato que ya usa el resto del
dashboard para montos en dos monedas. Sumarlos exigiría una cotización.

## Fuera de alcance

- Cargar o corregir un costo sin ingresar mercadería (la otra mitad de la deuda
  del costo, ver `docs/contexto/proximos-pasos.md`).
- Convertir costos con una cotización.
- El margen en dólares del dashboard (decisión 5).

## Tests

- `textoDeMargen`: misma moneda (ARS/ARS y USD/USD con el ejemplo de la
  maqueta), monedas distintas en las dos direcciones, precio cero, sin costo.
- `ingresarStock` guarda `monedaCosto`; sin moneda guarda `ARS`.
- Alta con costo en dólares guarda el movimiento en dólares.
- `crearVenta`: ítem ARS con último costo USD → `costoUnitario` NULL y no suma
  a `costoArs`; ítem ARS con costo ARS sigue igual (regresión).
- `valuacionDelTenant` separa pesos y dólares.
- Migración: las filas existentes quedan en `ARS`.
