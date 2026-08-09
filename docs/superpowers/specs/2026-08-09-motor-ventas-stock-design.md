# Spec: motor de stock y ventas

Fecha: 2026-08-09

El modelo de datos del ciclo de ventas y la lógica de servidor que lo mueve.
Sin interfaz, sin login y sin caja: al terminar, una venta se crea desde un test
y el stock queda bien.

Es la primera capa de producto. Todo lo demás del negocio —las dos pantallas,
la caja en pesos y dólares, la facturación ARCA— se apoya en esto.

## Alcance, y por qué es este y no más

"Inventario y ventas" se abre en siete piezas, y meterlas en un spec haría
impreciso justo lo que más importa: la atomicidad del descuento de stock y el
manejo de plata.

| # | Pieza | Depende de | Estado |
|---|---|---|---|
| 1 | Schema del ciclo de ventas | — | **este spec** |
| 2 | Motor de stock y ventas | 1 | **este spec** |
| 3 | Auth.js | — | ciclo aparte |
| 4 | UI de inventario | 2 + 3 | ciclo aparte |
| 5 | UI de ventas | 2 + 3 | ciclo aparte |
| 6 | Caja en pesos y dólares | 2 | ciclo aparte |
| 7 | Facturación ARCA | 6 | ciclo aparte, ya previsto en CLAUDE.md |

Se eligieron 1 y 2 juntos porque el motor es lo que le da sentido al schema: un
modelo de datos sin la lógica que lo escribe no se puede probar, y probarlo es
lo único que distingue un diseño bueno de uno plausible. Y porque sin login,
publicar pantallas sería dejar una puerta abierta en un subdominio.

## Estado del que se parte

Verificado sobre el repo:

- El núcleo tiene `Tenant`, `TenantModule`, `User`, `Cliente` y `Articulo`, con
  RLS que falla cerrado. **`Articulo` no tiene stock ni costo**: sólo `sku`,
  `nombre`, `tipo` y `precio`.
- La app **no tiene interfaz**: `app/page.tsx`, `layout.tsx`, `forbidden.tsx` y
  el healthcheck. No existe `components/`.
- **No hay autenticación.** `lib/tenant/desde-request.ts` resuelve el tenant por
  el `Host`, pero no hay sesión ni usuario.
- El dinero ya se modela con `Decimal(12,2)` en `Articulo.precio`, con un
  comentario que explica por qué nunca `Float`. Este spec sigue esa convención.

## El bloqueante que hay que levantar primero

`lib/tenant/prisma.ts` **rechaza a propósito** las transacciones interactivas, y
su mensaje de error nombra exactamente este caso:

> `prismaParaTenant(tenantId).$transaction(fn)` todavía no está soportado. […]
> Para trabajo atómico multi-paso (p. ej. `crearVentaDesde`: venta + movimiento
> de stock) hace falta un helper dedicado que abra la transacción interactiva y
> corra el `set_config` una sola vez adentro — todavía no existe, es tarea
> aparte.

El motivo del rechazo es real y está bien encontrado: las operaciones dentro del
callback pasan igual por `$allOperations`, que las agrupa en **su propio**
`$transaction([...])` sobre el cliente base — otra conexión. La atomicidad se
perdería en silencio.

Así que la primera pieza de este ciclo es ese helper.

```ts
export async function enTransaccionDeTenant<T>(
  tenantId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T>
```

Vive en `lib/tenant/transaccion.ts`, al lado de `prismaParaTenant` y no dentro
de `lib/ventas/`: es infraestructura de multi-tenancy, no de ventas, y el
próximo trabajo atómico multi-paso —una orden de trabajo, un cierre de caja— lo
va a necesitar igual.

Abre una transacción interactiva sobre el cliente **base**, corre el
`set_config` con el tercer argumento en `true` —local a la transacción, muere
con ella— y le pasa el cliente transaccional al callback.

Dos consecuencias que hay que tener presentes, y ninguna es un defecto:

- **Adentro se pierde el autocompletado de `tenantId`.** El cliente
  transaccional no lleva la extensión, así que cada `create` tiene que pasar
  `tenantId` explícito. Lo atrapa el compilador, porque el campo es obligatorio,
  y detrás está el `WITH CHECK` de la policy.
- **Cada transacción retiene una conexión mientras dura**, y el pool es de 5.
  Por eso el motor hace su trabajo y sale: nada de esperar red ni de llamar a
  ARCA adentro. El `timeout` y el `maxWait` van explícitos y no por default.

## El modelo de datos

Todas las tablas nuevas llevan `tenant_id` y la misma policy que ya usa el
núcleo, copiada literal:

```sql
ALTER TABLE "<tabla>" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "<tabla>" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

### `Articulo` gana `stock`

`Decimal(12,3)`, default 0.

**Decimal y no entero**, aunque un local de celulares venda unidades enteras:
CLAUDE.md ya tiene previsto el módulo de gastronomía descontando insumos por
receta, y medio kilo de harina no es un entero. Cambiar el tipo después toca
todas las filas de todos los tenants; ponerlo bien ahora no cuesta nada. Es
también la clase de supuesto contra el que CLAUDE.md advierte en *Riesgos
conocidos*: que el núcleo quede con forma de servicio técnico.

### `MovimientoStock`

`delta` con signo (`Decimal(12,3)`), `motivo`, `ventaId` opcional, `usuarioId`,
`nota` opcional.

```
enum MotivoMovimiento { VENTA, ANULACION_VENTA, AJUSTE, INGRESO }
```

**Append-only: nada se edita ni se borra.** Es lo que permite responder "por qué
tengo 3 y no 5", que es la pregunta que un dueño hace cuando el inventario no le
cierra. Y es el punto de extensión que CLAUDE.md ya le promete a los módulos:
órdenes de trabajo descontando repuestos, gastronomía descontando insumos.

### `Venta`

`numero` correlativo por tenant, `clienteId` opcional, `usuarioId`, `total`,
`anuladaEn`, `anuladaPorId`.

`clienteId` opcional porque la venta de mostrador —sin cliente identificado— es
la mayoría de las ventas de un local.

### `VentaItem`

`cantidad` (`Decimal(12,3)`), `precioUnitario` (`Decimal(12,2)`) y `descripcion`,
**congelados al momento de la venta**.

No son una referencia viva al artículo. Los precios cambian todas las semanas en
Argentina y los artículos se renombran: una venta de marzo tiene que seguir
diciendo lo que se cobró en marzo. `articuloId` se guarda igual, para poder
navegar, pero no es de dónde sale lo que se muestra.

### `Pago`

Varios por venta. `medio`, `moneda`, `monto`, `cotizacion`.

```
enum MedioPago { EFECTIVO, TRANSFERENCIA, TARJETA_DEBITO, TARJETA_CREDITO }
enum Moneda    { ARS, USD }
```

El pago partido —una parte en efectivo, otra por transferencia— es la norma, no
la excepción.

### El número correlativo

Un contador en `Tenant` (`proximoNumeroVenta`), incrementado **dentro de la misma
transacción** con `UPDATE … SET proximo_numero_venta = proximo_numero_venta + 1
… RETURNING`.

Eso serializa las ventas simultáneas de un mismo tenant. Para un local es
irrelevante —no hay dos cajas cobrando en el mismo milisegundo— y a cambio no
hay huecos ni números repetidos, que es lo que hace que "la venta 123" sirva
para hablar por teléfono. Una secuencia de Postgres no sirve: son globales, y
acá el correlativo es por tenant.

## Plata y monedas

**La venta tiene su total en pesos. Cada pago lleva su moneda y la cotización
usada** — los ARS que valía una unidad de esa moneda en ese momento. Un pago en
pesos lleva cotización 1.

Es como funciona un local argentino: el precio está en pesos, y si el cliente
paga en dólares se acuerda un tipo de cambio en el mostrador. Guardar la
cotización aplicada es lo que después deja cerrar la caja en las dos monedas sin
tener que reconstruir a qué valor se tomó cada dólar.

**El total lo calcula el motor**, sumando `cantidad × precioUnitario` de los
ítems. No se recibe por parámetro: un total que llega de afuera es un total que
puede no coincidir con lo que se cobró, y esa discrepancia se descubre meses
después al cerrar una caja.

El motor valida que los pagos cubran ese total exactamente. Si no cierra, la
venta no se crea: unos pagos que no suman es un error de carga, y dejarlo pasar
rompe la caja de una forma que después nadie puede reconstruir.

**El redondeo va explícito y no librado a la biblioteca.** Cada
`monto × cotizacion` se redondea a 2 decimales —la precisión en la que se
guarda la plata— *antes* de sumar. Sumar primero y redondear al final da un
resultado distinto en los bordes, y "distinto en los bordes" acá significa una
venta rechazada por un centavo. Misma regla para `cantidad × precioUnitario`.

## El motor

Tres funciones, en `lib/ventas/`, cada una en una transacción de tenant.

### `crearVenta`

Recibe los ítems (artículo y cantidad), los pagos, el `usuarioId`, y
opcionalmente el `clienteId`. En orden:

1. Lee los artículos del tenant. Si alguno no existe, aborta.
2. Congela precio y descripción de cada uno en su `VentaItem`.
3. Calcula el total y valida que los pagos lo cubran exactamente.
4. Toma el próximo número del contador del tenant.
5. Crea la `Venta`, sus `VentaItem` y sus `Pago`.
6. Por cada ítem de tipo `PRODUCTO`: crea el `MovimientoStock` con `delta`
   negativo y actualiza el artículo con **`UPDATE … SET stock = stock + $delta`**.

El paso 6 es relativo y no absoluto a propósito: dos ventas simultáneas del
mismo artículo no se pisan, sin necesidad de bloquear filas desde la
aplicación. Un `SET stock = $valorLeido - $cantidad` perdería una de las dos.

Los artículos de tipo `SERVICIO` no mueven stock — no tienen.

**El stock puede quedar negativo, y eso no frena nada.** Es una decisión de
negocio: el cliente está parado en el mostrador y la plata es real. Bloquear la
venta por un dato mal cargado hace perder una venta de verdad por un error
administrativo, y en un local con cola alguien va a terminar cargando un ajuste
falso para poder cobrar — que ensucia el inventario igual, pero sin dejar
rastro de por qué. Un stock en -2 es información: dice "acá falta cargar
mercadería", que es exactamente lo que pasó.

### `anularVenta`

Marca `anuladaEn` y `anuladaPorId`, y crea los movimientos compensatorios de
signo opuesto con motivo `ANULACION_VENTA`, actualizando el stock de cada
artículo con el mismo `UPDATE` relativo.

Compensa **sólo los movimientos que la venta generó**, o sea únicamente los
ítems de tipo `PRODUCTO`. Los servicios nunca movieron stock, así que no hay
nada que devolver — y derivar la compensación de los movimientos existentes, en
vez de recorrer los ítems de nuevo, es lo que garantiza que las dos mitades
coincidan aunque el tipo del artículo haya cambiado desde entonces.

**La venta no se borra ni se edita.** Sus ítems y su total quedan intactos: el
historial tiene que poder responder qué se cobró, y cuando llegue ARCA esa venta
anulada va a ser el comprobante que necesita su nota de crédito.

Anular una venta ya anulada no hace nada y no es un error: el reintento de un
click es más probable que la mala intención.

### `ajustarStock`

El ingreso de mercadería y la corrección de inventario. Un movimiento con motivo
`INGRESO` o `AJUSTE`, sin venta asociada, con `nota` para el porqué. Es lo que
devuelve a cero un stock negativo.

## El usuario, que todavía no existe

`crearVenta` recibe el `usuarioId` como **parámetro**, no de una sesión.

No hay Auth.js todavía, y esperar a que exista frenaría este ciclo entero por
algo que no cambia el diseño: cuando llegue el login, lo único que cambia es
quién llama. Los tests le pasan un usuario sembrado.

Queda anotado como deuda explícita: **hasta que exista la sesión, nada impide
que un llamador pase el `usuarioId` de otro**. No es un agujero hoy porque no
hay llamadores fuera de los tests, pero sí lo sería el día que se exponga una
ruta HTTP sin login. La UI no se construye antes que Auth.js, y ése es el orden
que lo cubre.

## Testing

Contra `arandano-dev`, con Vitest, como el resto del repo.

- **Aislamiento**: las tablas nuevas entran en `test/rls.test.ts` y
  `test/rls-cobertura.test.ts`, que es lo que garantiza que ninguna tabla nueva
  quede sin policy.
- **Atomicidad**: que una venta que falla a mitad —pagos que no cierran, artículo
  inexistente— no deje ni venta, ni ítems, ni movimientos, ni el contador
  incrementado.
- **Concurrencia**: dos `crearVenta` simultáneas sobre el mismo artículo dejan el
  stock correcto. Es la prueba del `UPDATE` relativo, y la única forma de saber
  que no se perdió una.
- **La suma cierra**: para cualquier artículo, `stock == SUM(delta)` de sus
  movimientos. Es la reconciliación que justifica tener el campo denormalizado,
  y tiene que ser un test, no una intención.
- **Anulación**: devuelve el stock exacto, deja la venta legible, y anular dos
  veces es idempotente.
- **Stock negativo**: se permite, se registra, y el movimiento queda.
- **Precios congelados**: cambiar el precio de un artículo después de la venta no
  cambia lo que la venta dice que se cobró.

## Fuera de alcance

Explícitamente, para que no se lea como olvido:

- **Interfaz.** Ninguna pantalla, ningún componente. No se puede usar desde un
  navegador al terminar este ciclo.
- **Auth.js.** El motor recibe el usuario por parámetro.
- **Caja**: apertura, cierre y arqueo en pesos y dólares. Se apoya en los pagos
  que este spec define, pero es su propio ciclo.
- **Facturación ARCA.** Ya está previsto como ciclo aparte en CLAUDE.md, detrás
  de una interfaz propia.
- **Costo del artículo y margen.** No hace falta para vender ni para descontar
  stock; entra cuando haya reportes que lo usen.
- **Listas de precios, descuentos y promociones.** Un precio por artículo alcanza
  para el MVP.
- **Reserva de stock.** No hay carrito persistente ni pedidos pendientes: el
  stock se descuenta al cobrar.
