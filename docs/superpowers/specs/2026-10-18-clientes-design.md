# Spec: la solapa Clientes

**Fecha**: 2026-10-18

**Origen**: pedido de un cliente (local que vende iPhones), audios de WhatsApp del
7 y 8 de octubre de 2026, pasado por el dueño del producto como "Tarea 3": tener
registrados a todos los que le compraron, para después mandarles ofertas.

**Cómo se decidió**: el dueño del producto pidió el ciclo resuelto de noche y sin
preguntas, y revisa a la mañana. Cada **decisión** de abajo es una llamada de
quien implementó. Siguen abiertas para el cliente qué datos quiere guardar y por
qué medio quiere mandar las ofertas.

## Lo que ya existe

- `Cliente { id, tenantId, nombre, telefono?, email?, creadoEn, actualizadoEn }`,
  con RLS desde la migración inicial, sin índice único y sin consentimiento.
- `lib/clientes/administrar.ts`: `crearClienteEn`, `crearCliente`,
  `buscarClientes`, usados hoy sólo por el alta de una orden de servicio
  técnico, que crea clientes al vuelo.
- `Venta.clienteId` opcional (`onDelete: Restrict`) y `crearVenta` ya lo acepta y
  lo valida contra el tenant, pero `/vender` nunca lo manda. `/ventas` y su
  detalle ya muestran el nombre del cliente ("Consumidor final" si no hay).
- `OrdenDeTrabajo.clienteId` obligatorio, `Restrict`.

## El principio

**El cliente se registra donde se lo tiene enfrente: al cobrar.** Una lista que
hay que llenar después nunca se llena. La solapa es el lugar para buscar,
corregir y exportar; el lugar donde nacen los clientes es la venta.

## Las decisiones

### 1. Columnas nuevas en `Cliente`, todas aditivas

- `notas String?` — texto libre.
- `aceptaOfertas Boolean @default(false) @map("acepta_ofertas")` — el
  consentimiento. **Default `false`**: nadie aceptó nada por haber sido cargado
  antes de que el campo existiera, y escribirles a esos clientes sin
  consentimiento es justo lo que el campo existe para evitar.
- `telefonoClave String? @map("telefono_clave")` — los **últimos 10 dígitos** del
  teléfono, o `NULL` si tiene menos de 10. Es la clave de duplicados, con el
  mismo criterio que `coinciden` en `lib/bot/numeros-de-prueba.ts`: "11 2233-4455",
  "+54 9 11 2233 4455" y "1122334455" son el mismo número. La escribe la
  aplicación en cada alta y edición, con una función pura compartida; la
  migración la rellena para las filas existentes con
  `right(regexp_replace(telefono, '\D', '', 'g'), 10)` cuando hay al menos 10
  dígitos. Índice `(tenantId, telefonoClave)`.
- `@@index([tenantId, clienteId])` en `Venta`, para la ficha.

Fecha de alta = `creadoEn`, que ya existe.

### 2. Los duplicados se frenan en la aplicación, no con un índice único

**Decisión**: el índice es común, no `UNIQUE`. Las órdenes de servicio técnico
llevan semanas creando clientes al vuelo sin ningún chequeo, así que en
producción puede haber dos filas con el mismo número; un índice único haría
fallar la migración en el deploy, y resolver esos duplicados exige decidir cuál
de las dos queda —una fusión con sus ventas y órdenes—, que es otro ciclo. El
chequeo vive en `crearClienteEn` y en la edición, dentro de la transacción del
tenant: si otro cliente tiene la misma `telefonoClave`, se rechaza con
`TELEFONO_REPETIDO` y un mensaje que nombra al cliente que ya lo tiene. Se
aplica a **todos** los caminos que crean clientes, incluido el alta de una
orden de trabajo, donde el mensaje lo manda a elegir el existente de la lista.

Un teléfono con menos de 10 dígitos se guarda tal cual pero no participa de los
duplicados (no hay con qué compararlo sin falsos positivos).

### 3. Las pantallas

- **`/clientes`** — listado con buscador (nombre, teléfono, email), filtro
  "Aceptan ofertas", cantidad de compras y fecha de alta por fila, alta en un
  diálogo y "Exportar CSV". El buscador reusa `buscarClientes`, extendido a
  email y a la clave del teléfono (para que "1122334455" encuentre a quien está
  cargado como "11 2233-4455").
- **`/clientes/[id]`** — la ficha: datos editables (nombre, teléfono, email,
  notas, acepta ofertas), las compras (ventas, con número, fecha, total en su
  moneda y las anuladas marcadas como tales, cada una enlazada a
  `/ventas/[id]`) y las órdenes de servicio técnico, porque ya existen y son la
  otra mitad de la historia de ese cliente. Borrar está acá.

La pestaña "Clientes" va en la navegación principal, visible para todos.

### 4. Quién puede qué

- Ver, buscar, crear y editar: **cualquier usuario con sesión**. El vendedor
  necesita crear clientes al cobrar, y las órdenes de trabajo ya le permiten
  hacerlo hoy.
- **Exportar y borrar: sólo el dueño** (`exigirDuenio`). El CSV es la base
  entera de contactos del local en un archivo, con el mismo criterio que
  `exportarVentas` del dashboard. **Decisión**: no es un permiso delegable en
  este ciclo para no sumar un switch que nadie pidió; si un dueño lo pide,
  pasa a ser un permiso del catálogo.

### 5. Borrar

Se puede borrar un cliente **sin ventas ni órdenes** (el cargado por error, el
duplicado). Uno con historia no se borra: las FK son `Restrict` y la ficha
explica por qué ("tiene 3 compras y 1 orden: no se puede borrar"). Mismo
criterio que el borrado de artículos (ciclo del 2026-09-07). **Decisión**: no
hay baja lógica en este ciclo — el caso que la necesitaría ("no quiero ver más
a este cliente") no está en el pedido, y "no le escribas" ya lo resuelve
`aceptaOfertas`.

### 6. Asociar una venta a un cliente, en dos lugares

- **Al cobrar, en `/vender`**: un campo opcional "Cliente" en el paso de cobro,
  con búsqueda y "Cliente nuevo" (nombre, teléfono, acepta ofertas) en el
  mismo lugar. El cliente nuevo se crea en la misma transacción que la venta
  (como hoy la orden de trabajo crea el suyo), así que una venta que falla no
  deja un cliente huérfano. **Sin cliente la venta se cobra igual**: es la
  mayoría de las ventas de mostrador, y el cobro no puede ganar un paso
  obligatorio. Este es el cambio más delicado del ciclo porque toca la pantalla
  más usada: el campo se agrega sin mover nada de lo que ya hay, y el test de
  `/vender` existente tiene que seguir en verde sin cambios de comportamiento.
- **Después, en `/ventas/[id]`**: "Asignar cliente" / "Cambiar cliente" /
  "Quitar cliente", para las ventas que ya se hicieron. Es seguro por el mismo
  motivo que `guardarDetalle`: el cliente no entra en ningún total ni en
  ninguna validación de plata. Cualquier usuario con sesión, como el detalle.

### 7. El CSV

Columnas: nombre, teléfono, email, acepta ofertas (sí/no), fecha de alta,
cantidad de compras, última compra, notas. Respeta el filtro y la búsqueda que
estén aplicados en el listado. Mismo armado que los otros dos CSV del repo
(`lib/formato/csv.ts`, BOM para Excel, filas armadas fuera del archivo `'use
server'` para poder testearlas).

## Fuera de alcance

- Mandar ofertas desde el sistema (segunda etapa, el medio no está decidido).
- Fusionar clientes duplicados que ya existan.
- Relacionar `Cliente` con las conversaciones del bot.

## Tests

- `claveDeTelefono`: formatos argentinos con y sin +54 / 9 / guiones / espacios,
  menos de 10 dígitos → null.
- Alta y edición rechazan un teléfono repetido en el mismo tenant (en otro
  formato también) y lo aceptan en otro tenant; editar un cliente sin cambiar
  su propio teléfono no choca consigo mismo.
- El alta de orden de trabajo con un cliente nuevo de teléfono repetido se
  rechaza con el mensaje.
- Búsqueda por nombre, email y teléfono en otro formato.
- Filtro "acepta ofertas" y CSV (encabezado, escapado, sí/no).
- Borrar: sin historia se borra; con una venta o una orden, se rechaza.
- Permisos: un empleado no puede exportar ni borrar; el dueño sí.
- Venta con `clienteNuevo` crea el cliente en la misma transacción; si la venta
  falla, el cliente no queda. Asignar/cambiar/quitar cliente en una venta ya
  cobrada no toca totales ni pagos.
- La ficha lista las ventas del cliente y no las de otro.

## Ajustes durante la implementación

Lo que el código obligó a decidir y el spec no decía, cada uno con la opción
más conservadora que había:

- **El chequeo de repetidos va bajo un lock.** El spec decía "dentro de la
  transacción del tenant"; eso solo no alcanza: dos altas simultáneas del
  mismo número no se ven entre sí hasta el commit. `crearClienteEn` y
  `editarCliente` toman un `pg_advisory_xact_lock` por (tenant, clave), el
  mismo mecanismo que los rangos del plan canje. En una venta y en una orden se
  toma antes del lock de la fila del tenant (`proximoNumero`), siempre en ese
  orden. Un test lanza dos altas a la vez y entra una sola.
- **Un solo mensaje de repetido para los tres caminos**: "Ese teléfono ya lo
  tiene Juan Pérez. Si es la misma persona, buscala y elegila en vez de
  cargarla de nuevo." Sirve en `/vender`, en la recepción y en `/clientes`.
- **Buscar por teléfono con 10 dígitos o más busca por los últimos diez**, igual
  que se arma la clave: "+54 9 11 2233-4455" tiene trece dígitos y ninguna clave
  los contiene enteros. Con menos de 3 dígitos no se busca por clave (sería
  ruido); por el teléfono tal cual sigue buscando.
- **`digitosDe` y `ultimos10` se mudaron a `lib/texto/telefono.ts`.** El bot los
  re-exporta, así que ni sus llamadores ni sus tests cambiaron, y clientes no
  importa internals del bot.
- **Los campos tienen topes y el email una forma mínima.** Nombre 120, teléfono
  40, email 200, notas 1000: lo que pasa se corta, no se rechaza (como el
  detalle de una venta), y el `maxLength` de cada campo es el mismo número. Un
  email sin `@` o con espacios se rechaza (`EMAIL_INVALIDO`): lo que ataja es el
  teléfono tipeado en el campo equivocado. El mensaje de nombre vacío pasó a
  "El cliente necesita un nombre." (ningún test ni pantalla leía el anterior).
- **"Compras" no cuenta las anuladas** (listado y CSV: una venta anulada no es
  una compra); **"tiene N compras: no se puede borrar" sí las cuenta**, porque
  la FK las cuenta igual. La ficha las muestra tachadas y con el chip
  "Anulada", para que los dos números se puedan leer.
- **Sin paginar.** El listado trae los primeros 200 por nombre y dice cuántos
  hay ("buscá para encontrar al resto"); la ficha, las últimas 100 compras y
  órdenes, y avisa si hay más. El CSV no tiene tope, por el mismo argumento que
  `exportarVentas`.
- **El cliente nuevo viaja del cobro como un JSON en un solo campo oculto**
  (`clienteNuevo`), al lado de `clienteId`. Los dos vacíos son "sin cliente".
  El consentimiento sólo es sí con un `true` literal: ni "true" ni "1".
- **El campo "Cliente" de `/vender` corta la propagación de cada Enter que
  atiende.** Elegir con Enter saca el buscador del DOM en el mismo evento, el
  foco cae en `<body>` y el atajo global cobraba la venta con ese mismo Enter
  (encontrado leyendo el código antes de verlo en pantalla; un caso sobre la
  fuente lo fija). Después de elegir, el foco queda en `<body>` a propósito: el
  Enter siguiente sí cobra, como promete la leyenda.
- **"Asignar cliente" en `/ventas/[id]` también carga uno nuevo**, con el mismo
  selector que el cobro, y el cliente nace en la misma transacción que el
  cambio. **No deja fila en `EdicionDeVenta`**: esa bitácora es de cómo se pagó
  (lo que mueve plata), y "le pusimos el cliente" la volvería ruido. Como
  `guardarDetalle`, no deja rastro de quién lo cambió ni de qué decía antes; si
  hace falta, la salida es una columna o una bitácora propia. **Funciona sobre
  una venta anulada**, como el detalle.
- **La card de órdenes de la ficha sólo aparece si tiene alguna**: un cliente de
  un kiosco no tiene por qué ver una card vacía de servicio técnico.
- **En el teléfono la ficha pone los datos primero**; en escritorio, la
  historia a la izquierda y los datos a la derecha, como `/ventas/[id]`.
- **La pestaña va después de Inventario**, sin permiso.
- **Editar sólo chequea repetidos si la clave del teléfono cambia** (review
  del ciclo). Con la misma clave no hay nada que reservar, y chequear igual
  dejaba congelados a los repetidos heredados: ninguno de los dos se podía
  editar, ni siquiera para tildar las ofertas. Pasarse a un número que ya tiene
  otro cliente sigue rechazándose.
