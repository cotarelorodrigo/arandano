# Spec: permisos por usuario

**Fecha**: 2026-08-26

**Origen**: feedback de un dueño que dio de alta un usuario para sus empleados
— *"Que puedan agregar productos con precio de venta. Y solo mi usuario de
dueño pueda cargar los costos."* — y, sobre esa base, el pedido explícito del
dueño del producto de que **no sea una regla del producto sino una decisión de
cada local**: *"podemos tener un cliente que quiera esto para sus empleados y
otro que no. Si cada dueño puede ajustar los roles o permisos de sus empleados
sería genial."*

Ese segundo pedido es el que define el ciclo. El primero solo se resolvía
moviendo tres guardas de lugar; el segundo obliga a que la autorización deje de
estar escrita a mano en cada pantalla.

## El punto de partida, que es lo inverso de lo que se pidió

Vale escribirlo porque la intuición engaña: el pedido **no** es sacarle el costo
al empleado.

- **El alta de artículos hoy es sólo del dueño** (`comoDuenio`,
  `app/(app)/inventario/acciones.ts`). El empleado no puede cargar un producto
  ni con precio ni sin él. Lo primero que hay que hacer es **abrirle** el alta.
- **El costo hoy lo carga cualquiera con sesión**: el campo "Costo unitario" del
  ingreso de mercadería vive detrás de `conSesion`, no de `comoDuenio`. Y lo
  **ve** cualquiera: el tile "Último costo" con su margen, la columna Detalle
  del historial y el CSV no miran el rol en ningún lado.

O sea que el estado actual es exactamente el opuesto del pedido en las dos
mitades.

## Alcance

**Entra**: el mecanismo de permisos (modelo, guarda, catálogo), la conversión de
las **once** guardas de rol que hoy están hardcodeadas y pasan a ser
delegables, y la pantalla donde el dueño los ajusta, que es `/usuarios` y ya
existe. Las otras **cinco** guardas del repo —la pantalla `/usuarios` y sus
cuatro acciones— quedan exactamente como están; ver *Lo que NO es delegable*.

**No entra**, y cada uno con su motivo:

- **Roles personalizados** ("Vendedor", "Encargado", definidos por el dueño).
  Evaluado y descartado: agrega ABM de roles, la pregunta de qué pasa al borrar
  un rol con gente adentro, y obliga a que `User.rol` deje de ser un enum. Para
  un local de tres empleados no compra nada que los permisos por usuario no den
  ya. **No queda cerrado**: este ciclo es su cimiento — el día que haga falta,
  un rol es un nombre y un conjunto de permisos que ya existen.
- **Permisos sobre módulos que no están construidos** (caja, ARCA, catálogo,
  bot). El catálogo cubre lo que hoy tiene guarda; un permiso que no destraba
  nada es una promesa vacía en la pantalla.
- **Completar el costo de un ingreso después de hecho.** Se evaluó como salida
  para que el empleado reciba mercadería y el dueño le ponga el costo más tarde;
  es una capacidad nueva (editar un movimiento ya escrito) sobre una tabla que
  hoy sólo se escribe una vez. Ver *Lo que se pierde*, más abajo.
- **Auditoría de cambios de permisos.** Quién le dio qué a quién y cuándo. La
  tabla guarda `otorgado_en` y nada más; un log de otorgamientos y revocaciones
  es su propio ciclo, y hoy no hay a quién rendirle cuentas.

## El modelo

```prisma
enum Permiso {
  ARTICULOS_CREAR
  ARTICULOS_EDITAR
  COSTOS
  CATEGORIAS
  VENTAS_ANULAR
  ORDENES_ANULAR

  @@map("permiso")
}

model UsuarioPermiso {
  tenantId   String   @map("tenant_id") @db.Uuid
  usuarioId  String   @map("usuario_id") @db.Uuid
  permiso    Permiso
  otorgadoEn DateTime @default(now()) @map("otorgado_en") @db.Timestamptz(3)

  tenant  Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  usuario User   @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@id([tenantId, usuarioId, permiso])
  @@map("usuario_permisos")
}
```

Con la policy de siempre, palabra por palabra igual que `categorias`:

```sql
ALTER TABLE "usuario_permisos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "usuario_permisos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Cinco decisiones adentro de esas veinte líneas:

**La fila ES el permiso otorgado; su ausencia es la negación.** No hay columna
booleana ni tri-estado. Revocar es `DELETE`, no `UPDATE … SET false`. Esto es lo
que hace que **no exista backfill**: los usuarios que ya están en la base no
necesitan ninguna fila para quedar exactamente como están hoy, porque hoy no
pueden nada de esto.

**`permiso` es un enum de Postgres**, como `RolUsuario`, `TipoArticulo` y
`Modulo` ya en este schema. Agregar uno al catálogo es `ALTER TYPE … ADD VALUE`
—aditivo, sin reescribir la tabla— y a cambio la base rechaza escribir un
permiso que el catálogo no tiene. La alternativa (`String`) ahorraba esa
migración y a cambio dejaba que un typo se guardara sin que nadie se entere.

**No hay `otorgadoPorId`.** Sería la mitad de una auditoría: sin el registro de
las revocaciones, "quién se lo dio" no responde ninguna pregunta que alguien
vaya a hacer. O la auditoría entra completa en su propio ciclo, o no entra.

**Un empleado desactivado conserva sus filas**, y al reactivarlo vuelve con los
mismos permisos. Es lo coherente con cómo ya funciona la baja en este producto
—`User.desactivadoEn`, la fila es indestructible por la FK de `ventas`— y con lo
que uno espera al readmitir a alguien que se fue dos meses. Revocar es un acto
aparte y explícito.

**La FK a `users` no es compuesta con `tenant_id`**, igual que todas las demás
del schema. Es la limitación conocida —las FK de Postgres saltean RLS, anotada
en `CLAUDE.md` desde el ciclo de categorías— y **este ciclo no la arregla ni la
empeora**: cerrarla de verdad es un ciclo sobre el schema entero, y hacerlo sólo
acá dejaría la asimetría que el próximo ciclo copiaría al revés.

## El catálogo

Seis, cerrado en código, uno por cada guarda de rol que hoy está escrita a mano.
Vive en `lib/permisos/catalogo.ts` y es **la única fuente**: la pantalla lo
renderea desde ahí, no desde una lista escrita a mano al lado.

| Permiso | Qué destraba |
|---|---|
| `ARTICULOS_CREAR` | `/inventario/nuevo` y el alta de un artículo |
| `ARTICULOS_EDITAR` | editar, desactivar y reactivar un artículo que ya existe |
| `COSTOS` | ver el costo y el margen donde aparezcan, **y** cargarlos |
| `CATEGORIAS` | el ABM del árbol: crear, renombrar, mover, borrar |
| `VENTAS_ANULAR` | anular una venta |
| `ORDENES_ANULAR` | anular una orden de trabajo |

Cada entrada del catálogo lleva su nombre visible y una línea de ayuda —lo que
la pantalla muestra al lado del switch—, así que agregar un permiso es tocar un
archivo y no tres.

**`COSTOS` es uno solo y no dos** (ver / cargar). Cargar un costo que no podés
ver no es un caso que exista: el ingreso de mercadería te muestra lo que
acabás de escribir. Partirlo en dos daba cuatro combinaciones de las cuales dos
son absurdas.

**`ARTICULOS_CREAR` y `ARTICULOS_EDITAR` sí son dos**, y ésa es la asimetría a
propósito. Cargar un producto nuevo y cambiarle el precio a uno que se viene
vendiendo hace meses no tienen el mismo riesgo, y el pedido original nombra sólo
el primero.

## Cómo se pregunta

`lib/permisos/guarda.ts` gana `exigirPermiso(permiso)`, que reemplaza a
`exigirDuenio()` en los once lugares delegables. **No vive en
`lib/auth/sesion.ts`** —corrección post-implementación, I4 de la review final:
esta misma sección lo ubicaba ahí, y quedó sin corregir al escribirse el
código. `sesion.ts` resuelve *quién sos* desde el request; los permisos son
*qué podés* y consultan una tabla, así que meter esa consulta en `sesion.ts` le
sumaría una dependencia de base de datos que hoy no tiene (ver la sección
*Desvío del spec, decidido al planificar* del plan,
`docs/superpowers/plans/2026-08-26-permisos-por-usuario.md`, que es donde se
tomó la decisión en su momento). `exigirDuenio()` **sobrevive**, y no como
vestigio: es lo que sigue guardando `/usuarios` (ver más abajo).

**Un `DUENO` da verdadero sin tocar la tabla.** No es un atajo de performance:
es lo que garantiza que un dueño no pueda quedarse afuera de su propio local, y
lo que hace que no haya que otorgarle nada al crear un tenant. El único código
que consulta `usuario_permisos` es el que evalúa a un `EMPLEADO`.

**La carga va con `cache()` de React, no adentro de `sesionActual()`.** Meterla
en la sesión haría que toda pantalla pague una query que la mayoría no usa
—`sesionActual()` corre en cada layout y en cada página—; con `cache()` se
consulta a lo sumo una vez por request, y sólo si alguien pregunta. Para pintar
la UI, la misma función en su forma que no tira: `puede(permiso)`.

**La guarda real vive en el server action, no en la UI.** Esconder un botón es
comodidad para que la pantalla no ofrezca lo que no se puede hacer; lo que
autoriza es el `exigirPermiso` que está donde hoy está `exigirDuenio`. Es la
regla que el repo ya aplica en `servicio-tecnico/formularios.tsx` ("esconder el
botón acá es comodidad") y que este ciclo no cambia.

## Las once guardas que cambian

La fila de categorías son cuatro acciones (crear, renombrar, mover, borrar) y la
de `/usuarios` son cinco (la pantalla y sus cuatro acciones); por eso la tabla
tiene nueve filas y no dieciséis.

| Archivo | Hoy | Pasa a |
|---|---|---|
| `inventario/nuevo/page.tsx` | `exigirDuenio()` | `exigirPermiso(ARTICULOS_CREAR)` |
| `inventario/acciones.ts` → `altaArticulo` | `comoDuenio` | `ARTICULOS_CREAR` |
| `inventario/acciones.ts` → `guardarArticulo` | `comoDuenio` | `ARTICULOS_EDITAR` |
| `inventario/acciones.ts` → `bajaArticulo` | `comoDuenio` | `ARTICULOS_EDITAR` |
| `inventario/acciones.ts` → `reactivarArticuloAccion` | `comoDuenio` | `ARTICULOS_EDITAR` |
| `inventario/acciones.ts` → las cuatro de categorías | `comoDuenio` | `CATEGORIAS` |
| `ventas/acciones.ts` → anular | `exigirDuenio()` | `VENTAS_ANULAR` |
| `servicio-tecnico/acciones.ts` → anular | `exigirDuenio()` | `ORDENES_ANULAR` |
| `usuarios/page.tsx` y sus cuatro acciones | `exigirDuenio()` | **no cambia** |

Y las condicionales de render que hoy leen `rol === 'DUENO'` a mano:
`inventario/page.tsx` (el botón "Artículo nuevo", el `esDuenio` del panel de
categorías y el texto del vacío), `inventario/[id]/page.tsx` y
`inventario/formularios.tsx` (los botones del Topbar, el `<form>` de baja, los
`Resultado` y la card "Datos"), y `servicio-tecnico/[id]/page.tsx`. Cada una
pasa a preguntar por el permiso que corresponde en vez de por el rol.

## `COSTOS`, que toca cuatro lugares y no uno

Es el único permiso que además de destrabar una acción **esconde un dato**, así
que conviene enumerarlo entero:

1. **El tile "Último costo"** de `/inventario/[id]`, con su pie de margen. Sin
   el permiso, el tile no se renderea — no se muestra en "—", que sería mentir
   diciendo que no hay costo cargado.
2. **La columna Detalle del historial** (`historial.tsx`) **y el CSV de
   `exportarHistorialCsv`, que la reusan igual.** El CSV no tiene columna de
   costo propia —`ENCABEZADO_CSV` es `['Fecha', 'Motivo', 'Detalle', 'Cambio',
   'Queda', 'Usuario']`—: el costo de un ingreso viaja adentro de "Detalle",
   junto a la nota, armado por la función compartida `detalleDeMovimiento()`.
   Sin el permiso, esa función no recibe el costo y queda sólo la nota — en la
   tabla de la ficha y en el CSV a la vez, porque ambos llaman a la misma
   función. La exportación sigue siendo de cualquiera con sesión —exportar lo
   que la pantalla ya muestra no es una capacidad nueva—; lo que cambia es que
   exporta lo que **esa persona** puede ver.
3. **El campo "Costo unitario" del ingreso de mercadería**
   (`formularios.tsx`). Sin el permiso, el campo no se dibuja y el server lo
   ignora si llega igual.
4. **El campo "Costo unitario" del alta** (`formularios.tsx`), el del stock
   inicial. Mismo tratamiento.

Los puntos 3 y 4 son los que hay que blindar en el servidor y no sólo en la
UI: son un `<input name="costoUnitario">` que un `curl` puede mandar aunque la
pantalla no lo dibuje.

## Lo que NO es delegable

**`/usuarios` queda duro en `DUENO`**, pantalla y las cuatro acciones. Un
permiso que habilita a repartir permisos es una escalada de privilegios con
pasos de más: el empleado que puede editar usuarios se otorga los otros cinco y
listo. Que no esté en el catálogo no es un olvido, y el spec lo dice para que
nadie lo "complete" más adelante.

De ahí sale la regla general para cuando el catálogo crezca: **se delega lo que
opera el negocio; no se delega lo que reparte poder.**

## Los defaults, y lo que este ciclo le saca al empleado

**Un empleado nuevo arranca sin ningún permiso.** Es lo que pidió el dueño del
producto —un local lo activa y otro no— y además es exactamente el
comportamiento de hoy para cinco de los seis.

El sexto no, y hay que decirlo fuerte: **`COSTOS` apagado por default le saca al
empleado dos cosas que hoy tiene** — ver el costo y el margen, y cargarlo al
recibir mercadería. Es una regresión deliberada, es el pedido literal del dueño
que escribió el feedback, y **es gratis exactamente ahora**: todavía no hay
tenants reales. Dentro de seis meses sería sacarle una capacidad a gente que ya
la usa.

### Lo que se pierde, escrito antes de que alguien lo descubra

- **Un ingreso hecho por un empleado queda sin costo para siempre.** El schema
  ya lo dice de `MovimientoStock.costoUnitario`: es "una puerta de una sola
  dirección", no se backfillea. En un local donde el dueño no está a la mañana,
  el "Último costo" del artículo sólo se actualiza cuando recibe él. La salida
  —que el dueño complete el costo después— está en *No entra*, y el disparador
  para construirla es concreto: que a un dueño le moleste.
- **Un empleado con `ARTICULOS_CREAR` pero sin `CATEGORIAS`** puede cargar el
  artículo pero no inventar la rama del árbol. Lo guarda sin categoría, o
  espera al dueño. Es coherente —crear una rama es organizar el catálogo, no
  cargar un producto— pero es fricción real, y el par natural a otorgar juntos
  es ése.
- **Sin `ARTICULOS_EDITAR`, un empleado que se equivoca al cargar no puede
  corregirse.** Un precio mal tipeado queda mal hasta que lo vea el dueño. Es
  el costo aceptado de la asimetría crear/editar; el dueño que prefiera lo otro
  prende los dos switches.

## La pantalla

`/usuarios`, que ya existe. Por cada fila de **empleado**, un diálogo con los
seis switches, renderizados desde el catálogo. Las filas de dueño no lo
ofrecen: no hay nada que ajustar en alguien que puede todo por construcción.

**Cada switch guarda solo, con toast**, sin botón "Guardar". Es el patrón que
este repo ya eligió para el ABM de categorías, y trae con él las dos reglas que
ese ciclo dejó escritas y que acá aplican igual: **el toast se lanza en el
handler que ejecuta la acción, nunca en un `useEffect` sobre `useActionState`**,
y lleva **clave estable por acción y por usuario** para que sonner no apile una
copia por render. El `<Toaster>` ya está en el root layout; no se toca.

La fila muestra el conteo ("3 de 6 permisos") en su **propia columna
"Permisos"**, no al lado del chip de rol — corrección post-implementación, M2
de la review final: el código (`app/(app)/usuarios/formularios.tsx`) le da una
columna dedicada, entre "Estado" y "Acciones", y esta línea describía algo
distinto. El motivo es el mismo que el de la columna separada: el estado se
lee sin abrir nada, en cualquiera de los dos lugares.

**Deuda con la maqueta**: `design/arandano.pen` no dibuja este diálogo. Se
construye derivando de lo que la maqueta sí fija para `/usuarios`, y la entrada
va a `docs/correcciones-pendientes-del-pen.md` — igual que hizo el panel de
categorías, que es el precedente exacto.

## Deploy

La migración es **puramente aditiva**: un tipo nuevo y una tabla nueva. Nada se
borra ni se renombra, así que el rollback automático a la imagen anterior
encuentra una tabla que simplemente nadie consulta. **Por eso la migración y el
código pueden viajar en el mismo deploy**, a diferencia de los ciclos de
`Articulo.categoria` y `Caja`, donde la columna viajó sola: la razón de aquella
separación era que revertir la imagen no sirve si el código que quedó en
producción depende de una columna que la base no tiene, y acá `migrate deploy`
corre **antes** de promover la imagen, así que esa dependencia nunca queda
descubierta.

Es un **MINOR**: el cliente ve una pantalla nueva.

## Verificación

- `exigirPermiso`: un `DUENO` pasa sin que se consulte la tabla; un `EMPLEADO`
  sin la fila recibe 403; con la fila, pasa. Y la fila de **otro tenant** no
  sirve — es lo que ata el permiso a RLS y no sólo al `where`.
- **En las dos direcciones, como el resto del repo**: todo permiso del catálogo
  aparece en al menos un `exigirPermiso` del código (un permiso que no destraba
  nada es un switch que miente), y todo `exigirPermiso` usa un permiso del
  catálogo.
- **El catálogo y la pantalla, también en las dos direcciones**: los seis
  switches salen del catálogo, y no hay ningún switch escrito a mano al lado.
- Una acción por permiso, en sus dos formas: empleado sin permiso → rechazada;
  empleado con permiso → hace el efecto de verdad (el artículo queda creado, la
  venta queda anulada), no sólo devuelve 200.
- **`COSTOS`, los cuatro lugares**, y los dos del servidor con el campo mandado a
  mano por fuera de la pantalla.
- **`/usuarios` sigue siendo del dueño**: un empleado, tenga los seis permisos,
  no entra ni ejecuta sus acciones.
- La cobertura de RLS de la tabla nueva sale sola:
  `test/rls-cobertura.test.ts` enumera las tablas reales de `pg_class`, así que
  olvidar la policy rompe el build sin que nadie tenga que acordarse.
- `test/pantallas.test.ts` exige la sección de `/usuarios` actualizada en
  `docs/pantallas.md`.
- **Lo que ningún test cubre**: que el diálogo se vea bien. Queda para la
  verificación manual, sobre el canario de dev y con un empleado de verdad.

## Lo que sigue

- **Los permisos de lo que todavía no existe** (caja, ARCA, catálogo, bot):
  cada módulo suma su entrada al catálogo cuando se construye, y ése es el
  momento de decidir si su acción es delegable.
- **Roles personalizados**, si un local con muchos empleados hace que prender
  seis switches de a uno se vuelva molesto. El disparador es ése y no una
  cantidad de permisos: agrupar antes de que moleste es inventarse el problema.
- **La auditoría de otorgamientos y revocaciones**, el día que haya que
  responderle a alguien qué pasó.
