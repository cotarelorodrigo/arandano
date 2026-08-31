# Lo vendido y lo cobrado, cada moneda por separado — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `/ventas` y `/ventas/[id]` muestren, además de la mercadería a
precio de lista, **la plata que entró en cada moneda** — para que una venta de
US$ 300 cobrada US$ 200 en billetes más el resto en pesos deje de aparecer como
si hubiera entrado entera en dólares.

**Architecture:** presentación pura. El dato ya está completo en `Pago`: la
plata que entró es `Σ Pago.monto` apilado por `Pago.moneda`. Un archivo nuevo
—`lib/ventas/cobrado.ts`— concentra las dos magnitudes ("Vendido" y "Cobrado"),
la regla que decide una línea o dos, y el formato; las tres pantallas lo
consumen. **Sin migración**: no se crea, borra ni cambia ninguna columna.

**Tech Stack:** TypeScript, Next.js App Router (Server Components), Prisma,
`Prisma.Decimal` para toda la plata, Vitest (con Postgres efímero levantado por
`test/global-setup.ts`), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-31-cobrado-por-moneda-design.md`

## Global Constraints

Copiadas del spec y de `CLAUDE.md`. Valen para **todas** las tasks.

- **Toda la plata es `Prisma.Decimal`. Nunca `number` con decimales.** Ni
  `Number()`, ni `toFixed(2)`, ni aritmética de punto flotante sobre importes.
  Ya costó un bug real: `(2010/2000).toFixed(2)` daba `"1.00"`.
- **Nada se convierte entre monedas.** Ninguna función de este ciclo multiplica
  ni divide por una cotización. Si aparece un `cotizacion` en el código nuevo,
  está mal.
- **Se apila por `Pago.moneda`, NUNCA por `Pago.cubre`.** `moneda` es lo que
  entró al cajón; `cubre` es cuál de los dos totales paga. Apilar por `cubre`
  reproduce exactamente el bug que este ciclo arregla.
- **`Pago.monto` ya es `base + recargo`** (`lib/ventas/crear.ts`). No se le suma
  `Venta.recargo` encima: sería contarlo dos veces.
- **Formato:** pesos primero, dólares después, unidos por `' + '`, **omitiendo
  el lado que está en cero**. Con los dos lados en cero, `$ 0,00`.
- **Rótulos exactos, en este orden:** `Vendido`, luego `Recargo` (o `Descuento`
  si el recargo es negativo, y ahí el importe va **sin** el signo), luego
  `Cobrado`.
- **Mobile-first en las clases de Tailwind**: el valor del teléfono sin prefijo,
  el de escritorio con `lg:`. Un solo corte, 1024 px. `sm:`/`md:` prohibidos en
  código propio.
- **Nada de `$queryRaw`.** La extensión de `lib/tenant/prisma.ts` intercepta
  operaciones de modelo, no raw queries: un raw no lleva el
  `set_config('arandano.tenant_id')` y RLS devuelve **cero filas en silencio**.
- **`docs/pantallas.md` se actualiza en el mismo commit que la pantalla.**
- Cada task termina con `npx vitest run` de los archivos que tocó, en verde, y
  un commit.

---

## Estructura de archivos

**Crear**

| Archivo | Responsabilidad |
|---|---|
| `lib/ventas/cobrado.ts` | Las dos magnitudes, la regla del desglose y el formato. La única fuente de la aritmética para las tres pantallas. |
| `lib/ventas/cobrado.test.ts` | Sus tests, puros (sin base). |

**Modificar**

| Archivo | Qué cambia |
|---|---|
| `app/(app)/ventas/page.tsx` | La columna Total, el tile, los dos pies, `pagosDelPeriodo` (nueva), las consultas. |
| `app/(app)/ventas/page.test.tsx` | Los casos que cablean el fuente viejo. |
| `app/(app)/ventas/[id]/page.tsx` | `lineasDeRecargo` y el renglón único. |
| `app/(app)/ventas/[id]/page.test.tsx` | Los casos del pie. |
| `test/ventas.test.ts` | La regla de las anuladas y el caso del feedback, contra la base efímera. |
| `lib/ventas/totales.ts` | Se borra `totalCobrado`. |
| `lib/ventas/totales.test.ts` | Se borra su `describe`. |
| `docs/pantallas.md` | Secciones `/ventas` y `/ventas/[id]`. |
| `docs/correcciones-pendientes-del-pen.md` | Entrada 26. |
| `CLAUDE.md` | La entrada del ciclo y la corrección del párrafo de la costura. |

---

### Task 1: `lib/ventas/cobrado.ts` — las dos magnitudes y la regla del desglose

**Files:**
- Create: `lib/ventas/cobrado.ts`
- Test: `lib/ventas/cobrado.test.ts`

**Interfaces:**
- Consumes: `Totales` y `redondearDinero` de `lib/ventas/totales.ts`;
  `formatearPrecio` y `formatearDolares` de `lib/formato/mostrar.ts`; el tipo
  `Moneda` de `@/generated/prisma/client`.
- Produces (lo usan las tasks 2, 3 y 4):
  - `type LineaDeImporte = { rotulo?: string; valor: string }`
  - `vendidoDeVenta(v: { total: Decimal; totalUsd: Decimal }): Totales`
  - `cobradoDePagos(pagos: { moneda: Moneda; monto: Decimal }[]): Totales`
  - `cobradoDeGrupos(grupos: { moneda: Moneda; monto: Decimal; _count: number }[]): Totales`
  - `mismosTotales(a: Totales, b: Totales): boolean`
  - `hayQueDesglosar(vendido: Totales, cobrado: Totales, recargo: Decimal): boolean`
  - `formatearTotales(t: Totales): string`
  - `lineasDeImporte(vendido: Totales, cobrado: Totales, recargo: Decimal): LineaDeImporte[]`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/ventas/cobrado.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  vendidoDeVenta,
  cobradoDePagos,
  cobradoDeGrupos,
  mismosTotales,
  hayQueDesglosar,
  formatearTotales,
  lineasDeImporte,
} from './cobrado'

const d = (v: string) => new Prisma.Decimal(v)
const t = (ars: string, usd: string) => ({ ars: d(ars), usd: d(usd) })

describe('cobradoDePagos', () => {
  // LA regla del ciclo: se apila por la moneda que ENTRÓ (`moneda`), no por
  // el total que el pago cubre (`cubre`). Apilar por `cubre` es exactamente
  // el bug que este ciclo arregla — un pago en pesos que cubre dólares
  // aparecía del lado de los dólares.
  it('un pago en pesos que cubre el total en dólares cuenta como PESOS', () => {
    const c = cobradoDePagos([{ moneda: 'ARS', monto: d('148500') }])
    expect(c.ars.toString()).toBe('148500')
    expect(c.usd.toString()).toBe('0')
  })

  // El caso del feedback: un iPhone de US$ 300 cobrado US$ 200 en billetes
  // más el resto en pesos a 1485.
  it('reparte un cobro partido entre las dos monedas', () => {
    const c = cobradoDePagos([
      { moneda: 'USD', monto: d('200') },
      { moneda: 'ARS', monto: d('148500') },
    ])
    expect(c.ars.toString()).toBe('148500')
    expect(c.usd.toString()).toBe('200')
  })

  it('sin pagos, las dos pilas quedan en cero', () => {
    const c = cobradoDePagos([])
    expect(c.ars.toString()).toBe('0')
    expect(c.usd.toString()).toBe('0')
  })
})

describe('cobradoDeGrupos', () => {
  // Las filas del groupBy traen `_count`: el mismo monto repetido N veces.
  // Se redondea PRIMERO y se multiplica después, igual que componerPorMedio,
  // que es lo que mantiene el redondeo por pago.
  it('multiplica cada grupo por su cantidad', () => {
    const c = cobradoDeGrupos([
      { moneda: 'ARS', monto: d('1000'), _count: 3 },
      { moneda: 'USD', monto: d('50'), _count: 2 },
    ])
    expect(c.ars.toString()).toBe('3000')
    expect(c.usd.toString()).toBe('100')
  })

  it('ignora un grupo con cantidad cero o negativa', () => {
    const c = cobradoDeGrupos([{ moneda: 'ARS', monto: d('1000'), _count: 0 }])
    expect(c.ars.toString()).toBe('0')
  })
})

describe('mismosTotales', () => {
  it('compara las dos monedas, no una', () => {
    expect(mismosTotales(t('100', '0'), t('100', '0'))).toBe(true)
    expect(mismosTotales(t('100', '0'), t('100', '5'))).toBe(false)
    expect(mismosTotales(t('100', '5'), t('101', '5'))).toBe(false)
  })

  it('0 y 0.00 son el mismo número', () => {
    expect(mismosTotales(t('0', '0'), t('0.00', '0.00'))).toBe(true)
  })
})

describe('hayQueDesglosar', () => {
  it('no desglosa cuando las dos magnitudes coinciden y no hubo recargo', () => {
    expect(hayQueDesglosar(t('50000', '0'), t('50000', '0'), d('0'))).toBe(false)
    expect(hayQueDesglosar(t('0', '300'), t('0', '300'), d('0'))).toBe(false)
  })

  it('desglosa cuando difieren', () => {
    expect(hayQueDesglosar(t('0', '300'), t('148500', '200'), d('0'))).toBe(true)
  })

  // La segunda mitad de la regla: con recargo se desglosa SIEMPRE, aunque las
  // dos magnitudes coincidan. En una venta mixta las dos pilas se arman por
  // caminos distintos y nada prueba que un recargo no pueda quedar
  // compensado; un recargo invisible es peor que un desglose de más.
  it('desglosa con recargo aunque las magnitudes coincidan', () => {
    expect(hayQueDesglosar(t('50000', '0'), t('50000', '0'), d('100'))).toBe(true)
    expect(hayQueDesglosar(t('50000', '0'), t('50000', '0'), d('-100'))).toBe(true)
  })
})

describe('formatearTotales', () => {
  it('sólo pesos: un número, sin "+" ni "US$"', () => {
    const texto = formatearTotales(t('103900', '0'))
    expect(texto).toContain('103.900,00')
    expect(texto).not.toContain('US$')
    expect(texto).not.toContain('+')
  })

  // La omisión es nueva y limpia el caso más común: antes de este ciclo la
  // columna mostraba "$ 0,00 + US$ 300,00" para toda venta en dólares.
  it('sólo dólares: se OMITE el lado en cero', () => {
    const texto = formatearTotales(t('0', '300'))
    expect(texto).toContain('US$')
    expect(texto).toContain('300,00')
    expect(texto).not.toContain('+')
  })

  it('las dos monedas: pesos primero, unidas por "+"', () => {
    const texto = formatearTotales(t('148500', '200'))
    const posArs = texto.indexOf('148.500,00')
    const posUsd = texto.indexOf('US$')
    expect(posArs).toBeGreaterThan(-1)
    expect(posUsd).toBeGreaterThan(posArs)
    expect(texto).toContain('+')
  })

  it('las dos en cero: "$ 0,00", nunca un string vacío', () => {
    expect(formatearTotales(t('0', '0'))).toContain('0,00')
  })
})

describe('lineasDeImporte', () => {
  it('una sola línea SIN rótulo cuando no hay nada que desglosar', () => {
    const lineas = lineasDeImporte(t('50000', '0'), t('50000', '0'), d('0'))
    expect(lineas).toHaveLength(1)
    expect(lineas[0].rotulo).toBeUndefined()
    expect(lineas[0].valor).toContain('50.000,00')
  })

  it('dos líneas rotuladas Vendido/Cobrado, en ese orden', () => {
    const lineas = lineasDeImporte(t('0', '300'), t('148500', '200'), d('0'))
    expect(lineas).toHaveLength(2)
    expect(lineas[0].rotulo).toBe('Vendido')
    expect(lineas[0].valor).toContain('300,00')
    expect(lineas[1].rotulo).toBe('Cobrado')
    expect(lineas[1].valor).toContain('148.500,00')
  })
})

describe('vendidoDeVenta', () => {
  it('la mercadería a precio de lista, partida por moneda', () => {
    const v = vendidoDeVenta({ total: d('50000'), totalUsd: d('300') })
    expect(v.ars.toString()).toBe('50000')
    expect(v.usd.toString()).toBe('300')
  })
})

// El invariante que sostiene la decisión de "sólo cuando difieren": sin
// dólares de por medio, lo cobrado es EXACTAMENTE `total + recargo`, así que
// un local que vende en pesos sin planes cae siempre a una sola línea y no ve
// ninguna diferencia respecto de antes de este ciclo. Sale de que el motor
// garantiza `Σ base = total` y de que `monto = base + recargo` por pago.
describe('el invariante de un local sin dólares', () => {
  it('Σ Pago.monto es total + recargo, así que nunca se desglosa sin recargo', () => {
    const total = d('50000')
    const recargo = d('0')
    const cobrado = cobradoDePagos([
      { moneda: 'ARS', monto: d('30000') },
      { moneda: 'ARS', monto: d('20000') },
    ])
    expect(cobrado.ars.toString()).toBe(total.add(recargo).toString())
    expect(hayQueDesglosar(vendidoDeVenta({ total, totalUsd: d('0') }), cobrado, recargo)).toBe(false)
  })

  it('con plan, cobrado supera a vendido y por eso se desglosa', () => {
    const total = d('50000')
    const recargo = d('20000')
    const cobrado = cobradoDePagos([{ moneda: 'ARS', monto: d('70000') }])
    expect(cobrado.ars.toString()).toBe(total.add(recargo).toString())
    expect(hayQueDesglosar(vendidoDeVenta({ total, totalUsd: d('0') }), cobrado, recargo)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run lib/ventas/cobrado.test.ts
```

Esperado: FALLA con `Failed to resolve import "./cobrado"`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/ventas/cobrado.ts`:

```ts
import { Prisma } from '@/generated/prisma/client'
import type { Moneda } from '@/generated/prisma/client'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { redondearDinero, type Totales } from './totales'

type Decimal = Prisma.Decimal

/**
 * Un renglón de plata de las pantallas de venta: el importe ya formateado y,
 * cuando hay algo que distinguir, su rótulo.
 *
 * Sin rótulo es el caso de siempre —un número solo—; con rótulo es el
 * desglose "Vendido"/"Cobrado". La misma forma la consumen la columna Total
 * del listado y el tile "Total del período", que es lo que impide que las dos
 * se dibujen distinto.
 */
export type LineaDeImporte = { rotulo?: string; valor: string }

const CERO = () => ({ ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) })

/** La mercadería de una venta a precio de lista, partida por moneda. */
export function vendidoDeVenta(v: { total: Decimal; totalUsd: Decimal }): Totales {
  return { ars: v.total, usd: v.totalUsd }
}

/**
 * La plata que entró, apilada por la moneda en que se ENTREGÓ.
 *
 * **Por `Pago.moneda`, nunca por `Pago.cubre`**, y ahí está todo el ciclo: un
 * pago en pesos que cubre el total en dólares tiene `cubre = USD` porque paga
 * mercadería en dólares, pero lo que entró al cajón fueron pesos. Apilar por
 * `cubre` reproduce el defecto que este ciclo arregla — la venta de US$ 300
 * cobrada US$ 200 + pesos volvería a decir US$ 300.
 *
 * `Pago.monto` YA es `base + recargo` (`lib/ventas/crear.ts`), así que no hay
 * que sumarle `Venta.recargo` encima: sería contarlo dos veces.
 *
 * Y se lee crudo, sin `pesosEntregados` ni `montoEnPesos`: las dos convierten,
 * y acá el monto ya está en la unidad de su propia pila.
 */
export function cobradoDePagos(pagos: { moneda: Moneda; monto: Decimal }[]): Totales {
  return cobradoDeGrupos(pagos.map((p) => ({ moneda: p.moneda, monto: p.monto, _count: 1 })))
}

/**
 * La misma cuenta sobre filas de un `groupBy` con `_count`, para los agregados
 * del período.
 *
 * Redondea PRIMERO y multiplica por la cantidad después, no al revés: es lo
 * que reproduce exactamente la suma pago por pago, y el mismo motivo por el
 * que el `groupBy` lleva `monto` en la clave en vez de un `_sum` (ver
 * `FilaDePagos` en `./composicion.ts`).
 */
export function cobradoDeGrupos(
  grupos: { moneda: Moneda; monto: Decimal; _count: number }[],
): Totales {
  return grupos.reduce<Totales>((acc, g) => {
    if (g._count <= 0) return acc
    const suma = redondearDinero(g.monto).mul(g._count)
    return g.moneda === 'USD'
      ? { ars: acc.ars, usd: acc.usd.add(suma) }
      : { ars: acc.ars.add(suma), usd: acc.usd }
  }, CERO())
}

/** Si dos magnitudes coinciden en las DOS monedas. */
export function mismosTotales(a: Totales, b: Totales): boolean {
  return a.ars.equals(b.ars) && a.usd.equals(b.usd)
}

/**
 * LA regla de las tres pantallas: si el importe se muestra desglosado en
 * "Vendido" y "Cobrado", o como un número solo.
 *
 * Un número solo es el caso común —toda venta en pesos sin plan— y es lo que
 * hace que un local que no usa ni planes ni dólares no vea ninguna diferencia
 * respecto de antes de este ciclo.
 *
 * **Mira el recargo ADEMÁS de comparar las magnitudes**, y esa segunda mitad
 * parece redundante pero no lo es del todo: sin dólares sí lo es —`cobrado.ars`
 * es `total + recargo`, así que un recargo distinto de cero garantiza que
 * difieran—, pero en una venta mixta las dos pilas se arman por caminos
 * distintos y nada prueba que un recargo no pueda quedar compensado. Un
 * desglose de más no le hace daño a nadie; un recargo que se vuelve invisible
 * por una cancelación aritmética, sí.
 */
export function hayQueDesglosar(vendido: Totales, cobrado: Totales, recargo: Decimal): boolean {
  return !recargo.isZero() || !mismosTotales(vendido, cobrado)
}

/**
 * Una magnitud escrita: pesos primero, dólares después, unidos por " + ", y
 * **se omite el lado que está en cero**.
 *
 * Nada se convierte: cada moneda dice su propio número. La omisión limpia el
 * caso más común de este producto —antes de este ciclo una venta en dólares
 * se escribía "$ 0,00 + US$ 300,00"— y con las dos pilas en cero devuelve
 * "$ 0,00" y no un string vacío, que en una celda de plata se leería como un
 * dato faltante.
 */
export function formatearTotales(t: Totales): string {
  const partes: string[] = []
  if (!t.ars.isZero()) partes.push(formatearPrecio(t.ars.toString()))
  if (!t.usd.isZero()) partes.push(formatearDolares(t.usd.toString()))
  return partes.length === 0 ? formatearPrecio('0') : partes.join(' + ')
}

/**
 * El importe de una venta o de un período, listo para dibujar: un renglón sin
 * rótulo, o los dos del desglose.
 *
 * En el caso sin desglose se formatea `cobrado` y no `vendido`, aunque sean el
 * mismo número: es la plata que entró, que es lo que la pantalla contesta.
 */
export function lineasDeImporte(
  vendido: Totales,
  cobrado: Totales,
  recargo: Decimal,
): LineaDeImporte[] {
  if (!hayQueDesglosar(vendido, cobrado, recargo)) {
    return [{ valor: formatearTotales(cobrado) }]
  }
  return [
    { rotulo: 'Vendido', valor: formatearTotales(vendido) },
    { rotulo: 'Cobrado', valor: formatearTotales(cobrado) },
  ]
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
npx vitest run lib/ventas/cobrado.test.ts
```

Esperado: PASS, 17 casos.

- [ ] **Step 5: Verificar tipos y lint**

```bash
npx tsc --noEmit && npx eslint lib/ventas/cobrado.ts lib/ventas/cobrado.test.ts
```

Esperado: sin salida.

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/cobrado.ts lib/ventas/cobrado.test.ts
git commit -m "feat(ventas): lo vendido y lo cobrado, cada moneda por separado"
```

---

### Task 2: La columna Total del listado de `/ventas`

**Files:**
- Modify: `app/(app)/ventas/page.tsx` (borrar `totalesFormateados`; `FilaDeVenta`; la celda de `Listado`; el `select` de `pagos`; el `map` que arma las filas)
- Test: `app/(app)/ventas/page.test.tsx`

**Interfaces:**
- Consumes: `lineasDeImporte`, `vendidoDeVenta`, `cobradoDePagos`,
  `LineaDeImporte` de `@/lib/ventas/cobrado` (Task 1).
- Produces: `FilaDeVenta.totalLineas: LineaDeImporte[]` — reemplaza a
  `totalFormateado: string`. Lo consume `Listado`, y nada fuera de este archivo.

- [ ] **Step 1: Escribir los tests que fallan**

En `app/(app)/ventas/page.test.tsx`:

1. Cambiar el import: sacar `totalesFormateados` de la lista importada de `./page`.
2. **Borrar entero** el `describe('totalesFormateados', ...)` (línea ~297): su
   función deja de existir; lo que probaba vive ahora en `cobrado.test.ts`.
3. En el `describe('la columna Total y el tile del período muestran lo cobrado', ...)`,
   **reemplazar** el caso `'la celda Total usa totalCobrado(v), no v.total a secas'` por:

```tsx
  // El ciclo del cobrado por moneda: la celda deja de leer `total + recargo`
  // (que ignora lo que entró en dólares) y pasa a comparar las dos magnitudes.
  // Positivo + negativo, para que no alcance con que la cadena nueva aparezca
  // en cualquier lado del archivo.
  it('la celda Total compara lo vendido contra lo cobrado de los pagos', () => {
    expect(fuente).toContain(
      'totalLineas: lineasDeImporte(vendidoDeVenta(v), cobradoDePagos(v.pagos), v.recargo),',
    )
    expect(fuente).not.toContain('formatearPrecio(totalCobrado(v).toString())')
  })

  // Sin `monto` en el select, `cobradoDePagos` recibiría filas sin el número
  // que suma: TypeScript lo atajaría, pero el caso deja escrito POR QUÉ esa
  // columna está en un select que existía para la celda "Medios".
  it('el select del listado pide el monto de cada pago', () => {
    expect(fuente).toContain('pagos: { select: { medio: true, moneda: true, monto: true }')
  })
```

4. En el `describe('el tile "Total del período" y la columna Total muestran dólares sin convertir', ...)`,
   **reemplazar** el caso `'la columna Total usa totalesFormateados(v), que no convierte nada'` por:

```tsx
  it('la columna Total no convierte nada: ninguna cotización en el armado de la fila', () => {
    const posMap = fuente.indexOf('filas={ventas.map((v) => ({')
    const posCierre = fuente.indexOf('anulada: v.anuladaEn !== null,', posMap)
    expect(posMap).toBeGreaterThan(-1)
    expect(fuente.slice(posMap, posCierre)).not.toContain('cotizacion')
  })
```

5. Cambiar la constante `FILA` (línea ~318): `totalFormateado: '$ 103.900,00'`
   pasa a `totalLineas: [{ valor: '$ 103.900,00' }]`.

6. Agregar, al final del `describe('Listado: el patrón grid + display:contents', ...)`:

```tsx
  it('con una sola línea, la celda Total no dibuja ningún rótulo', () => {
    const html = renderListado()
    expect(html).toContain('$ 103.900,00')
    expect(html).not.toContain('Vendido')
    expect(html).not.toContain('Cobrado')
  })

  it('con dos líneas, dibuja los rótulos y Vendido va ARRIBA de Cobrado', () => {
    const html = renderListado({
      filas: [{
        ...FILA,
        totalLineas: [
          { rotulo: 'Vendido', valor: 'US$ 300,00' },
          { rotulo: 'Cobrado', valor: '$ 148.500,00 + US$ 200,00' },
        ],
      }],
    })
    const posVendido = html.indexOf('Vendido')
    const posCobrado = html.indexOf('Cobrado')
    expect(posVendido).toBeGreaterThan(-1)
    expect(posCobrado).toBeGreaterThan(posVendido)
    expect(html).toContain('$ 148.500,00 + US$ 200,00')
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run "app/(app)/ventas/page.test.tsx"
```

Esperado: FALLA — `totalesFormateados` ya no se importa pero el fuente sigue
teniéndolo, y `FILA` tiene una propiedad que `FilaDeVenta` no declara.

- [ ] **Step 3: Escribir la implementación**

En `app/(app)/ventas/page.tsx`:

1. Agregar el import:

```ts
import {
  lineasDeImporte, vendidoDeVenta, cobradoDePagos, type LineaDeImporte,
} from '@/lib/ventas/cobrado'
```

2. **Borrar entera** la función `totalesFormateados` con su docblock (líneas
   ~272-283). Si `formatearDolares` queda sin usarse en el archivo tras la Task 3,
   se saca del import ahí; en esta task todavía lo usa el tile.

3. En `FilaDeVenta`, reemplazar `totalFormateado: string` por:

```ts
  /** Un renglón, o los dos del desglose Vendido/Cobrado — ya resueltos a
   *  texto por `lineasDeImporte()` en el llamador, para que `Listado` no
   *  reciba ningún `Decimal` de Prisma. */
  totalLineas: LineaDeImporte[]
```

4. En el `select` del `findMany` de ventas, agregar `monto` a los pagos:

```ts
        pagos: { select: { medio: true, moneda: true, monto: true }, orderBy: { creadoEn: 'asc' } },
```

5. En el `map` que arma `filas`, reemplazar la línea de `totalFormateado` (y su
   comentario) por:

```ts
                // Las dos magnitudes de la venta: la mercadería a precio de
                // lista (`vendidoDeVenta`) y la plata que entró, apilada por
                // la moneda en que se entregó (`cobradoDePagos`). Un renglón
                // cuando coinciden —toda venta en pesos sin plan—, dos
                // rotulados cuando no. Nada se convierte.
                totalLineas: lineasDeImporte(vendidoDeVenta(v), cobradoDePagos(v.pagos), v.recargo),
```

6. En `Listado`, reemplazar el contenido de la celda Total:

```tsx
                    <div className="flex flex-col items-end lg:h-full lg:justify-center">
                      {f.totalLineas.map((l) => (
                        <div key={l.rotulo ?? '—'} className="flex flex-col items-end">
                          {/* El rótulo NO hereda el 15px semibold tabular de
                              la celda: se lo pisa explícito. 9px es el escalón
                              más chico que este listado ya usa para meta. */}
                          {l.rotulo && (
                            <span className="text-[9px] font-normal tracking-[0.6px] text-muted-foreground uppercase">
                              {l.rotulo}
                            </span>
                          )}
                          <span>{l.valor}</span>
                        </div>
                      ))}
                    </div>
```

reemplazando exactamente a:

```tsx
                    <div className="lg:flex lg:h-full lg:items-center lg:justify-end">
                      {f.totalFormateado}
                    </div>
```

**Por qué `lg:h-full lg:justify-center` y no `self-center`:** la fila lleva
`lg:contents`, así que la celda no tiene caja propia y `align-self: center` la
encogería, dejando su `border-b` a distinta altura que el del resto de la fila.
El envoltorio interno con altura completa es el patrón que ya usa el resto de
este listado.

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run "app/(app)/ventas/page.test.tsx"
```

Esperado: PASS.

- [ ] **Step 5: Verificar tipos, lint y el resto de la suite de esa pantalla**

```bash
npx tsc --noEmit && npx eslint "app/(app)/ventas/page.tsx" && npx vitest run test/responsive.test.ts
```

Esperado: sin salida en los dos primeros; `responsive.test.ts` en verde (no se
agregó ningún ancho fijo).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/ventas/page.tsx" "app/(app)/ventas/page.test.tsx"
git commit -m "feat(ventas): la columna Total distingue lo vendido de lo cobrado"
```

---

### Task 3: El tile "Total del período", los dos pies y `pagosDelPeriodo`

**Files:**
- Modify: `app/(app)/ventas/page.tsx` (`Tile`, `pieDeCobradas`, `pieDeAnuladas`, `totalDelPeriodo` docblock, `pagosDelPeriodo` nueva, el `Promise.all`, el bloque de tiles)
- Modify: `test/ventas.test.ts` (la regla de las anuladas contra la base efímera)
- Test: `app/(app)/ventas/page.test.tsx`
- Docs: `docs/pantallas.md`, sección `/ventas`

**Interfaces:**
- Consumes: todo lo de la Task 1, más `LineaDeImporte` (ya importado en Task 2).
- Produces:
  - `pagosDelPeriodo(prisma, donde, anuladas: boolean)` — exportada, la consume
    `test/ventas.test.ts`. Devuelve `{ moneda, monto, _count }[]`.
  - `Tile({ rotulo, lineas, pie, marca })` — `lineas: LineaDeImporte[]`
    reemplaza a `valor: string` y `valorUsd?: string`.
  - `pieDeCobradas(cobradoArs: string, cobradas: number, hayDolaresCobrados: boolean)`
  - `pieDeAnuladas(devueltoArs: string, hayDolaresDevueltos: boolean)`

- [ ] **Step 1: Escribir los tests que fallan**

**1a.** En `app/(app)/ventas/page.test.tsx`, reemplazar entero el
`describe('Tile: valorUsd — la segunda línea del tile de marca', ...)` por:

```tsx
// El tile de marca ("Total del período"): con una sola línea se ve
// exactamente como antes de este ciclo —un local que no usa planes ni dólares
// no puede notarlo—, y con dos aparecen los rótulos, Vendido arriba.
describe('Tile: una línea o el desglose Vendido/Cobrado', () => {
  it('con una sola línea sin rótulo, el tile de marca no dibuja ningún rótulo de línea', () => {
    const html = renderToStaticMarkup(
      <Tile marca rotulo="Total del período" lineas={[{ valor: '$ 1.284.500,00' }]} pie="sin contar las anuladas" />,
    )
    expect(html).toContain('$ 1.284.500,00')
    expect(html).not.toContain('Vendido')
    expect(html).not.toContain('Cobrado')
  })

  it('con dos líneas, Vendido va ARRIBA de Cobrado', () => {
    const html = renderToStaticMarkup(
      <Tile
        marca
        rotulo="Total del período"
        lineas={[
          { rotulo: 'Vendido', valor: 'US$ 300,00' },
          { rotulo: 'Cobrado', valor: '$ 148.500,00 + US$ 200,00' },
        ]}
        pie="sin contar las anuladas"
      />,
    )
    const posVendido = html.indexOf('Vendido')
    const posCobrado = html.indexOf('Cobrado')
    expect(posVendido).toBeGreaterThan(-1)
    expect(posCobrado).toBeGreaterThan(posVendido)
  })

  it('los tiles chicos (un conteo, sin rótulo de línea) se dibujan igual que siempre', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="Ventas cobradas" lineas={[{ valor: '12' }]} pie="promedio $ 1.000,00" />,
    )
    expect(html).toContain('12')
    expect(html).toContain('promedio $ 1.000,00')
  })
})
```

**1b.** En el mismo archivo, dentro del `describe('la columna Total y el tile del período muestran lo cobrado', ...)`,
reemplazar los cuatro casos que cablean `sumaCobrada` / `devueltoCobrado` /
`_sum` por:

```tsx
  it('el tile "Total del período" recibe las dos magnitudes del período', () => {
    const posTile = fuente.indexOf('rotulo="Total del período"')
    const posLineas = fuente.indexOf(
      'lineas={lineasDeImporte(vendidoPeriodo, cobradoPeriodo, recargoPeriodo)}',
      posTile,
    )
    expect(posTile).toBeGreaterThan(-1)
    expect(posLineas).toBeGreaterThan(posTile)
  })

  // Los dos pies pasan a hablar de lo COBRADO en pesos, no de `total +
  // recargo`: sin esto, un período que cobró $148.500 cubriendo una venta en
  // dólares seguiría diciendo "promedio $ 0,00" o, peor, omitiendo el pie.
  it('el pie de "Ventas cobradas" recibe el cobrado en pesos del período', () => {
    expect(fuente).toContain(
      'pieDeCobradas(cobradoPeriodo.ars.toString(), cobradas, !cobradoPeriodo.usd.isZero())',
    )
    expect(fuente).not.toContain('pieDeCobradas(sumaCobrada.toString()')
  })

  it('el pie de "Anuladas" recibe lo devuelto en pesos, de los pagos de las anuladas', () => {
    expect(fuente).toContain(
      'pieDeAnuladas(devueltoPeriodo.ars.toString(), !devueltoPeriodo.usd.isZero())',
    )
    expect(fuente).not.toContain('pieDeAnuladas(devueltoCobrado.toString()')
  })

  // La regla "una venta anulada no es plata que entró" vive ahora en DOS
  // agregados. `pagosDelPeriodo` es la mitad nueva, y está exportada
  // justamente para que test/ventas.test.ts la pueda correr contra la base:
  // el `groupBy` inline del panel de medios no se puede llamar desde ningún
  // test, que es lo que el hallazgo I3 dejó como lección.
  it('las dos mitades del cobrado del período salen de pagosDelPeriodo', () => {
    expect(fuente).toContain('pagosDelPeriodo(prisma, donde, false)')
    expect(fuente).toContain('pagosDelPeriodo(prisma, donde, true)')
  })
```

**1b-bis.** En el `describe('el tile "Total del período" y la columna Total muestran dólares sin convertir', ...)`,
reemplazar el caso `'el tile pasa valorUsd sólo cuando el período tiene algo en dólares'`
—queda rojo, porque `valorUsd` deja de existir— por:

```tsx
  it('el tile no arma sus líneas a mano: se las pide a lineasDeImporte', () => {
    expect(fuente).toContain('lineas={lineasDeImporte(vendidoPeriodo, cobradoPeriodo, recargoPeriodo)}')
    expect(fuente).not.toContain('valorUsd=')
  })
```

Los otros dos casos de ese `describe` (`'el aggregate de totalDelPeriodo suma
totalUsd'` y `'el select del listado pide totalUsd'`) siguen siendo ciertos y
**no se tocan**.

**1c.** En `test/ventas.test.ts`:

- Declarar el import diferido, junto al de `totalDelPeriodo` (línea ~30):

```ts
let pagosDelPeriodo: typeof import('@/app/(app)/ventas/page').pagosDelPeriodo
```

- En el `beforeAll`, cambiar la desestructuración de la línea ~64 por:

```ts
  ;({ totalDelPeriodo, pagosDelPeriodo } = await import('@/app/(app)/ventas/page'))
```

- Agregar, al final del `describe('totalDelPeriodo (app/(app)/ventas/page.tsx)', ...)`,
  un `describe` hermano:

```ts
// El ciclo del cobrado por moneda: el tile "Total del período" muestra, además
// de la mercadería, la plata que entró en cada moneda. Sale de `Pago`, no de
// `Venta`, así que la regla "una venta anulada no es plata que entró" vuelve a
// necesitar su propio test contra la base — es exactamente el hallazgo I3, que
// mostró que borrar ese filtro dejaba 785 tests en verde.
//
// Mismo patrón de antes/después que los tres casos de arriba: el tenant es
// compartido por todo el archivo, así que lo único estable es el DELTA.
describe('pagosDelPeriodo (app/(app)/ventas/page.tsx)', () => {
  const donde = { creadoEn: { gte: new Date('2000-01-01T00:00:00Z'), lt: new Date('2999-01-01T00:00:00Z') } }

  const cobradoArs = (filas: { moneda: string; monto: Prisma.Decimal; _count: number }[]) =>
    filas
      .filter((f) => f.moneda === 'ARS')
      .reduce((acc, f) => acc.add(f.monto.mul(f._count)), new Prisma.Decimal(0))

  it('reparte los pagos a los dos lados de la anulación', async () => {
    const prisma = prismaParaTenant(tenantId)

    const cobradoAntes = cobradoArs(await pagosDelPeriodo(prisma, donde, false))
    const devueltoAntes = cobradoArs(await pagosDelPeriodo(prisma, donde, true))

    await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500'), cotizacion: d('1') }],
    })
    const { id: idAAnular } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1.4') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('700'), cotizacion: d('1') }],
    })
    await anularVenta({ tenantId, ventaId: idAAnular, usuarioId })

    const cobradoDespues = cobradoArs(await pagosDelPeriodo(prisma, donde, false))
    const devueltoDespues = cobradoArs(await pagosDelPeriodo(prisma, donde, true))

    // El $500 quedó del lado de lo cobrado; el $700 del lado de lo devuelto.
    // Si el filtro de anulación se cayera, el primero valdría 1200.
    expect(cobradoDespues.minus(cobradoAntes).toString()).toBe('500')
    expect(devueltoDespues.minus(devueltoAntes).toString()).toBe('700')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run "app/(app)/ventas/page.test.tsx" test/ventas.test.ts
```

Esperado: FALLA — `pagosDelPeriodo` no existe y `Tile` no acepta `lineas`.

- [ ] **Step 3: Escribir la implementación**

En `app/(app)/ventas/page.tsx`:

**3a.** Agregar `cobradoDeGrupos` al import de `@/lib/ventas/cobrado` (que ya
existe desde la Task 2), y borrar `totalCobrado` del import de
`@/lib/ventas/totales` (queda `redondearDinero` solo).

**3b.** Actualizar el docblock de `totalDelPeriodo`: los dos últimos párrafos
(los que dicen que el llamador arma `totalCobrado()` y que `totalUsd` va a una
segunda línea) se reemplazan por:

```
 * Suma `total`, `recargo` y `totalUsd` porque el llamador arma con los tres la
 * magnitud "Vendido" del tile (`total`/`totalUsd`, la mercadería a precio de
 * lista) y el argumento `recargo` de `hayQueDesglosar`. **Lo COBRADO no sale
 * de acá**: sale de `pagosDelPeriodo`, más abajo, porque la plata que entró se
 * apila por la moneda de cada pago y esta tabla no la conoce.
```

**3c.** Agregar, inmediatamente después de `totalDelPeriodo`:

```ts
/**
 * Los pagos del período agrupados por moneda e importe, de un lado o del otro
 * de la anulación.
 *
 * Es la fuente de las dos cifras de "Cobrado" del tile: la del período
 * (`anuladas = false`) y la devuelta (`anuladas = true`).
 *
 * **Exportada y parametrizada a propósito, y no reusando el `groupBy` que ya
 * alimenta "Cómo entró la plata"**, que selecciona exactamente las mismas
 * filas del lado de las no anuladas. Ese `groupBy` está inline en el
 * componente de página —un Server Component `async` que abre sesión—, así que
 * ningún test lo puede llamar, y su `anuladaEn: null` quedaría tan
 * desprotegido como el que el hallazgo I3 de la review del rediseño mostró que
 * se podía borrar dejando 785 tests en verde. La regla "una venta anulada no
 * es plata que entró" tiene que vivir donde la base efímera la pueda
 * ejercitar; es el mismo motivo por el que `totalDelPeriodo` se extrajo.
 *
 * Las dos consultas no pueden desacordar con el panel: la suma de `monto` por
 * moneda es idéntica se agrupe por `['moneda','monto']` o por
 * `['medio','moneda','cotizacion','monto']` —agrupar por más columnas refina
 * los grupos, no cambia la suma— y la cláusula `where` es la misma.
 *
 * `monto` va en la CLAVE con `_count`, y no en un `_sum`, por lo mismo que ya
 * documenta `FilaDePagos` en lib/ventas/composicion.ts: es lo que mantiene el
 * redondeo POR PAGO. Con `_sum` el tile y el panel se separaban por centavos
 * en la misma pantalla.
 *
 * `groupBy` y no `$queryRaw`: la extensión de lib/tenant/prisma.ts intercepta
 * operaciones de MODELO, y un raw sin el `set_config('arandano.tenant_id')`
 * devuelve cero filas EN SILENCIO.
 */
export function pagosDelPeriodo(
  prisma: ReturnType<typeof prismaParaTenant>,
  donde: FiltroDePeriodo,
  anuladas: boolean,
) {
  return prisma.pago.groupBy({
    by: ['moneda', 'monto'],
    where: { venta: { ...donde, anuladaEn: anuladas ? { not: null } : null } },
    _count: true,
  })
}
```

**3d.** Reescribir los docblocks y las firmas de los dos pies. En
`pieDeCobradas`, reemplazar la firma y el cuerpo por:

```ts
export function pieDeCobradas(
  cobradoArs: string, cobradas: number, hayDolaresCobrados: boolean,
): string | undefined {
  if (cobradas <= 0) return undefined
  if (hayDolaresCobrados && new Prisma.Decimal(cobradoArs).isZero()) return undefined
  const promedio = redondearDinero(new Prisma.Decimal(cobradoArs).div(cobradas))
  return `promedio ${formatearPrecio(promedio.toString())}`
}
```

y agregar al final de su docblock:

```
 * **Sobre lo COBRADO EN PESOS** (`Σ Pago.monto` de los pagos en pesos), no
 * sobre `total + recargo`: desde que un pago en pesos puede cubrir el total en
 * dólares, esas dos cosas dejaron de ser la misma. La guarda de omisión
 * también cambió de pregunta —ahora es "¿se COBRÓ algo en dólares?" y no "¿se
 * vendió?"—, que es la correcta: lo que el pie podría estar afirmando en falso
 * es sobre plata que entró. Efecto de paso: el período del feedback (una venta
 * en dólares cobrada en pesos) pasa de omitir el pie a decir un promedio real.
```

En `pieDeAnuladas`, renombrar el parámetro `montoDevuelto` a `devueltoArs` y
`hayDolares` a `hayDolaresDevueltos`, con la nota equivalente en el docblock.

**3e.** Reescribir `Tile`. La firma pasa a:

```ts
export function Tile({
  rotulo, lineas, pie, marca = false,
}: { rotulo: string; lineas: LineaDeImporte[]; pie?: string; marca?: boolean }) {
```

y su docblock reemplaza los dos párrafos sobre `marca` y `valorUsd` por:

```
 * `lineas` es una sola —el número solo de siempre, y así se ven los dos tiles
 * de conteo— o las dos del desglose "Vendido"/"Cobrado" (ver `lineasDeImporte`
 * en lib/ventas/cobrado.ts). Las dos se dibujan al MISMO tamaño, apoyándose en
 * la regla que este componente ya tenía escrita para las monedas: ninguna pesa
 * más que la otra en esta pantalla, así que ninguna se dibuja más chica —
 * tampoco pesa más lo vendido que lo cobrado.
 *
 * `design/arandano.pen` no dibuja ningún tile con rótulos de línea: es
 * anterior a este ciclo. Anotado en docs/correcciones-pendientes-del-pen.md,
 * entrada 26.
```

En la rama `marca`, reemplazar el bloque `<div className="flex flex-col gap-0.5">…</div>` por:

```tsx
        <div className="flex flex-col gap-0.5">
          {lineas.map((l) => (
            <div key={l.rotulo ?? '—'} className="flex flex-col">
              {l.rotulo && (
                <div
                  className="text-[10px] font-bold tracking-[1px] uppercase lg:tracking-[1.2px]"
                  style={{ color: 'var(--marca-dim)' }}
                >
                  {l.rotulo}
                </div>
              )}
              <div style={{ color: 'var(--marca-foreground)' }} className={claseValor}>
                {l.valor}
              </div>
            </div>
          ))}
        </div>
```

En la rama sin `marca`, reemplazar el `<div className={...text-[24px]...}>{valor}</div>` por:

```tsx
      {lineas.map((l) => (
        <div key={l.rotulo ?? '—'} className="flex flex-col">
          {l.rotulo && (
            <div className="text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase lg:tracking-[1.2px]">
              {l.rotulo}
            </div>
          )}
          <div
            className={`${estilos.archivo} text-[24px] leading-none font-semibold tracking-[-0.6px] tabular-nums text-foreground lg:text-[26px]`}
          >
            {l.valor}
          </div>
        </div>
      ))}
```

**3f.** En el `Promise.all`, **borrar** el agregado `devueltas` entero (queda sin
lectores: `devueltoCobrado` y `devueltoUsd` desaparecen) y **agregar** dos
llamadas al final del array:

```ts
    // Las dos mitades del "Cobrado": la plata que entró en el período y la que
    // se devolvió al anular. Ver el docblock de pagosDelPeriodo para por qué
    // no se reusa el groupBy del panel de medios.
    pagosDelPeriodo(prisma, donde, false),
    pagosDelPeriodo(prisma, donde, true),
```

y ajustar la desestructuración. **El orden importa y es posicional**: al
borrar `devueltas` (que era el 5.º) todo lo que venía después se corre un
lugar, así que el array queda, en este orden exacto — `venta.findMany`,
`venta.count`, `totalDelPeriodo`, `venta.count` de anuladas, el `groupBy` del
panel de medios, el `venta.findMany` de fechas, y las dos llamadas nuevas:

```ts
  const [ventas, total, suma, anuladas, pagos, ventasDelPeriodo, pagosCobrados, pagosDevueltos] =
    await Promise.all([
```

Un desfasaje acá **no lo atrapa TypeScript en todos los casos** (dos `count`
consecutivos son los dos `number`), así que conviene releer el array contra
esta lista antes de seguir.

**3g.** Reemplazar el bloque de `sumaCobrada` / `devueltoCobrado` /
`sumaUsdPeriodo` / `devueltoUsd` (líneas ~915-938) por:

```ts
  // Las dos magnitudes del período. "Vendido" sale de `Venta` (la mercadería a
  // precio de lista, en sus dos monedas); "Cobrado" sale de `Pago`, apilado
  // por la moneda en que se entregó cada uno. Nada se convierte: son cuatro
  // números y ninguna cotización los cruza.
  const vendidoPeriodo = vendidoDeVenta({
    total: suma._sum.total ?? new Prisma.Decimal(0),
    totalUsd: suma._sum.totalUsd ?? new Prisma.Decimal(0),
  })
  const recargoPeriodo = suma._sum.recargo ?? new Prisma.Decimal(0)
  const cobradoPeriodo = cobradoDeGrupos(pagosCobrados)
  // Lo devuelto por las anuladas: sólo alimenta el pie del tile de anuladas,
  // que muestra un conteo y no plata, así que esta cifra no tiene una segunda
  // línea donde aparecer.
  const devueltoPeriodo = cobradoDeGrupos(pagosDevueltos)
```

**3h.** Reemplazar los tres call sites de los tiles:

```tsx
                <Tile
                  marca
                  rotulo="Total del período"
                  lineas={lineasDeImporte(vendidoPeriodo, cobradoPeriodo, recargoPeriodo)}
                  pie="sin contar las anuladas"
                />
```

```tsx
                  <Tile
                    rotulo="Ventas cobradas"
                    lineas={[{ valor: formatearCantidad(String(cobradas)) }]}
                    pie={pieDeCobradas(cobradoPeriodo.ars.toString(), cobradas, !cobradoPeriodo.usd.isZero())}
                  />
                  <Tile
                    rotulo="Anuladas"
                    lineas={[{ valor: formatearCantidad(String(anuladas)) }]}
                    pie={pieDeAnuladas(devueltoPeriodo.ars.toString(), !devueltoPeriodo.usd.isZero())}
                  />
```

**3i.** Si `formatearDolares` quedó sin usos en el archivo, sacarlo del import.

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run "app/(app)/ventas/page.test.tsx" test/ventas.test.ts
```

Esperado: PASS.

- [ ] **Step 5: Actualizar `docs/pantallas.md`, sección `/ventas`**

En **Qué se puede hacer**, el bullet de los tres tiles pasa a decir que el tile
del período muestra **Vendido y Cobrado cuando difieren, y un número solo
cuando coinciden**, y que los dos pies de plata hablan de lo cobrado **en
pesos**. El bullet del listado pasa a decir que la columna Total muestra el
mismo par, y reemplaza el ejemplo `"$ 178.200,00 + US$ 300,00"` por
`"Vendido US$ 300,00 / Cobrado $ 148.500,00 + US$ 200,00"`.

En **Decisiones**, reescribir el bullet que empieza con "La columna Total, el
tile «Total del período»…" para que diga, en este orden:

1. Que las dos magnitudes son **Vendido** (`Venta.total` + `Venta.totalUsd`, la
   mercadería a precio de lista) y **Cobrado** (`Σ Pago.monto` apilado por
   `Pago.moneda`), y que ninguna se convierte a la otra.
2. Que se apila por `Pago.moneda` y **no** por `Pago.cubre` — un pago en pesos
   que cubre el total en dólares es plata que entró en pesos.
3. Que se muestran dos líneas sólo cuando difieren, y que sin dólares ni planes
   coinciden **por construcción** (`Σ Pago.monto = total + recargo`), así que un
   local que no usa ninguna de las dos cosas no ve ninguna diferencia.
4. Que la costura con "Cómo entró la plata" **se angosta pero no desaparece**:
   el tile no convierte y el panel sí, porque las barras necesitan una unidad
   común para ser comparables.

- [ ] **Step 6: Verificar tipos, lint y el gate de pantallas**

```bash
npx tsc --noEmit && npx eslint "app/(app)/ventas/page.tsx" && npx vitest run test/pantallas.test.ts test/responsive.test.ts test/tipografia.test.ts
```

Esperado: sin salida en los dos primeros; los tres tests en verde.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/ventas/page.tsx" "app/(app)/ventas/page.test.tsx" test/ventas.test.ts docs/pantallas.md
git commit -m "feat(ventas): el tile del periodo muestra lo vendido y lo cobrado por moneda"
```

---

### Task 4: El pie de `/ventas/[id]`

**Files:**
- Modify: `app/(app)/ventas/[id]/page.tsx` (`LineaDeTotal`, `lineasDeRecargo`, el docblock de `Detalle`, el `map` del render y `totalFormateado`)
- Test: `app/(app)/ventas/[id]/page.test.tsx`
- Docs: `docs/pantallas.md`, sección `/ventas/[id]`

**Interfaces:**
- Consumes: `vendidoDeVenta`, `cobradoDePagos`, `hayQueDesglosar`,
  `formatearTotales` de `@/lib/ventas/cobrado` (Task 1).
- Produces: `LineaDeTotal = { rotulo: string; valor: string; destacada: boolean }`
  (antes: `{ rotulo, monto: Decimal, moneda, destacada }`), y
  `lineasDeRecargo(v: { total, recargo, totalUsd?, pagos })`.

- [ ] **Step 1: Escribir los tests que fallan**

En `app/(app)/ventas/[id]/page.test.tsx`, **reemplazar los seis casos** del
`describe('lineasDeRecargo', ...)` (líneas ~76-129). Los seis asertan sobre
`.monto` y `.moneda`, que dejan de existir: una línea puede llevar las dos
monedas a la vez, así que ya no hay una `moneda` única que la describa ni un
`Decimal` sin formatear. Los reemplazos:

```tsx
const pagoArs = (monto: string) => ({ moneda: 'ARS' as const, monto: d(monto) })
const pagoUsd = (monto: string) => ({ moneda: 'USD' as const, monto: d(monto) })

describe('lineasDeRecargo', () => {
  it('null cuando no hay nada que desglosar: el renglón único "Total" de siempre', () => {
    expect(
      lineasDeRecargo({ total: d('50000'), recargo: d('0'), totalUsd: d('0'), pagos: [pagoArs('50000')] }),
    ).toBeNull()
  })

  // Una venta en dólares pagada en dólares pasa de DOS renglones ("Total
  // $ 0,00" + "Total en dólares US$ 300,00") a uno solo.
  it('null también con una venta en dólares pagada en dólares', () => {
    expect(
      lineasDeRecargo({ total: d('0'), recargo: d('0'), totalUsd: d('300'), pagos: [pagoUsd('300')] }),
    ).toBeNull()
  })

  it('en pesos con recargo: Vendido / Recargo / Cobrado, y la banda es Cobrado', () => {
    const lineas = lineasDeRecargo({
      total: d('50000'), recargo: d('20000'), totalUsd: d('0'), pagos: [pagoArs('70000')],
    })
    expect(lineas?.map((l) => l.rotulo)).toEqual(['Vendido', 'Recargo', 'Cobrado'])
    expect(lineas?.map((l) => l.destacada)).toEqual([false, false, true])
    expect(lineas?.[2].valor).toContain('70.000,00')
  })

  it('con recargo negativo la palabra es Descuento y el importe va sin signo', () => {
    const lineas = lineasDeRecargo({
      total: d('50000'), recargo: d('-5000'), totalUsd: d('0'), pagos: [pagoArs('45000')],
    })
    expect(lineas?.[1].rotulo).toBe('Descuento')
    expect(lineas?.[1].valor).not.toContain('-')
    expect(lineas?.[1].valor).toContain('5.000,00')
  })

  // El caso canónico del proyecto: el iPhone de lista US$ 300 cobrado en pesos
  // a 1485 con un plan de 12 cuotas al 40 %. Antes de este ciclo el pie decía
  // "Mercadería $ 0,00 / Recargo $ 178.200 / Cobrado $ 178.200 / Total en
  // dólares US$ 300" — cuatro renglones donde el "Cobrado" no era lo cobrado.
  it('el caso canónico: Vendido en dólares, Recargo y Cobrado en pesos', () => {
    const lineas = lineasDeRecargo({
      total: d('0'), recargo: d('178200'), totalUsd: d('300'), pagos: [pagoArs('623700')],
    })
    expect(lineas?.map((l) => l.rotulo)).toEqual(['Vendido', 'Recargo', 'Cobrado'])
    expect(lineas?.[0].valor).toContain('US$')
    expect(lineas?.[0].valor).toContain('300,00')
    expect(lineas?.[1].valor).toContain('178.200,00')
    expect(lineas?.[2].valor).toContain('623.700,00')
    // Una sola banda, no dos: el renglón "Cobrado" ya lleva las dos monedas
    // cuando hace falta, así que no hay una segunda banda por moneda.
    expect(lineas?.filter((l) => l.destacada)).toHaveLength(1)
  })

  // El caso del feedback: US$ 300 cobrados US$ 200 en billetes + el resto en
  // pesos. Sin recargo, pero las dos magnitudes difieren.
  it('el caso del feedback: sin recargo, pero Vendido y Cobrado difieren', () => {
    const lineas = lineasDeRecargo({
      total: d('0'), recargo: d('0'), totalUsd: d('300'),
      pagos: [pagoUsd('200'), pagoArs('148500')],
    })
    expect(lineas?.map((l) => l.rotulo)).toEqual(['Vendido', 'Cobrado'])
    expect(lineas?.[0].valor).toContain('300,00')
    expect(lineas?.[1].valor).toContain('148.500,00')
    expect(lineas?.[1].valor).toContain('US$')
  })
})
```

Y, en el bloque de regresión que lee el fuente de esa pantalla, agregar:

```tsx
  it('el renglón único puede mostrar dólares: usa formatearTotales, no formatearPrecio', () => {
    expect(fuente).toContain('totalFormateado={formatearTotales(vendidoDeVenta(venta))}')
    expect(fuente).not.toContain('totalFormateado={formatearPrecio(venta.total.toString())}')
  })
```

(Si en ese archivo no existe una constante `fuente`, agregarla con
`const fuente = readFileSync('app/(app)/ventas/[id]/page.tsx', 'utf8')`, igual
que en `app/(app)/ventas/page.test.tsx`. Y agregar `d`/`pagoArs`/`pagoUsd` si
faltan.)

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run "app/(app)/ventas/[id]/page.test.tsx"
```

Esperado: FALLA — `lineasDeRecargo` no acepta `pagos` y devuelve `monto`, no `valor`.

- [ ] **Step 3: Escribir la implementación**

En `app/(app)/ventas/[id]/page.tsx`:

**3a.** Cambiar el import de `@/lib/ventas/totales`: sacar `totalCobrado`
(quedan `subtotalItem`, `pesosEntregados`, `baseEnDolares`). Agregar:

```ts
import {
  vendidoDeVenta, cobradoDePagos, hayQueDesglosar, formatearTotales,
} from '@/lib/ventas/cobrado'
```

**3b.** Reemplazar el tipo `LineaDeTotal` y su comentario por:

```ts
/** Una línea del pie de "Qué se vendió": el importe YA formateado —puede
 *  llevar las dos monedas unidas por " + ", así que ya no hay una `moneda`
 *  única que lo describa— y si es la banda destacada (--marca). */
export type LineaDeTotal = { rotulo: string; valor: string; destacada: boolean }
```

**3c.** Reemplazar `lineasDeRecargo` entera por:

```ts
/**
 * Las líneas del pie de "Qué se vendió": el desglose Vendido / Recargo /
 * Cobrado, o `null` cuando no hay nada que desglosar y el llamador cae al
 * renglón único "Total".
 *
 * `null` es el caso común —toda venta en pesos sin plan— y también, desde este
 * ciclo, toda venta en dólares pagada en dólares: antes ésa mostraba dos
 * renglones ("Total $ 0,00" más "Total en dólares US$ 300,00") y ahora muestra
 * uno.
 *
 * **"Vendido" y no "Mercadería"**: es la misma palabra que usan la columna
 * Total del listado y el tile "Total del período", y una sola palabra para una
 * sola magnitud. **"Cobrado" es lo que entró de verdad**, apilado por la moneda
 * de cada pago (`cobradoDePagos`), no `total + recargo` — desde que un pago en
 * pesos puede cubrir el total en dólares esas dos cosas dejaron de ser lo
 * mismo, y ahí vivía el defecto que este ciclo arregla.
 *
 * **Una sola banda destacada, no dos.** Antes podía haber una por moneda,
 * porque el lado de los dólares era un renglón aparte; ahora el renglón
 * "Cobrado" lleva las dos monedas cuando hace falta.
 *
 * El recargo va SIEMPRE en pesos —`Pago.recargo` y `Venta.recargo` lo son por
 * diseño, incluso cuando el pago que lo generó cubría el total en dólares—,
 * así que nunca hay un "Recargo" que desglosar en dólares. La gramática no
 * cambia: la palabra sale del SIGNO —"Recargo" si suma, "Descuento" si resta—
 * y bajo "Descuento" el importe va SIN el signo, porque la palabra ya dice de
 * qué lado está. Y no nombra el plan: con pagos partidos entre dos planes,
 * nombrar uno le atribuiría el recargo entero a uno de los dos (eso lo dice la
 * columna "Plan" de la tabla de pagos, de a un pago por vez).
 */
export function lineasDeRecargo(v: {
  total: Decimal
  recargo: Decimal
  totalUsd?: Decimal
  pagos: { moneda: Moneda; monto: Decimal }[]
}): LineaDeTotal[] | null {
  const vendido = vendidoDeVenta({ total: v.total, totalUsd: v.totalUsd ?? new Prisma.Decimal(0) })
  const cobrado = cobradoDePagos(v.pagos)
  if (!hayQueDesglosar(vendido, cobrado, v.recargo)) return null

  const lineas: LineaDeTotal[] = [
    { rotulo: 'Vendido', valor: formatearTotales(vendido), destacada: false },
  ]
  if (!v.recargo.isZero()) {
    lineas.push({
      rotulo: v.recargo.isNegative() ? 'Descuento' : 'Recargo',
      valor: formatearTotales({ ars: v.recargo.abs(), usd: new Prisma.Decimal(0) }),
      destacada: false,
    })
  }
  lineas.push({ rotulo: 'Cobrado', valor: formatearTotales(cobrado), destacada: true })
  return lineas
}
```

(Si `Moneda` no está importado en el archivo, agregar
`import type { Moneda } from '@/generated/prisma/client'`.)

**3d.** **El call site NO cambia**: ya es `const lineasDeTotal = lineasDeRecargo(venta)`,
y `venta` ya carga sus pagos para la tabla "Cómo se pagó" — el parámetro nuevo
entra solo. (Hay un caso que cablea esa línea exacta, `'el pie de "Qué se
vendió" usa lineasDeRecargo(), no venta.total a secas'`, y tiene que seguir
verde.) Lo que sí cambia es el JSX:

```tsx
        totalFormateado={formatearTotales(vendidoDeVenta(venta))}
        lineasDeTotal={
          lineasDeTotal?.map(({ rotulo, valor, destacada }) => ({
            rotulo, montoFormateado: valor, destacada,
          })) ?? null
        }
```

Verificar que el `select` de la venta incluya `pagos: { select: { …, moneda: true, monto: true, … } }`
—ya lo hace para la tabla de pagos— y que `totalUsd` siga en el select.

**3e.** Actualizar el comentario del bloque del pie en `Detalle` (el que
describe "Mercadería, Recargo/Cobrado … más «Total en dólares»") para que
describa `Vendido / Recargo / Cobrado` y diga que ahora hay **una sola** banda
destacada. El prop `lineasDeTotal` de `Detalle` **no cambia de forma**: sigue
siendo `{ rotulo, montoFormateado, destacada }[]`.

**3f.** Si `precioEnSuMoneda` o `formatearPrecio` quedaron sin usos, sacarlos
del import; `precioEnSuMoneda` probablemente siga en uso en la tabla de pagos.

**3g.** Actualizar el caso `'con totalUsd, hay DOS bandas destacadas: una en
pesos y otra en dólares'` del `describe` de render de `Detalle` (línea ~440).
**Ese caso queda VERDE igual** —`Detalle` sigue aceptando N bandas y el test le
pasa su propio fixture, no el resultado de `lineasDeRecargo`—, así que nada
avisaría de que documenta un escenario que la pantalla ya no produce. Se
reemplaza por su equivalente nuevo, sin tocar el componente:

```tsx
  // El renglón "Cobrado" lleva las dos monedas cuando hace falta, así que
  // desde el ciclo del cobrado por moneda hay UNA sola banda destacada y no
  // una por moneda. `Detalle` sigue soportando varias —el `destacada` es por
  // línea— pero `lineasDeRecargo` ya no genera dos.
  it('con las dos monedas, UNA sola banda destacada y las dos en el mismo renglón', () => {
    const html = renderDetalle({
      lineasDeTotal: [
        { rotulo: 'Vendido', montoFormateado: 'US$ 300,00', destacada: false },
        { rotulo: 'Cobrado', montoFormateado: '$ 148.500,00 + US$ 200,00', destacada: true },
      ],
    })
    const bandas = html.match(/class="flex items-center justify-between bg-\[var\(--marca\)\][^"]*lg:bg-muted[^"]*"/g) ?? []
    expect(bandas).toHaveLength(1)
    expect(html).toContain('$ 148.500,00 + US$ 200,00')
    expect(html).toContain('>Vendido<')
  })
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

```bash
npx vitest run "app/(app)/ventas/[id]/page.test.tsx"
```

Esperado: PASS.

- [ ] **Step 5: Actualizar `docs/pantallas.md`, sección `/ventas/[id]`**

El pie de "Qué se vendió" pasa a describirse como `Vendido / Recargo / Cobrado`,
con el renglón único "Total" cuando no hay nada que desglosar —que ahora incluye
las ventas en dólares pagadas en dólares—, y con **una sola** banda destacada.
Dejar escrito que "Cobrado" es la plata que entró apilada por la moneda de cada
pago, no `total + recargo`.

- [ ] **Step 6: Verificar tipos y lint**

```bash
npx tsc --noEmit && npx eslint "app/(app)/ventas/[id]/page.tsx" && npx vitest run test/pantallas.test.ts
```

Esperado: sin salida en los dos primeros; el test en verde.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/ventas/[id]/page.tsx" "app/(app)/ventas/[id]/page.test.tsx" docs/pantallas.md
git commit -m "feat(ventas): el detalle muestra lo cobrado por moneda, no total + recargo"
```

---

### Task 5: El caso del feedback de punta a punta, y la poda de `totalCobrado`

**Files:**
- Modify: `test/ventas.test.ts`
- Modify: `lib/ventas/totales.ts` (borrar `totalCobrado`)
- Modify: `lib/ventas/totales.test.ts` (borrar su `describe`)

**Interfaces:**
- Consumes: `vendidoDeVenta`, `cobradoDePagos` de `@/lib/ventas/cobrado`.
- Produces: nada. `totalCobrado` deja de existir.

- [ ] **Step 1: Escribir el test de aceptación**

En `test/ventas.test.ts`, agregar un `describe` al final del archivo. Importa
desde `lib/` de forma estática porque `cobrado.ts` no toca la base:

```ts
// El caso literal del feedback que abrió este ciclo, de punta a punta: un
// iPhone de lista US$ 300 cobrado con US$ 200 en billetes y el resto en pesos
// a 1485. Antes de este ciclo /ventas lo mostraba como "una venta de US$ 300";
// lo que tiene que decir es que se vendió US$ 300 y que entraron US$ 200 más
// $ 148.500.
//
// Va contra la base y no en cobrado.test.ts a propósito: lo que se prueba acá
// no es la aritmética —eso ya está— sino que `crearVenta` GUARDE los pagos de
// forma que las dos magnitudes salgan bien al leerlos.
describe('el caso del feedback: US$ 300 cobrados en dos monedas', () => {
  it('la venta se guarda con la mercadería en dólares y los pagos en su moneda', async () => {
    const { vendidoDeVenta, cobradoDePagos } = await import('@/lib/ventas/cobrado')

    const iphone = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, 'iPhone del feedback', 'PRODUCTO', 300, 'USD', 10, now(), now())
       RETURNING id`,
      [tenantId, `USD-FB-${Date.now()}`],
    )

    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: iphone.rows[0].id, cantidad: d('1') }],
      pagos: [
        // US$ 200 en billetes: la base va en dólares y cubre el total en dólares.
        { medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', base: d('200'), cotizacion: d('1485') },
        // Los US$ 100 restantes, pagados en PESOS a 1485: `base` sigue yendo en
        // dólares (es lo que cubre) y el motor calcula los $ 148.500.
        { medio: 'EFECTIVO', moneda: 'ARS', cubre: 'USD', base: d('100'), cotizacion: d('1485') },
      ],
    })

    const venta = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.venta.findUniqueOrThrow({
        where: { id },
        select: {
          total: true, totalUsd: true, recargo: true,
          pagos: { select: { moneda: true, monto: true }, orderBy: { creadoEn: 'asc' } },
        },
      }),
    )

    // La mercadería no cambia: el iPhone es US$ 300 se pague como se pague.
    const vendido = vendidoDeVenta(venta)
    expect(vendido.ars.toString()).toBe('0')
    expect(vendido.usd.toString()).toBe('300')

    // Lo que entró al cajón, apilado por la moneda ENTREGADA.
    const cobrado = cobradoDePagos(venta.pagos)
    expect(cobrado.usd.toString()).toBe('200')
    expect(cobrado.ars.toString()).toBe('148500')

    // Y el defecto que este ciclo arregla, dicho como aserción: las dos
    // magnitudes NO son la misma, así que la pantalla tiene que mostrar las dos.
    expect(cobrado.usd.equals(vendido.usd)).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que pasa**

```bash
npx vitest run test/ventas.test.ts
```

Esperado: PASS. **Si falla**, no parchear el test: significa que `crearVenta`
guarda algo distinto de lo que el spec describe, y hay que detenerse y
reportarlo — el spec afirma que la venta ya se guarda bien y todo el ciclo se
apoya en eso.

- [ ] **Step 3: Borrar `totalCobrado`**

En `lib/ventas/totales.ts`, borrar la función `totalCobrado` con su docblock
completo (desde `/**\n * Lo que entró a la caja por una venta:` hasta el cierre
de la función). En `lib/ventas/totales.test.ts`, borrar el
`describe('totalCobrado', ...)` y sacar `totalCobrado` del import.

**`totalDeItems` y `totalDePagos` NO se tocan**: siguen anclando el espejo de la
aritmética en enteros del navegador en `lib/ventas/centavos.test.ts`.

- [ ] **Step 4: Verificar que no quedó ningún llamador**

```bash
grep -rn "totalCobrado" app lib test scripts
```

Esperado: **sin salida**. Si aparece algo, es un llamador que las tasks 2-4 no
migraron.

- [ ] **Step 5: Correr la suite entera**

```bash
npm test
```

Esperado: todo en verde.

- [ ] **Step 6: Verificar tipos y lint del repo**

```bash
npx tsc --noEmit && npx eslint
```

Esperado: sin salida.

- [ ] **Step 7: Commit**

```bash
git add test/ventas.test.ts lib/ventas/totales.ts lib/ventas/totales.test.ts
git commit -m "test(ventas): el caso del feedback de punta a punta, y se poda totalCobrado"
```

---

### Task 6: La documentación del ciclo

**Files:**
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 26)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada. Produces: nada.

- [ ] **Step 1: Agregar la entrada 26 a `docs/correcciones-pendientes-del-pen.md`**

Antes de la sección final `## Cómo agregar una entrada`, con el mismo formato
que las 25 anteriores (mirar la 24 como molde). Contenido:

**Título:** `## 26. La maqueta no dibuja el desglose Vendido/Cobrado, en ninguna de las tres pantallas`

**Cuerpo:** `design/arandano.pen` es anterior a este ciclo, así que no tiene
frame para (1) la columna Total del listado con dos líneas rotuladas, (2) el
tile "Total del período" con rótulos de línea, ni (3) el pie de `/ventas/[id]`
con `Vendido / Recargo / Cobrado`. Las tres formas se derivaron del código.
Dejar escrito qué se derivó y con qué criterio: los rótulos reusan el rol
tipográfico que el tile ya tenía (10 px, bold, uppercase, tracking), pintados
con `--marca-dim` para no competir con el rótulo del tile, y **no** agregan
ninguna fila a la escala de `docs/sistema-de-diseno.md`. Y anotar que sigue
pendiente, de antes de este ciclo, que una persona guarde desde Pencil el
`.pen` vivo y lo commitee: el versionado sigue siendo el del 2026-08-21.

- [ ] **Step 2: Agregar la entrada del ciclo a `CLAUDE.md`**

En **Próximos pasos técnicos**, después del ítem que empieza con
`~~Mostrar cada moneda por separado en "Cómo entró la plata"…~~`, agregar un
ítem tachado nuevo. Tiene que cubrir, con el tono del resto del archivo:

1. El origen: el feedback textual del cliente, citado.
2. Que **la venta ya se guardaba bien** y que el defecto era de lectura: la
   columna y el tile leían la mercadería, no la plata que entró.
3. Que la columna era **híbrida sin decirlo** —pesos = cobrado, dólares =
   mercadería— y que este ciclo la ordena.
4. Las cinco decisiones con su alternativa descartada (las dos magnitudes y no
   una; dos líneas sólo cuando difieren, con el costo aceptado para un local con
   planes; el número sale de `Pago` y no de columnas cacheadas, con la razón del
   backfill; nada se convierte; `/vender` no se toca).
5. Que **no hay migración**, y por lo tanto no hay nada de expand/contract que
   coordinar.
6. Que `totalCobrado()` se podó y por qué (a diferencia de `totalDeItems` y
   `totalDePagos`, que se conservan como anclas de test).
7. La lección que dejó el ciclo al escribir el plan: **una regla que la base
   efímera tiene que poder ejercitar no puede vivir en una consulta inline de un
   Server Component `async`** — es el motivo por el que se descartó reusar la
   `groupBy` del panel de medios y por el que existe `pagosDelPeriodo`. Es la
   misma lección del hallazgo I3, aplicada antes de pagarla.
8. Lo que sigue: la costura con "Cómo entró la plata", que se angosta y no
   desaparece.
9. La verificación manual pendiente.

- [ ] **Step 3: Corregir el párrafo que declaraba la costura como abierta**

En `CLAUDE.md`, en la entrada del 2026-08-30, el párrafo **"Lo que este ciclo no
cierra"** dice que la costura entre el tile y "Cómo entró la plata" sigue
abierta y que cerrarla es "una decisión de producto con su propio ciclo".
Reescribirlo para que diga que **la mitad del tile se cerró el 2026-08-31** —el
tile pasó a mostrar la plata que entró en cada moneda— y que lo que queda
abierto es sólo que el panel siga convirtiendo, porque sus barras necesitan una
unidad común. Dejar la entrada como registro de lo que era cierto ese día, igual
que ya hace el archivo con el conteo de superficies de `--marca`.

- [ ] **Step 4: Verificar el gate de documentación**

```bash
npm test
```

Esperado: todo en verde (`test/pantallas.test.ts`, `test/maqueta.test.ts` y
`test/sistema-de-diseno.test.ts` incluidos).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/correcciones-pendientes-del-pen.md
git commit -m "docs: el ciclo del cobrado por moneda, y la costura que queda"
```

---

## Verificación final (a ojo, y no la reemplaza ningún test)

No es una task: es lo que hay que hacer antes de dar el ciclo por cerrado.

1. Levantar el entorno local (Postgres en Docker + `npm run dev`, que sirve en
   `:3001` porque el 3000 está tomado).
2. Sembrar catálogo y ventas con importes de **distinta cantidad de dígitos**
   (`npm run catalogo:sembrar`, `npm run ventas:sembrar`): con montos parejos no
   se ve si las columnas de números bailan.
3. Cargar a mano la venta del feedback en `/vender`: el iPhone en dólares,
   US$ 200 en efectivo y el resto en pesos con la cotización.
4. Mirar en `/ventas`, **a 1440 px y a 390 px**:
   - Que una venta en pesos sin plan se vea **exactamente** como antes: un solo
     número, sin rótulos.
   - Que la venta del feedback muestre `Vendido US$ 300,00` y
     `Cobrado $ 148.500,00 + US$ 200,00`.
   - Que el tile con dos líneas rotuladas **no quede apretado en el teléfono** —
     es el riesgo específico de este ciclo y ningún test lo puede juzgar.
   - Que el promedio del tile "Ventas cobradas" muestre un número y no se omita.
5. Abrir esa venta y ver el pie: `Vendido / Cobrado`, una sola banda destacada.
