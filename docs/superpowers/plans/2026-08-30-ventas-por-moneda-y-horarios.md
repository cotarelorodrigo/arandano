# Las dos monedas en "Cómo entró la plata", y cuándo vende el local — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que `/ventas` muestre los dólares sin convertir al lado de los pesos en "Cómo entró la plata", que gane el panel "Cuándo vende el local", y que el campo de precio de venta tenga el radio que la maqueta le dibujó.

**Architecture:** tres piezas independientes de presentación, sin migración. La lógica pura vive en `lib/ventas/` (probable sin Prisma), los componentes en `app/(app)/ventas/`, y `page.tsx` los cablea con una consulta más dentro del `Promise.all` que ya tiene. El estado del panel nuevo viaja en la URL (`?vista=hora|dia`), así que ningún componente de este plan lleva `'use client'`.

**Tech Stack:** Next.js App Router (server components), TypeScript, Prisma, Tailwind v4, shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-ventas-por-moneda-y-horarios-design.md`

## Global Constraints

- **Paso 0, antes de la Task 1 y lo hace una persona**: guardar el documento abierto en Pencil como `design/arandano.pen` y commitearlo. El MCP ignora su parámetro `filePath` y lee siempre el documento del editor; el archivo versionado tiene un solo commit, del 2026-08-21. Sin esto, todo este plan se escribe contra una maqueta que no está en el repo.
- **Nada de `$queryRaw`.** La extensión de `lib/tenant/prisma.ts` intercepta operaciones de modelo, no raw queries: un raw no lleva `set_config('arandano.tenant_id')` y RLS devuelve cero filas **en silencio**.
- **Toda hora es hora de Buenos Aires**, con `timeZone: 'America/Argentina/Buenos_Aires'` declarado. El servidor está en Ashburn.
- **Mobile-first**: el valor sin prefijo es el del teléfono, el de escritorio va con `lg:`. Un solo corte, 1024 px. Ningún ancho fijo mayor a 362 px sin `lg:` (lo vigila `test/responsive.test.ts`).
- **Ningún hex crudo** fuera de `components/ui/`: se usan tokens (`bg-primary`, `bg-accent`, `text-muted-foreground`, …).
- **Sin `'use client'`** en ningún archivo nuevo de este plan.
- Los tests corren con `npx vitest run <ruta>` (5 s para un archivo puro). El gate completo es `npm test`.
- Los textos de pantalla son **literales de la maqueta**; los que este plan deriva están marcados como tales.

---

### Task 1: `usdCrudo` — los dólares sin convertir, en la composición

**Files:**
- Modify: `lib/ventas/medios.ts` (el tipo `Barra`)
- Modify: `lib/ventas/composicion.ts` (el acumulador de `componerPorMedio`)
- Test: `lib/ventas/composicion.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `Barra` gana `usdCrudo: string` — los dólares del medio **sin pasar por ninguna cotización**. Lo consumen las Tasks 2 (`GraficoDeMedios`).

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/ventas/composicion.test.ts`, agregar estos tres casos dentro del `describe('componerPorMedio')` que ya existe:

```ts
  it('los dólares crudos NO pasan por ninguna cotización', () => {
    // El mismo par de filas del caso de arriba: 150 dólares en total, tomados
    // a dos cotizaciones distintas. `usd` los convierte y suma 185.000 pesos;
    // `usdCrudo` dice 150, que es lo que la segunda línea del panel muestra.
    const { barras } = componerPorMedio([
      fila('EFECTIVO', 'USD', '100', '1200'),
      fila('EFECTIVO', 'USD', '50', '1300'),
    ])
    expect(barras[0].usdCrudo).toBe('150')
    expect(barras[0].usd).toBe('185000')
  })

  it('un pago en PESOS con cotización distinta de 1 no aporta a usdCrudo', () => {
    // El pago que cubre el total en dólares entregando pesos (ciclo del
    // 2026-08-29): lleva la cotización real, 1485, con el monto YA en pesos.
    // Entró en pesos, así que la línea de dólares del panel no lo nombra —
    // es la misma regla por la que `pesosEntregados` no lo multiplica.
    const { barras } = componerPorMedio([fila('TARJETA_CREDITO', 'ARS', '623700', '1485')])
    expect(barras[0]).toEqual({
      medio: 'TARJETA_CREDITO',
      ars: '623700',
      usd: '0',
      usdCrudo: '0',
      total: '623700',
    })
  })

  it('multiplica los dólares crudos por la cantidad de pagos del grupo', () => {
    // El `_count` del groupBy: tres pagos idénticos de US$ 20 son US$ 60.
    const { barras } = componerPorMedio([fila('EFECTIVO', 'USD', '20', '1485', 3)])
    expect(barras[0].usdCrudo).toBe('60')
  })
```

Y actualizar los `toEqual` que ya existen, que enumeran la barra entera y por lo tanto fallan al sumarse un campo:

```ts
    expect(barras).toEqual([{ medio: 'EFECTIVO', ars: '0', usd: '185000', usdCrudo: '150', total: '185000' }])
```

```ts
    expect(barras).toEqual([{ medio: 'EFECTIVO', ars: '5000', usd: '12000', usdCrudo: '10', total: '17000' }])
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run lib/ventas/composicion.test.ts`
Expected: FAIL — los casos nuevos por `expected undefined to be '150'`, y los dos `toEqual` viejos por la propiedad que falta.

- [ ] **Step 3: Sumar el campo al tipo**

En `lib/ventas/medios.ts`, dentro de `export type Barra`, después de `usd`:

```ts
  /**
   * Lo cobrado en dólares, SIN convertir: la segunda línea del rótulo de cada
   * medio (design/arandano.pen, nodo `l4Inhd`).
   *
   * A diferencia de `ars` y `usd` —que están los dos en pesos y siguen sin
   * consumidor de producción—, éste sí tiene uno: `GraficoDeMedios`. Y es
   * justamente el número que `usd` no puede dar, porque `usd` ya pasó por la
   * cotización de cada pago.
   *
   * Un pago en PESOS que cubre el total en dólares no entra acá: la línea
   * dice qué moneda entró al cajón, y esos fueron pesos. Misma regla que
   * `pesosEntregados` usa para decidir si multiplica.
   */
  usdCrudo: string
```

- [ ] **Step 4: Acumularlo en `componerPorMedio`**

En `lib/ventas/composicion.ts`, tres cambios dentro de la función:

```ts
  const acumulado = new Map<Medio, { ars: Decimal; usd: Decimal; usdCrudo: Decimal }>()
```

```ts
    const actual =
      acumulado.get(f.medio) ??
      { ars: new Prisma.Decimal(0), usd: new Prisma.Decimal(0), usdCrudo: new Prisma.Decimal(0) }

    if (f.moneda === 'USD') {
      hayDolares = true
      actual.usd = actual.usd.add(enPesos)
      // Sin `pesosEntregados` y sin cotización: son los dólares que entraron.
      // Con el mismo `_count` que el resto, que es lo que mantiene el
      // redondeo por pago (ver el docblock de FilaDePagos).
      actual.usdCrudo = actual.usdCrudo.add(f.monto.mul(f._count))
    } else {
      actual.ars = actual.ars.add(enPesos)
    }
```

```ts
  const barras: Barra[] = [...acumulado.entries()]
    .map(([medio, { ars, usd, usdCrudo }]) => ({
      medio,
      ars: ars.toString(),
      usd: usd.toString(),
      usdCrudo: usdCrudo.toString(),
      total: ars.add(usd).toString(),
    }))
```

`total` se sigue armando con `ars.add(usd)` y **no** toca `usdCrudo`: la barra y el porcentaje siguen midiendo pesos, que es lo que la nota nueva de la Task 2 le promete al lector.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run lib/ventas/composicion.test.ts`
Expected: PASS (14 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/medios.ts lib/ventas/composicion.ts lib/ventas/composicion.test.ts
git commit -m "feat(ventas): los dólares de cada medio, sin convertir"
```

---

### Task 2: las dos líneas y la nota nueva en "Cómo entró la plata"

**Files:**
- Modify: `app/(app)/ventas/grafico.tsx`
- Test: `app/(app)/ventas/grafico.test.tsx`
- Modify: `docs/pantallas.md` (sección `/ventas`)

**Interfaces:**
- Consumes: `Barra.usdCrudo` de la Task 1.
- Produces: nada que otra task consuma.

- [ ] **Step 1: Escribir los tests que fallan**

En `app/(app)/ventas/grafico.test.tsx`, primero los fixtures que ya existen necesitan el campo nuevo (si no, no compilan). `CUATRO_MEDIOS` lleva `usdCrudo: '0'` en sus cuatro barras, y `UN_MEDIO` pasa a tener dólares de verdad:

```ts
const UN_MEDIO: Composicion = {
  barras: [{ medio: 'EFECTIVO', ars: '90000', usd: '12000', usdCrudo: '10', total: '102000' }],
  total: '102000',
  hayDolares: true,
}
```

Y los casos nuevos, en el `describe('GraficoDeMedios')` que ya existe:

```ts
  it('muestra los dólares en su propia línea, sin convertir', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    // Los pesos del medio y los dólares que entraron, cada uno con su
    // formateador: US$ 10, no los $ 12.000 en los que se convirtieron.
    expect(html).toContain('$ 90.000,00')
    expect(html).toContain('US$ 10,00')
    expect(html).not.toContain('$ 12.000,00')
  })

  it('sin dólares, ningún medio muestra una segunda línea', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={CUATRO_MEDIOS} />)
    expect(html).not.toContain('US$')
  })

  it('la nota explica que la barra compara en pesos', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).toContain('Cada moneda dice su propio número.')
    expect(html).toContain('La barra compara todo en pesos, a la cotización de cada pago.')
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run app/\(app\)/ventas/grafico.test.tsx`
Expected: FAIL — `US$ 10,00` no aparece y la nota nueva tampoco.

- [ ] **Step 3: Implementar las dos líneas y la nota**

En `app/(app)/ventas/grafico.tsx`, sumar `formatearDolares` al import que ya trae `formatearPrecio`:

```ts
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
```

Reemplazar el `<span>` del monto por el bloque de dos líneas:

```tsx
              {/* Los importes apilados y alineados a la derecha
                  (design/arandano.pen, nodo `l4Inhd`): los pesos arriba, en
                  13/600; los dólares abajo, en 12/600 y un tono más apagado.
                  Que la línea de dólares sea MÁS CHICA es deliberado, y a
                  propósito distinto del tile "Total del período" de la misma
                  pantalla, donde las dos monedas van a 32 px y al mismo
                  color: allá ninguna manda sobre la otra, acá el número que
                  gobierna la barra es el de pesos y éste es el detalle de
                  qué parte entró en billetes. */}
              <span className="flex flex-col items-end gap-px">
                <span className={`${estilos.archivo} text-[13px] font-semibold text-foreground`}>
                  {formatearPrecio(b.ars)}
                </span>
                {/* Sólo los medios que tuvieron dólares: en el frame,
                    Efectivo y Transferencia la tienen, Débito y Crédito no. */}
                {Number(b.usdCrudo) !== 0 && (
                  <span className={`${estilos.archivo} text-[12px] font-semibold text-foreground-soft`}>
                    {formatearDolares(b.usdCrudo)}
                  </span>
                )}
              </span>
```

**Ojo con lo que cambia acá y no es sólo agregar**: la línea de pesos pasa a mostrar `b.ars` y ya no `b.total`. `total` sigue siendo lo que mide la barra y el porcentaje, pero como importe visible sumaba los dólares convertidos a los pesos — que es exactamente lo que la maqueta parte en dos.

Y reemplazar el texto de la nota:

```tsx
          <p className="text-[11px] leading-[1.4] text-muted-foreground">
            Cada moneda dice su propio número. La barra compara todo en pesos, a
            la cotización de cada pago.
          </p>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run app/\(app\)/ventas/grafico.test.tsx`
Expected: PASS

- [ ] **Step 5: Actualizar `docs/pantallas.md`**

En la sección `/ventas`, reemplazar la viñeta de "Cómo entró la plata" por:

```markdown
- Ver **"Cómo entró la plata"**: una barra por medio de pago, de un solo color,
  con **un importe por moneda** en el rótulo — los pesos arriba y, sólo si ese
  medio recibió dólares, los dólares abajo, sin convertir. La barra y el
  porcentaje siguen comparando todo en pesos, a la cotización de cada pago, que
  es lo que dice la nota del pie: una barra que mezclara unidades no se podría
  comparar contra la de al lado. Un pago en pesos que cubre el total en dólares
  cuenta como pesos — la línea dice qué moneda entró al cajón.
```

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/ventas/grafico.tsx app/\(app\)/ventas/grafico.test.tsx docs/pantallas.md
git commit -m "feat(ventas): cada moneda dice su propio número en Cómo entró la plata"
```

---

### Task 3: `lib/ventas/horarios.ts` — la agregación por hora y por día

**Files:**
- Create: `lib/ventas/horarios.ts`
- Test: `lib/ventas/horarios.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type Vista = 'hora' | 'dia'` y `const VISTAS: readonly Vista[]`
  - `function vistaValida(v: string | undefined): Vista` — cualquier cosa que no sea `'dia'` cae en `'hora'`
  - `type BarraDeTiempo = { clave: string; rotulo: string; ventas: number; pico: boolean }`
  - `type Horarios = { barras: BarraDeTiempo[]; pie: string }`
  - `function agregarPorTiempo(fechas: Date[], vista: Vista): Horarios`

Los consumen las Tasks 4 y 5.

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/ventas/horarios.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { agregarPorTiempo, vistaValida } from './horarios'

/** Un instante UTC, que es como Postgres devuelve `Venta.creadoEn`. */
const utc = (iso: string) => new Date(iso)

describe('vistaValida', () => {
  it('cae en hora ante cualquier cosa que no sea dia', () => {
    // Mismo criterio que fechaOhoy y que el clamp de ?p: un query string
    // escrito a mano no puede servir un 500.
    expect(vistaValida('dia')).toBe('dia')
    expect(vistaValida('hora')).toBe('hora')
    expect(vistaValida(undefined)).toBe('hora')
    expect(vistaValida('AAAA')).toBe('hora')
  })
})

describe('agregarPorTiempo · vista hora', () => {
  it('cuenta en hora de Buenos Aires y no en UTC', () => {
    // 23:30 UTC son las 20:30 en Buenos Aires. Sin el huso declarado, esta
    // venta caería en la barra de las 23 y el local vería un pico que no
    // existe tres horas después de cerrar.
    const { barras } = agregarPorTiempo([utc('2026-08-21T23:30:00Z')], 'hora')
    const conVentas = barras.filter((b) => b.ventas > 0)
    expect(conVentas).toHaveLength(1)
    expect(conVentas[0].clave).toBe('20')
  })

  it('la franja va de la hora más temprana a la más tardía con ventas', () => {
    // Un local que abre a las 8 y cierra a las 22: quince barras, no las doce
    // que dibuja la maqueta. Con la franja fija, esas dos ventas de los
    // extremos no aparecerían en ningún lado.
    const { barras } = agregarPorTiempo(
      [utc('2026-08-21T11:00:00Z'), utc('2026-08-22T01:00:00Z')],
      'hora',
    )
    expect(barras.map((b) => b.clave)).toEqual([
      '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22',
    ])
  })

  it('sin ninguna venta, la franja es la de la maqueta', () => {
    const { barras, pie } = agregarPorTiempo([], 'hora')
    expect(barras.map((b) => b.clave)).toEqual([
      '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    ])
    expect(barras.every((b) => b.ventas === 0 && !b.pico)).toBe(true)
    expect(pie).toBe('Todavía no hubo ventas en este período.')
  })

  it('marca una sola barra como pico y lo dice en el pie', () => {
    const fechas = [
      utc('2026-08-21T21:00:00Z'), // 18 h
      utc('2026-08-21T21:30:00Z'), // 18 h
      utc('2026-08-21T15:00:00Z'), // 12 h
    ]
    const { barras, pie } = agregarPorTiempo(fechas, 'hora')
    expect(barras.filter((b) => b.pico).map((b) => b.clave)).toEqual(['18'])
    expect(pie).toBe('El pico es a las 18 h, con 2 ventas.')
  })

  it('con empate gana la hora más temprana', () => {
    // Dos horas con una venta cada una: pintar las dos de --primary diría que
    // hubo dos picos, y el pie tendría que elegir igual. Elige una sola, y es
    // la primera — el mismo criterio para el color y para el texto.
    const { barras, pie } = agregarPorTiempo(
      [utc('2026-08-21T13:00:00Z'), utc('2026-08-21T21:00:00Z')],
      'hora',
    )
    expect(barras.filter((b) => b.pico).map((b) => b.clave)).toEqual(['10'])
    expect(pie).toBe('El pico es a las 10 h, con 1 venta.')
  })
})

describe('agregarPorTiempo · vista día', () => {
  it('son siempre siete barras, de lunes a domingo', () => {
    const { barras } = agregarPorTiempo([utc('2026-08-21T15:00:00Z')], 'dia')
    expect(barras.map((b) => b.rotulo)).toEqual(['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'])
  })

  it('agrupa por día de la semana en hora de Buenos Aires', () => {
    // 2026-08-21 es viernes. A las 02:00 UTC del sábado 22 todavía es viernes
    // en Buenos Aires (23:00), así que las dos ventas caen en el mismo día.
    const { barras, pie } = agregarPorTiempo(
      [utc('2026-08-21T15:00:00Z'), utc('2026-08-22T02:00:00Z')],
      'dia',
    )
    const viernes = barras.find((b) => b.rotulo === 'Vie')
    expect(viernes?.ventas).toBe(2)
    expect(viernes?.pico).toBe(true)
    expect(pie).toBe('El pico es el viernes, con 2 ventas.')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/ventas/horarios.test.ts`
Expected: FAIL — `Failed to resolve import "./horarios"`.

- [ ] **Step 3: Escribir la implementación**

Crear `lib/ventas/horarios.ts`:

```ts
/**
 * Cuándo vende el local: las ventas del período agrupadas por hora del día o
 * por día de la semana (design/arandano.pen, nodo `t93if9`).
 *
 * **Sin Prisma a propósito**, igual que `porcentajesQueSuman100`: recibe
 * fechas y devuelve barras, así que se prueba entera sin base — incluido lo
 * único que de verdad puede salir mal acá, que es el huso.
 *
 * La agregación se hace EN JAVASCRIPT y no con un `$queryRaw` con
 * `date_trunc`: la extensión de `lib/tenant/prisma.ts` intercepta operaciones
 * de MODELO, no raw queries, así que un raw no lleva el
 * `set_config('arandano.tenant_id')` y RLS lo devuelve VACÍO — no falla,
 * devuelve cero filas, que en un panel se lee como "no vendiste nada". Es el
 * mismo hallazgo que ya dejaron anotado el agregado de medios de pago de
 * `/ventas` y `agregarVentasPorMes` de `/inventario/[id]`. Y `groupBy` de
 * Prisma no sabe agrupar por hora, así que tampoco hay atajo por ahí.
 */

const ZONA = 'America/Argentina/Buenos_Aires'

/**
 * La hora del día en Buenos Aires, 0–23.
 *
 * `hourCycle: 'h23'` explícito y no `hour12: false`, que en varias locales
 * devuelve "24" para la medianoche en vez de "00" — un bug que aparecería una
 * sola vez por noche y sólo en un local que venda a esa hora.
 *
 * Devuelve la hora con cero a la izquierda ("08"), que `Number` resuelve sin
 * ayuda — no es un octal: `Number('08')` es 8, y el parseo octal de un string
 * con cero adelante murió con `parseInt` sin radix, que acá no se usa.
 *
 * El formatter se crea UNA vez, a nivel de módulo: construir un
 * `Intl.DateTimeFormat` por fila es el costo real de esta agregación, y son
 * miles de filas en un período largo.
 */
const HORA = new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: 'numeric', hourCycle: 'h23' })

/**
 * El día en Buenos Aires como `YYYY-MM-DD`, para derivar de ahí el día de la
 * semana.
 *
 * Se pasa por la fecha y no por `weekday: 'short'` de `Intl` porque los
 * nombres cortos que devuelve una locale no son los que dibuja la maqueta
 * (varían con la versión de ICU, y en `es` vienen sin mayúscula inicial).
 * Con el `YYYY-MM-DD` en la mano, el mediodía UTC de ese día cae siempre
 * dentro del mismo día en cualquier huso, así que `getUTCDay()` es exacto.
 */
const FECHA = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA })

export const VISTAS = ['hora', 'dia'] as const
export type Vista = (typeof VISTAS)[number]

export const ROTULO_VISTA: Record<Vista, string> = { hora: 'Hora', dia: 'Día' }

/** La franja que se dibuja cuando el período no tuvo una sola venta: la de la maqueta. */
const HORA_DESDE_VACIO = 9
const HORA_HASTA_VACIO = 20

const DIAS_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export type BarraDeTiempo = {
  /** Clave estable para React y para las aserciones: la hora ('18') o el índice del día ('4'). */
  clave: string
  /** Lo que se dibuja debajo de la barra. */
  rotulo: string
  ventas: number
  /** La barra más alta, la única que pinta `--primary`. */
  pico: boolean
}

export type Horarios = {
  barras: BarraDeTiempo[]
  pie: string
}

/**
 * El `?vista` del query string. Cualquier cosa que no sea `dia` cae en
 * `hora`, sin romper nada: el mismo criterio con el que `fechaOhoy` trata una
 * fecha malformada y el clamp de `?p` una página imposible.
 */
export function vistaValida(v: string | undefined): Vista {
  return v === 'dia' ? 'dia' : 'hora'
}

function horaEnArgentina(d: Date): number {
  return Number(HORA.format(d))
}

/** 0 = lunes … 6 = domingo, en hora de Buenos Aires. */
function diaEnArgentina(d: Date): number {
  const domingoPrimero = new Date(`${FECHA.format(d)}T12:00:00Z`).getUTCDay()
  return (domingoPrimero + 6) % 7
}

/**
 * La barra más alta, con el empate resuelto por la primera: `>` estricto sobre
 * un recorrido en orden. Que el color y el pie salgan de la MISMA función es
 * lo que impide que se contradigan.
 */
function indiceDelPico(conteos: number[]): number {
  let pico = -1
  for (let i = 0; i < conteos.length; i++) {
    if (conteos[i] > 0 && (pico === -1 || conteos[i] > conteos[pico])) pico = i
  }
  return pico
}

function plural(n: number): string {
  return n === 1 ? '1 venta' : `${n} ventas`
}

export function agregarPorTiempo(fechas: Date[], vista: Vista): Horarios {
  const esHora = vista === 'hora'
  const indices = fechas.map((f) => (esHora ? horaEnArgentina(f) : diaEnArgentina(f)))

  // La franja de la vista Hora sale de los datos y no de las 9–20 que dibuja
  // la maqueta: con la franja fija, una venta a las 22 no aparecería en ningún
  // lado y el gráfico diría menos ventas de las que hubo, sin avisarlo. Sin
  // ninguna venta cae a la franja del frame, que es lo que hace que el panel
  // vacío se vea como está dibujado. La vista Día siempre son los siete.
  const desde = esHora ? (indices.length > 0 ? Math.min(...indices) : HORA_DESDE_VACIO) : 0
  const hasta = esHora ? (indices.length > 0 ? Math.max(...indices) : HORA_HASTA_VACIO) : 6

  const conteos = new Array(hasta - desde + 1).fill(0)
  for (const i of indices) conteos[i - desde] += 1

  const pico = indiceDelPico(conteos)

  const barras: BarraDeTiempo[] = conteos.map((ventas, i) => {
    const valor = desde + i
    return {
      clave: String(valor),
      rotulo: esHora ? String(valor) : DIAS_CORTOS[valor],
      ventas,
      pico: i === pico,
    }
  })

  if (pico === -1) return { barras, pie: 'Todavía no hubo ventas en este período.' }

  const cuando = esHora ? `a las ${desde + pico} h` : `el ${DIAS_LARGOS[desde + pico]}`
  return { barras, pie: `El pico es ${cuando}, con ${plural(conteos[pico])}.` }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/ventas/horarios.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/horarios.ts lib/ventas/horarios.test.ts
git commit -m "feat(ventas): agregar las ventas por hora y por día, en hora de Buenos Aires"
```

---

### Task 4: `GraficoDeHorarios` — la card, el segmentado y las barras

**Files:**
- Create: `app/(app)/ventas/horarios.tsx`
- Test: `app/(app)/ventas/horarios.test.tsx`

**Interfaces:**
- Consumes: `Horarios`, `Vista`, `ROTULO_VISTA` de la Task 3.
- Produces: `GraficoDeHorarios({ horarios, vista, href }: { horarios: Horarios; vista: Vista; href: (v: Vista) => string })`. Lo consume la Task 5.

`href` es una función y no dos strings sueltos: el llamador ya tiene que preservar `desde`/`hasta`/`p` en la URL, y pasarle la misma forma que ya usa `conPagina` en `page.tsx` evita inventar un segundo mecanismo.

- [ ] **Step 1: Escribir el test que falla**

Crear `app/(app)/ventas/horarios.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraficoDeHorarios } from './horarios'
import { agregarPorTiempo } from '@/lib/ventas/horarios'

const href = (v: string) => `/ventas?desde=2026-08-21&hasta=2026-08-21&vista=${v}`

const CON_PICO = agregarPorTiempo(
  [
    new Date('2026-08-21T21:00:00Z'),
    new Date('2026-08-21T21:30:00Z'),
    new Date('2026-08-21T15:00:00Z'),
  ],
  'hora',
)

describe('GraficoDeHorarios', () => {
  it('dibuja el título, los rótulos y el pie', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('Cuándo vende el local')
    expect(html).toContain('El pico es a las 18 h, con 2 ventas.')
  })

  it('sólo la barra del pico pinta con --primary', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    // Una sola barra en bg-primary; las demás en bg-accent. Si el color
    // saliera de otra cuenta que la del pie, este caso lo vería.
    expect(html.match(/bg-primary/g) ?? []).toHaveLength(1)
    expect((html.match(/bg-accent/g) ?? []).length).toBe(CON_PICO.barras.length - 1)
  })

  it('el segmentado marca la vista activa y linkea a la otra', () => {
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('vista=dia')
    expect(html).toContain('aria-current="page"')
  })

  it('una hora sin ventas es una barra de altura cero, no una barra ausente', () => {
    // El hueco con su rótulo es lo que dice "a esta hora no vendés". Sacar la
    // columna correría las demás y el eje dejaría de ser el reloj.
    const html = renderToStaticMarkup(
      <GraficoDeHorarios horarios={CON_PICO} vista="hora" href={href} />,
    )
    expect(html).toContain('height:0')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run app/\(app\)/ventas/horarios.test.tsx`
Expected: FAIL — `Failed to resolve import "./horarios"`.

- [ ] **Step 3: Escribir el componente**

Crear `app/(app)/ventas/horarios.tsx`:

```tsx
import Link from 'next/link'
import { ROTULO_VISTA, VISTAS, type Horarios, type Vista } from '@/lib/ventas/horarios'
import estilos from './tipografia.module.css'

// La fila mide 90 px (design/arandano.pen, nodo `EkGAz`) y la barra más alta
// llega a 70: el resto es el aire que necesitan el rótulo de 10 px y su gap
// de 8 para no empujarse fuera de la card, que tiene `overflow-hidden`. Mismo
// reparto que GraficoDeRotacion en /inventario, por el mismo motivo.
const ALTURA_FILA = 90
const ALTURA_MAXIMA_BARRA = 70

/**
 * Cuándo vende el local (design/arandano.pen, nodo `t93if9`): una barra por
 * hora del día o por día de la semana, sobre el mismo período que filtra el
 * resto de la pantalla.
 *
 * **El componente no calcula nada**: las barras, el pico y el pie vienen ya
 * resueltos por `agregarPorTiempo` (lib/ventas/horarios.ts). Es lo que impide
 * que el color de la barra más alta y el texto del pie discrepen entre sí.
 *
 * El segmentado son dos LINKS y no un control de cliente: el estado vive en
 * `?vista`, como los chips Hoy / 7 días / Este mes de esta misma pantalla y
 * como el `?tipo` de /inventario, así que el panel entero funciona sin
 * JavaScript y la vista elegida se puede compartir en una URL. El costo
 * aceptado es que cambiar de vista recarga la página.
 *
 * **La maqueta no lo dibuja en el teléfono** (`nwW2V` no tiene este panel).
 * Va igual, con el mismo tratamiento que "Cómo se movió" de `Móvil / Artículo
 * ficha`: es información, no un control cuyo destino haya que inventar —la
 * distinción que dejó escrita el ciclo móvil—. Anotado en
 * docs/correcciones-pendientes-del-pen.md.
 */
export function GraficoDeHorarios({
  horarios, vista, href,
}: { horarios: Horarios; vista: Vista; href: (v: Vista) => string }) {
  const maximo = Math.max(0, ...horarios.barras.map((b) => b.ventas))

  return (
    <section className="flex w-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>Cuándo vende el local</h2>
        {/* El segmentado (nodo `YVCzu`): el activo se despega con fondo de
            card y sombra, el inactivo es transparente. `shadow-sm` de
            Tailwind en vez del `0 1 2 #17122114` literal de la maqueta, que
            sería un hex crudo fuera de components/ui. */}
        <div className="flex gap-[2px] rounded-[10px] bg-muted p-[3px]">
          {VISTAS.map((v) => (
            <Link
              key={v}
              href={href(v)}
              aria-current={v === vista ? 'page' : undefined}
              className={
                v === vista
                  ? 'rounded-lg bg-card px-[13px] py-[7px] text-[12px] font-semibold text-foreground shadow-sm'
                  : 'rounded-lg px-[13px] py-[7px] text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {ROTULO_VISTA[v]}
            </Link>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3 p-[14px] lg:gap-[14px] lg:p-[18px]">
        {/* items-end y no h-full en cada columna: la fila mide alto fijo y
            cada columna ocupa el alto natural de su barra más su rótulo,
            alineada al piso, así todas comparten la misma línea de base. */}
        <div className="flex items-end gap-[6px]" style={{ height: ALTURA_FILA }}>
          {horarios.barras.map((b) => (
            <div key={b.clave} className="flex flex-1 flex-col items-center gap-2">
              <div
                className={`w-full rounded-t-[6px] ${b.pico ? 'bg-primary' : 'bg-accent'}`}
                style={{
                  height: maximo > 0 ? Math.round((b.ventas / maximo) * ALTURA_MAXIMA_BARRA) : 0,
                }}
              />
              <span className="text-[10px] text-muted-foreground">{b.rotulo}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] leading-[1.4] text-muted-foreground">{horarios.pie}</p>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run app/\(app\)/ventas/horarios.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/ventas/horarios.tsx app/\(app\)/ventas/horarios.test.tsx
git commit -m "feat(ventas): la card de Cuándo vende el local"
```

---

### Task 5: cablear el panel en `/ventas`

**Files:**
- Modify: `app/(app)/ventas/page.tsx`
- Test: `app/(app)/ventas/page.test.tsx`
- Modify: `docs/pantallas.md` (sección `/ventas`)

**Interfaces:**
- Consumes: `GraficoDeHorarios` (Task 4), `agregarPorTiempo` / `vistaValida` / `Vista` (Task 3).
- Produces: nada que otra task consuma.

- [ ] **Step 1: Escribir el test que falla**

En `app/(app)/ventas/page.test.tsx`, sumar un `describe` con el caso que la consulta tiene que cumplir. Es un test de fuente, como los que ya cubren "las DOS copias" en este repo: el `page.tsx` de `/ventas` es un Server Component async y no se renderiza en vitest.

```ts
describe('la consulta del panel de horarios', () => {
  const fuente = readFileSync('app/(app)/ventas/page.tsx', 'utf8')

  it('excluye las anuladas, como el panel de medios', () => {
    // Una venta anulada no fue una venta a esa hora. Si esta consulta se
    // escribiera con `donde` a secas, el panel contaría ventas que el tile de
    // arriba ya descuenta.
    //
    // Se afirma con un regex tolerante al formato —`\s+` entre las dos
    // propiedades— y no con el string literal: prettier decide dónde parte la
    // línea, y un test que se rompa al reformatear el archivo es un test que
    // se termina ignorando.
    expect(fuente).toMatch(/where:\s*\{\s*\.\.\.donde,\s*anuladaEn:\s*null\s*\},\s*select:\s*\{\s*creadoEn:\s*true\s*\}/)
  })

  it('preserva la vista en los links de rango y de página', () => {
    // Sin esto, tocar "7 días" o pasar de página devuelve a la vista Hora sin
    // que nadie lo haya pedido. Dos apariciones, una por helper: `conPagina`
    // y `hrefRango`. Se cuentan las DOS y no se afirma "al menos una" —
    // gatear una sola y dejar la otra suelta es exactamente el modo de falla
    // que este repo ya pagó con las dos copias de un botón.
    expect(fuente.match(/vista !== 'hora'/g) ?? []).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run app/\(app\)/ventas/page.test.tsx`
Expected: FAIL — los dos, porque el código todavía no existe.

- [ ] **Step 3: Sumar la consulta y el estado de la vista**

En `app/(app)/ventas/page.tsx`:

Los imports:

```ts
import { agregarPorTiempo, vistaValida, type Vista } from '@/lib/ventas/horarios'
import { GraficoDeHorarios } from './horarios'
```

La firma de `searchParams` y la lectura:

```ts
  searchParams: Promise<{ desde?: string; hasta?: string; p?: string; vista?: string }>
```

```ts
  const { desde, hasta, p = '1', vista: vistaParam } = await searchParams
```

```ts
  const vista = vistaValida(vistaParam)
```

Y una consulta más al final del `Promise.all`, después del `groupBy` de pagos (agregar el nombre `ventasDelPeriodo` a la desestructuración de la izquierda):

```ts
    // Las fechas de las ventas del período, para "Cuándo vende el local".
    // Sólo `creadoEn`: una columna de timestamps, no filas completas. La
    // agregación por hora y por día se hace en JS (lib/ventas/horarios.ts) —
    // ni Prisma sabe agrupar por hora, ni un `$queryRaw` con `date_trunc`
    // llevaría el `set_config('arandano.tenant_id')` que RLS necesita, y sin
    // él devolvería cero filas EN SILENCIO.
    //
    // Sin techo de filas, con el motivo escrito: son ~1.400 en un mes de un
    // local activo, y el `count` de arriba ya recorre el mismo conjunto. Con
    // un rango largo tipeado a mano (`?desde=2020-01-01`) serían decenas de
    // miles — es lo primero a mirar si esta pantalla se pone lenta.
    prisma.venta.findMany({
      where: { ...donde, anuladaEn: null },
      select: { creadoEn: true },
    }),
```

Y el cálculo, junto a `const composicion = …`:

```ts
  const horarios = agregarPorTiempo(ventasDelPeriodo.map((v) => v.creadoEn), vista)
```

- [ ] **Step 4: Preservar la vista en las URLs y renderizar el panel**

Los dos helpers de URL ya existen en `page.tsx` y se llaman `conPagina` y `hrefRango` (están juntos, unas líneas antes del `return`). Suman la vista sólo cuando no es la default — así una URL en vista Hora queda idéntica a la de hoy, byte a byte:

```ts
  const conPagina = (n: number) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (n > 1) u.set('p', String(n))
    if (vista !== 'hora') u.set('vista', vista)
    return `/ventas?${u.toString()}`
  }
```

```ts
  const hrefRango = (r: Rango) => {
    const { desde: d, hasta: h } = rangoDeChip(r, hoy)
    const u = new URLSearchParams({ desde: d, hasta: h })
    if (vista !== 'hora') u.set('vista', vista)
    return `/ventas?${u.toString()}`
  }
```

`hrefRango` pasa de una sola expresión a un cuerpo con `const u`, que es lo que le da dónde colgar el `set`.

Y uno nuevo, al lado de los otros dos:

```ts
  const hrefDeVista = (v: Vista) => {
    const u = new URLSearchParams({ desde: dDesde, hasta: dHasta })
    if (v !== 'hora') u.set('vista', v)
    return `/ventas?${u.toString()}`
  }
```

**El `?p` NO se preserva al cambiar de vista, a propósito**: la vista no cambia el listado, pero cambiar de vista es un gesto de mirar el panel, y volver a la página 1 es lo que hace que el listado y el panel hablen de lo mismo al leerlos juntos.

El render va **fuera** del `div` de la fila de dos columnas y dentro del contenedor del cuerpo, justo después de `{composicion.barras.length > 0 && <GraficoDeMedios composicion={composicion} />}` y su `</div>` de cierre:

```tsx
        {/* Cuándo vende el local (design/arandano.pen, nodo `t93if9`): a todo
            el ancho, debajo de la fila. Colgado de `total > 0` como los
            tiles y no de que haya ventas no anuladas: un período con todas
            las ventas anuladas SÍ dibuja el panel, y su pie dice que no hubo
            ninguna — que es información, no un panel roto. */}
        {total > 0 && <GraficoDeHorarios horarios={horarios} vista={vista} href={hrefDeVista} />}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run app/\(app\)/ventas/page.test.tsx`
Expected: PASS

- [ ] **Step 6: Verificar el typecheck y el lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. Si `tsc` se queja de que `ventasDelPeriodo` no existe, es que faltó agregarlo a la desestructuración del `Promise.all`.

- [ ] **Step 7: Actualizar `docs/pantallas.md`**

En la sección `/ventas`, sumar a "Qué se puede hacer":

```markdown
- Ver **"Cuándo vende el local"**: una barra por hora del día o por día de la
  semana, sobre el mismo período que filtra la pantalla, con el pico
  destacado y nombrado en el pie. El segmentado Hora/Día viaja en `?vista`,
  así que el panel funciona sin JavaScript y la vista se comparte en la URL.
  **La franja horaria sale de los datos** —de la primera a la última hora con
  ventas, y 9–20 cuando no hubo ninguna—, no de las doce barras fijas que
  dibuja la maqueta: con la franja fija, una venta a las 22 no aparecería en
  ningún lado. Las anuladas no cuentan.
```

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/ventas/page.tsx app/\(app\)/ventas/page.test.tsx docs/pantallas.md
git commit -m "feat(ventas): Cuándo vende el local, con la vista en la URL"
```

---

### Task 6: el radio de 9 px del campo de precio

**Files:**
- Modify: `components/selector-de-moneda.tsx`
- Modify: `app/(app)/inventario/formularios.tsx` (los dos `Input` de precio)
- Test: `app/(app)/inventario/formularios.test.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Escribir el test que falla**

En `app/(app)/inventario/formularios.test.tsx`, dentro del `describe('SelectorDeMoneda')` que ya existe:

```ts
  it('el campo compuesto mide 9 px en las esquinas externas', () => {
    // design/arandano.pen, nodos `UI6JI` (alta) y `eKwLI` (ficha): [9,0,0,9]
    // en el selector y [0,9,9,0] en el input. El default de shadcn
    // (`rounded-lg`, 10 px con --radius: 0.625rem) dejaba a este campo como el
    // único del formulario con un radio distinto del de sus vecinos, que ya
    // escriben rounded-[9px] explícito.
    const html = renderToStaticMarkup(<SelectorDeMoneda id="m" name="moneda" valorInicial="ARS" />)
    expect(html).toContain('rounded-l-[9px]')

    const fuente = readFileSync('app/(app)/inventario/formularios.tsx', 'utf8')
    const derechos = fuente.match(/rounded-l-none rounded-r-\[9px\]/g) ?? []
    // Las DOS copias, el alta y la ficha: la lección del ciclo del 2026-08-28
    // es que este campo ya divergió una vez entre las dos pantallas.
    expect(derechos).toHaveLength(2)
  })
```

Si `readFileSync` no está importado en ese archivo, agregar `import { readFileSync } from 'node:fs'` arriba.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run app/\(app\)/inventario/formularios.test.tsx`
Expected: FAIL — `rounded-l-[9px]` no aparece.

- [ ] **Step 3: Cambiar el radio en el selector**

En `components/selector-de-moneda.tsx`, en el `className` del `SelectTrigger`, cambiar `rounded-r-none` por el par explícito:

```tsx
            className="h-10 w-[86px] rounded-l-[9px] rounded-r-none border-r-0 text-[13px] font-medium"
```

Y sumar al comentario que ya está ahí:

```tsx
            // El radio va explícito y no por el `rounded-lg` de shadcn (10 px
            // con --radius: 0.625rem): la maqueta mide 9 en las esquinas
            // externas del campo compuesto, igual que los inputs vecinos de
            // estas dos pantallas, que ya lo escriben a mano.
```

- [ ] **Step 4: Cambiar el radio en los dos inputs de precio**

En `app/(app)/inventario/formularios.tsx`, las dos instancias del `Input` de precio (la del alta, `id="precio"`, y la de la ficha, `id="e-precio"`):

```tsx
                    className="h-10 flex-1 rounded-l-none rounded-r-[9px]"
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run app/\(app\)/inventario/formularios.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add components/selector-de-moneda.tsx app/\(app\)/inventario/formularios.tsx app/\(app\)/inventario/formularios.test.tsx
git commit -m "fix(inventario): el campo de precio mide 9 px, como lo dibuja la maqueta"
```

---

### Task 7: el cierre documental

**Files:**
- Modify: `CLAUDE.md` (la lista de "Próximos pasos técnicos")
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 23 y una nueva)

**Interfaces:**
- Consumes: todas las tasks anteriores, terminadas.
- Produces: nada.

- [ ] **Step 1: Correr el gate completo antes de documentar nada**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde. Documentar sobre un gate en rojo es documentar algo que todavía no es cierto.

- [ ] **Step 2: Cerrar el punto 1 y el 5 de la entrada 23**

En `docs/correcciones-pendientes-del-pen.md`, entrada 23 ("La maqueta no dibuja nada del precio en dólares"): marcar como **RESUELTA A MEDIAS** en el título, y anotar bajo los puntos 1 y 5 que la maqueta se actualizó el 2026-08-30 y ahora los dibuja — el punto 1 con el campo compuesto de 9 px que la Task 6 hizo coincidir, y el punto 5 con la segunda línea del tile, que el código ya tenía. Los puntos 2, 3 y 4 (la banda del total de `/vender`, el selector `Cubre` y el segundo chip de faltante) **siguen abiertos**: la maqueta de `App / Vender` no se tocó.

- [ ] **Step 3: Abrir la entrada nueva del panel de horarios en el teléfono**

Al final del mismo archivo, con el formato que documenta su sección "Cómo agregar una entrada":

```markdown
## 24. El panel "Cuándo vende el local" del teléfono, derivado sin frame

`design/arandano.pen` dibuja este panel sólo en `App / Ventas` (nodo
`t93if9`). `Móvil / Ventas` (`nwW2V`) no lo tiene, y el ciclo lo construyó
igual para el teléfono: es información, no un control cuyo destino haya que
inventar —la distinción que dejó escrita el ciclo móvil—, y el dueño de un
local mira el celular más que la computadora.

Lo que se derivó sin referencia: el tratamiento a 390 px (se copió el de
"Cómo se movió" de `Móvil / Artículo ficha`, que es el único gráfico de
barras que la maqueta dibuja en ese ancho) y el segmentado Hora/Día, que en
el teléfono comparte la fila del título de la card.

Y una diferencia deliberada con el frame de escritorio, que no es una
derivación sino una decisión: **la franja horaria sale de los datos**, así que
el panel puede tener más o menos de las doce barras dibujadas.
```

- [ ] **Step 4: Anotar el ciclo en `CLAUDE.md`**

En la lista de "Próximos pasos técnicos", después de la entrada del precio en dólares, sumar una entrada tachada con el resumen del ciclo. Tiene que decir, además de qué se construyó:

- que el origen fue **la maqueta y no un cliente**, ejerciendo la regla de que el `.pen` manda;
- que **el MCP de Pencil ignora su parámetro `filePath`** y lee el documento abierto, y que por eso `design/arandano.pen` estuvo nueve días atrás de la maqueta viva sin que nada avisara — con el detalle de que `test/maqueta.test.ts` seguía en verde por una razón distinta de la que se creía;
- que la franja horaria derivada de los datos es la única vez que el ciclo se aparta del frame, con el motivo (un dato que desaparece sin avisar);
- que la consulta del panel quedó **sin techo de filas**, con el número concreto (~1.400 en un mes) y qué la volvería un problema;
- que el ciclo **no cierra** la costura entre el tile "Total del período" y "Cómo entró la plata", que sigue siendo su propia decisión de producto.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/correcciones-pendientes-del-pen.md
git commit -m "docs(ventas): el cierre del ciclo de las dos monedas y los horarios"
```

---

## Verificación manual, al final de todo

Ningún test contesta esto, y el ciclo no está cerrado sin ello:

1. Sembrar datos con `npm run ventas:sembrar` y abrir `/ventas` por el subdominio del tenant (nunca por la IP pelada: desde el cutover de tenants por `Host`, eso devuelve 404 y es correcto que lo haga). En la Mac, el entorno local corre en el puerto 3001.
2. **"Cómo entró la plata"**: que un medio con dólares muestre las dos líneas, que la de dólares se lea más chica y más apagada sin quedar ilegible, y que un período sin dólares se vea **exactamente** como antes.
3. **"Cuándo vende el local"**: que el pico se distinga a ojo del resto, que el segmentado se lea como segmentado (el activo despegado del fondo), que tocar "Día" no pierda el rango de fechas, y que tocar "7 días" no vuelva a la vista Hora.
4. Con el período en un día sin ventas: que el pie diga que no hubo ninguna y no un pico de cero.
5. A 390 px: que el panel entre sin scroll horizontal y que las barras no queden tan finitas como para no verse. Con doce barras y `gap-[6px]` quedan en ~24 px cada una.
6. **El campo de precio**: que las esquinas externas se vean del mismo radio que los inputs de arriba y de abajo.
