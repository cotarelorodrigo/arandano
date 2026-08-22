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

El punto de venta. Es la pantalla más caliente del sistema, la única que se
opera con alguien esperando del otro lado del mostrador, y la primera con su
**cuerpo** rediseñado contra `design/arandano.pen` (frame `App / Vender`) — el
shell (sidebar + encabezado) ya venía de un ciclo anterior.

**Acciones**: `cobrar`, `buscarArticulos`, `abrirCajaDesdeVender`,
`cerrarCajaDesdeVender`.

**Qué se puede hacer**

- Buscar un artículo por nombre o código y agregarlo al carrito, desde una
  barra prominente a todo el ancho de la pantalla con su propio atajo (`F2`
  la enfoca desde cualquier lado). El buscador habilita el lector de código de
  barras sin código propio: el lector tipea y manda Enter.
- Cambiar cantidades con un stepper `[−] [valor] [+]` —el valor del medio
  sigue siendo editable a mano, no sólo con los botones— y quitar ítems.
- Cobrar con **pagos partidos**, en pesos y en dólares, cada uno con su medio
  (efectivo, transferencia, débito, crédito) y su cotización. Un pago en
  dólares muestra cuántos pesos representa (`Entran $X`).
- Ver el vuelto y el faltante como chips de estado (verde/rojo), excluyentes
  entre sí.
- Cobrar apretando `Enter` con el foco en `<body>` (sin nada en particular
  enfocado), y vaciar el carrito con `Esc`.
- Ver el estado real de la caja del turno en un chip del header, y abrirla o
  cerrarla ahí mismo, sin salir de la pantalla.
- Ver la cotización del dólar que fijó el dueño (`Tenant.cotizacionUsd`), con
  de cuándo es.

**Decisiones**

- **Cobrar es idempotente.** El punto de venta genera una `claveIdempotencia`
  por venta; si el mismo submit llega dos veces —doble click, F5 sobre el POST,
  reintento de red— la segunda devuelve la venta que ya existe en vez de cobrar
  dos veces y descontar el stock dos veces.
- El total ancla la vista: está **siempre** en el mismo lugar, en una franja
  pintada con `--marca` (la única superficie de marca de esta pantalla, junto
  con el avatar del pie del sidebar), desde el carrito vacío y en `$ 0,00`. Un
  ancla que aparece y desaparece no es un ancla.
- Con una cantidad a medio tipear muestra `—`, nunca `$ NaN`.
- La cotización que **precarga el campo de un pago en dólares** sale de la
  última con la que se cobró (`ultimaCotizacionUsd`, sobre `Pago.cotizacion`,
  histórica) — **no** es la misma que el chip del header, que muestra
  `Tenant.cotizacionUsd` (la que el dueño fija para hoy). Las dos conviven a
  propósito: una es "a cuánto se cobró", la otra es "a cuánto se cobra ahora
  si no se toca nada". El comentario del campo en `prisma/schema.prisma` lo
  explica.
- Todo producto se redondea **antes** de entrar en cualquier suma: el total de
  los ítems y el de los pagos se comparan por igualdad, así que los dos tienen
  que redondear en el mismo momento y de la misma forma.
- **El typeahead del buscador se mantuvo**, aunque el `.pen` no dibuja ningún
  frame para la lista de resultados. No es un descuido: el `.pen` modela
  estados de **reposo**, no de interacción —el mismo criterio que ya vale para
  `--primary-hover`, un token que tampoco aparece en la maqueta porque un frame
  estático no puede dibujar un hover—. Borrar el typeahead habría perdido una
  capacidad real (buscar por nombre cuando no hay código de barras) a cambio
  de nada. Es la lectura a aplicar cada vez que el `.pen` no contesta algo: la
  ausencia de un frame no es una instrucción de borrar, es un estado que la
  maqueta no puede mostrar.
- **El aviso de stock insuficiente es un chip ámbar, no rojo.** Vender con
  stock negativo está permitido en este producto —el mostrador manda—, así que
  es "hay que mirar", no "esto impide seguir"; el rojo queda para lo que sí
  bloquea (una cantidad ilegible, que sí apaga "Cobrar").
- **Los `<select>` nativos de medio de pago y moneda pasaron a `Select` de
  shadcn (Radix), a conciencia.** Trae popover propio y navegación por
  teclado —alcance que un comentario de una task anterior había diferido
  explícitamente—, pero se acepta: la maqueta pide un chip con `chevron-down`
  que ningún `<select>` nativo dibuja en ningún browser, y ésta es una
  pantalla que se opera con teclado, donde el manejo de Radix es mejor que el
  nativo.
- **El chip de caja muestra el estado real y ofrece abrirla o cerrarla ahí
  mismo**, sin pantalla `/caja` ni arqueo — ver el detalle en *Pendiente*.
  `cajaAbierta()` se lee en el servidor (`page.tsx`), igual que
  `ultimaCotizacionUsd`, así que el chip llega con el dato puesto en vez de
  parpadear entre "sin caja" y "caja abierta" en cada carga.
- **`Esc` vacía el carrito con confirmación en dos pasos, no con `confirm()`
  ni con un deshacer.** El primer `Esc` arma la confirmación (la leyenda bajo
  el botón cambia a "Esc de nuevo para vaciar el carrito") y se desarma solo a
  los 3 segundos, o apenas se toca cualquier línea del carrito; sólo el
  **segundo** `Esc` vacía de verdad. Mismo mecanismo que ya usa `AnularVenta`
  (`app/(app)/ventas/formularios.tsx`) para "esto es irreversible pero
  frecuente": sin diálogo (que además competiría por la misma tecla con el
  manejo propio de Escape de cualquier panel modal) y sin sumar una
  dependencia de toasts para un vaciado deshacible.
- **`Enter` no cobra salvo con el foco en `<body>` (o sin ningún foco), y
  `Esc` se abstiene ENTERO mientras haya un overlay de Radix abierto —
  las dos son allow-lists, no deny-lists, y el porqué es un bug de runtime
  real, no una prolijidad.** La primera versión negaba tagNames concretos
  (`INPUT`, `TEXTAREA`, `SELECT`, `BUTTON`) asumiendo que cualquier otro
  elemento no tiene nada que hacer con su propio Enter — cierto mientras
  medio/moneda eran `<select>` nativos, falso en cuanto pasaron a `Select`
  de shadcn (Radix): Radix no renderiza ningún `<select>`, el trigger es un
  `<button>` y la opción resaltada de un dropdown abierto es un `<div
  role="option">`, que la deny-list dejaba pasar. Verificado en runtime: con
  el carrito armado, abrir "Medio", bajar a "Transferencia" y apretar Enter
  cobraba la venta — porque ni `@radix-ui/react-select` ni
  `DismissableLayer` cortan la propagación del evento hacia `window`, así
  que Enter elegía la opción en Radix Y disparaba el atajo global en el
  mismo golpe, con el medio TODAVÍA no actualizado en React. Con Esc el
  espejo era peor: cerrar el dropdown de "Medio" con Esc armaba el vaciado
  del carrito, y cerrar el de "Moneda" con un segundo Esc lo confirmaba —dos
  Esc sueltos, sin relación con el carrito, alcanzaban para vaciar quince
  ítems. El arreglo tiene dos partes: `puedeDispararCobroDesdeFoco` pasó a
  allow-list (sólo `BODY` o ningún foco dejan pasar Enter), y el listener
  compartido de Enter/Esc se abstiene entero cuando `hayOverlayDeRadixAbierto()`
  encuentra un `[role="listbox"]`/`[role="dialog"]`/`[role="menu"]` montado.
  El mismo problema, sin ningún overlay de Radix de por medio, alcanzaba
  también al mini-form de caja del header (`caja.tsx`): tipear el saldo
  inicial y apretar Escape armaba el vaciado del carrito de al lado, así
  que esos dos mini-forms cortan Escape con `stopPropagation()` en su
  propio `onKeyDown` en vez de depender de la guarda de la pantalla.

**Pendiente**

- **La caja sigue sin arqueo ni pantalla propia**, y `crearVenta` **no** exige
  que haya una caja abierta para cobrar — a propósito: eso rompería el cobro
  de cualquier tenant que no use la caja. El chip del header cubre abrir y
  cerrar; el arqueo es su propio ciclo futuro.

## `/ventas`

El historial por período.

**Qué se puede hacer**

- Filtrar por rango de fechas a mano, o con los accesos rápidos **Hoy / 7 días
  / Este mes**. El default es hoy.
- Ver tres tiles: total del período (el ancla de `--marca` de esta pantalla,
  ver `docs/sistema-de-diseno.md`), ventas cobradas con su promedio, y
  anuladas con lo devuelto.
- Ver el listado dentro de su propia card ("Últimas ventas"), con la columna
  "Cliente" (quién compró, no quién vendió — eso vive en el detalle), cuántos
  artículos, con qué medios se pagó y su estado.
- Ver **"Cómo entró la plata"**: una barra por medio de pago, de un solo color,
  con los dólares convertidos a pesos a la cotización de cada pago —sin
  segunda serie: la maqueta nunca pidió una, ver el comentario de
  `--chart-2` en `test/maqueta.test.ts`—.
- Entrar al detalle de cualquier venta.
- Paginar de a 50, con números de página.

**Decisiones**

- **El total NO suma las anuladas**, y lo dice en pantalla para que nadie tenga
  que deducirlo. Lo devuelto de las anuladas es un agregado APARTE, no el
  mismo número con el filtro invertido.
- **Las anuladas se muestran**: el historial tiene que poder responder qué pasó,
  y esconderlas sería tapar la respuesta. Van con un chip (`ChipEstado`,
  compartido con el panel Resumen del detalle), no con texto suelto: quien no
  distingue el rojo igual ve que la fila está marcada.
- Los tiles cuelgan del **período**, no de la página: colgados de la página, un
  `?p=5` los hacía desaparecer.
- **La columna "Medios" de un pago partido** lista los medios distintos
  separados por "+" (`rotuloDeMedios()`) — decisión de UI sin equivalente en
  la maqueta, que no muestra ningún caso con más de un medio por venta.
- **La columna dice "Cliente" y no "Vendió".** El dato que muestra —el
  comprador— está bien: es más útil en un historial de ventas que quién la
  vendió. El rótulo llegó a decir "Vendió" sobre esa misma columna con el dato
  ya cambiado (hallazgo de la review final del rediseño): un error de la
  maqueta, corregido en el `.pen` y no sólo en el código. **Y saber qué
  empleado hizo cada venta ya no se puede desde este listado** — antes de este
  rediseño la columna mostraba el vendedor, y esa capacidad se resignó a
  cambio de mostrar el cliente: hoy hay que abrir venta por venta y mirar su
  panel Resumen para verlo.
- El filtro es `method="get"`: anda sin JavaScript y la URL con el rango se
  comparte. Los chips de rango rápido son links por el mismo motivo.
- El "hoy" se calcula en el huso de Buenos Aires y no en el del servidor, que
  está en Ashburn: sin eso, a las 22:00 "las ventas de hoy" mostraría las de
  mañana.
- Una fecha malformada en el query string cae en hoy en vez de servir un 500.
- El panel de medios **no se dibuja si no hay pagos** — un período puede tener
  ventas y ningún pago si están todas anuladas, y un panel en blanco se lee
  como que algo se rompió.
- **No hay link "Ver todas".** La maqueta lo dibuja —probablemente el residuo
  de un card de dashboard reusado, no una decisión sobre esta pantalla en
  particular—, pero esta pantalla ya es el listado completo del período que se
  está mirando: no hay un "todas" más grande adonde ir sin sumar un modo sin
  rango, que es lógica de consulta nueva. Una versión anterior lo dibujaba
  igual, apuntando a `/ventas` sin filtro (que resuelve al default de hoy) —
  parado en un rango más amplio, ese link llevaba a MENOS ventas, no a más
  (hallazgo de la review final). Si el razonamiento de por qué no hay un
  destino mejor es correcto, la conclusión es no dibujar el link, no dibujarlo
  apuntando a un subconjunto.

## `/ventas/[id]`

El detalle de una venta: qué se vendió, cómo se pagó, y un resumen.

**Acciones**: `anular`.

**Qué se puede hacer**

- Ver los ítems con su SKU (o "Servicio" si no lleva stock), cantidad, precio
  unitario y subtotal.
- Ver los pagos con su medio, moneda, cotización (sólo en los pagos en
  dólares), monto y su equivalente en pesos.
- Ver el panel **Resumen**: fecha y hora, quién la vendió, el cliente (o
  "Consumidor final"), el estado y el comprobante.
- **Anular la venta** — sólo el dueño, y sólo mientras siga cobrada.

**Decisiones**

- El guard de dueño está **en la action**, no sólo en la pantalla: una server
  action se invoca sin pasar por ningún componente. `puedeAnular()` en
  `page.tsx` sólo decide si el botón se ofrece.
- Anular **no borra los movimientos de stock originales**: genera movimientos
  compensatorios. Por eso el aviso puede decir "el stock volvió al inventario"
  sin mentir, y el historial del artículo sigue explicando qué pasó.
- **La "Zona de riesgo" es texto permanente, visible a cualquier rol** —no
  sólo al dueño—: explica qué pasa y por qué un empleado no tiene el botón. Se
  oculta entera una vez la venta está anulada, porque ya no hay nada que
  advertir sobre una acción que no se puede repetir.
- **"Comprobante" dice "Sin factura ARCA", fijo.** No existe `model Factura` en
  el schema (ver CLAUDE.md, *Decisiones abiertas del modelo de datos*) y hoy
  ninguna venta tiene comprobante fiscal, así que el texto es exactamente
  cierto para todas. Cuando ARCA se integre, este campo pasa a leer del
  modelo — no antes.

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
- El encabezado (`components/shell/encabezado.tsx`, ciclo del shell) lleva el
  subtítulo fijo "Se agrega al catálogo del local": no depende de ningún dato
  de la pantalla, así que no hace falta una consulta para mostrarlo.

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

## `/servicio-tecnico`

El tablero de órdenes: qué equipos hay en el local y en qué anda cada uno.

**Qué se puede hacer**

- Ver las órdenes **abiertas** (los siete estados que no son `ENTREGADO`).
- Filtrar por estado con los chips, que traen el conteo de cada uno.
- Buscar por número de orden, cliente, marca, modelo o IMEI.
- Paginar de a 50.

**Decisiones**

- **Ordena la más vieja primero, al revés que `/ventas`.** En ventas lo último
  es lo que importa; acá lo que duele es el equipo que lleva tres semanas en el
  estante.
- **Buscar sale del filtro por defecto.** Sin búsqueda se muestran las abiertas;
  buscando se busca sobre **todas**, incluidas las entregadas y las anuladas.
  Una orden entregada tiene que poder encontrarse otra vez —el cliente vuelve
  con el mismo equipo—, y "por defecto" quiere decir cuando nadie pidió otra
  cosa. Buscar es pedir otra cosa.
- **Los contadores cuentan todas las órdenes vivas, no lo que el filtro
  muestra.** Si contaran lo filtrado, elegir "Listo" pondría el resto en cero y
  no habría cómo volver. El chip sin filtro, en cambio, cuenta las **abiertas**,
  porque es el que devuelve al listado por defecto y su número tiene que ser el
  de ese listado.
- **El número se busca como número, no como texto**: `?q=42` encuentra la orden
  42 y no las que contienen un 4 y un 2. Y se recorta contra el techo de un
  `int4` antes de tocar Prisma: un IMEI tiene 15 dígitos, ~166.000 veces ese
  techo, y pasarlo crudo no daba "no encontré nada" sino un 500 — justo el
  primer camino que iba a recorrer alguien leyendo el placeholder, que dice
  "IMEI".
- `?p` se trunca y se limita, por lo mismo que en `/inventario`.

## `/servicio-tecnico/nuevo`

La recepción del equipo en el mostrador.

**Acciones**: `recibirEquipo`.

**Qué se puede hacer**

- Buscar al cliente por nombre o teléfono, o **crearlo al vuelo** escribiendo
  nombre y teléfono.
- Cargar marca, modelo, IMEI o número de serie y clave de desbloqueo.
- Anotar la falla declarada por el cliente, los accesorios entregados y los
  daños visibles.
- Al guardar, ir derecho al ticket.

**Decisiones**

- **El cliente se busca, no se elige de una lista.** Antes había un desplegable
  con los primeros 50: pasados los 50, los que ordenaban después del corte no se
  podían elegir **nunca**, así que el mostrador creaba un duplicado en cada
  visita de esa gente. Con la tabla vacía se ve igual; con un local de un año
  adentro, no.
- **El cliente nuevo nace adentro de la transacción de la orden**, no antes.
  Creado aparte y comiteado por su cuenta, el segundo submit de un doble click
  creaba un segundo "Juan Pérez" y recién después devolvía la orden que ya
  existía: la clave de idempotencia protegía la orden y no al cliente.
- **Quién recibió sale de la sesión, nunca del formulario**, que lo manda el
  navegador.
- El `redirect()` va **fuera** del `try`: señaliza con una excepción, y adentro
  del `catch` el traductor de errores la relanzaría como si fuera un bug. Mismo
  cuidado que `app/login/acciones.ts`.

## `/servicio-tecnico/[id]`

La ficha de una orden: moverla de estado, diagnosticarla y leer su historia.

**Acciones**: `moverEstado`, `diagnosticar`, `anular`.

**Qué se puede hacer**

- Ver el equipo, el cliente, la falla y lo que se anotó al recibirlo.
- **Mover el estado**, con una nota opcional. Sólo aparecen las transiciones
  legales desde donde está.
- **Cargar el diagnóstico** y el monto estimado del presupuesto.
- Llamar al cliente con un toque (el teléfono es un `tel:`, no texto suelto: es
  el gesto que se hace cuando el equipo queda listo).
- Reimprimir el ticket.
- Leer la bitácora completa.
- **Anular la orden** — sólo el dueño.

**Decisiones**

- **El estado salió del título y bajó al cuerpo (ciclo del shell).** El título
  ahora es "Orden #N · marca modelo" —lo que identifica al equipo—, y el
  subtítulo dice "Ingresó el DD/MM/AAAA · hace N días en el local" (`hoy` para
  0, singular para 1). El estado en sí quedó como un párrafo al principio del
  cuerpo ("Estado actual: X"), porque el encabezado de 66 px es común a las
  diez pantallas y no tiene lugar para un dato que sólo ésta necesita. El
  cálculo de los días es `lib/ordenes-de-trabajo/antiguedad.ts` (`diasEnElLocal`),
  contado por fecha CALENDARIO de Buenos Aires y no por milisegundos.
- **El grafo de estados es la fuente de verdad y el servidor lo vuelve a
  consultar.** La pantalla dibuja los botones a partir de la misma tabla, pero
  una UI que esconde un botón no es una validación.
- **`SIN_REPARACION` y `RECHAZADO` no son terminales, y es la decisión que más
  define el modelo.** El equipo sigue en el estante hasta que el cliente lo
  viene a buscar, así que el único estado final es `ENTREGADO` — se entrega
  arreglado, sin arreglar, o porque no aceptaron el presupuesto. Cuál de las
  tres fue sale de la bitácora, que es para lo que existe.
- **La bitácora es append-only forzada en la base**, no por convención: a
  `arandano_app` se le revocan `UPDATE` y `DELETE` sobre `eventos_orden` —y
  también el `DELETE` sobre `ordenes_de_trabajo`, porque la FK es
  `ON DELETE CASCADE` y borrar una orden se llevaba su historia entera sin tocar
  la tabla que se acaba de cerrar—. Un historial que se puede editar no contesta
  la única pregunta que se le hace: "hace dos semanas que está acá, ¿qué pasó?".
- Anular es lo único destructivo del módulo, y por eso lleva el mismo corte que
  anular una venta: guard de dueño **en la action**.
- El guard de uuid está por lo mismo que en `/ventas/[id]` e `/inventario/[id]`:
  Prisma tipa el parámetro por columna, así que un id sin forma de uuid lo
  rechaza antes de consultar, y eso en un server component es un 500 servido
  desde la barra de direcciones.

## `/servicio-tecnico/[id]/ticket`

El comprobante de recepción en papel térmico de 80 mm. Se imprime solo al
cargar.

**Qué se puede hacer**

- Nada: es una pantalla de una sola función, que dispara el diálogo de impresión
  al abrirse. Se llega desde la recepción o desde "Reimprimir ticket". Sin
  JavaScript se ve igual y se imprime con Ctrl+P — el `window.print()` es una
  comodidad para el mostrador, no el mecanismo.

**Decisiones**

- **Salen dos copias en una sola impresión**, la del cliente y la del local, y
  la **línea de corte va una vez y entre las dos** — no adentro de cada una.
  Cuando vivía adentro, quien cortara por la línea rotulada "COPIA LOCAL" le
  arrancaba el encabezado a la copia del local, que es donde está el número
  grande.
- **La clave de desbloqueo no se imprime.** El dato llega igual al componente, y
  eso es a propósito: si no llegara, el test que verifica que no aparece pasaría
  por accidente y nadie sabría que la decisión sigue viva.
- **Es la única superficie del producto que no usa los tokens de
  `app/globals.css`**: escribe `#000` sobre `#fff`. La excepción está declarada
  en `docs/sistema-de-diseno.md` con su razón y con lo que la haría caducar —una
  térmica quema un solo color y el fondo es el papel, así que un token de tema
  ahí no significaría nada.
- El cuerpo vive en `cuerpo.tsx`, separado de `page.tsx`, para que el test lo
  pueda renderizar sin arrastrar `lib/db.ts` —que construye su Pool al
  importarse— y por lo tanto sin base.
- La ruta está en `RUTAS_SIN_SMOKE`: no hay id de orden que pedirle al gate sin
  sembrar datos.

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
- El encabezado (ciclo del shell) muestra un subtítulo con dos números
  derivados: cuánta gente hay y cuántos dueños activos (`contarDuenosActivos`,
  `lib/usuarios/resumen.ts`). Se calculan sobre el mismo `findMany` que ya trae
  la tabla, no con una consulta aparte.

<!-- pantallas:fin -->

## Lo que hereda toda pantalla de la aplicación

Todas las de arriba que no son `/` ni `/login` cuelgan de `app/(app)/`, y de ahí
heredan cuatro cosas sin que nadie las repita:

- **El guard de sesión** (`exigirSesion` en el layout). Una ruta nueva bajo
  `(app)` nace protegida; `test/rutas-con-guard.test.ts` falla si alguna queda
  afuera del grupo sin declarar por qué.
- **`robots: noindex`**. Son datos de un local.
- **El shell**: el cartel con el nombre del local, quién sos, cómo salir, y la
  navegación.
- **El encabezado de 66 px** (`components/shell/encabezado.tsx`, ciclo del
  shell): el único `<h1>` de la pantalla, un subtítulo opcional y un slot de
  acciones a la derecha. Las diez lo usan; ninguna dibuja su propio `<h1>`.

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
