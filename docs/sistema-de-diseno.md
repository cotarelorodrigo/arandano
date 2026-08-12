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

### El arándano como superficie

Hay **una** excepción a esa contención, y tiene su propio token: `--marca`, el
paño de la persiana en la pantalla de login (`app/login/persiana.module.css`).

La razón de la regla está escrita arriba y es literal: *"lo que menos cansa en
una pantalla que se mira ocho horas"*. El login se mira ocho segundos, una vez
por día, antes de empezar a trabajar — la razón no aplica, así que la regla
tampoco. Es además el único momento de marca que tiene el producto: lo que
viene después es una herramienta y se comporta como tal.

**Por qué un token nuevo y no `--primary` en un `<section>`.** Si el paño fuera
exactamente el color del botón, el botón dejaría de ser lo único accionable a
la vista, que es justo lo que la contención compra. `--marca` es más oscuro
—0.28 contra 0.37 de luminosidad— y eso lo aleja de "control" y lo acerca a
"material". El hue sigue siendo **287**, igual que los otros tres: es el mismo
arándano a una cuarta distancia, no un color nuevo.

**Dónde NO se usa**: en ninguna otra pantalla. Si aparece una segunda, esta
sección deja de describir una excepción y hay que volver a discutir la regla,
no estirar la excepción en silencio.

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
| `--marca` | `oklch(0.28 0.09 287)` |
| `--secondary` | `oklch(0.97 0 0)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` |
| `--muted` | `oklch(0.97 0 0)` |
| `--muted-foreground` | `oklch(0.535 0 0)` |
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
| `--marca` | `#271f52` | El paño de la persiana del login, y nada más |

El hue es **287** en los cuatro. Lo que los distingue es croma y luminosidad, no
tono: es un solo color de marca visto a cuatro distancias.

### Contraste

Medido convirtiendo `oklch` → sRGB lineal → **el byte que se pinta** →
luminancia relativa → ratio WCAG 2.1. No estimado a ojo, y no en continuo: el
redondeo a 8 bits es lo que hace que estos números sean los mismos que reportan
axe y Lighthouse. La diferencia no es cosmética — medido en continuo,
`--muted-foreground` sobre `--muted` daba 4.51 y pasaba; sobre los bytes reales
daba 4.48 y no llegaba.

**Los pares con opacidad cuentan como pares.** Un `hover:bg-primary/80` no es
`--primary`: es otro color, y puede caerse del mínimo sin que ningún par opaco
se entere. La composición se hace sobre los bytes, que es donde compone el
navegador — mezclar en lineal da otros números (y haría que `rgba(0,0,0,.5)`
sobre blanco fuera `#bcbcbc` en vez del `#808080` que todos conocemos).

<!-- contraste:inicio -->

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 19.80 | 4.5 | ok |
| `--foreground` sobre `--muted` | 18.16 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 5.17 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 4.75 | 4.5 | ok |
| `--muted-foreground` sobre `--accent` | 4.53 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 10.34 | 4.5 | ok |
| `--primary-foreground` sobre `--primary/80` | 5.76 | 4.5 | ok |
| `--primary-foreground` sobre `--marca` | 14.33 | 4.5 | ok |
| `--primary-foreground/70` sobre `--marca` | 7.69 | 4.5 | ok |
| `--primary` sobre `--background` | 10.79 | 4.5 | ok |
| `--primary` sobre `--accent` | 9.44 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 4.57 | 4.5 | ok |
| `--destructive` sobre `--background` | 4.77 | 4.5 | ok |
| `--destructive/90` sobre `--card` | 4.54 | 4.5 | ok |
| `--input` sobre `--background` | 1.26 | 3.0 | **excepción declarada** |

<!-- contraste:fin -->

Cada par de la tabla nombra los **tokens** involucrados, no colores genéricos: `--primary-foreground` es `oklch(0.985 0 0)`, distinto de "blanco puro", así que sus ratios difieren del que podría calcularse contra un 1.0. El `/NN` es la opacidad con la que ese token aparece en un componente: `--primary/80` es el hover del botón de acción (`components/ui/button.tsx`), `--destructive/90` es la descripción de un error (`components/ui/alert.tsx`) y `--primary-foreground/70` es la firma "Arándano" sobre el paño del login (`app/login/persiana.module.css`).

**El par más justo es `--muted-foreground` sobre `--accent`, con 4.53.** Es el
que fija cuánto más se puede oscurecer `--accent` sin romper nada, y por eso
está medido: la fila seleccionada de las pantallas que vienen es exactamente
donde ese par se va a ver.

Al medir aparecieron **dos defectos que ya venían del default de shadcn**, no de
esta paleta:

1. **`--muted-foreground` sobre `--muted` daba 4.35**, abajo del mínimo para
   texto: el gris secundario sobre el fondo gris, o sea un subtítulo adentro de
   una card. **Corregido** — `0.556` → `0.535` lo deja en 4.75, y en 5.17 sobre
   blanco. Un primer intento con `0.547` daba 4.51 medido en continuo pero 4.48
   sobre los bytes reales: no alcanzaba, y de paso mostró que 0.01 de holgura no
   es holgura. El cambio es imperceptible a ojo.

2. **El borde de `--input` sobre blanco da 1.26**, contra los 3:1 que pide WCAG
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
dueño. **Sigue siendo la pila de toda la aplicación**, incluido el punto de
venta.

`--font-heading: var(--font-sans)`: los títulos usan la misma familia.

### La escala

Los roles, con su cara y su tamaño. Un texto que no encaja en ninguno de estos
cuatro es señal de que falta una decisión, no de que falte un tamaño.

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Cartel** — nombre del local | Archivo | 24 px | 600, `font-stretch: 112%`, tracking −0.01em |
| Título de pantalla (`h1`) | sistema | 20 px | 500 |
| Pestaña de navegación | sistema | 14 px | 500; activa 600 |
| Identidad, meta, pie | sistema | 12 px | 400, `--muted-foreground` |

**El cartel pesa más que el título de la pantalla, y es la decisión.** El nombre
del local es lo más grande de la aplicación: siempre estás adentro de tu local,
y `Inventario` es sólo dónde estás parado. Es la misma jerarquía que declara el
login —el negocio del cliente es el héroe, la plataforma no firma—, sostenida
las ocho horas en vez de los ocho segundos.

### La cara de display: Archivo

Lo que el párrafo de arriba anticipaba —*"adoptar una fuente propia más adelante
es aditivo y barato"*— pasó, y en un solo lugar.

**Archivo**, de [Omnibus-Type](https://www.omnibus-type.com/), foundry de Buenos
Aires. Se usa para **una cosa**: el nombre del local. Esa cosa se ve en dos
lugares y en dos tamaños — el cartel del login y el del header de la
aplicación (`components/cartel.module.css`). Ningún otro rol la usa.

**Por qué ésa.** Tiene eje de ancho variable (`wdth`, 62–125), y ése es el
motivo entero de la elección: un local argentino tiene el nombre pintado a lo
ancho del frente, y la versión expandida —acá, `font-stretch: 112%`— se parece
a eso en vez de a un título de aplicación. Que sea de una fundición argentina
no es lo que la justifica, pero tampoco es un accidente.

**Qué cuesta**, escrito para que se pueda revisar y no sólo defender:

| | |
|---|---|
| Peso | 90 KB de woff2, ejes `wght` y `wdth` completos |
| Subset | Sólo `latin` (U+0000–00FF y algunos más) |
| Origen | `app/fuentes/archivo-latin-var.woff2`, servido desde el propio dominio |
| Carga | `next/font/local` con `display: swap` y preload |
| Dónde pesa | En toda pantalla. En la sesión normal viene cacheada del login, pero una sesión con cookie viva entra derecho a `/vender` y ahí paga los 90 KB |

El subset `latin` cubre el español entero —ñ, acentos, `¿`, `¡`—. Un nombre de
local con un carácter afuera de ese rango cae en la pila del sistema **para ese
glifo**, que es una degradación aceptable y no un error.

Un detalle que muerde si se toca: el descriptor `font-stretch: 62% 125%` va en
`declarations` de `localFont` (`app/layout.tsx`). **Sin él el eje de ancho no se
activa** y el `font-stretch: 112%` de la pantalla no hace absolutamente nada,
sin avisar — se ve una Archivo normal y parece una decisión de diseño.

No hay token `--font-display` en `@theme inline`, y es a propósito: una sola
pantalla la usa, desde `app/login/persiana.module.css`, con `var(--font-archivo)`
—la variable que emite `next/font`— directo. Un token de `@theme` que ninguna
utilidad de Tailwind referencia es un token muerto, que es lo que el caso *no
quedan tokens de sidebar ni de gráficos* existe para evitar. Si una segunda
pantalla la necesita, ahí entra el token.

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
lista, **en el código que escribimos nosotros** —pantallas y layouts de `app/`—,
es señal de que el layout está mal, no de que falte un token.

Excepción, y es angosta: un solape de hairline atado al ancho de un borde no
es un paso de espaciado y no cae bajo esta regla. `-mb-px` en el riel de
pestañas de `components/navegacion.tsx` es el caso — solapa el `border-b` de
1 px del `<header>` para que el subrayado de 2 px de la pestaña activa se
apoye en el riel en vez de dibujar una segunda línea un pixel más arriba. El
−1 px ahí no sale de elegir un punto de la escala: sale de medir el borde que
hay que tapar, exactamente como `border-b-2` tampoco sale de la escala de
espaciado y nadie lo llamaría una violación. El límite es ese y no más: cubre
un solape de 1 px derivado de un borde real, no una puerta para colar
cualquier valor que no esté en la lista.

El recorte importa y no es una escapatoria: los componentes copiados de shadcn
que viven en `components/ui/` traen medios pasos adentro (`gap-1.5`, `px-2.5`,
`gap-0.5`, `translate-y-0.5`) y hasta un `pr-18`. **No se les pelea**, por el
mismo motivo por el que se adoptan sus 32 px de alto: son decisiones internas de
un componente que funciona, y tocarlas es pelearle a la librería para nada. La
regla gobierna la composición de pantallas, que es donde un espaciado
inventado sí se nota.

La densidad es **media**, y en números — todos verificados contra el código, no
aspiracionales:

| Elemento | Medida |
|---|---|
| Fila de tabla | 36 px (`py-2` sobre `text-sm`) |
| Input y botón | 32 px (`h-8`) |
| Padding de card | 16 px (`--card-spacing`, 12 px con `size="sm"`) |
| Gutter de página | 24 px (`p-6`) |

Los 32 px de input y botón, y los 16 de la card, no son una elección nueva: es
lo que ya traen los componentes de shadcn copiados al repo. Adoptarlos es no
pelearles. Los 36 px de la fila salen de `py-2` sobre `text-sm`, que es lo que
usa `app/(app)/usuarios/page.tsx`, la única tabla que existe hoy; subirla a 40
pediría `py-2.5`, o sea justo un medio paso de los que la regla de arriba deja
afuera del código propio.

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
que calcula los ratios WCAG desde los tokens reales de `app/globals.css`
—oklch → sRGB lineal → luminancia → ratio, en continuo, que es lo que la review
final corrigió dos párrafos más abajo— en vez de copiarlos a mano; se
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

**El agujero que la review final encontró: un segundo `:root`.** Los dos parsers
—el del test y el del script— buscaban el bloque con `/^:root\s*\{…/m`, que
matchea **el primero**. En CSS gana el último, así que agregar al final de
`app/globals.css`

```css
:root { --primary: oklch(0.6 0.3 30); --inventado: oklch(0.5 0 0); }
```

dejaba los 13 casos **en verde** con la aplicación sirviendo un naranja como
color de acción y un token que ningún documento declaraba. Un
`@media (prefers-color-scheme: dark) { :root { … } }` pasaba igual de entero: el
modo oscuro que este documento declara cerrado volvía por la puerta de al lado.
El parser vive ahora en un solo lugar —`tokensDelCss()` en
`scripts/contraste.mts`, importado por el test— y exige **un** `:root`, **de
primer nivel**. Verificado por efecto, revirtiendo cada mutación antes de la
siguiente:

| Mutación en `app/globals.css` | Resultado |
|---|---|
| El `:root` de arriba pegado al final | rojo en `hay un solo bloque :root, y de primer nivel` — *"app/globals.css tiene 2 bloques :root y tiene que tener exactamente 1…"* |
| `@media (prefers-color-scheme: dark) { :root { --background: oklch(0.145 0 0); } }` al final | el mismo rojo, más los 4 casos de `el documento y el CSS declaran lo mismo` y los 6 de `test/contraste.test.ts`, que dependen del mismo parser |
| El único `:root` envuelto en un `@media` | rojo en el mismo caso, por la otra rama — *"app/globals.css tiene el bloque :root anidado adentro de otra regla…"* |

**El contraste se medía en continuo, y los navegadores miden sobre 8 bits.** El
cálculo llegaba a la luminancia desde los componentes lineales, sin pasar por el
byte que efectivamente se pinta. Con eso `--muted-foreground` sobre `--muted`
daba 4.51 y figuraba "ok"; sobre `#6d6d6d` contra `#f5f5f5`, que son los bytes
reales, daba 4.48 y no llegaba. Se agregó la cuantización a 8 bits —que es lo
que hacen axe y Lighthouse— y `--muted-foreground` bajó a `oklch(0.535 0 0)`,
que deja 4.75 y 5.17 en vez de 0.01 de margen.

**Los estados con transparencia entraron a la tabla.** `PARES` sólo cubría pares
opacos, así que el hover del botón **Entrar** (`hover:bg-primary/80`) y la
descripción de un error de login (`text-destructive/90`) no los miraba nadie.
Ahora se componen sobre el color de abajo y se miden como cualquier otro par.
**Sobre los bytes, que es donde compone el navegador**: mezclar en sRGB lineal
da otros números —3.49 y 3.46 para esos dos, contra los 5.76 y 4.54 reales— y
también haría que `rgba(0,0,0,.5)` sobre blanco fuera `#bcbcbc` en vez del
`#808080` que cualquiera reconoce. Los dos llegan al mínimo sin tocar ningún
componente; el que no llegaba era `--muted-foreground` sobre `--accent` (4.15
con el gris de shadcn, 4.27 con `0.547`), y lo cerró el mismo cambio a `0.535`.

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
