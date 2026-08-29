# Precio del artículo en dólares — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un artículo se pueda cargar con el precio en dólares, y que una venta pueda llevar dos totales —uno en pesos y uno en dólares— con cada pago declarando cuál de los dos cubre.

**Architecture:** Cuatro columnas aditivas (`Articulo.moneda`, `VentaItem.moneda`, `Venta.totalUsd`, `Pago.cubre`), todas con default `ARS`/`0`, así que toda fila existente sigue diciendo lo mismo. El invariante central del motor deja de ser uno y pasa a ser dos, uno por moneda. La regla que gobierna todo el cálculo: **`aporte` no divide nunca** — `base` va en dólares si el pago toca dólares de algún lado, y `cotizacion` multiplica siempre desde ese lado.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7 (`@/generated/prisma/client`), PostgreSQL con RLS, Tailwind v4, shadcn, vitest.

**Spec:** `docs/superpowers/specs/2026-08-29-precio-en-usd-design.md` — el plan argumenta desde ahí; leelo antes de la primera task.

## Global Constraints

- Código, comentarios y mensajes de commit en **español rioplatense con acentos**. Los comentarios explican POR QUÉ, no QUÉ.
- **Toda la plata es `Prisma.Decimal`, nunca `number` con decimales.** En el navegador, enteros (`lib/ventas/centavos.ts`). `0.1 + 0.2` está prohibido en este repo.
- **`aporte` no divide nunca.** Si una implementación necesita una división para cerrar la venta, está mal planteada — volvé a la tabla de cuatro filas del spec.
- **Migraciones sólo aditivas.** Ninguna columna se borra ni se renombra en este ciclo. Nada de `migrate reset` ni `db push`.
- **`git add` con archivos nombrados, NUNCA `git add -A`.**
- Los colores salen de tokens de `app/globals.css`, nunca de hex a mano. **`--primary-foreground` no puede aparecer fuera de `components/ui/`.**
- **Mobile-first:** el valor de teléfono sin prefijo, el de escritorio con `lg:` (corte 1024). Todo ancho fijo nuevo mayor a **362 px** tiene que venir prefijado con `lg:`, o `test/responsive.test.ts` falla.
- **Toda guarda o control duplicado tiene que existir en las DOS copias** (Topbar de escritorio `hidden lg:flex` + pie o `accionMovil` del teléfono), y el caso lo cuenta **en las dos direcciones**.
- Al terminar cada task: `npm test` en cero fallas, `npm run lint` limpio, `npx tsc --noEmit` limpio.
- **No corras comandos de `docker` mientras los tests corren**: el Postgres de test lo gestiona la suite y produce `ECONNREFUSED` que parecen bugs.
- Correr un archivo suelto: `npx vitest run <ruta>`. La suite completa: `npm test`.

## Mapa de archivos

| Archivo | Responsabilidad tras el ciclo |
|---|---|
| `prisma/schema.prisma` | Las cuatro columnas nuevas, con su comentario de por qué. |
| `prisma/migrations/<ts>_precio_en_usd/migration.sql` | El `ALTER TABLE` aditivo. |
| `docs/schema.md` | Regenerado por `scripts/generar-erd.sh` (lo verifica el pre-commit). |
| `lib/ventas/totales.ts` | **El único lugar donde vive la tabla de cuatro filas**: `aporteDePago`, `totalesDeItems`, `totalesDePagos`, `pesosEntregados`. |
| `lib/ventas/crear.ts` | Dos invariantes, `moneda` congelada en el ítem, `cubre` en el pago, la regla del plan relajada. |
| `lib/ventas/composicion.ts` | Pasa a `pesosEntregados` (bug que el modelo nuevo destapa). |
| `lib/ventas/centavos.ts` | El espejo en enteros de `aporteDePago` y de los dos totales. |
| `lib/ventas/buscar.ts` | Devuelve `moneda` en los resultados; pierde `ultimaCotizacionUsd()`. |
| `lib/inventario/articulos.ts` | `moneda` en alta y edición, con su validación. |
| `components/selector-de-moneda.tsx` | **Un solo control** de moneda para el alta y la ficha. |
| `app/(app)/inventario/formularios.tsx` | Instancia ese control en las dos pantallas. |
| `app/(app)/inventario/page.tsx`, `[id]/page.tsx` | Precio en su moneda; margen `—` en dólares. |
| `app/(app)/vender/punto-de-venta.tsx` | Carrito con dos totales, `Cubre` por pago, dos chips de faltante. |
| `app/(app)/vender/page.tsx` | Pierde `cotizacionInicial`. |
| `app/(app)/ventas/page.tsx`, `[id]/page.tsx` | Los dos totales en el tile, la columna y el detalle. |
| `docs/pantallas.md`, `CLAUDE.md` | La documentación que el ciclo obliga a mover. |

---

### Task 1: La migración y el modelo

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_precio_en_usd/migration.sql` (lo genera `prisma migrate dev`)
- Modify: `docs/schema.md` (regenerado, no a mano)
- Test: `test/schema-usd.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `Articulo.moneda: Moneda`, `VentaItem.moneda: Moneda`, `Venta.totalUsd: Decimal`, `Pago.cubre: Moneda`. El enum `Moneda { ARS USD }` **ya existe** — no lo crees.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/schema-usd.test.ts`. Copiá el arranque (imports, `beforeAll`, helpers de tenant) de `test/rls.test.ts`, que es el patrón de este repo para tests que tocan la base.

```ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'

describe('las columnas de moneda nacen con default', () => {
  it('un artículo creado sin moneda queda en ARS', async () => {
    const a = await crearArticuloCrudo({ nombre: 'Funda', precio: '15000' })
    expect(a.moneda).toBe('ARS')
  })

  it('una venta creada sin totalUsd queda en 0', async () => {
    const v = await crearVentaCruda({ total: '15000' })
    expect(v.totalUsd.toString()).toBe('0')
  })

  it('un pago creado sin cubre queda en ARS', async () => {
    const p = await crearPagoCrudo({ monto: '15000', moneda: 'ARS', cotizacion: '1' })
    expect(p.cubre).toBe('ARS')
  })
})
```

Los tres helpers `crearArticuloCrudo` / `crearVentaCruda` / `crearPagoCrudo` los escribís vos en el mismo archivo, insertando por Prisma **sin** pasar la columna nueva — que es exactamente lo que prueba el default. Usá `enTransaccionDeTenant` como el resto de la suite.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/schema-usd.test.ts`
Expected: FAIL — `moneda`, `totalUsd` y `cubre` no existen en el cliente de Prisma.

- [ ] **Step 3: Agregar las cuatro columnas al schema**

En `prisma/schema.prisma`, dentro de `model Articulo`, junto a `precio`:

```prisma
  // En qué moneda está cargado `precio`. Con USD, `precio` NO son pesos: son
  // dólares, y la conversión se hace recién al vender, con la cotización que
  // se tipea en ese momento. El default cubre todo lo cargado antes de este
  // ciclo, que era pesos por no haber otra opción.
  moneda       Moneda    @default(ARS)
```

En `model VentaItem`, junto a `precioUnitario`:

```prisma
  // Congelada al vender, igual que `descripcion` y `precioUnitario`: el
  // artículo puede pasar de dólares a pesos mañana y esta venta tiene que
  // seguir diciendo en qué moneda se cobró.
  moneda         Moneda   @default(ARS)
```

En `model Venta`, junto a `total`:

```prisma
  // La mercadería EN DÓLARES, a precio de lista. `total` es la mitad en pesos
  // de lo mismo, y no cambió de significado para ninguna fila anterior a este
  // ciclo: todas tienen `totalUsd = 0`.
  totalUsd    Decimal  @default(0) @db.Decimal(12, 2)
```

En `model Pago`, junto a `moneda`:

```prisma
  // Cuál de los dos totales de la venta paga esta fila. NO es lo mismo que
  // `moneda`, que es lo que la persona entrega: un pago en pesos puede cubrir
  // el total en dólares (se tipea la cotización y cuántos DÓLARES cubre), y
  // ahí `moneda = ARS` con `cubre = USD`. Ver la tabla de cuatro filas en
  // docs/superpowers/specs/2026-08-29-precio-en-usd-design.md.
  cubre        Moneda    @default(ARS)
```

- [ ] **Step 4: Generar la migración y el cliente**

```bash
npx prisma migrate dev --name precio_en_usd
```

Abrí el `migration.sql` generado y verificá **con los ojos** que sean cuatro `ALTER TABLE … ADD COLUMN … DEFAULT …` y **ningún** `DROP`. Si aparece un `DROP`, pará y avisá: algo se desincronizó.

- [ ] **Step 5: Regenerar el ERD**

```bash
scripts/generar-erd.sh
```

`docs/schema.md` se regenera solo. **No lo edites a mano** — el hook de pre-commit y el paso 3 de `deploy.sh` lo verifican contra el DDL.

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run test/schema-usd.test.ts`
Expected: PASS, los tres casos.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md test/schema-usd.test.ts
git commit -m "feat(usd): las cuatro columnas de moneda, todas aditivas"
```

---

### Task 2: `aporteDePago` y los dos totales, en `lib/ventas/totales.ts`

Es el corazón del ciclo: la tabla de cuatro filas del spec, hecha código, en un único lugar.

**Files:**
- Modify: `lib/ventas/totales.ts`
- Test: `lib/ventas/totales.test.ts:38` en adelante (agregar bloques, no tocar los existentes)

**Interfaces:**
- Consumes: `redondearDinero`, `montoEnPesos` (ya existen en el archivo).
- Produces:
  - `type Totales = { ars: Prisma.Decimal; usd: Prisma.Decimal }`
  - `totalesDeItems(items: { cantidad: Decimal; precioUnitario: Decimal; moneda: Moneda }[]): Totales`
  - `aporteDePago(p: { moneda: Moneda; cubre: Moneda; base: Decimal; cotizacion: Decimal }): Decimal`
  - `totalesDePagos(pagos: { moneda: Moneda; cubre: Moneda; base: Decimal; cotizacion: Decimal }[]): Totales`
  - `montoEntregado(p: { moneda: Moneda; cubre: Moneda; base: Decimal; cotizacion: Decimal }): Decimal`
  - `pesosEntregados(p: { moneda: Moneda; monto: Decimal; cotizacion: Decimal }): Decimal`
  - `baseEnDolares(p: { moneda: Moneda; cubre: Moneda }): boolean`

**No toques** `totalDeItems`, `totalDePagos`, `montoEnPesos` ni `totalCobrado`: siguen teniendo consumidores (`lib/ventas/centavos.test.ts` los usa como ancla del espejo, `/ventas` y `/ventas/[id]` usan `totalCobrado`).

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `lib/ventas/totales.test.ts`, con el helper `d` que ese archivo ya define:

```ts
describe('baseEnDolares', () => {
  it('es falso sólo cuando ninguna de las dos puntas toca dólares', () => {
    expect(baseEnDolares({ moneda: 'ARS', cubre: 'ARS' })).toBe(false)
    expect(baseEnDolares({ moneda: 'USD', cubre: 'ARS' })).toBe(true)
    expect(baseEnDolares({ moneda: 'USD', cubre: 'USD' })).toBe(true)
    expect(baseEnDolares({ moneda: 'ARS', cubre: 'USD' })).toBe(true)
  })
})

describe('aporteDePago', () => {
  it('pesos cubriendo pesos aporta su base', () => {
    const p = { moneda: 'ARS' as const, cubre: 'ARS' as const, base: d('15000'), cotizacion: d('1') }
    expect(aporteDePago(p).toString()).toBe('15000')
    expect(montoEntregado(p).toString()).toBe('15000')
  })

  it('dólares cubriendo pesos aporta base × cotización, y se entregan los dólares', () => {
    const p = { moneda: 'USD' as const, cubre: 'ARS' as const, base: d('300'), cotizacion: d('1485') }
    expect(aporteDePago(p).toString()).toBe('445500')
    expect(montoEntregado(p).toString()).toBe('300')
  })

  it('dólares cubriendo dólares aporta su base, sin cotización de por medio', () => {
    const p = { moneda: 'USD' as const, cubre: 'USD' as const, base: d('300'), cotizacion: d('1') }
    expect(aporteDePago(p).toString()).toBe('300')
    expect(montoEntregado(p).toString()).toBe('300')
  })

  it('pesos cubriendo dólares aporta los DÓLARES de la base, y se entregan los pesos', () => {
    // El caso del feedback: la base se tipea en dólares y el peso se
    // MULTIPLICA. Si algún día esto divide, está mal.
    const p = { moneda: 'ARS' as const, cubre: 'USD' as const, base: d('300'), cotizacion: d('1485') }
    expect(aporteDePago(p).toString()).toBe('300')
    expect(montoEntregado(p).toString()).toBe('445500')
  })
})

describe('totalesDeItems', () => {
  it('parte el carrito por moneda y redondea cada línea antes de sumar', () => {
    const t = totalesDeItems([
      { cantidad: d('2'), precioUnitario: d('7500'), moneda: 'ARS' },
      { cantidad: d('1'), precioUnitario: d('300'), moneda: 'USD' },
      { cantidad: d('3'), precioUnitario: d('0.335'), moneda: 'ARS' },
    ])
    // 15000 + 1.01 (0.335×3 = 1.005 → 1.01 con ROUND_HALF_UP)
    expect(t.ars.toString()).toBe('15001.01')
    expect(t.usd.toString()).toBe('300')
  })

  it('un carrito vacío da cero en las dos monedas', () => {
    const t = totalesDeItems([])
    expect(t.ars.toString()).toBe('0')
    expect(t.usd.toString()).toBe('0')
  })
})

describe('totalesDePagos', () => {
  it('acumula cada pago contra el total que declara cubrir', () => {
    const t = totalesDePagos([
      { moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') },
      { moneda: 'ARS', cubre: 'ARS', base: d('15000'), cotizacion: d('1') },
      { moneda: 'USD', cubre: 'ARS', base: d('10'), cotizacion: d('1485') },
    ])
    expect(t.usd.toString()).toBe('300')
    expect(t.ars.toString()).toBe('29850')
  })
})

describe('pesosEntregados', () => {
  it('un pago en pesos vale su monto, aunque su cotización no sea 1', () => {
    // Un pago en pesos que cubre el total en dólares lleva `cotizacion = 1485`
    // y `monto` YA en pesos: multiplicarlo otra vez daba 926 millones.
    expect(
      pesosEntregados({ moneda: 'ARS', monto: d('623700'), cotizacion: d('1485') }).toString(),
    ).toBe('623700')
  })

  it('un pago en dólares vale monto × cotización', () => {
    expect(
      pesosEntregados({ moneda: 'USD', monto: d('300'), cotizacion: d('1485') }).toString(),
    ).toBe('445500')
  })
})
```

Agregá los nombres nuevos al `import` del principio del archivo de test.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/ventas/totales.test.ts`
Expected: FAIL — `baseEnDolares is not a function` y compañía.

- [ ] **Step 3: Implementar**

En `lib/ventas/totales.ts`. El import va **arriba de todo**, junto al de
`Prisma` que el archivo ya tiene:

```ts
import type { Moneda } from '@/generated/prisma/client'
```

y el resto, después de `totalDePagos`:

```ts
/** Los dos totales de una venta: la mercadería en pesos y la que está en dólares. */
export type Totales = { ars: Decimal; usd: Decimal }

/** Una fila de pago, en la forma mínima que estas funciones necesitan. */
type FilaDePago = { moneda: Moneda; cubre: Moneda; base: Decimal; cotizacion: Decimal }

/**
 * Si la `base` de un pago se expresa en dólares.
 *
 * Es LA regla del ciclo, y está en una función propia porque de ella depende
 * que nada divida: `base` va en dólares si el pago toca dólares de algún lado
 * —la moneda que entra o el total que cubre—, y `cotizacion` multiplica
 * siempre DESDE ese lado. La alternativa —definir `base` siempre en la moneda
 * del pago, o siempre en la del total— deja uno de los dos cruces necesitando
 * `base / cotizacion`, y una división acá produce ventas que no cierran por un
 * centavo y que la persona del mostrador no tiene forma de arreglar. Es el
 * mismo motivo por el que el ciclo de precios por forma de pago prohibió el
 * plan sobre un pago en dólares.
 */
export function baseEnDolares(p: { moneda: Moneda; cubre: Moneda }): boolean {
  return p.moneda === 'USD' || p.cubre === 'USD'
}

/**
 * Lo que un pago le aporta al total que declara cubrir, en la moneda de ESE
 * total.
 *
 * Las cuatro combinaciones, y ninguna divide:
 *
 * | moneda | cubre | base en | aporta                |
 * |--------|-------|---------|-----------------------|
 * | ARS    | ARS   | pesos   | base                  |
 * | USD    | ARS   | dólares | base × cotizacion     |
 * | USD    | USD   | dólares | base                  |
 * | ARS    | USD   | dólares | base                  |
 *
 * O sea: sólo se multiplica cuando la base está en dólares y el total que se
 * cubre está en pesos. En todo lo demás la base ya está en la unidad correcta.
 */
export function aporteDePago(p: FilaDePago): Decimal {
  if (p.cubre === 'ARS' && baseEnDolares(p)) return montoEnPesos(p.base, p.cotizacion)
  return redondearDinero(p.base)
}

/**
 * Lo que la persona entrega por este pago, en `p.moneda` — lo que va a
 * `Pago.monto` (antes de sumarle el recargo del plan).
 *
 * Es el reflejo de `aporteDePago`: cuando la base está en dólares y el pago se
 * entrega en pesos, acá es donde se multiplica.
 */
export function montoEntregado(p: FilaDePago): Decimal {
  if (p.moneda === 'ARS' && baseEnDolares(p)) return montoEnPesos(p.base, p.cotizacion)
  return redondearDinero(p.base)
}

/** La mercadería del carrito, partida por la moneda de cada ítem. */
export function totalesDeItems(
  items: { cantidad: Decimal; precioUnitario: Decimal; moneda: Moneda }[],
): Totales {
  return items.reduce<Totales>(
    (acc, i) => {
      const sub = subtotalItem(i.cantidad, i.precioUnitario)
      return i.moneda === 'USD' ? { ...acc, usd: acc.usd.add(sub) } : { ...acc, ars: acc.ars.add(sub) }
    },
    { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
  )
}

/** Lo que los pagos cubren, acumulado contra el total que cada uno declara. */
export function totalesDePagos(pagos: FilaDePago[]): Totales {
  return pagos.reduce<Totales>(
    (acc, p) => {
      const a = aporteDePago(p)
      return p.cubre === 'USD' ? { ...acc, usd: acc.usd.add(a) } : { ...acc, ars: acc.ars.add(a) }
    },
    { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
  )
}

/**
 * Cuántos pesos entregó un pago YA GUARDADO, leído desde su fila.
 *
 * Distinta de `montoEnPesos`, y la diferencia es un bug real que este ciclo
 * destapa: `montoEnPesos(monto, cotizacion)` multiplica siempre, y eso era
 * correcto mientras todo pago en pesos llevara cotización 1. Un pago en pesos
 * que cubre el total en dólares lleva la cotización de verdad (1485) y `monto`
 * YA en pesos, así que multiplicarlo otra vez da un número mil quinientas
 * veces más grande. Toda lectura de un pago guardado pasa por acá.
 */
export function pesosEntregados(p: {
  moneda: Moneda
  monto: Decimal
  cotizacion: Decimal
}): Decimal {
  return p.moneda === 'ARS' ? redondearDinero(p.monto) : montoEnPesos(p.monto, p.cotizacion)
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/ventas/totales.test.ts`
Expected: PASS, incluidos los bloques viejos sin tocar.

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/totales.ts lib/ventas/totales.test.ts
git commit -m "feat(usd): aporteDePago y los dos totales, sin ninguna división"
```

---

### Task 3: `crearVenta` con dos invariantes

**Files:**
- Modify: `lib/ventas/crear.ts:16-31` (el tipo `PagoDeVenta`), `:145-186` (los planes), `:194-222` (las líneas), `:223-235` (el invariante), `:245-280` (el `create`)
- Test: `test/ventas.test.ts`

**Interfaces:**
- Consumes: `totalesDeItems`, `totalesDePagos`, `aporteDePago`, `montoEntregado`, `baseEnDolares`, `montoEnPesos` de Task 2.
- Produces: `PagoDeVenta` gana `cubre?: Moneda` (default `'ARS'` si no viene). `crearVenta` sigue devolviendo `{ id, numero }`.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/ventas.test.ts`, un `describe` nuevo. Reusá los helpers de alta de artículo y tenant que el archivo ya tiene.

```ts
describe('venta con artículos en dólares', () => {
  it('un carrito todo en dólares se cobra en dólares, sin ninguna cotización', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: iphone.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') }],
    })
    const v = await leerVenta(id)
    expect(v.total.toString()).toBe('0')
    expect(v.totalUsd.toString()).toBe('300')
    expect(v.items[0].moneda).toBe('USD')
    expect(v.pagos[0].cubre).toBe('USD')
    expect(v.pagos[0].monto.toString()).toBe('300')
  })

  it('un carrito mixto lleva los dos totales y cada pago cubre el suyo', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const funda = await crearArticulo({ nombre: 'Funda', precio: d('15000'), moneda: 'ARS' })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [
        { articuloId: iphone.id, cantidad: d('1') },
        { articuloId: funda.id, cantidad: d('1') },
      ],
      pagos: [
        { medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('300'), cotizacion: d('1') },
        { medio: 'TARJETA_DEBITO', moneda: 'ARS', cubre: 'ARS', base: d('15000'), cotizacion: d('1') },
      ],
    })
    const v = await leerVenta(id)
    expect(v.total.toString()).toBe('15000')
    expect(v.totalUsd.toString()).toBe('300')
  })

  it('pagar el total en dólares CON PESOS: se tipea la cotización y se cobran los pesos', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: iphone.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: d('300'), cotizacion: d('1485') }],
    })
    const v = await leerVenta(id)
    expect(v.totalUsd.toString()).toBe('300')
    expect(v.pagos[0].monto.toString()).toBe('445500')
    expect(v.pagos[0].moneda).toBe('ARS')
    expect(v.pagos[0].cubre).toBe('USD')
  })

  it('un plan de cuotas sobre el total en dólares cobra 623700 y aporta 300 exactos', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const plan = await crearPlan({ medio: 'TARJETA_CREDITO', nombre: '12 cuotas', porcentaje: d('40') })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: iphone.id, cantidad: d('1') }],
      pagos: [{
        medio: 'TARJETA_CREDITO', moneda: 'ARS', cubre: 'USD',
        base: d('300'), cotizacion: d('1485'), planId: plan.id,
      }],
    })
    const v = await leerVenta(id)
    expect(v.totalUsd.toString()).toBe('300')
    expect(v.recargo.toString()).toBe('178200')
    expect(v.pagos[0].monto.toString()).toBe('623700')
    expect(v.pagos[0].recargo.toString()).toBe('178200')
  })

  it('rechaza la venta si cierra en pesos pero no en dólares', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const funda = await crearArticulo({ nombre: 'Funda', precio: d('15000'), moneda: 'ARS' })
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [
          { articuloId: iphone.id, cantidad: d('1') },
          { articuloId: funda.id, cantidad: d('1') },
        ],
        pagos: [
          { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS', base: d('15000'), cotizacion: d('1') },
        ],
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })
  })

  it('sigue rechazando un plan sobre un pago ENTREGADO en dólares', async () => {
    const iphone = await crearArticulo({ nombre: 'iPhone', precio: d('300'), moneda: 'USD' })
    const plan = await crearPlan({ medio: 'TARJETA_CREDITO', nombre: '12 cuotas', porcentaje: d('40') })
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [{ articuloId: iphone.id, cantidad: d('1') }],
        pagos: [{
          medio: 'TARJETA_CREDITO', moneda: 'USD', cubre: 'USD',
          base: d('300'), cotizacion: d('1'), planId: plan.id,
        }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_EN_DOLARES' })
  })

  it('una venta SIN nada en dólares produce exactamente lo de siempre', async () => {
    const funda = await crearArticulo({ nombre: 'Funda', precio: d('15000'), moneda: 'ARS' })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: funda.id, cantidad: d('1') }],
      // Sin `cubre`: el default del tipo tiene que valer ARS.
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('15000'), cotizacion: d('1') }],
    })
    const v = await leerVenta(id)
    expect(v.total.toString()).toBe('15000')
    expect(v.totalUsd.toString()).toBe('0')
    expect(v.recargo.toString()).toBe('0')
    expect(v.pagos[0].cubre).toBe('ARS')
    expect(v.items[0].moneda).toBe('ARS')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run test/ventas.test.ts -t 'artículos en dólares'`
Expected: FAIL — `cubre` no existe en `PagoDeVenta`.

- [ ] **Step 3: Implementar**

**3a.** En el tipo `PagoDeVenta` (`lib/ventas/crear.ts:17`), ajustar el docblock de `base` y agregar `cubre`:

```ts
  /**
   * Lo que este pago cubre de la venta, A PRECIO DE LISTA. Va **en dólares si
   * el pago toca dólares de algún lado** (`moneda` o `cubre`), y en pesos si
   * no toca ninguno — ver `baseEnDolares` en totales.ts, que es donde vive esa
   * regla y por qué nada divide. NO es lo que entra a la caja: eso es
   * `montoEntregado(p) + recargo`, y lo calcula el servidor.
   */
  base: Prisma.Decimal
  cotizacion: Prisma.Decimal
  /**
   * Cuál de los dos totales paga esta fila. Ausente vale `ARS`, que es lo que
   * era toda venta antes de este ciclo — así ningún llamador viejo cambia.
   */
  cubre?: Moneda
```

**3b.** Normalizar `cubre` una sola vez, arriba del bucle de validación (`:79`), para no repetir el `?? 'ARS'` en cada uso:

```ts
  const pagosNormalizados = pagos.map((p) => ({ ...p, cubre: p.cubre ?? 'ARS' }))
```

y usar `pagosNormalizados` de ahí en adelante en lugar de `pagos`.

**3c.** La regla del plan (`:173-186`). Reemplazar la guarda y el cálculo del recargo:

```ts
        // Sólo la MONEDA, ya no también la cotización. Un pago en pesos que
        // cubre el total en dólares lleva la cotización de verdad, y el
        // recargo se calcula sobre los pesos que efectivamente se entregan
        // —`montoEntregado`—, así que la cuenta cierra igual y sin dividir.
        // Lo que sigue prohibido es el plan sobre un pago ENTREGADO en
        // dólares: ahí el recargo saldría en dólares y volver a pesos sí
        // exigiría una división.
        if (p.moneda !== 'ARS') {
          throw new ErrorDeVenta(
            'PLAN_EN_DOLARES',
            'un pago con plan tiene que entregarse en pesos: el recargo va sobre la parte en pesos',
          )
        }
        const enPesos = montoEntregado(p)
        const recargo = recargoDePago(enPesos, plan.recargoPorcentaje)
        return { ...p, recargo, monto: enPesos.add(recargo) }
```

y la rama sin plan (`:146-148`) pasa a:

```ts
        if (p.planId === undefined) {
          return { ...p, recargo: new Prisma.Decimal(0), monto: montoEntregado(p) }
        }
```

**3d.** Congelar la moneda en la línea (`:218`), junto a `precioUnitario`:

```ts
          precioUnitario: a.precio,
          moneda: a.moneda,
```

**3e.** Los dos invariantes (`:223-235`):

```ts
      const totales = totalesDeItems(lineas)
      // Contra las BASES y no contra los montos: el recargo no es mercadería.
      // Y ahora son DOS comparaciones, una por moneda: una venta que cierra en
      // pesos y no en dólares es tan inválida como la que no cierra a secas.
      const cubierto = totalesDePagos(pagosConRecargo)
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
```

**3f.** El `create` (`:245-280`): agregar `totalUsd: totales.usd` junto a `total: totales.ars`, `moneda: l.moneda` en cada ítem, y `cubre: p.cubre` en cada pago. **Campo por campo**, como el resto del bloque — nada de `...p`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS, **incluidos los casos viejos**. Si alguno viejo falla, la normalización de `cubre` no está cubriendo un camino.

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/crear.ts test/ventas.test.ts
git commit -m "feat(usd): crearVenta con dos invariantes, uno por moneda"
```

---

### Task 4: El bug que el modelo destapa — `pesosEntregados` en las lecturas

Un pago en pesos que cubre el total en dólares lleva `cotizacion = 1485` y `monto` ya en pesos. Los dos lugares que hoy hacen `montoEnPesos(monto, cotizacion)` sobre una fila guardada lo multiplicarían de nuevo.

**Files:**
- Modify: `lib/ventas/composicion.ts:73`
- Modify: `app/(app)/ventas/[id]/page.tsx:733`
- Test: `lib/ventas/composicion.test.ts`

**Interfaces:**
- Consumes: `pesosEntregados` de Task 2.
- Produces: nada nuevo.

- [ ] **Step 1: Escribir el test que falla**

En `lib/ventas/composicion.test.ts`:

```ts
it('un pago en PESOS que cubre el total en dólares no se multiplica dos veces', () => {
  // moneda ARS + cotizacion 1485: `monto` ya está en pesos. Con `montoEnPesos`
  // esto daba 926.194.500.
  const c = componerPorMedio([
    { medio: 'TARJETA_CREDITO', moneda: 'ARS', monto: d('623700'), cotizacion: d('1485'), _count: 1 },
  ])
  expect(c.barras[0].total).toBe('623700')
  expect(c.hayDolares).toBe(false)
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/ventas/composicion.test.ts`
Expected: FAIL — recibe `926194500`.

- [ ] **Step 3: Implementar**

En `lib/ventas/composicion.ts`, cambiar el import de `montoEnPesos` por `pesosEntregados` y la línea 73:

```ts
    // `pesosEntregados` y no `montoEnPesos`: un pago en pesos vale su monto
    // aunque su cotización no sea 1 — que es lo que pasa desde que un pago en
    // pesos puede cubrir el total en dólares. Ver su docblock en totales.ts.
    const enPesos = pesosEntregados(f).mul(f._count)
```

En `app/(app)/ventas/[id]/page.tsx:733`, el mismo cambio:

```ts
      enPesosFormateado: formatearPrecio(pesosEntregados(p).toString()),
```

y actualizar el import de `:15` y el comentario de `:566` que nombra `montoEnPesos()`.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/ventas/composicion.test.ts && npx tsc --noEmit`
Expected: PASS y typecheck limpio.

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/composicion.ts lib/ventas/composicion.test.ts "app/(app)/ventas/[id]/page.tsx"
git commit -m "fix(usd): un pago en pesos vale su monto aunque su cotización no sea 1"
```

---

### Task 5: El espejo en el navegador

`lib/ventas/centavos.ts` es lo que decide si el botón "Cobrar" se habilita. Tiene que dar exactamente lo mismo que Task 2.

**Files:**
- Modify: `lib/ventas/centavos.ts`
- Test: `lib/ventas/centavos.test.ts`

**Interfaces:**
- Consumes: `aCentavos`, `pesosDePagoEnCentavos`, `subtotalEnCentavos` (ya existen).
- Produces:
  - `type TotalesEnCentavos = { ars: number; usd: number }`
  - `baseEnDolaresCentavos(p: { moneda: 'ARS' | 'USD'; cubre: 'ARS' | 'USD' }): boolean`
  - `aporteEnCentavos(p: { moneda; cubre; baseCentavos: number; cotizacionDiezMilesimas: number }): number`
  - `montoEntregadoEnCentavos(p: {…igual…}): number`
  - `totalesEnCentavos(lineas: { cantidadMilesimas: number; precioCentavos: number; moneda: 'ARS'|'USD' }[]): TotalesEnCentavos`
  - `totalesDePagosEnCentavos(pagos: […]): TotalesEnCentavos`

**No borres** `totalEnCentavos` ni `totalDePagosEnCentavos`: `centavos.test.ts` los usa como ancla contra el servidor.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/ventas/centavos.test.ts`, un bloque nuevo que compara **las dos aritméticas caso por caso**, que es el patrón que ese archivo ya usa:

```ts
describe('aporteEnCentavos espeja a aporteDePago', () => {
  const casos = [
    { moneda: 'ARS', cubre: 'ARS', base: '15000', cotizacion: '1' },
    { moneda: 'USD', cubre: 'ARS', base: '300', cotizacion: '1485' },
    { moneda: 'USD', cubre: 'USD', base: '300', cotizacion: '1' },
    { moneda: 'ARS', cubre: 'USD', base: '300', cotizacion: '1485' },
    { moneda: 'USD', cubre: 'ARS', base: '0.05', cotizacion: '1485.3333' },
  ] as const

  it.each(casos)('mismo aporte y mismo monto entregado: %j', (c) => {
    const delServidor = aporteDePago({
      moneda: c.moneda, cubre: c.cubre,
      base: new Prisma.Decimal(c.base), cotizacion: new Prisma.Decimal(c.cotizacion),
    })
    const delCliente = aporteEnCentavos({
      moneda: c.moneda, cubre: c.cubre,
      baseCentavos: aCentavos(c.base),
      cotizacionDiezMilesimas: aDiezMilesimas(c.cotizacion),
    })
    expect(delCliente).toBe(aCentavos(delServidor.toString()))

    const entregadoServidor = montoEntregado({
      moneda: c.moneda, cubre: c.cubre,
      base: new Prisma.Decimal(c.base), cotizacion: new Prisma.Decimal(c.cotizacion),
    })
    const entregadoCliente = montoEntregadoEnCentavos({
      moneda: c.moneda, cubre: c.cubre,
      baseCentavos: aCentavos(c.base),
      cotizacionDiezMilesimas: aDiezMilesimas(c.cotizacion),
    })
    expect(entregadoCliente).toBe(aCentavos(entregadoServidor.toString()))
  })
})

describe('totalesEnCentavos', () => {
  it('parte el carrito por moneda', () => {
    const t = totalesEnCentavos([
      { cantidadMilesimas: 2000, precioCentavos: 750000, moneda: 'ARS' },
      { cantidadMilesimas: 1000, precioCentavos: 30000, moneda: 'USD' },
    ])
    expect(t.ars).toBe(1500000)
    expect(t.usd).toBe(30000)
  })

  it('una cantidad en NaN envenena SÓLO su moneda', () => {
    const t = totalesEnCentavos([
      { cantidadMilesimas: NaN, precioCentavos: 750000, moneda: 'ARS' },
      { cantidadMilesimas: 1000, precioCentavos: 30000, moneda: 'USD' },
    ])
    expect(Number.isNaN(t.ars)).toBe(true)
    expect(t.usd).toBe(30000)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/ventas/centavos.test.ts`
Expected: FAIL — las funciones no existen.

- [ ] **Step 3: Implementar**

En `lib/ventas/centavos.ts`, después de `totalDePagosEnCentavos`. **Este archivo no importa Prisma** (lo importa un componente cliente), así que la moneda se tipea a mano:

```ts
/** La moneda, escrita a mano: este archivo NO puede importar Prisma. */
type MonedaTexto = 'ARS' | 'USD'

/** Los dos totales del carrito, en centavos de su propia moneda. */
export type TotalesEnCentavos = { ars: number; usd: number }

type FilaDePagoCentavos = {
  moneda: MonedaTexto
  cubre: MonedaTexto
  baseCentavos: number
  cotizacionDiezMilesimas: number
}

/** Espeja a `baseEnDolares` de totales.ts. */
export function baseEnDolaresCentavos(p: { moneda: MonedaTexto; cubre: MonedaTexto }): boolean {
  return p.moneda === 'USD' || p.cubre === 'USD'
}

/** Espeja a `aporteDePago` de totales.ts, incluido cuándo multiplica y cuándo no. */
export function aporteEnCentavos(p: FilaDePagoCentavos): number {
  if (p.cubre === 'ARS' && baseEnDolaresCentavos(p)) {
    return pesosDePagoEnCentavos(p.baseCentavos, p.cotizacionDiezMilesimas)
  }
  return p.baseCentavos
}

/** Espeja a `montoEntregado` de totales.ts. */
export function montoEntregadoEnCentavos(p: FilaDePagoCentavos): number {
  if (p.moneda === 'ARS' && baseEnDolaresCentavos(p)) {
    return pesosDePagoEnCentavos(p.baseCentavos, p.cotizacionDiezMilesimas)
  }
  return p.baseCentavos
}

/**
 * Los dos totales del carrito, igual que `totalesDeItems`.
 *
 * Un NaN envenena SÓLO la moneda de la línea inválida, y eso es a propósito:
 * una cantidad a medio tipear en la funda no tiene por qué apagar el total en
 * dólares del iPhone de al lado.
 */
export function totalesEnCentavos(
  lineas: { cantidadMilesimas: number; precioCentavos: number; moneda: MonedaTexto }[],
): TotalesEnCentavos {
  return lineas.reduce<TotalesEnCentavos>(
    (acc, l) => {
      const sub = subtotalEnCentavos(l.cantidadMilesimas, l.precioCentavos)
      return l.moneda === 'USD' ? { ...acc, usd: acc.usd + sub } : { ...acc, ars: acc.ars + sub }
    },
    { ars: 0, usd: 0 },
  )
}

/** Lo que los pagos cubren, acumulado por moneda. Espeja a `totalesDePagos`. */
export function totalesDePagosEnCentavos(pagos: FilaDePagoCentavos[]): TotalesEnCentavos {
  return pagos.reduce<TotalesEnCentavos>(
    (acc, p) => {
      const a = aporteEnCentavos(p)
      return p.cubre === 'USD' ? { ...acc, usd: acc.usd + a } : { ...acc, ars: acc.ars + a }
    },
    { ars: 0, usd: 0 },
  )
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/ventas/centavos.test.ts`
Expected: PASS. Si el caso `0.05 × 1485.3333` falla, las dos aritméticas redondean en momentos distintos — arreglá el cliente, nunca el servidor.

- [ ] **Step 5: Verificar que el cliente no arrastró Prisma**

Run: `npx vitest run test/limite-cliente-servidor.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/centavos.ts lib/ventas/centavos.test.ts
git commit -m "feat(usd): el espejo en enteros de aporteDePago y los dos totales"
```

---

### Task 6: `moneda` en el alta, la edición y la búsqueda

**Files:**
- Modify: `lib/inventario/articulos.ts:1-120` (`EntradaCrearArticulo`, `crearArticulo`), `:340-347` (`editarArticulo`)
- Modify: `lib/ventas/buscar.ts` (el `select` de `buscarArticulosVendibles`; borrar `ultimaCotizacionUsd`)
- Test: `test/inventario.test.ts`, `test/ventas.test.ts:1256`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `EntradaCrearArticulo` gana `moneda?: Moneda` (default `'ARS'`); `editarArticulo` gana `moneda: Moneda` **requerido**; los resultados de `buscarArticulosVendibles` ganan `moneda: 'ARS' | 'USD'`.

`moneda` va **requerido** en `editarArticulo` por lo mismo que `categoriaId` quedó requerido en el ciclo del 2026-08-28: con un campo opcional, un llamador que lo omita por descuido no da ningún error y deja la moneda vieja en silencio.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/inventario.test.ts`:

```ts
it('un artículo se puede crear en dólares', async () => {
  const a = await crearArticulo({ tenantId, usuarioId, nombre: 'iPhone', tipo: 'PRODUCTO', precio: d('300'), moneda: 'USD' })
  expect((await leerArticulo(a.id)).moneda).toBe('USD')
})

it('sin moneda se crea en pesos', async () => {
  const a = await crearArticulo({ tenantId, usuarioId, nombre: 'Funda', tipo: 'PRODUCTO', precio: d('15000') })
  expect((await leerArticulo(a.id)).moneda).toBe('ARS')
})

it('editar cambia la moneda sin tocar el precio', async () => {
  const a = await crearArticulo({ tenantId, usuarioId, nombre: 'iPhone', tipo: 'PRODUCTO', precio: d('300') })
  await editarArticulo({ tenantId, articuloId: a.id, nombre: 'iPhone', sku: a.sku, precio: d('300'), categoriaId: null, moneda: 'USD' })
  const leido = await leerArticulo(a.id)
  expect(leido.moneda).toBe('USD')
  expect(leido.precio.toString()).toBe('300')
})
```

En `test/ventas.test.ts`, dentro del describe de `buscarArticulosVendibles`:

```ts
it('el resultado dice en qué moneda está el precio', async () => {
  await crearArticulo({ tenantId, usuarioId, nombre: 'iPhone', tipo: 'PRODUCTO', precio: d('300'), moneda: 'USD' })
  const [r] = await buscarArticulosVendibles(tenantId, 'iPhone')
  expect(r.moneda).toBe('USD')
})
```

Y **borrá** el `describe('ultimaCotizacionUsd', …)` entero (`test/ventas.test.ts:1256-1279`) más su import y su asignación en el `beforeAll` (`:19`, `:57`).

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run test/inventario.test.ts test/ventas.test.ts`
Expected: FAIL — `moneda` no es una propiedad válida.

- [ ] **Step 3: Implementar**

En `lib/inventario/articulos.ts`, agregar a `EntradaCrearArticulo`:

```ts
  /**
   * En qué moneda está `precio`. Ausente vale pesos, que es lo que era todo
   * artículo antes de este ciclo. Opcional acá y REQUERIDO en `editarArticulo`
   * a propósito: el alta tiene un default sensato, y una edición que omita el
   * campo estaría dejando la moneda vieja sin que nadie lo haya decidido.
   */
  moneda?: Moneda
```

y pasarla al `create`: `moneda: entrada.moneda ?? 'ARS'`.

En `editarArticulo`, agregar `moneda: Moneda` al tipo de entrada y al `update`.

En `lib/ventas/buscar.ts`: sumar `moneda: true` al `select` de `buscarArticulosVendibles` y al tipo que devuelve; **borrar** `ultimaCotizacionUsd()` entera.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run test/inventario.test.ts test/ventas.test.ts && npx tsc --noEmit`
Expected: PASS. El typecheck va a marcar `app/(app)/vender/page.tsx`, que todavía importa `ultimaCotizacionUsd` — se arregla en Task 10. Si querés el árbol verde en cada commit, hacé el borrado del import acá y dejá la prop `cotizacionInicial={null}`.

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/articulos.ts lib/ventas/buscar.ts test/inventario.test.ts test/ventas.test.ts
git commit -m "feat(usd): moneda en el alta, la edición y el buscador de artículos"
```

---

### Task 7: `SelectorDeMoneda`, un solo control para las dos pantallas

**Files:**
- Create: `components/selector-de-moneda.tsx`
- Modify: `app/(app)/inventario/formularios.tsx:210-220` (alta), `:480-490` (ficha)
- Modify: `app/(app)/inventario/acciones.ts` (leer `moneda` del `FormData` en las dos acciones)
- Test: `app/(app)/inventario/formularios.test.tsx`

**Interfaces:**
- Consumes: `editarArticulo` / `crearArticulo` con `moneda` (Task 6).
- Produces: `<SelectorDeMoneda name="moneda" valorInicial={'ARS' | 'USD'} id={string} />`, un `Select` de shadcn que emite `ARS`/`USD` por un `<input type="hidden">` con ese `name`.

**Un solo componente para las dos pantallas, no dos.** Es la lección directa del ciclo del 2026-08-28: la categoría terminó en `SelectorDeCategoria` después de que la ficha y el alta se desincronizaran durante cuatro días con el gate entero en verde.

- [ ] **Step 1: Escribir el test que falla**

En `app/(app)/inventario/formularios.test.tsx`:

```ts
describe('el selector de moneda está en las DOS pantallas', () => {
  const fuente = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')

  it('lo instancian el alta y la ficha, y ninguna arma su propio Select', () => {
    const apariciones = fuente.match(/<SelectorDeMoneda/g) ?? []
    expect(apariciones).toHaveLength(2)
  })

  it('el alta arranca en pesos y la ficha precarga la del artículo', () => {
    expect(fuente).toContain('<SelectorDeMoneda id="moneda" name="moneda" valorInicial="ARS"')
    expect(fuente).toContain('<SelectorDeMoneda id="e-moneda" name="moneda" valorInicial={moneda}')
  })
})
```

Y un caso de render del propio componente:

```ts
it('avisa al pasar de pesos a dólares, porque el número no se reinterpreta solo', () => {
  const html = renderToStaticMarkup(<SelectorDeMoneda id="m" name="moneda" valorInicial="USD" />)
  expect(html).toContain('name="moneda"')
  expect(html).toContain('value="USD"')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run "app/(app)/inventario/formularios.test.tsx"`
Expected: FAIL — el componente no existe.

- [ ] **Step 3: Crear el componente**

`components/selector-de-moneda.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/**
 * En qué moneda está el precio de un artículo.
 *
 * **Un solo componente para el alta y para la ficha**, y no dos controles que
 * haya que acordarse de sincronizar. Es la lección directa del ciclo del
 * 2026-08-28: la categoría vivió cuatro días con dos implementaciones
 * distintas —un par de selectores en el alta y un campo de texto en la
 * ficha—, el gate entero en verde, y lo reportó un cliente.
 *
 * Emite por un `<input type="hidden">` porque `Select` de Radix no renderiza
 * ningún `<select>` nativo: el trigger es un `<button>`, y sin el hidden el
 * `FormData` del server action llegaría sin el campo.
 *
 * Cambiar de moneda AVISA y no impide: pasar 300 de dólares a pesos hace que
 * el número diga otra cosa, y ninguna validación puede distinguir eso de un
 * cambio deliberado. La decisión es de quien carga el precio, no del control.
 */
export function SelectorDeMoneda({
  id,
  name,
  valorInicial,
}: {
  id: string
  name: string
  valorInicial: 'ARS' | 'USD'
}) {
  const [moneda, setMoneda] = useState(valorInicial)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex">
        <Select value={moneda} onValueChange={(v) => setMoneda(v as 'ARS' | 'USD')}>
          <SelectTrigger id={id} aria-label="Moneda del precio" className="h-9! w-[86px] rounded-r-none border-r-0 text-[13px] font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">$</SelectItem>
            <SelectItem value="USD">US$</SelectItem>
          </SelectContent>
        </Select>
        <input type="hidden" name={name} value={moneda} />
      </div>
      {moneda !== valorInicial && (
        <p className="text-xs text-muted-foreground">
          El precio no se convierte: {valorInicial === 'ARS' ? 'lo que estaba en pesos ahora se lee en dólares' : 'lo que estaba en dólares ahora se lee en pesos'}.
        </p>
      )}
    </div>
  )
}
```

El `w-[86px]` es menor a 362, así que **no** necesita prefijo `lg:`.

- [ ] **Step 4: Instanciarlo en las dos pantallas**

En `app/(app)/inventario/formularios.tsx`, envolver el input de precio del **alta** (`:210-220`) y el de la **ficha** (`:480-490`) en un `flex` con el selector a la izquierda, pegado (el input pierde su radio izquierdo: `rounded-l-none`). Los `id` son `moneda` y `e-moneda`, siguiendo la convención `e-` que la ficha ya usa.

`FichaDeArticulo` recibe `moneda: 'ARS' | 'USD'` como prop nueva, y su `page.tsx` se la pasa desde el artículo.

En `app/(app)/inventario/acciones.ts`, las dos acciones leen `formData.get('moneda')` y lo validan contra `['ARS','USD']` antes de pasarlo — un valor que no sea ninguno de los dos es un `FormData` armado a mano, y cae en el error genérico de la acción.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/inventario/formularios.test.tsx" && npx tsc --noEmit && npx vitest run test/responsive.test.ts`
Expected: PASS los tres.

- [ ] **Step 6: Commit**

```bash
git add components/selector-de-moneda.tsx "app/(app)/inventario/formularios.tsx" "app/(app)/inventario/acciones.ts" "app/(app)/inventario/formularios.test.tsx"
git commit -m "feat(usd): un solo selector de moneda para el alta y la ficha"
```

---

### Task 8: `/inventario` muestra cada precio en su moneda

**Files:**
- Modify: `app/(app)/inventario/page.tsx` (la columna Precio del listado)
- Modify: `app/(app)/inventario/[id]/page.tsx` (los tiles "Precio de venta" y "Último costo", `textoDeMargen`)
- Modify: `lib/formato/mostrar.ts` si `formatearDolares` no está exportado desde ahí (`/ventas/[id]` ya lo usa — reusalo, no escribas otro)
- Test: `app/(app)/inventario/page.test.tsx`, `app/(app)/inventario/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `Articulo.moneda` (Task 1), `formatearPrecio` / `formatearDolares` de `lib/formato/mostrar.ts`.
- Produces: nada que otra task consuma.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('el listado muestra el precio en dólares con US$', async () => {
  const html = await renderListado([{ nombre: 'iPhone', precio: '300', moneda: 'USD' }])
  expect(html).toContain('US$')
  expect(html).not.toContain('$ 300,00<') // no lo muestra como si fueran pesos
})

it('la ficha de un artículo en dólares deja el margen en —', async () => {
  // El costo se guarda en pesos (MovimientoStock.costoUnitario) y no hay
  // contra qué compararlo sin una cotización.
  expect(textoDeMargen({ precio: d('300'), moneda: 'USD' }, d('150000'))).toBe('—')
})

it('la ficha de un artículo en pesos sigue calculando el margen igual que antes', () => {
  expect(textoDeMargen({ precio: d('20000'), moneda: 'ARS' }, d('15000'))).toBe('25 %')
})
```

Ajustá la firma esperada de `textoDeMargen` a la que el archivo ya tiene; lo que cambia es que ahora recibe la moneda.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run "app/(app)/inventario"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Una sola función de formateo, usada en los dos lugares:

```ts
/**
 * El precio de un artículo, en su moneda y SIN equivalente en pesos.
 *
 * Fuera de una venta no hay ninguna cotización de la cual derivarlo, y un
 * número inventado es peor que ninguno — la misma regla por la que el chip de
 * cotización del header de /vender muestra "—" en vez de fabricar un valor.
 */
export function precioEnSuMoneda(precio: string, moneda: 'ARS' | 'USD'): string {
  return moneda === 'USD' ? formatearDolares(precio) : formatearPrecio(precio)
}
```

`textoDeMargen` devuelve `'—'` cuando `moneda === 'USD'`, con el comentario de por qué (el costo es en pesos; es la costura con la deuda del costo, no un olvido).

El tile "Precio de venta" y el precio derivado de un plan (`precioConPlan`) usan `precioEnSuMoneda`: el recargo es un porcentaje, así que US$ 300 al 40 % son US$ 420, que es exactamente el equivalente de los $623.700 del mostrador.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/inventario" && npx vitest run test/pantallas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/inventario" lib/formato/mostrar.ts
git commit -m "feat(usd): el inventario muestra cada precio en su moneda"
```

---

### Task 9: El carrito de `/vender` con dos totales

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx:615-680` (el cálculo), `:1500-1560` (la banda de total)
- Test: `app/(app)/vender/punto-de-venta.test.tsx`

**Interfaces:**
- Consumes: `totalesEnCentavos` (Task 5), `moneda` en los resultados del buscador (Task 6).
- Produces: `LineaDeCarrito` gana `moneda: 'ARS' | 'USD'`; el componente calcula `totales: TotalesEnCentavos` en vez de `totalCentavos`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('un carrito todo en pesos muestra UNA sola línea de total, igual que antes', () => {
  const html = render(<PuntoDeVenta {...props} lineasIniciales={[funda]} />)
  expect(lineasDeTotal(html)).toHaveLength(1)
})

it('un carrito mixto muestra las dos', () => {
  const html = render(<PuntoDeVenta {...props} lineasIniciales={[funda, iphone]} />)
  const lineas = lineasDeTotal(html)
  expect(lineas).toHaveLength(2)
  expect(lineas.join(' ')).toContain('US$')
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`enCentavos` suma `moneda: l.moneda`; `totalCentavos` pasa a `const totales = totalesEnCentavos(enCentavos)`. La banda de `--marca` renderiza **una línea por moneda con total distinto de cero**, y si sólo hay una, se ve exactamente como hoy.

Cuidado con dos cosas que ya están escritas en ese archivo y que hay que preservar:
- `hayCarrito` exigía `totalCentavos > 0`; ahora es `totales.ars > 0 || totales.usd > 0`.
- El `useEffect` que sincroniza el primer pago con el total (`:662-680`) tiene que sincronizar contra el total de la moneda que ese pago cubre, no contra "el total".

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/vender"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/vender/punto-de-venta.tsx" "app/(app)/vender/punto-de-venta.test.tsx"
git commit -m "feat(usd): el carrito muestra una línea de total por moneda"
```

---

### Task 10: El panel de cobro — `Cubre`, dos chips y la cotización vacía

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx:2061-2260` (la fila de pago), `:880-900` (faltante), `:1690-1700` (los chips)
- Modify: `app/(app)/vender/page.tsx:2,17,22,49` (borrar `cotizacionInicial`)
- Modify: `app/(app)/vender/acciones.ts` (el payload gana `cubre`)
- Test: `app/(app)/vender/punto-de-venta.test.tsx`

**Interfaces:**
- Consumes: `aporteEnCentavos`, `totalesDePagosEnCentavos`, `montoEntregadoEnCentavos` (Task 5); `PagoDeVenta.cubre` (Task 3).
- Produces: el tipo `Pago` del cliente gana `cubre: 'ARS' | 'USD'`; el JSON que viaja al server action lleva `base`, `cotizacion`, `planId` y `cubre`.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('el selector Cubre aparece sólo cuando la venta tiene los DOS totales', () => {
  expect(render(<PuntoDeVenta {...props} lineasIniciales={[funda]} />)).not.toContain('Cubre')
  expect(render(<PuntoDeVenta {...props} lineasIniciales={[iphone]} />)).not.toContain('Cubre')
  expect(render(<PuntoDeVenta {...props} lineasIniciales={[funda, iphone]} />)).toContain('Cubre')
})

it('la cotización arranca VACÍA, nunca precargada', () => {
  const html = render(<PuntoDeVenta {...props} lineasIniciales={[iphone]} pagosIniciales={[pagoArsCubriendoUsd]} />)
  expect(html).toMatch(/id="cot-0"[^>]*value=""/)
})

it('hay un chip de faltante por moneda que la venta tenga', () => {
  const html = render(<PuntoDeVenta {...props} lineasIniciales={[funda, iphone]} />)
  expect(chipsDeFaltante(html)).toHaveLength(2)
})

it('cambiar cubre limpia el plan', () => {
  // Igual que cambiar el medio o la moneda: un plan que sobreviva a un cambio
  // que lo vuelve inválido es un error del motor con la pantalla en verde.
  expect(fuente).toContain("onCambiar({ cubre: valor as Pago['cubre'], planId: null })")
})

it('el renglón "A cobrar" usa montoEntregadoEnCentavos, no la base', () => {
  expect(fuente).toContain('montoEntregadoEnCentavos(')
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- El tipo `Pago` del cliente gana `cubre: 'ARS' | 'USD'`, arrancando en `'ARS'`.
- El `<Select>` de `Cubre` se dibuja **sólo si** `totales.ars > 0 && totales.usd > 0`, entre el de moneda y el de plan. Sus dos opciones se rotulan "total en pesos" y "total en dólares". `onValueChange` limpia el plan, igual que los otros dos selectores.
- Los campos de la fila salen de `baseEnDolaresCentavos({ moneda, cubre })`: el rótulo del monto es "Monto" cuando no cruza y "Cubre US$" cuando sí; el campo de cotización se dibuja **sólo cuando cruza** (`moneda !== cubre`).
- `entranPesosCentavos` se reemplaza por `montoEntregadoEnCentavos`, y con eso **las dos funciones de fila cambian de firma**: pasan a recibir la fila entera, porque ya no alcanza con la base y la cotización para saber cuántos pesos entran.

```ts
type FilaDePagoDeLaPantalla = {
  moneda: 'ARS' | 'USD'
  cubre: 'ARS' | 'USD'
  base: string
  cotizacion: string
  planId: string | null
}

/** Los pesos que ESTA fila entrega, antes del recargo. */
function pesosDeLaFilaEnCentavos(pago: FilaDePagoDeLaPantalla): number {
  return montoEntregadoEnCentavos({
    moneda: pago.moneda,
    cubre: pago.cubre,
    baseCentavos: dineroEnCentavos(pago.base),
    cotizacionDiezMilesimas: cotizacionEnDiezMilesimas(pago.cotizacion),
  })
}

export function recargoDeLaFilaEnCentavos(
  pago: FilaDePagoDeLaPantalla,
  planes: PlanVisible[],
): number {
  const plan = planes.find((p) => p.id === pago.planId)
  if (!plan) return 0
  return recargoEnCentavos(pesosDeLaFilaEnCentavos(pago), porcentajeEnMilesimas(plan.porcentaje))
}

export function aCobrarDeLaFilaEnCentavos(
  pago: FilaDePagoDeLaPantalla,
  planes: PlanVisible[],
): number {
  return pesosDeLaFilaEnCentavos(pago) + recargoDeLaFilaEnCentavos(pago, planes)
}
```

  **Es lo que evita el bug de plata que el merge del 2026-08-28 ya destapó una vez**: el chip de vuelto tiene que restar lo que hay que cobrar por esa fila, no la base. Actualizá también `lineasDelPieDeCobro` y `planesOfrecidos`, que reciben el mismo tipo de fila.
- `faltanCentavos` pasa a ser dos números (`faltan.ars`, `faltan.usd`) contra `totalesDePagosEnCentavos`. `cierra` exige que las dos den cero. `hayFaltanteDeVenta` se aplica a cada una y el vuelto sigue apagándose si **alguna** falta.
- `<ChipDeFaltante>` se renderiza una vez por moneda con total distinto de cero.
- Borrar `cotizacionInicial` de toda la cadena: import y llamada en `page.tsx`, las dos declaraciones de prop en `punto-de-venta.tsx` (`:505`, `:511`, `:2061`, `:2070`), el paso en `:1632`, y el `?? '1'` de `:2147`, que pasa a `''`.
- El JSON escondido del `<form>` lleva `cubre` por pago. **Verificá el nombre del campo con los ojos**: el merge del 2026-08-28 dejó `monto:` donde iba `base:` y `tsc` no lo vio, porque es un objeto literal que viaja como JSON.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/vender" && npx tsc --noEmit && npx vitest run test/responsive.test.ts`
Expected: PASS los tres.

- [ ] **Step 5: Verificar la copia móvil**

El pie fijo del teléfono (`PieDeVenta` / `PieDeTotales`) muestra los mismos totales que la card de escritorio. Si agregaste una línea a uno y no al otro, el caso que cuenta las dos apariciones tiene que fallar.

Run: `npx vitest run test/permisos-en-las-dos-copias.test.ts "app/(app)/vender"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/vender"
git commit -m "feat(usd): cada pago declara qué total cubre, y la cotización arranca vacía"
```

---

### Task 11: `/ventas` y `/ventas/[id]` con los dos totales

**Files:**
- Modify: `app/(app)/ventas/page.tsx:779-800` (el tile), `:950-960` (la columna Total)
- Modify: `app/(app)/ventas/[id]/page.tsx:71-95` (el pie), la tabla de ítems y la de pagos
- Test: `app/(app)/ventas/page.test.tsx`, `app/(app)/ventas/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `Venta.totalUsd`, `VentaItem.moneda`, `Pago.cubre` (Task 1); `totalCobrado` (sin cambios).
- Produces: nada que otra task consuma.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('el tile Total del período muestra los dos números cuando hay ventas en dólares', async () => {
  const html = await renderListado(ventasMixtas)
  expect(html).toContain('US$')
})

it('el tile muestra UN solo número cuando no hay ninguna venta en dólares', async () => {
  const html = await renderListado(ventasSoloPesos)
  expect(html).not.toContain('US$')
})

it('la columna Total de una venta mixta muestra las dos monedas', async () => {
  const html = await renderListado([ventaMixta])
  expect(filaDeVenta(html)).toContain('US$')
})

it('el detalle dice qué total cubrió cada pago', async () => {
  const html = await renderDetalle(ventaConPagoArsCubriendoUsd)
  expect(html).toContain('total en dólares')
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run "app/(app)/ventas"`
Expected: FAIL.

- [ ] **Step 3: Implementar**

- El tile suma `totalCobrado(v)` para los pesos (sin cambios) **y** `totalUsd` aparte. La línea de dólares se dibuja sólo si la suma es distinta de cero — un local sin dólares ve el tile exactamente como hoy.
- La columna Total de cada fila muestra las monedas que esa venta tenga, unidas por `+`.
- El detalle: cada ítem con su moneda; el pie con las dos líneas de mercadería cuando corresponda; cada pago con qué total cubrió (sólo cuando `cubre !== 'ARS'` o la venta tiene los dos totales, para no ensuciar el caso común).

**El recargo se suma del lado de los pesos**, incluso cuando el pago cubría el total en dólares: `Pago.recargo` es en pesos por diseño (ver Task 3). Dejá el comentario que lo diga.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run "app/(app)/ventas" && npx vitest run test/responsive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/ventas"
git commit -m "feat(usd): /ventas muestra los dos totales sin convertir nada"
```

---

### Task 12: La documentación y el seed

**Files:**
- Modify: `docs/pantallas.md` (secciones `/inventario`, `/inventario/[id]`, `/inventario/nuevo`, `/vender`, `/ventas`, `/ventas/[id]`)
- Modify: `CLAUDE.md` (una entrada nueva en *Próximos pasos técnicos* y la corrección de significado de `Articulo.precio`)
- Modify: `scripts/sembrar-catalogo-dev.mts`
- Test: `test/pantallas.test.ts` (ya existe; tiene que seguir pasando)

- [ ] **Step 1: Sembrar un artículo en dólares**

En `scripts/sembrar-catalogo-dev.mts`, al menos un artículo con `moneda: 'USD'` y un precio de tres dígitos, para que la verificación manual tenga contra qué mirar. Importes de **distinta cantidad de dígitos** entre los artículos: con montos parejos no se ve si las columnas de números bailan.

- [ ] **Step 2: Actualizar `docs/pantallas.md`**

Una sección por pantalla tocada, con las decisiones no obvias: el selector compartido, el margen en `—`, el `Cubre` que aparece sólo con los dos totales, la cotización vacía, los dos chips de faltante, y que nada se convierte en `/ventas`.

- [ ] **Step 3: Actualizar `CLAUDE.md`**

Una entrada nueva en *Próximos pasos técnicos*, en el estilo de las existentes: el origen (el feedback textual), las cinco decisiones con su alternativa descartada, **el cambio de significado de `Articulo.precio`** —que ninguna migración anuncia—, el bug de `pesosEntregados` que el ciclo destapó, y lo que queda pendiente (el costo en dólares, el `DROP` del índice de `Pago`, y la verificación manual después del merge).

- [ ] **Step 4: Correr la suite completa**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: cero fallas en los tres. `test/pantallas.test.ts` ata `docs/pantallas.md` a `app/**/page.tsx` en las dos direcciones.

- [ ] **Step 5: Commit**

```bash
git add docs/pantallas.md CLAUDE.md scripts/sembrar-catalogo-dev.mts
git commit -m "docs(usd): las decisiones del ciclo y el cambio de significado de precio"
```

---

## Verificación manual (después del merge, no antes)

`arandano-dev` bind-montea `/root/arandano`, no el worktree, así que esto va **después** de integrar. Con el catálogo sembrado y entrando por el subdominio del tenant (`flor.localhost:3000`, nunca por la IP pelada, que devuelve 404 a propósito):

- El selector de moneda precarga la del artículo al abrir la ficha, y el aviso aparece al cambiarla.
- Un carrito sólo con la funda se ve **exactamente** como antes: un total, sin `Cubre`, sin chip de más.
- Un carrito mixto muestra los dos totales y los dos chips de faltante.
- El campo de cotización arranca **vacío**.
- Cubrir los US$ 300 con pesos y un plan de 12 cuotas al 40 % cobra **$623.700** y deja la venta cerrada.
- La ficha del iPhone muestra `US$ 300`, el margen en `—`, y el precio con plan en `US$ 420`.
- `/ventas` muestra los dos números en el tile y `US$` en la fila de la venta en dólares.
