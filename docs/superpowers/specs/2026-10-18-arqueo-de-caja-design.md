# Spec: efectivo en caja, egresos y el cierre del día con arqueo

**Fecha**: 2026-10-18

**Origen**: pedido de un cliente (local que vende iPhones), audios WA0022 y
WA0023, pasado por el dueño del producto como "Tarea 4": ver desde la caja
**cuánto efectivo hay ahora**, y que el cierre diario deje registrado **de
cuánto fue el cierre y cuánto se retiró**.

**Cómo se decidió**: sin preguntas al dueño del producto, que revisa después.
Cada **decisión** es una llamada de quien implementó. Siguen abiertas para el
cliente: si la caja maneja dólares en efectivo de verdad y si lo que queda pasa
como apertura del día siguiente (este diseño asume que sí a las dos, y las deja
fáciles de apagar).

## Lo que ya existe

`Caja` (prisma/schema.prisma) registra quién abrió, con cuánto (`saldoInicial`,
un solo monto en pesos) y quién cerró. Su comentario lo dice: *"Lo que NO tiene,
a propósito: arqueo, movimientos de efectivo y cuadre contra las ventas del
turno. Eso es la pieza 6 del roadmap"*. Éste es ese ciclo. El chip "Caja
abierta" del header de `/vender` (`caja.tsx`) abre y cierra; en el teléfono, la
hoja `ControlDeCaja`. `crearVenta` **no** exige caja abierta, y eso no cambia.

## El principio

**El efectivo esperado se deriva, nunca se lleva a mano.** Es la suma de lo que
el sistema ya sabe (apertura, cobros en efectivo, movimientos de caja) dentro de
la ventana del turno. Lo único que se escribe a mano es lo que sólo una persona
puede saber: lo que hay en el cajón cuando lo cuenta, y lo que se lleva.

## Las decisiones

### 1. El turno es una ventana de tiempo, no una FK

`Pago` no tiene `cajaId` y no lo gana: `crearVenta` no exige caja, y la regla
"una sola caja abierta por tenant" (índice único parcial) hace que la ventana
`[abiertaEn, cerradaEn ?? ahora)` identifique un solo turno sin ambigüedad.

**Efectivo cobrado en el turno**, por moneda: la suma de `Pago.monto` con
`medio = EFECTIVO`, agrupada por `Pago.moneda` (lo que el cliente entregó), de
ventas **creadas en la ventana y no anuladas**. Se filtra por `Venta.creadoEn` y
no por `Pago.creadoEn`, porque la edición de una venta recrea sus pagos con
`creadoEn = ahora` y los movería de turno.

**Anulaciones**: una venta creada en un turno anterior y anulada **durante este**
devuelve su efectivo desde este cajón, así que se resta acá (por
`Venta.anuladaEn` en la ventana). Una creada y anulada en el mismo turno
simplemente no suma.

**Límite declarado**: una **edición** de una venta de otro turno que cambie
efectivo (de tarjeta a efectivo, por ejemplo) no se refleja en el turno donde se
hizo la corrección. Es la misma limitación que ya se aceptó en el ciclo de
edición de venta (proximos-pasos.md: *"se descartó… porque `crearVenta` ni
siquiera exige caja abierta"*); la diferencia aparece en el arqueo, que es
justamente para eso.

### 2. Movimientos de caja: tabla nueva, append-only

`MovimientoDeCaja { id, tenantId, cajaId → Caja, tipo, moneda, monto > 0, nota?,
usuarioId, creadoEn }` con RLS y `enum TipoMovimientoCaja { INGRESO, EGRESO,
RETIRO }`:

- **EGRESO**: plata que sale del cajón para un gasto (el delivery, la limpieza).
  Nota obligatoria: un egreso sin motivo es el que nadie puede explicar después.
- **RETIRO**: plata que el dueño se lleva durante el día, sin ser gasto.
- **INGRESO**: plata que entra sin venta (cambio que se trae del banco).

Se registran sólo con una caja abierta, desde el mismo control de la caja. No se
editan ni se borran: un error se corrige con el movimiento contrario, y los dos
quedan a la vista. **Decisión**: cualquiera del local registra, igual que abrir y
cerrar hoy; cada movimiento lleva quién fue, y el arqueo es el control.

**Efectivo actual** = apertura + cobrado − anulaciones devueltas + ingresos −
egresos − retiros, **por moneda**. Pesos y dólares nunca se suman.

### 3. Apertura en las dos monedas

`Caja.saldoInicialUsd Decimal(12,2) @default(0)`. El formulario de apertura
muestra el campo en dólares plegado ("+ dólares") para que el local que no
maneja dólares no vea un campo de más. Ese mismo criterio rige en toda la
pantalla: **la columna de dólares se muestra sólo si el turno tiene algún dólar**
(apertura, cobro o movimiento).

**Apertura sugerida**: el formulario arranca con lo que quedó en el último
cierre (contado − retirado), por moneda, y se puede cambiar. Sin un cierre
previo con arqueo, vacío como hoy.

### 4. El cierre con arqueo

"Cerrar caja" pasa de un "¿Seguro?" a un formulario:

- el **efectivo esperado** por moneda (calculado en el servidor al abrir el
  formulario, y **recalculado en la transacción del cierre**, que es el que se
  guarda);
- **efectivo contado** por moneda (obligatorio, ≥ 0);
- **retirado** por moneda (≥ 0 y ≤ contado);
- nota opcional;
- en vivo: la **diferencia** (contado − esperado: "sobran $ 200", "faltan $ 200",
  "cuadra") y **lo que queda** (contado − retirado).

La diferencia **no bloquea** el cierre. Se guardan en `Caja`, todas nullable
(una caja cerrada antes de este ciclo no las tiene, y la imagen anterior las
ignora): `esperadoArs/Usd`, `contadoArs/Usd`, `retiradoArs/Usd`, `notaCierre`.
Diferencia y "queda" se derivan; no se guardan dos veces.

`cerrarCaja` sin arqueo deja de existir como camino de la UI, pero la función
acepta el arqueo opcional para no romper a un llamador viejo (un formulario
cacheado durante el deploy cierra como hoy, sin arqueo).

### 5. Dónde se ve

- **El chip "Caja abierta"** del header de `/vender` muestra el efectivo actual
  ("Caja abierta · $ 55.000") y abre un panel con el detalle (apertura, cobrado,
  movimientos, actual), "Registrar movimiento" y "Cerrar caja". Se actualiza con
  cada cobro porque el cobro ya revalida `/vender`. En el teléfono, lo mismo en
  la hoja `ControlDeCaja`.
- **`/caja`** — historial de cierres, nueva pantalla: por fecha (filtro desde /
  hasta, por defecto los últimos 30 días), cada fila con fecha y hora de
  apertura y cierre, quién abrió y cerró, apertura, esperado, contado,
  diferencia (resaltada si no es cero), retirado y queda, por moneda; el detalle
  de una caja con sus movimientos. **Decisión**: sólo el dueño
  (`soloDueno`, como `/dashboard`): las diferencias de caja de cada empleado son
  información de gestión.

## Fuera de alcance

- Exigir caja abierta para cobrar.
- Efectivo de otros medios (vuelto en otra moneda: `recibido` no se guarda).
- Un permiso para registrar egresos.

## Tests

- El ejemplo del pedido: apertura $ 10.000 + ventas en efectivo $ 50.000 −
  egreso $ 5.000 → esperado $ 55.000; contado $ 55.000, retirado $ 45.000 →
  queda $ 10.000, diferencia $ 0.
- Cobrado del turno: sólo EFECTIVO, por moneda, sólo ventas de la ventana, las
  anuladas no suman; una de un turno anterior anulada en éste resta; una venta
  editada después no se mueve de turno; otro tenant no suma.
- Movimientos: con caja abierta sí, sin caja no; monto > 0; egreso sin nota no.
- Cierre: guarda los campos; retirado > contado se rechaza; diferencia ≠ 0 no
  bloquea; el esperado guardado es el recalculado en la transacción.
- Apertura sugerida = queda del último cierre.
- `/caja`: sólo dueño; filtro por fecha.

## Ajustes durante la implementación

Llamadas que el código obligó a hacer y que el diseño no decía. En cada una se
eligió la opción más conservadora.

- **Un movimiento bloquea la fila de la caja.** `registrarMovimiento` corre un
  `UPDATE cajas SET cerrada_en = NULL WHERE cerrada_en IS NULL` que no cambia
  nada pero toma el lock de la fila, igual que el `UPDATE` del cierre. Sin eso,
  un movimiento concurrente con un cierre podía quedar colgado de una caja ya
  cerrada y fuera de su arqueo para siempre (la FK del insert toma un
  `FOR KEY SHARE`, que no choca con el `UPDATE` del cierre). Probado con una
  conexión propia que cierra a mitad de camino, y verificado en rojo contra la
  versión `findFirst` + `create`.
- **La ventana del turno abierto no tiene cota superior** (`creadoEn >=
  abiertaEn`, sin `< ahora`): sólo se calcula para la caja abierta, y una cota
  con el reloj del proceso contra el `now()` de Postgres no compra nada. Un
  COBRO concurrente con el cierre no toma el lock (`crearVenta` no toca la
  caja, y eso no cambia): una venta que commitea después del recálculo con un
  `creado_en` anterior al cierre no queda en el esperado de nadie. Es una
  ventana de milisegundos y la diferencia la muestra el arqueo.
- **"Devuelto" incluye ventas cobradas sin ninguna caja abierta**: la regla es
  "creada antes de que abriera este turno y anulada durante éste", y una venta
  de antes de cualquier caja devuelve su efectivo desde este cajón igual.
- **El contado en dólares ausente es cero.** Cuando el turno no tuvo dólares el
  formulario no muestra la columna, y el servidor no puede saber si se mostró:
  lee la ausencia como cero (si en ese turno sí había dólares —un cobro que
  entró mientras se contaba—, el arqueo lo muestra como faltante en vez de
  impedir el cierre). Cuando la columna se muestra, el campo es `required` en el
  formulario. El contado en pesos es obligatorio también en el servidor. Los
  retirados vacíos son cero.
- **El formulario viejo se reconoce por la AUSENCIA del campo `contadoArs`**
  (no por estar vacío): ausente cierra sin arqueo; vacío es el formulario nuevo
  sin completar, y es un error que se le muestra a la persona.
- **La apertura sugerida mira sólo el último cierre**: si ése fue sin arqueo,
  no hay sugerencia (el campo arranca en "0", como antes) en vez de buscar uno
  más viejo, porque lo que quedó hace tres días no es lo que hay hoy. Con
  dólares en lo que quedó, el campo de dólares arranca desplegado.
- **CHECKs además del de `monto > 0`**: no negativos en `saldo_inicial_usd` y en
  contado y retirado. El esperado no lleva CHECK (un egreso mayor que lo que
  había da un esperado negativo, que es un dato). `saldo_inicial` en pesos no
  ganó el suyo: sumárselo a una columna con datos escritos queda fuera de un
  ciclo aditivo.
- **Notas con tope de 500 caracteres** (movimiento y cierre).
- **El detalle de una caja en `/caja` va plegado en la fila** (`<details>`), y
  no en una ruta `/caja/[id]`: lista corta, sin JavaScript, sin ruta dinámica
  que sacar del barrido del smoke ni 404 que manejar.
- **`/caja` filtra por fecha de CIERRE** y no muestra la caja abierta (no tiene
  cierre; su estado vive en `/vender`). Tope de 400 cierres por consulta, con
  aviso. Sólo lee lo guardado: el esperado no se recalcula.
- **El chip de sólo lectura del teléfono también dice el importe**: "en el
  teléfono, lo mismo" (decisión 5) se leyó como el mismo texto en el chip y el
  mismo panel en la hoja.
- **El panel no dibuja las filas en cero** (salvo apertura, cobrado y actual),
  para que un local que nunca registra egresos no lea "Egresos $ 0,00" cada
  vez.
- **Un contado que la gramática no entiende** (`54.800`, ambiguo entre miles y
  decimales) no muestra una cuenta en vivo inventada sino cómo escribirlo; el
  servidor lo rechaza igual.
