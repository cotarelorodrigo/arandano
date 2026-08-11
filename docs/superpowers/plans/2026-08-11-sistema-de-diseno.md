# Sistema de diseño — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que Arándano tenga una decisión visual escrita —color, tipografía y espaciado— y que el documento que la declara no pueda desincronizarse de `app/globals.css`.

**Architecture:** Tres archivos. `docs/sistema-de-diseno.md` lleva el porqué de cada decisión y una **tabla normativa** de token → valor, delimitada por marcadores HTML para que un parser la encuentre sin confundirla con las otras tablas del documento. `app/globals.css` lleva los tokens reales. `test/sistema-de-diseno.test.ts` compara los dos **en las dos direcciones** y falla cerrado si no puede parsear ninguno de los dos.

**Tech Stack:** vitest (`readFileSync` + regex, sin dependencias nuevas), CSS de Tailwind v4 con tokens en `oklch`.

**Spec:** `docs/superpowers/specs/2026-08-11-sistema-de-diseno-design.md`

## Global Constraints

- **El orden de las tasks importa y no es cosmético.** Se borra lo muerto (Task 1), después se construye el mecanismo contra el CSS **tal como quedó** (Task 2), y recién ahí se cambia la paleta (Task 3). Así el diff de la Task 3 es puro diseño —gris → arándano en dos archivos— y el mecanismo que lo cuida ya está probado sobre un estado conocido. Invertir el orden deja un commit rojo en el medio, y este repo no tiene ramas largas donde esconderlo.
- **`@custom-variant dark (&:is(.dark *))` NO se borra**, aunque el bloque `.dark` sí. Sin esa línea, `dark:` vuelve al default de Tailwind v4 —`prefers-color-scheme`— y las 5 clases `dark:` de `button.tsx` e `input.tsx` se activarían solas en cualquiera con el sistema en oscuro, sobre una paleta clara y sin un solo token oscuro definido.
- **El test compara strings exactos.** `oklch(0.37 0.10 287)` y `oklch(0.37 0.1 287)` son distintos para él. En todo este plan se escribe **`0.10`**, con el cero, en el doc y en el CSS.
- **No se rediseña ninguna pantalla.** Login y usuarios heredan la paleta solas por los tokens.
- `npm test` = `scripts/tests/correr-todos.sh && vitest run`. Un archivo nuevo en `test/` entra por glob; no hay lista que tocar.
- Comentarios, prosa y mensajes de commit en castellano rioplatense, como el resto del repo.
- **Temporales en `/var/tmp`**, nunca en `/tmp`.

---

### Task 1: Barrer los tokens que no usa nadie

Pura resta, y va primera porque es lo más seguro que tiene este ciclo: se borra el bloque `.dark` (28 variables que nada activa) y los 13 tokens que ningún componente referencia, con sus 13 mapeos. Deja el CSS en el estado sobre el que la Task 2 va a construir.

**Files:**
- Modify: `app/globals.css`
- Create: `test/sistema-de-diseno.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `test/sistema-de-diseno.test.ts` con el bloque `describe('el CSS no arrastra tokens muertos', …)`. La Task 2 le agrega un segundo `describe` al **mismo archivo**, sin tocar éste.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/sistema-de-diseno.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const CSS = 'app/globals.css'

describe('el CSS no arrastra tokens muertos', () => {
  const css = readFileSync(CSS, 'utf8')

  it('no hay bloque .dark', () => {
    // Se borró a propósito: definía 28 variables y nada aplicaba la clase.
    // `npx shadcn init` lo reinyecta, así que esto es un cable trampa y no una
    // aserción decorativa. Anclado a principio de línea para no confundirse con
    // el `.dark *` que vive adentro de @custom-variant, que SÍ se queda.
    expect(
      css,
      'volvió el bloque .dark a app/globals.css. Si es a propósito, es un ciclo ' +
        'propio: hace falta activador, persistencia y una paleta oscura completa.',
    ).not.toMatch(/^\.dark\s*\{/m)
  })

  it('@custom-variant dark sigue estando', () => {
    // La línea más filosa del ciclo. button.tsx e input.tsx traen 5 clases
    // `dark:`. Mientras esta línea exista, el variante queda atado a una clase
    // que nadie pone y esas reglas quedan inertes. Si se borra, `dark:` vuelve
    // al default de Tailwind v4 —prefers-color-scheme— y se activarían solas en
    // cualquier usuario con el sistema en oscuro, sobre la paleta clara.
    expect(
      css,
      'se borró @custom-variant dark. Sin esa línea las clases dark: de shadcn ' +
        'se activan por prefers-color-scheme sobre una paleta que no tiene ' +
        'ningún token oscuro definido.',
    ).toMatch(/@custom-variant\s+dark\s+\(&:is\(\.dark \*\)\)/)
  })

  it('no quedan tokens de sidebar ni de gráficos', () => {
    // Ningún componente ni pantalla los referencia — verificado por grep al
    // escribir el spec. Vuelven solos con `npx shadcn add sidebar` o con el
    // primer gráfico, y ahí se documentan.
    const muertos = [...css.matchAll(/--(?:color-)?(?:sidebar|chart)[a-z0-9-]*/g)].map(
      (m) => m[0],
    )
    expect(
      muertos,
      `app/globals.css declara tokens que ningún componente usa: ${muertos.join(', ')}. ` +
        `Si entró un componente que sí los usa, documentalos en docs/sistema-de-diseno.md ` +
        `y sacá este caso.`,
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: FALLAN el primero (existe `.dark {`) y el tercero (existen `--sidebar-*` y `--chart-*`). PASA el segundo, porque `@custom-variant dark` ya está. Si el segundo falla, pará: alguien ya tocó esa línea y hay que entender por qué antes de seguir.

- [ ] **Step 3: Borrar del CSS**

En `app/globals.css`:

1. Borrar el bloque `.dark { … }` **entero** (desde `.dark {` hasta su `}`).
2. Dentro de `@theme inline`, borrar las 13 líneas de mapeo: las 8 `--color-sidebar-*` y las 5 `--color-chart-*`.
3. Dentro de `:root`, borrar las 13 declaraciones: las 5 `--chart-N` y las 8 `--sidebar-*`.
4. Dejar `@custom-variant dark (&:is(.dark *));` **donde está**, y ponerle este comentario arriba:

```css
/* Se queda aunque el bloque .dark se haya borrado, y no es un olvido.
   button.tsx e input.tsx traen 5 clases `dark:` de shadcn. Con esta línea, el
   variante apunta a una clase que ya no pone nadie y esas reglas quedan
   inertes. SIN esta línea, `dark:` vuelve al default de Tailwind v4
   —prefers-color-scheme— y se activarían solas en cualquiera con el sistema en
   oscuro, sobre esta paleta clara y sin un solo token oscuro definido.
   test/sistema-de-diseno.test.ts lo cuida. */
@custom-variant dark (&:is(.dark *));
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde. Las pantallas no cambian de aspecto: nada usaba lo que se borró.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css test/sistema-de-diseno.test.ts
git commit -m "refactor(css): borrar el modo oscuro muerto y los tokens sin consumidor

El bloque .dark definía 28 variables y nada aplicaba la clase; --sidebar-* y
--chart-* no los referencia ningún componente. Vuelven solos el día que se
corra shadcn add sidebar o se haga el primer gráfico.

@custom-variant dark se queda: sin esa línea las clases dark: de shadcn
vuelven a prefers-color-scheme y se activan solas sobre una paleta clara."
```

---

### Task 2: El documento y el test que lo ata al CSS

Se escribe el documento completo —incluidas tipografía y espaciado, que son prosa— y el test bidireccional, **declarando los valores grises que el CSS tiene hoy**. Es deliberado: el mecanismo queda probado contra un estado conocido, y el diff de la Task 3 pasa a ser puro diseño.

**Files:**
- Create: `docs/sistema-de-diseno.md`
- Modify: `test/sistema-de-diseno.test.ts` (agregar un segundo `describe`)

**Interfaces:**
- Consumes: el `app/globals.css` que dejó la Task 1 (19 tokens en `:root`).
- Produces:
  - `docs/sistema-de-diseno.md` con la tabla normativa entre `<!-- tokens:inicio -->` y `<!-- tokens:fin -->`.
  - En el test, las funciones `tokensDelDoc()` y `tokensDelCss()`, que devuelven `Map<string, string>` de nombre → valor. La Task 3 no las toca; sólo cambia datos.

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `test/sistema-de-diseno.test.ts`:

```ts
const DOC = 'docs/sistema-de-diseno.md'
const INICIO = '<!-- tokens:inicio -->'
const FIN = '<!-- tokens:fin -->'

/**
 * Los tokens que DECLARA la tabla normativa del documento.
 *
 * Entre marcadores y no "la primera tabla del archivo": el doc tiene además la
 * tabla de contraste y la de espaciado, y un parser que agarre la que venga
 * primero se rompe el día que alguien reordene secciones.
 */
function tokensDelDoc(): Map<string, string> {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(
      `${DOC} no tiene los marcadores ${INICIO} … ${FIN} alrededor de la tabla ` +
        `normativa, o están al revés. Sin ellos no hay nada contra qué comparar el CSS.`,
    )
  }
  const tokens = new Map<string, string>()
  for (const linea of texto.slice(desde, hasta).split('\n')) {
    const m = linea.match(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*`([^`]+)`\s*\|/)
    if (m) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

/** Los tokens que DEFINE el bloque :root de globals.css. */
function tokensDelCss(): Map<string, string> {
  const texto = readFileSync(CSS, 'utf8')
  const bloque = texto.match(/^:root\s*\{([\s\S]*?)^\}/m)
  if (!bloque) throw new Error(`${CSS} no tiene un bloque :root que se pueda leer`)
  const tokens = new Map<string, string>()
  for (const linea of bloque[1].split('\n')) {
    const m = linea.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/)
    if (m) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

describe('el documento y el CSS declaran lo mismo', () => {
  const doc = tokensDelDoc()
  const css = tokensDelCss()

  // Las dos mitades que hacen que esto no sea decorativo. Un parser que no
  // encuentra nada devuelve un Map vacío, y dos Maps vacíos son iguales: el
  // test daría verde sobre un documento roto. Es el mismo modo de falla que ya
  // cerraron rutas_autenticadas y test/boundaries-app.test.ts.
  it('la tabla del documento no está vacía', () => {
    expect(
      doc.size,
      `no se parseó ningún token de la tabla normativa de ${DOC}. O la tabla ` +
        `quedó vacía, o cambió el formato de las filas y el regex dejó de matchear.`,
    ).toBeGreaterThan(0)
  })

  it('el bloque :root del CSS no está vacío', () => {
    expect(css.size, `no se parseó ningún token del :root de ${CSS}`).toBeGreaterThan(0)
  })

  it('todo token del documento existe en el CSS, con el mismo valor', () => {
    for (const [nombre, valor] of doc) {
      expect(
        css.get(nombre),
        `${DOC} declara ${nombre}: ${valor}, y ${CSS} ${
          css.has(nombre) ? `tiene ${css.get(nombre)}` : 'no lo define'
        }. El documento es la fuente de verdad: si el color cambió, cambialo en los dos.`,
      ).toBe(valor)
    }
  })

  it('todo token del CSS está documentado', () => {
    const sinDocumentar = [...css.keys()].filter((n) => !doc.has(n))
    expect(
      sinDocumentar,
      `${CSS} define tokens que ${DOC} no declara: ${sinDocumentar.join(', ')}. ` +
        `Un color que no está escrito en ningún lado es exactamente lo que este ` +
        `documento existe para impedir.`,
    ).toEqual([])
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: los 3 casos de la Task 1 siguen pasando; los 4 nuevos fallan al construirse el `describe`, porque `docs/sistema-de-diseno.md` todavía no existe (`ENOENT`). Ése es el rojo correcto.

- [ ] **Step 3: Escribir el documento**

Crear `docs/sistema-de-diseno.md`. La tabla normativa lleva **los valores que el CSS tiene hoy**, después de la Task 1 — todavía grises. La Task 3 los cambia.

````markdown
# Sistema de diseño

La decisión visual de Arándano: color, tipografía y espaciado. Este documento es
la **fuente de verdad** de los tokens que viven en `app/globals.css`, y
`test/sistema-de-diseno.test.ts` lo comprueba en las dos direcciones: si acá
dice un color, ése es el que está en el CSS, y un token del CSS que no esté acá
rompe el build.

Eso tiene una consecuencia que conviene saber antes de pelearse con ella:
**cambiar un color toca siempre dos archivos.** Es el costo elegido a cambio de
que este documento no pueda mentir.

## La referencia

**El color de un arándano**: el azul-violeta profundo de la fruta. Entra en tres
lugares y en ninguno más — acciones, foco y selección. Todo el resto es gris
neutro puro. La contención es la decisión, no una etapa: es lo que menos cansa
en una pantalla que se mira ocho horas, y lo que deja margen para que el rojo de
un error se destaque de verdad.

## Los tokens

<!-- tokens:inicio -->

| Token | Valor |
|---|---|
| `--background` | `oklch(1 0 0)` |
| `--foreground` | `oklch(0.145 0 0)` |
| `--card` | `oklch(1 0 0)` |
| `--card-foreground` | `oklch(0.145 0 0)` |
| `--popover` | `oklch(1 0 0)` |
| `--popover-foreground` | `oklch(0.145 0 0)` |
| `--primary` | `oklch(0.205 0 0)` |
| `--primary-foreground` | `oklch(0.985 0 0)` |
| `--secondary` | `oklch(0.97 0 0)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` |
| `--muted` | `oklch(0.97 0 0)` |
| `--muted-foreground` | `oklch(0.556 0 0)` |
| `--accent` | `oklch(0.97 0 0)` |
| `--accent-foreground` | `oklch(0.205 0 0)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` |
| `--border` | `oklch(0.922 0 0)` |
| `--input` | `oklch(0.922 0 0)` |
| `--ring` | `oklch(0.708 0 0)` |
| `--radius` | `0.625rem` |

<!-- tokens:fin -->

Los marcadores de arriba y abajo no son decoración: el parser del test busca la
tabla entre ellos, porque este documento tiene otras tablas y agarrar "la
primera" se rompe el día que alguien reordene secciones.

## Tipografía

**La pila del sistema**, que es la que Tailwind define para `font-sans`:

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
'Noto Sans', Arial, sans-serif, y las cuatro familias de emoji
```

No es un default que quedó: es una decisión. Cero bytes, cero salto de fuente al
cargar, y se ve nativa en el Windows del mostrador igual que en el Android del
dueño. Adoptar una fuente propia más adelante es aditivo y barato.

`--font-heading: var(--font-sans)`: los títulos usan la misma familia.

**Tres pesos y no más**: 400 texto, 500 etiquetas y botones, 600 títulos. El 700
se saltea a propósito — la pila varía demasiado entre sistemas y en algunos cae
en un falso negrita sintético.

Dos reglas que **no son estéticas**:

- **Números tabulares y alineados a la derecha** (`tabular-nums text-right`) en
  toda columna de plata, stock, cantidad o total. Sin eso las columnas bailan y
  comparar dos precios de un vistazo deja de funcionar.
- **`text-base` en inputs hasta `md`, `text-sm` de ahí para arriba.** Ya lo hace
  `components/ui/input.tsx`, y el porqué va escrito antes de que alguien lo
  "arregle": abajo de 16 px iOS hace zoom solo al enfocar un campo, y en una
  tablet de mostrador eso es la pantalla saltando en cada carga de artículo.

## Espaciado y radio

La escala de 4 px de Tailwind, con un **subconjunto habilitado**: los pasos `1,
2, 3, 4, 6, 8, 12` — o sea 4, 8, 12, 16, 24, 32 y 48 px. Un valor fuera de esa
lista es señal de que el layout está mal, no de que falte un token.

La densidad es **media**, y en números:

| Elemento | Medida |
|---|---|
| Fila de tabla | 40 px (`py-2.5`) |
| Input y botón | 32 px (`h-8`) |
| Padding de card | 24 px |
| Gutter de página | 24 px |

Los 32 px de input y botón no son una elección nueva: es lo que ya traen los
componentes de shadcn copiados al repo. Adoptarlos es no pelearles.

`--radius: 0.625rem`, con la escala derivada de 7 pasos que vive en
`@theme inline`. No hay razón de marca para moverla.

## Modo oscuro

**No hay.** El bloque `.dark` se borró: definía 28 variables y nada aplicaba la
clase. Vuelve como su propio ciclo —con activador, persistencia y una paleta
oscura completa— si alguna vez se pide.

Lo que **sí** se queda es `@custom-variant dark (&:is(.dark *))`, y esa línea es
load-bearing aunque no lo parezca: sin ella, `dark:` vuelve al default de
Tailwind v4 (`prefers-color-scheme`) y las 5 clases `dark:` que traen
`button.tsx` e `input.tsx` se activarían solas en cualquiera con el sistema en
oscuro, sobre esta paleta clara.

## Colores que todavía no existen

**No hay verde de éxito ni ámbar de advertencia**, porque hoy no hay una sola
pantalla que los use. Cuando aparezca la primera, van acá y no inventados a
mano en un componente:

- **Éxito** (cobro confirmado, venta cerrada): hue 150, misma luminosidad que
  `--destructive`.
- **Advertencia** (stock bajo, presupuesto por vencer): hue 85.

En los dos casos: medir el contraste antes de fijarlo, no estimarlo a ojo.
````

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: 7 passed. Si falla "todo token del CSS está documentado", la lista de faltantes que imprime el mensaje dice exactamente qué fila agregar a la tabla — es la Task 1 mal terminada o un token que se pasó por alto.

- [ ] **Step 5: Gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add docs/sistema-de-diseno.md test/sistema-de-diseno.test.ts
git commit -m "docs: el sistema de diseño, atado a globals.css por un test

El documento declara los tokens y el test compara en las dos direcciones: un
color que cambia en el CSS sin cambiar acá falla, y un token del CSS que no
esté documentado también.

Los valores todavía son los grises de shadcn: esta task construye el
mecanismo contra un estado conocido, y la paleta viene en la siguiente."
```

---

### Task 3: La paleta

Recién acá entra el arándano. El diff es puro diseño: cinco valores, en los dos archivos.

**Files:**
- Modify: `docs/sistema-de-diseno.md` (5 filas de la tabla normativa, más la sección de contraste)
- Modify: `app/globals.css` (5 declaraciones de `:root`)

**Interfaces:**
- Consumes: `tokensDelDoc()` y `tokensDelCss()` de la Task 2. No se tocan.
- Produces: la paleta final. Ninguna task posterior depende de nombres nuevos.

- [ ] **Step 1: Ver el test atrapar la divergencia, antes de usarlo**

Cambiar **sólo el CSS**, para comprobar que el mecanismo de la Task 2 sirve. En `app/globals.css`, dentro de `:root`:

```css
  --primary: oklch(0.37 0.10 287);
```

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: FALLA `todo token del documento existe en el CSS, con el mismo valor`, con un mensaje que nombra `--primary`, el valor del doc y el del CSS. **No revertir**: el paso siguiente completa el cambio.

Si **pasa**, pará. El test es decorativo y hay que diagnosticar antes de seguir — el sospechoso es el regex de `tokensDelDoc()`, que estaría devolviendo un Map vacío sin que nadie lo note.

- [ ] **Step 2: Completar el cambio en el CSS**

En `app/globals.css`, dentro de `:root`, dejar estas cinco líneas (`--primary` ya quedó del paso anterior):

```css
  --primary: oklch(0.37 0.10 287);
  --muted-foreground: oklch(0.547 0 0);
  --accent: oklch(0.955 0.012 287);
  --accent-foreground: oklch(0.37 0.10 287);
  --ring: oklch(0.37 0.10 287);
```

- [ ] **Step 3: Actualizar la tabla normativa del documento**

En `docs/sistema-de-diseno.md`, entre los marcadores, cambiar exactamente estas cinco filas:

```markdown
| `--primary` | `oklch(0.37 0.10 287)` |
| `--muted-foreground` | `oklch(0.547 0 0)` |
| `--accent` | `oklch(0.955 0.012 287)` |
| `--accent-foreground` | `oklch(0.37 0.10 287)` |
| `--ring` | `oklch(0.37 0.10 287)` |
```

- [ ] **Step 4: Escribir el porqué y el contraste en el documento**

En `docs/sistema-de-diseno.md`, agregar **después** de la tabla normativa y su párrafo de marcadores:

````markdown
### Dónde entra el arándano

| Token | Hex | Dónde se ve |
|---|---|---|
| `--primary` | `#3d3571` | Botón de acción, links |
| `--ring` | `#3d3571` | Anillo de foco — lo más visible al operar con teclado |
| `--accent` | `#efeff8` | Fila seleccionada, hover. Único neutral tintado |

El hue es **287** en los tres. Lo que los distingue es croma y luminosidad, no
tono: es un solo color de marca visto a tres distancias.

### Contraste

Medido convirtiendo `oklch` → sRGB lineal → luminancia relativa → ratio WCAG
2.1. No estimado a ojo.

| Par | Ratio | Mínimo | |
|---|---|---|---|
| texto sobre fondo | 19.12 | 4.5 | ok |
| texto sobre `muted` | 17.53 | 4.5 | ok |
| `muted-foreground` sobre fondo | 4.91 | 4.5 | ok |
| `muted-foreground` sobre `muted` | 4.50 | 4.5 | ok |
| blanco sobre `primary` | 10.33 | 4.5 | ok |
| `primary` sobre fondo | 10.79 | 4.5 | ok |
| `primary` sobre `accent` | 9.44 | 4.5 | ok |
| blanco sobre `destructive` | 4.56 | 4.5 | ok |
| `destructive` sobre fondo | 4.76 | 4.5 | ok |
| **borde de `--input` sobre fondo** | **1.27** | **3.0** | **no llega — excepción, abajo** |

Al medir aparecieron **dos defectos que ya venían del default de shadcn**, no de
esta paleta:

1. **`--muted-foreground` sobre `--muted` daba 4.34**, abajo del mínimo para
   texto: el gris secundario sobre el fondo gris, o sea un subtítulo adentro de
   una card. **Corregido** — `0.556` → `0.547` lo deja en 4.50 exacto y en 4.91
   sobre blanco. El cambio es imperceptible a ojo.

2. **El borde de `--input` sobre blanco da 1.27**, contra los 3:1 que pide WCAG
   1.4.11 para el borde de un control. **Aceptado como excepción, no corregido.**
   Llevarlo a `oklch(0.669 0 0)` cerraría el hueco pero cambia visiblemente todo
   campo de la aplicación, y se eligió conservar el look liviano. Lo mitiga que
   todo campo lleva `<Label>` asociado y anillo de foco de marca, así que el
   borde no es el único indicio de que ahí hay un input. **Revisar** si aparece
   un reporte real de gente que no encuentra los campos, o ante una auditoría de
   accesibilidad formal.
````

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: 7 passed.

- [ ] **Step 6: Gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde. En particular `app/(app)/layout.test.tsx` y `test/boundaries-app.test.ts` siguen pasando: no se tocó markup.

- [ ] **Step 7: Commit**

```bash
git add app/globals.css docs/sistema-de-diseno.md
git commit -m "feat(ui): la paleta del arándano

El azul-violeta de la fruta en tres lugares y ninguno más: acciones, foco y
selección. El resto queda gris neutro puro.

De paso se corrige un contraste que venía del default de shadcn:
muted-foreground sobre muted daba 4.34, abajo del mínimo de 4.5 para texto.
El borde de --input queda como excepción escrita, con su mitigación."
```

---

### Task 4: Probar que el mecanismo atrapa, y mirar la aplicación de verdad

Un test que corre y da verde no prueba que atrape nada, y una paleta que pasa un test no prueba que se vea bien. Esta task responde las dos preguntas, y por eso es un gate propio.

**Files:**
- Modify: `docs/sistema-de-diseno.md` (una sección corta al final)
- Modify: `CLAUDE.md` (el ítem de *Próximos pasos técnicos*)

**Interfaces:**
- Consumes: todo lo de las Tasks 1–3.
- Produces: la evidencia. No hay código.

- [ ] **Step 1: Cuatro defectos, uno por vez, verificando el rojo**

Cada uno se introduce, se corre el test, se anota el mensaje y **se revierte antes del siguiente**. Anotá el renglón rojo exacto de cada uno: van al Step 4.

| # | Defecto | Dónde | Caso que tiene que fallar |
|---|---|---|---|
| 1 | Cambiar `--ring` a `oklch(0.5 0 0)` | sólo `app/globals.css` | `todo token del documento existe en el CSS, con el mismo valor` |
| 2 | Cambiar `--ring` a `oklch(0.5 0 0)` | sólo `docs/sistema-de-diseno.md` | el mismo |
| 3 | Agregar `--inventado: oklch(0.5 0 0);` a `:root` | sólo `app/globals.css` | `todo token del CSS está documentado` |
| 4 | Pegar `.dark { --background: oklch(0 0 0); }` al final | sólo `app/globals.css` | `no hay bloque .dark` |

Run (después de cada uno): `npx vitest run test/sistema-de-diseno.test.ts`
Expected: falla **el caso de la columna derecha y ninguno más**. Si falla otro, o si pasa, pará y diagnosticá: es el hallazgo que esta task existe para producir.

Después del cuarto: `git status --short` tiene que salir vacío.

- [ ] **Step 2: Vaciar la tabla del documento y verificar que NO da verde**

El caso que más importa, porque es el modo de falla que este repo ya cerró dos veces. Borrar **todas** las filas de la tabla entre `<!-- tokens:inicio -->` y `<!-- tokens:fin -->`, dejando el encabezado.

Run: `npx vitest run test/sistema-de-diseno.test.ts`
Expected: falla `la tabla del documento no está vacía`, **y también** `todo token del CSS está documentado` con los 19 nombres. Lo que NO puede pasar es que todo dé verde porque no hay nada que comparar.

Revertir con `git checkout docs/sistema-de-diseno.md` y confirmar `git status --short` vacío.

- [ ] **Step 3: Mirar la aplicación**

Run: `docker compose -f docker/compose.dev.yml up -d --wait`
(suele estar levantado ya; el comando es idempotente)

Dev escucha en `http://100.64.81.63:3000`, o sea sólo por Tailscale. La pantalla
de login necesita un tenant: si no hay ninguno en la base de dev, crearlo con
`npm run tenant:crear` y darle clave con `npm run usuario:clave` — los dos corren
con `tsx` y están documentados en `docs/runbook-stacks.md`.

Abrir el login de ese tenant y comprobar tres cosas **a ojo**, que es lo único
que puede juzgarlas:

1. El botón **Entrar** es azul-violeta profundo, no negro.
2. Tabulando hasta un campo, el **anillo de foco** es del mismo azul-violeta, no gris.
3. El texto secundario bajo el título del local se lee cómodo sobre la card.

Si algo se ve mal —el botón demasiado oscuro, el foco invisible— **pará acá**. Es exactamente el momento para el que sirve haber decidido la paleta con dos pantallas y no con veinte: mover un token cuesta dos líneas.

- [ ] **Step 4: Dejar la evidencia escrita**

En `docs/sistema-de-diseno.md`, al final, agregar una sección `## Cómo se verifica` con: qué archivo corre la verificación, los cuatro defectos del Step 1 con el renglón rojo que produjo cada uno, el resultado del Step 2, y la fecha. Un test del que dentro de tres meses nadie sepa si alguna vez atrapó algo es un test que nadie va a defender cuando estorbe.

- [ ] **Step 5: Cerrar el ítem en CLAUDE.md**

En `CLAUDE.md`, *Próximos pasos técnicos*, el ítem que arranca con **"Definir el sistema de diseño, en su propio archivo"**: tacharlo con `~~…~~` y marcarlo **Hecho** (2026-08-11), como los demás. Nombrar `docs/sistema-de-diseno.md`, que el test lo ata a `globals.css` en las dos direcciones, y que el modo oscuro se borró en el mismo ciclo.

- [ ] **Step 6: Gate completo y commit**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde.

```bash
git add docs/sistema-de-diseno.md CLAUDE.md
git commit -m "docs: dejar escrito que el test del sistema de diseño atrapa

Un test que corre y da verde no prueba que atrape nada. Se metieron cuatro
defectos de a uno —divergencia en cada dirección, un token sin documentar y
el regreso de .dark— y cada uno falló su caso y ninguno más. La tabla vacía
también da rojo, que es el modo de falla que importa."
```

---

### Task 5: El contraste, calculado y no transcripto

**Sumada al ciclo el 2026-08-11**, después de que la review de la Task 3 encontrara cuatro ratios mal en una tabla que el propio documento presenta como "medido, no estimado a ojo". Corregir los números no impide que vuelva a pasar: estaban pegados a mano, y esa es la causa. Esta task le da a los ratios el mismo trato que ya tienen los tokens.

**Se ejecuta ANTES de la Task 4**, para que la evidencia y el cierre de `CLAUDE.md` de esa task cubran también esto.

**Files:**
- Create: `scripts/contraste.mts`
- Create: `test/contraste.test.ts`
- Modify: `docs/sistema-de-diseno.md` (marcadores y forma canónica de las filas)
- Modify: `package.json` (un script)

**Interfaces:**
- Consumes: el `:root` de `app/globals.css` que dejó la Task 3, y la sección "Contraste" del documento que dejó su fix.
- Produces: `scripts/contraste.mts` exporta `PARES`, `EXCEPCIONES`, `tokensDelCss()` y `ratios()`. La Task 4 no los usa; nadie más depende de ellos.

- [ ] **Step 1: Normalizar las filas de la tabla del documento**

Para que un parser pueda leerlas, las diez filas tienen que nombrar sus dos tokens con la misma forma. En `docs/sistema-de-diseno.md`, sección "Contraste", envolver la tabla en marcadores y dejar las filas así:

```markdown
<!-- contraste:inicio -->

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 19.79 | 4.5 | ok |
| `--foreground` sobre `--muted` | 18.15 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 4.91 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 4.51 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 10.33 | 4.5 | ok |
| `--primary` sobre `--background` | 10.79 | 4.5 | ok |
| `--primary` sobre `--accent` | 9.44 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 4.56 | 4.5 | ok |
| `--destructive` sobre `--background` | 4.76 | 4.5 | ok |
| `--input` sobre `--background` | 1.26 | 3.0 | **excepción declarada** |

<!-- contraste:fin -->
```

La línea aclaratoria que ya existe debajo de la tabla —la que dice que cada par nombra tokens y no colores genéricos— se conserva.

- [ ] **Step 2: Escribir el test que falla**

Crear `test/contraste.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { PARES, EXCEPCIONES, nombreDelPar, ratios } from '@/scripts/contraste.mts'

const DOC = 'docs/sistema-de-diseno.md'
const INICIO = '<!-- contraste:inicio -->'
const FIN = '<!-- contraste:fin -->'

/** Los ratios que DECLARA la tabla de contraste del documento. */
function ratiosDelDoc(): Map<string, number> {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(`${DOC} no tiene los marcadores ${INICIO} … ${FIN}`)
  }
  const filas = new Map<string, number>()
  for (const linea of texto.slice(desde, hasta).split('\n')) {
    const m = linea.match(
      /^\|\s*`(--[a-z-]+)`\s+sobre\s+`(--[a-z-]+)`\s*\|\s*([\d.]+)\s*\|/,
    )
    if (m) filas.set(`${m[1]} sobre ${m[2]}`, Number(m[3]))
  }
  return filas
}

describe('el contraste de la paleta', () => {
  let calculados: ReturnType<typeof ratios>
  let doc: Map<string, number>

  beforeAll(() => {
    calculados = ratios()
    doc = ratiosDelDoc()
  })

  // Las dos mitades que hacen que esto no sea decorativo: una lista vacía y una
  // tabla vacía dan cero comparaciones, y cero comparaciones no fallan nunca.
  it('hay pares declarados', () => {
    expect(PARES.length).toBeGreaterThan(0)
  })

  it('la tabla del documento no está vacía', () => {
    expect(
      doc.size,
      `no se parseó ninguna fila de la tabla de contraste de ${DOC}`,
    ).toBeGreaterThan(0)
  })

  it('cada par llega a su mínimo, o está exceptuado con su razón escrita', () => {
    for (const r of calculados) {
      if (r.llega) continue
      const razon = EXCEPCIONES[r.nombre]
      expect(
        razon,
        `${r.nombre} da ${r.ratio.toFixed(2)} contra un mínimo de ${r.minimo}, y no ` +
          `está en EXCEPCIONES (scripts/contraste.mts). Una excepción de ` +
          `accesibilidad sin razón escrita no es revisable: o se corrige el token, ` +
          `o se declara por qué se acepta.`,
      ).toBeTruthy()
    }
  })

  it('no hay excepciones de más', () => {
    // Una excepción que ya no hace falta es una deuda que quedó cobrando sin
    // que nadie se entere de que se pagó.
    const fallan = new Set(calculados.filter((r) => !r.llega).map((r) => r.nombre))
    const sobran = Object.keys(EXCEPCIONES).filter((n) => !fallan.has(n))
    expect(
      sobran,
      `estas excepciones ya no corresponden porque el par pasa el mínimo: ` +
        `${sobran.join(', ')}. Borralas de EXCEPCIONES.`,
    ).toEqual([])
  })

  it('el documento declara el ratio que el cálculo produce', () => {
    for (const r of calculados) {
      expect(
        doc.get(r.nombre),
        `${DOC} declara ${doc.get(r.nombre) ?? 'nada'} para ${r.nombre}, y el ` +
          `cálculo sobre los tokens reales da ${r.ratio.toFixed(2)}. La tabla se ` +
          `presenta como medida: no se transcribe a mano.`,
      ).toBe(Number(r.ratio.toFixed(2)))
    }
  })

  it('el documento no declara pares que el cálculo no cubre', () => {
    const nombres = new Set(calculados.map((r) => r.nombre))
    const sobran = [...doc.keys()].filter((n) => !nombres.has(n))
    expect(sobran, `filas sin par correspondiente en PARES: ${sobran.join(', ')}`).toEqual(
      [],
    )
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run test/contraste.test.ts`
Expected: FALLA al resolver el import de `@/scripts/contraste.mts`, que todavía no existe. Ése es el rojo correcto.

- [ ] **Step 4: Escribir el script**

Crear `scripts/contraste.mts`:

```ts
/**
 * Los ratios de contraste WCAG 2.1 de la paleta, calculados desde los tokens
 * REALES de app/globals.css.
 *
 * Existe porque la tabla del documento se escribió a mano una vez y se
 * desincronizó: cuatro de diez ratios no correspondían a los tokens que estaban
 * en el CSS, en una sección cuya propia prosa dice "medido, no estimado a ojo".
 * Corregir los números no arreglaba la causa. test/contraste.test.ts compara
 * esta salida contra la tabla, así que ahora "medido" es una afirmación que el
 * gate sostiene.
 *
 * Correr a mano: `npm run contraste`.
 */
import { readFileSync } from 'node:fs'

const CSS = 'app/globals.css'

export type Par = { texto: string; fondo: string; minimo: number }

/**
 * Los pares que importan, con el mínimo que les corresponde.
 *
 * 4.5 es el mínimo de WCAG 2.1 para texto normal (1.4.3). El 3.0 del borde de
 * un control sale de 1.4.11, que es otra regla: no habla de texto sino de qué
 * hace falta para identificar un componente.
 */
export const PARES: Par[] = [
  { texto: '--foreground', fondo: '--background', minimo: 4.5 },
  { texto: '--foreground', fondo: '--muted', minimo: 4.5 },
  { texto: '--muted-foreground', fondo: '--background', minimo: 4.5 },
  { texto: '--muted-foreground', fondo: '--muted', minimo: 4.5 },
  { texto: '--primary-foreground', fondo: '--primary', minimo: 4.5 },
  { texto: '--primary', fondo: '--background', minimo: 4.5 },
  { texto: '--primary', fondo: '--accent', minimo: 4.5 },
  { texto: '--primary-foreground', fondo: '--destructive', minimo: 4.5 },
  { texto: '--destructive', fondo: '--background', minimo: 4.5 },
  { texto: '--input', fondo: '--background', minimo: 3.0 },
]

/**
 * Los pares que NO llegan a su mínimo y se aceptan igual, cada uno con su razón.
 *
 * Escrita a mano a propósito: una excepción de accesibilidad tiene que ser una
 * decisión visible en el diff, no algo que el script deduzca solo. Mismo patrón
 * que RUTAS_SIN_SMOKE en scripts/lib/rutas-comun.sh y SIN_TENANT_ID en
 * test/rls-cobertura.test.ts.
 */
export const EXCEPCIONES: Record<string, string> = {
  '--input sobre --background':
    'el borde de un control pide 3:1 (WCAG 1.4.11) y da 1.26. Se conserva el look ' +
    'liviano de shadcn a conciencia: todo campo lleva <Label> asociado y anillo de ' +
    'foco de marca, así que el borde no es el único indicio de que ahí hay un input. ' +
    'Revisar ante un reporte real de gente que no encuentra los campos, o ante una ' +
    'auditoría de accesibilidad formal.',
}

export const nombreDelPar = (p: Par) => `${p.texto} sobre ${p.fondo}`

/** Los tokens del bloque :root, tal como están en el CSS. */
export function tokensDelCss(): Map<string, string> {
  const texto = readFileSync(CSS, 'utf8')
  const bloque = texto.match(/^:root\s*\{([\s\S]*?)^\}/m)
  if (!bloque) throw new Error(`${CSS} no tiene un bloque :root que se pueda leer`)
  const tokens = new Map<string, string>()
  for (const linea of bloque[1].split('\n')) {
    const m = linea.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/)
    if (m) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

/** oklch(L C H) → sRGB lineal. */
function aRgbLineal(valor: string): [number, number, number] {
  const m = valor.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/)
  if (!m) throw new Error(`no es un color oklch de tres componentes: ${valor}`)
  const [L, C, H] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ]
}

/** Luminancia relativa (WCAG 2.1), sobre los componentes lineales clampeados. */
function luminancia(valor: string): number {
  const [r, g, b] = aRgbLineal(valor).map((v) => Math.min(1, Math.max(0, v)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export type Resultado = {
  nombre: string
  ratio: number
  minimo: number
  llega: boolean
}

export function ratios(): Resultado[] {
  const tokens = tokensDelCss()
  return PARES.map((p) => {
    for (const t of [p.texto, p.fondo]) {
      if (!tokens.has(t)) throw new Error(`${CSS} no define ${t}, que PARES nombra`)
    }
    const a = luminancia(tokens.get(p.texto)!)
    const b = luminancia(tokens.get(p.fondo)!)
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    return {
      nombre: nombreDelPar(p),
      ratio,
      minimo: p.minimo,
      // Redondeado a dos decimales antes de comparar: es lo que se publica en
      // el documento, y un par que da 4.4996 no puede figurar como 4.50 "ok".
      llega: Number(ratio.toFixed(2)) >= p.minimo,
    }
  })
}

// Sólo cuando se corre como comando, no cuando lo importa el test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  let fallan = 0
  for (const r of ratios()) {
    const exceptuado = !r.llega && EXCEPCIONES[r.nombre]
    if (!r.llega && !exceptuado) fallan++
    const estado = r.llega ? 'ok' : exceptuado ? 'excepción declarada' : 'NO LLEGA'
    console.log(
      `${r.nombre.padEnd(46)} ${r.ratio.toFixed(2).padStart(6)}  (mín ${r.minimo})  ${estado}`,
    )
  }
  process.exit(fallan === 0 ? 0 : 1)
}
```

- [ ] **Step 5: Sumar el comando a package.json**

En `"scripts"`, después de `"usuario:clave"`:

```json
    "contraste": "tsx scripts/contraste.mts",
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `npx vitest run test/contraste.test.ts`
Expected: 6 passed.

Run: `npm run contraste`
Expected: diez líneas, nueve `ok` y `--input sobre --background` con `excepción declarada`, y código de salida 0.

- [ ] **Step 7: Gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo verde.

- [ ] **Step 8: Commit**

```bash
git add scripts/contraste.mts test/contraste.test.ts docs/sistema-de-diseno.md package.json
git commit -m "feat(a11y): calcular el contraste en vez de transcribirlo

La tabla del documento decía 'medido, no estimado a ojo' y tenía cuatro de
diez ratios que no correspondían a los tokens del CSS. Corregir los números
no arreglaba la causa: estaban pegados a mano.

Ahora el cálculo sale de los tokens reales y el test compara la tabla contra
él. La excepción de --input pasa de ser una nota en un .md a una entrada con
razón escrita que el gate conoce: el día que se cierre, sobra y el test lo dice."
```

---

## Self-Review

**Cobertura del spec**

| Sección del spec | Task |
|---|---|
| Borrar el bloque `.dark` | 1 |
| Borrar `--sidebar-*` y `--chart-*` y sus mapeos | 1 |
| `@custom-variant dark` se queda, con su porqué | 1 (comentario en el CSS + caso de test) |
| `docs/sistema-de-diseno.md` con tabla normativa | 2 |
| Test bidireccional | 2 (los dos casos) |
| Test que falla cerrado con tabla vacía | 2 (caso), 4 Step 2 (verificado por efecto) |
| Tripwire de `.dark` y `@custom-variant` | 1 (casos), 4 Step 1 #4 (verificado) |
| Paleta: `primary`, `ring`, `accent`, `accent-foreground` | 3 |
| Corrección de `muted-foreground` 0.556 → 0.547 | 3 |
| Excepción escrita de `--input` | 3, Step 4 |
| Tabla de contraste medida | 3, Step 4 |
| Tipografía: pila, 3 pesos, tabulares, `text-base md:text-sm` | 2, Step 3 |
| Espaciado: subconjunto y densidad media en números | 2, Step 3 |
| Dónde irían éxito y advertencia | 2, Step 3 |
| Nada de rediseñar pantallas | Ninguna task toca `.tsx` |

**Sin placeholders:** cada step trae el contenido exacto o el comando exacto. Las dos ediciones que no llevan prosa literal (Task 4 Steps 4 y 5) dicen qué tiene que decir el texto, en qué archivo y en qué sección — que es lo especificable sin escribirle la prosa al implementador.

**Consistencia de nombres:** `tokensDelDoc()` y `tokensDelCss()` se definen en la Task 2 y se nombran igual en la Task 3 Step 1. Los marcadores `<!-- tokens:inicio -->` / `<!-- tokens:fin -->` son el mismo string en el parser (Task 2 Step 1), en el documento (Task 2 Step 3) y en la Task 4 Step 2. `oklch(0.37 0.10 287)` se escribe con el cero final en las tres apariciones —CSS, tabla normativa y tabla de "dónde entra"— porque el test compara strings exactos, y eso está dicho en *Global Constraints*.

**Un riesgo que el plan asume a conciencia:** la Task 2 escribe en la tabla los valores grises que la Task 3 cambia, así que cinco filas se tocan dos veces. Es deliberado y está justificado arriba — compra que el diff de la Task 3 sea puro diseño y que el mecanismo quede probado contra un estado conocido antes de que dependa de él.
