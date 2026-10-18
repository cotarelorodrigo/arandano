# Spec: la cotización del dólar del local, con historial

**Fecha**: 2026-10-18

**Origen**: pedido de un cliente (local que vende iPhones), audio WA0021, pasado
por el dueño del producto en la segunda versión de "Tarea 1": *una casilla para
cargar la cotización del dólar, que se actualice por día o cada vez que cambie*,
con historial (fecha, valor, quién) y usada en todos los lugares donde haya que
convertir entre USD y ARS.

**Cómo se decidió**: igual que los ciclos de esta noche, sin preguntas al dueño
del producto, que revisa después. Cada **decisión** es una llamada de quien
implementó. Siguen abiertas para el cliente: qué dólar usa (blue, oficial, otro)
y quién la puede actualizar.

## Lo que este pedido revierte, y por qué

El ciclo del precio en dólares (2026-08-29,
`docs/superpowers/specs/2026-08-29-precio-en-usd-design.md`) decidió con el dueño
del producto que **la cotización se tipea en cada venta y nunca se precarga**, y
borró `ultimaCotizacionUsd()` por dato viejo. El motivo era real: una cotización
del local que nadie actualiza es exactamente el número equivocado, y un pago
cobrado con el dólar de la semana pasada es plata perdida.

Este pedido viene del cliente que usa el sistema, y pide lo contrario: un dólar
del local, visible y fácil de actualizar. **El motivo de aquella decisión sigue
vigente y este diseño lo atiende en vez de ignorarlo**: la cotización se precarga
sólo si es **de hoy**, y en todo lugar donde se usa se dice de cuándo es. Una
cotización vieja no convierte nada en silencio.

`Pago.cotizacion` no cambia de significado: sigue siendo a cuánto se cobró ESE
pago, histórica e inmutable. La cotización del local es el precio de hoy.

## Las decisiones

### 1. Una tabla append-only, `CotizacionDelDolar`

`{ id, tenantId, valor Decimal(12,2), cargadaPorId → User, creadaEn }`, con RLS,
índice `(tenantId, creadaEn)`. Nunca se edita ni se borra una fila: corregir es
cargar otra. La vigente es la más reciente (desempate por `id`, uuid(7)).

`Tenant.cotizacionUsd` / `cotizacionUsdEn` nunca tuvieron escritor y quedan **sin
lector**: el chip de `/vender` pasa a leer la tabla nueva. El `DROP` de las dos
columnas es un deploy posterior (expand/contract), anotado en
`docs/contexto/proximos-pasos.md`.

### 2. Quién la carga: permiso nuevo `COTIZACION`

"Actualizar la cotización del dólar". El dueño siempre; un empleado si se lo
otorgan en `/usuarios`. Verla, todos.

### 3. Dónde se carga: el chip "USD" del header de `/vender`

Ya existe (`ChipCotizacion`, `caja.tsx`) y hoy muestra "USD —" porque nadie
escribe la columna. Pasa a ser un botón: abre un diálogo con el valor vigente, de
cuándo es y quién la cargó, el campo para cargar una nueva y las últimas 10
cargas (fecha y hora, valor, quién). Sin el permiso, el diálogo muestra lo mismo
sin el campo. En el teléfono, la misma entrada en la hoja de controles de caja.

El chip se pinta como **vieja** (el ámbar de advertencia del sistema de diseño)
cuando la vigente no es de hoy en hora argentina, o cuando no hay ninguna.

### 4. Dónde se usa

**"Hoy"** se mide en `America/Argentina/Buenos_Aires`, con una función pura
compartida. Una cotización **de hoy** convierte; una **vieja** se muestra con su
fecha y no se usa sola.

- **Cobro en `/vender`**: cuando un pago cruza monedas, el campo "Cotización"
  arranca con la del local **si es de hoy**, y se puede cambiar (lo que se guarda
  en `Pago.cotizacion` es lo que quedó tipeado, como siempre). Si es vieja, el
  campo arranca vacío —la regla de `lib/ventas/cruce.ts`— con la vieja como
  sugerencia visible ("la del local es del 15/10: $ 1.420"). Un pago que no cruza
  sigue en `1`.
- **Margen de la ficha** con costo y precio en monedas distintas: se calcula
  convirtiendo el costo a la moneda del precio con la vigente, y el pie lo dice:
  *"margen 31,2 % · con el dólar a $ 1.450 del 18/10"*. Con una cotización vieja
  también se calcula, porque es un número de referencia y no plata que se cobra,
  pero el pie lleva la fecha igual. Sin ninguna cotización, el pie de hoy.
- **Precio en pesos de un artículo en dólares**: en la ficha (pie del tile
  "Precio de venta") y en la lista de `/inventario`, un "≈ $ 1.450.000" debajo
  del precio en dólares, con la fecha si es vieja. Es orientativo: el cobro
  sigue cobrando en la moneda del artículo con la cotización del pago.
- **Plan canje**: el campo "Cotización del dólar" de la calculadora arranca con
  la del local si es de hoy, igual que el cobro.

**No se convierte**, a propósito:

- **El dashboard y `/ventas`**: los números del pasado ya tienen la cotización de
  cada pago; convertirlos con la de hoy reescribiría lo que se cobró.
- **El costo del stock** del dashboard: sigue separado por moneda. Sumarlo con
  la de hoy es posible, pero mezcla en un solo número dos cosas que el dueño
  hoy lee por separado; queda como pedido abierto.
- **El bot**: cotizarle un precio en pesos a un cliente con un dólar que puede
  ser de ayer es una promesa que el local no hizo.
- **El congelado del costo en la venta** (margen de ventas en dólares del
  dashboard): sigue siendo el ciclo pendiente del costo en dólares.

### 5. Validaciones

Valor decimal > 0, dos decimales, con la gramática compartida de `lib/formato`.
Un tope de cordura: si la nueva difiere en más de 50 % de la vigente, se pide
confirmar (un cero de más es el error más probable).

## Tests

- `esDeHoy` en hora argentina, incluidos los bordes de medianoche (23:59 y 00:00
  ART contra UTC).
- Cargar una cotización: con el permiso, sin él (forbidden), dueño; queda el
  historial con usuario y fecha; la vigente es la última; aislada por tenant.
- El cobro precarga la de hoy y no la vieja; el valor guardado es el tipeado.
- Margen con monedas distintas: ARS→USD y USD→ARS con la cotización, sin
  cotización, con una vieja (lleva la fecha).
- Equivalente en pesos en la ficha y la lista.
- La calculadora de canje precarga la de hoy.
