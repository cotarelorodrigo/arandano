# Spec: Plan canje — cuánto se le reconoce al usado y cuánto paga el cliente

**Fecha**: 2026-10-18

**Origen**: pedido de un cliente (local que vende iPhones), audios de WhatsApp del
7 y 8 de octubre de 2026, pasado por el dueño del producto como "Tarea 2". El
local acepta iPhones usados como parte de pago y hoy cada vendedor le pregunta
al dueño cuánto se paga por cada equipo. El cliente dice que esto sería *"casi
el 50 %"* de la razón para comprar el software.

**Cómo se decidió**: el dueño del producto pidió el ciclo resuelto de noche y sin
preguntas, y revisa a la mañana. Cada **decisión** de abajo es una llamada de
quien implementó. Las preguntas abiertas para el cliente (rangos reales,
otros factores como capacidad o estado, registrar la operación) siguen
abiertas; el diseño las deja fáciles de cambiar en vez de adivinarlas.

## El problema

El valor del usado vive en la cabeza del dueño. Cada canje frena una venta
hasta que alguien lo encuentra, y dos vendedores pueden cotizar distinto el
mismo equipo. Lo que se necesita es que la tabla que el dueño ya tiene en la
cabeza esté escrita en el sistema, y que el vendedor la consulte sin poder
cambiarla.

## El principio

**Una tabla que el dueño mantiene y una cuenta que el vendedor lee.** La
pantalla del vendedor no escribe nada en la base: calcula. Por eso este ciclo
no toca ventas, stock ni caja, y se revierte entero revirtiendo la imagen.

## Las decisiones

### 1. Es parte del núcleo, no un módulo nuevo

La lista de módulos es cerrada a propósito (`CLAUDE.md`: "los módulos son
tres"). El canje no es exclusivo de los celulares —un local de bicicletas, de
consolas o de autos toma usados igual—, así que **el modelo es genérico**: el
"modelo" es un texto que el dueño escribe ("iPhone 14", "iPhone 13 Pro") y el
"estado" es el rango de batería. **Decisión**: el eje de batería es fijo en este
ciclo porque es lo único que el cliente pidió; si aparece otro rubro o el
cliente dice que también depende de la capacidad, el eje se generaliza entonces
(ver "Fuera de alcance").

La pestaña "Plan canje" se muestra en todo tenant, con la misma deuda
consciente que ya tiene `/servicio-tecnico` en `components/navegacion.tsx`:
cuando exista el registry de módulos/presets, el preset decide si aparece.

### 2. Cuatro tablas, todas con RLS

- `RangoDeBateria { id, tenantId, minimo Int, maximo Int, orden }`: un rango
  cerrado de porcentajes enteros, `0 ≤ minimo ≤ maximo ≤ 100`. Sin solapamientos
  dentro de un tenant (validado en la aplicación, en la misma transacción que
  escribe). Los huecos se permiten —un dueño puede no tomar equipos con menos de
  80 %— y el cálculo dice "sin cotización" para ese porcentaje.
- `ModeloDeCanje { id, tenantId, nombre }`, único por `(tenantId, nombre)`
  comparando sin distinguir mayúsculas.
- `ValorDeCanje { id, tenantId, modeloId, rangoId, valor Decimal(12,2) }`, único
  por `(modeloId, rangoId)`, con `onDelete: Cascade` desde modelo y rango: borrar
  el modelo "iPhone 8" se lleva sus valores, que es lo que el dueño quiere decir.
- La moneda es **una sola para toda la tabla**: `ConfiguracionDeCanje { tenantId
  @id, moneda Moneda @default(USD) }`. **Decisión**: una tabla de canje donde
  algunas celdas están en pesos y otras en dólares no la escribe ningún local, y
  una moneda por celda obliga a mirar dos cosas en cada número. El default es
  USD porque el pedido dice que el precio de venta del iPhone está en dólares.
  Cambiar la moneda **no convierte** los valores (no hay cotización guardada);
  la pantalla lo avisa antes de confirmar.

El cálculo se apoya en el valor: borrar o cambiar una fila no puede romper
ninguna operación pasada, porque todavía no se registra ninguna.

### 3. Rangos sugeridos, cargados con un botón

Un tenant arranca sin rangos. La pantalla de valores, vacía, ofrece **"Usar los
rangos sugeridos"**: 100 %, 90–99 %, 85–89 %, 80–84 % y menos de 80 % (0–79). No
se cargan solos al abrir la pantalla —un GET que escribe es una sorpresa— ni en
una migración —el tenant que no hace canje no los necesita—. Después se pueden
agregar, editar y borrar rangos libremente.

### 4. Dos pantallas

- **`/plan-canje`** — la calculadora. Cualquier usuario con sesión.
- **`/plan-canje/valores`** — la tabla. Exige el permiso nuevo `CANJE_VALORES`
  ("Editar los valores del plan canje"); el dueño lo tiene siempre, como todo
  permiso. La calculadora muestra un enlace a la tabla sólo a quien puede
  editarla.

La tabla se dibuja como lo que es: **modelos en filas, rangos en columnas, el
valor en cada celda**. Es la forma en que el dueño ya la piensa, y la que permite
actualizar todos los valores de un modelo en un solo gesto cuando cambia el
precio. Cada fila se edita y se guarda entera; los rangos se administran en una
card aparte de la misma pantalla.

### 5. La calculadora

El vendedor elige:

1. **El equipo que se vende**: búsqueda sobre los artículos vendibles, la misma
   que usa `/vender` (`buscarArticulosVendibles`), mostrando nombre, precio en
   su moneda y stock.
2. **El modelo que entrega el cliente**: un selector con los modelos cargados.
3. **La batería**: un número entero de 0 a 100.

Y ve tres números: precio del equipo, valor del usado y **la diferencia que paga
el cliente** (precio − valor), que es el número de `--marca` de la pantalla.

- **Sin cotización** para esa combinación (no hay rango que contenga el
  porcentaje, o el modelo no tiene valor en ese rango): el mensaje *"Sin
  cotización cargada para un iPhone 14 con 88 % de batería. Consultá al
  encargado."*, nunca un error.
- **El usado vale más que el equipo**: la diferencia se muestra como lo que el
  local le devuelve al cliente, no como un número negativo.
- **Monedas distintas** (el equipo en pesos y la tabla en dólares, o al revés):
  no se inventa una cotización. Se muestran los dos números en su moneda y un
  campo "Cotización del dólar" que el vendedor tipea —el mismo criterio que
  `/vender`, donde la cotización se tipea en cada venta—; con ella se calcula la
  diferencia **en la moneda del equipo**. Sin cotización tipeada, no hay
  diferencia.

Toda la cuenta vive en funciones puras de `lib/canje/`
(`rangoParaBateria`, `calcularCanje`), separadas de Prisma, para que el ciclo
que registre la operación como venta las llame tal cual.

### 6. Validaciones

- Batería: entero, 0–100. "88,5" se rechaza con un mensaje.
- Rango: entero, `minimo ≤ maximo`, sin solaparse con otro rango.
- Valor: decimal ≥ 0 con dos decimales, con la gramática compartida de
  `lib/formato`. Una celda vacía significa "no se toma ese equipo en ese
  rango" y borra el valor si existía.
- Nombre de modelo: no vacío, único sin distinguir mayúsculas.

## Fuera de alcance (preparado para después)

- **Registrar el canje como venta** y dar de alta el usado en el stock (pregunta
  abierta 2). `calcularCanje` devuelve un resultado estructurado pensado para
  que ese ciclo lo convierta en una venta con un pago "en equipo".
- **Otros factores del valor** (capacidad, estado estético, color — pregunta
  abierta 1). Si el cliente los confirma, el eje "rango de batería" pasa a ser
  uno de varios.
- Historial de cambios de los valores.

## Tests

- `rangoParaBateria`: los bordes de los rangos sugeridos (100, 99, 90, 89, 85,
  84, 80, 79, 0), un porcentaje en un hueco, y entradas inválidas.
- `calcularCanje`: el ejemplo del pedido (iPhone 16 a USD 1000, iPhone 14 con
  88 % cotizado USD 400 → paga USD 600); sin cotización; el usado vale más; monedas
  distintas con y sin cotización tipeada.
- Rangos solapados rechazados; nombres de modelo duplicados rechazados.
- Permisos: un empleado sin `CANJE_VALORES` usa la calculadora pero las acciones
  de la tabla le dan `forbidden`; con el permiso, puede editar; el dueño puede.
- RLS: las cuatro tablas aisladas entre tenants.
