# Spec: categorías de artículo, el modelo

**Fecha**: 2026-08-23
**Ciclo**: el primero de dos. Este trae el modelo de datos; la UI —el árbol
lateral de `/inventario` y su ABM— es el ciclo siguiente y tiene su propio spec.

## De dónde sale

Feedback de un cliente, textual:

> Categorías estaría bueno también. Para ver el stock organizado por
> categorías, como celulares, dentro de celulares por marca, y después
> productos tipo, fundas también después por marcas, vidrios templados, cables,
> cargadores.

Dos niveles: un rubro arriba (Celulares, Fundas, Vidrios templados, Cables,
Cargadores) y la marca abajo. Y fijarse en qué NO pide: no todos los rubros
llevan marca. "Cables" y "Cargadores" los nombró sueltos.

## Estado del que se parte

`Articulo.categoria` es un `String?` de texto libre. El comentario del schema
lo dice sin vueltas:

> Texto libre y no una tabla: un catálogo de local no necesita una taxonomía
> con integridad referencial, y una tabla obliga a un ABM que nadie pidió. La
> maqueta muestra dos niveles ("Accesorios · Protección"); si el dueño los
> quiere, los escribe en el campo.

O sea: **los dos niveles de hoy son una convención tipográfica**, un `·` que
alguien tipea. `CLAUDE.md` cerró esa decisión el 2026-08-22 dejando la puerta
abierta — *"agregar la tabla más adelante sigue siendo aditivo si hiciera
falta"*. Este pedido es ese "si hiciera falta", y llega tres semanas después,
no tres años: la puerta sigue barata de cruzar porque todavía no hay tenants
reales.

Hoy el texto se muestra en tres lugares (la fila del listado, el subtítulo de
la ficha, y un `<Input>` libre en los dos formularios) y **no filtra ni agrupa
nada**.

## Alcance

**Entra**: la tabla `categorias` con su RLS, la FK `Articulo.categoriaId`, el
backfill de lo que ya está cargado, y la sincronización texto → árbol en el
alta y la edición de artículo.

**No entra**: ninguna pantalla. Ni el árbol lateral, ni el ABM, ni un filtro,
ni `/vender`, ni el catálogo público. La UI es el ciclo siguiente.

Esa separación no es prolijidad: es expand/contract. `CLAUDE.md` ya la aplicó
igual en el ciclo del 2026-08-22 (`Articulo.categoria`, `Caja`,
`Tenant.cotizacionUsd`), y la razón es la misma — el rollback automático de un
deploy revierte la imagen, no la base, así que la columna tiene que estar en
producción **antes** que el código que la lee, nunca junto.

## Decisiones

### Tabla propia, no dos columnas de texto

Descartado seguir con texto: dos escrituras distintas de lo mismo ("Fundas" y
"fundas") son dos categorías distintas para siempre, y renombrar obliga a tocar
artículo por artículo. Un catálogo con filas propias hace que renombrar sea un
`UPDATE` y que la lista de categorías exista como dato en vez de deducirse de
un `SELECT DISTINCT` sobre texto tipeado a mano.

### Dos niveles fijos, con auto-relación y no con dos tablas

`Categoria` se referencia a sí misma: `padreId = NULL` es una raíz, con padre
es una hoja. Los dos niveles los sostiene una **validación de servidor** —una
categoría con padre no puede tener hijas—, no el schema.

La alternativa era dos tablas (`Categoria` y `Marca`), donde los dos niveles
quedan garantizados por la estructura. Se descartó por dos razones concretas:
duplica el ABM entero (dos altas, dos renombres, dos borrados) y convierte
"mover Samsung de Celulares a Fundas" —un `UPDATE` de una columna— en un caso
especial. Y si algún día aparece el tercer nivel, aflojar una validación es más
barato que crear una tabla.

**Lo que cuesta si está mal**: la validación es una función de dominio con su
test. Cambiar de opinión hacia dos tablas después es una migración de datos;
cambiar hacia tres niveles es borrar un `if`.

### Un artículo cuelga de una raíz o de una hoja, indistinto

`Articulo.categoriaId` apunta a cualquiera de las dos. Es lo que hace que
"Cables" sin marca sea válido — que es literalmente lo que el cliente
describió. Forzar que todo artículo cuelgue de una hoja obligaría a inventar
una marca falsa ("Cables · Genérico") para cada rubro que no la usa.

Consecuencia para el ciclo de la UI: filtrar por una raíz tiene que incluir a
sus hijas **y** a los artículos colgados de la raíz misma. Es un `OR` de un
solo nivel, no una consulta recursiva.

### La unicidad necesita DOS índices, no uno

`@@unique([tenantId, padreId, nombre])` **no alcanza**: en Postgres `NULL ≠
NULL`, así que dos raíces llamadas "Celulares" en el mismo tenant pasarían el
índice sin chistar. Hace falta además un índice único parcial
`WHERE padre_id IS NULL` para las raíces.

Es exactamente el mecanismo que ya sostiene "una sola caja abierta por tenant"
(`cajas_una_abierta_por_tenant`), y por la misma razón que se escribió ahí: dos
pestañas creando "Celulares" en el mismo segundo pasan las dos por cualquier
`if` previo. La base es el único lugar donde la carrera no existe.

### Borrar: nunca en cascada, nunca huérfano

`Categoria.padreId` y `Articulo.categoriaId` van con `onDelete: Restrict`. Una
categoría con hijas o con artículos no se borra: la base lo rechaza y el ciclo
de la UI lo traduce a un mensaje que dice por qué.

`CASCADE` borraría en silencio el trabajo de clasificar todo un rubro;
`SET NULL` dejaría artículos sin categoría sin que nadie se entere. Las dos
son formas de perder datos por apretar un botón chico.

La única cascada es la de siempre: `tenantId → tenants` con `CASCADE`, como
toda tabla del núcleo.

### Alfabético, sin columna `orden`

El ABM del ciclo siguiente va a permitir renombrar y mover de padre, no
arrastrar para reordenar. Un local con cinco categorías no gana nada con orden
manual, y `orden Int` es aditiva el día que sí.

### RLS igual que el resto, sin excepción

`ENABLE ROW LEVEL SECURITY` y la policy `tenant_aislamiento` copiada tal cual
de `cajas`: `USING` y `WITH CHECK` con el mismo
`nullif(current_setting('arandano.tenant_id', true), '')::uuid`, que **falla
cerrado** — sin la GUC seteada no pasa ninguna fila.

No es opcional ni queda a criterio: `test/rls-cobertura.test.ts` recorre
`pg_class` y exige que toda tabla con `tenant_id` tenga RLS encendida y la
policy con sus dos mitades. Una tabla nueva sin eso rompe el build.

## La ventana entre los dos deploys

Acá está la decisión que más costaría descubrir tarde.

Si este ciclo sólo hiciera el backfill, todo artículo cargado **entre** este
deploy y el de la UI nacería con el texto y sin fila en el árbol — y el ciclo
de la UI tendría que correr un segundo backfill para juntar lo acumulado.

Así que `crearArticulo` y `editarArticulo` **mantienen `categoriaId`
sincronizado desde el texto que ya reciben**. Los formularios no cambian: el
`<Input>` libre sigue siendo el mismo. Pero al guardar `"Fundas · Samsung"`, la
lib busca o crea esas dos filas y deja el artículo apuntando a la hoja. Cuando
llegue la UI, el árbol ya está poblado con lo que el local cargó de verdad.

**Y `articulos.categoria` (el texto) se sigue escribiendo, sin excepción.** Es
lo que hace que el rollback a la imagen anterior sirva de algo: el código viejo
lee esa columna y encuentra el dato. El `DROP COLUMN` es un deploy posterior,
y ahí muere también esta escritura doble.

**Durante la ventana, renombrar una categoría NO actualiza el texto de sus
artículos.** El texto es un vestigio con fecha de defunción, no una segunda
fuente de verdad; sincronizarlo sería pagar mantenimiento por algo que se
borra. (En este ciclo la pregunta es teórica: renombrar todavía no existe.)

### Cómo se parte el texto

`"Fundas · Samsung"` → raíz `Fundas`, hoja `Samsung`.

Una sola regla, sin casos especiales, y de ahí sale todo lo demás:

1. Partir por `·` (el middot solo, no `" · "` con espacios: quien escriba
   `"Fundas·Samsung"` quiso decir lo mismo).
2. Trimear cada segmento y **descartar los vacíos**.
3. Sin segmentos, no hay categoría.
4. El primero es la raíz; el resto, unido con `" · "`, es la hija.

Lo que eso produce en los bordes, que es donde importa:

| Texto | Raíz | Hija |
|---|---|---|
| `"Fundas · Samsung"` | `Fundas` | `Samsung` |
| `"Fundas·Samsung"` | `Fundas` | `Samsung` |
| `"Cables"` | `Cables` | — |
| `"Accesorios · Fundas · Samsung"` | `Accesorios` | `Fundas · Samsung` |
| `"· Samsung"` | `Samsung` | — |
| `"A ·  · B"` | `A` | `B` |
| `""`, `"   "`, `"·"`, `" · · "` | — | — |

El tercer nivel se pliega dentro de la hija en vez de descartarse: es feo, pero
**no pierde nada**, y eso es lo que importa — tirar el tercer segmento sería
borrar lo que alguien escribió sin avisarle. Y un texto que queda sin ningún
segmento deja `categoria` y `categoriaId` los dos en NULL, que es el
comportamiento que `limpiarCategoria` ya tiene para el texto: el árbol lo
hereda en vez de inventar el suyo.

### El `INSERT` de la categoría va con `ON CONFLICT DO NOTHING`, y eso es load-bearing

`crearArticulo` tiene una invariante **escrita en un comentario largo** que hay
que no romper:

> `articulos` tiene UNA sola unicidad (`@@unique([tenantId, sku])`) y
> `movimientos_stock` ninguna, así que adentro de esta transacción un P2002 no
> puede ser otra cosa que el SKU.

Eso sostiene a `esSkuRepetido`, que bajo `arandano_app` **devuelve `true` para
cualquier P2002** — RLS hace que Postgres retenga el `DETAIL` del error, así
que los nombres de columna nunca llegan. Si la creación de la categoría entrara
a esa transacción con un `create` normal de Prisma, una colisión de unicidad de
categoría se leería como "SKU repetido": el alta reintentaría cinco veces con
SKUs distintos, chocaría siempre por la categoría, y terminaría diciendo *"no
se pudo generar un código libre"* — un mensaje que no tiene nada que ver con lo
que pasó.

Por eso `asegurarCategoria` inserta con `INSERT … ON CONFLICT DO NOTHING
RETURNING id` y, si no volvió nada, hace un `SELECT`. **Nunca tira P2002**, así
que la invariante sigue en pie y el comentario sigue siendo cierto.

Y resuelve la carrera de paso: bajo `READ COMMITTED` —el default de Postgres—
el `INSERT` bloqueado por otra transacción que aún no comiteó se destraba al
commit de esa otra, no inserta nada, y el `SELECT` posterior **sí ve** la fila
recién comiteada.

**Va adentro de la transacción del artículo, no en una propia.** La alternativa
—una transacción separada, como hace `proximoSku`— dejaría categorías fantasma
cuando el alta falla después. Un hueco en la secuencia de SKU no se ve nunca;
una categoría vacía en el árbol la ve el dueño la primera vez que lo abre.

**Costo asumido**: el `INSERT` es SQL crudo, así que los ids los genera
`gen_random_uuid()` (v4) en vez de los v7 que produce Prisma. Nada en el código
depende de la versión del uuid —`esUuid` sólo mira la forma— y `test/datos.ts`
ya inserta tenants y usuarios así. Queda escrito para que nadie lo descubra
como una sorpresa.

## Base de datos

```prisma
model Categoria {
  id            String   @id @default(uuid(7)) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  nombre        String
  padreId       String?  @map("padre_id") @db.Uuid
  creadoEn      DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  padre  Categoria?  @relation("Jerarquia", fields: [padreId], references: [id], onDelete: Restrict)
  hijas  Categoria[] @relation("Jerarquia")

  articulos Articulo[]

  @@unique([tenantId, padreId, nombre])
  @@index([tenantId, padreId])
  @@map("categorias")
}
```

Más, en `Articulo`: `categoriaId String? @map("categoria_id") @db.Uuid` con su
relación `onDelete: Restrict`. `Tenant` suma `categorias Categoria[]`.

Y en la migración, lo que Prisma no genera solo:

1. El índice único parcial de las raíces.
2. `ENABLE ROW LEVEL SECURITY` + la policy.
3. El backfill.

### El backfill

Un bloque SQL delimitado por marcadores (`-- >>> BACKFILL` / `-- <<< BACKFILL`)
que:

1. Junta los `(tenant_id, categoria)` distintos de `articulos` con categoría no
   vacía.
2. Los parte en raíz y hija con la misma regla de arriba.
3. Inserta las raíces distintas, después las hijas, las dos con
   `ON CONFLICT DO NOTHING`.
4. Actualiza `articulos.categoria_id` **sólo donde está NULL**.

**Idempotente a propósito**, y los marcadores tampoco son decorativos: la base
de los tests arranca vacía, así que `migrate deploy` nunca ejercita este SQL
con datos adentro. `test/categorias.test.ts` **lee el bloque del archivo de
migración y lo ejecuta** contra artículos sembrados a mano. Es el SQL exacto
que va a correr en producción, no una reimplementación paralela que puede
diverger — el mismo criterio con el que `scripts/definir-clave.binario.test.ts`
spawnea el binario real en vez de probar sólo la función.

## Arquitectura

**`lib/inventario/categorias.ts`**, módulo nuevo:

- `partirCategoria(texto): { raiz, hija } | null` — pura, sin base. Es donde
  viven todas las reglas de parseo de arriba, y donde se prueban.
- `asegurarCategoria(tx, tenantId, texto): Promise<string | null>` — el
  `INSERT … ON CONFLICT` de raíz y hoja; devuelve el id de la hoja, o el de la
  raíz si no hay hija, o `null` si no hay categoría.
**No** hay una función `exigirDosNiveles` en este ciclo, y la omisión es
deliberada: no tendría un solo llamador. En este ciclo el único escritor de
categorías es `asegurarCategoria`, que **no puede** producir un tercer nivel —
busca la raíz con `padre_id IS NULL` y cuelga la hija de ella, siempre. La
garantía de profundidad es estructural, y un test la afirma en vez de dejarla
implícita.

La validación explícita entra con el ABM del ciclo siguiente, que es el primer
escritor capaz de violarla (mover una raíz debajo de otra). Si algún día se
quiere que la garantice la base y no el servidor, el camino conocido es una FK
compuesta contra una columna `nivel` generada — anotado acá para no
redescubrirlo, no como algo que este ciclo haga.

`crearArticulo` y `editarArticulo` la llaman adentro de la transacción que ya
abren. Ningún otro punto del código cambia.

## Verificación

- `partirCategoria` en todos sus bordes: sin separador, con uno, con tres, sin
  espacios alrededor, sólo espacios, sólo separadores, raíz vacía con hija.
- El alta y la edición dejan `categoria_id` apuntando a la hoja correcta, y el
  texto sigue escribiéndose igual (esto último es lo que sostiene el rollback).
- Dos altas con la misma categoría reusan la fila; no la duplican.
- Dos raíces homónimas en el mismo tenant chocan (el índice parcial), y **la
  misma raíz en dos tenants distintos convive** — que es lo que prueba que el
  índice lleva `tenant_id` adentro.
- Una categoría con hijas o con artículos no se puede borrar.
- El backfill, corriendo el SQL real extraído de la migración.
- RLS: un tenant no ve las categorías de otro. Lo genérico ya lo cubre
  `test/rls-cobertura.test.ts`; el caso concreto va en `test/rls.test.ts`.

## Fuera de alcance, explícito

- **Toda la UI.** Árbol lateral, ABM, filtro por categoría, breadcrumbs.
- **`/vender` y el catálogo público.** El pedido es sobre stock.
- **El `DROP COLUMN` de `articulos.categoria`.** Es el contract, y va en un
  deploy posterior al de la UI — no en el siguiente, en uno posterior: mientras
  exista código desplegado que lea el texto, la columna se queda.
- **Categorías sembradas por preset de rubro.** Los presets no existen todavía
  como mecanismo (`CLAUDE.md`, *Próximos pasos técnicos*). El árbol de cada
  local nace de lo que ya cargó.

## Deuda que este ciclo crea, dicha en voz alta

`design/arandano.pen` **no dibuja ningún panel de categorías**. La regla del
proyecto es que la maqueta es la autoridad, así que el ciclo de la UI va a estar
construyendo algo que el `.pen` no tiene. Eso se anota en
`docs/correcciones-pendientes-del-pen.md`, que existe justo para esto, y lo
tiene que cerrar una persona en Pencil — las herramientas MCP leen el archivo
pero no persisten escrituras.
