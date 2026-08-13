# La paleta oscura — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la paleta clara de Arándano por la paleta oscura derivada de la maqueta *Diseño MVP Arándano*, sin reponer el mecanismo de modo oscuro que se borró, y aplicar los deltas estructurales que la maqueta trae.

**Architecture:** Los valores del único bloque `:root` de `app/globals.css` se reemplazan en su lugar — sin bloque `.dark`, sin `@media`, sin toggle. Como la aplicación no tiene un solo color hardcodeado, ese cambio repinta todas las pantallas. Lo que no se arregla solo son los lugares donde un token se usaba por su *luminosidad* y no por su rol: el flip de `--primary-foreground`, el sombreado de la persiana y el hover del botón. Cada uno se resuelve explícitamente.

**Tech Stack:** Next.js App Router, Tailwind v4 (`@theme inline`), shadcn/ui copiado al repo, módulos CSS, vitest, `scripts/contraste.mts` como calculadora de contraste.

**Spec:** `docs/superpowers/specs/2026-08-13-paleta-oscura-design.md`

## Global Constraints

- **Un solo `:root`, de primer nivel.** `tokensDelCss()` tira error si aparece un segundo o si queda anidado en un `@media`. Nunca agregar un bloque `.dark`.
- **Hue 287** en todos los tokens salvo `--destructive` (hue 22).
- **El tinte de los neutros llega hasta croma 0.030.** `--accent` (0.060) es la única excepción.
- **Todo token del CSS tiene que estar en la tabla de `docs/sistema-de-diseno.md` con el mismo valor**, y viceversa. Los dos casos de `test/sistema-de-diseno.test.ts` lo comprueban en las dos direcciones.
- **La tabla de contraste del documento se regenera desde `npm run contraste`**, nunca se transcribe a mano.
- **Los ratios se publican redondeados a dos decimales**, tal como los imprime el script.
- **Cero cambios de comportamiento**: sin tocar `lib/**`, server actions, schema ni permisos. La única consulta nueva es el conteo de stock negativo de la Task 5.
- **La tipografía no se toca**: ni la pila del sistema, ni Archivo, ni los tamaños de la escala.
- Correr los tests con `npm test`. Typecheck con `npx tsc --noEmit`. No existe un script `typecheck`.

---

### Task 1: La paleta y su documento

El cambio atómico. No se puede partir: cambiar los tokens sin cambiar `PARES` y las dos tablas deja los tests en rojo, y cambiarlos sin mudar `--primary-foreground` deja el login con texto negro sobre paño oscuro.

**Files:**
- Modify: `app/globals.css` (bloque `:root`, `@theme inline`, `@layer base`)
- Modify: `docs/sistema-de-diseno.md` (tabla de tokens, tabla de contraste, tres pasajes de prosa)
- Modify: `scripts/contraste.mts` (`PARES`, `EXCEPCIONES`)
- Modify: `components/ui/button.tsx:12`
- Modify: `app/login/persiana.module.css` (4 usos de `--primary-foreground`)
- Modify: `app/sitio/cierre.module.css:27`
- Test: `test/sistema-de-diseno.test.ts` (un caso nuevo), `test/contraste.test.ts` (existente, no se edita)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: el token `--primary-hover` (`oklch(0.72 0.105 287)`) y la utilidad `bg-primary-hover`; `--marca` en `oklch(0.32 0.095 287)` (hex `#312860`), que la Task 3 compara contra el OG; `--card` en `oklch(0.245 0.028 287)`, que la Task 4 usa de fondo para los tiles.

- [ ] **Step 1: Ver el estado verde del que se parte**

Run: `npm test 2>&1 | tail -20`
Expected: PASS. Es la línea de base — si algo ya viene rojo, no es de este ciclo.

- [ ] **Step 2: Reemplazar el bloque `:root` de `app/globals.css`**

Reemplazar el bloque `:root` entero (líneas 69–95) por:

```css
:root {
  --background: oklch(0.214 0.025 287);
  --foreground: oklch(0.935 0.008 287);
  --card: oklch(0.245 0.028 287);
  --card-foreground: oklch(0.935 0.008 287);
  --popover: oklch(0.245 0.028 287);
  --popover-foreground: oklch(0.935 0.008 287);
  --primary: oklch(0.66 0.124 287);
  --primary-foreground: oklch(0.20 0.03 287);
  /* El hover del botón de acción. Es un token y no `bg-primary/80` porque sobre
     fondo oscuro la opacidad acerca el botón AL FONDO: el control retrocedía
     cuando lo apuntabas, y encima el par daba 4.08. Éste aclara, y da 7.11. */
  --primary-hover: oklch(0.72 0.105 287);
  /* El arándano como SUPERFICIE, no como control: el paño de la persiana del
     login y la franja de cierre del sitio. Sube de 0.28 a 0.32 porque contra un
     fondo de 0.214 el valor viejo no se despegaba — el paño y el fondo eran el
     mismo material. Ver docs/sistema-de-diseno.md, "El arándano como
     superficie". */
  --marca: oklch(0.32 0.095 287);
  --secondary: oklch(0.30 0.025 287);
  --secondary-foreground: oklch(0.935 0.008 287);
  --muted: oklch(0.268 0.024 287);
  --muted-foreground: oklch(0.70 0.030 287);
  /* El único neutral que pasa de croma 0.030: es la fila seleccionada, y tiene
     que distinguirse de --muted sin depender sólo de la luminosidad. */
  --accent: oklch(0.27 0.060 287);
  --accent-foreground: oklch(0.66 0.124 287);
  --destructive: oklch(0.70 0.160 22);
  --border: oklch(0.381 0.019 287);
  --input: oklch(0.381 0.019 287);
  --ring: oklch(0.66 0.124 287);
  --radius: 0.625rem;
}
```

- [ ] **Step 3: Escribir el caso que exige `color-scheme`, y verlo fallar**

Agregar a `test/sistema-de-diseno.test.ts`, dentro del `describe('el CSS no arrastra tokens muertos')`, un quinto caso:

```ts
  it('declara color-scheme: dark', () => {
    // Sin esta declaración el navegador pinta de claro todo lo que la hoja de
    // estilos no controla: los scrollbars, el selector nativo de
    // <input type="date"> —que /ventas usa en Desde y Hasta— y el lienzo antes
    // del primer paint, que es un flash blanco en cada carga. Es un modo de
    // falla que sólo se ve en un navegador de verdad, nunca en jsdom, así que
    // el único lugar donde puede quedar atrapado es acá.
    expect(
      css,
      'app/globals.css no declara color-scheme: dark. La paleta es oscura, así ' +
        'que los controles nativos y el lienzo del primer paint quedan claros.',
    ).toMatch(/color-scheme:\s*dark/)
  })
```

Run: `npx vitest run test/sistema-de-diseno.test.ts -t 'color-scheme'`
Expected: FAIL — `app/globals.css` todavía no la declara.

- [ ] **Step 4: Sumar la entrada de `@theme inline` y `color-scheme`**

En `@theme inline`, inmediatamente después de la línea `--color-primary: var(--primary);`, agregar:

```css
  --color-primary-hover: var(--primary-hover);
```

Sin esta línea no existe la utilidad `hover:bg-primary-hover` y el Step 7 no hace nada. Con ella, el token queda referenciado por una utilidad, que es lo que el caso *no quedan tokens muertos* exige.

En `@layer base`, agregar la declaración a la regla `html` existente:

```css
  html {
    @apply font-sans;
    /* Le dice al navegador que pinte de oscuro lo que la hoja de estilos no
       controla: scrollbars, el selector nativo de <input type="date"> —que
       /ventas usa en Desde y Hasta— y el lienzo antes del primer paint, que
       sin esto es un flash blanco en cada carga. Va acá y no en :root para que
       el bloque de tokens siga conteniendo tokens y nada más. */
    color-scheme: dark;
  }
```

- [ ] **Step 5: Correr los tests y verificar que fallan donde tienen que fallar**

Run: `npm test 2>&1 | grep -E "✓|×|FAIL|→" | head -30`
Expected: el caso de `color-scheme` ahora **pasa**, y quedan en FAIL `test/sistema-de-diseno.test.ts` (*todo token del documento existe en el CSS, con el mismo valor* — el doc todavía declara los claros; *todo token del CSS está documentado* — `--primary-hover` no está en la tabla) y `test/contraste.test.ts` (*el documento declara el ratio que el cálculo produce*). Ese rojo es la prueba de que el mecanismo mira de verdad los tokens nuevos.

- [ ] **Step 6: Actualizar la tabla de tokens del documento**

En `docs/sistema-de-diseno.md`, reemplazar el contenido entre `<!-- tokens:inicio -->` y `<!-- tokens:fin -->` por:

```markdown
| Token | Valor |
|---|---|
| `--background` | `oklch(0.214 0.025 287)` |
| `--foreground` | `oklch(0.935 0.008 287)` |
| `--card` | `oklch(0.245 0.028 287)` |
| `--card-foreground` | `oklch(0.935 0.008 287)` |
| `--popover` | `oklch(0.245 0.028 287)` |
| `--popover-foreground` | `oklch(0.935 0.008 287)` |
| `--primary` | `oklch(0.66 0.124 287)` |
| `--primary-foreground` | `oklch(0.20 0.03 287)` |
| `--primary-hover` | `oklch(0.72 0.105 287)` |
| `--marca` | `oklch(0.32 0.095 287)` |
| `--secondary` | `oklch(0.30 0.025 287)` |
| `--secondary-foreground` | `oklch(0.935 0.008 287)` |
| `--muted` | `oklch(0.268 0.024 287)` |
| `--muted-foreground` | `oklch(0.70 0.030 287)` |
| `--accent` | `oklch(0.27 0.060 287)` |
| `--accent-foreground` | `oklch(0.66 0.124 287)` |
| `--destructive` | `oklch(0.70 0.160 22)` |
| `--border` | `oklch(0.381 0.019 287)` |
| `--input` | `oklch(0.381 0.019 287)` |
| `--ring` | `oklch(0.66 0.124 287)` |
| `--radius` | `0.625rem` |
```

- [ ] **Step 7: Cambiar el hover del botón**

En `components/ui/button.tsx`, en el variante `default` (línea 12):

```
-        default: "bg-primary text-primary-foreground hover:bg-primary/80",
+        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
```

No tocar los otros variantes. `secondary` ya usa `color-mix(in oklch, var(--secondary), var(--foreground) 5%)`, que sobre fondo oscuro aclara — anda para el lado correcto sin cambios.

- [ ] **Step 8: Mudar los siete usos de `--primary-foreground` que significaban "el color claro"**

> **Corregido durante la ejecución.** Este paso decía *cinco* y son **siete**: el
> conteo original miró los módulos CSS y se salteó dos utilidades de Tailwind en
> un `.tsx` — `text-primary-foreground` y `text-primary-foreground/70` en
> `app/sitio/secciones.tsx`, sobre el paño de `--marca` de la landing. Post-flip
> daban 1.39:1 en el título que convierte. Los dos van al final de este step.

En `app/login/persiana.module.css`, cuatro cambios:

```
-  --brillo: color-mix(in srgb, var(--primary-foreground) 7%, transparent);
+  --brillo: color-mix(in srgb, var(--foreground) 7%, transparent);
```
```
-  background-color: color-mix(in srgb, var(--primary-foreground) 16%, transparent);
+  background-color: color-mix(in srgb, var(--foreground) 16%, transparent);
```
```
-  /* 7.69:1 sobre --marca, medido en scripts/contraste.mts. */
-  color: color-mix(in srgb, var(--primary-foreground) 70%, transparent);
+  /* 6.13:1 sobre --marca, medido en scripts/contraste.mts. */
+  color: color-mix(in srgb, var(--foreground) 70%, transparent);
```
```
-  color: var(--primary-foreground);
+  color: var(--foreground);
```

En `app/sitio/cierre.module.css`:

```
-/* La firma sobre el paño, al pie de la franja. 7.69:1 sobre --marca, medido en
-   scripts/contraste.mts — es el mismo par que ya usa el login. */
+/* La firma sobre el paño, al pie de la franja. 6.13:1 sobre --marca, medido en
+   scripts/contraste.mts — es el mismo par que ya usa el login. */
```
```
-  color: color-mix(in srgb, var(--primary-foreground) 70%, transparent);
+  color: color-mix(in srgb, var(--foreground) 70%, transparent);
```

El `--surco` y el `background-color` de `.persiana` **no se tocan en esta task** — son la Task 2.

- [ ] **Step 9: Actualizar `PARES` y `EXCEPCIONES`**

En `scripts/contraste.mts`, tres cambios en `PARES`.

Reemplazar el par del hover:

```
-  // El hover del botón de acción — el "Entrar" del login (components/ui/button.tsx).
-  { texto: '--primary-foreground', fondo: '--primary', alfaFondo: 0.8, minimo: 4.5 },
+  // El hover del botón de acción — el "Entrar" del login (components/ui/button.tsx).
+  // Es un token y no una opacidad desde el ciclo de la paleta oscura: sobre
+  // fondo oscuro `bg-primary/80` acercaba el botón al fondo, o sea que el
+  // control retrocedía al apuntarlo, y el par daba 4.08.
+  { texto: '--primary-foreground', fondo: '--primary-hover', minimo: 4.5 },
```

Reemplazar los dos pares de `--marca`:

```
-  { texto: '--primary-foreground', fondo: '--marca', minimo: 4.5 },
-  { texto: '--primary-foreground', fondo: '--marca', alfaTexto: 0.7, minimo: 4.5 },
+  { texto: '--foreground', fondo: '--marca', minimo: 4.5 },
+  { texto: '--foreground', fondo: '--marca', alfaTexto: 0.7, minimo: 4.5 },
```

Y actualizar el comentario que está arriba de esos dos pares: donde dice "El nombre del local va opaco", sigue siendo cierto, pero el token cambió — reemplazar la mención de `--primary-foreground` por `--foreground` en la prosa del comentario.

Agregar un par nuevo, inmediatamente después de `{ texto: '--destructive', fondo: '--card', alfaTexto: 0.9, minimo: 4.5 }`:

```ts
  // El botón "Desactivar artículo" (app/(app)/inventario/formularios.tsx), que
  // es `bg-destructive/10 text-destructive` en components/ui/button.tsx. Existía
  // desde el ciclo de inventario y ningún par lo cubría: con la paleta clara
  // zafaba, y con una nueva merece medirse en vez de suponerse.
  { texto: '--destructive', fondo: '--destructive', alfaFondo: 0.1, minimo: 4.5 },
```

Y reescribir la razón de la excepción en `EXCEPCIONES`:

```ts
export const EXCEPCIONES: Record<string, string> = {
  '--input sobre --background':
    'el borde de un control pide 3:1 (WCAG 1.4.11) y da 1.77 — mejor que el 1.26 ' +
    'de la paleta clara, pero todavía corto. Se conserva el borde tenue que usa la ' +
    'maqueta a conciencia: todo campo lleva <Label> asociado y anillo de foco de ' +
    'marca, así que el borde no es el único indicio de que ahí hay un input. ' +
    'Revisar ante un reporte real de gente que no encuentra los campos, o ante una ' +
    'auditoría de accesibilidad formal.',
}
```

- [ ] **Step 10: Regenerar la tabla de contraste desde el script**

Run: `npm run contraste`
Expected: 17 líneas, todas `ok` salvo `--input sobre --background`, que dice `excepción declarada`. El comando sale con 0.

Con esa salida, reemplazar el contenido entre `<!-- contraste:inicio -->` y `<!-- contraste:fin -->` en `docs/sistema-de-diseno.md`. Los ratios se copian de la salida del script, no se estiman. La tabla queda así:

```markdown
| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 14.63 | 4.5 | ok |
| `--foreground` sobre `--muted` | 12.63 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 6.59 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 5.69 | 4.5 | ok |
| `--muted-foreground` sobre `--accent` | 5.69 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 5.64 | 4.5 | ok |
| `--primary-foreground` sobre `--primary-hover` | 7.11 | 4.5 | ok |
| `--foreground` sobre `--marca` | 10.83 | 4.5 | ok |
| `--foreground/70` sobre `--marca` | 6.13 | 4.5 | ok |
| `--primary` sobre `--background` | 5.49 | 4.5 | ok |
| `--primary` sobre `--accent` | 4.74 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 6.31 | 4.5 | ok |
| `--destructive` sobre `--background` | 6.14 | 4.5 | ok |
| `--destructive/90` sobre `--card` | 4.86 | 4.5 | ok |
| `--destructive` sobre `--destructive/10` | 5.36 | 4.5 | ok |
| `--input` sobre `--background` | 1.77 | 3.0 | **excepción declarada** |
| `--ring` sobre `--background` | 5.49 | 3.0 | ok |
```

**Si algún número de la salida difiere del de arriba, gana la salida del script** — y avisá, porque significa que un token quedó distinto del que este plan especifica.

- [ ] **Step 11: Corregir la prosa del documento que dejó de ser cierta**

Tres pasajes de `docs/sistema-de-diseno.md`.

**a) La regla de croma 0**, en la sección *La referencia*. Reemplazar:

> **El color de un arándano**: el azul-violeta profundo de la fruta. Entra en tres lugares y en ninguno más — acciones, foco y selección. Todo el resto es gris neutro puro. La contención es la decisión, no una etapa: es lo que menos cansa en una pantalla que se mira ocho horas, y lo que deja margen para que el rojo de un error se destaque de verdad.

por:

> **El color de un arándano**: el azul-violeta de la fruta, sobre un fondo oscuro. Entra saturado en tres lugares y en ninguno más — acciones, foco y selección. Todo el resto es gris, pero **gris tintado del mismo hue**: los neutros llevan croma hasta 0.030 a hue 287, porque sobre fondo oscuro un gris de croma 0 lee apagado. La contención es la decisión, no una etapa: es lo que menos cansa en una pantalla que se mira ocho horas, y lo que deja margen para que el rojo de un error se destaque de verdad.
>
> **El límite del tinte es 0.030.** Un token de cromo por encima de eso deja de ser un gris tintado y pasa a ser un color, y ahí la contención se empieza a perder de a poco. `--accent` (0.060) es la excepción declarada, por la misma razón por la que ya era el único tintado en la paleta clara: es la fila seleccionada, y tiene que distinguirse de `--muted` sin depender sólo de la luminosidad.

**b) La tabla *Dónde entra el arándano***. Reemplazar los hexes y sumar la fila del hover:

```markdown
| Token | Hex | Dónde se ve |
|---|---|---|
| `--primary` | `#8e85da` | Botón de acción, links |
| `--primary-hover` | `#a09ae3` | El botón de acción, apuntado |
| `--ring` | `#8e85da` | Anillo de foco — lo más visible al operar con teclado |
| `--accent` | `#252142` | Fila seleccionada, hover. El neutral más tintado |
| `--marca` | `#312860` | El paño de la persiana del login y la franja de cierre de la landing |
```

Y en el párrafo que sigue, donde dice "El hue es **287** en los cuatro", cambiar "cuatro" por "cinco".

**c) La sección *El arándano como superficie***. Reemplazar el párrafo que arranca con "**Por qué un token nuevo y no `--primary` en un `<section>`.**" — los números 0.28 y 0.37 quedaron viejos:

> **Por qué un token nuevo y no `--primary` en un `<section>`.** Si el paño fuera exactamente el color del botón, el botón dejaría de ser lo único accionable a la vista, que es justo lo que la contención compra. `--marca` es **más oscuro** que `--primary` —0.32 contra 0.66 de luminosidad— y eso lo aleja de "control" y lo acerca a "material". Sobre la paleta clara la distancia era la misma en la otra dirección: 0.28 contra 0.37. El hue sigue siendo **287**, igual que los otros: es el mismo arándano a otra distancia, no un color nuevo.
>
> **Y sube de 0.28 a 0.32 con la paleta oscura por una razón mecánica**: contra un fondo de 0.214, un paño de 0.28 casi no se despega — paño y fondo pasan a ser el mismo material. 0.32 es además la luminosidad del único paño saturado de la maqueta (`#262a60`), así que el número no sale de la nada.

Reemplazar también, en esa misma sección, las dos menciones de los pares medidos si nombran `--primary-foreground` sobre `--marca`: ahora el par es `--foreground` sobre `--marca`.

**d) El párrafo del par más justo**, en *Contraste*. Reemplazar:

> **El par más justo es `--muted-foreground` sobre `--accent`, con 4.53.** Es el que fija cuánto más se puede oscurecer `--accent` sin romper nada, y por eso está medido: la fila seleccionada de las pantallas que vienen es exactamente donde ese par se va a ver.

por:

> **El par más justo es `--primary` sobre `--accent`, con 4.74** — el violeta sobre la fila seleccionada. Es el que fija cuánto más se puede aclarar `--accent` antes de romper algo, y ocupa el lugar que en la paleta clara tenía `--muted-foreground` sobre `--accent`.

Y en el punto 2 de la lista de defectos heredados de shadcn, actualizar el 1.26 a 1.77 y la razón, para que coincida con el texto nuevo de `EXCEPCIONES`.

- [ ] **Step 12: Correr todo y verificar verde**

Run: `npm test 2>&1 | tail -20 && npx tsc --noEmit && npm run contraste`
Expected: los tres en verde. En particular `test/sistema-de-diseno.test.ts` con sus **nueve** casos —los ocho que ya tenía más el de `color-scheme` que suma esta task— y `test/contraste.test.ts` con los seis.

- [ ] **Step 13: Commit**

```bash
git add app/globals.css docs/sistema-de-diseno.md scripts/contraste.mts \
        components/ui/button.tsx app/login/persiana.module.css app/sitio/cierre.module.css \
        test/sistema-de-diseno.test.ts
git commit -m "feat(diseño): la paleta oscura

Reemplaza los valores del único :root — sin bloque .dark, sin @media y sin
toggle. Hue 287 en todo salvo el rojo del error, con los neutros tintados
hasta croma 0.030.

--primary-foreground se da vuelta (casi blanco a casi negro), porque --primary
también es el color de los links y tiene que llegar a 4.5 sobre el fondo: un
violeta oscuro no llega. Los siete usos que lo tomaban por 'el color claro'
se mudan a --foreground.

Entra --primary-hover: sobre fondo oscuro bg-primary/80 acercaba el botón al
fondo —el control retrocedía al apuntarlo— y daba 4.08. El token aclara y da
7.11.

Suma color-scheme: dark, sin el cual los scrollbars, el selector nativo de
fecha de /ventas y el lienzo del primer paint seguían pintándose de claro."
```

---

### Task 2: El sombreado de la persiana

La Task 1 dejó la persiana con los tokens correctos pero el relieve invertido: dos usos de `--foreground` estaban ahí porque era **el color oscuro**.

**Files:**
- Modify: `app/login/persiana.module.css:49` y `:53`

**Interfaces:**
- Consumes: `--background` en `oklch(0.214 0.025 287)` y `--marca` en `oklch(0.32 0.095 287)`, de la Task 1.
- Produces: nada que otra task consuma.

- [ ] **Step 1: Invertir las dos capas que dependían de la luminosidad**

```
-  --surco: color-mix(in srgb, var(--foreground) 26%, transparent);
+  /* Desde --background y no desde --foreground: el surco es una línea OSCURA
+     sobre el paño, y con la paleta oscura --foreground es casi blanco. Sin este
+     cambio quedaban dos brillos paralelos y ningún relieve. El 45% es más que
+     el 26% de la paleta clara porque la distancia entre --background (0.214) y
+     --marca (0.32) es menor que la que había entre negro y el paño. */
+  --surco: color-mix(in srgb, var(--background) 45%, transparent);
```

```
   /* Un poco más oscuro que el paño de atrás: si fueran el mismo color, el
      movimiento no se leería como un objeto que sube sino como un parpadeo. */
-  background-color: color-mix(in srgb, var(--foreground) 9%, var(--marca));
+  background-color: color-mix(in srgb, var(--background) 22%, var(--marca));
```

El `--brillo` y el travesaño ya quedaron en `--foreground` en la Task 1, y ahí está bien: los dos son las capas claras.

- [ ] **Step 2: Verificar que no quedó ningún uso de `--foreground` como color oscuro**

Run: `grep -n 'var(--foreground)\|var(--background)\|var(--marca)' app/login/persiana.module.css`
Expected: exactamente siete líneas.

- **Cuatro con `--foreground`**, todas capas claras: `--brillo` (7%), el travesaño (16%), la firma (70%) y el `color` del nombre.
- **Dos con `--background`**, las dos capas oscuras: `--surco` (45%) y el `background-color` de `.persiana` (22%, mezclado con `--marca`) — esta última matchea por partida doble, y es una sola línea.
- **Una con `--marca` sola**: el `background-color` de `.pano`, el paño de atrás. No se toca en ninguna de las dos tasks.
- Ninguna con `--primary-foreground`, que la Task 1 ya sacó de este archivo.

Si aparece `--foreground` en `--surco` o en el `background-color` de `.persiana`, el Step 1 no se aplicó.

- [ ] **Step 3: Correr los tests**

Run: `npm test 2>&1 | tail -10`
Expected: PASS. Ningún test mira este archivo — el relieve se juzga a ojo en la Task 7, y este step sólo confirma que no se rompió nada más.

- [ ] **Step 4: Commit**

```bash
git add app/login/persiana.module.css
git commit -m "fix(login): el relieve de la persiana, que la paleta oscura invertía

El surco y el fondo del paño se componían desde --foreground porque era el
color oscuro. Con la paleta oscura --foreground es casi blanco: el surco se
volvía un segundo brillo y el paño quedaba más claro que el de atrás, o sea
sin relieve y sin la sensación de un objeto que sube. Los dos pasan a
componerse desde --background.

Las proporciones (45% y 22%) son el punto de partida y se ajustan en la
verificación visual: el contraste entre dos mezclas del mismo paño no es algo
que la tabla mida."
```

---

### Task 3: La tarjeta social, atada al token

`app/opengraph-image.tsx` duplica dos colores a mano porque Satori no resuelve custom properties. El propio archivo lo advierte y nadie escribió el test.

**Files:**
- Modify: `scripts/contraste.mts` (exportar `aRgb`)
- Modify: `app/opengraph-image.tsx:29-30`
- Create: `test/opengraph.test.ts`

**Interfaces:**
- Consumes: `--marca` y `--foreground` de la Task 1; `tokensDelCss()` de `scripts/contraste.mts`.
- Produces: `aRgb(valor: string): [number, number, number]` exportado desde `scripts/contraste.mts`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/opengraph.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
// La misma conversión que usa la tabla de contraste, no una copia: dos
// implementaciones de oklch → sRGB se desincronizan, y el día que pase, este
// test compararía contra un color que la aplicación no pinta.
import { tokensDelCss, aRgb } from '@/scripts/contraste.mts'

const OG = 'app/opengraph-image.tsx'

/** El token, como los seis dígitos hex que Satori necesita. */
function hexDelToken(nombre: string): string {
  const valor = tokensDelCss().get(nombre)
  if (!valor) throw new Error(`app/globals.css no define ${nombre}`)
  return '#' + aRgb(valor).map((b) => b.toString(16).padStart(2, '0')).join('')
}

describe('la tarjeta social no se desincroniza de la paleta', () => {
  const fuente = readFileSync(OG, 'utf8')

  // Satori (el motor de next/og) no resuelve var(--marca), así que el hex está
  // duplicado a mano a propósito. El archivo lo advertía desde el ciclo de la
  // landing —"se desincroniza del color de marca sin que nadie se entere"— y
  // hasta el ciclo de la paleta oscura nada lo comprobaba: el repintado entero
  // habría dejado la tarjeta con el arándano viejo, en silencio.
  it('el fondo es exactamente --marca', () => {
    const esperado = hexDelToken('--marca')
    expect(
      fuente,
      `${OG} tiene que pintar backgroundColor: '${esperado}', que es --marca ` +
        `convertido a hex. Si el token cambió, este archivo es el segundo lugar a tocar.`,
    ).toContain(`backgroundColor: '${esperado}'`)
  })

  it('el texto es exactamente --foreground', () => {
    const esperado = hexDelToken('--foreground')
    expect(
      fuente,
      `${OG} tiene que pintar color: '${esperado}', que es --foreground convertido ` +
        `a hex. Usaba --primary-foreground, que con la paleta oscura pasó a ser casi ` +
        `negro: texto negro sobre el paño de marca.`,
    ).toContain(`color: '${esperado}'`)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/opengraph.test.ts`
Expected: FAIL. Primero por el import — `aRgb` no está exportado — y después, una vez exportado, porque el archivo tiene `#271f52` y `#fafafa`.

- [ ] **Step 3: Exportar `aRgb`**

En `scripts/contraste.mts`, agregar `export` a la función y sumar la razón al docblock que ya tiene:

```
-function aRgb(valor: string): Rgb {
+export function aRgb(valor: string): Rgb {
```

Y arriba del docblock existente, agregar una línea: `Exportada desde el ciclo de la paleta oscura: test/opengraph.test.ts la usa para comparar los hexes que Satori necesita contra los tokens reales.`

- [ ] **Step 4: Actualizar los dos hexes**

En `app/opengraph-image.tsx`:

```
-          backgroundColor: '#271f52',
-          color: '#fafafa',
+          backgroundColor: '#312860',
+          color: '#e9e9ef',
```

Y actualizar el docblock del archivo, que hoy dice "esta nota es el recordatorio":

```
- * el mismo que documenta docs/sistema-de-diseno.md para --marca y para
- * --primary-foreground; si algún día ese token cambia, este archivo es el
- * segundo lugar a tocar, y esta nota es el recordatorio.
+ * el mismo que documenta docs/sistema-de-diseno.md para --marca y para
+ * --foreground. La nota ya no es el único recordatorio: test/opengraph.test.ts
+ * convierte los tokens reales a hex y compara contra este archivo, así que un
+ * cambio de paleta que se olvide de acá rompe el build en vez de servir en
+ * silencio una tarjeta con el color viejo.
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run test/opengraph.test.ts`
Expected: PASS, los dos casos.

- [ ] **Step 6: Verificar que el test atrapa de verdad**

Cambiar a mano `backgroundColor: '#312860'` por `'#312861'`, correr `npx vitest run test/opengraph.test.ts`, comprobar que **falla**, y revertir. Un test que nunca se vio fallar no es evidencia de nada.

- [ ] **Step 7: Correr todo y commitear**

Run: `npm test 2>&1 | tail -10 && npx tsc --noEmit`
Expected: verde.

```bash
git add scripts/contraste.mts app/opengraph-image.tsx test/opengraph.test.ts
git commit -m "test(og): atar los hexes de la tarjeta social a los tokens

Satori no resuelve var(--marca), así que app/opengraph-image.tsx duplica dos
colores a mano. El archivo lo advertía desde el ciclo de la landing y nada lo
comprobaba: este repintado le habría dejado el arándano viejo en silencio.

El test convierte los tokens reales a hex con la misma función que usa la
tabla de contraste —exportada, no copiada— y compara contra el archivo.

De paso corrige el color del texto: usaba --primary-foreground, que con la
paleta oscura pasó a ser casi negro."
```

---

### Task 4: Ventas — tiles, subtítulo y chips

**Files:**
- Modify: `app/(app)/ventas/page.tsx`
- Modify: `scripts/contraste.mts` (`PARES`: un par nuevo)
- Modify: `docs/sistema-de-diseno.md` (tabla de contraste regenerada)

**Interfaces:**
- Consumes: `--card` (`oklch(0.245 0.028 287)`) y `--primary` (`oklch(0.66 0.124 287)`) de la Task 1.
- Produces: nada que otra task consuma.

- [ ] **Step 1: Sumar el par `--primary sobre --card` y regenerar la tabla**

Los tiles ponen el rótulo en violeta sobre `--card`, una combinación que ningún par cubría. En `scripts/contraste.mts`, después de `{ texto: '--primary', fondo: '--accent', minimo: 4.5 }`:

```ts
  // El rótulo de los tiles de /ventas, que van sobre --card y no sobre el
  // fondo. Es texto chico (10 px), así que el par vale más que de costumbre.
  { texto: '--primary', fondo: '--card', minimo: 4.5 },
```

Run: `npm run contraste`
Expected: la línea nueva da `5.08  (mín 4.5)  ok`.

Agregar la fila a la tabla del documento, entre marcadores, respetando el orden de `PARES`:

```markdown
| `--primary` sobre `--card` | 5.08 | 4.5 | ok |
```

- [ ] **Step 2: Correr `test/contraste.test.ts` y verificar verde**

Run: `npx vitest run test/contraste.test.ts`
Expected: PASS. Si falla en *el documento no declara pares que el cálculo no cubre* o en *el documento declara el ratio que el cálculo produce*, la fila quedó mal escrita.

- [ ] **Step 3: Sumar el conteo de anuladas a la consulta**

En `app/(app)/ventas/page.tsx`, en el `Promise.all` (líneas 73–88), agregar un cuarto elemento:

```ts
  const [ventas, total, suma, anuladas] = await Promise.all([
    prisma.venta.findMany({
      where: donde,
      orderBy: { numero: 'desc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, numero: true, total: true, creadoEn: true, anuladaEn: true,
        usuario: { select: { nombre: true } },
      },
    }),
    prisma.venta.count({ where: donde }),
    // El total del período NO suma las anuladas: una venta anulada no es plata
    // que entró. Se dice en pantalla para que nadie tenga que deducirlo.
    prisma.venta.aggregate({ where: { ...donde, anuladaEn: null }, _sum: { total: true } }),
    // Se cuentan las anuladas y NO las cobradas: cobradas = total - anuladas es
    // aritmética sobre dos números que ya vienen de la misma transacción, así
    // que no puede dar una suma que no cierre contra el listado.
    prisma.venta.count({ where: { ...donde, anuladaEn: { not: null } } }),
  ])
```

- [ ] **Step 4: Agregar el formateador del período y el componente del tile**

Después de la función `fechaOhoy` (línea 46), agregar:

```tsx
/**
 * `YYYY-MM-DD` → "13 de agosto de 2026".
 *
 * Con el huso declarado, por lo mismo que `hoyEnArgentina`: sin él, el
 * `Date` de medianoche argentina se formatea en UTC y muestra el día anterior.
 */
function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(inicioDelDia(iso))
}

/**
 * Un tile del resumen del período.
 *
 * Van sobre --card y no sobre el fondo: es la superficie elevada que ya define
 * el sistema, y es lo que los separa del listado de abajo sin sumar un borde.
 */
function Tile({ rotulo, valor, pie }: { rotulo: string; valor: string; pie?: string }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="text-[10px] font-medium tracking-[0.1em] text-primary uppercase">
        {rotulo}
      </div>
      {/* tabular-nums en los tres, no sólo en el de plata: los tiles están uno
          al lado del otro y un dígito de ancho variable los descalza entre sí. */}
      <div className="mt-0.5 text-2xl tracking-tight tabular-nums">{valor}</div>
      {pie && <div className="mt-0.5 text-[11px] text-muted-foreground">{pie}</div>}
    </div>
  )
}
```

- [ ] **Step 5: Reemplazar el encabezado por título + subtítulo**

```tsx
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">Ventas</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {dDesde === dHasta ? fechaLarga(dDesde) : `${fechaLarga(dDesde)} — ${fechaLarga(dHasta)}`}
            {' · '}
            {total === 1 ? '1 venta' : `${total} ventas`}
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/vender">Vender</Link>
        </Button>
      </div>
```

- [ ] **Step 6: Poner los tiles arriba de la tabla y sacar la línea de abajo**

Inmediatamente después del `</form>` del filtro, y **dentro** de la rama que hoy renderiza la tabla (o sea después de `) : (` y de `<>`), agregar:

```tsx
          {/* gap-px sobre bg-border: las líneas entre tiles son el fondo que se
              ve por las juntas, no tres bordes que haya que hacer coincidir.
              w-max para que los tiles midan lo que necesitan y no se estiren a
              lo ancho de la pantalla, que los dejaría vacíos por dentro. */}
          <div className="mb-6 grid w-max grid-cols-3 gap-px overflow-hidden rounded-lg bg-border">
            <Tile
              rotulo="Total del período"
              valor={formatearPrecio((suma._sum.total ?? '0').toString())}
              pie="sin contar las anuladas"
            />
            <Tile rotulo="Ventas cobradas" valor={String(total - anuladas)} />
            <Tile rotulo="Anuladas" valor={String(anuladas)} />
          </div>
```

Y borrar el bloque que hoy vive debajo de la tabla:

```tsx
          <p className="mt-4 text-sm tabular-nums">
            Total del período, sin contar las anuladas:{' '}
            <span className="font-medium">
              {formatearPrecio((suma._sum.total ?? '0').toString())}
            </span>
          </p>
```

- [ ] **Step 7: El estado como chip**

Reemplazar la celda de estado:

```tsx
                  {/* Las anuladas se MUESTRAN: el historial tiene que poder
                      responder qué pasó, y esconderlas sería tapar la respuesta.
                      Chip y no texto suelto: en una columna de una sola palabra,
                      la forma se lee antes que el color, y quien no distingue el
                      rojo igual ve que una fila está marcada. */}
                  <td>
                    {v.anuladaEn ? (
                      <span className="inline-flex rounded-md border border-destructive px-2.5 py-0.5 text-[11px] text-destructive">
                        Anulada
                      </span>
                    ) : (
                      <span className="inline-flex rounded-md bg-muted px-2.5 py-0.5 text-[11px]">
                        Cobrada
                      </span>
                    )}
                  </td>
```

- [ ] **Step 8: Correr tests y typecheck**

Run: `npm test 2>&1 | tail -15 && npx tsc --noEmit`
Expected: verde. `scripts/smoke.sh` abre `/ventas` y asserta 200 más el nombre del local, así que un error de render acá lo atrapa el gate — pero conviene no llegar con eso roto.

- [ ] **Step 9: Commit**

```bash
git add app/\(app\)/ventas/page.tsx scripts/contraste.mts docs/sistema-de-diseno.md
git commit -m "feat(ventas): el resumen del período como tiles

Los tres números del período —total, cobradas, anuladas— pasan de una línea
suelta debajo de la tabla a tres tiles arriba, que es donde se los busca antes
de leer el listado. El conteo de anuladas es una consulta nueva; cobradas sale
de restar, para que no puedan discrepar entre sí.

El estado pasa a chip: en una columna de una sola palabra la forma se lee
antes que el color, y quien no distingue el rojo igual ve la marca.

Suma el par --primary sobre --card (5.08) a la tabla de contraste: el rótulo
de los tiles es la primera vez que el violeta se apoya en esa superficie."
```

---

### Task 5: Inventario — el subtítulo con los conteos

**Files:**
- Modify: `app/(app)/inventario/page.tsx`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nada que otra task consuma.

- [ ] **Step 1: Contar los artículos con stock negativo**

En el `Promise.all` (líneas 44–56), agregar un tercer elemento:

```ts
  const [articulos, total, negativos] = await Promise.all([
    prisma.articulo.findMany({
      where: donde,
      orderBy: { nombre: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, sku: true, nombre: true, tipo: true, precio: true,
        stock: true, desactivadoEn: true,
      },
    }),
    prisma.articulo.count({ where: donde }),
    // Sobre `donde` y no sobre toda la tabla: el conteo tiene que hablar de lo
    // que el listado está mostrando, o el subtítulo diría "3 con stock
    // negativo" mientras la búsqueda filtrada no muestra ninguno.
    // Sólo PRODUCTO: un servicio no lleva stock, y su columna es un guion.
    prisma.articulo.count({ where: { ...donde, tipo: 'PRODUCTO', stock: { lt: 0 } } }),
  ])
```

- [ ] **Step 2: Reemplazar el encabezado por título + subtítulo**

```tsx
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">Inventario</h1>
          {/* Sólo si hay algo que contar: en un local recién dado de alta, un
              "0 artículos · 0 con stock negativo" es ruido debajo del título
              justo cuando la pantalla ya tiene su propio texto de vacío. */}
          {total > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {total === 1 ? '1 artículo' : `${total} artículos`}
              {verInactivos ? '' : ' activos'}
              {negativos > 0 &&
                ` · ${negativos === 1 ? '1 con stock negativo' : `${negativos} con stock negativo`}`}
            </p>
          )}
        </div>
        {sesion.usuario.rol === 'DUENO' && (
          <Button asChild size="sm">
            <Link href="/inventario/nuevo">Artículo nuevo</Link>
          </Button>
        )}
      </div>
```

- [ ] **Step 3: Correr tests y typecheck**

Run: `npm test 2>&1 | tail -15 && npx tsc --noEmit`
Expected: verde. `test/inventario.test.ts` cubre el motor, no esta pantalla; el render lo cubre el barrido de `scripts/smoke.sh`.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/inventario/page.tsx
git commit -m "feat(inventario): el subtítulo con los conteos

Cuántos artículos hay y cuántos están en stock negativo, debajo del título.
El conteo de negativos va sobre el mismo filtro que el listado —si no, el
número hablaría de artículos que la búsqueda no muestra— y sólo cuenta
productos, porque un servicio no lleva stock."
```

---

### Task 6: Landing — filas numeradas, kickers y chip

**Files:**
- Modify: `app/sitio/secciones.tsx`
- Test: `app/sitio/landing.test.tsx` (existente — verificar que sigue pasando)

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: nada que otra task consuma.

- [ ] **Step 1: Ver qué assertan los tests de la landing**

Run: `npx vitest run app/sitio/`
Expected: PASS. Es la línea de base. Si `landing.test.tsx` busca un `h2` con el texto exacto `Lo que hace`, el Step 2 lo va a romper — y ese rojo es correcto, porque ese texto pasa a ser el kicker.

- [ ] **Step 2: Convertir `LoQueHace` a filas numeradas**

En `app/sitio/secciones.tsx`, reemplazar el cuerpo de `LoQueHace()` por:

```tsx
export function LoQueHace() {
  return (
    <section id="lo-que-hace" className={`${ANCHO} py-12`}>
      <h2 className="text-2xl font-semibold">Seis cosas, todos los días</h2>
      {/* En filas numeradas y no en una grilla de cards: seis items del mismo
          peso visual no se leen en orden, y éstos tienen uno — es la secuencia
          de un día de mostrador, de vender a mostrar. */}
      <div className="mt-8">
        {CAPACIDADES.map(([titulo, texto], i) => (
          <div
            key={titulo}
            className="grid grid-cols-[2.5rem_minmax(0,12rem)_minmax(0,1fr)] items-baseline gap-x-8 border-t border-border py-5 first:border-t-0"
          >
            {/* tabular-nums para que los seis números queden en la misma
                columna óptica: 01 y 06 tienen anchos distintos sin eso. */}
            <p className="text-sm text-primary tabular-nums">
              {String(i + 1).padStart(2, '0')}
            </p>
            <h3 className="font-medium">{titulo}</h3>
            <p className="max-w-[52ch] text-sm text-muted-foreground">{texto}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
```

`CAPACIDADES` es el array de tuplas `[titulo, texto]` que ya está arriba en el archivo y **no se toca**: los seis títulos y textos son los que ya están escritos. El `id="lo-que-hace"` sólo se agrega si la navegación de `app/sitio/landing.tsx` ancla ahí; si no, se omite.

- [ ] **Step 3: El chip del plan más elegido**

Hoy `Planes()` ya distingue al destacado con `destacado ? 'bg-accent' : undefined` en la `Card` y con un `<p className="mt-1 text-xs text-primary">el más elegido</p>` debajo del nombre. El texto ya existe: lo que cambia es que pasa a ser un chip **al lado** del nombre, no una línea debajo. Reemplazar esas dos líneas del `map`:

```tsx
-              <h3 className="font-medium">{nombre}</h3>
-              {destacado ? <p className="mt-1 text-xs text-primary">el más elegido</p> : null}
+              <div className="flex items-center justify-between gap-2">
+                <h3 className="font-medium">{nombre}</h3>
+                {destacado ? (
+                  <span className="inline-flex shrink-0 rounded-md bg-accent px-2.5 py-0.5 text-[11px] text-accent-foreground">
+                    el más elegido
+                  </span>
+                ) : null}
+              </div>
```

El chip queda `--accent-foreground` sobre `--accent`, que es `--primary` sobre `--accent`: ya medido en 4.74. Pero ojo — la card destacada **también** tiene `bg-accent`, así que el chip desaparecería contra su propio fondo. Cambiar el fondo de esa card a `bg-card` y dejar el acento sólo en el chip:

```tsx
-          <Card key={nombre} className={destacado ? 'bg-accent' : undefined}>
+          <Card key={nombre} className={destacado ? 'ring-1 ring-primary' : undefined}>
```

Es además lo que hace la maqueta: el plan destacado se marca con un borde violeta, no con un paño.

- [ ] **Step 4: Correr los tests de la landing**

Run: `npx vitest run app/sitio/ && npx tsc --noEmit`
Expected: PASS. Si `landing.test.tsx` falla porque buscaba un `h2` con el texto `Lo que hace`, ese texto ahora es el kicker: actualizar el test para que busque el kicker o el `h2` nuevo, **sin** aflojar lo que asserta.

- [ ] **Step 5: Commit**

```bash
git add app/sitio/secciones.tsx app/sitio/landing.test.tsx
git commit -m "feat(landing): las seis cosas como filas numeradas

Lo que hace pasa de seis cards a seis filas numeradas bajo el título 'Seis
cosas, todos los días', con el rótulo viejo como kicker. Es la disposición de
la maqueta: en cards, seis items del mismo peso no se leen en orden, y estos
sí tienen uno.

Suma el chip 'el más elegido' en Profesional, que el texto ya afirmaba en prosa."
```

---

### Task 7: La verificación visual

No es una task de código y no se puede saltear: es lo único que juzga si el repintado funcionó. La hace **una persona**, no un agente.

**Files:**
- Modify: `docs/sistema-de-diseno.md` (sección *Verificación visual*)
- Modify: `CLAUDE.md` (el ítem del sistema de diseño en *Próximos pasos técnicos*)

- [ ] **Step 1: Levantar dev y sembrar el canario**

Run: `docker compose -f docker/compose.dev.yml up -d`
Expected: el stack arriba en `http://100.64.81.63:3000` (la IP de Tailscale — dev no existe desde internet).

Sembrar el catálogo del tenant canario de dev con importes de **distinta cantidad de dígitos**: con montos parejos no se ve si las columnas de números bailan. Es el mismo detalle que costó tiempo en la verificación del punto de venta y está anotado en `CLAUDE.md`.

- [ ] **Step 2: Mirar las cinco superficies, en este orden**

Entrando **por el subdominio del tenant** (`http://<canario>.<host>:3000`), nunca por la IP pelada, que devuelve 404 a propósito desde el cutover por `Host`.

1. **Login** — es lo que más riesgo tiene. ¿La persiana todavía lee como una persiana, con relieve, y no como dos brillos paralelos? ¿El paño se despega del fondo? Si el relieve no convence, ajustar los porcentajes de la Task 2 (45% y 22%) y volver a mirar.
2. **`/vender`** — ¿el botón *Cobrar* se distingue del secundario de un vistazo? ¿El total en Archivo se sigue leyendo?
3. **`/ventas`** — los tiles, los chips, y el **selector de fecha abierto**, que es donde se comprueba que `color-scheme: dark` hizo efecto.
4. **`/inventario`** — el subtítulo, y el stock negativo en rojo sobre fondo oscuro.
5. **La landing del ápex** — las filas numeradas y la franja de cierre.

Y en todas: **tabular con el teclado** y comprobar que el anillo de foco se ve, y pasar el mouse por una fila de tabla para ver que la fila seleccionada se distingue de la normal.

- [ ] **Step 3: Escribir lo que se vio**

Actualizar la sección *Verificación visual* de `docs/sistema-de-diseno.md` con la fecha, qué se miró y qué se ajustó. Si algo quedó pendiente, se escribe como pendiente — no se omite.

Actualizar en `CLAUDE.md` el ítem de *Definir el sistema de diseño*: hoy dice que la verificación se cerró el 2026-08-13 sobre la paleta clara. Sumar que el ciclo de la paleta oscura la rehízo, con lo que costó tiempo.

- [ ] **Step 4: Commit**

```bash
git add docs/sistema-de-diseno.md CLAUDE.md
git commit -m "docs: la verificación visual de la paleta oscura"
```

- [ ] **Step 5: Cerrar la rama**

Correr el gate completo antes de mergear:

Run: `npm test && npx tsc --noEmit && npm run contraste && npm run lint`
Expected: los cuatro en verde.

Después, la review antes del merge — con un solo desarrollador es la única segunda mirada que existe — y recién ahí `deploy.sh`. Es un **MINOR**: el cliente ve algo distinto en cada pantalla.

---

## Notas para quien ejecute

- **El orden importa entre la 1 y la 2.** La Task 1 deja la persiana visualmente rota a propósito (los tokens correctos, el relieve invertido). No es un bug a reportar: es la Task 2.
- **Entre la Task 1 y la Task 3, la tarjeta social queda con el arándano viejo.** También es transitorio y también está previsto.
- **Ningún número de contraste se escribe a mano.** Si `npm run contraste` imprime algo distinto de lo que este plan dice, gana el script — y avisá, porque significa que un token quedó distinto del especificado.
- **Si algo obliga a tocar `lib/**`, el schema o un server action, parate.** Este ciclo no cambia comportamiento, y una necesidad así es señal de que algo se entendió mal.
