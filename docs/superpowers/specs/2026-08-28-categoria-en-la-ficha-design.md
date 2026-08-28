# Spec: la categoría de un artículo ya cargado

**Fecha**: 2026-08-28

**Sale de feedback de un dueño**, textual: *"el dueño no puede agregar marca o
categoría a un producto del inventario ya agregado, tampoco puede agregarle o
modificar el costo de un producto ya agregado"*.

**Maqueta**: `design/arandano.pen`, frames `App / Artículo ficha` (`y4tEb`) y
`Móvil / Artículo ficha`. **Los dos siguen dibujando el control viejo** —un
campo de texto único "Categoría", sin "Marca"—, y este ciclo va igual: ver
*La maqueta*, más abajo.

## Alcance

**Entra**: reemplazar el campo de texto libre "Categoría" de la card "Datos" de
`/inventario/[id]` por los dos selectores encadenados Categoría → Marca que
`/inventario/nuevo` ya tiene, extraídos a un componente que usan las dos
pantallas. Y con eso, zanjar la asimetría de permisos que las dos pantallas
tienen hoy.

**No entra**, decidido con el dueño del producto:

- **Todo lo del costo.** La segunda mitad del feedback es cierta y queda para su
  propio ciclo. Lo que se sabe hoy está en *La deuda del costo*, al final, para
  que no haya que redescubrirlo.
- **Asignar categoría en tanda** desde el listado de `/inventario`. De a uno
  desde la ficha alcanza para responder al feedback; la tanda tiene su
  disparador escrito abajo.
- **Dibujar los frames de la ficha en la maqueta.** El código va primero y la
  deuda queda anotada.

## El problema, con nombre y apellido

La ficha **sí** tiene un campo "Categoría"
(`app/(app)/inventario/formularios.tsx`, en `FichaDeArticulo`) y el camino de
servidor **funciona**: `guardarArticulo` → `editarArticulo` →
`asegurarCategoria` escribe la rama. Nada está roto en el sentido de tirar un
error. Lo que no funciona es poder usarlo:

- **No hay campo "Marca".** El alta tiene dos selectores desde el 2026-08-24; la
  ficha se quedó en la versión anterior a ese ciclo.
- **El único separador que se parsea es el middot `·`**
  (`lib/inventario/categorias.ts`, `SEPARADOR`). Para poner marca desde la ficha
  hay que escribir literalmente `Celulares · Samsung`, con un carácter que no
  está en un teclado argentino. `Celulares / Samsung` **no falla**: crea una raíz
  sola llamada así, con la barra adentro del nombre.
- **Tipear sólo `Samsung` crea un rubro raíz nuevo**, al lado del
  `Celulares > Samsung` que ya existe, en silencio. Sin autocompletar y sin ver
  qué ramas hay, no hay forma de descubrir que se espera una rama del árbol.

Es la entrada 7 de `docs/correcciones-pendientes-del-pen.md`, escrita el
2026-08-24 y confirmada por el feedback: **una divergencia entre dos pantallas
que cargan el mismo dato es un defecto de producto, no una inconsistencia
estética.**

## Enfoques evaluados

**Elegido — espejo exacto del alta, con el par de selectores extraído a un
componente compartido.** Es lo más chico que responde al feedback, y el único de
los tres que ataca la causa además del síntoma: mientras haya dos
implementaciones del mismo control, una va a volver a quedarse atrás. La
fricción que deja —para colgar un artículo de una rama que no existe hay que ir
al panel y volver— ya tiene precedente aceptado y mitigación escrita del ciclo
del 2026-08-24.

**Descartado — lo mismo más un "+ Crear…" adentro de cada selector.** Mata esa
fricción, pero es meter un ABM adentro de un `Select` de Radix: el mismo choque
que el ciclo móvil ya documentó con el `<input>` dentro del `DropdownMenu` de
caja. Duplicaría el ABM que ya vive en el panel de `/inventario`, que está a un
click, y sería deuda nueva con la maqueta sobre deuda vieja. **El disparador
para reconsiderarlo**: que ir y volver al panel moleste de verdad al ordenar un
catálogo.

**Descartado — un solo `Select` con las ramas ya plegadas** ("Celulares",
"Celulares · Samsung", "Cables"). Un control en vez de dos y más bajo en el
teléfono, pero vuelve a contradecir al alta — que es exactamente el defecto que
este ciclo viene a cerrar.

## `SelectorDeCategoria`

Componente cliente nuevo, extraído tal cual del bloque que hoy vive dentro de
`FormularioDeAlta`: los dos `Select`, el estado `rubroId`/`marcaId`, el limpiado
de la marca al cambiar de rubro —dejarla puesta guardaría una marca de otro
rubro, y el servidor la aceptaría porque el id existe—, el `disabled` cuando el
rubro no tiene marcas, y la nota con el link al panel.

**Recibe `categoriaIdInicial: string | null` y deriva los dos valores solo.** Si
el id es una hoja, precarga rubro = su padre y marca = la hoja; si es una raíz,
rubro = la raíz y marca vacía. `arbolDeCategorias` ya devuelve las raíces con sus
hijas, así que alcanza con buscar. `/inventario/nuevo` lo instancia con `null` y
queda idéntico a hoy.

**Los campos pasan de `name` de Radix a `<input type="hidden">` propios.** Hoy el
alta se apoya en el `name` del `<Select>`, que alcanza porque el formulario
arranca vacío y "sin categoría" es la ausencia de elección. En la ficha eso no
alcanza: un artículo que **ya** tiene rama necesita poder volver a "sin
categoría", y Radix no admite un item con `value=""`. Con inputs propios,
"Sin categoría" y "Sin marca" son opciones explícitas que mandan cadena vacía,
sin filtrar ningún centinela al servidor.

**El contrato de nombres no cambia**: siguen siendo `categoriaId` y `marcaId`, y
la regla de resolución también — **la marca gana sobre el rubro cuando hay las
dos**, porque la rama más específica es la que el artículo tiene que ocupar.

**En la ficha los dos selectores van apilados, no en fila.** La card "Datos" mide
324 px; dos selects lado a lado quedan en ~150 px cada uno y "Vidrios templados"
no entra. El alta los deja en fila porque su card es mucho más ancha. El
`Código` recupera la fila completa que hoy comparte con el campo que desaparece.

**El subtítulo de la ficha no se toca**: ya muestra la rama completa, porque
`articulo.categoria` es el texto canónico desde el ciclo del modelo. Esa mitad
de la entrada 7 estaba resuelta sin que la entrada lo dijera.

## El servidor

`editarArticulo` (`lib/inventario/articulos.ts`) cambia su parámetro
`categoria?: string | null` por `categoriaId: string | null`, y resuelve igual
que `crearArticulo`: con id, `ramaElegida(tx, id)` **dentro de la misma
transacción** devuelve el id validado y el texto canónico, y se escriben las dos
columnas; con `null`, las dos van a `null`. Un id de otro tenant no resuelve a
ninguna fila —RLS lo vuelve invisible— y sale como `CATEGORIA_INEXISTENTE`, no
como una FK reventando con un código que nadie atrapa.

`Articulo.categoria` (el texto) **se sigue escribiendo**, derivado de la rama.
Sigue rigiendo el expand/contract del ciclo del modelo: el `DROP COLUMN` es un
deploy posterior al de la UI, no éste.

**Eso saca de la ficha el único camino que creaba ramas tipeando**, que es el
punto del enfoque elegido. `asegurarCategoria` deja de tener llamador desde la
edición y queda sirviendo sólo al alta por texto, que es lo que usa
`scripts/sembrar-catalogo-dev.mts` — y un seed no es una pantalla.

### El permiso, que es la decisión que este ciclo zanja

Hoy las dos pantallas piden cosas distintas para lo mismo, y nadie lo decidió:
`altaArticulo` acepta `categoriaId` con sólo `ARTICULOS_CREAR`, sin mirar
`CATEGORIAS`; `guardarArticulo` descarta el cambio de categoría sin `CATEGORIAS`.

**Manda el alta: elegir rama es `ARTICULOS_EDITAR`.** Colgar un artículo de una
rama que ya existe es editar el artículo, no tocar el árbol. `CATEGORIAS` queda
significando exactamente lo que su descripción en `lib/permisos/catalogo.ts` ya
dice —administrar el árbol: crear, renombrar, mover, borrar—, y las cuatro
acciones del ABM lo siguen pidiendo. **El catálogo sigue en siete permisos**; no
se agrega ninguno.

Con eso **desaparece la distinción `undefined` = "no tocar la categoría"** de
`editarArticulo`. Existía por una sola razón, escrita en su docblock: era la
forma de que alguien con `ARTICULOS_EDITAR` y sin `CATEGORIAS` no creara ramas al
vuelo escribiendo texto libre. Con selectores no hay nada que crear, así que la
distinción se queda sin motivo — y borrarla **es** lo que implementa la decisión.

**Y `categoriaId` va como parámetro requerido, no opcional.** Es lo que impide
que la tri-estado vuelva por la ventana: con un campo opcional, un llamador que
lo omita significa "no tocar", que es justamente la semántica que se está
sacando, y omitirlo por descuido no daría ningún error. Requerido, cada edición
dice explícitamente de qué rama cuelga el artículo o que no cuelga de ninguna, y
`tsc` marca al que no lo diga. El costo es tocar las llamadas de
`test/inventario.test.ts` que hoy omiten el campo; todas son de artículos sin
categoría, así que `null` no cambia lo que afirman.

`guardarArticulo` pasa a mandar
`categoriaId: texto(datos,'marcaId') || texto(datos,'categoriaId') || null`, la
misma línea que ya tiene `altaArticulo`.

**Y se corrige un comentario que miente.** El de `guardarArticulo` afirma hoy
*"La UI ya no dibuja este campo sin el permiso (ver `formularios.tsx`)"*: es
falso — `FichaDeArticulo` nunca recibió un prop de ese permiso y el campo se
dibuja siempre que haya `ARTICULOS_EDITAR`. El efecto visible era que un empleado
en esa combinación escribía una categoría, recibía "Cambios guardados", y no
cambiaba nada. Deja de existir con el cambio de arriba, pero el comentario se va
igual: un comentario falso sobrevive al código que describía.

### La pantalla

`/inventario/[id]/page.tsx` suma `arbolDeCategorias(tenantId, { verInactivos:
true })` al `Promise.all` que ya tiene, con el mismo `verInactivos` del alta y
por el mismo motivo: acá el árbol es una **lista de opciones**, no un informe. Un
rubro cuyos artículos están todos dados de baja sigue siendo una opción válida, y
esconderlo obligaría a recrearlo con el mismo nombre — que además chocaría contra
el índice único.

## Sin migración

El backfill de `20260824023756_categorias` fue completo: convirtió el texto libre
en filas del árbol, enganchó cada artículo a su rama y normalizó el texto. No
queda ningún artículo con `categoria` y sin `categoria_id`, así que no hay
ninguna fila que el selector no pueda precargar. `test/categorias-backfill.test.ts`
lo prueba y no se toca.

## Verificación

**Seis aserciones existentes cambian, y una se invierte.** `acciones.test.ts`
prueba hoy que alguien con `ARTICULOS_EDITAR` y sin `CATEGORIAS` **no** puede
tocar la categoría (el caso usa `'Bypass · Intento'`). Con la decisión de arriba
ese caso pasa a afirmar lo contrario. **Invertir un test de permisos a mano es
justo donde se cuela un agujero**, así que va con la razón escrita al lado y el
caso negativo explícito y no implícito: sí puede colgar el artículo de una rama
existente, **no** puede crear una.

Casos nuevos:

- `formularios.test.tsx` — la ficha renderea `name="categoriaId"` y
  `name="marcaId"` y ya no `name="categoria"`; precarga rubro y marca cuando el
  artículo cuelga de una hoja; precarga sólo el rubro cuando cuelga de una raíz;
  ofrece "Sin categoría"; y **la card entera sigue sin renderearse** sin
  `ARTICULOS_EDITAR` (caso que ya existe y hay que conservar).
- `acciones.test.ts` — `guardarArticulo` mueve el artículo a la rama elegida y
  escribe las dos columnas con el texto canónico; `marcaId` gana sobre
  `categoriaId`; vacío lo deja sin categoría; una rama de **otro tenant** sale
  como `CATEGORIA_INEXISTENTE` y no como una FK reventando; y el par de permisos
  invertido.

`test/pantallas.test.ts` ata `docs/pantallas.md` a las rutas, así que la sección
`/inventario/[id]` se actualiza en el mismo commit — es la regla del repo, y ese
test sólo verifica que la sección **exista**, no que diga la verdad.

El gate: `npm test`, `npx tsc --noEmit`, `npm run lint`.

**Queda pendiente la verificación manual**, por lo mismo que en los dos ciclos
anteriores: `arandano-dev` bind-montea `/root/arandano` y no el worktree, así que
mirar a ojo va después del merge. Lo que hay que mirar: que el selector precargue
la rama del artículo al abrir la ficha, que elegir "Sin categoría" la borre de
verdad, que cambiar de rubro limpie la marca, y que un empleado con
`ARTICULOS_EDITAR` y sin `CATEGORIAS` pueda mover el artículo pero no vea el ABM
del panel.

## La maqueta

`design/arandano.pen` no dibuja este control en la ficha, en ningún ancho. **El
código va primero y la deuda queda anotada** — decidido con el dueño del
producto, y es un cambio de criterio respecto del 2026-08-24, cuando la misma
entrada 7 dijo lo contrario ("sin el frame dibujado, habría que inventar el
tratamiento"). Lo que cambió: esta vez no hay tratamiento que inventar, porque
existe en el mismo archivo, en `App / Artículo nuevo`. Lo que se deriva sin
referencia es **el apilado vertical** de los dos selectores en la card de 324 px,
que el alta no puede contestar porque su card es más ancha.

La entrada 7 se actualiza a "resuelta en código, la maqueta queda atrás" y
**sigue abierta**, con eso escrito.

## La deuda del costo

La segunda mitad del feedback —*"tampoco puede agregarle o modificar el costo de
un producto ya agregado"*— es **cierta**, y queda para su propio ciclo. Lo
investigado, para no redescubrirlo:

1. **El único escritor de `costoUnitario` es `ingresarStock`**
   (`lib/inventario/stock.ts`, su propio docblock lo dice), más el movimiento de
   stock inicial del alta.
2. **`ingresarStock` exige `cantidad > 0`.** No hay forma de registrar un costo
   sin además sumar stock. El rodeo sería ingresar 1 unidad y corregir por
   conteo, pero `corregirStock` no escribe costo: queda un ingreso fantasma en el
   historial.
3. **`MovimientoStock` es append-only**: un costo mal tipeado es permanente.
   CLAUDE.md ya lo llama "una puerta de una sola dirección".
4. **Y un bug de pérdida silenciosa en el alta**: en `crearArticulo`
   (`lib/inventario/articulos.ts:282`) el movimiento que lleva `costoUnitario` se
   crea **sólo adentro** de `if (stockInicial && stockInicial.greaterThan(0))`.
   El formulario muestra "Cantidad (opcional)" y "Costo unitario (opcional)" lado
   a lado, sin nada que sugiera que una depende de la otra. Quien carga un
   producto diciendo "sé cuánto me cuesta, todavía no tengo stock" **pierde el
   costo sin ningún mensaje**.

**La raíz es un choque de modelos mentales**, y es lo que ese ciclo tiene que
resolver antes de escribir código: el modelo dice *"el costo es un atributo del
evento de recepción"* y el dueño piensa *"el costo es un atributo del
producto"*. Mientras el único lugar donde se escribe un costo sea un ingreso de
mercadería, y el único donde se lee sea un tile de sólo lectura, el producto no
tiene respuesta para "¿cuánto me cuesta esto?" separada de "¿cuándo lo recibí?".

## Lo que sigue

- **El ciclo del costo**, con la pregunta de modelo de arriba primero.
- **Asignar categoría en tanda** desde el listado. **Disparador**: que a un dueño
  le moleste de verdad ordenar un catálogo grande de a uno. Necesita selección
  múltiple en `/inventario`, que la maqueta no dibuja en ningún ancho.
- **Crear una rama sin salir de la ficha**, si ir y volver al panel molesta.
- **Dibujar los dos frames de la ficha** y corregir el código si la maqueta
  decide otra cosa.
