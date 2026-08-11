# Spec: UI de inventario

Fecha: 2026-08-11

Las tres pantallas que ponen el motor de stock al alcance de una persona: cargar
el catálogo, ver cuánto hay de cada cosa, recibir mercadería, corregir un
faltante y entender por qué el número es el que es.

Es la pieza 4 de la tabla que dejó el spec del motor
(`docs/superpowers/specs/2026-08-09-motor-ventas-stock-design.md`). La 5 —la UI
de ventas— es el ciclo siguiente y tiene su propio spec.

## Alcance, y por qué inventario antes que ventas

El spec del motor abrió "inventario y ventas" en siete piezas y dejó la 4 y la 5
como ciclos separados. Este ciclo toma la 4 sola, por dos razones:

- **Es prerrequisito real.** No se puede vender lo que no está cargado. Una
  pantalla de ventas contra un catálogo vacío no se puede ni probar a mano.
- **Es un deploy chico.** CLAUDE.md lo dice sin vueltas: sin feature flags, el
  tamaño del deploy es literalmente el radio de daño. Dos secciones nuevas de la
  aplicación en un solo deploy es exactamente lo que esa decisión desaconseja.

## Estado del que se parte

Verificado sobre el repo:

- **El motor está entero.** `crearVenta`, `anularVenta` y `ajustarStock` en
  `lib/ventas/`, con `enTransaccionDeTenant` abajo, las cinco tablas con RLS y
  `test/ventas.test.ts` probando que el stock cierra contra sus movimientos.
- **La autenticación está entera.** `exigirSesion()` y `exigirDuenio()` en
  `lib/auth/sesion.ts`; el layout de `app/(app)/` aplica el guard a todo lo que
  cuelgue de él, y `test/rutas-con-guard.test.ts` falla si una pantalla queda
  afuera sin declarar por qué.
- **El sistema de diseño está definido** (`docs/sistema-de-diseno.md`), con
  cinco componentes de shadcn en `components/ui/`: `button`, `input`, `label`,
  `card`, `alert`.
- **La única pantalla de la aplicación es `/usuarios`**, y es el patrón que este
  ciclo copia: página de servidor que consulta con `prismaParaTenant`, server
  actions en `acciones.ts` que reexigen el rol, formularios `'use client'` con
  `useActionState`, y lógica de dominio afuera, en `lib/usuarios/`.
- **No existe nada de artículos en la aplicación.** `Articulo` se escribe
  únicamente desde tests y desde Prisma Studio.
- **La navegación es un `<a>` suelto** a `/usuarios` en `app/page.tsx`, visible
  sólo para el dueño.

## Decisiones

### Permisos: ver todos, precio y catálogo sólo el dueño

| Acción | Quién |
|---|---|
| Ver el listado, el detalle y el historial | Cualquiera con sesión |
| Ingresar mercadería y corregir por conteo | Cualquiera con sesión |
| Dar de alta, editar y desactivar un artículo | Sólo dueño |

El corte no es "escribir vs. leer" sino **qué decide el negocio y qué decide el
mostrador**. El precio es plata y el catálogo es una decisión comercial: eso es
del dueño. Recibir una caja del proveedor y corregir un faltante es operación
del día, la hace quien está atendiendo, y no queda anónima: todo movimiento
lleva `usuarioId`, así que la trazabilidad es la firma del movimiento y no un
permiso denegado.

El empleado necesita ver el stock igual, porque es lo que va a mirar cuando un
cliente pregunte si hay.

### El costo del movimiento entra ahora

CLAUDE.md tiene esta anotada como **la única puerta de una sola dirección** del
modelo de datos: el costo que un reporte de margen necesita es el del momento
del movimiento, no el actual, y `MovimientoStock` no lo guarda ni hay dato del
cual reconstruirlo. Todo movimiento creado antes de que exista la columna queda
sin costo para siempre.

Este ciclo construye justo la pantalla que conoce ese número —el ingreso de
mercadería es el momento en que alguien tiene la factura del proveedor en la
mano—, así que la columna entra acá y no después:

```prisma
costoUnitario Decimal? @map("costo_unitario") @db.Decimal(12, 2)
```

**Nada la lee.** No hay reportes de margen, ni costo promedio, ni valorización
del inventario: el spec del motor los dejó fuera de alcance y este spec no los
mete. Lo único que cambia es que el dato deja de tirarse.

Queda `null` en las ventas, en las anulaciones y en las correcciones por
conteo. Sólo el ingreso lo ofrece, y también ahí es opcional: un local que no
lleva costos no tiene por qué completarlo.

### Un artículo se desactiva, no se borra

`Articulo` hoy no tiene forma de darse de baja, y borrarlo lo impide la FK
apenas tenga un movimiento o una venta (`onDelete: Restrict`, a propósito:
borrar un artículo no puede borrar la historia de lo que se vendió).

Entra `desactivadoEn`, con el mismo tipo y el mismo sentido que
`User.desactivadoEn`, que ya sienta el precedente en este schema. El artículo
desaparece del listado por defecto y —cuando exista— del buscador de la pantalla
de ventas; su historial y sus ventas viejas quedan intactos.

Sin esto, el catálogo sólo crece: un local que dejó de trabajar una marca sigue
viéndola en cada búsqueda, y la pantalla de ventas del ciclo siguiente ofrecería
artículos que ya no se pueden conseguir.

### El SKU se autogenera si nadie lo escribe

`Articulo.sku` es obligatorio y único por tenant, así que el alta tiene que
producir uno. Un local chico no maneja códigos internos, y exigírselo en la
primera pantalla que toca es fricción sin contrapartida.

El campo aparece en el formulario y **no frena**: si se deja vacío se genera un
correlativo (`A-0001`). El que ya usa códigos —o el que quiere pegar el código
de barras del proveedor— lo escribe.

**Con contador por tenant, no con `count()` de artículos.** Es el mismo problema
que ya resolvió `Tenant.proximoNumeroVenta`, con la misma solución y el mismo
código de referencia (`proximoNumero` en `lib/ventas/crear.ts`): un
`UPDATE … RETURNING` dentro de la transacción, que serializa las altas
simultáneas de ese local y a cambio no repite números. Contar artículos le daría
el mismo `A-0007` a dos altas concurrentes, y con `desactivadoEn` en juego
llegaría a dar uno ya usado apenas alguien dé de baja algo.

```prisma
proximoSkuArticulo Int @default(1) @map("proximo_sku_articulo")
```

Queda un borde real: alguien puede escribir a mano `A-0007` y chocar más tarde
con el autogenerado. El `@@unique([tenantId, sku])` lo atrapa siempre —la base
no deja pasar el duplicado— y el alta reintenta con el siguiente número **hasta
cinco veces** antes de rendirse con `SKU_REPETIDO`; agotar cinco correlativos
seguidos significa que alguien tipeó a mano una racha de códigos con ese mismo
formato, y ahí el mensaje de error es mejor respuesta que seguir contando.
Un SKU **tipeado** que choca con uno existente no se reintenta nunca: devuelve
`SKU_REPETIDO` con el mensaje diciendo cuál es, porque cambiarle el código al
que lo escribió a mano sería decidir por él.

### La corrección se pide como conteo, no como delta

El que cuenta el inventario dice *"tengo 3"*, no *"restá 2"*. Así que la
pantalla pide el **stock contado** y el delta lo calcula el motor **adentro de
la transacción**, contra el stock de ese momento.

No es sólo comodidad. Pedir el delta obligaría a leer el stock en la pantalla y
restarlo en el navegador, y entre que la pantalla se dibuja y alguien aprieta el
botón puede haber pasado una venta: la corrección se calcularía contra un número
viejo y dejaría el inventario peor de como estaba. Calcular el delta con el lock
de la fila ya tomado es lo que hace que el resultado sea el que la persona
contó.

## Arquitectura

### Módulo nuevo: `lib/inventario/`

Mismo reparto que `lib/usuarios/` y `lib/ventas/`: la lógica de dominio afuera
de los server actions, con un error propio que lleva **código y no sólo
mensaje**, para que la pantalla decida qué mostrar sin parsear strings.

| Archivo | Responsabilidad |
|---|---|
| `lib/inventario/articulos.ts` *(nuevo)* | `crearArticulo`, `editarArticulo`, `desactivar`, `reactivar`, y el correlativo del SKU |
| `lib/inventario/stock.ts` *(nuevo)* | `ingresarStock`, `corregirStock`, y `ajustarStock` mudado desde `lib/ventas/anular.ts` |
| `lib/inventario/errores.ts` *(nuevo)* | `ErrorDeInventario` con su `codigo` |
| `lib/formato/numeros.ts` *(nuevo)* | Parseo de montos y cantidades escritos por una persona |
| `app/(app)/inventario/page.tsx` *(nuevo)* | El listado |
| `app/(app)/inventario/nuevo/page.tsx` *(nuevo)* | El alta |
| `app/(app)/inventario/[id]/page.tsx` *(nuevo)* | El detalle |
| `app/(app)/inventario/acciones.ts` *(nuevo)* | Los server actions de las tres pantallas |
| `app/(app)/inventario/formularios.tsx` *(nuevo)* | Los formularios `'use client'` |
| `app/(app)/layout.tsx` *(modificado)* | La navegación |
| `app/page.tsx` *(modificado)* | Se le saca el `<a>` suelto a `/usuarios` |

### `ajustarStock` se muda de casa

Hoy vive en `lib/ventas/anular.ts`, que no es su lugar: no tiene nada que ver
con anular una venta — quedó ahí porque la Task del motor que la escribió era la
misma. Se mueve a `lib/inventario/stock.ts`, que es de donde la van a llamar las
dos operaciones nuevas.

Es un movimiento de la función, no una reescritura: la firma no cambia y
`test/ventas.test.ts` ya la cubre.

Lo que sí cambia es de dónde cuelga el trabajo. `ajustarStock` hoy abre su
propia transacción y hace todo adentro, y `corregirStock` **no puede
reutilizarla tal cual**: necesita leer el stock y calcular el delta dentro de
la misma transacción que después escribe, que es todo el punto de la decisión
de más arriba. Así que el cuerpo se extrae a un helper interno que recibe el
cliente transaccional —crea el `MovimientoStock` y hace el `UPDATE` relativo
sobre `Articulo.stock`—, y las tres funciones públicas abren su transacción y
lo llaman:

- `ajustarStock(delta)` — la que ya existía, con su firma intacta.
- `ingresarStock(cantidad, costoUnitario?, nota?)` — delta positivo, motivo
  `INGRESO`, y el único camino que escribe `costoUnitario`.
- `corregirStock(stockContado, nota?)` — lee el stock adentro de la
  transacción, calcula `delta = contado - actual`, motivo `AJUSTE`. Si el delta
  da cero no escribe ningún movimiento: un conteo que confirma lo que ya había
  no es un evento del inventario, y ensuciaría el historial que este ciclo
  construye para poder leerlo.

### `lib/formato/numeros.ts`, compartido y no dentro de inventario

Un `<input type="number">` quiere punto decimal; un teclado en el mostrador
argentino escribe `1500,50`. La normalización acepta las dos formas y devuelve
un `Prisma.Decimal`, o tira `NUMERO_INVALIDO`.

Va en `lib/formato/` y no en `lib/inventario/` porque la pantalla de ventas la
va a necesitar igual el ciclo que viene, para el mismo problema y con la misma
respuesta. Ponerla en inventario garantizaría una segunda copia con criterio
propio.

## Base de datos

Una sola migración, **enteramente aditiva**: tres columnas nullables o con
default, ninguna tabla nueva, ningún borrado ni renombre.

```
MovimientoStock.costoUnitario  Decimal(12,2)?   nullable
Articulo.desactivadoEn         Timestamptz(3)?  nullable
Tenant.proximoSkuArticulo      Int              default 1
```

Cumple expand/contract sin esfuerzo: el código anterior sigue funcionando contra
este schema, así que el rollback automático del deploy —que revierte la imagen y
no la base— sigue teniendo sentido.

**Sin policies de RLS nuevas**, porque no hay tablas nuevas: las de `articulos`
y `movimientos_stock` ya cubren estas columnas. `test/rls-cobertura.test.ts` no
cambia.

`docs/schema.md` se regenera con `scripts/generar-erd.sh`, que el hook de
pre-commit y el paso 3 de `deploy.sh` verifican — un schema sin ERD actualizado
no se puede commitear.

## Las pantallas

### `/inventario` — el listado

Buscador por nombre o SKU en un `<form method="get">`: anda sin JavaScript, y
una URL con la búsqueda adentro se puede compartir o guardar. Paginación por
query param, 50 por página. Los desactivados no aparecen salvo que se tilde "ver
desactivados".

Columnas: SKU, nombre, tipo, precio y stock. Cada fila enlaza al detalle. El
botón de alta sólo lo ve el dueño.

Dos detalles que no son cosméticos:

- **Un servicio muestra `—` en stock, no `0`.** El motor no le descuenta stock a
  un `SERVICIO` (`crear.ts` filtra por `esProducto`), así que un `0` ahí se
  leería como faltante y alguien saldría a comprar lo que no existe.
- **El stock negativo se resalta.** El motor permite negativo a propósito —no
  aborta una venta por falta de stock, y está escrito como decisión de negocio—,
  y eso convierte al negativo en el síntoma de "entró mercadería que nadie
  cargó". Esconderlo sería tapar justamente lo que el sistema está diciendo.

El estado vacío no queda en blanco: es la primera pantalla que ve un local
recién dado de alta, y tiene que decir qué hacer.

### `/inventario/nuevo` — el alta (sólo dueño)

Nombre, tipo, precio, SKU opcional, y para un producto: **stock inicial y costo
unitario, también opcionales**. Cargar doscientos artículos entrando dos veces a
cada uno es fricción de onboarding que no hace falta pagar.

**El stock inicial no se escribe en la columna: crea un movimiento `INGRESO` en
la misma transacción que el artículo.** Es la invariante de todo el motor —el
stock es la suma de sus movimientos, y `test/ventas.test.ts` ya lo prueba—, y un
artículo que nace con 5 sin movimiento que lo explique es exactamente la
pregunta que la tabla append-only existe para poder responder.

Los campos de stock se ocultan al elegir "servicio". El formulario ya es
`'use client'` por `useActionState`, así que es estado local y nada más. Sin
JavaScript los campos se ven igual y el servidor rechaza con
`SERVICIO_SIN_STOCK`: la pantalla mejora con JS, no depende de él.

### `/inventario/[id]` — el detalle

Cuatro bloques, ordenados por quién los usa. Un empleado sólo puede mover stock,
así que eso va arriba y la edición abajo.

1. **Cabecera**: nombre, SKU, tipo, precio y stock actual. Un `Alert` si el
   artículo está desactivado.
2. **Mover stock** (cualquiera con sesión, sólo productos): *Ingresar
   mercadería* —cantidad, costo unitario opcional, nota— y *Corregir por conteo*
   —cuánto hay realmente, más nota—.
3. **Editar** (sólo dueño): nombre, SKU, precio, y desactivar o reactivar.
4. **Historial**: los movimientos, el más reciente arriba, con fecha, motivo,
   delta con signo, quién lo hizo, la nota y el número de venta si vino de una
   venta. Es el bloque que responde "por qué tengo 3 y no 5", que es la pregunta
   que un dueño hace cuando el inventario no le cierra.

**El tipo no se edita.** Pasar un `PRODUCTO` con stock y movimientos a
`SERVICIO` deja stock huérfano que el motor ya no descuenta ni explica, y el
camino inverso deja un artículo con historia de ventas y sin ningún movimiento
que justifique su stock. Se muestra y no se toca; un artículo mal cargado se
desactiva y se crea de nuevo.

### Dos cosas de formato que son bugs si se ignoran

- **Las fechas se muestran con `timeZone: 'America/Argentina/Buenos_Aires'`
  explícito.** El servidor está en Ashburn: sin declarar el huso, un movimiento
  de las 22:00 de Buenos Aires aparece con fecha del día siguiente, y el
  historial de un cierre de jornada queda partido en dos días.
- **Los montos y las cantidades aceptan coma y punto**, vía
  `lib/formato/numeros.ts`. Ver arriba.

### Navegación

`Inicio · Inventario · Usuarios` —el último sólo para el dueño— en el header de
`app/(app)/layout.tsx`, que es donde ya vive la sesión y donde ya está el botón
de salir. El `<a>` suelto de `app/page.tsx` se elimina.

**Sin registry de módulos todavía.** CLAUDE.md promete la navegación como punto
de extensión del núcleo, y ese punto se diseña bien cuando exista Órdenes de
Trabajo para tironear de él; diseñarlo ahora sería hacerlo a ciegas. Tener los
enlaces centralizados en un solo lugar es lo que hace barato ese refactor
después.

El `data-testid="tenant-nombre"` del header **no se toca**: `scripts/smoke.sh`
lo busca en cada pantalla autenticada para distinguir una página de verdad de un
200 vacío, y borrarlo hace fallar todos los casos de pantalla del gate a la vez.

## Verificación

- **`test/inventario.test.ts`** — integración contra el Postgres efímero, con el
  patrón de `test/ventas.test.ts`. El caso central es el invariante: después de
  un alta con stock inicial, un ingreso, una corrección por conteo y una venta,
  **el stock del artículo es la suma de sus movimientos**. Más el aislamiento
  por tenant, el SKU autogenerado bajo concurrencia, y que un artículo
  desactivado no aparece en el listado por defecto.
- **`lib/formato/numeros.test.ts`** — puro, sin Docker.
- **`app/(app)/inventario/acciones.test.ts`** — que cada action reexija su rol
  por su cuenta. Que la pantalla no se muestre no es una defensa: una action se
  invoca sin pasar por la pantalla, y `app/(app)/usuarios/acciones.ts` ya dejó
  escrito ese razonamiento.
- **`RUTAS_SIN_SMOKE['/inventario/[id]']`**, con su razón escrita. Esa lista
  arrancó vacía diciendo *"existe para que la primera sea una decisión y no un
  olvido"*: ésta es la primera. `/inventario` y `/inventario/nuevo` entran solas
  al barrido del smoke, que se deriva del sistema de archivos.
- El usuario del canario se crea como `DUENO` (`scripts/crear-tenant.mts`), así
  que el barrido cubre también las pantallas de dueño — igual que `/usuarios`
  hoy.

## Fuera de alcance

Explícito, para que no se lea como olvido:

- **La UI de ventas.** Es la pieza 5 y el ciclo siguiente.
  **Y se lleva un requisito de este ciclo**: el buscador de artículos de esa
  pantalla tiene que filtrar `desactivadoEn: null`, y `crearVenta` tiene que
  rechazar un artículo desactivado. Hoy no lo hace —resuelve por
  `{ id: { in: … } }` sin filtro— y es inofensivo sólo porque no hay pantalla
  de ventas todavía. Escrito acá y no como "cuando exista", que es la forma de
  que a nadie le trope.
- **Clientes.** No hay pantalla de clientes; la venta la va a necesitar y entra
  con ella.
- **Costo promedio, valorización del inventario y márgenes.** El costo se
  guarda; nada lo lee.
- **Alertas de stock mínimo, categorías o rubros de artículo, fotos,
  importación por CSV.**
- **Multi-sucursal.** Sigue rigiendo por omisión "un tenant por local", como
  dice CLAUDE.md en *Decisiones abiertas del modelo de datos*. `Articulo.stock`
  sigue siendo un escalar.
- **Reserva de stock.** Ya estaba fuera de alcance en el motor y sigue estándolo.

Un efecto que sale gratis y vale nombrarlo: el buscador por SKU habilita el
lector de código de barras sin escribir una línea más — un lector tipea el
código y manda Enter.
