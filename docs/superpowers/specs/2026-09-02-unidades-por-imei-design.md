# Spec: unidades identificadas por IMEI

**Fecha**: 2026-09-02

**Origen**: feedback textual de un cliente — *"Necesito la casilla IMEI en los
celulares. Es posible que se pueda cargar este dato en los productos del
inventario? Idealmente también si estamos vendiendo un celular y hay varias
unidades en stock (cada una con su IMEI) podríamos seleccionar cuál de todos
esos estamos vendiendo. Sería un nivel más de detalle ya que dentro del stock de
un producto tenemos que saber cuál se vendió. Esto por ahí se puede generalizar
ya que es un caso de uso de productos caros"*.

El propio cliente nombra la generalización, y conviene tomarla en serio desde el
título: esto no es un campo IMEI, es **un nivel más abajo del stock**. Hoy el
catálogo modela *modelos* —un SKU es "iPhone 13 128 GB"— y el stock es cuántos
hay. El pedido es que abajo del modelo exista la *unidad física*, con identidad
propia, y que vender signifique elegir una. El IMEI es cómo se llama esa
identidad en celulares; en otros rubros caros es el número de serie, y el modelo
es el mismo.

## El punto de partida

Hoy:

- `Articulo.stock Decimal(12,3)` es un escalar, y es un **caché** de la suma de
  sus `MovimientoStock` — no la fuente de verdad. Se actualiza con `increment`
  relativo en la misma transacción que el movimiento.
- `MovimientoStock` es append-only y con signo: `+n` ingresa, `−n` descuenta.
  Su motivo es `VENTA`, `ANULACION_VENTA`, `AJUSTE` o `INGRESO`.
- `crearVenta` (`lib/ventas/crear.ts`) recibe `{ articuloId, cantidad }` por
  ítem, congela descripción, precio y moneda en el `VentaItem`, y descuenta
  stock sin validar que alcance —decisión de negocio ya tomada, no un olvido.
- `ingresarStock` y `corregirStock` (`lib/inventario/stock.ts`) son las dos
  puertas de entrada y de corrección. La corrección por conteo fija el stock en
  un número y el servidor calcula el delta **adentro de la transacción**, contra
  el stock del momento.
- El buscador del mostrador (`buscarArticulosVendibles`, `lib/ventas/buscar.ts`)
  matchea **nombre y SKU**, y eso es lo que habilita el lector de código de
  barras sin una línea de código propia.
- "Serie" ya existe en el repo, y **no es esto**: `OrdenDeTrabajo.equipoSerie`
  es el IMEI del equipo **del cliente** que entra a reparar. No hay ninguna
  relación entre las dos cosas y este ciclo no crea ninguna.

## Lo que se decidió, y contra qué alternativa

Las cinco decisiones se tomaron con el dueño del producto antes de escribir una
línea. Van arriba de todo porque son lo que hay que releer dentro de seis meses.

### 1. La unidad convive con el stock escalar; no lo reemplaza

`Articulo.stock` **no se toca**. Sigue siendo el caché de siempre, actualizado
por las mismas dos escrituras en la misma transacción. Para un artículo con
serie se le suma un invariante: `stock = cantidad de unidades libres`.

**La alternativa era que la unidad *fuera* el stock**: `Articulo.stock` ignorado
para estos artículos y todo lector haciendo `count()`. Elimina por estructura el
riesgo de que los dos números se desincronicen, y se descartó por superficie:
cada lectura de stock del producto pasaría a ramificar por `llevaSerie` —el
listado paginado de `/inventario`, el chip "Queda poco", la disponibilidad que
informa el bot, el chip de stock del carrito, el tile "En stock" de la ficha, la
exportación de CSV—. Es más código condicional, más riesgo y más trabajo, para
eliminar un riesgo que este motor **ya sabe defender**: la relación entre
`Articulo.stock` y sus movimientos es exactamente el mismo problema, resuelto
desde el ciclo de inventario con las dos escrituras juntas y un test que prueba
que la suma cierra.

**La otra alternativa era no crear ninguna tabla**: una columna `serie` en
`MovimientoStock`, y "disponible" definido como una serie con un `+1` sin `−1`
posterior. Append-only puro y cero entidades nuevas. Se descartó porque "qué
IMEI tengo" pasa a ser un agregado sobre una tabla que crece para siempre, no
hay dónde poner el índice único que impide cargar dos veces el mismo IMEI, y un
error de tipeo queda incorregible por diseño.

### 2. El switch es del artículo, y con el switch prendido no hay excepciones

`Articulo.llevaSerie` decide si ese artículo se maneja por unidad. Prendido:
**toda** unidad se carga al ingresar, y vender **exige** elegir una. Apagado:
funciona exactamente como hoy.

Lo opcional es **qué artículos lo usan**, nunca qué unidades. La alternativa era
permitir el mixto —un artículo con serie donde algunas unidades no tienen IMEI
cargado— y se descartó porque deja el stock con dos verdades posibles ("dice 5 y
hay 3 IMEI") sin ninguna respuesta buena a qué significa el número, que es
exactamente la clase de dato ambiguo que después nadie sabe leer.

### 3. La unidad es identidad pura: sin costo ni precio propios

Una unidad guarda su IMEI, cuándo entró, quién la recibió, y por qué puerta
salió. Precio y costo siguen siendo del artículo.

Se evaluó **costo por unidad** —con equipos caros el costo real varía entre
unidades del mismo modelo, y hoy el costo vive en el movimiento de ingreso sin
poder atribuirse a ninguna— y **precio por unidad** —el usado con la pantalla
rayada sale menos—. Las dos se descartaron para este ciclo: la segunda rompe el
supuesto de que el precio lo pone el artículo, que hoy sostienen el punto de
venta, el catálogo y el bot; y la primera es la mitad de la deuda del costo que
ya tiene su investigación escrita en CLAUDE.md y merece su propio ciclo, no un
rincón de éste. **Ninguna de las dos queda bloqueada**: las dos son columnas
nullable sobre una tabla que este ciclo crea.

### 4. Prender el switch con stock cargado pide los IMEI ahí mismo

Un local que ya tiene 5 iPhones contados como número suelto prende el switch y
la pantalla le abre cinco campos. Recién con los cinco cargados queda prendido.

La alternativa era **exigir stock en cero** (corregir por conteo a 0, prender,
volver a ingresar las 5 con sus IMEI): cero código de migración, y varios pasos
que además ensucian el historial de movimientos con una baja y un alta que nunca
pasaron. La otra era **sólo en artículos nuevos**, que obligaría a recargar como
artículo nuevo cualquier modelo que ya se venía vendiendo. Se eligió la
interrupción de una vez, que es la que deja el artículo cuadrado al instante y
no miente en el historial.

### 5. La corrección por conteo se apaga; la baja es por unidad

En un artículo con serie no alcanza con decir "quedan 4": hay que decir **cuál**
se fue. `corregirStock` se rechaza para estos artículos y en su lugar hay una
baja individual, con nota (se robó, se rompió, fue a garantía, estaba mal
cargada).

Se evaluó conservar el conteo con tildes —el dueño cuenta la vitrina y marca
cuáles encontró, y las no marcadas se dan de baja juntas—, mejor para el arqueo
periódico y más pesado para dar de baja una sola. Se eligió la individual, que
es el caso frecuente. El conteo con tildes sigue siendo aditivo si aparece la
necesidad.

## El modelo

```prisma
model Articulo {
  // …
  llevaSerie Boolean @default(false) @map("lleva_serie")
  unidades   UnidadDeArticulo[]
}

model UnidadDeArticulo {
  id             String    @id @default(uuid(7)) @db.Uuid
  tenantId       String    @map("tenant_id") @db.Uuid
  articuloId     String    @map("articulo_id") @db.Uuid
  imei           String
  ingresadaEn    DateTime  @default(now()) @map("ingresada_en") @db.Timestamptz(3)
  ingresadaPorId String    @map("ingresada_por_id") @db.Uuid
  // La venta que se la llevó. NULL mientras esté en la vitrina.
  ventaId        String?   @map("venta_id") @db.Uuid
  // La otra puerta de salida: se robó, se rompió, fue a garantía.
  bajaEn         DateTime? @map("baja_en") @db.Timestamptz(3)
  bajaNota       String?   @map("baja_nota")
  bajaPorId      String?   @map("baja_por_id") @db.Uuid
  creadoEn       DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)
  // …relaciones, todas Restrict salvo tenant (Cascade)
}
```

Más dos índices comunes: `@@index([tenantId, articuloId])`, que es por donde la
ficha lista las unidades libres de un artículo, y `@@index([tenantId, imei])`,
que es por donde entra el escaneo del mostrador.

**"Libre" es `ventaId IS NULL AND baja_en IS NULL`.** Una unidad no se borra
nunca: sale por una de las dos puertas y queda como historia. Es la misma forma
que ya tienen `Articulo.desactivadoEn`, `User.desactivadoEn` y `Venta.anuladaEn`
— borrar la fila se llevaría puesta la respuesta a "¿este equipo salió de acá?",
que es justamente la pregunta que llega meses después con un reclamo de
garantía.

### La unicidad del IMEI es PARCIAL, y esto es lo que alguien va a querer simplificar

```sql
CREATE UNIQUE INDEX unidades_articulo_imei_libre
  ON unidades_articulo (tenant_id, imei)
  WHERE venta_id IS NULL AND baja_en IS NULL;
```

Prisma no sabe expresar un índice parcial, así que va escrito a mano en el SQL
de la migración — mismo mecanismo, y por la misma razón, que "una sola caja
abierta por tenant" y que las raíces homónimas del árbol de categorías.

Un `@@unique([tenantId, imei])` global sería más estricto y estaría **mal**: un
local de celulares **recompra** el equipo que vendió, y ese IMEI tiene que poder
volver a entrar. Dos filas con el mismo IMEI en el historial no son un defecto:
son el mismo teléfono pasando dos veces por el mismo local, que es exactamente
lo que pasó.

Lo que el índice parcial sí impide, que es el caso real: cargar dos veces el
mismo IMEI en la vitrina.

### `MovimientoStock.unidadId`, nullable

Es lo que deja que el historial "Cómo se movió" de `/inventario/[id]` diga
**cuál** entró y cuál salió, en vez de un `+1` anónimo.

**No fuerza la decisión abierta de `MovimientoStock`** que CLAUDE.md tiene
anotada. Aquélla es sobre el **origen** del movimiento —hoy `ventaId`, mañana
`ordenDeTrabajoId` y `comandaId`, o el par `(origenTipo, origenId)`—; ésta es
sobre su **sujeto**. Son ejes distintos y la elección de uno no condiciona la
del otro.

### Lo que NO se agrega: `VentaItem.unidadId`

Con `Unidad.ventaId` alcanza para contestar "qué IMEI se llevó esta venta". La
línea del carrito de un artículo con serie es siempre **una unidad, cantidad
1** —vender dos iPhones son dos líneas—, así que aparear línea con unidad es
trivial, y la única ambigüedad posible (dos líneas del mismo artículo) es
irrelevante: las dos dicen exactamente lo mismo, con la misma descripción y el
mismo precio congelados.

Sumar la columna sería un segundo vínculo para el mismo hecho, con el modo de
falla clásico de los vínculos redundantes: que un día digan cosas distintas.

## El motor

### `crearVenta`

`ItemDeVenta` gana `unidadId?: string`. Las reglas nuevas, cada una con su
`ErrorDeVenta` propio y su mensaje escrito para el mostrador:

| Situación | Código |
|---|---|
| Artículo con `llevaSerie` sin `unidadId` | `UNIDAD_REQUERIDA` |
| Artículo con `llevaSerie` y `cantidad ≠ 1` | `CANTIDAD_CON_SERIE` |
| Artículo sin serie que viene con `unidadId` | `UNIDAD_NO_CORRESPONDE` |
| La unidad no existe, o no es de ese artículo | `UNIDAD_INEXISTENTE` |
| La unidad ya se vendió o se dio de baja | `UNIDAD_NO_DISPONIBLE` |
| La misma unidad dos veces en el mismo carrito | `UNIDAD_REPETIDA` |

El artículo sin serie que viene con `unidadId` **se rechaza y no se ignora**: es
la misma clase de decisión que ya toma `crearVenta` al distinguir
`ARTICULO_DESACTIVADO` de `ARTICULO_INEXISTENTE` en vez de filtrarlo en el
`where` — ignorar en silencio borra la distinción que hace falta para
diagnosticar.

### La carrera de dos cajas, que es lo que justifica el diseño

Dos cajas pueden leer "está libre" a la vez y vender el mismo equipo. **Leer y
después escribir no lo cierra.** Lo que lo cierra es tomar la unidad con un
`UPDATE` condicional y exigir que haya movido una fila:

```ts
const tomada = await tx.unidadDeArticulo.updateMany({
  where: { id: unidadId, ventaId: null, bajaEn: null },
  data: { ventaId: venta.id },
})
if (tomada.count !== 1) throw new ErrorDeVenta('UNIDAD_NO_DISPONIBLE', …)
```

La segunda caja ve `count === 0` y su venta se rechaza entera. Es exactamente el
mismo criterio que ya hace que el índice único —y no el `findFirst` previo— sea
la defensa **real** de la idempotencia del cobro: el chequeo temprano es el
camino rápido del caso común, la escritura condicional es la que cierra la
carrera exacta.

**Las unidades se toman ordenadas por `id`**, igual que los artículos: dos
transacciones que tomen los mismos locks en orden distinto se deadlockean
(`40P01`), y un orden total y común a todo el motor es lo único que lo hace
imposible.

### `anularVenta`

Además de revertir los movimientos, libera las unidades (`ventaId = null`) y
anota el `unidadId` en el movimiento `ANULACION_VENTA`.

**El caso de borde real**: si mientras la venta estuvo viva alguien re-ingresó
ese mismo IMEI —el local recompró el equipo que había vendido—, la liberación
choca contra el índice parcial, porque pasarían a existir dos unidades libres
con el mismo IMEI. Se traduce a un error que dice qué pasó y qué hacer, en vez
de un 500 con un `P2002` crudo.

### `ingresarStock`

Para un artículo con serie, deja de recibir una cantidad y recibe **la lista de
IMEI**; la cantidad es su longitud. Una cantidad suelta sobre un artículo con
serie se rechaza. El costo unitario sigue siendo uno por ingreso, como hoy.

### `corregirStock` y `darDeBajaUnidad`

`corregirStock` se rechaza con `SERIE_SIN_CONTEO` para artículos con serie. En
su lugar, `darDeBajaUnidad(unidadId, nota)`: marca la baja, escribe su
movimiento `AJUSTE` de −1 con la nota y el `unidadId`, y decrementa el stock. Las
mismas dos escrituras, en la misma transacción, que hace todo el resto del
motor.

### `prenderSerie(articuloId, imeis[])`

Lee el stock **dentro de la transacción** y exige que `imeis.length` sea
exactamente ese número; crea las unidades y prende el switch. **No genera ningún
movimiento**: el stock no cambia, sólo pasa a tener nombre. Leerlo adentro es lo
que evita validar el conteo contra el número que la pantalla dibujó hace un
minuto — el mismo cuidado que ya tiene `corregirStock`.

Con stock en 0 no pide nada y prende directo.

**Y exige que el stock sea un entero no negativo.** `Articulo.stock` es un
`Decimal(12,3)` —lo es porque CLAUDE.md ya tiene previsto gastronomía
descontando insumos por receta—, y el motor permite que quede negativo, porque
vender no valida que alcance. Medio iPhone no existe, y "−2 unidades libres"
tampoco: las dos situaciones se rechazan con su error, en vez de intentar crear
2,5 unidades o ninguna y dejar el invariante roto desde el primer minuto.

### Apagar el switch exige stock en cero

Apagarlo con unidades libres significa convertir cinco identidades en un número
5 y tirar los IMEI: pérdida silenciosa de datos, que es lo que este repo
penaliza en todos lados.

El costo aceptado es real y conviene decirlo: arrepentirse **después** de haber
cargado unidades obliga a darlas de baja una por una. Es molesto y es raro — el
caso frecuente de arrepentirse es "lo prendí y todavía no cargué nada", donde el
stock ya es cero y no hay nada que hacer.

## Las pantallas

Cinco, y ninguna nueva.

### `/inventario/nuevo`

Un switch "Lleva IMEI o número de serie" en la card de datos, al lado del
selector de tipo. Sólo tiene sentido en `PRODUCTO`: con `SERVICIO` queda apagado
y deshabilitado, por la misma razón por la que un servicio no lleva stock.

Prendido, el par "Cantidad (opcional) / Costo unitario" cambia: la cantidad pasa
a ser una lista donde se escanean o tipean los IMEI, uno por línea, y la
cantidad **es** cuántos hay en la lista.

### `/inventario/[id]`

Es la pantalla que más cambia:

- El switch, con el diálogo que pide los N IMEI cuando el artículo ya tiene
  stock (decisión 4).
- Una card nueva, **"Unidades"**, con la lista de IMEI libres, cuándo entró cada
  uno, y "Dar de baja" con su nota. Con muchas unidades, un filtro dentro de la
  card.
- El tile "En stock" **no cambia**: sigue mostrando el mismo número, que ahora
  además es la cantidad de filas de esa lista.
- "Ingresar mercadería" pide IMEI en vez de cantidad.
- "Corrección por conteo" queda **deshabilitada y explicada**, con el texto que
  dice por qué y manda a la card de Unidades. Deshabilitada, no escondida:
  desaparecer sin decir nada es lo que este repo trata como defecto.

### `/vender`

Dos caminos que terminan igual:

- **Se escanea el IMEI** → el artículo entra al carrito con esa unidad ya
  elegida. Es una condición más en la búsqueda del mostrador, que ya matchea
  nombre y SKU. Si esa unidad ya está en el carrito, no duplica: avisa.

  **El match del IMEI es EXACTO y sólo contra unidades libres**, al revés que el
  `contains` de nombre y SKU. Un IMEI es un identificador de quince dígitos que
  se escanea entero: un `contains` no lo mejora en nada y en cambio haría que
  tipear "355" trajera media vitrina, además de no poder usar el índice. Y como
  el match es exacto y las libres son únicas por el índice parcial, devuelve una
  unidad o ninguna — nunca hay que desempatar. `ArticuloVendible` gana
  `unidad?: { id, imei }`, que es lo que le permite a la pantalla agregar la
  línea con la unidad ya elegida en vez de volver a preguntar.
- **Se busca por nombre** → al agregar un artículo con serie aparece la lista de
  IMEI libres y se toca uno.

En el carrito, la línea de un artículo con serie muestra el IMEI **en el lugar
del stepper** `[−][valor][+]`: su cantidad es 1 y no se puede cambiar, y dos
equipos son dos líneas. Si otra caja se llevó la unidad entre que se agregó y
que se cobró, el `UNIDAD_NO_DISPONIBLE` del motor sale como un cartel que dice
qué pasó y qué hacer — mismo criterio que el `PLAN_INEXISTENTE` del plan dado de
baja desde otra pestaña.

### `/ventas/[id]`

Los IMEI que se llevó la venta, dentro del bloque "Qué se vendió". Es lo que
hace útil el reclamo de garantía tres meses después.

### El teléfono

Todo a 390 px, por la regla que el ciclo móvil aplicó cinco veces: una capacidad
que desaparece del teléfono y no reaparece en ningún lado es un defecto, no una
simplificación. Alcanza a la lista de unidades de la ficha, al "Dar de baja", al
selector de unidad del carrito y al diálogo de prender el switch — que en el
teléfono es donde **más** se va a usar, porque ahí el lector de código de barras
es la cámara.

### Lo que la maqueta no dibuja

`design/arandano.pen` es anterior a todo esto: no hay frame para el switch, ni
para la card de Unidades, ni para el selector del carrito, en ningún ancho. Se
deriva del código con los patrones que ya existen (card, `Sheet` en el teléfono,
chips), y queda anotado como entrada nueva en
`docs/correcciones-pendientes-del-pen.md`, igual que hizo el ciclo del precio en
dólares.

## Permisos

**El catálogo no crece.** `lib/permisos/catalogo.ts` no suma ninguna clave, y
el número de claves no se escribe acá: la fuente es ese archivo. Este repo ya
pagó tres veces el peaje de un conteo mantenido a mano.

Es la misma forma de razonar que cerró la moneda del artículo en el ciclo de
USD: **se delega por lo que la acción mueve**. El switch y los IMEI del alta
mueven UN artículo, así que viajan con `ARTICULOS_CREAR` / `ARTICULOS_EDITAR`,
igual que el precio y la moneda. Ingresar unidades y darlas de baja quedan
detrás de `conSesion` sin permiso propio, exactamente donde ya están hoy
`ingresarMercaderia` y `corregirPorConteo`.

## El bot no ve IMEIs

La condición nueva del buscador entra **sólo** en el camino del mostrador, no en
el de `porPalabras` que usa el bot, y `lib/bot/catalogo.ts` sigue devolviendo
`{ nombre, precio, disponibilidad }`. La disponibilidad sale de `Articulo.stock`,
que sigue siendo correcta para los dos tipos de artículo.

Es coherente con la defensa que eligió ese ciclo, y vale repetir su forma: no es
que el prompt lo prohíba — es que **no hay ningún camino de código** que alcance
un IMEI desde el agente.

## Cómo se verifica

TDD, y los casos que de verdad importan:

- **El invariante `stock = unidades libres`**, en las tres puertas: vender,
  anular y dar de baja.
- **La carrera de dos cajas por la misma unidad.** Es el caso que justifica el
  diseño del motor, y el que un `findFirst` dejaría verde estando roto.
- **Anular devuelve la unidad a libre**, y el choque contra el índice parcial
  —cuando el IMEI se re-ingresó mientras tanto— sale con un error legible.
- **La unicidad parcial en las dos direcciones**: dos libres con el mismo IMEI
  chocan; una vendida más una nueva con ese IMEI, no.
- **`corregirStock` rechazado** sobre un artículo con serie.
- **El bot no puede llegar a un IMEI**, por fuente: la condición nueva no está
  en el camino de `porPalabras`.
- **Que "Dar de baja" y el selector de unidad aparezcan UNA sola vez.** Esto
  invierte lo que este spec pedía antes de escribirse —"las DOS copias,
  contadas en las dos direcciones"—, y el cambio es deliberado: la fila de
  unidad se construyó como **un solo árbol** (un `<div>` interno `flex-col
  lg:flex-row` para el par IMEI/fecha), no como dos presentaciones ocultas una
  por CSS, así que no hay dos copias que contar. El argumento está en el
  docblock de `FilaDeUnidad` y es el mismo que CLAUDE.md ya registra como
  decisión tomada ("Un solo árbol, no dos presentaciones: el patrón
  `lg:contents`"): renderizar dos veces deja el mismo dato dos veces en el DOM
  y manufactura justamente las copias que después hay que probar que estén
  gateadas igual. El selector de unidad de `/vender` es un `Dialog` único por
  la misma razón. Los casos asertan **exactamente una** aparición
  (`unidades.test.tsx`), que es lo que atrapa una regresión hacia el patrón
  duplicado.

  **La regla de las dos copias sigue vigente donde la duplicación es real** —un
  botón en el Topbar (`hidden lg:flex`) más su gemelo en `accionMovil` o al pie
  (`lg:hidden`), que es lo que `<Encabezado>` obliga—: ahí se cuenta en las dos
  direcciones, porque un `not.toContain` pasa igual si una quedó gateada y la
  otra no. Lo que cambió no es la regla: es que esta pantalla no la necesita.
- `docs/pantallas.md`, sección por pantalla tocada, **en el mismo commit**.

## El riesgo, y por qué esta migración es inerte

La migración es tabla nueva, `articulos.lleva_serie` con default `false`, y
`movimientos_stock.unidad_id` nullable. Cero `DROP`.

**Mientras nadie prenda el switch, ninguna fila que la migración pueda producir
es distinta de lo que la imagen anterior ya sabe leer**: sin `llevaSerie`, no
hay unidades, no hay `unidad_id` escrito, y todo camino del motor pasa por donde
pasaba. Eso es exactamente lo que pide expand/contract —que el schema nuevo
soporte la versión anterior del código—, así que la migración y la UI viajan en
el mismo deploy, con el mismo argumento escrito del ciclo del precio en dólares.
Partirlo en dos deploys no compraría nada.

`docs/schema.md` se regenera solo por el hook de pre-commit.

Y una nota que no es de este ciclo pero aplica igual: **las FK de Postgres
saltean RLS**, así que `unidades_articulo.articulo_id` puede apuntar por SQL
crudo a un artículo de otro tenant, como ya pasa con todas las demás FK del
schema. Lo que RLS sí garantiza es que ese dato ajeno no se lea desde el otro
lado. Cerrarlo de verdad —FK compuestas contra `(tenant_id, id)`— sigue siendo
un ciclo propio sobre el schema entero.

## Lo que este ciclo NO hace

Explícito, para que no se lea como olvido:

- **Costo por unidad.** Es la mitad de la deuda del costo que ya tiene su
  investigación escrita en CLAUDE.md, y merece ese ciclo y no un rincón de éste.
  Queda aditivo: una columna nullable sobre la tabla que este ciclo crea.
- **Precio por unidad.** El usado con la pantalla rayada sale menos, y eso rompe
  el supuesto de que el precio lo pone el artículo. Ver decisión 3.
- **El aviso "este IMEI ya pasó por acá"** al reingresar uno que está en el
  historial. Es una consulta y un cartel, y es aditivo.
- **El conteo con tildes** para el arqueo de la vitrina. Ver decisión 5.
- **Cualquier relación con `OrdenDeTrabajo.equipoSerie`.** Ése es el equipo del
  cliente, no del inventario, y unirlos es un ciclo propio con su propia
  pregunta de producto: qué significa que el equipo que entró a reparar sea uno
  que este local vendió.
- **Multi-sucursal.** Sigue rigiendo "un tenant por local" por omisión. Una
  unidad no lleva sucursal.

## Lo que sigue

- El **disparador para el costo por unidad**: que a un dueño le moleste que dos
  iPhones del mismo modelo, comprados a precios distintos, midan su margen
  contra el mismo número.
- El **disparador para el precio por unidad**: que el local empiece a vender
  usados en serio, donde el estado de cada equipo mueve el precio.
- La **verificación manual**, que ningún test reemplaza: escanear un IMEI real
  con el lector del local y ver que la unidad entra al carrito; prender el
  switch en un artículo con stock y cargar los N; y a 390 px, que la lista de
  unidades y el selector del carrito no queden apretados.
