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

- **Frame**: `pb32f` (`App / Inventario`)
- **Falta**: la columna lateral con el árbol de categorías, y su relación con
  el listado

**Por qué.** El 2026-08-23 se decidió, con el dueño del producto, que las
categorías pasan a ser un árbol de dos niveles (rubro → marca) y que **se
recorren desde una columna a la izquierda del listado**: cada rama con su
conteo, clic en "Celulares" filtra a todo el rubro, clic en "Samsung" filtra a
esa marca. Esa columna además es donde se crean, renombran y mueven las
categorías — no hay pantalla de ABM aparte.

La maqueta no dibuja nada de eso. Hoy `App / Inventario` es la fila de filtros
más la card del listado a todo el ancho, y la categoría aparece sólo como texto
bajo el nombre del artículo.

**Qué hace falta decidir en Pencil**, porque el código no lo puede inventar sin
contradecir la regla de que la maqueta manda:

- El ancho de la columna y qué le queda al listado.
- Cómo se ve una rama seleccionada, y cómo se ve el estado "todas".
- Dónde va el conteo por rama y si cuenta artículos o unidades.
- Cómo se ve "Sin categoría", que es una rama más y va a existir siempre.
- Los controles del ABM: crear una raíz, crear una marca adentro, renombrar,
  mover, borrar.

Hasta que eso esté dibujado, el ciclo de la UI va a estar construyendo contra
un frame que no existe. Es la única entrada de esta lista donde falta una
pantalla entera y no un detalle.

Detectado al cerrar el ciclo del modelo de categorías (2026-08-23). Ver
`docs/superpowers/specs/2026-08-23-categorias-design.md`.

---

## Cómo agregar una entrada

Cuando un ciclo decida que la maqueta se equivocó, la entrada va acá **y** en el
reporte del ciclo. Lo que no puede pasar es que la decisión viva sólo en
`.superpowers/`, que está gitignoreado y no sobrevive a la rama.
