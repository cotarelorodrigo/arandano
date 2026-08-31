# Spec: lo vendido y lo cobrado, cada moneda por separado

**Fecha**: 2026-08-31

**Origen**: feedback de un cliente sobre una venta real. Con un artículo de
precio en dólares, el mostrador puede cobrar una parte en billetes y el resto en
pesos —lo que el ciclo del precio en dólares (2026-08-29) construyó a
propósito—, pero `/ventas` después muestra esa venta como si hubiera entrado
entera en dólares:

> *"si el producto cuesta trescientos dólares, la venta puede ser con un pago de
> doscientos dólares y el resto un pago en pesos usando la cotización. El
> problema es que cuando cargo esta venta, en ventas aparece como una venta de
> trescientos dólares, y tendría que aparecer como una venta de doscientos
> dólares más la parte en pesos."*

Es la **costura que este proyecto ya tenía anotada como abierta**. El comentario
del `groupBy` de pagos en `app/(app)/ventas/page.tsx` la describe con nombre y
apellido y termina diciendo: *"si algún día el tile tiene que mostrar los pesos
entregados, es una decisión de producto y su propio ciclo"*. Éste es ese ciclo.
El párrafo equivalente de `CLAUDE.md` ("Lo que este ciclo no cierra", en la
entrada del 2026-08-30) queda desactualizado por éste y se corrige.

## El punto de partida: la venta ya se guarda bien

Conviene decirlo antes que nada, porque acota el ciclo entero: **no falta ningún
dato y no hace falta ninguna migración**. Con el caso del feedback —un iPhone de
lista US$ 300, US$ 200 en billetes y el resto en pesos a 1485— la base tiene:

| Fila | Campos |
|---|---|
| `Venta` | `total = 0`, `totalUsd = 300`, `recargo = 0` |
| `Pago` #1 | `moneda = USD`, `cubre = USD`, `monto = 200` |
| `Pago` #2 | `moneda = ARS`, `cubre = USD`, `monto = 148.500`, `cotizacion = 1485` |

O sea que "US$ 200 + $ 148.500" ya está escrito, completo y exacto. Lo que falla
es qué de todo eso lee la pantalla: la columna Total y el tile del período leen
`Venta.total` / `Venta.totalUsd`, que son **la mercadería a precio de lista**, y
la mercadería es US$ 300 se pague como se pague.

**Y hoy la columna es híbrida sin decirlo.** Del lado de los pesos muestra
`total + recargo` (o sea lo COBRADO); del lado de los dólares muestra `totalUsd`
(o sea la MERCADERÍA). Dos criterios distintos en la misma celda, separados por
un `+`. Que nadie lo haya notado antes es porque hasta el ciclo del precio en
dólares las dos cosas coincidían siempre.

## Lo que se decidió, y contra qué alternativa

**1. Se muestran las DOS magnitudes, no una.** La alternativa era reemplazar: que
la columna y el tile pasaran a mostrar sólo lo cobrado y la mercadería quedara
únicamente en el detalle. Se descartó porque las dos preguntas son legítimas y un
listado de ventas las contesta las dos —cuánto se vendió y cuánta plata entró—, y
porque con planes de pago de por medio la diferencia entre ambas es justamente el
dato que el dueño quiere ver.

**2. Las dos líneas aparecen sólo cuando difieren.** La alternativa era
mostrarlas siempre, rotuladas, para que la fila tenga siempre la misma forma. Se
descartó por el principio que el ciclo del precio en dólares dejó escrito: un
local que no usa nada de esto no puede ver ninguna diferencia. Una venta en pesos
sin plan sigue siendo un solo número. **El costo aceptado**: un local **con**
planes de pago sí ve un cambio —esas ventas hoy muestran sólo lo cobrado y pasan
a mostrar las dos líneas—, y es correcto que lo vea, porque ahí las dos
magnitudes efectivamente son distintas y hoy la pantalla mostraba una sola sin
avisar cuál.

**3. El número sale de `Pago`, no de columnas nuevas en `Venta`.** La alternativa
era cachear `Venta.cobradoArs` / `cobradoUsd`, siguiendo el precedente de
`Venta.recargo`. Se descartó por dos razones. La primera es que ese caché existe
**para evitar el join de pagos**, y acá el join ya está: el listado trae los pagos
de cada fila desde el ciclo de precios por forma de pago, para la celda "Medios".
La segunda es que la migración **no sería inerte**: un `default 0` dejaría a toda
venta ya grabada afirmando que no cobró nada, así que exigiría un backfill masivo
sobre datos de clientes, con RLS de por medio, a cambio de ahorrar una consulta
en una pantalla que ya dispara siete en paralelo. Sin columnas nuevas, este ciclo
**no lleva migración**: se revierte entero revirtiendo la imagen.

**4. Nada se convierte.** Sigue rigiendo la regla del ciclo del precio en
dólares: cada moneda dice su propio número y ninguna se pasa por la cotización de
la otra. "Cobrado" no es un número, son dos.

**5. `/vender` no se toca.** El cobro ya funciona: reparte los pagos entre los dos
totales, valida que cierren y guarda todo lo necesario. El defecto es de lectura,
no de captura.

## Pieza 1 — Las dos magnitudes, en `lib/ventas/cobrado.ts`

Un archivo nuevo, con la aritmética que las tres pantallas comparten. Vive en
`lib/` y no en la página por la razón que el docblock de `totalCobrado` ya dejaba
escrita: es lo único que impide que el tile de arriba y el listado de abajo
desacuerden sobre qué es "lo cobrado".

```ts
/** La mercadería a precio de lista, partida por moneda. */
export function vendidoDeVenta(v: { total: Decimal; totalUsd: Decimal }): Totales

/** La plata que entró, apilada por la moneda en que se ENTREGÓ. */
export function cobradoDePagos(pagos: { moneda: Moneda; monto: Decimal }[]): Totales

/** La misma cuenta sobre filas de `groupBy` con `_count`, para los agregados
 *  del período: multiplica por la cantidad en vez de recorrer fila por fila. */
export function cobradoDeGrupos(grupos: { moneda: Moneda; monto: Decimal; _count: number }[]): Totales

/** Si dos magnitudes coinciden en las dos monedas. */
export function mismosTotales(a: Totales, b: Totales): boolean

/** LA regla de las tres pantallas: si hay que desglosar en dos líneas. */
export function hayQueDesglosar(
  vendido: Totales, cobrado: Totales, recargo: Decimal,
): boolean

/** "$ 148.500,00 + US$ 200,00". Pesos primero, y se OMITE el lado en cero. */
export function formatearTotales(t: Totales): string
```

`Totales` es el tipo que ya existe en `lib/ventas/totales.ts` (`{ ars, usd }`), no
uno nuevo.

**Tres precisiones que hacen que esto cierre, y que son fáciles de implementar
mal:**

- **`Cobrado` incluye el recargo sin esfuerzo.** `Pago.monto` ya es
  `base + recargo` (lo fija `lib/ventas/crear.ts`), así que no hay que sumarle
  nada aparte. Sumar `Venta.recargo` encima sería contarlo dos veces.
- **Se apila por `Pago.moneda`, NUNCA por `Pago.cubre`.** Es toda la diferencia
  del ciclo. El pago de $148.500 tiene `cubre = USD` —paga mercadería en
  dólares— pero `moneda = ARS`, porque lo que entró al cajón fueron pesos.
  Apilar por `cubre` reproduce exactamente el bug que estamos arreglando.
- **`monto` se lee crudo, sin pasar por `pesosEntregados` ni por
  `montoEnPesos`.** Las dos convierten, y acá no se convierte nada: el monto ya
  está en la moneda de su pila.

**`hayQueDesglosar` mira el recargo ADEMÁS de comparar las dos magnitudes**, y
esa segunda mitad parece redundante pero no lo es del todo. Sin dólares de por
medio sí lo es —`cobrado.ars = total + recargo`, así que un recargo distinto de
cero garantiza que difieran—, pero en una venta mixta las dos pilas se arman por
caminos distintos y no hay ninguna demostración de que un recargo no pueda quedar
compensado y las magnitudes coincidan igual. Un desglose de más no le hace daño a
nadie; un recargo que se vuelve invisible por una cancelación aritmética, sí. La
regla vive en una función, y no repetida en tres pantallas, por lo mismo que
vive acá la aritmética.

**El invariante que sostiene la decisión 2, y que hay que probar y no razonar:**
sin dólares de por medio, `Σ Pago.monto` es **exactamente** `total + recargo`.
Sale de que `Σ base = total` (lo garantiza el motor al validar la venta) y de que
`monto = base + recargo` por pago. Ése es el motivo por el que un local que vende
en pesos sin planes no ve absolutamente ninguna diferencia: las dos magnitudes le
coinciden siempre, y siempre cae a una sola línea.

**El formato**, común a las tres pantallas: pesos primero, dólares después,
unidos por `" + "`, **omitiendo el lado que está en cero**. La omisión es nueva y
limpia el caso más común: `$ 0,00 + US$ 300,00` pasa a ser `US$ 300,00`. Con los
dos lados en cero —que no puede pasar en una venta real, porque toda venta tiene
mercadería y todo pago tiene monto— devuelve `$ 0,00` en vez de un string vacío.

## Pieza 2 — La columna Total del listado

Una línea o dos, según `hayQueDesglosar`:

```
#12   Vendido  US$ 300,00                 #13   $ 50.000,00
      Cobrado  $ 148.500,00 + US$ 200,00        (sin desglose: una sola línea)
```

Sale de agregar `monto: true` al `select` de `pagos` que la fila **ya trae** para
la celda "Medios" (hoy pide `medio` y `moneda`). **Cero consultas nuevas en el
listado.**

`totalesFormateados` deja de existir con esa forma: pasa a devolver o un string
—una línea, el caso de siempre— o el par rotulado. La celda vive dentro del grid
con `lg:contents` del ciclo del teléfono, así que las dos líneas van apiladas
dentro de la misma celda y no como dos filas del grid, que descuadraría la tabla.

## Pieza 3 — El tile "Total del período" y los dos pies

**El tile.** Hoy `Tile` recibe `valor` + `valorUsd`: dos líneas sin rótulo, una
por moneda. Pasa a recibir `lineas: { rotulo?: string; valor: string }[]`:

- Sin desglose, **una línea sin rótulo** — el tile de hoy, sin ningún cambio
  visible para un local que no usa planes ni dólares.
- Con desglose, **dos líneas rotuladas** "Vendido" y "Cobrado".

Es la misma `hayQueDesglosar` del listado, aplicada a los agregados del período
en vez de a una venta.

Las dos al **mismo tamaño**, apoyándose en la regla que ese componente ya tiene
escrita para las monedas —*"ninguna pesa más que la otra en esta pantalla, así
que ninguna se dibuja más chica"*—: tampoco pesa más lo vendido que lo cobrado.

**De dónde sale el número.** El cobrado de las no anuladas se deriva de la
**misma `groupBy` de pagos que ya alimenta "Cómo entró la plata"**: esas filas
son, exactamente, los pagos del período de las ventas no anuladas, y
`cobradoDeGrupos` es una función pura sobre un array que ya está en memoria.
Conserva el redondeo por pago, que es la razón por la que ese `groupBy` lleva
`monto` en la clave y `_count` en vez de un `_sum` (con `_sum` el panel y el tile
se separaban por centavos).

**La única consulta nueva de todo el ciclo** es su espejo sobre las anuladas
—`groupBy` por `moneda`/`monto` con `where: { venta: { ...donde, anuladaEn: { not: null } } }`—,
que hoy no existe y la necesita el pie de "devuelto". La asimetría es deliberada:
del lado de las no anuladas ya hay una fuente y agregar una segunda sería crear
dos que puedan desacordar.

**Los dos pies chicos** pasan a calcular sobre **cobrado en pesos** en vez de
`total + recargo`:

- `pieDeCobradas` (el promedio por venta cobrada) y `pieDeAnuladas`
  (`"$ X devueltos"`) conservan intacta su regla de omisión —no afirmar un
  `$ 0,00` cuando el período movió dólares—, pero el flag que la dispara pasa a
  ser *"se cobró algo en dólares"* (`cobrado.usd !== 0`) en vez de *"se vendió
  algo en dólares"*. Es la pregunta correcta: lo que el pie podría estar
  afirmando en falso es sobre plata que entró.
- **Eso arregla el caso del feedback de paso**: hoy el promedio por venta **se
  omite** en ese período (porque `total + recargo` da 0 y hay dólares), y con el
  cambio dice `promedio $ 148.500`. La regla de omisión sobrevive; se dispara
  mucho menos, que es lo que corresponde.

## Pieza 4 — El pie de `/ventas/[id]`

`lineasDeRecargo` pasa a recibir los pagos y a devolver `Vendido / Recargo /
Cobrado`, con dólares donde corresponda. El caso canónico del proyecto —el iPhone
de US$ 300 cobrado en pesos con un plan de 12 cuotas al 40 %— queda legible por
primera vez:

```
hoy                                    propuesta
  Mercadería          $      0,00        Vendido   US$    300,00
  Recargo             $ 178.200,00       Recargo   $  178.200,00
  Cobrado             $ 178.200,00       Cobrado   $  623.700,00
  Total en dólares    US$   300,00
```

Y cae al renglón único "Total" cuando `hayQueDesglosar` dice que no. Eso amplía el caso simple respecto de hoy: una venta en dólares pagada
en dólares pasa de dos renglones (`Total $ 0,00` + `Total en dólares US$ 300,00`)
a uno solo, `Total US$ 300,00`. El renglón único tiene entonces que poder
formatear dólares, cosa que hoy no hace —recibe `formatearPrecio(venta.total)`, en
pesos y a secas—, así que pasa a recibir `formatearTotales(vendido)`.

**`"Mercadería"` se renombra a `"Vendido"`.** Hoy el listado no rotula, el detalle
dice "Mercadería" y el tile diría "Vendido": tres pantallas y dos palabras para lo
mismo. Queda una. El desglose sigue leyéndose como cualquier comprobante —lo que
se vendió, lo que se le suma o resta, el resultado—, y la gramática del recargo no
cambia: la palabra sigue saliendo del signo ("Recargo" si suma, "Descuento" si
resta) y bajo "Descuento" el importe sigue yendo sin el signo.

## Pieza 5 — La poda de `totalCobrado()`

Se queda **sin ningún llamador de producción**: hoy la usan exactamente las dos
pantallas de este ciclo (la columna, el tile, los dos pies y el pie del detalle),
y las cinco pasan a `cobradoDePagos` / `cobradoDeGrupos`.

Se **borra**, junto con su bloque de `lib/ventas/totales.test.ts`, en vez de
conservarse como "ancla de test" con el patrón de `totalDeItems` y
`totalDePagos`. La diferencia con esos dos es el motivo: ellos anclan aritmética
que sigue siendo cierta, y el docblock de `totalCobrado` son treinta líneas
explicando por qué devuelve un número que **parece** un bug con `totalUsd ≠ 0`.
Ese número es justamente el que este ciclo deja de mostrar, así que la explicación
se va con él. La advertencia queda igual archivada donde corresponde: en el
registro de este ciclo, en `CLAUDE.md`.

`totalDeItems` y `totalDePagos` **no se tocan**: siguen anclando el espejo de la
aritmética en enteros del navegador en `lib/ventas/centavos.test.ts`.

## Cómo se verifica

**`lib/ventas/cobrado.test.ts`** (nuevo) — la aritmética pura, con los cuatro
casos que decide la regla de una-o-dos-líneas:

| Caso | Vendido | Cobrado | |
|---|---|---|---|
| Pesos, sin plan | `{50.000, 0}` | `{50.000, 0}` | coinciden → una línea |
| Pesos, plan 40 % | `{50.000, 0}` | `{70.000, 0}` | difieren → dos |
| US$ 300 pagado en dólares | `{0, 300}` | `{0, 300}` | coinciden → una |
| US$ 300 = US$ 200 + pesos | `{0, 300}` | `{148.500, 200}` | difieren → dos |

Más el **invariante** de la Pieza 1 —sin dólares, `Σ Pago.monto = total +
recargo`—, que hoy es un razonamiento y ningún test lo sostiene; más el formato,
incluida la omisión del lado en cero; más el caso que fija que se apila por
`moneda` y no por `cubre` (un pago `ARS`/`cubre USD` tiene que caer del lado de
los pesos).

**`app/(app)/ventas/page.test.tsx`** — la columna y el tile, en sus dos formas.
Hay que reescribir el caso de la línea 206, que hoy cablea
`formatearPrecio(totalCobrado(v).toString())` leyendo el fuente.

**`app/(app)/ventas/[id]/page.test.tsx`** — el pie: el caso canónico
(`Vendido US$ 300 / Recargo $ 178.200 / Cobrado $ 623.700`), el que colapsa al
renglón único en dólares, y el de pesos con recargo, que **no puede cambiar**
respecto de hoy salvo por la palabra "Vendido".

**`test/ventas.test.ts`**, contra la base efímera — dos casos que no se pueden
probar sin base:

1. Que el cobrado del período **no cuente las anuladas**. Es exactamente la regla
   que este repo ya descubrió que se podía romper sin que 785 tests se enteraran
   (hallazgo I3 de la review del rediseño), y ahora vive en dos agregados en vez
   de uno.
2. **El caso del feedback, de punta a punta**: crear la venta de US$ 300 con los
   dos pagos y afirmar `Vendido {0, 300}` / `Cobrado {148.500, 200}`. Es lo que
   ata el ciclo al pedido real y no a su interpretación.

**A ojo, y esto no lo reemplaza ningún test**: el tile pasa de una línea a dos
líneas rotuladas, y a 390 px puede quedar apretado. A diferencia de los últimos
cuatro ciclos —que quedaron sin confirmar porque `arandano-dev` bind-montea
`/root/arandano` y no el worktree—, acá sí se puede: el entorno local corre Next
nativo en `:3001` contra el Postgres de Docker. Hay que sembrar ventas con
importes de distinta cantidad de dígitos, por lo que ya dejó anotado la primera
verificación visual del proyecto: con montos parejos no se ve si las columnas
bailan.

## Lo que este ciclo NO hace

- **No toca "Cómo entró la plata".** Ese panel convierte los dólares a pesos
  para que una barra se pueda comparar con la de al lado, y desde el 2026-08-30
  además muestra el importe en dólares sin convertir en una segunda línea. La
  costura entre ese panel y el tile **se angosta pero no desaparece**: el tile
  ahora dice lo que entró en cada moneda sin convertir, y el panel sigue
  convirtiendo para poder ordenar los medios. Son dos preguntas distintas y sólo
  una necesita una unidad común.
- **No lleva migración**, y por lo tanto no toca `docs/schema.md` ni tiene nada
  de expand/contract que coordinar.
- **No toca `/vender`.** El cobro ya guarda todo lo necesario.
- **No cambia el significado de ninguna columna.** `Venta.total` sigue siendo la
  mercadería en pesos a precio de lista y `Venta.totalUsd` su mitad en dólares —
  a diferencia de los dos ciclos anteriores, que sí movieron el significado de
  `Articulo.precio` sin que ninguna migración lo anunciara.
- **No agrega ningún permiso.** Las dos pantallas son de lectura y ya las ve
  cualquier sesión.

## Lo que sigue

- **La costura con "Cómo entró la plata"**, si algún día molesta de verdad: hoy
  el tile no convierte y el panel sí, y cerrarla del todo significaría decidir si
  las barras dejan de ser comparables entre sí. No es este ciclo.
- **La maqueta no dibuja nada de esto** —ni la columna de dos líneas ni el tile
  con rótulos—, así que las dos formas se derivan sin frame. Queda anotado en
  `docs/correcciones-pendientes-del-pen.md` como entrada 26. Y sigue pendiente,
  de antes de este ciclo, que una persona guarde desde Pencil el `design/arandano.pen`
  vivo y lo commitee: el archivo versionado sigue siendo el del 2026-08-21.
