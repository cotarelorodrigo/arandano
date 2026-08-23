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

Reescrita entera en las Tasks 3-5 del cierre del rediseño (2026-08-22) contra
`design/arandano.pen`, frame `Sitio / Landing`. Antes tenía nueve piezas sin
copy literal de la maqueta; ahora son las siete que la maqueta dibuja, en
`app/sitio/secciones.tsx`.

**Qué se puede hacer**

- En `arandano.app`: leer qué es el producto —siete secciones: Nav, Hero,
  Módulos, Rubros, Planes, Cierre, Pie— y dejar un contacto (WhatsApp o mail,
  un solo campo).
- En `flor.arandano.app`: nada — redirige a `/vender` si hay sesión, o a
  `/login` si no.

**Decisiones**

- **Es la única página que se indexa.** Toda pantalla de tenant lleva
  `robots: noindex`: un local no quiere su punto de venta en Google. Se decide
  acá y no en un `robots.txt`, que sería el mismo archivo para el ápex y para
  todos los subdominios — justamente la distinción que hay que hacer.
  `test/indexacion.test.ts` lo fija.
- **El retrato del carrito (Hero → Muestra) sigue al `/vender` real** —Task 3—.
  Se había quedado atrás del rediseño del carrito (tabla pelada, sin stepper,
  sin chip de stock, sin banda de total): ahora reconstruye el marcado nuevo
  con los mismos componentes de shadcn y el mismo formateo de plata
  (`lib/formato/mostrar.ts`), atado por test. **No** importa
  `app/(app)/vender/punto-de-venta.tsx` directo: ese archivo lleva `'use
  client'`, y un export de un módulo cliente le llega a un componente de
  servidor como un proxy no invocable (mismo motivo por el que
  `lib/formato/mostrar.ts` es el punto de encuentro). El cartel con el nombre
  del local que mostraba antes se sacó: el `.pen` ya no lo dibuja adentro de
  la card — se mudó a la barra de navegador que envuelve al retrato, con la
  URL `flor.arandano.app/vender`.
- **Módulos** (arquitectura núcleo + tres módulos) y **Rubros** (grilla de doce
  rubros con qué módulos activa cada uno) reemplazan a las viejas "Lo que
  hace" (seis filas numeradas) y "Rubros" (tres cards de módulo sin grilla).
  El estado de cada módulo ("Disponible" para Órdenes de trabajo, "En camino"
  para Turnos y Gastronomía) sale de un dato (`MODULOS`, con su campo
  `estado`), no de tres bloques de JSX con el texto escrito a mano — el día
  que Turnos se entregue, cambia en un solo lugar.
- **Planes muestra precio real por primera vez** ($ 24.900 / $ 44.900 /
  $ 79.900 / "A medida"), con el checklist de features de cada uno y el botón
  "Hablemos" del Premium (los demás dicen "Probar 5 días").
- **La sección `Direccion`** (la caja con la URL de ejemplo
  `https://florcelulares.{dominio}`) **se eliminó** — decisión 3 del plan del
  cierre: el `.pen` no la dibuja en ningún lado del frame, no es un silencio de
  estado de reposo, es una sección entera que el rediseño no incluye.
- **El formulario de captura pasó de cinco campos a uno** (decisión 1): "Tu
  WhatsApp o tu mail". `enviarLead` clasifica el valor por su forma —con
  arroba va a `email`, si no va a `whatsapp`— y `nombre`/`rubro` quedan en
  NULL. El motivo no es sólo la maqueta: un trial de cinco días "con muchos
  registros que no convierten" (CLAUDE.md) no se sostiene con cinco campos
  delante. El mismo `<Formulario>` vive en el Hero (`textoBoton="Quiero
  probarlo"`, variante clara) y en el Cierre (`textoBoton="Empezar"` default,
  variante oscura sobre `--marca`) — un solo componente, dos invitaciones a
  la acción, porque el `.pen` le pone un texto de botón distinto a cada una.
- **La landing tiene tres superficies de `--marca`** (la card "Núcleo" en
  Módulos, la card "Profesional" destacada en Planes, y la franja de Cierre),
  no una — `docs/sistema-de-diseno.md` explica por qué eso no afloja la regla
  de "una por pantalla": la unidad de cuenta para una página que se recorre
  con scroll es la banda visible, no el documento entero.
- Describe el producto completo, **incluido lo que todavía no está
  construido** (caja, ARCA, catálogo, bot, Turnos, Gastronomía). Es una
  decisión consciente.
- `leads` es la primera tabla del schema **sin `tenant_id`**, así que no la
  protege RLS sino el privilegio: `arandano_app` sólo inserta, y los leads se
  leen con `npm run leads`. `nombre`, `email` y `rubro` son nullable desde la
  migración `lead_de_un_campo` — un lead nuevo trae sólo el contacto que se
  clasificó, un lead viejo (de los cinco campos) sigue trayendo todo.

## `/login`

Entrar a un local. Usuario y contraseña, sin magic link ni OAuth (rediseño de
`design/arandano.pen`, frame `App / Login`).

**Acciones**: `entrar`.

**Qué se puede hacer**

- Entrar con mail y contraseña.
- Mostrar u ocultar la contraseña con el ícono de "ojo" dentro del campo.

**Decisiones**

- **No hay login en el ápex**: `arandano.app/login` da 404. Entrar es siempre
  entrar a un local, y por eso el paño de la izquierda lleva el nombre del
  tenant en grande y "Arándano" chico arriba — el cartel es del local, la marca
  firma abajo.
- **No hay "olvidé mi contraseña".** No hay proveedor de mail, y una pantalla de
  recupero que promete un mail que nunca sale es peor que no tenerla. El
  recupero real es `npm run usuario:clave` en el servidor, o el dueño desde
  `/usuarios` — el texto de ayuda bajo el botón lo dice así, literal.
- Un tenant `SUSPENDIDO` recibe 403, no 404: existe, pero no puede entrar.
- El `redirect()` de esta action es el único camino que Next resuelve haciendo
  un `fetch()` contra sí mismo, con un `Host` distinto del que pidió el
  navegador. Ahí vivió un bug que dejaba la home en 404 después de cada login,
  y por eso `scripts/smoke.sh` entra **por la pantalla** además de por el
  endpoint.
- **El paño suma marca, bajada y pie** (Task 2 del cierre del rediseño): un
  logo cuadrado junto a "Arándano" (los dos en `--marca-soft`, no
  `--marca-dim` — consultado en vivo con el MCP de Pencil, contra lo que decía
  el relevamiento escrito), una bajada bajo el nombre del local, y un pie con
  el subdominio del tenant (`${subdominio}.${dominioBase}`, armado con
  `piezasDeOrigen()`) más la nota "Cada local entra por su propia dirección."
  `justify-content` del paño pasa de `center` a `space-between` para anclar
  estas tres piezas — la animación de la persiana en sí no se tocó.
- **El formulario suma su propio título** ("Entrar" + "Usuario y contraseña
  del local."), un rol nuevo de la escala tipográfica ("H1 de login", Archivo
  28px/600). No es la Card que un ciclo anterior sacó a propósito: aquélla
  repetía el nombre del local adentro del panel, éste es un rótulo del
  formulario en sí.
- El botón "Entrar" suma el ícono `arrow-right`; el campo de contraseña, el
  ícono `eye`/`eye-off` de mostrar/ocultar — mismo patrón que `ScanBarcode` en
  `punto-de-venta.tsx`: un botón con ícono DENTRO del `Input`, sin sumar
  ningún componente de shadcn nuevo.

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
  segunda serie: la maqueta nunca pidió una (`docs/sistema-de-diseno.md`,
  sección "Cómo se verifica", el párrafo sobre la reescritura sin `recharts`
  que sacó `--chart-1` y `--chart-2` del repo)—.
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

El listado de artículos, con buscador, filtro de tipo y chips de estado
(rediseño de `design/arandano.pen`, frame `App / Inventario`).

**Qué se puede hacer**

- Buscar por nombre o SKU.
- Filtrar por tipo con el segmentado **Todos / Productos / Servicios**.
- Ver stock, precio, tipo y la categoría (dos niveles, p. ej. "Accesorios ·
  Protección" — texto libre que el dueño tipea al cargar el artículo).
- Mostrar u ocultar los artículos desactivados.
- Paginar de a 50, con botones numerados.

**Decisiones**

- El conteo de artículos con stock negativo se calcula sobre **lo que el
  listado está mostrando** (búsqueda + tipo + desactivados), no sobre toda la
  tabla: si no, el subtítulo diría "3 con stock negativo" mientras la búsqueda
  filtrada no muestra ninguno. Con la tab "Servicios" activa el conteo se
  fuerza a 0 sin consultar — ningún servicio tiene stock.
- La celda de estado (`chip-estado.tsx`) es una de tres, con prioridad fija:
  **Desactivado** gana siempre sobre **Stock negativo** o **Queda poco** —son
  historia en ese punto, no una alerta de reponer—, y un servicio nunca lleva
  chip de stock. "Queda poco" usa un umbral fijo para todo el catálogo
  (`STOCK_BAJO_UMBRAL`, hoy 5 unidades): el modelo no tiene un umbral por
  artículo, así que uno solo para todos es la opción barata frente a una
  migración que este ciclo no toma.
- La baja es **lógica** (`desactivadoEn`), nunca un `DELETE`: un artículo
  borrado se llevaría puesto el historial de las ventas que lo incluyen.
- `?p` se trunca y se limita: `?p=2.3` daría un `skip` con decimales y
  `?p=1e300` uno fuera del rango de un `Int`, y Prisma rechaza los dos con un
  error que nadie atrapa — un 500 servido desde la barra de direcciones.

## `/inventario/nuevo`

El alta de un artículo, en tres cards: qué se está cargando, sus datos y el
stock inicial (`design/arandano.pen`, frame `App / Artículo nuevo`).

**Acciones**: `altaArticulo`.

**Qué se puede hacer**

- Elegir Producto o Servicio con dos tarjetas seleccionables (no un
  `<select>`): un servicio oculta la card de stock inicial entera.
- Cargar nombre, categoría (opcional) y precio.
- Dejar el SKU vacío y que se genere solo, con el próximo código libre
  mostrado como ayuda.
- Cargar stock inicial y su costo unitario, que nace como movimiento y no como
  un número suelto.

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
- **"Cancelar" y "Guardar artículo" viven en el Topbar**, no al pie del
  formulario: el `<form>` envuelve encabezado y cuerpo por igual
  (`className="contents"`, sin alterar el layout de `SidebarInset`) porque el
  botón que dispara vive arriba y el HTML exige que sea descendiente del
  `<form>`. `FormularioDeAlta` (`formularios.tsx`) arma la pantalla entera,
  ya no sólo el cuerpo.

## `/inventario/[id]`

La ficha de un artículo, en dos columnas: a la izquierda las métricas, mover
stock y el historial; a la derecha los datos editables y "Cómo se movió"
(`design/arandano.pen`, frame `App / Artículo ficha`).

**Acciones**: `guardarArticulo`, `ingresarMercaderia`, `corregirPorConteo`,
`bajaArticulo`, `reactivarArticuloAccion`, `exportarHistorialCsv`.

**Qué se puede hacer**

- Ver tres tiles: **En stock** (pintado con `--marca`, el ancla de esta
  pantalla), **Precio de venta** (con hace cuánto se actualizó) y **Último
  costo** (con el margen contra el precio actual). Un servicio sólo muestra el
  de precio.
- Editar nombre, categoría, precio y código desde la card "Datos".
- **Ingresar mercadería** con su costo unitario y una nota (factura, proveedor).
- **Corregir por conteo**: se escribe el stock contado, no el delta.
- Desactivar y reactivar el artículo.
- Ver el historial completo de movimientos, con chip de motivo, la celda
  "Detalle" (combina quién y qué, según el motivo) y la columna **Queda**
  (el saldo después de cada movimiento).
- Ver **"Cómo se movió"**: seis barras con las unidades vendidas por mes.
- **Exportar CSV** con el historial completo (sin el límite de la tabla en
  pantalla).

**Decisiones**

- En la corrección por conteo **el delta lo calcula el servidor, adentro de la
  transacción, contra el stock del momento**. Si lo calculara el navegador, una
  venta ocurrida entre que se abrió la pantalla y se apretó el botón quedaría
  pisada.
- **El costo unitario del ingreso dejó de ser un dato que nadie lee.** Es
  opcional, y el tile "Último costo" es su primer lector: busca el ingreso con
  costo cargado más reciente (no el ingreso más reciente a secas, que puede no
  tenerlo) y calcula el margen contra el precio de venta actual. Sin ningún
  ingreso con costo, el tile muestra "—", nunca un número inventado.
- **La columna "Queda" se reconstruye, no se guarda.** `MovimientoStock` no
  tiene columna de saldo por fila, y `Articulo.stock` es apenas el caché de la
  suma de sus movimientos. `calcularSaldos` (`historial.tsx`) recorre los
  deltas hacia atrás desde el stock actual — ver el comentario de esa función
  antes de sumarle una columna nueva para "optimizarla".
- **"Cómo se movió" se agrega en JavaScript, no con `$queryRaw`**: la
  extensión de `lib/tenant/prisma.ts` intercepta operaciones de modelo para
  setear `arandano.tenant_id`, no raw queries — un `$queryRaw` sin esa
  variable de sesión choca contra RLS y devuelve cero filas, en silencio
  (mismo hallazgo que ya dejó anotado `/ventas` para su panel de medios).
- **"Cómo se movió" excluye las ventas anuladas**, mismo criterio que
  `/ventas` ("el total NO suma las anuladas"): la consulta de movimientos
  filtra por `venta: { anuladaEn: null }`, así que una venta anulada no sigue
  contando como vendida sólo porque el `ANULACION_VENTA` que le devolvió el
  stock cae en un mes distinto.
- **"Exportar CSV" es un server action que arma el CSV en memoria** y lo
  devuelve como string — no hay librería, endpoint nuevo ni streaming. El
  botón lo convierte en una descarga con un `Blob` del lado del cliente,
  porque un server action no puede fijar `Content-Disposition`. Las notas se
  escapan por RFC 4180 (comillas y comas), y no está restringido a dueño: es
  de sólo lectura, de datos que la pantalla ya le muestra a cualquier sesión.
- **"Guardar cambios" y "Desactivar"/"Reactivar" viven en el Topbar.** Como el
  botón está lejos del `<form>` que dispara (el de "Guardar cambios" en la
  card "Datos", el de "Desactivar" invisible), cada uno se asocia por el
  atributo HTML `form={id}`. Los dos hooks de `useActionState` viven en un
  único componente (`FichaDeArticulo`, `formularios.tsx`) que arma encabezado
  y cuerpo juntos — repartir el hook entre dos componentes separados hubiera
  dejado el botón del Topbar sin enterarse nunca de que el `<form>` remoto
  terminó de enviarse.
- Los movimientos llevan el motivo (`VENTA`, `ANULACION_VENTA`, `AJUSTE`,
  `INGRESO`). Sumar un motivo es una migración aditiva: es el punto de extensión
  que el núcleo le promete a los módulos.

## `/servicio-tecnico`

El tablero de órdenes: qué equipos hay en el local y en qué anda cada uno.

**Qué se puede hacer**

- Ver las órdenes **abiertas** (los ocho estados que no son `ENTREGADO` —desde
  el ciclo del rediseño, con `APROBADO` sumado al medio del flujo).
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

**Rediseño contra `design/arandano.pen`** (ciclo de las tres pantallas de
Servicio Técnico):

- **Cada chip de fila lleva color e ícono propios**, salidos de un único mapeo
  (`ESTADO_VISUAL`, `lib/ordenes-de-trabajo/estados.ts`) que también usan el
  chip del tablero y la bitácora de la ficha — un solo lugar para no repetir la
  paleta en tres archivos. Una orden **anulada** nunca usa el chip de color de
  su estado viejo (mentiría sobre una orden que ya no está viva): se pinta
  neutro, "Anulada (Estado)".
- **El listado vive dentro de una card**, con encabezado propio y una `<Table>`
  real de cinco columnas (Orden/Equipo/Cliente/Ingresó/Estado) — reemplaza al
  `<ul>` suelto de antes del rediseño.
- **`ENTREGADO` va al final de la fila de chips**, no en su posición "natural"
  después de `LISTO`: es el orden exacto que dibuja la maqueta, y `ESTADOS`
  —la fuente que también alimenta `TRANSICIONES` y el guard `esEstado`— se
  reordenó para decir la verdad sobre qué ve el tablero.
- **El subtítulo del Topbar** ("N equipos en el local · el más viejo hace N
  días") se completó en este ciclo: el comentario que dejaba pendiente el ciclo
  del shell decía textualmente "para el ciclo del tablero", y éste lo fue.

## `/servicio-tecnico/nuevo`

La recepción del equipo en el mostrador.

**Acciones**: `recibirEquipo`.

**Qué se puede hacer**

- Buscar al cliente por nombre o teléfono y elegirlo de una lista de cards —o
  **crearlo al vuelo** escribiendo nombre y teléfono.
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

**Rediseño contra `design/arandano.pen`** (ciclo de las tres pantallas de
Servicio Técnico):

- **El buscador pasa de `<select>` a cards seleccionables**, con nombre,
  teléfono y "N órdenes previas" — dato que antes no se calculaba
  (`buscarClientes`, `lib/clientes/administrar.ts`, ya traía sólo `id, nombre,
  telefono`). `Cliente.ordenes` ya era una relación del schema, así que sumar
  el conteo fue un `_count` de Prisma, no una migración. La redacción
  ("1 orden previa" / "N órdenes previas") vive en `rotuloOrdenesPrevias`, en
  el mismo archivo — la ficha de la orden (`/servicio-tecnico/[id]`) pide el
  mismo dato para su card Cliente, aunque con otra redacción (el número
  pelado, sin la frase).
- **La selección es estado de React, no un grupo de radios nativo.** El
  componente ya es `'use client'` por `useActionState`, así que no había
  pureza que preservar, y el estado es lo que permite deseleccionar un cliente
  elegido por error con sólo empezar a tipear en "Cliente nuevo" — sin eso, un
  clic de más dejaba la orden a nombre de quien había quedado seleccionado
  antes, sin que lo tipeado después se usara (`crearOrden` prioriza
  `clienteId` sobre `clienteNuevo` si vienen los dos).
- **Elegir un cliente EXISTENTE de la lista requiere JavaScript, desde este
  cambio** (hallazgo I6 de la review final). El `<select>` nativo de antes
  andaba sin una sola línea de JS —el comentario que lo decía se borró en el
  mismo commit que sacó el `<select>`—, y las cards seleccionables de ahora son
  un `<button onClick>` que sólo fija estado de React: sin JS, todo submit
  toma la rama "cliente nuevo". **No falla en silencio**: con los campos de esa
  card vacíos, `crearClienteEn` tira `NOMBRE_VACIO` y el `Aviso` lo muestra. Lo
  que se pierde es la posibilidad de elegir un cliente ya cargado sin JS —quien
  quisiera avanzar así terminaría tipeando el nombre de nuevo, el duplicado que
  este módulo evita a propósito—. El buscador de texto (recargar con
  `?cliente=`) y el alta al vuelo siguen andando sin JS, igual que siempre.
  Decisión: dejarlo así —el producto entero ya exige JavaScript (`/vender` no
  existe sin él) y el fallo es ruidoso, no silencioso—, mientras que revertir la
  propiedad significaría volver a un control nativo (radio oculto con `label`)
  sólo para este único caso.
- **"Guardar e imprimir ticket" y "Cancelar" suben al Topbar.** Como el
  buscador de cliente necesita su propio `<form>` de método GET —y un `<form>`
  no puede anidar otro—, el `<form>` real que dispara `recibirEquipo` queda
  invisible (mismo mecanismo que `FORM_BAJA_ARTICULO` en
  `app/(app)/inventario/formularios.tsx`) y cada campo de las cuatro cards
  apunta a él con el atributo HTML `form=`, sin importar dónde caiga en el DOM.
- **Cuatro cards**: Cliente (buscador + resultados + alta al vuelo), Equipo
  (con el aviso de que la clave no se imprime), Qué le pasa (falla, accesorios,
  daños) y "Qué se imprime" — un panel puramente informativo, sin inputs, con
  los cuatro puntos que ya explicaba el ticket.

## `/servicio-tecnico/[id]`

La ficha de una orden: moverla de estado, diagnosticarla y leer su historia.

**Acciones**: `moverEstado`, `diagnosticar`, `anular`.

**Qué se puede hacer**

- Ver el equipo, el cliente (con sus órdenes previas) y la falla declarada.
- **Mover el estado**, con una nota opcional, desde el paño violeta "ESTADO
  ACTUAL". Sólo aparecen las transiciones legales desde donde está.
- **Cargar el diagnóstico** y el monto estimado del presupuesto.
- Llamar al cliente con un toque (el teléfono es un `tel:`, no texto suelto: es
  el gesto que se hace cuando el equipo queda listo).
- Reimprimir el ticket.
- Leer la bitácora completa, más nueva primero.
- **Anular la orden** — sólo el dueño.

**Decisiones**

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

**Rediseño contra `design/arandano.pen`** (ciclo de las tres pantallas de
Servicio Técnico):

- **El paño "ESTADO ACTUAL" reemplaza al `<p>` de texto plano** que un ciclo
  anterior bajó al cuerpo esperando exactamente este paño (el comentario lo
  decía). Es un bloque pintado con `--marca`: rótulo, estado y "hace cuánto"
  arriba; "MOVER A" y los botones de transición abajo, sólido el camino
  principal (el primero de la lista) y fantasma el resto. "Hace cuánto" mide el
  tiempo desde el **último evento de la bitácora**, no desde que el equipo
  entró al local (eso ya lo dice el subtítulo del Topbar) — por invariante, el
  evento más reciente siempre trajo la orden a su estado actual.
- **Los botones son los que devuelve `TRANSICIONES`, no los que dibuja la
  maqueta.** Para `EN_REPARACION` el `.pen` muestra Listo / Sin reparación /
  Rechazado; el grafo real de este módulo es Listo / Presupuestado / Sin
  reparación, sin Rechazado ahí. **No se tocó** — agregar un estado que falta
  (como `APROBADO`, tarea de un ciclo anterior) es llenar un hueco evidente;
  cambiar a qué estados se puede ir desde uno existente es rediseñar el flujo
  del negocio, y esa decisión no le toca a un ciclo de presentación. Queda
  como pregunta abierta para el dueño del producto (ver `CLAUDE.md`).
- **Una orden anulada no ofrece transiciones**, aunque `TRANSICIONES` diga que
  las hay desde su estado: anular es una columna aparte
  (`OrdenDeTrabajo.anuladaEn`), no un estado, así que el grafo no puede
  expresarlo por su cuenta — `transicionesDisponibles(estado, anulada)` le
  suma esa segunda razón.
- **La bitácora pasa a línea de tiempo, más nueva primero** (al revés que
  antes del rediseño), con el ícono y el color de `ESTADO_VISUAL` — el mismo
  mapeo que ya pinta los chips del tablero, no uno nuevo. La maqueta pinta
  distinto el evento de apertura ("Equipo recibido", verde) del resto de las
  apariciones de `RECIBIDO` (gris) — inconsistencia de la propia maqueta que
  este ciclo no replicó: usa el mapeo real en todos los casos.
- **Las cards Cliente/Equipo/Falla se rehacen contra la maqueta.** Cliente
  suma "Órdenes previas" (mismo dato y helper de redacción que el buscador de
  `/servicio-tecnico/nuevo`, ver esa sección — **con la orden actual restada**,
  hallazgo I3 de la review final: `Cliente.ordenes` cuenta TODAS las órdenes,
  la que se está mirando incluida, y sin restarla un cliente nuevo veía
  "Órdenes previas: 1" en su propia primera orden) y un botón "Llamar al
  cliente".
  Equipo **pierde la fila de "Daños visibles"**: la card del rediseño enumera
  cuatro filas exactas, no cinco. **La maqueta no tira ese dato, lo muda a la
  bitácora**: la nota del evento de apertura ("Equipo recibido") es
  literalmente el texto que el mostrador tipeó ahí (nodo `C1Ip0` del `.pen`,
  "Marco golpeado en la esquina inferior derecha") — hallazgo I1 de la review
  final, que corrigió una primera versión donde el dato quedaba de sólo
  escritura (se guardaba pero no se veía en ningún lado salvo abriendo el
  diálogo de impresión del ticket). `crearOrden` escribe `danosVisibles` como
  la nota de ese evento, en la misma transacción. Falla y Diagnóstico se
  funden en una sola card (antes eran dos `<section>` separadas): la cita de
  lo que dijo el cliente es de sólo lectura y siempre visible; el formulario
  de diagnóstico se apaga con la orden anulada, igual que antes del ciclo.
- **"Anular orden" y "Reimprimir ticket" suben al Topbar.** El botón de anular
  usa el mismo mecanismo de `<form>` invisible + atributo `form=` que
  `/servicio-tecnico/nuevo`, y sólo existe en el DOM cuando puede aparecer
  (dueño, orden viva) — esconderlo no reemplaza la revalidación de la action
  (`exigirDuenio` + `ORDEN_ANULADA`), es sólo comodidad. **"Anular orden" pide
  confirmación en dos pasos** (hallazgo M5 de la review final del rediseño):
  el primer click arma "¿Sí, anular?"/"Cancelar" en el mismo lugar del Topbar,
  y sólo el segundo dispara la acción — mismo mecanismo que `AnularVenta`
  (`app/(app)/ventas/formularios.tsx`) para "esto es irreversible pero
  frecuente", y no un `confirm()` del navegador. Antes de esto, el botón vivía
  pegado a "Reimprimir ticket" —el que más se aprieta en la pantalla— y un
  solo click ya anulaba.
- **"Quién recibió" dejó de pedirse aparte.** Es siempre el mismo usuario que
  firma el evento de apertura de la bitácora (`crearOrden` le asigna el mismo
  `usuarioId` a los dos), así que ese dato ya sale de ahí sin repetir la
  consulta.

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

El equipo del local (rediseño de `design/arandano.pen`, frame `App /
Usuarios`).

**Acciones**: `altaEmpleado`, `nuevaClave`, `baja`, `alta`.

**Qué se puede hacer**

- Agregar a alguien como `EMPLEADO` o `DUENO` con un control segmentado (no un
  `<select>`), con su contraseña inicial.
- Cambiarle la contraseña a cualquier usuario del local, **incluido uno mismo**
  —el link "Cambiar clave" abre un formulario inline en la propia fila.
- Dar de baja y reactivar personas — "Baja" queda disponible para cualquier
  fila activa que no sea la propia, dueños incluidos (ver más abajo).
- Copiar la clave recién generada con un botón, desde el aviso ámbar.

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
  forma de recuperarla después. El rediseño le suma un bloque ámbar propio
  (`aviso-clave.tsx`, `--warn`/`--warn-soft`) que dice explícitamente las dos
  cosas que antes la pantalla no contaba: que se muestra una sola vez y que las
  sesiones de esa persona ya se cerraron — el servidor ya lo hacía, la
  pantalla no lo decía. `role="alert"` a mano, porque este bloque reemplaza al
  `<Alert>` de shadcn que lo traía siempre.
- El mínimo son **8 caracteres**, y el número no está escrito acá ni en el
  formulario: sale de `ctx.password.config` de Better Auth, para que la
  validación del servidor y la de la librería no puedan desincronizarse.
- El encabezado (ciclo del shell) muestra un subtítulo con dos números
  derivados: cuánta gente hay y cuántos dueños activos (`contarDuenosActivos`,
  `lib/usuarios/resumen.ts`). Se calculan sobre el mismo `findMany` que ya trae
  la tabla, no con una consulta aparte.
- **"Baja" no se esconde para los dueños.** La maqueta sólo dibuja "Cambiar
  clave" en las dos filas de dueño de su ejemplo, pero esconder "Baja" ahí
  quitaría una capacidad que ya existía (dar de baja a OTRO dueño) y dejaría
  sin forma de ejercitar desde la pantalla la regla del último dueño. Se
  interpretó como variedad ilustrativa del mockup, no como una regla nueva.
- **La card "Dos reglas que el sistema no deja romper" es texto fijo, no
  reimplementado**: las dos reglas ya existen en `lib/usuarios/administrar.ts`
  (el lock del último dueño en `desactivar()`, el `session.deleteMany` de
  `resetearClave()`); la pantalla sólo las cuenta.
- Consultado en vivo con el MCP de Pencil: a diferencia de los otros dos
  títulos de card de esta pantalla ("El equipo del local", "Agregar a
  alguien", en Archivo 15px/600), el título de la card de Reglas usa la pila
  del sistema a 13px/700 — el relevamiento escrito los agrupaba a los tres.

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
