# Spec: el Dashboard del local

**Fecha**: 2026-09-02
**Sale de**: `design/arandano.pen`, frames `App / Dashboard` (`A2Hffo`) y
`Móvil / Dashboard` (`OWGzI`), más el ítem `Nav/Dashboard` (`dKCXo`) que se
sumó al componente `Shell/Sidebar`.

Es la primera pantalla de este proyecto que no contesta "qué pasó con esta
venta" sino "cómo viene el local": cuatro tiles con su variación contra el
período anterior, la tendencia de los últimos catorce días, y tres
composiciones — por medio de pago, por categoría y por artículo.

---

## El punto de partida: qué hay y qué falta

Tres de las piezas ya existen y se reusan tal cual:

- **El motor de rangos** de `/ventas` (`rangoDeChip`, `chipActivo`,
  `hoyEnArgentina`, `inicioDelDia`) resuelve los chips y el huso.
- **Las dos magnitudes por moneda** (`lib/ventas/cobrado.ts`:
  `vendidoDeVenta`, `cobradoDePagos`, `lineasDeImporte`) ya saben mostrar
  pesos y dólares sin convertir, y es lo que van a usar los tiles.
- **La composición por medio** (`lib/ventas/composicion.ts`) ya agrupa los
  pagos del período — con un defecto que este ciclo arregla, ver Pieza 0.

Y falta todo lo demás: la comparación contra un período anterior no existe en
ninguna pantalla, la composición por categoría tampoco, el ranking de
artículos tampoco, y **el costo de lo vendido no está en la base**.

---

## El hallazgo que le da forma al ciclo: no hay tipo de cambio por venta

`cotizacionParaElCruce` (`app/(app)/vender/punto-de-venta.tsx:351`) guarda
**`Pago.cotizacion = 1` cuando el pago no cruza monedas**, y lo hace a
propósito y bien: pagar un iPhone de US$ 300 con 300 dólares en efectivo no
convierte nada, así que no hay ninguna cotización que registrar — y escribir
el `1` es además lo que borra una cotización mentirosa que haya quedado
tipeada de antes.

La consecuencia para esta pantalla es grande: **una venta cobrada en dólares
no lleva encima ningún tipo de cambio**, así que no existe forma de expresar
su mercadería en pesos sin inventar un número. Eso descarta de entrada
cualquier diseño que mezcle las dos monedas en un mismo anillo, en una misma
barra o en un mismo porcentaje.

No es una limitación nueva: es la misma regla que este proyecto ya escribió
dos veces —"fuera de una venta no hay conversión ni número inventado"— vista
desde el único lugar donde todavía no se había aplicado.

---

## Lo que se decidió, y contra qué alternativa

### 1. El costo se congela en la venta, no se deriva después

`VentaItem` no guarda costo y `MovimientoStock.costoUnitario` sólo lo escribe
`ingresarStock` (`lib/inventario/stock.ts:143`): el movimiento que genera una
venta lo deja en `NULL`. O sea que hoy el margen del período **no se puede
calcular con lo que hay guardado**.

Se agregan columnas aditivas y `crearVenta` copia el último costo conocido de
cada artículo al cobrar, congelándolo — la misma decisión que `VentaItem` ya
toma con `descripcion` y `precioUnitario`, y por el mismo motivo: un costo
que se actualiza mañana no puede cambiar lo que una venta de hoy dice que
costó.

**La alternativa descartada** era derivar el margen al vuelo, buscando por
cada artículo vendido su ingreso con costo más reciente — lo mismo que hace
el tile "Último costo" de `/inventario/[id]`. Es más barata (ninguna
migración) y funciona sobre los datos históricos desde el primer día, pero
produce un número sobre plata **que se mueve hacia atrás**: el margen de
marzo cambia solo cuando alguien corrige un costo hoy, sin que nadie haya
tocado la venta de marzo. Es exactamente la clase de número que este
proyecto ya rechazó cuando eligió congelar el recargo en `Pago.recargo`
teniendo la FK al plan.

**Y es barato AHORA**, que es la otra mitad del argumento: todavía no hay
tenants reales. Es el mismo razonamiento con el que se cerraron
`Venta.claveIdempotencia` y `MovimientoStock.costoUnitario`, los dos con la
tabla vacía.

**El costo aceptado**: las ventas ya cargadas quedan sin costo y el tile lo
dice, en vez de mostrar un margen que no puede sostener.

### 2. Nada se convierte, en ninguna parte de la pantalla

Los **tiles** muestran las dos monedas a la vez, cada una su renglón — el
tratamiento que `lineasDeImporte` ya define y que `/ventas` usa desde el ciclo
del cobrado por moneda.

Los **paneles** miden en una sola moneda, elegida por un selector `$ / US$`
que aparece **únicamente cuando el período tuvo mercadería en las dos**. Un
anillo reparte 100 % entre sus gajos y una barra se mide contra la de al
lado: las dos cosas necesitan una unidad común adentro del panel, y la única
que existe sin inventar nada es "una moneda por vez".

**Las alternativas descartadas** fueron duplicar cada panel (la pantalla pasa
de cuatro paneles a siete, y el teléfono ya es una columna larga) y componer
sólo la mercadería en pesos con el dólar dicho al pie (deja los cuatro
paneles vacíos justo para el local que carga todo su catálogo en dólares, que
es el que pidió esa feature).

El selector es UI que la maqueta no dibuja — el frame es posterior al ciclo
del precio en dólares pero no contempla el caso. Va anotado en
`docs/correcciones-pendientes-del-pen.md`.

### 3. "Ventas por día" es una ventana fija de catorce días

No responde al chip de rango. El único texto de la maqueta sobre ese panel es
la nota "últimos 14 días" del frame móvil (`ZDHsA`), y con el rango en su
default (Hoy) un panel que siguiera al filtro sería **una sola barra**, que no
es una tendencia. Hay precedente: las seis barras de meses de "Cómo se movió"
en `/inventario/[id]` tampoco responden a ningún filtro.

**Consecuencia sobre el copy**: el pie de escritorio dice hoy "el mejor día
**del mes**" (`TZqEL`), y sobre una ventana de catorce días eso sería falso.
Pasa a decir "de los últimos 14 días", y los dos frames quedan con la misma
frase. Anotado como divergencia con la maqueta.

### 4. El período anterior es el tramo homólogo, no la ventana previa

`Hoy` compara contra ayer; `7 días`, contra los siete anteriores; `Este mes`,
contra **del 1 al mismo día del mes pasado**; `Este año`, contra del 1 de
enero al mismo día del año pasado.

**La alternativa descartada** era la ventana inmediatamente anterior del mismo
largo, que para "Este mes" un día 12 daría del 20 al 31 del mes pasado — y el
rótulo que la maqueta dibuja ("Comparado con julio") sería mentira. El tramo
homólogo es el único que hace cierto ese rótulo a mitad de mes.

### 5. Sin rango libre: sólo los cuatro chips

La maqueta no dibuja campos de fecha en esta pantalla, y `/ventas` ya es donde
vive el rango tipeado a mano. `Este año` es el cuarto chip y **es nuevo**:
`/ventas` sigue con sus tres, porque su propio frame no cambió.

### 6. Ningún permiso nuevo; el margen exige `COSTOS`

La pantalla la ve cualquier sesión, igual que `/ventas`. El **tile de Margen
bruto no se dibuja sin el permiso `COSTOS`** — es el mismo dato que ese
permiso ya protege en `/inventario`, y esconderlo en una pantalla mientras se
muestra en otra sería no protegerlo. El catálogo de `lib/permisos/catalogo.ts`
**no crece en este ciclo**: elegir el rango de un dashboard no mueve nada, y
el único dato sensible que la pantalla suma ya tiene su permiso.

---

## Pieza 0 — "Cómo entró la plata" deja de convertir

**Es un arreglo, no una feature, y no es de este ciclo**: el panel ya está en
producción en `/ventas`.

`componerPorMedio` (`lib/ventas/composicion.ts:67`) calcula el largo de cada
barra con `total = ars + usd`, donde `usd` sale de `pesosEntregados`, que
multiplica todo pago en dólares por su cotización. Con el hallazgo de más
arriba, un pago de **US$ 300 en efectivo sobre un total en dólares lleva
cotización 1**, así que aporta **300** a la barra en vez de los ~445.500 que
representa.

**Los importes que se muestran están bien** — `grafico.tsx` dibuja `b.ars` y
`b.usdCrudo`, los dos crudos. Lo que está mal es **el largo de la barra y el
"N % del total"**. Para un local que cobra en dólares en efectivo, todas sus
barras quedan cerca de cero y los porcentajes dejan de significar nada.

**El arreglo**: la pila la elige `Pago.moneda` y el importe es `Pago.monto`
tal cual. Ninguna cotización entra en la cuenta, en ninguna de las cuatro
combinaciones. Es además la definición correcta de lo que el panel promete —
"cómo entró la plata" es qué se entregó físicamente, y lo que se entregó no
necesita ninguna conversión para nombrarse.

`componerPorMedio` pasa a devolver una composición **por moneda**
(`{ ars: Composicion; usd: Composicion; hayDolares: boolean }`) y el panel
recibe la que corresponda al selector. Los importes visibles no cambian;
cambian los largos y los porcentajes.

Con esto queda cerrada la costura que `CLAUDE.md` dejó abierta el 2026-08-31:
*"Cómo entró la plata sigue convirtiendo los dólares a pesos, porque sus
barras necesitan una unidad común... cerrar eso significaría decidir si dejan
de serlo — no es parte de ningún ciclo todavía"*. Este ciclo es esa decisión,
y la respuesta es que dejan de serlo.

`pesosEntregados` **no se toca**: sigue siendo correcta para lo que existe
(leer cuántos pesos entregó un pago que sí cruzó monedas) y la usa
`app/(app)/ventas/[id]/page.tsx`. Lo que cambia es que la composición por
medio deja de ser uno de sus llamadores.

---

## Pieza 1 — El costo, congelado en la venta

### La migración (aditiva, tres columnas, cero `DROP`)

```prisma
model VentaItem {
  // El último costo conocido del artículo AL MOMENTO DE COBRAR, en pesos.
  // NULL cuando el artículo no tenía ningún ingreso con costo cargado, y
  // NULL siempre para un ítem en dólares (el costo se guarda en pesos).
  costoUnitario Decimal? @map("costo_unitario") @db.Decimal(12, 2)
}

model Venta {
  // Caché de la suma de los ítems que SÍ tenían costo. Mismo criterio que
  // Venta.recargo frente a Pago.recargo, y que Articulo.stock frente a sus
  // movimientos: la fuente de verdad son los ítems, esto evita traerlos.
  costoArs        Decimal @default(0) @map("costo_ars")         @db.Decimal(12, 2)
  // La mercadería en pesos DE ESOS MISMOS ítems, a precio de lista.
  vendidoConCosto Decimal @default(0) @map("vendido_con_costo") @db.Decimal(12, 2)
}
```

**Por qué dos columnas en `Venta` y no una.** El margen del período es
`Σ vendidoConCosto − Σ costoArs`, y el porcentaje es esa diferencia sobre
`Σ vendidoConCosto`. Las dos suman **exactamente los mismos ítems**, así que
el porcentaje nunca puede mezclar mercadería con costo conocido contra
mercadería sin él. Con una sola columna habría que dividir contra
`Venta.total`, que incluye lo que no tiene costo cargado, y el margen saldría
subestimado sin que nada lo dijera.

Las dos son `_sum` de un `aggregate`, así que el tile no trae ni una fila de
`VentaItem`.

**Por qué `default 0` y no nullable.** Toda venta anterior al ciclo queda en
`0 / 0`, y el tile lee eso como "no hay mercadería con costo cargado" y lo
dice. Un `NULL` habría exigido distinguir "no se sabe" de "se sabe que es
cero" en cada `_sum`, para contestar lo mismo.

### El escritor

`crearVenta` (`lib/ventas/crear.ts`), adentro de la transacción que ya tiene:
por cada ítem en pesos busca el `MovimientoStock` de motivo `INGRESO` más
reciente **con `costoUnitario` no nulo** de ese artículo — el mismo criterio
que ya usa el tile "Último costo" de `/inventario/[id]`, que busca el ingreso
con costo cargado más reciente y no el ingreso más reciente a secas.

Los ítems en dólares quedan en `NULL` y **no suman a ninguna de las dos
columnas** de `Venta`.

### El expand/contract

Las tres columnas son aditivas, con default, y sus defaults reproducen
exactamente lo que el código anterior asumía (que no hay costo). La imagen
anterior lee cualquier fila que esta migración produzca sin enterarse de que
las columnas existen, y no hay nada que revertir en la otra dirección: **el
margen no existe hasta que se cobra la primera venta con esta imagen**.

Es el mismo caso que el ciclo del precio en dólares dejó escrito: lo que
expand/contract exige no es "la migración en un deploy aparte" sino que el
schema nuevo soporte la versión anterior del código. Migración y UI viajan en
el mismo deploy.

---

## Pieza 2 — El rango, la comparación y el selector de moneda

Tres parámetros en la URL, server-only y sin JavaScript, como los chips de
`/ventas` y el `?vista` del panel de horarios:

| Parámetro | Valores | Default |
|---|---|---|
| `?rango` | `hoy` · `7dias` · `estemes` · `esteanio` | `estemes` |
| `?moneda` | `ars` · `usd` | `ars` |

El default es `estemes` y no `hoy`: es el que la maqueta dibuja activo, y es
el único con el que los cuatro paneles tienen algo que mostrar la primera vez
que alguien entra.

`lib/dashboard/rango.ts` (nuevo) exporta `RANGOS`, `ROTULO_RANGO`,
`periodoDeRango(rango, hoy)` y `periodoAnterior(rango, hoy)`, más
`rotuloDeComparacion(rango, hoy)` — el texto del chip
`git-compare-arrows` ("Comparado con julio", "Comparado con ayer", …).

**No reusa `rangoDeChip` de `/ventas`**, y es a propósito: ese archivo no
conoce `esteanio` ni el período anterior, y sumárselos le agregaría dos
conceptos que su pantalla no usa. Lo que sí se comparte son las primitivas de
huso (`hoyEnArgentina`, `inicioDelDia`, `sumarDias`), que se extraen de
`app/(app)/ventas/page.tsx` a `lib/formato/fechas.ts` — hoy son funciones
privadas de una página, y este ciclo es el segundo consumidor.

---

## Pieza 3 — Los cuatro tiles

Cada uno con su **delta** contra el período anterior: un chip redondeado con
`trending-up` sobre `--ok`/`--ok-soft` o `trending-down` sobre
`--destructive`/`--destructive-soft`, y el porcentaje con el signo.

**El chip del tile de marca no puede usar esos tokens**: sobre el paño violeta
el `--ok-soft` (un verde casi blanco) desaparece y el `--ok` (un verde oscuro)
no contrasta. La maqueta lo resuelve con un fondo `#FFFFFF1F` —blanco al 12 %,
o sea el propio paño aclarado— y texto `#C9F2DF`, un verde claro que el `.pen`
escribe literal sin nombrarlo. Se promueve a **`--marca-ok`**, con el mismo
tratamiento que ya tienen `--marca-soft` y `--marca-dim`: anotado en
`SOLO_EN_CSS` de `test/maqueta.test.ts` y documentado en
`docs/sistema-de-diseno.md`.

**Y no hay `--marca-danger`**, aunque el chip a la baja sobre el paño violeta
sea posible: la maqueta no dibuja ese estado y no hay de dónde copiarlo. Se
resuelve con el mismo `#FFFFFF1F` y `--marca-foreground`, o sea el mismo chip
sin color de signo, y queda anotado en
`docs/correcciones-pendientes-del-pen.md` como derivado sin frame. Inventar un
rojo claro para ese paño sería decidir un color escribiendo código, que es
exactamente lo que `SOLO_EN_CSS` existe para no dejar pasar en silencio.

| Tile | Valor | Pie |
|---|---|---|
| **Total del período** (paño `--marca`) | Lo **cobrado en pesos** | `US$ 4.120 aparte` |
| **Ventas cobradas** | El conteo de ventas no anuladas | `vs. 286 en julio` |
| **Ticket promedio** | Cobrado en pesos ÷ cobradas | `mediana $ 19.400` |
| **Margen bruto** | `Σ vendidoConCosto − Σ costoArs` | `28,5% sobre la venta` |

**El total es lo COBRADO, no lo vendido**, y sale de la maqueta misma: el
centro del anillo dice "$ 8,41 M / cobrado" y el subtítulo del Topbar móvil
dice "312 ventas cobradas". Se calcula con `pagosDelPeriodo` +
`cobradoDeGrupos`, exportadas de `app/(app)/ventas/page.tsx` — la misma
función, para que los dos tiles de las dos pantallas no se puedan separar.

**Las dos monedas conviven en el tile, pero NO con `formatearTotales`.** Esa
función une las dos pilas con un `+` (`"$ 8.412.900 + US$ 4.120"`), que es lo
correcto en una celda de tabla y es ilegible a 30 px. La maqueta resuelve el
mismo problema de otra forma —el peso grande y el dólar al pie, en 11 px sobre
`--marca-dim`— y manda la maqueta. Los otros tres tiles no tienen pie libre,
así que:

- **Ventas cobradas** es un conteo: no tiene moneda.
- **Ticket promedio** es **sólo en pesos**, con la guarda que `pieDeCobradas`
  ya implementa (se omite cuando lo cobrado en pesos es cero y el período sí
  cobró dólares). No se agrega una línea en dólares, y el motivo ya está
  escrito en el docblock de esa función: el promedio en dólares dividiría por
  un denominador que incluye las ventas que no movieron un solo dólar.
- **Margen bruto** es sólo en pesos por construcción — el costo se guarda en
  pesos.

**El caso invertido, que es el del único local que hoy usa esto**: cuando el
período cobró **cero pesos** y sí cobró dólares, el tile de marca muestra los
dólares como número grande y omite el pie. Sin esta regla, un local que carga
y cobra todo su catálogo en dólares abriría el dashboard con "$ 0,00" de
titular. Es el mismo criterio que `pieDeCobradas` ya aplica un tile más allá.

**El delta va siempre sobre el número grande** del tile, sea la pila que sea.
**El selector de moneda no toca ningún tile**: gobierna los cuatro paneles y
nada más.

**El delta cuando el período anterior es cero** no se dibuja: no hay
porcentaje de crecimiento contra nada, y "+∞ %" o "+100 %" son las dos
maneras de inventarlo. El chip desaparece y el pie dice "sin ventas en
julio".

**La mediana no trae el período entero.** Se resuelve con `count` y después
un `findMany` con `orderBy: { total: 'asc' }`, `skip: ⌊(n−1)/2⌋` y `take: 1`
o `2` según la paridad: Postgres ordena, pero cruzan una o dos filas. Es lo
que evita que "Este año" traiga decenas de miles de `Decimal` para calcular
un solo número — la preocupación que `CLAUDE.md` ya dejó anotada para el
panel de horarios.

**El margen sin datos** (`Σ vendidoConCosto = 0`) muestra una raya y el pie
dice "ninguna venta del período tiene el costo cargado", que es distinto de
un margen de cero. Es el mismo criterio que `textoDeMargen` en
`/inventario/[id]`: nunca un número inventado, y nunca una raya que no
explique cuál de los dos casos es.

---

## Pieza 4 — Los cuatro paneles

**Ventas por día** (`lib/dashboard/tendencia.ts`). Catorce barras, una por
día, altura por importe en la moneda del selector; la más alta se pinta con
`--primary` y el resto con `--accent`, con la leyenda "día común / mejor día"
que la maqueta dibuja. El pie nombra el mejor día con su importe y su
cantidad de ventas. La consulta trae `{ creadoEn, total, totalUsd }` de los
catorce días — acotada por definición, sin el techo abierto que tiene el
panel de horarios.

**Cómo entró la plata**. `componerPorMedio` ya arreglada (Pieza 0), y el
`GraficoDeMedios` de `/ventas` se muda a `components/` para que las dos
pantallas usen el mismo componente. Es la regla que el merge del ciclo móvil
dejó escrita: una sola fuente, no dos copias que haya que acordarse de
sincronizar.

**Ventas por categoría** (`lib/dashboard/categorias.ts`). Anillo de cinco
gajos: las cuatro ramas raíz con más importe más "Otros". El agrupamiento es
`VentaItem.groupBy(['articuloId', 'precioUnitario', 'moneda'])` con
`_sum: { cantidad }` — el precio va en la **clave** y no en un `_sum`, por lo
mismo que ya documenta `FilaDePagos`: es lo que mantiene el redondeo por
grupo y hace que la suma cierre contra los tiles. La cantidad de grupos está
acotada por el catálogo, no por el volumen de ventas.

De ahí se resuelve `articuloId → categoría raíz` con una consulta a
`Articulo` + `Categoria`. Un artículo colgado de una hoja suma a su raíz
—que es como el panel de `/inventario` ya cuenta— y uno sin categoría cae en
"Otros".

**Lo que más se vendió**. El mismo `groupBy`, otro corte: los cinco artículos
con más importe, cada uno con su barra proporcional al primero, sus unidades
y su importe. El primero se pinta con `--primary` y el resto con
`--marca-soft`, como dibuja la maqueta. El link "Ver inventario →" va a
`/inventario`.

### Los anillos

`components/anillo.tsx`, nuevo. Es un `<svg>` con un arco por gajo
(`stroke-dasharray` sobre un círculo), **sin librería** — es la misma decisión
que ya sacó `recharts` del repo entero en el ciclo del rediseño de
`/inventario`, y un anillo de cinco gajos no la justifica de vuelta.

Los cinco colores salen literales de la maqueta (`#2A1760`, `#4A2AA5`,
`#7C5FD6`, `#B6A6E8`, `#DCD3F2`): son `--marca` y `--primary` más tres
escalones intermedios que el `.pen` escribe a mano sin nombrarlos con ninguna
variable `$ar-*`. **Se promueven a tokens** (`--marca-2`, `--marca-3`,
`--marca-4`) y se anotan en `SOLO_EN_CSS` de `test/maqueta.test.ts` con esa
razón — el mismo tratamiento que ya tienen `--marca-soft` y `--marca-dim`,
que el propio test señala como "el candidato número uno a promoverse".
También hay que documentarlos en `docs/sistema-de-diseno.md`, que
`test/sistema-de-diseno.test.ts` compara en las dos direcciones.

El porcentaje de cada gajo pasa por `porcentajesQueSuman100`
(`app/(app)/ventas/grafico.tsx`), que ya existe y ya garantiza que la suma dé
exactamente 100 por el método del resto mayor. Se mueve a `lib/` junto con el
componente.

---

## Pieza 5 — La ruta y la navegación

`app/(app)/dashboard/page.tsx`. Entrada nueva en `PESTANAS`
(`components/navegacion.tsx`), **tercera**, entre Ventas e Inventario, con el
ícono `layout-dashboard` — la posición y el ícono salen del `Shell/Sidebar` de
la maqueta.

**El ítem `/bot` se queda donde está.** La maqueta no lo dibuja porque su
`Shell/Sidebar` es anterior al ciclo del bot, y el silencio de un frame no es
una instrucción de borrar — es la misma regla que ya salvó al typeahead de
`/vender`.

`/` sigue redirigiendo a `/vender` y este ciclo no lo cambia: el mostrador es
lo primero que se abre a la mañana, y mover la home es una decisión de
producto que nadie pidió.

---

## Pieza 6 — Exportar CSV

Una fila por venta del período: número, fecha, hora, cliente, medios, vendido
y cobrado por moneda, recargo y estado. Es el dato crudo detrás de los cuatro
paneles y lo que un dueño lleva al contador.

Mismo patrón que el CSV de `/inventario/[id]`: un server action arma el string
entero en memoria y lo devuelve, y el botón lo convierte en descarga con un
`Blob` del lado del cliente — un server action no puede fijar
`Content-Disposition`. Escapado por RFC 4180 y con BOM, como aquél.

**No exige permiso**: son datos de sólo lectura que la pantalla ya muestra a
cualquier sesión. **No incluye costo ni margen**, aunque quien lo baje tenga
`COSTOS`: un CSV es un archivo que sale del sistema y sigue circulando, y el
alcance de este ciclo es el dashboard, no un reporte de rentabilidad.

---

## El teléfono

El frame `Móvil / Dashboard` apila todo en una columna a 390 px, con el mismo
corte de 1024 y las mismas clases mobile-first que el resto del producto. Tres
diferencias con escritorio que el frame define y que no son derivadas:

- El segmentado de rango ocupa el ancho completo, con los cuatro chips en
  `flex-1`.
- El tile de marca va **solo**, arriba; los de Ventas y Ticket comparten
  fila; y el de Margen bruto cambia de eje — es una **fila**, con rótulo y
  valor a la izquierda y el chip de delta y el pie a la derecha (`XIEgM`),
  igual que el tile "En stock" de `/inventario/[id]` en el teléfono.
- El Topbar reemplaza los dos botones por la ranura de 38 px con el ícono
  `download` (`FW8AQ` sobrescribe `GZz1a`), o sea el CSV. **El botón "Vender"
  no reaparece en ningún lado y está bien**: el sidebar del drawer lo tiene, y
  la regla de la capacidad que desaparece pide que reaparezca en algún lado,
  no que se duplique.

`test/responsive.test.ts` cubre el modo de falla de siempre (un ancho fijo sin
`lg:` que desborde), y el panel de horarios no aplica acá.

---

## Cómo se verifica

**Unidad, sin base** (`lib/dashboard/*.test.ts`): `periodoDeRango` y
`periodoAnterior` para los cuatro chips, incluidos los bordes (el 1 del mes, el
1 de enero, y "este mes" un día 1, donde el período es un solo día); el delta
con período anterior en cero; `rotuloDeComparacion`; la agregación de las
catorce barras con días sin ventas en el medio; el reparto en cinco gajos con
"Otros"; y `componerPorMedio` con las cuatro combinaciones de
`(moneda, cubre)`.

**El caso que fija el arreglo de la Pieza 0**: un pago `USD/USD` de 300 con
cotización 1 no puede aportar 300 a la barra de pesos. Es el caso que hoy no
existe y que dejó pasar el defecto.

**Contra la base efímera** (`test/dashboard.test.ts`): que `crearVenta`
congele el costo del último ingreso con costo cargado y no el del ingreso más
reciente; que un ítem en dólares quede en `NULL` y no sume a ninguna de las
dos columnas; que una venta anulada no cuente en ningún tile ni en ningún
panel — la regla que el hallazgo I3 de la review del rediseño mostró que se
podía borrar dejando 785 tests en verde, y por eso las funciones que la
llevan van **exportadas**, no inline en el Server Component.

**Render** (`app/(app)/dashboard/page.test.tsx`): que el tile de margen no
aparezca sin `COSTOS` y sí con él; que el selector de moneda no se dibuje con
un período de una sola moneda; y que el botón del CSV esté en las **dos**
copias (Topbar de escritorio y ranura móvil) — el caso cuenta las dos
apariciones en las dos direcciones, como exige
`test/permisos-en-las-dos-copias.test.ts`.

**Barrido**: `scripts/smoke.sh` toma `/dashboard` solo, porque deriva las
rutas de `app/(app)/**/page.tsx`. `test/pantallas.test.ts` exige su sección en
`docs/pantallas.md`, que va en el mismo commit.

**A ojo**, que es lo que ningún test contesta: a 1440 y a 390 px, con el
catálogo sembrado y con ventas en las dos monedas, mirar que los cuatro tiles
con dos renglones no queden apretados en el teléfono, que el anillo se lea, y
que el selector de moneda no aparezca en un local que no usa dólares.

---

## Lo que este ciclo NO hace

- **No toca `/vender`.** El cobro ya guarda todo lo que hace falta; lo único
  que se agrega es el costo, que el mostrador no ve ni tipea.
- **No agrega el rango libre** a `/dashboard` ni el chip "Este año" a
  `/ventas`.
- **No arregla `Tenant.cotizacionUsd`**, que sigue sin escritor. Este ciclo
  justamente demuestra por qué no alcanzaría: una cotización del local de hoy
  no puede valuar una venta de marzo.
- **No convierte nada, en ningún panel.** La costura entre el tile y los
  paneles, que `CLAUDE.md` viene angostando desde el 2026-08-30, queda
  **cerrada**: ahora ninguno de los dos convierte.
- **No incluye el margen en el CSV.**

---

## Lo que sigue

- **La deuda del costo**, que este ciclo toca pero no cierra. Sigue sin haber
  forma de cargar el costo de un artículo sin además sumarle stock
  (`ingresarStock` exige `cantidad > 0`), sigue perdiéndose en silencio el
  costo tipeado en el alta cuando no se carga stock inicial
  (`lib/inventario/articulos.ts:298`, adentro del `if (stockInicial > 0)`), y
  sigue abierto el choque de modelos mentales que `CLAUDE.md` describe: el
  costo como atributo del evento de recepción contra el costo como atributo
  del producto. Lo que este ciclo agrega es el **segundo lector** de ese dato,
  que es lo que hace que la deuda empiece a doler y por lo tanto a valer la
  pena.
- **El costo en dólares**, que le devolvería el margen a los artículos
  cargados en esa moneda — hoy quedan afuera del tile, igual que quedan
  afuera del tile "Último costo" de `/inventario/[id]`.
- **El backfill del costo** de las ventas ya cobradas, si alguna vez importa.
  Hoy no: no hay tenants reales.
- **Comparar contra un período elegido a mano**, en vez del homólogo.
- **Guardar `design/arandano.pen`**. El archivo del repo sigue siendo el
  commit `87973d4` del 2026-08-21: los dos frames de este ciclo viven
  únicamente en el documento abierto en Pencil, que el MCP lee pero no
  persiste. Lo tiene que hacer una persona, y hasta que pase, el próximo ciclo
  no ve este diseño.
