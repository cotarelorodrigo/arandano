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

## 2. ~~Los formularios no tienen el campo de categoría~~ — RESUELTA A MEDIAS

- **Frames**: `B4O7t` (`App / Artículo nuevo`) y `y4tEb` (`App / Artículo ficha`)

**El alta quedó resuelta el 2026-08-24**: el frame ahora trae **dos**
selectores, "Categoría" y "Marca", que es más de lo que esta entrada pedía y
lo correcto desde que las categorías son un árbol de dos niveles.

**La ficha sigue sin resolverse**, y ahora además quedó contradiciendo al alta:
ver la entrada 7.

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

## 4. ~~El frame "Artículo nuevo" perdió su columna~~ — RESUELTA

- **Frame**: `B4O7t` (`App / Artículo nuevo`)

**Resuelta el 2026-08-24.** El frame se rediseñó entero y ya no está vacío:
Topbar con Cancelar/Guardar, y el cuerpo en dos columnas —"Qué es" y "Datos del
artículo" a la izquierda, "Stock inicial" y "Catálogo público" en 420 a la
derecha—. El código lo siguió en el ciclo de la UI de categorías.

**Lo que ese rediseño trajo y NO se construyó**, decidido con el dueño del
producto:

- **Código de barras**, dibujado al lado del SKU. Es una columna nueva en
  `Articulo`, y el buscador de `/vender` debería mirarla además del SKU: su
  propio ciclo.
- **"Mostrarlo en el catálogo"**, la card entera de Catálogo público. El
  catálogo no está construido; un toggle que no publica nada es una promesa
  vacía en la pantalla.

Las dos quedan como divergencia conocida entre la maqueta y el código: la
maqueta las dibuja, la pantalla no las tiene.

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

## 6. Los tres estados del árbol de categorías que la maqueta no dibuja

- **Frame**: `pb32f` (`App / Inventario`)

**El árbol se dibujó el 2026-08-24** y el código lo siguió al pie: columna de
248, filas de 30 con `padding [0,8]` y radio 8, marcas con sangría 24 y texto
12.5/normal, seleccionada en `$ar-primary-soft` con el texto en
`$ar-primary-deep`. Lo que la maqueta dibuja está construido.

**Lo que falta dibujar** son tres estados que el código tuvo que derivar, y que
por lo tanto hoy existen sin referencia:

1. **Rubro y marca seleccionados.** Sólo está dibujado "Todos los artículos"
   activo. El código los derivó del mismo tratamiento (`$ar-primary-soft` de
   fondo, texto en `$ar-primary-deep`, weight 600), y la marca **conserva su
   12.5** al seleccionarse: agrandarla movería la fila.
2. **La fila en modo edición**, que es cómo se renombra y cómo se crea. El
   código usa un input inline del mismo alto que la fila (30) con borde
   `$ar-line-strong` y radio 8 — **no** el campo de 40 del resto de la
   aplicación, que haría saltar la lista diez píxeles cada vez que alguien
   empieza a editar.
3. **El menú `⋯` de cada fila** (Renombrar / Agregar marca / Mover a… /
   Borrar), que aparece al hover **en el lugar de la cuenta**. Correr el texto
   cada vez que pasa el mouse haría bailar la lista entera.

Si al dibujarlos la maqueta decide otra cosa, manda la maqueta y se corrige el
código: son tres tratamientos, no tres decisiones de producto.

Detectado al cerrar el ciclo de la UI de categorías (2026-08-24). Ver
`docs/superpowers/specs/2026-08-24-categorias-ui-design.md`.

---

## 7. La ficha de artículo quedó atrás del alta

- **Frame**: `y4tEb` (`App / Artículo ficha`)
- **Dice**: un solo campo "Categoría", de texto, en la card "Datos"; y el
  subtítulo `SKU 000412 · Producto · Accesorios`
- **Tiene que decir**: dos selectores, **Categoría** y **Marca**, como los que
  el mismo `.pen` ya dibuja en `App / Artículo nuevo`; y el subtítulo con la
  rama completa (`Vidrios templados · Apple`)

**Por qué.** El 2026-08-24 el alta pasó a dos selectores encadenados y la ficha
no se tocó. Quedan contradiciéndose dentro de la propia maqueta: la misma
categoría se carga de dos formas distintas según por dónde se entre, y en la
ficha se puede tipear texto libre que ya no crea ninguna rama.

El código **no** siguió a la ficha, a propósito y con el dueño del producto: sin
el frame dibujado, habría que inventar el tratamiento. Hasta que se dibuje, la
ficha sigue con su campo de texto, que ahora arma el árbol por detrás
(`asegurarCategoria`) — o sea que las dos pantallas escriben la misma columna
por caminos distintos.

Detectado al leer la maqueta del ciclo de categorías (2026-08-24).

---

## 8. El botón "Ingresar mercadería" del listado de `/inventario`, en escritorio y en el teléfono

- **Frames**: `App / Inventario` (nodo `DOvVZ`) y `Móvil / Inventario` (nodo
  `U3nUt`), los dos con ícono `truck`
- **Dice**: un botón "Ingresar mercadería" a la vista, en el cuerpo del
  listado
- **Tiene que decir**: nada, hasta que alguien decida a dónde manda —o se
  borra el botón, si la respuesta es "a ningún lado nuevo"

**Por qué no se construyó.** "Ingresar mercadería" ya existe como acción, pero
vive **por artículo**, dentro de la card del mismo nombre en la ficha
(`/inventario/[id]`, ver `docs/pantallas.md`). No hay ninguna pantalla ni
flujo de alta de mercadería a nivel del LISTADO al que este botón pudiera
apuntar — habría que inventar uno. `App / Inventario` (escritorio) lo dibuja
desde antes del ciclo móvil, en el Topbar, y nadie lo construyó nunca; el
ciclo móvil iba a repetir el mismo error copiándolo al cuerpo del teléfono
(Task 6), hasta que la review de ese ciclo lo frenó.

Es el mismo criterio ya escrito para el `more-vertical` de la ficha de
artículo (spec `2026-08-26-movil-design.md`, §7.4: "un botón que abre un menú
inventado es peor que la ausencia del botón") y para el toggle de catálogo
público que no publicaba nada (spec `2026-08-24-categorias-ui-design.md`:
"una promesa vacía en la pantalla"). Un botón cuyo rótulo promete algo que no
hace es peor que no tenerlo — sea porque abre un menú vacío o porque no abre
nada.

**A diferencia de la entrada 7**, acá no hace falta "el dueño del producto en
la mano" para decidir el tratamiento visual: la pregunta que hay que
responder primero es de producto, no de diseño — ¿existe (o va a existir) un
alta de mercadería a nivel de listado, o esto vive y va a seguir viviendo
sólo en la ficha? Recién con esa respuesta tiene sentido dibujar (o borrar)
el botón.

Detectado por el coordinador al revisar el reporte de la Task 6 del ciclo
móvil (2026-08-26), antes de despachar la review formal. El brief de esa task
heredaba el error, tal cual: "el botón... baja del Topbar al cuerpo" —
describía un botón que nunca existió en el Topbar de escritorio. El
implementador lo siguió al pie de la letra y construyó el atajo — un link que
enfocaba el buscador, la salida más honesta disponible sin inventar una
pantalla —, pero incluso esa salida seguía mintiendo: alguien que lo toca
esperando cargar stock recibe un campo de búsqueda enfocado. El botón se sacó
del código en la misma task.

---

## Cómo agregar una entrada

Cuando un ciclo decida que la maqueta se equivocó, la entrada va acá **y** en el
reporte del ciclo. Lo que no puede pasar es que la decisión viva sólo en
`.superpowers/`, que está gitignoreado y no sobrevive a la rama.
