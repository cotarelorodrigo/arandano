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

## 8. El diálogo de permisos de `/usuarios`, y un texto de `/ventas/[id]` que quedó mintiendo

- **Frame**: `App / Usuarios` (para la primera mitad); `App / Venta detalle`,
  nodo `TIlD3` (para la segunda)

**Primera mitad: la maqueta no dibuja el diálogo de permisos ni la columna
nueva.** `design/arandano.pen` fija la tabla de `/usuarios` con las columnas
Persona/Rol/Estado/Acciones y el resto de esa pantalla (el alta con el control
segmentado, el aviso ámbar de clave). No dibuja ningún diálogo con switches por
permiso, ni la columna "Permisos" que el ciclo de permisos por usuario le sumó
a la tabla (2026-08-26). El código se derivó de lo que la maqueta **sí** fija
para esa pantalla —el mismo tratamiento de card, tabla y botones fantasma que
ya usa el resto de `/usuarios`— y no de un frame propio, que no existe. Mismo
precedente que el panel de categorías de `/inventario` (entrada 6, arriba):
construir contra lo que la maqueta ya dice sobre esa pantalla, cuando el
control puntual no tiene frame.

**Segunda mitad: un texto de `/ventas/[id]` quedó mintiendo, y no se corrige
acá.** El bloque "Anular la venta" de `/ventas/[id]` dice, palabra por palabra,
"Sólo el dueño puede hacerlo" — copy literal del `.pen` (nodo `TIlD3`), fijado
antes de que existiera este ciclo. Desde la conversión del botón a
`exigirPermiso('VENTAS_ANULAR')`, un empleado con ese permiso delegado ve el
botón de anular al lado de una oración que le dice que no puede usarlo. La
guarda real —la que importa— sigue siendo la del server action, así que no es
un agujero de seguridad; es una oración que ya no describe el sistema.

No se cambió el texto en este ciclo, a propósito: la regla escrita del proyecto
es que la maqueta manda y la divergencia se anota, no que un ciclo de permisos
reescriba copy de producto por su cuenta — eso es decisión del dueño del
producto, sobre esta pantalla puntual y sobre si el patrón se repite en algún
otro lado que use el mismo giro ("Sólo el dueño…").

Detectado al cerrar el ciclo de permisos por usuario (2026-08-26). Ver
`docs/superpowers/specs/2026-08-26-permisos-por-usuario-design.md`.

---

## 9. La maqueta no dibuja el selector de plan ni el pie del cobro de `/vender`

- **Frame**: `App / Vender` (nodos `Cyias` para la card de Cobro, `XdYjF`/`VnEsm`
  para una fila de pago)

**Qué falta.** `design/arandano.pen` es anterior a los planes de pago
(2026-08-27), así que el frame de `/vender` no tiene:

1. **El `Select` de plan de cada fila de pago.** Aparece bajo los selectores de
   Medio y Moneda, y **sólo** cuando el medio elegido tiene planes cargados y el
   pago es en pesos — un local sin planes no ve ningún control nuevo. El código
   lo derivó del selector de **Medio** de esa misma fila, que es su hermano
   directo y sí está dibujado: mismo alto (36), mismo radio (9), mismo borde
   `$ar-line-strong`, mismo 13/500. Lo único que no sale de ahí es que ocupe su
   **propia fila** a todo el ancho en vez de ir al lado de Medio y Moneda: en
   una card de 384 un tercer control apretaría justo al de Medio, que es el que
   más se toca, y los nombres de plan son largos ("Crédito 3 cuotas sin
   interés").
2. **El pie de tres líneas del panel de Cobro** — `Mercadería`, `Recargo <plan>`
   (o `Descuento <plan>`, según el signo) y `Total a cobrar`—, que aparece sólo
   cuando hay algún plan elegido y va entre los carteles de error/éxito y el
   chip de Faltante. El código lo derivó del renglón **"Entran $X"** (nodo
   `OTlAa`), que es el otro sitio de esta pantalla donde un rótulo y un importe
   conviven en una línea: rótulo 12 en `$ar-text-muted`, importe 13/600 en
   Archivo. Lo derivado es el destaque de la última línea (borde arriba y
   15/700), que "Entran $X" no tiene porque no cierra ninguna cuenta.

**Lo que la maqueta NO tiene que cambiar**, y conviene decirlo para que nadie lo
"arregle" al dibujarlo: la banda de `--marca` sigue mostrando la **mercadería**,
no el total a cobrar. Es el ancla de contenido de la pantalla y el número contra
el que se reparten los pagos; el total a cobrar vive en el pie del panel de
cobro, que es donde se decide cuánta plata entra. El chip "Faltan / Sobran"
mide contra la mercadería por la misma razón: si midiera contra lo cobrado, una
venta financiada no cerraría nunca.

Mismo precedente que el panel de categorías de `/inventario` (entrada 6) y que
el diálogo de permisos de `/usuarios` (entrada 8): la maqueta no **contradice**
al código acá, le **falta** el control, así que se construyó contra lo que el
`.pen` ya fija para esa pantalla en vez de inventar un tratamiento. Si al
dibujarlos la maqueta decide otra cosa, manda la maqueta y se corrige el código.

Detectado al construir el selector de plan del mostrador (2026-08-27). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`, sección
*Las pantallas*, que ya anticipaba esta deuda.

---

## 10. La maqueta no dibuja el panel "Precios por forma de pago" de la ficha del artículo

- **Frame**: `App / Artículo ficha`, columna derecha

**Qué falta.** `design/arandano.pen` es anterior a los planes de pago
(2026-08-27), así que el frame de la ficha no tiene la card nueva "Precios por
forma de pago" — una fila por plan activo con nombre, medio, cuotas y el
precio derivado. El código la derivó de las dos cards vecinas que sí están
dibujadas y viven en la misma columna: el encabezado con borde inferior y la
cara de display de "Datos" y "Cómo se movió" (`design/arandano.pen`, frame
`y4tEb`), y el patrón fila-con-importe-a-la-derecha de la tabla de
`/formas-de-pago` (que tampoco tiene frame propio, ver entrada 9 más arriba).

Mismo precedente que las entradas 6, 8 y 9: la maqueta no **contradice** al
código acá, le **falta** el control, así que se construyó contra lo que el
`.pen` ya fija para esa pantalla en vez de inventar un tratamiento. Si al
dibujarla la maqueta decide otra cosa, manda la maqueta y se corrige el
código.

Detectado al construir el panel de precios de la ficha (2026-08-27, Task 7 del
ciclo de planes de pago). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`,
sección *Las pantallas*.

---

## 11. La maqueta no dibuja el desglose de recargo ni la columna Plan de `/ventas/[id]`

- **Frame**: `KEwHe` (`App / Venta detalle`) — `NjMl1`, citado en el código
  (`app/(app)/ventas/[id]/page.tsx`, la fila de las dos columnas), es un nodo
  "Fila" ANIDADO adentro de este frame (`KEwHe > Columna lEwoj > Cuerpo jC6yK >
  Fila NjMl1`), sin texto propio — no la pantalla.

**Qué falta.** `design/arandano.pen` es anterior a los planes de pago
(2026-08-27), así que el frame del detalle de venta no tiene:

1. **El desglose de tres líneas del pie de "Qué se vendió"** (Mercadería /
   Recargo o Descuento / Cobrado), que sólo aparece cuando `Venta.recargo` no
   es cero. El código lo derivó del único renglón "Total" que la maqueta sí
   dibuja ahí: mismo fondo `bg-muted` y mismo peso para la línea final
   ("Cobrado"), y las dos líneas nuevas de arriba toman el tratamiento más
   liviano de una fila de tabla común (12px muted / 13px semibold), sin
   inventar un tercer estilo.
2. **La columna "Plan" de la tabla "Cómo se pagó"**, entre Medio y Moneda —
   "—" sin plan. El código la derivó de las columnas vecinas de esa misma
   tabla: mismo `TableHead` de 10px uppercase, mismo ancho fijo que Moneda
   (110px, ampliado a 150px porque un nombre de plan es más largo que
   "Dólares").

Mismo precedente que las entradas 6, 8, 9 y 10: la maqueta no **contradice** al
código acá, le **falta** el control, así que se construyó contra lo que el
`.pen` ya fija para esa pantalla en vez de inventar un tratamiento. Si al
dibujarlos la maqueta decide otra cosa, manda la maqueta y se corrige el
código.

Detectado al construir el desglose de recargo del detalle de venta (2026-08-27,
Task 8 del ciclo de planes de pago). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`,
sección *Las pantallas*.

---

## Cómo agregar una entrada

Cuando un ciclo decida que la maqueta se equivocó, la entrada va acá **y** en el
reporte del ciclo. Lo que no puede pasar es que la decisión viva sólo en
`.superpowers/`, que está gitignoreado y no sobrevive a la rama.
