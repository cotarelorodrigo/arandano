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

## Cómo agregar una entrada

Cuando un ciclo decida que la maqueta se equivocó, la entrada va acá **y** en el
reporte del ciclo. Lo que no puede pasar es que la decisión viva sólo en
`.superpowers/`, que está gitignoreado y no sobrevive a la rama.
