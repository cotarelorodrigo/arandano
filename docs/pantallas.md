# Las pantallas

Qué hay construido hoy, pantalla por pantalla: qué se puede hacer en cada una,
qué server actions expone y las decisiones no obvias que lleva encima.

**No es `CLAUDE.md`, y la diferencia importa.** Ese documento son decisiones
cerradas —lo que no hay que volver a discutir—; éste es **estado actual**, y
cambia con cada ciclo. Mezclarlos deja sin saber qué parte es vinculante.

**Y no puede quedar desactualizado en silencio.** `test/pantallas.test.ts`
compara este archivo contra `app/**/page.tsx` en las dos direcciones: una
pantalla nueva sin sección rompe el build, y una sección que ya no corresponde a
ninguna ruta también. Es el mismo mecanismo que ata `docs/sistema-de-diseno.md`
a `app/globals.css` y `docs/schema.md` al DDL.

Lo que el test **no** puede verificar es que el contenido de cada sección siga
siendo cierto. Eso sigue dependiendo de quien toque la pantalla, así que la
regla es: si cambiás lo que una pantalla hace, la sección va en el mismo commit.

<!-- pantallas:inicio -->

## `/`

La landing del ápex y, en un subdominio de tenant, el redirect a la aplicación.
La misma ruta hace las dos cosas porque lo que la decide es el `Host`.

**Qué se puede hacer**

- En `arandano.app`: leer qué es el producto y dejar un lead (mail y WhatsApp).
- En `flor.arandano.app`: nada — redirige a `/vender` si hay sesión, o a
  `/login` si no.

**Decisiones**

- **Es la única página que se indexa.** Toda pantalla de tenant lleva
  `robots: noindex`: un local no quiere su punto de venta en Google. Se decide
  acá y no en un `robots.txt`, que sería el mismo archivo para el ápex y para
  todos los subdominios — justamente la distinción que hay que hacer.
  `test/indexacion.test.ts` lo fija.
- La landing muestra un fragmento **real** del punto de venta —los mismos
  componentes y el mismo formateo de plata, atados por test—, no una captura.
- Describe el producto completo, **incluido lo que todavía no está
  construido** (caja, ARCA, catálogo, bot, módulos). Es una decisión consciente.
- `leads` es la primera tabla del schema **sin `tenant_id`**, así que no la
  protege RLS sino el privilegio: `arandano_app` sólo inserta, y los leads se
  leen con `npm run leads`.

## `/login`

Entrar a un local. Usuario y contraseña, sin magic link ni OAuth.

**Acciones**: `entrar`.

**Qué se puede hacer**

- Entrar con mail y contraseña.

**Decisiones**

- **No hay login en el ápex**: `arandano.app/login` da 404. Entrar es siempre
  entrar a un local, y por eso el paño de la izquierda lleva el nombre del
  tenant en grande y "Arándano" chico arriba — el cartel es del local, la marca
  firma abajo.
- **No hay "olvidé mi contraseña".** No hay proveedor de mail, y una pantalla de
  recupero que promete un mail que nunca sale es peor que no tenerla. El
  recupero real es `npm run usuario:clave` en el servidor, o el dueño desde
  `/usuarios`.
- Un tenant `SUSPENDIDO` recibe 403, no 404: existe, pero no puede entrar.
- El `redirect()` de esta action es el único camino que Next resuelve haciendo
  un `fetch()` contra sí mismo, con un `Host` distinto del que pidió el
  navegador. Ahí vivió un bug que dejaba la home en 404 después de cada login,
  y por eso `scripts/smoke.sh` entra **por la pantalla** además de por el
  endpoint.

## `/vender`

El punto de venta. Es la pantalla más caliente del sistema y la única que se
opera con alguien esperando del otro lado del mostrador.

**Acciones**: `cobrar`, `buscarArticulos`.

**Qué se puede hacer**

- Buscar un artículo por nombre o código y agregarlo al carrito. El buscador
  habilita el lector de código de barras sin código propio: el lector tipea.
- Cambiar cantidades y quitar ítems.
- Cobrar con **pagos partidos**, en pesos y en dólares, cada uno con su medio
  (efectivo, transferencia, débito, crédito) y su cotización.
- Ver el vuelto calculado.

**Decisiones**

- **Cobrar es idempotente.** El punto de venta genera una `claveIdempotencia`
  por venta; si el mismo submit llega dos veces —doble click, F5 sobre el POST,
  reintento de red— la segunda devuelve la venta que ya existe en vez de cobrar
  dos veces y descontar el stock dos veces.
- El total ancla la vista: está **siempre** en el mismo lugar, desde el carrito
  vacío y en `$ 0,00`. Un ancla que aparece y desaparece no es un ancla.
- Con una cantidad a medio tipear muestra `—`, nunca `$ NaN`.
- La cotización del dólar se precarga con la última que usó el local
  (`ultimaCotizacionUsd`), y esa consulta tiene índice propio: sin él era un
  scan de toda la tabla de pagos en cada carga de la pantalla más usada.
- Todo producto se redondea **antes** de entrar en cualquier suma: el total de
  los ítems y el de los pagos se comparan por igualdad, así que los dos tienen
  que redondear en el mismo momento y de la misma forma.

## `/ventas`

El historial por período.

**Qué se puede hacer**

- Filtrar por rango de fechas. El default es hoy.
- Ver tres tiles: total del período, ventas cobradas y anuladas.
- Ver **"Cómo entró la plata"**: una barra por medio de pago, apilada por
  moneda, con los dólares convertidos a pesos a la cotización de cada pago.
- Entrar al detalle de cualquier venta.
- Paginar de a 50.

**Decisiones**

- **El total NO suma las anuladas**, y lo dice en pantalla para que nadie tenga
  que deducirlo.
- **Las anuladas se muestran**: el historial tiene que poder responder qué pasó,
  y esconderlas sería tapar la respuesta. Van con un chip, no con texto suelto:
  quien no distingue el rojo igual ve que la fila está marcada.
- Los tiles cuelgan del **período**, no de la página: colgados de la página, un
  `?p=5` los hacía desaparecer.
- El filtro es `method="get"`: anda sin JavaScript y la URL con el rango se
  comparte.
- El "hoy" se calcula en el huso de Buenos Aires y no en el del servidor, que
  está en Ashburn: sin eso, a las 22:00 "las ventas de hoy" mostraría las de
  mañana.
- Una fecha malformada en el query string cae en hoy en vez de servir un 500.
- El panel del gráfico **no se dibuja si no hay pagos** — un período puede tener
  ventas y ningún pago si están todas anuladas, y un gráfico en blanco se lee
  como que algo se rompió.

## `/ventas/[id]`

El detalle de una venta: qué se vendió y cómo se pagó.

**Acciones**: `anular`.

**Qué se puede hacer**

- Ver los ítems con cantidad, precio unitario y subtotal.
- Ver los pagos con su medio, moneda y cotización.
- **Anular la venta** — sólo el dueño.

**Decisiones**

- El guard de dueño está **en la action**, no sólo en la pantalla: una server
  action se invoca sin pasar por ningún componente.
- Anular **no borra los movimientos de stock originales**: genera movimientos
  compensatorios. Por eso el aviso puede decir "el stock volvió al inventario"
  sin mentir, y el historial del artículo sigue explicando qué pasó.

## `/inventario`

El listado de artículos, con buscador.

**Qué se puede hacer**

- Buscar por nombre o SKU.
- Ver stock, precio y tipo (producto o servicio).
- Mostrar u ocultar los artículos desactivados.
- Paginar de a 50.

**Decisiones**

- El conteo de artículos con stock negativo se calcula sobre **lo que el
  listado está mostrando**, no sobre toda la tabla: si no, el subtítulo diría
  "3 con stock negativo" mientras la búsqueda filtrada no muestra ninguno.
- Sólo los `PRODUCTO` cuentan para ese aviso: un servicio no lleva stock, y su
  columna es un guion.
- La baja es **lógica** (`desactivadoEn`), nunca un `DELETE`: un artículo
  borrado se llevaría puesto el historial de las ventas que lo incluyen.
- `?p` se trunca y se limita: `?p=2.3` daría un `skip` con decimales y
  `?p=1e300` uno fuera del rango de un `Int`, y Prisma rechaza los dos con un
  error que nadie atrapa — un 500 servido desde la barra de direcciones.

## `/inventario/nuevo`

El alta de un artículo.

**Acciones**: `altaArticulo`.

**Qué se puede hacer**

- Crear un producto (con stock) o un servicio (sin stock).
- Dejar el SKU vacío y que se genere solo.
- Cargar stock inicial, que nace como movimiento y no como un número suelto.

**Decisiones**

- **La secuencia de SKU puede tener huecos, y es a propósito.**
  `Tenant.proximoSkuArticulo` se incrementa en su propia transacción comiteada:
  con el `UPDATE` adentro de la transacción del alta, un choque de unicidad la
  rollbackeaba entera —contador incluido— y el reintento volvía a pedir el mismo
  número, así que el bucle no convergía nunca. Un SKU es un código opaco que
  nadie recita: el hueco no se ve. **Es la decisión inversa a la de
  `Venta.numero`, y las dos están bien** — un número de venta se dice por
  teléfono.
- El stock inicial entra como `MovimientoStock`, así que el historial del
  artículo arranca explicando de dónde salió cada unidad.

## `/inventario/[id]`

La ficha de un artículo: editarlo, moverle el stock y ver su historial.

**Acciones**: `guardarArticulo`, `ingresarMercaderia`, `corregirPorConteo`,
`bajaArticulo`, `reactivarArticuloAccion`.

**Qué se puede hacer**

- Editar nombre y precio.
- **Ingresar mercadería** con su costo unitario y una nota (factura, proveedor).
- **Corregir por conteo**: se escribe el stock contado, no el delta.
- Desactivar y reactivar el artículo.
- Ver el historial completo de movimientos.

**Decisiones**

- En la corrección por conteo **el delta lo calcula el servidor, adentro de la
  transacción, contra el stock del momento**. Si lo calculara el navegador, una
  venta ocurrida entre que se abrió la pantalla y se apretó el botón quedaría
  pisada.
- El costo unitario del ingreso es **opcional** y hoy **nadie lo lee**: no hay
  reportes de margen todavía. Se captura igual porque el momento de conocerlo es
  cuando alguien tiene la factura del proveedor en la mano — después no se puede
  backfillear.
- Los movimientos llevan el motivo (`VENTA`, `ANULACION_VENTA`, `AJUSTE`,
  `INGRESO`). Sumar un motivo es una migración aditiva: es el punto de extensión
  que el núcleo le promete a los módulos.

## `/usuarios`

El equipo del local.

**Acciones**: `altaEmpleado`, `nuevaClave`, `baja`, `alta`.

**Qué se puede hacer**

- Agregar a alguien como `EMPLEADO` o `DUENO`, con su contraseña inicial.
- Cambiarle la contraseña a cualquier usuario del local, **incluido uno mismo**.
- Desactivar y reactivar personas.

**Decisiones**

- **Todo esto es sólo del dueño**, y el guard (`comoDuenio`) está en cada
  action, no en la pantalla.
- **Nunca se puede dejar un local sin dueño activo.** El chequeo del último
  dueño, la escritura de `desactivadoEn` y el borrado de sesiones van en una
  sola transacción.
- **Resetear una clave borra las sesiones de esa persona.** Sin eso, cambiarle
  la clave a alguien que se fue no lo saca de ningún lado. Efecto secundario a
  tener presente: quien se cambia su propia contraseña se queda afuera y tiene
  que volver a entrar.
- La contraseña se muestra **en texto plano** una sola vez, al crearla o
  resetearla: el dueño se la tiene que poder dictar a un empleado. No hay otra
  forma de recuperarla después.
- El mínimo son **8 caracteres**, y el número no está escrito acá ni en el
  formulario: sale de `ctx.password.config` de Better Auth, para que la
  validación del servidor y la de la librería no puedan desincronizarse.

<!-- pantallas:fin -->

## Lo que hereda toda pantalla de la aplicación

Las siete de arriba que no son `/` ni `/login` cuelgan de `app/(app)/`, y de ahí
heredan tres cosas sin que nadie las repita:

- **El guard de sesión** (`exigirSesion` en el layout). Una ruta nueva bajo
  `(app)` nace protegida; `test/rutas-con-guard.test.ts` falla si alguna queda
  afuera del grupo sin declarar por qué.
- **`robots: noindex`**. Son datos de un local.
- **El shell**: el cartel con el nombre del local, quién sos, cómo salir, y la
  navegación.

Y todas, sin excepción, leen la base con `prismaParaTenant`, que fuerza el
filtro por `tenant_id` y ata la conexión al tenant por GUC de sesión. RLS es la
segunda capa: si un query se olvidara el filtro, la base igual protege el dato.

## Cómo se verifica

Un test que corre y da verde no prueba que atrape nada. Antes de dar este
archivo por cerrado se metieron a mano los defectos que tiene que detectar, uno
por vez y revirtiendo cada uno antes del siguiente, para comprobar que el rojo
es el esperado y no otro.

| Defecto introducido | Dónde | Qué falló |
|---|---|---|
| Una pantalla nueva sin sección (`app/(app)/caja/page.tsx`) | el código | *toda pantalla del código está documentada* — `estas pantallas existen en app/ y docs/pantallas.md no las describe: /caja` |
| Una sección de una ruta inexistente (`## \`/reportes\``) | este archivo | *toda pantalla documentada existe en el código* — `describe pantallas que ya no existen en app/: /reportes` |
| Dos secciones para la misma ruta | este archivo | *ninguna sección aparece dos veces* — `tiene dos secciones para: /ventas` |

Las dos mitades restantes —"encuentra páginas en app/" y "el documento declara
pantallas"— están por el modo de falla que no se ve: dos listas vacías son
iguales, así que un parser que dejó de matchear daría verde sobre un documento
roto. Es lo mismo que ya cierran `rutas_autenticadas` en
`scripts/lib/rutas-comun.sh` y los dos casos "no está vacía" de
`test/sistema-de-diseno.test.ts`.

**Lo que ningún test cubre**, y conviene decirlo en vez de dejarlo implícito: si
el *contenido* de una sección sigue siendo cierto. El mecanismo garantiza que
la lista de pantallas esté completa, no que lo que dice cada una esté al día.
