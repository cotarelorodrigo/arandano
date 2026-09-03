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

## 1. ~~El encabezado de columna del listado de ventas dice "VENDIÓ" y muestra el cliente~~ — RESUELTA

- **Frame**: `yhuFd` (`App / Ventas`)
- **Nodo**: `H9hBt4`
- **Decía**: `VENDIÓ`
- **Dice hoy**: `CLIENTE`

**Resuelta.** Verificado con el MCP de Pencil en la Task 13 del ciclo móvil
(2026-08-26): `H9hBt4` dice `CLIENTE`, y no queda ningún nodo con "VENDIÓ" ni
en `yhuFd` ni en `nwW2V`. Alguien la aplicó en Pencil en algún momento entre
el ciclo de `/ventas` y éste. Se deja el texto de abajo como registro de por
qué se pidió.

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

**La ficha sigue sin resolverse en la maqueta**, y ahí queda contradiciendo al
alta: ver la entrada 7. **En el código ya no**: desde el 2026-08-28 las dos
pantallas cargan la categoría con el mismo componente y bajo el mismo permiso.

La distinción de planos no es prolijidad y vale para todo este archivo: desde
ese ciclo puede haber entradas donde el código ya está resuelto y la maqueta no,
y una entrada que no diga de cuál de los dos habla envejece mintiendo.

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

## 7. La ficha de artículo quedó atrás del alta — RESUELTA EN CÓDIGO, LA MAQUETA QUEDA ATRÁS

- **Frames**: `y4tEb` (`App / Artículo ficha`) y `T5gME`
  (`Móvil / Artículo ficha`)
- **Dicen**: un solo campo "Categoría", de texto, en la card "Datos"; y el
  subtítulo `SKU 000412 · Producto · Accesorios`
- **Tienen que decir**: los dos selectores **Categoría** y **Marca** que el
  mismo `.pen` ya dibuja en `App / Artículo nuevo` (`B4O7t`) — y en la ficha,
  **apilados**, uno abajo del otro

**Lo que quedó resuelto, y esta vez del lado del código** (2026-08-28, ciclo de
la categoría en la ficha —
`docs/superpowers/specs/2026-08-28-categoria-en-la-ficha-design.md`). La ficha
ya no tiene un campo de texto: usa `SelectorDeCategoria`
(`app/(app)/inventario/selector-categoria.tsx`), **el mismo componente** que
instancia el alta, y `editarArticulo` recibe el id de la rama elegida en vez de
texto libre. Lo que disparó el ciclo no fue esta entrada sino el feedback de un
dueño que no podía ponerle marca a un artículo ya cargado: lo que acá estaba
escrito como "dos pantallas que se contradicen" era, del lado del mostrador, un
dato que no se podía cargar.

**Y es un cambio de criterio respecto del 2026-08-24, que conviene leer entero
antes de citarlo.** La versión anterior de esta entrada decía que el código
**no** iba a seguir a la ficha, "a propósito y con el dueño del producto: sin el
frame dibujado, habría que inventar el tratamiento". Ir igual también se decidió
con el dueño del producto, y lo que cambió no es la regla sino la premisa:
**esta vez no había tratamiento que inventar.** Los dos selectores —sus
rótulos, su alto, su radio, el encadenamiento de uno con el otro— ya están
dibujados en este mismo archivo, en `App / Artículo nuevo` (`B4O7t`). Copiar un
tratamiento que la maqueta ya fijó en la pantalla de al lado no es derivar
diseño; inventarlo de cero sí lo hubiera sido. La regla no se aflojó: sin
referencia se sigue sin inventar.

**Lo que sí se derivó sin referencia es lo que falta dibujar, y es lo que
justifica que la entrada siga abierta:**

1. **Los dos selectores apilados en vertical**, en la card "Datos" de 324 px. El
   alta no puede contestarlo: los dibuja en fila porque su card es mucho más
   ancha, y a 324 px cada uno queda en ~150, donde "Vidrios templados" no entra.
   El apilado es una decisión del código sobre un ancho que la maqueta nunca
   miró.
2. **El frame `Móvil / Artículo ficha`**, que tampoco los dibuja: sigue con el
   campo de texto único, igual que el de escritorio.

**La otra mitad que esta entrada pedía ya estaba resuelta, y la entrada no lo
decía**: el subtítulo con la rama completa. `articulo.categoria` es el texto
canónico de la rama desde el ciclo del modelo, así que el encabezado de la ficha
viene mostrando `Vidrios templados · Apple` —la rama entera, con su middot— y no
un nombre suelto. Lo que la maqueta sigue dibujando es un ejemplo de un solo
nivel, que hoy sólo se da si el artículo cuelga de una raíz.

Detectado al leer la maqueta del ciclo de categorías (2026-08-24). Resuelta en
código el 2026-08-28. Falta que alguien dibuje los dos frames en Pencil y
commitee el archivo — y corregir el código si la maqueta decide otra cosa.

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

## 9. La grilla de estados del teléfono en `/servicio-tecnico` sólo dibuja nueve cards, y le falta "Rechazado"

- **Frame**: `Móvil / Servicio Técnico` (`F9BzV`), nodo `v1PnE3`
- **Dibuja**: tres filas de tres — Abiertas/Recibido/En diagnóstico,
  Presupuestado/Aprobado/En reparación, Listo/Sin reparación/Entregado
- **Le falta**: un card para `RECHAZADO`. El equivalente de escritorio
  (`G5b3dG`) sí trae los diez —Abiertas más los nueve estados de `ESTADOS`,
  con Rechazado incluido—, así que no es una decisión de "no cabe": es una
  card que se quedó afuera al armar la grilla de 3×3.

**Por qué no se copió tal cual.** Sacar "Rechazado" del teléfono sería una
regresión real y silenciosa: nadie podría ver cuántas órdenes rechazadas hay,
ni filtrar por ese estado, desde el celular — y no hay ninguna razón de
espacio o de producto escrita en ningún lado que lo justifique (el resto de
los ocho SÍ entra). El código de `ChipDeFiltroMovil`/`FilaDeChips`
(`app/(app)/servicio-tecnico/page.tsx`) mantiene los diez chips: la grilla de
3 columnas simplemente cae en una cuarta fila con "Entregado" solo, en vez de
cerrar en tres filas parejas como dibuja la maqueta.

Hace falta sumar la décima card (Rechazado) al frame para que las tres filas
de tres que hoy dibuja pasen a ser tres filas de tres más una de una — o
rediagramar la grilla completa si se prefiere otra distribución para diez
elementos.

Detectado en la Task 8 del ciclo móvil (2026-08-26), al leer el frame con el
MCP de Pencil antes de implementar el tablero.

---

## 10. El árbol de categorías del teléfono, abierto

- **Frame**: `b1jiWO` (`Móvil / Inventario`)
- **Dibuja**: el botón de 36 px que lo abre (`TK1ZV`, ícono `list-tree`, al
  lado del segmentado de Tipo) y el chip de la rama activa con su ✕
  (`jgesH` > `o0cWFv` + el conteo `QJ4TA`)
- **No dibuja**: el árbol desplegado. No hay ningún frame del panel abierto
  en el teléfono

**Qué hizo el código, y por qué.** Sirve el `PanelCategorias` que ya existe
—el mismo componente, con el ABM entero adentro— dentro de un `Sheet` con
`side="left"` y 280 px de ancho. Elegir el lado izquierdo no es una preferencia:
es el lado donde vive la columna de 248 px en escritorio, así que abrir el
panel desde el mismo borde es lo que menos desorienta a alguien que usa las dos
pantallas. El único cambio dentro del componente fue pasar su `<aside>` de
`w-[248px]` fijo a `w-full lg:w-[248px]`, porque la misma instancia vive ahora
en dos contenedores de ancho distinto.

Es una **derivada declarada**, no una omisión: el spec del ciclo
(`2026-08-26-movil-design.md`, §7.1) ya la anticipaba. Lo que hace falta
dibujar es el estado abierto, para que el ancho, el lado y el tratamiento del
velo dejen de ser una elección del código. Si al dibujarlo la maqueta decide
otra cosa, manda la maqueta.

Detectado al planificar el ciclo móvil (2026-08-26) y confirmado en la Task 6.

---

## 11. El menú de caja de `/vender` en el teléfono, abierto — y que no terminó siendo un menú

- **Frame**: `VaHod` (`Móvil / Vender`), Topbar `SoTUC`
- **Dibuja**: la ranura derecha con `more-vertical` en tono suave
  (`SoTUC/NlGrn`, relleno `$ar-sunken`, ícono `SoTUC/GZz1a` en `$ar-ink`)
- **No dibuja**: qué pasa al tocarlo

**Por qué el control existe.** En el teléfono los dos chips de estado —caja y
dólar— bajan al cuerpo (`xMMfZ`) y ahí son de **sólo lectura**: ni `<button>`,
ni `<form>`, ni `<input>`. Abrir y cerrar el turno tiene que vivir en algún
lado, y el único que queda es esta ranura. Es la diferencia con la entrada 13:
acá la derivación está forzada por la propia maqueta.

**Y no terminó siendo un menú, que es lo que hay que dibujar.** La primera
versión usó `DropdownMenu`, y eso costaba dos capacidades reales: abrir la caja
**sin declarar el saldo inicial** (abría en 0, en silencio) y cerrarla sin
confirmación — porque un `DropdownMenu` de Radix no puede contener un `<input>`
sin pelearle a su propio typeahead. Abrir una caja con el saldo equivocado no
es una incomodidad, es un problema contable. El control pasó a un `Sheet`, que
aloja los **mismos dos mini-formularios** que el chip de escritorio. Cuesta un
toque más para abrir la caja; compra que el número sea el que la persona quiso.

Así que lo que falta dibujar no es "el menú abierto" sino la hoja con sus dos
formularios. Si la maqueta prefiere de verdad un menú, entonces tiene que
decir además de dónde sale el saldo inicial.

Detectado al planificar el ciclo móvil (2026-08-26, spec §7.2) y resuelto así
en la Task 3.

---

## 12. El velo del drawer y su botón de cerrar están escritos con hex crudos — RESUELTA A MEDIAS

- **Frame**: `klNkg` (`Móvil / Menú (drawer)`)
- **Nodos**: `k2qBi` (Velo, `fill: #171221A6`) y `hFjNK` (Cerrar, `fill:
  #FFFFFF26`, con el ícono `pJwYu` en `#FFFFFF`)
- **Dicen**: tres colores literales
- **Tienen que decir**: variables `$ar-*`, o una variable nueva si ninguna de
  las que hay sirve

**Lo que quedó resuelto, en la ola final del ciclo móvil (2026-08-26,
`components/ui/sheet.tsx`, commit `37d4791`).** Esta entrada nació señalando
una consecuencia concreta del problema de fondo: `SheetOverlay` pintaba
`bg-black/10` más `backdrop-blur` —el default que copia el registry de
shadcn—, y el `.pen` pide `#171221A6`, violeta casi negro al 65 % **sin**
desenfoque. Ya no hay discrepancia: `SheetOverlay` pinta `bg-foreground/65`,
sin blur. Fue posible sin inventar ninguna variable porque `#171221` ya era un
token —es `--foreground`—, así que el color correcto se pudo escribir con lo
que ya existía. Y con eso, la pregunta que la entrada dejaba abierta para el
dueño del producto —"si el velo lleva desenfoque o no"— **ya no está
abierta**: se siguió al `.pen`, sin desenfoque, bajo la misma regla que rige
todo el proyecto (la maqueta manda). El botón de cerrar no cambió: ya seguía a
la maqueta desde antes (38×38, círculo, blanco al 15 %, ícono `x` de 19 px,
`padding [14,12]` desde el borde).

**Lo que sigue pendiente, y es lo que justifica que la entrada siga
abierta.** El frame `klNkg` sigue pintando sus tres colores —incluido el velo,
ya corregido en el código— con hex crudos en vez de variables `$ar-*`. Eso
importa por lo mismo que explicaba la versión anterior de esta entrada:
`test/maqueta.test.ts` ata el `.pen` con `app/globals.css` comparando
**variables**, así que un color que vive como hex crudo dentro de un frame
queda afuera de ese mecanismo aunque hoy coincida byte a byte con el código —
nada evita que alguien cambie uno de los dos lados mañana sin que ningún test
lo note. Es exactamente el agujero que el ciclo del login cerró creando
`--marca-halo` en vez de enterrar una mezcla adentro de un `radial-gradient`,
y acá sigue abierto. Falta que alguien lo aplique en Pencil: reemplazar los
tres literales de `klNkg` por variables (una nueva si ninguna de las que hay
sirve) y commitear el archivo.

Detectado en la Task 13 del ciclo móvil (2026-08-26), leyendo `klNkg` con el
MCP de Pencil para documentar el drawer. Resolución parcial verificada contra
el código el 2026-08-27, en la revisión de documentación previa a integrar la
rama.

---

## 13. El `more-vertical` de la ficha de artículo, que NO se construye

- **Frame**: `T5gME` (`Móvil / Artículo ficha`), Topbar `OqlvI`
- **Dibuja**: la ranura derecha con `more-vertical` en tono suave
  (`OqlvI/NlGrn` + `OqlvI/GZz1a`)
- **Tiene que decir**: nada, hasta que alguien decida qué contiene — o se
  borra, si la respuesta es "nada nuevo"

**Por qué no se construyó.** Es la excepción de esta familia y por eso vale
explicarla al lado de la entrada 11, que se resolvió al revés. En `/vender` la
derivación está forzada: sus chips son de sólo lectura y abrir el turno no
tiene otro lugar donde vivir. Acá no pasa eso — las dos acciones de la ficha ya
están al pie (`Desactivar` y `Guardar cambios`, 50 px de alto) y las
secundarias —ingresar mercadería, corregir por conteo, exportar CSV— ya están
en el cuerpo. No queda nada que el menú pueda contener sin inventarlo.

Es el mismo criterio de la entrada 8 y del toggle de catálogo público de la
entrada 4: **un botón que promete algo que no hace es peor que la ausencia del
botón**, sea porque abre un menú vacío o porque no abre nada.

Detectado al planificar el ciclo móvil (2026-08-26, spec §7.4). El código deja
la ranura vacía con el motivo escrito al lado.

---

## 14. El `printer` de `/ventas/[id]`, dibujado en los dos anchos y sin construir en ninguno

- **Frames**: `KEwHe` (`App / Venta detalle`) y `WBV5G` (`Móvil / Venta
  detalle`), Topbar `qO1HX`
- **Dibujan**: un botón de imprimir — en el teléfono, la ranura derecha con
  `printer` en tono suave (`qO1HX/NlGrn` + `qO1HX/GZz1a`)
- **Tienen que decir**: nada, hasta que exista impresión de ventas

**Por qué.** El producto no imprime ventas. Lo único que se imprime hoy es el
ticket térmico de una orden de trabajo (`/servicio-tecnico/[id]/ticket`), y
eso es una feature con su propio formato, no un botón. La ranura derecha de
esta pantalla queda vacía en el teléfono, igual que el Topbar de escritorio la
dejó siempre.

**No es una divergencia nueva del ciclo móvil**: el frame de escritorio la
dibuja desde antes y nadie la construyó nunca. El frame móvil la heredó. Se
anota ahora porque el ciclo la volvió a encontrar y porque, a diferencia de
antes, ahora hay dos frames que corregir y no uno.

El disparador de cuándo esto deja de ser una corrección pendiente y pasa a ser
una feature: el día que se integre ARCA y exista un comprobante que valga la
pena imprimir. Hasta entonces, la maqueta promete algo que el producto no
tiene.

Detectado al planificar el ciclo móvil (2026-08-26, spec §7) y confirmado en la
Task 5.

---

## 15. El buscador de `/inventario` mide 46 px en la maqueta y 40 en la aplicación

- **Frame**: `b1jiWO` (`Móvil / Inventario`)
- **Nodo**: `v3Epdn` (`height: 46`, radio 12, `padding [0,14]`, lupa de 18)
- **El código**: 40 px, que es la altura de un `<Input>` de este repo

**Por qué no se cambió, y por qué igual hay algo que decidir.** El
implementador eligió los 40 px por consistencia con el resto de los campos de
la aplicación, y esa razón es razonable pero no está exenta: `/vender` **sí**
se apartó de esa consistencia siguiendo su propia maqueta —su buscador mide 52
px en el teléfono y 58 en escritorio—, así que "todos los inputs miden 40" no
describe la aplicación de hoy.

Lo que hay que responder es si esos 46 px son un **tratamiento prominente**
querido —un buscador que es la acción principal de la pantalla, como el de
`/vender`— o una variación del mockup que nadie eligió a conciencia. Si es lo
primero, manda la maqueta y el código sube a 46. Si es lo segundo, la maqueta
baja a 40 y la consistencia queda escrita de una vez.

Detectado en la review de la Task 6 del ciclo móvil (2026-08-26).

---

## 16. La columna MEDIOS del listado de ventas mide 150 en la maqueta y 168 en el código

- **Frame**: `yhuFd` (`App / Ventas`) — la maqueta de **escritorio**
- **Nodo**: `qjFU0` (`Col Medios`, `width: 150`)
- **El código**: 168 px

**Por qué manda el código acá.** Las otras cinco columnas coinciden byte a
byte con la maqueta —84 `NÚMERO`, 110 `HORA`, `fill_container` `CLIENTE`, 140
`TOTAL`, 104 `ESTADO`—, así que el 150 desentona con sus propias hermanas. Y
el ciclo móvil tenía una constraint dura: **el escritorio no cambia**. Tocar
esa columna para seguir a la maqueta habría movido una pantalla que ya está
verificada a ojo, en un ciclo que no era el suyo.

Es la corrección más chica de esta lista y también la más fácil de aplicar:
son 18 px en un nodo de texto. Si al mirarla resulta que los 150 son los
correctos, entonces el que cambia es el código, y eso es un cambio de una
línea en `app/(app)/ventas/page.tsx` — pero con su verificación visual, como
cualquier cambio de escritorio.

Detectado en la Task 4 del ciclo móvil (2026-08-26). El ledger de ese ciclo lo
anotó contra el frame `nwW2V` (el móvil); es `yhuFd`, el de escritorio —
verificado con el MCP de Pencil en la Task 13, `nwW2V` no tiene ningún nodo
"MEDIOS", porque en el teléfono los medios de pago se funden en la línea de
meta y dejan de ser columna.

---

## 17. El chip de cotización del teléfono no dice de cuándo es el dólar

- **Frame**: `VaHod` (`Móvil / Vender`), los chips de estado del cuerpo
- **Dibuja**: la cotización sola
- **Falta**: de cuándo es

**Por qué no es un detalle.** Este repo tiene escrita la decisión contraria:
un dólar sin saber de cuándo es, es peor que no mostrarlo — porque
`Tenant.cotizacionUsd` es un número que alguien fija a mano y que puede llevar
una semana sin tocarse. En escritorio ese dato se resuelve con un tooltip
sobre el chip del header. **En un teléfono no hay hover**, así que el tooltip
no es una opción, y la maqueta no dibuja ningún reemplazo.

La salida que nadie evaluó es la más obvia: poner la fecha al lado, dentro del
chip o abajo. Cuesta ancho en una pantalla que no lo tiene de sobra, y por eso
es una decisión de producto y no una derivación que el código pueda tomar solo.

Detectado en la review de la Task 3 del ciclo móvil (2026-08-26), y explícita
para el dueño del producto.

---

## 18. El diálogo de permisos de `/usuarios`, y un texto de `/ventas/[id]` que quedó mintiendo

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

## 19. La maqueta no dibuja el selector de plan ni el pie del cobro de `/vender`

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
el diálogo de permisos de `/usuarios` (entrada 18): la maqueta no **contradice**
al código acá, le **falta** el control, así que se construyó contra lo que el
`.pen` ya fija para esa pantalla en vez de inventar un tratamiento. Si al
dibujarlos la maqueta decide otra cosa, manda la maqueta y se corrige el código.

Detectado al construir el selector de plan del mostrador (2026-08-27). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`, sección
*Las pantallas*, que ya anticipaba esta deuda.

---

## 20. La maqueta no dibuja el panel "Precios por forma de pago" de la ficha del artículo

- **Frame**: `App / Artículo ficha`, columna derecha

**Qué falta.** `design/arandano.pen` es anterior a los planes de pago
(2026-08-27), así que el frame de la ficha no tiene la card nueva "Precios por
forma de pago" — una fila por plan activo con nombre, medio, cuotas y el
precio derivado. El código la derivó de las dos cards vecinas que sí están
dibujadas y viven en la misma columna: el encabezado con borde inferior y la
cara de display de "Datos" y "Cómo se movió" (`design/arandano.pen`, frame
`y4tEb`), y el patrón fila-con-importe-a-la-derecha de la tabla de
`/formas-de-pago` (que tampoco tiene frame propio, ver entrada 22 más abajo).

Mismo precedente que las entradas 6, 18 y 19: la maqueta no **contradice** al
código acá, le **falta** el control, así que se construyó contra lo que el
`.pen` ya fija para esa pantalla en vez de inventar un tratamiento. Si al
dibujarla la maqueta decide otra cosa, manda la maqueta y se corrige el
código.

Detectado al construir el panel de precios de la ficha (2026-08-27, Task 7 del
ciclo de planes de pago). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`,
sección *Las pantallas*.

---

## 21. La maqueta no dibuja el desglose de recargo ni la columna Plan de `/ventas/[id]`

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

Mismo precedente que las entradas 6, 18, 19 y 20: la maqueta no **contradice** al
código acá, le **falta** el control, así que se construyó contra lo que el
`.pen` ya fija para esa pantalla en vez de inventar un tratamiento. Si al
dibujarlos la maqueta decide otra cosa, manda la maqueta y se corrige el
código.

Detectado al construir el desglose de recargo del detalle de venta (2026-08-27,
Task 8 del ciclo de planes de pago). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`,
sección *Las pantallas*.

---

## 22. La maqueta no dibuja `/formas-de-pago`, la pantalla entera

- **Frame**: ninguno. `design/arandano.pen` es anterior a los planes de pago
  (2026-08-27) y no tiene ni el frame de escritorio ni el `Móvil / …`

**Qué falta.** La pantalla completa: la tabla de planes —forma de pago, cuotas,
recargo con signo, el precio de ejemplo derivado y la celda de baja/reactivación—,
el botón "Plan nuevo" del Topbar, el diálogo de alta y edición, y el estado
vacío que explica que sin planes todo se cobra a precio de lista.

**Qué hizo el código, y por qué.** No inventó tratamiento nuevo: el layout, la
card, el título de card y el patrón de tabla los toma prestados de las
pantallas de listado que ya existen, que es lo que hace que se vea como parte
del producto sin que nadie la haya dibujado. La decisión más visible que quedó
derivada es el **precio de ejemplo sobre un artículo de referencia fijo de
$10.000** — la maqueta no tiene opinión sobre esa columna porque no tiene la
columna.

**Y falta la maqueta del teléfono.** Esta pantalla se construyó en un ciclo que
arrancó de `main` antes del ciclo del teléfono, así que su tabla todavía declara
anchos fijos y **no** sigue el patrón `lg:contents` que las otras cinco tablas
del producto ya comparten: en el teléfono las dos cards se apilan y la tabla
scrollea horizontalmente adentro de la suya, en vez de volverse tarjetas. Es
legible y operable, no es el rediseño.

Lo que el merge SÍ tuvo que arreglar, porque no era deuda sino un defecto: la
fila de las dos cards era un `flex` sin prefijo, con la tabla en `flex-1`
(hipotética 0) y el panel lateral en `w-[360px]`. A 390 px el espacio libre es
negativo y todo el encogimiento cae sobre el lateral —el factor de la izquierda
es `shrink × base` = 0—, así que la tabla se quedaba **en cero de ancho**, con
`overflow-hidden` matándole además el mínimo automático: la pantalla entera
desaparecía abajo de unos 424 px de viewport. Y el mismo merge le había dado a
esta pantalla un disparador de alta en el Topbar móvil, o sea que se podía crear
un plan donde no se veía ninguno. `test/responsive.test.ts` no puede atraparlo:
su umbral es 362, esto es `w-[360px]`, y sobre todo el modo de falla es colapso
y no desborde.

Hasta que se dibuje, cualquier adaptación mayor a 390 px sería otra derivada del
código sobre una pantalla que la maqueta nunca vio.

Detectado al cerrar el ciclo de precios por forma de pago (2026-08-27) y
confirmado al mergearlo con el ciclo del teléfono (2026-08-28). Ver
`docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`,
sección *Las pantallas*.

---

## 23. La maqueta no dibuja nada del precio en dólares — en ninguna de las cinco pantallas — RESUELTA A MEDIAS

- **Frames**: `App / Artículo nuevo`, `App / Artículo ficha` (y `Móvil /
  Artículo ficha`), `App / Vender` (y `Móvil / Vender` + `Móvil / Vender ·
  Cobro`), `App / Ventas`, `KEwHe` (`App / Venta detalle`).

**Qué falta.** `design/arandano.pen` es anterior al ciclo del precio en dólares
(2026-08-29) — que a su vez es posterior al de planes de pago, ya anotado en las
entradas 19, 20, 21 y 22 —, así que ninguno de esos frames tiene:

1. **El selector de moneda pegado al campo "Precio de venta"** (`$` / `US$`) del
   alta y de la ficha, ni el aviso que aparece debajo al cambiarla ("el precio
   no se convierte…"). El código lo derivó de `SelectorDeCategoria`, que vive en
   la misma card y sí está dibujado: mismo alto de 40 px, mismo 13/500, mismo
   `SelectTrigger` de shadcn. Lo único que no sale de ahí es que vaya **pegado**
   al input (sin radio del lado interno y sin separación), que es el tratamiento
   estándar de un input con prefijo y lo que hace legible que la moneda es del
   número de al lado y no un campo aparte.
2. **La banda del total de `/vender` con una línea por moneda.** El frame dibuja
   una sola línea, que sigue siendo exactamente lo que se ve con un carrito en
   pesos; la segunda línea repite el tratamiento de la primera. Lo mismo para el
   subtítulo del Topbar del cobro móvil.
3. **El selector `Cubre` de cada fila de pago**, con su rótulo visible — a
   diferencia de Medio y Moneda, que en la maqueta van sin rótulo. Derivado del
   selector de Medio de esa misma fila; el rótulo se sumó porque "total en
   dólares" sin él no dice si es lo que se entrega o lo que se cubre.
4. **El segundo chip de "Faltan / Sobran"** (uno por moneda) y el rótulo "Total
   a cobrar **en pesos**" del pie del cobro cuando la venta tiene los dos
   totales. Los dos son el mismo tratamiento del control que ya está dibujado,
   repetido o rotulado.
5. **La segunda línea del tile "Total del período" de `/ventas`**, el segundo
   número de la columna Total de una fila, y **la banda "Total en dólares" del
   pie de "Qué se vendió"** en `/ventas/[id]` — que puede convivir con la banda
   de "Cobrado", o sea DOS bandas destacadas a la vez donde la maqueta dibuja
   una. Es la deuda que el comentario del pie de esa pantalla nombra.

**Lo que la maqueta NO tiene que cambiar**, y conviene decirlo para que nadie lo
"arregle" al dibujarlo: **ninguno de estos números se convierte**. Los dos
totales conviven sin sumarse y sin un equivalente en la otra moneda, en el
carrito, en el tile, en la fila y en el pie del detalle. Es la regla del ciclo
entero — fuera de una venta no hay ninguna cotización de la cual derivar el
equivalente, y un número inventado envejece solo. Un frame que dibuje "US$ 300
($ 445.500)" estaría pidiendo justo lo que el ciclo se cuidó de no hacer.

Mismo precedente que las entradas 6, 18, 19, 20 y 21: la maqueta no
**contradice** al código acá, le **faltan** los controles, así que se
construyeron contra lo que el `.pen` ya fija para cada pantalla en vez de
inventar un tratamiento. Si al dibujarlos la maqueta decide otra cosa, manda la
maqueta y se corrige el código.

**Los puntos 1 y 5 quedaron resueltos el 2026-08-30**, cuando `design/arandano.pen`
se actualizó de nuevo — ver
`docs/superpowers/specs/2026-08-30-ventas-por-moneda-y-horarios-design.md`, que
además trae el panel nuevo "Cuándo vende el local" y las dos monedas de "Cómo
entró la plata". **El punto 1**: la maqueta dibuja por primera vez el campo
compuesto de "Precio de venta", con el mismo tratamiento pegado que el código ya
había derivado de `SelectorDeCategoria`, y agrega la medida que faltaba —9 px en
las esquinas externas del campo, contra los 10 px del `rounded-lg` de shadcn que
el código tenía puesto—; ese único desvío lo cerró este mismo ciclo
(`components/selector-de-moneda.tsx`, `app/(app)/inventario/formularios.tsx`).
**El punto 5**: la maqueta dibuja ahora la segunda línea del tile "Total del
período", que el código ya tenía desde el ciclo del precio en dólares
(2026-08-29, Task 11) — acá fue la maqueta la que alcanzó al código, y no al
revés.

**Los puntos 2, 3 y 4 siguen abiertos.** La maqueta de `App / Vender` no se tocó
en esta actualización, así que la banda del total con una línea por moneda, el
selector `Cubre` de cada fila de pago y el segundo chip de "Faltan / Sobran"
siguen sin frame de referencia.

Detectado al construir el ciclo del precio de artículo en dólares (2026-08-29).
Ver `docs/superpowers/specs/2026-08-29-precio-en-usd-design.md`, sección *Las
pantallas*. Resolución parcial de los puntos 1 y 5 verificada contra la maqueta
el 2026-08-30, en el cierre documental del ciclo de las dos monedas y los
horarios.

---

## 24. El panel "Cuándo vende el local" del teléfono, derivado sin frame

`design/arandano.pen` dibuja este panel sólo en `App / Ventas` (nodo
`t93if9`). `Móvil / Ventas` (`nwW2V`) no lo tiene, y el ciclo lo construyó
igual para el teléfono: es información, no un control cuyo destino haya que
inventar —la distinción que dejó escrita el ciclo móvil—, y el dueño de un
local mira el celular más que la computadora.

Lo que se derivó sin referencia: el tratamiento a 390 px (se copió el de
"Cómo se movió" de `Móvil / Artículo ficha`, que es el único gráfico de
barras que la maqueta dibuja en ese ancho) y el segmentado Hora/Día, que en
el teléfono comparte la fila del título de la card.

Y una diferencia deliberada con el frame de escritorio, que no es una
derivación sino una decisión: **la franja horaria sale de los datos**, así que
el panel puede tener más o menos de las doce barras dibujadas.

Detectado al construir el ciclo de las dos monedas y los horarios (2026-08-30).
Ver `docs/superpowers/specs/2026-08-30-ventas-por-moneda-y-horarios-design.md`.

---

## 25. La maqueta no dibuja el desglose Vendido/Cobrado, en ninguna de las tres pantallas

`design/arandano.pen` es anterior a este ciclo, así que no tiene frame para
(1) la columna Total del listado con dos líneas rotuladas, (2) el tile "Total
del período" con rótulos de línea, ni (3) el pie de `/ventas/[id]` con
`Vendido / Recargo / Cobrado`. Las tres formas se derivaron del código.

Lo que se derivó: los rótulos reusan el rol tipográfico que el tile ya
tenía —10 px, bold, uppercase, con tracking—, pintados con `--marca-dim` para
no competir con el rótulo del propio tile. **No agregan ninguna fila nueva a
la escala de `docs/sistema-de-diseno.md`**: es el mismo rol de siempre, en un
lugar donde antes no había ningún rótulo.

**Y la columna Total del listado cambió de ancho, que sí es una medida que la
maqueta fija: de 140 px a 280 px.** Con el desglose, `$ 155.000,00 +
US$ 200,00` no entraba en 140 px y se partía en dos renglones; con el rótulo
encima de cada importe, esa fila terminaba midiendo el doble de alto que sus
vecinas. El ancho salió de `Cliente`, que es `1fr` y venía quedándose con
~1.150 px vacíos al lado. En escritorio el rótulo pasó además a ir **en línea**
con su importe —rótulo a la izquierda, número a la derecha—, así la fila
desglosada mide dos renglones y no cuatro; en el teléfono sigue apilado, que es
lo único que entra a 390 px. Lo pidió el dueño del producto mirando la pantalla
construida.

Y sigue pendiente, de antes de este ciclo y sin que éste lo mueva: que una
persona guarde desde Pencil el `.pen` vivo y lo commitee. El archivo
versionado sigue siendo el del 2026-08-21 (ver la entrada del 2026-08-30 de
`CLAUDE.md`).

Detectado al construir el ciclo del cobrado por moneda (2026-08-31). Ver
`docs/superpowers/specs/2026-08-31-cobrado-por-moneda-design.md`.

---

## 26. La maqueta no dibuja `/bot`, la pantalla entera

- **Frame**: ninguno. `design/arandano.pen` es anterior al bot de WhatsApp
  (2026-08-29) y no tiene ni el frame de escritorio ni el `Móvil / …`.

**Qué falta.** La pantalla completa: la card de conexión con sus tres estados
—sin conectar, con números esperando confirmación, y conectado—, el switch de
prendido, el textarea de la información del local con su contador, la card de
consumo del mes con su barra, la card que explica qué contesta el bot, y el
disparador "Conectar mi WhatsApp" del Topbar en sus dos anchos.

**Qué hizo el código, y por qué.** No inventó tratamiento nuevo: es exactamente
el mismo caso que la entrada 22 (`/formas-de-pago`), y la respuesta es la misma
—el layout de dos columnas, la card, el título de card y los textos de ayuda
salen de los roles que las otras pantallas ya comparten. Una card
estructuralmente igual a "Los planes del local" con otra tipografía se leería
como un accidente.

Lo que sí quedó derivado sin ninguna referencia, y por eso esta entrada sigue
abierta:

- **Los tres estados de la card de conexión.** La maqueta no dibuja ningún flujo
  de onboarding contra un tercero, así que la progresión "generar enlace →
  confirmar número → conectado" no tiene ni un frame del que copiarse.
- **La card de consumo**, que usa `<Progress>` — un componente que hasta ahora
  sólo aparecía en el panel "Cómo entró la plata" de `/ventas`, y ahí midiendo
  proporciones de un total, no un avance contra un tope.
- **El switch como control principal de una card.** `<Switch>` existe en el
  producto sólo en el diálogo de permisos de `/usuarios`, dentro de una lista.
  Acá es el control único de su card, y la maqueta no tiene un caso así.

**Y a diferencia de la 22, esta pantalla SÍ nace mobile-first.** El ciclo de
`/formas-de-pago` dejó anotado que su tabla no seguía el patrón `lg:contents` y
que su fila de cards colapsaba abajo de ~424 px; acá las dos columnas se apilan
sin prefijo y el ancho fijo del lateral lleva `lg:`. No es rediseño de teléfono
—no hay tabla que convertir en tarjetas— pero tampoco es deuda: la pantalla es
operable en los dos anchos desde el primer commit.

---

## 27. La maqueta no dibuja nada de las unidades por IMEI — ningún ancho, ninguna de las tres pantallas

- **Frames**: ninguno. `design/arandano.pen` es anterior al ciclo de unidades
  por IMEI (2026-09-02) — que a su vez es posterior al del precio en dólares,
  entrada 23 — y no tiene ni un frame de escritorio ni un `Móvil / …` que
  dibuje algo de esto.

**Qué falta.** Cuatro controles nuevos, en tres pantallas, en ningún ancho:

1. **El switch "Lleva IMEI o número de serie"** de `/inventario/nuevo` y de
   `/inventario/[id]`, con su diálogo que pide los N IMEI cuando el artículo
   ya tiene stock. El código lo derivó del mismo tratamiento de card que ya
   usan `SwitchDeSerie` y sus vecinos —borde, fondo `bg-card`, `Label` más
   texto de ayuda a la izquierda, control a la derecha—, mismo patrón que la
   entrada 26 (`/bot`) ya usó para su propio switch cuando tampoco tenía
   frame. **El diálogo ya no existe** (ciclo "unidades sin identificar",
   2026-09-03): pedía los treinta números de una sentada y no entraba en la
   pantalla, así que el switch prende directo y la captura se mudó a la card
   de Unidades — ver la entrada 28. El switch en sí sigue sin frame.
2. **La card "Unidades"** de `/inventario/[id]`: la lista de IMEI libres, la
   fecha de ingreso de cada uno, el filtro que aparece recién con más de 8, y
   "Dar de baja" con su nota. Se construyó con la misma `CardDelFormulario`
   que arman el resto de las cards de esa pantalla —mismo título, mismo
   borde, mismo padding—, y la fila de cada unidad copia el tratamiento
   `flex-col lg:flex-row` que ya usan las filas de otras listas de este
   producto (mismo criterio de "un solo árbol, no dos presentaciones" que
   dejó escrito el ciclo móvil).
3. **El selector de unidad del carrito**, en `/vender`: el `Dialog` que se
   abre al agregar por nombre un artículo con serie, con la lista de IMEI
   libres para tocar. Es el mismo `Dialog` de shadcn que ya usa el diálogo de
   prender el switch (punto 1) y el de permisos de `/usuarios` — ningún
   tratamiento nuevo, sólo su contenido.
4. **La línea del carrito sin stepper**, también en `/vender`: el recuadro
   con el IMEI que reemplaza a `[−] [valor] [+]` en la línea de un artículo
   con serie. Mide lo mismo que el stepper que reemplaza (`h-9 w-[104px]`,
   mismo borde `border-input`, mismo radio `rounded-[9px]`) para que la fila
   no salte de alto ni de ancho según lleve serie o no — es el mismo
   principio que ya aplicó el chip `Cubre` de la entrada 23: un control nuevo
   ocupa el lugar del que reemplaza, no inventa uno propio. **Este control
   también resultó ser un defecto** (2026-09-03, reporte de un dueño): ese
   lugar era la celda de la columna "Cantidad", así que la fila se leía
   "Cantidad: 355000000000001". Ver la entrada 29.

**Qué NO hizo el código: inventar un tratamiento nuevo.** Los cuatro controles
salen de patrones que esta pantalla, o una vecina, ya tenía dibujados —la
card, el `Dialog`, el switch de card, la fila `flex-col lg:flex-row`—, mismo
precedente que las entradas 19 a 22 y 26: la maqueta no **contradice** al
código acá, sencillamente todavía no llegó a ver la feature.

Detectado al construir el ciclo de unidades por IMEI (2026-09-02). Ver
`docs/superpowers/specs/2026-09-02-unidades-por-imei-design.md`, sección *Lo
que la maqueta no dibuja*.

## 28. La maqueta tampoco dibuja la captura progresiva del IMEI, y el único control que sí se había derivado ya no existe

- **Frames**: ninguno, otra vez. `design/arandano.pen` es anterior también al
  ciclo "unidades sin identificar" (2026-09-03).

Esta entrada es la continuación de la 27 y no la reemplaza, porque cuenta algo
distinto: **el ciclo anterior derivó un control que este ciclo BORRÓ.** El
diálogo de N campos del punto 1 de la entrada 27 —derivado sin frame, con el
`Dialog` de shadcn que ya usaba `/usuarios`— resultó ser justamente el defecto:
con treinta unidades no entraba en la pantalla, y exigía tener los treinta
equipos a mano en ese momento. Vale como dato sobre el método, no sólo sobre
este control: **derivar un control sin frame salió bien tres veces y mal una**,
y la que salió mal no se descubrió con un test sino usándolo contra un
inventario real.

**Ese conteo duró un día.** El 2026-09-03, más tarde, un dueño reportó que el
punto 4 de la entrada 27 —el recuadro del IMEI en el lugar del stepper— también
estaba mal, por un motivo distinto y no por su geometría. La cuenta real de ese
ciclo es **dos de cuatro**, y este párrafo queda como registro de lo que era
cierto esa mañana. Ver la entrada 29.

**Qué falta dibujar, hoy:**

1. **El bloque de captura de la card "Unidades"** (`/inventario/[id]`): un
   campo enfocado, con el contador de cuántas quedan sin identificar, que le
   pone el número a la más vieja y se vacía solo para el escaneo siguiente. Se
   derivó del mismo `Input` de shadcn que usa el resto de la pantalla, dentro
   de un recuadro `bg-muted/40` — el mismo tratamiento de "bloque destacado
   adentro de una card" que ya usa el aviso de clave generada de `/usuarios`.
2. **"Corregir" en cada fila de unidad identificada**: el IMEI pasa de ser un
   `<span>` a ser un `<input>` prellenado con su valor actual, con un botón
   `ghost` al lado. Mismo tratamiento de botón secundario que "Dar de baja",
   que ya vive en esa fila.
3. **El tope de alto de la lista de unidades** (`max-h-[420px]
   overflow-y-auto`). El número se derivó —unas ocho filas— y no sale de
   ningún frame: es la respuesta al síntoma que originó el ciclo, ahora que la
   causa (el modal) no está.
4. **La fila "Una sin identificar — quedan N"** del selector de `/vender`: una
   sola fila para todas las que no tienen número, con borde punteado
   (`border-dashed`) para distinguirla de las que sí lo tienen. El punteado es
   lo único verdaderamente nuevo de esta entrada: el resto copia el botón de
   unidad que la entrada 27 ya describe.
5. **El campo de captura en la línea del carrito** (`/vender`), que ocupa el
   mismo lugar y las mismas medidas (`h-9 w-[104px]`) que el recuadro del IMEI
   del punto 4 de la entrada 27 — mismo principio de "un control nuevo ocupa el
   lugar del que reemplaza"—, más la leyenda "IMEI opcional: podés dejarlo en
   blanco y cargarlo después" en la línea de meta, junto al SKU.

Detectado al construir el ciclo "unidades sin identificar" (2026-09-03). Ver
`docs/superpowers/specs/2026-09-03-unidades-sin-identificar-design.md`.

## 29. El IMEI ocupaba el lugar del stepper, y ese lugar tenía un encabezado que decía CANTIDAD

- **Frames**: ninguno, todavía. `design/arandano.pen` sigue siendo anterior a
  todo el ciclo de unidades por IMEI (entradas 27 y 28).

Esta entrada no agrega nada nuevo que la maqueta deba dibujar: **corrige un
control que las entradas 27 y 28 ya habían anotado como derivado**, el punto 4
de la 27 y el punto 5 de la 28. El IMEI de la línea del carrito —y el campo
para escanearlo— se dibujaban dentro de la celda de `/vender` cuyo
`columnheader` dice CANTIDAD, así que en escritorio la fila se leía "Cantidad:
355000000000001". Lo reportó el dueño de un local, no un test.

**La lección es sobre el principio con el que se derivaron, no sobre el
tamaño.** Las dos entradas justifican el control diciendo que "ocupa el lugar
del que reemplaza, no inventa uno propio", y como criterio de **geometría** eso
funcionó: la fila no salta de alto ni de ancho según lleve serie o no. Lo que
ese criterio no mira es el **significado** del lugar que se ocupa. Una celda de
una tabla no es sólo un rectángulo: es un rectángulo con un rótulo arriba, y
ese rótulo pasó a mentir. Dicho como regla para el próximo control derivado sin
frame: **heredar el lugar de otro control es heredar también lo que ese lugar
promete.** Donde el lugar tiene un rótulo —una columna, un `fieldset`, una
card con título—, "ocupa el mismo lugar" deja de alcanzar como justificación.

**Dónde quedó cada cosa**: el IMEI y su campo de captura viven ahora en la
línea de meta de la celda del artículo, junto al SKU —que es el otro dato de
identidad de la línea, y donde la leyenda "IMEI opcional…" ya vivía desde la
entrada 28—, y la celda de Cantidad muestra un `1` fijo con el mismo rol
tipográfico que el valor del stepper que reemplaza. Sigue sin haber frame para
nada de esto; lo que cambió es cuál derivación está vigente.

Detectado usando `/vender` contra un inventario real (2026-09-03). Ver
`docs/pantallas.md`, sección `/vender`, *Decisiones*.

## Cómo agregar una entrada

Cuando un ciclo decida que la maqueta se equivocó, la entrada va acá **y** en el
reporte del ciclo. Lo que no puede pasar es que la decisión viva sólo en
`.superpowers/`, que está gitignoreado y no sobrevive a la rama.
