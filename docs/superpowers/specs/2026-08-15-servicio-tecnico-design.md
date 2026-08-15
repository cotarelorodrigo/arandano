# Spec: Servicio Técnico — recepción y seguimiento del equipo

Fecha: 2026-08-15

La pantalla que reemplaza al cuaderno del mostrador: recibir un equipo, saber
en qué anda cada uno, y darle al cliente un papel que diga qué dejó.

Es la primera parte del **módulo de Órdenes de trabajo**, la etapa 1 del roadmap
de producto de `CLAUDE.md` y el primer módulo del sistema. No es el módulo
entero: este ciclo llega hasta entregar el equipo, y deja los repuestos y el
cobro para el siguiente.

## Alcance, y por qué este corte

El ciclo completo que promete `CLAUDE.md` es *ingreso → diagnóstico →
presupuesto → aprobación del cliente → ejecución con repuestos → cierre y
cobro*. Este ciclo toma hasta la entrega, sin repuestos que descuenten stock y
sin cobro.

El motivo es el mismo que ya decidió el corte entre inventario y ventas: sin
feature flags, **el tamaño del deploy es el radio de daño**. El ciclo entero
tocaría, en un solo deploy, dos tablas nuevas del núcleo (`MovimientoStock`
cambiando su origen) más el motor de ventas (`crearVentaDesde`) además de sumar
cuatro pantallas. Cortado acá, el deploy agrega tablas nuevas y pantallas
nuevas, y no modifica una sola línea de código que hoy esté en uso — que es la
categoría de cambio más barata que existe en un sistema sin flags.

Y el corte deja algo que ya sirve solo: un local que recibe equipos y no sabe
cuál está listo tiene el problema resuelto el primer día. Cobrar por `/vender`
al entregar es lo que ese local ya hace hoy.

## Estado del que se parte

Verificado sobre el repo, no recordado:

- **No existe nada de módulos.** No hay directorio `modules/`, no hay registry,
  y `TenantModule` es una tabla que ninguna línea de código lee. Las pestañas
  son una lista literal en `components/navegacion.tsx`.
- **El núcleo está entero**: ventas, stock append-only, auth con roles, RLS,
  `enTransaccionDeTenant`, sistema de diseño con su test en las dos direcciones.
- **`Cliente` existe y la usa `Venta`**, pero **no hay ninguna pantalla de
  clientes**: nadie puede dar uno de alta desde la aplicación.
- **La aplicación es oscura** (`color-scheme: dark`, ciclo del 2026-08-13).
- **El barrido del smoke sale del sistema de archivos** y **corta el gate
  entero** si aparece una ruta con parámetro que nadie declaró en
  `RUTAS_SIN_SMOKE` con su razón escrita (`scripts/lib/rutas-comun.sh`).
- **RLS se cubre solo**: `test/rls-cobertura.test.ts` mira todas las tablas con
  `tenant_id` y exige policy con `USING` y `WITH CHECK`.

## Decisiones

### La pestaña es fija, no depende de `TenantModule`

Servicio Técnico se suma a la lista de `components/navegacion.tsx` y se ve en
**todos** los tenants, igual que las otras cuatro. No se construye el registry
de módulos en este ciclo.

Está anotado acá porque es una decisión con fecha de vencimiento, no una
omisión: **`CLAUDE.md` dice que una veterinaria no debería ver esta pestaña**, y
el archivo de navegación ya está escrito y comentado como el punto de extensión
donde ese registry va a engancharse. El costo aceptado es que el día que exista
un tenant que no sea de tecnología, sacarla se hace con datos de clientes
adentro en vez de con la tabla vacía.

**Lo que hace vencer esta decisión**: el primer tenant de un rubro sin servicio
técnico. Mientras el único vertical implementado sea locales de celulares, la
pestaña fija no le miente a nadie.

### El cliente es obligatorio, y se crea al vuelo

Una orden sin cliente no sirve: el punto de todo esto es saber a quién llamar.
`clienteId` es FK **no nullable** a `Cliente` — al revés que `Venta.clienteId`,
que es opcional porque la venta de mostrador anónima es la mayoría de las
ventas.

En la pantalla de recepción se busca por nombre o teléfono y, si no está, se lo
crea ahí mismo con nombre y teléfono, sin salir. **No se construye `/clientes`**
—listado, edición, historial— en este ciclo: es una segunda sección nueva en el
mismo deploy, justo lo que el corte de arriba evita.

Usar la tabla que ya existe, en vez de guardar nombre y teléfono sueltos, es lo
que hace que "todo lo de Juan" sea una consulta y no una búsqueda de texto: sus
órdenes y sus ventas cuelgan del mismo `clienteId`.

### Estado actual como columna, historia como bitácora append-only

`OrdenDeTrabajo.estado` guarda el estado de hoy; `EventoOrden` registra cada
transición y **nada se edita ni se borra**.

Es exactamente el patrón que el núcleo ya eligió para el stock —`Articulo.stock`
como caché, `MovimientoStock` como fuente de verdad— y por el mismo motivo: la
pregunta que se hace cuando el cliente reclama no es "¿en qué estado está?" sino
**"hace dos semanas que está acá, ¿qué pasó?"**. Un modelo de sólo columnas la
deja sin respuesta.

Las dos alternativas quedaron descartadas: columnas de fecha por hito
(`diagnosticadoEn`, `entregadoEn`) no guardan quién hizo cada cambio ni una nota
por paso, y una orden que va y viene entre estados pisa su propia fecha. Estado
derivado del último evento, sin columna, es imposible de desincronizar pero
obliga al tablero —la pantalla que más se abre— a un join y un orden por cada
orden en cada carga.

### `SIN_REPARACION` y `RECHAZADO` no son el final

El equipo sigue en el estante hasta que el cliente lo viene a buscar. El estado
terminal es siempre **`ENTREGADO`**: se entrega arreglado, se entrega sin
arreglar, o se entrega porque el cliente no aceptó el presupuesto.

Que se haya entregado sin arreglar no se pierde en el camino: sale de la
bitácora, que es justamente para eso. Modelarlo como dos finales distintos
dejaría al tablero sin poder contestar "¿qué equipos están todavía acá?", que es
la pregunta que se hace mirando el estante.

`ENTREGADO → EN_REPARACION` queda permitido **a propósito**: es el equipo que
vuelve por garantía. Hoy eso es una orden nueva en el cuaderno, que pierde la
historia de la anterior.

### Anular es una columna, no un estado

`anuladaEn` / `anuladaPorId`, igual que `Venta`. Como estado, anular pisaría el
estado anterior y no habría de dónde reconstruirlo — y se puede anular desde
cualquier punto del ciclo, así que no encaja en el grafo de transiciones.

### El correlativo va sin huecos

`OrdenDeTrabajo.numero` es por tenant y se incrementa con `UPDATE … RETURNING`
**adentro de la transacción del alta**, con `Tenant.proximoNumeroOrden`. Mismo
mecanismo y misma razón que `Venta.numero`: es el número que el cliente lee del
ticket y dice por teléfono, así que el hueco acá **es** el problema.

Es la decisión inversa a la de `Tenant.proximoSkuArticulo`, que sí tolera huecos
porque un SKU es un código opaco que nadie recita. Las dos siguen siendo
correctas y no hay que armonizarlas.

### El alta es idempotente

`claveIdempotencia` con `@@unique([tenantId, claveIdempotencia])`, nullable, y el
mismo mecanismo ya escrito en `lib/ventas/crear.ts`: el formulario genera una
clave por orden y la manda escondida.

Un doble click acá no cobra dos veces, pero **imprime dos tickets con números
distintos para un solo equipo**, y el cliente se lleva uno de los dos. El índice
único entra ahora, con la tabla vacía, por el mismo motivo que el de ventas:
crearlo después es un bloqueo sobre datos de clientes.

### La clave de desbloqueo se guarda en texto plano y no se imprime

El técnico la necesita para probar que el arreglo funcionó. Se guarda en texto
plano en la base compartida, se ve en pantalla, y **no aparece en el ticket** —
ni en la copia del local, que queda pegada al equipo en el estante.

Es una credencial de otra persona, así que la decisión va escrita y no implícita
en un campo que aparece: RLS la aísla entre tenants como a cualquier otra
columna, pero adentro del local la ve cualquiera con sesión. Hashearla no es una
opción — el técnico tiene que poder **leerla**, no compararla.

Que no se imprima lo asegura un test del ticket, no la memoria de quien edite el
archivo después.

### Lo que no entra, y por qué

- **Fotos del equipo.** Hoy el proyecto no tiene almacenamiento de archivos de
  ningún tipo: ni bucket, ni subida, ni ruta que sirva imágenes validando
  tenant, ni cobertura en el backup (`pg_dump` no se lleva archivos). Y una
  térmica no las imprime. Es su propio ciclo, con las tres preguntas que trae:
  dónde se guardan, quién las ve, y cómo entran al backup. `danosVisibles` en
  texto cubre el grueso del reclamo mientras tanto.
- **Repuestos que descuenten stock.** Es lo que obliga a cerrar la decisión
  abierta de `MovimientoStock` que `CLAUDE.md` tiene anotada: su único origen
  hoy es `ventaId`, una FK concreta, y las dos salidas conocidas —columna
  nullable por módulo, o el par `(origenTipo, origenId)` sin FK— tienen costos
  distintos. `CLAUDE.md` pide elegir **con el módulo de órdenes de trabajo en la
  mano**, y este ciclo no la elige a propósito: la elige el ciclo de repuestos,
  que es cuando el costo de elegir mal se ve de verdad.
- **El cobro.** Al entregar se cobra por `/vender`, como el local hace hoy. El
  punto de extensión `crearVentaDesde` que promete `CLAUDE.md` entra con el
  ciclo de repuestos, que es cuando la orden tiene ítems que llevar a una venta.
- **El presupuesto con ítems.** `montoEstimado` es un número, no un documento.
  Alcanza para decirle un precio al cliente y para que el estado
  `PRESUPUESTADO` signifique algo.
- **El aviso automático al cliente.** El bot de WhatsApp no existe todavía. El
  teléfono del cliente es un link `tel:` en el detalle.

## Modelo de datos

Todo aditivo: dos tablas, un enum, dos columnas en `tenants`. Ningún drop y
ningún rename, así que el rollback a la imagen anterior sigue funcionando —
que es la condición que `CLAUDE.md` le pone a toda migración por no haber flags.

```prisma
enum EstadoOrden {
  RECIBIDO
  EN_DIAGNOSTICO
  PRESUPUESTADO
  EN_REPARACION
  LISTO
  ENTREGADO
  SIN_REPARACION
  RECHAZADO

  @@map("estado_orden")
}

model OrdenDeTrabajo {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  // Sin huecos, por tenant: es el número que el cliente lee del ticket.
  numero   Int
  // Ver lib/ventas/crear.ts: la misma clave, el mismo motivo. Acá el doble
  // submit no cobra dos veces, imprime dos tickets para un solo equipo.
  claveIdempotencia String? @map("clave_idempotencia")

  // NO nullable, al revés que Venta.clienteId: una orden sin cliente no sirve,
  // porque el punto es saber a quién llamar.
  clienteId     String      @map("cliente_id") @db.Uuid
  recibidaPorId String      @map("recibida_por_id") @db.Uuid
  estado        EstadoOrden @default(RECIBIDO)

  equipoMarca  String  @map("equipo_marca")
  equipoModelo String  @map("equipo_modelo")
  // IMEI o número de serie. Opcional: hay equipos que entran sin encender.
  equipoSerie  String? @map("equipo_serie")
  // Texto plano y legible a propósito: el técnico tiene que USARLA, no
  // compararla. No se imprime nunca — ver la decisión con su nombre.
  claveDesbloqueo String? @map("clave_desbloqueo")

  // Lo que dijo el cliente. Obligatorio: es el motivo por el que el equipo está
  // acá, y va impreso en las dos copias.
  fallaDeclarada String  @map("falla_declarada")
  accesorios     String?
  danosVisibles  String? @map("danos_visibles")

  // Lo que encontró el técnico. Se carga después de recibir.
  diagnostico   String?
  // En pesos. Decimal y nunca Float, como todo importe del schema.
  montoEstimado Decimal? @map("monto_estimado") @db.Decimal(12, 2)

  // Anular es columna y no estado: como estado pisaría el estado anterior.
  anuladaEn    DateTime? @map("anulada_en") @db.Timestamptz(3)
  anuladaPorId String?   @map("anulada_por_id") @db.Uuid

  creadoEn      DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant     Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Restrict: borrar un cliente no puede borrar la historia de sus equipos.
  cliente    Cliente @relation(fields: [clienteId], references: [id], onDelete: Restrict)
  recibidaPor User   @relation("OrdenesRecibidas", fields: [recibidaPorId], references: [id], onDelete: Restrict)
  anuladaPor  User?  @relation("OrdenesAnuladas", fields: [anuladaPorId], references: [id], onDelete: Restrict)

  eventos EventoOrden[]

  @@unique([tenantId, numero])
  @@unique([tenantId, claveIdempotencia])
  // El tablero filtra por estado y ordena por fecha: es su índice.
  @@index([tenantId, estado, creadoEn])
  @@index([tenantId, clienteId])
  @@map("ordenes_de_trabajo")
}

// Append-only, como movimientos_stock: nada se edita ni se borra.
model EventoOrden {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  ordenId  String @map("orden_id") @db.Uuid

  // Null en el evento de apertura, que no viene de ningún estado.
  desde EstadoOrden?
  hasta EstadoOrden
  nota  String?

  usuarioId String   @map("usuario_id") @db.Uuid
  creadoEn  DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orden   OrdenDeTrabajo @relation(fields: [ordenId], references: [id], onDelete: Cascade)
  usuario User           @relation(fields: [usuarioId], references: [id], onDelete: Restrict)

  @@index([tenantId, ordenId, creadoEn])
  @@map("eventos_orden")
}
```

Y en `Tenant`, junto a los otros dos correlativos:

```prisma
proximoNumeroOrden Int @default(1) @map("proximo_numero_orden")
```

Más las relaciones inversas que Prisma exige del otro lado, que no agregan
columnas: `ordenes` y `eventosOrden` en `Tenant`, `ordenes` en `Cliente`, y en
`User` las tres nombradas — `ordenesRecibidas`, `ordenesAnuladas` y
`eventosOrden`.

Las dos tablas llevan `tenant_id` y su policy de RLS con `USING` y `WITH CHECK`.
No hay que agregarlas a ninguna lista: `test/rls-cobertura.test.ts` las levanta
del catálogo de Postgres y falla si les falta la policy.

## El ciclo de estados

```
RECIBIDO → EN_DIAGNOSTICO → PRESUPUESTADO → EN_REPARACION → LISTO → ENTREGADO
                  ↓               ↓                                     ↑
           SIN_REPARACION     RECHAZADO ────────────────────────────────┘
```

Las transiciones válidas se declaran en un solo archivo,
`lib/ordenes-de-trabajo/estados.ts`, y el server action las valida — la UI
muestra sólo los botones válidos, pero la UI no es la que decide.

| Desde | Hacia |
|---|---|
| `RECIBIDO` | `EN_DIAGNOSTICO`, `PRESUPUESTADO`, `EN_REPARACION`, `SIN_REPARACION` |
| `EN_DIAGNOSTICO` | `PRESUPUESTADO`, `EN_REPARACION`, `SIN_REPARACION` |
| `PRESUPUESTADO` | `EN_REPARACION`, `RECHAZADO`, `SIN_REPARACION` |
| `EN_REPARACION` | `LISTO`, `PRESUPUESTADO`, `SIN_REPARACION` |
| `LISTO` | `ENTREGADO`, `EN_REPARACION` |
| `SIN_REPARACION` | `ENTREGADO` |
| `RECHAZADO` | `ENTREGADO` |
| `ENTREGADO` | `EN_REPARACION` |

Las que parecen raras y no lo son:

- **`RECIBIDO → EN_REPARACION`** salteando el diagnóstico: la pantalla rota que
  se sabe qué es y cuánto sale no necesita diagnosticarse.
- **`EN_REPARACION → PRESUPUESTADO`**: se abrió el equipo y apareció algo más.
  Hay que volver a hablar con el cliente.
- **`LISTO → EN_REPARACION`**: no quedó bien y vuelve al banco antes de que el
  cliente lo retire.
- **`ENTREGADO → EN_REPARACION`**: la garantía.

Anular sale del grafo: se puede desde cualquier estado, sólo el dueño, y deja su
evento en la bitácora igual.

## Las pantallas

```
app/(app)/servicio-tecnico/page.tsx              el tablero
app/(app)/servicio-tecnico/acciones.ts           server actions
app/(app)/servicio-tecnico/formularios.tsx       'use client'
app/(app)/servicio-tecnico/nuevo/page.tsx        recepción
app/(app)/servicio-tecnico/[id]/page.tsx         detalle y seguimiento
app/(app)/servicio-tecnico/[id]/ticket/page.tsx  el papel
lib/ordenes-de-trabajo/{crear,estados,buscar,errores}.ts
```

Mismo reparto que `/inventario` y `/ventas`: página de servidor que consulta con
`prismaParaTenant`, server actions que **reexigen** el rol (la UI que esconde un
botón no es un permiso), formularios `'use client'` con `useActionState`, y el
dominio afuera en `lib/`.

**El tablero.** Por defecto, las abiertas — todo lo que no está entregado ni
anulado — ordenadas **de la más vieja a la más nueva**, al revés que `/ventas`.
No es un detalle de gusto: en ventas lo último es lo que importa, y acá lo que
duele es el equipo que lleva tres semanas en el estante. Arriba, contadores por
estado que funcionan como filtro; el que más se va a apretar es **Listo**, que
son los clientes a los que hay que llamar. Buscador por número, cliente, modelo
o IMEI, y paginación como inventario.

**La recepción.** Un formulario. El cliente se resuelve ahí mismo: buscador por
nombre o teléfono, y alta al vuelo con nombre y teléfono si no está. Al guardar,
la orden y su primer evento de bitácora nacen en **la misma transacción**, y la
pantalla deja directo en el ticket.

**El detalle.** Los datos del equipo, el cliente con el teléfono como link
`tel:`, la clave de desbloqueo visible, y los botones de las transiciones
**válidas desde el estado actual** — no una lista de ocho donde elegir
cualquiera. El diagnóstico y el monto estimado se cargan acá, cada cambio con su
nota opcional. Abajo, la bitácora completa. Reimprimir el ticket, y anular, que
sólo ve el dueño.

## El ticket

Ticket térmico de 80 mm, las dos copias en **una sola impresión** sobre el rollo
continuo, separadas por la línea de corte y rotuladas **COPIA CLIENTE** y
**COPIA LOCAL**.

Lleva: nombre del local, el número de orden en grande, fecha y hora, cliente y
teléfono, marca, modelo, IMEI o serie, falla declarada, accesorios, daños
visibles y quién recibió. La copia del local deja el espacio de firma. **No
lleva la clave de desbloqueo.**

Dos cosas que salieron de mirar el repo y que definen cómo se construye:

- **La aplicación es oscura.** El ticket tiene que salirse de esa paleta entero:
  negro sobre blanco, porque el fondo es el papel y una térmica imprime un solo
  color. Eso es una excepción al sistema de diseño y va **declarada en
  `docs/sistema-de-diseno.md` con su razón**, que es el mecanismo que ese
  documento ya tiene para las excepciones — no un color suelto en un CSS.
- **La página vive bajo `(app)`**, así que hereda el guard de sesión sin que
  nadie se acuerde. El header y el pie del shell se ocultan sólo al imprimir
  (`@media print`, en el archivo de estilos del ticket). La alternativa —un
  grupo de rutas aparte con layout propio— pedía dos excepciones declaradas
  (`FUERA_DEL_GRUPO` y `RUTAS_SIN_SMOKE`) más un `exigirSesion()` duplicado, a
  cambio de nada que se vea en el papel.

`@page { size: 80mm auto; margin: 0 }`. La página dispara `window.print()` sola
al cargar y sigue funcionando con Ctrl+P si el JavaScript no corre — como el
resto de las pantallas.

## Permisos

| Acción | Quién |
|---|---|
| Ver el tablero, el detalle y la bitácora | Cualquiera con sesión |
| Recibir un equipo, cambiar de estado, diagnosticar, presupuestar, entregar | Cualquiera con sesión |
| Imprimir y reimprimir el ticket | Cualquiera con sesión |
| Anular una orden | Sólo dueño |

Mismo corte que el resto del sistema: **lo que decide el negocio contra lo que
decide el mostrador**. Recibir un equipo y moverlo de estado es la operación del
día, la hace quien está atendiendo, y no queda anónima — cada evento de la
bitácora lleva su `usuarioId`, así que la trazabilidad es la firma y no un
permiso denegado. Anular es lo único destructivo del módulo, y va del lado del
dueño por el mismo motivo que la anulación de venta.

El monto estimado lo carga cualquiera: a diferencia del precio de catálogo —que
es una decisión comercial permanente— un presupuesto es una conversación con un
cliente concreto, y quien la tuvo es quien está en el mostrador.

## Cómo se verifica

- **`test/ordenes-de-trabajo.test.ts`**: el correlativo sin huecos con altas
  concurrentes, las transiciones válidas y el rechazo de las inválidas, la
  bitácora que registra cada cambio con su usuario, la idempotencia del alta,
  la anulación restringida al dueño, y el aislamiento entre tenants.
- **Test de render del ticket**: que estén las dos copias rotuladas, que esté el
  número, y que **la clave de desbloqueo no aparezca en el cuerpo**. Es lo que
  convierte esa decisión en algo que un editor futuro no puede deshacer sin
  romper el build.
- **`app/(app)/servicio-tecnico/acciones.test.ts`**: que cada action reexija
  sesión y rol, como los de inventario y ventas.
- **RLS**: sale gratis, `test/rls-cobertura.test.ts` levanta las tablas del
  catálogo.
- **`test/rutas-con-guard.test.ts`**: las cuatro pantallas quedan bajo `(app)`,
  así que pasa sin excepciones.
- **Smoke**: `/servicio-tecnico` y `/servicio-tecnico/nuevo` entran solas al
  barrido del gate. Las dos con `[id]` van declaradas en `RUTAS_SIN_SMOKE`
  **con su razón escrita**, o el gate no arranca — mismo argumento que
  `/ventas/[id]`: no hay de dónde sacar un id válido sin sembrar datos, y
  sembrarlos convertiría el smoke en una suite de fixtures.
- **`docs/schema.md`** lo regenera el hook de pre-commit; el paso 3 de
  `deploy.sh` falla si quedó desactualizado.

**Y una verificación que ningún test hace: imprimir el ticket de verdad en la
térmica.** Si el texto entra en 80 mm, si la línea de corte cae donde tiene que
caer, si el número se lee de lejos — eso lo ve una persona con el papel en la
mano. Va como paso de cierre del ciclo, igual que la verificación visual del
punto de venta, y se anota acá cuando se haya hecho.

Para poder mirar algo hay que tener algo: un sembrador de órdenes de dev en la
línea de `scripts/sembrar-ventas-dev.mts`, con equipos de nombres largos y
cortos y fallas de uno y de cinco renglones. Con datos parejos no se ve si el
ticket desborda — la misma lección que dejó el sembrador de ventas con los
importes de distinta cantidad de dígitos.

## Migración y deploy

Aditiva y en un solo deploy: dos tablas, un enum, dos columnas en `tenants`
(`proximoNumeroOrden` y nada más en las existentes). Sin drops ni renames, así
que la imagen anterior sigue corriendo contra el schema nuevo y el rollback
automático mantiene su red.

Sube **MINOR**: es una pantalla que el cliente ve.

## Lo que sigue

En orden, cada uno con su propio ciclo de spec → plan → implementación:

1. **Repuestos**, que descuentan stock. Es el ciclo que cierra la decisión
   abierta de `MovimientoStock` (origen del movimiento), con el módulo en la
   mano como pide `CLAUDE.md`.
2. **El cobro**, que estrena el punto de extensión `crearVentaDesde`: entregar
   deja de mandar a `/vender` a mano y genera la venta con los ítems de la orden.
3. **Fotos del equipo**, con las tres preguntas que traen: almacenamiento, quién
   las ve, y backup.
4. **El registry de módulos**, que es lo que le saca la pestaña a la veterinaria.
5. **`/clientes`** como sección propia: listado, edición e historial de un
   cliente cruzando sus órdenes con sus ventas.

## Riesgos

- **La pestaña fija es deuda con fecha.** Está aceptada arriba con su límite; el
  riesgo real es que se olvide de que es deuda. El primer tenant de un rubro sin
  servicio técnico es el disparador.
- **El núcleo puede quedar con forma de servicio técnico**, que es el riesgo que
  `CLAUDE.md` ya nombra. Este ciclo lo mitiga sin querer: no toca ni un punto de
  extensión del núcleo, porque no llega a repuestos ni a cobro. El ciclo que
  sigue es el que lo pone a prueba de verdad.
- **La clave de desbloqueo es dato sensible de un tercero** — del cliente del
  local, no del local. Está aislada por RLS como todo lo demás, pero adentro del
  tenant la ve cualquiera con sesión, y no está cifrada en reposo. Es la primera
  columna del schema con esa forma, y vale revisarla el día que haya política de
  retención: una orden entregada hace dos años no necesita seguir guardando el
  PIN de nadie.
