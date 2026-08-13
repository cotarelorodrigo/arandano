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

**El color de un arándano**: el azul-violeta de la fruta, sobre un fondo oscuro.
Entra saturado en tres lugares y en ninguno más — acciones, foco y selección.
Todo el resto es gris, pero **gris tintado del mismo hue**: los neutros llevan
croma hasta 0.030 a hue 287, porque sobre fondo oscuro un gris de croma 0 lee
apagado. La contención es la decisión, no una etapa: es lo que menos cansa en
una pantalla que se mira ocho horas, y lo que deja margen para que el rojo de un
error se destaque de verdad.

**El límite del tinte es 0.030.** Un token de cromo por encima de eso deja de
ser un gris tintado y pasa a ser un color, y ahí la contención se empieza a
perder de a poco. `--accent` (0.060) es la excepción declarada, por la misma
razón por la que ya era el único tintado en la paleta clara: es la fila
seleccionada, y tiene que distinguirse de `--muted` sin depender sólo de la
luminosidad.

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
la vista, que es justo lo que la contención compra. `--marca` es **más oscuro**
que `--primary` —0.32 contra 0.66 de luminosidad— y eso lo aleja de "control" y
lo acerca a "material". Sobre la paleta clara la distancia era la misma en la
otra dirección: 0.28 contra 0.37. El hue sigue siendo **287**, igual que los
otros: es el mismo arándano a otra distancia, no un color nuevo.

**Y sube de 0.28 a 0.32 con la paleta oscura por una razón mecánica**: contra
un fondo de 0.214, un paño de 0.28 casi no se despega — paño y fondo pasan a
ser el mismo material. 0.32 es además la luminosidad del único paño saturado de
la maqueta (`#262a60`), así que el número no sale de la nada.

**Dónde se usa, y en ningún otro lado**: las **superficies de marca** — la
pantalla de login (`app/login/persiana.module.css`) y la franja de cierre del
sitio público (`app/sitio/cierre.module.css`). **Nunca la aplicación.** La razón
es la misma de arriba y no cambió: la contención existe porque una pantalla de
trabajo se mira ocho horas, y ni el login ni una landing se miran ocho horas.

Si aparece una **tercera** superficie de marca, esta sección deja de describir
una excepción angosta: ahí se vuelve a discutir la regla, en vez de estirarla
una vez más en silencio.

## Los tokens

<!-- tokens:inicio -->

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

<!-- tokens:fin -->

Los marcadores de arriba y abajo no son decoración: el parser del test busca la
tabla entre ellos, porque este documento tiene otras tablas y agarrar "la
primera" se rompe el día que alguien reordene secciones.

### Dónde entra el arándano

| Token | Hex | Dónde se ve |
|---|---|---|
| `--primary` | `#8e85da` | Botón de acción, links |
| `--primary-hover` | `#a09ae3` | El botón de acción, apuntado |
| `--ring` | `#8e85da` | Anillo de foco — lo más visible al operar con teclado |
| `--accent` | `#252142` | Fila seleccionada, hover, y el chip "el más elegido" de los planes de la landing. El neutral más tintado |
| `--marca` | `#312860` | El paño de la persiana del login y la franja de cierre de la landing |

El hue es **287** en los cinco. Lo que los distingue es croma y luminosidad, no
tono: es un solo color de marca visto a cinco distancias.

### Contraste

Medido convirtiendo `oklch` → sRGB lineal → **el byte que se pinta** →
luminancia relativa → ratio WCAG 2.1. No estimado a ojo, y no en continuo: el
redondeo a 8 bits es lo que hace que estos números sean los mismos que reportan
axe y Lighthouse. La diferencia no es cosmética — medido en continuo,
`--muted-foreground` sobre `--muted` daba 4.51 y pasaba; sobre los bytes reales
daba 4.48 y no llegaba.

**Los pares con opacidad cuentan como pares.** Un `bg-destructive/10` no es
`--destructive`: es otro color, y puede caerse del mínimo sin que ningún par
opaco se entere. La composición se hace sobre los bytes, que es donde compone
el navegador — mezclar en lineal da otros números (y haría que `rgba(0,0,0,.5)`
sobre blanco fuera `#bcbcbc` en vez del `#808080` que todos conocemos).

<!-- contraste:inicio -->

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 14.63 | 4.5 | ok |
| `--foreground` sobre `--muted` | 12.63 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 6.59 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 5.69 | 4.5 | ok |
| `--muted-foreground` sobre `--accent` | 5.69 | 4.5 | ok |
| `--muted-foreground` sobre `--card` | 6.10 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 5.64 | 4.5 | ok |
| `--primary-foreground` sobre `--primary-hover` | 7.11 | 4.5 | ok |
| `--foreground` sobre `--marca` | 10.83 | 4.5 | ok |
| `--foreground/70` sobre `--marca` | 6.13 | 4.5 | ok |
| `--primary` sobre `--background` | 5.49 | 4.5 | ok |
| `--primary` sobre `--accent` | 4.74 | 4.5 | ok |
| `--primary` sobre `--card` | 5.08 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 6.31 | 4.5 | ok |
| `--destructive` sobre `--background` | 6.14 | 4.5 | ok |
| `--destructive/90` sobre `--card` | 4.86 | 4.5 | ok |
| `--destructive` sobre `--destructive/10` | 5.36 | 4.5 | ok |
| `--input` sobre `--background` | 1.77 | 3.0 | **excepción declarada** |
| `--input` sobre `--card` | 1.63 | 3.0 | **excepción declarada** |
| `--ring` sobre `--background` | 5.49 | 3.0 | ok |
| `--ring/50` sobre `--background` | 2.33 | 3.0 | **excepción declarada** |

<!-- contraste:fin -->

Cada par de la tabla nombra los **tokens** involucrados, no colores genéricos: `--primary-foreground` es `oklch(0.20 0.03 287)`, distinto de "negro puro", así que sus ratios difieren del que podría calcularse contra un 0.0. El `/NN` es la opacidad con la que ese token aparece en un componente: `--destructive/10` es el fondo del botón "Desactivar artículo" (`components/ui/button.tsx`), `--destructive/90` es la descripción de un error (`components/ui/alert.tsx`), `--foreground/70` es la firma "Arándano" sobre el paño del login (`app/login/persiana.module.css`) y `--ring/50` es el halo de foco de botón e input (`focus-visible:ring-ring/50`).

**Un mismo token puede aparecer sobre dos fondos, y no es redundancia.** `--input` figura dos veces porque el borde de un campo contrasta distinto según dónde esté dibujado, y la superficie que importa es la que el producto usa de verdad: `--card`, porque **todo formulario del producto pone sus campos adentro de una Card**.

**El par más justo es `--primary` sobre `--accent`, con 4.74** — el violeta
sobre la fila seleccionada. Es el que fija cuánto más se puede aclarar
`--accent` antes de romper algo, y ocupa el lugar que en la paleta clara tenía
`--muted-foreground` sobre `--accent`.

Al medir aparecieron **dos defectos que ya venían del default de shadcn**, no de
esta paleta:

1. **`--muted-foreground` sobre `--muted` daba 4.35**, abajo del mínimo para
   texto: el gris secundario sobre el fondo gris, o sea un subtítulo adentro de
   una card. **Corregido** — `0.556` → `0.535` lo deja en 4.75, y en 5.17 sobre
   blanco. Un primer intento con `0.547` daba 4.51 medido en continuo pero 4.48
   sobre los bytes reales: no alcanzaba, y de paso mostró que 0.01 de holgura no
   es holgura. El cambio es imperceptible a ojo.

2. **El borde de `--input` da 1.63 donde se dibuja de verdad** — sobre `--card`,
   porque todo formulario del producto (el de la landing, que es el único camino
   de conversión que hay, y la columna de cobro de `/vender`) pone sus campos
   adentro de una Card. Sobre el fondo pelado da 1.77, mejor que el 1.26 de la
   paleta clara; los dos quedan cortos contra los 3:1 que pide WCAG 1.4.11 para
   el borde de un control, y el número que se está aceptando es el peor de los
   dos, no el más cómodo. **Aceptado como excepción, no corregido.** Se conserva
   el borde tenue que usa la maqueta a conciencia: todo campo lleva `<Label>`
   asociado y anillo de foco de marca, así que el borde no es el único indicio
   de que ahí hay un input. **Revisar** si aparece un reporte real de gente que
   no encuentra los campos, o ante una auditoría de accesibilidad formal.

Y una tercera excepción, que no es un defecto heredado sino una consecuencia de
que el foco tenga **dos** indicadores:

3. **El halo de foco de botón e input (`--ring/50`) da 2.33**, abajo de los
   mismos 3:1. No está solo: `focus-visible:border-ring` pinta al mismo tiempo
   el borde del control con `--ring` **opaco**, y ése da **5.49**. Lo que
   identifica al control enfocado cumple; el halo es refuerzo. **Donde no hay
   ese segundo indicador el anillo va opaco**: las pestañas de
   `components/navegacion.tsx` no tienen borde propio, y por eso usan
   `inset-ring-ring` sin opacidad. Esos dos números son los que cita su
   comentario, y `test/contraste.test.ts` los ata a esta tabla.

## Tipografía

**La pila del sistema**, que es la que Tailwind define para `font-sans`:

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
'Noto Sans', Arial, sans-serif, y las cuatro familias de emoji
```

No es un default que quedó: es una decisión. Cero bytes, cero salto de fuente al
cargar, y se ve nativa en el Windows del mostrador igual que en el Android del
dueño. **Sigue siendo la pila del cuerpo de toda la aplicación**: títulos,
botones y texto corrido no la abandonan en ninguna pantalla; dos roles salen
hacia Archivo: el cartel —el nombre del local—, que desde el ciclo del cartel
paga Archivo también en
el header de la aplicación y no sólo en el login, y el importe —la plata—, que
desde este ciclo paga Archivo en `/vender`: ahí los importes de la tabla y de
la lista de resultados, los campos de monto, cotización y recibido del
formulario de cobro, y el aviso de vuelto, van en Archivo y no en la pila del
sistema (ver *La cara de display: Archivo* más abajo).

`--font-heading: var(--font-sans)`: los títulos usan la misma familia.

### La escala

Los roles, con su cara y su tamaño. Un texto que no encaja en ninguno de estos
cinco es señal de que falta una decisión, no de que falte un tamaño.

<!-- escala:inicio -->

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Cartel** — nombre del local | Archivo | 24 px | 600, `font-stretch: 112%`, tracking −0.01em |
| Título de pantalla (`h1`) | sistema | 20 px | 500 |
| Pestaña de navegación | sistema | 14 px | 500; activa 600 |
| Identidad, meta, pie | sistema | 12 px | 400, `--muted-foreground` |
| **Importe** — plata en el punto de venta | Archivo | 40 px el total; 14 px la columna | 600 el total, 400 la columna; `font-stretch: 85%`, `tabular-nums` |

<!-- escala:fin -->

Los marcadores no son decoración: el documento tiene varias tablas y un parser
que agarre "la primera" se rompe el día que alguien reordene secciones. Es el
mismo mecanismo que ya usan `<!-- tokens:inicio -->` y `<!-- contraste:inicio -->`.

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

### La cara de display: Archivo

Lo que el párrafo de arriba anticipaba —*"adoptar una fuente propia más adelante
es aditivo y barato"*— pasó, y no se quedó en un solo lugar: hoy son dos roles
repartidos en tres módulos CSS.

**Archivo**, de [Omnibus-Type](https://www.omnibus-type.com/), foundry de Buenos
Aires. **Se usa para dos roles**, y los dos están en la tabla de arriba: el
nombre del local (`font-stretch: 112%`) y el importe del punto de venta
(`85%`). Los distingue el eje de ancho, no la familia. Ningún otro rol la usa:
títulos, tablas —salvo las columnas de plata de `/vender`— y botones siguen en
la pila del sistema, y los campos también —salvo los de plata en `/vender`
(monto, cotización, recibido), que llevan el rol Importe igual que cualquier
otra columna de plata.

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

La excepción también cubre **copiar esas clases a mano fuera de
`components/ui/`, cuando lo que se está igualando es un componente existente**.
Los dos `<select>` de `FilaDePago` en `/vender`
(`app/(app)/vender/punto-de-venta.tsx`) llevan `px-2.5 py-1 ring-3` textual,
tomado de `components/ui/input.tsx`: un `<select>` nativo no es un `<input>` y
no tiene versión propia en `components/ui/`, así que la única forma de
igualarlo a `Input` a ojo es transcribir sus medios pasos tal cual. **El
límite es ese, y no más**: vale para **copiar** las clases de un componente que
ya vive en `components/ui/`, no para **inventar** un espaciado nuevo que no
esté en ningún componente. La frase de arriba —*"la regla gobierna la
composición de pantallas"*— sigue rigiendo para cualquier medio paso que
alguien tipee de cero ahí; no para uno transcripto de un componente ya
aceptado.

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

**El eje izquierdo del shell.** Cartel, pestañas y contenido arrancan todos en
el mismo gutter de 24 px (`px-6` en `app/(app)/layout.tsx`, `p-6` en cada
pantalla). Hoy coinciden porque cada pantalla eligió lo mismo por su cuenta;
queda escrito para que la próxima no invente otro y parta la columna. El pie
comparte el mismo `px-6`, pero su contenido es `text-right`: la caja arranca en
ese gutter izquierdo, el texto cierra contra el derecho.

`--radius: 0.625rem`, con la escala derivada de 7 pasos que vive en
`@theme inline`. No hay razón de marca para moverla.

## Las clases `dark:` de shadcn

**La paleta de este producto es oscura, y aun así no hay "modo oscuro".** No es
un juego de palabras: hay **una sola cara**, la que declara el `:root` de
`app/globals.css`, y no existe ningún activador que cambie a otra. El bloque
`.dark` de shadcn se borró en el ciclo del sistema de diseño —definía 28
variables y nada aplicaba la clase— y no volvió con la paleta oscura
(2026-08-13): esta paleta se escribió **adentro** del único `:root`, que es lo
que mantiene un solo lugar donde vive un color.

Lo que **sí** se queda es `@custom-variant dark (&:is(.dark *))`, y esa línea
sigue siendo load-bearing por la misma razón que antes, que la paleta oscura no
cambió: sin ella, `dark:` vuelve al default de Tailwind v4
(`prefers-color-scheme`) y las 5 clases `dark:` que traen `button.tsx` e
`input.tsx` se activarían solas en cualquiera con el sistema en oscuro. Con
ella, apuntan a una clase que nadie pone y quedan inertes.

**Que ahora la paleta sea oscura no las vuelve correctas**, y ése es el punto
que más fácil se pierde: esas cinco reglas —`dark:bg-input/30`,
`dark:aria-invalid:border-destructive/50` y compañía— fueron escritas para
*otra* paleta oscura, la de shadcn, no para ésta. Si se activaran, pisarían
estos tokens con valores derivados de una paleta que este documento no declara.
Siguen tan inertes y tan equivocadas como el día que se borró el `.dark`.

Si alguna vez se pide una **segunda** cara —clara, con activador y
persistencia—, es su propio ciclo, y ahí lo primero que hay que resolver es esta
línea, no los tokens.

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

**`test/tipografia.test.ts`** ata la tabla de *La escala* —entre
`<!-- escala:inicio -->` y `<!-- escala:fin -->`— a los módulos CSS que declaran
cada `font-stretch`, en las dos direcciones, con el mismo mecanismo de
marcadores que ya usan los tokens de color. Se corre con `npx vitest run
test/tipografia.test.ts`, y forma parte de `npm test`.

Los cuatro defectos del gate de esta task, cada uno introducido sólo en el
archivo que dice la columna, corrido, anotado y revertido antes del siguiente:

| # | Defecto | Dónde | Caso(s) que falló (real) |
|---|---|---|---|
| 1 | `font-stretch: 85%` → `90%` | sólo `components/importe.module.css` | **Dos casos**, no uno: `todo rol con ancho propio lo declara igual en su módulo` —*"…declara "Importe" con font-stretch: 85%, y components/importe.module.css declara 90%…"*— y además `ningún módulo declara un ancho que el documento no documente`, porque 90% tampoco es un ancho documentado |
| 2 | `font-stretch: 85%` → `90%` en la fila *Importe* | sólo `docs/sistema-de-diseno.md` | El mismo caso, por el otro lado —*"…declara "Importe" con font-stretch: 90%, y components/importe.module.css declara 85%…"*— más `ningún módulo declara un ancho que el documento no documente`, por el mismo motivo que el defecto 1 |
| 3 | Borrar las 5 filas entre los marcadores | sólo `docs/sistema-de-diseno.md` | **Dos casos a la vez**, el mismo modo de falla que ya describe la sección de la tabla vacía de tokens más arriba: `la tabla de la escala no está vacía` (0 roles parseados) y `ningún módulo declara un ancho que el documento no documente`, ahora con `app/login/persiana.module.css` señalado —sin nada documentado contra qué comparar, cualquier `font-stretch` del repo cuenta como "no documentado" |
| 4 | Agregar `font-stretch: 70%;` a `app/login/persiana.module.css` | sólo ese archivo | Exactamente el predicho: sólo `ningún módulo declara un ancho que el documento no documente` —*"app/login/persiana.module.css declara font-stretch: 70%, que no figura en la tabla de la escala…"* |

Los defectos 1 y 3 atraparon un caso más de los previstos al escribir esta
task. No es un defecto del test: `ningún módulo declara un ancho que el
documento no documente` compara **todo** ancho de **todo** módulo CSS del repo
contra el conjunto de anchos documentados, así que cualquier valor que no
coincida con ninguna fila —sea porque cambió el CSS o porque la tabla se
vació— cae ahí también, además del caso más específico. Se documenta el
resultado real y no el previsto, que es justamente lo que este bloque de
evidencia existe para permitir verificar. En los cuatro casos, después de
revertir, `git status --short` volvió a mostrar sólo los cambios de esta task
—nunca el defecto— antes de seguir con el siguiente.

**Verificación visual — hecha el 2026-08-13.** Una persona miró dev y confirmó
las ocho cosas que ningún test automatizado puede responder. Se cerraron las
dos deudas juntas: las tres del ciclo del sistema de diseño (2026-08-11), que
habían quedado abiertas por no haber interfaz que mirar todavía, y las cinco
del ciclo del punto de venta.

En el login: el botón **Entrar** se ve azul-violeta y no negro, el anillo de
foco al tabular hasta él es del mismo azul-violeta y no gris, y el texto
secundario bajo el título del local se lee cómodo sobre la card.

En `/vender`, con el carrito cargado: los importes se ven **angostos** y no de
ancho normal —que es la comprobación de que el eje `wdth` se activó de verdad,
y por lo tanto de que el cable trampa del descriptor `font-stretch` en
`test/tipografia.test.ts` no está mintiendo—, las columnas no bailan al
cambiar cantidades y montos (`tnum` funcionando sobre Archivo), el total ancla
la vista al entrar a la pantalla, el pie muestra `$ 0,00` con el carrito vacío
y `—` —no `$ NaN`— con una cantidad a medio tipear, y los dos `<select>` de la
columna de cobro muestran el anillo de foco de marca.

**Cómo se llegó, que no es como decía este párrafo antes.** La versión anterior
mandaba a abrir `http://100.64.81.63:3000`, y esa URL responde **404** desde el
cutover de tenants por `Host` (2026-08-08): la IP pelada no termina en
`DOMINIO_BASE`, así que para la aplicación es un dominio ajeno, y es correcto
que lo sea. Hay que entrar por el subdominio del tenant —
`http://canario.dev.arandano.app:3000/login`, con una línea en el `/etc/hosts`
de la máquina propia, porque los archivos hosts no tienen wildcards. Y el
catálogo del canario de dev arrancaba **vacío**: sin artículos que cargar al
carrito no hay importes que mirar, así que la verificación necesita catálogo
sintético sembrado antes, con montos de distinta cantidad de dígitos —acá, de
`$ 990` a `$ 899.999`— porque un catálogo de importes parejos no puede mostrar
si las columnas bailan. Ver *Tenants y subdominios* en
`docs/runbook-stacks.md`.

Lo que ya se había comprobado mecánicamente y sigue valiendo: el bundle de CSS
que manda al navegador (`/_next/static/chunks/app_globals_*.css`) lleva el
token nuevo — transformado por el build (Lightning CSS/Tailwind v4 baja
`oklch(0.37 0.10 287)` a `#3d3571` como fallback y a `lab(25.5499% 16.7471
-34.1581)` dentro de `@supports (color: lab(0% 0 0))`), pero el mismo color en
los tres lugares donde `--primary` y `--ring` aparecen, coincidente con el hex
que ya documenta la sección *Dónde entra el arándano*. Y la fuente variable
(`/_next/static/media/archivo_latin_var-*.woff2`) se sirve con 200: si esa
respuesta fuera un 404, los importes se verían anchos y el defecto parecería
del código cuando sería del asset.

**2026-08-11.**
