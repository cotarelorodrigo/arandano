# Spec: borrar un artículo

**Fecha**: 2026-09-07

**Origen**: pedido del dueño del producto — *"necesitamos agregar la feature de
que se pueda eliminar un producto del inventario (no sólo desactivarlo). Más que
nada porque si se carga un producto dos veces por algún error"*.

Hoy el catálogo sólo sabe **desactivar** (`Articulo.desactivadoEn`), y eso es lo
correcto para un artículo que se dejó de vender: su historial y sus ventas
siguen ahí, y el artículo desaparece de las pantallas de operación. Pero es la
respuesta equivocada para un artículo que **nunca debió existir**. Un duplicado
cargado por error no tiene historia que preservar: desactivarlo lo deja para
siempre en el listado con el chip de "Desactivado", ensuciando el catálogo con
una fila que no significa nada y que dentro de seis meses nadie va a saber por
qué está.

Son dos actos distintos y hoy el producto sólo tiene uno.

## Lo que este ciclo revierte, y por qué es legítimo

`prisma/schema.prisma` afirma hoy, en el comentario de `Articulo.desactivadoEn`:

> Un artículo que se deja de vender NO se borra: la FK de movimientos_stock y la
> de venta_items son Restrict a propósito —borrarlo se llevaría la historia de
> lo que se vendió—, así que se desactiva.

Ese comentario **se reescribe en este ciclo**, y conviene ver que el argumento
que lo sostenía no se pierde: sigue siendo cierto que borrar un artículo
**vendido** se llevaría la historia de lo que se vendió, y por eso ese caso se
sigue prohibiendo — ahora explícitamente y con un mensaje, en vez de por
ausencia de un botón. Lo que la afirmación mezclaba en una sola regla eran dos
cosas distintas: "no se borra lo que se vendió" (que se mantiene, y se
endurece) y "no se borra nada nunca" (que era el efecto colateral de no tener
la primera escrita en ningún lado).

## El principio

**Borrar es para lo que nunca existió de verdad.** Un artículo que no produjo
ninguna venta no tiene nada que explicarle a nadie: se puede ir entero, con su
historial de stock y sus unidades, y el catálogo queda como si el error no
hubiera pasado. Un artículo que vendió una sola vez ya es parte de la historia
de la plata del local, y ésa no se toca.

Desactivar no se va a ningún lado ni cambia: sigue siendo la respuesta para el
artículo que se dejó de vender.

## La regla

**Frena el borrado una sola cosa: que exista al menos una línea de venta**
(`venta_items`) que apunte al artículo.

- **Las ventas anuladas también frenan.** Anular es un `UPDATE` sobre `ventas`
  (`lib/ventas/anular.ts`): la venta queda marcada y el stock vuelve, pero sus
  `venta_items` siguen en pie. Es correcto que frenen — una venta anulada es un
  hecho que pasó y que el listado sigue mostrando.
- **Todo lo demás se va con el artículo**: sus movimientos de stock (ingresos,
  correcciones por conteo, altas con stock inicial, bajas de unidades) y sus
  unidades identificadas, vendidas nunca —no puede haberlas— pero sí libres o
  dadas de baja.
- **Estar desactivado no cambia nada.** Un artículo dado de baja se borra igual
  si nunca se vendió, y uno activo también. Lo único que decide es la venta.

## El modelo

### Las tres FKs que cambian, y la que no

| FK | Hoy | Queda | Por qué |
|---|---|---|---|
| `MovimientoStock.articuloId` | `Restrict` | `Cascade` | El historial de stock es del artículo y se va con él |
| `UnidadDeArticulo.articuloId` | `Restrict` | `Cascade` | Las unidades identificadas, igual |
| `MovimientoStock.unidadId` | `Restrict` | `NoAction` | Ver abajo: si no, el borrado en cascada choca contra sí mismo |
| `VentaItem.articuloId` | `Restrict` | **`Restrict`** | **Es el guard.** No se toca |

### El guard es la base, no el chequeo de la aplicación

Que `VentaItem.articuloId` se quede en `Restrict` no es "no hacer nada": es la
decisión central del ciclo. Postgres se niega a borrar un artículo con líneas
de venta, así que la regla se sostiene **aunque el chequeo previo de la
aplicación falle, se olvide o llegue tarde**.

`borrarArticulo` igual cuenta las ventas antes de borrar, pero **eso es para
poder escribir un mensaje que se entienda**, no para garantizar nada. Si entre
el conteo y el `DELETE` alguien cobra ese artículo en el mostrador, el `DELETE`
revienta contra la FK y el error se traduce al mismo código. Es exactamente el
criterio que este repo ya aplica en la idempotencia del cobro (el índice único,
no el `findFirst` previo) y en la carrera por una unidad (el `updateMany`
condicional, no el `findFirst`).

### `MovimientoStock.unidadId` tiene que pasar a `NoAction`

Un artículo con serie se lleva puestas dos tablas a la vez: sus movimientos y
sus unidades. Y `movimientos_stock.unidad_id` apunta a `unidades_articulo`. En
Postgres, `RESTRICT` se evalúa **inmediatamente**, sin esperar al final de la
sentencia; `NO ACTION` es diferible y tolera que la fila que referencia
desaparezca en la misma sentencia. Con las dos cascadas disparando a la vez,
`RESTRICT` sobre `unidad_id` puede abortar el borrado por una fila que se está
yendo igual.

`NoAction` y no `Cascade` a propósito: fuera de este camino, ninguna unidad se
borra jamás —darla de baja es una columna (`bajaEn`), como anular una venta—,
así que `Cascade` estaría describiendo un flujo que no existe. Lo que se
necesita es sólo que el chequeo no se adelante.

### El append-only de `movimientos_stock` queda con una puerta, y hay que escribirlo donde se lee

`scripts/setup-db-roles.sh:160` hace `REVOKE UPDATE, DELETE ON
public.movimientos_stock FROM arandano_app`, y el comentario que lo acompaña es
el argumento entero: sobre ese append-only se apoya la promesa de poder
contestar *"por qué tengo 3 y no 5"*. Ese mismo bloque, unas líneas más abajo,
revoca `DELETE` sobre `ordenes_de_trabajo` **justamente para tapar la puerta de
atrás de una cascada** que borraría `eventos_orden` sin tocar nunca la tabla
recién cerrada.

Este ciclo abre esa puerta, acotada, sobre `movimientos_stock`. Las acciones de
FK las ejecuta el sistema y no pasan por el chequeo de privilegios del rol que
llama, así que el `REVOKE` sigue en pie y sin embargo el borrado del artículo se
lleva sus movimientos.

**Se acepta**, con dos razones:

1. La promesa del append-only era poder explicar el stock de un artículo **que
   existe**. Cuando el artículo entero desaparece no queda ningún número sin
   explicación: no hay un "tengo 3" que contestar.
2. Lo que se borra por esta puerta nunca produjo una venta. Son ingresos y
   correcciones de un artículo que no movió plata.

**Y se documenta en `scripts/setup-db-roles.sh`, en ese mismo bloque**, no sólo
acá: quien lea el `REVOKE` tiene que enterarse ahí de que existe una cascada que
lo esquiva, porque el argumento escrito al lado dice lo contrario.

### RLS y la cascada

`CLAUDE.md` ya deja anotado que las FK de Postgres saltean RLS. Acá no abre
nada: la fila que se borra es `articulos`, y ésa **sí** está protegida por su
policy `tenant_aislamiento`, así que un artículo de otro tenant no se borra
—es invisible— y sus movimientos no se pueden alcanzar por la cascada de un
borrado que nunca ocurre.

**Y hay una segunda pregunta, sobre las filas que la cascada SÍ alcanza**
(hallazgo M6, review de la rama): el análisis de arriba mira sólo la fila
`articulos` que se borra, no las de `movimientos_stock`/`unidades_articulo`
que se van con ella. Como ninguna FK del schema es compuesta con `tenant_id`
—el mismo hallazgo que ya deja anotado `CLAUDE.md` para las FK en general—,
nada impide por estructura que una fila de esas dos tablas tenga un
`tenant_id` propio y un `articulo_id` que apunte a un artículo de OTRO tenant.
Antes de este ciclo, con `Restrict`, una fila así habría **bloqueado** el
`DELETE` con una violación de FK (el mismo modo de falla que el test de la
carrera ejercita contra `venta_items`, que se queda en `Restrict`). Con
`Cascade`, esa misma fila mal-tenanteada **se borra en silencio** junto con el
artículo ajeno, sin ningún error. **Hoy es inalcanzable**: ningún camino de la
aplicación puede escribir una fila de `movimientos_stock`/`unidades_articulo`
con un `tenant_id` que no coincida con el de su `articulo_id` — `enTransaccionDeTenant`
fija el `tenant_id` de la sesión antes de cualquier INSERT, y todo escritor de
estas dos tablas pasa por ahí. Pero la CONSECUENCIA sí cambió con este ciclo
—de "bloquea" a "borra en silencio"— y valía la pena dejarla escrita, para
que el día que alguien abra un camino de escritura nuevo sepa que esa garantía
ya no está.

### La migración es inerte

Dos migraciones, por separado como manda el precedente
(`permiso_planes_pago`, `permiso_bot`):

1. Los tres `DROP CONSTRAINT` / `ADD CONSTRAINT` de las FKs.
2. `ALTER TYPE "permiso" ADD VALUE 'ARTICULOS_BORRAR'`.

**Ninguna columna se borra ni se renombra, y la imagen anterior corre igual**:
el código viejo no borra artículos por ningún camino, así que las cascadas
nuevas jamás se disparan, y un valor de enum que ningún código viejo puede
producir —otorgarlo requiere la pantalla nueva— no aparece en ninguna fila que
la imagen vieja tenga que leer. La migración y la UI viajan en el **mismo
deploy**, con el mismo argumento que el ciclo del precio en USD: expand/contract
exige que el schema nuevo soporte la versión anterior del código, no que la
migración vaya en un deploy aparte.

`docs/schema.md` se regenera con `scripts/generar-erd.sh` — el hook de
pre-commit y el paso 3 de `deploy.sh` lo verifican, así que no es opcional.

## El motor

### `borrarArticulo({ tenantId, articuloId })`

En `lib/inventario/articulos.ts`, dentro de `enTransaccionDeTenant`, al lado de
`desactivarArticulo`:

1. `count` de `venta_items` del artículo. Si es > 0, `ARTICULO_CON_VENTAS` con
   el número adentro del mensaje.
2. `deleteMany({ where: { id: articuloId } })` — `deleteMany` y no `delete` por
   lo mismo que `marcarBaja` usa `updateMany`: un id de otro tenant no
   encuentra fila (RLS) y devuelve `count: 0`, que se traduce a
   `ARTICULO_INEXISTENTE`, en vez de tirar un error de Prisma que nadie atrapa.

### La traducción de P2003 vive en el `catch` de `borrarArticulo`, no en `traducirErrorDeBase`

Si el `DELETE` pierde la carrera contra un cobro, Prisma tira `P2003` (foreign
key constraint failed). Se traduce a `ARTICULO_CON_VENTAS` **en el catch propio
de esta función**, y no en el traductor compartido: ahí un `P2003` puede venir
de cualquier otra FK del módulo —la de categorías, por ejemplo— y significaría
otra cosa. Un traductor que devuelva "tiene ventas" ante cualquier FK
violada sería exactamente la clase de error que manda a alguien a buscar donde
no es.

El `catch` sigue delegando en `traducirErrorDeBase` para todo lo demás, como
`editarArticulo` y `marcarBaja`.

### `resumenDeBorrado(tenantId, articuloId)`

Devuelve `{ movimientos, unidades, ventas }` para que el diálogo diga números
reales. **`movimientos` y `unidades` salen de una sola consulta**, con el
`_count` anidado de Prisma sobre esas dos relaciones — dos subconsultas sobre
la misma fila.

**`ventas`, en cambio, es una SEGUNDA consulta, y no un tercer `_count`
anidado — a propósito, no por descuido.** `_count.ventaItems` cuenta LÍNEAS de
venta, no ventas: con un artículo con serie, dos unidades vendidas en la misma
venta son siempre dos líneas (`crearVenta` exige cantidad 1 por línea con
serie), así que ese número diría "se vendió 2 veces" de una venta que fue una
sola. Lo que el diálogo necesita son ventas DISTINTAS, y eso pide su propio
`findMany` de `venta_items` con `distinct: ['ventaId']`. **Corregido durante la
review de la rama** (hallazgo M1), después de que `borrarArticulo` —que en su
primera versión sí contaba líneas, con `ventaItem.count`— y el diálogo
mostraran dos números distintos para el mismo hecho.

La lee el Server Component de `/inventario/[id]` y la pasa como props. Puede
quedar vieja entre que la pantalla se renderiza y alguien aprieta Borrar, y
está bien: **la pantalla informa, la base decide**. Ése es el reparto que
justifica que el guard sea la FK.

### Los errores

Uno nuevo en `lib/inventario/errores.ts`: `ARTICULO_CON_VENTAS`. Reusa
`ARTICULO_INEXISTENTE` para el id que no existe o no es de este tenant.

## Permisos

**`ARTICULOS_BORRAR`, el noveno del catálogo** (`lib/permisos/catalogo.ts`, más
el enum del schema — `test/permisos-catalogo.test.ts` los ata en las dos
direcciones).

> **Borrar artículos.** Borrar del todo un artículo cargado por error, con su
> historial de stock. Sólo si nunca se vendió.

**Por qué no se pliega sobre `ARTICULOS_EDITAR`**, que es el que hoy cubre
desactivar y reactivar: la regla que este repo viene aplicando es que se delega
por **lo que la acción mueve**, no por el sustantivo que la nombra. Desactivar
y reactivar mueven una columna y se deshacen con un click. Borrar no se deshace
y se lleva filas de dos tablas más. Es el mismo escalón que ya separó
`VENTAS_ANULAR` y `ORDENES_ANULAR` de la edición: lo irreversible se delega
aparte de lo reversible.

El dueño lo tiene sin fila en `usuario_permisos`, como todos: `exigirPermiso`
corta antes de consultar la tabla.

La acción va detrás de `comoPuede('ARTICULOS_BORRAR', …)`, igual que
`bajaArticulo` con el suyo.

## Las pantallas

### `/inventario/[id]`, y sólo ahí

El listado no se toca. Borrar desde una fila de una tabla es donde el click
accidental cuesta más caro, y el flujo del duplicado pasa por la ficha de todos
modos: hay que mirar el artículo para saber cuál de los dos es el que sobra.

"Borrar" entra al lado de "Desactivar"/"Reactivar", **en las dos copias**: la
del Topbar (`hidden lg:flex`, en `acciones`) y la del pie del cuerpo
(`lg:hidden`), que es la regla que `test/permisos-en-las-dos-copias.test.ts`
existe para sostener y el modo de falla que ya se cobró un bug en el merge del
ciclo móvil. Los casos cuentan en las **dos direcciones**: con el permiso
aparecen las dos, sin el permiso ninguna.

### El diálogo, con sus dos caras

Un `Dialog` de shadcn, que lee `resumenDeBorrado`:

**Sin ventas** — se puede borrar:

> **¿Borrar "Funda iPhone 13"?**
> Se borran el artículo, sus 3 movimientos de stock y sus 5 unidades. No se
> puede deshacer.
>
> `[Cancelar]` `[Borrar]`

Las líneas que no aplican no se escriben: un artículo sin unidades no dice "y
sus 0 unidades", y uno recién creado sin ningún movimiento sólo dice que se
borra el artículo.

**Con ventas** — no se puede:

> **No se puede borrar "iPhone 13 128 GB"**
> Este artículo se vendió 3 veces: borrarlo se llevaría esas ventas. Podés
> desactivarlo — deja de ofrecerse y su historial queda intacto.
>
> `[Cancelar]` `[Borrar]` (apagado) `[Desactivar]`

El botón de borrar queda **apagado y a la vista**, no ausente: es lo que ata el
mensaje a la acción que la persona vino a hacer. El de desactivar dispara la
acción que ya existe, y tanto él como la frase que lo anuncia ("Podés
desactivarlo…") comparten las MISMAS tres condiciones: hay ventas —si no, el
diálogo ya está en su cara permisiva—, el artículo **no** está desactivado
todavía —ahí esa salida no existe—, y la persona tiene `ARTICULOS_EDITAR` —sin
ese permiso no tiene el botón "Desactivar" en ninguna de las dos copias de la
ficha, y ofrecérselo acá sería prometerle algo que no puede hacer. La tercera
condición se sumó durante las reviews del ciclo, cuando quedó claro que las
primeras dos solas dejaban a un empleado sin `ARTICULOS_EDITAR` leyendo
"Podés desactivarlo" sin ningún botón, en ningún lado, que lo hiciera. Faltando
cualquiera de las tres, el diálogo se queda sólo con el motivo —sin esa
oración— y `[Cancelar]`.

**El botón "Borrar" de la ficha se dibuja siempre**, con o sin ventas: quien
busca el botón y no lo encuentra asume que la feature no existe, y este diálogo
es el único lugar donde la regla se puede explicar en el momento en que
importa.

### Después de borrar

La ficha deja de existir, así que la acción devuelve ok y **el cliente** hace
`router.push('/inventario')` y lanza el toast de `sonner` (`"${nombre} se
borró del inventario."` — corregido en la review de la rama, hallazgo M7: la
acción del servidor devuelve el aviso genérico "Artículo borrado.", pero el
diálogo lo ignora y arma el suyo propio con el NOMBRE del artículo, que es
más útil en una pantalla —`/inventario`, adonde se navega justo después— que
lista varios a la vez) **en el mismo handler**, con el resultado en la mano —
no desde un `useEffect` sobre `useActionState`, que es la lección que dejó
escrita el ciclo de la UI de categorías. La acción hace
`revalidatePath('/inventario')` para que el listado al que se navega no venga
cacheado con el artículo todavía adentro.

### El teléfono

`design/arandano.pen` no dibuja ni este botón ni este diálogo, en ningún ancho.
Se deriva con los patrones que ya existen: el `Dialog` de shadcn (el mismo de
permisos y el de prender serie) y la segunda copia del botón al pie, como el
resto de las acciones de esta ficha. Queda anotado en
`docs/correcciones-pendientes-del-pen.md`.

## Cómo se verifica

Contra la base efímera, en el archivo de inventario que ya existe:

- Borra un artículo con movimientos de stock y con unidades: las filas de las
  tres tablas desaparecen, y la cuenta de las otras tablas del tenant no se
  mueve.
- Borra un artículo con unidades **dadas de baja**, que es el caso donde
  `movimientos_stock.unidad_id` está poblado — es el que prueba de verdad que
  el `NoAction` era necesario.
- Frena con `ARTICULO_CON_VENTAS` un artículo vendido, y **también** uno cuya
  única venta está anulada.
- Un `articuloId` de otro tenant sale como `ARTICULO_INEXISTENTE` y no borra
  nada (RLS), igual que uno que no tiene forma de uuid.
- La carrera: se cuenta 0 ventas, se cobra el artículo, y el `DELETE` sale con
  `ARTICULO_CON_VENTAS` y no con un P2003 crudo.
- `resumenDeBorrado` devuelve los tres números y no cuenta los de otro
  artículo.
- Las **dos copias** del botón, con y sin permiso.
- Sin `ARTICULOS_BORRAR`, la acción rechaza aunque el artículo sea borrable.

Y la verificación manual, que ningún test reemplaza: `arandano-dev` sirve
`main`, así que después del merge hay que cargar un duplicado con stock inicial,
borrarlo desde la ficha y ver que el listado queda limpio; abrir el diálogo en
un artículo vendido y leer el mensaje; y mirar el diálogo a 390 px, que es el
ancho donde nadie lo vio todavía.

## Lo que se acepta, dicho explícito

**Un artículo borrado no deja rastro en ningún lado.** No hay tabla de
auditoría, así que después del borrado nadie puede saber que existió, ni quién
lo borró, ni cuándo. Es lo que se pidió —el duplicado tiene que desaparecer—
pero es exactamente la propiedad que lo separa de desactivar, y la que hace que
el permiso valga la pena tenerlo aparte.

Si algún día hace falta el rastro, la salida conocida es una tabla-libro de
borrados con su propia línea de `REVOKE` en `setup-db-roles.sh`. Es aditiva:
nada de este ciclo habría que deshacer.

## Lo que este ciclo NO hace

- **No borra desde el listado.** Ver arriba.
- **No hay borrado masivo** ni "borrar los duplicados que detecte solo": no
  existe detección de duplicados y este ciclo no la inventa.
- **No hay papelera ni deshacer.** Un borrado con vuelta atrás es una baja
  lógica, que es exactamente lo que ya existe y lo que el pedido dice que no
  alcanza.
- **No toca `desactivarArticulo` ni `reactivarArticulo`**, ni su permiso, ni su
  texto. Los dos actos conviven.
