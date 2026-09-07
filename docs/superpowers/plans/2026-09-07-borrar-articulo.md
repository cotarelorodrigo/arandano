# Borrar un artículo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un artículo cargado por error se pueda borrar de verdad del
inventario —con su historial de stock y sus unidades— mientras no haya
producido ninguna venta.

**Architecture:** El guard no es un `if`: `VentaItem.articuloId` se queda en
`ON DELETE RESTRICT` y es Postgres el que se niega a borrar un artículo
vendido. `MovimientoStock.articuloId` y `UnidadDeArticulo.articuloId` pasan a
`CASCADE` y se llevan la historia interna del artículo. La aplicación cuenta
las ventas antes de borrar sólo para poder escribir un mensaje que se entienda,
y traduce la violación de FK al mismo código cuando pierde la carrera.

**Tech Stack:** Next.js App Router (Server Components + server actions),
Prisma sobre PostgreSQL con RLS, shadcn/ui (`Dialog`, `Button`), `sonner` para
los avisos, vitest contra un Postgres efímero.

**Spec:** `docs/superpowers/specs/2026-09-07-borrar-articulo-design.md`

## Global Constraints

- **Todo el código, los comentarios, los mensajes de error y los commits van en
  español**, con acentos correctos. Es la convención del repo entero.
- **Toda migración que necesite SQL propio se genera con
  `npx prisma migrate dev --create-only --name <nombre>`** y se aplica en un
  paso posterior explícito. Sin `--create-only`, Prisma la aplica al generarla
  y editarla después exige `migrate reset`, que está prohibido.
- **`prisma migrate dev` no lee `.env.local`.** Antes de correr una migración:
  `set -a && source .env.local && set +a`.
- **`npm test` levanta su propio Postgres efímero** y lo migra desde disco. Si
  falla con errores raros de datos duplicados, revisar que no haya un túnel SSH
  ocupando el 55432: `lsof -nP -iTCP:55432 -sTCP:LISTEN`.
- **`docs/schema.md` se regenera con `scripts/generar-erd.sh`**, nunca a mano.
  El hook de pre-commit lo verifica: un schema cambiado sin regenerar no
  commitea.
- **El nombre del permiso nuevo es exactamente `ARTICULOS_BORRAR`**, en el enum
  de Prisma y en `lib/permisos/catalogo.ts`. `test/permisos-catalogo.test.ts`
  los ata en las dos direcciones.
- **Nunca gatear una sola copia de un botón.** La ficha de artículo dibuja cada
  acción dos veces (Topbar de escritorio + pie del teléfono) y las dos se
  guardan con la MISMA expresión.

## Archivos que toca este plan

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` | Las tres FKs que cambian de acción, el enum del permiso, y el comentario de `desactivadoEn` que hoy afirma lo contrario |
| `prisma/migrations/*_borrado_de_articulo/` | `DROP`/`ADD CONSTRAINT` de las tres FKs |
| `prisma/migrations/*_permiso_articulos_borrar/` | `ALTER TYPE "permiso" ADD VALUE` |
| `scripts/setup-db-roles.sh` | Comentario: el append-only de `movimientos_stock` queda con una puerta acotada |
| `lib/inventario/errores.ts` | El código `ARTICULO_CON_VENTAS` |
| `lib/inventario/articulos.ts` | `borrarArticulo` y `resumenDeBorrado` |
| `lib/permisos/catalogo.ts` | La fila de `ARTICULOS_BORRAR` |
| `app/(app)/inventario/acciones.ts` | `borrarArticuloAccion`, detrás del permiso |
| `app/(app)/inventario/borrar-dialogo.tsx` | **Nuevo.** El diálogo con sus dos caras y su trigger, cliente |
| `app/(app)/inventario/formularios.tsx` | Monta el diálogo en las dos copias de la ficha |
| `app/(app)/inventario/[id]/page.tsx` | Resuelve el permiso y el resumen, y los pasa |
| `docs/pantallas.md`, `CLAUDE.md`, `docs/correcciones-pendientes-del-pen.md` | El registro del ciclo |

---

### Task 1: El schema, la migración de las FKs y lo que la base ahora garantiza

**Files:**
- Modify: `prisma/schema.prisma` (`Articulo.desactivadoEn`, `MovimientoStock.articulo`, `MovimientoStock.unidad`, `UnidadDeArticulo.articulo`)
- Create: `prisma/migrations/<timestamp>_borrado_de_articulo/migration.sql`
- Modify: `docs/schema.md` (generado)
- Modify: `scripts/setup-db-roles.sh` (sólo comentario)
- Test: `test/schema.test.ts`, `test/setup-db-roles.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: la base borra `articulos` llevándose `movimientos_stock` y
  `unidades_articulo`, y se niega cuando hay `venta_items`. Todo lo que sigue
  se apoya en eso.

- [ ] **Step 1: Escribir los casos que fijan el comportamiento de la base**

En `test/schema.test.ts`, agregar `urlApp` al import de la primera línea
(`import { urlOwner, urlApp } from './postgres-efimero'`) y este bloque al
final del archivo:

```ts
describe('el borrado de un artículo', () => {
  /** Un tenant con un usuario, listo para colgarle artículos. */
  async function escenario(nombre: string) {
    const t = await cliente.query(
      `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $1, 'TRIAL', now(), now()) RETURNING id`,
      [`${nombre}-${Date.now()}`],
    )
    const tenantId = t.rows[0].id
    const u = await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Dueño', $2, 'DUENO', now(), now()) RETURNING id`,
      [tenantId, `d-${tenantId}@borrado.test`],
    )
    const a = await cliente.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'BORR-1', 'Duplicado', 'PRODUCTO', 100.00, 1, now(), now())
       RETURNING id`,
      [tenantId],
    )
    return { tenantId, usuarioId: u.rows[0].id as string, articuloId: a.rows[0].id as string }
  }

  async function conMovimiento(e: { tenantId: string; usuarioId: string; articuloId: string }) {
    await cliente.query(
      `INSERT INTO movimientos_stock
         (id, tenant_id, articulo_id, usuario_id, motivo, cantidad, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 'INGRESO', 1, now())`,
      [e.tenantId, e.articuloId, e.usuarioId],
    )
  }

  async function conUnidad(e: { tenantId: string; usuarioId: string; articuloId: string }) {
    const { rows } = await cliente.query(
      `INSERT INTO unidades_articulo
         (id, tenant_id, articulo_id, imei, ingresada_por_id, ingresada_en, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), now()) RETURNING id`,
      [e.tenantId, e.articuloId, `IMEI-${crypto.randomUUID()}`, e.usuarioId],
    )
    return rows[0].id as string
  }

  async function cuantos(tabla: string, articuloId: string) {
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM ${tabla} WHERE articulo_id = $1`,
      [articuloId],
    )
    return rows[0].n as number
  }

  it('se lleva sus movimientos de stock', async () => {
    const e = await escenario('borr-movs')
    await conMovimiento(e)
    await cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('movimientos_stock', e.articuloId)).toBe(0)
  })

  it('se lleva sus unidades', async () => {
    const e = await escenario('borr-unis')
    await conUnidad(e)
    await cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('unidades_articulo', e.articuloId)).toBe(0)
  })

  // El caso que prueba que `movimientos_stock.unidad_id` tenía que dejar de
  // ser RESTRICT: acá las dos filas se van en la MISMA sentencia, y RESTRICT
  // —que se evalúa inmediato, sin esperar al final— abortaría el borrado por
  // una fila que se está yendo igual.
  it('se lleva un movimiento que apunta a una unidad, las dos a la vez', async () => {
    const e = await escenario('borr-mov-uni')
    const unidadId = await conUnidad(e)
    await cliente.query(
      `INSERT INTO movimientos_stock
         (id, tenant_id, articulo_id, unidad_id, usuario_id, motivo, cantidad, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'BAJA', -1, now())`,
      [e.tenantId, e.articuloId, unidadId, e.usuarioId],
    )
    await cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    expect(await cuantos('movimientos_stock', e.articuloId)).toBe(0)
    expect(await cuantos('unidades_articulo', e.articuloId)).toBe(0)
  })

  // El guard, y la razón por la que `venta_items` NO pasa a Cascade: la
  // historia de la plata no se toca. Que lo sostenga la base y no un `if` es
  // lo que hace que la regla valga aunque el chequeo de la aplicación falle.
  it('la base se niega si el artículo tiene una línea de venta', async () => {
    const e = await escenario('borr-vendido')
    const v = await cliente.query(
      `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
       VALUES (gen_random_uuid(), $1, 1, $2, 100.00, now()) RETURNING id`,
      [e.tenantId, e.usuarioId],
    )
    await cliente.query(
      `INSERT INTO venta_items
         (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Duplicado', 1, 100.00)`,
      [e.tenantId, v.rows[0].id, e.articuloId],
    )
    await expect(
      cliente.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId]),
    ).rejects.toThrow(/foreign key|llave foránea/i)
  })

  // La mitad que de verdad importa y que el owner no puede probar: el rol de
  // la app NO tiene DELETE sobre movimientos_stock (setup-db-roles.sh lo
  // revoca), y sin embargo la cascada se los lleva. Las acciones de FK las
  // ejecuta el sistema y no pasan por el chequeo de privilegios del rol que
  // llama — es exactamente la puerta que este ciclo abre a propósito.
  it('el rol de la app borra el artículo y la cascada se lleva el libro que él no puede tocar', async () => {
    const e = await escenario('borr-app')
    await conMovimiento(e)
    const app = new Client({ connectionString: urlApp() })
    await app.connect()
    try {
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [e.tenantId])
      await expect(
        app.query(`DELETE FROM movimientos_stock WHERE articulo_id = $1`, [e.articuloId]),
      ).rejects.toThrow(/permission denied|denegado/i)
      await app.query(`DELETE FROM articulos WHERE id = $1`, [e.articuloId])
    } finally {
      await app.end()
    }
    expect(await cuantos('movimientos_stock', e.articuloId)).toBe(0)
  })

  // RLS es lo único que impide borrar el artículo de otro local, y sigue en
  // pie: la cascada no es una vía de entrada porque la fila que se borra —la
  // de `articulos`— está protegida por su policy.
  it('el rol de la app no borra el artículo de otro tenant', async () => {
    const mio = await escenario('borr-mio')
    const ajeno = await escenario('borr-ajeno')
    const app = new Client({ connectionString: urlApp() })
    await app.connect()
    try {
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [mio.tenantId])
      const r = await app.query(`DELETE FROM articulos WHERE id = $1`, [ajeno.articuloId])
      expect(r.rowCount).toBe(0)
    } finally {
      await app.end()
    }
    const { rows } = await cliente.query(`SELECT count(*)::int AS n FROM articulos WHERE id = $1`, [
      ajeno.articuloId,
    ])
    expect(rows[0].n).toBe(1)
  })
})
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run test/schema.test.ts -t 'el borrado de un artículo'`
Expected: FAIL — los tres primeros y el de la app fallan con violación de FK
(`update or delete on table "articulos" violates foreign key constraint`),
porque hoy las tres FKs son `RESTRICT`.

- [ ] **Step 3: Cambiar las tres FKs en el schema**

En `prisma/schema.prisma`, `model MovimientoStock`:

```prisma
  // Cascade desde el ciclo del borrado (2026-09-07): el historial de stock es
  // del artículo, así que se va con él. El guard de "no se borra lo que se
  // vendió" NO vive acá —vive en venta_items, que sigue siendo Restrict—, y
  // eso es a propósito: sólo puede llegar a esta cascada un artículo que nunca
  // vendió nada.
  articulo Articulo          @relation(fields: [articuloId], references: [id], onDelete: Cascade)
  // NoAction y no Restrict: cuando se borra un artículo con serie, sus
  // movimientos y sus unidades se van en la MISMA sentencia. RESTRICT se
  // evalúa inmediato, sin esperar al final, así que abortaría el borrado por
  // una fila que se está yendo igual; NO ACTION es diferible y lo tolera.
  //
  // Y no Cascade: fuera de ese camino ninguna unidad se borra nunca —darla de
  // baja es una columna—, así que Cascade describiría un flujo que no existe.
  unidad   UnidadDeArticulo? @relation(fields: [unidadId], references: [id], onDelete: NoAction)
```

En `model UnidadDeArticulo`:

```prisma
  // Cascade desde el ciclo del borrado (2026-09-07), por lo mismo que
  // movimientos_stock: las unidades de un artículo que nunca se vendió se van
  // con él. Un artículo CON ventas no llega acá — venta_items lo frena antes.
  articulo     Articulo @relation(fields: [articuloId], references: [id], onDelete: Cascade)
```

Y en `model Articulo`, reemplazar el comentario de `desactivadoEn`, que hoy
afirma justo lo contrario de lo que este ciclo construye:

```prisma
  // Un artículo que se DEJA DE VENDER no se borra: se desactiva, y su historial
  // y sus ventas quedan intactos. Mismo campo y mismo sentido que
  // User.desactivadoEn, que ya sienta el precedente.
  //
  // Borrar existe y es otro acto (ciclo del 2026-09-07): es para el artículo
  // cargado por error, que nunca vendió nada y no tiene historia que
  // preservar. La regla la sostiene la base —venta_items.articulo_id sigue
  // siendo Restrict—, no un chequeo de la aplicación.
  desactivadoEn DateTime?    @map("desactivado_en") @db.Timestamptz(3)
```

- [ ] **Step 4: Generar la migración SIN aplicarla**

```bash
set -a && source .env.local && set +a
npx prisma migrate dev --create-only --name borrado_de_articulo
```

- [ ] **Step 5: Leer el SQL generado y verificar que dice lo que tiene que decir**

Run: `cat prisma/migrations/*_borrado_de_articulo/migration.sql`

Expected: tres pares `DROP CONSTRAINT` / `ADD CONSTRAINT`, con
`ON DELETE CASCADE` en `movimientos_stock_articulo_id_fkey` y en
`unidades_articulo_articulo_id_fkey`, y `ON DELETE NO ACTION` en
`movimientos_stock_unidad_id_fkey`. **Ningún `DROP COLUMN` ni `DROP TABLE`** —
si aparece uno, parar: el gate de `deploy.sh` rechaza migraciones destructivas.

- [ ] **Step 6: Aplicarla y regenerar el diagrama**

```bash
set -a && source .env.local && set +a
npx prisma migrate deploy
scripts/generar-erd.sh
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS, incluidos los siete casos nuevos.

- [ ] **Step 8: Documentar la puerta en el lugar donde alguien la va a buscar**

En `scripts/setup-db-roles.sh`, al final del comentario del bloque que revoca
sobre `movimientos_stock` (justo antes del `DO $$` de la línea ~157), agregar:

```bash
# LA EXCEPCIÓN, y está acá porque es acá donde se la busca: desde el ciclo del
# borrado de artículos (2026-09-07), movimientos_stock.articulo_id es ON DELETE
# CASCADE. Las acciones de FK las ejecuta el sistema y no pasan por este
# REVOKE, así que borrar un artículo SÍ se lleva sus movimientos aunque el rol
# de la app no pueda tocarlos por ningún otro camino. Es exactamente la puerta
# de atrás que el bloque de eventos_orden, unas líneas más abajo, cierra a mano
# para las órdenes — acá se deja abierta a propósito y acotada: sólo la cruza un
# artículo que nunca produjo una venta, porque venta_items.articulo_id sigue
# siendo Restrict y frena a cualquier otro. Un artículo que no vendió nada no
# deja ningún "por qué tengo 3 y no 5" sin contestar: no queda ningún stock que
# explicar, porque el artículo entero deja de existir.
#
# Depende de que ninguna tabla tenga FORCE ROW LEVEL SECURITY, que hoy es el
# caso (ver la migración resolver_tenant). Con FORCE, la cascada pasaría a
# evaluarse contra las policies y este camino dejaría de funcionar.
```

Y agregar el caso que fija el par entero en `test/setup-db-roles.test.ts`,
dentro del `describe('las tablas-libro son append-only')`, después del caso de
`movimientos_stock`:

```ts
    // La excepción documentada, en las dos direcciones: el DELETE directo
    // sigue prohibido (arriba) y la cascada del artículo sí se los lleva. Sin
    // este caso, alguien que "cierre la puerta" por prolijidad —volviendo la
    // FK a Restrict— rompería el borrado de artículos sin que nada avise.
    it('movimientos_stock: y sin embargo la cascada de un artículo sí se los lleva', async () => {
      const owner = new Client({ connectionString: urlOwner() })
      await owner.connect()
      try {
        const { rows } = await owner.query(
          `SELECT confdeltype FROM pg_constraint
            WHERE conname = 'movimientos_stock_articulo_id_fkey'`,
        )
        // 'c' = CASCADE. Se lee de pg_constraint y no borrando una fila: lo
        // que este caso custodia es la DECISIÓN, y el efecto ya lo prueba
        // test/schema.test.ts contra el rol de la app.
        expect(rows[0].confdeltype).toBe('c')
      } finally {
        await owner.end()
      }
    })
```

- [ ] **Step 9: Correr todo y commitear**

Run: `npx vitest run test/schema.test.ts test/setup-db-roles.test.ts`
Expected: PASS

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md scripts/setup-db-roles.sh test/schema.test.ts test/setup-db-roles.test.ts
git commit -m "feat(borrar-articulo): la base se lleva el historial y frena la venta

Las tres FKs cambian de acción: movimientos_stock y unidades_articulo pasan
a Cascade desde articulos, y venta_items se queda en Restrict — pasa a ser
el guard estructural de \"no se borra lo que se vendió\".

movimientos_stock.unidad_id pasa a NoAction porque RESTRICT se evalúa
inmediato y abortaría el borrado de un artículo con serie, donde las dos
filas se van en la misma sentencia.

Y queda escrito en setup-db-roles.sh que el append-only de movimientos_stock
tiene desde hoy esta puerta acotada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

### Task 2: El permiso `ARTICULOS_BORRAR`

**Files:**
- Modify: `prisma/schema.prisma` (`enum Permiso`)
- Create: `prisma/migrations/<timestamp>_permiso_articulos_borrar/migration.sql`
- Modify: `lib/permisos/catalogo.ts`
- Test: `test/permisos-catalogo.test.ts` (ya existe y ata las dos direcciones)

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces: `'ARTICULOS_BORRAR'` como valor válido del tipo `Permiso`
  (`lib/permisos/catalogo.ts`), usable en `exigirPermiso` y `puedeConSesion`.

- [ ] **Step 1: Correr el test que ya existe, para ver el estado de partida**

Run: `npx vitest run test/permisos-catalogo.test.ts`
Expected: PASS con ocho permisos. Es el test que va a fallar si el enum y el
catálogo se desincronizan, así que hay que verlo verde ANTES de tocar nada.

- [ ] **Step 2: Agregar el valor al enum del schema**

En `prisma/schema.prisma`, al final de `enum Permiso` (antes del `@@map`):

```prisma
  // Borrar un artículo del todo, con su historial de stock. Aparte de
  // ARTICULOS_EDITAR —que ya cubre desactivar y reactivar— porque se delega
  // por lo que la acción MUEVE: desactivar mueve una columna y se deshace con
  // un click; borrar no se deshace y se lleva filas de dos tablas más. Es el
  // mismo escalón que separa VENTAS_ANULAR y ORDENES_ANULAR de la edición.
  ARTICULOS_BORRAR
```

- [ ] **Step 3: Agregar la fila al catálogo**

En `lib/permisos/catalogo.ts`, dentro de `PERMISOS`, inmediatamente después de
la entrada de `ARTICULOS_EDITAR`:

```ts
  {
    clave: 'ARTICULOS_BORRAR',
    nombre: 'Borrar artículos',
    ayuda: 'Borrar del todo un artículo cargado por error, con su historial de stock. Sólo si nunca se vendió.',
  },
```

- [ ] **Step 4: Generar y aplicar la migración**

```bash
set -a && source .env.local && set +a
npx prisma migrate dev --create-only --name permiso_articulos_borrar
cat prisma/migrations/*_permiso_articulos_borrar/migration.sql
```

Expected: una sola línea, `ALTER TYPE "permiso" ADD VALUE 'ARTICULOS_BORRAR';`
— igual que `20260829214100_permiso_bot`. Después:

```bash
npx prisma migrate deploy
scripts/generar-erd.sh
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run test/permisos-catalogo.test.ts test/permisos.test.ts`
Expected: PASS, ahora con nueve permisos. Si algún caso afirma un número
escrito a mano en vez de derivarlo de `CLAVES_DE_PERMISO.length`, **derivarlo**:
es la tercera vez que este repo paga ese peaje.

- [ ] **Step 6: Commitear**

```bash
git add prisma/schema.prisma prisma/migrations lib/permisos/catalogo.ts docs/schema.md
git commit -m "feat(borrar-articulo): ARTICULOS_BORRAR, el noveno del catálogo

Lo irreversible se delega aparte de lo reversible, que es lo que ya separa
VENTAS_ANULAR y ORDENES_ANULAR de la edición. Un empleado puede corregir un
precio sin poder hacer desaparecer un artículo y su historial.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

### Task 3: El motor — `borrarArticulo` y `resumenDeBorrado`

**Files:**
- Modify: `lib/inventario/errores.ts`
- Modify: `lib/inventario/articulos.ts`
- Test: `test/inventario.test.ts`

**Interfaces:**
- Consumes: las FKs de la Task 1.
- Produces:
  - `borrarArticulo(entrada: { tenantId: string; articuloId: string }): Promise<void>`
  - `type ResumenDeBorrado = { movimientos: number; unidades: number; ventas: number }`
  - `resumenDeBorrado(tenantId: string, articuloId: string): Promise<ResumenDeBorrado>`
  - el código `'ARTICULO_CON_VENTAS'` en `CodigoErrorDeInventario`

- [ ] **Step 1: Escribir los casos que fallan**

En `test/inventario.test.ts`: agregar al `beforeAll` las dos funciones nuevas
al import dinámico existente, quedando

```ts
  let borrarArticulo: typeof import('@/lib/inventario/articulos').borrarArticulo
  let resumenDeBorrado: typeof import('@/lib/inventario/articulos').resumenDeBorrado
```

junto a las otras declaraciones `let` del tope del archivo, y dentro del
`beforeAll`:

```ts
  ;({
    crearArticulo, editarArticulo, desactivarArticulo, reactivarArticulo,
    borrarArticulo, resumenDeBorrado,
  } = await import('@/lib/inventario/articulos'))
  ;({ darDeBajaUnidad } = await import('@/lib/inventario/stock'))
```

(`darDeBajaUnidad` necesita su propio `let` declarado igual que los demás:
`let darDeBajaUnidad: typeof import('@/lib/inventario/stock').darDeBajaUnidad`.
Si el archivo ya lo importa, no duplicarlo.)

Y este bloque nuevo al final del archivo:

```ts
describe('borrar un artículo', () => {
  /** Una venta con una línea del artículo, insertada crudo con el owner: lo
   *  que importa acá es que exista la fila de venta_items que frena el
   *  borrado, no ejercitar el motor de ventas —eso es test/ventas.test.ts. */
  let proximoNumero = 9000
  async function venderCrudo(articuloId: string, anulada = false) {
    const v = await owner.query(
      `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, anulada_en, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 100.00, $4, now()) RETURNING id`,
      [tenantId, proximoNumero++, usuarioId, anulada ? new Date() : null],
    )
    await owner.query(
      `INSERT INTO venta_items
         (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Una línea', 1, 100.00)`,
      [tenantId, v.rows[0].id, articuloId],
    )
  }

  async function existe(articuloId: string) {
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM articulos WHERE id = $1`, [articuloId],
    )
    return rows[0].n === 1
  }

  it('borra el artículo y se lleva sus movimientos de stock', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cargado dos veces', tipo: 'PRODUCTO',
      precio: d('100'), stockInicial: d('2'),
    })
    await borrarArticulo({ tenantId, articuloId: a.id })

    expect(await existe(a.id)).toBe(false)
    const movs = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [a.id],
    )
    expect(movs.rows[0].n, 'el alta con stock inicial deja un movimiento y tiene que irse').toBe(0)
  })

  it('borra un artículo con serie y se lleva sus unidades', async () => {
    const a = await crearArticuloConSerie('iPhone duplicado', ['111111111111111'])
    await borrarArticulo({ tenantId, articuloId: a.id })

    const unis = await owner.query(
      `SELECT count(*)::int AS n FROM unidades_articulo WHERE articulo_id = $1`, [a.id],
    )
    expect(unis.rows[0].n).toBe(0)
  })

  // El caso que ejercita el NoAction de movimientos_stock.unidad_id por el
  // camino real: dar de baja una unidad escribe un movimiento QUE LA NOMBRA, y
  // las dos filas se van en la misma sentencia.
  it('borra un artículo con una unidad dada de baja, que es el caso del movimiento que la nombra', async () => {
    const a = await crearArticuloConSerie('Con baja', ['222222222222222'])
    const [unidad] = await unidadesLibres(tenantId, a.id)
    await darDeBajaUnidad({ tenantId, unidadId: unidad.id, usuarioId, nota: 'se rompió' })

    await borrarArticulo({ tenantId, articuloId: a.id })
    expect(await existe(a.id)).toBe(false)
  })

  it('un artículo desactivado se borra igual: lo único que decide es la venta', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'De baja y duplicado', tipo: 'PRODUCTO', precio: d('100'),
    })
    await desactivarArticulo({ tenantId, articuloId: a.id })
    await borrarArticulo({ tenantId, articuloId: a.id })
    expect(await existe(a.id)).toBe(false)
  })

  it('rechaza borrar un artículo vendido', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vendido', tipo: 'PRODUCTO', precio: d('100'),
    })
    await venderCrudo(a.id)
    await expect(borrarArticulo({ tenantId, articuloId: a.id })).rejects.toMatchObject({
      codigo: 'ARTICULO_CON_VENTAS',
    })
    expect(await existe(a.id), 'la venta lo frenó, así que sigue estando').toBe(true)
  })

  // Anular es un UPDATE sobre `ventas`: el venta_item sigue en pie, y es
  // correcto que frene. Una venta anulada es un hecho que pasó.
  it('rechaza borrar un artículo cuya única venta está anulada', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vendido y anulado', tipo: 'PRODUCTO', precio: d('100'),
    })
    await venderCrudo(a.id, true)
    await expect(borrarArticulo({ tenantId, articuloId: a.id })).rejects.toMatchObject({
      codigo: 'ARTICULO_CON_VENTAS',
    })
  })

  /**
   * El camino del P2003: el conteo previo dice 0 y el DELETE falla igual.
   *
   * No se simula una carrera de reloj —eso no es determinista—, sino la MISMA
   * situación por el otro lado: una línea de venta que RLS le esconde al
   * conteo pero que la FK sí ve. Es posible porque las FK de Postgres saltean
   * RLS y ninguna es compuesta con `tenant_id`, cosa que CLAUDE.md ya tiene
   * anotada como hallazgo del ciclo de categorías.
   *
   * Prueba exactamente lo que la carrera real produciría: que el error de la
   * base sale traducido y no como un P2003 crudo que nadie atrapa.
   */
  it('si el conteo no la ve pero la FK sí, sale traducido y no como un P2003 crudo', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Carrera', tipo: 'PRODUCTO', precio: d('100'),
    })
    // La venta es del OTRO tenant y apunta a nuestro artículo. El conteo de
    // `borrarArticulo` corre con `arandano.tenant_id` en el nuestro, así que
    // esta fila no existe para él.
    const v = await owner.query(
      `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 100.00, now()) RETURNING id`,
      [otroTenantId, proximoNumero++, usuarioAjeno],
    )
    await owner.query(
      `INSERT INTO venta_items
         (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Ajena', 1, 100.00)`,
      [otroTenantId, v.rows[0].id, a.id],
    )

    const e = await borrarArticulo({ tenantId, articuloId: a.id }).catch((x) => x)
    expect(e, 'un P2003 crudo llegaría a la pantalla como 500').toBeInstanceOf(ErrorDeInventario)
    expect(e.codigo).toBe('ARTICULO_CON_VENTAS')
  })

  it('rechaza un artículo que no existe en este tenant, y un id malformado', async () => {
    await expect(
      borrarArticulo({ tenantId, articuloId: '00000000-0000-7000-8000-000000000000' }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
    await expect(
      borrarArticulo({ tenantId, articuloId: 'no-es-uuid' }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })

  it('no borra el artículo de otro tenant', async () => {
    const ajeno = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'AJENO-B', 'Ajeno', 'PRODUCTO', 100.00, 0, now(), now())
       RETURNING id`,
      [otroTenantId],
    )
    await expect(
      borrarArticulo({ tenantId, articuloId: ajeno.rows[0].id }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
    expect(await existe(ajeno.rows[0].id)).toBe(true)
  })
})

describe('resumenDeBorrado', () => {
  it('cuenta los movimientos, las unidades y las ventas del artículo', async () => {
    const a = await crearArticuloConSerie('Para el resumen', ['333333333333333', '444444444444444'])
    await ingresarStock({
      tenantId, articuloId: a.id, usuarioId, cantidad: d('1'), imeis: ['555555555555555'],
    })

    const r = await resumenDeBorrado(tenantId, a.id)
    expect(r.unidades).toBe(3)
    expect(r.movimientos).toBe(1)
    expect(r.ventas).toBe(0)
  })

  it('no cuenta lo de otro artículo', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vacío', tipo: 'PRODUCTO', precio: d('100'),
    })
    const r = await resumenDeBorrado(tenantId, a.id)
    expect(r).toEqual({ movimientos: 0, unidades: 0, ventas: 0 })
  })
})
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run test/inventario.test.ts -t 'borrar un artículo'`
Expected: FAIL con `borrarArticulo is not a function`.

- [ ] **Step 3: Agregar el código de error**

En `lib/inventario/errores.ts`, dentro del union `CodigoErrorDeInventario`,
después de `'ARTICULO_INEXISTENTE'`:

```ts
  // Lo tira `borrarArticulo` por los DOS caminos: el conteo previo de
  // venta_items, y la violación de la FK cuando el conteo pierde la carrera
  // contra un cobro. Los dos dan el mismo código a propósito — para quien
  // borra es el mismo hecho.
  | 'ARTICULO_CON_VENTAS'
```

- [ ] **Step 4: Escribir `borrarArticulo` y `resumenDeBorrado`**

En `lib/inventario/articulos.ts`, al final del archivo (después de
`reactivarArticulo`):

```ts
export type ResumenDeBorrado = {
  movimientos: number
  unidades: number
  ventas: number
}

/**
 * Qué se lleva puesto el borrado, para que el diálogo diga números reales.
 *
 * Una sola consulta con `_count` anidado y no tres `count` sueltos: son tres
 * subconsultas sobre la misma fila.
 *
 * **Puede quedar vieja** entre que la pantalla se renderiza y alguien aprieta
 * Borrar, y está bien: la pantalla informa, la base decide. Ese reparto es lo
 * que justifica que el guard sea la FK de `venta_items` y no este número.
 */
export async function resumenDeBorrado(
  tenantId: string,
  articuloId: string,
): Promise<ResumenDeBorrado> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const fila = await tx.articulo.findUnique({
      where: { id: articuloId },
      select: { _count: { select: { movimientos: true, unidades: true, ventaItems: true } } },
    })
    if (!fila) return { movimientos: 0, unidades: 0, ventas: 0 }
    return {
      movimientos: fila._count.movimientos,
      unidades: fila._count.unidades,
      ventas: fila._count.ventaItems,
    }
  })
}

/**
 * El artículo desaparece, con su historial de stock y sus unidades.
 *
 * Es el acto opuesto a `desactivarArticulo`, no una versión más fuerte:
 * desactivar es para el artículo que se deja de vender —su historia importa y
 * queda—, y esto es para el que nunca debió existir, el duplicado cargado por
 * error, que no tiene historia que preservar.
 *
 * **El conteo de ventas de acá abajo NO es la garantía**: es para poder
 * escribir un mensaje que se entienda. La garantía es que
 * `venta_items.articulo_id` sigue siendo `ON DELETE RESTRICT`, así que si
 * alguien cobra el artículo entre el conteo y el DELETE, la base rechaza el
 * borrado igual. Mismo criterio que la idempotencia del cobro (el índice
 * único, no el `findFirst` previo) y que la carrera por una unidad (el
 * `updateMany` condicional).
 */
export async function borrarArticulo(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  const { tenantId, articuloId } = entrada
  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      const ventas = await tx.ventaItem.count({ where: { articuloId } })
      if (ventas > 0) {
        throw new ErrorDeInventario('ARTICULO_CON_VENTAS', mensajeDeVentas(ventas))
      }

      // `deleteMany` y no `delete`, por lo mismo que `marcarBaja` usa
      // `updateMany`: un id de otro tenant no encuentra fila (RLS lo esconde) y
      // devuelve `count: 0` en vez de tirar un error de Prisma que nadie
      // atrapa. "No existe" y "no es tuyo" tienen que ser la misma respuesta.
      const { count } = await tx.articulo.deleteMany({ where: { id: articuloId } })
      if (count === 0) {
        throw new ErrorDeInventario(
          'ARTICULO_INEXISTENTE',
          `el artículo ${articuloId} no existe en este tenant`,
        )
      }
    })
  } catch (e) {
    // P2003 = FK violada. Se traduce ACÁ y no en `traducirErrorDeBase`, a
    // propósito: ahí un P2003 puede venir de cualquier otra FK del módulo —la
    // de categorías, por ejemplo— y significaría otra cosa. Un traductor que
    // conteste "tiene ventas" ante cualquier FK violada manda a buscar donde
    // no es. Acá, en cambio, la única FK Restrict que puede frenar este DELETE
    // es la de venta_items.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') {
      throw new ErrorDeInventario(
        'ARTICULO_CON_VENTAS',
        'este artículo se vendió: borrarlo se llevaría esas ventas. Podés desactivarlo.',
      )
    }
    throw traducirErrorDeBase(e)
  }
}

function mensajeDeVentas(ventas: number): string {
  return ventas === 1
    ? 'este artículo se vendió 1 vez: borrarlo se llevaría esa venta. Podés desactivarlo.'
    : `este artículo se vendió ${ventas} veces: borrarlo se llevaría esas ventas. Podés desactivarlo.`
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run test/inventario.test.ts`
Expected: PASS, todo el archivo.

- [ ] **Step 6: Commitear**

```bash
git add lib/inventario/errores.ts lib/inventario/articulos.ts test/inventario.test.ts
git commit -m "feat(borrar-articulo): el motor, con el conteo para el mensaje y la FK para la garantía

borrarArticulo cuenta las ventas para poder escribir un mensaje que se
entienda, y traduce el P2003 al mismo código cuando pierde la carrera contra
un cobro. La traducción vive en su propio catch y no en traducirErrorDeBase:
ahí un P2003 puede venir de la FK de categorías y significaría otra cosa.

resumenDeBorrado devuelve los tres números en una sola consulta.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

### Task 4: La acción `borrarArticuloAccion`

**Files:**
- Modify: `app/(app)/inventario/acciones.ts`
- Test: `app/(app)/inventario/acciones.test.ts`

**Interfaces:**
- Consumes: `borrarArticulo` de la Task 3, `'ARTICULOS_BORRAR'` de la Task 2.
- Produces:
  `borrarArticuloAccion(_e: EstadoInventario, datos: FormData): Promise<EstadoInventario>`
  — lee `articuloId` del FormData; devuelve `{ error: null, aviso: 'Artículo
  borrado.' }` o `{ error: <mensaje>, aviso: null }`.

- [ ] **Step 1: Escribir los casos que fallan**

En `app/(app)/inventario/acciones.test.ts`, agregar la declaración al tope
junto a las otras:

```ts
let borrarArticuloAccion: typeof import('./acciones').borrarArticuloAccion
```

incluirla en el import dinámico del `beforeAll` donde ya se traen las demás, y
agregar al final del archivo:

El archivo ya trae todo lo que hace falta: `crearArticuloDePrueba(nombre,
stock)`, `comoEmpleadoSinPermisos(fn)`, `estado.cookie`, `cookieDuenio`,
`INICIAL`, `owner` y el mock de `forbidden` que tira `'FORBIDDEN'`. Lo único
nuevo es un helper para colgarle una venta a un artículo:

```ts
describe('borrarArticuloAccion', () => {
  let proximoNumeroAcc = 7000
  /** Una venta con una línea del artículo, cruda con el owner: lo que importa
   *  es que exista la fila de venta_items que frena el borrado. */
  async function venderCrudo(articuloId: string) {
    const u = await owner.query(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [
      estado.tenantId,
    ])
    const v = await owner.query(
      `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 100.00, now()) RETURNING id`,
      [estado.tenantId, proximoNumeroAcc++, u.rows[0].id],
    )
    await owner.query(
      `INSERT INTO venta_items
         (id, tenant_id, venta_id, articulo_id, descripcion, cantidad, precio_unitario)
       VALUES (gen_random_uuid(), $1, $2, $3, 'Una línea', 1, 100.00)`,
      [estado.tenantId, v.rows[0].id, articuloId],
    )
  }

  function formData(articuloId: string) {
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    return datos
  }

  it('un DUEÑO borra el artículo y la acción avisa', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Duplicado de la acción')
    const r = await borrarArticuloAccion(INICIAL, formData(id))
    expect(r).toEqual({ error: null, aviso: 'Artículo borrado.' })

    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM articulos WHERE id = $1`, [
      id,
    ])
    expect(rows[0].n).toBe(0)
  })

  // El error de dominio vuelve como cartel y no como excepción: es lo que la
  // persona puede resolver desactivando, así que tiene que verlo escrito.
  it('un artículo vendido vuelve como error, no como 500', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Vendido de la acción')
    await venderCrudo(id)
    const r = await borrarArticuloAccion(INICIAL, formData(id))
    expect(r.aviso).toBeNull()
    expect(r.error).toMatch(/se vendió/)
  })

  // El permiso corta ANTES de tocar la base, igual que el resto de las
  // acciones de este archivo. Y se comprueba el efecto, no sólo el throw: el
  // artículo tiene que seguir estando.
  it('un empleado sin ARTICULOS_BORRAR no llega a borrar nada', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Que el empleado no puede borrar')
    await expect(
      comoEmpleadoSinPermisos(() => borrarArticuloAccion(INICIAL, formData(id))),
    ).rejects.toThrow('FORBIDDEN')

    const { rows } = await owner.query(`SELECT count(*)::int AS n FROM articulos WHERE id = $1`, [
      id,
    ])
    expect(rows[0].n).toBe(1)
  })

  // Y que sea ESE permiso y no el de editar: los dos son distintos a propósito.
  it('exige ARTICULOS_BORRAR y no ARTICULOS_EDITAR', () => {
    expect(FUENTE).toMatch(/borrarArticuloAccion[\s\S]{0,400}comoPuede\('ARTICULOS_BORRAR'/)
  })
})
```

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run "app/(app)/inventario/acciones.test.ts" -t borrarArticuloAccion`
Expected: FAIL — `borrarArticuloAccion is not a function`.

- [ ] **Step 3: Escribir la acción**

En `app/(app)/inventario/acciones.ts`, importar `borrarArticulo` junto a
`desactivarArticulo` en el import de `@/lib/inventario/articulos`, y agregar
inmediatamente después de `reactivarArticuloAccion`:

```ts
/**
 * Borrar de verdad, no desactivar.
 *
 * **`ARTICULOS_BORRAR` y no `ARTICULOS_EDITAR`**, que es el que gobierna a las
 * dos acciones de acá arriba: desactivar y reactivar mueven una columna y se
 * deshacen con un click; esto no se deshace. Se delega por lo que la acción
 * mueve, no por el sustantivo que la nombra.
 *
 * **No revalida `/inventario/[id]`**, a diferencia de sus vecinas: esa ruta
 * deja de existir. Quien la llama navega a `/inventario`, que sí se revalida
 * para que el listado no venga cacheado con el artículo todavía adentro.
 */
export async function borrarArticuloAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoPuede('ARTICULOS_BORRAR', (tenantId) => borrarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    return { error: null, aviso: 'Artículo borrado.' }
  } catch (e) {
    return traducir(e)
  }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/inventario/acciones.test.ts" test/use-server.test.ts`
Expected: PASS. `use-server.test.ts` verifica que este archivo sólo exporte
funciones async — si falla, es que se agregó una constante por error.

- [ ] **Step 5: Commitear**

```bash
git add "app/(app)/inventario/acciones.ts" "app/(app)/inventario/acciones.test.ts"
git commit -m "feat(borrar-articulo): la acción, detrás de ARTICULOS_BORRAR

Y sin revalidar /inventario/[id], que es la única de las tres acciones de
artículo cuya ruta deja de existir al terminar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

### Task 5: El diálogo, con sus dos caras

**Files:**
- Create: `app/(app)/inventario/borrar-dialogo.tsx`
- Create: `app/(app)/inventario/borrar-dialogo.test.tsx`

**Interfaces:**
- Consumes: `borrarArticuloAccion` (Task 4), `ResumenDeBorrado` (Task 3).
- Produces:
  `<DialogoDeBorrado articuloId nombre desactivado resumen movil? />`, un
  componente cliente que incluye su propio `<Button>` disparador. `movil`
  elige el estilo del trigger, igual que `DialogoDePlan` en
  `app/(app)/formas-de-pago/formularios.tsx`.

- [ ] **Step 1: Escribir el test del componente**

Crear `app/(app)/inventario/borrar-dialogo.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// acciones.ts es 'use server' y su contrato ya lo prueba acciones.test.ts
// contra una base real. Acá sólo importa qué renderiza el diálogo.
vi.mock('./acciones', () => ({ borrarArticuloAccion: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

async function render(
  resumen: { movimientos: number; unidades: number; ventas: number },
  extra: Partial<{ desactivado: boolean; movil: boolean }> = {},
) {
  const { DialogoDeBorrado } = await import('./borrar-dialogo')
  return renderToStaticMarkup(
    <DialogoDeBorrado
      articuloId="a1"
      nombre="Vidrio templado 9H"
      desactivado={extra.desactivado ?? false}
      resumen={resumen}
      movil={extra.movil ?? false}
    />,
  )
}

// `DialogContent` de Radix sólo se monta cuando el diálogo está abierto, así
// que un render estático ve el TRIGGER y no el contenido. Lo que se afirma acá
// es lo que se puede afirmar sin un navegador: que el disparador existe, cómo
// se rotula y que el texto del cuerpo lo arma la función pura de abajo.
describe('DialogoDeBorrado', () => {
  it('dibuja el disparador con la palabra Borrar', async () => {
    expect(await render({ movimientos: 0, unidades: 0, ventas: 0 })).toContain('Borrar')
  })

  it('lo dibuja también en el teléfono', async () => {
    expect(await render({ movimientos: 0, unidades: 0, ventas: 0 }, { movil: true })).toContain(
      'Borrar',
    )
  })
})

describe('el texto de lo que se lleva', () => {
  it('nombra sólo lo que existe', async () => {
    const { queSeLleva } = await import('./borrar-dialogo')
    expect(queSeLleva({ movimientos: 0, unidades: 0, ventas: 0 })).toBe(
      'Se borra el artículo. No se puede deshacer.',
    )
    expect(queSeLleva({ movimientos: 3, unidades: 0, ventas: 0 })).toBe(
      'Se borran el artículo y sus 3 movimientos de stock. No se puede deshacer.',
    )
    expect(queSeLleva({ movimientos: 3, unidades: 5, ventas: 0 })).toBe(
      'Se borran el artículo, sus 3 movimientos de stock y sus 5 unidades. No se puede deshacer.',
    )
  })

  it('usa el singular cuando es uno solo', async () => {
    const { queSeLleva } = await import('./borrar-dialogo')
    expect(queSeLleva({ movimientos: 1, unidades: 1, ventas: 0 })).toBe(
      'Se borran el artículo, su movimiento de stock y su unidad. No se puede deshacer.',
    )
  })
})

describe('el motivo cuando no se puede', () => {
  it('nombra las ventas y ofrece desactivar', async () => {
    const { porQueNo } = await import('./borrar-dialogo')
    expect(porQueNo(3, false)).toContain('se vendió 3 veces')
    expect(porQueNo(3, false)).toContain('Podés desactivarlo')
  })

  it('no ofrece desactivar un artículo que ya está desactivado', async () => {
    const { porQueNo } = await import('./borrar-dialogo')
    expect(porQueNo(1, true)).toContain('se vendió 1 vez')
    expect(porQueNo(1, true)).not.toContain('desactivarlo')
  })
})
```

- [ ] **Step 2: Correrlo y ver que falla**

Run: `npx vitest run "app/(app)/inventario/borrar-dialogo.test.tsx"`
Expected: FAIL — `Cannot find module './borrar-dialogo'`.

- [ ] **Step 3: Escribir el componente**

Crear `app/(app)/inventario/borrar-dialogo.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import type { ResumenDeBorrado } from '@/lib/inventario/articulos'
import { borrarArticuloAccion } from './acciones'

/**
 * Qué se lleva puesto el borrado, en una oración.
 *
 * Exportada y pura para poder probarla: `DialogContent` de Radix sólo se monta
 * cuando el diálogo está abierto, así que un render estático no la ve nunca.
 * Es la misma razón por la que el ABM de categorías separó sus textos.
 *
 * Las líneas que no aplican no se escriben: un artículo sin unidades no dice
 * "y sus 0 unidades".
 */
export function queSeLleva(resumen: ResumenDeBorrado): string {
  const partes: string[] = []
  if (resumen.movimientos > 0) {
    partes.push(
      resumen.movimientos === 1
        ? 'su movimiento de stock'
        : `sus ${resumen.movimientos} movimientos de stock`,
    )
  }
  if (resumen.unidades > 0) {
    partes.push(resumen.unidades === 1 ? 'su unidad' : `sus ${resumen.unidades} unidades`)
  }
  if (partes.length === 0) return 'Se borra el artículo. No se puede deshacer.'
  const lista =
    partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
  return `Se borran el artículo${partes.length === 1 ? ' y ' : ', '}${lista}. No se puede deshacer.`
}

/**
 * Por qué no se puede borrar. Ofrece desactivar sólo si hay algo que ofrecer:
 * en un artículo que YA está desactivado, esa salida no existe.
 */
export function porQueNo(ventas: number, desactivado: boolean): string {
  const cuantas = ventas === 1 ? 'se vendió 1 vez' : `se vendió ${ventas} veces`
  const salida = desactivado
    ? ''
    : ' Podés desactivarlo: deja de ofrecerse y su historial queda intacto.'
  return `Este artículo ${cuantas}: borrarlo se llevaría esas ventas.${salida}`
}

/**
 * El botón "Borrar" de la ficha, con su diálogo.
 *
 * **Se dibuja siempre**, con ventas o sin ellas: quien busca el botón y no lo
 * encuentra asume que la feature no existe, y este diálogo es el único lugar
 * donde la regla se puede explicar en el momento en que importa. Con ventas, el
 * botón de confirmar queda apagado y a la vista —no ausente—, que es lo que ata
 * el mensaje a la acción que la persona vino a hacer.
 *
 * **El toast se lanza en el handler**, con el resultado en la mano, y NO en un
 * `useEffect`: es la lección del ABM de categorías. El `<Toaster>` vive en el
 * root layout, así que sobrevive a la navegación que sigue.
 *
 * `movil` elige el estilo del trigger, igual que `DialogoDePlan` de
 * `/formas-de-pago`: es UN componente instanciado dos veces, no dos
 * implementaciones que haya que acordarse de sincronizar.
 */
export function DialogoDeBorrado({
  articuloId,
  nombre,
  desactivado,
  resumen,
  movil = false,
}: {
  articuloId: string
  nombre: string
  desactivado: boolean
  resumen: ResumenDeBorrado
  movil?: boolean
}) {
  const [abierto, setAbierto] = useState(false)
  const [enCurso, empezar] = useTransition()
  const router = useRouter()
  const sePuede = resumen.ventas === 0

  function borrar() {
    empezar(async () => {
      const datos = new FormData()
      datos.set('articuloId', articuloId)
      const r = await borrarArticuloAccion({ error: null, aviso: null }, datos)
      if (r.error) {
        toast.error(r.error, { id: `borrar-${articuloId}`, duration: Infinity })
        return
      }
      setAbierto(false)
      toast.success(`${nombre} se borró del inventario.`, { id: `borrar-${articuloId}` })
      router.push('/inventario')
    })
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="destructive" className={movil ? 'shrink-0' : undefined}>
          <Trash2 aria-hidden="true" className="size-[15px]" />
          Borrar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sePuede ? `¿Borrar "${nombre}"?` : `No se puede borrar "${nombre}"`}
          </DialogTitle>
          <DialogDescription>
            {sePuede ? queSeLleva(resumen) : porQueNo(resumen.ventas, desactivado)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button variant="destructive" disabled={!sePuede || enCurso} onClick={borrar}>
            {enCurso ? 'Borrando…' : 'Borrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run "app/(app)/inventario/borrar-dialogo.test.tsx"`
Expected: PASS. Si `queSeLleva` falla por el armado de la oración, ajustar la
función hasta que los cuatro strings del test salgan exactos — el test es la
especificación del texto.

- [ ] **Step 5: Commitear**

```bash
git add "app/(app)/inventario/borrar-dialogo.tsx" "app/(app)/inventario/borrar-dialogo.test.tsx"
git commit -m "feat(borrar-articulo): el diálogo, con sus dos caras

Sin ventas dice qué se lleva puesto, con números reales; con ventas explica
por qué no se puede y ofrece desactivar — salvo que ya esté desactivado,
donde esa salida no existe.

El trigger se elige por \`movil\`, un solo componente para las dos copias:
es lo que evita que se desincronicen, que es como este repo ya se comió un
bug en el merge del ciclo del teléfono.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

### Task 6: Enchufarlo en la ficha, en las dos copias

**Files:**
- Modify: `app/(app)/inventario/formularios.tsx` (`FichaDeArticulo`: props, `acciones` del `<Encabezado>`, pie del teléfono)
- Modify: `app/(app)/inventario/[id]/page.tsx`
- Modify: `app/(app)/inventario/formularios.test.tsx`
- Modify: `test/permisos-en-las-dos-copias.test.ts`
- Modify: `docs/pantallas.md`, `docs/correcciones-pendientes-del-pen.md`

**Interfaces:**
- Consumes: `<DialogoDeBorrado>` (Task 5), `resumenDeBorrado` (Task 3),
  `'ARTICULOS_BORRAR'` (Task 2).
- Produces: `FichaDeArticulo` acepta dos props nuevas —
  `puedeBorrar: boolean` y `resumenBorrado: ResumenDeBorrado | null`.

- [ ] **Step 1: Escribir los casos de las dos copias**

En `app/(app)/inventario/formularios.test.tsx`:

1. agregar `borrarArticuloAccion: vi.fn()` al `vi.mock('./acciones', …)` del
   tope,
2. agregar `vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))`
   si el archivo todavía no lo tiene,
3. extender el helper `renderFicha` con las dos props nuevas:

```tsx
async function renderFicha(
  categoriaId: string | null,
  extra: Partial<{
    desactivado: boolean
    puedeEditar: boolean
    puedeBorrar: boolean
    moneda: 'ARS' | 'USD'
  }> = {},
) {
  const { FichaDeArticulo } = await import('./formularios')
  return renderToStaticMarkup(
    <SidebarProvider>
      <FichaDeArticulo
        titulo="Vidrio templado 9H"
        subtitulo="SKU 000412 · Producto"
        articuloId="a1"
        nombre="Vidrio templado 9H"
        sku="000412"
        precio="12000"
        moneda={extra.moneda ?? 'ARS'}
        arbol={ARBOL}
        categoriaId={categoriaId}
        desactivado={extra.desactivado ?? false}
        puedeEditar={extra.puedeEditar ?? true}
        puedeBorrar={extra.puedeBorrar ?? true}
        resumenBorrado={{ movimientos: 3, unidades: 0, ventas: 0 }}
        columnaIzquierda={<div>columna izquierda</div>}
      />
    </SidebarProvider>,
  )
}
```

4. y agregar, junto al caso `'las DOS copias de cada botón las gobierna el
   mismo puedeEditar'`:

```tsx
  // El mismo caso que el de arriba, para el botón nuevo y su permiso propio:
  // cuenta en las DOS direcciones. Un `not.toContain` no alcanzaría —pasaría
  // igual si una copia quedó gateada y la otra no.
  it('las DOS copias de "Borrar" las gobierna puedeBorrar, no puedeEditar', async () => {
    const con = await renderFicha(null, { puedeBorrar: true })
    const sin = await renderFicha(null, { puedeBorrar: false })
    expect([...con.matchAll(/Borrar/g)]).toHaveLength(2)
    expect([...sin.matchAll(/Borrar/g)]).toHaveLength(0)
  })

  // Los dos permisos son independientes de verdad: un empleado que puede
  // borrar pero no editar tiene que ver "Borrar" y no "Guardar cambios".
  it('puedeEditar y puedeBorrar no se arrastran entre sí', async () => {
    const soloBorrar = await renderFicha(null, { puedeEditar: false, puedeBorrar: true })
    expect([...soloBorrar.matchAll(/Borrar/g)]).toHaveLength(2)
    expect(soloBorrar).not.toContain('Guardar cambios')

    const soloEditar = await renderFicha(null, { puedeEditar: true, puedeBorrar: false })
    expect(soloEditar).not.toContain('Borrar')
    expect([...soloEditar.matchAll(/Guardar cambios/g)]).toHaveLength(2)
  })
```

Y en `test/permisos-en-las-dos-copias.test.ts`, un `describe` nuevo que cubra
por FUENTE lo que el render no ve (que `page.tsx` resuelve el permiso y no lo
confunde con el de editar):

```ts
describe('/inventario/[id]: "Borrar" existe dos veces y las dos las gobierna ARTICULOS_BORRAR', () => {
  const FICHA = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
  const PAGE = readFileSync('app/(app)/inventario/[id]/page.tsx', 'utf8')

  it('la pantalla resuelve el permiso propio, no reusa ARTICULOS_EDITAR', () => {
    expect(PAGE).toContain("puedeConSesion(sesion, 'ARTICULOS_BORRAR')")
  })

  it('las dos copias del diálogo se guardan con la MISMA expresión', () => {
    expect([...FICHA.matchAll(/puedeBorrar && <DialogoDeBorrado/g)]).toHaveLength(2)
  })

  it('ninguna copia se cuela con puedeEditar', () => {
    expect(FICHA).not.toMatch(/puedeEditar && <DialogoDeBorrado/)
  })
})
```

**Ajustar los regex al código real** que se escriba en el Step 3 — si el JSX
queda con otro formato (por ejemplo `{puedeBorrar && (` con salto de línea),
el `matchAll` tiene que matchear eso.

- [ ] **Step 2: Correrlos y ver que fallan**

Run: `npx vitest run "app/(app)/inventario/formularios.test.tsx" test/permisos-en-las-dos-copias.test.ts`
Expected: FAIL — `Borrar` aparece 0 veces y `page.tsx` no menciona el permiso.

- [ ] **Step 3: Sumar las props y las dos copias en `FichaDeArticulo`**

En `app/(app)/inventario/formularios.tsx`:

1. importar el diálogo y el tipo:

```tsx
import { DialogoDeBorrado } from './borrar-dialogo'
import type { ResumenDeBorrado } from '@/lib/inventario/articulos'
```

2. agregar las dos props a la firma de `FichaDeArticulo` (en el objeto
   desestructurado y en su tipo), junto a `puedeEditar`:

```tsx
  puedeBorrar,
  resumenBorrado,
```
```tsx
  puedeBorrar: boolean
  resumenBorrado: ResumenDeBorrado | null
```

3. dentro de `acciones={…}` del `<Encabezado>`, **antes** del botón de
   Desactivar. El `acciones` de hoy es `puedeEditar ? (<>…</>) : undefined`, y
   con dos permisos independientes eso ya no alcanza: pasa a ser un fragmento
   con las dos guardas adentro.

```tsx
        acciones={
          puedeEditar || puedeBorrar ? (
            <>
              {/* Primero el borrado y después la baja, en el mismo orden en
                  las dos copias: el de la izquierda es el más destructivo. */}
              {puedeBorrar && <DialogoDeBorrado
                articuloId={articuloId}
                nombre={nombre}
                desactivado={desactivado}
                resumen={resumenBorrado ?? { movimientos: 0, unidades: 0, ventas: 0 }}
              />}
              {puedeEditar && (
                <>
                  {/* … los dos botones que ya estaban, sin cambios … */}
                </>
              )}
            </>
          ) : undefined
        }
```

4. y lo mismo en el pie del teléfono, donde hoy la guarda es
   `{puedeEditar && (<div className="sticky …">…)}`: la condición del `div`
   pasa a `puedeEditar || puedeBorrar`, el par de botones existente queda
   envuelto en su propio `{puedeEditar && (<>…</>)}`, y el diálogo entra
   primero:

```tsx
      {(puedeEditar || puedeBorrar) && (
        <div className="sticky bottom-0 z-10 flex items-center gap-[10px] border-t bg-card p-[14px] lg:hidden">
          {puedeBorrar && <DialogoDeBorrado
            articuloId={articuloId}
            nombre={nombre}
            desactivado={desactivado}
            resumen={resumenBorrado ?? { movimientos: 0, unidades: 0, ventas: 0 }}
            movil
          />}
          {puedeEditar && (
            <>
              {/* … los dos botones que ya estaban, sin cambios … */}
            </>
          )}
        </div>
      )}
```

- [ ] **Step 4: Resolver el permiso y el resumen en la página**

En `app/(app)/inventario/[id]/page.tsx`:

1. importar `resumenDeBorrado` de `@/lib/inventario/articulos`,
2. junto a los otros permisos (línea ~256):

```tsx
  const puedeBorrar = await puedeConSesion(sesion, 'ARTICULOS_BORRAR')
```

3. sumar el resumen al `Promise.all` que ya existe, condicionado al permiso —
   mismo criterio que `puedeEditar ? arbolDeCategorias(…) : []`: sin el
   permiso no hay diálogo que alimentar y la consulta sería trabajo tirado.

```tsx
  const [movimientos, ultimoConCosto, ventasPorMes, planes, arbol, unidades, resumenBorrado] =
    await Promise.all([
      // … los seis que ya estaban, sin cambios …
      puedeBorrar ? resumenDeBorrado(sesion.tenant.id, id) : null,
    ])
```

4. y pasarlas al componente, junto a `puedeEditar`:

```tsx
      puedeBorrar={puedeBorrar}
      resumenBorrado={resumenBorrado}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/inventario" test/permisos-en-las-dos-copias.test.ts test/responsive.test.ts`
Expected: PASS. `responsive.test.ts` marca anchos fijos sin prefijo `lg:` — si
el diálogo introdujo alguno, sacarlo.

- [ ] **Step 6: Verificar que compila de verdad**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. **Esto no es opcional en esta task**: un Server
Component que le pasa mal las props a un componente cliente es un error de
runtime que ningún test de este repo ve.

- [ ] **Step 7: Documentar la pantalla**

En `docs/pantallas.md`, sección `` `/inventario/[id]` ``, agregar a la lista de
features:

```markdown
- **Borrar el artículo**, que es otro acto que desactivarlo: es para el que se
  cargó por error y nunca vendió nada. El botón se dibuja siempre —en el Topbar
  y en el pie del teléfono, las dos copias con la misma guarda— y el diálogo
  tiene dos caras: sin ventas dice qué se lleva puesto (el artículo, sus
  movimientos de stock y sus unidades, con los números reales), y con ventas
  explica por qué no se puede y ofrece desactivar. Detrás de `ARTICULOS_BORRAR`,
  que es propio y no `ARTICULOS_EDITAR`: desactivar se deshace, esto no. La
  regla la sostiene la base —`venta_items.articulo_id` es `Restrict`—, no el
  conteo que el diálogo muestra.
```

Y en `docs/correcciones-pendientes-del-pen.md`, una entrada nueva siguiendo el
formato de las que ya están (la última es la 31), con: que la maqueta no dibuja
ni el botón "Borrar" ni su diálogo en ningún ancho, que se derivó del `Dialog`
de shadcn ya usado en `/usuarios` y `/formas-de-pago`, y que la posición
elegida es a la izquierda de "Desactivar" en las dos copias.

- [ ] **Step 8: Commitear**

```bash
git add "app/(app)/inventario" test/permisos-en-las-dos-copias.test.ts docs/pantallas.md docs/correcciones-pendientes-del-pen.md
git commit -m "feat(borrar-articulo): el botón en la ficha, en las dos copias

Topbar de escritorio y pie del teléfono, las dos con la misma guarda. El
\`acciones\` del Encabezado deja de ser un ternario sobre puedeEditar: con dos
permisos independientes, un empleado que puede borrar y no editar tiene que
ver Borrar y no Guardar cambios.

El resumen se consulta sólo si el permiso está, como el árbol de categorías.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

### Task 7: El cierre del ciclo en `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Correr el gate completo antes de escribir el registro**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS entero. El registro se escribe sobre lo que efectivamente
funciona, no sobre lo que se quiso hacer.

- [ ] **Step 2: Agregar la entrada del ciclo**

En `CLAUDE.md`, en la lista de *Próximos pasos técnicos*, inmediatamente
después de la entrada de "Que el IMEI se pueda cargar cuando el equipo
aparece", pegar esto tal cual:

```markdown
- ~~Poder eliminar un producto del inventario, no sólo desactivarlo.~~
  **Hecho** (2026-09-07). Sale del feedback textual de un cliente:
  *"necesitamos agregar la feature de que se pueda eliminar un producto del
  inventario (no sólo desactivarlo). Más que nada porque si se carga un
  producto dos veces por algún error"*. Ver
  `docs/superpowers/specs/2026-09-07-borrar-articulo-design.md`.

  **Son dos actos distintos y el producto sólo tenía uno.** Desactivar es la
  respuesta correcta para el artículo que se deja de vender: su historial y sus
  ventas quedan. Es la respuesta equivocada para el que nunca debió existir —un
  duplicado desactivado queda para siempre en el listado con su chip, y dentro
  de seis meses nadie sabe por qué está.

  **Revierte a medias un comentario del schema**, el de
  `Articulo.desactivadoEn`, que afirmaba *"un artículo que se deja de vender NO
  se borra"*. Lo que ese comentario mezclaba eran dos reglas: "no se borra lo
  que se vendió", que **se mantiene y se endurece** —pasa de ser la ausencia de
  un botón a ser una FK que Postgres hace cumplir—, y "no se borra nada nunca",
  que era su efecto colateral.

  **Las cinco decisiones, cada una con la alternativa que se descartó:**

  - **Frena una sola cosa: que exista una línea de venta.** Las alternativas
    eran "sólo si está impecable" (sin movimientos ni unidades), que dejaba
    afuera el caso del feedback —cargar el duplicado con stock inicial ya le
    crea un movimiento—, y "se borra siempre" con `VentaItem.articuloId`
    nullable, que dejaba el historial hablando de algo que no existe.
    **Las ventas anuladas también frenan**: anular es un `UPDATE` sobre
    `ventas` y sus `venta_items` siguen en pie.
  - **El guard es la base, no el chequeo.** `VentaItem.articuloId` se queda en
    `Restrict` y `movimientos_stock`/`unidades_articulo` pasan a `Cascade`. La
    aplicación cuenta las ventas antes de borrar **para poder escribir un
    mensaje que se entienda**, no para garantizar nada: si alguien cobra el
    artículo entre el conteo y el `DELETE`, la base lo rechaza igual. Mismo
    criterio que la idempotencia del cobro (el índice único, no el `findFirst`
    previo).
  - **`ARTICULOS_BORRAR`, el noveno del catálogo**, y no plegado sobre
    `ARTICULOS_EDITAR` ni reservado al dueño. Se delega por lo que la acción
    **mueve**: desactivar mueve una columna y se deshace con un click; borrar
    no se deshace y se lleva filas de dos tablas más. Es el mismo escalón que
    ya separa `VENTAS_ANULAR` y `ORDENES_ANULAR` de la edición. La fuente sigue
    siendo `lib/permisos/catalogo.ts`, no este párrafo.
  - **Un diálogo que dice qué se lleva puesto**, con los números reales, contra
    la confirmación en dos pasos sobre el mismo botón que ya usa `AnularVenta`.
    Ese mecanismo se eligió allá para "irreversible pero **frecuente**", y
    borrar un artículo no es frecuente: acá conviene que la persona vea el
    tamaño de lo que está tirando antes de confirmarlo.
  - **El botón se dibuja siempre**, con ventas o sin ellas, y es el diálogo el
    que explica. Esconderlo deja a quien lo busca asumiendo que la feature no
    existe; el diálogo es el único lugar donde la regla se puede enseñar en el
    momento en que importa.

  **El precio, dicho sin maquillar: el append-only de `movimientos_stock` queda
  con una puerta.** `scripts/setup-db-roles.sh` le revoca `DELETE` al rol de la
  app sobre esa tabla, y unas líneas más abajo revoca `DELETE` sobre
  `ordenes_de_trabajo` **justamente para tapar la puerta de atrás de una
  cascada**. Este ciclo abre esa puerta sobre `movimientos_stock`, acotada:
  sólo la cruza un artículo que nunca produjo una venta. El argumento del
  append-only —poder contestar *"por qué tengo 3 y no 5"*— no se pierde, porque
  cuando el artículo entero desaparece no queda ningún stock que explicar.
  Queda escrito en ese mismo bloque del script, no sólo en el spec, y
  `test/setup-db-roles.test.ts` fija el par entero: el `DELETE` directo sigue
  prohibido y la cascada sí se los lleva. **Depende de que ninguna tabla tenga
  `FORCE ROW LEVEL SECURITY`**, que hoy es el caso.

  **`MovimientoStock.unidadId` pasó de `Restrict` a `NoAction`**, y es el
  detalle que más fácil se lee como arbitrario: al borrar un artículo con
  serie, sus movimientos y sus unidades se van en la MISMA sentencia, y
  `RESTRICT` se evalúa inmediato —sin esperar al final— así que abortaría el
  borrado por una fila que se está yendo igual. `NoAction` es diferible y lo
  tolera. No `Cascade`, porque fuera de este camino ninguna unidad se borra
  nunca: darla de baja es una columna.

  **La migración es inerte y viaja en el mismo deploy que la UI**, mismo
  argumento que el ciclo del precio en USD: ninguna columna se borra ni se
  renombra, y el código viejo no borra artículos por ningún camino, así que las
  cascadas nuevas jamás se disparan. Lo que expand/contract exige no es "la
  migración en un deploy aparte", es que el schema nuevo soporte la versión
  anterior del código.

  **Lo que se acepta: un artículo borrado no deja rastro de ningún tipo.** No
  hay tabla de auditoría, así que después del borrado nadie puede saber que
  existió, ni quién lo borró, ni cuándo. Es lo que se pidió, y es exactamente
  la propiedad que lo separa de desactivar — la que hace que el permiso valga
  la pena tenerlo aparte. Si algún día hace falta el rastro, la salida conocida
  es una tabla-libro de borrados con su propia línea de `REVOKE`, y es aditiva:
  nada de este ciclo habría que deshacer.

  **Lo que este ciclo NO hace**: borrar desde el listado (el click accidental
  cuesta más caro en una fila de tabla, y el flujo del duplicado pasa por la
  ficha igual), borrado masivo, detección de duplicados, y papelera o deshacer
  —un borrado con vuelta atrás es una baja lógica, que es justamente lo que ya
  existía y lo que el pedido dice que no alcanza.

  **`design/arandano.pen` no dibuja ni el botón ni el diálogo**, en ningún
  ancho. Se derivaron con los patrones que ya existen: el `Dialog` de shadcn de
  `/usuarios` y `/formas-de-pago`, y la segunda copia del botón al pie como el
  resto de las acciones de esta ficha. Anotado en
  `docs/correcciones-pendientes-del-pen.md`.

  **Queda pendiente la verificación manual**, y a diferencia de los ciclos de
  permisos, teléfono, planes y categoría en la ficha —que quedaron sin
  confirmar porque `arandano-dev` bind-montea `/root/arandano` y no el
  worktree— acá se puede hacer después del merge. Lo que hay que mirar: cargar
  un duplicado con stock inicial y borrarlo desde la ficha, viendo que el
  listado quede limpio; abrir el diálogo en un artículo vendido y leer el
  mensaje; abrirlo en uno vendido **y ya desactivado**, donde no tiene que
  ofrecer desactivar; mirar el pie a 390 px con "Borrar" y "Guardar cambios" en
  la misma fila; y que un empleado con `ARTICULOS_EDITAR` y sin
  `ARTICULOS_BORRAR` vea "Guardar cambios" y no vea "Borrar".
```

- [ ] **Step 3: Commitear**

```bash
git add CLAUDE.md
git commit -m "docs(borrar-articulo): el cierre del ciclo

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01X8Wo2gDyAFTGkbAjMDrexc"
```

---

## Verificación manual, después del merge

Ningún test de este plan puede contestar estas preguntas. `arandano-dev`
bind-montea `/root/arandano`, así que esto se mira después del merge a `main`,
o en el entorno local de la Mac (`PORT=3001 npm run dev`, entrando por
`http://canario.localhost:3001`).

1. Cargar un artículo con stock inicial 3, entrar a su ficha, borrarlo: el
   diálogo tiene que decir "sus 3 movimientos de stock" —no, es uno solo: el
   del stock inicial— y el listado tiene que quedar sin la fila.
2. Abrir el diálogo en un artículo que se vendió: el mensaje nombra las ventas,
   el botón de borrar está apagado, y "Desactivar" funciona desde ahí.
3. Lo mismo en un artículo vendido **y ya desactivado**: el diálogo no ofrece
   desactivar.
4. A 390 px, con el pie del teléfono: que "Borrar" y "Guardar cambios" entren
   en la misma fila sin desbordar.
5. Con un empleado con `ARTICULOS_EDITAR` y sin `ARTICULOS_BORRAR`: ve
   "Guardar cambios" y "Desactivar", no ve "Borrar".
6. Que el toast aparezca al borrar y sobreviva a la navegación a `/inventario`.
