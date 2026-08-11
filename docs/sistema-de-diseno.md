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
| `--primary` | `oklch(0.37 0.10 287)` |
| `--primary-foreground` | `oklch(0.985 0 0)` |
| `--secondary` | `oklch(0.97 0 0)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` |
| `--muted` | `oklch(0.97 0 0)` |
| `--muted-foreground` | `oklch(0.547 0 0)` |
| `--accent` | `oklch(0.955 0.012 287)` |
| `--accent-foreground` | `oklch(0.37 0.10 287)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` |
| `--border` | `oklch(0.922 0 0)` |
| `--input` | `oklch(0.922 0 0)` |
| `--ring` | `oklch(0.37 0.10 287)` |
| `--radius` | `0.625rem` |

<!-- tokens:fin -->

Los marcadores de arriba y abajo no son decoración: el parser del test busca la
tabla entre ellos, porque este documento tiene otras tablas y agarrar "la
primera" se rompe el día que alguien reordene secciones.

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

Cada par de la tabla nombra los **tokens** involucrados, no colores genéricos: `--primary-foreground` es `oklch(0.985 0 0)`, distinto de "blanco puro", así que sus ratios difieren del que podría calcularse contra un 1.0.

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

## Cómo se verifica

Un test que corre y da verde no prueba que atrape nada. Antes de dar este
documento por cerrado se metieron a mano los defectos que el mecanismo tiene
que detectar, uno por vez, revirtiendo cada uno antes del siguiente, para
comprobar que el rojo es el esperado y no otro. Quedan anotados acá para que
dentro de tres meses alguien pueda saber si esto atrapó algo alguna vez, sin
tener que repetir el ejercicio.

**`test/sistema-de-diseno.test.ts`** corre la comparación de tokens entre
`app/globals.css` y la tabla normativa de este documento, en las dos
direcciones. Se corre con `npx vitest run test/sistema-de-diseno.test.ts`, y
forma parte de `npm test`.

Los cuatro defectos del gate, cada uno introducido sólo en el archivo que dice
la columna, corrido, anotado y revertido antes del siguiente:

| # | Defecto | Dónde | Caso que falló (y sólo ése) |
|---|---|---|---|
| 1 | `--ring` a `oklch(0.5 0 0)` | sólo `app/globals.css` | `todo token del documento existe en el CSS, con el mismo valor` — *"docs/sistema-de-diseno.md declara --ring: oklch(0.37 0.10 287), y app/globals.css tiene oklch(0.5 0 0)"* |
| 2 | `--ring` a `oklch(0.5 0 0)` | sólo `docs/sistema-de-diseno.md` | el mismo caso, en el sentido inverso — *"docs/sistema-de-diseno.md declara --ring: oklch(0.5 0 0), y app/globals.css tiene oklch(0.37 0.10 287)"* |
| 3 | `--inventado: oklch(0.5 0 0);` agregado a `:root` | sólo `app/globals.css` | `todo token del CSS está documentado` — *"app/globals.css define tokens que docs/sistema-de-diseno.md no declara: --inventado"* |
| 4 | `.dark { --background: oklch(0 0 0); }` pegado al final | sólo `app/globals.css` | `no hay bloque .dark` — *"volvió el bloque .dark a app/globals.css"* |

En los cuatro casos falló exactamente el renglón esperado y ningún otro; el
resto de la suite (6 de 7 tests) siguió en verde. Después de cada uno,
`git status --short` volvió a dar vacío antes de seguir con el siguiente.

**La tabla vacía.** Se borraron a mano las 19 filas de la tabla normativa,
entre `<!-- tokens:inicio -->` y `<!-- tokens:fin -->`, dejando sólo el
encabezado. El resultado no fue verde: fallaron dos casos a la vez, `la tabla
del documento no está vacía` (0 tokens parseados) y `todo token del CSS está
documentado`, esta vez con los 19 nombres del CSS completos —sin nada contra
qué compararlos, cualquier token del CSS cuenta como "no documentado". Es el
modo de falla que importa: un parser que no encuentra filas no puede devolver
un Map vacío y darse por satisfecho. Revertido con `git checkout
docs/sistema-de-diseno.md`.

**El contraste.** La tabla de arriba se escribió a mano y se desincronizó: la
review de la Task 3 encontró que cuatro de los diez ratios no correspondían a
los tokens que estaban en `app/globals.css`, y se corrigieron a mano en ese
mismo ciclo (commit `3d57397`). Corregir los números no arreglaba la causa
—seguían siendo transcriptos—, así que la Task 5 sumó `scripts/contraste.mts`,
que calcula los diez ratios WCAG desde los tokens reales de `app/globals.css`
—oklch → sRGB lineal → luminancia → ratio— en vez de copiarlos a mano; se
corre suelto con `npm run contraste`. `test/contraste.test.ts` compara esa
salida contra la tabla del documento y forma parte de `npm test`.

Lo que la review de la Task 5 verificó del mecanismo nuevo, mutando el
documento y el CSS durante la review y confirmando cada rojo (no se re-corrió
acá — la evidencia vive en esa review):

- Cambiar un ratio de la tabla del documento da rojo en `el documento declara
  el ratio que el cálculo produce`.
- Bajar `--muted-foreground` a `oklch(0.70 0 0)` da rojo en `cada par llega a
  su mínimo, o está exceptuado con su razón escrita` — el par contra
  `--background` cae a 2.67.
- Declarar en `EXCEPCIONES` una excepción para un par que sí llega a su
  mínimo da rojo en `no hay excepciones de más`.
- Vaciar la tabla de contraste falla cerrado.

**Verificación visual — pendiente.** El Step 3 de esta task pide mirar el
login de un tenant real y juzgar a ojo si el botón **Entrar** es azul-violeta
y no negro, si el anillo de foco es del mismo azul-violeta y no gris, y si el
texto secundario bajo el título del local se lee cómodo sobre la card. Ningún
test automatizado puede responder eso. Lo que sí se comprobó mecánicamente:
con el stack de dev levantado (`docker compose -f docker/compose.dev.yml up -d
--wait`) y sirviendo en `http://100.64.81.63:3000`, el bundle de CSS que
manda al navegador (`/_next/static/chunks/app_globals_*.css`) lleva el token
nuevo — transformado por el build (Lightning CSS/Tailwind v4 baja `oklch(0.37
0.10 287)` a `#3d3571` como fallback y a `lab(25.5499% 16.7471 -34.1581)`
dentro de `@supports (color: lab(0% 0 0))`), pero el mismo color en los tres
lugares donde `--primary` y `--ring` aparecen, coincidente con el hex que ya
documenta la sección *Dónde entra el arándano*. Queda pendiente que una
persona abra `http://100.64.81.63:3000` (sólo por Tailscale) con el login de
un tenant y confirme las tres cosas a ojo.

**2026-08-11.**
