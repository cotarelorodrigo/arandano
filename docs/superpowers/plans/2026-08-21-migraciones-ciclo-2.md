# Ciclo 2 — Las tres migraciones aditivas

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sumar al schema los tres datos que la maqueta muestra y el modelo no tiene — la categoría del artículo, la caja abierta y la cotización del local — más cerrar los tres residuales que dejó el ciclo del shell.

**Architecture:** Tres migraciones **aditivas y nullable**, en un solo deploy y sin UI. El código que las lee llega en los ciclos de cada pantalla, que es lo que el expand/contract pide: la columna viaja primero, el código después, así el rollback automático siempre tiene a dónde volver. Se suma la lógica de dominio mínima de `Caja` (abrir y cerrar) con sus tests, porque una migración que nada ejercita sólo prueba que el DDL corre.

**Tech Stack:** Prisma 7 sobre PostgreSQL con Row Level Security, vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-maqueta-shell-design.md`, sección *Lo que sigue*.

## Global Constraints

- Código, comentarios y mensajes de commit en **español rioplatense con acentos**. Los comentarios explican POR QUÉ, no QUÉ.
- **`design/arandano.pen` es la autoridad.** Cuando contradice al código, a la documentación o a un test, se modifica lo otro.
- **Migraciones sólo con `npx prisma migrate dev`** contra `arandano_dev`. Nunca `migrate reset` ni `db push`.
- **Toda migración es aditiva.** Ninguna columna se borra ni se renombra. Todo campo nuevo es nullable o trae default.
- **Toda tabla nueva con `tenant_id` necesita su policy de RLS**, con `USING` y `WITH CHECK`, en la misma migración. `test/rls-cobertura.test.ts` falla si falta.
- **`git add` con archivos nombrados, NUNCA `git add -A`.**
- Al terminar: `npm test` en cero fallas, `npm run lint` limpio, `npx tsc --noEmit` limpio.
- Estado de partida: **685 tests pasando** (74 archivos), rama `feat/redesign` en `bdd27ce`.

---

### Task 1: Los tres residuales del sistema de diseño

Cierra lo que la review final del ciclo anterior dejó parqueado. No toca el schema; va primero porque es independiente y saca ruido del camino.

**Files:**
- Modify: `docs/sistema-de-diseno.md`, `components/shell/sidebar-arandano.test.tsx`

**Interfaces:**
- Consumes: nada
- Produces: nada que otra tarea use

- [ ] **Step 1: `px-4` está mal clasificado**

En la sección *Espaciado y radio*, la enmienda lista `px-4` entre los valores que "no son un paso de la escala". Es falso: `px-4` son 16 px, o sea el paso 4, y esa misma sección declara el subconjunto habilitado `1, 2, 3, 4, 6, 8, 12` unas sesenta líneas más arriba.

Sacalo de la lista de exentos. `px-5` (20) y `px-7` (28) sí quedan, porque ésos no están en la escala.

- [ ] **Step 2: La fila de 12 px se borró y dejó texto vivo sin rol**

El ciclo anterior sacó la fila "Identidad, meta, pie · sistema · 12 px · 400" porque describía el pie del shell viejo. Pero el **tamaño** sigue describiendo texto que existe: `text-xs` está en `app/(app)/vender/punto-de-venta.tsx:380` y `:472` (los encabezados de columna y el rótulo "Total") y en `app/(app)/servicio-tecnico/`. En el `.pen` hay diez nodos de `fontSize: 12` en los cuerpos de Vender y Ventas.

La tabla afirma que "un texto que no encaja en ninguno de estos roles es señal de que falta una decisión". Hoy hay ocho usos que no encajan.

Verificá los usos con `grep -rn "text-xs" app components` y mirá el `.pen` para ver qué rol cumplen esos nodos de 12 px. Después sumá la fila que corresponda, con el nombre del rol que de verdad describe (encabezado de columna de tabla, o lo que veas). **No inventes el nombre**: miralo en la maqueta.

- [ ] **Step 3: El `<nav>` sin test**

El ciclo anterior perdió el landmark `<nav>` de las diez pantallas sin que nada lo detectara, y lo devolvió en `components/shell/sidebar-arandano.tsx:70`. Nada impide que se vuelva a perder igual de silenciosamente.

Sumá el caso a `components/shell/sidebar-arandano.test.tsx`:

```tsx
  // El ciclo del shell perdió este landmark en silencio al pasar de <nav> con
  // pestañas a <ul> de shadcn, y nadie se enteró hasta la review final. Un
  // lector de pantalla se quedó sin la navegación de las diez pantallas.
  it('la navegación es un landmark, no una lista suelta', () => {
    const html = render()
    expect(html).toMatch(/<nav[^>]*aria-label="[^"]+"/)
  })
```

- [ ] **Step 4: Probá que el caso nuevo falla**

Sacá temporalmente el `<nav>` de `components/shell/sidebar-arandano.tsx` y corré:

```bash
npx vitest run components/shell/sidebar-arandano.test.tsx
```

Esperado: FAIL en el caso nuevo. Después `git checkout -- components/shell/sidebar-arandano.tsx` y confirmá verde.

- [ ] **Step 5: Correr todo y commitear**

```bash
npm test && npm run lint && npx tsc --noEmit
git add docs/sistema-de-diseno.md components/shell/sidebar-arandano.test.tsx
git commit -m "fix(diseño): los tres residuales que dejó el ciclo del shell"
```

---

### Task 2: `Articulo.categoria`

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Articulo`)
- Create: `prisma/migrations/<timestamp>_categoria_articulo/migration.sql` (lo genera Prisma)
- Modify: `docs/schema.md` (lo regenera el script)

**Interfaces:**
- Consumes: nada
- Produces: `Articulo.categoria: String?` — el ciclo de `/inventario` lo lee para el subtítulo `SKU · tipo · categoría` y para la columna del listado

- [ ] **Step 1: Sumar el campo al schema**

En `prisma/schema.prisma`, modelo `Articulo`, después de `tipo`:

```prisma
  // Texto libre y no una tabla: un catálogo de local no necesita una taxonomía
  // con integridad referencial, y una tabla obliga a un ABM que nadie pidió.
  // La maqueta muestra dos niveles ("Accesorios · Protección"); si el dueño los
  // quiere, los escribe en el campo. Nullable porque los artículos que ya
  // existen no la tienen y ninguno se rompe sin ella.
  categoria     String?
```

- [ ] **Step 2: Generar la migración**

```bash
npx prisma migrate dev --name categoria_articulo
```

Abrí el SQL generado y confirmá que dice `ADD COLUMN "categoria" TEXT` y **nada más**. Si trae algún `DROP` o algún `ALTER … TYPE`, pará y avisá: la migración tiene que ser puramente aditiva.

- [ ] **Step 3: Regenerar el diagrama del schema**

```bash
./scripts/generar-erd.sh
```

`docs/schema.md` se genera desde el DDL, no desde el schema, y el hook de pre-commit más el paso 3 de `deploy.sh` lo verifican. Si no lo regenerás, el commit se rechaza.

- [ ] **Step 4: Correr los tests**

```bash
npm test
```

Esperado: PASS. `test/rls-cobertura.test.ts` no debería reaccionar — `articulos` ya tenía su policy y sumar una columna no la cambia.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md
git commit -m "feat(inventario): la categoría del artículo, que la maqueta muestra y el modelo no tenía"
```

---

### Task 3: El modelo `Caja`

Apertura y cierre, nada más. Sin arqueo, sin movimientos de efectivo, sin pantalla propia — eso es la pieza 6 del roadmap y su propio ciclo.

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Caja` nuevo + relaciones en `Tenant` y `User`)
- Create: `prisma/migrations/<timestamp>_caja/migration.sql`
- Create: `lib/caja/abrir-cerrar.ts`, `lib/caja/abrir-cerrar.test.ts`
- Modify: `docs/schema.md`

**Interfaces:**
- Consumes: `prismaParaTenant(tenantId)` de `lib/tenant/prisma.ts`
- Produces:
  ```ts
  export async function abrirCaja(tenantId: string, usuarioId: string, saldoInicial: string): Promise<{ id: string }>
  export async function cerrarCaja(tenantId: string, usuarioId: string): Promise<{ id: string }>
  export async function cajaAbierta(tenantId: string): Promise<{ id: string; abiertaEn: Date; saldoInicial: Decimal } | null>
  ```
  El ciclo de `/vender` consume `cajaAbierta()` para el chip del header.

- [ ] **Step 1: El modelo**

En `prisma/schema.prisma`, después de `Pago`:

```prisma
// La caja del turno: quién la abrió, con cuánto, y quién la cerró.
//
// Lo que NO tiene, a propósito: arqueo, movimientos de efectivo y cuadre contra
// las ventas del turno. Eso es la pieza 6 del roadmap y su propio ciclo; acá
// entra sólo lo que la maqueta muestra (el chip "Caja abierta" del header de
// /vender), para que ese chip diga la verdad en vez de estar pintado.
model Caja {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid

  abiertaEn    DateTime @default(now()) @map("abierta_en") @db.Timestamptz(3)
  abiertaPorId String   @map("abierta_por_id") @db.Uuid
  // Con cuánto efectivo arranca el turno. Decimal y nunca Float: un flotante
  // binario no representa 0,10 y el error se acumula en cada suma.
  saldoInicial Decimal  @map("saldo_inicial") @db.Decimal(12, 2)

  // Nullable es lo que define "abierta": la caja del turno en curso es la que
  // tiene esto en NULL, y el índice único parcial de la migración usa
  // exactamente esa condición para que no haya dos.
  cerradaEn    DateTime? @map("cerrada_en") @db.Timestamptz(3)
  cerradaPorId String?   @map("cerrada_por_id") @db.Uuid

  creadoEn DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant     Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  abiertaPor User   @relation("CajasAbiertas", fields: [abiertaPorId], references: [id], onDelete: Restrict)
  cerradaPor User?  @relation("CajasCerradas", fields: [cerradaPorId], references: [id], onDelete: Restrict)

  @@index([tenantId, abiertaEn])
  @@map("cajas")
}
```

Y las relaciones inversas: en `Tenant`, `cajas Caja[]`; en `User`, `cajasAbiertas Caja[] @relation("CajasAbiertas")` y `cajasCerradas Caja[] @relation("CajasCerradas")`.

- [ ] **Step 2: Generar la migración**

```bash
npx prisma migrate dev --name caja
```

- [ ] **Step 3: Sumarle a mano el RLS y el índice único parcial**

Prisma **no** genera ninguna de las dos cosas. Editá el SQL recién generado y agregá al final:

```sql
-- Una sola caja abierta por tenant, y esto TIENE que ser un índice y no una
-- validación de aplicación: dos pestañas apretando "Abrir caja" en el mismo
-- segundo pasan las dos por cualquier chequeo previo y abren dos. El índice
-- parcial lo resuelve en la base, que es el único lugar donde la carrera no
-- existe.
CREATE UNIQUE INDEX "cajas_una_abierta_por_tenant"
  ON "cajas" ("tenant_id")
  WHERE "cerrada_en" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "cajas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "cajas" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Después aplicala:

```bash
npx prisma migrate dev
```

- [ ] **Step 4: Escribir los tests, que van primero**

`lib/caja/abrir-cerrar.test.ts`. El montaje sale de `lib/tenant/prisma.test.ts`, que es el
patrón de este repo para un test que toca la base: `@/test/postgres-efimero` da las URLs y
`@/test/datos` da `crearTenant`. **Ojo con el orden del `beforeAll`**: el pool de `lib/db.ts` se
construye al importar leyendo `DATABASE_URL`, así que la variable se fija ANTES del import
dinámico, no después.

Vas a necesitar además un usuario, porque `abiertaPorId` es una FK a `users` con `onDelete:
Restrict`. Fijate si `@/test/datos` ya tiene un helper para eso; si no, creá la fila con el
cliente `owner` como hace `crearTenant`.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantA: string
let tenantB: string
let usuarioA: string
let usuarioB: string
let abrirCaja: typeof import('@/lib/caja/abrir-cerrar').abrirCaja
let cerrarCaja: typeof import('@/lib/caja/abrir-cerrar').cerrarCaja
let cajaAbierta: typeof import('@/lib/caja/abrir-cerrar').cajaAbierta

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'caja-a')
  tenantB = await crearTenant(owner, 'caja-b')
  usuarioA = await crearUsuario(owner, tenantA, 'flor@caja-a.test')
  usuarioB = await crearUsuario(owner, tenantB, 'ruben@caja-b.test')

  process.env.DATABASE_URL = urlApp()
  ;({ abrirCaja, cerrarCaja, cajaAbierta } = await import('@/lib/caja/abrir-cerrar'))
})

afterAll(async () => {
  await owner.end()
})

// Cada caso arranca sin caja abierta: el índice parcial es por tenant, así que
// una caja que quedó abierta de un caso anterior hace fallar al siguiente por
// el motivo equivocado.
beforeEach(async () => {
  await owner.query('DELETE FROM cajas')
})

describe('abrir y cerrar la caja', () => {
  it('abrir deja la caja con cerradaEn en null', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    const abierta = await cajaAbierta(tenantA)
    expect(abierta?.id).toBe(id)
    expect(abierta?.saldoInicial.toString()).toBe('15000')
  })

  it('sin caja abierta, cajaAbierta() devuelve null', async () => {
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  it('cerrar la deja con la fecha y con quién la cerró', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    const fila = await owner.query('SELECT cerrada_en, cerrada_por_id FROM cajas WHERE id = $1', [id])
    expect(fila.rows[0].cerrada_en).not.toBeNull()
    expect(fila.rows[0].cerrada_por_id).toBe(usuarioA)
  })

  it('después de cerrar, cajaAbierta() vuelve a dar null', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  it('se puede abrir una caja nueva después de cerrar la anterior', async () => {
    const primera = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    const segunda = await abrirCaja(tenantA, usuarioA, '20000.00')
    expect(segunda.id).not.toBe(primera.id)
    expect((await cajaAbierta(tenantA))?.id).toBe(segunda.id)
  })

  // El caso que justifica el índice único parcial. Sin el índice, esto pasa —
  // y el paso 8 del plan te hace comprobar exactamente eso.
  it('no deja abrir dos cajas a la vez en el mismo tenant', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await expect(abrirCaja(tenantA, usuarioA, '20000.00')).rejects.toThrow(/ya hay una caja abierta/i)
  })

  // El índice es POR TENANT, no global: dos locales distintos abren a la vez.
  it('dos tenants pueden tener cada uno su caja abierta', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await abrirCaja(tenantB, usuarioB, '9000.00')
    expect(await cajaAbierta(tenantA)).not.toBeNull()
    expect(await cajaAbierta(tenantB)).not.toBeNull()
  })

  it('cerrar sin caja abierta falla con un error claro', async () => {
    await expect(cerrarCaja(tenantA, usuarioA)).rejects.toThrow(/no hay ninguna caja abierta/i)
  })

  // Cualquiera del local abre y cierra, dueño o empleado: en un mostrador abre
  // el que llega primero. La fila registra quién fue, así que la trazabilidad
  // no se pierde, y sin arqueo todavía no hay plata que cuadrar — que es lo
  // único que justificaría restringirlo.
  it('un empleado puede abrir y cerrar', async () => {
    const empleado = await crearUsuario(owner, tenantA, 'nahuel@caja-a.test', 'EMPLEADO')
    await abrirCaja(tenantA, empleado, '15000.00')
    expect(await cajaAbierta(tenantA)).not.toBeNull()
    await cerrarCaja(tenantA, empleado)
    expect(await cajaAbierta(tenantA)).toBeNull()
  })
})
```

Acordate de importar `beforeEach` de vitest, y de escribir `crearUsuario` (o de usar el helper
que ya exista en `@/test/datos` si lo hay — fijate antes de escribir uno nuevo).

- [ ] **Step 5: Correr los tests y verlos fallar**

```bash
npx vitest run lib/caja/abrir-cerrar.test.ts
```

Esperado: FAIL — `Cannot find module './abrir-cerrar'`.

- [ ] **Step 6: Escribir `lib/caja/abrir-cerrar.ts`**

Las tres funciones de la sección *Interfaces*. Dos cosas que no son obvias:

- **Cualquiera del local abre y cierra**, dueño o empleado. Es lo que pasa en un mostrador: el que llega primero abre. La fila registra quién fue, así que la trazabilidad no se pierde — y sin arqueo todavía no hay plata que cuadrar, que es lo que justificaría restringirlo. Dejalo escrito en un comentario, porque es una decisión y no un olvido.
- **El choque del índice único hay que atraparlo y traducirlo.** Un `P2002` de Prisma con el nombre del índice adentro no le sirve a nadie; convertilo en un error con un mensaje que diga que ya hay una caja abierta.

- [ ] **Step 7: Correr los tests y verlos pasar**

```bash
npx vitest run lib/caja/abrir-cerrar.test.ts
```

Esperado: PASS los nueve.

- [ ] **Step 8: Probar que el índice parcial es el que sostiene el caso**

Sacá temporalmente el `CREATE UNIQUE INDEX` (podés dropearlo a mano con `DROP INDEX "cajas_una_abierta_por_tenant";` contra `arandano_dev`) y corré el caso de las dos cajas: **tiene que fallar**. Volvé a crearlo y confirmá verde.

Si el caso pasa igual sin el índice, es que lo estás verificando en la aplicación y no en la base — que es exactamente lo que este paso existe para descartar.

- [ ] **Step 9: Regenerar el ERD, correr todo y commitear**

```bash
./scripts/generar-erd.sh
npm test && npm run lint && npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations docs/schema.md lib/caja/abrir-cerrar.ts lib/caja/abrir-cerrar.test.ts
git commit -m "feat(caja): apertura y cierre, con una sola caja abierta por tenant"
```

`test/rls-cobertura.test.ts` tiene que pasar sin que lo toques: `cajas` tiene `tenant_id` y su policy, así que entra sola por el barrido.

---

### Task 4: `Tenant.cotizacionUsd`

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Tenant`)
- Create: `prisma/migrations/<timestamp>_cotizacion_del_local/migration.sql`
- Modify: `docs/schema.md`

**Interfaces:**
- Consumes: nada
- Produces: `Tenant.cotizacionUsd: Decimal?` y `Tenant.cotizacionUsdEn: DateTime?` — el ciclo de `/vender` los lee para el header

**Antes de escribir nada, leé esto — es la razón por la que este campo no es una duplicación:**

`lib/ventas/buscar.ts:74` ya tiene `ultimaCotizacionUsd()`, que saca la cotización del último `Pago` en dólares, y `/vender` ya la usa. **No son el mismo dato:**

- `Pago.cotizacion` es *a cuánto se cobró aquella venta*. Es histórico e inmutable: una venta de la semana pasada tiene que seguir diciendo su cotización para siempre, aunque el dólar haya cambiado tres veces.
- `Tenant.cotizacionUsd` es *a cuánto está el dólar en este local hoy*. Es el que el dueño fija y el que la maqueta muestra en el header de `/vender`.

Hoy el header sólo puede mostrar el primero, y ése es el problema: si nadie pagó en dólares en cuatro días, muestra la cotización del jueves pasado **sin decir que es vieja**. Por eso el segundo campo, `cotizacionUsdEn`, no es opcional en el diseño aunque la maqueta no lo dibuje.

- [ ] **Step 1: Sumar los campos al schema**

En `prisma/schema.prisma`, modelo `Tenant`, después de `proximoNumeroOrden`:

```prisma
  // A cuánto está el dólar EN ESTE LOCAL, hoy. Lo fija el dueño.
  //
  // No duplica a Pago.cotizacion: aquélla es a cuánto se cobró UNA venta, es
  // histórica y no se toca nunca más. Ésta es el precio de hoy, y cambia. Un
  // ciclo futuro que quiera "unificarlas" estaría borrando la diferencia entre
  // lo que valió y lo que vale.
  cotizacionUsd   Decimal?  @map("cotizacion_usd") @db.Decimal(12, 2)
  // De cuándo es la de arriba. La maqueta no lo dibuja y va igual: un dólar en
  // el header sin saber de cuándo es, es peor que no mostrarlo — el que cobra
  // no tiene forma de saber si está mirando el de hoy o el de la semana pasada.
  cotizacionUsdEn DateTime? @map("cotizacion_usd_en") @db.Timestamptz(3)
```

- [ ] **Step 2: Generar la migración y verificar que es aditiva**

```bash
npx prisma migrate dev --name cotizacion_del_local
```

Abrí el SQL: tienen que ser dos `ADD COLUMN` y nada más.

- [ ] **Step 3: Regenerar el ERD y correr todo**

```bash
./scripts/generar-erd.sh
npm test && npm run lint && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md
git commit -m "feat(caja): la cotización del local, que es el precio de hoy y no el de aquella venta"
```

---

### Task 5: Anotar el ciclo

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: el ciclo cerrado

- [ ] **Step 1: Cerrar las dos decisiones abiertas que este ciclo toca**

`CLAUDE.md` tiene una sección *Decisiones abiertas del modelo de datos*. Dos de sus ítems se mueven con este ciclo:

- El de **`Venta.numero` como número fiscal** no se toca: sigue abierto, es de ARCA.
- El de **stock por sucursal** tampoco.

Lo que sí hay que anotar es el ciclo en sí. En *Próximos pasos técnicos*, debajo del ítem del shell que el ciclo anterior dejó, sumá un párrafo con: las tres migraciones que entraron, que son aditivas y sin UI a propósito (expand/contract), que la caja entra sólo con apertura y cierre y el arqueo sigue siendo la pieza 6, y **la distinción entre `Tenant.cotizacionUsd` y `Pago.cotizacion`**, que es la que alguien va a querer borrar.

Escribilo en la voz del archivo: párrafos que explican el porqué, no una lista de lo hecho.

- [ ] **Step 2: Correr todo y commitear**

```bash
npm test && npm run lint && npx tsc --noEmit
git add CLAUDE.md
git commit -m "docs: el ciclo de las migraciones, y por qué hay dos cotizaciones"
```
