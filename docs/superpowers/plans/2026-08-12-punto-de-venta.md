# La cinta — el punto de venta: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/vender` como una cinta de registradora —ancho contenido, importes en Archivo condensada, total anclando el pie— sin tocar el motor de ventas ni cambiar un solo control.

**Architecture:** Toda la identidad sale de un rol tipográfico nuevo (*Importe*), implementado como un módulo CSS que usa `var(--font-archivo)` directo — el mismo patrón que `cartel.module.css` y `persiana.module.css`. El rol se documenta en `docs/sistema-de-diseno.md` y queda atado con tests en las dos direcciones, como ya lo está el color. Las pantallas no cambian de comportamiento: sólo JSX y clases.

**Tech Stack:** Next.js App Router, React 19, Tailwind v4, CSS Modules, vitest con `renderToStaticMarkup` (no hay testing-library ni jsdom en este repo).

**Spec:** `docs/superpowers/specs/2026-08-12-punto-de-venta-design.md`

## Global Constraints

Cada task las hereda. No se repiten en los pasos.

- **No entra ningún color nuevo.** Ni verde de éxito, ni ámbar, ni `--marca`. `npm run contraste` tiene que dar exactamente lo mismo antes y después de todo el ciclo.
- **Escala de espaciado: sólo los pasos `1, 2, 3, 4, 6, 8, 12`** en código propio (`app/`, `components/` fuera de `components/ui/`). Excepción ya escrita en `docs/sistema-de-diseno.md`: las clases que se copian **textual** de un componente de `components/ui/` conservan sus medios pasos (`px-2.5`), porque igualar un control a `Input` no es inventar un espaciado.
- **Números tabulares y alineados a la derecha** en toda columna de plata, stock, cantidad o total. En el rol *Importe*, `font-variant-numeric` vive en el módulo CSS (no como utilidad) para que no se pierda en un refactor de clases; `text-right` sigue siendo utilidad.
- **`text-base` hasta `md`, `text-sm` de ahí para arriba** en todo control de texto. Abajo de 16 px iOS hace zoom solo al enfocar.
- **`lib/ventas/**`, `app/(app)/vender/acciones.ts`, el schema y las migraciones NO se tocan.** Ni una línea. Si una task parece pedirlo, está mal leída.
- **El documento normativo y el código van en el mismo commit.** `docs/sistema-de-diseno.md` es fuente de verdad, no una bitácora.
- **Comentarios en español y explicando el porqué**, no el qué. Es la convención del repo y lo que hace que las decisiones sobrevivan.
- Correr `npm test` con el stack de dev arriba: `docker compose -f docker/compose.dev.yml up -d --wait` (los tests usan una base efímera y `fileParallelism: false`).

---

### Task 1: El cable trampa del eje de ancho

`app/layout.tsx` declara `declarations: [{ prop: "font-stretch", value: "62% 125%" }]`. **Sin esa línea el eje `wdth` de Archivo no se activa**, los `font-stretch: 112%` del cartel dejan de tener efecto y no avisa nadie: se ve una Archivo de ancho normal y parece una decisión de diseño. El propio `docs/sistema-de-diseno.md` advierte de esto y hoy no lo vigila ningún test.

Esta task es independiente del resto del ciclo y vale sola.

**Files:**
- Create: `test/tipografia.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: el archivo `test/tipografia.test.ts` con la función `compacto(ruta: string): string`, que las tasks siguientes reutilizan.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/tipografia.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const LAYOUT = 'app/layout.tsx'

/**
 * El fuente sin espacios y con las comillas unificadas.
 *
 * Comparar contra el archivo tal cual sería pelearle al formateador: el día que
 * prettier parta el objeto de `declarations` en dos líneas, el rojo hablaría del
 * formato y no del descriptor, que es lo único que importa acá.
 */
function compacto(ruta: string): string {
  return readFileSync(ruta, 'utf8')
    .replace(/\s+/g, '')
    .replace(/['"]/g, '"')
}

describe('el eje de ancho de Archivo está activado', () => {
  it('app/layout.tsx declara el descriptor font-stretch', () => {
    expect(
      compacto(LAYOUT),
      `${LAYOUT} dejó de declarar el descriptor font-stretch de Archivo en ` +
        `localFont({ declarations }). Sin él el eje wdth no se activa: los ` +
        `font-stretch de components/cartel.module.css y ` +
        `app/login/persiana.module.css dejan de tener efecto y NO avisa — se ve ` +
        `una Archivo de ancho normal y parece una decisión de diseño.`,
    ).toContain('prop:"font-stretch",value:"62%125%"')
  })
})

export { compacto }
```

- [ ] **Step 2: Correrlo y ver que pasa (todavía no falla)**

Run: `npx vitest run test/tipografia.test.ts`
Expected: PASS. El descriptor está hoy, así que en verde es lo correcto.

- [ ] **Step 3: Verificar por efecto que el cable trampa atrapa**

Borrar a mano la línea `declarations: [{ prop: "font-stretch", value: "62% 125%" }],` de `app/layout.tsx`.

Run: `npx vitest run test/tipografia.test.ts`
Expected: FAIL, con el mensaje largo que nombra al descriptor y a los dos módulos.

Revertir: `git checkout app/layout.tsx`, y comprobar que `git status --short` queda vacío antes de seguir.

- [ ] **Step 4: Correr la suite completa**

Run: `npm test`
Expected: PASS, sin regresiones.

- [ ] **Step 5: Commit**

```bash
git add test/tipografia.test.ts
git commit -m "test(tipografia): cable trampa del descriptor font-stretch de Archivo

Sin declarations: [{ prop: 'font-stretch', value: '62% 125%' }] en
app/layout.tsx el eje wdth no se activa y los font-stretch de los módulos
CSS dejan de hacer efecto SIN avisar. docs/sistema-de-diseno.md lo advierte
desde el ciclo del cartel y hasta ahora no lo vigilaba nadie.

Verificado por efecto: borrada la línea, falla con el mensaje esperado."
```

---

### Task 2: El rol *Importe* existe, está documentado y está vigilado

Crea el módulo CSS, suma el rol a la tabla *La escala*, le pone marcadores a esa tabla para que un parser la encuentre, y ata las dos cosas con tests en las dos direcciones. **Todavía no lo usa ninguna pantalla** — eso es la Task 3. El entregable es que el rol exista y no pueda desincronizarse.

De paso corrige los dos párrafos de `docs/sistema-de-diseno.md` que hoy afirman algo falso sobre `--font-display`.

**Files:**
- Create: `components/importe.module.css`
- Modify: `test/tipografia.test.ts`
- Modify: `docs/sistema-de-diseno.md` (tabla *La escala*, sección *La cara de display: Archivo*, párrafo del token)

**Interfaces:**
- Consumes: `compacto()` de la Task 1.
- Produces: `components/importe.module.css` exportando dos clases — `importe` (familia, `font-stretch: 85%`, `tabular-nums`, sin tamaño) y `total` (lo anterior más 600 y 2.5rem). Las consume la Task 3 como `estilos.importe` y `estilos.total`.

- [ ] **Step 1: Ponerle marcadores a la tabla de la escala y sumar el rol**

En `docs/sistema-de-diseno.md`, sección *La escala*, envolver la tabla en marcadores y agregar la última fila. Queda así:

```markdown
<!-- escala:inicio -->

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Cartel** — nombre del local | Archivo | 24 px | 600, `font-stretch: 112%`, tracking −0.01em |
| Título de pantalla (`h1`) | sistema | 20 px | 500 |
| Pestaña de navegación | sistema | 14 px | 500; activa 600 |
| Identidad, meta, pie | sistema | 12 px | 400, `--muted-foreground` |
| **Importe** — plata en el punto de venta | Archivo | 40 px el total; 14 px la columna | 600 el total, 400 la columna; `font-stretch: 85%`, `tabular-nums` |

<!-- escala:fin -->
```

Los marcadores no son decoración: el documento tiene varias tablas y un parser que agarre "la primera" se rompe el día que alguien reordene secciones. Es el mismo mecanismo que ya usan `<!-- tokens:inicio -->` y `<!-- contraste:inicio -->`.

Debajo de la tabla, agregar el párrafo que explica el rol nuevo:

```markdown
**El *Importe* usa la otra punta del mismo eje.** Archivo se eligió por su eje
`wdth` porque *"un local argentino tiene el nombre pintado a lo ancho del
frente"*; ese eje tiene otra punta, y ahí vive el otro objeto del rubro: el
número angosto que sale impreso en la cinta de la registradora. 112 % el nombre,
85 % la plata. Una sola cara cumpliendo dos roles opuestos, distinguidos por el
eje que motivó elegirla.

Hoy el rol se aplica **sólo en `/vender`**. `/ventas` e `/inventario` siguen en
la pila del sistema hasta que tengan su propio ciclo: un rol nuevo aplicado a
medias es una inconsistencia visible; aplicado a una pantalla y declarado como
tal es una decisión.
```

- [ ] **Step 2: Corregir los dos párrafos que mienten**

En la sección *La cara de display: Archivo*, la frase que hoy dice *"Se usa para **una cosa**: el nombre del local… Ningún otro rol la usa."* pasa a:

```markdown
**Se usa para dos roles**, y los dos están en la tabla de arriba: el nombre del
local (`font-stretch: 112%`) y el importe del punto de venta (`85%`). Los
distingue el eje de ancho, no la familia. Ningún otro rol la usa: títulos,
tablas, botones y campos siguen en la pila del sistema.
```

Y el párrafo del token, que hoy dice *"una sola pantalla la usa… Si una segunda la necesita, ahí entra el token"*, pasa a:

```markdown
No hay token `--font-display` en `@theme inline`, y es a propósito. Los
consumidores son **tres** módulos CSS —`app/login/persiana.module.css`,
`components/cartel.module.css` y `components/importe.module.css`— y ninguno lo
querría igual: además de la familia, cada uno necesita su `font-stretch` y su
tracking, así que ninguna utilidad de Tailwind referenciaría el token. Un token
de `@theme` que ninguna utilidad referencia es un token muerto, que es lo que el
caso *no quedan tokens de sidebar ni de gráficos* de
`test/sistema-de-diseno.test.ts` existe para evitar. Los tres consumen
`var(--font-archivo)` —la variable que emite `next/font`— directo.

Este párrafo dijo lo contrario hasta el ciclo de la cinta: prometía que *"si una
segunda pantalla la necesita, ahí entra el token"*, cuando el ciclo del cartel ya
había sumado la segunda sin que entrara. Es exactamente el modo de falla que la
tabla de la escala ahora tiene cubierto con `test/tipografia.test.ts` — y la
razón por la que existe ese test.
```

- [ ] **Step 3: Escribir los tests que fallan**

Agregar a `test/tipografia.test.ts`, debajo de lo que ya hay:

```ts
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

const DOC = 'docs/sistema-de-diseno.md'
const INICIO = '<!-- escala:inicio -->'
const FIN = '<!-- escala:fin -->'

/**
 * Qué módulo CSS implementa cada rol de la tabla.
 *
 * El test no puede deducirlo: la tabla habla de ROLES y el CSS habla de
 * ARCHIVOS. Este mapa es el puente, y que haya que tocarlo para sumar un rol
 * con cara propia es parte del punto — obliga a decir dónde vive.
 */
const MODULOS_POR_ROL: Record<string, string[]> = {
  Cartel: ['app/login/persiana.module.css', 'components/cartel.module.css'],
  Importe: ['components/importe.module.css'],
}

/** Rol → `font-stretch`, leído de la tabla normativa entre marcadores. */
function anchosDelDoc(): Map<string, string> {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(
      `${DOC} no tiene los marcadores ${INICIO} … ${FIN} alrededor de la tabla ` +
        `de la escala, o están al revés. Sin ellos no hay nada contra qué ` +
        `comparar los módulos CSS.`,
    )
  }
  const anchos = new Map<string, string>()
  for (const linea of texto.slice(desde, hasta).split('\n')) {
    const rol = linea.match(/^\|\s*\*\*([^*]+)\*\*/)
    const ancho = linea.match(/`font-stretch:\s*([\d.]+%)`/)
    if (rol && ancho) anchos.set(rol[1].trim(), ancho[1])
  }
  return anchos
}

/** Todos los módulos CSS del repo, sin node_modules ni directorios ocultos. */
function modulosDelRepo(dir = '.', encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) modulosDelRepo(ruta, encontrados)
    else if (entrada.name.endsWith('.module.css')) encontrados.push(ruta)
  }
  return encontrados
}

function anchosDeArchivo(ruta: string): string[] {
  const css = readFileSync(ruta, 'utf8')
  return [...css.matchAll(/font-stretch:\s*([\d.]+%)/g)].map((m) => m[1])
}

describe('la escala tipográfica y los módulos declaran lo mismo', () => {
  // Fail-closed, igual que `la tabla del documento no está vacía` del test de
  // color: un parser que no encuentra filas devuelve un Map vacío, y sobre un
  // Map vacío los dos casos de abajo pasan sin mirar nada.
  it('la tabla de la escala no está vacía', () => {
    expect(
      anchosDelDoc().size,
      `no se parseó ningún rol con font-stretch de la tabla de la escala de ` +
        `${DOC}. O la tabla quedó vacía, o cambió el formato de las filas y el ` +
        `regex dejó de matchear.`,
    ).toBeGreaterThan(0)
  })

  it('todo rol con ancho propio lo declara igual en su módulo', () => {
    for (const [rol, ancho] of anchosDelDoc()) {
      const modulos = MODULOS_POR_ROL[rol]
      expect(
        modulos,
        `${DOC} declara el rol "${rol}" con font-stretch: ${ancho}, y ` +
          `MODULOS_POR_ROL no dice qué módulo CSS lo implementa. Agregalo ahí, ` +
          `o el rol nuevo queda sin vigilancia.`,
      ).toBeDefined()
      for (const ruta of modulos) {
        const declarados = anchosDeArchivo(ruta)
        expect(
          declarados,
          `${DOC} declara "${rol}" con font-stretch: ${ancho}, y ${ruta} ` +
            `declara ${declarados.length ? declarados.join(', ') : 'ninguno'}. ` +
            `El documento es la fuente de verdad: si el ancho cambió, cambialo ` +
            `en los dos.`,
        ).toContain(ancho)
      }
    }
  })

  it('ningún módulo declara un ancho que el documento no documente', () => {
    const documentados = new Set(anchosDelDoc().values())
    const mapeados = new Set(Object.values(MODULOS_POR_ROL).flat())
    for (const ruta of modulosDelRepo()) {
      const declarados = anchosDeArchivo(ruta)
      if (declarados.length === 0) continue
      expect(
        mapeados.has(ruta),
        `${ruta} declara font-stretch y no figura en MODULOS_POR_ROL. Un ancho ` +
          `de Archivo que no corresponde a ningún rol escrito es exactamente lo ` +
          `que la tabla de la escala existe para impedir.`,
      ).toBe(true)
      for (const ancho of declarados) {
        expect(
          documentados.has(ancho),
          `${ruta} declara font-stretch: ${ancho}, que no figura en la tabla de ` +
            `la escala de ${DOC}.`,
        ).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 4: Correr y ver el rojo esperado**

Run: `npx vitest run test/tipografia.test.ts`
Expected: FAIL en `todo rol con ancho propio lo declara igual en su módulo`, con el mensaje que nombra a `components/importe.module.css` — el archivo todavía no existe, así que `readFileSync` tira `ENOENT`. Ése es el rojo correcto: el documento declara un rol que el CSS no implementa.

- [ ] **Step 5: Crear el módulo CSS**

Crear `components/importe.module.css`:

```css
/*
 * El importe: la plata del punto de venta.
 *
 * QUÉ ES. El otro extremo del eje de ancho de Archivo. El cartel es el nombre
 * pintado a lo ancho del frente del local (112%); esto es el número angosto que
 * sale impreso en la cinta de la registradora (85%). Una sola cara, dos roles,
 * distinguidos por el eje que motivó elegir la fuente.
 *
 * POR QUÉ UN MÓDULO CSS Y NO UNA UTILIDAD DE TAILWIND. Igual que el cartel: el
 * @theme de app/globals.css es `inline`, así que var(--font-display) no
 * existiría fuera de una clase de Tailwind, y además de la familia este rol
 * necesita font-stretch propio. --font-archivo, en cambio, la emite next/font
 * sobre el <html> y se puede usar directo. Ver docs/sistema-de-diseno.md.
 *
 * POR QUÉ font-variant-numeric VIVE ACÁ y no como la utilidad `tabular-nums`.
 * "Números tabulares y alineados a la derecha" es una regla explícitamente NO
 * estética del sistema de diseño: sin cifras tabulares las columnas bailan y
 * comparar dos precios de un vistazo deja de funcionar. Adentro del módulo, el
 * rol no puede perderla en un refactor de clases. `text-right` sí queda como
 * utilidad, porque es alineación de columna y no propiedad del rol.
 *
 * POR QUÉ 40 PX EL TOTAL. Es lo que lo hace legible del otro lado del
 * mostrador. Supera al cartel de 24 px, y eso está declarado como enmienda con
 * su límite en docs/sistema-de-diseno.md: el cartel es lo más grande del SHELL;
 * el contenido puede pesar más cuando el contenido es el punto.
 */
.importe {
  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  font-stretch: 85%;
  font-variant-numeric: tabular-nums;
}

.total {
  composes: importe;
  font-weight: 600;
  font-size: 2.5rem;
  line-height: 1;
}
```

`composes` es la forma nativa de CSS Modules de heredar una clase, y Next la soporta sin configuración: `estilos.total` llega al HTML como `"importe total"`.

- [ ] **Step 6: Correr los tests y ver el verde**

Run: `npx vitest run test/tipografia.test.ts`
Expected: PASS, los cuatro casos.

- [ ] **Step 7: Verificar por efecto que atrapa, uno por vez**

Cada mutación se corre, se anota el rojo y se revierte con `git checkout` **antes** de la siguiente. Comprobar `git status --short` vacío entre una y otra.

| # | Defecto | Dónde | Caso que tiene que fallar |
|---|---|---|---|
| 1 | `font-stretch: 85%` → `90%` | sólo `components/importe.module.css` | `todo rol con ancho propio lo declara igual en su módulo` |
| 2 | `font-stretch: 85%` → `90%` en la fila *Importe* | sólo `docs/sistema-de-diseno.md` | el mismo caso, por el otro lado — y además `ningún módulo declara un ancho que el documento no documente` |
| 3 | Borrar las 5 filas entre los marcadores | sólo `docs/sistema-de-diseno.md` | `la tabla de la escala no está vacía` |
| 4 | Agregar `font-stretch: 70%;` a `app/login/persiana.module.css` | sólo ese archivo | `ningún módulo declara un ancho que el documento no documente` |

Anotar el resultado real de los cuatro: entran en la sección *Cómo se verifica* de `docs/sistema-de-diseno.md` en el Step 8.

- [ ] **Step 8: Escribir la evidencia en el documento**

En `docs/sistema-de-diseno.md`, sección *Cómo se verifica*, agregar un bloque con la tabla de los cuatro defectos del Step 7 y su rojo real, con el mismo formato que el bloque que ya existe para los tokens de color. Si algún rojo no fue el esperado, **no** se maquilla: se arregla el test y se vuelve a correr.

- [ ] **Step 9: Correr la suite completa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add components/importe.module.css test/tipografia.test.ts docs/sistema-de-diseno.md
git commit -m "feat(diseno): el rol Importe, en la otra punta del eje de Archivo

El cartel es el nombre pintado a lo ancho del frente (112%); el importe es
el número angosto de la cinta (85%). Una sola cara, dos roles, distinguidos
por el eje que motivó elegir la fuente.

La tabla de la escala pasa a tener marcadores y test/tipografia.test.ts la
ata a los módulos CSS en las dos direcciones — hasta ahora era prosa que
podía desincronizarse, que es justo lo que le había pasado a los dos
párrafos de --font-display que este commit corrige.

Todavía no lo usa ninguna pantalla: eso es el commit siguiente."
```

---

### Task 3: La cinta

El carrito pasa a ser la cinta de la registradora: ancho contenido, encabezado impreso, importes en Archivo condensada y el pie con doble regla anclando el total. Incluye la enmienda de la regla de jerarquía, porque es esta task la que la necesita.

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx:324-441` (la columna izquierda)
- Create: `app/(app)/vender/punto-de-venta.test.tsx`
- Modify: `docs/sistema-de-diseno.md` (la regla de jerarquía en *La escala*)

**Interfaces:**
- Consumes: `estilos.importe` y `estilos.total` de `components/importe.module.css` (Task 2).
- Produces: nada que consuman otras tasks. La Task 4 toca el mismo archivo, en otra región.

- [ ] **Step 1: Validar el arnés de render antes de escribir aserciones**

`PuntoDeVenta` es un componente **cliente** con `useActionState`, `useState`, `useRef` y ajustes de estado durante el render. Este repo no tiene testing-library ni jsdom: renderiza con `renderToStaticMarkup`, igual que `app/(app)/layout.test.tsx`. Antes de escribir el test de verdad, comprobar que el arnés aguanta.

Crear `app/(app)/vender/punto-de-venta.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Las dos funciones que el componente importa viven en un archivo 'use server'.
// Su contrato ya lo fija app/(app)/vender/acciones.test.ts; acá sólo importa qué
// renderiza la pantalla, así que se mockean.
vi.mock('./acciones', () => ({
  cobrar: vi.fn(),
  buscarArticulos: vi.fn(async () => []),
}))

async function render() {
  const { PuntoDeVenta } = await import('./punto-de-venta')
  return renderToStaticMarkup(<PuntoDeVenta cotizacionInicial={null} />)
}

describe('el punto de venta', () => {
  it('renderiza con el carrito vacío', async () => {
    expect(await render()).toContain('Buscar artículo')
  })
})
```

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: PASS.

**Si falla** porque el renderer estático no soporta algún hook: no pelearlo. Anotar el error, borrar el archivo y pasar a asertar sobre el fuente con la función `compacto()` de `test/tipografia.test.ts` (`expect(compacto('app/(app)/vender/punto-de-venta.tsx')).toContain('estilos.total')`). Es más débil pero no es decorativo: sigue atrapando que el tratamiento desaparezca en un refactor.

- [ ] **Step 2: Escribir los tests que fallan**

Agregar al `describe` del Step 1:

```tsx
  // El ancla de la pantalla. Está desde el carrito vacío y no sólo cuando hay
  // algo que cobrar: un ancla que aparece y desaparece no es un ancla — la
  // vista aprende dónde mirar porque el número está SIEMPRE en el mismo lugar.
  it('el pie de la cinta está desde el carrito vacío, en cero', async () => {
    const html = await render()
    expect(html).toMatch(/class="[^"]*total[^"]*"[^>]*>[^<]*0,00/)
  })

  // El tratamiento de display de la plata, igual que el caso del cartel en
  // app/(app)/layout.test.tsx: vitest no procesa CSS, así que `estilos.total`
  // llega al HTML como "importe total" (composes) y `estilos.importe` como
  // "importe".
  it('el total lleva el tratamiento de importe', async () => {
    expect(await render()).toMatch(/class="[^"]*importe/)
  })

  // Una sola vez en pantalla. Antes estaba dos veces —la card de cobro y el
  // pie— y en ninguna de las dos mandaba.
  it('el total no está también en la columna de cobro', async () => {
    const html = await render()
    const veces = [...html.matchAll(/class="[^"]*total[^"]*"/g)].length
    expect(veces, `el total aparece ${veces} veces y tiene que aparecer 1`).toBe(1)
  })
```

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: FAIL en los tres casos nuevos — todavía no existe el pie.

- [ ] **Step 3: Importar el módulo en la pantalla**

En `app/(app)/vender/punto-de-venta.tsx`, junto al resto de los imports:

```tsx
import estilos from '@/components/importe.module.css'
```

- [ ] **Step 4: Contener la cinta y reescribir el encabezado**

Reemplazar la apertura de la columna izquierda (hoy `<div className="flex-1">`, línea 325) por:

```tsx
      {/* La cinta se contiene: en un monitor de 22" el carrito suelto deja
          ~1100 px entre el nombre del artículo y su importe, que es más de lo
          que el ojo enlaza de una sola pasada. `max-w-3xl` es un token de
          max-width de Tailwind, no un paso de la escala de espaciado, así que
          no cae bajo la regla del subconjunto. */}
      <div className="max-w-3xl flex-1">
```

Y el `<thead>` (líneas 372-380) por:

```tsx
            <thead>
              {/* Como imprime una cinta: chico, gris y en mayúsculas. El
                  `font-normal` es necesario porque <th> viene en negrita por
                  default del navegador. */}
              <tr className="border-b text-left text-xs tracking-wider text-muted-foreground uppercase">
                <th className="pb-2 font-normal">Artículo</th>
                <th className="w-24 pb-2 text-right font-normal">Cantidad</th>
                <th className="pb-2 text-right font-normal">Precio</th>
                <th className="pb-2 text-right font-normal">Subtotal</th>
                <th />
              </tr>
            </thead>
```

- [ ] **Step 5: Los importes de la tabla, en Archivo condensada**

Las dos columnas de plata de cada fila (líneas 416-423) pasan a llevar la clase del módulo. `tabular-nums` sale de las utilidades: ahora vive adentro del módulo, y dejarlo en los dos lugares invita a que alguien "limpie" el que importa.

```tsx
                    <td className={`${estilos.importe} text-right`}>
                      {formatearPrecio(l.precio)}
                    </td>
                    <td className={`${estilos.importe} text-right`}>
                      {invalida
                        ? '—'
                        : formatearPrecio(
                            deCentavos(subtotalEnCentavos(cantidadMilesimas, aCentavos(l.precio))),
                          )}
                    </td>
```

Lo mismo en la lista de resultados del buscador (línea 352-359): el `<span className="tabular-nums">` que envuelve precio y stock pasa a `<span className={estilos.importe}>`. El `—` del stock de un servicio no se toca.

- [ ] **Step 6: El pie de la cinta**

Hoy la tabla entera vive adentro de un ternario que la reemplaza por la ayuda cuando el carrito está vacío (líneas 366-440):

```tsx
        {lineas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Buscá un artículo para empezar la venta.
          </p>
        ) : (
          <table className="w-full text-sm">…</table>
        )}
```

Eso tiene que dejar de ser un ternario: **el encabezado y el pie están siempre**, y lo único que cambia es si hay filas. La `<table>` pasa a renderizarse sin condición —con `<tbody>` vacío cuando no hay líneas— y la ayuda baja a debajo de ella:

```tsx
        <table className="w-full text-sm">
          <thead>…</thead>
          <tbody>
            {lineas.map((l, i) => {
              /* el cuerpo de la fila NO cambia: es el mismo bloque de hoy,
                 con las dos celdas de plata del Step 5 */
            })}
          </tbody>
        </table>

        {lineas.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">
            Buscá un artículo para empezar la venta.
          </p>
        )}

        {/* El pie de la cinta: doble regla y el total. Está siempre, incluso con
            el carrito vacío en $ 0,00 — un ancla que aparece y desaparece no es
            un ancla. Supera al cartel de 24 px, y eso está declarado como
            enmienda con su límite en docs/sistema-de-diseno.md.

            `border-t-4 border-double` y no un valor arbitrario de 3 px: la doble
            regla necesita al menos 3 px para dibujarse, y 4 es el paso de la
            escala de bordes de Tailwind. Un ancho de borde no es un paso de
            espaciado, igual que el -mb-px del riel de pestañas.

            Con una cantidad a medio tipear `totalCentavos` queda en NaN, y
            "$ NaN" en 40 px es un cartel roto en una pantalla de plata. Muestra
            "—", que es exactamente lo que ya hace la columna Subtotal de cada
            línea inválida unas líneas más arriba. */}
        <div className="mt-2 flex items-baseline justify-between border-t-4 border-double border-foreground pt-3">
          <span className="text-xs tracking-wider text-muted-foreground uppercase">Total</span>
          <span className={`${estilos.total} text-right`}>
            {Number.isNaN(totalCentavos) ? '—' : formatearPrecio(deCentavos(totalCentavos))}
          </span>
        </div>
```

El `<tbody>` vacío con encabezado y pie a la vista **es** el estado vacío que se quiere: una cinta puesta en la registradora, sin imprimir todavía.

- [ ] **Step 7: Correr los tests**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: FAIL todavía en `el total no está también en la columna de cobro` — ese lo cierra la Task 4. Los otros tres, PASS.

Si molesta tener un rojo entre tasks, mover ese caso a la Task 4. **No** se cierra acá adelantando el cambio de la card: son dos regiones distintas del archivo y dos revisiones distintas.

- [ ] **Step 8: Escribir la enmienda de la regla**

En `docs/sistema-de-diseno.md`, debajo de la tabla de *La escala*, el párrafo que hoy dice *"El cartel pesa más que el título de la pantalla… El nombre del local es lo más grande de la aplicación."* pasa a:

```markdown
**El cartel pesa más que el título de la pantalla, y es la decisión.** El nombre
del local es lo más grande **del shell**: siempre estás adentro de tu local, y
`Inventario` es sólo dónde estás parado. Es la misma jerarquía que declara el
login —el negocio del cliente es el héroe, la plataforma no firma—, sostenida
las ocho horas en vez de los ocho segundos.

**Enmienda (ciclo de la cinta, 2026-08-12): el contenido puede pesar más que el
cartel cuando el contenido es el punto.** El total del punto de venta va en
40 px, contra los 24 del cartel. La razón de la regla original es sobre el
shell —compara el nombre del local con el título de la pantalla, o sea cromo
contra cromo—, y el total no es cromo: es el valor de la transacción en curso,
el número que se dice en voz alta cien veces por día.

**El límite, que es la mitad de la enmienda.** Hoy esto es **un número en una
sola pantalla**. Una segunda pantalla que quiera el suyo no estira esta
excepción: reabre la discusión. Si aparece un segundo importe en 40 px fuera de
`/vender`, esta sección dejó de describir el sistema.
```

- [ ] **Step 9: Correr la suite completa y el lint**

Run: `npm test && npm run lint`
Expected: PASS (menos el caso que la Task 4 cierra, ver Step 7).

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/vender/punto-de-venta.tsx" "app/(app)/vender/punto-de-venta.test.tsx" docs/sistema-de-diseno.md
git commit -m "feat(vender): el carrito es la cinta, y el pie ancla el total

Ancho contenido a max-w-3xl, encabezado impreso, importes en Archivo
condensada y un pie con doble regla que está desde el carrito vacío: un
ancla que aparece y desaparece no es un ancla.

El total en 40 px supera al cartel de 24. Va con la enmienda escrita y su
límite: el cartel es lo más grande del SHELL, y el contenido puede pesar más
cuando el contenido es el punto — hoy, un número en una sola pantalla."
```

---

### Task 4: La columna de cobro

El total sale de la card —pasa a estar una sola vez en pantalla—, la card nombra la zona en vez de repetir el nombre de la acción, y los dos `<select>` escritos a mano se igualan a `Input`.

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx:443-448` (la card) y `:589-616` (los selects de `FilaDePago`)
- Modify: `app/(app)/vender/punto-de-venta.test.tsx`

**Interfaces:**
- Consumes: `estilos.importe` de `components/importe.module.css`, ya importado por la Task 3.
- Produces: nada.

- [ ] **Step 1: Ver el rojo que quedó abierto**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: FAIL en `el total no está también en la columna de cobro`, con el mensaje que dice que aparece 2 veces.

- [ ] **Step 2: Sacar el total de la card y renombrar el título**

Reemplazar las líneas 443-448 por:

```tsx
      <Card className="md:w-80">
        <CardHeader>
          {/* "Cobro" y no "Cobrar": el botón de abajo dice Cobrar, y una acción
              tiene un solo nombre en todo el flujo. La card nombra la zona, el
              botón nombra lo que pasa al apretarlo. */}
          <CardTitle>Cobro</CardTitle>
        </CardHeader>
        <CardContent>
```

El `<p className="mb-4 text-2xl tabular-nums">` con el total se **borra**: ahora vive en el pie de la cinta, una sola vez en pantalla.

- [ ] **Step 3: Los montos de la fila de pago, en Archivo condensada**

En `FilaDePago`, los tres `<Input>` de monto, cotización y recibido llevan hoy `className="text-right tabular-nums"`. Pasan a:

```tsx
          className={`${estilos.importe} text-right`}
```

Y el cartel del vuelto (línea 652-657), hoy `<p className="text-sm tabular-nums">`, pasa a `<p className={`${estilos.importe} text-sm`}>`.

El aviso de `Faltan/Sobran` (línea 501) queda **exactamente como está**: `text-sm tabular-nums text-destructive`. No es un importe impreso sino texto de estado, así que no lleva el módulo — pero sí sigue necesitando cifras tabulares, porque el número cambia en el lugar mientras se tipea, y ahí las utilidades son el único lugar de donde puede salir.

- [ ] **Step 4: Igualar los dos `<select>` a `Input`**

Los dos `<select>` de `FilaDePago` (líneas 589-616) usan hoy `className="h-8 flex-1 rounded-md border px-3 text-sm"` y `"h-8 w-24 rounded-md border px-3 text-sm"`. Pasan a copiar las clases de `components/ui/input.tsx`:

```tsx
          className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
```

```tsx
          className="h-8 w-24 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
```

Tres cosas que esto arregla y no son cosméticas: el anillo de foco de marca —que el sistema de diseño llama *"lo más visible al operar con teclado"*— hoy no lo tienen; `border-input` en vez del `border-border` que heredaban de la capa base; y `text-base` hasta `md`, que es la regla del zoom de iOS.

El `px-2.5` es un medio paso: entra por la excepción ya escrita —clases copiadas textual de un componente de `components/ui/`— y no es un espaciado inventado.

**No** se cambian por el `Select` de shadcn: eso suma componente y comportamiento, y el alcance del ciclo es visual.

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: PASS, los cuatro casos.

- [ ] **Step 6: Correr la suite completa, el lint y el typecheck**

Run: `npm test && npm run lint && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Confirmar que el contraste no se movió**

Run: `npm run contraste`
Expected: la misma tabla que documenta `docs/sistema-de-diseno.md`, sin una fila ni un número distinto. El ciclo no toca colores; si algo cambió acá, algo se metió de más.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/vender/punto-de-venta.tsx" "app/(app)/vender/punto-de-venta.test.tsx"
git commit -m "feat(vender): el cobro deja de repetir el total y gana foco de marca

El total sale de la card: ahora está una sola vez en pantalla, en el pie de
la cinta. El título pasa a Cobro, para que Cobrar sea el nombre de la acción
y de nada más.

Los dos <select> escritos a mano se igualan a Input: anillo de foco de
marca, border-input y text-base hasta md (el zoom de iOS). No se cambian por
el Select de shadcn — eso es componente y comportamiento nuevos."
```

---

### Task 5: Mirarlo, que es lo único que puede juzgarlo

Ningún test puede responder si el eje de ancho se activó de verdad ni si el total ancla la vista. Esta task es una persona mirando dev, y cierra además la verificación visual que quedó pendiente del ciclo del login.

**Files:**
- Modify: `docs/sistema-de-diseno.md` (la sección *Verificación visual — pendiente* del final)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Levantar dev**

```bash
docker compose -f docker/compose.dev.yml up -d --wait
```

Sirve en `http://100.64.81.63:3000`, sólo por Tailscale.

- [ ] **Step 2: Mirar el login, que es la deuda del ciclo anterior**

Entrar al login de un tenant y confirmar a ojo las tres cosas que `docs/sistema-de-diseno.md` dejó anotadas:

1. El botón **Entrar** es azul-violeta y no negro.
2. El anillo de foco (tabulando hasta el botón) es del mismo azul-violeta y no gris.
3. El texto secundario bajo el título del local se lee cómodo sobre la card.

- [ ] **Step 3: Mirar la cinta**

Entrar a `/vender` y cargar tres artículos:

1. **Los importes se ven angostos**, no de ancho normal. Es la comprobación de que el eje `wdth` se activó: si se ven normales, el descriptor de `app/layout.tsx` no está haciendo efecto y el cable trampa de la Task 1 mintió.
2. **Las columnas no bailan** al cambiar cantidades y montos: `tnum` está funcionando sobre Archivo.
3. **El total ancla la vista** al entrar a la pantalla.
4. El pie está en `$ 0,00` con el carrito vacío, y muestra `—` (no `$ NaN`) al dejar una cantidad a medio tipear.
5. Tabulando por la columna de cobro, los dos `<select>` muestran el anillo de foco de marca.

- [ ] **Step 4: Escribir lo que se vio**

En `docs/sistema-de-diseno.md`, la sección *Verificación visual — pendiente* del final se reemplaza por lo observado, con fecha. Si algo no se ve como dice el documento, **eso es un hallazgo y se arregla**, no se anota como aceptado.

- [ ] **Step 5: Commit**

```bash
git add docs/sistema-de-diseno.md
git commit -m "docs(diseno): cerrada la verificación visual, la del login y la de la cinta

Lo que ningún test puede responder: que el botón Entrar es azul-violeta, que
el anillo de foco se distingue, que los importes se ven angostos —o sea que
el eje wdth se activó de verdad— y que las columnas no bailan.

La deuda del ciclo del sistema de diseño quedaba abierta desde el 2026-08-11
y se cierra acá porque se mira la misma aplicación."
```

---

## Verificación final del ciclo

Antes de dar el ciclo por cerrado:

- [ ] `npm test` en verde, con los 4 casos nuevos de `test/tipografia.test.ts` y los 4 de `punto-de-venta.test.tsx`.
- [ ] `npm run lint` y `npx tsc --noEmit` en verde.
- [ ] `npm run contraste` idéntico a la tabla del documento: el ciclo no toca colores.
- [ ] `git diff v<último>..HEAD --stat` no toca `lib/ventas/**`, `app/(app)/vender/acciones.ts`, `prisma/**` ni `scripts/**`.
- [ ] La verificación visual de la Task 5, hecha por una persona y escrita.

**Deploy:** es **MINOR** — el cliente ve una pantalla distinta. Sin migración, así que expand/contract no aplica y el rollback es la imagen anterior como siempre.
