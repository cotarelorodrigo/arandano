# Corte por contenedor en `/vender` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/vender` decida si muestra las dos columnas por el ancho que tiene su propio cuerpo y no por el del monitor, para que el panel de cobro aparezca a ~960 px de ventana en vez de esconderse.

**Architecture:** El cuerpo de la pantalla se envuelve en un contenedor con nombre (`@container/venta`) y las noventa clases `lg:` del archivo pasan a variantes de contenedor (`@cobro/venta:`), cuyo umbral vive una sola vez como `--container-cobro` en `app/globals.css`. El único lector JavaScript del corte (`useIsMobile()`, que gobierna cuatro props del Topbar) pasa a un `ResizeObserver` sobre ese mismo envoltorio, contra la misma constante. El sidebar y el Topbar siguen mirando el viewport en 1024, porque contestan otra pregunta.

**Tech Stack:** Next.js (App Router), React, TypeScript, Tailwind CSS v4.3.3 (container queries nativos), vitest en `environment: 'node'` (sin jsdom).

**Spec:** `docs/superpowers/specs/2026-09-07-corte-por-contenedor-en-vender-design.md`

## Global Constraints

- **El umbral es 850 px** y se escribe **una sola vez**, como `--container-cobro` en el bloque `@theme inline` de `app/globals.css`. Ninguna clase puede usar `@min-[850px]` literal.
- **El contenedor se llama `venta`** y las variantes le apuntan por nombre (`@cobro/venta:`, `@max-cobro/venta:`). Nunca sin nombre: `components/ui/card.tsx:28` ya establece `@container/card-header`, y una consulta sin nombre resolvería contra el contenedor más cercano.
- **Mobile-first**, igual que hoy: el valor angosto va sin prefijo y el ancho con `@cobro/venta:`. Prohibido `@max-cobro/venta:` salvo donde hoy hay una clase sin prefijo que haya que apagar en ancho — no existe ninguna en este archivo.
- **No se toca** `components/shell/encabezado.tsx`, `hooks/use-mobile.ts` (más allá de su comentario, Task 5), `app/(app)/vender/caja.tsx`, `components/ui/sidebar.tsx`, ni ninguna de las otras nueve pantallas.
- **`components/shell/encabezado.test.tsx:199`** —que afirma `MOBILE_BREAKPOINT === 1024`— tiene que seguir en verde sin tocarse. Es la evidencia de que la pregunta del viewport no se movió.
- **Sin migración, sin columna nueva y sin permiso nuevo.** `lib/permisos/catalogo.ts` no crece.
- El gate local de cada task es `npx vitest run <archivo>`; antes de cada commit corre además `npx tsc --noEmit` y `npm run lint`.

Sintaxis verificada contra Tailwind 4.3.3 real antes de escribir este plan:

| clase | CSS que emite |
|---|---|
| `@container/venta` | `container-type: inline-size; container-name: venta` |
| `@cobro/venta:flex-row` | `@container venta (width >= 850px) { flex-direction: row }` |
| `@max-cobro/venta:hidden` | `@container venta (width < 850px) { display: none }` |
| `@cobro/venta:group-hover:bg-x` | anida bien dentro de `@media (hover: hover)` |
| `@cobro/venta:contents` y `@cobro/venta:grid-cols-[…]` | emiten normalmente |

`--container-cobro` declarada en `@theme inline` **no se emite como custom property** (eso es lo que significa `inline`), así que JavaScript no puede leerla en runtime. Por eso la constante de TypeScript existe y se ata al CSS por test, en vez de leerse del DOM.

---

### Task 1: El umbral, declarado una vez y atado en las dos direcciones

**Files:**
- Create: `hooks/use-dos-columnas.ts`
- Modify: `app/globals.css` (bloque `@theme inline`)
- Test: `hooks/use-dos-columnas.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `ANCHO_MINIMO_DOS_COLUMNAS: number` (= `850`)
  - `NOMBRE_DEL_CONTENEDOR: string` (= `'venta'`)
  - `hayLugarParaDosColumnas(ancho: number): boolean`

- [ ] **Step 1: Escribir el test que falla**

Crear `hooks/use-dos-columnas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  ANCHO_MINIMO_DOS_COLUMNAS,
  NOMBRE_DEL_CONTENEDOR,
  hayLugarParaDosColumnas,
} from '@/hooks/use-dos-columnas'

const GLOBALS = readFileSync('app/globals.css', 'utf8')

describe('el umbral de las dos columnas', () => {
  // 48 del p-6 + 392 (el mínimo del carrito que declara hooks/use-mobile.ts)
  // + 18 del gap + 384 del panel = 842, redondeado a 850. Ver el spec, §4.
  it('vale 850 y la cuenta de la que sale está escrita', () => {
    expect(ANCHO_MINIMO_DOS_COLUMNAS).toBe(850)
  })

  it('el ancho justo alcanza, y uno menos no', () => {
    expect(hayLugarParaDosColumnas(850)).toBe(true)
    expect(hayLugarParaDosColumnas(849)).toBe(false)
    expect(hayLugarParaDosColumnas(960)).toBe(true)
    expect(hayLugarParaDosColumnas(0)).toBe(false)
  })

  // EN LAS DOS DIRECCIONES, y es el punto del caso: el número vive en dos
  // lenguajes —TypeScript lo usa para medir, el CSS para consultar— y no hay
  // forma de que uno lea al otro en runtime, porque `@theme inline` no emite
  // la variable como custom property. Sin este caso, mover uno y olvidarse
  // del otro deja la pantalla con el JavaScript decidiendo en un ancho y el
  // CSS en otro, sin que nada falle.
  it('el CSS declara exactamente el mismo número', () => {
    const declarada = GLOBALS.match(/--container-cobro:\s*(\d+)px\s*;/)
    expect(declarada, 'falta --container-cobro en app/globals.css').toBeTruthy()
    expect(Number(declarada![1])).toBe(ANCHO_MINIMO_DOS_COLUMNAS)
  })

  it('la variable vive adentro del bloque @theme, o Tailwind no genera la variante', () => {
    const tema = GLOBALS.slice(GLOBALS.indexOf('@theme inline'))
    expect(tema.slice(0, tema.indexOf('\n}'))).toContain('--container-cobro')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run hooks/use-dos-columnas.test.ts`
Expected: FAIL — `Cannot find module '@/hooks/use-dos-columnas'`.

- [ ] **Step 3: Crear el módulo**

Crear `hooks/use-dos-columnas.ts` (por ahora sólo la parte pura; el hook llega en la Task 2):

```ts
/**
 * ¿Entran las dos columnas de `/vender` —el carrito y el panel de cobro— en el
 * ancho que tiene el cuerpo de la pantalla?
 *
 * ES OTRA PREGUNTA QUE LA DE `hooks/use-mobile.ts`, y por eso es otro módulo.
 * Aquélla contesta "¿el sidebar es un panel flotante?", que es del VIEWPORT y
 * corta en 1024. Ésta contesta "¿hay lugar para dos columnas?", que es del
 * CONTENEDOR — y el viewport no la puede contestar, porque el sidebar parte la
 * relación entre uno y otro en dos regímenes: abajo de 1024 es un `Sheet` y no
 * ocupa nada, a partir de 1024 son 248 px de flujo. Un píxel más de ventana le
 * saca 267 px al cuerpo. Ver
 * docs/superpowers/specs/2026-09-07-corte-por-contenedor-en-vender-design.md.
 */

/**
 * 48 del `p-6` del cuerpo + 392 (el mínimo del carrito que declara
 * `hooks/use-mobile.ts`) + 18 del `gap` de la fila + 384 del panel de cobro =
 * 842, redondeado a 850.
 *
 * **El mismo número está en `app/globals.css` como `--container-cobro`**, que
 * es lo que consulta el CSS. No se puede leer de ahí en runtime: está en
 * `@theme inline`, y `inline` significa justamente que el valor se mete en las
 * utilidades en vez de emitirse como custom property. `hooks/use-dos-columnas.test.ts`
 * ata los dos en las dos direcciones.
 */
export const ANCHO_MINIMO_DOS_COLUMNAS = 850

/**
 * El nombre del contenedor, que las variantes usan (`@cobro/venta:`).
 *
 * CON NOMBRE Y NO SIN ÉL: una consulta sin nombre resuelve contra el
 * contenedor más cercano, y `components/ui/card.tsx:28` ya establece uno
 * (`@container/card-header`). `/vender` no usa `CardHeader` hoy, pero el día
 * que lo use, un `@cobro:` adentro pasaría a preguntar por el ancho de un
 * encabezado de card — en silencio, sin ningún error.
 */
export const NOMBRE_DEL_CONTENEDOR = 'venta'

/** Con el ancho justo alcanza: es `>=`, igual que la variante de Tailwind. */
export function hayLugarParaDosColumnas(ancho: number): boolean {
  return ancho >= ANCHO_MINIMO_DOS_COLUMNAS
}
```

- [ ] **Step 4: Declarar la variable en el CSS**

En `app/globals.css`, dentro del bloque `@theme inline` que ya existe, agregar antes de los `--color-*`:

```css
  /* El umbral de las dos columnas de /vender, que consultan las variantes
     `@cobro/venta:` de app/(app)/vender/punto-de-venta.tsx. El mismo número
     está en hooks/use-dos-columnas.ts, que es el que mide del lado de
     JavaScript; use-dos-columnas.test.ts los ata en las dos direcciones.
     Acá y no como valor arbitrario en cada clase: son noventa clases, y un
     número escrito noventa veces es un número que se desincroniza. */
  --container-cobro: 850px;
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run hooks/use-dos-columnas.test.ts`
Expected: PASS, 4 casos.

- [ ] **Step 6: Verificar que no se rompió nada del sistema de diseño**

Run: `npx vitest run test/sistema-de-diseno.test.ts test/maqueta.test.ts`
Expected: PASS. `scripts/tokens.mts` lee el bloque `:root`, no `@theme`, así que una variable nueva acá no le corresponde a esos casos. Si alguno falla, es señal de que el parser sí mira `@theme` y hay que documentar la variable donde ese test lo pida — no de que la variable esté mal.

- [ ] **Step 7: Commit**

```bash
git add hooks/use-dos-columnas.ts hooks/use-dos-columnas.test.ts app/globals.css
git commit -m "feat(vender): el umbral de las dos columnas, en un solo lugar"
```

---

### Task 2: El hook que mide el contenedor

**Files:**
- Modify: `hooks/use-dos-columnas.ts`
- Test: `hooks/use-dos-columnas.test.ts`

**Interfaces:**
- Consumes: `ANCHO_MINIMO_DOS_COLUMNAS`, `hayLugarParaDosColumnas` (Task 1).
- Produces: `useDosColumnas(ref: React.RefObject<HTMLElement | null>): boolean`

**Por qué el hook no se renderiza en ningún test:** `vitest.config.mts` corre con `environment: 'node'`, sin jsdom — una decisión escrita del repo (el ciclo de `/ventas` sacó la única excepción que había). Así que la parte que se puede probar de verdad es la función pura, y el cableado del observador se afirma por FUENTE, que es el mismo patrón que este archivo de tests ya usa para otras cosas. La verificación real del observador es manual (ver el spec, *Verificación*).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `hooks/use-dos-columnas.test.ts`:

```ts
const HOOK = readFileSync('hooks/use-dos-columnas.ts', 'utf8')

describe('el hook que mide el contenedor', () => {
  it('mide con ResizeObserver y no con el viewport', () => {
    expect(HOOK).toContain('ResizeObserver')
    expect(
      HOOK,
      'medir el viewport es exactamente lo que este hook existe para no hacer',
    ).not.toMatch(/matchMedia|innerWidth/)
  })

  // Una sola definición del corte: el hook tiene que preguntarle a la función
  // pura, no repetir la comparación. Con la comparación escrita dos veces,
  // mover el `>=` a `>` en un lado deja el otro decidiendo distinto.
  it('el hook decide con hayLugarParaDosColumnas y no con su propia comparación', () => {
    const cuerpo = HOOK.slice(HOOK.indexOf('export function useDosColumnas'))
    expect(cuerpo).toContain('hayLugarParaDosColumnas')
    expect(cuerpo).not.toContain('ANCHO_MINIMO_DOS_COLUMNAS')
  })

  // El servidor no tiene ancho que medir. Arranca en "hay lugar" —o sea el
  // layout ancho— que es EXACTAMENTE lo que hoy devuelve el
  // `getServerSnapshot()` de useIsMobile (`false`, "no es mobile"). Es paridad
  // con el comportamiento actual, no una decisión nueva.
  it('sin medición todavía asume que hay lugar, igual que useIsMobile hoy', () => {
    expect(HOOK).toMatch(/useState\(true\)/)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run hooks/use-dos-columnas.test.ts`
Expected: FAIL — `expect(HOOK).toContain('ResizeObserver')` no encuentra nada.

- [ ] **Step 3: Escribir el hook**

Agregar al final de `hooks/use-dos-columnas.ts`, y poner `'use client'` en la primera línea del archivo:

```ts
/**
 * Verdadero mientras el elemento referenciado tenga lugar para las dos
 * columnas. Es la mitad JavaScript de la misma decisión que el CSS toma con
 * `@cobro/venta:`, contra el mismo número.
 *
 * POR QUÉ HACE FALTA UNA MITAD JAVASCRIPT. Casi todo lo resuelve el CSS solo,
 * y es mejor así. Lo que no puede son las cuatro props del `<Encabezado>` que
 * dependen del paso —el título ("Vender" / "Cobro"), el subtítulo con el
 * total, la flecha de volver y `controlMovil`—: son props, no clases, así que
 * ahí hay que preguntar. Si esta pregunta se la hiciéramos al viewport
 * mientras el CSS le pregunta al contenedor, los dos se desincronizarían justo
 * en la banda que este ciclo arregla.
 *
 * `useState(true)` y no `false`: el servidor no tiene ancho que medir, y
 * arrancar en el layout ancho es lo mismo que ya hace hoy el
 * `getServerSnapshot()` de `useIsMobile`. La primera medición real llega en el
 * layout effect, antes de que el navegador pinte.
 */
export function useDosColumnas(ref: React.RefObject<HTMLElement | null>): boolean {
  const [hayLugar, setHayLugar] = React.useState(true)

  React.useLayoutEffect(() => {
    const elemento = ref.current
    if (!elemento) return
    const observador = new ResizeObserver(([entrada]) => {
      // `contentBoxSize` y no `contentRect`: es el ancho sin padding ni borde,
      // que es contra lo que compara un container query. El envoltorio no
      // lleva padding (ver el spec, §6), así que hoy dan lo mismo — pero si
      // alguien le pusiera uno, `contentRect` empezaría a mentir en silencio.
      const ancho = entrada.contentBoxSize?.[0]?.inlineSize ?? entrada.contentRect.width
      setHayLugar(hayLugarParaDosColumnas(ancho))
    })
    observador.observe(elemento)
    return () => observador.disconnect()
  }, [ref])

  return hayLugar
}
```

Agregar el import de React arriba del archivo: `import * as React from 'react'`.

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run hooks/use-dos-columnas.test.ts`
Expected: PASS, 7 casos.

- [ ] **Step 5: Verificar que el módulo cliente no arrastra nada al bundle**

Run: `npx vitest run test/limite-cliente-servidor.test.ts test/servidor-llama-a-cliente.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hooks/use-dos-columnas.ts hooks/use-dos-columnas.test.ts
git commit -m "feat(vender): el hook que mide el contenedor, contra el mismo umbral"
```

---

### Task 3: El envoltorio, la fila y las dos cards — CSS y JavaScript juntos

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx` (líneas 1006, 1013, 1704, 1801, 1818, 2325-2326)
- Test: `app/(app)/vender/punto-de-venta.test.tsx` (bloque desde la línea 2019)

**Interfaces:**
- Consumes: `useDosColumnas` (Task 2) en el componente; `NOMBRE_DEL_CONTENEDOR` (Task 1) **sólo en el test** — el `.tsx` escribe la clase literal, porque una clase armada por interpolación no la vería el escáner de Tailwind.
- Produces: el envoltorio `@container/venta` con su `ref`, del que cuelga todo lo de la Task 4.

Agregar al principio del archivo de tests el import que los casos nuevos usan:

```ts
import { NOMBRE_DEL_CONTENEDOR } from '@/hooks/use-dos-columnas'
```

**Las dos mitades van en la misma task a propósito**: son la misma decisión. Separarlas dejaría un commit donde el CSS mira el contenedor y el Topbar mira el viewport, que es el defecto que este ciclo existe para evitar.

- [ ] **Step 1: Reescribir los casos que afirman el corte viejo**

En `app/(app)/vender/punto-de-venta.test.tsx`, reemplazar el comentario de la línea 2019 y los tres casos que afirman `lg:`:

```ts
// Un solo árbol de marcado, mobile-first, con un único corte —pero por
// CONTENEDOR y no por viewport: `@cobro/venta:`, umbral en
// hooks/use-dos-columnas.ts y app/globals.css. El viewport no puede contestar
// "¿entran las dos columnas?", porque el sidebar le saca 248 px al cuerpo
// justo al cruzar 1024 (ver el spec del 2026-09-07). Frames `VaHod` (carrito)
// y `keRdN` (cobro) de design/arandano.pen.
```

Reemplazar el caso `'la fila de columnas corta en lg, y no queda ningún md: en la pantalla'`:

```ts
  it('la fila corta por contenedor, y no queda ningún corte de viewport en la pantalla', () => {
    expect(FUENTE).toMatch(/flex flex-col gap-\[18px\] @cobro\/venta:flex-row/)
    // EN LA DIRECCIÓN INVERSA, que es la que atrapa de verdad: una clase que
    // se quedara en `lg:` seguiría mirando el viewport y decidiría distinto
    // que sus vecinas, con todo el gate en verde. Es el mismo modo de falla de
    // las dos copias de "Anular orden" (CLAUDE.md, merge del ciclo móvil).
    expect(
      SIN_COMENTARIOS,
      'esta pantalla decide por contenedor: no puede quedar ningún lg:',
    ).not.toMatch(/\blg:/)
    // Sólo `md:`, igual que antes de este ciclo: `sm:` NO se puede prohibir
    // acá, porque el DialogContent del selector de unidad trae
    // `sm:max-w-[512px]` del registry de shadcn (línea 2572).
    expect(SIN_COMENTARIOS, 'ningún md: nuevo').not.toMatch(/\bmd:/)
    // El píxel se escribe una vez, en app/globals.css, o no se escribe.
    expect(SIN_COMENTARIOS, 'el umbral no se repite como valor arbitrario').not.toMatch(
      /@min-\[\d+px\]/,
    )
  })

  it('el contenedor se declara con nombre', () => {
    expect(FUENTE).toContain(`@container/${NOMBRE_DEL_CONTENEDOR}`)
    // Sin nombre resolvería contra el contenedor más cercano, y
    // components/ui/card.tsx ya establece uno (@container/card-header). Una
    // variante sin nombre se escribe `@cobro:algo`; con nombre, `@cobro/venta:`
    // —que no contiene la cadena `@cobro:` en ningún lado—.
    expect(
      SIN_COMENTARIOS,
      'las variantes tienen que apuntar al contenedor por nombre',
    ).not.toContain('@cobro:')
  })
```

Reemplazar el caso `'el paso esconde una columna y muestra la otra, sólo en el teléfono'`:

```ts
  it('el paso esconde una columna y muestra la otra, sólo en una columna', () => {
    expect(FUENTE).toMatch(/paso === 'cobro' \? 'hidden @cobro\/venta:flex' : 'flex'/)
    expect(FUENTE).toMatch(/paso === 'cobro' \? 'flex' : 'hidden @cobro\/venta:flex'/)
    expect(SIN_COMENTARIOS, 'la constraint del ciclo prohíbe max-lg:').not.toMatch(/max-lg:/)
  })
```

Reemplazar el caso `'en escritorio el paso se ignora'`:

```ts
  // Con lugar para las dos columnas el paso se ignora POR COMPLETO: las dos se
  // ven siempre y el Topbar no cambia, aunque la URL traiga ?paso=cobro —lo que
  // pasa, por ejemplo, al agrandar la ventana a mitad de un cobro—.
  it('con lugar para las dos columnas el paso se ignora', () => {
    expect(FUENTE).toMatch(/const pasoVisible = dosColumnas \? 'carrito' : paso/)
  })

  // La pregunta del contenedor la contesta el hook del contenedor. Preguntarle
  // al viewport acá, con el CSS preguntándole al contenedor, es la
  // desincronización que este ciclo existe para cerrar.
  it('el paso no lo decide el viewport', () => {
    expect(FUENTE).toContain('useDosColumnas')
    expect(FUENTE, 'useIsMobile contesta la pregunta del sidebar, no la de esta fila').not.toContain(
      'useIsMobile',
    )
  })
```

Reemplazar el caso `'el panel de cobro ocupa todo el ancho del teléfono'`:

```ts
  it('el panel de cobro ocupa todo el ancho cuando hay una sola columna', async () => {
    const html = await render()
    expect(html).toContain('w-full')
    expect(html).toContain('@cobro/venta:w-96')
  })
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: FAIL en los cinco casos de arriba — el fuente todavía dice `lg:`.

- [ ] **Step 3: Envolver el cuerpo en el contenedor**

En `app/(app)/vender/punto-de-venta.tsx`, reemplazar la línea 1704:

```tsx
      <div className="flex flex-1 flex-col gap-3 px-[14px] py-3 lg:gap-[18px] lg:p-6">
```

por:

```tsx
      {/* El envoltorio del contenedor: SIN padding, a propósito. Un container
          query compara contra el content box, así que si este elemento
          llevara el padding —que además cambia con la propia consulta— la
          consulta dependería de su propio resultado. Con el padding en el hijo,
          lo que se mide es el ancho del <SidebarInset>, que no depende de nada
          que decidamos acá. El `ref` es el mismo que mide `useDosColumnas`:
          una sola fuente para el CSS y para el JavaScript. */}
      <div ref={cuerpo} className="@container/venta flex flex-1 flex-col">
        <div className="flex flex-1 flex-col gap-3 px-[14px] py-3 @cobro/venta:gap-[18px] @cobro/venta:p-6">
```

Y cerrar el `</div>` que se abrió de más. Hoy el fuente termina el cuerpo así (líneas 2536-2539): un `</div>` que cierra la fila de las dos columnas, otro que cierra el cuerpo, una línea en blanco y `<PieDeVenta`. Hace falta **un tercer `</div>`** después del segundo:

```tsx
        </div>
      </div>
      </div>

      <PieDeVenta
```

Confirmar con `npx tsc --noEmit`, que falla ruidosamente si el JSX queda desbalanceado. Reindentar los tres cierres y todo el bloque envuelto — `npm run lint` incluye el formateo.

- [ ] **Step 4: Cambiar el lector de JavaScript**

Reemplazar la línea 15 (`import { useIsMobile } from '@/hooks/use-mobile'`) por:

```tsx
import { useDosColumnas } from '@/hooks/use-dos-columnas'
```

Reemplazar las líneas 1006 y 1013:

```tsx
  // El ancho del cuerpo, que es lo que decide si entran las dos columnas. Se
  // mide sobre el mismo elemento que lleva el `@container/venta`, contra el
  // mismo umbral: el CSS y esto no pueden decidir distinto.
  const cuerpo = useRef<HTMLDivElement>(null)
  const dosColumnas = useDosColumnas(cuerpo)
```

```tsx
  // Con las dos columnas a la vista el paso se ignora POR COMPLETO, aunque la
  // URL traiga `?paso=cobro`. Las columnas resuelven lo suyo por CSS
  // (`hidden @cobro/venta:flex`, más abajo); el Topbar no puede, porque su
  // título y su flecha son props y no clases, así que ahí sí hace falta
  // preguntar — y se le pregunta al contenedor, no al viewport.
  const pasoVisible = dosColumnas ? 'carrito' : paso
```

Agregar `useRef` al import de React que ya existe en el archivo.

- [ ] **Step 5: Convertir la fila y las dos cards**

Línea 1801:

```tsx
        <div className="flex flex-col gap-[18px] @cobro/venta:flex-row">
```

Línea 1818:

```tsx
              paso === 'cobro' ? 'hidden @cobro/venta:flex' : 'flex'
```

Líneas 2325-2326:

```tsx
              paso === 'cobro' ? 'flex' : 'hidden @cobro/venta:flex'
            } w-full gap-0 rounded-[16px] border py-0 ring-0 @cobro/venta:w-96`}
```

- [ ] **Step 6: Correr los tests y verificar que pasan los cinco casos nuevos**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: los cinco casos nuevos en PASS. **Los demás siguen fallando** — el archivo todavía tiene ochenta y pico de `lg:` que la Task 4 convierte, y el caso `not.toMatch(/\blg:/)` los ve. Es esperado y es la razón de que la Task 4 exista.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/vender/punto-de-venta.tsx" "app/(app)/vender/punto-de-venta.test.tsx"
git commit -m "feat(vender): la fila y el Topbar deciden por el contenedor"
```

---

### Task 4: El resto de las clases de la pantalla

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx` (líneas 1729, 1737, 1756, 1842, 1874, 1881, 1927, 1943, 1949, 1978, 2070, 2071, 2080, 2156, 2158, 2171, 2173, 2214, 2216, 2468, 2752, más los comentarios que nombran `lg:` en 1010, 1246, 1257, 1681, 1706, 1727, 1798, 1814, 1877, 1909, 1913, 1919, 1946, 2077, 2164, 2189, 2206, 2321)
- Test: `app/(app)/vender/punto-de-venta.test.tsx`

**Interfaces:**
- Consumes: el envoltorio `@container/venta` de la Task 3.
- Produces: un archivo sin ningún `lg:`.

- [ ] **Step 1: Correr el test y confirmar qué falta**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx" -t 'la fila corta por contenedor'`
Expected: FAIL, por el `not.toMatch(/\blg:/)`. Es la lista de trabajo de esta task.

- [ ] **Step 2: Reemplazar todos los `lg:` de código por `@cobro/venta:`**

La conversión es literal: cada `lg:X` pasa a `@cobro/venta:X`, sin excepción y sin cambiar el orden de las clases. Incluye las compuestas, que se escriben con la variante de contenedor primero:

- `lg:group-hover:bg-muted/50` → `@cobro/venta:group-hover:bg-muted/50`
- `lg:group-last:border-b-0` → `@cobro/venta:group-last:border-b-0`

Los diecinueve lugares con clases: 1729 (`hidden lg:block`), 1737 (`lg:h-[58px]`), 1756 (`lg:inline-block`), 1842 (`lg:hidden`), 1874 (`lg:grid-cols-[1fr_104px_110px_130px_28px]`), 1881 (`hidden lg:contents`), 1927 (`lg:contents`), 1943, 1949 (`lg:gap-0.5`), 1978 (`lg:hidden`), 2070 (`lg:contents`), 2071, 2080, 2156, 2158, 2171, 2173, 2214, 2216, 2468 (`hidden … lg:flex`), 2752 (`lg:hidden`).

Verificar después con:

```bash
grep -c 'lg:' "app/(app)/vender/punto-de-venta.tsx"
```

Expected: sólo los comentarios, que se atienden en el paso siguiente.

- [ ] **Step 3: Actualizar los comentarios que nombran el corte viejo**

Los dieciocho comentarios listados arriba dicen cosas como "se esconde con `hidden lg:flex`", "a 768 px al carrito le quedaban 136 px" o "arriba de 1024 las dos columnas terminan en `flex`". Reemplazar cada mención de `lg:` por la variante nueva y cada mención del viewport por el contenedor. El de la línea 1798, que explica el corte, se reescribe entero:

```tsx
        {/* "Fila": las dos columnas — el carrito y el cobro. El corte NO es de
            viewport: es del ancho de este cuerpo (`@cobro/venta:`, umbral en
            hooks/use-dos-columnas.ts). El viewport no lo puede contestar
            porque el sidebar le saca 248 px al cuerpo justo al cruzar 1024,
            así que hay MÁS lugar a 1023 que a 1024. Ver el spec del
            2026-09-07. */}
```

- [ ] **Step 4: Escribir el caso que mira el CSS generado**

Es la única red contra una variante mal escrita: una variante que Tailwind no reconoce **no emite CSS y no da ningún error**, así que la pantalla se serviría en una sola columna en todos los anchos con el gate entero en verde.

Crear `app/(app)/vender/container-query.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { ANCHO_MINIMO_DOS_COLUMNAS, NOMBRE_DEL_CONTENEDOR } from '@/hooks/use-dos-columnas'

/**
 * Compila el CSS real del proyecto contra las clases reales de la pantalla.
 *
 * POR QUÉ NO ALCANZA CON MIRAR EL FUENTE: una variante de Tailwind que no
 * existe no emite nada y no falla. Un `@cobro/ventas:` con una ese de más, o un
 * `--container-cobro` que quedó fuera del bloque `@theme`, dejan la pantalla en
 * una sola columna en TODOS los anchos, y ningún caso que lea el .tsx lo vería:
 * las clases estarían escritas igual.
 *
 * `source(none)` + un `@source` puntual en vez del escaneo automático: sin eso
 * Tailwind recorre el repo entero y este caso pasaría a tardar segundos.
 */
const GLOBALS = 'app/globals.css'

async function compilar(): Promise<string> {
  const original = readFileSync(GLOBALS, 'utf8')
  const acotado = original.replace(
    '@import "tailwindcss";',
    '@import "tailwindcss" source(none);\n@source "app/(app)/vender/punto-de-venta.tsx";',
  )
  const resultado = await postcss([tailwind()]).process(acotado, {
    from: path.resolve(GLOBALS),
  })
  return resultado.css
}

describe('el container query de /vender llega al CSS', () => {
  it('emite la consulta contra el contenedor con nombre y el umbral declarado', async () => {
    const css = await compilar()
    expect(css).toContain(`container-name: ${NOMBRE_DEL_CONTENEDOR}`)
    expect(css).toContain(
      `@container ${NOMBRE_DEL_CONTENEDOR} (width >= ${ANCHO_MINIMO_DOS_COLUMNAS}px)`,
    )
  })

  it('la fila y el panel están adentro de esa consulta', async () => {
    const css = await compilar()
    const bloques = css.split(
      `@container ${NOMBRE_DEL_CONTENEDOR} (width >= ${ANCHO_MINIMO_DOS_COLUMNAS}px)`,
    )
    const dentro = bloques.slice(1).join('\n')
    expect(dentro, 'la fila no pasa a flex-row en ningún ancho').toContain('flex-direction: row')
    expect(dentro, 'el panel no recupera sus 384 px').toContain('width: var(--container-sm)')
  })
})
```

Si el segundo caso falla porque `w-96` no resuelve a `var(--container-sm)` en esta versión, afirmar en su lugar la clase escapada `.\\@cobro\\/venta\\:w-96`, que es lo que de verdad importa: que la regla exista dentro del bloque.

- [ ] **Step 5: Correr todo el archivo y el caso nuevo**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx" "app/(app)/vender/container-query.test.ts"`
Expected: PASS, todo.

Si el caso del CSS tarda más de ~5 segundos, reemplazar el entry por uno mínimo: `@import "tailwindcss" source(none);` + `@source` + un `@theme inline { --container-cobro: <valor leído de globals.css con regex> }`. Se pierde fidelidad del pipeline completo y se conserva lo que el caso vino a probar.

- [ ] **Step 6: Correr el gate completo de la rama**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. Dos archivos a mirar de cerca:

- **`components/shell/encabezado.test.tsx`** tiene que seguir en verde **sin haberse tocado**. Es la evidencia de que la pregunta del viewport no se movió.
- **`test/responsive.test.ts`** no se ve afectado, y conviene saber por qué exactamente: ese caso sólo mira `w-[Npx]`, `min-w-[Npx]` y `basis-[Npx]`, y **ninguno** de los `lg:` que esta task convierte es de esa familia (son `h-`, `p-`, `px-`, `grid-cols-`, `contents`, `hidden`, `flex`). **Punto ciego que queda anotado**: la clase de caracteres del prefijo de variante de ese regex (`[a-z0-9@[\]&>_-]+`) **no incluye la `/`**, así que un `@cobro/venta:w-[400px]` futuro le resultaría invisible — no lo marcaría ni como prefijado ni como suelto. Si alguna vez se agrega un ancho fijo con esta variante, hay que sumarle la `/` a ese regex.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/vender/punto-de-venta.tsx" "app/(app)/vender/punto-de-venta.test.tsx" "app/(app)/vender/container-query.test.ts"
git commit -m "feat(vender): las noventa clases pasan al contenedor, con la red del CSS compilado"
```

---

### Task 5: La documentación, incluido el comentario que causó el defecto

**Files:**
- Modify: `hooks/use-mobile.ts` (comentario de las líneas 3-12)
- Modify: `docs/pantallas.md` (sección `/vender`, línea 242)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Corregir el comentario de `hooks/use-mobile.ts`**

Es la fuente del malentendido: hoy justifica el 1024 con una cuenta que le falta el padding y el gap, y que le descuenta el sidebar también abajo del corte, donde el sidebar no ocupa nada. El número **no cambia** —contesta la otra pregunta—, el porqué sí:

```ts
// 1024 y no los 768 que trae shadcn por default, y la pregunta que contesta es
// UNA SOLA: ¿el sidebar es un panel flotante? Abajo de este ancho el sidebar se
// renderiza como `Sheet` (components/ui/sidebar.tsx) y no ocupa nada en el
// flujo; a partir de acá son 248 px de columna. Por eso el Topbar tiene que
// mostrar la hamburguesa abajo del corte: es el único camino a la navegación.
//
// LO QUE ESTE NÚMERO YA NO DECIDE, y es la corrección del 2026-09-07: si en
// /vender entran las dos columnas. Ese cálculo vivía acá y estaba mal por dos
// motivos —le faltaban el padding del cuerpo y el gap de la fila, y le
// descontaba los 248 del sidebar también abajo de 1024, donde el sidebar es un
// Sheet—. La consecuencia es que el corte quedó puesto justo donde el espacio
// EMPEORA: un píxel más de ventana le saca 267 px al cuerpo. Esa pregunta la
// contesta ahora hooks/use-dos-columnas.ts, midiendo el contenedor.
export const MOBILE_BREAKPOINT = 1024
```

- [ ] **Step 2: Actualizar la sección `/vender` de `docs/pantallas.md`**

En la sección que arranca en la línea 242, agregar bajo las decisiones no obvias:

```markdown
- **El corte de las dos columnas es por CONTENEDOR, no por viewport**
  (`@cobro/venta:`, umbral `--container-cobro` en `app/globals.css` y
  `ANCHO_MINIMO_DOS_COLUMNAS` en `hooks/use-dos-columnas.ts`). Es la única
  pantalla del repo así, y tiene un motivo que no aplica a las demás: el
  sidebar le saca 248 px al cuerpo justo al cruzar 1024, así que hay más lugar
  a 1023 que a 1024 y ningún corte de viewport puede ser correcto. El Topbar y
  el sidebar siguen en 1024 (`hooks/use-mobile.ts`) porque contestan la otra
  pregunta. Colapsar el sidebar devuelve las dos columnas.
```

- [ ] **Step 3: Agregar la entrada a `CLAUDE.md`**

En *Próximos pasos técnicos*, después de la entrada del contexto del bot por local, agregar:

```markdown
- ~~Que el panel de cobro no desaparezca según el tamaño de la ventana.~~
  **Hecho** (2026-09-07). Sale del feedback textual del dueño del producto:
  *"hay veces que si estas en /ventas depende el tamaño de la pamtalla la caja
  de cobro donde seleccionas como paga el cliente no aparece o queda oculta"*.
  La pantalla es `/vender`, y el ancho donde se ve es ~960 px: un monitor Full
  HD con el navegador a media pantalla. Ver
  `docs/superpowers/specs/2026-09-07-corte-por-contenedor-en-vender-design.md`.

  **El panel no se rompía: abajo de 1024 px `/vender` sirve el layout de
  teléfono, donde el cobro es un paso propio.** Lo que lo convierte en defecto
  es por qué está puesto ahí ese número. El comentario de `hooks/use-mobile.ts`
  lo justificaba con una cuenta que tiene **dos errores**: le faltan el
  `lg:p-6` del cuerpo (48) y el `gap-[18px]` de la fila —así que a 1024 al
  carrito le quedan 326 px y no los 392 que ese mismo comentario llama "el
  mínimo que funciona"—, y le descuenta los 248 px del sidebar **también abajo
  del corte**, donde el sidebar es un `Sheet` y no ocupa nada en el flujo.

  **La consecuencia es que el corte quedó puesto justo donde el espacio
  empeora**: un píxel más de ventana le saca 267 px al cuerpo. A 960 el carrito
  tendría 530 px —más que a 1024 (326) y más que a 1200 (502)—, y es
  exactamente ahí donde el panel se escondía. Del otro lado, entre 1024 y
  ~1090, las dos columnas se prendían con el carrito por debajo del mínimo
  declarado. **Ningún corte sobre el viewport puede ser correcto acá**, porque
  el sidebar parte la relación entre viewport y espacio disponible en dos
  regímenes que no son monótonos.

  **La decisión: son dos preguntas distintas, no una respondida dos veces.**
  Es lo único que hace legítimo revisar el *"un solo corte, 1024 px"* del ciclo
  móvil. *"¿El sidebar es un panel flotante?"* es del **viewport**, la sigue
  contestando `useIsMobile()` en 1024, y de ella dependen el `Sheet` del
  sidebar y la hamburguesa del Topbar — que abajo de ese ancho es el único
  camino a la navegación. *"¿Entran las dos columnas?"* es del **espacio que
  tiene el cuerpo**, y pasa a `hooks/use-dos-columnas.ts`.

  **El mecanismo son container queries de Tailwind v4**, con el cuerpo de
  `/vender` envuelto en `@container/venta` y sus clases en `@cobro/venta:`.
  Tres cosas que valen para releer:

  - **El contenedor va con NOMBRE.** Una consulta sin nombre resuelve contra el
    contenedor más cercano, y `components/ui/card.tsx` ya establece uno
    (`@container/card-header`). La pantalla no usa `CardHeader` hoy; el día que
    lo use, un `@cobro:` adentro pasaría a preguntar por el ancho de un
    encabezado de card, en silencio.
  - **El envoltorio NO lleva padding.** Un container query compara contra el
    content box, así que un contenedor que llevara el padding —que además
    cambia con la propia consulta— dependería de su propio resultado.
  - **El umbral es 850 y vive una sola vez**, como `--container-cobro` en
    `app/globals.css`. Sale de constantes que el proyecto ya había fijado: 48
    del `p-6` + 392 del carrito + 18 del gap + 384 del panel = 842. **No se
    puede leer desde JavaScript**: está en `@theme inline`, y `inline`
    significa que el valor se mete en las utilidades en vez de emitirse como
    custom property. Por eso la constante de TypeScript existe aparte y un caso
    ata las dos en las dos direcciones.

  **La mitad JavaScript no es opcional, y ésa es la lección transferible.**
  `punto-de-venta.tsx` ya leía el corte con `useIsMobile()` para cuatro props
  del `<Encabezado>` que son props y no clases (el título, el subtítulo, la
  flecha de volver y `controlMovil`). Mover sólo el CSS al contenedor los
  habría desincronizado justo en la banda que el ciclo arregla — el mismo modo
  de falla de las dos copias de "Anular orden", con todo el gate en verde.
  Cuando una pantalla decide algo por CSS **y** por JavaScript, mover una mitad
  es mover media decisión.

  **Lo que este ciclo EMPEORA, dicho explícito**: entre 1024 y 1097 px de
  ventana se pasa a ver el layout de una columna, donde antes había dos. Es la
  respuesta correcta —ahí el carrito queda entre 326 y 399 px— pero es una
  capacidad que estaba y deja de estar, con salida a mano: colapsar el sidebar
  la devuelve, que es un caso que ninguna media query podía cubrir y éste sí.
  Los últimos ocho píxeles de esa banda son el precio de redondear 842 a 850.

  **Sin migración, sin columna y sin permiso nuevo.** Es presentación pura, así
  que el ciclo entero se revierte revirtiendo la imagen.
  `lib/permisos/catalogo.ts` no crece.

  **Queda pendiente la verificación manual**, y acá el número depende de ella:
  850 es defendible en papel, pero el `min-content` real del carrito no se
  midió nunca en un navegador. El ancho que decide es **1098**, el borde exacto
  donde el carrito queda en 400 px. Lo demás a mirar está en la sección
  *Verificación* del spec.
```

**Sin números que haya que mantener a mano** —no "noventa clases"—: la fuente es el archivo, por la misma regla que este documento ya aplica al conteo de pantallas de la maqueta.

Y en la entrada del ciclo móvil, donde dice *"Un solo corte, 1024 px, y el número es aritmética"*, agregar el puntero:

```markdown
  **Esto se revisó el 2026-09-07**, y conviene leer por qué antes de creer que
  la regla se abandonó: la aritmética de ese párrafo está incompleta —le faltan
  el padding del cuerpo y el gap de la fila— y, peor, le descuenta los 248 px
  del sidebar también abajo del corte, donde el sidebar es un `Sheet` y no ocupa
  nada. Lo que se separó no son dos respuestas a una pregunta sino dos
  preguntas: el sidebar y el Topbar siguen en 1024 (viewport), y `/vender`
  decide por el ancho de su cuerpo. Ver la entrada del corte por contenedor,
  más abajo.
```

- [ ] **Step 4: Verificar que la documentación no rompió ningún caso**

Run: `npx vitest run test/pantallas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/use-mobile.ts docs/pantallas.md CLAUDE.md
git commit -m "docs(vender): el porqué del corte por contenedor, y la cuenta que estaba mal"
```

---

## Verificación manual (después del merge)

`arandano-dev` bind-montea `/root/arandano`, no el worktree, así que esto va después de mergear. Sembrar antes el catálogo con `npx tsx scripts/sembrar-catalogo-dev.mts` y **con nombres largos**: con nombres cortos no se ve dónde está el `min-content` real del carrito, que es lo que valida o corrige el 850.

Con el navegador en 960, 1024, 1098 y 1280, y una vez más a 1024 con el sidebar colapsado:

1. A 960, las dos columnas entran y el carrito con 510 px no se ve apretado.
2. A 1024, el layout de una columna aparece completo —pie con "Cobrar →", encabezado del carrito con "Vaciar", tarjetas en vez de tabla— y no a medias.
3. A 1098 —el borde exacto, donde el carrito queda en 400 px— el panel mide sus 384 y nada desborda. **Es el ancho que decide si el 850 se sostiene o hay que subirlo.**
4. Colapsar el sidebar a 1024 devuelve las dos columnas.
5. Los `Select` de medio, moneda, cubre y plan se abren anclados donde corresponde en los cuatro anchos — es el riesgo de `container-type: inline-size`, que cambia el origen de cualquier `position: fixed` descendiente.
6. Redimensionar de 960 a 1024 en medio de un cobro no pierde el carrito.
