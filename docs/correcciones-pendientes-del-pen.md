# Correcciones pendientes de `design/arandano.pen`

`design/arandano.pen` es la autoridad del diseño: cuando contradice al código, a
la documentación o a un test, se modifica lo otro. Pero eso no vuelve infalible a
la maqueta — a veces el código tiene razón, y entonces lo que corresponde es
corregir el archivo, no ignorarlo.

**Y eso no se puede hacer desde acá.** Las herramientas MCP de Pencil leen el
`.pen` sin problema, pero **no persisten escrituras al archivo del repo**: un
`Update` se confirma al releerlo en la sesión y el archivo en disco no cambia
—mismo MD5, `git status` sin diff—. El `execute` parece operar sobre el
documento abierto en la app de escritorio y no expone ninguna primitiva de
guardado. Editarlo a mano tampoco es opción: está encriptado.

Así que esta lista existe para que alguien las aplique en Pencil y commitee el
archivo. Cada entrada dice el frame, el nodo, qué dice hoy y qué tiene que decir.

---

## 1. El encabezado de columna del listado de ventas dice "VENDIÓ" y muestra el cliente

- **Frame**: `yhuFd` (`App / Ventas`)
- **Nodo**: `H9hBt4`
- **Dice**: `VENDIÓ`
- **Tiene que decir**: `CLIENTE`

**Por qué.** La columna muestra el comprador —"Consumidor final", "Martín Sosa"—,
no quién hizo la venta. El dato es el correcto: en un listado de ventas el cliente
es más útil que el vendedor, y el código lo implementó así siguiendo la maqueta.
Lo que está mal es el rótulo: "Vendió: Martín Sosa" se lee al revés en la pantalla
donde el dueño revisa cuánto entró.

Detectado en la review final del ciclo de `/ventas` (2026-08-22). El código ya
dice "Cliente".

---

## 2. El formulario de alta de artículo y el card "Datos" no tienen el campo de categoría

- **Frames**: `B4O7t` (`App / Artículo nuevo`) y `y4tEb` (`App / Artículo ficha`)
- **Falta**: un campo de texto para la categoría, con el mismo tratamiento que
  sus campos vecinos

**Por qué.** La maqueta muestra la categoría en el listado de `/inventario` y en
el subtítulo de la ficha —"SKU 000412 · Producto · Accesorios"— pero no la ofrece
en ningún formulario. Un campo que se muestra y no se puede cargar **nace siempre
vacío**.

Detectado al escribir el spec del rediseño (2026-08-21) y confirmado por el
relevamiento del ciclo de inventario. El código va a tener el campo en los dos
formularios.

---

## 3. El SKU de ejemplo usa un formato que el generador no produce

- **Frames**: `B4O7t` (`App / Artículo nuevo`), `y4tEb` (`App / Artículo ficha`) y
  `pb32f` (`App / Inventario`)
- **Dicen**: códigos de seis dígitos sin prefijo — `000413`, `000412`, `000198`
- **El generador produce**: `A-0043` — un prefijo y cuatro dígitos

**Por qué.** `proximoSku()` en `lib/inventario/articulos.ts` arma el código con
esa forma, y el ciclo de inventario decidió mostrar el número real en vez de
copiar el estilo cosmético de la maqueta. El texto de ayuda del alta —"el
próximo código libre es el…"— tiene que mostrar lo que el sistema va a generar,
o le miente a quien lo lee.

No es urgente: son números de ejemplo dentro de la maqueta y no cambian ninguna
decisión de diseño. Pero conviene alinearlos para que nadie tome ese formato
como especificación.

Detectado en el ciclo de inventario (2026-08-22).

---

## 4. El frame "Artículo nuevo" perdió su columna: en Pencil se ve vacío

- **Frame**: `B4O7t` (`App / Artículo nuevo`)
- **Tiene**: un solo hijo, el `ref` del Sidebar (`jr0Ww`)
- **Le falta**: el hijo `Columna` (`LBhdp`), que contiene el `Topbar` y el `Cuerpo`

**Qué pasó.** El nodo `LBhdp` **existe y está entero** —sus dos hijos siguen ahí,
con las tres cards del formulario— pero está **desenganchado del frame**. Las
otras cuatro pantallas de aplicación (`y4tEb`, `pb32f`, `yhuFd`, `Fe3bW`) tienen
sus dos hijos normalmente.

La consecuencia práctica: **quien abra "Artículo nuevo" en Pencil hoy no va a ver
ni el topbar ni el cuerpo dibujados en el lienzo**, aunque el contenido no se
haya perdido.

**No lo causó el rediseño.** Verificado: el MD5 de `design/arandano.pen` es el
mismo desde el inicio del trabajo, y el único commit que tocó el archivo es
`87973d4`, el que lo trajo al repo. Ya venía así.

Se arregla en Pencil arrastrando `LBhdp` de vuelta adentro de `B4O7t`. El
contenido se pudo relevar igual navegando por id, así que el rediseño de esa
pantalla se hizo contra los valores correctos.

Detectado en el ciclo de inventario (2026-08-22).

---

## 5. El card "Datos" de la ficha no distingue campos editables de sólo lectura

- **Frame**: `y4tEb` (`App / Artículo ficha`), card "Datos"
- **Dibuja**: cuatro campos con el mismo tratamiento visual — Nombre, Precio de
  venta, Código y Tipo
- **El problema**: dos de ellos **no se pueden editar**. El código lo genera el
  sistema, y el tipo (Producto/Servicio) no se puede cambiar sin dejar stock
  huérfano — una decisión ya tomada y fundamentada en el código.

**Por qué importa.** Cuatro cajas idénticas invitan a escribir en las cuatro. La
maqueta no tiene ningún tratamiento de sólo-lectura que copiar, así que el ciclo
de inventario resolvió la mitad segura: mostró los editables y **omitió el campo
"Tipo"** en vez de dibujarlo como si se pudiera cambiar.

Hace falta decidir en la maqueta cómo se ve un campo que se muestra pero no se
edita —fondo hundido, sin borde, con candado, lo que sea— y aplicarlo al Código
y al Tipo. Recién ahí el código puede mostrarlos sin mentir.

Detectado en el ciclo de inventario (2026-08-22).

---

## 6. El listado de inventario no tiene dónde vivir el árbol de categorías

- **Frame**: `pb32f` (`App / Inventario`), 1440 × 900
- **Falta**: una columna con el árbol de categorías, a la izquierda del listado

**Por qué.** El 2026-08-23 se decidió, con el dueño del producto, que las
categorías pasan a ser un árbol de dos niveles (rubro → marca) y que **se
recorren desde una columna a la izquierda del listado**. El modelo ya está
construido (`docs/superpowers/specs/2026-08-23-categorias-design.md`); falta la
pantalla, y la maqueta no dibuja nada de eso.

Lo que sigue no son preguntas: es la pantalla ya resuelta, para dibujar. Donde
quedó algo abierto está dicho al final.

### El layout

El `Cuerpo` (`kgGY4`) hoy es vertical con `padding 24` y `gap 16`: `Filtros`
(`PmgHg`) arriba y `Listado` (`BT29h`) abajo, los dos a `fill_container`. Sigue
igual, con **un frame horizontal nuevo entre el Cuerpo y el Listado**:

```
┌ App / Inventario · 1440 × 900 ──────────────────────────────────────────────┐
│ Sidebar  │ Topbar · 66                                                      │
│   248    ├──────────────────────────────────────────────────────────────────┤
│          │  Cuerpo · padding 24 · gap 16                                    │
│          │  ┌ Filtros · 1144 × 40 ───────────────────────────────────────┐  │
│          │  │ [Buscar…            ] [Ver desactivados] [Todos|Prod|Serv] │  │
│          │  └────────────────────────────────────────────────────────────┘  │
│          │  ┌ Contenido · horizontal · gap 16 ───────────────────────────┐  │
│          │  │ ┌ Categorías ─┐  ┌ Listado (BT29h, como está) ──────────┐  │  │
│          │  │ │    248      │  │              880                     │  │  │
│          │  │ │             │  │                                      │  │  │
│          │  │ └─────────────┘  └──────────────────────────────────────┘  │  │
│          │  └────────────────────────────────────────────────────────────┘  │
└──────────┴──────────────────────────────────────────────────────────────────┘
```

**Los filtros quedan arriba, a todo el ancho, y no adentro de la columna
derecha.** El buscador busca en el catálogo y se combina con la rama elegida
(ver *La selección*); dejarlo cruzando las dos columnas es lo que dice
visualmente que manda sobre las dos.

**La columna mide 248, igual que el sidebar**, y es a propósito: son las dos
columnas laterales del producto y repetir el ancho las hace leer como un
sistema. Un valor parecido pero distinto —260, 240— se lee como un error de
alineación. Al listado le quedan 880, contra los 1144 de hoy; entra sin perder
ninguna columna.

La columna **scrollea sola**, independiente del listado: con 730 px de alto
útil entran unas 19 filas, y un local con quince rubros y sus marcas pasa de
eso.

### La columna, fila por fila

```
┌ Categorías · 248 ───────────────────┐
│ CATEGORÍAS                      [+] │  encabezado
│                                     │
│ ▸ Todos los artículos            48 │  ← seleccionado por defecto
│ ─────────────────────────────────── │
│ ▾ Celulares                       6 │  raíz con hijas, abierta
│      Samsung                      4 │  hija
│      Motorola                     2 │
│ ▸ Fundas                         12 │  raíz con hijas, cerrada
│   Cables                          3 │  raíz sin hijas: sin chevron
│   Cargadores                      5 │
│ ▾ Vidrios templados               9 │
│      Apple                        9 │
│ ─────────────────────────────────── │
│   Sin categoría                   1 │  ← sólo si hay alguno
└─────────────────────────────────────┘
```

**Las filas copian el ítem de navegación del sidebar**, que ya está dibujado y
resuelto: `rounded-[9px]`, `padding 9 / 12`, alto ~36, `font-medium` en reposo
y `font-semibold` cuando está seleccionada. No hace falta inventar un
tratamiento nuevo — es la misma clase de cosa (una lista de destinos), y que se
vean iguales es correcto.

- **El chevron sólo aparece en las raíces que tienen hijas.** Una raíz sin
  marcas no lleva chevron ni sangría fantasma.
- **Las hijas van indentadas** un paso (12 px más de sangría izquierda) y **sin
  chevron**: el árbol tiene dos niveles y nunca tres.
- **El conteo va alineado a la derecha**, en `text-muted-foreground`, un punto
  más chico que el nombre.
- **"Todos los artículos"** es el estado por defecto y va arriba, separado del
  resto por una línea.
- **"Sin categoría" va al fondo**, después de las ramas y de otra línea, y
  **sólo si hay al menos un artículo ahí**. Abajo y no arriba porque es el cajón
  de lo no clasificado, no un rubro más: ponerlo entre las ramas lo pone al
  mismo nivel que "Celulares". Y si no hay ninguno, la fila no se dibuja — una
  fila permanente en cero es ruido.

### Los conteos: la regla, porque es lo que se implementa mal

**El conteo de una raíz incluye los artículos de sus hijas más los colgados de
la raíz misma.** "Fundas 12" son las Apple, las Samsung y las que no tienen
marca. Si no, el número de arriba nunca cierra con la suma de abajo y el árbol
miente.

**El conteo responde al catálogo, no al resultado de la búsqueda.** Sigue el
mismo criterio de activos/desactivados que el listado —si está tildado "Ver
desactivados", los cuenta—, pero **ignora la búsqueda y el segmentado de
tipo**. El motivo es concreto: si el conteo siguiera la búsqueda, apenas
escribís algo que sólo matchea una rama, todas las demás mostrarían 0 — y el
árbol dejaría de servir para navegar justo en el momento en que más lo
necesitás.

Es a propósito **distinto del conteo de stock negativo del subtítulo**, que sí
habla de lo que el listado está mostrando. Son dos preguntas distintas: aquél
es "de esto que estoy viendo, cuánto está mal"; éste es "cuánto tengo de cada
cosa".

### La selección y el filtrado

- **Una rama a la vez.** Clic en "Celulares" filtra a todo el rubro (todas sus
  marcas incluidas); clic en "Samsung" filtra a esa marca. Clic en "Todos los
  artículos" limpia.
- **Viaja en el query string** (`?cat=<id>`), como ya viajan `?q`, `?tipo`,
  `?inactivos` y `?p`. Es el mismo mecanismo, no uno nuevo.
- **Se combina en AND con el buscador y con el tipo.** Estar en "Fundas" y
  buscar "A54" da las fundas A54.
- **Elegir una rama vuelve a la página 1.** Quedarse en la página 3 de un
  listado que ahora tiene 8 artículos muestra un vacío que parece un error.
- **El vacío con rama activa necesita salida**: cuando la combinación de rama +
  búsqueda no da nada, el estado vacío ofrece *"Buscar en todo el inventario"*,
  que limpia la rama y deja la búsqueda. Sin eso, buscar algo que existe pero
  está en otra rama se ve como si no existiera.

### El ABM, que vive en la misma columna

Se decidió que no hay pantalla aparte: se administra donde se ve el efecto.

- **`[+]` en el encabezado** crea un **rubro** (una raíz). La fila nueva aparece
  al final en modo edición, con el cursor puesto.
- **Cada fila, al hover, muestra un `⋯`** a la derecha (donde estaba el conteo,
  que se corre o se tapa) con: **Renombrar**, **Mover a…**, **Borrar**, y en las
  raíces además **Agregar marca**.
- **Renombrar es in-place**: la fila se convierte en un input del mismo alto,
  con el texto seleccionado. `Enter` guarda, `Esc` cancela.
- **Mover** cambia de padre: una marca pasa a colgar de otro rubro. Sólo aplica
  a hijas, porque mover una raíz debajo de otra crearía un tercer nivel.
- **Borrar** sólo funciona si la rama está vacía y sin hijas — la base lo
  garantiza con `ON DELETE RESTRICT`. Con artículos adentro, el mensaje tiene
  que decir cuántos son y no un error genérico: *"Celulares · Samsung tiene 4
  artículos. Movelos antes de borrarla."*

### Los frames que hay que dibujar

1. `App / Inventario` con la columna, en reposo y con "Todos" seleccionado.
2. Una **raíz seleccionada** y una **hija seleccionada** (son dos tratamientos
   distintos por la sangría).
3. La fila **en modo edición** (renombrar / crear).
4. El **menú `⋯` abierto**, en una raíz y en una hija (los ítems difieren).
5. El **estado vacío** con rama activa y su salida.

Los estados de hover no hacen falta: la maqueta modela reposo, y eso ya está
escrito como criterio en `CLAUDE.md`.

### Lo que queda abierto, y por qué no lo decidí

- **Qué pasa en pantallas angostas.** El `.pen` modela 1440 y la columna se
  come 248; abajo de ~1100 px el listado empieza a apretarse. La salida
  probable es colapsar la columna a un botón que la abre encima del listado,
  pero eso es una pantalla más y ningún frame del `.pen` modela hoy un ancho
  chico. No lo inventé.
- **Si el rubro seleccionado debe seguir mostrando la categoría en cada fila
  del listado.** Con "Fundas · Samsung" activo, la columna Categoría repite lo
  mismo en todas las filas. Dejarla es información redundante; sacarla hace que
  la tabla cambie de forma según dónde estés parado. Me inclino por dejarla —una
  tabla que cambia de columnas desorienta más de lo que ahorra—, pero es
  decisión de quien mire las dos versiones dibujadas.

Detectado al cerrar el ciclo del modelo de categorías (2026-08-23); descrito en
detalle el 2026-08-24.

---

## Cómo agregar una entrada

Cuando un ciclo decida que la maqueta se equivocó, la entrada va acá **y** en el
reporte del ciclo. Lo que no puede pasar es que la decisión viva sólo en
`.superpowers/`, que está gitignoreado y no sobrevive a la rama.
