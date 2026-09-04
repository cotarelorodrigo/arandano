# Spec: el costo del stock

**Fecha**: 2026-09-04
**Sale de**: el feedback textual del dueño del producto: *"el dueño debería
poder ver el costo total de un item cuando entra al detalle de cada producto
en el inventario. es decir si tiene 30 unidades cuánto costo total tiene ese
producto. luego en /dashboard debería poder ver el costo total del local, es
decir de todos los productos"*.

Dos tiles y una definición. Es el ciclo más chico que tuvo este proyecto en
código, y el spec existe igual porque lo que define no es una pantalla: es
una **magnitud nueva** —cuánta plata hay parada en mercadería— que este repo
ya sabe que se le va a pedir en más lugares.

---

## El punto de partida: qué hay guardado

El único costo que existe es `MovimientoStock.costoUnitario`, y su único
escritor es `ingresarStock` (`lib/inventario/stock.ts`) — más el alta de
artículo con stock inicial (`lib/inventario/articulos.ts`), que escribe el
mismo campo en el movimiento que crea. Es opcional, y desde el ciclo de
permisos (2026-08-26) está detrás del permiso `COSTOS`.

Hoy ese número se lee en tres lugares, y los tres eligen **el mismo**:

| Dónde | Qué hace |
|---|---|
| Tile "Último costo" de `/inventario/[id]` | El `INGRESO` con costo cargado más reciente, desempatado por `id` |
| Pie de ese mismo tile (`textoDeMargen`) | El margen contra el precio de venta actual |
| `crearVenta` (`lib/ventas/crear.ts`) | Congela ese costo en `Venta.costoArs`, que es lo que alimenta el tile "Margen" del dashboard |

El costo se guarda **siempre en pesos**, incluso para un artículo con precio
en dólares. Eso es lo que hoy le saca el margen a esos artículos —comparar un
costo en pesos contra un precio en dólares exigiría inventar una cotización—
y es, en este ciclo, exactamente lo contrario: un problema que no aparece.

Y falta lo que este ciclo agrega: **el stock nunca se valuó**. `Articulo.stock`
existe desde el ciclo de inventario y nadie lo multiplicó por nada.

---

## Lo que se decidió, y contra qué alternativa

### 1. Se valúa con el último costo conocido

```
costoTotal(artículo) = max(stock, 0) × últimoCostoConocido
```

`últimoCostoConocido` es **literalmente la misma consulta** que ya alimenta el
tile "Último costo": `motivo: 'INGRESO'` con `costoUnitario: { not: null }`,
ordenado por `creadoEn` descendente y desempatado por `id`.

**Las alternativas descartadas** son las dos que un contador nombraría
primero:

- **Promedio ponderado de los ingresos.** Más fiel a lo que realmente se pagó
  —si entraron 20 a $7.000 y 10 a $9.000, el último costo valúa las 30 a
  $9.000 y se pasa—, pero introduce un **cuarto** número de costo en el mismo
  producto, distinto de los tres de la tabla de arriba. Alguien va a tener que
  explicar, en la misma ficha, por qué el tile de al lado dice $9.000 y éste
  divide por $7.666,67.
- **FIFO: el costo real de las unidades que quedan.** Es el número
  contablemente correcto y el más caro: reconstruir capas de ingreso
  consumiéndolas con las salidas, por artículo, sobre una tabla append-only,
  y para **todo el catálogo** en `/dashboard`. Se descarta por costo, no por
  incorrecto.

El costo aceptado de la decisión está dicho arriba con su ejemplo: con
compras a precios distintos, el total se corre hacia el precio de la última
compra. Es la misma imprecisión que el tile "Último costo" y el margen de la
venta ya tienen desde que existen, así que no suma una imprecisión nueva
—suma un cuarto lector de la que ya había—.

**El disparador para reconsiderarlo**, concreto y no una fecha: que a un dueño
le moleste que su total suba solo porque el último ingreso vino más caro,
teniendo el depósito lleno de mercadería vieja comprada a otro precio.

### 2. Sin costo cargado, el artículo no suma y se dice cuántos son

El costo es opcional al ingresar, así que va a haber artículos con stock y sin
ningún costo. El total **suma lo que sabe** y el pie del tile del dashboard
dice cuántos quedaron afuera: `12 artículos sin costo`.

**Las dos alternativas descartadas**: sumar sin avisar deja un total que
parece completo y no lo es —exactamente la clase de número que este repo
penalizó cuando le puso pie a `delta()` en vez de inventar un "+100 %"—; y no
mostrar ningún total hasta que todo el catálogo tenga costo deja el tile vacío
para siempre en cualquier local real.

En la **ficha**, en cambio, el tile no se dibuja. No es una excepción: es la
misma regla vista desde un solo artículo. El pie "12 sin costo" existe porque
el total del local es una suma parcial que hay que calificar; el costo total
de **un** artículo sin costo no es parcial, no existe. Y el tile de al lado ya
muestra "—" en "Último costo", que dice todo lo que hay que decir.

### 3. El stock negativo cuenta como cero

Vender sin stock no está frenado (`lib/ventas/crear.ts`: *"el stock puede
quedar negativo y eso no frena"*), así que un artículo puede decir −2.

Restarlo del total sería aritméticamente consistente —el total es Σ stock ×
costo— y produciría un número más chico sin que nadie sepa por qué. Un stock
negativo es un **error de carga**, no mercadería que valga plata negativa, y
`/inventario` ya tiene su propio aviso de stock negativo, que es donde se
corrige.

El clamp vive en una sola función pura, no repetido en las dos pantallas.

### 3b. Los dos bordes que el clamp deja, escritos para que no se resuelvan dos veces

- **Stock cero con costo cargado** devuelve **cero, no `null`**. El tile de la
  ficha se dibuja y dice `$ 0,00`, con el pie `0 × $ 7.400`. Es verdad —no hay
  mercadería— y es coherente con el tile de al lado, que dice "En stock 0". El
  `null` está reservado para "no se sabe", que es otra cosa.
- **`sinCosto` cuenta artículos, no movimientos, y sólo los que tienen
  mercadería**: un artículo entra a ese conteo si su stock **clampeado** es
  mayor a cero y no tiene ningún costo. Uno con stock cero o negativo no
  aporta nada al total, así que decir que "falta" su costo sería inflar un
  aviso con artículos que no distorsionan ningún número. El pie concuerda en
  número: `1 artículo sin costo`, `12 artículos sin costo`.

### 4. Entran los artículos activos, tipo producto

- **Servicios**: no tienen stock (`lib/inventario/stock.ts` rechaza moverles
  stock) y nunca tienen movimientos. Quedan afuera por definición, no por un
  filtro que haya que acordarse de poner.
- **Desactivados**: quedan **afuera**. Un artículo dado de baja con stock
  encima es plata inmovilizada, cierto, pero es plata que el dueño ya decidió
  no vender, y sumarla mezcla "cuánto tengo invertido en lo que vendo" con
  "cuánto me quedé colgado". Es además el criterio que `/inventario` ya usa
  por default y el que usa el bot.
- **Artículos con serie** (`llevaSerie`): entran sin ningún caso especial. Su
  `stock` **es** la cantidad de unidades libres, así que la misma
  multiplicación da el número correcto. Las unidades no llevan costo propio
  —decisión explícita del ciclo del 2026-09-02, aditiva si algún día hace
  falta—.

### 5. Los artículos con precio en dólares entran, y en pesos

Es el único cálculo de este proyecto donde el dólar no obliga a decidir nada:
`costoUnitario` está en pesos para todos, así que el total es en pesos para
todos y no hay ninguna cotización que inventar.

Vale escribirlo porque **parece** que debería haber un problema: el ciclo del
precio en dólares dejó a `textoDeMargen` devolviendo `null` para estos
artículos, y la intuición dice que acá pasaría lo mismo. No pasa. Aquel
`null` es porque el margen compara costo **contra el precio**, y son de
monedas distintas; acá el costo se multiplica por una **cantidad**, que no
tiene moneda.

### 6. Sin permiso nuevo, sin migración, sin columna

`lib/permisos/catalogo.ts` **no crece**: los dos tiles van detrás de `COSTOS`,
que es exactamente el permiso que ya tapa el costo y el margen en las dos
pantallas. Este número no es más sensible que el costo unitario del que sale
—es el mismo dato multiplicado por un stock que cualquiera puede ver—, así
que un permiso propio sería tapar con dos llaves la misma puerta.

Y no hay nada que guardar: el número se **deriva** de lo que ya está escrito.
Sin migración, el ciclo entero se revierte revirtiendo la imagen.

---

## Las pantallas

### `/inventario/[id]` — un cuarto tile

```
COSTO TOTAL
$ 222.000
30 × $ 7.400
```

El pie muestra la cuenta, y no es decoración: es lo que hace obvio de dónde
sale el número, por qué es ese y no otro, y por qué se mueve cuando entra
mercadería a otro costo. Sin él, el dueño tiene tres tiles con plata y ninguna
forma de atar el tercero a los otros dos.

Se muestra con `esProducto && puedeCostos && costoTotal !== null` — las mismas
tres condiciones que ya gobiernan al tile de al lado, más la del número que
no existe.

**Lo que cuesta en layout**: la fila pasa de 3 tiles a 4. En el teléfono
mejora —los tres de hoy dejan uno huérfano en la grilla; cuatro cierran un
2×2 parejo—. En escritorio los tres actuales se achican para dar lugar al
cuarto, y "En stock" conserva su tratamiento de marca.

### `/dashboard` — un quinto tile

```
COSTO DEL STOCK
$ 2.480.000
al día de hoy · 12 artículos sin costo
```

Con todo el catálogo costeado, el pie es sólo `al día de hoy`.

Ese pie es **load-bearing y no una aclaración**: los otros cuatro tiles de esa
fila responden al selector de período y se comparan contra el período
anterior; éste ignora los chips por completo, porque es una foto de ahora. Sin
el pie, un dueño que toca "Este mes" y ve el mismo número que en "Hoy" tiene
razón en pensar que algo está roto.

Por el mismo motivo **no lleva chip de variación**: no hay período anterior
contra el cual comparar. Ya hay precedente de tiles sin chip en esa fila
("Ticket promedio" y "Margen" tampoco lo llevan).

**El rótulo es "COSTO DEL STOCK"** y no "costo del local", que fue la palabra
del pedido: "costo del local" se lee como alquiler y sueldos, que es plata que
este producto no modela.

**No entra al CSV del dashboard.** Ese archivo exporta el período; esto es una
foto de ahora, y una fila que ignora el rango dentro de una exportación
rotulada por rango es un dato que alguien va a leer mal.

### El teléfono

Los dos casos son el mismo: una grilla de 2 columnas que pasa de 3 items a 4,
o sea de una fila y un huérfano a un 2×2 cerrado. Ningún ancho fijo nuevo, así
que `test/responsive.test.ts` no tiene nada que marcar.

---

## Cómo se construye

Módulo nuevo `lib/inventario/valuacion.ts`, con la cuenta separada de la
consulta:

- **`costoTotalDeArticulo(stock, costo): Decimal | null`** — pura. El clamp del
  negativo y el `null` sin costo viven acá **una sola vez**, para las dos
  pantallas. Es la lección de las dos copias de un botón, aplicada antes de
  pagarla: dos implementaciones de la misma regla es la forma en que un día
  el dashboard clampea y la ficha no.
- **`valuacionDelTenant(prisma): Promise<{ total, sinCosto }>`** — dos
  consultas: los artículos activos de tipo producto con su stock, y el último
  costo de cada uno vía `distinct: ['articuloId']` con `orderBy: [{ articuloId:
  'asc' }, { creadoEn: 'desc' }, { id: 'desc' }]`. Es el **mismo** `DISTINCT ON`
  que ya usa `crearVenta`, con el mismo desempate y por la misma razón: dos
  ingresos de la misma transacción comparten `creadoEn` hasta el milisegundo.

**Nunca `$queryRaw`.** La extensión de `lib/tenant/prisma.ts` intercepta
operaciones de modelo, no raw queries, así que un raw sin el `set_config` de
RLS devuelve **cero filas en silencio** — este repo ya lo documentó dos veces
(el panel de medios de `/ventas` y el gráfico de rotación de
`/inventario/[id]`), y las dos veces la salida fue agregar en JavaScript.

**Las dos funciones van exportadas, no inline en el Server Component.** Es la
regla que este proyecto ya pagó con el hallazgo I3 de la review del rediseño:
una consulta escrita adentro de un componente `async` que abre sesión no la
puede llamar ningún test, y su `desactivadoEn: null` quedaría tan desprotegido
como el `anuladaEn` que se podía borrar dejando 785 tests en verde. Es la misma
razón por la que existen `pagosDelPeriodo`, `metricasDelPeriodo` y
`datosDelDetalle`.

La ficha **no** llama a `valuacionDelTenant`: ya tiene el último costo del
artículo en la mano (`ultimoCosto`, del `Promise.all` que ya corre) y sólo
necesita la función pura. Cero consultas nuevas en esa pantalla.

---

## Cómo se verifica

**La cuenta pura** (`costoTotalDeArticulo`): con costo y stock normales;
`null` sin costo; cero con stock negativo; cero con stock cero; un artículo en
dólares dando el mismo resultado que uno en pesos con los mismos números —el
caso existe para fijar que la moneda del PRECIO no entra en esta cuenta—.

**`valuacionDelTenant`** contra la base efímera, que es lo único que puede
ejercitar RLS y el `DISTINCT ON`: que elige el costo más **reciente** y no el
primero (dos ingresos del mismo artículo a costos distintos); que un ingreso
sin costo no borra lo que se sabía del anterior; que el conteo de `sinCosto`
cuenta artículos y no movimientos; que un artículo desactivado no suma ni
cuenta; que un servicio no suma ni cuenta; que un artículo con stock cero no
entra en `sinCosto` —no tiene mercadería que valuar, así que no falta nada—.

**El render de los dos tiles**, y en las **dos** direcciones para el permiso:
con `COSTOS` el tile está, sin `COSTOS` no está. Un `not.toContain` solo no
alcanza —pasa igual si una de las dos pantallas quedó destapada—, que es la
lección que dejó escrita el merge del ciclo móvil.

**Lo que ningún test puede contestar**, y por lo tanto queda para la
verificación manual: si cinco tiles en una fila de 116 px de alto siguen
siendo legibles en escritorio, y si el pie de dos partes (`al día de hoy · 12
artículos sin costo`) entra sin cortarse a 390 px. Es el riesgo específico de
este ciclo.

---

## Documentación

- `docs/pantallas.md`, secciones `/inventario/[id]` y `/dashboard`, en el
  **mismo commit** que el cambio de cada pantalla — la regla de ese archivo.
- `docs/correcciones-pendientes-del-pen.md`, entrada **33**: la maqueta no
  dibuja ninguno de los dos tiles, y además este ciclo le cambia la cuenta de
  tiles a dos filas que el `.pen` sí dibuja (de 3 a 4 en la ficha, de 4 a 5 en
  el dashboard). Es la desviación más grande de este ciclo respecto de la
  maqueta y no se disimula.
- `CLAUDE.md`: una entrada en *Próximos pasos técnicos*, y la nota de que
  **esto no cierra la deuda del costo** — ver abajo.

---

## Lo que este ciclo NO hace

- **No cierra la deuda del costo**, que sigue con su investigación escrita en
  `CLAUDE.md`: el costo sigue siendo un atributo del **evento de recepción**
  y no del producto, sigue sin poder cargarse sin sumar stock, sigue sin poder
  corregirse una vez escrito, y sigue perdiéndose en silencio en el alta
  cuando alguien carga costo sin cantidad. Este ciclo suma un **lector** más
  de ese dato; no cambia dónde vive ni cómo se escribe. Si algo, sube la
  presión para cerrarla: un tile que dice "12 artículos sin costo" es la
  primera pantalla que le muestra al dueño el tamaño del agujero.
- **No agrega costo por unidad** (el IMEI de un iPhone comprado más caro que
  el de al lado). Sigue siendo aditivo, con su disparador ya escrito en
  `CLAUDE.md`.
- **No desglosa el total del local** por categoría ni por artículo. El pedido
  es un número; un ranking de capital inmovilizado es otra pantalla.
- **No compara el costo del stock contra nada** —ni contra el mes pasado, ni
  contra lo vendido—. No hay serie histórica de stock guardada en ningún lado,
  así que cualquier comparación exigiría escribirla primero.
- **No entra al CSV** de ninguna de las dos pantallas.
