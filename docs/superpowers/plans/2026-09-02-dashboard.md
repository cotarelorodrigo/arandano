# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir `/dashboard`, la pantalla que contesta "cómo viene el
local": cuatro tiles con su variación contra el período anterior, la tendencia
de catorce días, y tres composiciones (medio de pago, categoría, artículo).

**Architecture:** Server Component con todo el estado en la URL
(`?rango`, `?moneda`), sin JavaScript propio salvo el botón de descarga del
CSV. Toda regla de negocio vive en `lib/dashboard/*` exportada y probada — nada
inline en el componente de página, porque lo inline no lo puede llamar ningún
test (hallazgo I3 de la review del rediseño). Una migración aditiva congela el
costo de lo vendido en el momento de cobrar.

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Postgres con RLS,
Tailwind v4 + shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-09-02-dashboard-design.md`

## Global Constraints

- **Nada se convierte entre monedas, en ninguna parte.** No existe tipo de
  cambio por venta: `Pago.cotizacion` vale `1` cuando el pago no cruza monedas
  (`app/(app)/vender/punto-de-venta.tsx:351`). Ninguna suma, barra, anillo o
  porcentaje puede mezclar pesos con dólares.
- **Prohibido `$queryRaw`.** La extensión de `lib/tenant/prisma.ts` intercepta
  operaciones de MODELO; un raw sin el `set_config('arandano.tenant_id')`
  devuelve cero filas EN SILENCIO. Toda agregación que Prisma no sepa hacer se
  hace en JavaScript sobre un `groupBy` acotado.
- **Toda regla de negocio va exportada**, nunca inline en un Server Component
  `async`: los tests no pueden llamar a lo que vive adentro de un componente
  que abre sesión.
- **Mobile-first, corte único en `lg` (1024 px).** El valor sin prefijo es el
  del teléfono, `lg:` el de escritorio. Prohibido `sm:`/`md:` en código propio.
- **Toda guarda de permiso alcanza las DOS copias** de un control duplicado
  (Topbar de escritorio + ranura móvil), y el caso cuenta las apariciones en
  las dos direcciones.
- **`npm test` corre todo el gate.** Un caso nuevo que no falle antes de la
  implementación no prueba nada: siempre correr el test y verlo fallar.
- Colores literales de la maqueta usados en este ciclo: `#2A1760`
  (`--marca`), `#4A2AA5` (`--primary`), `#7C5FD6`, `#B6A6E8` (`--marca-soft`),
  `#DCD3F2`, `#C9F2DF`, `#9C8BD6` (`--marca-dim`).

---

## File Structure

**Nuevos**

| Archivo | Responsabilidad |
|---|---|
| `lib/formato/fechas.ts` | Las primitivas de huso (hoy, inicio del día, sumar días), hoy privadas de `/ventas` |
| `lib/dashboard/rango.ts` | Los cuatro chips, el período y su homólogo anterior |
| `lib/dashboard/metricas.ts` | Los cuatro tiles: cobrado, conteo, ticket, margen, y el delta |
| `lib/dashboard/tendencia.ts` | Las catorce barras de "Ventas por día" |
| `lib/dashboard/composicion.ts` | Categorías y top de artículos, desde un solo `groupBy` |
| `lib/ventas/porcentajes.ts` | `porcentajesQueSuman100`, hoy en `grafico.tsx` |
| `components/anillo.tsx` | El anillo SVG de gajos, sin librería |
| `app/(app)/dashboard/page.tsx` | La pantalla |
| `app/(app)/dashboard/paneles.tsx` | Los cuatro paneles |
| `app/(app)/dashboard/acciones.ts` | El server action del CSV |
| `app/(app)/dashboard/exportar.tsx` | El botón cliente que baja el CSV |

**Modificados**

| Archivo | Cambio |
|---|---|
| `prisma/schema.prisma` | Tres columnas aditivas |
| `lib/ventas/crear.ts` | Congela el costo al cobrar |
| `lib/ventas/composicion.ts` | Deja de convertir; compone por moneda |
| `lib/ventas/medios.ts` | El tipo `Barra` pierde `usd`/`usdCrudo`/`total` |
| `app/(app)/ventas/grafico.tsx` | Recibe una composición de una moneda; gana el selector |
| `app/(app)/ventas/page.tsx` | Usa `lib/formato/fechas.ts`; pasa `?moneda` al panel |
| `components/navegacion.tsx` | La pestaña Dashboard, tercera |
| `app/globals.css` | Cuatro tokens de marca |
| `docs/sistema-de-diseno.md`, `docs/pantallas.md`, `docs/correcciones-pendientes-del-pen.md`, `docs/schema.md` | La documentación que el gate exige |

---

### Task 1: Las primitivas de fecha, fuera de `/ventas`

Hoy son funciones privadas de `app/(app)/ventas/page.tsx`. Este ciclo es su
segundo consumidor, así que se mudan antes de que existan dos copias.

**Files:**
- Create: `lib/formato/fechas.ts`
- Create: `lib/formato/fechas.test.ts`
- Modify: `app/(app)/ventas/page.tsx` (borrar las privadas, importar)

**Interfaces:**
- Produces: `hoyEnArgentina(): string`, `inicioDelDia(iso: string): Date`,
  `sumarDias(iso: string, dias: number): string`,
  `primerDiaDelMes(iso: string): string`, `primerDiaDelAnio(iso: string): string`,
  `fechaLarga(iso: string): string`, `ES_FECHA: RegExp`,
  `fechaOhoy(valor: string | undefined, hoy: string): string`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/formato/fechas.test.ts
import { describe, it, expect } from 'vitest'
import {
  inicioDelDia, sumarDias, primerDiaDelMes, primerDiaDelAnio, fechaLarga, fechaOhoy,
} from './fechas'

describe('las primitivas de fecha anclan a Buenos Aires', () => {
  it('inicioDelDia ancla a UTC-3, no a UTC', () => {
    expect(inicioDelDia('2026-08-21').toISOString()).toBe('2026-08-21T03:00:00.000Z')
  })

  it('sumarDias cruza el fin de mes', () => {
    expect(sumarDias('2026-08-31', 1)).toBe('2026-09-01')
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('primerDiaDelMes y primerDiaDelAnio recortan', () => {
    expect(primerDiaDelMes('2026-08-21')).toBe('2026-08-01')
    expect(primerDiaDelAnio('2026-08-21')).toBe('2026-01-01')
  })

  it('fechaLarga no se corre un día por el huso', () => {
    expect(fechaLarga('2026-08-01')).toBe('1 de agosto de 2026')
  })

  it('fechaOhoy cae al default con una fecha imposible', () => {
    // 2026-13-45 pasa cualquier regex de \d{4}-\d{2}-\d{2} y después da un
    // Invalid Date que Prisma rechaza sin que nadie lo atrape.
    expect(fechaOhoy('2026-13-45', '2026-08-21')).toBe('2026-08-21')
    expect(fechaOhoy(undefined, '2026-08-21')).toBe('2026-08-21')
    expect(fechaOhoy('2026-08-01', '2026-08-21')).toBe('2026-08-01')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run lib/formato/fechas.test.ts`
Expected: FAIL — `Failed to resolve import "./fechas"`

- [ ] **Step 3: Crear el módulo moviendo el código, no reescribiéndolo**

Copiar textualmente de `app/(app)/ventas/page.tsx` las funciones
`hoyEnArgentina`, `inicioDelDia`, `fechaOhoy`, `fechaLarga`, `sumarDias`,
`primerDiaDelMes` y la constante `ES_FECHA`, **con sus docblocks completos** —
explican el huso, que es la única razón por la que existen. Exportarlas todas.
Agregar la única nueva:

```ts
/** El primer día del año de `iso`, mismo criterio que primerDiaDelMes. */
export function primerDiaDelAnio(iso: string): string {
  return `${iso.slice(0, 4)}-01-01`
}
```

Encabezar el archivo:

```ts
/**
 * Las primitivas de fecha del producto, ancladas a Buenos Aires.
 *
 * Vivían como funciones privadas de app/(app)/ventas/page.tsx. Salieron acá
 * cuando el dashboard se volvió su segundo consumidor: el huso es la clase de
 * detalle que, copiado, se arregla en un archivo y se queda roto en el otro —
 * el servidor está en Ashburn, así que un `new Date()` a las 22:00 de Buenos
 * Aires ya es el día siguiente en UTC.
 */
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx vitest run lib/formato/fechas.test.ts`
Expected: PASS, 5 casos.

- [ ] **Step 5: Dejar `/ventas` importándolas**

En `app/(app)/ventas/page.tsx`: borrar las seis funciones y `ES_FECHA`, y
sumar al bloque de imports:

```ts
import {
  hoyEnArgentina, inicioDelDia, fechaOhoy, fechaLarga, sumarDias, primerDiaDelMes,
} from '@/lib/formato/fechas'
```

- [ ] **Step 6: Verificar que `/ventas` no se movió**

Run: `npx vitest run "app/(app)/ventas" && npx tsc --noEmit`
Expected: PASS. Ningún caso de `/ventas` puede cambiar: es una mudanza.

- [ ] **Step 7: Commit**

```bash
git add lib/formato/fechas.ts lib/formato/fechas.test.ts "app/(app)/ventas/page.tsx"
git commit -m "refactor(fechas): las primitivas de huso salen de /ventas a lib/formato

El dashboard es su segundo consumidor. El huso es la clase de detalle que,
copiado, se arregla en un archivo y se queda roto en el otro."
```

---

### Task 2: El rango y su período homólogo anterior

**Files:**
- Create: `lib/dashboard/rango.ts`
- Create: `lib/dashboard/rango.test.ts`

**Interfaces:**
- Consumes: `sumarDias`, `primerDiaDelMes`, `primerDiaDelAnio`, `inicioDelDia`,
  `fechaLarga` de `@/lib/formato/fechas` (Task 1)
- Produces:
  - `RANGOS: readonly ['hoy','7dias','estemes','esteanio']`, `type Rango`
  - `ROTULO_RANGO: Record<Rango, string>`
  - `rangoValido(v: string | undefined): Rango` — default `'estemes'`
  - `type Periodo = { desde: string; hasta: string }` (ISO `YYYY-MM-DD`, ambos inclusive)
  - `periodoDeRango(rango: Rango, hoy: string): Periodo`
  - `periodoAnterior(rango: Rango, hoy: string): Periodo`
  - `rotuloDeComparacion(rango: Rango, hoy: string): string`
  - `textoDelPeriodo(p: Periodo): string`
  - `filtroDe(p: Periodo): { creadoEn: { gte: Date; lt: Date } }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/dashboard/rango.test.ts
import { describe, it, expect } from 'vitest'
import {
  rangoValido, periodoDeRango, periodoAnterior, rotuloDeComparacion,
  textoDelPeriodo, filtroDe,
} from './rango'

// Un viernes 21 de agosto de 2026, a mitad de mes: el caso que distingue el
// tramo homólogo de la ventana previa.
const HOY = '2026-08-21'

describe('el período de cada chip', () => {
  it('hoy es un solo día', () => {
    expect(periodoDeRango('hoy', HOY)).toEqual({ desde: HOY, hasta: HOY })
  })

  it('7 días incluye hoy, así que resta 6', () => {
    expect(periodoDeRango('7dias', HOY)).toEqual({ desde: '2026-08-15', hasta: HOY })
  })

  it('este mes va del 1 a hoy, no al fin de mes', () => {
    expect(periodoDeRango('estemes', HOY)).toEqual({ desde: '2026-08-01', hasta: HOY })
  })

  it('este año va del 1 de enero a hoy', () => {
    expect(periodoDeRango('esteanio', HOY)).toEqual({ desde: '2026-01-01', hasta: HOY })
  })
})

describe('el período anterior es el tramo homólogo, no la ventana previa', () => {
  it('hoy compara contra ayer', () => {
    expect(periodoAnterior('hoy', HOY)).toEqual({ desde: '2026-08-20', hasta: '2026-08-20' })
  })

  it('7 días compara contra los 7 anteriores, sin solaparse', () => {
    expect(periodoAnterior('7dias', HOY)).toEqual({ desde: '2026-08-08', hasta: '2026-08-14' })
  })

  // El caso que define la decisión: la ventana previa del mismo largo daría
  // del 20 al 31 de julio, y el rótulo "Comparado con julio" sería mentira.
  it('este mes compara contra el MISMO TRAMO del mes pasado', () => {
    expect(periodoAnterior('estemes', HOY)).toEqual({ desde: '2026-07-01', hasta: '2026-07-21' })
  })

  it('este año compara contra el mismo tramo del año pasado', () => {
    expect(periodoAnterior('esteanio', HOY)).toEqual({ desde: '2025-01-01', hasta: '2025-08-21' })
  })

  // Un 31 de marzo no tiene homólogo en febrero. Se recorta al último día que
  // existe en vez de desbordar al 3 de marzo, que es lo que hace Date solo.
  it('recorta cuando el día no existe en el mes anterior', () => {
    expect(periodoAnterior('estemes', '2026-03-31')).toEqual({
      desde: '2026-02-01', hasta: '2026-02-28',
    })
  })

  // El 29 de febrero de un bisiesto no existe el año anterior.
  it('recorta también en el salto de año', () => {
    expect(periodoAnterior('esteanio', '2024-02-29')).toEqual({
      desde: '2023-01-01', hasta: '2023-02-28',
    })
  })

  it('el día 1 del mes compara contra un solo día', () => {
    expect(periodoAnterior('estemes', '2026-08-01')).toEqual({
      desde: '2026-07-01', hasta: '2026-07-01',
    })
  })
})

describe('los rótulos', () => {
  it('el chip de comparación nombra el período, no las fechas', () => {
    expect(rotuloDeComparacion('hoy', HOY)).toBe('Comparado con ayer')
    expect(rotuloDeComparacion('7dias', HOY)).toBe('Comparado con los 7 días previos')
    expect(rotuloDeComparacion('estemes', HOY)).toBe('Comparado con julio')
    expect(rotuloDeComparacion('esteanio', HOY)).toBe('Comparado con 2025')
  })

  it('el texto del período une las dos puntas sin repetir el mes', () => {
    expect(textoDelPeriodo({ desde: '2026-08-01', hasta: '2026-08-21' }))
      .toBe('1 al 21 de agosto de 2026')
    expect(textoDelPeriodo({ desde: '2026-08-21', hasta: '2026-08-21' }))
      .toBe('21 de agosto de 2026')
    expect(textoDelPeriodo({ desde: '2026-07-28', hasta: '2026-08-03' }))
      .toBe('28 de julio al 3 de agosto de 2026')
  })
})

describe('el filtro que va a Prisma', () => {
  // `lt` sobre el día SIGUIENTE, nunca `lte` sobre `hasta`: `hasta` es
  // medianoche, así que un `lte` dejaría afuera todas las ventas del último día.
  it('cierra por abajo y abre por arriba, con el día siguiente', () => {
    const f = filtroDe({ desde: '2026-08-01', hasta: '2026-08-21' })
    expect(f.creadoEn.gte.toISOString()).toBe('2026-08-01T03:00:00.000Z')
    expect(f.creadoEn.lt.toISOString()).toBe('2026-08-22T03:00:00.000Z')
  })
})

describe('el chip inválido cae al default', () => {
  it('lo que no está en la lista es este mes', () => {
    expect(rangoValido(undefined)).toBe('estemes')
    expect(rangoValido('la semana que viene')).toBe('estemes')
    expect(rangoValido('7dias')).toBe('7dias')
  })
})
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx vitest run lib/dashboard/rango.test.ts`
Expected: FAIL — `Failed to resolve import "./rango"`

- [ ] **Step 3: Implementar**

```ts
// lib/dashboard/rango.ts
import {
  sumarDias, primerDiaDelMes, primerDiaDelAnio, inicioDelDia, fechaLarga,
} from '@/lib/formato/fechas'

/** Los cuatro chips del segmentado (design/arandano.pen, nodo `toCZo`). */
export const RANGOS = ['hoy', '7dias', 'estemes', 'esteanio'] as const
export type Rango = (typeof RANGOS)[number]

export const ROTULO_RANGO: Record<Rango, string> = {
  hoy: 'Hoy',
  '7dias': '7 días',
  estemes: 'Este mes',
  esteanio: 'Este año',
}

/**
 * El chip del query string, o el default.
 *
 * El default es `estemes` y no `hoy` —que es el de /ventas— por dos motivos:
 * es el que la maqueta dibuja activo, y es el único con el que los cuatro
 * paneles tienen algo que mostrar la primera vez que alguien entra.
 */
export function rangoValido(v: string | undefined): Rango {
  return RANGOS.includes(v as Rango) ? (v as Rango) : 'estemes'
}

/** Las dos puntas de un período, ambas inclusive, en `YYYY-MM-DD`. */
export type Periodo = { desde: string; hasta: string }

export function periodoDeRango(rango: Rango, hoy: string): Periodo {
  switch (rango) {
    case 'hoy':
      return { desde: hoy, hasta: hoy }
    // Resta 6 y no 7: del 15 al 21 son 7 días con el 21 incluido, y restar 7
    // dejaría afuera el propio día de hoy. Misma cuenta que `rangoDeChip` en
    // app/(app)/ventas/page.tsx.
    case '7dias':
      return { desde: sumarDias(hoy, -6), hasta: hoy }
    case 'estemes':
      return { desde: primerDiaDelMes(hoy), hasta: hoy }
    case 'esteanio':
      return { desde: primerDiaDelAnio(hoy), hasta: hoy }
  }
}

/**
 * El mismo tramo del período calendario anterior — no la ventana previa del
 * mismo largo.
 *
 * La diferencia sólo aparece en `estemes` y `esteanio`, y es la que hace
 * cierto el rótulo que dibuja la maqueta. Un día 21 de agosto, la ventana
 * previa daría "del 20 al 31 de julio" y el chip seguiría diciendo "Comparado
 * con julio", que sería falso: es un tercio de julio. El tramo homólogo da
 * "del 1 al 21 de julio", que es lo que cualquiera entiende por comparar
 * contra el mes pasado a mitad de mes.
 */
export function periodoAnterior(rango: Rango, hoy: string): Periodo {
  switch (rango) {
    case 'hoy': {
      const ayer = sumarDias(hoy, -1)
      return { desde: ayer, hasta: ayer }
    }
    // Los 7 anteriores, sin solaparse con los 7 actuales: hasta el día previo
    // al `desde` del período vigente.
    case '7dias':
      return { desde: sumarDias(hoy, -13), hasta: sumarDias(hoy, -7) }
    case 'estemes': {
      const hasta = mismoDiaEn(mesAnterior(hoy), hoy)
      return { desde: primerDiaDelMes(hasta), hasta }
    }
    case 'esteanio': {
      const hasta = mismoDiaEn(`${Number(hoy.slice(0, 4)) - 1}-${hoy.slice(5, 7)}`, hoy)
      return { desde: primerDiaDelAnio(hasta), hasta }
    }
  }
}

/** `YYYY-MM` del mes anterior al de `iso`. */
function mesAnterior(iso: string): string {
  const anio = Number(iso.slice(0, 4))
  const mes = Number(iso.slice(5, 7))
  return mes === 1
    ? `${anio - 1}-12`
    : `${anio}-${String(mes - 1).padStart(2, '0')}`
}

/**
 * El mismo día del mes que `iso`, dentro del mes `anioMes` (`YYYY-MM`),
 * RECORTADO al último día que ese mes tiene.
 *
 * Sin el recorte, un 31 de marzo comparado contra febrero desbordaría al 3 de
 * marzo —que es lo que hace `Date` con `setUTCMonth`— y el período anterior
 * incluiría tres días del mes vigente, contándolos dos veces.
 */
function mismoDiaEn(anioMes: string, iso: string): string {
  const [anio, mes] = anioMes.split('-').map(Number)
  // Día 0 del mes SIGUIENTE es el último del mes pedido.
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  const dia = Math.min(Number(iso.slice(8, 10)), ultimo)
  return `${anioMes}-${String(dia).padStart(2, '0')}`
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** El texto del chip `git-compare-arrows` (nodo `unJCa`). */
export function rotuloDeComparacion(rango: Rango, hoy: string): string {
  const previo = periodoAnterior(rango, hoy)
  switch (rango) {
    case 'hoy':
      return 'Comparado con ayer'
    case '7dias':
      return 'Comparado con los 7 días previos'
    case 'estemes':
      return `Comparado con ${MESES[Number(previo.desde.slice(5, 7)) - 1]}`
    case 'esteanio':
      return `Comparado con ${previo.desde.slice(0, 4)}`
  }
}

/**
 * "1 al 21 de agosto de 2026" (nodo `w4NsZ`).
 *
 * Se apoya en `fechaLarga` para la punta derecha y sólo abrevia la izquierda
 * cuando las dos caen en el mismo mes: repetir "de agosto de 2026" dos veces
 * en una línea de 12 px es ruido, y omitirlo cuando el período cruza de mes
 * sería ambiguo.
 */
export function textoDelPeriodo(p: Periodo): string {
  const derecha = fechaLarga(p.hasta)
  if (p.desde === p.hasta) return derecha
  const mismoMes = p.desde.slice(0, 7) === p.hasta.slice(0, 7)
  const izquierda = mismoMes
    ? String(Number(p.desde.slice(8, 10)))
    : `${Number(p.desde.slice(8, 10))} de ${MESES[Number(p.desde.slice(5, 7)) - 1]}`
  return `${izquierda} al ${derecha}`
}

/**
 * El `where` que va a Prisma.
 *
 * `lt` sobre el día SIGUIENTE y nunca `lte` sobre `hasta`: `inicioDelDia` da
 * medianoche, así que un `lte` dejaría afuera todas las ventas del último día
 * del período — las 23 horas y 59 minutos que importan.
 */
export function filtroDe(p: Periodo): { creadoEn: { gte: Date; lt: Date } } {
  return {
    creadoEn: { gte: inicioDelDia(p.desde), lt: inicioDelDia(sumarDias(p.hasta, 1)) },
  }
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx vitest run lib/dashboard/rango.test.ts`
Expected: PASS, 17 casos.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/rango.ts lib/dashboard/rango.test.ts
git commit -m "feat(dashboard): los cuatro chips de rango y su período homólogo

El período anterior es el mismo TRAMO del período calendario anterior, no la
ventana previa del mismo largo: es lo único que hace cierto el rótulo
\"Comparado con julio\" a mitad de mes."
```

---

### Task 3: "Cómo entró la plata" deja de convertir

**Es un arreglo de un defecto que ya está en producción**, no una feature.
`componerPorMedio` valúa un pago en dólares con `Pago.cotizacion`, que vale
`1` cuando el pago no cruzó monedas: US$ 300 en efectivo aportan **300** al
largo de la barra en vez de los ~445.500 que representan. Los importes que se
muestran están bien; lo que miente es la barra y el "N % del total".

**Files:**
- Modify: `lib/ventas/medios.ts` (el tipo `Barra`, el tipo `Composicion`)
- Modify: `lib/ventas/composicion.ts` (`componerPorMedio`)
- Modify: `lib/ventas/composicion.test.ts`
- Modify: `app/(app)/ventas/grafico.tsx` (una moneda por vez + selector)
- Modify: `app/(app)/ventas/page.tsx` (leer `?moneda`, pasarla)
- Modify: `app/(app)/ventas/page.test.tsx`

**Interfaces:**
- Produces:
  - `type Barra = { medio: Medio; monto: string }`
  - `type Composicion = { barras: Barra[]; total: string }`
  - `type ComposicionPorMoneda = { ars: Composicion; usd: Composicion; hayDolares: boolean }`
  - `componerPorMedio(filas: FilaDePagos[]): ComposicionPorMoneda`
  - `type MonedaElegida = 'ars' | 'usd'`, `monedaValida(v: string | undefined): MonedaElegida`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/ventas/composicion.test.ts`:

```ts
describe('ningún pago se valúa por su cotización', () => {
  const fila = (over: Partial<FilaDePagos>): FilaDePagos => ({
    medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
    cotizacion: d('1'), monto: d('1000'), _count: 1, ...over,
  })

  // EL caso del arreglo. Un iPhone de US$ 300 pagado con 300 dólares en
  // efectivo lleva cotización 1 (cotizacionParaElCruce: el pago no cruza, así
  // que no hay conversión que registrar). Multiplicar por esa cotización daba
  // 300 pesos, y la barra de Efectivo quedaba prácticamente vacía.
  it('un pago USD que cubre USD no aporta NADA a la pila de pesos', () => {
    const c = componerPorMedio([
      fila({ moneda: 'USD', cubre: 'USD', monto: d('300'), cotizacion: d('1') }),
    ])
    expect(c.ars.total).toBe('0')
    expect(c.usd.total).toBe('300')
    expect(c.usd.barras).toEqual([{ medio: 'EFECTIVO', monto: '300' }])
    expect(c.hayDolares).toBe(true)
  })

  // La otra dirección: un pago EN PESOS que cubre el total en dólares lleva la
  // cotización de verdad (1485) con el monto YA en pesos. Va entero a la pila
  // de pesos, sin tocar la cotización.
  it('un pago ARS que cubre USD va entero a pesos, sin multiplicar', () => {
    const c = componerPorMedio([
      fila({ moneda: 'ARS', cubre: 'USD', monto: d('445500'), cotizacion: d('1485') }),
    ])
    expect(c.ars.total).toBe('445500')
    expect(c.usd.total).toBe('0')
    expect(c.hayDolares).toBe(false)
  })

  it('un pago USD que cubre ARS suma DÓLARES, no su equivalente en pesos', () => {
    const c = componerPorMedio([
      fila({ moneda: 'USD', cubre: 'ARS', monto: d('100'), cotizacion: d('1485') }),
    ])
    expect(c.usd.total).toBe('100')
    expect(c.ars.total).toBe('0')
  })

  it('la pila la elige Pago.moneda y el importe es Pago.monto tal cual', () => {
    const c = componerPorMedio([
      fila({ medio: 'EFECTIVO', moneda: 'ARS', monto: d('1000'), _count: 3 }),
      fila({ medio: 'TRANSFERENCIA', moneda: 'USD', cubre: 'USD', monto: d('50'), _count: 2 }),
    ])
    expect(c.ars.total).toBe('3000')
    expect(c.usd.total).toBe('100')
  })

  it('cada pila ordena de mayor a menor por su cuenta', () => {
    const c = componerPorMedio([
      fila({ medio: 'EFECTIVO', monto: d('100') }),
      fila({ medio: 'TRANSFERENCIA', monto: d('900') }),
    ])
    expect(c.ars.barras.map((b) => b.medio)).toEqual(['TRANSFERENCIA', 'EFECTIVO'])
  })

  it('un medio sin un solo pago en esa moneda no aparece en esa pila', () => {
    const c = componerPorMedio([
      fila({ medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD', monto: d('10') }),
    ])
    expect(c.ars.barras).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run lib/ventas/composicion.test.ts`
Expected: FAIL — `c.ars.total is undefined`, y el caso del pago USD/USD falla
con `'300'` en la pila de pesos si se lo adapta a la forma vieja. Ese fallo
**es el defecto**.

- [ ] **Step 3: Reescribir los tipos**

En `lib/ventas/medios.ts`, reemplazar `Barra` y `Composicion` por:

```ts
/**
 * Una barra del panel: un medio de pago y lo que entró por él, EN UNA SOLA
 * MONEDA.
 *
 * Antes eran cuatro campos (`ars`, `usd`, `usdCrudo`, `total`) porque el panel
 * mezclaba las dos monedas en una barra, convirtiendo los dólares con
 * `Pago.cotizacion`. Eso resultó imposible de sostener: `cotizacion` vale 1
 * cuando el pago no cruza monedas —a propósito, ver `cotizacionParaElCruce` en
 * app/(app)/vender/punto-de-venta.tsx—, así que un pago de US$ 300 en efectivo
 * aportaba 300 a una barra de pesos. Hoy hay una composición por moneda y
 * ninguna cotización entra en la cuenta.
 *
 * `monto` es `string` y no `Decimal` por lo mismo de siempre: es la salida
 * FINAL de una suma, y lo único que un consumidor hace con ella es mostrarla.
 */
export type Barra = { medio: Medio; monto: string }

export type Composicion = {
  /** De mayor a menor. Los medios sin un solo pago en esta moneda no aparecen. */
  barras: Barra[]
  total: string
}

/** Las dos pilas del período, sin ninguna conversión entre ellas. */
export type ComposicionPorMoneda = {
  ars: Composicion
  usd: Composicion
  /** Si hubo algún pago en dólares. Es lo que decide si el selector se dibuja. */
  hayDolares: boolean
}

/** Qué pila mira la pantalla. Viaja en la URL como `?moneda`. */
export type MonedaElegida = 'ars' | 'usd'

export function monedaValida(v: string | undefined): MonedaElegida {
  return v === 'usd' ? 'usd' : 'ars'
}
```

- [ ] **Step 4: Reescribir `componerPorMedio`**

En `lib/ventas/composicion.ts`, reemplazar el cuerpo de la función. **Borrar
el import de `pesosEntregados`**: es el llamador que se va.

```ts
/**
 * Cómo entró la plata del período, por medio de pago y POR MONEDA.
 *
 * La pila la elige `Pago.moneda` y el importe es `Pago.monto` tal cual:
 * ninguna cotización entra en la cuenta, en ninguna de las cuatro
 * combinaciones de `(moneda, cubre)`. Es la definición correcta de lo que el
 * panel promete —qué se entregó físicamente— y lo que se entregó no necesita
 * ninguna conversión para nombrarse.
 *
 * **Esto ARREGLA un defecto que estuvo en producción.** La versión anterior
 * valuaba los pagos en dólares con `pesosEntregados`, o sea con
 * `Pago.cotizacion`, que vale 1 cuando el pago no cruza monedas: un pago de
 * US$ 300 en efectivo sobre un total en dólares aportaba 300 al largo de la
 * barra en vez de los ~445.500 que representa. Los importes que el panel
 * mostraba estaban bien —salían de `ars` y `usdCrudo`, los dos crudos—; lo que
 * mentía era la barra y el "N % del total", y para un local que cobra en
 * dólares en efectivo todas las barras quedaban cerca de cero.
 *
 * Con esto queda cerrada la costura que CLAUDE.md dejó abierta el 2026-08-30:
 * "Cómo entró la plata sigue convirtiendo los dólares a pesos, porque sus
 * barras necesitan una unidad común". Ya no la necesitan: cada moneda es su
 * propio panel.
 *
 * `_count` y el redondeo por pago se mantienen intactos (ver `FilaDePagos`).
 */
export function componerPorMedio(filas: FilaDePagos[]): ComposicionPorMoneda {
  const pilas: Record<MonedaElegida, Map<Medio, Decimal>> = { ars: new Map(), usd: new Map() }
  let hayDolares = false

  for (const f of filas) {
    if (f._count <= 0) continue
    const pila = f.moneda === 'USD' ? pilas.usd : pilas.ars
    if (f.moneda === 'USD') hayDolares = true
    // Redondear PRIMERO y multiplicar por la cantidad después, no al revés:
    // es lo que reproduce exactamente la suma pago por pago de `totalDePagos`.
    const suma = redondearDinero(f.monto).mul(f._count)
    pila.set(f.medio, (pila.get(f.medio) ?? new Prisma.Decimal(0)).add(suma))
  }

  return { ars: aComposicion(pilas.ars), usd: aComposicion(pilas.usd), hayDolares }
}

function aComposicion(pila: Map<Medio, Decimal>): Composicion {
  const barras: Barra[] = [...pila.entries()]
    .map(([medio, monto]) => ({ medio, monto: monto.toString() }))
    // Por plata y de mayor a menor: la barra más larga arriba es lo que hace
    // que el orden de lectura y el largo de las barras digan lo mismo.
    .sort((a, b) => Number(b.monto) - Number(a.monto))
  const total = barras.reduce((acc, b) => acc.add(b.monto), new Prisma.Decimal(0))
  return { barras, total: total.toString() }
}
```

Actualizar el re-export de tipos del encabezado del archivo para incluir
`ComposicionPorMoneda`.

- [ ] **Step 5: Correr y verlo pasar**

Run: `npx vitest run lib/ventas/composicion.test.ts`
Expected: PASS. Los casos viejos que leían `b.ars`/`b.usdCrudo`/`b.total` hay
que reescribirlos a la forma nueva — **no borrarlos**: cada uno prueba una
regla (el redondeo por pago, el orden, la exclusión de medios sin pagos) que
sigue vigente.

- [ ] **Step 6: `GraficoDeMedios` recibe una moneda y gana el selector**

En `app/(app)/ventas/grafico.tsx`:

1. Mover `porcentajesQueSuman100` a `lib/ventas/porcentajes.ts` (archivo nuevo,
   con su docblock completo del método del resto mayor), y mover sus casos de
   `grafico.test.tsx` a `lib/ventas/porcentajes.test.ts`. Importarla acá.
2. La firma pasa a:

```tsx
export function GraficoDeMedios({
  composicion, hayDolares, moneda, hrefDeMoneda,
}: {
  composicion: Composicion
  hayDolares: boolean
  moneda: MonedaElegida
  /** El link de cada opción del selector, armado por la pantalla: este
   *  componente no conoce el resto del query string. */
  hrefDeMoneda: (m: MonedaElegida) => string
}) {
```

3. Cada barra muestra **un solo importe**: `formatearPrecio(b.monto)` si
   `moneda === 'ars'`, `formatearDolares(b.monto)` si no. Se van las dos líneas
   apiladas y las dos guardas de cero, que existían para el panel mezclado.
4. El encabezado gana el selector, a la derecha del título, **sólo si
   `hayDolares`** — dos links con la geometría del segmentado de rango
   (`rounded-[8px] px-[10px] py-1 text-[11px] font-semibold`, el activo con
   `bg-card text-foreground`, el inactivo con `text-muted-foreground`, adentro
   de un `rounded-[9px] bg-muted p-[3px]`).
5. La nota del pie pasa a: *"Cada moneda dice su propio número. Nada se
   convierte: no hay tipo de cambio guardado en una venta cobrada en dólares."*

- [ ] **Step 7: `/ventas` lee `?moneda` y la pasa**

En `app/(app)/ventas/page.tsx`: leer `monedaValida(sp.moneda)`, elegir la pila,
y armar `hrefDeMoneda` preservando `rango`/`desde`/`hasta`/`vista`/`p` — el
mismo criterio que ya usan `hrefRango` y `hrefDeVista`, incluido el de **no
escribir el parámetro cuando es el default**. Sumar el campo oculto `moneda` a
`FormularioDeFechas`, al lado del de `vista`, por el mismo motivo que ese: un
filtro de fechas no puede devolver el panel a pesos sin que nadie lo pida.

- [ ] **Step 8: Verificar todo `/ventas` y el typecheck**

Run: `npx vitest run "app/(app)/ventas" lib/ventas && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/ventas components/ "app/(app)/ventas"
git commit -m "fix(ventas): las barras de medios dejan de valuar dólares a cotización 1

Un pago que no cruza monedas lleva cotizacion = 1 a propósito, así que
US\$ 300 en efectivo aportaban 300 al largo de la barra. Los importes que se
mostraban estaban bien; mentía la barra y el porcentaje. La composición pasa a
ser por moneda y ninguna cotización entra en la cuenta.

Cierra la costura que CLAUDE.md dejó abierta el 2026-08-30."
```

---

### Task 4: El costo, congelado en la venta

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_costo_en_la_venta/migration.sql`
- Modify: `lib/ventas/crear.ts`
- Modify: `test/ventas.test.ts`
- Modify: `docs/schema.md` (regenerado)

**Interfaces:**
- Produces: `VentaItem.costoUnitario: Decimal | null`,
  `Venta.costoArs: Decimal`, `Venta.vendidoConCosto: Decimal`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/ventas.test.ts` (tiene el arnés contra la base efímera):

```ts
describe('el costo se congela al cobrar', () => {
  it('toma el último INGRESO CON COSTO, no el ingreso más reciente', async () => {
    // Dos ingresos: el primero con costo, el segundo sin. El segundo es el más
    // reciente, y el que hay que ignorar — mismo criterio que el tile
    // "Último costo" de /inventario/[id].
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('10'),
      usuarioId, costoUnitario: d('600') })
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('5'),
      usuarioId, costoUnitario: null })

    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: remera, cantidad: d('2') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
        base: d('2000'), cotizacion: d('1') }],
    })

    const prisma = prismaParaTenant(tenantId)
    const items = await prisma.ventaItem.findMany({ where: { ventaId: venta.id } })
    expect(items[0].costoUnitario?.toString()).toBe('600')

    const guardada = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(guardada.costoArs.toString()).toBe('1200')        // 600 × 2
    expect(guardada.vendidoConCosto.toString()).toBe('2000') // 1000 × 2, a precio de lista
  })

  it('un artículo sin ningún ingreso con costo queda en NULL y no suma', async () => {
    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
        base: d('5000'), cotizacion: d('1') }],
    })
    const prisma = prismaParaTenant(tenantId)
    const items = await prisma.ventaItem.findMany({ where: { ventaId: venta.id } })
    expect(items[0].costoUnitario).toBeNull()
    const guardada = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(guardada.costoArs.toString()).toBe('0')
    expect(guardada.vendidoConCosto.toString()).toBe('0')
  })

  // El costo se guarda en PESOS y el precio de este artículo está en dólares:
  // compararlos exigiría inventar una cotización. Misma decisión que
  // `textoDeMargen` en /inventario/[id].
  it('un ítem en dólares queda en NULL aunque el artículo tenga costo', async () => {
    const enUsd = await crearArticulo({
      tenantId, usuarioId, nombre: 'iPhone', tipo: 'PRODUCTO',
      precio: d('300'), moneda: 'USD', stockInicial: d('3'), costoUnitario: d('200000'),
    })
    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: enUsd.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'USD', cubre: 'USD',
        base: d('300'), cotizacion: d('1') }],
    })
    const prisma = prismaParaTenant(tenantId)
    const items = await prisma.ventaItem.findMany({ where: { ventaId: venta.id } })
    expect(items[0].costoUnitario).toBeNull()
    const guardada = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(guardada.costoArs.toString()).toBe('0')
    expect(guardada.vendidoConCosto.toString()).toBe('0')
  })

  // La mitad que importa del par de columnas: las dos suman EXACTAMENTE los
  // mismos ítems, así que el margen nunca divide por mercadería cuyo costo no
  // se conoce.
  it('con un ítem con costo y otro sin él, las dos columnas cubren sólo el primero', async () => {
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('10'),
      usuarioId, costoUnitario: d('600') })
    const venta = await crearVenta({
      tenantId, usuarioId,
      items: [
        { articuloId: remera, cantidad: d('1') },   // $1000, costo 600
        { articuloId: servicio, cantidad: d('1') }, // $5000, sin costo
      ],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', cubre: 'ARS',
        base: d('6000'), cotizacion: d('1') }],
    })
    const prisma = prismaParaTenant(tenantId)
    const g = await prisma.venta.findUniqueOrThrow({ where: { id: venta.id } })
    expect(g.costoArs.toString()).toBe('600')
    expect(g.vendidoConCosto.toString()).toBe('1000')
    expect(g.total.toString()).toBe('6000')
  })
})
```

Sumar `ingresarStock` al bloque de imports dinámicos del archivo, junto a
`ajustarStock`.

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run test/ventas.test.ts -t "el costo se congela"`
Expected: FAIL — `Property 'costoUnitario' does not exist on type VentaItem`.

- [ ] **Step 3: El schema**

En `prisma/schema.prisma`:

```prisma
model VentaItem {
  // ... campos existentes
  /// El último costo conocido del artículo AL MOMENTO DE COBRAR, en pesos.
  /// Congelado, igual que `descripcion` y `precioUnitario` y por el mismo
  /// motivo: un costo que se corrige mañana no puede cambiar lo que una venta
  /// de hoy dice que costó.
  /// NULL cuando el artículo no tenía ningún ingreso con costo cargado, y NULL
  /// SIEMPRE para un ítem en dólares — el costo se guarda en pesos y
  /// compararlo contra un precio en dólares exigiría inventar una cotización.
  costoUnitario Decimal? @map("costo_unitario") @db.Decimal(12, 2)
}

model Venta {
  // ... campos existentes
  /// Caché de la suma de los ítems que SÍ tenían costo. Mismo criterio que
  /// `recargo` frente a `Pago.recargo` y que `Articulo.stock` frente a sus
  /// movimientos: la fuente de verdad son los ítems, esto evita traerlos.
  costoArs        Decimal @default(0) @map("costo_ars")         @db.Decimal(12, 2)
  /// La mercadería EN PESOS de ESOS MISMOS ítems, a precio de lista.
  /// Existe para que el margen del período se divida contra la mercadería
  /// cuyo costo se conoce y no contra `total`, que incluye lo que no lo tiene:
  /// con `total` el porcentaje saldría subestimado sin que nada lo dijera.
  vendidoConCosto Decimal @default(0) @map("vendido_con_costo") @db.Decimal(12, 2)
}
```

- [ ] **Step 4: La migración, con `--create-only`**

```bash
npx prisma migrate dev --create-only --name costo_en_la_venta
```

`--create-only` es obligatorio en este repo: sin él Prisma aplica antes de que
se pueda revisar el SQL, y salir de eso exige un `migrate reset` que el gate
prohíbe. El SQL tiene que quedar en exactamente tres `ALTER TABLE ... ADD
COLUMN`, **ningún `DROP`**. Aplicarla después:

```bash
npx prisma migrate dev
```

- [ ] **Step 5: El escritor, en `crearVenta`**

En `lib/ventas/crear.ts`, **inmediatamente después** del `const porId = new
Map(...)` y **antes** de `proximoNumero` — todo lo que se consulte después de
esa llamada es tiempo que la otra caja pasa esperando el lock del tenant:

```ts
// El último costo conocido de cada artículo, para congelarlo en el ítem.
//
// `distinct` sobre `articuloId` con `orderBy` descendente devuelve la fila más
// reciente de cada artículo en UNA consulta, sin un query por ítem.
//
// El filtro es `costoUnitario: { not: null }` y no "el ingreso más reciente":
// un ingreso cargado sin costo no borra lo que se sabía del anterior. Mismo
// criterio que el tile "Último costo" de app/(app)/inventario/[id]/page.tsx.
const ultimosCostos = await tx.movimientoStock.findMany({
  where: {
    articuloId: { in: items.map((i) => i.articuloId) },
    motivo: 'INGRESO',
    costoUnitario: { not: null },
  },
  orderBy: [{ articuloId: 'asc' }, { creadoEn: 'desc' }],
  distinct: ['articuloId'],
  select: { articuloId: true, costoUnitario: true },
})
const costoPorArticulo = new Map(ultimosCostos.map((m) => [m.articuloId, m.costoUnitario]))
```

En el `map` que arma `lineas`, agregar al objeto devuelto:

```ts
// NULL para un ítem en dólares aunque el artículo tenga costo: el costo está
// en pesos, y compararlos exigiría inventar una cotización.
costoUnitario: a.moneda === 'USD' ? null : (costoPorArticulo.get(a.id) ?? null),
```

Después de `const totales = totalesDeItems(lineas)`:

```ts
// Las DOS columnas cubren exactamente los mismos ítems, y por eso se calculan
// en el mismo reduce: el margen del período divide una contra la otra, así que
// un ítem que entrara en una y no en la otra sesgaría el porcentaje sin que
// nada lo dijera.
const conCosto = lineas.reduce(
  (acc, l) =>
    l.costoUnitario === null
      ? acc
      : {
          costo: acc.costo.add(subtotalItem(l.cantidad, l.costoUnitario)),
          vendido: acc.vendido.add(subtotalItem(l.cantidad, l.precioUnitario)),
        },
  { costo: new Prisma.Decimal(0), vendido: new Prisma.Decimal(0) },
)
```

En `tx.venta.create`, sumar `costoArs: conCosto.costo` y
`vendidoConCosto: conCosto.vendido`, y en el `create` de cada ítem sumar
`costoUnitario: l.costoUnitario`.

- [ ] **Step 6: Correr y verlo pasar**

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS. Ningún caso viejo de ese archivo puede cambiar.

- [ ] **Step 7: Regenerar el diagrama del schema**

```bash
scripts/generar-erd.sh
```

Es el paso 3 del gate de `deploy.sh` y el hook de pre-commit: sin esto,
`docs/schema.md` queda desactualizado y el commit se rechaza.

- [ ] **Step 8: Commit**

```bash
git add prisma/ lib/ventas/crear.ts test/ventas.test.ts docs/schema.md
git commit -m "feat(ventas): el costo de lo vendido se congela al cobrar

Tres columnas aditivas con default. VentaItem.costoUnitario toma el último
INGRESO CON COSTO del artículo —no el ingreso más reciente— y queda fijo, igual
que descripcion y precioUnitario. Venta.costoArs y Venta.vendidoConCosto son el
caché, y cubren exactamente los mismos ítems: es lo que impide que el margen
del período divida contra mercadería cuyo costo no se conoce.

Los defaults reproducen lo que el código anterior asumía, así que la imagen
previa lee cualquier fila que esta migración produzca."
```

---

### Task 5: Los cuatro tokens de marca

**Files:**
- Modify: `app/globals.css`
- Modify: `docs/sistema-de-diseno.md`
- Modify: `test/maqueta.test.ts` (`SOLO_EN_CSS`)

**Interfaces:**
- Produces: `--marca-2: #4A2AA5`, `--marca-3: #7C5FD6`, `--marca-4: #DCD3F2`,
  `--marca-ok: #C9F2DF`

- [ ] **Step 1: Correr el gate de diseño y verlo fallar**

Agregar los cuatro tokens a `:root` en `app/globals.css`, junto a
`--marca-soft`/`--marca-dim`, con este comentario:

```css
  /* La escala del anillo del dashboard: cinco gajos que van de --marca al más
     claro. --marca es el primero y --primary el segundo, así que sólo hacen
     falta tres escalones más. La maqueta los escribe literales, sin nombrarlos
     con ninguna variable $ar-*, igual que ya pasaba con --marca-soft: son los
     colores que más se repiten sin variable propia. */
  --marca-2: #4A2AA5;
  --marca-3: #7C5FD6;
  --marca-4: #DCD3F2;
  /* El verde del chip de delta SOBRE el paño de marca. No puede pagar --ok /
     --ok-soft: sobre el violeta, el soft (casi blanco) desaparece y el --ok
     (verde oscuro) no contrasta. No hay --marca-danger: la maqueta no dibuja
     el chip a la baja sobre este paño, así que ése va sin color de signo en
     vez de inventarle un rojo. */
  --marca-ok: #C9F2DF;
```

Run: `npx vitest run test/maqueta.test.ts test/sistema-de-diseno.test.ts`
Expected: FAIL — "app/globals.css define tokens que la maqueta no conoce:
--marca-2, --marca-3, --marca-4, --marca-ok", y el par en
`test/sistema-de-diseno.test.ts` por no estar documentados.

- [ ] **Step 2: Anotar la excepción en `test/maqueta.test.ts`**

Sumar a `SOLO_EN_CSS`:

```ts
  '--marca-2':
    'la escala del anillo del dashboard. En la maqueta está escrito literal como ' +
    '#4A2AA5 dentro de los gajos, sin variable propia — mismo caso que --marca-soft.',
  '--marca-3': 'lo mismo, un escalón más claro (#7C5FD6).',
  '--marca-4': 'lo mismo, el más claro de los cinco (#DCD3F2).',
  '--marca-ok':
    'el verde del chip de delta sobre el paño de marca (#C9F2DF, literal en el ' +
    '.pen). No puede pagar --ok/--ok-soft: sobre el violeta uno desaparece y el ' +
    'otro no contrasta.',
```

- [ ] **Step 3: Documentar los cuatro en `docs/sistema-de-diseno.md`**

En la sección donde ya viven `--marca-soft` y `--marca-dim`, agregar sus filas
con el valor exacto y el uso. `test/sistema-de-diseno.test.ts` compara el
documento contra el CSS **en las dos direcciones**: un token en uno de los dos
archivos y no en el otro rompe el build.

- [ ] **Step 4: Correr y verlo pasar**

Run: `npx vitest run test/maqueta.test.ts test/sistema-de-diseno.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/globals.css docs/sistema-de-diseno.md test/maqueta.test.ts
git commit -m "feat(diseño): la escala del anillo y el verde sobre el paño de marca"
```

---

### Task 6: El anillo

**Files:**
- Create: `components/anillo.tsx`
- Create: `components/anillo.test.tsx`
- Create: `lib/ventas/porcentajes.ts` (si Task 3 no lo movió ya)

**Interfaces:**
- Consumes: `porcentajesQueSuman100` de `@/lib/ventas/porcentajes`
- Produces:
  - `type Gajo = { rotulo: string; monto: string; porcentaje: number }`
  - `type Arco = { largo: number; offset: number; color: string }`
  - `COLORES_DEL_ANILLO: readonly string[]` — cinco `var(--…)`
  - `arcosDe(porcentajes: number[]): Arco[]`
  - `Anillo({ gajos, centro, diametro }): JSX.Element` — sin `pie`: la leyenda
    la dibuja cada panel, que es el que sabe si muestra importe, porcentaje o
    los dos

- [ ] **Step 1: Escribir el test que falla**

```tsx
// components/anillo.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Anillo, arcosDe } from './anillo'

describe('los arcos del anillo', () => {
  it('el primero arranca arriba y van en sentido horario', () => {
    const [a] = arcosDe([50, 50])
    expect(a.offset).toBe(0)
  })

  it('cada arco arranca donde termina el anterior', () => {
    const arcos = arcosDe([40, 35, 25])
    expect(arcos.map((a) => a.offset)).toEqual([0, 40, 75])
    expect(arcos.map((a) => a.largo)).toEqual([40, 35, 25])
  })

  it('un gajo en cero no dibuja arco', () => {
    expect(arcosDe([100, 0]).length).toBe(1)
  })

  it('sin ningún gajo no dibuja nada', () => {
    expect(arcosDe([])).toEqual([])
  })
})

describe('el anillo se lee sin ver el SVG', () => {
  // display:none sobre un <svg> no lo saca del árbol de accesibilidad de forma
  // confiable, y un anillo sin texto no dice nada: la lista va SIEMPRE, y el
  // SVG va aria-hidden.
  it('lleva una lista accesible con cada gajo y su porcentaje', () => {
    const html = renderToStaticMarkup(
      <Anillo
        gajos={[
          { rotulo: 'Efectivo', monto: '$ 4.038.200', porcentaje: 48 },
          { rotulo: 'Crédito', monto: '$ 673.000', porcentaje: 8 },
        ]}
        centro={{ valor: '$ 8,41 M', rotulo: 'cobrado' }}
      />,
    )
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('Efectivo')
    expect(html).toContain('48%')
    expect(html).toContain('$ 4.038.200')
    expect(html).toContain('$ 8,41 M')
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run components/anillo.test.tsx`
Expected: FAIL — `Failed to resolve import "./anillo"`

- [ ] **Step 3: Implementar**

```tsx
// components/anillo.tsx
/**
 * Un anillo de gajos, en SVG y sin librería.
 *
 * Es un solo círculo por gajo, con `stroke-dasharray` recortándolo al arco que
 * le toca y `stroke-dashoffset` corriéndolo hasta donde termina el anterior.
 * La circunferencia se elige en 100 para que los porcentajes SEAN las
 * longitudes y no haya que multiplicar por 2πr en ningún lado.
 *
 * Sin librería a propósito: el ciclo del rediseño de /inventario sacó recharts
 * del repo entero, y cinco arcos no lo justifican de vuelta.
 */

/** El radio que hace que la circunferencia mida exactamente 100. */
const RADIO = 100 / (2 * Math.PI)

export type Gajo = { rotulo: string; monto: string; porcentaje: number }

/**
 * Los cinco colores, de --marca al más claro (design/arandano.pen, nodos
 * `z7E8t`…`e0EpYe`). Un anillo con más de cinco gajos no existe: los paneles
 * que lo usan agrupan la cola en "Otros".
 */
export const COLORES_DEL_ANILLO = [
  'var(--marca)', 'var(--marca-2)', 'var(--marca-3)',
  'var(--marca-soft)', 'var(--marca-4)',
] as const

export type Arco = { largo: number; offset: number; color: string }

/**
 * Los arcos acumulados, en el orden de los gajos.
 *
 * Los gajos en cero no dibujan arco: un `stroke-dasharray` de 0 no pinta nada
 * pero igual monta un `<circle>`, y con `stroke-linecap` redondeado dejaría un
 * punto de color flotando sobre el arco vecino.
 */
export function arcosDe(porcentajes: number[]): Arco[] {
  const arcos: Arco[] = []
  let acumulado = 0
  porcentajes.forEach((p, i) => {
    if (p > 0) {
      arcos.push({ largo: p, offset: acumulado, color: COLORES_DEL_ANILLO[i % COLORES_DEL_ANILLO.length] })
    }
    acumulado += p
  })
  return arcos
}

export function Anillo({
  gajos, centro, diametro = 132,
}: {
  gajos: Gajo[]
  centro: { valor: string; rotulo: string }
  diametro?: number
}) {
  const arcos = arcosDe(gajos.map((g) => g.porcentaje))
  return (
    <div className="relative shrink-0" style={{ width: diametro, height: diametro }}>
      {/* rotate(-90) arranca el primer gajo arriba en vez de a las 3 en punto,
          que es donde SVG pone el ángulo 0. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 32 32"
        className="size-full -rotate-90"
      >
        {arcos.map((a, i) => (
          <circle
            key={i}
            cx="16" cy="16" r={RADIO}
            fill="none"
            stroke={a.color}
            // 0.38 del diámetro es el grosor que deja `innerRadius: 0.62` en
            // el .pen: el hueco del medio ocupa el 62 % del radio.
            strokeWidth={RADIO * 2 * 0.38}
            strokeDasharray={`${a.largo} ${100 - a.largo}`}
            strokeDashoffset={-a.offset}
          />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-[family-name:var(--font-archivo)] text-[19px] font-semibold tracking-[-0.4px] text-foreground">
          {centro.valor}
        </span>
        <span className="text-[11px] text-muted-foreground">{centro.rotulo}</span>
      </div>
      {/* El anillo es puro color: sin esto, quien no ve el SVG no tiene el
          dato. No es `sr-only` decorativo — es el contenido, y la leyenda que
          los paneles dibujan al lado no siempre repite el porcentaje. */}
      <ul className="sr-only">
        {gajos.map((g) => (
          <li key={g.rotulo}>{`${g.rotulo}: ${g.porcentaje}%, ${g.monto}`}</li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Correr y verlo pasar**

Run: `npx vitest run components/anillo.test.tsx`
Expected: PASS, 5 casos.

- [ ] **Step 5: Commit**

```bash
git add components/anillo.tsx components/anillo.test.tsx lib/ventas/porcentajes.ts
git commit -m "feat(dashboard): el anillo de gajos, en SVG y sin librería"
```

---

### Task 7: Las métricas de los cuatro tiles

**Files:**
- Create: `lib/dashboard/metricas.ts`
- Create: `lib/dashboard/metricas.test.ts`

**Interfaces:**
- Consumes: `Periodo`, `filtroDe` (Task 2); `cobradoDeGrupos`, `Totales` de
  `@/lib/ventas/cobrado`; `redondearDinero` de `@/lib/ventas/totales`
- Produces:
  - `type Delta = { porcentaje: number; sube: boolean } | null`
  - `delta(actual: Decimal, previo: Decimal): Delta`
  - `type Margen = { monto: Decimal; porcentaje: Decimal } | null`
  - `margenDe(vendidoConCosto: Decimal, costo: Decimal): Margen`
  - `indicesDeMediana(n: number): { skip: number; take: number } | null`
  - `type Metricas = { cobrado: Totales; cobradas: number; ticket: Decimal | null; mediana: Decimal | null; margen: Margen }`
  - `metricasDelPeriodo(prisma: PrismaDeTenant, periodo: Periodo): Promise<Metricas>`

**Movimiento previo obligatorio.** El spec dice que este módulo usa "la misma
función" que el tile de `/ventas`, y hoy `pagosDelPeriodo` vive dentro de
`app/(app)/ventas/page.tsx`. Un módulo de `lib/` no puede importar de `app/`
—la dependencia va en la otra dirección—, así que **antes del Step 1** se mueve
`pagosDelPeriodo` a `lib/ventas/cobrado.ts`, donde ya vive `cobradoDeGrupos`,
con su docblock completo. Hay que actualizar los dos importadores:
`app/(app)/ventas/page.tsx` y `test/ventas.test.ts` (que hoy lo importa de la
página). Sin este movimiento habría dos `groupBy` con el mismo `anuladaEn:
null`, que es exactamente la duplicación que el docblock de esa función existe
para evitar.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/dashboard/metricas.test.ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { delta, margenDe, indicesDeMediana } from './metricas'

const d = (v: string) => new Prisma.Decimal(v)

describe('el delta contra el período anterior', () => {
  it('sube y baja con el signo correcto, a un decimal', () => {
    expect(delta(d('312'), d('286'))).toEqual({ porcentaje: 9.1, sube: true })
    expect(delta(d('2398700'), d('2455200'))).toEqual({ porcentaje: -2.3, sube: false })
  })

  // No hay porcentaje de crecimiento contra cero: "+∞ %" y "+100 %" son las
  // dos maneras de inventarlo. El chip no se dibuja y el pie lo dice.
  it('sin período anterior no hay delta', () => {
    expect(delta(d('312'), d('0'))).toBeNull()
  })

  it('de algo a cero sí tiene delta: es −100 %', () => {
    expect(delta(d('0'), d('286'))).toEqual({ porcentaje: -100, sube: false })
  })

  it('sin movimiento el delta es cero y se dibuja igual', () => {
    expect(delta(d('286'), d('286'))).toEqual({ porcentaje: 0, sube: true })
  })
})

describe('el margen divide contra la mercadería CON costo, no contra el total', () => {
  it('el porcentaje sale sobre vendidoConCosto', () => {
    // Vendido con costo 8.416.000, costo 6.017.300 → margen 2.398.700 = 28,5 %
    const m = margenDe(d('8416000'), d('6017300'))
    expect(m?.monto.toString()).toBe('2398700')
    expect(m?.porcentaje.toFixed(1)).toBe('28.5')
  })

  // La diferencia entre "no hay margen" y "el margen es cero": sin ninguna
  // venta con costo cargado el tile muestra una raya y lo explica, no un 0 %.
  it('sin mercadería con costo no hay margen', () => {
    expect(margenDe(d('0'), d('0'))).toBeNull()
  })

  it('un margen negativo es un margen, no una ausencia', () => {
    const m = margenDe(d('1000'), d('1200'))
    expect(m?.monto.toString()).toBe('-200')
    expect(m?.porcentaje.toFixed(1)).toBe('-20.0')
  })
})

describe('la mediana no trae el período entero', () => {
  // Con n impar cruza UNA fila; con n par, dos. Es lo que evita que "Este año"
  // traiga decenas de miles de Decimal para calcular un solo número.
  it('con n impar pide una sola fila, la del medio', () => {
    expect(indicesDeMediana(7)).toEqual({ skip: 3, take: 1 })
    expect(indicesDeMediana(1)).toEqual({ skip: 0, take: 1 })
  })

  it('con n par pide las dos del medio', () => {
    expect(indicesDeMediana(8)).toEqual({ skip: 3, take: 2 })
    expect(indicesDeMediana(2)).toEqual({ skip: 0, take: 2 })
  })

  it('sin ventas no pide nada', () => {
    expect(indicesDeMediana(0)).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run lib/dashboard/metricas.test.ts`
Expected: FAIL — `Failed to resolve import "./metricas"`

- [ ] **Step 3: Implementar las funciones puras**

```ts
// lib/dashboard/metricas.ts
import { Prisma } from '@/generated/prisma/client'
import { redondearDinero } from '@/lib/ventas/totales'

type Decimal = Prisma.Decimal

/** El chip de variación: el porcentaje con signo, y si sube. */
export type Delta = { porcentaje: number; sube: boolean } | null

/**
 * La variación contra el período anterior, a un decimal.
 *
 * `null` cuando el período anterior fue CERO, y es una decisión: no hay
 * porcentaje de crecimiento contra nada. "+∞ %" y "+100 %" son las dos maneras
 * de inventarlo, y las dos se leen como un dato real. El chip no se dibuja y
 * el pie del tile dice "sin ventas en julio".
 *
 * De algo a cero sí devuelve delta (−100 %): ahí el denominador existe.
 */
export function delta(actual: Decimal, previo: Decimal): Delta {
  if (previo.isZero()) return null
  const pct = actual.minus(previo).div(previo).mul(100)
  const redondeado = Number(pct.toDecimalPlaces(1, Prisma.Decimal.ROUND_HALF_UP))
  return { porcentaje: redondeado, sube: redondeado >= 0 }
}

export type Margen = { monto: Decimal; porcentaje: Decimal } | null

/**
 * El margen del período y su porcentaje sobre la venta.
 *
 * Divide contra `vendidoConCosto` y NO contra `Venta.total`: las dos columnas
 * cubren exactamente los mismos ítems (ver `crearVenta`), así que el
 * porcentaje nunca mezcla mercadería con costo conocido contra mercadería sin
 * él. Con `total` en el denominador saldría subestimado sin que nada lo dijera.
 *
 * `null` con cero mercadería con costo: es distinto de un margen de cero, y el
 * tile lo dice con todas las letras en vez de mostrar "0 %". Mismo criterio
 * que `textoDeMargen` en app/(app)/inventario/[id]/page.tsx.
 */
export function margenDe(vendidoConCosto: Decimal, costo: Decimal): Margen {
  if (vendidoConCosto.isZero()) return null
  const monto = redondearDinero(vendidoConCosto.minus(costo))
  return { monto, porcentaje: monto.div(vendidoConCosto).mul(100) }
}

/**
 * El `skip`/`take` que traen la o las filas del medio de `n` ventas ordenadas.
 *
 * Existe para no traer el período entero: Postgres ordena igual, pero cruzan
 * una o dos filas en vez de decenas de miles. Es la respuesta a la
 * preocupación que CLAUDE.md ya dejó anotada para el panel de horarios.
 */
export function indicesDeMediana(n: number): { skip: number; take: number } | null {
  if (n <= 0) return null
  return n % 2 === 1
    ? { skip: (n - 1) / 2, take: 1 }
    : { skip: n / 2 - 1, take: 2 }
}
```

- [ ] **Step 4: Correr y verlo pasar**

Run: `npx vitest run lib/dashboard/metricas.test.ts`
Expected: PASS, 10 casos.

- [ ] **Step 5: Sumar el orquestador que toca la base**

En el mismo archivo, debajo:

```ts
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { cobradoDeGrupos, pagosDelPeriodo, type Totales } from '@/lib/ventas/cobrado'
import { filtroDe, type Periodo } from './rango'

type PrismaDeTenant = ReturnType<typeof prismaParaTenant>

export type Metricas = {
  cobrado: Totales
  cobradas: number
  /** El ticket promedio EN PESOS. `null` cuando afirmarlo sería falso. */
  ticket: Decimal | null
  mediana: Decimal | null
  margen: Margen
}

/**
 * Las cuatro métricas de un período.
 *
 * Exportada, y no inline en el Server Component, por la razón de siempre: un
 * componente `async` que abre sesión no lo puede llamar ningún test, y la
 * regla "una venta anulada no es plata que entró" quedaría tan desprotegida
 * como la que el hallazgo I3 de la review del rediseño mostró que se podía
 * borrar dejando 785 tests en verde. Ese `anuladaEn: null` aparece cuatro
 * veces acá abajo, y las cuatro tienen que decir lo mismo.
 */
export async function metricasDelPeriodo(
  prisma: PrismaDeTenant,
  periodo: Periodo,
): Promise<Metricas> {
  const donde = { ...filtroDe(periodo), anuladaEn: null }

  const [grupos, cobradas, sumas] = await Promise.all([
    pagosDelPeriodo(prisma, filtroDe(periodo), false),
    prisma.venta.count({ where: donde }),
    prisma.venta.aggregate({
      where: donde,
      _sum: { costoArs: true, vendidoConCosto: true },
    }),
  ])

  const cobrado = cobradoDeGrupos(grupos)
  const cero = new Prisma.Decimal(0)

  return {
    cobrado,
    cobradas,
    ticket: ticketPromedio(cobrado, cobradas),
    // Va DESPUÉS del count y no en el Promise.all: `indicesDeMediana` necesita
    // el total para saber qué fila pedir.
    mediana: await medianaDeVentas(prisma, donde, cobradas),
    margen: margenDe(sumas._sum.vendidoConCosto ?? cero, sumas._sum.costoArs ?? cero),
  }
}

/**
 * El ticket promedio en pesos, o `null`.
 *
 * Misma guarda —y misma razón— que `pieDeCobradas` en app/(app)/ventas/page.tsx:
 * sin ninguna venta cobrada no hay promedio, y con CERO pesos cobrados sobre un
 * período que sí cobró dólares, "$ 0,00" no es una omisión sino una afirmación
 * falsa al lado de un tile que muestra dólares. No se agrega una segunda línea
 * en dólares: el promedio en dólares dividiría por un denominador que incluye
 * las ventas que no movieron un solo dólar.
 */
function ticketPromedio(cobrado: Totales, cobradas: number): Decimal | null {
  if (cobradas <= 0) return null
  if (cobrado.ars.isZero() && !cobrado.usd.isZero()) return null
  return redondearDinero(cobrado.ars.div(cobradas))
}

/**
 * La mediana de `Venta.total` del período, sin traer el período entero.
 *
 * Postgres ordena igual, pero cruzan una o dos filas en vez de decenas de
 * miles: es lo que hace que "Este año" no sea un problema de volumen. Es la
 * respuesta a la preocupación que CLAUDE.md ya dejó anotada para el panel de
 * horarios de /ventas.
 */
async function medianaDeVentas(
  prisma: PrismaDeTenant,
  donde: object,
  n: number,
): Promise<Decimal | null> {
  const indices = indicesDeMediana(n)
  if (!indices) return null
  const filas = await prisma.venta.findMany({
    where: donde,
    orderBy: { total: 'asc' },
    select: { total: true },
    ...indices,
  })
  if (filas.length === 0) return null
  // Con n par la mediana es el promedio de las dos del medio.
  const suma = filas.reduce((acc, f) => acc.add(f.total), new Prisma.Decimal(0))
  return redondearDinero(suma.div(filas.length))
}
```

- [ ] **Step 6: Verificar contra la base efímera**

Agregar a `test/ventas.test.ts` un caso que cobre dos ventas y anule una, y
afirme que `metricasDelPeriodo` no cuenta la anulada en ninguna de las cuatro
métricas.

Run: `npx vitest run test/ventas.test.ts lib/dashboard`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/dashboard/metricas.ts lib/dashboard/metricas.test.ts test/ventas.test.ts
git commit -m "feat(dashboard): las métricas de los cuatro tiles

El delta es null contra un período anterior en cero: no hay porcentaje de
crecimiento contra nada. El margen divide contra la mercadería CON costo, no
contra el total. Y la mediana trae una o dos filas, no el período entero."
```

---

### Task 8: Las catorce barras de "Ventas por día"

**Files:**
- Create: `lib/dashboard/tendencia.ts`
- Create: `lib/dashboard/tendencia.test.ts`

**Interfaces:**
- Consumes: `sumarDias`, `hoyEnArgentina` (Task 1); `MonedaElegida` (Task 3)
- Produces:
  - `DIAS_DE_TENDENCIA = 14`
  - `type BarraDeDia = { dia: string; etiqueta: string; monto: string; ventas: number; esMejor: boolean }`
  - `agregarPorDia(ventas: { creadoEn: Date; total: string; totalUsd: string }[], hoy: string, moneda: MonedaElegida): BarraDeDia[]`
  - `pieDeTendencia(barras: BarraDeDia[], moneda: MonedaElegida): string | null`
  - `ventasDeLaTendencia(prisma: PrismaDeTenant, hoy: string): Promise<…>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/dashboard/tendencia.test.ts
import { describe, it, expect } from 'vitest'
import { agregarPorDia, pieDeTendencia, DIAS_DE_TENDENCIA } from './tendencia'

const v = (iso: string, total: string, totalUsd = '0') => ({
  creadoEn: new Date(`${iso}T15:00:00-03:00`), total, totalUsd,
})

describe('la ventana es fija: catorce días, no el rango elegido', () => {
  it('devuelve siempre 14 barras, aunque no haya ninguna venta', () => {
    const b = agregarPorDia([], '2026-08-21', 'ars')
    expect(b).toHaveLength(DIAS_DE_TENDENCIA)
    expect(b[0].dia).toBe('2026-08-08')
    expect(b[13].dia).toBe('2026-08-21')
    expect(b.every((x) => x.monto === '0' && x.ventas === 0)).toBe(true)
  })

  it('un día sin ventas en el medio queda en cero, no se saltea', () => {
    const b = agregarPorDia([v('2026-08-08', '100'), v('2026-08-10', '300')], '2026-08-21', 'ars')
    expect(b[1].monto).toBe('0')
    expect(b[2].monto).toBe('300')
  })

  // El huso importa: una venta de las 23:00 del 19 en Buenos Aires ya es el 20
  // en UTC, y sin anclar caería en la barra equivocada.
  it('agrupa por el día de Buenos Aires, no por el de UTC', () => {
    const tarde = { creadoEn: new Date('2026-08-19T23:30:00-03:00'), total: '500', totalUsd: '0' }
    const b = agregarPorDia([tarde], '2026-08-21', 'ars')
    expect(b.find((x) => x.dia === '2026-08-19')?.monto).toBe('500')
  })

  it('una venta fuera de la ventana no entra', () => {
    const b = agregarPorDia([v('2026-08-01', '999')], '2026-08-21', 'ars')
    expect(b.every((x) => x.monto === '0')).toBe(true)
  })
})

describe('la moneda elegida decide qué columna se suma', () => {
  it('en pesos suma total y en dólares suma totalUsd', () => {
    const mixta = [v('2026-08-19', '1000', '300')]
    expect(agregarPorDia(mixta, '2026-08-21', 'ars')[11].monto).toBe('1000')
    expect(agregarPorDia(mixta, '2026-08-21', 'usd')[11].monto).toBe('300')
  })
})

describe('el mejor día', () => {
  it('marca uno solo, el de más plata', () => {
    const b = agregarPorDia(
      [v('2026-08-19', '512400'), v('2026-08-17', '300000')], '2026-08-21', 'ars',
    )
    expect(b.filter((x) => x.esMejor).map((x) => x.dia)).toEqual(['2026-08-19'])
  })

  // Sin esto, catorce barras en cero marcarían la primera como "mejor día" y
  // el pie afirmaría un récord de $ 0.
  it('con todo en cero no hay mejor día ni pie', () => {
    const b = agregarPorDia([], '2026-08-21', 'ars')
    expect(b.some((x) => x.esMejor)).toBe(false)
    expect(pieDeTendencia(b, 'ars')).toBeNull()
  })

  it('el empate lo gana el más reciente', () => {
    const b = agregarPorDia([v('2026-08-17', '100'), v('2026-08-19', '100')], '2026-08-21', 'ars')
    expect(b.filter((x) => x.esMejor).map((x) => x.dia)).toEqual(['2026-08-19'])
  })

  // No dice "del mes": la ventana son catorce días y afirmar el mes sería falso.
  it('el pie nombra el día, su plata y su cantidad de ventas', () => {
    const b = agregarPorDia(
      [v('2026-08-19', '300000'), v('2026-08-19', '212400')], '2026-08-21', 'ars',
    )
    expect(pieDeTendencia(b, 'ars'))
      .toBe('El miércoles 19 fue el mejor de los últimos 14 días: $ 512.400,00 en 2 ventas.')
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run lib/dashboard/tendencia.test.ts`
Expected: FAIL — `Failed to resolve import "./tendencia"`

- [ ] **Step 3: Implementar**

```ts
// lib/dashboard/tendencia.ts
import { Prisma } from '@/generated/prisma/client'
import { sumarDias, inicioDelDia } from '@/lib/formato/fechas'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import type { MonedaElegida } from '@/lib/ventas/medios'

/**
 * Catorce días, y la ventana es FIJA: no responde al chip de rango.
 *
 * El único texto de la maqueta sobre este panel es la nota "últimos 14 días"
 * (frame `Móvil / Dashboard`, nodo `ZDHsA`), y con el rango en `hoy` un panel
 * que siguiera al filtro sería UNA SOLA barra, que no es una tendencia. Hay
 * precedente: las seis barras de meses de "Cómo se movió" en
 * /inventario/[id] tampoco responden a ningún filtro.
 *
 * Está escrito acá para que el próximo ciclo no lo "arregle" atándolo al
 * rango.
 */
export const DIAS_DE_TENDENCIA = 14

export type BarraDeDia = {
  /** `YYYY-MM-DD`. */
  dia: string
  /** El número de día sin ceros a la izquierda: "8", "21". */
  etiqueta: string
  monto: string
  ventas: number
  esMejor: boolean
}

/**
 * El día de Buenos Aires de un instante — NUNCA `toISOString().slice(0,10)`,
 * que agrupa por UTC: una venta de las 23:30 del 19 caería en la barra del 20.
 */
function diaDe(fecha: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(fecha)
}

export function agregarPorDia(
  ventas: { creadoEn: Date; total: string; totalUsd: string }[],
  hoy: string,
  moneda: MonedaElegida,
): BarraDeDia[] {
  // Los catorce días SIEMPRE, con o sin ventas: un día vacío en el medio es
  // información, y saltearlo dejaría barras contiguas que mienten sobre la
  // continuidad del período.
  const dias: string[] = []
  for (let i = DIAS_DE_TENDENCIA - 1; i >= 0; i--) dias.push(sumarDias(hoy, -i))

  const acumulado = new Map(dias.map((d) => [d, { monto: new Prisma.Decimal(0), ventas: 0 }]))
  for (const v of ventas) {
    const casilla = acumulado.get(diaDe(v.creadoEn))
    // Una venta fuera de la ventana simplemente no entra.
    if (!casilla) continue
    casilla.monto = casilla.monto.add(moneda === 'usd' ? v.totalUsd : v.total)
    casilla.ventas += 1
  }

  // `>=` y no `>`, recorriendo del más viejo al más nuevo: es lo que hace que
  // un empate lo gane el día MÁS RECIENTE, que es el que sirve mirar.
  let mejor: string | null = null
  let maximo = new Prisma.Decimal(0)
  for (const dia of dias) {
    const m = acumulado.get(dia)!.monto
    // Estrictamente mayor que CERO: con todo en cero no hay mejor día, y sin
    // esta guarda la primera barra quedaría resaltada y el pie afirmaría un
    // récord de $ 0.
    if (m.greaterThan(0) && m.greaterThanOrEqualTo(maximo)) {
      maximo = m
      mejor = dia
    }
  }

  return dias.map((dia) => {
    const { monto, ventas: n } = acumulado.get(dia)!
    return {
      dia,
      etiqueta: String(Number(dia.slice(8, 10))),
      monto: monto.toString(),
      ventas: n,
      esMejor: dia === mejor,
    }
  })
}

/**
 * El pie del panel (nodo `TZqEL`).
 *
 * **No dice "del mes"**, aunque la maqueta de escritorio lo diga: la ventana
 * son catorce días, y afirmar el mes sobre catorce días es falso. Los dos
 * frames del `.pen` ya se contradicen entre sí acá (el móvil no lo dice), así
 * que la divergencia queda anotada en
 * docs/correcciones-pendientes-del-pen.md.
 */
export function pieDeTendencia(barras: BarraDeDia[], moneda: MonedaElegida): string | null {
  const mejor = barras.find((b) => b.esMejor)
  if (!mejor) return null
  const nombre = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(mejor.dia))
  const plata = moneda === 'usd' ? formatearDolares(mejor.monto) : formatearPrecio(mejor.monto)
  const ventas = mejor.ventas === 1 ? '1 venta' : `${mejor.ventas} ventas`
  return `El ${nombre} ${mejor.etiqueta} fue el mejor de los últimos ${DIAS_DE_TENDENCIA} días: ${plata} en ${ventas}.`
}
```

La consulta va en el mismo archivo, exportada:

```ts
/**
 * Las ventas de la ventana. Acotada por definición —catorce días—, así que no
 * tiene el techo abierto que CLAUDE.md dejó anotado para el panel de horarios.
 */
export function ventasDeLaTendencia(prisma: PrismaDeTenant, hoy: string) {
  return prisma.venta.findMany({
    where: {
      creadoEn: {
        gte: inicioDelDia(sumarDias(hoy, -(DIAS_DE_TENDENCIA - 1))),
        lt: inicioDelDia(sumarDias(hoy, 1)),
      },
      anuladaEn: null,
    },
    select: { creadoEn: true, total: true, totalUsd: true },
  })
}
```

- [ ] **Step 4: Correr y verlo pasar**

Run: `npx vitest run lib/dashboard/tendencia.test.ts`
Expected: PASS, 9 casos.

- [ ] **Step 5: Commit**

```bash
git add lib/dashboard/tendencia.ts lib/dashboard/tendencia.test.ts
git commit -m "feat(dashboard): las catorce barras de Ventas por día

Ventana FIJA, no el rango elegido: es lo único que dice la maqueta y con el
rango en Hoy un panel que siguiera al filtro sería una sola barra. Por eso el
pie dice \"de los últimos 14 días\" y no \"del mes\"."
```

---

### Task 9: Categorías y top de artículos, desde un solo `groupBy`

**Files:**
- Create: `lib/dashboard/composicion.ts`
- Create: `lib/dashboard/composicion.test.ts`

**Interfaces:**
- Consumes: `Periodo`, `filtroDe` (Task 2); `MonedaElegida` (Task 3);
  `Gajo` (Task 6)
- Produces:
  - `type FilaDeItems = { articuloId: string; precioUnitario: Decimal; moneda: 'ARS'|'USD'; _sum: { cantidad: Decimal | null } }`
  - `type VendidoPorArticulo = { articuloId: string; unidades: Decimal; importe: Decimal }`
  - `agruparPorArticulo(filas, moneda): VendidoPorArticulo[]`
  - `MAX_GAJOS = 5`, `ROTULO_OTROS = 'Otros'`, `SIN_CATEGORIA = 'Sin categoría'`
  - `TOP_DE_ARTICULOS = 5`
  - `repartirEnGajos(porCategoria: { rotulo: string; importe: Decimal }[]): { rotulo: string; importe: Decimal }[]`
  - `type FilaDeTop = { nombre: string; unidades: string; importe: string; ancho: number }`
  - `topDeArticulos(vendido: VendidoPorArticulo[], nombres: Map<string, string>): FilaDeTop[]`
    — los cinco primeros; `ancho` es el porcentaje del importe del primero
    (100 para el primero), redondeado a entero, y **0 si el primero es 0**
    para no dividir por cero
  - `itemsDelPeriodo(prisma: PrismaDeTenant, periodo: Periodo): Promise<FilaDeItems[]>`
  - `ramaPorArticulo(prisma: PrismaDeTenant, ids: string[]): Promise<Map<string, string>>`

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/dashboard/composicion.test.ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  agruparPorArticulo, repartirEnGajos, topDeArticulos, MAX_GAJOS, TOP_DE_ARTICULOS,
} from './composicion'

const d = (v: string) => new Prisma.Decimal(v)
const fila = (articuloId: string, precio: string, cantidad: string, moneda: 'ARS' | 'USD' = 'ARS') =>
  ({ articuloId, precioUnitario: d(precio), moneda, _sum: { cantidad: d(cantidad) } })

describe('el importe sale del precio en la CLAVE del groupBy', () => {
  // El precio va en la clave y no en un _sum por lo mismo que documenta
  // FilaDePagos: es lo que mantiene el redondeo por grupo y hace que la suma
  // cierre contra los tiles. Un artículo que cambió de precio a mitad de mes
  // llega en dos filas.
  it('suma las filas del mismo artículo a precios distintos', () => {
    const r = agruparPorArticulo(
      [fila('a', '1000', '3'), fila('a', '1200', '2')], 'ars',
    )
    expect(r).toEqual([{ articuloId: 'a', unidades: d('5'), importe: d('5400') }])
  })

  it('descarta lo que no está en la moneda elegida', () => {
    const r = agruparPorArticulo([fila('a', '1000', '1'), fila('b', '300', '1', 'USD')], 'ars')
    expect(r.map((x) => x.articuloId)).toEqual(['a'])
    expect(agruparPorArticulo([fila('a', '1000', '1'), fila('b', '300', '1', 'USD')], 'usd')
      .map((x) => x.articuloId)).toEqual(['b'])
  })

  // Prisma devuelve `_sum: { cantidad: null }` para un grupo vacío; sin la
  // guarda eso explota al construir el Decimal.
  it('un grupo sin cantidad no rompe', () => {
    const r = agruparPorArticulo([{ ...fila('a', '1000', '0'), _sum: { cantidad: null } }], 'ars')
    expect(r).toEqual([])
  })

  it('ordena de mayor a menor importe', () => {
    const r = agruparPorArticulo([fila('a', '100', '1'), fila('b', '900', '1')], 'ars')
    expect(r.map((x) => x.articuloId)).toEqual(['b', 'a'])
  })
})

describe('el anillo agrupa la cola en Otros', () => {
  const cat = (rotulo: string, importe: string) => ({ rotulo, importe: d(importe) })

  it('con más de cinco ramas, la quinta es la suma del resto', () => {
    const g = repartirEnGajos([
      cat('Celulares', '4400'), cat('Servicio técnico', '1900'), cat('Fundas', '1400'),
      cat('Cables', '1200'), cat('Vidrios', '700'), cat('Cargadores', '400'),
    ])
    expect(g).toHaveLength(MAX_GAJOS)
    expect(g[4]).toEqual({ rotulo: 'Otros', importe: d('1100') })
  })

  it('con cinco o menos, ninguna se agrupa', () => {
    const g = repartirEnGajos([cat('Celulares', '4400'), cat('Cables', '1200')])
    expect(g.map((x) => x.rotulo)).toEqual(['Celulares', 'Cables'])
  })

  // "Otros" existente y "Otros" agrupado son dos cosas distintas, y sumarlas
  // en un solo gajo sería mentir sobre una rama que el local nombró así.
  it('exactamente seis ramas dejan una sola en Otros', () => {
    const g = repartirEnGajos([
      cat('a', '6'), cat('b', '5'), cat('c', '4'), cat('d', '3'), cat('e', '2'), cat('f', '1'),
    ])
    expect(g[4]).toEqual({ rotulo: 'Otros', importe: d('3') })
  })

  it('sin nada vendido no hay gajos', () => {
    expect(repartirEnGajos([])).toEqual([])
  })
})

describe('el top de artículos', () => {
  const nombres = new Map([['a', 'iPhone 13 128 GB'], ['b', 'Cambio de módulo']])
  const vendido = [
    { articuloId: 'a', unidades: d('12'), importe: d('2964000') },
    { articuloId: 'b', unidades: d('31'), importe: d('1612000') },
  ]

  it('el ancho de cada barra es el porcentaje del PRIMERO, no del total', () => {
    const t = topDeArticulos(vendido, nombres)
    expect(t[0].ancho).toBe(100)
    expect(t[1].ancho).toBe(54) // 1.612.000 / 2.964.000
  })

  it('corta en cinco', () => {
    const muchos = 'abcdefg'.split('').map((k, i) => ({
      articuloId: k, unidades: d('1'), importe: d(String(100 - i)),
    }))
    expect(topDeArticulos(muchos, new Map())).toHaveLength(TOP_DE_ARTICULOS)
  })

  // Sin esta guarda el ancho sale NaN y React lo escribe crudo en el style.
  it('con el primero en cero ningún ancho divide por cero', () => {
    const t = topDeArticulos([{ articuloId: 'a', unidades: d('1'), importe: d('0') }], nombres)
    expect(t[0].ancho).toBe(0)
  })

  it('un artículo sin nombre conocido no rompe la fila', () => {
    expect(topDeArticulos(vendido, new Map())[0].nombre).toBe('—')
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run lib/dashboard/composicion.test.ts`
Expected: FAIL — `Failed to resolve import "./composicion"`

- [ ] **Step 3: Implementar**

Lo que el test no dice y el implementador necesita:

- `itemsDelPeriodo` es
  `prisma.ventaItem.groupBy({ by: ['articuloId', 'precioUnitario', 'moneda'], where: { venta: { ...filtroDe(periodo), anuladaEn: null } }, _sum: { cantidad: true } })`.
  **`anuladaEn: null` es la regla que este módulo existe para proteger**, y va
  en una función exportada por eso.
- El importe de cada grupo es `subtotalItem(cantidad, precioUnitario)` de
  `@/lib/ventas/totales` — **no** `cantidad.mul(precio)` a mano: el redondeo
  tiene que ocurrir en el mismo momento y de la misma forma que en el motor, o
  el panel y los tiles se separan por centavos en la misma pantalla.
- La rama de cada artículo se resuelve con
  `prisma.articulo.findMany({ where: { id: { in: … } }, select: { id: true, categoriaArbol: { select: { nombre: true, padre: { select: { nombre: true } } } } } })`.
  Un artículo colgado de una **hoja** suma a su **raíz** (`padre?.nombre ??
  nombre`), que es como el panel de `/inventario` ya cuenta; uno sin categoría
  cae en `SIN_CATEGORIA`.
- `SIN_CATEGORIA` es `'Sin categoría'` y **no** se pliega sobre `'Otros'`: son
  dos cosas distintas —una es una rama que el local no asignó, la otra es la
  cola de ramas chicas— y el dueño las resuelve distinto.

- [ ] **Step 4: Correr y verlo pasar**

Run: `npx vitest run lib/dashboard/composicion.test.ts`
Expected: PASS, 12 casos.

- [ ] **Step 5: Verificar la regla de la anulada contra la base efímera**

Agregar a `test/ventas.test.ts`: cobrar dos ventas del mismo artículo, anular
una, y afirmar que `itemsDelPeriodo` devuelve las unidades de una sola.

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/dashboard/composicion.ts lib/dashboard/composicion.test.ts test/ventas.test.ts
git commit -m "feat(dashboard): la composición por categoría y el top de artículos

Un solo groupBy con el precio EN LA CLAVE, por lo mismo que FilaDePagos: es lo
que mantiene el redondeo por grupo y hace que la suma cierre contra los tiles.
Y \"Sin categoría\" no se pliega sobre \"Otros\": son dos cosas distintas."
```

---

### Task 10: La pantalla — ruta, navegación, Topbar, rango y tiles

**Files:**
- Create: `app/(app)/dashboard/page.tsx`
- Create: `app/(app)/dashboard/page.test.tsx`
- Modify: `components/navegacion.tsx`, `components/navegacion.test.tsx`
- Modify: `docs/pantallas.md`
- Modify: `docs/correcciones-pendientes-del-pen.md`

**Interfaces:**
- Consumes: todo lo de las Tasks 1–9
- Produces: `Tile` (local a la pantalla), `ChipDeDelta`, `SegmentadoDeRango`

- [ ] **Step 1: La pestaña**

En `components/navegacion.tsx`, sumar a `PESTANAS` en **tercera** posición
—entre `/ventas` e `/inventario`, que es donde la pone `Shell/Sidebar`— con el
ícono `LayoutDashboard` de lucide. **Sin `permiso` ni `soloDueno`**: la ve
cualquier sesión, igual que `/ventas`.

Agregar el comentario:

```ts
  // Tercera, entre Ventas e Inventario: es donde la pone el frame
  // Shell/Sidebar. El ítem de /bot NO se mueve ni se saca aunque la maqueta no
  // lo dibuje — ese frame es anterior al ciclo del bot, y el silencio de un
  // frame no es una instrucción de borrar.
```

- [ ] **Step 2: Escribir el test de render que falla**

```tsx
// app/(app)/dashboard/page.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Tile, ChipDeDelta, SegmentadoDeRango } from './page'

describe('el tile de marca', () => {
  it('en pesos: el número grande y el dólar al pie', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="TOTAL DEL PERÍODO" valor="$ 8.412.900"
        pie="US$ 4.120 aparte" delta={{ porcentaje: 18.4, sube: true }} marca />,
    )
    expect(html).toContain('$ 8.412.900')
    expect(html).toContain('US$ 4.120 aparte')
    expect(html).toContain('+18,4%')
  })

  // Sin esta regla, un local que carga y cobra TODO su catálogo en dólares
  // —el único que hoy usa esa feature— abriría el dashboard con "$ 0,00" de
  // titular.
  it('sin pesos cobrados, el número grande es el dólar y no hay pie', () => {
    const html = renderToStaticMarkup(
      <Tile rotulo="TOTAL DEL PERÍODO" valor="US$ 4.120" marca />,
    )
    expect(html).toContain('US$ 4.120')
    expect(html).not.toContain('$ 0,00')
  })
})

describe('el chip de delta', () => {
  it('el signo decide el ícono y el color', () => {
    expect(renderToStaticMarkup(<ChipDeDelta delta={{ porcentaje: 9.1, sube: true }} />))
      .toContain('+9,1%')
    expect(renderToStaticMarkup(<ChipDeDelta delta={{ porcentaje: -2.3, sube: false }} />))
      // Menos tipográfico (U+2212), no guion: es lo que dibuja la maqueta.
      .toContain('−2,3%')
  })

  it('sin delta no dibuja nada', () => {
    expect(renderToStaticMarkup(<ChipDeDelta delta={null} />)).toBe('')
  })
})

describe('el segmentado de rango', () => {
  it('marca el activo y linkea los otros tres', () => {
    const html = renderToStaticMarkup(
      <SegmentadoDeRango activo="estemes" href={(r) => `/dashboard?rango=${r}`} />,
    )
    expect(html).toContain('Este año')
    expect(html).toContain('aria-current="page"')
    // El activo no se linkea a sí mismo con el parámetro puesto de más.
    expect(html).toContain('/dashboard?rango=hoy')
  })
})
```

- [ ] **Step 3: Correr y verlo fallar**

Run: `npx vitest run "app/(app)/dashboard"`
Expected: FAIL — `Failed to resolve import "./page"`

- [ ] **Step 4: Escribir la pantalla**

`export const dynamic = 'force-dynamic'`, `exigirSesion()`,
`prismaParaTenant(tenantId)`. `puedeConSesion(sesion, 'COSTOS')` decide si el
cuarto tile existe.

Geometría, contra `A2Hffo` (escritorio) y `OWGzI` (teléfono):

- Cuerpo: `flex flex-col gap-3 p-[14px] lg:gap-4 lg:p-6`.
- Fila de rango: en el teléfono es sólo el segmentado a ancho completo
  (`AP9E6`: los cuatro chips en `flex-1`); en escritorio suma el texto del
  período, un espaciador y el chip de comparación
  (`hidden lg:flex`, `gap-[10px]`).
- Segmentado: contenedor `rounded-[10px] bg-muted p-[3px] gap-0.5`; cada chip
  `rounded-lg px-[13px] py-[7px] text-xs font-medium`, el activo con
  `bg-card font-semibold text-foreground`.
- Tiles: en el teléfono el de marca va solo y los otros en fila
  (`grid grid-cols-2 gap-3`), en escritorio los cuatro en fila
  (`lg:flex lg:h-[116px] lg:gap-4`). El de marca:
  `rounded-2xl px-[16px] py-[15px]` con `backgroundColor: 'var(--marca)'`;
  rótulo `text-[10px] font-bold tracking-[1.2px] uppercase` sobre
  `var(--marca-soft)`; valor `text-[29px] lg:text-[30px] font-semibold
  tracking-[-0.6px] tabular-nums` en Archivo sobre `var(--marca-foreground)`;
  pie `text-[11px]` sobre `var(--marca-dim)`.
- Chip de delta: `rounded-full px-[7px] py-[2px] gap-[3px] text-[11px]
  font-semibold`, ícono 11×11. Sobre el paño de marca:
  `backgroundColor: '#FFFFFF1F'` y color `var(--marca-ok)` si sube,
  `var(--marca-foreground)` si baja. Fuera del paño: `bg-ok-soft text-ok` /
  `bg-destructive-soft text-destructive`.

**El tile de marca invierte** cuando lo cobrado en pesos es cero y hubo
dólares: el valor grande pasa a ser el dólar y el pie se omite.

**El `<h1>` lo pone `Encabezado`**, con `titulo="Dashboard"` y el subtítulo
`"Agosto 2026 · 312 ventas cobradas"` derivado del período y del conteo. En el
teléfono, `accionMovil` es el link de descarga del CSV con ícono `download` y
`tono: 'suave'`. En escritorio, `acciones` son los dos botones (Exportar CSV
outline + Vender primary con `shopping-cart`, a `/vender`).

- [ ] **Step 5: Correr y verlo pasar**

Run: `npx vitest run "app/(app)/dashboard" components/navegacion.test.tsx`
Expected: PASS.

- [ ] **Step 6: Documentar la pantalla**

`test/pantallas.test.ts` ata `docs/pantallas.md` a `app/**/page.tsx` **en las
dos direcciones**: sin la sección, el build rompe. Escribir `## /dashboard`
siguiendo la forma de las demás (descripción, **Acciones**, **Qué se puede
hacer**, **Decisiones**), con al menos: la ventana fija de catorce días, el
selector de moneda, el tramo homólogo, el tile que se invierte, y el margen
detrás de `COSTOS`.

En `docs/correcciones-pendientes-del-pen.md`, agregar las entradas: el
selector de moneda (UI que el `.pen` no dibuja), el chip de delta a la baja
sobre el paño de marca (sin frame), el pie de tendencia que deja de decir "del
mes", y que el `.pen` versionado no tiene todavía estos dos frames.

- [ ] **Step 7: Correr el gate entero**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/dashboard" components/navegacion.tsx components/navegacion.test.tsx docs/
git commit -m "feat(dashboard): la pantalla, el rango y los cuatro tiles"
```

---

### Task 11: Los cuatro paneles en la pantalla

**Files:**
- Create: `app/(app)/dashboard/paneles.tsx`
- Create: `app/(app)/dashboard/paneles.test.tsx`
- Modify: `app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `Anillo`, `COLORES_DEL_ANILLO` (Task 6); `agregarPorDia`,
  `pieDeTendencia` (Task 8); `agruparPorArticulo`, `repartirEnGajos` (Task 9);
  `componerPorMedio` (Task 3)
- Produces: `VentasPorDia`, `AnilloDeMedios`, `VentasPorCategoria`,
  `TopDeArticulos`, `SelectorDeMoneda`

- [ ] **Step 1: Escribir el test que falla**

```tsx
// app/(app)/dashboard/paneles.test.tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { VentasPorDia, SelectorDeMoneda, TopDeArticulos } from './paneles'

describe('el selector de moneda', () => {
  // La regla del producto: un local que no usa dólares no ve NINGUNA
  // diferencia con lo que ya conoce.
  it('no se dibuja si el período tuvo una sola moneda', () => {
    expect(renderToStaticMarkup(
      <SelectorDeMoneda hayDolares={false} moneda="ars" href={(m) => `?moneda=${m}`} />,
    )).toBe('')
  })

  it('con las dos monedas ofrece las dos', () => {
    const html = renderToStaticMarkup(
      <SelectorDeMoneda hayDolares moneda="ars" href={(m) => `?moneda=${m}`} />,
    )
    expect(html).toContain('US$')
    expect(html).toContain('?moneda=usd')
  })
})

describe('ventas por día', () => {
  const barras = [
    { dia: '2026-08-19', etiqueta: '19', monto: '512400', ventas: 23, esMejor: true },
    { dia: '2026-08-20', etiqueta: '20', monto: '256200', ventas: 11, esMejor: false },
  ]

  it('la barra más alta es la del mejor día', () => {
    const html = renderToStaticMarkup(
      <VentasPorDia barras={barras} pie="El miércoles 19 fue el mejor…" moneda="ars" />,
    )
    expect(html).toContain('height:100%')
    expect(html).toContain('height:50%')
  })

  it('dice cuántos días muestra, para que nadie lo lea como el período', () => {
    const html = renderToStaticMarkup(<VentasPorDia barras={barras} pie={null} moneda="ars" />)
    expect(html).toContain('últimos 14 días')
  })

  // Sin ventas, dividir por el máximo sería dividir por cero.
  it('con todo en cero no explota ni dibuja barras llenas', () => {
    const vacias = barras.map((b) => ({ ...b, monto: '0', ventas: 0, esMejor: false }))
    const html = renderToStaticMarkup(<VentasPorDia barras={vacias} pie={null} moneda="ars" />)
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('height:100%')
  })
})

describe('lo que más se vendió', () => {
  it('la barra de cada fila es proporcional al primero', () => {
    const html = renderToStaticMarkup(
      <TopDeArticulos filas={[
        { nombre: 'iPhone 13 128 GB', unidades: '12', importe: '2964000', ancho: 100 },
        { nombre: 'Cambio de módulo', unidades: '31', importe: '1612000', ancho: 54 },
      ]} moneda="ars" />,
    )
    expect(html).toContain('width:100%')
    expect(html).toContain('width:54%')
    expect(html).toContain('12 u.')
  })

  it('sin ventas muestra un vacío, no una tabla vacía', () => {
    expect(renderToStaticMarkup(<TopDeArticulos filas={[]} moneda="ars" />))
      .toContain('Todavía no se vendió nada')
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run "app/(app)/dashboard/paneles.test.tsx"`
Expected: FAIL — `Failed to resolve import "./paneles"`

- [ ] **Step 3: Implementar los cuatro paneles**

Geometría contra `Y1sSh` y `Db1MT` (escritorio) y sus equivalentes móviles:

- Card: `rounded-2xl border bg-card overflow-hidden`; encabezado
  `flex items-center justify-between border-b px-[14px] py-[12px] lg:px-[18px] lg:py-[13px]`
  con el título en `.tituloDeCard` (reusar
  `app/(app)/ventas/tipografia.module.css`: **no** escribir
  `fontFamily: 'var(--font-archivo)'` a mano, que evade
  `test/tipografia.test.ts`).
- **Ventas por día**: `flex h-[165px] items-end gap-1 lg:h-[190px] lg:gap-[7px]`;
  cada día es `flex flex-1 flex-col items-center gap-[7px] lg:gap-2` con la
  barra `w-full rounded-t-[5px] lg:rounded-t-md` y `height` en porcentaje del
  máximo. El mejor día paga `bg-primary` y su etiqueta `font-semibold
  text-foreground-soft`; el resto `bg-accent` y `text-muted-foreground`.
- **Cómo entró la plata**: `Anillo` de 132 (148 en el teléfono) más leyenda
  vertical; en escritorio el panel es `lg:w-[344px] lg:shrink-0`.
- **Ventas por categoría**: `Anillo` de 128 (140 en el teléfono),
  `lg:w-[400px] lg:shrink-0`; el centro muestra el gajo más grande.
- **Lo que más se vendió**: `lg:flex-1`; cada fila con puesto, nombre, barra
  (`h-[10px] rounded-full bg-muted` con el relleno `bg-primary` en el primero
  y `bg-marca-soft` en el resto), unidades e importe. En el teléfono la fila se
  parte en dos líneas (`RPi9a` + `BO12U`), en escritorio es una sola.
- Las dos filas de paneles: `flex flex-col gap-3 lg:flex-row lg:gap-4`.

- [ ] **Step 4: Correr y verlo pasar**

Run: `npx vitest run "app/(app)/dashboard"`
Expected: PASS.

- [ ] **Step 5: Enchufarlos en la página**

Las consultas van en un solo `Promise.all` junto a las de los tiles.
`hrefDeMoneda` preserva `?rango`, y **no escribe `moneda=ars`** cuando es el
default — mismo criterio que `hrefRango` en `/ventas`.

- [ ] **Step 6: El gate entero, incluido el responsive**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. `test/responsive.test.ts` marca cualquier `w-[Npx]` mayor a
362 sin prefijo `lg:` — los `344px` y `400px` de los paneles tienen que ir
prefijados.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/dashboard"
git commit -m "feat(dashboard): los cuatro paneles y el selector de moneda"
```

---

### Task 12: Exportar CSV

**Files:**
- Create: `app/(app)/dashboard/acciones.ts`
- Create: `app/(app)/dashboard/acciones.test.ts`
- Create: `app/(app)/dashboard/exportar.tsx`
- Modify: `app/(app)/dashboard/page.tsx`

**Interfaces:**
- Produces: `exportarVentas(rango: string): Promise<string>` (server action),
  `BotonDeExportar({ rango, className, children })` (cliente)

- [ ] **Step 1: Escribir el test que falla**

```ts
// app/(app)/dashboard/acciones.test.ts
import { describe, it, expect } from 'vitest'
import { filaCsv, ENCABEZADO_CSV } from './acciones'

describe('el CSV escapa por RFC 4180', () => {
  it('encomilla lo que lleva coma, comilla o salto de línea', () => {
    expect(filaCsv(['1042', 'Pérez, Ana', 'dijo "hola"'])).toBe(
      '1042,"Pérez, Ana","dijo ""hola"""',
    )
  })

  it('deja pasar lo que no necesita comillas', () => {
    expect(filaCsv(['1042', 'Efectivo'])).toBe('1042,Efectivo')
  })

  it('el encabezado nombra las dos monedas por separado', () => {
    expect(ENCABEZADO_CSV).toContain('Vendido ARS')
    expect(ENCABEZADO_CSV).toContain('Vendido USD')
    expect(ENCABEZADO_CSV).toContain('Cobrado ARS')
    expect(ENCABEZADO_CSV).toContain('Cobrado USD')
    // No lleva costo ni margen aunque quien lo baje tenga COSTOS: un CSV sale
    // del sistema y sigue circulando.
    expect(ENCABEZADO_CSV).not.toContain('Costo')
    expect(ENCABEZADO_CSV).not.toContain('Margen')
  })
})
```

- [ ] **Step 2: Correr y verlo fallar**

Run: `npx vitest run "app/(app)/dashboard/acciones.test.ts"`
Expected: FAIL — `Failed to resolve import "./acciones"`

- [ ] **Step 3: Implementar la acción**

`'use server'` arriba, `exigirSesion()` adentro —una action es un endpoint y
se invoca sin pasar por la pantalla—, y **sin** exigir permiso: son datos de
sólo lectura que la pantalla ya muestra a cualquier sesión. `rango` pasa por
`rangoValido()`, así que un valor tipeado a mano cae al default en vez de
explotar.

Trae las ventas del período con sus pagos, arma el string entero en memoria y
lo devuelve. Copiar el patrón de `app/(app)/inventario/acciones.ts` (BOM
`﻿`, `\r\n` entre filas).

- [ ] **Step 4: El botón cliente**

`'use client'`, llama a la action, recibe el string y lo baja con un `Blob` —
un server action no puede fijar `Content-Disposition`. Copiar el patrón de
`app/(app)/inventario/formularios.tsx:697`, incluido el estado "Exportando…".

**Va en las DOS copias**: el botón del Topbar de escritorio y la ranura de
38 px del teléfono. Agregar a `page.test.tsx` el caso que cuenta las dos
apariciones — un solo `toContain` pasaría igual con una sola.

- [ ] **Step 5: Correr y verlo pasar**

Run: `npx vitest run "app/(app)/dashboard"`
Expected: PASS.

- [ ] **Step 6: El gate entero**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 7: Actualizar `docs/pantallas.md`**

Sumar `exportarVentas` a la línea **Acciones** de la sección `/dashboard` y la
decisión de por qué el CSV no lleva costo.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/dashboard" docs/pantallas.md
git commit -m "feat(dashboard): exportar las ventas del período a CSV

Sin costo ni margen aunque quien lo baje tenga COSTOS: un CSV sale del sistema
y sigue circulando."
```

---

## Verificación final del ciclo

- [ ] `npm test` en verde (incluye `scripts/tests/correr-todos.sh`).
- [ ] `npx tsc --noEmit` y `npm run lint` en verde.
- [ ] `scripts/verify-infra.sh env` sin diferencias.
- [ ] **A ojo, que es lo que ningún test contesta**: `/dashboard` a 1440 y a
      390 px, con el catálogo sembrado y ventas en las dos monedas. Mirar que
      los cuatro tiles no queden apretados en el teléfono, que el anillo se
      lea, que el selector de moneda **no** aparezca en un local sin dólares, y
      que un empleado sin `COSTOS` no vea el tile de margen.
- [ ] **Guardar `design/arandano.pen` desde Pencil y commitearlo.** Lo hace una
      persona: el MCP lee el documento pero no lo persiste. Sin esto, el `.pen`
      del repo sigue siendo el commit `87973d4` del 2026-08-21 y el próximo
      ciclo no ve este diseño.
