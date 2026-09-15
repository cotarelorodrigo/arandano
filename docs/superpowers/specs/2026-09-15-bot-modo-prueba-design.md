# Spec: el bot se puede probar sin que les conteste a clientes reales

**Fecha**: 2026-09-15

**Origen**: pedido del dueño del producto — *"para la feature de bot de whatsapp
deberíamos agregar que el dueño pueda configurar N números a los que sólo el bot
les responda. esto es para que lo pueda testear para ver cómo responde y que no
afecte a clientes reales. Es decir que podría activar el modo test del bot
configurando ciertos números"*.

## El problema

Hoy el bot tiene dos estados: apagado, o contestándoles a **todos** los que
escriban. Entre los dos no hay un lugar donde mirar cómo responde. El número está
en coexistencia —es el mismo que el local ya usa con sus clientes—, así que la
única forma de ver al bot contestando es prenderlo delante de esos clientes. La
primera respuesta equivocada, entonces, la recibe un cliente real.

`npm run bot:probar` resuelve esto para quien tiene una terminal en el servidor,
que no es el dueño de un local.

## El principio

**Probar es un estado del bot, no un permiso ni un flag aparte.** El bot está
apagado, en prueba o contestándoles a todos, y en ningún momento hay dos controles
que haya que leer juntos para saber qué va a pasar con el próximo mensaje.

## Las decisiones

### 1. Tres estados, no un switch más una lista

`BotDeWhatsapp.activo Boolean` pasa a ser `modo ModoBot`, con
`enum ModoBot { APAGADO, PRUEBA, TODOS }`. En la pantalla es un control
segmentado de tres opciones: **Apagado · Sólo prueba · Todos**.

Se descartaron dos alternativas:

- **Mantener el switch y que la lista restrinja si tiene números.** Tiene menos
  UI, pero quitar el último número de la lista le suelta el bot a todos los
  clientes sin ningún gesto que lo diga. El paso a clientes reales tiene que ser
  una decisión explícita, no el efecto de vaciar una lista.
- **Switch de prendido más un toggle "modo prueba".** Son dos controles para
  tres estados reales, y su combinación hay que leerla.

### 2. Los números se tipean, y se comparan por los últimos 10 dígitos

El dueño escribe el número en un campo libre. Se guardan **sólo los dígitos**, y
un `waId` coincide con un número de prueba si **los últimos 10 dígitos de los
dos son iguales**. En Argentina, código de área más número suman 10 dígitos, así
que `11 2233-4455`, `+54 9 11 2233 4455` y el `5491122334455` que entrega Kapso
dan lo mismo.

Se rechaza lo que tenga **menos de 10 dígitos** o **más de 15**, que es el largo
máximo de E.164.

**El caso que esta comparación NO salva**, escrito para que no se descubra por
las malas: `011 15 2233-4455` son 13 dígitos, y sus últimos 10 (`1522334455`) no
son los del número. La ayuda del campo pide "con código de área, sin 0 y sin
15", y la pantalla muestra por cada número si ya escribió alguien que coincida
(decisión 6). Ésa es la red: si el dueño se escribe desde ese celular y la fila
sigue diciendo "Todavía no escribió", el número está mal cargado. No se intenta
detectar el `15` automáticamente: los códigos de área tienen largo variable y
cualquier heurística le erraría a alguno.

Se descartó **elegir el número de entre las conversaciones que ya llegaron**
(coincidencia exacta, sin normalizar nada): obliga a escribirle al bot antes de
poder probarlo y suma una segunda superficie de UI.

Hay una colisión posible entre países con los mismos 10 dígitos finales. Para una
lista de números de prueba de un local es un riesgo despreciable, y su peor caso
es que el bot le conteste a una persona más durante una prueba.

### 3. Tabla propia, no una columna de arreglo

```prisma
model NumeroDePruebaBot {
  id       String   @id @default(uuid(7)) @db.Uuid
  tenantId String   @map("tenant_id") @db.Uuid
  digitos  String
  creadoEn DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, digitos])
  @@map("numeros_de_prueba_bot")
}
```

Agregar un número es un `INSERT` y quitarlo es un `DELETE`: la fila es el dato,
igual que en `usuario_permisos`. Los repetidos los frena el índice único, no un
chequeo previo, así que dos pestañas agregando el mismo número a la vez no lo
duplican. La tabla lleva `tenant_id`, `ENABLE ROW LEVEL SECURITY` y la policy
`tenant_aislamiento` en la propia migración, igual que `usuario_permisos`, y
`test/rls-cobertura.test.ts` la cubre sin tocarlo.

`digitos` guarda los dígitos **tal como se tipearon** (sin símbolos), no sólo los
últimos 10: así la pantalla puede mostrar lo que el dueño cargó. La unicidad
queda sobre esa forma, de modo que `1122334455` y `5491122334455` podrían
convivir como dos filas que coinciden con el mismo teléfono. Es inofensivo (el
bot contesta igual, una sola vez) y la acción de agregar lo rechaza antes
comparando los últimos 10 contra los que ya hay, con su propio error.

Tiene un **tope de 20 números por local**, validado en la acción. Una lista de
prueba más larga ya no es una prueba.

Se descartó **`text[]` en `bots_de_whatsapp`**: sería el primer arreglo del
schema y dejaría la unicidad en código, con dos escrituras concurrentes pisándose
la lista.

### 4. `activo` se sigue escribiendo, y el valor elegido es el que hace seguro el rollback

La migración agrega `modo` con default `APAGADO` y la llena desde la columna
vieja: `TODOS` donde `activo = true`. **`activo` no se borra**: toda escritura
de `modo` escribe también `activo = (modo === 'TODOS')`.

El valor no es arbitrario. La imagen anterior sólo lee `activo`. Si un local está
en `PRUEBA` y el healthcheck revierte la imagen, la vieja lee `activo = false` y
**se calla**. La alternativa, `activo = (modo !== 'APAGADO')`, haría que un
rollback durante una prueba ponga al bot a contestarles a todos los clientes. En
un rollback, el bot tiene que fallar callado.

El `DROP COLUMN activo` es un deploy **posterior**, por expand/contract.

### 5. La regla vive en `evaluarCorte`, antes de insertar

El orden de los cortes queda así:

1. `APAGADO` → `BOT_APAGADO` (igual que hoy).
2. `PRUEBA` y el `waId` no coincide con ningún número de la lista → **`MODO_PRUEBA`**,
   un valor nuevo de `MotivoSinRespuesta`.
3. `SIN_TEXTO`, `SIN_MODELO`, `TOPE_MENSUAL`, igual que hoy.
4. `TOPE_CONVERSACION`, **salvo que el `waId` sea un número de prueba**.

El mensaje del cliente real se guarda igual, con su motivo: la regla de
**guardar siempre y decidir después** no cambia, y es la que permite mostrar
cuántos clientes escribieron durante la prueba.

`PRUEBA` con la lista vacía no le contesta a nadie. No es un error de
configuración; la pantalla lo avisa.

La lista se lee **sólo** cuando hace falta: en `PRUEBA` para el corte 2, y en
`TODOS` para la excepción del corte 4. Es una lectura local como las otras cuatro;
el camino antes del 200 sigue sin red.

La comparación vive en `lib/bot/numeros-de-prueba.ts` (`digitosDe`,
`validarNumeroDePrueba`, `coincideConAlguno`), y la usan el webhook, la acción de
agregar y la pantalla. Es una sola implementación, por la misma razón que existe
`SelectorDeCategoria`.

**Los números de prueba no tienen el tope de 12 respuestas por hora**, en
ningún modo. Ese tope defiende del ping-pong entre dos automatizaciones sobre un
número en coexistencia, y quien usa un número de prueba es una persona haciendo
preguntas a propósito: llega a 12 en diez minutos. Si hubiera un bucle, lo sigue
frenando el tope mensual, y el eco del propio número del local ya se descarta
antes de todos los cortes.

**Sí cuentan contra el tope mensual**: cada respuesta de prueba es una llamada
al modelo que se paga igual.

**Rollback y el valor nuevo del enum**: la imagen anterior no conoce
`MODO_PRUEBA`, y el Prisma viejo fallaría al deserializar una fila con ese
valor. Hoy no hay ningún camino que lo haga: `registrarEntrante` escribe con
`createMany` (no devuelve filas), `historialDe` filtra `motivo: null` en el
`WHERE`, y los topes son `count`. El test del caso fija ese invariante (ver
*Verificación*).

### 6. La pantalla

**Card "El bot".** El `Switch` pasa a ser un `ToggleGroup` de tres opciones, el
mismo control segmentado del alta de `/usuarios`. Debajo va una línea que depende
del modo:

- Apagado: "No le contesta a nadie. Los mensajes quedan guardados."
- Sólo prueba: "Contesta sólo a los números de prueba." Con la lista vacía:
  "Todavía no cargaste ningún número de prueba: no le contesta a nadie."
- Todos: "Les contesta a todos los que escriban."

Los dos toasts de hoy (falta a qué se dedica el local, falta la información del
local) salen al pasar a **Sólo prueba o a Todos**, no sólo a Todos: probar es
justo cuando conviene enterarse.

**Pasar a Todos pide una confirmación en dos toques sobre el mismo control**, y
es la única transición que la pide. El primer toque en "Todos" no cambia el modo:
arma la confirmación y la leyenda pasa a "Tocá de nuevo para que les conteste a
todos". El segundo toque confirma. Se desarma sola a los 3 segundos o si se toca
otra opción. Es el mecanismo de `AnularVenta`, sin diálogo. Bajar a Sólo prueba o
a Apagado no pide nada: es la dirección segura. Sin confirmación, un toque de más
sobre la opción vecina alcanzaría para mandar el bot a clientes reales.

**Card nueva, "Números de prueba"**, en la columna izquierda, debajo de "El bot".
Se ve siempre que haya número conectado, en cualquier modo, para poder armar la
lista antes de pasar a prueba.

- Un campo con el botón Agregar. Ayuda: "Con código de área, sin 0 y sin 15.
  Ej: 11 2233-4455".
- Una fila por número, con los últimos 10 dígitos como `112233-4455` (sin
  partir el código de área, cuyo largo varía de 2 a 4 dígitos), el botón quitar
  y una segunda línea: **"Todavía no escribió"** o **"Último mensaje: <fecha
  corta>"**, calculada contra `ConversacionBot.ultimoMensajeEn` con la misma
  `coincideConAlguno`. Esa línea es la verificación del número (decisión 2).
- Los errores de las acciones van por toast, con el patrón del ABM de
  categorías: menos de 10 dígitos, ya está cargado, tope de 20. Los errores no se
  auto-descartan.
- Con 20 números, el campo se deshabilita y lo dice.

**Card "Este mes".** En modo `PRUEBA`, si hubo entrantes con motivo
`MODO_PRUEBA` en el mes, suma una línea: "Mientras estuvo en prueba te
escribieron N clientes que no recibieron respuesta." Es un `count` más, y sólo
corre en ese modo.

**Encabezado.** El subtítulo muestra `<número> · Contestando`, `· En prueba` o
`· Apagado`.

**Teléfono.** No hay copia que duplicar: `CuerpoBot` es un solo árbol que se
apila, sin acciones en el Topbar para esto. El segmentado de tres opciones cortas
entra en 362 px; la fila de cada número apila el botón quitar debajo, como las
filas de unidades con IMEI.

### 7. Acciones y permisos

- `prenderOApagar(activo: boolean)` → `cambiarModo(modo: ModoBot)`.
  `alternarActivo` → `cambiarModo` en `lib/bot/administrar.ts`, que conserva la
  guarda de hoy: pasar a `PRUEBA` o a `TODOS` exige número conectado
  (`SIN_NUMERO`).
- `agregarNumeroDePrueba(texto: string)` y `quitarNumeroDePrueba(id: string)`.
  Quitar filtra por id **y** por tenant (la extensión de Prisma más RLS).
- `desconectar` deja `modo = APAGADO` (y `activo = false`, como hoy). La lista
  **no se borra**: si se reconecta el mismo local, los números siguen siendo sus
  números de prueba.

Las tres acciones van detrás de `exigirPermiso('BOT')` y de `botHabilitadoEn`,
como las cinco de hoy. **No hay permiso nuevo**: `BOT` ya cubre prender y apagar,
y elegir a quién le contesta el bot es la misma palanca. `lib/permisos/catalogo.ts`
no crece.

## Verificación

**Automática**, con los casos en las dos direcciones:

- `lib/bot/numeros-de-prueba.test.ts`: `digitosDe` con espacios, guiones, `+` y
  paréntesis; `validarNumeroDePrueba` rechaza 9 dígitos y 16, y acepta 10 y 13;
  `coincideConAlguno` iguala `11 2233-4455` con `+5491122334455`, y **no** iguala
  `011 15 2233-4455`. Ese último caso fija el límite de la decisión 2.
- `app/api/whatsapp/webhook/route.test.ts`:
  - En `PRUEBA`, un número de la lista recibe respuesta y otro queda con
    `MODO_PRUEBA`.
  - En `PRUEBA` con la lista vacía, nadie recibe respuesta.
  - Un número de prueba pasa las 12 respuestas por hora y uno que no es de prueba
    queda en `TOPE_CONVERSACION`.
  - En `TODOS`, un número que no es de prueba se contesta.
  - `APAGADO` sigue dando `BOT_APAGADO`.
- `lib/bot/administrar.test.ts`: `cambiarModo('PRUEBA')` deja `activo = false`,
  `cambiarModo('TODOS')` deja `activo = true`, y pasar a `PRUEBA` sin número
  conectado da `SIN_NUMERO`. Agregar rechaza el repetido (también el que coincide
  por los últimos 10), el de menos de 10 dígitos y el número 21. Quitar un id de
  otro tenant no borra nada.
- Invariante de rollback: con una fila `MODO_PRUEBA` en la conversación,
  `historialDe` la excluye sin fallar.
- `app/(app)/bot/acciones.test.ts`: las tres acciones rechazan sin `BOT` y fuera
  de `BOT_HABILITADO_EN`, y corren con los dos.
- `app/(app)/bot/page.test.tsx` y `formularios`: la card de números sólo con
  número conectado, la línea de "Todavía no escribió" y la de último mensaje, y
  la leyenda de la lista vacía en `PRUEBA`.

**Manual, después del merge** (`arandano-dev` sirve `main`):

1. Conectar el número sandbox de Kapso, cargar el celular propio como número de
   prueba y pasar a Sólo prueba.
2. Escribir desde ese celular y ver que contesta. Ver que la fila pasa a "Último
   mensaje".
3. Escribir desde otro celular y ver que no contesta, y que "Este mes" suma el
   cliente sin respuesta.
4. Tocar Todos una vez y ver que no cambia de modo. Esperar 3 segundos y ver que
   se desarma. Tocar dos veces y ver que cambia.
5. Cargar un número con `15` y ver que queda en "Todavía no escribió" aunque
   escriba.
6. Mirar las dos cards a 1440 y a 390 px.

## Deploy

La migración viaja con la UI en el mismo deploy. Contiene una tabla nueva, una
columna `modo` con default, un valor nuevo en `MotivoSinRespuesta`, un enum nuevo
y el backfill `modo = 'TODOS' WHERE activo`. No hay ningún `DROP` ni renombre.

Contra la imagen anterior:

- El código viejo no lee `modo` ni la tabla nueva.
- El código nuevo escribe `activo` de forma que la imagen vieja se calla en
  `PRUEBA` (decisión 4).
- Ningún lector viejo deserializa una fila con `MODO_PRUEBA` (decisión 5).

**`ALTER TYPE … ADD VALUE`** no puede usarse dentro de la misma transacción que lo
agrega. La migración no usa `MODO_PRUEBA` en ningún `UPDATE`, así que no choca,
pero el plan tiene que verificarlo corriendo `migrate dev` antes de dar la
migración por buena.

El `DROP COLUMN activo` queda anotado para un deploy posterior.

## Lo que este ciclo NO hace

- **Marcar como de prueba una conversación que ya llegó.** Se descartó a favor
  de tipear el número (decisión 2). Es aditivo si el campo resulta incómodo.
- **Nombre o alias por número** ("el celu de Juan"). Con pocos números, los
  dígitos alcanzan.
- **Normalizar `Cliente.telefono`** para cruzarlo con `waId`. Sigue siendo
  requisito del estado de una orden por WhatsApp. `digitosDe` puede servirle a
  ese ciclo, pero la comparación por últimos 10 dígitos no alcanza para
  identificar a un cliente, que es otra pregunta.
- **Una bandeja para leer las conversaciones de prueba.** El dueño las ve en su
  propio celular, que es desde donde prueba.

## La maqueta

`design/arandano.pen` no dibuja el control segmentado del bot ni la card
"Números de prueba", en ningún ancho. Se derivan del `ToggleGroup` de `/usuarios`
y de las filas de unidades de `/inventario/[id]`. Se anota en
`docs/correcciones-pendientes-del-pen.md`.
