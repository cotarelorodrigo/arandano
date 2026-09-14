# Spec: corregir cómo se pagó una venta

**Fecha**: 2026-09-14

**Origen**: pedido del dueño del producto — *"tenemos que agregar la
funcionalidad para poder editar/modificar una venta. si un empleado realizo una
venta pero se confundio en el metodo de pago entonces deberia poder
modificarlo. lo mismo con el monto por ejemplo. el dueño puede decidir sacarle
el permiso de editar venta al empleado"*.

Hoy, lo único que le puede pasar a una venta después del cobro es anularse o
que alguien le escriba el detalle. Si quien atendió marcó "Efectivo" donde era
"Transferencia", el único camino es anular y volver a cargarla entera: se quema
un número de venta, quedan dos filas en el listado, se generan movimientos de
stock compensatorios por un error que nunca tocó el stock, y el reporte del día
muestra una venta anulada que no lo está.

## El alcance, y por qué se corta ahí

**Se corrige cómo se pagó, nunca qué se vendió.** Medio de pago, moneda, plan,
cotización, y cómo se reparte la plata entre los pagos — incluido agregar o
quitar un pago, que es el caso *"cobré todo en efectivo y en realidad fue mitad
y mitad"*. La mercadería no se toca.

Ese corte no es prolijidad: es lo que hace que el ciclo sea seguro. Una venta
guardada tiene un invariante que `crearVenta` valida y que **ninguna escritura
posterior rompió nunca** — los pagos cierran exactamente contra los dos totales
de la mercadería, en pesos y en dólares, con el recargo del plan por afuera.
Mientras los ítems queden intactos, esos dos totales no se mueven, así que la
corrección se valida con **exactamente la misma regla que ya corre al cobrar**,
contra los mismos números.

Se evaluó y se descartó el alcance completo (editar también los ítems):
arrastra stock, unidades con IMEI, el costo congelado de cada ítem y el margen
del período, y es rehacer la venta con compensaciones como las de anular. Y se
descartó el rodeo (*"Corregir" anula la original y abre `/vender` precargado,
dejando las dos ligadas*): no toca el motor, pero quema un número por cada
corrección y deja dos filas donde hubo una venta.

**Sin ventana de tiempo.** Cualquier venta, de cualquier fecha. El único
control es el permiso, igual que con anular, que tampoco tiene ventana. El
costo aceptado, dicho explícito: corregir una venta de hace tres meses
**reescribe el reporte de ese mes** — "Cómo entró la plata" y los totales del
período leen los pagos, así que van a decir otra cosa que ayer. Se descartó
"sólo el mismo día", que deja sin salida el error que se descubre a la mañana
siguiente, que es cuando se descubren casi todos; y se descartó atarlo al turno
de caja, porque `crearVenta` ni siquiera exige caja abierta para cobrar y atar
la corrección a algo que el cobro no exige dejaría sin corregir a todo local
que no use la caja.

## El permiso: `VENTAS_EDITAR`, el décimo del catálogo

Aparte de `VENTAS_ANULAR` y no plegado sobre él. La regla de este repo es
delegar **por lo que la acción mueve**, y son dos cosas distintas: anular da de
baja la venta entera y devuelve el stock —todo el mundo ve que desapareció—;
editar la deja en pie diciendo que la plata entró de otra forma, que es más
silencioso. Un dueño puede querer que quien atiende corrija su propio error de
medio de pago sin poder borrar ventas del período, y también lo contrario.

Es el mismo escalón que ya separa `ARTICULOS_BORRAR` de `ARTICULOS_EDITAR` y
`PLANES_PAGO` de `ARTICULOS_EDITAR`. La fuente sigue siendo
`lib/permisos/catalogo.ts`, atada al enum del schema en las dos direcciones por
`test/permisos-catalogo.test.ts`; el número "diez" de este párrafo es de hoy y
no es la fuente.

## Lo que se guarda

Dos tablas nuevas, las dos **append-only de verdad** —`REVOKE UPDATE, DELETE`
en `scripts/setup-db-roles.sh`, como `movimientos_stock`, `eventos_orden` y
`mensajes_bot`—, no append-only por comentario.

### `EdicionDeVenta` → `ediciones_venta`

Quién corrigió, cuándo, sobre qué venta, y una `nota` opcional (el motivo, si
lo quieren escribir). Misma forma y mismos campos que `EventoOrden`, que es la
bitácora que este repo ya tiene: `tenantId`, `ventaId`, `usuarioId`, `nota
String?`, `creadoEn`, con `@@index([tenantId, ventaId, creadoEn])`.

La nota es **opcional y no requerida**: un motivo obligatorio es fricción sobre
una corrección que suele ser evidente ("puse efectivo y era transferencia"), y
un campo obligatorio que nadie quiere llenar se llena con un punto. `EventoOrden.nota`
ya sentó ese precedente.

### `PagoArchivado` → `pagos_archivados`

**Las filas de pago tal como estaban ANTES de esa edición**, con sus columnas
`Decimal` reales: `medio`, `moneda`, `cubre`, `monto`, `cotizacion`,
`planDePagoId`, `recargo`, más el `creadoEn` original del pago (renombrado
`pagadoEn` para que no se confunda con el `creadoEn` de la fila de archivo).
`edicionId` la ata a la edición que la reemplazó.

**El "después" no se guarda en ningún lado, y eso es la decisión.** Es `pagos`
tal como está hoy, o el "antes" de la edición siguiente. Guardar los dos lados
sería un segundo registro del mismo hecho, con el modo de falla que este repo
ya nombró al decidir que `VentaItem` no lleva `unidadId`: que un día digan
cosas distintas. La cadena es exacta y no tiene redundancia que se pueda
desincronizar.

**Se archiva la fila en vez de serializarla a JSON**, y no es indiferente: el
schema no tiene hoy ni una columna `Json`, y la primera no va a ser una que
guarde importes — Prisma serializa un `Decimal` a string, así que un snapshot
en JSON convierte la plata en texto y pierde la escala exacta que
`Decimal(12,2)` garantiza. Con tabla propia, un peso archivado es el mismo tipo
que un peso vivo.

**`pagos` NO se convierte en tabla-libro**, y conviene decirlo porque es la
alternativa que parece más pura. Marcar las filas viejas con un
`reemplazadoEn` y filtrarlas en toda lectura repartiría la responsabilidad
entre todos los lectores de pagos que hoy existen —`lib/ventas/composicion.ts`,
`lib/ventas/cobrado.ts`, `lib/ventas/medios.ts`, el detalle de `/ventas/[id]` y
el panel del período, sin contarlos acá porque un número a mano en este
párrafo es un número que queda viejo—, y el que se olvide de filtrar muestra
plata contada dos veces, sin error y sin que nada avise. Es el modo de falla que este repo ya
pagó con las dos copias de un botón, multiplicado por cinco. Archivar a otra
tabla da la misma trazabilidad sin tocar a ningún lector.

### `Pago.porcentaje Decimal(6,3)?` — la columna que hace falta para no corromper lo viejo

`Pago` congela hoy el `recargo` —cuántos pesos fueron recargo— pero **no el
porcentaje** que lo produjo: ése se lee vivo de `PlanDePago.recargoPorcentaje`
al cobrar. Mientras la única escritura sobre una venta cerrada fuera anularla,
eso alcanzaba. Con corrección de pagos deja de alcanzar, y el modo de falla es
silencioso:

> Una venta de marzo se cobró con "Crédito 12 cuotas, 40 %" y un pago en
> efectivo. En julio el dueño subió ese plan a 45 % —en este país los recargos
> de cuotas se mueven todos los meses—. En agosto alguien corrige el **medio
> del pago en efectivo**. Como la corrección revalida el juego entero, el pago
> con plan se vuelve a resolver contra `PlanDePago`, y su recargo pasa a ser el
> 45 % de hoy. **Nadie pidió eso**, y la venta de marzo queda diciendo que
> cobró algo que nunca cobró.

Eso contradice de frente la doctrina que el propio schema ya escribe al lado de
`Pago.recargo`: *"un plan editado o dado de baja no puede cambiar lo que una
venta vieja dice que cobró"*.

**Y no se puede derivar.** `Pago` guarda `monto` (base más recargo) y
`recargo`, así que el porcentaje saldría de `recargo / (monto − recargo) × 100`
— una **división**, que es exactamente lo que el ciclo del precio en dólares
prohibió en este motor porque produce números que no cierran por un centavo.

**La regla de la corrección**, en tres líneas:

- Un plan que **la venta ya tenía** entra con el porcentaje que esa venta
  congeló, no con el de hoy.
- Un plan que **no estaba** en la venta entra con el porcentaje de hoy: es un
  cobro nuevo, y no hay nada viejo que respetar.
- Sin plan no hay porcentaje ni recargo.

No hace falta identidad por fila de pago para aplicarla: dentro de una misma
venta, un plan tiene un solo porcentaje, así que alcanza con mirar qué
porcentaje tenía la venta para ese plan.

**Nullable y sin backfill.** Las filas anteriores a este deploy tienen
`recargo` pero no porcentaje, y `NULL` dice exactamente eso: no se guardó. Para
esas, la corrección cae al porcentaje de hoy **y el diálogo lo dice** en vez de
hacerlo en silencio. Es un caso acotado que desaparece solo con el tiempo, y
hoy es aún más chico: no hay tenants reales, así que las únicas filas afectadas
son de dev y del canario. Un backfill por división compraría poco y pagaría el
precio que esta misma sección acaba de rechazar.

`crearVenta` pasa a escribirla, al lado del `recargo` que ya escribe.

## Por qué la migración viaja en el mismo deploy que la UI

Es aditiva e inerte: dos tablas nuevas, una columna nullable en `pagos`, un
valor más en el enum `Permiso`, cero `DROP` y cero renombres. El código
anterior no lee las tablas nuevas ni la columna nueva, y no borra ni actualiza
pagos por ningún camino, así que la imagen vieja lee cualquier fila que la
migración pueda producir sin enterarse de que existen.

`Pago.porcentaje` es el único punto que merece el chequeo explícito, porque es
la columna que la imagen vieja sí toca: `crearVenta` de la versión anterior
inserta pagos **sin** ese campo, y al ser nullable esa fila es válida —queda en
`NULL`, que es exactamente lo que el párrafo de arriba define como "no se
guardó"—. O sea que el rollback automático del healthcheck no deja ninguna fila
inválida atrás.

Lo que expand/contract exige no es "la migración en un deploy aparte", es que
**el schema nuevo soporte la versión anterior del código**. Mismo argumento ya
escrito para el precio en dólares, el borrado de artículos y el detalle de
venta.

## El motor

### Primero, un refactor que es condición y no adorno

El bloque que valida pagos dentro de `crearVenta` —base mayor que cero,
cotización mayor que cero, escalas, normalización de `cubre`, resolución del
plan contra la transacción, `PLAN_NO_CORRESPONDE`, `PLAN_EN_DOLARES`, el
recargo congelado, el monto entregado, y las dos comparaciones que exigen que
los pagos cierren contra los totales— sale a **`lib/ventas/pagos.ts`**, y
`crearVenta` pasa a llamarlo.

Tres funciones, en el orden en que se usan:

- `normalizarPagos(pagos)` — aplica `cubre ?? 'ARS'` una sola vez y valida los
  invariantes de dominio de cada fila. No toca la base.
- `resolverPagosConRecargo(tx, pagosNormalizados, porcentajesPrevios?)` —
  resuelve los planes contra el cliente transaccional (RLS filtra por tenant,
  así que el plan de otro local cae en `PLAN_INEXISTENTE` igual que uno
  inventado), congela el porcentaje y el recargo, y calcula el monto entregado.
  El tercer parámetro es el mapa `planId → porcentaje` que la venta ya tenía:
  `crearVenta` no lo pasa —una venta nueva no tiene nada viejo que respetar— y
  `reemplazarPagos` sí. Es el único punto donde las dos difieren, y por eso va
  como parámetro explícito y no como una rama adentro de la función.
- `exigirQueCierren(pagosConRecargo, totales)` — las dos comparaciones, una por
  moneda, contra las **bases** y no contra los montos.

**Sin ningún cambio de comportamiento**, con una sola excepción deliberada:
`crearVenta` pasa a escribir `Pago.porcentaje`, que es aditivo y no cambia
ninguna cuenta. Fuera de eso, los tests que ya existen sobre `crearVenta` son
la red de que el refactor no movió nada, y ningún caso nuevo describe una regla
nueva en este paso.

Si esto no se hace, quedan **dos implementaciones de la misma regla de plata**,
que es el defecto exacto que este repo ya pagó dos veces —el selector de
categoría desincronizado durante cuatro días con el gate en verde, y las dos
copias de "Anular orden" que el merge del ciclo móvil dejó apuntando a
permisos distintos—. Acá el modo de falla no es un botón de más: es una venta
guardada que dice haber cobrado algo que no cierra.

### `reemplazarPagos`, en `lib/ventas/editar.ts`

```
reemplazarPagos({ tenantId, ventaId, usuarioId, pagos, nota })
```

Dentro de `enTransaccionDeTenant`, en este orden:

1. **Toma el lock de la fila de la venta** (`SELECT id, total, total_usd,
   anulada_en FROM ventas WHERE id = … FOR UPDATE`) antes de leer nada más. Es
   el mismo recurso que `proximoNumero` usa para serializar las ventas de un
   tenant, y existe por el mismo motivo por el que `anularVenta` mete su
   condición **dentro** del `UPDATE`: bajo READ COMMITTED —el nivel por
   defecto, que `enTransaccionDeTenant` no cambia— dos correcciones
   simultáneas leen las dos el mismo estado anterior, archivan las dos la misma
   foto y la segunda pisa a la primera. La plata queda bien (el último juego de
   pagos es uno solo y cierra), pero **la bitácora miente**: dice que se pasó
   de A a C y de A a C, cuando se pasó de A a B y de B a C. Una bitácora que
   miente es peor que no tenerla.
2. Si la venta no existe en este tenant: `VENTA_INEXISTENTE`.
3. Si está anulada: **`VENTA_ANULADA`**, un código nuevo. Una venta anulada no
   se edita: sus pagos ya no cuentan en ningún reporte —toda consulta del
   período filtra `anuladaEn: null`—, así que no hay plata que corregir, y
   cambiar cómo entró algo que no entró es reescribir el pasado sin efecto.
   Es la decisión **inversa** a la de `guardarDetalle`, que sí funciona sobre
   una venta anulada, y por exactamente la misma razón que allá era sí: aquello
   no era plata y esto sí. Una venta anulada es justamente sobre la que alguien
   quiere dejar escrito qué pasó, y para eso está el detalle.
4. `exigirUsuario(tx, usuarioId)` **antes** de escribir la FK, como hace
   `anularVenta` y por lo mismo: las FK de Postgres no distinguen tenants (ver
   `lib/ventas/pertenencia.ts`).
5. Valida y resuelve el juego nuevo con las tres funciones de `pagos.ts`
   —pasándole los porcentajes que la venta ya tenía, ver `Pago.porcentaje` más
   arriba—, y
   **exige que cierre contra `venta.total` y `venta.totalUsd` ya guardados**.
   No los recalcula desde los ítems: la mercadería no se toca, y recalcularla
   abriría la puerta a que una corrección de pagos mueva el total sin que nadie
   lo haya pedido —si un artículo cambió de precio desde la venta, el total
   recalculado daría distinto del cobrado.
6. Copia los pagos vivos a `pagos_archivados` contra una `EdicionDeVenta`
   nueva, los borra, inserta los nuevos.
7. Recalcula el caché `Venta.recargo` como la suma de los recargos del juego
   nuevo. Es el único caché que esta operación puede mover: `total`, `totalUsd`,
   `costoArs` y `vendidoConCosto` describen la mercadería, que no se tocó.

**Nada más se toca**: ni stock, ni `movimientos_stock`, ni unidades con IMEI,
ni el número de venta, ni la clave de idempotencia, ni el cliente, ni el
vendedor, ni la fecha.

**Sin idempotencia por clave**, al revés que el cobro, y es deliberado: una
corrección que llega dos veces deja el mismo juego de pagos —la segunda vuelve
a cerrar contra los mismos totales— y una segunda fila de bitácora con "antes"
igual a "después". Eso es ruido en la bitácora, no plata duplicada. Inventarle
una clave de idempotencia a un formulario que se abre a mano sería resolver un
problema que el cobro tiene (el lector de código de barras, el F5 sobre el
POST) y éste no.

## Las pantallas

### `/ventas/[id]` — corregir

La card **"Cómo se pagó"** ya muestra la tabla de pagos; gana un botón
**"Corregir"** en su encabezado, que abre un `Dialog`.

**No se toca `/vender`.** Ése es el camino de cobrar, y una corrección no es un
cobro: no toma número, no descuenta stock, no tiene vuelto que contar ni
efectivo que recibir.

Adentro del diálogo, una fila por pago con los mismos controles que el panel de
cobro —medio, moneda, `Cubre` (sólo si la venta tiene los dos totales, misma
regla que `seMuestraCubre` ya aplica en esta pantalla), plan (sólo si ese medio
tiene planes cargados), monto y cotización—, con filas que se agregan y se
quitan. Abajo, el chip **"Faltan / Sobran"** en vivo contra los dos totales de
la venta, y el guardar deshabilitado mientras no cierre.

**Ese chip sale de `lib/ventas/centavos.ts`**, el espejo en centavos enteros de
la aritmética del motor que `/vender` ya usa. Es el reuso que importa: con la
misma aritmética, el mismo redondeo y el mismo momento de redondear, el
diálogo **no puede** decir que cierra mientras el servidor dice que no.

**La deuda que este ciclo acepta, dicha explícito.** El JSX de estas filas se
va a parecer al del panel de cobro, y **no** se extrae de
`app/(app)/vender/punto-de-venta.tsx`: son 3.379 líneas de la pantalla más
delicada del producto —vuelto, atajos de teclado con allow-list de foco, pie
fijo del teléfono, el paso de cobro sincronizado con `pushState`— y
refactorizarla dentro de este ciclo es riesgo sin contrapartida.

La diferencia con el caso del selector de categoría, que es lo que hace que
esto sea deuda tolerable y no el mismo error: **allá lo duplicado era la
regla** —una pantalla parseaba el separador `·` y la otra no, y se
desincronizaron en silencio—, y acá la regla vive una sola vez, en
`centavos.ts` del lado del navegador y en `pagos.ts` del lado del servidor. Lo
duplicado es la disposición. **El disparador para extraerlo**: que aparezca una
tercera copia.

### `/ventas/[id]` — la bitácora

Una card **"Correcciones"**, entre Detalles y la Zona de riesgo, con el mismo
tratamiento de línea de tiempo que la bitácora de una orden de trabajo: quién,
cuándo, la nota si la hay, y cómo estaban los pagos antes.

**Sólo se dibuja si hubo alguna corrección.** Es distinto de Detalles, que se
dibuja vacía a propósito porque es el lugar donde el dato se carga; acá no hay
nada que cargar, así que un local que nunca corrigió una venta no ve nada
nuevo. Sigue rigiendo el principio de siempre: quien no usa esto no ve ninguna
diferencia.

### El teléfono

Cinco controles por fila no entran en 390 px: la fila se apila, como ya hace el
panel de cobro. Y el botón "Corregir" tiene que existir en los dos anchos —es
la regla que el ciclo móvil aplicó cinco veces: una capacidad que desaparece
del teléfono y no reaparece en ningún lado es un defecto, no una
simplificación.

### El permiso, en las DOS puertas

El botón y la server action. Una action se invoca sin pasar por ningún
componente, y esto mueve plata. Es la misma lección que el merge del ciclo
móvil dejó escrita, y el caso cuenta en las **dos** direcciones: con el permiso
el botón está, sin el permiso no está — un `not.toContain` solo pasaría igual
si la guarda quedara en una sola copia.

## Lo que este ciclo NO hace

- **Los ítems.** Ver *El alcance*. Cambiar qué se vendió es otro ciclo, y el
  que tenga que resolver las compensaciones de stock.
- **El cliente, la fecha, el vendedor y el número de venta.**
- **Editar una venta anulada.**
- **Deshacer una corrección.** Se corrige de nuevo, y la bitácora tiene las
  dos. Un "deshacer" sería un tercer camino de escritura sobre los pagos para
  llegar a un estado que el que ya existe alcanza.
- **Nada en `/ventas`.** El listado no dice que una venta fue corregida: hay
  que abrirla para enterarse. **El disparador para reconsiderarlo**: que a un
  dueño le moleste no poder ver de un vistazo qué ventas del período se
  tocaron.
- **Ningún aviso a nadie.** Corregir no notifica al dueño. Cuando exista algo
  que notifique —hoy no hay nada—, ésta es candidata.

## Tests

Del motor, contra base real:

- Cierra en pesos, cierra en dólares, cierra en los dos; y no cierra en cada
  una de las tres combinaciones, con su `PAGOS_NO_CIERRAN`.
- **El porcentaje del plan que la venta ya tenía sobrevive a la corrección**,
  aunque el plan haya cambiado desde entonces: se corrige el medio de un pago
  de una venta vieja, el plan pasó de 40 % a 45 % en el medio, y el recargo del
  otro pago sigue siendo el 40 % con el que se cobró. Es el caso que justifica
  `Pago.porcentaje`, y el que más fácil se rompe en un refactor futuro.
- Un plan que **no** estaba en la venta entra con el porcentaje de hoy.
- Un pago con `porcentaje` NULL (cobrado antes de este ciclo) cae al porcentaje
  de hoy, y el diálogo lo dice.
- `PLAN_EN_DOLARES` sobre un pago entregado en dólares.
- `VENTA_ANULADA`, `VENTA_INEXISTENTE`, y la venta de otro tenant (que da
  `VENTA_INEXISTENTE`, no un error distinto que filtre qué ids existen).
- El caché `Venta.recargo` queda igual a la suma del juego nuevo.
- La fila archivada conserva los `Decimal` con su escala, y el `pagadoEn`
  original.
- Dos correcciones seguidas encadenan: el "antes" de la segunda es el juego que
  dejó la primera.

Del refactor: los tests que ya existen sobre `crearVenta`, sin tocar.

Del resto:

- `test/setup-db-roles.test.ts`: `arandano_app` no puede hacer `UPDATE` ni
  `DELETE` sobre `ediciones_venta` ni sobre `pagos_archivados`.
- `test/permisos-catalogo.test.ts` ya ata el catálogo al enum en las dos
  direcciones; `VENTAS_EDITAR` entra solo.
- El permiso en las dos copias (botón y action).
- `docs/pantallas.md`, sección `/ventas/[id]`, en el mismo commit que la
  pantalla — `test/pantallas.test.ts` ata la existencia de la sección, no su
  contenido.

## Verificación manual

Se puede hacer después del merge: `arandano-dev` bind-montea `/root/arandano`,
que sirve `main`.

- Cobrar una venta en efectivo, corregirla a transferencia, y ver que el panel
  "Cómo entró la plata" de `/ventas` cambia de barra.
- Partir un pago único en dos (mitad efectivo, mitad transferencia) y ver que
  el chip sólo deja guardar cuando cierra.
- Corregir una venta con los dos totales, moviendo qué pago cubre cuál.
- **El riesgo de plata de este ciclo**: que el chip de faltante diga lo mismo
  que el servidor con un plan de **efectivo en descuento** (porcentaje
  negativo). Es exactamente donde este repo ya tuvo un bug de plata —el chip de
  vuelto de `/vender` restaba la base y no lo que hay que cobrar por esa fila—,
  y ningún test de aritmética lo contesta del lado de la pantalla.
- Cobrar con un plan, cambiarle el porcentaje al plan desde `/formas-de-pago`,
  volver a esa venta y corregir el **otro** pago: el recargo del pago con plan
  tiene que quedar igual que antes.
- **El riesgo de presentación**: el diálogo con tres filas de pago a 390 px.
- Que un empleado con `VENTAS_ANULAR` y sin `VENTAS_EDITAR` vea "Anular" y no
  vea "Corregir".

## La maqueta

`design/arandano.pen` no dibuja ni el botón "Corregir", ni el diálogo, ni la
card "Correcciones", en ningún ancho. Se derivan de patrones que ya existen: el
`Dialog` de `/usuarios` y `/formas-de-pago`, las filas de pago del panel de
cobro, y la línea de tiempo de la bitácora de una orden de trabajo. Queda
anotado en `docs/correcciones-pendientes-del-pen.md`.
