# Spec: precio del artículo en dólares

**Fecha**: 2026-08-29

**Origen**: feedback textual de un cliente — *"un producto del inventario
debería poder cargarlo con precio en usd. ya que si lo compro en usd y lo carga
en pesos tiene que estar modificando el precio del artículo todo el tiempo ya
que la cotización del dólar puede cambiar"*.

El pedido es chico de enunciar y grande de implementar, y conviene decir por qué
antes de nada: no pide un campo más, pide que **el precio deje de estar siempre
en pesos**. Todo el motor de ventas está construido sobre el supuesto contrario
—un total, en pesos, contra el que los pagos tienen que cerrar—, así que la
pregunta no era dónde poner el número sino qué pasa con la suma.

## El punto de partida

Hoy:

- `Articulo.precio Decimal(12,2)` es el precio de lista, **siempre en pesos**.
  Que signifique pesos no está escrito en ninguna columna: está en que no hay
  otra opción.
- `Venta.total` es la mercadería a precio de lista, en pesos, y `Venta.recargo`
  el caché de la suma de los recargos de sus pagos (también en pesos).
- Los pagos partidos **ya funcionan**: una parte en efectivo, otra por
  transferencia, otra en dólares con su `Pago.cotizacion`. Lo que no existe es
  que el total esté en otra moneda.
- El invariante central, en `lib/ventas/crear.ts`, es uno solo:

```ts
const total = totalDeItems(lineas)
const cubierto = totalDePagos(pagosConRecargo.map((p) => ({ monto: p.base, cotizacion: p.cotizacion })))
if (!cubierto.equals(total)) throw new ErrorDeVenta('PAGOS_NO_CIERRAN', …)
```

Y un dato que hace falta tener a mano porque se parece a la solución y no lo es:
**`Tenant.cotizacionUsd` existe desde el 2026-08-22 y no tiene un solo escritor
en todo el repo.** Es siempre NULL. El chip del header de `/vender` la muestra
como `—`. Este ciclo **no** se apoya en ella y **no** la arregla.

## Lo que se decidió, y contra qué alternativa

Las cinco decisiones se tomaron con el dueño del producto antes de escribir una
línea. Van arriba de todo porque son lo que hay que releer dentro de seis meses.

**1. El precio se carga directo en dólares, sin pedir ninguna cotización al
cargarlo.** La alternativa era guardar el precio en pesos y recalcularlo contra
"el dólar del local" (`Tenant.cotizacionUsd`), que además le hubiera dado por
fin un escritor a esa columna. Se descartó: el dueño dijo que la cotización se
tipea **en cada venta**, no que se fija una para el local. Un precio derivado de
un número del local es exactamente el número que después nadie actualiza, que es
el problema del que el cliente se está quejando, movido de lugar.

**2. La venta tiene DOS totales, no uno.** Es la decisión que da forma a todo el
ciclo, y salió de una pregunta del dueño: *"¿no podemos manejar una venta con
pago en pesos y pago en dólares? tener dos totales"*. La alternativa era
colapsar todo a pesos al cerrar la venta, convirtiendo lo que estuviera en
dólares con una cotización de la venta. Se descartó porque obliga a inventar una
cotización incluso cuando no hace falta ninguna: si el iPhone está en US$ 300 y
el cliente paga US$ 300 en billetes, **no hay ninguna conversión ocurriendo**, y
guardar una cotización sería registrar un hecho que no pasó.

**3. Cada total se cobra por separado, y cada pago declara cuál cubre.** Un
carrito mixto —un iPhone en dólares y una funda en pesos— no fuerza ninguna
elección de moneda: muestra `US$ 300` y `$ 15.000`, y quien cobra reparte los
pagos entre los dos. La cotización aparece **sólo** cuando un pago cruza:
cubrir el total en dólares entregando pesos, o al revés. Palabras del dueño:
*"si agrego un producto en dólares y otro en pesos igualmente podría pagar todo
en pesos. para el total en dólares podría seleccionar que se paga en pesos e
ingresar una cotización. también podría pagar la parte en dólares con dólares y
la parte en pesos con pesos"*.

La alternativa —prohibir el carrito mixto y obligar a dos ventas— se descartó
sola: un local de celulares vende el iPhone y la funda en la misma operación
todos los días.

**4. La cotización se tipea siempre, y el campo arranca vacío.** Hoy el campo de
un pago en dólares viene **precargado** con `ultimaCotizacionUsd()`, la última
cotización con la que el local cobró — que es justamente el número viejo del
jueves pasado si nadie pagó en dólares desde entonces. Es la misma clase de dato
envejecido contra la que el cliente escribió el feedback. El prefill se va, y
con él `ultimaCotizacionUsd()`, que se queda sin ningún consumidor.

**5. Ningún permiso nuevo.** Elegir la moneda de un artículo mueve el precio de
**un** artículo, así que viaja con `ARTICULOS_CREAR` / `ARTICULOS_EDITAR`, igual
que el precio mismo. Es la misma forma de razonar con la que el ciclo de precios
por forma de pago sí separó `PLANES_PAGO`: ése mueve el precio de todo el
catálogo de una. El catálogo de `lib/permisos/catalogo.ts` **no crece en este
ciclo**.

## El modelo

Cuatro columnas nuevas, **todas aditivas y con default**. Ninguna migración
destructiva, así que el rollback a la imagen anterior sigue teniendo a dónde
volver.

| Tabla | Columna | Qué es |
|---|---|---|
| `Articulo` | `moneda Moneda @default(ARS)` | En qué moneda está cargado `precio`. |
| `VentaItem` | `moneda Moneda @default(ARS)` | Congelada al vender, junto a `precioUnitario` y `descripcion`. |
| `Venta` | `totalUsd Decimal(12,2) @default(0)` | La mercadería en dólares, a precio de lista. |
| `Pago` | `cubre Moneda @default(ARS)` | Cuál de los dos totales paga esta fila. |

El enum `Moneda { ARS USD }` **ya existe** (lo usa `Pago.moneda`), así que no hay
que crearlo.

### Qué cambia de significado y qué no

**`Articulo.precio` deja de significar "pesos" y pasa a significar "la cantidad,
en `Articulo.moneda`".** Es la segunda vez que esta columna cambia de
significado sin cambiar de tipo: el ciclo de precios por forma de pago ya la
había pasado de "precio de contado" a "precio de lista". Como entonces, ninguna
migración lo anuncia, así que vive escrito acá.

**`Venta.total` NO cambia de significado para ninguna fila ya escrita.** Pasa a
ser la mercadería **en pesos** a precio de lista, y toda venta anterior a este
ciclo tiene `totalUsd = 0`, así que sigue diciendo exactamente lo que decía. No
se renombra, por lo mismo que no se renombró cuando llegaron los planes.

**`Pago.recargo` y `Venta.recargo` siguen siendo en pesos**, sin partirse en dos.
Ver la regla del plan más abajo: es lo que lo hace posible.

### El invariante deja de ser uno y pasa a ser dos

```
Σ aporte(pago) donde cubre = ARS  ==  venta.total
Σ aporte(pago) donde cubre = USD  ==  venta.totalUsd
```

Las dos tienen que cerrar para que la venta se cree. Una venta que cierra en
pesos y no en dólares se rechaza igual que hoy se rechaza la que no cierra.

### `aporte` no divide nunca

Es la restricción de diseño más importante del ciclo, y no es teórica: el ciclo
de precios por forma de pago ya rechazó la división por esto mismo — *"hay pares
(porcentaje, total) donde no existe un monto en dólares que cierre exacto contra
la base: el resultado sería una venta que el motor rechaza y que la persona del
mostrador no tiene forma de arreglar"*.

La regla que lo evita: **`base` va en dólares si el pago toca dólares de algún
lado** —sea la moneda que entra o el total que cubre—, y `cotizacion` sigue
significando lo mismo que hoy, pesos por dólar, multiplicando siempre **desde**
el lado del dólar.

| `moneda` | `cubre` | `base` está en | Aporta | `monto` (lo que entrega el cliente) |
|---|---|---|---|---|
| ARS | ARS | pesos | `base` → `total` | `base` pesos |
| USD | ARS | dólares | `base × cotizacion` → `total` | `base` dólares |
| USD | USD | dólares | `base` → `totalUsd` | `base` dólares |
| **ARS** | **USD** | **dólares** | **`base` → `totalUsd`** | **`base × cotizacion` pesos** |

Las tres primeras filas son literalmente lo que el motor hace hoy, con `cubre`
implícito en ARS. La cuarta es la nueva, y es el caso que originó el feedback.

**En la cuarta fila se tipea cuántos DÓLARES cubre el pago, no cuántos pesos.**
Es lo que hace que la operación sea una multiplicación y no una división, y de
paso es el mejor flujo de mostrador: quien cobra tiene el total en dólares
delante y la cotización en la cabeza; el número de pesos a cobrar lo calcula el
servidor. Que la persona tipee 445.500 y el sistema divida sería pedirle que
haga la cuenta ella y después verificarla.

Las filas donde `moneda === cubre` llevan `cotizacion = 1`. No es un valor
inventado: es literalmente cuánto convierte esa fila, que es nada.

### Los planes de pago, sobre los dos totales

La regla de hoy —*"un pago con plan tiene que ser en pesos y a cotización 1"*—
se relaja a **"un pago con plan tiene que entregarse en pesos"** (`moneda ===
'ARS'`), y el recargo se calcula sobre `montoEnPesos(base, cotizacion)` en vez
de sobre `base`.

Para toda venta existente eso es idéntico, porque ahí la cotización vale 1. Lo
que habilita es el caso nuevo: un iPhone de US$ 300 en 12 cuotas al 40 % se
cobra **$623.700** y aporta **US$ 300 exactos** al total en dólares. Sin
división, y con `Pago.recargo` quedándose en pesos, que es lo que evita tener
que partir `Venta.recargo` en dos columnas.

Lo que sigue prohibido, igual que hoy: un plan sobre un pago **entregado en
dólares**. El motivo es el mismo de siempre —el recargo se calcularía en dólares
y volver a pesos exige dividir—, y el error `PLAN_EN_DOLARES` se queda, con el
mensaje ajustado a la regla nueva.

## Las pantallas

**El principio que gobierna todo: un local que no usa dólares no ve ninguna
diferencia.** Cada control nuevo aparece únicamente cuando hay algo que decidir.
Es la misma forma en que los planes de pago entraron sin que un local sin planes
viera nada.

### `/inventario/nuevo` y `/inventario/[id]`

El campo "Precio de venta" gana un selector de moneda pegado, con `$` por
default:

```
Precio de venta
┌──────┬──────────────────┐
│ $  ▾ │ 15000            │
└──────┴──────────────────┘
   ↑ $ / US$
```

**Un solo componente para las dos pantallas**, no dos implementaciones del mismo
control. Es la lección directa del ciclo del 2026-08-28: la categoría terminó en
`SelectorDeCategoria` **después** de que un cliente reportara que la ficha y el
alta se habían desincronizado en silencio durante cuatro días, con el gate
entero en verde. No se paga ese peaje dos veces.

### `/inventario`, listado y ficha

El precio se muestra en su moneda, **sin equivalente en pesos**. Fuera de una
venta no hay ninguna cotización de la cual derivarlo, y un número inventado es
peor que ninguno — es la misma regla por la que el chip de cotización del header
muestra `—` en vez de fabricar un valor.

El tile "Último costo" y su margen quedan en `—` para un artículo en dólares:
`MovimientoStock.costoUnitario` es en pesos y no hay contra qué compararlo. Eso
**no es un agujero de este ciclo**: es la costura con la deuda del costo, que ya
está anotada en CLAUDE.md con su investigación hecha. Se declara acá para que
quien la lea sepa que el `—` es deliberado.

El precio derivado de un plan (`precioConPlan`) sí funciona en dólares: el
recargo es un porcentaje, así que US$ 300 al 40 % son US$ 420, y ése es
exactamente el equivalente de los $623.700 que el mostrador va a cobrar.

### `/vender`, el carrito

La banda del total pintada con `--marca` muestra **una línea por moneda**, y sólo
las que existen. Carrito todo en pesos → idéntico a hoy, un solo número.

### `/vender`, el panel de cobro

El selector `Cubre` aparece **únicamente cuando la venta tiene los dos totales**.
Si sólo tiene uno no hay elección que ofrecer, y el control no se dibuja.

```
A cobrar          US$ 300  ·  $ 15.000

Pago 1  [ Efectivo ▾ ] [ USD ▾ ]
        Cubre  [ total en dólares ▾ ]
        Monto  [ 300 ]
                                        Faltan US$ 0 ✓

Pago 2  [ Efectivo ▾ ] [ ARS ▾ ]
        Cubre  [ total en pesos ▾ ]
        Monto  [ 15.000 ]
                                        Faltan $ 0 ✓
```

y el caso del feedback, cubriendo los dólares con pesos y en cuotas:

```
Pago 1  [ Crédito ▾ ] [ ARS ▾ ]
        Cubre       [ total en dólares ▾ ]
        Plan        [ 12 cuotas +40 % ▾ ]
        Cubre US$   [ 300 ]
        Cotización  [        ]   ← arranca vacío, siempre
        ─────────────────────────
        A cobrar    $ 623.700
```

El chip "Faltan / Sobran" pasa a ser **uno por moneda**, mostrando sólo las que
la venta tiene, y "Cobrar" se habilita cuando cierran las dos. El renglón "A
cobrar $X" por fila —que el ciclo de planes de pago introdujo justamente porque
el campo de monto dejó de ser lo que hay que pedirle a la persona— es ahora el
único lugar donde se ve el número de pesos de un pago que cubre dólares.

Cambiar `moneda` o `cubre` **limpia el plan**, en el mismo cambio de estado, por
lo mismo que ya lo limpia el selector de medio: un plan que sobreviva a un cambio
que lo vuelve inválido es un `PLAN_NO_CORRESPONDE` con la pantalla mostrando algo
que se ve bien.

### `/ventas` y `/ventas/[id]`

El tile "Total del período" muestra los dos números, uno debajo del otro; la
columna Total de cada fila muestra las monedas que esa venta tenga
(`$ 15.000 + US$ 120`). **Nada se convierte**, así que ningún número envejece
cuando se mueve el dólar — que es el criterio del ciclo entero. `/ventas/[id]`
suma la moneda a cada ítem y, en cada pago, qué total cubrió.

## El motor

- `lib/ventas/totales.ts`: `totalDeItems` pasa a devolver los dos totales.
  Aparece `aporteDePago`, que es la tabla de cuatro filas de arriba hecha código
  y el único lugar donde vive esa regla.
- `lib/ventas/crear.ts`: dos invariantes en vez de uno; la regla del plan
  relajada a `moneda === 'ARS'` con el recargo sobre `montoEnPesos(base,
  cotizacion)`; `moneda` congelada en cada `VentaItem` desde el artículo, en el
  mismo lugar donde ya se congelan `descripcion` y `precioUnitario`.
- `lib/ventas/centavos.ts`: el espejo en enteros para el navegador. Es la mitad
  que decide si "Cobrar" se habilita, así que tiene que dar exactamente lo mismo
  que el servidor — misma regla de redondeo, mismo momento.
- `lib/ventas/buscar.ts`: los resultados del buscador devuelven `moneda`;
  `ultimaCotizacionUsd()` se borra.
- `lib/inventario/articulos.ts`: `crearArticulo` y `editarArticulo` aceptan
  `moneda`, con la misma validación de escala que ya tiene `precio`.
- `app/(app)/vender/page.tsx` y `punto-de-venta.tsx`: la prop `cotizacionInicial`
  se borra en toda su cadena.

`scripts/sembrar-catalogo-dev.mts` siembra al menos un artículo en dólares, para
que la verificación manual tenga contra qué mirar.

## Cómo se verifica

- **Los cuatro cuadrantes** de la tabla de `aporte`, cada uno con su caso.
- Una venta que **cierra en pesos y no en dólares** se rechaza con
  `PAGOS_NO_CIERRAN`, y al revés.
- Un plan sobre el total en dólares cobra **$623.700** y aporta **US$ 300
  exactos**; un plan sobre un pago entregado en dólares sigue dando
  `PLAN_EN_DOLARES`.
- **Una venta sin nada en dólares produce exactamente lo mismo que hoy**: mismo
  `total`, mismo `recargo`, `totalUsd = 0`, `cubre = ARS` en cada pago. Es el
  caso que protege a todos los tenants que no usan esta feature.
- El selector de moneda existe en **las dos** pantallas de artículo. Lo garantiza
  el componente compartido; el caso lo afirma igual, porque es la regla que este
  repo ya pagó tres veces (`test/permisos-en-las-dos-copias.test.ts` y los dos
  casos "las DOS copias" de `formularios.test.tsx`).
- `test/responsive.test.ts` ya cubre lo suyo: todo ancho fijo nuevo mayor a 362
  tiene que venir prefijado con `lg:`.

## El riesgo, y por qué esta migración es inerte

La migración viaja en **su propio deploy, antes que la UI**, como manda el
proyecto. Lo que hace que ese primer deploy sea genuinamente sin riesgo:
mientras ningún artículo esté marcado en dólares, ninguna venta puede tener
`totalUsd > 0`, así que la imagen anterior no puede encontrarse con una fila que
no sepa leer. **La feature no existe hasta que alguien marca el primer
artículo**, y para entonces el código que la lee ya está en producción.

El `DROP` del índice `@@index([tenantId, moneda, creadoEn])` de `Pago` —que
existía para `ultimaCotizacionUsd()` y se queda sin lector— es un deploy
**posterior**, no éste. Un índice de más no le hace daño a nadie; borrarlo junto
con el código que lo dejó de usar es exactamente lo que expand/contract prohíbe.

**Lo que queda sin red, y hay que decirlo:** que un local marque un artículo en
dólares y después lo vuelva a pesos sin tocar el precio deja el número dicho en
la moneda equivocada — `300` pasa a significar $300. Ninguna validación puede
distinguir eso de un cambio deliberado, así que la salida es que el selector
**avise** al cambiar de moneda, no que lo impida.

## Lo que este ciclo NO hace

- **El costo en dólares.** `MovimientoStock.costoUnitario` sigue siendo en pesos,
  y el margen de un artículo en dólares queda en `—`. Es el ciclo de la deuda del
  costo, que ya tiene su investigación escrita en CLAUDE.md.
- **Planes sobre un pago entregado en dólares.** Sigue prohibido, por la misma
  división de siempre.
- **`Tenant.cotizacionUsd`.** Sigue sin ningún escritor y el chip del header
  sigue mostrando `—`. Este ciclo no se apoya en ella y no la arregla.
- **El catálogo público, el bot y ARCA.** No existen todavía.
- **La verificación manual.** Como en los tres ciclos anteriores,
  `arandano-dev` bind-montea `/root/arandano` y no el worktree, así que va
  después del merge. Hay que mirar: que el selector de moneda precargue la del
  artículo al abrir la ficha; que un carrito mixto muestre los dos totales; que
  el campo de cotización arranque vacío; que cubrir los dólares con pesos y un
  plan cobre el número que dice el spec; y que un local sin ningún artículo en
  dólares vea `/vender` exactamente igual que antes.

## Lo que sigue

- El costo en dólares, que es lo que le devuelve el margen a estos artículos.
- El `DROP` del índice de `Pago`, un deploy después.
- El override de precio por artículo y plan, si aparece la necesidad real — ya
  tiene su entrada y su disparador en *Opciones evaluadas y descartadas*.
