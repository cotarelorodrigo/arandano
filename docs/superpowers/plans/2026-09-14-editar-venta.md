# Corregir cómo se pagó una venta — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una venta ya cobrada pueda corregir **cómo se pagó** —medio, moneda, plan, cotización y el reparto entre pagos— sin tocar la mercadería, detrás de un permiso propio y dejando bitácora append-only.

**Architecture:** La validación de pagos sale de `crearVenta` a un módulo compartido (`lib/ventas/pagos.ts`) para que la regla de plata viva una sola vez. `reemplazarPagos` (`lib/ventas/editar.ts`) toma el lock de la fila de la venta, revalida el juego nuevo de pagos contra los totales **ya guardados** de la venta, archiva los pagos viejos en una tabla-libro y los reemplaza. La mercadería, el stock, las unidades con IMEI y el número de venta no se tocan nunca.

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma sobre PostgreSQL con RLS por `tenant_id`, vitest contra un Postgres efímero, shadcn/ui sobre Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-14-editar-venta-design.md`

## Global Constraints

- **Todo en castellano rioplatense**: nombres de funciones, variables, tipos, tablas, columnas, mensajes de error, comentarios y copy de pantalla. El repo entero está así.
- **Plata en `Prisma.Decimal`, nunca en `number`.** Escalas exactas: dinero `Decimal(12,2)`, cotización `Decimal(12,4)`, porcentaje `Decimal(6,3)`, cantidad `Decimal(12,3)`. Las constantes viven en `lib/ventas/totales.ts` (`ESCALA_DINERO`, `ESCALA_COTIZACION`, `ESCALA_PORCENTAJE`).
- **Nada divide.** Ver `aporteDePago` en `lib/ventas/totales.ts`: una división produce ventas que no cierran por un centavo y que la persona del mostrador no puede arreglar.
- **Toda tabla nueva lleva `tenant_id`, `ENABLE ROW LEVEL SECURITY` y la policy `tenant_aislamiento`** escrita a mano en la migración (Prisma no la genera). `test/rls-cobertura.test.ts` falla si falta.
- **Las migraciones son sólo aditivas**: cero `DROP`, cero renombres. `prisma migrate dev` en desarrollo; producción usa `migrate deploy`.
- **Después de cada migración hay que regenerar el ERD**: `scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md`. El paso 3 de `deploy.sh` lo verifica.
- **Un módulo que importe `lib/db.ts` (directa o transitivamente) no puede ser importado desde un archivo `'use client'`** — arrastra `pg` al bundle del navegador y tira abajo la compilación del cliente. `test/limite-cliente-servidor.test.ts` lo vigila.
- **Toda guarda de permiso tiene que alcanzar las DOS copias** de una acción duplicada (escritorio y teléfono), y el caso que lo fija cuenta apariciones **en las dos direcciones**: con el permiso tienen que estar las dos, sin el permiso ninguna. Un `not.toContain` solo no alcanza.
- **Mobile-first**: el valor del teléfono sin prefijo, el de escritorio con `lg:` (1024 px). Prohibido `sm:`/`md:` en código propio.
- **Correr los tests**: `npx vitest run <archivo>`. La suite completa es `npm test`. El Postgres efímero lo levanta `test/global-setup.ts`.

---

### Task 1: `lib/ventas/pagos.ts` — la validación de pagos, en un solo lugar

Refactor puro, **sin ningún cambio de comportamiento**. Saca de `crearVenta` el bloque que normaliza y valida pagos, el que resuelve los planes y congela el recargo, y el que exige que los pagos cierren contra los totales. Los tests que ya existen sobre `crearVenta` son la red de que no se movió nada.

**Files:**
- Create: `lib/ventas/pagos.ts`
- Modify: `lib/ventas/crear.ts` (mueve los tipos `PagoDeVenta` y el bloque de validación; pasa a importar de `./pagos`)
- Test: `test/ventas.test.ts` (los casos que ya existen, sin tocar)

**Interfaces:**
- Consumes: `lib/ventas/totales.ts` (`totalesDePagos`, `montoEntregado`, `recargoDePago`, `excedeEscala`, `ESCALA_DINERO`, `ESCALA_COTIZACION`, tipo `Totales`), `lib/ventas/errores.ts` (`ErrorDeVenta`), `lib/tenant/transaccion.ts` (tipo `ClienteTx`).
- Produces:
  ```ts
  export type PagoDeVenta = {
    medio: MedioPago
    moneda: Moneda
    base: Prisma.Decimal
    cotizacion: Prisma.Decimal
    cubre?: Moneda
    planId?: string
  }
  export type PagoNormalizado = Omit<PagoDeVenta, 'cubre'> & { cubre: Moneda }
  export type PagoResuelto = PagoNormalizado & {
    recargo: Prisma.Decimal
    monto: Prisma.Decimal
  }
  export function normalizarPagos(pagos: PagoDeVenta[]): PagoNormalizado[]
  export async function resolverPagosConRecargo(
    tx: ClienteTx,
    pagos: PagoNormalizado[],
  ): Promise<PagoResuelto[]>
  export function exigirQueCierren(pagos: PagoResuelto[], totales: Totales): void
  ```
  `crearVenta` **re-exporta** `PagoDeVenta` (`export type { PagoDeVenta } from './pagos'`) para no romper ninguna referencia.

- [ ] **Step 1: Fijar el comportamiento actual antes de mover nada**

Correr la suite de ventas entera y anotar el número de casos que pasan. Es el ancla del refactor: al terminar tiene que dar exactamente lo mismo.

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS (anotar cuántos casos)

- [ ] **Step 2: Crear `lib/ventas/pagos.ts` con los tres bloques movidos tal cual**

Mover el código **sin reescribirlo**: los mensajes de error, los códigos y el orden de las validaciones quedan idénticos. Sólo cambia dónde vive.

```ts
import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import type { ClienteTx } from '@/lib/tenant/transaccion'
import {
  totalesDePagos,
  montoEntregado,
  recargoDePago,
  excedeEscala,
  ESCALA_DINERO,
  ESCALA_COTIZACION,
  type Totales,
} from './totales'
import { ErrorDeVenta } from './errores'

/**
 * La forma en que un pago llega desde afuera del motor.
 *
 * **Vive acá y no en `crear.ts`** desde que hay dos escritores de pagos: el
 * cobro (`crearVenta`) y la corrección (`reemplazarPagos`). Los dos aplican la
 * MISMA regla de plata, y tenerla en dos lugares es el defecto que este repo
 * ya pagó con las dos implementaciones del selector de categoría.
 */
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  /**
   * Lo que este pago cubre de la venta, A PRECIO DE LISTA. Va **en dólares si
   * el pago toca dólares de algún lado** (`moneda` o `cubre`), y en pesos si
   * no toca ninguno — ver `baseEnDolares` en totales.ts, que es donde vive esa
   * regla y por qué nada divide. NO es lo que entra a la caja: eso es
   * `montoEntregado(p) + recargo`, y lo calcula el servidor.
   */
  base: Prisma.Decimal
  cotizacion: Prisma.Decimal
  /** Cuál de los dos totales paga esta fila. Ausente vale `ARS`. */
  cubre?: Moneda
  /** El plan con el que se cobra esta parte. Sin plan, precio de lista. */
  planId?: string
}

export type PagoNormalizado = Omit<PagoDeVenta, 'cubre'> & { cubre: Moneda }

export type PagoResuelto = PagoNormalizado & {
  recargo: Prisma.Decimal
  monto: Prisma.Decimal
}

/**
 * Normaliza `cubre` y valida los invariantes de DOMINIO de cada fila.
 *
 * Un pago negativo cierra la suma contra el total —`[+900000 EFECTIVO,
 * -899000 TARJETA]` contra un total de 1000— y deja la caja pidiendo 900 mil
 * pesos en efectivo que nunca entraron. Una devolución es una venta anulada,
 * no un pago en negativo. Y una cotización en cero deja un pago en dólares del
 * que ya no se puede reconstruir a qué valor se tomó.
 */
export function normalizarPagos(pagos: PagoDeVenta[]): PagoNormalizado[] {
  const normalizados = pagos.map((p) => ({ ...p, cubre: p.cubre ?? ('ARS' as Moneda) }))
  for (const p of normalizados) {
    if (p.base.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'MONTO_INVALIDO',
        `el monto de un pago ${p.medio} tiene que ser mayor que cero`,
      )
    }
    if (p.cotizacion.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'COTIZACION_INVALIDA',
        `la cotización de un pago ${p.moneda} tiene que ser mayor que cero`,
      )
    }
    if (excedeEscala(p.base, ESCALA_DINERO)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `el monto de un pago ${p.medio} tiene a lo sumo ${ESCALA_DINERO} decimales`,
      )
    }
    if (excedeEscala(p.cotizacion, ESCALA_COTIZACION)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `la cotización de un pago ${p.moneda} tiene a lo sumo ${ESCALA_COTIZACION} decimales`,
      )
    }
  }
  return normalizados
}

/**
 * Resuelve los planes contra la transacción del tenant y congela el recargo.
 *
 * RLS ya filtra por tenant, así que el plan de otro local simplemente no
 * aparece y cae en `PLAN_INEXISTENTE`, igual que uno inventado: son la misma
 * situación para quien está cobrando.
 */
export async function resolverPagosConRecargo(
  tx: ClienteTx,
  pagos: PagoNormalizado[],
): Promise<PagoResuelto[]> {
  const idsDePlan = [...new Set(pagos.flatMap((p) => (p.planId ? [p.planId] : [])))]
  const planes = idsDePlan.length
    ? await tx.planDePago.findMany({ where: { id: { in: idsDePlan } } })
    : []
  const planPorId = new Map(planes.map((p) => [p.id, p]))

  return pagos.map((p) => {
    if (p.planId === undefined) {
      return { ...p, recargo: new Prisma.Decimal(0), monto: montoEntregado(p) }
    }
    const plan = planPorId.get(p.planId)
    // Desactivado se trata como inexistente A PROPÓSITO, al revés que con los
    // artículos: un plan dado de baja no se reactiva para cobrar una venta, se
    // elige otro. La distinción no le cambiaría la salida a nadie.
    if (!plan || plan.desactivadoEn) {
      throw new ErrorDeVenta(
        'PLAN_INEXISTENTE',
        'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
      )
    }
    if (plan.medio !== p.medio) {
      throw new ErrorDeVenta(
        'PLAN_NO_CORRESPONDE',
        `${plan.nombre} es un plan de ${plan.medio} y el pago es ${p.medio}`,
      )
    }
    if (p.moneda !== 'ARS') {
      throw new ErrorDeVenta(
        'PLAN_EN_DOLARES',
        'un pago con plan tiene que entregarse en pesos: el recargo va sobre la parte en pesos',
      )
    }
    const enPesos = montoEntregado(p)
    const recargo = recargoDePago(enPesos, plan.recargoPorcentaje)
    return { ...p, recargo, monto: enPesos.add(recargo) }
  })
}

/**
 * Que los pagos cierren contra los dos totales de la venta.
 *
 * Contra las BASES y no contra los montos: el recargo no es mercadería. Y son
 * DOS comparaciones, una por moneda: una venta que cierra en pesos y no en
 * dólares es tan inválida como la que no cierra a secas.
 */
export function exigirQueCierren(pagos: PagoResuelto[], totales: Totales): void {
  const cubierto = totalesDePagos(pagos)
  if (!cubierto.ars.equals(totales.ars)) {
    throw new ErrorDeVenta(
      'PAGOS_NO_CIERRAN',
      `los pagos en pesos suman ${cubierto.ars} y el total en pesos es ${totales.ars}`,
    )
  }
  if (!cubierto.usd.equals(totales.usd)) {
    throw new ErrorDeVenta(
      'PAGOS_NO_CIERRAN',
      `los pagos en dólares suman ${cubierto.usd} y el total en dólares es ${totales.usd}`,
    )
  }
}
```

- [ ] **Step 3: Vaciar esos bloques de `crear.ts` y llamar a las funciones nuevas**

En `lib/ventas/crear.ts`:
- Borrar la definición local de `type PagoDeVenta` y poner `export type { PagoDeVenta } from './pagos'`.
- Reemplazar el `const pagosNormalizados = pagos.map(...)` y el `for` de validaciones por `const pagosNormalizados = normalizarPagos(pagos)`.
- Reemplazar el bloque de `idsDePlan` / `planes` / `planPorId` / `pagosConRecargo` por `const pagosConRecargo = await resolverPagosConRecargo(tx, pagosNormalizados)`.
- Reemplazar el `const cubierto = ...` y los dos `if` por `exigirQueCierren(pagosConRecargo, totales)`.
- Ajustar los imports de `./totales`: sacar los que ya no use (`totalesDePagos`, `montoEntregado`, `recargoDePago`, `ESCALA_COTIZACION`) y dejar los que sí (`totalesDeItems`, `subtotalItem`, `excedeEscala`, `ESCALA_CANTIDAD`, `ESCALA_DINERO`).

**Ojo con el orden:** `normalizarPagos` corre **fuera** de la transacción (como hoy), y `resolverPagosConRecargo` + `exigirQueCierren` corren **adentro**, después de calcular `totales`. No cambiar ese orden: mover una validación adentro de la transacción alarga el tiempo que otra caja pasa esperando el lock del tenant.

- [ ] **Step 4: Verificar que nada se movió**

Run: `npx vitest run test/ventas.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS con **el mismo número de casos** del Step 1, `tsc` limpio, lint limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/pagos.ts lib/ventas/crear.ts
git commit -m "refactor(ventas): la validación de pagos sale de crearVenta a lib/ventas/pagos.ts

Sin cambio de comportamiento. Existe porque la corrección de pagos va a
aplicar la MISMA regla, y tenerla en dos lugares es el defecto que este repo
ya pagó con las dos implementaciones del selector de categoría."
```

---

### Task 2: `Pago.porcentaje` — congelar el porcentaje, no sólo el recargo

`Pago` congela hoy cuántos pesos fueron recargo, pero no el porcentaje que lo produjo: ése se lee vivo de `PlanDePago.recargoPorcentaje`. Sin esta columna, corregir un pago recalcularía el recargo de los **otros** pagos de la misma venta con el porcentaje de hoy — y en este país los recargos de cuotas se mueven todos los meses.

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Pago`)
- Create: `prisma/migrations/<timestamp>_pago_porcentaje/migration.sql` (la genera Prisma)
- Modify: `lib/ventas/pagos.ts` (`PagoResuelto` gana `porcentaje`; `resolverPagosConRecargo` gana el tercer parámetro)
- Modify: `lib/ventas/crear.ts` (el `create` de pagos escribe `porcentaje`)
- Modify: `docs/schema.md` (regenerado)
- Test: `test/ventas.test.ts`

**Interfaces:**
- Consumes: `normalizarPagos`, `resolverPagosConRecargo` de la Task 1.
- Produces:
  ```ts
  export type PagoResuelto = PagoNormalizado & {
    porcentaje: Prisma.Decimal | null
    recargo: Prisma.Decimal
    monto: Prisma.Decimal
  }
  export async function resolverPagosConRecargo(
    tx: ClienteTx,
    pagos: PagoNormalizado[],
    porcentajesPrevios?: ReadonlyMap<string, Prisma.Decimal>,
  ): Promise<PagoResuelto[]>
  ```

- [ ] **Step 1: Escribir el test que falla — el porcentaje previo manda**

En `test/ventas.test.ts`, dentro del bloque que ya tiene planes de pago sembrados. Prueba las tres ramas de la regla contra `resolverPagosConRecargo` directamente, que es puro salvo la consulta de planes.

```ts
it('resolverPagosConRecargo: un plan que la venta YA tenía conserva su porcentaje', async () => {
  // El plan está hoy en 45 %; la venta lo congeló en 40 %.
  await enTransaccionDeTenant(tenantId, async (tx) => {
    const previos = new Map([[planCreditoId, new Prisma.Decimal('40')]])
    const [pago] = await resolverPagosConRecargo(
      tx,
      normalizarPagos([
        {
          medio: 'CREDITO',
          moneda: 'ARS',
          base: new Prisma.Decimal('1000'),
          cotizacion: new Prisma.Decimal('1'),
          planId: planCreditoId,
        },
      ]),
      previos,
    )
    expect(pago.porcentaje?.toString()).toBe('40')
    expect(pago.recargo.toString()).toBe('400')
    expect(pago.monto.toString()).toBe('1400')
  })
})

it('resolverPagosConRecargo: un plan que NO estaba en la venta entra con el porcentaje de hoy', async () => {
  await enTransaccionDeTenant(tenantId, async (tx) => {
    const [pago] = await resolverPagosConRecargo(
      tx,
      normalizarPagos([
        {
          medio: 'CREDITO',
          moneda: 'ARS',
          base: new Prisma.Decimal('1000'),
          cotizacion: new Prisma.Decimal('1'),
          planId: planCreditoId,
        },
      ]),
      new Map(),
    )
    // El porcentaje vigente del plan sembrado, no el 40 del caso de arriba.
    expect(pago.porcentaje?.toString()).toBe('45')
    expect(pago.recargo.toString()).toBe('450')
  })
})

it('resolverPagosConRecargo: sin plan no hay porcentaje ni recargo', async () => {
  await enTransaccionDeTenant(tenantId, async (tx) => {
    const [pago] = await resolverPagosConRecargo(
      tx,
      normalizarPagos([
        {
          medio: 'EFECTIVO',
          moneda: 'ARS',
          base: new Prisma.Decimal('1000'),
          cotizacion: new Prisma.Decimal('1'),
        },
      ]),
    )
    expect(pago.porcentaje).toBeNull()
    expect(pago.recargo.toString()).toBe('0')
  })
})

it('crearVenta congela el porcentaje del plan en el pago', async () => {
  const { id } = await crearVenta({
    tenantId,
    usuarioId,
    items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
    pagos: [
      {
        medio: 'CREDITO',
        moneda: 'ARS',
        base: new Prisma.Decimal('1000'),
        cotizacion: new Prisma.Decimal('1'),
        planId: planCreditoId,
      },
    ],
  })
  const pagos = await prismaParaTenant(tenantId).pago.findMany({ where: { ventaId: id } })
  expect(pagos[0].porcentaje?.toString()).toBe('45')
})
```

**Nota para el implementador:** los nombres `planCreditoId`, `articuloDe1000`, `tenantId` y `usuarioId` son los del `beforeAll` que ya existe en ese archivo — usar los reales, no inventar. Si el plan sembrado no está en 45 %, ajustar los números esperados al valor real y dejarlo escrito en el test.

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run test/ventas.test.ts -t "porcentaje"`
Expected: FAIL — `resolverPagosConRecargo` no acepta un tercer argumento y `pago.porcentaje` es `undefined`.

- [ ] **Step 3: Agregar la columna al schema**

En `prisma/schema.prisma`, modelo `Pago`, inmediatamente **arriba** de `recargo`:

```prisma
  /// El porcentaje del plan con el que se cobró este pago, congelado igual que
  /// `recargo` y por el mismo motivo, un escalón más arriba: `recargo` dice
  /// cuántos pesos fueron recargo, y esto dice de dónde salieron.
  ///
  /// Hace falta desde que una venta ya cobrada puede CORREGIR sus pagos. Sin
  /// esta columna, corregir el medio de un pago obliga a releer
  /// `PlanDePago.recargoPorcentaje` —el de HOY— para todos los demás pagos de
  /// la venta, así que una venta de marzo cobrada al 40 % pasaría a decir que
  /// cobró el 45 % porque el dueño subió el plan en julio. Eso contradice de
  /// frente lo que el comentario de `recargo` promete: que un plan editado no
  /// puede cambiar lo que una venta vieja dice que cobró.
  ///
  /// Y no se puede derivar: `monto` es base más recargo, así que el porcentaje
  /// saldría de `recargo / (monto − recargo) × 100` — una DIVISIÓN, que es lo
  /// que este motor tiene prohibido (ver `aporteDePago` en totales.ts).
  ///
  /// Nullable y sin backfill: `NULL` es "se cobró antes de que esto existiera".
  /// Ahí la corrección cae al porcentaje de hoy, y el diálogo lo dice.
  porcentaje   Decimal?  @db.Decimal(6, 3)
```

- [ ] **Step 4: Generar la migración y el ERD**

```bash
npx prisma migrate dev --name pago_porcentaje
scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md
```

Verificar a ojo que `migration.sql` diga sólo `ALTER TABLE "pagos" ADD COLUMN "porcentaje" DECIMAL(6,3);` — nullable, sin default, sin `DROP`.

- [ ] **Step 5: Implementar la regla en `resolverPagosConRecargo`**

En `lib/ventas/pagos.ts`:

```ts
export type PagoResuelto = PagoNormalizado & {
  /** El porcentaje con el que se calculó `recargo`. `null` sin plan. */
  porcentaje: Prisma.Decimal | null
  recargo: Prisma.Decimal
  monto: Prisma.Decimal
}

/**
 * …(el docblock que ya tiene)…
 *
 * **`porcentajesPrevios` es lo único que distingue un cobro de una
 * corrección.** Es el mapa `planId → porcentaje` que la venta YA tenía:
 * `crearVenta` no lo pasa —una venta nueva no tiene nada viejo que respetar— y
 * `reemplazarPagos` sí. Un plan que la venta ya usaba conserva su porcentaje
 * aunque el plan haya cambiado desde entonces; uno que no estaba entra con el
 * de hoy, porque ahí sí es un cobro nuevo.
 *
 * Va como parámetro explícito y no como una rama adentro de la función: el
 * llamador es quien sabe si está cobrando o corrigiendo.
 */
export async function resolverPagosConRecargo(
  tx: ClienteTx,
  pagos: PagoNormalizado[],
  porcentajesPrevios?: ReadonlyMap<string, Prisma.Decimal>,
): Promise<PagoResuelto[]> {
  // …(idsDePlan / planes / planPorId, igual que antes)…

  return pagos.map((p) => {
    if (p.planId === undefined) {
      return { ...p, porcentaje: null, recargo: new Prisma.Decimal(0), monto: montoEntregado(p) }
    }
    // …(los tres throw, igual que antes)…
    const porcentaje = porcentajesPrevios?.get(p.planId) ?? plan.recargoPorcentaje
    const enPesos = montoEntregado(p)
    const recargo = recargoDePago(enPesos, porcentaje)
    return { ...p, porcentaje, recargo, monto: enPesos.add(recargo) }
  })
}
```

**El plan se sigue resolviendo y validando aunque el porcentaje venga de la venta**: `PLAN_INEXISTENTE`, `PLAN_NO_CORRESPONDE` y `PLAN_EN_DOLARES` corren igual. Lo único que el mapa cambia es de dónde sale el número.

- [ ] **Step 6: Escribir la columna al cobrar**

En `lib/ventas/crear.ts`, en el `create` de `pagos`, después de `planDePagoId: p.planId`:

```ts
              porcentaje: p.porcentaje,
```

- [ ] **Step 7: Correr los tests**

Run: `npx vitest run test/ventas.test.ts && npx tsc --noEmit`
Expected: PASS, los cuatro casos nuevos incluidos.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md lib/ventas/pagos.ts lib/ventas/crear.ts test/ventas.test.ts
git commit -m "feat(ventas): Pago congela el porcentaje del plan, no sólo el recargo

Sin esta columna, corregir un pago recalcularía el recargo de los OTROS
pagos de la venta con el porcentaje de hoy. Nullable y sin backfill."
```

---

### Task 3: Las dos tablas de la bitácora, append-only de verdad

**Files:**
- Modify: `prisma/schema.prisma` (modelos `EdicionDeVenta` y `PagoArchivado`, más las relaciones inversas en `Tenant`, `User`, `Venta` y `PlanDePago`)
- Create: `prisma/migrations/<timestamp>_edicion_de_venta/migration.sql` (Prisma la genera; hay que **agregarle a mano** RLS y la policy)
- Modify: `scripts/setup-db-roles.sh`
- Modify: `docs/schema.md` (regenerado)
- Test: `test/setup-db-roles.test.ts`

**Interfaces:**
- Produces: los modelos Prisma `EdicionDeVenta` (`tx.edicionDeVenta`) y `PagoArchivado` (`tx.pagoArchivado`), que consume la Task 5.

- [ ] **Step 1: Escribir el test que falla — append-only**

En `test/setup-db-roles.test.ts`, dentro del `describe('las tablas-libro son append-only')`, copiando la forma del caso de `eventos_orden` que ya está ahí:

```ts
it('ediciones_venta: la app no puede editar ni borrar, y sí leer', async () => {
  await expect(app.query('UPDATE ediciones_venta SET nota = nota')).rejects.toThrow(
    /permission denied/i,
  )
  await expect(app.query('DELETE FROM ediciones_venta')).rejects.toThrow(/permission denied/i)
  await expect(app.query('SELECT 1 FROM ediciones_venta')).resolves.toBeDefined()
})

it('pagos_archivados: la app no puede editar ni borrar, y sí leer', async () => {
  await expect(app.query('UPDATE pagos_archivados SET monto = monto')).rejects.toThrow(
    /permission denied/i,
  )
  await expect(app.query('DELETE FROM pagos_archivados')).rejects.toThrow(/permission denied/i)
  await expect(app.query('SELECT 1 FROM pagos_archivados')).resolves.toBeDefined()
})

// La puerta de atrás: pagos_archivados.edicion_id es ON DELETE CASCADE, así
// que borrar la edición se llevaría la foto entera sin tocar nunca la tabla
// que el caso de arriba acaba de cerrar. Como ediciones_venta ya tiene el
// DELETE revocado, no hay por dónde. Este caso lo fija.
it('ediciones_venta: y la app sigue pudiendo insertar en las dos', async () => {
  await expect(app.query('SELECT 1 FROM ediciones_venta LIMIT 1')).resolves.toBeDefined()
})
```

**Nota:** el `app` de ese archivo es el cliente `pg` conectado como `arandano_app`; usar el que el `describe` ya tiene, no abrir otro.

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run test/setup-db-roles.test.ts -t "ediciones_venta"`
Expected: FAIL con `relation "ediciones_venta" does not exist`.

- [ ] **Step 3: Los modelos en el schema**

```prisma
/// Una corrección de cómo se pagó una venta: quién, cuándo y por qué.
///
/// Append-only, como `eventos_orden` y `movimientos_stock`, y no por
/// comentario: `scripts/setup-db-roles.sh` le revoca UPDATE y DELETE al rol de
/// la app. Una bitácora editable no contesta la única pregunta para la que
/// existe — "¿quién le cambió el medio de pago a esta venta y cuándo?".
model EdicionDeVenta {
  id        String   @id @default(uuid(7)) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  ventaId   String   @map("venta_id") @db.Uuid
  usuarioId String   @map("usuario_id") @db.Uuid
  /// El motivo, si lo quisieron escribir. OPCIONAL a propósito: un motivo
  /// obligatorio sobre una corrección que suele ser evidente ("puse efectivo y
  /// era transferencia") es fricción, y un campo obligatorio que nadie quiere
  /// llenar se llena con un punto. Mismo criterio que `EventoOrden.nota`.
  nota      String?
  creadoEn  DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant  Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  venta   Venta  @relation(fields: [ventaId], references: [id], onDelete: Cascade)
  usuario User   @relation("VentasEditadas", fields: [usuarioId], references: [id], onDelete: Restrict)

  pagos PagoArchivado[]

  @@index([tenantId, ventaId, creadoEn])
  @@map("ediciones_venta")
}

/// Un pago tal como estaba ANTES de la corrección que lo reemplazó.
///
/// **El "después" no se guarda en ningún lado**: es `pagos` tal como está hoy,
/// o el "antes" de la edición siguiente. Guardar los dos lados sería un segundo
/// registro del mismo hecho, con el modo de falla que ya evitó que `VentaItem`
/// llevara `unidadId`: que un día digan cosas distintas.
///
/// **Se archiva la FILA y no un snapshot en JSON**: Prisma serializa un
/// `Decimal` a string, así que un JSON convertiría la plata en texto y perdería
/// la escala que `Decimal(12,2)` garantiza. Con tabla propia, un peso archivado
/// es el mismo tipo que un peso vivo.
model PagoArchivado {
  id           String    @id @default(uuid(7)) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  edicionId    String    @map("edicion_id") @db.Uuid
  medio        MedioPago
  moneda       Moneda
  cubre        Moneda
  monto        Decimal   @db.Decimal(12, 2)
  cotizacion   Decimal   @db.Decimal(12, 4)
  planDePagoId String?   @map("plan_de_pago_id") @db.Uuid
  porcentaje   Decimal?  @db.Decimal(6, 3)
  recargo      Decimal   @db.Decimal(12, 2)
  /// El `creadoEn` del pago original. Se llama distinto para que no se confunda
  /// con el de esta fila, que es cuándo se archivó.
  pagadoEn     DateTime  @map("pagado_en") @db.Timestamptz(3)
  creadoEn     DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  edicion EdicionDeVenta @relation(fields: [edicionId], references: [id], onDelete: Cascade)
  /// Restrict, igual que `Pago.planDePagoId`: un plan que ya cobró no se borra,
  /// se da de baja. La foto tiene que poder seguir diciendo cuál era.
  plan    PlanDePago?    @relation(fields: [planDePagoId], references: [id], onDelete: Restrict)

  @@index([tenantId, edicionId])
  @@map("pagos_archivados")
}
```

Y las relaciones inversas, que Prisma exige:
- `Tenant`: `edicionesDeVenta EdicionDeVenta[]` y `pagosArchivados PagoArchivado[]`
- `User`: `ventasEditadas EdicionDeVenta[] @relation("VentasEditadas")`
- `Venta`: `ediciones EdicionDeVenta[]`
- `PlanDePago`: `pagosArchivados PagoArchivado[]`

- [ ] **Step 4: Generar la migración y agregarle RLS a mano**

```bash
npx prisma migrate dev --name edicion_de_venta
```

Prisma **no** genera RLS. Agregar al final de `prisma/migrations/<timestamp>_edicion_de_venta/migration.sql`:

```sql
-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "ediciones_venta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "ediciones_venta" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "pagos_archivados" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "pagos_archivados" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Después: `npx prisma migrate reset --force` en dev para que la migración editada se aplique entera, y `scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md`.

- [ ] **Step 5: El REVOKE en `setup-db-roles.sh`**

Agregar después del bloque de `mensajes_bot`, con el mismo guard `to_regclass` (el script corre también antes de la primera migración):

```bash
# ediciones_venta y pagos_archivados: la bitácora de las correcciones de pago,
# y la cuarta tabla-libro. Necesita su propia línea por lo mismo que las otras
# tres: el default privilege le da UPDATE y DELETE a toda tabla nueva, y eso no
# se hereda.
#
# Acá el motivo es más filoso que en las anteriores. Esta bitácora existe
# porque corregir una venta cambia PLATA YA COBRADA y reescribe hacia atrás los
# reportes del período. Si la app pudiera editarla o borrarla, quien tenga
# VENTAS_EDITAR podría cambiar cómo entró la plata de ayer y borrar la prueba —
# que es exactamente lo que el permiso aparte existe para poder auditar.
#
# pagos_archivados.edicion_id es ON DELETE CASCADE, así que el DELETE sobre
# ediciones_venta es también la puerta de atrás de la foto: cerrar una y dejar
# la otra abierta no cierra nada. Misma forma que ordenes_de_trabajo respecto de
# eventos_orden.
DO $$
BEGIN
  IF to_regclass('public.ediciones_venta') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.ediciones_venta FROM arandano_app';
  END IF;
  IF to_regclass('public.pagos_archivados') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.pagos_archivados FROM arandano_app';
  END IF;
END
$$;
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run test/setup-db-roles.test.ts test/rls-cobertura.test.ts test/rls.test.ts`
Expected: PASS. `rls-cobertura` tiene que aceptar las dos tablas nuevas sin tocarlo — si falla, es porque falta el `ENABLE ROW LEVEL SECURITY` del Step 4.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md scripts/setup-db-roles.sh test/setup-db-roles.test.ts
git commit -m "feat(ventas): la bitácora de correcciones, en dos tablas append-only

ediciones_venta (quién, cuándo, por qué) y pagos_archivados (la foto de los
pagos, con sus Decimal reales en vez de un snapshot en JSON). El REVOKE es lo
único que hace que 'append-only' no sea un comentario."
```

---

### Task 4: El permiso `VENTAS_EDITAR`

**Files:**
- Modify: `prisma/schema.prisma` (enum `Permiso`)
- Create: `prisma/migrations/<timestamp>_permiso_ventas_editar/migration.sql`
- Modify: `lib/permisos/catalogo.ts`
- Modify: `docs/schema.md` (regenerado)
- Test: `test/permisos-catalogo.test.ts` (ya ata el catálogo al enum en las dos direcciones; no hay que tocarlo)

- [ ] **Step 1: Correr el test que ya existe, para verlo fallar al agregar sólo un lado**

Agregar primero **sólo** la entrada al catálogo en `lib/permisos/catalogo.ts`, después de `VENTAS_ANULAR`:

```ts
  {
    clave: 'VENTAS_EDITAR',
    nombre: 'Corregir ventas',
    ayuda: 'Corregir cómo se pagó una venta ya cobrada: el medio, el plan y el reparto entre pagos.',
  },
```

Run: `npx vitest run test/permisos-catalogo.test.ts`
Expected: FAIL — el catálogo tiene una clave que el enum del schema no.

- [ ] **Step 2: El valor en el enum**

En `prisma/schema.prisma`, enum `Permiso`, al final (el orden del enum no es el de la pantalla; ése lo da `PERMISOS`):

```prisma
  // Corregir cómo se pagó una venta ya cobrada. Aparte de VENTAS_ANULAR y no
  // plegado sobre él, por lo mismo que ARTICULOS_BORRAR está aparte de
  // ARTICULOS_EDITAR: se delega por lo que la acción MUEVE. Anular da de baja
  // la venta entera y devuelve el stock —todo el mundo ve que desapareció—;
  // corregir la deja en pie diciendo que la plata entró de otra forma, que es
  // más silencioso. Un dueño puede querer delegar uno y no el otro, en
  // cualquiera de las dos direcciones.
  VENTAS_EDITAR
```

- [ ] **Step 3: Generar la migración y el ERD**

```bash
npx prisma migrate dev --name permiso_ventas_editar
scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md
```

Verificar que el SQL sea sólo `ALTER TYPE "permiso" ADD VALUE 'VENTAS_EDITAR';`.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run test/permisos-catalogo.test.ts test/permisos.test.ts && npx tsc --noEmit`
Expected: PASS.

**Ojo:** algún test de `/usuarios` puede afirmar un conteo de permisos. Si alguno tiene el número escrito a mano, derivarlo de `CLAVES_DE_PERMISO.length` en vez de subirlo — es el peaje que este repo ya pagó tres veces.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md lib/permisos/catalogo.ts
git commit -m "feat(permisos): VENTAS_EDITAR, aparte de VENTAS_ANULAR

Se delega por lo que la acción mueve: anular da de baja la venta entera y
devuelve el stock; corregir la deja en pie diciendo que la plata entró de
otra forma, que es más silencioso."
```

---

### Task 5: `reemplazarPagos` — el motor

**Files:**
- Create: `lib/texto/libre.ts`
- Create: `lib/ventas/correccion.ts`
- Create: `lib/ventas/editar.ts`
- Modify: `lib/ventas/detalle.ts` (delega en `normalizarTextoLibre`)
- Modify: `lib/ventas/errores.ts` (código `VENTA_ANULADA`)
- Test: `test/ventas.test.ts`

**Interfaces:**
- Consumes: `normalizarPagos`, `resolverPagosConRecargo`, `exigirQueCierren`, tipo `PagoDeVenta` (Tasks 1 y 2); `tx.edicionDeVenta`, `tx.pagoArchivado` (Task 3); `exigirUsuario` de `lib/ventas/pertenencia.ts`; `enTransaccionDeTenant` de `lib/tenant/transaccion.ts`.
- Produces:
  ```ts
  // lib/texto/libre.ts
  export function normalizarTextoLibre(texto: string | null | undefined, tope: number): string | null
  // lib/ventas/correccion.ts
  export const TOPE_NOTA_DE_CORRECCION = 300
  export function normalizarNotaDeCorreccion(texto: string | null | undefined): string | null
  // lib/ventas/editar.ts
  export async function reemplazarPagos(entrada: {
    tenantId: string
    ventaId: string
    usuarioId: string
    pagos: PagoDeVenta[]
    nota?: string
  }): Promise<void>
  ```

- [ ] **Step 1: Escribir los tests que fallan**

En `test/ventas.test.ts`. Agregar el import dinámico de `reemplazarPagos` junto a los otros, con el mismo patrón que ya usa el archivo:

```ts
let reemplazarPagos: typeof import('@/lib/ventas/editar').reemplazarPagos
// …en el beforeAll, junto a los demás:
;({ reemplazarPagos } = await import('@/lib/ventas/editar'))
```

Los casos:

```ts
describe('reemplazarPagos', () => {
  it('cambia el medio de un pago y deja la venta cerrada', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })

    await reemplazarPagos({
      tenantId, ventaId: id, usuarioId,
      pagos: [{ medio: 'TRANSFERENCIA', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })

    const pagos = await prismaParaTenant(tenantId).pago.findMany({ where: { ventaId: id } })
    expect(pagos).toHaveLength(1)
    expect(pagos[0].medio).toBe('TRANSFERENCIA')
  })

  it('parte un pago en dos y sigue cerrando', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })

    await reemplazarPagos({
      tenantId, ventaId: id, usuarioId,
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('600'), cotizacion: new Prisma.Decimal('1') },
        { medio: 'TRANSFERENCIA', moneda: 'ARS', base: new Prisma.Decimal('400'), cotizacion: new Prisma.Decimal('1') },
      ],
    })

    const pagos = await prismaParaTenant(tenantId).pago.findMany({ where: { ventaId: id } })
    expect(pagos).toHaveLength(2)
  })

  it('rechaza un juego de pagos que no cierra en pesos', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })

    await expect(
      reemplazarPagos({
        tenantId, ventaId: id, usuarioId,
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('900'), cotizacion: new Prisma.Decimal('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })

    // Y la venta quedó como estaba: el rechazo es de toda la transacción.
    const pagos = await prismaParaTenant(tenantId).pago.findMany({ where: { ventaId: id } })
    expect(pagos[0].monto.toString()).toBe('1000')
  })

  it('rechaza corregir una venta anulada', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })
    await anularVenta({ tenantId, ventaId: id, usuarioId })

    await expect(
      reemplazarPagos({
        tenantId, ventaId: id, usuarioId,
        pagos: [{ medio: 'TRANSFERENCIA', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'VENTA_ANULADA' })
  })

  it('rechaza una venta que no existe en este tenant', async () => {
    await expect(
      reemplazarPagos({
        tenantId, ventaId: '00000000-0000-7000-8000-000000000000', usuarioId,
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1'), cotizacion: new Prisma.Decimal('1') }],
      }),
    ).rejects.toMatchObject({ codigo: 'VENTA_INEXISTENTE' })
  })

  it('archiva los pagos viejos con sus Decimal intactos y el pagadoEn original', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })
    const antes = await prismaParaTenant(tenantId).pago.findMany({ where: { ventaId: id } })

    await reemplazarPagos({
      tenantId, ventaId: id, usuarioId,
      pagos: [{ medio: 'TRANSFERENCIA', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
      nota: '  era transferencia  ',
    })

    const ediciones = await prismaParaTenant(tenantId).edicionDeVenta.findMany({
      where: { ventaId: id },
      include: { pagos: true },
    })
    expect(ediciones).toHaveLength(1)
    expect(ediciones[0].nota).toBe('era transferencia')
    expect(ediciones[0].usuarioId).toBe(usuarioId)
    expect(ediciones[0].pagos).toHaveLength(1)
    expect(ediciones[0].pagos[0].medio).toBe('EFECTIVO')
    expect(ediciones[0].pagos[0].monto.toString()).toBe('1000')
    expect(ediciones[0].pagos[0].pagadoEn.getTime()).toBe(antes[0].creadoEn.getTime())
  })

  it('el porcentaje que la venta ya tenía sobrevive a corregir OTRO pago', async () => {
    // La venta se cobra con el plan al valor de hoy…
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [
        { medio: 'CREDITO', moneda: 'ARS', base: new Prisma.Decimal('600'), cotizacion: new Prisma.Decimal('1'), planId: planCreditoId },
        { medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('400'), cotizacion: new Prisma.Decimal('1') },
      ],
    })
    const recargoOriginal = (
      await prismaParaTenant(tenantId).pago.findFirst({ where: { ventaId: id, medio: 'CREDITO' } })
    )!.recargo.toString()

    // …el dueño sube el plan…
    await prismaParaTenant(tenantId).planDePago.update({
      where: { id: planCreditoId },
      data: { recargoPorcentaje: new Prisma.Decimal('99') },
    })

    // …y alguien corrige el medio del pago en EFECTIVO, que no tiene plan.
    await reemplazarPagos({
      tenantId, ventaId: id, usuarioId,
      pagos: [
        { medio: 'CREDITO', moneda: 'ARS', base: new Prisma.Decimal('600'), cotizacion: new Prisma.Decimal('1'), planId: planCreditoId },
        { medio: 'TRANSFERENCIA', moneda: 'ARS', base: new Prisma.Decimal('400'), cotizacion: new Prisma.Decimal('1') },
      ],
    })

    const credito = await prismaParaTenant(tenantId).pago.findFirst({
      where: { ventaId: id, medio: 'CREDITO' },
    })
    expect(credito!.recargo.toString()).toBe(recargoOriginal)
    expect(credito!.porcentaje!.toString()).not.toBe('99')
  })

  it('recalcula el caché Venta.recargo con el juego nuevo', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'CREDITO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1'), planId: planCreditoId }],
    })

    await reemplazarPagos({
      tenantId, ventaId: id, usuarioId,
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })

    const venta = await prismaParaTenant(tenantId).venta.findUnique({ where: { id } })
    expect(venta!.recargo.toString()).toBe('0')
    // La mercadería NO se movió.
    expect(venta!.total.toString()).toBe('1000')
  })

  it('dos correcciones seguidas encadenan: el antes de la segunda es lo que dejó la primera', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })
    const uno = { medio: 'TRANSFERENCIA' as const, moneda: 'ARS' as const, base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }
    const dos = { medio: 'DEBITO' as const, moneda: 'ARS' as const, base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }

    await reemplazarPagos({ tenantId, ventaId: id, usuarioId, pagos: [uno] })
    await reemplazarPagos({ tenantId, ventaId: id, usuarioId, pagos: [dos] })

    const ediciones = await prismaParaTenant(tenantId).edicionDeVenta.findMany({
      where: { ventaId: id },
      include: { pagos: true },
      orderBy: { creadoEn: 'asc' },
    })
    expect(ediciones).toHaveLength(2)
    expect(ediciones[0].pagos[0].medio).toBe('EFECTIVO')
    expect(ediciones[1].pagos[0].medio).toBe('TRANSFERENCIA')
  })

  it('no toca el stock ni el número de venta', async () => {
    const { id, numero } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: articuloDe1000, cantidad: new Prisma.Decimal('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })
    const stockAntes = (await prismaParaTenant(tenantId).articulo.findUnique({ where: { id: articuloDe1000 } }))!.stock.toString()
    const movimientosAntes = await prismaParaTenant(tenantId).movimientoStock.count({ where: { ventaId: id } })

    await reemplazarPagos({
      tenantId, ventaId: id, usuarioId,
      pagos: [{ medio: 'TRANSFERENCIA', moneda: 'ARS', base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1') }],
    })

    const venta = await prismaParaTenant(tenantId).venta.findUnique({ where: { id } })
    expect(venta!.numero).toBe(numero)
    expect((await prismaParaTenant(tenantId).articulo.findUnique({ where: { id: articuloDe1000 } }))!.stock.toString()).toBe(stockAntes)
    expect(await prismaParaTenant(tenantId).movimientoStock.count({ where: { ventaId: id } })).toBe(movimientosAntes)
  })
})
```

**Nota:** el caso del porcentaje deja el plan en 99 %; si el `beforeAll` comparte ese plan con otros casos, restaurarlo en un `afterEach` del `describe` o crear un plan propio para ese caso. Revisar cómo lo hace el archivo antes de asumir.

- [ ] **Step 2: Correr para verlos fallar**

Run: `npx vitest run test/ventas.test.ts -t "reemplazarPagos"`
Expected: FAIL — `Cannot find module '@/lib/ventas/editar'`.

- [ ] **Step 3: Generalizar el normalizador de texto libre**

Crear `lib/texto/libre.ts`:

```ts
/**
 * Deja un texto libre opcional listo para guardar.
 *
 * **Este módulo no importa nada, a propósito**: lo consumen archivos con
 * `'use client'`, y un import que llegue a `lib/db.ts` arrastraría `pg` al
 * bundle del navegador.
 *
 * **Vacío, sólo espacios y ausente son lo MISMO**: la ausencia del dato, o sea
 * `null`. Un `''` guardado sería una tercera respuesta que ninguna pantalla
 * sabe distinguir de las otras dos.
 *
 * **Y lo que pasa el tope se CORTA, no se rechaza.** Un cartel rojo por una
 * nota larga sería frenar una operación por lo único que no es plata. El
 * `maxLength` del control ya impide llegar acá desde la pantalla; este corte es
 * la red para un POST armado a mano.
 *
 * El segundo `trim()` es por el corte: puede caer justo sobre un espacio.
 *
 * **Los saltos de línea se normalizan a `\n` ANTES que nada más**, y es lo que
 * hace que dos escritores del mismo campo coincidan: un `FormData` normaliza
 * los saltos a CRLF y el argumento de un server action queda en LF. Sin este
 * paso el MISMO texto se guardaba distinto según qué pantalla lo escribió, y un
 * CRLF cerca del tope perdía un carácter de más contra lo que el `maxLength`
 * del cliente prometía.
 */
export function normalizarTextoLibre(
  texto: string | null | undefined,
  tope: number,
): string | null {
  if (texto === null || texto === undefined) return null
  const conSaltosNormalizados = texto.replace(/\r\n?/g, '\n')
  const limpio = conSaltosNormalizados.trim().slice(0, tope).trim()
  return limpio === '' ? null : limpio
}
```

En `lib/ventas/detalle.ts`, reemplazar el **cuerpo** de `normalizarDetalle` (dejando el docblock que ya tiene, más una línea que diga que la mecánica vive en `lib/texto/libre.ts`):

```ts
import { normalizarTextoLibre } from '@/lib/texto/libre'

export function normalizarDetalle(texto: string | null | undefined): string | null {
  return normalizarTextoLibre(texto, TOPE_DETALLE)
}
```

Crear `lib/ventas/correccion.ts`:

```ts
import { normalizarTextoLibre } from '@/lib/texto/libre'

/**
 * El tope de la nota de una corrección de pagos. Lo consumen el motor y el
 * `Textarea` del diálogo, así que vive UNA sola vez.
 *
 * 300 y no los 500 del detalle de venta: el detalle guarda un dato de entrega
 * (una dirección, un teléfono), y esto es una frase que explica por qué se
 * corrigió.
 */
export const TOPE_NOTA_DE_CORRECCION = 300

/** Deja la nota lista para guardar. La mecánica vive en `lib/texto/libre.ts`,
 *  compartida con el detalle de venta: es la misma regla con otro tope. */
export function normalizarNotaDeCorreccion(texto: string | null | undefined): string | null {
  return normalizarTextoLibre(texto, TOPE_NOTA_DE_CORRECCION)
}
```

- [ ] **Step 4: El código de error nuevo**

En `lib/ventas/errores.ts`, agregar a `CodigoErrorDeVenta`, junto a `VENTA_INEXISTENTE`:

```ts
  // Corregir cómo se pagó una venta ANULADA no tiene sentido: sus pagos ya no
  // cuentan en ningún reporte —toda consulta del período filtra
  // `anuladaEn: null`—, así que no hay plata que corregir. Separado de
  // VENTA_INEXISTENTE porque para quien mira la pantalla son dos situaciones
  // con salidas distintas, igual que ARTICULO_DESACTIVADO respecto de
  // ARTICULO_INEXISTENTE.
  | 'VENTA_ANULADA'
```

- [ ] **Step 5: Escribir `lib/ventas/editar.ts`**

```ts
import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'
import {
  normalizarPagos,
  resolverPagosConRecargo,
  exigirQueCierren,
  type PagoDeVenta,
} from './pagos'
import { normalizarNotaDeCorreccion } from './correccion'

/**
 * Corregir cómo se pagó una venta ya cobrada.
 *
 * **Reemplaza el juego ENTERO de pagos, no una fila.** El invariante de una
 * venta es del conjunto —los pagos cierran contra los dos totales de la
 * mercadería—, así que validar el conjunto es la regla que ya existe y validar
 * un campo aislado sería una regla nueva y más débil.
 *
 * **La mercadería no se toca**, y de ahí sale todo lo demás: los dos totales no
 * se mueven, así que la revalidación corre contra los números YA GUARDADOS y
 * no hay stock, unidades con IMEI, costos congelados ni número de venta que
 * tocar.
 *
 * **Sin idempotencia por clave**, al revés que el cobro: una corrección que
 * llega dos veces deja el mismo juego de pagos y una segunda fila de bitácora
 * con "antes" igual a "después". Eso es ruido en la bitácora, no plata
 * duplicada. El cobro necesita la clave por el lector de código de barras y el
 * F5 sobre el POST; un formulario que se abre a mano, no.
 */
export async function reemplazarPagos(entrada: {
  tenantId: string
  ventaId: string
  usuarioId: string
  pagos: PagoDeVenta[]
  nota?: string
}): Promise<void> {
  const { tenantId, ventaId, usuarioId, pagos, nota } = entrada

  // Fuera de la transacción, igual que en `crearVenta`: son invariantes de
  // dominio de cada fila y no necesitan la base. Todo lo que se pueda validar
  // antes de tomar un lock es tiempo que otra caja no pasa esperando.
  const normalizados = normalizarPagos(pagos)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      // El lock de la fila de la venta, ANTES de leer nada más.
      //
      // Bajo READ COMMITTED —el nivel por defecto, que `enTransaccionDeTenant`
      // no cambia— dos correcciones simultáneas leen las dos el mismo estado
      // anterior, archivan las dos la misma foto, y la segunda pisa a la
      // primera. La PLATA queda bien: el último juego de pagos es uno solo y
      // cierra. Lo que queda mal es la bitácora, que diría que se pasó de A a C
      // dos veces cuando se pasó de A a B y de B a C. Una bitácora que miente
      // es peor que no tenerla, y es la única razón por la que esta función
      // existe.
      //
      // Es el mismo recurso que `proximoNumero` usa para serializar las ventas
      // de un tenant, y el mismo motivo por el que `anularVenta` mete su
      // condición DENTRO del UPDATE en vez de en un `if` sobre un `findUnique`.
      //
      // `$queryRaw` acá SÍ ve las policies de RLS: `enTransaccionDeTenant` setea
      // `arandano.tenant_id` para toda la transacción, así que la advertencia
      // sobre raw queries de CLAUDE.md —que aplica a `prismaParaTenant`, cuya
      // extensión intercepta operaciones de MODELO— no vale adentro de acá.
      // `anularVenta` ya se apoya en lo mismo.
      const bloqueadas = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM ventas WHERE id = ${ventaId}::uuid FOR UPDATE
      `
      if (bloqueadas.length === 0) {
        throw new ErrorDeVenta(
          'VENTA_INEXISTENTE',
          `la venta ${ventaId} no existe en este tenant`,
        )
      }

      // Por el API de modelo y no por el raw de arriba: así los `Decimal`
      // llegan tipados y no hay que confiar en cómo Prisma mapea un `numeric`
      // crudo. El lock ya está tomado, así que esta lectura ve el estado final.
      const venta = await tx.venta.findUniqueOrThrow({
        where: { id: ventaId },
        select: { total: true, totalUsd: true, anuladaEn: true },
      })
      if (venta.anuladaEn !== null) {
        throw new ErrorDeVenta(
          'VENTA_ANULADA',
          'Esta venta está anulada: no hay nada que corregir sobre cómo se pagó.',
        )
      }

      // Antes de escribir la FK `usuario_id` de la edición: las FK de Postgres
      // no distinguen tenants. El porqué completo está en `pertenencia.ts`.
      await exigirUsuario(tx, usuarioId)

      const vivos = await tx.pago.findMany({
        where: { ventaId },
        orderBy: { creadoEn: 'asc' },
      })

      // El porcentaje que la venta YA tenía para cada plan. No hace falta
      // identidad por fila: dentro de una misma venta un plan tiene un solo
      // porcentaje, así que alcanza con mirar qué porcentaje tenía la venta
      // para ese plan. Un pago viejo con `porcentaje` NULL —cobrado antes de
      // que la columna existiera— no entra al mapa, así que cae al porcentaje
      // de hoy, que es lo que el diálogo avisa.
      const porcentajesPrevios = new Map(
        vivos.flatMap((p) =>
          p.planDePagoId !== null && p.porcentaje !== null
            ? ([[p.planDePagoId, p.porcentaje]] as [string, Prisma.Decimal][])
            : [],
        ),
      )

      const resueltos = await resolverPagosConRecargo(tx, normalizados, porcentajesPrevios)
      // Contra los totales YA GUARDADOS y no contra los ítems recalculados: la
      // mercadería no se toca, y recalcularla abriría la puerta a que una
      // corrección de pagos mueva el total sin que nadie lo haya pedido — si un
      // artículo cambió de precio desde la venta, el total recalculado daría
      // distinto del cobrado.
      exigirQueCierren(resueltos, { ars: venta.total, usd: venta.totalUsd })

      const edicion = await tx.edicionDeVenta.create({
        data: { tenantId, ventaId, usuarioId, nota: normalizarNotaDeCorreccion(nota) },
      })

      // Archivar ANTES de borrar, obviamente, y en la misma transacción: o se
      // mueven las dos mitades o no se mueve ninguna.
      if (vivos.length > 0) {
        await tx.pagoArchivado.createMany({
          data: vivos.map((p) => ({
            tenantId,
            edicionId: edicion.id,
            medio: p.medio,
            moneda: p.moneda,
            cubre: p.cubre,
            monto: p.monto,
            cotizacion: p.cotizacion,
            planDePagoId: p.planDePagoId,
            porcentaje: p.porcentaje,
            recargo: p.recargo,
            pagadoEn: p.creadoEn,
          })),
        })
      }

      await tx.pago.deleteMany({ where: { ventaId } })

      // Campo por campo y no con `...p`, igual que `crearVenta`: un spread
      // dejaría pasar cualquier propiedad de más que traiga un body JSON ya
      // parseado, y Prisma la rechaza con `PrismaClientValidationError` —un 500
      // sin `codigo`— en vez del `ErrorDeVenta` que esta función usa para todo.
      await tx.pago.createMany({
        data: resueltos.map((p) => ({
          tenantId,
          ventaId,
          medio: p.medio,
          moneda: p.moneda,
          cubre: p.cubre,
          monto: p.monto,
          cotizacion: p.cotizacion,
          planDePagoId: p.planId,
          porcentaje: p.porcentaje,
          recargo: p.recargo,
        })),
      })

      // El único caché que esta operación puede mover: `total`, `totalUsd`,
      // `costoArs` y `vendidoConCosto` describen la mercadería, que no se tocó.
      await tx.venta.update({
        where: { id: ventaId },
        data: {
          recargo: resueltos.reduce((acc, p) => acc.add(p.recargo), new Prisma.Decimal(0)),
        },
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run test/ventas.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/texto/libre.ts lib/ventas/correccion.ts lib/ventas/editar.ts lib/ventas/detalle.ts lib/ventas/errores.ts test/ventas.test.ts
git commit -m "feat(ventas): reemplazarPagos, el motor de la corrección

Reemplaza el juego entero de pagos revalidando contra los totales ya
guardados, con el lock de la fila de la venta para que la bitácora no mienta,
y archivando lo anterior antes de borrarlo. La mercadería no se toca."
```

---

### Task 6: La server action

**Files:**
- Modify: `app/(app)/ventas/acciones.ts`
- Modify: `app/(app)/ventas/[id]/page.tsx` (`datosDelDetalle` trae `porcentaje` y `planDePagoId` de cada pago, los planes vigentes del local, y las ediciones)
- Test: `app/(app)/ventas/acciones.test.ts` (crear si no existe)

**Interfaces:**
- Consumes: `reemplazarPagos` (Task 5), `exigirPermiso` de `lib/permisos/guarda.ts`.
- Produces:
  ```ts
  export type EstadoCorreccion = { error: string | null; aviso: string | null }
  export async function corregirPagos(entrada: {
    ventaId: string
    pagos: { medio: string; moneda: string; cubre: string; base: string; cotizacion: string; planId: string | null }[]
    nota: string
  }): Promise<EstadoCorreccion>
  ```
  Los importes llegan como **string** y los convierte el servidor con `new Prisma.Decimal(...)`: un `number` de JS no representa la plata sin perder centavos, y es el mismo criterio que ya usa el cobro.

- [ ] **Step 1: Escribir el test que falla**

```ts
const VENTA = '01920000-0000-7000-8000-000000000001'
const UN_PAGO = [
  { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: '1000', cotizacion: '1', planId: null },
]

it('corregirPagos: sin VENTAS_EDITAR no llega al motor', async () => {
  sesionMock.mockResolvedValue({
    tenant: { id: TENANT },
    usuario: { id: USUARIO, rol: 'EMPLEADO' },
  })
  permisosMock.mockResolvedValue(new Set())

  // `exigirPermiso` llama a `forbidden()` de next/navigation, que tira.
  await expect(corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '' })).rejects.toThrow()
  expect(reemplazarPagosMock).not.toHaveBeenCalled()
})

it('corregirPagos: con VENTAS_EDITAR llega al motor con los importes como Decimal', async () => {
  permisosMock.mockResolvedValue(new Set(['VENTAS_EDITAR']))

  const r = await corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '  era transferencia ' })

  expect(r.error).toBeNull()
  const arg = reemplazarPagosMock.mock.calls[0][0]
  expect(arg.pagos[0].base.toString()).toBe('1000')
  expect(arg.pagos[0].planId).toBeUndefined()
  expect(arg.nota).toBe('  era transferencia ')
})

it('corregirPagos: traduce un ErrorDeVenta a un aviso y no a un 500', async () => {
  permisosMock.mockResolvedValue(new Set(['VENTAS_EDITAR']))
  reemplazarPagosMock.mockRejectedValueOnce(
    new ErrorDeVenta('PAGOS_NO_CIERRAN', 'los pagos en pesos suman 900 y el total en pesos es 1000'),
  )

  const r = await corregirPagos({ ventaId: VENTA, pagos: UN_PAGO, nota: '' })

  expect(r.error).toContain('los pagos en pesos suman 900')
  expect(r.aviso).toBeNull()
})

it('corregirPagos: un ventaId mal formado no llega a Prisma', async () => {
  permisosMock.mockResolvedValue(new Set(['VENTAS_EDITAR']))

  const r = await corregirPagos({ ventaId: 'no-es-uuid', pagos: UN_PAGO, nota: '' })

  expect(r.error).toBe('Esa venta no existe.')
  expect(reemplazarPagosMock).not.toHaveBeenCalled()
})

it('corregirPagos: un importe que no es un número sale como aviso, no como 500', async () => {
  permisosMock.mockResolvedValue(new Set(['VENTAS_EDITAR']))

  const r = await corregirPagos({
    ventaId: VENTA,
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: 'mil', cotizacion: '1', planId: null }],
    nota: '',
  })

  expect(r.error).not.toBeNull()
  expect(reemplazarPagosMock).not.toHaveBeenCalled()
})
```

`TENANT` y `USUARIO` son dos uuid cualesquiera declarados arriba del archivo;
`sesionMock`, `permisosMock` y `reemplazarPagosMock` son los `vi.mock` de
`@/lib/auth/sesion`, `@/lib/permisos/consultar` y `@/lib/ventas/editar`.

**Nota:** mirar primero cómo `app/(app)/vender/acciones.test.ts` mockea la sesión y el motor, y copiar ese patrón — no inventar uno nuevo.

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run "app/(app)/ventas/acciones.test.ts"`
Expected: FAIL — `corregirPagos` no existe.

- [ ] **Step 3: Implementar la action**

En `app/(app)/ventas/acciones.ts`:

```ts
export type EstadoCorreccion = { error: string | null; aviso: string | null }

/**
 * Corregir cómo se pagó una venta.
 *
 * **Detrás de `VENTAS_EDITAR`, y el guard va acá y no sólo en la pantalla**:
 * una action se invoca sin pasar por ningún componente, y esto mueve plata ya
 * cobrada. Es la misma lección de las dos copias de un botón que dejó escrita
 * el merge del ciclo móvil.
 *
 * **Los importes llegan como string.** Un `number` de JS no representa la plata
 * sin perder centavos; el servidor los convierte a `Decimal` y el motor valida
 * la escala. Mismo criterio que el cobro.
 */
export async function corregirPagos(entrada: {
  ventaId: string
  pagos: {
    medio: string
    moneda: string
    cubre: string
    base: string
    cotizacion: string
    planId: string | null
  }[]
  nota: string
}): Promise<EstadoCorreccion> {
  const sesion = await exigirPermiso('VENTAS_EDITAR')
  const { ventaId, pagos, nota } = entrada
  if (!esUuid(ventaId)) return { error: NO_EXISTE, aviso: null }

  try {
    await reemplazarPagos({
      tenantId: sesion.tenant.id,
      ventaId,
      usuarioId: sesion.usuario.id,
      nota,
      pagos: pagos.map((p) => ({
        medio: p.medio as MedioPago,
        moneda: p.moneda as Moneda,
        cubre: p.cubre as Moneda,
        base: new Prisma.Decimal(p.base),
        cotizacion: new Prisma.Decimal(p.cotizacion),
        planId: p.planId ?? undefined,
      })),
    })
  } catch (e) {
    if (e instanceof ErrorDeVenta) return { error: e.message, aviso: null }
    // Un importe que no es un número tira `PrismaClientInitializationError`
    // desde el constructor de Decimal: sale como aviso y no como 500, igual que
    // el resto de lo que puede llegar mal de afuera.
    if (e instanceof Error && e.name === 'Error' && /Decimal/.test(e.message)) {
      return { error: 'Revisá los importes: hay uno que no es un número.', aviso: null }
    }
    throw e
  }

  revalidatePath('/ventas')
  revalidatePath(`/ventas/${ventaId}`)
  return { error: null, aviso: 'Listo: se corrigió cómo se pagó esta venta.' }
}
```

**Los casts a `MedioPago`/`Moneda` no validan nada por sí solos** — Prisma rechaza un valor fuera del enum con un error que hay que dejar caer como aviso, igual que el de `Decimal`. Si el test del Step 1 muestra que sale como 500, agregar la traducción acá y un caso que la fije.

- [ ] **Step 4: Ampliar `datosDelDetalle`**

En `app/(app)/ventas/[id]/page.tsx`, dentro del `select` de `pagos`, agregar:

```ts
          // Para precargar el diálogo de corrección: el id del plan (el
          // `plan: { nombre, cuotas }` de al lado es para mostrar) y el
          // porcentaje congelado, que es lo que decide si el diálogo avisa que
          // ese pago se va a recalcular con el porcentaje de hoy.
          planDePagoId: true,
          porcentaje: true,
```

Y al nivel de la venta:

```ts
      // La bitácora de correcciones. Va en la misma consulta que el resto: es
      // una sola pantalla y ya trae siete cosas.
      ediciones: {
        select: {
          id: true, nota: true, creadoEn: true,
          usuario: { select: { nombre: true } },
          pagos: {
            select: {
              id: true, medio: true, moneda: true, cubre: true,
              monto: true, cotizacion: true, recargo: true,
              plan: { select: { nombre: true, cuotas: true } },
            },
          },
        },
        orderBy: { creadoEn: 'desc' },
      },
```

Los planes vigentes del local (para el selector del diálogo) se traen aparte, con la misma consulta que ya usa `/vender` — buscarla ahí y reusarla, no escribir una nueva.

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run "app/(app)/ventas" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/ventas/acciones.ts" "app/(app)/ventas/acciones.test.ts" "app/(app)/ventas/[id]/page.tsx"
git commit -m "feat(ventas): la server action corregirPagos, detrás de VENTAS_EDITAR

El guard va en la action y no sólo en la pantalla: una action se invoca sin
pasar por ningún componente, y esto mueve plata ya cobrada."
```

---

### Task 7: El diálogo de corrección

**Files:**
- Create: `app/(app)/ventas/corregir-pagos.tsx` (`'use client'`)
- Modify: `app/(app)/ventas/[id]/page.tsx` (el botón en el encabezado de "Cómo se pagó" y el permiso)
- Test: `app/(app)/ventas/corregir-pagos.test.tsx`, `test/permisos-en-las-dos-copias.test.ts`

**Interfaces:**
- Consumes: `corregirPagos` (Task 6); `lib/ventas/centavos.ts` (`dineroEnCentavos`, `cotizacionEnDiezMilesimas`, `totalesDePagosEnCentavos`, `deCentavos`, y el tipo `FilaDePagoCentavos`, **al que hay que agregarle `export`** — hoy es local a ese módulo, y es un `export` de tipo puro que no cambia nada en runtime); `TOPE_NOTA_DE_CORRECCION` de `lib/ventas/correccion.ts`; `Dialog`, `Select`, `Input`, `Textarea`, `Button` de `components/ui/`.
- Produces: `export function CorregirPagos({ ventaId, totalArs, totalUsd, pagos, planes, hayPagoSinPorcentaje }: Props)`.

- [ ] **Step 1: Escribir el test que falla**

Los tests de componentes de este repo usan `renderToStaticMarkup` y **no**
jsdom (ver `app/(app)/ventas/grafico.test.tsx`): no hay forma de simular
clicks. Por eso el diálogo **exporta las tres decisiones que importan como
funciones puras**, y los casos van contra ellas. No es una concesión al
entorno de test: es lo que hace que la regla de plata sea verificable sin
abrir un navegador, que es exactamente lo que este repo viene señalando como
su punto ciego.

```ts
import { faltanteEnCentavos, textoDelChip, hayDosTotales } from './corregir-pagos'

// Los nombres de campo son los de `FilaDePagoCentavos` en
// `lib/ventas/centavos.ts` —`baseCentavos` y `cotizacionDiezMilesimas`, no
// `base` y `cotizacion`—: el tipo lleva la unidad en el nombre a propósito,
// para que no se pueda pasar pesos donde van centavos.
const EN_PESOS = (base: string) => ({
  moneda: 'ARS' as const,
  cubre: 'ARS' as const,
  baseCentavos: dineroEnCentavos(base),
  cotizacionDiezMilesimas: cotizacionEnDiezMilesimas('1'),
})

it('faltanteEnCentavos: dice cuánto falta cuando el juego no cierra', () => {
  expect(faltanteEnCentavos([EN_PESOS('900')], { ars: 100000, usd: 0 })).toEqual({
    ars: 10000,
    usd: 0,
  })
})

it('faltanteEnCentavos: da cero en las dos monedas cuando cierra', () => {
  expect(faltanteEnCentavos([EN_PESOS('1000')], { ars: 100000, usd: 0 })).toEqual({
    ars: 0,
    usd: 0,
  })
})

it('faltanteEnCentavos: en negativo cuando sobra', () => {
  expect(faltanteEnCentavos([EN_PESOS('1100')], { ars: 100000, usd: 0 })).toEqual({
    ars: -10000,
    usd: 0,
  })
})

it('faltanteEnCentavos: las dos monedas se miden por separado y no se compensan', () => {
  // Cierra en pesos y falta en dólares: NO cierra.
  const filas = [
    EN_PESOS('1000'),
    {
      moneda: 'USD' as const,
      cubre: 'USD' as const,
      baseCentavos: dineroEnCentavos('50'),
      cotizacionDiezMilesimas: cotizacionEnDiezMilesimas('1000'),
    },
  ]
  expect(faltanteEnCentavos(filas, { ars: 100000, usd: 30000 })).toEqual({
    ars: 0,
    usd: 25000,
  })
})

it('textoDelChip: null cuando cierra, que es lo que habilita guardar', () => {
  expect(textoDelChip({ ars: 0, usd: 0 })).toBeNull()
})

it('textoDelChip: distingue faltar de sobrar', () => {
  expect(textoDelChip({ ars: 10000, usd: 0 })).toContain('Faltan')
  expect(textoDelChip({ ars: -10000, usd: 0 })).toContain('Sobran')
})

it('hayDosTotales: sólo cuando la venta tiene mercadería en las dos monedas', () => {
  expect(hayDosTotales({ ars: 100000, usd: 0 })).toBe(false)
  expect(hayDosTotales({ ars: 0, usd: 30000 })).toBe(false)
  expect(hayDosTotales({ ars: 100000, usd: 30000 })).toBe(true)
})
```

Y dos casos de render, que sí se pueden hacer con `renderToStaticMarkup`
sobre el estado inicial del componente:

```tsx
it('avisa cuando un pago se cobró antes de que se guardara el porcentaje', () => {
  const html = renderToStaticMarkup(
    createElement(CorregirPagos, { ...props, hayPagoSinPorcentaje: true }),
  )
  expect(html).toContain('se recalcula con el porcentaje de hoy')
})

it('no dice nada de porcentajes cuando todos los pagos lo tienen', () => {
  const html = renderToStaticMarkup(
    createElement(CorregirPagos, { ...props, hayPagoSinPorcentaje: false }),
  )
  expect(html).not.toContain('porcentaje de hoy')
})
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run "app/(app)/ventas/corregir-pagos.test.tsx"`
Expected: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar el diálogo**

Estructura, con el detalle de estilo copiado de los diálogos que ya existen (`app/(app)/usuarios/` y `app/(app)/formas-de-pago/`):

- `Dialog` disparado por un `Button` "Corregir".
- Estado local: un array de filas `{ medio, moneda, cubre, base, cotizacion, planId }`, inicializado desde los pagos que llegan por props.
- Por fila: `Select` de medio, `Select` de plan (**sólo si ese medio tiene planes cargados**), `Select` de moneda, `Select` de `Cubre` (**sólo si `totalUsd > 0`**, misma regla que `seMuestraCubre` ya aplica en la pantalla), `Input` de monto, `Input` de cotización (**sólo si hay dólares de por medio**), y un botón de quitar la fila.
- Un botón "Agregar pago".
- Un `Textarea` para la nota, con `maxLength={TOPE_NOTA_DE_CORRECCION}`.
- El chip de faltante, calculado con `centavos.ts`:

```ts
/** Lo que falta (positivo) o sobra (negativo) en cada moneda, en centavos.
 *  Sale del MISMO espejo en enteros que usa /vender, así que el diálogo no
 *  puede decir que cierra mientras el servidor dice que no. */
export function faltanteEnCentavos(
  filas: FilaDePagoCentavos[],
  totales: TotalesEnCentavos,
): TotalesEnCentavos {
  const cubierto = totalesDePagosEnCentavos(filas)
  return { ars: totales.ars - cubierto.ars, usd: totales.usd - cubierto.usd }
}
```

- El guardar deshabilitado mientras `faltanteEnCentavos` no dé `{ ars: 0, usd: 0 }`.
- La leyenda cuando `hayPagoSinPorcentaje`: *"Uno de estos pagos se cobró antes de que se guardara el porcentaje del plan. Al corregir, se recalcula con el porcentaje de hoy."*
- Al guardar: llamar a `corregirPagos` y lanzar el toast con `sonner` **en el mismo handler**, con el resultado en la mano — nunca desde un `useEffect` sobre `useActionState`, que es lo que hizo desaparecer los toasts del ABM de categorías. Error: `duration: Infinity`. Éxito: duración por default.

**Mobile-first**: cada fila apila sus controles sin prefijo y pasa a fila con `lg:`. Sin `sm:` ni `md:`.

- [ ] **Step 4: El botón en la pantalla, con el permiso**

En `app/(app)/ventas/[id]/page.tsx`:

```ts
const puedeEditarVenta = await puedeConSesion(sesion, 'VENTAS_EDITAR')
```

y en el llamador, la misma forma que `seOfreceAnular`:

```ts
/** El botón de corregir: hace falta el permiso Y que la venta siga cobrada.
 *  Una venta anulada no tiene nada que corregir sobre cómo se pagó — el motor
 *  la rechaza con VENTA_ANULADA, y ofrecer un botón que siempre falla es peor
 *  que no ofrecerlo. */
export function seOfreceCorregir(puedeEditar: boolean, anuladaEn: Date | null): boolean {
  return puedeEditar && anuladaEn === null
}
```

`hayPagoSinPorcentaje` lo deriva la página del select que la Task 6 amplió:
`datos.pagos.some((p) => p.planDePagoId !== null && p.porcentaje === null)` —
un pago **sin** plan no tiene porcentaje que recuperar, así que no cuenta.

El `<CorregirPagos />` va en el `<div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">` del encabezado de "Cómo se pagó", que pasa a ser un flex con el `<h2>` a la izquierda y el botón a la derecha. **Una sola copia sirve a los dos anchos** —ese encabezado se renderiza igual en teléfono y en escritorio, a diferencia de `<Encabezado>`, que envuelve sus `acciones` en `hidden lg:flex`—; confirmarlo mirando el JSX antes de dar el paso por terminado.

- [ ] **Step 5: Fijar el permiso en las dos direcciones**

En `test/permisos-en-las-dos-copias.test.ts`, con el patrón que el archivo ya usa para `/inventario`:

```ts
it('«Corregir» aparece con VENTAS_EDITAR y no aparece sin él', () => {
  // Renderizar Detalle con ofreceCorregir en true y contar 1 aparición;
  // en false, contar 0. Las DOS direcciones: un not.toContain solo pasaría
  // igual si la guarda quedara en una sola copia.
})
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run "app/(app)/ventas" test/permisos-en-las-dos-copias.test.ts test/responsive.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS. `responsive.test.ts` marca cualquier ancho fijo mayor a 362 sin `lg:`.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/ventas/corregir-pagos.tsx" "app/(app)/ventas/corregir-pagos.test.tsx" "app/(app)/ventas/[id]/page.tsx" test/permisos-en-las-dos-copias.test.ts
git commit -m "feat(ventas): el diálogo para corregir cómo se pagó una venta

El chip de faltante sale del mismo espejo en centavos que usa /vender, así
que el diálogo no puede decir que cierra mientras el servidor dice que no."
```

---

### Task 8: La card "Correcciones"

**Files:**
- Modify: `app/(app)/ventas/[id]/page.tsx`
- Test: `app/(app)/ventas/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `datos.ediciones` (Task 6), `metaDePago` y `rotuloDePlan`, que ya existen en ese archivo.

- [ ] **Step 1: Escribir el test que falla**

```tsx
it('no dibuja la card Correcciones cuando la venta nunca se corrigió', () => {
  const html = renderToStaticMarkup(createElement(Detalle, { ...props, ediciones: [] }))
  expect(html).not.toContain('Correcciones')
})

it('dibuja quién, cuándo y cómo estaban los pagos antes', () => {
  const html = renderToStaticMarkup(
    createElement(Detalle, {
      ...props,
      ediciones: [
        {
          id: 'e1',
          nota: 'era transferencia',
          creadoEn: new Date('2026-09-14T12:00:00Z'),
          usuario: { nombre: 'Flor' },
          pagos: [{ id: 'p1', medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', monto: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1'), recargo: new Prisma.Decimal('0'), plan: null }],
        },
      ],
    }),
  )
  expect(html).toContain('Flor')
  expect(html).toContain('era transferencia')
  expect(html).toContain('Efectivo')
})
```

- [ ] **Step 2: Correr para verlo fallar**

Run: `npx vitest run "app/(app)/ventas/[id]/page.test.tsx"`
Expected: FAIL — `Detalle` no acepta `ediciones`.

- [ ] **Step 3: Implementar la card**

Entre Detalles y la Zona de riesgo, en las **dos** disposiciones (la de teléfono, que es un orden lineal, y la de escritorio, que reparte en dos columnas — mirar el comentario del componente, que documenta los dos órdenes, y sumar la card en los dos sin romper la numeración de `order-*`).

```tsx
{/* Correcciones: la bitácora de cómo se pagó esta venta. SÓLO se dibuja si
    hubo alguna — a diferencia de Detalles, que se dibuja vacía porque es el
    lugar donde el dato se carga. Acá no hay nada que cargar, así que un local
    que nunca corrigió una venta no ve nada nuevo. */}
{ediciones.length > 0 && (
  <div className="...">
    <h2 className={`${estilos.tituloDeCard} text-foreground`}>Correcciones</h2>
    {ediciones.map((e) => (
      <div key={e.id}>
        <p>
          {e.usuario.nombre} corrigió los pagos el {formatearFecha(e.creadoEn)} a las{' '}
          {formatearHora(e.creadoEn)}
        </p>
        {e.nota !== null && <p className="text-muted-foreground">{e.nota}</p>}
        <ul>
          {e.pagos.map((p) => (
            <li key={p.id}>
              {ROTULO_MEDIO[p.medio]}
              {rotuloDePlan(p.plan) !== null && ` · ${rotuloDePlan(p.plan)}`}
              {' · '}
              {precioEnSuMoneda(p.monto.toString(), p.moneda)}
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
)}
```

Cada entrada dice, en una línea: *"Flor corrigió los pagos el 14/9 a las
12:00"*, la nota debajo si existe, y la lista de cómo estaban los pagos antes.

Las funciones de formato ya existen y **no hay que escribir ninguna nueva**:
`formatearFecha`, `formatearHora` y `precioEnSuMoneda` de
`lib/formato/mostrar.ts`, `ROTULO_MEDIO` de `lib/ventas/medios.ts`, y
`rotuloDePlan`, que ya vive en `app/(app)/ventas/[id]/page.tsx` y hoy alimenta
la columna "Plan" de la tabla de pagos. Que la bitácora use exactamente las
mismas es lo que hace que un pago archivado se lea igual que uno vivo.

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run "app/(app)/ventas" && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ventas/[id]/page.tsx" "app/(app)/ventas/[id]/page.test.tsx"
git commit -m "feat(ventas): la card Correcciones, con la bitácora de cada venta

Sólo se dibuja si hubo alguna: un local que nunca corrigió una venta no ve
ninguna diferencia."
```

---

### Task 9: Documentación y cierre

**Files:**
- Modify: `docs/pantallas.md` (sección `/ventas/[id]`)
- Modify: `docs/correcciones-pendientes-del-pen.md`
- Modify: `CLAUDE.md` (una entrada en *Próximos pasos técnicos*, con el mismo formato tachado de las anteriores)

- [ ] **Step 1: `docs/pantallas.md`**

En la sección `/ventas/[id]`, agregar el diálogo de corrección y la card "Correcciones": qué hacen, qué permiso piden, y las dos decisiones que no son obvias mirando la pantalla — que la card sólo aparece si hubo correcciones, y que una venta anulada no ofrece corregir.

`test/pantallas.test.ts` ata la existencia de la sección, no su contenido: la sección va en el mismo commit que la pantalla, que es la regla escrita.

- [ ] **Step 2: `docs/correcciones-pendientes-del-pen.md`**

Entrada nueva: `design/arandano.pen` no dibuja el botón "Corregir", ni el diálogo, ni la card "Correcciones", en ningún ancho. Se derivaron del `Dialog` de `/usuarios` y `/formas-de-pago`, de las filas de pago del panel de cobro, y de la línea de tiempo de la bitácora de una orden de trabajo.

- [ ] **Step 3: `CLAUDE.md`**

Entrada tachada en *Próximos pasos técnicos*, siguiendo el formato de las anteriores: el origen textual del pedido, el alcance y por qué se corta ahí, las decisiones con su alternativa descartada, `Pago.porcentaje` y por qué hizo falta, la deuda del JSX duplicado con su disparador, lo que el ciclo NO hace, y la verificación manual pendiente.

**Y un párrafo que no se puede omitir**: que `VENTAS_EDITAR` es el permiso que más fácil se pliega sobre `VENTAS_ANULAR` en un refactor futuro, y por qué no hay que hacerlo.

- [ ] **Step 4: El gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS todo. El `build` no es opcional: hay una clase de error —un Server Component invocando una función de un módulo `'use client'`, o pasándole una función como prop— que ni los tests ni `tsc` ven.

- [ ] **Step 5: Commit**

```bash
git add docs/pantallas.md docs/correcciones-pendientes-del-pen.md CLAUDE.md
git commit -m "docs(editar-venta): pantallas, deuda del pen y la entrada del ciclo"
```

---

## Verificación manual (después del merge)

`arandano-dev` bind-montea `/root/arandano`, que sirve `main`, así que esto se puede hacer en cuanto la rama se mergee. Ningún test contesta nada de esto:

1. Cobrar una venta en efectivo, corregirla a transferencia, y ver que el panel "Cómo entró la plata" de `/ventas` cambia de barra.
2. Partir un pago único en dos (mitad efectivo, mitad transferencia) y ver que el chip sólo deja guardar cuando cierra.
3. Corregir una venta con los dos totales, moviendo qué pago cubre cuál.
4. **El riesgo de plata**: que el chip de faltante diga lo mismo que el servidor con un plan de **efectivo en descuento** (porcentaje negativo). Es exactamente donde este repo ya tuvo un bug de plata.
5. Cobrar con un plan, cambiarle el porcentaje al plan desde `/formas-de-pago`, volver a esa venta y corregir el **otro** pago: el recargo del pago con plan tiene que quedar igual que antes.
6. **El riesgo de presentación**: el diálogo con tres filas de pago a 390 px.
7. Que un empleado con `VENTAS_ANULAR` y sin `VENTAS_EDITAR` vea "Anular" y no vea "Corregir", y que tipear la URL no le alcance para nada.
8. Que una venta anulada no ofrezca corregir.
