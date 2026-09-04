# Las decisiones que tomó el rediseño

El rediseño de las trece pantallas contra `design/arandano.pen` se ejecutó en
nueve ciclos, sin nadie a quien preguntarle: la instrucción fue resolver todo y
dejarlo escrito. Este archivo es ese registro.

**No es un changelog.** Lo que cada pantalla hace vive en `docs/pantallas.md`;
lo que el sistema de diseño decidió, en `docs/sistema-de-diseno.md`. Acá van
sólo las decisiones que **no se derivan de la maqueta** — las que alguien tomó
porque el `.pen` no decía, decía mal, o decía algo que el producto no podía
sostener. Cada una con lo que cuesta si está mal, para que revertirla sea barato.

**La regla que gobernó todo el rediseño**: `design/arandano.pen` es la
autoridad; cuando contradice al código, a los docs o a los tests, se modifica lo
otro. Las decisiones de abajo son, en su mayoría, los lugares donde esa regla no
alcanzaba para decidir.

## Lo que cambió en el producto

### El estado `APROBADO` entra al flujo de Servicio Técnico

La maqueta lo muestra en tres lugares. Hoy `PRESUPUESTADO` va directo a
`EN_REPARACION`, así que **la aprobación del cliente no queda registrada en
ningún lado** — y en un service eso es justamente lo que hay que poder probar
antes de gastar un repuesto. Es aditivo al enum, no rompe ninguna orden
existente.

**Lo que NO se tocó, a propósito**: el resto del grafo de transiciones. La
maqueta dibuja para `EN_REPARACION` botones que no coinciden con las
transiciones legales de hoy —muestra `Rechazado`, que no sale de ahí, y no
muestra `Presupuestado`, que sí—. Agregar un estado que falta es llenar un
hueco evidente; **cambiar a qué estados se puede ir desde uno existente es
rediseñar el flujo del negocio**, y eso lo decide el dueño del producto. Queda
como pregunta abierta.

### El formulario de captura de la landing pasa a un campo

De cinco campos (nombre, mail, rubro y dos más) a uno: "Tu WhatsApp o tu mail".
El motivo no es sólo la maqueta — `CLAUDE.md` describe un trial de cinco días
"con muchos registros que no convierten", y un formulario de cinco campos
delante de eso es fricción pura.

`Lead.nombre`, `.email` y `.rubro` pasan a nullable. **Reversible en las dos
direcciones**: el código viejo sigue insertando valores y la base los acepta.

### El retrato de la landing pierde el cartel con el nombre del local

`app/sitio/retrato.tsx` mostraba "Flor Celulares" en Archivo, encima del
carrito. La reconstrucción contra el `.pen` (nodo `qjo7l`, "Carrito real")
arranca directo en el encabezado hundido, sin cartel adentro — pero antes de
sacarlo se buscó a dónde había ido a parar (la lección que ya dejó el ciclo
6, más abajo): se mudó a la barra de navegador que envuelve al retrato, con
la URL `flor.arandano.app/vender`. No es una pérdida, es la misma
información en otro lugar del mismo frame.

### Los tres puntos de la barra de navegador no inventan un color

El `.pen` los declara en hex crudo (rojo/ámbar/verde), sin ningún token
`$ar-*` asociado — decoración de ventana, no marca. En vez de aproximar con
`color-mix` (el recurso que ya usaron Login y otros hex sueltos del `.pen`),
se reusaron los tres tokens semánticos que ya significan exactamente eso en
el resto de la app: `--destructive`/`--warn`/`--ok`. Ningún color nuevo, y el
significado coincide.

### La landing pasa a tener tres superficies de `--marca`, no una

`docs/sistema-de-diseno.md` documentaba dos superficies de marca en el sitio
público (login, franja de cierre) con la regla "una por pantalla, alrededor
del dato principal". El `.pen` de la landing dibuja una tercera y una cuarta
(la card "Núcleo" de Módulos, la card "Profesional" destacada de Planes) en
el mismo documento HTML. La lectura que resuelve la tensión: una landing que
se recorre con scroll no es una pantalla que se mira de un vistazo como
`/vender` — la unidad de cuenta pasa a ser la banda visible, no el
documento entero, y ninguna de las dos ancla un número (una ancla la idea
del producto, la otra el plan recomendado). Quedó escrito en
`docs/sistema-de-diseno.md`, sección "El arándano como superficie", no sólo
acá.

### `Formulario` gana `variante` y `textoBoton` sin romper el contrato con `enviarLead`

El mismo componente vive en el Hero (fondo claro, botón "Quiero probarlo") y
en el Cierre (sobre `--marca`, botón "Empezar") — mismo campo, mismo
`action`, dos superficies y dos invitaciones distintas que el `.pen` no deja
resolver con un solo tratamiento fijo. Dos props opcionales en vez de dos
componentes separados: el campo y la lógica de envío no se duplican.

### La sección `Direccion` de la landing se borra

La caja con la URL de ejemplo no tiene equivalente en la maqueta. No es un
estado que el `.pen` no modele —como el hover o el typeahead—: es una sección
entera que el rediseño no incluye.

### El CSV de inventario no es la tabla de inventario

Dos decisiones que se apartan de lo que la pantalla muestra, porque **la maqueta
no diseñó el CSV** — sus columnas son invención del ciclo:

- **Exporta la fecha con año**, aunque la tabla la muestre sin él. La tabla está
  paginada y mira lo reciente; el CSV no tiene límite de filas, así que un
  artículo con tres años de movimientos exportaría filas indistinguibles entre
  2024 y 2026.
- **Incluye "Usuario"**, aunque la pantalla no lo muestre. La consulta ya traía
  el dato y lo descartaba. Una bitácora append-only sin el "quién" no sirve para
  auditar, que es para lo único que alguien baja este archivo.

### "Cómo se movió" deja de contar ventas anuladas

`/ventas` ya tenía esa regla escrita. Que dos pantallas del mismo producto
contaran distinto la misma venta era el defecto, no la regla.

### La columna "Vendió" del listado de ventas pasa a "Cliente"

El **dato** que la maqueta muestra es correcto —el cliente es más útil que el
vendedor en un listado de ventas— pero el **rótulo** está mal: una columna que
dice "Vendió" y muestra "Martín Sosa" se lee al revés. Es un error de la
maqueta, no del código.

Y que el empleado ya no se vea en el listado se anota como **capacidad
resignada**, no se restaura: la maqueta eligió el cliente, y el vendedor sigue
estando en la ficha de la venta.

### `STOCK_BAJO_UMBRAL = 5`, por omisión

El modelo no tiene columna de umbral por artículo y el ciclo no incluía
migración, así que hubo que elegir un número. Cinco unidades es razonable para
un local de celulares. **Queda escrito como decisión por omisión, no como
constante inevitable**: el día que alguien quiera umbral por artículo, es una
columna nueva y este número es el default.

### Archivo gana una tercera superficie

El h1 de las pantallas pasa a Archivo 21/600. `docs/sistema-de-diseno.md` decía
que sólo el Cartel y el Importe pagaban esa familia; la maqueta dice otra cosa,
y la maqueta manda. El documento y `test/tipografia.test.ts` se actualizaron.

### El estado de la orden bajó al cuerpo antes de tener dónde ir

El título de la ficha pasó a `Orden #N · <marca> <modelo>`, y el estado sólo
aparecía ahí. Cambiar el título a secas le sacaba a la pantalla un dato que
tenía, así que el estado bajó al cuerpo **en la posición que la maqueta le da**,
esperando el paño de "Estado actual" que construyó el ciclo 6.

## Lo que se resignó, y hay que saber que se resignó

- **El empleado que hizo la venta** ya no se ve en el listado de `/ventas`
  (sigue en la ficha).
- **`hooks/use-mobile.ts` no tiene test.** La lógica real —el breakpoint, el
  `matchMedia`, el listener de `change`, el cleanup— tiene cobertura cero,
  porque todos los tests del sidebar usan `renderToStaticMarkup` y sólo tocan
  `getServerSnapshot`. Peor: el resultado en SSR (`false`) coincide con lo que
  esos tests esperan, así que la falta de cobertura queda encubierta. Testearlo
  pide jsdom, que es una decisión de infraestructura propia.
- **Elegir un cliente existente al recibir un equipo ya no anda sin
  JavaScript.** Era un `<select>` nativo y pasó a tarjetas seleccionables con
  estado de React, como pide la maqueta. Falla ruidosa (el alta rechaza el
  nombre vacío), no en silencio. Lo que fue un accidente y se corrigió: el
  commit borró el comentario que afirmaba que la pantalla andaba sin una línea
  de JavaScript, sin declarar la pérdida.
- **El campo "Nota" del stock inicial** no se construyó: necesita un parámetro
  nuevo en `EntradaCrearArticulo`, fuera del alcance del ciclo.
- **El line-height del cartel** quedó como está: `components/cartel.module.css`
  comparte el tratamiento con la persiana del login, y tocarlo movía una
  pantalla de otro ciclo.

## Cómo se trabajó, y qué se aprendió trabajando

Estas no son decisiones de producto, pero son las que más caro salieron
descubrir. Van acá porque el próximo ciclo largo las va a necesitar.

### Dos agentes no pueden correr la suite a la vez

La suite levanta su propio Postgres efímero con nombre fijo. Dos agentes
corriendo `npm test` en paralelo se pisan el contenedor y producen **fallas
fantasma**. Un reviewer que ve fallas fantasma puede reportar como rotura algo
que no lo es o, peor, dar por bueno un verde que no verificó.

### El mutation testing se hace sobre una copia

Un agente que muere a mitad del experimento deja el repo en el estado roto que
estaba probando. Pasó una vez: un reviewer murió con el Critical reintroducido
en el árbol de trabajo. Se agarró sólo porque alguien miró `git status` antes de
relanzar.

### Un test que no puede fallar es peor que ninguno

Los tests de componente de este repo son whitebox —regex sobre el texto fuente—
y **un regex laxo es indistinguible de uno estricto a simple vista**. El
rediseño encontró más de quince tests que no podían ponerse rojos, incluido uno
cuyo *nombre* prometía una aserción que su cuerpo no hacía. La única defensa que
funcionó fue romper el código a propósito y mirar.

### El gate sólo ve lo que mide, y eso hay que auditarlo

Dos veces en el último ciclo el mismo problema, con dos disfraces.

**El bundle.** Un Client Component importaba —como valor, no como tipo— una
función de un módulo que abre transacciones, y eso arrastró `pg` al navegador.
Cuatro pantallas quedaron en 500. **`npm test`, `npm run lint` y `npx tsc
--noEmit` pasaron los tres**: el harness renderiza con `renderToStaticMarkup`
en Node, donde importar `pg` es perfectamente legal. Sólo un bundle real lo
atrapa, y ninguno de los tres bundlea. Pasó por una review final entera sin que
nadie lo viera, y la review fue buena — la herramienta no alcanzaba.

Desde entonces `npm run build` es parte del gate de cada ciclo. Pero el build
depende de que alguien se acuerde de correrlo, así que además está
`test/limite-cliente-servidor.test.ts`: recorre todo archivo con `'use client'`,
sigue sus imports de valor —por alias, relativos y a través de `export … from`—
y falla si alguno llega a la base.

**El smoke test.** `scripts/smoke.sh` verificaba que la landing fuera la de
verdad buscando `name="nombre"` en el HTML. El formulario pasó a un campo y
dejó de emitir ese campo. El paso 9 de `deploy.sh` habría fallado en el próximo
deploy **diciendo que la home no responde, mientras la home respondía
perfecto** — que es el peor modo de falla que puede tener un gate, porque manda
a diagnosticar el lugar equivocado.

**La lección que vale para lo que venga**: una aserción de gate que cita el HTML
de una pantalla es una dependencia oculta de esa pantalla, y no hay ningún
mecanismo que avise cuando se rompe. Cada vez que se rediseña algo que el gate
mira, hay que ir a leer el gate.

### Un contador mantenido a mano se desincroniza

`CLAUDE.md` llevaba una cuenta de cuántas pantallas iban rediseñadas. Se
corrigió dos veces durante el rediseño y quedó vieja las dos. La tercera vez no
se actualizó el número: se borró el contador, porque el documento ya decía lo
durable unas líneas más arriba.

Es la misma regla que ese archivo ya escribía para el número de versión contra
el tag de git, aplicada a sí mismo.

### Toda migración con SQL propio va con `--create-only`

Sin eso, `migrate dev` aplica la migración apenas la genera; editarla después
choca contra el guard de checksum, que exige `migrate reset` — prohibido en este
proyecto porque borra datos. Se descubre cuando ya es tarde.

### El proceso se comprimió a mitad de camino

Los ciclos 1 a 3 fueron un dispatch por tarea con una review por tarea. Del 4 en
adelante, tareas agrupadas y **una sola review final por ciclo**. El motivo: los
hallazgos grandes de los primeros ciclos salieron todos de las reviews
**finales**, no de las por-tarea. El valor marginal de la review por tarea había
caído.

### Todo pendiente que cruza ciclos se espeja en `docs/`

`.superpowers/` está en `.gitignore`. Un pendiente anotado sólo ahí se pierde
con un `git clean -fdx`, y el ciclo siguiente redescubre lo que ya se había
medido — o no lo redescubre. Este archivo existe por esa regla.

### Una card más corta no manda borrar

La regla del reposo —el silencio del `.pen` no es instrucción de borrar— tiene
una contracara que costó un Critical descubrir. El ciclo 6 sacó "Daños
visibles" de la ficha de una orden porque la maqueta dibujaba la card con
cuatro filas y el código tenía cinco. La lectura de la card era correcta; lo
que faltó fue mirar **a dónde había ido a parar la quinta**: la maqueta no
tiraba el dato, lo **mudaba** a la nota del evento de apertura de la bitácora,
donde el nodo dice literalmente "Marco golpeado en la esquina inferior
derecha".

**Antes de sacar un dato porque la maqueta no lo dibuja donde estaba, buscalo
en el resto del frame.**

### El `.pen` se lee pero no se escribe

El MCP de Pencil lee el archivo correctamente y **no persiste escrituras al
archivo del repo**: un `Update` se confirma al releerlo dentro de la sesión y el
archivo en disco no cambia. Las correcciones a la maqueta van a
`docs/correcciones-pendientes-del-pen.md`, para que una persona las aplique en
Pencil.

## El rediseño de la landing (2026-09-04)

Este ciclo es distinto de los nueve de arriba y conviene decirlo de entrada: no
derivó de la maqueta, **se apartó de ella entera**, por decisión explícita del
dueño del producto y con la deuda registrada en
`docs/correcciones-pendientes-del-pen.md` (entrada 32). El disparador fueron tres
problemas nombrados a la vez: la página se veía genérica, no convertía, y
describía un producto de hace un mes.

### "Genérica" tenía dos causas nombrables, no era una impresión

La primera: la página era el kit de tarjetas de SaaS. Todo picado en cajas de
`rounded-[18px]` — el núcleo del producto, un rubro y un plan con el mismo radio
y la misma caja—, así que la estructura no decía nada sobre el contenido. La
segunda: la puntuación dominante era la cadena de puntos medios ("5 días gratis
· sin tarjeta · el alta es instantánea", "Términos · Privacidad · Estado del
servicio", "por mes · IVA incluido").

**Lo que se hizo**: cada sección tiene ahora la forma de lo suyo —el núcleo una
banda, los módulos tres paneles, los rubros un índice, los planes cuatro
columnas— y las cadenas de puntos medios quedaron sólo donde son una enumeración
real (los rubros de un módulo, las piezas del núcleo).

**Lo que cuesta si está mal**: es presentación, se revierte revirtiendo la
imagen. No hay migración.

### El héroe pasó de captura a producto

Decisión del dueño del producto entre tres opciones. El retrato estático decía
"no es una captura" y la única forma de comprobarlo era creerla.

**Lo que se pierde**: el héroe dejó de ser server-only. `Retrato` es ahora un
componente cliente y la página carga JavaScript que antes no cargaba.

**Lo que lo hace tolerable**: `motion` se carga con `LazyMotion`, el carrito no
tiene animación de entrada (protege el LCP de la única página indexable), y el
marcado inicial sale del servidor completo — sin JavaScript se ve el carrito
entero con sus cuatro líneas y su total, sólo que no se puede tocar.

### `motion` entra al repo, y con condiciones

Es la primera dependencia del repo que sirve sólo a la presentación, en un
proyecto que sacó `recharts` entero y rechazó `next-themes` por no arrastrar una
librería para caer en el mismo default.

**El motivo, acotado**: animar la salida de un nodo que React está sacando del
árbol. Una transición de CSS necesita que el elemento exista; cuando se saca una
línea del carrito ya no existe. `AnimatePresence` lo mantiene montado mientras
colapsa. Los dos usos son ésos: la fila que se va y el aviso de stock.

**Lo que se descartó**: GSAP — imperativo, le pelea al modelo de render de
React, y sus fuertes son justamente la capa de revelados por scroll.

**Y lo que NO se descartó, contra la recomendación.** La capa de movimiento
completa —titular tipeado, revelados por sección, hovers en tarjetas, barra de
progreso— se propuso como la opción a evitar y el dueño del producto la eligió
igual, con la objeción sobre la mesa. Vive en `app/sitio/movimiento.tsx` y la
objeción queda escrita en su docblock en vez de discutirse de nuevo: el
revelado por sección es el patrón más repetido de las landings generadas, y el
titular tipeado empuja el LCP de la única página indexable del producto.

**Lo que sí se hizo para que el costo no sea gratuito**: el texto del titular
viaja completo en el HTML dentro de un `sr-only` —los buscadores y los lectores
de pantalla nunca ven un H1 vacío—, la caja del titular se reserva antes de
tipear para que no haya salto de layout, todo se apaga con
`prefers-reduced-motion`, y un `<noscript>` devuelve a la vista las cuatro
secciones que salen del servidor en `opacity: 0`. Sin ese último seguro, un
visitante sin JavaScript vería cuatro de las siete secciones en blanco.

**Lo que lo mantiene acotado**: `app/sitio/retrato.test.tsx` deja el CARRITO
afuera del scroll (falla si aparece `whileInView` o `useScroll` ahí), exige
`m.*` en vez de `motion.*` y `LazyMotion`; `app/sitio/movimiento.test.tsx` fija
las tres defensas de arriba.

### El copy dice lo que el producto hace, no lo que va a hacer

La página prometía "el alta es instantánea", "en dos minutos tenés tu local
cargado" y "elegís el rubro". Ninguna de las tres era cierta: el registro
público está apagado a propósito, el alta se hace a mano y el formulario tiene
un campo que guarda `rubro: null`.

**La alternativa que se descartó**: construir el alta self-service para que la
promesa fuera cierta. Es el ciclo más grande de los tres y no entraba acá; queda
anotado como candidato siguiente.

**El costo aceptado**: "te escribimos" convierte peor en el papel que "empezá en
dos minutos". Lo que compra es no quemar al primer interesado que llegue
esperando registrarse solo.

### Un verbo para navegar y uno para enviar

Había tres para la misma acción. La prop `textoBoton` de `Formulario` se
eliminó, no se le cambió el default: mientras exista la prop, dos call sites
pueden volver a divergir sin que nada avise.

### El texto de un rubro se deriva de sus módulos

Cuatro rubros anunciaban "Núcleo + Turnos" bajo un título que dice "Tu rubro ya
está adentro", mientras la sección de arriba decía que Turnos está En camino. La
frase estaba escrita a mano en `RUBROS` y el estado en `MODULOS`, sin nada que
los atara.

Ahora cada rubro declara **qué módulos activa**, como claves, y tanto el texto
como el aviso de lo que falta se derivan de `MODULOS`. La contradicción dejó de
ser posible de escribir. `app/sitio/datos.test.ts` la fija con un invariante:
ningún rubro puede presentarse como completo si alguno de sus módulos está en
camino.

### El eje de ancho de Archivo, por fin en la landing

`components/importe.module.css` dice desde hace tiempo que Archivo se eligió por
su eje de ancho, y el producto lo usa en sus dos extremos: el cartel del frente
del local (112%) y el número de la cinta de la registradora (85%). La landing
tenía siete roles de Archivo y los siete en el 100% por default.

El H1 pasa a `font-stretch: 78%`, el registro del rótulo. Es **la única**
decisión tipográfica expresiva del ciclo: el resto de la página se mantiene
disciplinado a propósito.

**Lo que no se puede verificar**: `font-stretch` no es representable en el
schema del `.pen`, así que ningún test puede atarlo a la maqueta en ninguna
dirección. Sí lo ata `test/tipografia.test.ts` contra
`docs/sistema-de-diseno.md`.

### Dos superficies de marca, no tres

El ciclo anterior había sumado la card "Núcleo" y la card "Profesional" a la
franja del Cierre, con el argumento de que en una página con scroll la unidad de
cuenta es la banda visible. El argumento sigue valiendo; el caso concreto no,
porque Planes y Cierre son secciones consecutivas — cosa que el propio
`docs/sistema-de-diseno.md` admitía con todas las letras.

Quedan la banda del Total del carrito y la franja del Cierre, separadas por tres
secciones. Y ahora hay un test que lo cuenta, así que la regla dejó de depender
de que alguien se acuerde de leer el documento.
