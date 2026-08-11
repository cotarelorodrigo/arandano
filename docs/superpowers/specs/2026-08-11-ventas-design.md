# Spec: UI de ventas

Fecha: 2026-08-11

El punto de venta y lo que hace falta para que sirva de verdad: cobrar, ver lo
que se cobró y poder deshacerlo.

Es la pieza 5 de la tabla que dejó el spec del motor
(`docs/superpowers/specs/2026-08-09-motor-ventas-stock-design.md`). La 4 —la UI
de inventario— se cerró el 2026-08-11 y está en producción desde `v1.4.0`.

## Alcance

Entra el ciclo entero de una venta: cobrarla, encontrarla y anularla. Sin eso
último la pantalla no se puede usar en serio — un error de tipeo en el mostrador
no tendría salida.

**La caja —apertura, cierre y arqueo— es la pieza 6 y queda afuera**, aunque se
apoye en los pagos que este ciclo empieza a generar. **ARCA es la 7.**

## Estado del que se parte

Verificado sobre el repo:

- **El motor está entero y probado**: `crearVenta` (ítems, pagos partidos,
  cliente opcional, correlativo por tenant), `anularVenta` (idempotente, con
  movimientos compensatorios), la aritmética de plata en `totales.ts`, y
  `enTransaccionDeTenant` abajo de todo.
- **Inventario está en producción**: `lib/inventario/` y las tres pantallas.
  De ahí salen dos cosas que este ciclo reusa tal cual: `lib/formato/numeros.ts`
  para leer lo que una persona tipea, y `lib/formato/mostrar.ts` para mostrar
  plata, cantidades y fechas.
- **No existe nada de clientes**: ni `lib/clientes/` ni pantalla. `Venta.clienteId`
  es opcional y hoy siempre queda nulo.
- **La navegación** vive en `components/navegacion.tsx`, compartida por el layout
  de `(app)` y por la home.

## Decisiones

### La idempotencia entra ahora, y por la misma razón que el costo entró en el ciclo anterior

CLAUDE.md lo tiene anotado desde el review del motor:

> `crearVenta` **no es idempotente**: un doble submit crea dos ventas y descuenta
> el stock dos veces. […] la UI va a necesitar una clave de idempotencia, y el
> lugar barato para ponerla es un `@@unique([tenantId, claveIdempotencia])` sobre
> `ventas` — migración aditiva, y conviene decidirla antes de que haya ventas
> cargadas.

Hasta hoy era teórico: el motor sólo se llamaba desde tests. Con un botón de
cobrar en un mostrador deja de serlo, y **hoy hay cero ventas cargadas en
producción** — la migración nunca va a ser más barata que ahora.

```prisma
claveIdempotencia String? @map("clave_idempotencia")

@@unique([tenantId, claveIdempotencia])
```

Nullable a propósito: en Postgres un índice único deja pasar varios `NULL`, así
que una venta creada sin clave —desde un test, desde un script futuro— no choca
contra nada.

**Cómo se usa.** El punto de venta genera un uuid cuando el carrito deja de
estar vacío y lo manda escondido. Si la misma clave llega dos veces, la segunda
choca contra el índice y la action **devuelve la venta que ya existe** en vez de
un error: para el que apretó dos veces, cobró una vez y ve el número de su
venta. Al terminar, el formulario genera una clave nueva.

Cubre las tres formas del problema, y el `disabled` del botón sólo cubre la
primera: el doble click, el F5 sobre el POST, y el reintento de red.

**El manejo del choque va AFUERA de la transacción.** Una violación de unicidad
**aborta la transacción** en Postgres: después del error ninguna sentencia más
funciona sobre esa conexión, así que buscar la venta existente adentro del mismo
callback falla con `current transaction is aborted`. Es exactamente el bug que
tuvo el contador de SKU en el ciclo de inventario —ver los ajustes de la Task 4
de `docs/superpowers/plans/2026-08-11-inventario.md`— y queda escrito acá para
no volver a descubrirlo con logs.

**Y la búsqueda posterior no tiene carrera, aunque lo parezca.** Si dos
transacciones mandan la misma clave a la vez, la segunda no falla enseguida:
queda esperando en el índice único hasta que la primera comitea o rollbackea.
Si comitea, la segunda recibe el `P2002` **con la fila del otro ya visible**, y
la busca sin encontrarse un hueco; si rollbackea, la segunda inserta y no hay
choque. O sea que el camino "chocó pero no encuentro la venta" no existe, y por
eso **no hace falta un código de error para la clave repetida**: una clave
repetida no es una falla, es la respuesta correcta llegando dos veces.

### Un artículo desactivado no se puede vender, y se dice distinto

El spec de inventario dejó este requisito escrito para este ciclo, para que no
dependiera de que alguien se acordara:

> el buscador de artículos de esa pantalla tiene que filtrar `desactivadoEn:
> null`, y `crearVenta` tiene que rechazar un artículo desactivado. Hoy no lo
> hace —resuelve por `{ id: { in: … } }` sin filtro—.

Entran las dos mitades. El buscador filtra, y `crearVenta` suma `desactivadoEn:
null` a su `findMany`.

**Con código propio, `ARTICULO_DESACTIVADO`, y no reusando
`ARTICULO_INEXISTENTE`.** Son dos situaciones distintas para el que está
cobrando: "ese artículo no existe" se resuelve buscando de nuevo, "ese artículo
está desactivado" se resuelve reactivándolo desde inventario. Un mensaje que no
las distinga manda a la persona al lugar equivocado.

### Quién puede anular: sólo el dueño

Ver el listado y el detalle, y **cobrar**, lo puede hacer cualquiera con sesión.
**Anular, sólo el dueño.**

Anular es la vía clásica para quedarse con el efectivo de una venta real, y
firmarla —`Venta.anuladaPorId` existe— deja el rastro pero no lo impide. En un
local chico el dueño suele estar.

Y el orden importa más que el criterio: aflojar un permiso después es trivial,
apretarlo cuando los empleados ya se acostumbraron es una pelea.

Es una decisión distinta a la que tomó inventario para el stock —ahí cualquiera
mueve stock y la trazabilidad es la firma— y la diferencia es deliberada: un
movimiento de stock mal hecho se corrige contando de nuevo, una venta anulada se
lleva plata.

### La cotización la escribe el vendedor, con la última como default

`Pago` guarda `cotizacion`: los ARS que valía una unidad de esa moneda **en ese
momento**. El campo existe para poder cerrar la caja en las dos monedas sin
reconstruir a qué valor se tomó cada dólar.

El campo aparece **sólo** si la moneda del pago es USD, y viene precargado con
la cotización del último pago en dólares de ese local — una consulta
(`ORDER BY creadoEn DESC LIMIT 1`), sin columna nueva ni pantalla de
configuración. El que cobra la confirma o la pisa.

Cada local tiene su propia cotización y cambia todos los días: el sistema no
puede saberla mejor que él. Una "cotización del día" por tenant se evaluó y se
descartó para este ciclo — suma columna, pantalla, y el problema de qué pasa
cuando nadie la actualizó.

### El punto de venta necesita JavaScript, y es la primera pantalla que lo necesita

Todo lo construido hasta ahora funciona sin JavaScript: formularios con server
actions, buscadores con `method="get"`. **El punto de venta no.**

No es pereza: un carrito es estado que se arma en varios pasos antes de
escribirse, y sostenerlo sin JavaScript exige persistirlo en el servidor — una
tabla de borradores, con su ciclo de vida y sus borradores abandonados. El spec
del motor ya dejó "carrito persistente" y "reserva de stock" fuera de alcance, y
este spec no los mete.

Lo que **sí** es requisito es que se opere **sin mouse**: el foco arranca en el
buscador, Enter agrega, y desde ahí se llega a cobrar con teclado. Es
literalmente la razón por la que CLAUDE.md eligió Radix — *"lo que más cuesta
hacer bien en una pantalla de venta que se opera sin mouse"*.

## Arquitectura

### Rutas

| Ruta | Qué | Quién |
|---|---|---|
| `/vender` | El punto de venta | Cualquiera con sesión |
| `/ventas` | Listado, hoy por defecto, con filtro de fechas | Cualquiera con sesión |
| `/ventas/[id]` | Detalle, y el botón de anular | Ver: todos. Anular: sólo dueño |

`/vender` y no `/ventas/nueva`: es la pantalla más usada del sistema, y un verbo
corto se tipea más rápido que una ruta anidada.

### Archivos

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` *(modificado)* | `claveIdempotencia` y su `@@unique` |
| `prisma/migrations/<ts>_idempotencia_venta/migration.sql` *(nuevo)* | La migración. Sin RLS nuevo: no hay tablas nuevas |
| `lib/ventas/errores.ts` *(modificado)* | `ARTICULO_DESACTIVADO`. Y nada para la clave repetida: no es un error, ver más arriba |
| `lib/ventas/crear.ts` *(modificado)* | La clave, el filtro de desactivados, y el reintento afuera de la transacción |
| `lib/ventas/buscar.ts` *(nuevo)* | Buscar artículos vendibles y leer la última cotización. Consultas de lectura, separadas del motor que escribe |
| `app/(app)/vender/page.tsx` *(nuevo)* | El punto de venta |
| `app/(app)/vender/acciones.ts` *(nuevo)* | `cobrar` y `buscarArticulos` |
| `app/(app)/vender/punto-de-venta.tsx` *(nuevo)* | El componente cliente: carrito, pagos, teclado |
| `app/(app)/ventas/page.tsx` *(nuevo)* | El listado |
| `app/(app)/ventas/[id]/page.tsx` *(nuevo)* | El detalle |
| `app/(app)/ventas/acciones.ts` *(nuevo)* | `anular` |
| `app/(app)/ventas/formularios.tsx` *(nuevo)* | El botón de anular en dos pasos |
| `components/navegacion.tsx` *(modificado)* | `Vender · Ventas · Inventario · Usuarios` |
| `app/(app)/layout.tsx` *(modificado)* | El nombre del local pasa a enlazar a `/` |
| `scripts/lib/rutas-comun.sh` *(modificado)* | La segunda entrada de `RUTAS_SIN_SMOKE` |

`lib/ventas/buscar.ts` aparte de `crear.ts` porque son cosas distintas: uno
escribe adentro de una transacción y tiene que ser conservador con las
conexiones del pool; el otro son dos lecturas que alimentan una pantalla.

## Las pantallas

### `/vender` — el punto de venta

Dos columnas en pantalla grande, apiladas en chica: a la izquierda buscar y el
carrito, a la derecha el total, los pagos y el botón.

**El buscador** arranca con el foco puesto. Busca por nombre o código filtrando
`desactivadoEn: null`, y muestra el stock de cada resultado — con la misma regla
que el listado de inventario: un servicio muestra `—` y nunca `0`, porque el
motor no le descuenta stock y un cero ahí se leería como faltante. Enter agrega
el primero.

Y una regla que hace funcionar el lector de código de barras sin escribir nada
específico para él: **si lo tipeado coincide exacto con un código, se agrega ese
artículo y se limpia el buscador**. Un lector tipea el código y manda Enter, que
es exactamente eso.

**El carrito** deja editar la cantidad, con el mismo parser que ya acepta coma
decimal. Agregar dos veces el mismo artículo incrementa la línea en vez de
duplicarla.

Si una línea deja el stock en negativo **se advierte y no se bloquea**: el motor
permite vender sin stock a propósito, y la pantalla no puede ser más estricta
que el motor sin volverse mentirosa — el que atiende sabe si la mercadería está
ahí y todavía no se cargó.

**Los pagos** arrancan resueltos para el caso del 90%: una fila con efectivo, en
pesos, por el total exacto. "Agregar pago" parte el cobro. La cotización aparece
sólo si la moneda es USD.

Debajo, "Faltan $X" o "Sobran $X". **El botón se habilita sólo cuando cierra
exacto**: `crearVenta` lo exige, y avisarlo antes es mejor que devolver el error
después.

**El vuelto** es lo más usado de un mostrador y el motor no puede modelarlo: un
pago en efectivo lleva un campo opcional *"con cuánto paga"* que **no se
persiste** y sólo calcula el vuelto en pantalla. El pago que se guarda es el
total, porque eso es lo que entró a la caja; los 5000 que el cliente apoyó sobre
el mostrador no son un dato de la venta.

Al cobrar: se limpia el carrito, aparece "Venta #123 cobrada" con enlace al
detalle, y se genera una clave de idempotencia nueva.

### `/ventas` — el listado

Las de hoy por defecto, con filtro de fechas por query param y `method="get"`,
así que una URL con un rango se puede compartir. Paginación como en inventario.

Columnas: número, hora, total, quién vendió, estado.

**Las anuladas se muestran, no se esconden** — el historial tiene que poder
responder qué pasó. Y **el total del período suma sólo las que no lo están**,
dicho en pantalla para que nadie tenga que deducirlo de la aritmética.

### `/ventas/[id]` — el detalle

- **Cabecera**: número, fecha, quién vendió, total.
- **Si está anulada**: un `Alert` con quién la anuló y cuándo.
- **Ítems**: descripción, cantidad, precio unitario y subtotal — los
  **congelados**, lo que se cobró ese día y no lo que el artículo vale hoy. Es
  para lo que `VentaItem` guarda copia.
- **Pagos**: medio, moneda, monto, y para un pago en dólares la cotización y su
  equivalente en pesos.
- **Anular** (sólo dueño), con confirmación en dos pasos sobre el mismo botón:
  se convierte en "¿Seguro? / Sí, anular / Cancelar". Sin dependencia nueva.

Un id malformado da `notFound()`, igual que uno de otro tenant — la misma regla
que el detalle de artículo, y por la misma razón: distinguirlos filtraría qué
ids existen.

### Navegación

Pasa a `Vender · Ventas · Inventario · Usuarios`, y el **nombre del local en el
header pasa a ser el enlace a `/`**. Eso libera el slot de "Inicio" sin perder la
vuelta a la home, que es lo que se espera de un nombre en una barra superior.

El `data-testid="tenant-nombre"` **no se toca**: `scripts/smoke.sh` lo busca en
cada pantalla autenticada para distinguir una página de verdad de un 200 vacío.

## Verificación

- **`test/ventas.test.ts`** suma al motor: la misma clave de idempotencia dos
  veces crea **una** venta y descuenta el stock **una** vez —el caso central, y
  tiene que ejercitar las dos llamadas de verdad—, y un artículo desactivado se
  rechaza con `ARTICULO_DESACTIVADO`.
- **La invariante**, ahora atravesando el ciclo completo: después de cobrar y
  anular, el stock del artículo vuelve a ser la suma de sus movimientos.
- **`app/(app)/vender/acciones.test.ts`** y el equivalente de anular: cobrar lo
  puede un empleado con sesión real; anular lo rechaza para ese mismo empleado y
  lo acepta para un dueño.
- **`RUTAS_SIN_SMOKE['/ventas/[id]']`**, la segunda entrada de esa lista.
  `/vender` y `/ventas` entran solas al barrido, que se deriva del sistema de
  archivos.

## Fuera de alcance

Explícito, para que no se lea como olvido:

- **La caja**: apertura, cierre y arqueo en pesos y dólares. Es la pieza 6.
- **ARCA.** `Venta.numero` sigue siendo el correlativo **interno**: el número
  fiscal necesita punto de venta y tipo de comprobante, y eso es la pieza 7.
- **La impresión del comprobante**, que viaja con ARCA por el mismo motivo.
- **Clientes.** La venta de mostrador no los necesita y `clienteId` queda
  siempre nulo. Se vuelven load-bearing con el bot —seguimiento de ventas frías,
  pedido de reseñas—, que es otro ciclo.
- **Devolución parcial.** Se anula la venta entera; devolver uno de tres ítems no
  existe.
- **Descuentos, listas de precios y promociones.**
- **Reserva de stock, presupuestos y cuenta corriente.**
- **Multi-sucursal.** Sigue rigiendo por omisión "un tenant por local".
