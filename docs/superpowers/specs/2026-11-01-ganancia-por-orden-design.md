# Spec: cuánto gané en cada reparación

**Fecha**: 2026-11-01

**Origen**: pedido del dueño del producto, en conversación: *"quiero ver cuánto
gané en cada reparación"*. Es la opción 2 de tres que se le ofrecieron (1:
totales sobre el presupuesto que ya existe; 2: valor y costo por orden; 3: el
ciclo completo de repuestos con stock y cobro por caja).

**Cómo se decidió**: lo marcado **(dueño)** lo dijo el dueño del producto en la
conversación. Lo marcado **(llamada propia)** lo decidió quien escribió este
spec y el dueño lo revisa al leerlo.

## El problema

`OrdenDeTrabajo` tiene un solo número de plata: `montoEstimado`, el presupuesto
en pesos. No hay costo y no hay monto cobrado: una orden entregada no genera
venta ni pasa por caja (`crearVentaDesde` está previsto como punto de extensión
en CLAUDE.md, pero todavía no existe como código). El dueño de un servicio técnico no tiene cómo saber
cuánto le dejó un trabajo.

## Lo que cuenta como éxito

Abrir una orden entregada y leer cuánto se ganó en ella. Abrir el tablero,
filtrar las entregadas de un mes y leer la ganancia de cada una y el total.

## Las decisiones

### 1. El costo es el repuesto comprado para ese equipo, y es un monto en la orden **(dueño)**

El dueño compra el repuesto **para ese equipo**; no sale del stock del local.
Por eso el costo es un monto en pesos guardado en la orden, y **este ciclo no
toca `MovimientoStock` ni el inventario**. La decisión abierta sobre el origen
de `MovimientoStock` (ver `docs/contexto/riesgos-y-decisiones-abiertas.md`)
sigue abierta: la cierra el ciclo de repuestos con stock, que es otro.

Columna nueva, nullable: `costo Decimal? @map("costo") @db.Decimal(12, 2)`.
Null significa "nadie cargó el costo", que no es lo mismo que cero (un trabajo
sin repuesto, por ejemplo una limpieza, tiene costo cero y se carga como cero).
Un solo monto total, no una lista de repuestos **(llamada propia)**: el dueño
habló de "el repuesto"; si aparecen dos, se suman a mano. Partirlo en líneas es
el ciclo de repuestos.

### 2. El valor es lo cobrado, que puede ser distinto del presupuesto **(dueño)**

El dueño dijo que lo cobrado a veces cambia respecto del presupuesto, cuando
aparece otra falla. Por eso no alcanza con `montoEstimado`.

Columna nueva, nullable: `montoCobrado Decimal? @map("monto_cobrado") @db.Decimal(12, 2)`.
`montoEstimado` no se toca y sigue siendo el presupuesto.

**Cuándo se carga (llamada propia):** al mover la orden a `ENTREGADO`. El botón
"Entregado" del paño de estado, en vez de mover directo, abre un paso que
pregunta *"¿Cuánto cobraste?"* con `montoEstimado` precargado (vacío si no hay
presupuesto). Confirmar guarda el monto y hace la transición en la misma
transacción. Ese paso sólo aparece para quien tiene el permiso `COSTOS` (ver
decisión 4); quien no lo tiene mueve a Entregado como hoy, y el cobrado queda
null hasta que alguien con permiso lo cargue desde la card. Después de
entregada, el cobrado se corrige desde la card "Plata".

**Segunda entrega, después de una garantía (llamada propia).** El grafo permite
`ENTREGADO → EN_REPARACION → … → ENTREGADO`. En la segunda entrega el paso de
cobro vuelve a aparecer, pero precargado con el `montoCobrado` actual (no con
`montoEstimado`), y lo que se confirma **reemplaza** al anterior: es "lo que se
cobró en total por este trabajo". Una garantía gratis es confirmar sin tocar
nada. Un repuesto extra comprado para la garantía se suma al `costo` a mano
desde la card. Regla general del precargado: `montoCobrado` si existe, si no
`montoEstimado`, si no vacío.

Se permite dejarlo vacío al entregar **(llamada propia)**: obligarlo frenaría la
entrega en el mostrador por un dato que se puede completar después. Cero es un
valor válido (equipo devuelto sin reparar y sin cobrar la revisión).

### 3. La ganancia se calcula, no se guarda **(llamada propia)**

`ganancia = montoCobrado − costo`. Se calcula al leer. Si falta cualquiera de
los dos, no hay ganancia: la pantalla dice cuál falta en vez de mostrar una
cuenta a medias. Puede ser negativa (se perdió plata) y se muestra negativa.

### 4. Permiso: el `COSTOS` que ya existe **(dueño)**

El dueño quiere que cualquiera del local pueda anotar el costo, y no le molesta
que un empleado vea la ganancia. Eso es exactamente `COSTOS`
(`lib/permisos/catalogo.ts`), que ya es "ver y cargar" en uno: el dueño lo
prende a sus empleados desde `/usuarios`. **No se crea ningún permiso nuevo.**

El dueño sabe y acepta **(dueño)** que prenderle `COSTOS` al técnico para que
anote el repuesto también le muestra el costo de compra y el margen de todo el
inventario: un solo permiso para toda la plata del negocio. El `ayuda` de
`COSTOS` en `lib/permisos/catalogo.ts` se actualiza para que lo diga (hoy habla
sólo de mercadería), por ejemplo: *"Ver el costo de compra y el margen, cargarlos
al recibir mercadería, y ver y cargar el costo y lo cobrado de cada orden de
servicio técnico."*

Quien no tiene `COSTOS` no ve la card "Plata", ni el paso de cobro al entregar,
ni las columnas y el total del tablero. Las acciones de servidor que escriben
costo o cobrado exigen `COSTOS` del lado del servidor (`exigirPermiso`), no
sólo escondiendo el botón. Si la card o el botón tienen copia de escritorio y
de teléfono, la guarda va en las dos (`test/permisos-en-las-dos-copias.test.ts`).

### 5. Cada cambio queda en la bitácora **(llamada propia)**

Cargar o cambiar costo o cobrado escribe un `EventoOrden` con una nota legible
(*"Costo: $ 25.000 → $ 28.000"*), para que "Qué pasó" diga quién lo cambió y
cuándo.

**Esto es una forma de evento nueva, y el código actual asume lo contrario.**
Hoy todo `EventoOrden` es un cambio de estado (lo escriben `cambiarEstado` y la
apertura en `crearOrden`), y el docblock de `anularOrden` rechaza explícitamente
la fila `desde = hasta` como "una fila que el grafo no puede producir". Este
ciclo revierte esa decisión para los eventos de plata, a propósito, y lo
documenta en ese mismo docblock:

- Los eventos de plata llevan `desde = hasta =` estado actual. Como el grafo
  no tiene lazos (ningún estado transiciona a sí mismo), `desde === hasta` es
  la marca inequívoca de "evento de plata", sin columna de tipo nueva. Un test
  fija que `TRANSICIONES` no tiene lazos, para que la marca no se rompa en
  silencio.
- El monto cobrado al entregar **no** va en la nota del evento de transición a
  Entregado: va en un evento de plata aparte, en la misma transacción. Así la
  nota libre del cambio de estado nunca lleva montos.
- `tituloDeEvento` (`app/(app)/servicio-tecnico/[id]/page.tsx`) tiene que
  titular estos eventos como cambio de plata y no como "Pasó a <estado>".
- `diasEnEstado` tiene que ignorarlos: hoy toma el evento más nuevo como el que
  trajo la orden a su estado, y un cambio de costo reiniciaría el contador
  "hace N días".

Ojo con la nota: la bitácora la ve cualquiera que abra la orden. Una nota con
montos expondría el costo a quien no tiene `COSTOS`. **Las notas de estos
eventos se muestran sólo a quien tiene `COSTOS`**; para el resto, el evento se
lee como *"Se actualizó la plata de la orden"* sin montos (o se oculta: lo
decide el builder, mientras no filtre montos).

### 6. Detalle de la orden: card "Plata"

En `/servicio-tecnico/[id]`, debajo de "Falla declarada y diagnóstico". Tres
filas:

- **Costo del repuesto**: editable en cualquier estado mientras la orden no
  esté anulada.
- **Cobrado**: editable una vez que la orden pasó por Entregado (antes no hay
  cobro que anotar); antes de eso se muestra el presupuesto como referencia,
  *"Presupuesto: $ X"*.
- **Ganancia**: calculada, o la frase de qué falta.

Orden anulada: la card se muestra en sólo lectura.

Montos en pesos, con el mismo formato de precio que ya usa la pantalla
(`formatearPrecio` / `montoSinSigno`). Sin dólares en este ciclo **(llamada
propia)**: `montoEstimado` ya es pesos y el dueño no mencionó dólares.

### 7. Tablero: ganancia del mes con el chip "Entregado"

En `/servicio-tecnico`, cuando el filtro es **Entregado** y el usuario tiene
`COSTOS`:

- Aparece un selector de **mes**, con el mes en curso por defecto **(dueño)**.
  El mes va en la URL (`?estado=ENTREGADO&mes=2026-11`) para que se pueda volver
  atrás y compartir el link, igual que el filtro de estado.
- **El mes filtra la lista, para todos (llamada propia).** Con el chip
  Entregado, la lista muestra sólo las órdenes entregadas en ese mes, ordenadas
  por fecha de entrega (la más reciente arriba), tenga o no `COSTOS` quien la
  mira: la misma URL muestra las mismas filas a cualquiera, y `COSTOS` sólo
  agrega las columnas de plata y los totales. Hoy "Entregado" lista todas las
  entregadas de siempre; eso cambia, y es aceptable porque las entregadas viejas
  se siguen encontrando con la búsqueda y cambiando de mes. El conteo del chip
  Entregado sigue el criterio que el builder elija, siempre que no contradiga la
  lista que se ve (lo más simple: que cuente las del mes seleccionado, o las del
  mes en curso fuera de ese filtro).
- **Los totales son del mes entero, no de la página** de 50 (llamada propia).
- El mes se mide por la **fecha de entrega**, no por la de recepción **(llamada
  propia)**: la ganancia se cuenta cuando se cobró. La fecha de entrega es el
  `creadoEn` del **último** `EventoOrden` con `hasta = ENTREGADO`, en hora
  Argentina (UTC-3). Una orden que volvió por garantía
  (`ENTREGADO → EN_REPARACION`) y se volvió a entregar cuenta en el mes de la
  última entrega, una sola vez. Si leerlo de la bitácora sale caro o complica la
  query, el builder puede agregar una columna `entregadaEn` que se escribe en
  la transición; es su llamada.
- Con `COSTOS`, la tabla suma tres columnas: **Cobrado**, **Costo**, **Ganancia**.
- Abajo, una fila de **totales** del mes: suma de cobrado, de costo y de
  ganancia. La ganancia total suma sólo las órdenes que tienen los dos números;
  la fila dice cuántas órdenes quedaron afuera por falta de datos (*"3 órdenes
  sin costo cargado no entran en la ganancia"*).
- Las filas sin costo o sin cobrado se marcan para que se note que les falta el
  dato.
- **Las anuladas no entran** en los totales **(llamada propia)**.
- Una orden que hoy está en `EN_REPARACION` por garantía no aparece en el
  filtro Entregado (porque su estado no es ese) y por lo tanto no entra en el
  total de ningún mes hasta que se vuelva a entregar **(llamada propia)**.

Sin `COSTOS`, el chip Entregado tiene el selector de mes y la lista del mes,
pero sin columnas de plata ni totales.

La búsqueda (que hoy alcanza a todas las órdenes) no muestra columnas de plata
**(llamada propia)**: los totales sólo tienen sentido sobre un mes.

## Lo que NO entra

- Repuestos que descuenten stock, o una lista de repuestos por orden.
- Generar una venta, pasar por caja, emitir factura. El cobro de una orden por
  caja es el ciclo de repuestos y cobro del roadmap.
- Dólares.
- Mano de obra de terceros como costo separado (el dueño dijo que el costo es
  el repuesto).
- Un reporte aparte, gráficos, comparación entre meses.

## Schema y migración

Dos columnas nullable en `ordenes_de_trabajo`: `costo` y `monto_cobrado`
(`Decimal(12,2)`), más `entregada_en` si el builder la elige. Aditiva, sin
backfill: las órdenes existentes quedan sin costo ni cobrado, que es la verdad.
Si se agrega `entregada_en`, el builder decide si la backfillea desde
`eventos_orden` (sería lo correcto para que las entregadas de antes aparezcan
en su mes). RLS: son columnas de una tabla que ya tiene política, no hace falta
nada nuevo. Revisar que `scripts/setup-db-roles.sh` no limite `UPDATE` por
columna sobre esta tabla.

## Validaciones

- Costo y cobrado: no negativos, mismo parseo que `montoEstimado`
  (`aDecimalOpcional`, `ErrorDeFormato`).
- Escribir costo o cobrado en una orden anulada: error de dominio.
- Escribir cobrado en una orden que nunca llegó a Entregado: error de dominio.
- Todo filtrado por tenant como el resto de `lib/ordenes-de-trabajo/`.

## Lo que queda al builder

Nombres de funciones y archivos, la forma exacta del paso de cobro (diálogo o
formulario en el paño), el layout de la card y de las columnas contra el
sistema de diseño (`docs/sistema-de-diseno.md`), cómo se ve en el teléfono, y
si la fecha de entrega sale de la bitácora o de una columna.
