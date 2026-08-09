# Motor de stock y ventas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una venta se pueda crear, anular y ajustar desde el servidor, con el stock siempre correcto y el historial completo — sin interfaz y sin login.

**Architecture:** Cinco tablas nuevas con RLS, más tres funciones de dominio que corren dentro de una transacción atada al tenant. El stock vive denormalizado en `Articulo` y se mueve con `UPDATE` relativo en la misma transacción que su `MovimientoStock`, que es append-only y es el punto de extensión que los módulos futuros van a usar. La aritmética de plata se aísla en un módulo puro, sin base de datos.

**Tech Stack:** Prisma 7 (cliente generado en `generated/prisma`), PostgreSQL 17 con Row Level Security, `Prisma.Decimal` para toda la plata, Vitest 4 contra un Postgres efímero en Docker.

**Spec:** `docs/superpowers/specs/2026-08-09-motor-ventas-stock-design.md`

## Lo primero, porque bloquea todo lo demás

`lib/tenant/prisma.ts` **rechaza a propósito** `$transaction(fn)`, y su mensaje de error nombra literalmente este trabajo:

> Para trabajo atómico multi-paso (p. ej. `crearVentaDesde`: venta + movimiento de stock) hace falta un helper dedicado que abra la transacción interactiva y corra el `set_config` una sola vez adentro — todavía no existe, es tarea aparte.

El motivo del rechazo es correcto: las operaciones dentro del callback pasan igual por `$allOperations`, que las agrupa en **su propio** `$transaction([...])` sobre el cliente base — otra conexión. La atomicidad se perdería sin que nada lo delate.

Por eso la Task 1 es ese helper, y nada más se puede escribir antes.

## Global Constraints

- Todo comentario, mensaje de commit, nombre de variable y texto de salida **en español**, explicando el **porqué** y no el qué.
- **Toda la plata es `Prisma.Decimal`, nunca `number`.** Un flotante binario no representa 0,10 y el error se acumula en cada suma de una caja. `Articulo.precio` ya sienta el precedente.
- Escalas exactas: dinero `Decimal(12, 2)`, cantidades y stock `Decimal(12, 3)`, cotización `Decimal(12, 4)`.
- **Redondeo explícito a 2 decimales antes de sumar**, nunca sumar primero y redondear al final. Modo `ROUND_HALF_UP`.
- Toda tabla nueva lleva `tenant_id` y esta policy, **copiada literal** de `prisma/migrations/20260804205911_inicial/migration.sql`:

  ```sql
  ALTER TABLE "<tabla>" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "tenant_aislamiento" ON "<tabla>" FOR ALL
    USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
  ```

- Ids `uuid(7)`, timestamps `@db.Timestamptz(3)`, nombres de columna en `snake_case` vía `@map`, nombres de tabla en plural. Es lo que ya hace el schema.
- **El historial no se borra.** Los movimientos son append-only; las ventas anuladas se marcan, no se eliminan.
- El stock **puede quedar negativo** y eso no aborta nada.
- **`npm test` corre `scripts/tests/correr-todos.sh && vitest run`**, y `pretest` regenera el cliente de Prisma. Los tests de base usan el Postgres efímero que levanta `test/global-setup.ts`.
- **`docs/schema.md` se regenera con `scripts/generar-erd.sh`** después de cualquier migración. El hook de pre-commit y el paso 3 de `deploy.sh` lo verifican, así que un schema sin ERD actualizado no se puede commitear.
- El motor **no llama a la red** dentro de una transacción: el pool es de 5 conexiones y una transacción interactiva retiene una mientras dura.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/tenant/transaccion.ts` *(nuevo)* | `enTransaccionDeTenant`. Infraestructura de multi-tenancy, no de ventas: el próximo trabajo atómico —una orden de trabajo, un cierre de caja— la va a necesitar igual. |
| `lib/tenant/transaccion.test.ts` *(nuevo)* | Sus tests, incluido el que prueba que la GUC no sobrevive a la transacción. |
| `prisma/schema.prisma` *(modificado)* | Los tres enums y las cinco tablas nuevas, más `stock` en `Articulo` y el contador en `Tenant`. |
| `prisma/migrations/<ts>_ventas_y_stock/migration.sql` *(nuevo)* | La migración, con el bloque de RLS agregado a mano. |
| `lib/ventas/totales.ts` *(nuevo)* | La aritmética de plata. Pura, sin base de datos, sin Prisma más allá del tipo `Decimal`. |
| `lib/ventas/totales.test.ts` *(nuevo)* | Sus tests. Corren sin Docker. |
| `lib/ventas/errores.ts` *(nuevo)* | `ErrorDeVenta` con su código, para que el llamador distinga "faltó stock" de "los pagos no cierran" sin parsear strings. |
| `lib/ventas/crear.ts` *(nuevo)* | `crearVenta`. |
| `lib/ventas/anular.ts` *(nuevo)* | `anularVenta` y `ajustarStock`: las dos escriben movimientos sin crear ventas. |
| `test/ventas.test.ts` *(nuevo)* | Los tests de integración del motor contra el Postgres efímero. |

`totales.ts` va separado de `crear.ts` a propósito: la aritmética de plata es la única lógica de este ciclo que se puede probar sin base de datos, y mezclarla con la persistencia obligaría a levantar Docker para probar un redondeo.

---

### Task 1: `enTransaccionDeTenant`

**Files:**
- Create: `lib/tenant/transaccion.ts`
- Test: `lib/tenant/transaccion.test.ts`

**Interfaces:**
- Produces:
  - `type ClienteTx = Prisma.TransactionClient`
  - `enTransaccionDeTenant<T>(tenantId: string, fn: (tx: ClienteTx) => Promise<T>): Promise<T>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `lib/tenant/transaccion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'
import { enTransaccionDeTenant } from './transaccion'
import { prisma } from '@/lib/db'

let owner: Client
let tenantA: string
let tenantB: string

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, `tx-a-${Date.now()}`)
  tenantB = await crearTenant(owner, `tx-b-${Date.now()}`)
  // Un cliente por tenant, para tener algo que contar.
  await owner.query(
    `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'de A', now(), now()),
            (gen_random_uuid(), $2, 'de B', now(), now())`,
    [tenantA, tenantB],
  )
})

afterAll(async () => {
  await owner.end()
})

describe('enTransaccionDeTenant', () => {
  it('adentro sólo se ven las filas del tenant', async () => {
    const nombres = await enTransaccionDeTenant(tenantA, async (tx) =>
      (await tx.cliente.findMany()).map((c) => c.nombre),
    )
    expect(nombres).toEqual(['de A'])
  })

  it('devuelve lo que devuelve el callback', async () => {
    const r = await enTransaccionDeTenant(tenantA, async () => 42)
    expect(r).toBe(42)
  })

  // Sin esto, media transacción escrita se queda: es la razón de existir del
  // helper.
  it('revierte todo si el callback lanza', async () => {
    const antes = await enTransaccionDeTenant(tenantA, async (tx) =>
      tx.cliente.count(),
    )

    await expect(
      enTransaccionDeTenant(tenantA, async (tx) => {
        await tx.cliente.create({
          data: { tenantId: tenantA, nombre: 'no debería quedar' },
        })
        throw new Error('falla a propósito')
      }),
    ).rejects.toThrow('falla a propósito')

    const despues = await enTransaccionDeTenant(tenantA, async (tx) =>
      tx.cliente.count(),
    )
    expect(despues).toBe(antes)
  })

  // El WITH CHECK de la policy es lo que atrapa un tenant_id ajeno. Sin esta
  // prueba, un bug de la app podría escribir en el tenant de otro.
  it('no deja escribir una fila de otro tenant', async () => {
    await expect(
      enTransaccionDeTenant(tenantA, async (tx) => {
        await tx.cliente.create({
          data: { tenantId: tenantB, nombre: 'invasor' },
        })
      }),
    ).rejects.toThrow()
  })

  // EL TEST DE SEGURIDAD. El set_config va con el tercer argumento en true, o
  // sea local a la transacción. Si alguien lo sacara, la GUC sobreviviría en la
  // conexión, volvería al pool con el tenant anterior puesto, y el request
  // siguiente leería datos de otro negocio. Sin esta prueba, ese cambio pasa
  // desapercibido: todos los demás tests seguirían en verde.
  it('la GUC no sobrevive a la transacción', async () => {
    await enTransaccionDeTenant(tenantA, async (tx) => {
      await tx.cliente.count()
    })

    const [{ guc }] = await prisma.$queryRaw<{ guc: string }[]>`
      SELECT current_setting('arandano.tenant_id', true) AS guc
    `
    expect(guc ?? '').toBe('')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/tenant/transaccion.test.ts`
Expected: FAIL — `Failed to resolve import "./transaccion"`.

- [ ] **Step 3: Escribir el helper**

Crear `lib/tenant/transaccion.ts`:

```ts
import { prisma } from '@/lib/db'
import type { Prisma } from '@/generated/prisma/client'

/**
 * El cliente que ve el callback. Es transaccional y **no lleva la extensión**
 * de `prismaParaTenant`, así que cada `create` tiene que pasar `tenantId`
 * explícito. Lo atrapa el compilador —el campo es obligatorio— y detrás está el
 * WITH CHECK de la policy.
 */
export type ClienteTx = Prisma.TransactionClient

// Generoso para el trabajo del motor (una venta son ~10 sentencias) y finito
// igual: una transacción colgada retiene una de las 5 conexiones del pool, así
// que "sin límite" sería una forma de quedarse sin base para todos los tenants.
const TIMEOUT_MS = 10_000

// Cuánto espera por una conexión libre antes de rendirse. Por debajo del
// timeout de arriba a propósito: si el pool está saturado conviene fallar
// rápido y devolver el error, no hacer cola detrás de una transacción larga.
const MAX_WAIT_MS = 5_000

/**
 * Corre `fn` dentro de una transacción atada a `tenantId`.
 *
 * Existe porque `prismaParaTenant(...).$transaction(fn)` está bloqueado a
 * propósito: las operaciones del cliente extendido pasan por `$allOperations`,
 * que las agrupa en SU PROPIO `$transaction([...])` sobre el cliente base —otra
 * conexión— y la atomicidad se pierde en silencio. Acá la transacción se abre
 * sobre el cliente base y el `set_config` corre UNA vez adentro, así que todo
 * lo del callback comparte conexión, transacción y tenant.
 *
 * El tercer argumento `true` del `set_config` lo hace **local a la
 * transacción**: muere con ella. Es lo que impide que una conexión devuelta al
 * pool arrastre el tenant anterior hasta el request siguiente.
 *
 * No llamar a la red desde adentro: mientras dure, esta transacción retiene una
 * de las 5 conexiones del pool.
 */
export async function enTransaccionDeTenant<T>(
  tenantId: string,
  fn: (tx: ClienteTx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('arandano.tenant_id', ${tenantId}, true)`
      return fn(tx)
    },
    { timeout: TIMEOUT_MS, maxWait: MAX_WAIT_MS },
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/tenant/transaccion.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Actualizar el mensaje de `prismaParaTenant`, que ahora miente**

`lib/tenant/prisma.ts` dice "todavía no existe, es tarea aparte". Ya existe. En `MENSAJE_TRANSACCION_INTERACTIVA`, reemplazar esa frase final por:

```
'Para trabajo atómico multi-paso (p. ej. crearVenta: venta + movimiento de ' +
'stock) usar enTransaccionDeTenant() de lib/tenant/transaccion.ts, que abre la ' +
'transacción interactiva sobre el cliente BASE y corre el set_config una sola ' +
'vez adentro.'
```

Un mensaje de error que manda a escribir algo que ya está escrito es peor que no tener mensaje: hace perder el tiempo justo a quien ya está trabado.

- [ ] **Step 6: Commit**

```bash
git add lib/tenant/transaccion.ts lib/tenant/transaccion.test.ts lib/tenant/prisma.ts
git commit -m "feat(tenant): transacciones interactivas atadas al tenant"
```

---

### Task 2: El schema del ciclo de ventas

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_ventas_y_stock/migration.sql` (lo genera Prisma; se le agrega el bloque de RLS a mano)
- Modify: `docs/schema.md` (regenerado, no editado a mano)

**Interfaces:**
- Produces: los modelos `MovimientoStock`, `Venta`, `VentaItem`, `Pago`; los enums `MotivoMovimiento`, `MedioPago`, `Moneda`; `Articulo.stock`; `Tenant.proximoNumeroVenta`.

- [ ] **Step 1: Agregar los enums**

Al final del bloque de enums de `prisma/schema.prisma`:

```prisma
// El "por qué" de cada movimiento. Es el punto de extensión que CLAUDE.md le
// promete a los módulos: órdenes de trabajo descontando repuestos, gastronomía
// descontando insumos por receta. Sumar un motivo es una migración aditiva.
enum MotivoMovimiento {
  VENTA
  ANULACION_VENTA
  AJUSTE
  INGRESO

  @@map("motivo_movimiento")
}

enum MedioPago {
  EFECTIVO
  TRANSFERENCIA
  TARJETA_DEBITO
  TARJETA_CREDITO

  @@map("medio_pago")
}

enum Moneda {
  ARS
  USD

  @@map("moneda")
}
```

- [ ] **Step 2: Sumar el stock a `Articulo` y el contador a `Tenant`**

En `model Articulo`, después de `precio`:

```prisma
  // Decimal(12,3) y no entero, aunque un local de celulares venda unidades:
  // CLAUDE.md ya tiene previsto gastronomía descontando insumos por receta, y
  // medio kilo de harina no es un entero. Cambiar el tipo después toca todas
  // las filas de todos los tenants; ponerlo bien ahora no cuesta nada.
  //
  // Es un CACHÉ de la suma de sus movimientos, no la fuente de verdad. Se
  // actualiza con UPDATE relativo en la misma transacción que el movimiento, y
  // `test/ventas.test.ts` prueba que la suma cierra.
  stock Decimal @default(0) @db.Decimal(12, 3)
```

y en sus relaciones:

```prisma
  movimientos MovimientoStock[]
  ventaItems  VentaItem[]
```

En `model Tenant`, después de `estado`:

```prisma
  // El correlativo de ventas es POR TENANT, así que no puede ser una secuencia
  // de Postgres —esas son globales—. Se incrementa dentro de la misma
  // transacción que crea la venta: eso serializa las ventas simultáneas de un
  // mismo local (irrelevante: no hay dos cajas cobrando en el mismo
  // milisegundo) y a cambio no hay huecos ni números repetidos, que es lo que
  // hace que "la venta 123" sirva para hablar por teléfono.
  proximoNumeroVenta Int @default(1) @map("proximo_numero_venta")
```

y en sus relaciones:

```prisma
  ventas      Venta[]
  ventaItems  VentaItem[]
  pagos       Pago[]
  movimientos MovimientoStock[]
```

- [ ] **Step 3: Agregar los cuatro modelos**

Al final de `prisma/schema.prisma`:

```prisma
// Append-only: nada se edita ni se borra. Es lo que permite responder "por qué
// tengo 3 y no 5", que es la pregunta que un dueño hace cuando el inventario no
// le cierra.
model MovimientoStock {
  id         String           @id @default(uuid(7)) @db.Uuid
  tenantId   String           @map("tenant_id") @db.Uuid
  articuloId String           @map("articulo_id") @db.Uuid
  // Con signo: negativo descuenta, positivo ingresa.
  delta     Decimal          @db.Decimal(12, 3)
  motivo    MotivoMovimiento
  // Null en AJUSTE e INGRESO, que no vienen de una venta.
  ventaId   String?          @map("venta_id") @db.Uuid
  usuarioId String           @map("usuario_id") @db.Uuid
  nota      String?
  creadoEn  DateTime         @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Restrict y no Cascade: borrar un artículo no puede borrar la historia de lo
  // que se vendió. Si tiene movimientos, no se borra.
  articulo Articulo @relation(fields: [articuloId], references: [id], onDelete: Restrict)
  venta    Venta?   @relation(fields: [ventaId], references: [id], onDelete: Restrict)
  usuario  User     @relation(fields: [usuarioId], references: [id], onDelete: Restrict)

  @@index([tenantId, articuloId])
  @@index([tenantId, ventaId])
  @@map("movimientos_stock")
}

model Venta {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  numero   Int
  // Opcional: la venta de mostrador, sin cliente identificado, es la mayoría de
  // las ventas de un local.
  clienteId    String?   @map("cliente_id") @db.Uuid
  usuarioId    String    @map("usuario_id") @db.Uuid
  // En pesos. Lo calcula el motor sumando los ítems; no llega de afuera.
  total        Decimal   @db.Decimal(12, 2)
  // La venta anulada NO se borra: sus ítems y su total quedan intactos porque
  // el historial tiene que poder responder qué se cobró, y cuando llegue ARCA
  // ésta va a ser el comprobante que necesita su nota de crédito.
  anuladaEn    DateTime? @map("anulada_en") @db.Timestamptz(3)
  anuladaPorId String?   @map("anulada_por_id") @db.Uuid
  creadoEn     DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  cliente    Cliente? @relation(fields: [clienteId], references: [id], onDelete: Restrict)
  usuario    User     @relation("VentasHechas", fields: [usuarioId], references: [id], onDelete: Restrict)
  anuladaPor User?    @relation("VentasAnuladas", fields: [anuladaPorId], references: [id], onDelete: Restrict)

  items       VentaItem[]
  pagos       Pago[]
  movimientos MovimientoStock[]

  @@unique([tenantId, numero])
  @@index([tenantId, creadoEn])
  @@map("ventas")
}

// Precio y descripción CONGELADOS al momento de la venta. No son una referencia
// viva al artículo: los precios cambian todas las semanas y los artículos se
// renombran, y una venta de marzo tiene que seguir diciendo lo que se cobró en
// marzo. `articuloId` se guarda igual, para poder navegar, pero no es de donde
// sale lo que se muestra.
model VentaItem {
  id             String  @id @default(uuid(7)) @db.Uuid
  tenantId       String  @map("tenant_id") @db.Uuid
  ventaId        String  @map("venta_id") @db.Uuid
  articuloId     String  @map("articulo_id") @db.Uuid
  descripcion    String
  cantidad       Decimal @db.Decimal(12, 3)
  precioUnitario Decimal @map("precio_unitario") @db.Decimal(12, 2)

  tenant   Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  venta    Venta    @relation(fields: [ventaId], references: [id], onDelete: Cascade)
  articulo Articulo @relation(fields: [articuloId], references: [id], onDelete: Restrict)

  @@index([tenantId, ventaId])
  @@map("venta_items")
}

// Varios por venta: el pago partido —una parte en efectivo, otra por
// transferencia— es la norma, no la excepción.
model Pago {
  id       String    @id @default(uuid(7)) @db.Uuid
  tenantId String    @map("tenant_id") @db.Uuid
  ventaId  String    @map("venta_id") @db.Uuid
  medio    MedioPago
  moneda   Moneda
  // En la moneda del pago, no en pesos.
  monto      Decimal  @db.Decimal(12, 2)
  // Los ARS que valía una unidad de esa moneda EN ESE MOMENTO. Un pago en pesos
  // lleva 1. Guardarla es lo que después deja cerrar la caja en las dos monedas
  // sin tener que reconstruir a qué valor se tomó cada dólar.
  cotizacion Decimal  @db.Decimal(12, 4)
  creadoEn   DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  venta  Venta  @relation(fields: [ventaId], references: [id], onDelete: Cascade)

  @@index([tenantId, ventaId])
  @@map("pagos")
}
```

`User` necesita las dos relaciones nombradas del otro lado, más la de movimientos:

```prisma
  ventasHechas   Venta[]           @relation("VentasHechas")
  ventasAnuladas Venta[]           @relation("VentasAnuladas")
  movimientos    MovimientoStock[]
```

y `Cliente`:

```prisma
  ventas Venta[]
```

- [ ] **Step 4: Generar la migración**

```bash
npx prisma migrate dev --name ventas_y_stock
```

Expected: crea `prisma/migrations/<timestamp>_ventas_y_stock/migration.sql` y aplica contra la base de dev.

- [ ] **Step 5: Agregar el bloque de RLS a la migración, a mano**

Prisma **no genera policies**. Al final del `migration.sql` recién creado:

```sql
-- ---------------------------------------------------------------------------
-- Row Level Security. Misma expresión que la migración inicial, copiada literal
-- y no reinventada: dos formas distintas de escribir el mismo aislamiento son
-- dos cosas que se pueden desincronizar.
--
-- Sin la GUC seteada, current_setting(..., true) devuelve NULL, el nullif evita
-- que una cadena vacía haga explotar el cast, y NULL = uuid da NULL — que no es
-- true. O sea: SIN GUC NO PASA NINGUNA FILA. Falla cerrado.
-- ---------------------------------------------------------------------------

ALTER TABLE "movimientos_stock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "movimientos_stock" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "ventas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "ventas" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "venta_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "venta_items" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "pagos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "pagos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Después de editarla, aplicarla:

```bash
npx prisma migrate reset --force --skip-seed
```

> `reset` y no `dev`: la migración ya está registrada como aplicada, así que Prisma no la volvería a correr y el bloque de RLS quedaría sin ejecutar. Es **sólo en dev** — CLAUDE.md prohíbe `reset` contra producción, y `deploy.sh` lo bloquea.

- [ ] **Step 6: Regenerar el ERD**

```bash
scripts/generar-erd.sh
```

Expected: `docs/schema.md` cambia. **No editarlo a mano**: se genera desde el DDL, y el hook de pre-commit lo verifica.

- [ ] **Step 7: Correr los tests de RLS, que cubren las tablas nuevas solos**

Run: `npx vitest run test/rls-cobertura.test.ts test/rls.test.ts test/schema.test.ts`
Expected: PASS. `rls-cobertura` recorre `pg_class` y exige policy en toda tabla con `tenant_id`, así que las cuatro nuevas entran sin tocar el test. Si falla, falta una policy.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md
git commit -m "feat(schema): stock, movimientos, ventas, items y pagos con RLS"
```

---

### Task 3: La aritmética de plata

**Files:**
- Create: `lib/ventas/totales.ts`
- Test: `lib/ventas/totales.test.ts`

**Interfaces:**
- Produces:
  - `redondearDinero(v: Decimal): Decimal`
  - `subtotalItem(cantidad: Decimal, precioUnitario: Decimal): Decimal`
  - `totalDeItems(items: { cantidad: Decimal; precioUnitario: Decimal }[]): Decimal`
  - `montoEnPesos(monto: Decimal, cotizacion: Decimal): Decimal`
  - `totalDePagos(pagos: { monto: Decimal; cotizacion: Decimal }[]): Decimal`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `lib/ventas/totales.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  redondearDinero,
  subtotalItem,
  totalDeItems,
  montoEnPesos,
  totalDePagos,
} from './totales'

const d = (v: string) => new Prisma.Decimal(v)

describe('redondearDinero', () => {
  it('deja dos decimales', () => {
    expect(redondearDinero(d('10.005')).toString()).toBe('10.01')
    expect(redondearDinero(d('10.004')).toString()).toBe('10')
  })

  it('redondea el medio hacia arriba', () => {
    expect(redondearDinero(d('0.125')).toString()).toBe('0.13')
    expect(redondearDinero(d('0.135')).toString()).toBe('0.14')
  })
})

describe('subtotalItem', () => {
  it('multiplica y redondea', () => {
    expect(subtotalItem(d('3'), d('1500.50')).toString()).toBe('4501.5')
  })

  it('soporta cantidades fraccionarias', () => {
    // Medio kilo a 2999,99: el caso de gastronomía que motivó el Decimal(12,3).
    expect(subtotalItem(d('0.5'), d('2999.99')).toString()).toBe('1500')
  })
})

describe('totalDeItems', () => {
  it('suma los subtotales ya redondeados', () => {
    const total = totalDeItems([
      { cantidad: d('3'), precioUnitario: d('0.005') },
      { cantidad: d('3'), precioUnitario: d('0.005') },
    ])
    // Redondear primero: 0,02 + 0,02 = 0,04.
    // Sumar primero daría 0,03, y esa diferencia de un centavo es una venta
    // rechazada por no cerrar contra los pagos.
    expect(total.toString()).toBe('0.04')
  })

  it('una lista vacía da cero', () => {
    expect(totalDeItems([]).toString()).toBe('0')
  })
})

describe('montoEnPesos', () => {
  it('un pago en pesos lleva cotización 1', () => {
    expect(montoEnPesos(d('1500.50'), d('1')).toString()).toBe('1500.5')
  })

  it('convierte con la cotización guardada', () => {
    expect(montoEnPesos(d('100'), d('1350.7500')).toString()).toBe('135075')
  })
})

describe('totalDePagos', () => {
  it('suma pago partido en dos monedas', () => {
    const total = totalDePagos([
      { monto: d('50000'), cotizacion: d('1') },
      { monto: d('100'), cotizacion: d('1350.7500') },
    ])
    expect(total.toString()).toBe('185075')
  })

  it('una lista vacía da cero', () => {
    expect(totalDePagos([]).toString()).toBe('0')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/ventas/totales.test.ts`
Expected: FAIL — `Failed to resolve import "./totales"`.

- [ ] **Step 3: Escribir el módulo**

Crear `lib/ventas/totales.ts`:

```ts
import { Prisma } from '@/generated/prisma/client'

type Decimal = Prisma.Decimal

/** Los decimales en los que se guarda la plata: `Decimal(12, 2)`. */
const ESCALA_DINERO = 2

/**
 * Todo producto se redondea ACÁ, antes de entrar en cualquier suma.
 *
 * Sumar primero y redondear al final da un resultado distinto en los bordes, y
 * "distinto en los bordes" acá significa una venta rechazada por un centavo:
 * el total de los ítems y el total de los pagos se comparan por igualdad, así
 * que los dos tienen que redondear en el mismo momento y de la misma forma.
 *
 * ROUND_HALF_UP y no el default de la librería: es la regla que la gente espera
 * cuando ve el vuelto, y la que usa el resto del comercio.
 */
export function redondearDinero(v: Decimal): Decimal {
  return v.toDecimalPlaces(ESCALA_DINERO, Prisma.Decimal.ROUND_HALF_UP)
}

export function subtotalItem(cantidad: Decimal, precioUnitario: Decimal): Decimal {
  return redondearDinero(cantidad.mul(precioUnitario))
}

export function totalDeItems(
  items: { cantidad: Decimal; precioUnitario: Decimal }[],
): Decimal {
  return items.reduce(
    (acc, i) => acc.add(subtotalItem(i.cantidad, i.precioUnitario)),
    new Prisma.Decimal(0),
  )
}

/** Un pago en pesos lleva cotización 1; uno en dólares, los ARS que valía el
 *  dólar en ese momento. */
export function montoEnPesos(monto: Decimal, cotizacion: Decimal): Decimal {
  return redondearDinero(monto.mul(cotizacion))
}

export function totalDePagos(
  pagos: { monto: Decimal; cotizacion: Decimal }[],
): Decimal {
  return pagos.reduce(
    (acc, p) => acc.add(montoEnPesos(p.monto, p.cotizacion)),
    new Prisma.Decimal(0),
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/ventas/totales.test.ts`
Expected: PASS, 10 tests. Sin Docker: este archivo no toca la base.

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/totales.ts lib/ventas/totales.test.ts
git commit -m "feat(ventas): aritmética de plata con redondeo explícito antes de sumar"
```

---

### Task 4: `crearVenta`

**Files:**
- Create: `lib/ventas/errores.ts`
- Create: `lib/ventas/crear.ts`
- Test: `test/ventas.test.ts`

**Interfaces:**
- Consumes: `enTransaccionDeTenant` (Task 1), los modelos (Task 2), `totalDeItems` / `totalDePagos` / `subtotalItem` (Task 3).
- Produces:
  - `class ErrorDeVenta extends Error { codigo: CodigoErrorDeVenta }`
  - `type CodigoErrorDeVenta = 'SIN_ITEMS' | 'CANTIDAD_INVALIDA' | 'ARTICULO_INEXISTENTE' | 'PAGOS_NO_CIERRAN' | 'VENTA_INEXISTENTE'`
  - `crearVenta(entrada: EntradaCrearVenta): Promise<{ id: string; numero: number }>`

- [ ] **Step 1: Escribir los errores**

Crear `lib/ventas/errores.ts`:

```ts
export type CodigoErrorDeVenta =
  | 'SIN_ITEMS'
  | 'CANTIDAD_INVALIDA'
  | 'ARTICULO_INEXISTENTE'
  | 'PAGOS_NO_CIERRAN'
  | 'VENTA_INEXISTENTE'

/**
 * Con código y no sólo con mensaje: la UI que venga después tiene que poder
 * distinguir "faltó un artículo" de "los pagos no cierran" para decir algo útil,
 * y parsear el texto de un Error es la forma de que eso se rompa en silencio la
 * primera vez que alguien mejore la redacción.
 */
export class ErrorDeVenta extends Error {
  constructor(
    readonly codigo: CodigoErrorDeVenta,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeVenta'
  }
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `test/ventas.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner } from './postgres-efimero'
import { crearTenant } from './datos'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { crearVenta } from '@/lib/ventas/crear'
import { ErrorDeVenta } from '@/lib/ventas/errores'

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
let remera: string
let servicio: string
// Sólo se toca a través del motor: es lo que hace significativo el test de
// reconciliación. Ver su comentario más abajo.
let recon: string

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `ventas-${Date.now()}`)

  const u = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor', 'v@x.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId],
  )
  usuarioId = u.rows[0].id

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'REM-1', 'Remera', 'PRODUCTO', 1000.00, 1000, now(), now()),
            (gen_random_uuid(), $1, 'SRV-1', 'Arreglo', 'SERVICIO', 500.00, 0, now(), now()),
            (gen_random_uuid(), $1, 'REC-1', 'Reconciliable', 'PRODUCTO', 100.00, 0, now(), now())
     RETURNING id, sku`,
    [tenantId],
  )
  const porSku = (sku: string) =>
    a.rows.find((r: { sku: string }) => r.sku === sku).id
  remera = porSku('REM-1')
  servicio = porSku('SRV-1')
  recon = porSku('REC-1')
})

afterAll(async () => {
  await owner.end()
})

/** El stock actual de un artículo, leído desde la transacción del tenant. */
async function stockDe(articuloId: string): Promise<string> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const a = await tx.articulo.findUniqueOrThrow({ where: { id: articuloId } })
    return a.stock.toString()
  })
}

describe('crearVenta', () => {
  it('crea la venta, descuenta el stock y deja el movimiento', async () => {
    const antes = await stockDe(remera)

    const { id, numero } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('2') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('2000'), cotizacion: d('1') }],
    })

    expect(numero).toBeGreaterThan(0)

    const { venta, movs } = await enTransaccionDeTenant(tenantId, async (tx) => ({
      venta: await tx.venta.findUniqueOrThrow({
        where: { id },
        include: { items: true, pagos: true },
      }),
      movs: await tx.movimientoStock.findMany({ where: { ventaId: id } }),
    }))

    expect(venta.total.toString()).toBe('2000')
    expect(venta.items).toHaveLength(1)
    expect(venta.pagos).toHaveLength(1)
    expect(movs).toHaveLength(1)
    expect(movs[0].delta.toString()).toBe('-2')
    expect(movs[0].motivo).toBe('VENTA')

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      new Prisma.Decimal(antes).minus(2).toString(),
    )
  })

  it('congela el precio: cambiarlo después no cambia lo cobrado', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
    })

    await owner.query(`UPDATE articulos SET precio = 9999 WHERE id = $1`, [remera])

    const item = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.ventaItem.findFirstOrThrow({ where: { ventaId: id } }),
    )
    expect(item.precioUnitario.toString()).toBe('1000')
    expect(item.descripcion).toBe('Remera')

    await owner.query(`UPDATE articulos SET precio = 1000 WHERE id = $1`, [remera])
  })

  it('un servicio no mueve stock', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') }],
    })

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id } }),
    )
    expect(movs).toHaveLength(0)
  })

  it('acepta pago partido en dos monedas', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') },
        { medio: 'EFECTIVO', moneda: 'USD', monto: d('0.5'), cotizacion: d('1000') },
      ],
    })

    const pagos = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.pago.findMany({ where: { ventaId: id } }),
    )
    expect(pagos).toHaveLength(2)
  })

  it('rechaza si los pagos no cierran, y no deja nada a medias', async () => {
    const stockAntes = await stockDe(remera)
    const numeroAntes = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )

    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('999'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })

    // Atomicidad: ni stock, ni contador.
    expect(await stockDe(remera)).toBe(stockAntes)
    const numeroDespues = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).proximoNumeroVenta,
    )
    expect(numeroDespues).toBe(numeroAntes)
  })

  it('rechaza un artículo que no existe', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: '00000000-0000-7000-8000-000000000000', cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1'), cotizacion: d('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })

  it('rechaza una venta sin ítems', async () => {
    await expect(
      crearVenta({ tenantId, usuarioId, items: [], pagos: [] }),
    ).rejects.toMatchObject({ codigo: 'SIN_ITEMS' })
  })

  it('rechaza cantidad cero o negativa', async () => {
    await expect(
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('0') }],
        pagos: [],
      }),
    ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
  })

  // Decisión de negocio explícita del spec: el cliente está parado en el
  // mostrador y la plata es real.
  it('permite dejar el stock negativo', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1000') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000000'), cotizacion: d('1') }],
    })
    expect(id).toBeTruthy()
    expect(new Prisma.Decimal(await stockDe(remera)).isNegative()).toBe(true)

    })

  // La prueba del UPDATE relativo. Con `SET stock = $leido - $cantidad` una de
  // las dos se pierde y este test lo detecta.
  it('dos ventas simultáneas del mismo artículo no se pisan', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))
    const venta = () =>
      crearVenta({
        tenantId,
        usuarioId,
        items: [{ articuloId: remera, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
      })

    await Promise.all([venta(), venta(), venta(), venta()])

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      antes.minus(4).toString(),
    )
  })

  // La reconciliación que justifica tener el campo denormalizado. Es un test y
  // no una intención.
  //
  // Corre sobre `recon`, un artículo que SÓLO se toca a través del motor.
  // Usar `remera` no serviría: otros tests le escriben el stock con UPDATE
  // directo para armar su escenario, y eso rompe la invariante a propósito —
  // el test daría rojo por el andamiaje del test, no por un bug del motor.
  it('el stock cierra contra la suma de sus movimientos', async () => {
    await ajustarStock({
      tenantId,
      articuloId: recon,
      delta: d('40'),
      motivo: 'INGRESO',
      usuarioId,
    })
    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: recon, cantidad: d('7.5') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('750'), cotizacion: d('1') }],
    })

    const { stock, suma } = await enTransaccionDeTenant(tenantId, async (tx) => {
      const a = await tx.articulo.findUniqueOrThrow({ where: { id: recon } })
      const agg = await tx.movimientoStock.aggregate({
        where: { articuloId: recon },
        _sum: { delta: true },
      })
      return { stock: a.stock, suma: agg._sum.delta ?? new Prisma.Decimal(0) }
    })
    expect(stock.toString()).toBe(suma.toString())
    expect(stock.toString()).toBe('32.5')
  })

  it('los números de venta son correlativos y sin huecos', async () => {
    const numeros = await enTransaccionDeTenant(tenantId, async (tx) =>
      (await tx.venta.findMany({ orderBy: { numero: 'asc' } })).map((v) => v.numero),
    )
    expect(numeros).toEqual(numeros.map((_, i) => i + 1))
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

Run: `npx vitest run test/ventas.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ventas/crear"`.

- [ ] **Step 4: Escribir `crearVenta`**

Crear `lib/ventas/crear.ts`:

```ts
import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { totalDeItems, totalDePagos } from './totales'
import { ErrorDeVenta } from './errores'

export type ItemDeVenta = { articuloId: string; cantidad: Prisma.Decimal }
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  monto: Prisma.Decimal
  cotizacion: Prisma.Decimal
}

export type EntradaCrearVenta = {
  tenantId: string
  // Por PARÁMETRO y no de una sesión: Auth.js todavía no existe, y esperar a
  // que exista frenaría este ciclo por algo que no cambia el diseño. Cuando
  // llegue el login, lo único que cambia es quién llama. Deuda explícita: hasta
  // entonces nada impide que un llamador pase el usuario de otro, y por eso la
  // UI no se construye antes que Auth.js.
  usuarioId: string
  clienteId?: string
  items: ItemDeVenta[]
  pagos: PagoDeVenta[]
}

export async function crearVenta(
  entrada: EntradaCrearVenta,
): Promise<{ id: string; numero: number }> {
  const { tenantId, usuarioId, clienteId, items, pagos } = entrada

  if (items.length === 0) {
    throw new ErrorDeVenta('SIN_ITEMS', 'una venta necesita al menos un ítem')
  }
  for (const i of items) {
    if (i.cantidad.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'CANTIDAD_INVALIDA',
        `la cantidad de ${i.articuloId} tiene que ser mayor que cero`,
      )
    }
  }

  return enTransaccionDeTenant(tenantId, async (tx) => {
    const articulos = await tx.articulo.findMany({
      where: { id: { in: items.map((i) => i.articuloId) } },
    })
    const porId = new Map(articulos.map((a) => [a.id, a]))

    // Congelar precio y descripción ACÁ. El artículo puede renombrarse o cambiar
    // de precio mañana; esta venta tiene que seguir diciendo lo de hoy.
    const lineas = items.map((i) => {
      const a = porId.get(i.articuloId)
      if (!a) {
        throw new ErrorDeVenta(
          'ARTICULO_INEXISTENTE',
          `el artículo ${i.articuloId} no existe en este tenant`,
        )
      }
      return {
        articuloId: a.id,
        descripcion: a.nombre,
        cantidad: i.cantidad,
        precioUnitario: a.precio,
        esProducto: a.tipo === 'PRODUCTO',
      }
    })

    const total = totalDeItems(lineas)
    if (!totalDePagos(pagos).equals(total)) {
      throw new ErrorDeVenta(
        'PAGOS_NO_CIERRAN',
        `los pagos suman ${totalDePagos(pagos)} y el total es ${total}`,
      )
    }

    const numero = await proximoNumero(tx, tenantId)

    const venta = await tx.venta.create({
      data: {
        tenantId,
        numero,
        clienteId,
        usuarioId,
        total,
        items: {
          create: lineas.map((l) => ({
            tenantId,
            articuloId: l.articuloId,
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            precioUnitario: l.precioUnitario,
          })),
        },
        pagos: { create: pagos.map((p) => ({ tenantId, ...p })) },
      },
    })

    for (const l of lineas.filter((l) => l.esProducto)) {
      await tx.movimientoStock.create({
        data: {
          tenantId,
          articuloId: l.articuloId,
          delta: l.cantidad.negated(),
          motivo: 'VENTA',
          ventaId: venta.id,
          usuarioId,
        },
      })
      // RELATIVO y no absoluto: `increment` genera `SET stock = stock + $1`, así
      // que dos ventas simultáneas del mismo artículo no se pisan. Un
      // `SET stock = $leido - $cantidad` perdería una de las dos, y el test de
      // concurrencia existe para atrapar exactamente ese cambio.
      //
      // Sin validar que alcance: el stock puede quedar negativo y eso no frena
      // la venta. Es decisión de negocio, no un olvido.
      await tx.articulo.update({
        where: { id: l.articuloId },
        data: { stock: { increment: l.cantidad.negated() } },
      })
    }

    return { id: venta.id, numero }
  })
}

/**
 * El correlativo por tenant, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()`: contar ventas daría el mismo
 * número a dos transacciones concurrentes. Esto las serializa —toma el lock de
 * la fila del tenant— y a cambio no hay huecos ni repetidos.
 */
async function proximoNumero(tx: ClienteTx, tenantId: string): Promise<number> {
  const filas = await tx.$queryRaw<{ proximo_numero_venta: number }[]>`
    UPDATE tenants
       SET proximo_numero_venta = proximo_numero_venta + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_numero_venta - 1 AS proximo_numero_venta
  `
  return filas[0].proximo_numero_venta
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS, 12 tests.

Si falla el de concurrencia con un error de timeout o de pool, el problema es que cuatro transacciones interactivas simultáneas más la lectura del assert saturan las 5 conexiones. Bajar la concurrencia del test a 3 **no** es la solución: eso oculta el límite real. Decilo en el reporte.

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/errores.ts lib/ventas/crear.ts test/ventas.test.ts
git commit -m "feat(ventas): crearVenta con precios congelados y descuento atómico de stock"
```

---

### Task 5: `anularVenta` y `ajustarStock`

**Files:**
- Create: `lib/ventas/anular.ts`
- Modify: `test/ventas.test.ts` (agregar dos `describe`)

**Interfaces:**
- Consumes: `enTransaccionDeTenant`, `ErrorDeVenta`, los modelos.
- Produces:
  - `anularVenta(e: { tenantId: string; ventaId: string; usuarioId: string }): Promise<void>`
  - `ajustarStock(e: { tenantId: string; articuloId: string; delta: Prisma.Decimal; motivo: 'AJUSTE' | 'INGRESO'; usuarioId: string; nota?: string }): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/ventas.test.ts`:

Primero, sumar el import **arriba del archivo**, junto a los que ya están —
JavaScript no admite un `import` a mitad del módulo:

```ts
import { anularVenta, ajustarStock } from '@/lib/ventas/anular'
```

Y después, al final del archivo:

```ts
describe('anularVenta', () => {
  it('devuelve el stock y deja la venta legible', async () => {
    await owner.query(`UPDATE articulos SET stock = 50 WHERE id = $1`, [remera])
    const antes = new Prisma.Decimal(await stockDe(remera))

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('3') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('3000'), cotizacion: d('1') }],
    })
    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      antes.minus(3).toString(),
    )

    await anularVenta({ tenantId, ventaId: id, usuarioId })

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(antes.toString())

    const venta = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id }, include: { items: true, pagos: true } }),
    )
    // La venta NO se borra: sus ítems y su total quedan intactos, porque el día
    // que exista ARCA ésta va a ser el comprobante que necesita su nota de
    // crédito.
    expect(venta.anuladaEn).not.toBeNull()
    expect(venta.anuladaPorId).toBe(usuarioId)
    expect(venta.total.toString()).toBe('3000')
    expect(venta.items).toHaveLength(1)
    expect(venta.pagos).toHaveLength(1)

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id }, orderBy: { creadoEn: 'asc' } }),
    )
    expect(movs.map((m) => m.motivo)).toEqual(['VENTA', 'ANULACION_VENTA'])
    expect(movs[1].delta.toString()).toBe('3')
  })

  // El reintento de un click es más probable que la mala intención.
  it('anular dos veces no duplica la devolución', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: id, usuarioId })
    const stockTrasPrimera = await stockDe(remera)

    await anularVenta({ tenantId, ventaId: id, usuarioId })

    expect(await stockDe(remera)).toBe(stockTrasPrimera)
    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id, motivo: 'ANULACION_VENTA' } }),
    )
    expect(movs).toHaveLength(1)
  })

  it('una venta de servicios se anula sin mover stock', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', monto: d('500'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: id, usuarioId })

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { ventaId: id } }),
    )
    expect(movs).toHaveLength(0)
  })

  it('rechaza una venta que no existe', async () => {
    await expect(
      anularVenta({
        tenantId,
        ventaId: '00000000-0000-7000-8000-000000000000',
        usuarioId,
      }),
    ).rejects.toMatchObject({ codigo: 'VENTA_INEXISTENTE' })
  })
})

describe('ajustarStock', () => {
  it('un ingreso suma y queda registrado con su nota', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))

    await ajustarStock({
      tenantId,
      articuloId: remera,
      delta: d('25'),
      motivo: 'INGRESO',
      usuarioId,
      nota: 'compra al proveedor',
    })

    expect(new Prisma.Decimal(await stockDe(remera)).toString()).toBe(
      antes.plus(25).toString(),
    )
    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirstOrThrow({
        where: { articuloId: remera, motivo: 'INGRESO' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov.nota).toBe('compra al proveedor')
    expect(mov.ventaId).toBeNull()
  })

  it('un ajuste negativo devuelve a cero un stock negativo', async () => {
    await owner.query(`UPDATE articulos SET stock = -5 WHERE id = $1`, [remera])

    await ajustarStock({
      tenantId,
      articuloId: remera,
      delta: d('5'),
      motivo: 'AJUSTE',
      usuarioId,
      nota: 'corrección de inventario',
    })

    expect(await stockDe(remera)).toBe('0')
  })

  it('rechaza un artículo que no existe', async () => {
    await expect(
      ajustarStock({
        tenantId,
        articuloId: '00000000-0000-7000-8000-000000000000',
        delta: d('1'),
        motivo: 'AJUSTE',
        usuarioId,
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run test/ventas.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/ventas/anular"`.

- [ ] **Step 3: Escribir el módulo**

Crear `lib/ventas/anular.ts`:

```ts
import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { ErrorDeVenta } from './errores'

export async function anularVenta(entrada: {
  tenantId: string
  ventaId: string
  usuarioId: string
}): Promise<void> {
  const { tenantId, ventaId, usuarioId } = entrada

  await enTransaccionDeTenant(tenantId, async (tx) => {
    const venta = await tx.venta.findUnique({ where: { id: ventaId } })
    if (!venta) {
      throw new ErrorDeVenta(
        'VENTA_INEXISTENTE',
        `la venta ${ventaId} no existe en este tenant`,
      )
    }
    // Idempotente: el reintento de un click es más probable que la mala
    // intención, y anular dos veces no puede duplicar la devolución de stock.
    if (venta.anuladaEn !== null) return

    // Se compensan LOS MOVIMIENTOS QUE LA VENTA GENERÓ, no los ítems.
    // Recorrer los ítems de nuevo daría distinto si el tipo del artículo cambió
    // de PRODUCTO a SERVICIO desde entonces; derivarlo de los movimientos
    // garantiza que las dos mitades coincidan siempre.
    const movimientos = await tx.movimientoStock.findMany({
      where: { ventaId, motivo: 'VENTA' },
    })

    for (const m of movimientos) {
      await tx.movimientoStock.create({
        data: {
          tenantId,
          articuloId: m.articuloId,
          delta: m.delta.negated(),
          motivo: 'ANULACION_VENTA',
          ventaId,
          usuarioId,
        },
      })
      await tx.articulo.update({
        where: { id: m.articuloId },
        data: { stock: { increment: m.delta.negated() } },
      })
    }

    await tx.venta.update({
      where: { id: ventaId },
      data: { anuladaEn: new Date(), anuladaPorId: usuarioId },
    })
  })
}

/**
 * El ingreso de mercadería y la corrección de inventario: lo que devuelve a cero
 * un stock negativo. No tiene venta asociada.
 */
export async function ajustarStock(entrada: {
  tenantId: string
  articuloId: string
  delta: Prisma.Decimal
  motivo: 'AJUSTE' | 'INGRESO'
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, delta, motivo, usuarioId, nota } = entrada

  await enTransaccionDeTenant(tenantId, async (tx) => {
    const articulo = await tx.articulo.findUnique({ where: { id: articuloId } })
    if (!articulo) {
      throw new ErrorDeVenta(
        'ARTICULO_INEXISTENTE',
        `el artículo ${articuloId} no existe en este tenant`,
      )
    }

    await tx.movimientoStock.create({
      data: { tenantId, articuloId, delta, motivo, usuarioId, nota },
    })
    await tx.articulo.update({
      where: { id: articuloId },
      data: { stock: { increment: delta } },
    })
  })
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS, 19 tests (12 de la Task 4 más 7 nuevos).

- [ ] **Step 5: Correr la suite entera**

Run: `npm test`
Expected: todo en verde. Es donde aparece si el schema nuevo rompió `rls-cobertura`, `schema` o el ERD.

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/anular.ts test/ventas.test.ts
git commit -m "feat(ventas): anulación con movimientos compensatorios y ajuste de stock"
```

---

## Lo que este plan no construye

Del spec, repetido acá para que no se lea como olvido: no hay interfaz, no hay Auth.js, no hay caja (apertura, cierre, arqueo), no hay ARCA, no hay costo ni margen del artículo, no hay listas de precios ni descuentos, y no hay reserva de stock. Al terminar, una venta se crea desde un test y el stock queda bien — nada de esto se puede usar todavía desde un navegador.
