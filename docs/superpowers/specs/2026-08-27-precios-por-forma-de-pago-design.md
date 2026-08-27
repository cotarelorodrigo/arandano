# Spec: precios por forma de pago

**Fecha**: 2026-08-27

**Origen**: feedback textual de un cliente — *"también necesitaría poder
diferenciar valor que se abona con crédito, del valor débito o transferencia.
Porque no es el mismo. Es decir, cada producto tiene que tener un precio para
abonar con crédito y otro precio para abonar débito/efectivo/transferencia."* —
y, sobre esa base, la precisión que llegó al empezar a diseñarlo: que el recargo
del crédito **depende de en cuántas cuotas** se paga (*"Crédito en 1 pago 10 %,
crédito en cuotas 40 %"*).

Esa segunda mitad es la que define la forma del ciclo. "Dos precios por
artículo" se resolvía con una columna; "un precio por cada forma de pago que el
local ofrezca" no es una columna: es una tabla del local, y una venta que tiene
que registrar con cuál se cobró.

## El punto de partida

Hoy el producto tiene **un solo precio por artículo** (`Articulo.precio`,
`Decimal(12,2)`) y el motor de ventas asume, en su invariante central, que el
total no depende de cómo se paga:

```ts
// lib/ventas/crear.ts
const total = totalDeItems(lineas)
if (!totalDePagos(pagos).equals(total)) throw new ErrorDeVenta('PAGOS_NO_CIERRAN', …)
```

Los pagos partidos ya funcionan —una parte en efectivo, otra por transferencia,
otra en dólares con su cotización—, así que el problema no es "soportar varias
formas de pago": es que **el precio pase a depender de cuál se usó**, sin
romper esa suma y sin ensuciar lo que ya está bien.

## Las cinco decisiones que este ciclo cierra

Las cinco se tomaron con el dueño del producto antes de escribir nada, y cada
una tenía una alternativa razonable que se descartó. Van acá arriba porque son
lo que hay que releer dentro de seis meses, antes que cualquier detalle de
implementación.

**1. El precio de crédito se DERIVA de un porcentaje, no se carga por
artículo.** Un segundo número por artículo era lo literal al pedido, y se
descartó: un catálogo de 300 artículos son 600 números para mantener, y cuando
cambia la lista del proveedor hay que acordarse de tocar los dos. Con un
porcentaje del local, el catálogo sigue teniendo un número por artículo.

**2. Los porcentajes viven en una tabla del local, con su ABM, y no en dos
campos fijos.** "Crédito en 1 pago 10 % / crédito en cuotas 40 %" son dos filas
de esa tabla, así que el pedido entra tal cual; y el local que mañana quiera
cobrar distinto 3 cuotas que 12 —que es lo normal, porque el costo financiero
real de la tarjeta es distinto en cada escalón— agrega una fila en vez de pedir
un ciclo de desarrollo.

**3. No hay precio por artículo y por plan.** Se evaluó el override ("en el
iPhone el 40 % no me da, ahí cobro tal número") y se descartó **para este
ciclo**: es una matriz de artículos × planes, o sea un segundo lugar donde vive
un precio, y cambiar `Articulo.precio` dejaría los overrides viejos sin avisar.
El dueño terminaría con precios inconsistentes que nadie ve hasta que se cobra
mal. Sumarla después es aditivo (tabla nueva, ninguna columna que borrar).

**4. El recargo cae sólo sobre la parte que se paga con ese plan.** La
alternativa —un plan por venta, que re-precia la venta entera— le cobraría el
recargo de la tarjeta a los $50.000 que entraron en efectivo, que es lo que
ningún local hace. Los ítems se congelan **siempre al precio de lista** y el
recargo va por afuera.

**5. El porcentaje lleva signo, y aplica a cualquier medio.** `-10.000` en
efectivo es el descuento por pago contado, tan común acá como el recargo por
cuotas. La alternativa era limitar los planes a la tarjeta de crédito y resolver
el descuento en un ciclo aparte, con otro mecanismo — dos maneras distintas de
mover el mismo número. Consecuencia que hay que decir en voz alta:
**`Articulo.precio` pasa a significar precio de LISTA**, no "precio de contado".

## Alcance

**Entra**: la tabla de planes con su ABM y su permiso, el recargo en el motor de
ventas y en el espejo del navegador, el selector de plan en el mostrador, el
desglose en las dos pantallas de ventas, y el panel de precios derivados en la
ficha del artículo — que es donde el pedido del cliente se ve.

**No entra**, y cada uno con su motivo:

- **Promociones bancarias** ("Ahora 12", 3 cuotas sin interés de tal banco, tope
  por tarjeta). Un local que las ofrezca las carga como un plan más; lo que no
  hay es integración con nadie ni reglas por emisor.
- **Redondeo comercial** — que el precio con recargo termine en `000`. El
  número sale exacto, con centavos si el porcentaje los da. Es una preferencia
  de presentación que nadie pidió y que, mal hecha, desalinea el total del
  navegador contra el del servidor.
- **Plan en un pago en dólares.** Ver *La aritmética*: encadenar el factor del
  plan con la cotización obliga a una división, y una división acá deja ventas
  rechazadas por un centavo. Se rechaza explícitamente, con su propio error.
- **ARCA.** La factura va a tener que discriminar el recargo; hoy no existe
  `model Factura` (ver *Decisiones abiertas del modelo de datos* en
  `CLAUDE.md`), así que no hay dónde escribirlo.
- **El catálogo público** mostrando precio por plan: el catálogo no existe.
- **Historial de cambios de porcentaje.** Qué porcentaje tenía el plan en marzo
  se responde por las ventas de marzo, que lo llevan congelado. Un log de
  ediciones del plan es su propio ciclo y hoy no responde ninguna pregunta que
  alguien vaya a hacer.
- **Órdenes de trabajo**: cobran mandando a `/vender` a mano, así que heredan
  esto sin tocar una línea. `crearVentaDesde` sigue sin existir.

## El modelo

```prisma
model PlanDePago {
  id                String    @id @default(uuid(7)) @db.Uuid
  tenantId          String    @map("tenant_id") @db.Uuid
  nombre            String
  // A qué medio aplica. Es lo que hace que elegir "Crédito" en la fila de pago
  // ofrezca sólo los planes de crédito, y lo que permite que el servidor
  // rechace un plan de tarjeta en un pago en efectivo.
  medio             MedioPago
  // Dato propio y no derivable del nombre: el mostrador necesita decir "6
  // cuotas de $X", y nadie va a parsear "Crédito 6 cuotas" para saberlo.
  cuotas            Int       @default(1)
  // CON SIGNO: +40.000 recarga, -10.000 descuenta. Tres decimales porque los
  // costos financieros reales vienen así (13.75 %), y (6,3) topea en 999.999 —
  // un recargo de más del 1000 % no es un caso, es un error de tipeo.
  recargoPorcentaje Decimal   @map("recargo_porcentaje") @db.Decimal(6, 3)
  // El orden del mostrador, decidido por el dueño. Sin esto se ordena por
  // nombre y "Crédito 12 cuotas" queda antes que "Crédito 3 cuotas".
  orden             Int       @default(0)
  // Baja lógica, como Articulo y User: un plan que ya cobró ventas es
  // indestructible por la FK Restrict de `pagos`, así que se desactiva.
  desactivadoEn     DateTime? @map("desactivado_en") @db.Timestamptz(3)
  creadoEn          DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn     DateTime  @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  pagos  Pago[]

  @@unique([tenantId, medio, nombre])
  @@index([tenantId, medio])
  @@map("planes_de_pago")
}
```

Con la policy de siempre, palabra por palabra igual que `categorias` y
`usuario_permisos`:

```sql
ALTER TABLE "planes_de_pago" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "planes_de_pago" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

`Pago` gana dos columnas:

```prisma
  // Con qué plan se cobró. NULL = a precio de lista, que es exactamente lo que
  // son todos los pagos que ya existen: sin backfill.
  planDePagoId String?     @map("plan_de_pago_id") @db.Uuid
  // Cuánto de este pago fue recargo — o descuento, en negativo. En PESOS
  // siempre, porque un pago en dólares no puede llevar plan (ver La
  // aritmética). CONGELADO: la venta de marzo tiene que seguir diciendo que se
  // cobró 40 % aunque el plan hoy esté en 45 % o esté dado de baja.
  recargo      Decimal     @default(0) @db.Decimal(12, 2)

  plan PlanDePago? @relation(fields: [planDePagoId], references: [id], onDelete: Restrict)
```

Y `Venta` una:

```prisma
  // La suma de los recargos de sus pagos. Es un CACHÉ, con el mismo criterio y
  // el mismo precedente que Articulo.stock respecto de sus movimientos: existe
  // para que el listado de /ventas no tenga que sumar los pagos de cada fila.
  recargo Decimal @default(0) @db.Decimal(12, 2)
```

`Permiso` gana un valor:

```prisma
  PLANES_PAGO
```

Cinco decisiones adentro de ese modelo:

**Guardar `recargo` además de la FK al plan no es duplicar.** Es exactamente la
misma decisión que ya toma `VentaItem` al congelar `descripcion` y
`precioUnitario` teniendo `articuloId`: la FK sirve para navegar, el número es
el que explica la plata. Un plan editado o dado de baja no puede cambiar lo que
una venta vieja dice que cobró.

**`Articulo` no cambia.** Ninguna columna, ningún backfill, ninguna fila de
artículo tocada. El precio de crédito no se guarda en ningún lado: se calcula.
Es lo que evita el problema de la decisión 3.

**`Venta.total` no cambia de significado**: sigue siendo la mercadería a precio
de lista. Lo cobrado es `total + recargo`. Cambiarle el significado habría
dejado a toda fila ya existente diciendo otra cosa, y habría dejado sin dato al
margen de `/inventario/[id]`, que se mide contra el precio de lista.

**El plan es del local y no del artículo.** No hay forma de excluir un artículo
de un plan ("esto no se vende en cuotas"). Se evaluó como opción C de la
decisión 3 y se dejó afuera por lo mismo: nadie lo pidió, y sumarlo después es
una tabla nueva.

**`ALTER TYPE "permiso" ADD VALUE 'PLANES_PAGO'` va sola en su migración y no se
usa ahí mismo.** Postgres permite agregar el valor dentro de una transacción
—que es como corre `prisma migrate deploy`— pero **no** usarlo en esa misma
transacción. Como la migración no inserta ninguna fila con ese permiso, no hay
problema; el precedente es `20260822204141_estado_aprobado`.

## La aritmética

Es el corazón del ciclo y es donde se puede introducir un bug que ningún test
mira de frente, así que va escrita antes que el código.

Sea `pct` el porcentaje del plan (0 si no hay plan) y `base` lo que ese pago
cubre de la venta, **a precio de lista**:

```
baseEnPesos_i = redondearDinero(base_i × cotizacion_i)
recargo_i     = redondearDinero(baseEnPesos_i × pct_i / 100)     ← con signo
monto_i       = base_i + recargo_i                                ← lo que entra a la caja

sum(baseEnPesos_i) == totalDeItems                                ← EL INVARIANTE
```

**El invariante es el de hoy, corrido un lugar.** Hoy los pagos suman el total;
ahora los suman **sus bases**. En código es literalmente `totalDePagos` aplicado
a las bases, así que de `lib/ventas/totales.ts` no se reescribe nada: se le suma
una función que calcula el recargo de un pago, y nada más.

Eso tiene una consecuencia que vale por sí sola: **el chip "Faltan / Sobran" del
mostrador sigue funcionando igual**, comparando contra la mercadería. La persona
que cobra sigue repartiendo la venta entre pagos, como hoy.

**Lo que la pantalla manda cambia**: por pago viaja `base` y `planId`, ya no
`monto`. `Pago.monto` lo calcula el servidor. Es deliberado: el monto es lo que
entra a la caja, y no puede depender de un número que armó el navegador. Del
porcentaje ni hablar — se lee de la fila del plan, siempre.

**Redondear cada recargo ANTES de sumar**, con `ROUND_HALF_UP`, igual que
`subtotalItem`. Sumar primero y redondear al final da distinto en los bordes, y
acá "distinto" significa una venta rechazada por un centavo.

**Un pago en dólares no puede llevar plan.** Con `cotizacion ≠ 1`, encadenar el
factor del plan obliga a dividir para saber cuántos dólares cobrar, y esa
división no siempre vuelve al mismo número: hay pares (porcentaje, total) donde
no existe un monto en dólares que cierre exacto contra la base. El resultado
sería una venta que el motor rechaza y que la persona del mostrador no tiene
forma de arreglar. Además el local ya tiene dónde ajustar el precio del dólar:
la cotización que fija el dueño (`Tenant.cotizacionUsd`). Si algún día hace
falta, es aditivo.

Como los planes son en pesos, `recargo` es siempre en pesos y `monto_i = base_i
+ recargo_i` cierra sin conversión: donde el recargo es distinto de cero, la
cotización vale 1.

**El porcentaje se valida al guardarlo, no al cobrar**: mayor que `-100` y menor
o igual a `999.999`. `-100 %` deja el pago en cero y menos de `-100 %` haría que
el local pague por vender; las dos cosas se rechazan en el ABM, que es donde la
persona puede corregir el número.

**El espejo del navegador.** `lib/ventas/centavos.ts` calcula el total en
enteros para habilitar el botón "Cobrar", y **tiene que dar el mismo número que
el servidor** — `centavos.test.ts` ya compara las dos aritméticas caso por caso.
El recargo entra ahí con la misma regla de redondeo y con casos nuevos en ese
test. Es el lugar más probable de un bug silencioso de este ciclo, y es por eso
que la red va justo ahí.

## El motor

`crearVenta` recibe, por pago, `{ medio, moneda, base, cotizacion, planId? }` y
resuelve los planes **dentro de la transacción del tenant**, así que RLS ya
garantiza que un plan de otro local no exista para esta consulta.

Lo que rechaza, con errores nuevos de `ErrorDeVenta` (mismo mecanismo que
`PAGOS_NO_CIERRAN`, mismo camino a un cartel corregible en la pantalla):

| Código | Cuándo |
|---|---|
| `PLAN_INEXISTENTE` | el plan no existe, es de otro tenant o está desactivado |
| `PLAN_NO_CORRESPONDE` | el `medio` del plan no es el `medio` del pago |
| `PLAN_EN_DOLARES` | el pago es en USD y trae plan |

`MONTO_INVALIDO` y `ESCALA_EXCEDIDA` pasan a evaluarse sobre `base` — es el
número que ahora llega de afuera.

**Lo que no se toca**: el congelado de precio y descripción por ítem, la
idempotencia (`claveIdempotencia`), el descuento de stock —que nunca supo de
plata— y la anulación, que conserva pagos y recargos intactos igual que
conserva ítems.

## Las pantallas

**`/formas-de-pago`** (nueva). El ABM de la tabla: nombre, medio, cuotas,
porcentaje, orden, alta / edición / baja lógica. Cada fila muestra el **precio
derivado de ejemplo** ("un artículo de $10.000 se cobra $14.000"), porque un
`40.000` en una celda no le dice nada a nadie a las 8 de la mañana. Avisos por
toast, como el ABM de categorías. Sexta pestaña del sidebar (ícono
`CreditCard`), visible para el dueño y para quien tenga `PLANES_PAGO` — el tipo
`Pestana` de `components/navegacion.tsx` gana un campo de permiso al lado del
`soloDueno` que ya tiene, y el layout resuelve con `puede()`.

**`/vender`**. La fila de pago gana un `Select` "Plan", que **aparece sólo si el
medio elegido tiene planes cargados**: un local que no cargue ninguno no ve un
solo control nuevo. El pie del panel de cobro pasa a tres líneas cuando hay
recargo:

```
Mercadería          $ 100.000
Recargo 3 cuotas     $ 12.500
Total a cobrar      $ 112.500
```

**`/inventario/[id]`**. Panel nuevo "Precios por forma de pago": una fila por
plan activo con su precio derivado. Es acá donde el pedido del cliente se ve
—cada producto con su precio de crédito y su precio de débito— sin haber
duplicado un solo número en la base.

**`/inventario` (listado) y el buscador de `/vender`**: sin cambios, precio de
lista. Cinco precios por fila es ruido en una tabla que se escanea; el desglose
vive en la ficha.

**`/ventas`** muestra lo cobrado (`total + recargo`), que es la plata que entró.
**`/ventas/[id]`** desglosa mercadería / recargo / cobrado y muestra el plan al
lado de cada pago.

**Deuda con la maqueta.** `design/arandano.pen` no dibuja `/formas-de-pago`, ni
el selector de plan, ni el panel de precios de la ficha. `CLAUDE.md` fija que el
`.pen` es la autoridad y que cuando contradice al código se modifica lo otro —
pero acá no contradice: falta. Va anotado en
`docs/correcciones-pendientes-del-pen.md`, como ya se hizo con el panel de
categorías.

## Deploy

**Dos deploys, por expand/contract.** Todo lo de este ciclo es aditivo: tabla
nueva, dos columnas en `pagos` (una nullable, otra con default), una en `ventas`
con default, un valor más en un enum. Nada se borra ni se renombra, así que no
hay contract.

1. **Deploy 1 (patch): sólo las migraciones.** Ningún código las lee. La imagen
   anterior sigue sirviendo igual porque no le falta nada.
2. **Deploy 2 (minor): motor, ABM y pantallas.** Si el healthcheck lo rechaza,
   el rollback a la imagen anterior encuentra la base con columnas de más y
   ninguna de menos, que es la única forma de que el rollback signifique algo.

## Verificación

Test primero, como el resto del repo.

- **RLS** (`test/rls.test.ts`, `test/rls-cobertura.test.ts`): la tabla nueva con
  sus policies, y que un plan de otro local no se lea ni sirva para cobrar.
- **El motor**: cobrar con plan, con descuento (recargo negativo), pago partido
  con una parte financiada y otra no, y los tres rechazos (`PLAN_INEXISTENTE`
  con plan ajeno y con plan desactivado, `PLAN_NO_CORRESPONDE`,
  `PLAN_EN_DOLARES`).
- **El espejo** (`lib/ventas/centavos.test.ts`): casos nuevos con recargo,
  comparando la aritmética del navegador contra la del servidor.
- **El catálogo de permisos** (`test/permisos-catalogo.test.ts`): pasa a siete,
  atado al enum del schema en las dos direcciones.
- **`test/pantallas.test.ts`**: obliga a que `/formas-de-pago` tenga su sección
  en `docs/pantallas.md` en el mismo commit.
- **`scripts/smoke.sh`**: el barrido de pantallas sale del sistema de archivos,
  así que la ruta nueva entra sola al gate sin tocar el script.
- **`scripts/generar-erd.sh` / `docs/schema.md`**: los verifica el hook de
  pre-commit y el paso 3 de `deploy.sh`; no pueden quedar desactualizados en
  silencio.

**Verificación manual, después del merge.** El contenedor `arandano-dev-app-1`
bind-montea `/root/arandano` —el workspace principal—, no el worktree, así que
mirar la pantalla a ojo va cuando esto vuelva a `main`. Es la misma deuda que
dejó anotada el ciclo de permisos. Lo que hay que mirar: que el selector de
plan aparezca sólo cuando hay planes cargados, que el pie del cobro sume bien,
que el precio derivado de la ficha coincida con lo que después cobra el
mostrador, y que un empleado sin `PLANES_PAGO` no vea la pestaña.

## Lo que sigue

- **El override por artículo**, si aparece la necesidad real (decisión 3). Es
  una tabla nueva; nada de lo de este ciclo hay que deshacer.
- **Plan en pagos en dólares**, si algún local lo pide. Requiere resolver antes
  la división que hoy lo bloquea.
- **ARCA**: cuando exista el modelo de factura, el recargo tiene que ir
  discriminado en el comprobante.
- **Excluir un artículo de un plan** ("esto no se vende en cuotas").
- **El disparador para reconsiderar todo esto**: que un local necesite que el
  recargo dependa del emisor de la tarjeta y no sólo de las cuotas. Ahí la tabla
  de planes deja de alcanzar y empieza a ser un motor de promociones, que es
  otro producto.
