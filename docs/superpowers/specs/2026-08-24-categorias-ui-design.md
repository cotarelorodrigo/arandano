# Spec: la UI de categorías

**Fecha**: 2026-08-24
**Ciclo**: el segundo de dos. El primero
(`docs/superpowers/specs/2026-08-23-categorias-design.md`) trajo el modelo; éste
trae las pantallas.

**Maqueta**: `design/arandano.pen`, frames `App / Inventario` (`pb32f`) y
`App / Artículo nuevo` (`B4O7t`), diseñados el 2026-08-24.

## Alcance

**Entra**: el panel de categorías en `/inventario` —navegación, filtrado y ABM—
y los dos selectores Categoría/Marca en `/inventario/nuevo`. Más un campo que
vino de yapa con el diseño del alta: **la factura del proveedor**, que no
necesita migración porque `MovimientoStock.nota` ya existe.

**No entra**, decidido con el dueño del producto:

- **`/inventario/[id]`, la ficha.** La maqueta no la actualizó: sigue con
  "Categoría" como un input de texto único y sin "Marca". Va a chocar con el
  alta, y se arregla cuando esté dibujada.
- **Código de barras.** La maqueta lo dibuja en el alta, al lado del SKU. Es una
  columna nueva en `Articulo` y el buscador de `/vender` debería mirarla además
  del SKU: es su propio ciclo.
- **"Mostrarlo en el catálogo".** El catálogo público no está construido. Un
  toggle que no publica nada es una promesa vacía en la pantalla; viaja con el
  catálogo cuando exista.

## Lo que la maqueta fija, y que el spec anterior había especificado mal

El ciclo del modelo dejó una descripción de la pantalla escrita **antes** de que
existiera el diseño (entrada 6 de `docs/correcciones-pendientes-del-pen.md`).
La maqueta la contradice en cinco puntos, y como el `.pen` manda, se implementa
la maqueta. Vale dejarlos escritos porque son justo los valores que alguien
podría "corregir" mirando el documento viejo:

| | Decía la descripción | Dice la maqueta |
|---|---|---|
| Fila | alto 36, `pad [9,12]`, `radius 9`, `gap 11` | alto **30**, `pad [0,8]`, `radius 8`, `gap 6` |
| Rubro sin marcas | sin chevron y **sin** hueco | **con** hueco (un frame de 14 px donde iría el chevron) |
| Marca | sólo indentada | sangría **24** y tipografía propia: **12.5 / normal / `--foreground-soft`** |
| Seleccionada | texto `--foreground` | texto **`--marca`**, weight 600, la cuenta incluida |
| "Todos los artículos" | sin chevron | **con** `chevron-right` |

El error de fondo fue mío y conviene nombrarlo: la descripción decía "copiá el
ítem de Nav del sidebar". La maqueta eligió filas más compactas, y tiene razón —
un sidebar con cinco destinos respira distinto que un árbol con veinte ramas.

## El panel `Categorías`

Card hermana del listado: `--card` sobre borde `--border`, radio 16, ancho
**248**, `padding [12, 8]`, `gap 2`. Vive dentro de un frame horizontal nuevo
(`Contenido`) junto al listado, que pasa de 1144 a 880 de ancho.

**Los filtros no se tocan** y quedan arriba, cruzando las dos columnas.

### Las cuatro variantes de fila

Todas: alto 30, `padding [0, 8]`, `gap 6`, radio 8, ancho completo. La cuenta
va a la derecha con ancho fijo 32, `--muted-foreground`, 12 px.

1. **Rubro con marcas** — chevron (14 px, `--muted-foreground`), `chevron-down`
   si está abierta y `chevron-right` si está cerrada. Etiqueta 13 / 500 /
   `--foreground`.
2. **Rubro sin marcas** — un hueco de 14 px en lugar del chevron, así el texto
   arranca donde arranca el de los demás. Etiqueta igual que el anterior.
3. **Marca** — hueco de **24 px**, sin chevron nunca. Etiqueta **12.5 / normal /
   `--foreground-soft`**: más chica y más liviana que un rubro, que es lo que
   dibuja la jerarquía sin sangrar de más.
4. **Seleccionada** (cualquiera de las tres) — fondo `--accent`, y **todo** el
   texto en `--marca` con weight 600: etiqueta, cuenta y chevron.

"Todos los artículos" y "Sin categoría" usan la variante de rubro sin marcas,
salvo que "Todos" lleva `chevron-right` — decorativo, porque no despliega nada.

Divisores de 1 px en `--border` con `padding [6, 4]`: uno bajo "Todos", otro
sobre "Sin categoría".

### Lo que la maqueta NO dibuja y hay que derivar

Sólo está el estado con "Todos" seleccionado. Estas tres piezas se derivan, y
quedan anotadas como divergencia para que alguien las dibuje:

- **Rubro y marca seleccionados**: se derivan de "Todos" — `--accent` de fondo y
  `--marca` en el texto. La marca **conserva su tamaño de 12.5** y sólo sube de
  peso: agrandarla al seleccionarla movería la fila.
- **La fila en edición**: un input inline del **mismo alto que la fila (30)**,
  borde `--input`, radio 8. No el `Input` de shadcn, que mide 40 y rompería el
  ritmo de la lista.
- **El menú de cada fila**: un `⋯` que aparece al hover **en el lugar de la
  cuenta**, sin correr el texto. Necesita `dropdown-menu` de shadcn, que hoy no
  está en `components/ui/`.

### Dos casos que la maqueta no puede dibujar

**El árbol vacío.** Un local recién dado de alta no tiene ninguna categoría, y
un panel en blanco al lado del listado se lee como algo roto. Muestra "Todos los
artículos" con su cuenta, "Sin categoría" si corresponde, y una línea corta
—"Todavía no creaste categorías"— con el `+` como única salida. No un estado
vacío ilustrado: es una columna de 248, no una pantalla.

**El colapso de un rubro.** La maqueta dibuja Fundas cerrada y el resto
abiertas, así que el estado es del usuario y no del dato. **Arrancan todas
abiertas** y el colapso es estado de cliente que no persiste entre
navegaciones: guardarlo pediría una columna o una cookie por algo que no le
cuesta nada a nadie rehacer, y un rubro que aparece cerrado sin que uno lo haya
cerrado es peor que uno abierto de más. El rubro de la rama activa se fuerza
abierto, siempre — una marca seleccionada dentro de un rubro colapsado sería una
selección invisible.

## Los conteos

**El conteo de un rubro incluye sus marcas** más lo colgado del rubro mismo.
Que la suma cierre no es cosmético: si el número de arriba no coincide con lo de
abajo, el árbol miente y deja de servir para decidir.

**El conteo responde al catálogo, no al resultado de la búsqueda.** Sigue el
mismo criterio de activos/desactivados que el listado, pero **ignora `?q` y
`?tipo`**. Si siguiera la búsqueda, apenas se escribe algo que matchea una sola
rama todas las demás mostrarían 0 — y el árbol dejaría de servir para navegar
justo cuando más se lo necesita.

Es **a propósito distinto** del conteo de stock negativo del subtítulo, que sí
habla de lo que el listado muestra. Son dos preguntas: aquélla es "de esto que
estoy viendo, cuánto está mal"; ésta es "cuánto tengo de cada cosa".

**Una sola consulta agrupada**, no una por rama: `groupBy` sobre `categoriaId`,
y los totales de los rubros se suman en JavaScript. Con `$queryRaw` la extensión
de `lib/tenant/prisma.ts` no setea la GUC y RLS devuelve cero filas en silencio
— ya pasó dos veces (`/ventas` y `/inventario`), y no hace falta una tercera.

## La selección y el filtrado

- **Viaja en `?cat=<id>`**, como ya viajan `?q`, `?tipo`, `?inactivos` y `?p`.
  Mismo mecanismo, sin nada nuevo que aprender.
- **Filtrar por un rubro incluye a sus marcas**: `OR` de un solo nivel
  (`categoriaId = rubro` o `categoriaId IN (hijas del rubro)`). Nada recursivo,
  porque el árbol tiene dos niveles.
- **`?cat=sin`** es el valor reservado de "Sin categoría" (`categoriaId: null`).
  Un id inventado o inexistente cae en "Todos", igual que `tipoDeQuery` con un
  tipo inválido: un query string escrito a mano no puede servir un 500.
- **Se combina en AND** con la búsqueda y el tipo.
- **Elegir una rama vuelve a la página 1**: quedarse en la página 3 de un
  listado que ahora tiene 8 artículos muestra un vacío que parece un error.
- **El vacío con rama activa ofrece salida.** `/inventario` ya tiene tres
  mensajes de vacío según el caso; éste es el cuarto, y suma un botón **"Buscar
  en todo el inventario"** que limpia `?cat` y conserva `?q`. Sin eso, buscar
  algo que existe pero está en otra rama se ve como si no existiera.

**La columna Categoría del listado se mantiene siempre**, también con una rama
activa. Con "Fundas · Samsung" seleccionado repite lo mismo en todas las filas,
pero una tabla que cambia de columnas según dónde estás parado desorienta más de
lo que ahorra. Era una pregunta abierta del ciclo anterior; queda cerrada acá.

## El ABM

Sólo **dueño**, igual que el alta de artículo: el catálogo es decisión del
negocio, mismo criterio que ya rige para el precio. Un empleado ve el árbol y
filtra con él, pero no lo edita — el `+` y el `⋯` no se le dibujan.

- **`+` en el encabezado** (22 × 22, `--muted`, radio 7, ícono `plus` de 13)
  crea un **rubro**. Es lo único del ABM que la maqueta sí dibuja.
- **`⋯` por fila**: **Renombrar**, **Mover a…**, **Borrar**, y en los rubros
  además **Agregar marca**.
- **Renombrar es in-place**, con `Enter` para guardar y `Esc` para cancelar.
- **Mover** sólo aplica a marcas: cambia de rubro padre. Mover un rubro debajo de
  otro crearía un tercer nivel, así que no se ofrece.
- **Borrar** exige la rama vacía y sin hijas — lo garantiza el `ON DELETE
  RESTRICT` de la base, no un chequeo de aplicación. El mensaje dice **cuántos
  artículos hay**, no un error genérico: *"Celulares · Samsung tiene 4 artículos.
  Movelos antes de borrarla."*

**El `Esc` de la edición in-place tiene que cortar la propagación.** Es la misma
trampa que ya mordió en `/vender`, donde un `Esc` destinado a cerrar un panel
armaba el vaciado del carrito: acá no hay carrito, pero la regla —un `Esc` local
se queda en su componente— vale igual y sale más barato escribirla ahora.

## `/inventario/nuevo`

La maqueta reorganizó la pantalla entera: de tres cards apiladas a **dos
columnas** — izquierda `fill` con "Qué es" y "Datos del artículo", derecha de
**420** con "Stock inicial" (y "Catálogo público", que no entra).

**Categoría y Marca son dos `Select` separados**, no un campo de texto:

- **Categoría** ofrece los rubros más "Sin categoría".
- **Marca** ofrece las hijas del rubro elegido. Con un rubro sin marcas, queda
  deshabilitado — no vacío y clickeable, que invita a buscar algo que no está.
- Cambiar de rubro **limpia** la marca elegida: dejarla puesta guardaría una
  marca de otro rubro.

**Esto quita una capacidad que hoy existe, y hay que decirlo.** Desde el ciclo
del modelo, el campo de texto libre **crea** la rama al vuelo: escribir
"Fundas · Samsung" en un artículo nuevo da de alta las dos filas. Con selectores
eso se termina: se elige de lo que hay, y para crear una categoría se va al panel
de `/inventario`. Es la decisión que el dueño del producto tomó al elegir
"catálogo propio" sobre "catálogo creable al vuelo", y el costo es real —un local
nuevo carga su primer artículo sin categoría, o interrumpe para crearla—. La
mitigación es un link **"Administrar categorías"** bajo el par de selectores, que
lleva al panel.

**El texto sigue escribiéndose**, ahora derivado del árbol en vez de tipeado:
`textoDeCategoria` sobre la rama elegida. El expand/contract no cambia — la
columna `categoria` se sigue llenando hasta el deploy que la borre.

**Factura del proveedor** entra como `MovimientoStock.nota` del movimiento de
stock inicial. `crearArticulo` ya crea ese movimiento; hoy le pasa la nota fija
`'stock inicial'`, que pasa a ser `'stock inicial · <factura>'` cuando hay
factura. Sin migración, sin campo nuevo.

**Margen sobre el costo cargado** es puro cálculo contra el precio de venta, del
lado del cliente, y no se guarda: es el mismo número que la ficha ya muestra en
el tile "Último costo".

## Verificación

- `partirCategoria` y `textoDeCategoria` ya están cubiertos por el ciclo anterior.
- El árbol que arma la pantalla: conteos que cierran (un rubro suma sus marcas),
  orden alfabético, "Sin categoría" ausente cuando no hay ninguno.
- El filtrado: por rubro trae las marcas, por marca trae sólo esa, `?cat`
  inválido cae en Todos, `?cat=sin` trae los de categoría nula, y todo combina
  en AND con `?q` y `?tipo`.
- El ABM: crear rubro y marca, renombrar, mover una marca de rubro, y los dos
  rechazos de borrado (con hijas y con artículos) con su mensaje contando.
- Los permisos: un empleado no ve los controles y sus acciones lo rechazan.
- El alta: la marca depende del rubro, cambiar de rubro la limpia, y el artículo
  queda con `categoriaId` y con el texto derivado.
- La factura del proveedor termina en la nota del movimiento.
