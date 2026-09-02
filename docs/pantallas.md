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
  un solo campo). "Entrar a mi local" (Nav) revela un campo de subdominio
  para quien ya es cliente y se olvidó de su dirección (Minor 15 de la
  review final: esta sección no lo mencionaba).
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

**En el teléfono**

Es la pantalla que menos cambia, porque ya tenía tratamiento responsive antes
del ciclo (frame `Móvil / Sitio · Landing`, `yz6Sr`). Lo que sí cambió:

- **Una sola columna.** El Hero deja de ser `grid-cols-[7fr_9fr]`: el título y
  la bajada arriba, el retrato del carrito abajo. Las ocho secciones comparten
  un solo margen lateral (`ANCHO`), 20 px en el teléfono contra 56 en
  escritorio — un cambio en una constante cubre Nav, Hero, Muestra, Módulos,
  Rubros, Planes, Cierre y Pie.
- **El nav se guarda en un `Sheet`.** La maqueta dibuja sólo un ícono de menú
  (nodo `K60WPs`), y los tres links de sección más "Entrar a mi local" **no
  desaparecen**: los reagrupa la hoja. Es el mismo criterio que el resto del
  ciclo — lo que la maqueta no dibuja hay que preguntarse qué pierde el
  producto si se saca, y acá se perdía la navegación entera.
- **Rubros va en dos columnas, no en una.** El nodo `dDugH` dibuja pares; la
  prosa del plan decía "una columna" y mandó la maqueta.
- **El formulario de captura pierde su marco.** El borde, el fondo y el radio
  de 14 px que envuelven al campo y al botón son una pieza **sólo de
  escritorio**: en el teléfono son dos cajas sueltas separadas por 9 px. Vive
  en `app/sitio/formulario.module.css` y no en clases de Tailwind con `lg:`
  porque el color de ese marco se fijaba con `style` inline, y a un estilo
  inline no le gana ninguna clase por especificidad — ninguna media query lo
  habría podido apagar.

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
  logo **circular** junto a "Arándano" (Minor 15 de la review final: esta
  sección lo llamaba "cuadrado" — `border-radius: 13px` sobre 26px es la
  mitad exacta, un círculo, no una esquina redondeada; los dos en
  `--marca-soft`, no `--marca-dim` — consultado en vivo con el MCP de Pencil,
  contra lo que decía el relevamiento escrito), una bajada bajo el nombre del
  local, y un pie con el subdominio del tenant (`${subdominio}.${dominioBase}`,
  armado con `piezasDeOrigen()`) más la nota "Cada local entra por su propia
  dirección." `justify-content` del paño pasa de `center` a `space-between`
  para anclar estas tres piezas — la animación de la persiana en sí no se
  tocó. Y el ancho del paño en escritorio pasa de 50% a 58,33% (840/1440,
  Minor 2 de la review final): el nodo `Formulario` del `.pen` mide 600px
  fijos sobre un frame de 1440, no la mitad.
- **El formulario suma su propio título** ("Entrar" + "Usuario y contraseña
  del local."), un rol nuevo de la escala tipográfica ("H1 de login", Archivo
  28px/600). No es la Card que un ciclo anterior sacó a propósito: aquélla
  repetía el nombre del local adentro del panel, éste es un rótulo del
  formulario en sí.
- El botón "Entrar" suma el ícono `arrow-right`; el campo de contraseña, el
  ícono `eye`/`eye-off` de mostrar/ocultar — mismo patrón que `ScanBarcode` en
  `punto-de-venta.tsx`: un botón con ícono DENTRO del `Input`, sin sumar
  ningún componente de shadcn nuevo.

**En el teléfono**

El paño de marca deja de ser una columna y pasa a ser una **franja superior de
300 px** (`flex-col lg:flex-row`, frame `Móvil / Login`, `Kp4Eg`). Toda la
tipografía del paño se escribe mobile-first en `persiana.module.css`: el
nombre del local a 32 px (contra el `clamp` de escritorio), la bajada a 13, el
logo a 22 y "Arándano" a 13. La persiana en sí —la animación, el travesaño, el
acanalado— no se toca en ningún ancho.

**El pie con el subdominio cambia de casa, y nunca desaparece.** En escritorio
vive dentro del paño, en colores de marca; en el teléfono se muda al fondo del
formulario, empujado por un espaciador, y ahí paga colores de tinta
(`--foreground-soft` / `--muted-foreground`) porque el fondo pasó a ser claro.
Eso obligó a que `FormularioLogin` reciba `dominio` como prop: antes ese dato
sólo lo necesitaba `page.tsx`.

Los campos y el botón crecen: 50 px de alto en el teléfono contra 44 (inputs) y
48 (botón) en escritorio. Un dedo no apunta como un mouse.

## `/vender`

El punto de venta. Es la pantalla más caliente del sistema, la única que se
opera con alguien esperando del otro lado del mostrador, y la primera con su
**cuerpo** rediseñado contra `design/arandano.pen` (frame `App / Vender`) — el
shell (sidebar + encabezado) ya venía de un ciclo anterior.

**Acciones**: `cobrar`, `buscarArticulos`, `abrirCajaDesdeVender`,
`cerrarCajaDesdeVender`.

**Lecturas del servidor**: `cajaAbierta`, `Tenant.cotizacionUsd` y
`planesDelTenant` (sólo los activos). Las tres se leen en `page.tsx` y viajan
como props: el cliente no consulta la base, así que la pantalla llega con el
dato puesto en vez de parpadear. **Eran cuatro hasta el ciclo del precio en
dólares** (2026-08-29): `ultimaCotizacionUsd` se borró junto con el prefill del
campo de cotización, ver *Decisiones*.

**Qué se puede hacer**

- Buscar un artículo por nombre o código y agregarlo al carrito, desde una
  barra prominente a todo el ancho de la pantalla con su propio atajo (`F2`
  la enfoca desde cualquier lado). El buscador habilita el lector de código de
  barras sin código propio: el lector tipea y manda Enter.
- Cambiar cantidades con un stepper `[−] [valor] [+]` —el valor del medio
  sigue siendo editable a mano, no sólo con los botones— y quitar ítems.
- Cobrar con **pagos partidos**, en pesos y en dólares, cada uno con su medio
  (efectivo, transferencia, débito, crédito) y su cotización. Un pago en
  dólares muestra cuántos pesos representa (`Entran $X` — `Base en pesos $X`
  cuando esa fila lleva un plan que mueve el número, ver *Decisiones*).
- Vender un carrito **mixto** —algo en dólares y algo en pesos— y ver los **dos
  totales**, uno por moneda, sin que la pantalla obligue a elegir ninguna.
- Elegir, en cada pago, **cuál de los dos totales cubre** (selector `Cubre`), y
  cubrir el total en dólares entregando pesos: se tipea cuántos **dólares**
  cubre y una cotización, y el renglón `A cobrar $X` de esa fila dice cuántos
  pesos hay que pedir.
- Elegir el **plan de pago** de cada parte (`Precio de lista` o uno de los que
  el local cargó en `/formas-de-pago`), ver cuánto hay que cobrar por esa fila
  (`A cobrar $X`, sólo cuando el plan mueve el número) y el recargo desglosado
  en el pie del panel de cobro — en las dos copias del pie, la de escritorio y
  la del teléfono.
- Ver el vuelto y el faltante como chips de estado (verde/rojo), excluyentes
  entre sí. **El vuelto se calcula contra lo que hay que cobrar por esa fila,
  no contra su base**: con un plan de efectivo en pesos —el descuento por pago
  contado— los dos números no coinciden, y restar la base devolvía de menos.
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
- **La banda del total muestra una línea por moneda, y sólo las que la venta
  tiene** (ciclo del precio en dólares). Un carrito enteramente en pesos se ve
  **exactamente** como antes —una sola línea— y un local que nunca marcó un
  artículo en dólares no ve ni un control nuevo en toda la pantalla. Es el
  principio que gobierna el ciclo entero: cada control aparece únicamente
  cuando hay algo que decidir. El carrito vacío sigue mostrando `$ 0,00`, por
  lo del ancla de arriba: sin ítems no hay ninguna moneda de la cual derivar
  las líneas.
- **El selector `Cubre` aparece únicamente cuando la venta tiene los DOS
  totales.** Con uno solo no hay elección que ofrecer, así que el control no se
  dibuja y el pago que se crea solo apunta al único total que existe
  (`cubrePorDefecto`). Y lleva **rótulo visible**, a diferencia de Medio y
  Moneda, que se conforman con `aria-label`: aquellos dos se leen del valor
  elegido ("Efectivo", "USD"), y "total en dólares" sin rótulo no dice si es lo
  que se entrega o lo que se cubre — que es justamente la distinción que la
  fila entera existe para hacer.
- **Con UN solo pago, la pantalla lo re-apunta cuando su total desaparece del
  carrito.** Sacar la funda de un carrito mixto deja la venta sólo en dólares:
  sin re-apuntado, el pago quedaba apuntando a un total que ya no existe, con
  el `Cubre` escondido (porque ya no hay dos), un `planId` invisible e
  incorregible, "Cobrar" habilitado y el motor rechazando con un mensaje que no
  dice qué tocar. `reapuntarPagoUnico` mueve `cubre`, la moneda, la base y la
  cotización juntas, y **limpia el plan** si hubo re-apuntado. **Con dos o más
  pagos no lo hace**: ahí no hay una respuesta única sobre cuál mover, y queda
  anotado como el mismo callejón un pago más adelante.
- Con una cantidad a medio tipear muestra `—`, nunca `$ NaN`.
- **El campo de cotización arranca VACÍO, siempre** (ciclo del precio en
  dólares, 2026-08-29). Hasta entonces venía precargado con
  `ultimaCotizacionUsd()` —la última cotización con la que el local había
  cobrado—, que es exactamente el número del jueves pasado si nadie pagó en
  dólares desde entonces: la misma clase de dato envejecido contra la que el
  cliente escribió el feedback que originó ese ciclo. El prefill se fue y
  `ultimaCotizacionUsd()` se borró con él, sin dejar ningún consumidor. La que
  el chip del header muestra (`Tenant.cotizacionUsd`, la que el dueño fija para
  hoy) es **otra cosa** y sigue sin escritor: es un dato para mirar, no un
  valor que precargue nada.
- **La cotización sólo aparece cuando un pago cruza monedas.** Con
  `moneda === cubre` no hay ninguna conversión ocurriendo —pagar US$ 300 en
  billetes contra un total de US$ 300 no convierte nada—, así que la fila
  guarda `cotizacion = 1`, que no es un valor inventado sino literalmente
  cuánto convierte. El campo se dibuja únicamente en el cruce, y
  `cotizacionParaElCruce` la vuelve a poner en `1` (o a vaciarla) en cada
  cambio de `moneda`/`cubre`: sin eso, tipear 1485 con `Cubre: dólares` y
  después volver el selector a pesos persistía una cotización mentirosa que la
  pantalla ya no mostraba.
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
- **El selector de plan aparece sólo si el medio elegido tiene planes
  cargados.** Un local que no cargó ninguno no ve un solo control nuevo: el
  mostrador queda exactamente como estaba. El filtro es por medio **y por
  moneda entregada** —`planesOfrecidos`—, porque las dos cosas las rechaza el
  motor: un plan de otro medio es `PLAN_NO_CORRESPONDE` y un plan sobre un pago
  **entregado** en dólares es `PLAN_EN_DOLARES`. Ofrecer lo que el servidor va
  a rechazar es ofrecer un error. **No filtra por `cubre`, y no es un olvido**:
  el motor prohíbe el plan sobre lo que se entrega en dólares, no sobre lo que
  cubre el total en dólares — y ese cruce (pesos que cubren dólares, en cuotas)
  es justo el caso más caro de la pantalla, el del feedback que originó el
  ciclo. Filtrarlo por `cubre` se lo sacaría al mostrador.
- **Cambiar el medio, la moneda o `Cubre` LIMPIA el plan elegido**, en el mismo
  cambio de estado. Esconder el selector no alcanzaría: el `planId` viejo
  seguiría en el estado y viajando en el JSON escondido, y la pantalla
  mostraría algo que se ve válido mientras el motor rechaza la venta. Se limpia
  también al volver de dólares a pesos — un plan que reaparezca solo es un
  recargo que nadie volvió a elegir.
- **El ítem "Precio de lista" lleva un valor centinela y no la cadena vacía.**
  Radix reserva `''` para "sin selección" y un `SelectItem` con `value=""` tira
  en runtime.
- **El pie del panel de cobro pasa a tres líneas —Mercadería, Recargo *nombre
  del plan*, Total a cobrar— sólo cuando hay algún plan elegido**; sin recargo
  no crece y la pantalla queda como estaba. Con más de un plan elegido el
  recargo va sin nombre, porque el número es la suma de todos.
- **La palabra del renglón del medio sale del SIGNO del neto: "Recargo" o
  "Descuento".** El descuento por pago contado es un caso de primera clase de
  este producto, no un borde, y "Recargo Contado −$ 1.000,00" se contradice a sí
  mismo en la misma línea. Bajo "Descuento" el importe va **sin** el menos: el
  rótulo ya dice de qué lado está, un `−` al lado de la palabra es una doble
  negación, y el total a cobrar quedando por debajo de la mercadería confirma
  la dirección. Es a propósito lo contrario de `formatearPorcentaje`, que
  muestra el signo siempre porque allá el rótulo de la columna es fijo y el
  signo es lo único que distingue un plan de otro. **La banda de
  `--marca` sigue mostrando la MERCADERÍA**: es el ancla de contenido de esta
  pantalla y el número contra el que se reparten los pagos; el total a cobrar
  vive en el panel donde se decide cuánta plata entra. El recargo lo calculan
  `recargoEnCentavos` y `porcentajeEnMilesimas` (`lib/ventas/centavos.ts`), que
  son el espejo exacto del `recargoDePago` del servidor — no una cuenta propia
  de la pantalla.
- **El chip "Faltan / Sobran" sigue midiendo contra la mercadería, no contra lo
  que entra a la caja.** Es lo que decide si "Cobrar" se puede apretar, y el
  motor compara la suma de las **bases** contra el total de ítems: si el
  faltante midiera contra el total a cobrar, una venta financiada no se podría
  cerrar nunca.
- **Y es UN chip por moneda**, no uno solo (ciclo del precio en dólares):
  aparecen las monedas que la venta tiene, en el mismo orden que la banda del
  total, y "Cobrar" se habilita cuando cierran **las dos**. Una venta que
  cierra en pesos y no en dólares se rechaza igual que hoy se rechaza la que no
  cierra. Con un solo total el panel se ve como antes: un chip.
- **El pie del cobro dice "Total a cobrar en PESOS" cuando la venta tiene
  totales en las dos monedas** (hallazgo Important de la review de esa task).
  Ese pie suma sólo la mitad en pesos —los dólares que se entregan en billetes
  no entran en ninguna de sus líneas—, así que sin la aclaración un cajero que
  confiara en esa línea cobraba de menos y la venta cerraba igual. Con un solo
  total el rótulo es el de siempre, "Total a cobrar".
- **El renglón `Entran $X` se llama `Base en pesos $X` cuando la fila lleva un
  plan que mueve el número.** Con base US$ 300 a 1485 y un plan del 40 %, la
  fila decía `Entran $ 445.500,00` y dos renglones más abajo
  `A cobrar $ 623.700,00`: dos importes contradictorios pegados, en la única
  pantalla donde se cuentan billetes. Lo que entra al cajón son los 623.700;
  los 445.500 son la mercadería convertida, **antes** del recargo. El renglón
  no se esconde —ese número es el que deja ver que la cotización aplicada es
  la que se tipeó, y es el puente entre `Cubre US$ 300` y lo que se cobra—:
  se lo llama por su nombre. El rótulo es condicional y no fijo porque sin
  plan `Entran` sigue siendo exacto, y ése es el estado que la maqueta dibuja.
  Los dos renglones salen de la **misma** condición (`elPlanMueveElNumero`):
  separadas, podrían volver a contradecirse.
- **El chip de faltante de una moneda se dibuja aunque su total sea cero, si
  hay pagos apuntados a ella.** Con dos pagos —uno por total— sacar del
  carrito la última línea en pesos dejaba `totales.ars` en 0 con un pago que
  seguía cubriendo pesos: la venta no cerraba, "Cobrar" quedaba apagado, el
  chip que lo explicaría no se dibujaba (pedía `totales.ars !== 0`) y el
  selector `Cubre` tampoco (pide las dos monedas presentes). Botón muerto y
  mudo. Ahora sale `Sobran $X`, que es el cartel que faltaba.
- **`design/arandano.pen` no dibuja ni el selector de plan ni el pie de tres
  líneas**: la maqueta es anterior a los planes de pago. No es una
  contradicción con el `.pen` sino un hueco, y queda anotado en
  `docs/correcciones-pendientes-del-pen.md`. El tratamiento de los dos
  controles se toma prestado de sus hermanos de esta misma pantalla —el
  selector de Medio y el renglón `Entran $X`—, no se inventa.
- **El chip de caja muestra el estado real y ofrece abrirla o cerrarla ahí
  mismo**, sin pantalla `/caja` ni arqueo — ver el detalle en *Pendiente*.
  `cajaAbierta()` se lee en el servidor (`page.tsx`), igual que los planes, así
  que el chip llega con el dato puesto en vez de parpadear entre "sin caja" y
  "caja abierta" en cada carga.
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

**En el teléfono**

Es la pantalla que más cambia del ciclo, y la única que se parte en dos frames
(`Móvil / Vender`, `VaHod`, y `Móvil / Vender · Cobro`, `keRdN`).

- **El cobro es una pantalla propia**, no una columna al costado. El paso vive
  en estado de cliente y se sincroniza con la URL (`?paso=cobro`) por
  `window.history.pushState`, **no** por `router.push`: `pushState` no dispara
  navegación de Next, así que el server component no vuelve a renderizar y
  `PuntoDeVenta` no se remonta con la venta a medias adentro. Es la única razón
  por la que el carrito sobrevive al cambio de paso. El detalle del historial
  —qué empuja una entrada y qué la consume— está en `app/(app)/vender/paso.ts`
  y resumido en `CLAUDE.md`.
- **El Topbar cambia con el paso**: título "Vender"/"Cobro", subtítulo con el
  monto en el cobro —los **dos** montos unidos por ` + ` si la venta tiene las
  dos monedas, calculados con la misma `lineasDeTotal` que la banda de
  `--marca`, para que el título del paso no diga menos que la pantalla de la
  que se viene—, flecha de volver, y la ranura derecha apagada mientras se
  cobra. Por eso el `<Encabezado>` de esta pantalla se renderiza desde
  `PuntoDeVenta` (que es cliente) y no desde `page.tsx`, y la flecha es un
  `alVolver` —una función— y no un `href`: un link a `/vender` dispararía
  justo la navegación que `pushState` existe para evitar.
- **Los dos chips de estado —caja y dólar— bajan al cuerpo**, arriba del
  buscador, y ahí son de **sólo lectura**. Abrir y cerrar el turno se mudan al
  `more-vertical` de la ranura derecha, que abre un `Sheet` con los **mismos
  dos mini-formularios** del chip de escritorio. No es un `DropdownMenu`, y la
  diferencia no es estética: un menú de Radix no puede alojar un `<input>` sin
  pelearle a su typeahead, y sin input la caja se abría en 0 en silencio.
  Abrir una caja con el saldo equivocado es un problema contable.
- **El carrito gana un encabezado propio con "Vaciar"** (nodo `L5UIo`). En
  escritorio esa capacidad la da el doble `Esc`, y un teléfono no tiene `Esc`:
  sin ese botón, deshacer una venta mal armada era borrar ítem por ítem. El
  botón y el atajo comparten el mismo `vaciadoArmado`, así que no se pueden
  desincronizar.
- **La fila del carrito se apila**: nombre y "Quitar" arriba, stepper y
  subtotal debajo, y el precio unitario fundido en la línea de meta. Mismo
  patrón `lg:contents` que los cuatro listados.

  **"Quitar" queda arriba a la derecha con `position: absolute`, no anidado
  junto al nombre**, así que en el DOM sigue siendo la quinta celda: por
  teclado se llega después del stepper y del subtotal. La alternativa está
  escrita en el código, al lado del botón — anidarlo junto al nombre y darle a
  las **cinco** celdas un `lg:col-start-N` explícito, que reconstruye la grilla
  de escritorio por posición declarada en vez de por orden del DOM. No se
  aplicó porque toca las cinco celdas de una pantalla ya verificada a ojo, y no
  se puede hacer a medias.
- **El pie fijo lleva el botón `Cobrar` de 54 px**, y el buscador sube a 52.
- **Los tres atajos de teclado no se tocan.** En un teléfono no hay teclado que
  los dispare, y su lógica de foco ya estaba probada.

**Pendiente**

- **La caja sigue sin arqueo ni pantalla propia**, y `crearVenta` **no** exige
  que haya una caja abierta para cobrar — a propósito: eso rompería el cobro
  de cualquier tenant que no use la caja. El chip del header cubre abrir y
  cerrar; el arqueo es su propio ciclo futuro.
- **El re-apuntado sólo cubre el pago único.** Con dos o más pagos, un total
  que desaparece del carrito deja un pago apuntando a una moneda que la venta
  ya no tiene: el mismo callejón que `reapuntarPagoUnico` vino a tapar, un pago
  más adelante. **La pantalla ya no queda muda en ese estado** —el chip de esa
  moneda se dibuja igual y dice `Sobran $X`, ver *Decisiones*—, pero corregirlo
  sigue siendo a mano: "Quitar pago", o volver a poner mercadería de esa
  moneda en el carrito. El selector `Cubre` no sirve acá: pide las dos monedas
  presentes, y este estado es justamente una de las dos en cero.
- **Un plan sobre un pago ENTREGADO en dólares sigue prohibido**
  (`PLAN_EN_DOLARES`), por la división que el ciclo entero se cuidó de no
  hacer. Cubrir dólares **entregando pesos** sí lo admite: es el caso del
  feedback.
- **`design/arandano.pen` no dibuja nada de esto** —es anterior al precio en
  dólares—: ni el selector `Cubre`, ni la banda de dos líneas, ni el segundo
  chip de faltante. Anotado en `docs/correcciones-pendientes-del-pen.md`,
  entrada 23.

## `/ventas`

El historial por período.

**Qué se puede hacer**

- Filtrar por rango de fechas a mano, o con los accesos rápidos **Hoy / 7 días
  / Este mes**. El default es hoy.
- Ver tres tiles: total del período (el ancla de `--marca` de esta pantalla,
  ver `docs/sistema-de-diseno.md`) —que muestra **Vendido y Cobrado cuando
  difieren, y un número solo cuando coinciden**—, ventas cobradas con su
  promedio, y anuladas con lo devuelto. **Los dos pies de plata hablan de lo
  cobrado EN PESOS, y desaparecen cuando esa cifra es cero y el período
  movió dólares** — ver *Decisiones*.
- Ver el listado dentro de su propia card ("Últimas ventas"), con la columna
  "Cliente" (quién compró, no quién vendió — eso vive en el detalle), cuántos
  artículos, con qué medios se pagó, el **total** y su estado. **La columna
  Total muestra el mismo par que el tile de arriba**: Vendido y Cobrado
  cuando difieren ("Vendido US$ 300,00 / Cobrado $ 148.500,00 + US$
  200,00"), un número solo cuando coinciden — sin convertir nada. En
  escritorio el rótulo va **en línea** con su importe, a la izquierda; en el
  teléfono va apilado encima. Ver *Decisiones*.
- Ver **"Cómo entró la plata"**: una barra por medio de pago, de un solo color,
  **en UNA SOLA MONEDA a la vez** — pesos por default. Un selector `$ / US$`,
  a la derecha del título, sólo se dibuja si el período tuvo algún pago en
  dólares; son dos links (`?moneda`), no un control de cliente, así que
  funciona sin JavaScript. **Nada se convierte**: la pila la elige
  `Pago.moneda` y el importe es `Pago.monto` tal cual, sin pasar por ninguna
  cotización — ver *Decisiones*.
- Entrar al detalle de cualquier venta.
- Paginar de a 50, con números de página.
- Ver **"Cuándo vende el local"**: una barra por hora del día o por día de la
  semana, sobre el mismo período que filtra la pantalla, con el pico
  destacado y nombrado en el pie. El segmentado Hora/Día viaja en `?vista`,
  así que el panel funciona sin JavaScript y la vista se comparte en la URL.
  **La franja horaria sale de los datos** —de la primera a la última hora con
  ventas, y 9–20 cuando no hubo ninguna—, no de las doce barras fijas que
  dibuja la maqueta: con la franja fija, una venta a las 22 no aparecería en
  ningún lado. Las anuladas no cuentan.

**Decisiones**

- **La columna Total, el tile "Total del período" y los dos pies de plata
  distinguen VENDIDO de COBRADO, y ninguno de los dos se convierte al otro**
  (ciclo del cobrado por moneda). **Vendido** es `Venta.total` +
  `Venta.totalUsd` — la mercadería a precio de lista, en sus dos monedas, sin
  recargo. **Cobrado** es `Σ Pago.monto`, apilado por **`Pago.moneda` y
  NUNCA por `Pago.cubre`**: un pago en pesos que cubre el total en dólares es
  plata que entró EN PESOS, y apilar por `cubre` reproduciría el defecto que
  este ciclo corrige — una venta de US$ 300 cobrada US$ 200 + pesos volvería
  a decir "US$ 300" cobrados. Las dos magnitudes se combinan con
  `lineasDeImporte()` (`lib/ventas/cobrado.ts`), la única fuente de las dos
  líneas en la columna y en el tile, y con las funciones sueltas del mismo
  archivo (`vendidoDeVenta`, `cobradoDePagos`, `hayQueDesglosar`,
  `formatearTotales`) en el pie de "Qué se vendió" de `/ventas/[id]`, que
  desde su propio ciclo dejó de armar el desglose contra `totalCobrado()` —, y
  **se muestran dos líneas —"Vendido" arriba, "Cobrado" abajo— sólo cuando
  difieren; un número solo cuando coinciden**. Sin dólares ni planes de pago
  coinciden POR CONSTRUCCIÓN (`Σ Pago.monto = total + recargo`), así que un
  local que no usa ninguna de las dos cosas no ve ninguna diferencia respecto
  de antes de este ciclo. Y **la costura con "Cómo entró la plata" ya cerró
  del todo** (arreglo posterior de un defecto de producción, Task 3 del ciclo
  del dashboard): el panel convertía cada pago a pesos con `Pago.cotizacion`,
  que vale 1 cuando el pago no cruza monedas —a propósito—, así que un pago de
  US$ 300 en efectivo sobre un total en dólares aportaba **300** al largo de
  la barra en vez de los ~445.500 que representa; para un local que cobra en
  dólares en efectivo, todas las barras quedaban cerca de cero. `componerPorMedio`
  ya no convierte: arma dos pilas por `Pago.moneda` (`ComposicionPorMoneda`,
  `lib/ventas/composicion.ts`), sin que ninguna cotización entre en la cuenta,
  y la pantalla dibuja una a la vez con el selector `?moneda`. Antes de
  este ciclo, las cuatro cifras sumaban `total + recargo` con `totalCobrado()`
  (`lib/ventas/totales.ts`) y el tile llevaba `totalUsd` a una segunda línea
  aparte; esta pantalla dejó de llamar a esa función porque dejó de describir
  lo que muestra, y el pie de `/ventas/[id]` la dejó de llamar en este mismo
  ciclo, poco después — sin ningún llamador de producción que le quedara,
  `totalCobrado()` se borró de `lib/ventas/totales.ts` en este ciclo, y ya no
  existe.
- **El total NO suma las anuladas**, y lo dice en pantalla para que nadie tenga
  que deducirlo. Lo devuelto de las anuladas es un agregado APARTE, no el
  mismo número con el filtro invertido.
- **Las anuladas se muestran**: el historial tiene que poder responder qué pasó,
  y esconderlas sería tapar la respuesta. Van con un chip (`ChipEstado`,
  compartido con el panel Resumen del detalle), no con texto suelto: quien no
  distingue el rojo igual ve que la fila está marcada.
- **Los pies de "Ventas cobradas" y "Anuladas" se omiten cuando lo cobrado (o
  lo devuelto) en pesos es cero y el período movió dólares.** Los dos se
  calculan sobre `Σ Pago.monto` de los pagos en pesos —vía `pagosDelPeriodo()`,
  no sobre `total + recargo`—: para el local que carga todo su catálogo en
  dólares y cobra en dólares —el que pidió esta feature—, eso es cero, y el
  resultado era `promedio $ 0,00` y `$ 0,00 devueltos` al lado de un tile que
  decía `US$ 3.000,00`. **Un tile sin pie omite; un `promedio $ 0,00`
  afirma**, y ahí afirma algo falso. Se eligió omitir y no sumarles una
  segunda línea en dólares como al tile de marca: el promedio en dólares sería
  `sumaUsd / cobradas`, y en un período mixto ese denominador incluye ventas
  que no movieron un dólar — un cuarto número derivado, en 10 px, debajo de un
  conteo. Con cero en pesos y ningún dólar, el pie sigue apareciendo: ahí el
  cero es cierto.
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
- **"Volver a la primera" (hallazgo M8 del barrido final, sin documentar hasta
  este commit):** con `total > 0` la página puede haber quedado fuera de
  rango (`?p` se clampea a [1, 1.000.000], no a `paginas`), y el `<nav>` de
  paginación vive DENTRO de la rama con resultados — sin este link, ese vacío
  por página fuera de rango no ofrece ningún control para volver. `/inventario`
  y `/servicio-tecnico` usan el mismo criterio.

**En el teléfono**

- **Los chips de rango van a ancho completo** y los tres campos de fecha se
  guardan detrás de un botón de 38 px con ícono `calendar`, que abre un
  `Sheet`. Es **un solo** `FormularioDeFechas` renderizado dos veces —una
  visible sólo en escritorio, otra dentro de la hoja— y no dos formularios: por
  eso las etiquetas van implícitas (un `<label>` envolviendo el campo) en vez
  de `id`/`htmlFor`, que se duplicarían en el instante en que las dos copias
  coexisten.
- **Los tres tiles se apilan** y bajan un escalón de tamaño (30 px el de marca
  contra 32, 24 los otros contra 26).
- **El listado deja de ser una tabla.** Cada venta es una tarjeta de tres
  líneas: `#1042 · 14:32` y el total arriba, el cliente debajo, y una línea de
  meta que funde la cantidad de artículos con los medios de pago — **"Medios"
  deja de existir como columna**. Es el mismo árbol que en escritorio: ver *Lo
  que hereda toda pantalla* para el patrón.
- **"Cómo entró la plata" ya era fluido** desde que se reescribió sin
  `recharts`, así que no necesitó nada.
- **La columna Total mide 280 px, no los 140 px que fijaba la maqueta**, y en
  escritorio el rótulo va en línea con su importe en vez de encima. Los dos
  cambios salen del mismo defecto, visto sobre la pantalla ya construida: con
  el desglose, `$ 155.000,00 + US$ 200,00` no entraba en 140 px y se partía en
  dos renglones, y con el rótulo encima esa fila terminaba midiendo el doble
  de alto que sus vecinas. El ancho salió de `Cliente`, que es `1fr` y venía
  quedándose con ~1.150 px vacíos al lado, así que no se le quitó espacio a
  nada. El importe se empuja con `ml-auto` y **no** con `justify-between` en
  el contenedor: una línea sin rótulo tiene un solo hijo y `justify-between`
  la dejaría a la izquierda, que es justo el caso común de esta columna. En el
  teléfono no cambia nada — sigue apilado, que es lo único que entra a 390 px.
  Anotado en `docs/correcciones-pendientes-del-pen.md`, entrada 25.

## `/ventas/[id]`

El detalle de una venta: qué se vendió, cómo se pagó, y un resumen.

**Acciones**: `anular`.

**Qué se puede hacer**

- Ver los ítems con su SKU (o "Servicio" si no lleva stock), cantidad, precio
  unitario y subtotal — **cada uno en su propia moneda** (Task 11): un ítem en
  dólares muestra "US$", sin convertirlo a pesos.
- Ver el pie de "Qué se vendió" **desglosado en Vendido / Recargo (o
  Descuento) / Cobrado cuando hay algo que desglosar**, o el renglón único
  "Total" de siempre si no — que desde el ciclo del cobrado por moneda incluye
  también toda venta en dólares pagada en dólares (antes mostraba dos
  renglones, "Total" y "Total en dólares"; ahora uno solo). **Una sola banda
  destacada**, no una por moneda: "Cobrado" ya lleva las dos monedas juntas
  cuando hace falta, y el recargo sigue yendo siempre del lado de los pesos
  (nunca hay un "Recargo" en dólares que desglosar).
- Ver los pagos con su medio, **el plan con el que se cobró cada uno** (o "—"
  sin plan), moneda, cotización (en los pagos que tocan dólares de algún
  lado — el que se paga en dólares o el que cruza a cubrir el total en
  dólares), monto y su equivalente en pesos. **Cuando corresponde, dice
  también qué total cubrió** ("Cubre el total en dólares"): sólo si el pago
  cubre dólares, o si la venta tiene los dos totales — el caso común (venta
  sólo en pesos, pago que cubre pesos) no lo dice, para no ensuciarlo.
- Ver el panel **Resumen**: fecha y hora, quién la vendió, el cliente (o
  "Consumidor final"), el estado y el comprobante.
- **Anular la venta** — con el permiso `VENTAS_ANULAR` (un dueño siempre lo
  tiene; un empleado, sólo si se lo otorgaron), y sólo mientras siga cobrada.

**Decisiones**

- **El pie de "Qué se vendió" desglosa cuando hay algo que desglosar, no sólo
  cuando `Venta.recargo` no es cero** (ciclo del cobrado por moneda,
  `hayQueDesglosar()` en `lib/ventas/cobrado.ts`, la misma función que ya usan
  la columna Total y el tile "Total del período" de `/ventas`). Además del
  recargo, también desglosa cuando lo **Vendido** (`Venta.total` +
  `Venta.totalUsd`, la mercadería a precio de lista) y lo **Cobrado**
  (`Σ Pago.monto`, apilado por `Pago.moneda` — nunca por `Pago.cubre`) no
  coinciden: el caso de un pago partido entre pesos y dólares sin ningún
  recargo de por medio (R8 del ciclo). Sin nada de eso —toda venta grabada
  antes de este ciclo, y la mayoría después— no hay nada que desglosar, y
  repetir el mismo número sería ruido. Con recargo, el rótulo de la segunda
  línea sigue la misma gramática que ya fijó `/vender` (Task 6): "Recargo" o
  "Descuento" según el signo, y bajo "Descuento" el importe va sin el signo
  porque la palabra ya dice de qué lado está — la misma regla vale en una
  pantalla que se LEE y no sólo en una que se opera. **Antes de este ciclo el
  pie sumaba `total + recargo` con `totalCobrado()` y agregaba una banda
  aparte, "Total en dólares", cuando `totalUsd !== 0`** — esta pantalla era la
  última que hacía esa cuenta; ahora usa las mismas `vendidoDeVenta` /
  `cobradoDePagos` / `formatearTotales` (`lib/ventas/cobrado.ts`) que el resto
  de las pantallas de venta, y "Cobrado" lleva las dos monedas en el mismo
  renglón en vez de una banda aparte por moneda.
- **La columna "Plan" de "Cómo se pagó" no filtra planes dados de baja.** La
  FK `Pago.planDePagoId` es `Restrict` y la baja es lógica (Task 1), así que
  la fila sigue estando: una venta de marzo tiene que seguir diciendo con qué
  plan se cobró aunque el local ya no lo ofrezca hoy. Confirmado contra la
  base en `test/ventas.test.ts`.
- **En el teléfono, "Plan" no es una columna: se funde en la línea de meta del
  pago**, delante de la moneda. Es el mismo mecanismo que ya usan Moneda y
  Cotización en esa tabla ("el dato no desaparece, se funde en la meta"), y va
  primero porque es lo que distingue un pago de otro del mismo medio. El
  desglose del pie, en cambio, **sí** se muestra en los dos anchos: la última
  línea es siempre la única banda destacada —`--marca` en el teléfono,
  `bg-muted` en escritorio—, lleve el rótulo "Total" o "Cobrado", así que el
  ancla visual de la pantalla no cambia con el desglose.
- **"Cómo se pagó" no le atribuye el recargo a un solo plan en el resumen.**
  Con un pago partido entre dos planes distintos, el pie de arriba muestra un
  único número de recargo (la suma); cuál plan cobró cuánto vive en la columna
  "Plan" de esta tabla, de a un pago por vez.
- El guard está **en la action**, no sólo en la pantalla: una server action se
  invoca sin pasar por ningún componente. `puedeAnular()` en `page.tsx` sólo
  decide si el botón se ofrece.
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

**En el teléfono**

- **El Topbar trae la flecha de volver a `/ventas`, y la ranura derecha queda
  vacía.** La maqueta dibuja un `printer` ahí —y también en el frame de
  escritorio—, pero imprimir una venta no es una feature que el producto tenga.
  Ver `docs/correcciones-pendientes-del-pen.md`, entrada 14. El link "Volver"
  del cuerpo se oculta: esa función ya la cumple la flecha.
- **"Resumen" pasa primero**, antes de "Qué se vendió". Las dos columnas de
  escritorio se disuelven con `contents` y cada card lleva su `order-N`, porque
  `order` sólo reordena hermanos del mismo contenedor.
- **Las dos tablas pasan a tarjetas.** Las columnas que no entran
  —Cantidad/Precio en una, Medio/Moneda/Cotización/Monto/En pesos en la otra—
  se funden en una línea de meta por tarjeta (`metaDeItem` y `metaDePago`, dos
  funciones puras).
- **La banda TOTAL va a ancho completo y se pinta con `--marca`** (nodo
  `Cv4xd`), donde en escritorio es `bg-muted`. Es la superficie de marca de
  esta pantalla en el teléfono.

## `/inventario`

El listado de artículos, con buscador, filtro de tipo y chips de estado
(rediseño de `design/arandano.pen`, frame `App / Inventario`).

**Qué se puede hacer**

- Buscar por nombre o SKU.
- **Recorrer el árbol de categorías** desde la columna de la izquierda: un
  rubro arriba (Celulares, Fundas, Cables) y la marca abajo. Clic en un rubro
  filtra a todo el rubro; clic en una marca, a esa marca.
- **Crear, renombrar, mover y borrar categorías** en esa misma columna, con el
  permiso `CATEGORIAS` (un dueño siempre lo tiene; un empleado, sólo si se lo
  otorgaron). No hay pantalla de ABM aparte.
- Filtrar por tipo con el segmentado **Todos / Productos / Servicios**.
- Ver stock, precio **en su moneda** (`$` o `US$`), tipo y la categoría (dos
  niveles, p. ej. "Accesorios · Protección").
- Mostrar u ocultar los artículos desactivados.
- Paginar de a 50, con botones numerados.

**Decisiones**

- **El precio se muestra en su moneda y SIN equivalente en pesos** (ciclo del
  precio en dólares, 2026-08-29). Fuera de una venta no hay ninguna cotización
  de la cual derivarlo, y un número inventado es peor que ninguno — la misma
  regla por la que el chip de cotización del header de `/vender` muestra `—` en
  vez de fabricar un valor. La columna no se ordena ni se suma, así que dos
  monedas conviviendo en ella no rompen nada: `precioEnSuMoneda`
  (`lib/formato/mostrar.ts`) elige el formateador y no convierte.
- **El conteo de una rama incluye el de sus marcas**, más los artículos
  colgados del rubro mismo. Si no cerrara, el número de arriba no coincidiría
  con la suma de abajo y el árbol dejaría de servir para decidir.
- **El conteo del árbol responde al catálogo, no al resultado de la búsqueda.**
  Sigue el mismo criterio de activos/desactivados que el listado, pero ignora
  `?q` y `?tipo`: si siguiera la búsqueda, apenas se escribe algo que matchea
  una sola rama todas las demás mostrarían 0, y el árbol dejaría de servir para
  navegar justo cuando más se lo necesita. Es **a propósito distinto** del
  conteo de stock negativo del subtítulo, que sí habla de lo que se muestra —
  son dos preguntas: "de esto que veo, cuánto está mal" y "cuánto tengo de cada
  cosa".
- **`?cat` que no corresponde a ninguna rama cae en "Todos"**, igual que
  `?tipo` inválido: una categoría borrada o de otro tenant filtraría a cero sin
  explicación.
- **El vacío con una rama activa es el único con salida.** Ofrece "Buscar en
  todo el inventario", que limpia la rama y conserva la búsqueda: sin eso,
  buscar algo que existe pero está en otra rama se ve igual que buscar algo que
  no existe.
- **Elegir una rama vuelve a la página 1**; sólo la paginación conserva `?p`.
- **El colapso de un rubro no persiste** entre navegaciones, y el rubro de la
  rama activa se fuerza abierto: una marca seleccionada dentro de un rubro
  colapsado sería una selección invisible.
- **El ABM lo gobierna el permiso `CATEGORIAS`**, delegable desde este ciclo de
  permisos por usuario (antes era del dueño sin excepción, mismo criterio que
  el alta de artículo). Que el panel no le dibuje los controles a quien no lo
  tiene no alcanza: las cuatro acciones exigen el permiso en el servidor,
  porque un server action es un endpoint. El botón "Artículo nuevo" del Topbar
  responde a `ARTICULOS_CREAR`, un permiso distinto — un empleado puede tener
  uno sin el otro.
- **Borrar exige la rama vacía y sin marcas**, y el mensaje dice **cuántos**
  artículos hay: un "no se puede" sin el número no dice si mover uno o cuarenta.
- **Los avisos del ABM van por toast** (`sonner`, montado una vez en el layout
  de `(app)`), no anclados a la fila: 248 px de ancho es poco para dos líneas y
  con el panel scrolleado el cartel quedaba cortado. **Los errores no se
  auto-descartan** —son accionables, y un aviso que se va solo se lleva la
  instrucción—; los de éxito sí. Cada uno con clave estable por acción y rama,
  o `useActionState` los apilaría en cada render.
- **El query string vive en `consulta.ts`**, un módulo sin `'use client'`: el
  panel es un Client Component y necesita `hrefListado`, y Next no deja pasarle
  una función como prop ni invocar desde el servidor una función que vive del
  lado del cliente. Las dos cosas dieron 500 con el gate entero en verde.
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
- **"Volver a la primera" (hallazgo M8 del barrido final, sin documentar hasta
  este commit):** con `total > 0` la página puede haber quedado fuera de
  rango (`?p` clampeado, no `paginas`), y el `<nav>` de paginación vive DENTRO
  de la rama con artículos — sin este link, ese vacío por página fuera de
  rango no ofrece ningún control para volver. Mismo criterio que ya usaba
  `/ventas`.

**En el teléfono**

- **El árbol de categorías sale de la columna.** Un botón de 36 px con ícono
  `list-tree`, al lado del segmentado de Tipo, abre un `Sheet` desde la
  izquierda con **el mismo `PanelCategorias`** de escritorio: el ABM entero
  —crear, renombrar, mover, borrar, los toasts— viaja adentro, sin una segunda
  forma de navegar el árbol. Debajo del segmentado, un chip con la rama activa
  y su ✕ para soltarla. La maqueta no dibuja el panel abierto: ver
  `docs/correcciones-pendientes-del-pen.md`, entrada 10.
- **El listado pasa a tarjetas**: nombre y precio en la primera línea, y una
  segunda línea de meta con código, categoría, el chip de estado y el stock.
  "Código" y "Tipo" dejan de tener celda propia. La técnica es más simple que
  en `/ventas` y vale saber por qué: como las celdas ocultas llevan `hidden`
  (que las saca del flujo), Nombre y Precio quedan pegados sin reordenar nada,
  y el orden del DOM sigue siendo el de escritorio.

  **Esa línea de meta vive DENTRO de la celda de Stock**, no en un `<div>`
  suelto al lado (ola final del ciclo del teléfono). Así la fila del teléfono
  no tiene ningún hijo que no sea celda, y el stock deja de estar duplicado en
  dos hermanos: las dos versiones —la meta compacta y el número alineado a la
  derecha— son dos presentaciones del mismo dato adentro de su propia celda.
  Ver *Lo que hereda toda pantalla* para cuándo esta fusión se puede y cuándo
  no.
- **"Ingresar mercadería" no se construyó**, ni acá ni en el Topbar de
  escritorio, aunque la maqueta lo dibuje en los dos: esa acción vive **por
  artículo**, en la ficha, y a nivel del listado no hay destino al que mandar.
  Ver `docs/correcciones-pendientes-del-pen.md`, entrada 8.

## `/inventario/nuevo`

El alta de un artículo, en tres cards: qué se está cargando, sus datos y el
stock inicial (`design/arandano.pen`, frame `App / Artículo nuevo`).

**Acciones**: `altaArticulo`.

**Qué se puede hacer**

- Elegir Producto o Servicio con dos tarjetas seleccionables (no un
  `<select>`): un servicio oculta la card de stock inicial entera.
- Cargar nombre y precio, **elegir en qué moneda está ese precio** (`$` por
  default o `US$`, desde un selector pegado al campo) y **elegir** categoría y
  marca de dos selectores encadenados: el de marca ofrece las hijas del rubro
  elegido.
- Anotar la **factura del proveedor** del stock inicial.
- Dejar el SKU vacío y que se genere solo, con el próximo código libre
  mostrado como ayuda.
- Cargar stock inicial y, con el permiso `COSTOS`, su costo unitario, que nace
  como movimiento y no como un número suelto.

**Decisiones**

- **Toda la pantalla exige `ARTICULOS_CREAR`**, no sólo la action: `page.tsx`
  llama a `exigirPermiso('ARTICULOS_CREAR')` antes de renderizar nada, así que
  un empleado sin el permiso no llega a ver el formulario. El campo "Costo
  unitario" del stock inicial es aparte: lo gobierna `COSTOS`, y sin él el
  campo no se dibuja y el servidor lo ignora si llega igual por fuera de la
  pantalla.
- **La moneda del precio se elige con `SelectorDeMoneda`, el mismo componente
  que la ficha** (`components/selector-de-moneda.tsx`, ciclo del precio en
  dólares). Es la lección directa del ciclo del 2026-08-28 aplicada **antes**
  de pagarla: la categoría vivió cuatro días con dos implementaciones —dos
  selectores acá y un campo de texto en la ficha—, el gate entero en verde, y
  lo reportó un cliente antes que un test. Un solo componente instanciado dos
  veces no se puede desincronizar; el caso lo cuenta igual, porque es la regla
  que este repo ya pagó varias veces.
- **El selector emite por un `<input type="hidden">`**, no por un `<select>`:
  `Select` de Radix no renderiza ninguno (el trigger es un `<button>`), así que
  sin el hidden el `FormData` del server action llegaría sin el campo. Mismo
  trade-off que la categoría, y con la misma consecuencia: **sin JavaScript no
  se puede elegir la moneda**, aunque el default de pesos sí viaja.
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
- **La categoría se elige, no se tipea**, y eso **quita una capacidad que
  existía**: hasta el 2026-08-24 el campo era texto libre y escribir
  "Fundas · Samsung" creaba las dos ramas al vuelo. Ahora se elige de lo que
  hay, y para crear una categoría se va al panel de `/inventario` — de ahí el
  link bajo los selectores. Es la consecuencia directa de haber elegido
  "catálogo propio" sobre "catálogo creable al vuelo".
- **Cambiar de rubro limpia la marca elegida**: dejarla puesta guardaría una
  marca de otro rubro, y el servidor la aceptaría sin chistar porque el id
  existe.
- **El selector de marca nace deshabilitado** con un rubro sin marcas, en vez
  de vacío y clickeable: un selector que se abre para no mostrar nada invita a
  buscar algo que no está.
- **Sin JavaScript no se puede elegir categoría.** El `Select` de Radix
  renderiza sus opciones del lado del cliente, así que el `<select>` oculto que
  viaja en el form nace con una sola opción vacía. Es el mismo trade-off que ya
  se aceptó en `/vender` al pasar medio y moneda a Radix, y una **regresión
  respecto del campo de texto**, que sí funcionaba sin JS. Se acepta porque la
  maqueta pide el chevron que ningún `<select>` nativo dibuja.
- **La factura del proveedor no es una columna nueva**: va como nota del
  movimiento de stock inicial (`'stock inicial · <factura>'`), que es
  exactamente para lo que `MovimientoStock.nota` existe y lo que el ingreso de
  mercadería de la ficha ya hace.
- **El texto de `Articulo.categoria` se sigue escribiendo**, ahora derivado de
  la rama en vez de tipeado. Es lo que hace que un rollback a la imagen
  anterior encuentre el dato; muere en el deploy del contract.
- **Los dos selectores salieron a `SelectorDeCategoria`, compartido con
  `/inventario/[id]`** (spec 2026-08-28: "categoría en la ficha del
  artículo"). Antes de ese ciclo esta pantalla tenía su propio par de
  `<Select>` y la ficha un campo de texto — dos implementaciones del mismo
  control, y una se había quedado atrás. Con un componente único la
  divergencia no se puede repetir.
- **Y con ese componente, elegir "Fundas" por error dejó de ser un callejón
  sin salida.** Antes, el `<Select>` de esta pantalla no ofrecía ningún ítem
  para volver a "ninguna" una vez elegida una rama —el placeholder "Sin
  categoría" sólo se veía mientras no se elegía nada, y Radix rechaza un
  `SelectItem` con `value=""`—, así que deshacer la elección exigía recargar
  la pantalla. Los dos selectores ofrecen ahora un ítem explícito "Sin
  categoría"/"Sin marca", siempre, también acá en el alta (no sólo en la
  ficha, que es donde la capacidad hacía más falta): el costo de tenerlo es
  cero, no cambia qué se puede guardar.
- **"Cancelar" y "Guardar artículo" viven en el Topbar**, no al pie del
  formulario: el `<form>` envuelve encabezado y cuerpo por igual
  (`className="contents"`, sin alterar el layout de `SidebarInset`) porque el
  botón que dispara vive arriba y el HTML exige que sea descendiente del
  `<form>`. `FormularioDeAlta` (`formularios.tsx`) arma la pantalla entera,
  ya no sólo el cuerpo.

**En el teléfono**

Las tres cards se apilan y las tarjetas Producto/Servicio pasan de fila a
columna. Las acciones bajan del Topbar a un **pie fijo** con "Cancelar" y
"Guardar artículo" de 50 px.

**Son dos botones, no uno movido**, y el mecanismo importa: un elemento del DOM
no puede estar en dos lugares, así que hay un juego `hidden lg:flex` y otro
`lg:hidden`. Lo que sigue siendo **uno solo** es el estado — el mismo
`useActionState` gobierna los dos, así que `pendiente` deshabilita los dos a la
vez. Acá ni siquiera hace falta `form=`: el formulario entero (Encabezado,
Cuerpo y Pie) vive dentro de un único `<form className="contents">`, así que el
botón del pie alcanza con ser descendiente.

"Cancelar" cambia de `ghost` a `outline` en el pie: un botón sin borde ni fondo
al pie de un teléfono es un área táctil invisible, y la maqueta le dibuja
borde.

## `/inventario/[id]`

La ficha de un artículo, en dos columnas: a la izquierda las métricas, mover
stock y el historial; a la derecha los datos editables, "Precios por forma de
pago" y "Cómo se movió" (`design/arandano.pen`, frame `App / Artículo ficha` —
el panel de precios no está dibujado ahí, ver *Decisiones* más abajo).

**Acciones**: `guardarArticulo`, `ingresarMercaderia`, `corregirPorConteo`,
`bajaArticulo`, `reactivarArticuloAccion`, `exportarHistorialCsv`.

**Qué se puede hacer**

- Ver tres tiles: **En stock** (pintado con `--marca`, el ancla de esta
  pantalla), **Precio de venta** (en su moneda, con hace cuánto se actualizó)
  y, con el permiso `COSTOS`, **Último costo** (siempre en pesos, con el margen
  contra el precio actual). Un servicio sólo muestra el de precio.
- Editar nombre, precio, **la moneda del precio** y código desde la card
  "Datos", y **elegir** categoría y marca de los mismos dos selectores
  encadenados que usa el alta — con el permiso `ARTICULOS_EDITAR`; sin él la
  card directamente no se renderea (no es de sólo lectura: no aparece).
- **Ingresar mercadería** — de cualquiera con sesión, no de `ARTICULOS_EDITAR`:
  es operación del día, la hace quien está atendiendo — y, con `COSTOS`
  además, su costo unitario y una nota (factura, proveedor).
- **Corregir por conteo** — de cualquiera con sesión, mismo motivo que
  "Ingresar mercadería": se escribe el stock contado, no el delta.
- Desactivar y reactivar el artículo (`ARTICULOS_EDITAR`).
- Ver el historial completo de movimientos, con chip de motivo, la celda
  "Detalle" (combina quién y qué, según el motivo — el costo de un ingreso
  aparece ahí sólo con `COSTOS`) y la columna **Queda** (el saldo después de
  cada movimiento).
- Ver **"Precios por forma de pago"**: una fila por plan de pago activo del
  local, con su precio derivado — sin ningún permiso, de cualquiera con
  sesión. No aparece si el local no cargó ningún plan.
- Ver **"Cómo se movió"**: seis barras con las unidades vendidas por mes.
- **Exportar CSV** con el historial completo (sin el límite de la tabla en
  pantalla; la columna de costo del CSV sigue la misma regla de `COSTOS` que la
  tabla, porque las dos arman su celda con la misma función).

**Decisiones**

- **`ARTICULOS_EDITAR` y `COSTOS` son dos permisos distintos**, y por eso un
  empleado puede editar nombre y precio sin poder ver ni cargar el costo, o
  viceversa (aunque no viceversa en la práctica: el default es que un
  empleado nuevo no tenga ninguno de los dos). `page.tsx` resuelve los dos por
  separado (`puedeConSesion(sesion, 'ARTICULOS_EDITAR')` y
  `puedeConSesion(sesion, 'COSTOS')`) y los reparte a `FichaDeArticulo` y a
  `MoverStock` como props booleanas independientes.
- En la corrección por conteo **el delta lo calcula el servidor, adentro de la
  transacción, contra el stock del momento**. Si lo calculara el navegador, una
  venta ocurrida entre que se abrió la pantalla y se apretó el botón quedaría
  pisada.
- **La categoría se elige del árbol, con el mismo componente que el alta**
  (spec 2026-08-28: "categoría en la ficha del artículo"). Hasta esa fecha la
  ficha tenía un campo de TEXTO mientras `/inventario/nuevo` ya elegía de dos
  selectores encadenados — dos implementaciones del mismo control, y una se
  había quedado atrás: poner una marca exigía tipear "Fundas · Apple" con un
  middot que no está en el teclado argentino, y tipear sólo "Apple" creaba un
  rubro raíz nuevo en silencio. `SelectorDeCategoria`
  (`selector-categoria.tsx`) es ahora el único control, en orientación
  `columna` acá (la card mide 324 px; en fila los dos selects quedan en ~150
  px cada uno, donde "Vidrios templados" no entra). `editarArticulo` recibe
  el id de la rama elegida (`categoriaId`, requerido) y lo resuelve con
  `ramaElegida` adentro de la misma transacción del `UPDATE` — la contraparte
  de `asegurarCategoria` para una rama que ya existe en vez de crearla. `null`
  despeja las dos columnas (`categoria` y `categoria_id`) a la vez.
- **La moneda del precio se elige con el mismo `SelectorDeMoneda` que el
  alta**, y cambiarla **avisa en vez de impedir** (ciclo del precio en dólares).
  Pasar 300 de dólares a pesos hace que el número diga otra cosa —`US$ 300`
  pasa a ser `$ 300`—, y ninguna validación puede distinguir eso de un cambio
  deliberado (alguien que además va a recargar el precio real en la otra
  moneda). Así que el control muestra, apenas la moneda difiere de la que el
  artículo tenía, "el precio no se convierte: lo que estaba en pesos ahora se
  lee en dólares" — y la decisión queda de quien carga el precio, que es el
  único que sabe cuál de las dos cosas está haciendo. Es lo que el spec llama
  explícitamente "lo que queda sin red".
- **Elegir la moneda pide `ARTICULOS_EDITAR`, y ningún permiso nuevo.** Mueve
  el precio de **un** artículo, así que viaja con el precio mismo — la misma
  forma de razonar con la que el ciclo de precios por forma de pago sí separó
  `PLANES_PAGO`, que mueve el precio de todo el catálogo de una. `moneda` es
  **requerida** en `editarArticulo`, no opcional, por el mismo motivo que
  `categoriaId`: un llamador que la omitiera dejaría la moneda vieja sin que
  nadie lo haya decidido y sin ningún error que lo avise.
- **Elegir rama pide `ARTICULOS_EDITAR`, no `CATEGORIAS`** — y es la inversión
  deliberada de la guarda anterior, que exigía `CATEGORIAS` además. El motivo
  de esa guarda vieja era el bypass: con texto libre, un empleado con
  `ARTICULOS_EDITAR` y sin `CATEGORIAS` podía tipear una rama nueva y saltar el
  permiso pensado para el ABM del árbol. Con selectores no hay nada que crear
  al vuelo — elegir una rama que YA existe es editar el artículo, no
  administrar el árbol —, así que el bypass que motivaba la guarda desapareció
  con el campo de texto. `CATEGORIAS` queda guardando sólo el ABM (crear,
  renombrar, mover, borrar desde el panel), que es lo que su descripción en
  `lib/permisos/catalogo.ts` ya decía.
- **El costo unitario del ingreso dejó de ser un dato que nadie lee.** Es
  opcional, y el tile "Último costo" es su primer lector: busca el ingreso con
  costo cargado más reciente (no el ingreso más reciente a secas, que puede no
  tenerlo) y calcula el margen contra el precio de venta actual. Sin ningún
  ingreso con costo, el tile muestra "—", nunca un número inventado.
- **Un artículo en dólares no tiene margen, y el pie del tile lo dice con
  todas las letras** (ciclo del precio en dólares): `MovimientoStock.costoUnitario`
  se guarda **siempre en pesos** —no distingue moneda—, así que comparar ese
  costo contra un precio en dólares exigiría inventar una cotización, que es
  exactamente lo que este ciclo no hace en ningún lado. El valor del tile sigue
  siendo el costo en pesos; el pie pasa a "el costo está en pesos: sin margen
  para un artículo en dólares", **distinto** del "el precio no permite calcular
  el margen" que ya existía: aquél es "no se puede dividir", éste es "no hay
  contra qué comparar". **No es un agujero de este ciclo**: es la costura
  declarada con la deuda del costo (CLAUDE.md, *Decisiones abiertas del modelo
  de datos*), y `textoDeMargen` recibe la moneda como tercer parámetro
  **requerido** por el mismo motivo que `editarArticulo` — omitirlo mostraría
  un margen en pesos para un artículo en dólares, o sea un número equivocado
  sobre plata.
- **"Precios por forma de pago" calcula con `precioConPlan`, la misma función
  que después usa el cobro en `/vender`** — no una cuenta propia — para que la
  ficha nunca pueda decir un número distinto del que cobra el mostrador. Es el
  pedido original del cliente ("un precio para crédito y otro para
  débito/efectivo/transferencia") hecho visible, sin haber guardado un
  segundo precio en la base: se deriva del precio de venta y del porcentaje
  de cada plan al momento de mostrarlo. Trae sólo planes **activos**
  (`planesDelTenant`, sin `incluirDesactivados`) y aplica tanto a productos
  como a servicios — el recargo es del medio de pago, no del tipo de
  artículo. Sin ningún plan cargado, el panel no se renderea (no una card con
  una sola fila que repite el precio de arriba, que sería ruido). **No lleva
  permiso**: es de sólo lectura sobre un precio que la misma ficha ya muestra
  arriba, y quien cobra necesita poder decirle a un cliente el precio en
  cuotas — `COSTOS` sigue tapando el costo y el margen, que son otra cosa.
  **El precio derivado sale en la moneda del artículo**: el recargo es un
  porcentaje puro, así que US$ 300 al 40 % son US$ 420, que es el equivalente
  exacto de los $623.700 que el mostrador va a cobrar. No hay ninguna
  conversión acá, sólo el formateo — `precioConPlan` no sabe de monedas y no
  tiene por qué saberlo.
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
  escapan por RFC 4180 (comillas y comas), y no está restringido a ningún
  permiso: es de sólo lectura, de datos que la pantalla ya le muestra a
  cualquier sesión — lo único que varía con `COSTOS` es si esos datos incluyen
  el costo, no si la exportación misma se ofrece.
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

**En el teléfono**

- **Los tiles se apilan y "En stock" cambia de eje**: en escritorio es una
  columna (rótulo arriba, valor grande abajo); en el teléfono es una fila, con
  el rótulo y el pie a la izquierda y el número a la derecha. "Precio de venta"
  y "Último costo" comparten la fila siguiente.
- **El cuerpo se reordena, no se apila.** La maqueta **intercala** "Datos" y
  "Cómo se movió" entre las piezas de la columna izquierda, así que apilar las
  dos columnas tal cual daba otro orden: los cinco bloques llevan `order-1` a
  `order-5` y `lg:order-none` restaura el de escritorio.
- **Las acciones bajan a un pie fijo** ("Desactivar"/"Reactivar" y "Guardar
  cambios"), atadas a los mismos `<form id=…>` por `form=`. "Ingresar
  mercadería" y "Corregir por conteo" se apilan en vez de compartir una fila de
  dos columnas angostas.
- **La ranura derecha del Topbar queda vacía**, aunque la maqueta dibuje un
  `more-vertical`: las dos acciones principales ya están al pie y las
  secundarias en el cuerpo, así que ese menú no tendría qué contener sin
  inventarlo. Ver `docs/correcciones-pendientes-del-pen.md`, entrada 13.

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
- **"Volver a la primera" (hallazgo M8 del barrido final, sin documentar hasta
  este commit):** mismo criterio que `/inventario` y `/ventas` — con
  `total > 0` la página puede haber quedado fuera de rango, y el `<nav>` de
  paginación vive DENTRO de la rama con órdenes.

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

**En el teléfono**

- **Los contadores de estado pasan de pastillas horizontales a una grilla de
  tres columnas**, con el conteo grande arriba (17 px en Archivo) y el rótulo
  abajo. Son **dos renderizados independientes**, cada uno oculto por CSS, y no
  el mismo árbol reordenado: acá cambia cuál dato va primero y la forma entera
  del chip, no sólo cómo se agrupan las mismas celdas.
- **Siguen siendo diez y no nueve.** La maqueta dibuja tres filas de tres y le
  falta "Rechazado"; sacarlo habría dejado sin ver ni filtrar las órdenes
  rechazadas desde el teléfono. La grilla cae en una cuarta fila con un chip
  solo. Ver `docs/correcciones-pendientes-del-pen.md`, entrada 9.
- **El listado pasa a tarjetas de tres líneas**: número, modelo y el chip de
  estado arriba; cliente y teléfono en una línea unida por "·"; IMEI, fecha de
  ingreso y antigüedad en la tercera. El chip de estado es la **única** celda
  que se dibuja dos veces en esta pantalla, y es a propósito: en el teléfono
  tiene que aparecer después de Equipo, y su columna de escritorio es la
  quinta, así que fundirlo habría corrido a Cliente e Ingresó de lugar.
- **El buscador y sus controles se apilan** en vez de compartir una fila.

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

**En el teléfono**

Las cuatro cards se apilan en el orden que ya traía el DOM, y las acciones
bajan a un pie fijo con "Cancelar" (en `outline`, por lo mismo que en el alta
de artículo) y **"Guardar e imprimir"** — más corto que el rótulo de
escritorio, porque "…ticket" no entra a 390 px al lado de "Cancelar", y porque
es literalmente lo que dice el nodo de la maqueta. Los dos botones del pie
están atados al mismo `<form id="form-recepcion">` por `form=` y al mismo
`pendiente`.

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
- **Anular la orden** — con el permiso `ORDENES_ANULAR` (un dueño siempre lo
  tiene; un empleado, sólo si se lo otorgaron).

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
  anular una venta: guard **en la action**, hoy `exigirPermiso('ORDENES_ANULAR')`
  (antes `exigirDuenio()`, sin excepción).
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
  (con `ORDENES_ANULAR`, orden viva) — esconderlo no reemplaza la revalidación
  de la action (`exigirPermiso('ORDENES_ANULAR')` + `ORDEN_ANULADA`), es sólo
  comodidad. **"Anular orden" pide
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

**En el teléfono**

- **El paño "ESTADO ACTUAL" va a ancho completo** y sus botones de transición
  se apilan a 44 px de alto cada uno, contra los 40 px en fila de escritorio.
- **La bitácora fluye con el resto del cuerpo**: pierde su altura y su scroll
  interno propios, y los recupera en escritorio, donde sigue empatándose con la
  columna vecina.
- **Reimprimir y anular no se pierden.** El `<Encabezado>` envuelve sus
  `acciones` en `hidden lg:flex`, así que sin nada en su lugar la ficha se
  quedaba sin las dos en el teléfono. La maqueta ya lo resolvía: el `printer`
  sube a la ranura derecha en tono suave, y "Anular orden" baja al cuerpo con
  46 px de alto. Es el mismo criterio que se aplicó con el vaciado del carrito
  y con la caja de `/vender` — una capacidad que desaparece y no reaparece en
  ningún lado es un defecto, no una simplificación.

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

**En el teléfono**

**Esta pantalla gana un `<Encabezado>` que antes no tenía en ningún ancho**, y
por eso es la única del ciclo donde sumar el Topbar también cambia el
escritorio: "Ticket #N", subtítulo "80 mm · dos copias en una impresión",
flecha de vuelta a la ficha, y `printer` en la ranura derecha — en **tono
acción** y no suave, la excepción del grupo, porque acá imprimir *es* la acción
de la pantalla y no una secundaria.

**Nada de esto llega al papel.** El `<Encabezado>` va envuelto en
`print:hidden`, y el envoltorio que le da al cuerpo la geometría de excepción
del teléfono (`padding [16,44]`, `gap 14`) se disuelve con `display: contents`
tanto en escritorio (`lg:contents`) como al imprimir (`print:contents`): ni
mueve el aspecto de hoy, ni le agrega un píxel de margen al rollo.

**`ticket.module.css` no cambió de reglas**, y eso lo sostiene un test que
compara el hash del archivo entero — cualquier cambio, hasta un espacio, lo
rompe. Se rebaselineó una sola vez, para corregir un comentario que la propia
suma del Encabezado dejó falso; el CSS con los comentarios eliminados quedó
byte a byte igual.

## `/formas-de-pago`

El ABM de los planes de pago del local: qué formas de pago ofrece y cuánto
recarga —o descuenta— cada una. Es la pantalla que hace configurable el pedido
que abrió el ciclo ("crédito en 1 pago 10 %, crédito en cuotas 40 %").

**Acciones**: `altaDePlan`, `edicionDePlan`, `bajaDePlan`, `reactivacionDePlan`.

**Qué se puede hacer**

- Ver los planes del local en una tabla —activos y dados de baja—, con su forma
  de pago, sus cuotas, su recargo y **el precio de ejemplo derivado**: "un
  artículo de $10.000 se cobra $14.000".
- Crear un plan desde el Topbar: nombre, forma de pago, cuotas y recargo.
- Editar nombre, cuotas, recargo y orden de uno que ya existe.
- Darlo de baja (lógica) y reactivarlo desde la misma celda.

**Decisiones**

- **Detrás de su propio permiso, `PLANES_PAGO`**, que un dueño puede delegar en
  un empleado. No se plegó sobre `ARTICULOS_EDITAR`: editar un artículo mueve
  el precio de UN artículo, y tocar el recargo de un plan mueve el precio de
  TODO el catálogo para esa forma de pago. **Cada action lo vuelve a exigir**,
  no sólo la pantalla: una action es un endpoint y se puede invocar sin pasar
  por acá. Un `DUENO` pasa sin ninguna fila en `usuario_permisos`, igual que en
  el resto del catálogo.
- **El ejemplo de la fila usa un artículo de referencia FIJO de $10.000**, no
  uno del catálogo: sirve para leer el porcentaje, no para cotizar. Con un
  artículo real, la columna cambiaría cada vez que alguien le toca el precio a
  ese artículo, y quien mirara la tabla creería que se movió el recargo. Se
  calcula en el servidor con `precioConPlan` —la misma función que usa el motor
  de ventas—, así que la pantalla no puede prometer un precio distinto del que
  el mostrador cobra.
- **`orden` sale de `cuotas` en el alta y sólo se toca en la edición.** Es lo
  que hace que 3 cuotas salga antes que 12 sin que nadie ordene nada a mano; un
  campo en el alta para confirmar ese default sería una pregunta sin respuesta
  interesante.
- **El medio no se edita**, se muestra, con la salida escrita al lado ("dale de
  baja y creá otro"). El medio define contra qué pagos sirve el plan, y moverlo
  dejaría las ventas viejas apuntando a un plan que ya no describe cómo se
  cobraron.
- **La baja es lógica, no borrado.** Un plan que ya cobró ventas es
  indestructible por la FK `Restrict` de `pagos`, y esas ventas tienen que
  seguir diciendo con qué plan se cobraron. El listado los muestra con su
  leyenda y ofrece reactivarlos; `desactivarPlan`/`reactivarPlan` son
  idempotentes, así que dos clicks no rompen nada.
- **El recargo lleva signo, y el formulario lo dice.** `−10` es el descuento por
  pago contado. El campo es `type="text"` y no `type="number"`: acepta coma
  decimal (13,755), que un input numérico rechaza según el locale del
  navegador, no el del local.
- **El recargo NO pasa por `aDecimal`** (`lib/formato/numeros.ts`), y es la
  única entrada de número del producto que no lo hace: esa gramática rechaza el
  signo por diseño —nada de lo que alimenta (precio, cantidad, stock contado)
  puede ser negativo—, así que un descuento sería inentrable. `porcentajeDe`
  (en `acciones.ts`) lo parsea aparte, y tampoco hereda el rechazo de lo
  ambiguo: un porcentaje está topeado en 999,999, así que nunca lleva separador
  de miles y `13,755` no puede querer decir trece mil setecientos cincuenta y
  cinco. El RANGO lo sigue validando `lib/planes/administrar.ts`, no la action.
- **Los avisos van por toast** (`sonner`), lanzados en el mismo handler que
  ejecuta la acción y nunca desde un `useEffect` sobre `useActionState` — misma
  lección que dejaron el ABM de categorías y el diálogo de permisos. Los
  errores no se auto-descartan (son accionables); los de éxito sí. Clave
  estable por acción y por plan, o sonner apila una copia por render.
- **Esta pantalla necesita JavaScript**: el alta y la edición viven en un
  diálogo de Radix y la forma de pago se elige con un `Select` de Radix. Es el
  mismo trade-off que ya aceptaron `/vender` y el alta de artículos.
- **Sin planes no muestra una tabla vacía** sino qué está pasando: todo se cobra
  a precio de lista y el mostrador no dibuja ningún control de más. Un local que
  nunca cargue un plan es un caso válido y completo.
- **`design/arandano.pen` no dibuja esta pantalla.** No la contradice: falta.
  Queda anotado en `docs/correcciones-pendientes-del-pen.md`, entrada 22. El
  layout, la card y el título reusan los roles que las otras cinco pantallas de
  tabla ya comparten.
- **Y es la única pantalla de la aplicación sin su rediseño de teléfono.** En el
  teléfono las dos cards se apilan y la tabla scrollea adentro de la suya, en vez
  de volverse tarjetas con el patrón `lg:contents` que las otras cinco tablas
  comparten desde el ciclo del teléfono: es legible y operable, no es el
  rediseño. Este ciclo arrancó de `main` antes de ese merge, y la maqueta tampoco
  tiene un frame `Móvil / …` del que derivarlo. Deuda declarada, no un olvido —
  misma entrada 22, que además cuenta el defecto de colapso que el merge sí tuvo
  que arreglar (la tabla quedaba en cero de ancho abajo de ~424 px).

## `/usuarios`

El equipo del local (rediseño de `design/arandano.pen`, frame `App /
Usuarios`).

**Acciones**: `altaEmpleado`, `nuevaClave`, `baja`, `alta`, `cambiarPermiso`.

**Qué se puede hacer**

- Agregar a alguien como `EMPLEADO` o `DUENO` con un control segmentado (no un
  `<select>`), con su contraseña inicial.
- Cambiarle la contraseña a cualquier usuario del local, **incluido uno mismo**
  —el link "Cambiar clave" abre un formulario inline en la propia fila.
- Dar de baja y reactivar personas — "Baja" queda disponible para cualquier
  fila activa que no sea la propia, dueños incluidos (ver más abajo).
- Copiar la clave recién generada con un botón, desde el aviso ámbar.
- **Otorgarle y quitarle, a cada `EMPLEADO`, cada uno de los permisos del
  catálogo** (`ARTICULOS_CREAR`, `ARTICULOS_EDITAR`, `COSTOS`, `CATEGORIAS`,
  `PLANES_PAGO`, `VENTAS_ANULAR`, `ORDENES_ANULAR`) desde un diálogo por fila
  —columna "Permisos", botón "N de M permisos" / "Sin permisos" que abre
  `PermisosDeUsuario` con los switches de `FilasDePermisos`, uno por permiso
  del catálogo—. Una fila de
  `DUENO` no lleva ese botón: un dueño puede todo por construcción
  (`exigirPermiso` le da verdadero sin tocar la tabla), así que un diálogo con
  todos prendidos y trabados no informaría nada.

**Decisiones**

- **Todo esto es sólo del dueño**, y el guard (`comoDuenio`) está en cada
  action, no en la pantalla — **incluida `cambiarPermiso`, a propósito y sin
  excepción**: ver la entrada de `CLAUDE.md` sobre por qué repartir permisos
  no es delegable aunque el resto del catálogo sí lo sea.
- **Cada switch guarda solo**, sin botón "Guardar" — mismo criterio que el ABM
  de categorías: un formulario con estado sucio para unos pocos booleanos
  independientes agrega la pregunta "¿guardé?" a cambio de nada. El aviso sale
  por toast (`sonner`), disparado en el mismo handler que llama a la acción y
  no en un `useEffect`, con la misma lección que dejó el ABM de categorías: un
  efecto atado al ciclo de vida del componente pierde el aviso si el
  `revalidatePath` remonta la fila antes de que corra.
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
- Consultado en vivo con el MCP de Pencil: **en escritorio**, a diferencia de
  los otros dos títulos de card de esta pantalla ("El equipo del local",
  "Agregar a alguien", en Archivo 15px/600), el título de la card de Reglas usa
  la pila del sistema a 13px/700 — el relevamiento escrito los agrupaba a los
  tres. En el teléfono la maqueta invierte esa excepción: ver más abajo.

**En el teléfono**

- **El aviso de clave generada pasa primero**, arriba de todo, cuando en
  escritorio vive debajo de la tabla. Las cuatro piezas quedan como una lista
  plana con gap uniforme: los dos envoltorios de columna se disuelven con
  `contents` y cada pieza lleva su `order-N`, sin tocar su lugar real en el DOM.
  Su botón de copiar pasa a ser sólo ícono (34×34), con `aria-label` propio
  porque se queda sin texto visible.
- **La tabla del equipo pasa a tarjetas**, con un **avatar de 34 px** que sólo
  existe en el teléfono: la inicial del nombre, con el color del rol. No hace
  falta duplicar ninguna celda —a diferencia de `/servicio-tecnico`— porque el
  orden de escritorio (Persona, Rol, Estado, Permisos, Acciones) ya es el que
  el teléfono necesita.
- **El disparador de permisos se funde en la línea de acciones**, con el mismo
  separador "·" a 10 px y el mismo tratamiento de link que "Cambiar clave" y
  "Baja": "· 2 de 6 permisos · Cambiar clave · Baja". Es **un solo nodo en el
  DOM** —el `lg:` de cada clase repone el botón fantasma de 28 px de
  escritorio—, y eso alcanza porque la columna "Permisos" ya está pegada a
  "Acciones" en el orden de escritorio: no hubo que reordenar nada ni duplicar
  la celda. En la fila de un **dueño** la celda entera desaparece del teléfono
  (`hidden lg:block`) para no dejar el hueco del `gap`; en escritorio sigue
  ocupando su pista, vacía, porque con `display:contents` sobre la fila una
  celda salteada correría todas las columnas siguientes.
- **El diálogo de permisos sigue siendo un `Dialog` centrado, con su propio
  velo, y no un `Sheet` desde abajo.** El ciclo del teléfono estableció
  `Sheet` para los overlays móviles y le cambió el velo a `bg-foreground/65`
  sin desenfoque; el ciclo de permisos llegó con `Dialog` de shadcn. Después
  del merge conviven los dos velos. **Es una decisión de producto pendiente**,
  no una que un merge pueda tomar: se dejó funcionando como venía. En la misma
  bolsa, `components/ui/dialog.tsx` y `components/ui/switch.tsx` traen `sm:`
  (640 px) del registry de shadcn, un corte que el ciclo del teléfono prohíbe
  en código propio — están en `components/ui/`, que es código copiado tal cual
  y que `test/responsive.test.ts` ya excluye, así que tampoco se tocaron.
- **El título de "Dos reglas que el sistema no deja romper" paga Archivo, y en
  escritorio no.** No es un bug de ninguno de los dos lados: son dos frames con
  una decisión distinta cada uno, y las dos son la autoridad en su ancho. Está
  explicado en `docs/sistema-de-diseno.md`, en la nota bajo la escala
  tipográfica, y en el propio `app/(app)/usuarios/tipografia.module.css`.
- **La celda Persona ganó `lg:min-w-0` + `lg:truncate`, y eso es la única
  excepción de todo el ciclo a la consigna de que el escritorio no cambia de
  aspecto.** Antes de la rama, `<Table className="table-fixed">` venía
  envuelta en el `overflow-x-auto` que trae `components/ui/table.tsx`, así que
  un mail largo no truncaba: scrolleaba la tabla entera. El grid de
  `lg:contents` no tiene ese envoltorio, y "Persona" es la única pista
  flexible (`1fr`) de esta grilla — sin `min-width: 0`, un ítem de grid no se
  achica por debajo de su contenido, y el mail (sin espacios donde cortar)
  ensanchaba la pista y sacaba la card de su contenedor en una ventana
  angosta de escritorio. Es el mismo mecanismo que ya usa la columna Detalle
  de `app/(app)/inventario/historial.tsx`. Lo que se ganó: la card ya no se
  desborda. Lo que cambió, y por eso es una excepción consciente y no gratis:
  un mail que antes se podía leer entero scrolleando la tabla ahora elide con
  puntos suspensivos.

## `/bot`

El bot de WhatsApp del local: conectar el número, prender y apagar, y escribir
lo que el bot cuenta del negocio. Sin bandeja de conversaciones — el local sigue
teniendo la suya, que es la aplicación de WhatsApp Business en su celular.

**Acciones**: `generarEnlaceDeConexion`, `confirmarNumeroDelLocal`,
`desconectarNumero`, `prenderOApagar`, `guardarInformacionDelLocal`.

**Qué se puede hacer**

- Generar el enlace de onboarding y conectar el número que el local ya usa (sólo
  el dueño).
- Confirmar cuál de los números que Kapso reporta es el del local (sólo el dueño).
- Prender y apagar el bot.
- Escribir la información que el bot responde: horarios, dirección, envíos,
  formas de pago.
- Ver cuántas respuestas dio este mes contra el tope, y desconectar el número
  (sólo el dueño).

**Decisiones**

- **Conectar es del dueño; configurar se delega.** Conectar o desconectar
  implica firmar con Facebook y le pone (o le saca) el bot al WhatsApp que el
  local usa todos los días: `exigirDuenio()`, como `/usuarios`. Prender, apagar
  y editar la información son `exigirPermiso('BOT')`. Es la misma regla que
  separó `PLANES_PAGO` de `ARTICULOS_EDITAR`: se delega lo que opera el negocio,
  no lo que reparte poder. La pantalla entera exige `BOT`, así que un empleado
  sin el permiso no la ve; uno con el permiso la ve completa pero sin los
  botones de conexión.

- **El redirect de Kapso no escribe nada.** Al volver del onboarding, la
  pantalla ve que hay customer y no hay número, y le PREGUNTA A KAPSO cuáles
  conectó ese customer. Los query params del redirect (`phone_number_id` y
  compañía) se ignoran: son texto del navegador, y un valor falseado conectaría
  el número de otro comercio. `confirmarNumero` vuelve a verificar contra Kapso
  que el número elegido esté en la lista del local — el formulario es tan
  falsificable como la query string, así que la selección se valida igual. De
  paso, preguntar resuelve el caso de la pestaña cerrada a mitad del signup: el
  dueño vuelve cuando quiera y el número lo está esperando.

- **La pantalla llama a un tercero al renderizar, y por eso el try/catch no es
  opcional.** `scripts/smoke.sh` barre esta ruta contra `arandano-stage`, que no
  tiene `KAPSO_API_KEY` ni cuenta de Kapso. Si acá se tirara una excepción,
  **todo deploy haría rollback**. Sin la variable la pantalla renderiza igual y
  la card lo dice.

- **El bot queda apagado al conectar.** Conectar el número y ponerlo a
  contestarles a los clientes son dos decisiones. Un bot que arranca contestando
  en el mismo segundo, con la información del local todavía vacía, le contesta
  "no sé" a la primera pregunta que le hagan.

- **Prenderlo sin información avisa y no impide.** Mismo criterio que el
  selector de moneda del ciclo del precio en dólares: el bot igual sirve para
  precios y disponibilidad, así que bloquear sería peor que avisar.

- **El consumo se cuenta, no se acumula.** "X de Y respuestas" sale de un
  `count` sobre `mensajes_bot`, sin contador que resetear. Es la misma
  preferencia que `Articulo.stock` respecto de sus movimientos y que la columna
  "Queda" del historial de inventario, y acá el argumento es más fuerte: los
  mensajes se guardan igual, así que un contador sería un caché de algo ya
  escrito cuyo único modo de falla —decir 1000 cuando hay 12 filas— nadie
  descubre hasta que un local reclama que el bot dejó de contestar.

- **La maqueta no dibuja esta pantalla**, en ningún ancho. El layout, las cards
  y el título de card se derivan de `/formas-de-pago`, que es el mismo caso.
  Anotado en `docs/correcciones-pendientes-del-pen.md`, entrada 26.

- **Un gate de rollout la esconde en los locales que no están en la lista, y es
  TEMPORAL.** `BOT_HABILITADO_EN` (`lib/bot/habilitado.ts`) nombra los
  subdominios donde el bot existe todavía; se declara en el `environment:`
  versionado de `docker/compose.prod.yml` y en ningún otro stack. Existe porque
  el bot es la primera integración con un tercero del producto y se prueba en
  producción con un local real antes de que lo vea todo el mundo — sin feature
  flags, es esto o que el primer deploy se lo muestre a todos a la vez.

  **La ausencia de la variable habilita a todos**, y ese fail-open no es
  descuido: `scripts/smoke.sh` barre esta ruta contra el canario de
  `arandano-stage`, que no la declara, y exige 200. Con un default de "nadie"
  el barrido daría 404 y **todo deploy haría rollback** — el mismo modo de falla
  que ya obliga al try/catch de Kapso, dos ítems más arriba. Lo que hace
  aceptable el fail-open es dónde vive la variable: un archivo versionado, no
  el `.env` del servidor, así que no se pierde editando credenciales a mano.

  **Está en las cinco puertas, no sólo en la pestaña**: el layout le saca `BOT`
  a los permisos que le pasa al sidebar, la pantalla hace `notFound()`, las
  cinco acciones lo repiten (`exigirBotHabilitado`) y el webhook devuelve su
  404 genérico. Ocultar la pestaña no es una defensa —un `DUENO` tiene el
  permiso `BOT` sin fila en `usuario_permisos`, así que tipear `/bot` lo dejaría
  entrar—, y una server action es un endpoint que se invoca sin pasar por la
  pantalla. Es la misma lección de las dos copias de un botón que dejó escrita
  el merge del ciclo móvil, con cinco copias en vez de dos.

  **`notFound()` y no `forbidden()`**: para ese local la pantalla no existe
  todavía; un 403 anunciaría que hay algo a lo que vale la pena volver.

  **No reemplaza al permiso `BOT` ni lo duplica**: son dos preguntas distintas
  —en qué locales existe el bot, y a quién del local se le delega—, así que un
  empleado sin `BOT` sigue sin ver la pantalla aunque su local esté en la lista.

  **Cómo se libera a todos**: borrar la línea de `docker/compose.prod.yml`. El
  código puede quedarse (sin variable no hace nada) o irse entero —
  `lib/bot/habilitado.ts`, las cinco llamadas y sus casos— cuando ya no se
  espere volver a usarlo.

## `/dashboard`

El panorama del local, sin filtrar por fecha a mano: un segmentado de cuatro
rangos rápidos (Hoy / 7 días / Este mes / Este año, default **Este mes**) y
cuatro tiles con lo que pasó en ese período, cada uno comparado contra el
**tramo homólogo** del período anterior — no la ventana previa del mismo
largo, sino el mismo tramo calendario (a mitad de agosto, "comparado con
julio" compara contra el 1–21 de julio, no contra el 21–31 de julio). Ver
`periodoAnterior` en `lib/dashboard/rango.ts`.

**Acciones**: `exportarVentas`.

**Qué se puede hacer**

- Elegir el rango con el segmentado (`?rango`, sin JavaScript) y ver, en
  escritorio, el texto del período vigente y un chip "Comparado con `<mes o
  período anterior>`" al lado.
- Ver **"Total del período"** (el tile de marca, `--marca` como ancla): lo
  cobrado en el período, con un chip de variación contra el tramo homólogo.
  **Este tile invierte**: si no entró ni un peso pero sí entraron dólares, el
  número grande pasa a ser el dólar y se omite el pie —sin esto, un local que
  carga y cobra TODO su catálogo en dólares abriría el dashboard con "$ 0,00"
  de titular—. Cuando no está invertido y sí hubo dólares, el pie dice
  "US$ X aparte" en vez de convertir nada.
- Ver **"Ventas cobradas"**, con el mismo chip de variación.
- Ver **"Ticket promedio"**: sólo el valor, **sin pie** (ver *Decisiones*).
- Ver **"Margen"**, sólo si la sesión tiene el permiso `COSTOS` — el mismo que
  ya protege el costo y el margen en `/inventario/[id]`.
- Entrar a `/vender` desde el botón del Topbar (o la ranura del teléfono).
- Bajar un CSV con las ventas del período elegido (`?rango`) desde "Exportar
  CSV" —el Topbar en escritorio, un ícono de 38 px en el teléfono—: número,
  fecha, hora, cliente, medios, vendido y cobrado por separado en cada moneda,
  recargo y estado. Una fila por venta, sin límite —ni de página ni del
  período: exporta lo que `?rango` esté mostrando, no un recorte—.

**Decisiones**

- **El chip de variación no se dibuja sin período anterior.** `delta()`
  devuelve `null` cuando el tramo homólogo no vendió nada —dividir por cero no
  tiene porcentaje—, y ahí el pie del tile lo dice con todas las letras ("sin
  ventas en julio") en vez de dejar un hueco. Es el mismo criterio que ya usa
  `pieDeCobradas` en `/ventas` para "sin dato" contra "dato en cero".
- **Ningún tile convierte una moneda a la otra.** El delta del tile de marca
  compara la MISMA magnitud que muestra —pesos contra pesos, o dólares contra
  dólares cuando está invertido—, nunca una cruzada con la otra.
- **"Ticket promedio" no lleva pie, y antes iba a llevar la mediana.** Se sacó
  en la review de esta task, con el motivo completo y el disparador para
  traerla de vuelta en `docs/correcciones-pendientes-del-pen.md`, entrada 27.
- **El margen va detrás de `COSTOS` y el tile no se renderea sin el
  permiso** — no se pone en "—": ese guión afirmaría que ninguna venta cargó
  costo, que es una afirmación distinta y falsa cuando lo que pasa es que a
  esta persona no se le muestra. Es la misma pieza de dato que ya protege
  `/inventario/[id]`, así que esconderla acá y mostrarla allá sería no
  protegerla en absoluto.
- **Todo el estado vive en la URL, server-only.** El rango y (en la próxima
  task) la moneda de los paneles son `?rango`/`?moneda`, escritos sólo cuando
  no son el default — mismo criterio que ya usan `/ventas` y
  `/formas-de-pago`.
- **Sin `permiso` ni `soloDueno` en la pestaña**: la ve cualquier sesión,
  igual que `/ventas`. Un dueño y un empleado sin ningún permiso ven el mismo
  dashboard, salvo el tile de margen.
- **`design/arandano.pen` dibuja esta pantalla** (frames `App / Dashboard` y
  `Móvil / Dashboard`), pero el `.pen` versionado del repo todavía no los
  tiene — es el mismo caso que ya dejó anotado el ciclo del cobrado por
  moneda: el archivo vivo sólo se ve por MCP mientras está abierto en Pencil,
  y guardarlo y commitearlo lo hace una persona. Ver
  `docs/correcciones-pendientes-del-pen.md`, entrada 27.
- **Queda para la próxima task de este ciclo (los cuatro paneles)**: "Cuánto
  se vendió por día" con su ventana FIJA de catorce días —no responde al
  segmentado de arriba, porque con el rango en Hoy sería una sola barra—,
  "Cómo entró la plata" con su anillo, "Qué se vendió por categoría" y "Lo que
  más se vendió". El selector de moneda (`?moneda`, sólo se dibuja si el
  período tuvo pagos en las dos monedas) es de esos paneles, no de esta
  pantalla: los cuatro tiles de acá no necesitan elegir moneda porque el tile
  de marca ya resuelve la suya solo (ver "Este tile invierte", arriba).
- **"Exportar CSV" no lleva costo ni margen, aunque quien lo baje tenga el
  permiso `COSTOS`.** Un CSV sale del sistema y sigue circulando —se manda
  por mail, queda en una carpeta compartida—; el alcance de este ciclo es el
  dashboard, no un reporte de rentabilidad. Es una decisión de PRODUCTO, no
  una limitación técnica: `exportar-accion.ts` ni siquiera consulta
  `costoUnitario`.
- **`exportarVentas` vive en `app/(app)/dashboard/exportar-accion.ts`, no en
  `acciones.ts`, y es la única pantalla del repo con esta forma.**
  `acciones.ts` no lleva `'use server'` de módulo: `filaCsv`/`ENCABEZADO_CSV`
  tienen que ser exports SUELTOS para poder testearse (`acciones.test.ts`), y
  un archivo `'use server'` de módulo sólo puede exportar funciones async
  (`test/use-server.test.ts`). Separar el archivo entero —no sólo el
  directive— es lo que además mantiene a `acciones.ts` afuera del alcance de
  `test/limite-cliente-servidor.test.ts`: sin `'use server'` de módulo,
  `exportar-accion.ts` es la frontera que ese test necesita para no cruzar de
  largo hasta `lib/tenant/prisma.ts` siguiendo el import que `exportarVentas`
  necesita. Mismo patrón que `lib/clientes/rotulos.ts`, invertido: allá se
  sacó la función PURA para que un Client Component la importara sin
  arrastrar el módulo que la rodeaba; acá se saca la función IMPURA para que
  el módulo puro pueda exportar de más sin romper el contrato de
  `'use server'`.
- **"Exportar CSV" existe en dos copias —el Topbar de escritorio y la
  ranura de 38 px del teléfono (`controlMovil`, no `accionMovil`: es un
  control que no navega)— y las dos llaman al mismo `BotonDeExportar`**
  (`app/(app)/dashboard/exportar.tsx`), con `children` como una FUNCIÓN de
  `exportando` en vez de un nodo fijo: el Topbar quiere texto
  ("Exportar CSV" → "Exportando…"), la ranura de 38 px sólo tiene lugar para
  un ícono (que pasa a un spinner) más un `sr-only` con el mismo texto —el
  ícono solo no tiene nombre accesible—. `page.test.tsx` cuenta las DOS
  apariciones en las DOS direcciones, mismo criterio que ya fija
  `test/permisos-en-las-dos-copias.test.ts` para el resto de las pantallas
  con un control duplicado.

<!-- pantallas:fin -->

## Lo que hereda toda pantalla de la aplicación

Todas las de arriba que no son `/` ni `/login` cuelgan de `app/(app)/`, y de ahí
heredan cuatro cosas sin que nadie las repita:

- **El guard de sesión** (`exigirSesion` en el layout). Una ruta nueva bajo
  `(app)` nace protegida; `test/rutas-con-guard.test.ts` falla si alguna queda
  afuera del grupo sin declarar por qué.
- **`robots: noindex`**. Son datos de un local.
- **El shell**: el cartel con el nombre del local, quién sos, cómo salir, y la
  navegación. **Abajo de 1024 px el mismo paño se sirve como drawer**, sobre un
  velo, con un botón de cerrar que flota afuera del panel. No hay una segunda
  navegación: es el mismo `Sidebar` de shadcn, que ya renderiza un `Sheet`
  cuando `useIsMobile` da verdadero.
- **El encabezado, de 56 px en el teléfono y 66 en escritorio**
  (`components/shell/encabezado.tsx`): el único `<h1>` de la pantalla, un
  subtítulo opcional y un slot de acciones a la derecha. Las de la
  aplicación lo usan todas;
  ninguna dibuja su propio `<h1>`. **Es una sola franja para las dos maquetas,
  no dos componentes** — el `.pen` la modela igual, con un `Móvil/Topbar`
  reusable que los doce frames instancian. En el teléfono gana dos ranuras de
  38 px: a la izquierda el `arrow-left` (con `atras` o `alVolver`) o, si no hay
  ninguno de los dos, el trigger que abre el drawer; a la derecha **una sola**
  acción —`accionMovil`, un link, o `controlMovil`, un control con estado
  propio—, mientras las `acciones` de escritorio pasan a `hidden lg:flex`.

**Y hay un solo corte, 1024 px**, que gobierna las dos mitades a la vez: el
`lg:` de Tailwind y el `Sheet` del sidebar (`MOBILE_BREAKPOINT` en
`hooks/use-mobile.ts`). Las clases se escriben mobile-first — el valor del
teléfono sin prefijo, el de escritorio con `lg:`. El porqué del número y del
patrón `lg:contents` que comparten los cuatro listados y el carrito está en
`CLAUDE.md`, en la entrada del ciclo del teléfono.

**La derivada que ese patrón deja abierta, y que conviene tener escrita**: en
varias filas quedan nodos que cuelgan de un `role="row"` sin ser ellos mismos
una celda, y una fila ARIA sólo debería tener celdas. Son de dos formas
distintas y sólo una es deuda — pero el criterio para distinguirlas **no** es
"hijo directo del row": un agrupador `lg:contents` puede anidar otro agrupador
adentro, y la deuda real puede terminar viviendo un nivel más adentro que el
propio row, como el caso de `/ventas` más abajo lo prueba. El criterio real es
si el nodo lleva contenido propio sin colgar de ningún `role="cell"`, sin
importar cuántos agrupadores lo separen del row:

- **Agrupadores `lg:contents`** — cajas que sólo juntan celdas para poder
  apilarlas en el teléfono, y se disuelven en escritorio. Son andamiaje de
  layout puro: todo lo que muestran vive ya en una celda hija. `/vender` y
  `/usuarios` los usan así de punta a punta. Los de `/ventas` casi cumplen lo
  mismo, con una excepción — ver el bullet de abajo.
- **Líneas fundidas `lg:hidden`** — contenido visible en el teléfono que junta
  datos que en escritorio son columnas distintas, sin colgar de ningún
  `role="cell"` en ningún nivel. Ésta sí es la deuda, porque es contenido y no
  layout. Quedan **tres en `/ventas/[id]`** (una en "Qué se vendió", dos en
  "Cómo se pagó"), **dos en el historial de `/inventario/[id]`**, **una en
  `/servicio-tecnico`** —esta última con su razón ya escrita en el docblock de
  `Listado` de esa pantalla: fundirla habría corrido dos columnas de escritorio
  de lugar— **y una en `/ventas`**: `{f.itemsLabel} · {f.mediosLabel}`
  (`app/(app)/ventas/page.tsx:561`) vive dentro del agrupador "Datos", no como
  hijo directo del row, así que un conteo que sólo mirara hijos directos la
  pasaba por alto — es la misma deuda que las otras cinco, un nivel más
  adentro en el DOM.

**`/inventario` ya no tiene ninguna**: la ola final del ciclo fundió su línea de
meta dentro de la celda real de **Stock**, que es la técnica que
`/servicio-tecnico` ya usaba en su celda "Ingresó" — un bloque `lg:hidden` y
otro `hidden lg:flex` como hermanos adentro de la misma celda. La lección que
hace falta para repetirla en las otras: **el dato no tiene por qué vivir cerca
de la celda que uno imagina**. La meta de `/inventario` habla del código, del
estado y del stock, y cuelga de la celda de Stock simplemente porque es la que
ocupa su lugar en la grilla de escritorio. Cuándo NO se puede: cuando la celda
que tocaría no está en la posición del DOM donde el teléfono necesita la línea,
porque moverla correría columnas de escritorio — que es exactamente el caso de
`/servicio-tecnico` y su chip.

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
