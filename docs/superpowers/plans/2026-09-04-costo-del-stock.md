# El costo del stock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrarle al dueño cuánta plata tiene parada en mercadería — por artículo en `/inventario/[id]` y del local entero en `/dashboard`.

**Architecture:** Una definición sola (`max(stock, 0) × último costo conocido`), en un módulo nuevo `lib/inventario/valuacion.ts` que separa la cuenta pura de la consulta. Las dos pantallas suman un tile detrás del permiso `COSTOS`. Sin migración, sin columna y sin permiso nuevo: el número se deriva de lo que ya está guardado.

**Tech Stack:** Next.js App Router (Server Components), Prisma sobre PostgreSQL con RLS por tenant, `Prisma.Decimal` para toda la plata, Vitest (`environment: 'node'`, una única base efímera compartida, `fileParallelism: false`), `renderToStaticMarkup` de `react-dom/server` para los tests de render.

**Spec:** `docs/superpowers/specs/2026-09-04-costo-del-stock-design.md`

## Global Constraints

Copiadas del spec. Todas las tasks las heredan.

- **La definición es una sola**: `costoTotal = max(stock, 0) × últimoCostoConocido`, donde `últimoCostoConocido` es el `MovimientoStock` con `motivo: 'INGRESO'` y `costoUnitario: { not: null }` más reciente, ordenado `[{ creadoEn: 'desc' }, { id: 'desc' }]`. El desempate por `id` NO es opcional: dos ingresos de la misma transacción comparten `creadoEn` hasta el milisegundo.
- **El clamp del negativo y el `null` sin costo viven en UNA sola función pura**, `costoTotalDeArticulo`. Ninguna pantalla reimplementa ninguna de las dos reglas.
- **Sin costo cargado → `null`, nunca cero.** El cero está reservado para "no hay mercadería" (stock cero o negativo), que es una afirmación distinta y verdadera.
- **`sinCosto` cuenta artículos, no movimientos**, y sólo los que tienen mercadería: entra al conteo el artículo cuyo stock es mayor a cero y no tiene ningún costo.
- **Entran sólo `tipo: 'PRODUCTO'` con `desactivadoEn: null`.** Los artículos con precio en dólares entran igual: `costoUnitario` está en pesos para todos.
- **Nunca `$queryRaw`.** La extensión de `lib/tenant/prisma.ts` intercepta operaciones de modelo, no raw queries; un raw sin el `set_config` de RLS devuelve cero filas **en silencio**.
- **Todo lo que consulta va exportado**, nunca inline en un Server Component `async`: un componente que abre sesión no lo puede llamar ningún test, y `desactivadoEn: null` quedaría sin cobertura.
- **Los dos tiles van detrás del permiso `COSTOS`.** `lib/permisos/catalogo.ts` no crece.
- **Sin migración.** No se toca `prisma/schema.prisma`.
- **El rótulo del dashboard es `COSTO DEL STOCK`** y el de la ficha `COSTO TOTAL`, literales.
- **Cada cambio de pantalla lleva su sección de `docs/pantallas.md` en el MISMO commit.** Es la regla de ese archivo.
- Los comandos del gate son `npx vitest run <archivo>` para un archivo suelto, `npm test` para todo, `npx tsc --noEmit` y `npm run lint`.

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `lib/inventario/valuacion.ts` (crear) | La definición: la cuenta pura (`costoTotalDeArticulo`) y la consulta del catálogo entero (`valuacionDelTenant`). Nada de presentación. |
| `lib/inventario/valuacion.test.ts` (crear) | La cuenta pura, sin base de datos. |
| `test/valuacion.test.ts` (crear) | `valuacionDelTenant` contra la base efímera, con su **propio tenant**: la función suma todo el catálogo, así que compartir el tenant de `test/inventario.test.ts` la haría depender de lo que escribió cualquier otro caso. |
| `app/(app)/inventario/[id]/page.tsx` (modificar) | El cuarto tile de la ficha y el quiebre a 2×2 en el teléfono. |
| `app/(app)/inventario/[id]/page.test.tsx` (modificar) | El tile de la ficha, por FUENTE y por render. |
| `app/(app)/dashboard/page.tsx` (modificar) | El quinto tile y su consulta. |
| `app/(app)/dashboard/page.test.tsx` (modificar) | El tile del dashboard, por FUENTE y por render. |
| `docs/pantallas.md` (modificar) | Secciones `/inventario/[id]` (línea ~1280) y `/dashboard` (línea ~2292). |
| `docs/correcciones-pendientes-del-pen.md` (modificar) | Entrada 33: los dos tiles no los dibuja la maqueta, y le cambian la cuenta de tiles a dos filas que sí dibuja. |
| `CLAUDE.md` (modificar) | La entrada del ciclo en *Próximos pasos técnicos*. |

---

### Task 1: la cuenta pura

**Files:**
- Create: `lib/inventario/valuacion.ts`
- Test: `lib/inventario/valuacion.test.ts`

**Interfaces:**
- Consumes: `redondearDinero(v: Decimal): Decimal` de `@/lib/ventas/totales` (redondea a 2 decimales con `ROUND_HALF_UP`).
- Produces: `costoTotalDeArticulo(stock: Prisma.Decimal, costo: Prisma.Decimal | null): Prisma.Decimal | null` — la usan la Task 2 (para sumar) y la Task 3 (para el tile de la ficha).

- [ ] **Step 1: Write the failing test**

Crear `lib/inventario/valuacion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { costoTotalDeArticulo } from './valuacion'

const d = (v: string) => new Prisma.Decimal(v)

describe('costoTotalDeArticulo', () => {
  it('multiplica el stock por el último costo conocido', () => {
    expect(costoTotalDeArticulo(d('30'), d('7400'))?.toString()).toBe('222000')
  })

  // La diferencia entre "no se sabe" y "no vale nada". Un cero acá afirmaría
  // que la mercadería no vale plata, que es otra cosa — mismo criterio que
  // `textoDeMargen` y `margenDe`, que devuelven null en vez de 0 %.
  it('sin costo cargado no hay número, y no es cero', () => {
    expect(costoTotalDeArticulo(d('30'), null)).toBeNull()
  })

  // Vender sin stock no está frenado (lib/ventas/crear.ts), así que el stock
  // puede quedar negativo. Eso es un error de carga, no mercadería que valga
  // plata negativa: restarla del total del local lo achicaría sin que nadie
  // sepa por qué.
  it('un stock negativo cuenta como cero, no resta', () => {
    expect(costoTotalDeArticulo(d('-2'), d('7400'))?.toString()).toBe('0')
  })

  // El otro lado del clamp: acá SÍ se sabe el costo y SÍ se puede afirmar el
  // número, y el número es cero. El tile se dibuja diciendo $ 0,00, coherente
  // con el "En stock: 0" de al lado.
  it('stock cero con costo cargado es cero, no null', () => {
    expect(costoTotalDeArticulo(d('0'), d('7400'))?.toString()).toBe('0')
  })

  // `stock` es Decimal(12,3) y `costoUnitario` Decimal(12,2), así que el
  // producto puede tener cinco decimales: 1,5 × 333,33 = 499,995. La plata se
  // muestra con dos, y el redondeo tiene que ser el mismo que usa el resto del
  // motor (redondearDinero, ROUND_HALF_UP).
  it('redondea a dos decimales con el mismo criterio que el resto de la plata', () => {
    expect(costoTotalDeArticulo(d('1.5'), d('333.33'))?.toString()).toBe('500')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/inventario/valuacion.test.ts`
Expected: FAIL — no existe `lib/inventario/valuacion.ts` (error de resolución del import).

- [ ] **Step 3: Write minimal implementation**

Crear `lib/inventario/valuacion.ts`:

```ts
import { Prisma } from '@/generated/prisma/client'
import { redondearDinero } from '@/lib/ventas/totales'

type Decimal = Prisma.Decimal

const CERO = new Prisma.Decimal(0)

/**
 * Cuánto costó la mercadería que queda de un artículo.
 *
 * `null` y CERO son dos respuestas distintas, y la diferencia es todo el
 * diseño de esta función:
 *
 * - `null` es **no se sabe**: ningún ingreso de este artículo cargó costo. El
 *   tile no se dibuja y el total del local no lo suma (pero sí lo cuenta como
 *   faltante, ver `valuacionDelTenant`). Mismo criterio que `textoDeMargen`
 *   en app/(app)/inventario/[id]/page.tsx y `margenDe` en
 *   lib/dashboard/metricas.ts: sin con qué calcular, no se inventa un número.
 * - CERO es **no hay mercadería**: stock en cero, o negativo. Con costo
 *   cargado se puede afirmar que lo que queda no vale nada, y es verdad.
 *
 * El clamp del negativo vive acá y en ningún otro lado. Vender sin stock no
 * está frenado (`lib/ventas/crear.ts`: "el stock puede quedar negativo y eso
 * no frena"), así que un artículo puede decir −2 — y eso es un error de carga
 * que `/inventario` ya avisa por su cuenta, no plata negativa que haya que
 * restarle al total del local.
 *
 * `costo` va siempre en PESOS, sea cual sea `Articulo.moneda`:
 * `MovimientoStock.costoUnitario` no distingue moneda (deuda del costo,
 * CLAUDE.md). Por eso esta función no recibe la moneda y no podría depender
 * de ella aunque quisiera — a diferencia del margen, que compara el costo
 * CONTRA EL PRECIO y por eso sí tiene que devolver null en dólares. Acá el
 * costo se multiplica por una cantidad, y una cantidad no tiene moneda.
 */
export function costoTotalDeArticulo(stock: Decimal, costo: Decimal | null): Decimal | null {
  if (costo === null) return null
  if (stock.lessThanOrEqualTo(0)) return CERO
  return redondearDinero(stock.mul(costo))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/inventario/valuacion.test.ts`
Expected: PASS, 5 casos.

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/valuacion.ts lib/inventario/valuacion.test.ts
git commit -m "feat(costo): la cuenta del costo del stock, en una sola función

max(stock, 0) por el último costo conocido. \`null\` es \"no se sabe\" y cero
es \"no hay mercadería\": son dos respuestas distintas y la diferencia es
todo el diseño de la función.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FPECywkhXCVD9hc2pkQNAf"
```

---

### Task 2: la valuación del catálogo entero

**Files:**
- Modify: `lib/inventario/valuacion.ts` (agregar `valuacionDelTenant` al final)
- Test: `test/valuacion.test.ts` (crear)

**Interfaces:**
- Consumes: `costoTotalDeArticulo` de la Task 1; `prismaParaTenant` de `@/lib/tenant/prisma` (sólo como **tipo**).
- Produces: `type Valuacion = { total: Prisma.Decimal; sinCosto: number }` y `valuacionDelTenant(prisma: ReturnType<typeof prismaParaTenant>): Promise<Valuacion>` — la Task 4 la llama desde el dashboard.

**Por qué el test va en un archivo nuevo y no en `test/inventario.test.ts`:** `valuacionDelTenant` suma **todo** el catálogo del tenant. Metido en el archivo existente, su resultado dependería de cada artículo que cualquier otro caso haya creado, y un caso nuevo en otro `describe` lo rompería sin tocarlo. El archivo nuevo crea su propio tenant.

- [ ] **Step 1: Write the failing test**

Crear `test/valuacion.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
// Mismo patrón que test/inventario.test.ts y test/ventas.test.ts.
let ingresarStock: typeof import('@/lib/inventario/stock').ingresarStock
let desactivarArticulo: typeof import('@/lib/inventario/articulos').desactivarArticulo
let prismaParaTenant: typeof import('@/lib/tenant/prisma').prismaParaTenant
let valuacionDelTenant: typeof import('@/lib/inventario/valuacion').valuacionDelTenant

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client

/**
 * Un tenant nuevo con su usuario. **Cada caso usa el suyo**, sin excepción:
 * `valuacionDelTenant` suma TODO el catálogo, así que dos casos que compartan
 * tenant se rompen entre sí y un caso nuevo rompe a los viejos sin tocarlos.
 */
async function localNuevo(): Promise<{ tenantId: string; usuarioId: string }> {
  const tenantId = await crearTenant(owner, `valuacion-${crypto.randomUUID()}`)
  const { rows } = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor', $2, 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId, `v-${crypto.randomUUID()}@val.test`],
  )
  return { tenantId, usuarioId: rows[0].id }
}

/** Un artículo con SQL crudo contra el owner: este archivo prueba la LECTURA,
 *  no el alta, y `crearArticulo` arrastraría categorías, SKU y unidades que no
 *  tienen nada que ver con lo que se está midiendo. */
async function crearArticulo(
  tenantId: string,
  nombre: string,
  opciones: { tipo?: 'PRODUCTO' | 'SERVICIO'; moneda?: 'ARS' | 'USD' } = {},
): Promise<string> {
  const { tipo = 'PRODUCTO', moneda = 'ARS' } = opciones
  const { rows } = await owner.query(
    `INSERT INTO articulos
       (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 1000.00, $5, 0, now(), now())
     RETURNING id`,
    [tenantId, `SKU-${crypto.randomUUID()}`, nombre, tipo, moneda],
  )
  return rows[0].id
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ ingresarStock } = await import('@/lib/inventario/stock'))
  ;({ desactivarArticulo } = await import('@/lib/inventario/articulos'))
  ;({ prismaParaTenant } = await import('@/lib/tenant/prisma'))
  ;({ valuacionDelTenant } = await import('@/lib/inventario/valuacion'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
})

afterAll(async () => {
  await owner.end()
})

describe('valuacionDelTenant', () => {
  it('suma stock por último costo, elige el MÁS RECIENTE y cuenta los que no tienen', async () => {
    const { tenantId, usuarioId } = await localNuevo()

    const remera = await crearArticulo(tenantId, 'Remera')
    // Dos ingresos a costos distintos: el total tiene que salir del SEGUNDO.
    // Con el orden invertido daría 200.000 en vez de 90.000.
    await ingresarStock({
      tenantId, articuloId: remera, cantidad: d('10'), usuarioId, costoUnitario: d('2000'),
    })
    await ingresarStock({
      tenantId, articuloId: remera, cantidad: d('10'), usuarioId, costoUnitario: d('3000'),
    })
    // Un ingreso SIN costo no borra lo que se sabía: sigue valiendo 3.000.
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('10'), usuarioId })

    // Con mercadería y sin ningún costo: no suma, pero se cuenta.
    const funda = await crearArticulo(tenantId, 'Funda')
    await ingresarStock({ tenantId, articuloId: funda, cantidad: d('5'), usuarioId })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))

    // 30 unidades × $ 3.000
    expect(total.toString()).toBe('90000')
    expect(sinCosto).toBe(1)
  })

  it('un artículo en dólares entra igual: el costo está en pesos para todos', async () => {
    const { tenantId, usuarioId } = await localNuevo()
    const iphone = await crearArticulo(tenantId, 'iPhone', { moneda: 'USD' })
    await ingresarStock({
      tenantId, articuloId: iphone, cantidad: d('2'), usuarioId, costoUnitario: d('500000'),
    })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(total.toString()).toBe('1000000')
    expect(sinCosto).toBe(0)
  })

  it('un artículo desactivado no suma ni cuenta como faltante', async () => {
    const { tenantId, usuarioId } = await localNuevo()

    const conCosto = await crearArticulo(tenantId, 'Cargador viejo')
    await ingresarStock({
      tenantId, articuloId: conCosto, cantidad: d('4'), usuarioId, costoUnitario: d('1000'),
    })
    const sinCostoCargado = await crearArticulo(tenantId, 'Cable viejo')
    await ingresarStock({ tenantId, articuloId: sinCostoCargado, cantidad: d('3'), usuarioId })

    await desactivarArticulo({ tenantId, articuloId: conCosto })
    await desactivarArticulo({ tenantId, articuloId: sinCostoCargado })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(total.toString()).toBe('0')
    expect(sinCosto).toBe(0)
  })

  it('un servicio no suma ni cuenta: no tiene stock', async () => {
    const { tenantId } = await localNuevo()
    await crearArticulo(tenantId, 'Arreglo', { tipo: 'SERVICIO' })

    const { total, sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(total.toString()).toBe('0')
    expect(sinCosto).toBe(0)
  })

  // El conteo dice cuántos artículos DISTORSIONAN el total. Uno sin mercadería
  // no distorsiona nada: contarlo inflaría el aviso con artículos que aportan
  // cero de todos modos.
  it('un artículo sin costo y sin stock no entra al conteo de faltantes', async () => {
    const { tenantId } = await localNuevo()
    await crearArticulo(tenantId, 'Sin nada')

    const { sinCosto } = await valuacionDelTenant(prismaParaTenant(tenantId))
    expect(sinCosto).toBe(0)
  })

  it('un stock negativo cuenta como cero y no le resta al total del local', async () => {
    const { tenantId, usuarioId } = await localNuevo()

    const bien = await crearArticulo(tenantId, 'Vidrio')
    await ingresarStock({
      tenantId, articuloId: bien, cantidad: d('10'), usuarioId, costoUnitario: d('1000'),
    })
    const roto = await crearArticulo(tenantId, 'Funda mal cargada')
    await ingresarStock({
      tenantId, articuloId: roto, cantidad: d('1'), usuarioId, costoUnitario: d('5000'),
    })
    // El stock negativo se fuerza con el owner: no hay camino de aplicación
    // que lo produzca sin cobrar una venta entera.
    await owner.query(`UPDATE articulos SET stock = -2 WHERE id = $1`, [roto])

    const { total } = await valuacionDelTenant(prismaParaTenant(tenantId))
    // 10 × 1.000, y el negativo aporta CERO — no −10.000.
    expect(total.toString()).toBe('10000')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/valuacion.test.ts`
Expected: FAIL — `valuacionDelTenant` no está exportada por `lib/inventario/valuacion.ts`.

- [ ] **Step 3: Write minimal implementation**

Agregar al final de `lib/inventario/valuacion.ts`, y sumar los dos imports nuevos arriba:

```ts
// `import type`, no de valor: mismo motivo que lib/dashboard/metricas.ts —
// `prismaParaTenant` acá sólo aparece dentro de un `ReturnType<typeof ...>`, y
// `costoTotalDeArticulo` es una función pura que un componente cliente va a
// querer importar directo. Con un import de valor, ese import alcanzaría
// lib/tenant/prisma.ts para test/limite-cliente-servidor.test.ts y se llevaría
// el bundle de cliente.
import type { prismaParaTenant } from '@/lib/tenant/prisma'
```

```ts
type PrismaDeTenant = ReturnType<typeof prismaParaTenant>

/** Cuánta plata hay parada en mercadería, y cuántos artículos quedaron afuera
 *  del número por no tener ningún costo cargado. */
export type Valuacion = { total: Decimal; sinCosto: number }

/**
 * El costo del stock de todo el local.
 *
 * Exportada, y no inline en el Server Component del dashboard, por la razón de
 * siempre en este repo: un componente `async` que abre sesión no lo puede
 * llamar ningún test, y el `desactivadoEn: null` de acá abajo quedaría tan
 * desprotegido como el `anuladaEn` que el hallazgo I3 de la review del
 * rediseño mostró que se podía borrar dejando 785 tests en verde.
 *
 * DOS consultas y una suma en JavaScript, nunca un `$queryRaw` con un
 * `SUM(...)`: la extensión de lib/tenant/prisma.ts intercepta operaciones de
 * modelo, no raw queries, así que un raw sin el `set_config` de RLS devuelve
 * CERO FILAS EN SILENCIO — este repo ya lo documentó dos veces (el panel de
 * medios de /ventas y el gráfico de rotación de /inventario/[id]), y las dos
 * veces la salida fue agregar en JavaScript.
 *
 * El `distinct` es el mismo `DISTINCT ON` que ya usa `crearVenta`
 * (lib/ventas/crear.ts), con el mismo orden y el mismo desempate: `articuloId`
 * primero porque es la clave del distinct, después `creadoEn` descendente para
 * quedarse con el más reciente, y `id` (uuid(7), ordenable por tiempo) para
 * desempatar dos ingresos de la misma transacción, que comparten `creadoEn`
 * hasta el milisegundo.
 *
 * El filtro es `costoUnitario: { not: null }` y no "el ingreso más reciente":
 * un ingreso cargado sin costo no borra lo que se sabía del anterior.
 */
export async function valuacionDelTenant(prisma: PrismaDeTenant): Promise<Valuacion> {
  const [articulos, costos] = await Promise.all([
    // Sólo PRODUCTO y sólo activos. Un servicio no tiene stock
    // (lib/inventario/stock.ts se lo rechaza) y un artículo dado de baja es
    // plata que el dueño ya decidió no vender — sumarla mezcla "cuánto tengo
    // invertido en lo que vendo" con "cuánto me quedé colgado".
    prisma.articulo.findMany({
      where: { tipo: 'PRODUCTO', desactivadoEn: null },
      select: { id: true, stock: true },
    }),
    prisma.movimientoStock.findMany({
      where: { motivo: 'INGRESO', costoUnitario: { not: null } },
      orderBy: [{ articuloId: 'asc' }, { creadoEn: 'desc' }, { id: 'desc' }],
      distinct: ['articuloId'],
      select: { articuloId: true, costoUnitario: true },
    }),
  ])

  const costoPorArticulo = new Map(costos.map((m) => [m.articuloId, m.costoUnitario]))

  let total = CERO
  let sinCosto = 0
  for (const a of articulos) {
    const parcial = costoTotalDeArticulo(a.stock, costoPorArticulo.get(a.id) ?? null)
    if (parcial === null) {
      // Cuenta artículos, no movimientos, y sólo los que tienen mercadería
      // encima: uno con stock cero o negativo aporta cero al total de todos
      // modos, así que decir que "falta" su costo infla el aviso con
      // artículos que no distorsionan ningún número.
      if (a.stock.greaterThan(0)) sinCosto += 1
      continue
    }
    total = total.add(parcial)
  }
  return { total, sinCosto }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/valuacion.test.ts`
Expected: PASS, 6 casos.

Después: `npx tsc --noEmit` y `npm run lint` — sin errores.

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/valuacion.ts test/valuacion.test.ts
git commit -m "feat(costo): el costo del stock de todo el local

Dos consultas y una suma en JavaScript —nunca un \$queryRaw, que sin el
set_config de RLS devuelve cero filas en silencio—, con el mismo DISTINCT ON
y el mismo desempate por id que ya usa crearVenta.

Entran los productos activos; los desactivados y los servicios quedan
afuera. El conteo de faltantes cuenta artículos con mercadería encima, no
movimientos.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FPECywkhXCVD9hc2pkQNAf"
```

---

### Task 3: el tile de la ficha del artículo

**Files:**
- Modify: `app/(app)/inventario/[id]/page.tsx` (el bloque de tiles, ~líneas 407-455; y el cálculo de `ultimoCosto`, ~línea 346)
- Modify: `app/(app)/inventario/[id]/page.test.tsx`
- Modify: `docs/pantallas.md` (sección `## /inventario/[id]`, línea ~1280)

**Interfaces:**
- Consumes: `costoTotalDeArticulo` de la Task 1; el `Tile` y el `ultimoCosto` que la pantalla ya tiene.
- Produces: nada que consuma otra task.

**Contexto para quien lo implemente.** La pantalla ya calcula `const ultimoCosto = ultimoConCosto?.costoUnitario ?? null` (~línea 346) con la consulta que trae el ingreso con costo más reciente. **No hay que agregar ninguna consulta**: el número que falta se calcula con la función pura sobre `articulo.stock` y ese `ultimoCosto`.

El bloque de tiles de hoy es así:

```tsx
<div className="order-1 flex flex-col gap-3 lg:order-none lg:flex-row lg:gap-4">
  {esProducto && (
    <Tile marca rotulo="EN STOCK" ... />
  )}
  <div className="flex gap-3 lg:contents">
    <Tile rotulo="PRECIO DE VENTA" ... />
    {esProducto && puedeCostos && (
      <Tile rotulo="ÚLTIMO COSTO" ... />
    )}
  </div>
</div>
```

El envoltorio interno (`flex gap-3 lg:contents`) pasa a ser una grilla de dos columnas en el teléfono, porque con tres tiles adentro una fila de tres los deja en ~120 px cada uno. En escritorio no cambia nada: `lg:contents` sigue disolviendo el envoltorio y los cuatro tiles vuelven a ser hermanos de la misma fila.

- [ ] **Step 1: Write the failing test**

Agregar a `app/(app)/inventario/[id]/page.test.tsx`, dentro del `describe('los tiles de la ficha (Task 4 del rediseño)')` o en un `describe` nuevo `describe('el tile "Costo total" (ciclo del costo del stock)')`:

```ts
describe('el tile "Costo total" (ciclo del costo del stock)', () => {
  // Las MISMAS tres condiciones que gobiernan al tile de al lado, más la del
  // número que no existe. Sin costo cargado el tile no se dibuja: un "$ 0"
  // afirmaría que la mercadería no vale nada, y un "—" afirmaría que no hay
  // mercadería — las dos son falsas cuando lo que pasa es que nadie cargó el
  // costo. El tile de "Último costo" de al lado ya dice eso con su propia raya.
  it('está condicionado a esProducto, a COSTOS y a que el número exista', () => {
    expect(FUENTE).toMatch(
      /esProducto && puedeCostos && costoTotal !== null && \(\s*<Tile\s*\n\s*rotulo="COSTO TOTAL"/,
    )
  })

  // El valor sale de la función compartida sobre el stock y el último costo de
  // ESTA pantalla — no de una multiplicación escrita a mano acá, que es como
  // el clamp del negativo terminaría existiendo dos veces con dos criterios.
  it('el número sale de costoTotalDeArticulo, no de una multiplicación local', () => {
    expect(FUENTE).toContain(
      'const costoTotal = costoTotalDeArticulo(articulo.stock, ultimoCosto)',
    )
    expect(FUENTE).not.toMatch(/articulo\.stock\.mul\(/)
  })

  // El pie muestra la cuenta, que es lo que ata este número a los dos tiles de
  // al lado: sin él, el dueño tiene tres tiles con plata y ninguna forma de
  // saber de dónde sale el tercero.
  it('el pie muestra la cuenta: stock por costo unitario', () => {
    const desde = FUENTE.indexOf('rotulo="COSTO TOTAL"')
    expect(desde).toBeGreaterThan(-1)
    const bloque = FUENTE.slice(desde, desde + 600)
    expect(bloque).toContain('formatearCantidad(articulo.stock.toString())')
    expect(bloque).toContain('formatearPrecio(ultimoCosto.toString())')
  })

  // El envoltorio de los tiles sin marca pasa a grilla de dos columnas en el
  // teléfono: con tres adentro, una fila los deja en ~120 px cada uno. En
  // escritorio `lg:contents` lo sigue disolviendo y la fila es de cuatro.
  it('en el teléfono los tres tiles sin marca van en una grilla de dos columnas', () => {
    expect(FUENTE).toContain('grid grid-cols-2 gap-3 lg:contents')
  })

  it('renderiza el valor y la cuenta que se le pasan', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="COSTO TOTAL" valor="$ 222.000" pie="30 × $ 7.400" />,
    )
    expect(html).toContain('COSTO TOTAL')
    expect(html).toContain('$ 222.000')
    expect(html).toContain('30 × $ 7.400')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/inventario/[id]/page.test.tsx"`
Expected: FAIL en los primeros cuatro casos — `COSTO TOTAL` no aparece en la fuente. El caso de render pasa (`Tile` ya existe y es de presentación pura).

- [ ] **Step 3: Write minimal implementation**

En `app/(app)/inventario/[id]/page.tsx`:

1. Sumar el import:

```ts
import { costoTotalDeArticulo } from '@/lib/inventario/valuacion'
```

2. Debajo de `const ultimoCosto = ultimoConCosto?.costoUnitario ?? null` (~línea 346):

```ts
// Cero consultas nuevas: el stock y el último costo ya están en la mano. La
// cuenta —y el clamp del stock negativo— viven en lib/inventario/valuacion.ts,
// la misma función que suma el total del local en /dashboard: dos
// implementaciones de la misma regla es la forma en que un día una pantalla
// clampea y la otra no.
const costoTotal = costoTotalDeArticulo(articulo.stock, ultimoCosto)
```

3. Cambiar el envoltorio interno de los tiles y agregar el cuarto tile:

```tsx
        <div className="grid grid-cols-2 gap-3 lg:contents">
          <Tile
            rotulo="PRECIO DE VENTA"
            valor={precioEnSuMoneda(articulo.precio.toString(), articulo.moneda)}
            pie={actualizadoHace(articulo.actualizadoEn)}
          />
          {/* Sin el permiso COSTOS, el tile no se renderea — no se pone en
              '—': ese guión afirma que ningún ingreso cargó el costo, que es
              una afirmación distinta y falsa cuando lo que pasa es que a esta
              persona no se le muestra. */}
          {esProducto && puedeCostos && (
            <Tile
              rotulo="ÚLTIMO COSTO"
              // ... (sin cambios: el bloque que ya existe, tal cual)
            />
          )}
          {/* La tercera condición NO es redundante con las dos de arriba:
              `costoTotal` es null exactamente cuando no hay ningún costo
              cargado, y ahí este tile no tiene nada que decir. Un "$ 0"
              afirmaría que la mercadería no vale nada y un "—" que no hay
              mercadería; las dos son falsas. El tile de al lado ya muestra su
              propia raya, que dice todo lo que hay que decir.

              El pie muestra la CUENTA, y no es decoración: es lo que ata este
              número a los dos tiles de al lado. Sin él son tres importes sin
              relación visible entre sí. `ultimoCosto` no puede ser null acá —
              si lo fuera, `costoTotal` también lo sería— pero TypeScript no lo
              sabe desde este scope, así que el `?? ''` es el que lo convence.

              El "×" es el signo de multiplicación (U+00D7), no una equis. */}
          {esProducto && puedeCostos && costoTotal !== null && (
            <Tile
              rotulo="COSTO TOTAL"
              valor={formatearPrecio(costoTotal.toString())}
              pie={`${formatearCantidad(articulo.stock.toString())} × ${
                ultimoCosto ? formatearPrecio(ultimoCosto.toString()) : ''
              }`}
            />
          )}
        </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(app)/inventario/[id]/page.test.tsx"`
Expected: PASS.

Después: `npx vitest run test/responsive.test.ts` (no se agregó ningún ancho fijo, tiene que seguir en verde), `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 5: Documentar la pantalla**

En `docs/pantallas.md`, sección `## /inventario/[id]`, en la lista de tiles (buscar el párrafo que menciona *"y, con el permiso `COSTOS`, **Último costo**"*), agregar el cuarto tile y este párrafo:

```markdown
- **Costo total** (con el permiso `COSTOS`): cuánto costó la mercadería que
  queda, con la cuenta en el pie — `30 × $ 7.400`. Sale de
  `costoTotalDeArticulo` (`lib/inventario/valuacion.ts`), la **misma** función
  que suma el total del local en `/dashboard`, sobre el mismo "último costo"
  que muestra el tile de al lado. Un stock negativo cuenta como **cero**: es un
  error de carga, no mercadería que valga plata negativa. Sin ningún ingreso
  con costo el tile **no se dibuja** — un "$ 0" afirmaría que la mercadería no
  vale nada y un "—" que no hay mercadería, y las dos son falsas; el "—" de
  "Último costo" ya dice lo único cierto, que es que nadie cargó el costo.
```

Y en la nota de layout del teléfono de esa misma sección (la que hoy dice que "Precio de venta"/"Último costo" comparten la fila siguiente), cambiarla: los tres tiles sin marca van ahora en una **grilla de dos columnas** en el teléfono, así que "En stock" sigue solo en su fila y los otros tres cierran un 2×2 con un hueco. En escritorio, `lg:contents` los devuelve a la fila única de cuatro.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/inventario/[id]/page.tsx" "app/(app)/inventario/[id]/page.test.tsx" docs/pantallas.md
git commit -m "feat(costo): la ficha del artículo dice cuánto costó lo que queda

Un cuarto tile, con la cuenta en el pie —30 × \$ 7.400— para que el número
quede atado a los dos tiles de al lado en vez de aparecer suelto. Cero
consultas nuevas: el stock y el último costo ya estaban en la mano.

Sin ningún ingreso con costo el tile no se dibuja: un \$ 0 diría que la
mercadería no vale nada y un guión que no hay mercadería, y las dos son
falsas.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FPECywkhXCVD9hc2pkQNAf"
```

---

### Task 4: el tile del dashboard

**Files:**
- Modify: `app/(app)/dashboard/page.tsx` (el `Promise.all` de consultas ~línea 265, y la fila de tiles ~líneas 523-571)
- Modify: `app/(app)/dashboard/page.test.tsx`
- Modify: `docs/pantallas.md` (sección `## /dashboard`, línea ~2292)

**Interfaces:**
- Consumes: `valuacionDelTenant` y el tipo `Valuacion` de la Task 2; el `Tile` que la pantalla ya exporta.
- Produces: nada que consuma otra task.

**Contexto para quien lo implemente.** La pantalla ya resuelve `const puedeCostos = await puedeConSesion(sesion, 'COSTOS')` dentro de un `Promise.all` (~línea 265) y ya tiene un tile detrás de esa condición ("Margen"). La fila de tiles es:

```tsx
<div className="flex flex-col gap-3 lg:h-[116px] lg:flex-row lg:gap-4">
  <Tile marca rotulo="Total del período" ... />
  <div className="grid grid-cols-2 gap-3 lg:contents">
    <Tile rotulo="Ventas cobradas" ... />
    <Tile rotulo="Ticket promedio" ... />
    {puedeCostos && <Tile rotulo="Margen" ... />}
  </div>
</div>
```

La grilla de dos columnas del teléfono ya existe, así que el quinto tile no cambia nada del layout móvil: pasa de tres items (uno huérfano) a cuatro (2×2 cerrado). En escritorio la fila pasa de cuatro tiles a cinco.

**El pie del tile es load-bearing.** Los otros cuatro responden al selector de período; éste lo ignora, porque es una foto de ahora. Sin el `al día de hoy`, un dueño que toca "Este mes" y ve el mismo número tiene razón en pensar que algo está roto.

- [ ] **Step 1: Write the failing test**

Agregar a `app/(app)/dashboard/page.test.tsx`. **`FUENTE` es local a otro `describe`** en ese archivo (línea ~138), así que este bloque declara el suyo:

```ts
describe('el tile "Costo del stock" (ciclo del costo del stock)', () => {
  const FUENTE = readFileSync('app/(app)/dashboard/page.tsx', 'utf8')

  // Detrás de COSTOS, igual que "Margen": es el mismo permiso que ya tapa el
  // costo unitario del que sale este número.
  it('está detrás del permiso COSTOS', () => {
    expect(FUENTE).toMatch(/puedeCostos && \(\s*<Tile\s*\n\s*rotulo="COSTO DEL STOCK"/)
  })

  // El número sale de la función compartida, no de una consulta escrita acá
  // adentro del Server Component —que ningún test podría llamar—.
  it('el número sale de valuacionDelTenant', () => {
    expect(FUENTE).toContain('valuacionDelTenant(prisma)')
  })

  // El pie sale de `pieDelCostoDelStock` y no de un literal escrito acá: lo que
  // dice, y que concuerde en número, lo afirma el describe de esa función más
  // abajo, llamándola. Un caso que buscara los literales en el FUENTE fallaría
  // siempre —la implementación los arma por interpolación— y diría menos.
  it('el pie sale de pieDelCostoDelStock, no de un literal en el JSX', () => {
    expect(FUENTE).toContain('pie={pieDelCostoDelStock(valuacion.sinCosto)}')
  })

  // Sin chip de variación: no hay período anterior contra el cual comparar una
  // foto de ahora. Ya hay precedente en esta misma fila (Ticket promedio y
  // Margen tampoco lo llevan).
  it('no lleva chip de variación', () => {
    const desde = FUENTE.indexOf('rotulo="COSTO DEL STOCK"')
    expect(desde).toBeGreaterThan(-1)
    const bloque = FUENTE.slice(desde, desde + 400)
    expect(bloque).not.toContain('delta=')
  })

  it('renderiza el valor y el pie que se le pasan', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="COSTO DEL STOCK" valor="$ 2.480.000" pie="al día de hoy · 12 artículos sin costo" />,
    )
    expect(html).toContain('$ 2.480.000')
    expect(html).toContain('al día de hoy · 12 artículos sin costo')
  })
})
```

Y el pie se arma con una función pura exportada, que también se prueba:

```ts
describe('pieDelCostoDelStock', () => {
  it('sin faltantes, sólo dice de cuándo es el número', () => {
    expect(pieDelCostoDelStock(0)).toBe('al día de hoy')
  })

  it('con faltantes, concuerda en número', () => {
    expect(pieDelCostoDelStock(1)).toBe('al día de hoy · 1 artículo sin costo')
    expect(pieDelCostoDelStock(12)).toBe('al día de hoy · 12 artículos sin costo')
  })
})
```

(agregar `pieDelCostoDelStock` al import desde `./page` en la cabecera del archivo de test)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/dashboard/page.test.tsx"`
Expected: FAIL — `pieDelCostoDelStock` no está exportada y `COSTO DEL STOCK` no aparece en la fuente.

- [ ] **Step 3: Write minimal implementation**

En `app/(app)/dashboard/page.tsx`:

1. Sumar el import:

```ts
import { valuacionDelTenant } from '@/lib/inventario/valuacion'
```

2. La función del pie, exportada, cerca de las otras funciones de texto de la pantalla (al lado de `sinVentasEnPeriodoAnterior`):

```ts
/**
 * El pie del tile "Costo del stock".
 *
 * `al día de hoy` NO es una aclaración de cortesía: los otros cuatro tiles de
 * esa fila responden al selector de período y se comparan contra el período
 * anterior, y éste ignora los chips por completo porque es una foto de ahora.
 * Sin el pie, un dueño que toca "Este mes" y ve el mismo número que en "Hoy"
 * tiene razón en pensar que algo está roto.
 *
 * Y el total es una suma PARCIAL cuando hay artículos sin costo cargado: un
 * número que parece completo sin serlo es exactamente lo que este repo ya
 * rechazó cuando le puso pie a `delta()` en vez de inventar un "+100 %".
 * Concuerda en número — "1 artículo", "12 artículos".
 */
export function pieDelCostoDelStock(sinCosto: number): string {
  if (sinCosto <= 0) return 'al día de hoy'
  const plural = sinCosto === 1 ? 'artículo' : 'artículos'
  return `al día de hoy · ${sinCosto} ${plural} sin costo`
}
```

3. Sumar `valuacionDelTenant(prisma)` al `Promise.all` que ya arma la pantalla (~línea 265), desestructurando el resultado como `valuacion`. La consulta corre en paralelo con las que ya están, así que no suma un round-trip en serie.

4. El quinto tile, después del de "Margen", dentro del mismo envoltorio `grid grid-cols-2 gap-3 lg:contents`:

```tsx
            {/* Detrás de COSTOS, igual que "Margen" de arriba y por el mismo
                motivo: es el permiso que ya tapa el costo unitario del que
                sale este número.

                SIN chip de variación, a propósito: no hay período anterior
                contra el cual comparar una foto de ahora. Ya hay precedente en
                esta misma fila ("Ticket promedio" y "Margen" tampoco lo
                llevan). Lo que el pie sí dice, y es load-bearing, es que este
                número no responde a los chips de período — ver
                `pieDelCostoDelStock`. */}
            {puedeCostos && (
              <Tile
                rotulo="COSTO DEL STOCK"
                valor={formatearPrecio(valuacion.total.toString())}
                pie={pieDelCostoDelStock(valuacion.sinCosto)}
              />
            )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(app)/dashboard/page.test.tsx"`
Expected: PASS.

Después: `npx vitest run test/responsive.test.ts`, `npx tsc --noEmit`, `npm run lint`.

- [ ] **Step 5: Documentar la pantalla**

En `docs/pantallas.md`, sección `## /dashboard`, en la lista de tiles, agregar:

```markdown
- **Costo del stock** (con el permiso `COSTOS`): cuánta plata hay parada en
  mercadería — `Σ max(stock, 0) × último costo conocido` sobre los productos
  activos, vía `valuacionDelTenant` (`lib/inventario/valuacion.ts`), la misma
  función y la misma definición que el tile "Costo total" de
  `/inventario/[id]`.

  **Es el único tile de la fila que NO responde al selector de período**, y por
  eso su pie dice `al día de hoy`: es una foto de ahora, no una métrica del
  rango. Por lo mismo no lleva chip de variación — no hay período anterior
  contra el cual comparar un stock.

  Cuando hay artículos con mercadería y sin ningún costo cargado, el pie lo
  dice (`al día de hoy · 12 artículos sin costo`): el total es una suma parcial
  y un número que parece completo sin serlo es lo que este repo ya rechazó en
  otros lados. El conteo cuenta **artículos con stock**, no movimientos: uno en
  cero no distorsiona el total, así que contarlo inflaría el aviso.

  **No entra al CSV** de esta pantalla: ese archivo exporta el período, y una
  fila que ignora el rango dentro de una exportación rotulada por rango es un
  dato que alguien va a leer mal.
```

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/dashboard/page.tsx" "app/(app)/dashboard/page.test.tsx" docs/pantallas.md
git commit -m "feat(costo): el dashboard dice cuánta plata hay parada en mercadería

Un quinto tile, detrás de COSTOS igual que Margen. Sin chip de variación:
no hay período anterior contra el cual comparar una foto de ahora, y el pie
—al día de hoy— es lo que evita que tocar \"Este mes\" y ver el mismo número
se lea como un bug.

Con artículos sin costo cargado el pie lo dice: el total es una suma
parcial, y un número que parece completo sin serlo es lo que este repo ya
rechazó en otros lados.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FPECywkhXCVD9hc2pkQNAf"
```

---

### Task 5: el registro del ciclo

**Files:**
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 33, antes de la sección `## Cómo agregar una entrada`)
- Modify: `CLAUDE.md` (sección *Próximos pasos técnicos*, al final de la lista de ítems del producto)

**Interfaces:**
- Consumes: nada. Produces: nada.

**Por qué es una task y no un párrafo suelto en la anterior:** las dos pantallas comparten una misma desviación de la maqueta, y escribirla dos veces —una en cada commit— es la forma en que las dos copias terminan diciendo cosas distintas.

- [ ] **Step 1: Escribir la entrada del `.pen`**

En `docs/correcciones-pendientes-del-pen.md`, justo antes de `## Cómo agregar una entrada`, agregar:

```markdown
## 33. Los dos tiles de costo se derivaron sin frame, y además le cambian la cuenta de tiles a dos filas que el `.pen` sí dibuja

`design/arandano.pen` es anterior a este ciclo y no dibuja ninguno de los dos:
ni "COSTO TOTAL" en `App / Artículo ficha` (`y4tEb`) ni "COSTO DEL STOCK" en
`App / Dashboard` (`A2Hffo`), ni en sus frames móviles.

Eso solo sería el caso de siempre —la maqueta calla, el código deriva, y el
silencio no es una instrucción de borrar nada—. Lo que hace a esta entrada
distinta es que **acá el `.pen` no calla**: dibuja las dos filas de tiles con
una cantidad concreta de tiles, y este ciclo se la cambia. La ficha pasa de
tres a cuatro, el dashboard de cuatro a cinco, y en los dos casos los tiles que
ya estaban se achican para dar lugar al nuevo.

En el teléfono el cambio mejora lo que había: las dos filas usan una grilla de
dos columnas, así que pasan de dejar un tile huérfano a cerrar un 2×2 parejo.
En escritorio no hay frame que diga si cinco tiles de 116 px de alto siguen
siendo legibles, y eso **no está confirmado por nadie** — es lo primero que hay
que mirar en la verificación manual.

La alternativa era un bloque aparte, fuera de la fila de tiles, que no le
tocaría la geometría a ningún frame. Se descartó en el diseño: el número es del
mismo orden que los otros cuatro y sacarlo de la fila lo escondería.

---
```

- [ ] **Step 2: Escribir la entrada de `CLAUDE.md`**

En `CLAUDE.md`, sección *Próximos pasos técnicos*, después del último ítem de producto (el de la PWA instalable), agregar:

```markdown
- ~~Ver cuánto costó la mercadería que queda.~~ **Hecho** (2026-09-04). Sale
  del pedido del dueño del producto: el costo total de un artículo en su
  ficha —30 unidades, cuánto costaron— y el del local entero en `/dashboard`.
  Ver `docs/superpowers/specs/2026-09-04-costo-del-stock-design.md`.

  **Una sola definición, en `lib/inventario/valuacion.ts`**: `max(stock, 0) ×
  último costo conocido`, donde "último costo conocido" es **el mismo** que ya
  leen el tile "Último costo" de la ficha y `crearVenta` al congelar
  `Venta.costoArs`. Que sea literalmente la misma consulta es la decisión: un
  cuarto criterio de costo sería un cuarto número en la misma pantalla que
  alguien va a tener que explicar por qué difiere.

  **Las dos alternativas descartadas**, cada una con su motivo: el **promedio
  ponderado** de los ingresos es más fiel a lo que se pagó —con 20 a $7.000 y
  10 a $9.000, el último costo valúa las 30 a $9.000 y se pasa— pero introduce
  ese cuarto número; **FIFO** es el número contablemente correcto y el más
  caro, porque exige reconstruir capas de ingreso sobre una tabla append-only
  para todo el catálogo. **El disparador para reconsiderarlo**: que a un dueño
  le moleste que su total suba solo porque el último ingreso vino más caro,
  teniendo el depósito lleno de mercadería comprada a otro precio.

  **`null` y cero son dos respuestas distintas, y esa distinción es la
  función.** Sin ningún ingreso con costo no se sabe, así que el tile de la
  ficha **no se dibuja** y el artículo no suma al total del local — pero sí se
  **cuenta**: el pie del dashboard dice "12 artículos sin costo", porque un
  total parcial que parece completo es lo que este repo ya rechazó cuando le
  puso pie a `delta()` en vez de inventar un "+100 %". Cero, en cambio, se
  afirma: con costo cargado y stock en cero o negativo, la mercadería que queda
  no vale nada y eso es verdad. **El stock negativo cuenta como cero** y no
  resta — es un error de carga, no plata negativa, y `/inventario` ya lo avisa
  por su cuenta.

  **El dólar no molesta acá, y conviene decirlo porque parece que debería.**
  `textoDeMargen` devuelve `null` para un artículo en dólares, y la intuición
  dice que esto haría lo mismo. No: aquel `null` es porque el margen compara el
  costo **contra el precio**, que están en monedas distintas; acá el costo se
  multiplica por una **cantidad**, y una cantidad no tiene moneda.
  `costoUnitario` está en pesos para todos, así que el total es en pesos para
  todos.

  **Entran los productos activos.** Un servicio no tiene stock; un artículo
  dado de baja con stock encima es plata que el dueño ya decidió no vender, y
  sumarla mezcla "cuánto tengo invertido en lo que vendo" con "cuánto me quedé
  colgado".

  **Sin migración, sin columna y sin permiso nuevo.** El número se deriva de lo
  que ya está guardado, así que el ciclo entero se revierte revirtiendo la
  imagen. `lib/permisos/catalogo.ts` **no crece**: los dos tiles van detrás de
  `COSTOS`, que es el permiso que ya tapa el costo unitario del que salen.

  **Esto NO cierra la deuda del costo**, que sigue con su investigación escrita
  más arriba en este documento: el costo sigue siendo un atributo del evento de
  recepción y no del producto, sigue sin poder cargarse sin sumar stock y sigue
  sin poder corregirse una vez escrito. Este ciclo suma un lector más de ese
  dato. Si algo, **sube la presión para cerrarla**: el pie "12 artículos sin
  costo" es la primera pantalla que le muestra al dueño el tamaño del agujero.

  **Queda pendiente la verificación manual**, y es el riesgo específico de este
  ciclo porque ningún test lo puede contestar: si **cinco** tiles en una fila de
  116 px siguen siendo legibles en escritorio (el dashboard pasa de cuatro a
  cinco y la ficha de tres a cuatro, achicando los que ya estaban), y si el pie
  de dos partes —`al día de hoy · 12 artículos sin costo`— entra sin cortarse a
  390 px. Anotado en `docs/correcciones-pendientes-del-pen.md`, entrada 33.
```

- [ ] **Step 3: Correr el gate completo**

Run: `npm test`
Expected: PASS, todo el repo. Prestar atención a `test/pantallas.test.ts` (ata `docs/pantallas.md` con `app/**/page.tsx` en las dos direcciones) y a `test/responsive.test.ts`.

Run: `npx tsc --noEmit` — sin errores.
Run: `npm run lint` — sin errores.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/correcciones-pendientes-del-pen.md
git commit -m "docs(costo): el registro del ciclo y la deuda con la maqueta

La entrada 33: los dos tiles se derivaron sin frame, y además le cambian la
cuenta de tiles a dos filas que el .pen sí dibuja —de tres a cuatro en la
ficha, de cuatro a cinco en el dashboard—. Que cinco tiles de 116 px sigan
siendo legibles en escritorio no lo confirmó nadie todavía.

Y la entrada de CLAUDE.md, con las dos alternativas descartadas (promedio
ponderado y FIFO) y su disparador, la distinción entre null y cero, y por
qué el dólar no molesta en esta cuenta y sí en el margen.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FPECywkhXCVD9hc2pkQNAf"
```

---

## Verificación manual (después del merge)

`arandano-dev` bind-montea `/root/arandano`, así que esto se hace con `main` mergeado, no desde el worktree. Con el catálogo del canario sembrado (`npm run catalogo:sembrar`) y a **1440 y 390 px**:

1. Que la ficha de un artículo con stock y costo muestre "Costo total" con la cuenta en el pie, y que el número sea `stock × último costo`.
2. Que la ficha de un artículo **sin** ningún ingreso con costo **no** dibuje el tile, y que "Último costo" siga mostrando su "—".
3. Que un artículo con stock negativo muestre `$ 0,00` y no un número negativo.
4. Que el dashboard muestre "Costo del stock", y que **tocar los chips de período no lo cambie** — que es justo lo que el pie promete.
5. Que el pie del dashboard diga cuántos artículos quedaron afuera, y que el número concuerde con lo que se ve en `/inventario`.
6. **Lo que ningún test contesta**: que cinco tiles en la fila del dashboard y cuatro en la de la ficha sigan siendo legibles a 1440 px, y que el pie de dos partes entre sin cortarse a 390.
7. Que un empleado **sin** `COSTOS` no vea ninguno de los dos tiles (el dashboard es `exigirDuenio()`, así que este caso se mira en la ficha).
