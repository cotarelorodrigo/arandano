# Spec: el sistema de diseño

**Fecha:** 2026-08-11
**Estado:** aprobado, sin implementar

Define la primera decisión visual del producto —color, tipografía y espaciado— y
la ata a `app/globals.css` con un test, para que el documento no pueda
desincronizarse del CSS que sirve la aplicación.

## Por qué existe

Hoy la aplicación usa la paleta neutra que trae shadcn por defecto: **todos los
tokens de color tienen croma `0`**. Es gris literal. No hay una sola decisión de
marca, y ninguna decisión de color, tipografía o espaciado está escrita en ningún
lado.

Va **antes** del ABM de artículos y del punto de venta, y no después. Son las dos
pantallas que van a fijar el lenguaje visual del producto, y rehacerlas cuesta más
que decidir la paleta primero. Hoy existen sólo el login y la de usuarios: es el
momento más barato que va a haber.

La referencia es **el color de un arándano** — el azul-violeta profundo de la
fruta.

## Estado del que se parte

- `app/globals.css` tiene los tokens de shadcn intactos, en `oklch`, todos con
  croma `0`.
- El bloque `.dark` está **completo y muerto**: define 28 variables y nada aplica
  la clase `dark` en ninguna parte del árbol.
- `--sidebar-*` (8 tokens) y `--chart-*` (5) no los referencia **ningún**
  componente ni pantalla. Verificado por grep: 0 usos.
- La tipografía es la pila del sistema, y el comentario que ya está en el archivo
  documenta que fue deliberado: el init de shadcn generaba
  `--font-sans: var(--font-sans)` esperando que `next/font` la llenara, y como
  esta app no trae fuente propia, esa línea tapaba la pila real con una variable
  sin quien la resuelva.
- Cinco componentes copiados: `alert`, `button`, `card`, `input`, `label`.
- `--radius: 0.625rem`, con una escala derivada de 7 pasos en `@theme inline`.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Alcance | Color, tipografía y espaciado | Es lo que `CLAUDE.md` pide textualmente. Componentes y patrones se escriben cuando existan las pantallas que los motiven |
| Modo oscuro | **Se borra** | Código sin consumidor. Vuelve como su propio ciclo, con activador y persistencia, si se pide |
| Sincronía doc ↔ CSS | Doc a mano + test que compara | El doc lleva el porqué, que ningún generador sabe escribir; el test hace imposible la divergencia |
| Paleta | **Sobrio**: el arándano sólo en acciones, foco y selección | Es lo que menos cansa en una pantalla que se mira ocho horas, y deja margen para que un error o un cobro se destaquen |
| Tipografía | Pila del sistema, decidida y escrita | Cero bytes, cero salto de fuente, nativa en cada SO. Adoptar una fuente propia después es aditivo |
| Densidad | **Media**: fila de 40 px | Es la que ya traen los componentes copiados (`input` mide 32 px). Adoptarla es no pelearle a lo que hay |
| Tokens muertos | Se borran `--sidebar-*` y `--chart-*` | Mismo argumento que `.dark`. Vuelven solos con `npx shadcn add sidebar` o con el primer gráfico |

## La paleta

El arándano entra en **tres lugares y en ninguno más**: acciones (`primary`),
foco (`ring`) y selección/hover (`accent`). El resto queda gris neutro puro.

| Token | Valor | Hex | Cambio |
|---|---|---|---|
| `--primary` | `oklch(0.37 0.10 287)` | `#3d3571` | **El arándano.** Hoy `oklch(0.205 0 0)` |
| `--ring` | `oklch(0.37 0.10 287)` | `#3d3571` | El foco pasa de gris a marca |
| `--accent` | `oklch(0.955 0.012 287)` | `#efeff8` | Único neutral tintado: filas seleccionadas y hover |
| `--accent-foreground` | `oklch(0.37 0.10 287)` | `#3d3571` | |
| `--muted-foreground` | `oklch(0.535 0 0)` | `#6d6d6d` | Baja de `0.556`. Cierra dos pares de contraste |
| Todo lo demás | sin cambio | | `background`, `foreground`, `card`, `popover`, `secondary`, `muted`, `border`, `input`, `destructive`, `radius` |

**El hue es 287 en los tres.** Lo que los distingue es croma y luminosidad, no
tono: es un solo color de marca visto a tres distancias.

### Contraste, calculado y no estimado

Los pares se miden convirtiendo `oklch` → sRGB lineal → **el byte que se pinta**
→ luminancia relativa → ratio WCAG 2.1, no a ojo. El redondeo a 8 bits es lo que
hace que el número coincida con el de axe y Lighthouse; los pares con opacidad se
componen sobre el color de abajo, en bytes, que es donde compone el navegador.

**Cada fila nombra sus dos tokens**, y no "blanco" o "texto": `--primary-foreground`
es `oklch(0.985 0 0)` y no blanco puro, y esa etiqueta suelta ya hizo equivocarse
a un reviewer. La tabla viva —la que el gate compara contra el cálculo— es la de
`docs/sistema-de-diseno.md`; ésta es la foto del momento en que se aprobó.

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 19.80 | 4.5 | ok |
| `--foreground` sobre `--muted` | 18.16 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 5.17 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 4.75 | 4.5 | ok |
| `--muted-foreground` sobre `--accent` | 4.53 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 10.34 | 4.5 | ok |
| `--primary-foreground` sobre `--primary/80` | 5.76 | 4.5 | ok |
| `--primary` sobre `--background` | 10.79 | 4.5 | ok |
| `--primary` sobre `--accent` | 9.44 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 4.57 | 4.5 | ok |
| `--destructive` sobre `--background` | 4.77 | 4.5 | ok |
| `--destructive/90` sobre `--card` | 4.54 | 4.5 | ok |
| **`--input` sobre `--background`** | **1.26** | **3.0** | **no llega — excepción aceptada, ver abajo** |

**Dos defectos que ya existen hoy**, heredados del default de shadcn y no
introducidos por esta paleta:

1. **`muted-foreground` sobre `muted` daba 4.35**, abajo del mínimo de 4.5 para
   texto — el gris secundario sobre el fondo gris, o sea un subtítulo adentro de
   una card. **Se corrige**: `0.556` → `0.535` lo deja en 4.75 y en 5.17 sobre
   blanco. El cambio es imperceptible a ojo.

2. **`--input` sobre blanco da 1.26**, contra los 3:1 que pide WCAG 1.4.11 para
   el borde de un control. **Se acepta y queda escrito como excepción.** Llevarlo
   a `oklch(0.669 0 0)` cerraría el hueco, pero cambia visiblemente el aspecto de
   todo campo de la aplicación, y se decidió conservar el look liviano. Es una
   deuda de accesibilidad conocida, no un olvido: la mitiga que todo campo lleva
   `<Label>` asociado y anillo de foco de marca, así que el borde no es el único
   indicio de que ahí hay un input. **Revisar** si aparece un reporte real de
   gente que no encuentra los campos, o si alguna vez se hace una auditoría de
   accesibilidad formal.

## Tipografía

**La pila del sistema**, la que Tailwind define para `font-sans`, escrita en el
doc para que se sepa qué se está mirando en cada SO:

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
'Noto Sans', Arial, sans-serif, y las cuatro familias de emoji
```

`--font-heading: var(--font-sans)` se queda como está: los títulos usan la misma
familia.

**Tres pesos y no más**: 400 para texto, 500 para etiquetas y botones, 600 para
títulos. El 700 se saltea a propósito — la pila varía demasiado entre sistemas y
en algunos cae en un falso negrita sintético.

Dos reglas que **no son estéticas**:

- **Números tabulares y alineados a la derecha** en toda columna de plata, stock,
  cantidad o total (`tabular-nums` + `text-right`). Sin eso las columnas bailan y
  comparar dos precios de un vistazo deja de funcionar.
- **`text-base` en inputs hasta `md`, `text-sm` de ahí para arriba.** Ya lo hace
  `input.tsx`, y el porqué va escrito antes de que alguien lo "arregle": abajo de
  16 px iOS hace zoom solo al enfocar un campo, y en una tablet de mostrador eso
  es la pantalla saltando en cada carga de artículo.

## Espaciado y radio

La escala de 4 px de Tailwind, con un **subconjunto habilitado** — los pasos `1,
2, 3, 4, 6, 8, 12`, o sea 4, 8, 12, 16, 24, 32 y 48 px. Un valor fuera de esa
lista es señal de que el layout está mal, no de que falte un token.

La densidad media, en números:

| Elemento | Medida |
|---|---|
| Fila de tabla | 40 px (`py-2.5`) |
| Input y botón | 32 px (`h-8`) — lo que ya traen los componentes |
| Padding de card | 24 px |
| Gutter de página | 24 px |

**Corregido al implementar:** dos de esos cuatro números eran aspiracionales y el
código decía otra cosa — la card de shadcn trae 16 px (`--card-spacing`) y la
única tabla que existe mide 36 px (`py-2`). Se decidió describir el código en vez
de rediseñar componentes copiados, y el subconjunto de la escala pasó a regir
sólo el código propio, porque los componentes de `components/ui/` traen medios
pasos adentro. Los números que valen están en `docs/sistema-de-diseno.md`.

`--radius: 0.625rem` **sin cambio**, con la escala derivada de 7 pasos que ya
está en `@theme inline`. No hay razón de marca para moverla.

## Qué se borra, y una línea que se queda

Se van del CSS:

- El bloque `.dark` entero (28 variables).
- `--sidebar-*` (8) y `--chart-*` (5), más sus 13 mapeos en `@theme inline`.

**`@custom-variant dark (&:is(.dark *))` NO se borra**, y esto es lo más filoso
del ciclo. `button.tsx` e `input.tsx` traen 5 clases `dark:` de shadcn. Mientras
esa línea exista, el variante queda atado a la clase `.dark` — que ya no la pone
nadie — y las cinco clases quedan inertes. **Si se borra**, `dark:` vuelve al
default de Tailwind v4, que es `prefers-color-scheme`, y esas cinco reglas se
activarían solas en cualquier usuario con el sistema en oscuro, sobre una paleta
clara y sin ningún token oscuro definido.

## El documento

`docs/sistema-de-diseno.md`, al lado de `docs/schema.md` y los runbooks. Lleva el
porqué de cada decisión y una **tabla normativa** de token → valor, que es la que
el test compara.

## El test

`test/sistema-de-diseno.test.ts`. Verifica **en las dos direcciones**, con el
mismo criterio que el `migrate status` de `deploy.sh`:

1. Todo token de la tabla del doc existe en `:root` **con ese valor exacto**.
2. Todo token de `:root` está **en la tabla del doc**. Agregar un color sin
   documentarlo rompe el build.
3. **La tabla no está vacía ni es imparseable.** Si el parser no encuentra filas,
   falla. Un barrido de cero elementos que reporta cero fallas es el modo de falla
   que este repo ya cerró dos veces (`rutas_autenticadas`,
   `test/boundaries-app.test.ts`).
4. **`.dark` no volvió** y `@custom-variant dark` sigue ahí. Correr
   `npx shadcn init` otra vez reinyecta el bloque, y esto lo ataja.

Entra a `npm test` por glob, y por lo tanto al gate del deploy, sin tocar nada.

**Consecuencia aceptada:** el doc pasa a ser código. Cambiar un color sin editar
el `.md` falla el gate, así que un retoque de color deja de ser un cambio de una
línea. Es exactamente lo que `CLAUDE.md` pide.

## Lo que este ciclo NO cubre

- **Componentes y patrones de pantalla.** Formularios, tablas, estados vacíos,
  errores. Se escriben cuando existan las pantallas que los motiven; hoy hay dos.
- **Modo oscuro.** Se borra. Vuelve como su propio ciclo si se pide.
- **Verde de éxito y ámbar de advertencia.** Ninguna pantalla los usa hoy, y
  agregarlos en el mismo commit que borra tokens muertos sería contradecirse. El
  doc deja escrito **dónde irían y con qué hue**, para que el primero que los
  necesite no invente un color a mano.
- **Logo e identidad de marca.** El sistema de diseño define tokens de interfaz,
  no la marca.
- **Aplicar la paleta a las pantallas existentes.** Login y usuarios la heredan
  solas por los tokens; no se rediseña ninguna pantalla en este ciclo.

## Riesgos que quedan escritos

- **El test ata dos archivos que se editan por motivos distintos.** Un cambio de
  color va a tocar siempre dos archivos, y alguien con apuro va a sentir que
  estorba. Es el costo elegido a cambio de que el doc no mienta.
- **La excepción de `--input` es una deuda de accesibilidad conocida**, no un
  descuido. Está escrita con su mitigación y su gatillo de revisión.
- **La paleta se decide sobre dos pantallas.** Login y usuarios no ejercitan
  tablas largas, estados de error densos ni el punto de venta. Puede que el
  arándano en `accent` se vea distinto sobre una grilla de 50 filas. Es el precio
  de decidir temprano, que es lo que este ciclo eligió a propósito — y mover un
  token después es barato justamente porque hay un solo lugar donde vive.
- **`@custom-variant dark` es load-bearing y no lo parece.** Una línea que
  aparenta ser configuración muerta al lado de un bloque que sí se borró. El test
  la cubre; el comentario en el CSS explica por qué.

## Fuera de alcance

Cualquier cosa que exija una pantalla nueva. Este ciclo escribe un documento,
edita un bloque de CSS y agrega un test.
