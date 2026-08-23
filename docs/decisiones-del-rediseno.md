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
