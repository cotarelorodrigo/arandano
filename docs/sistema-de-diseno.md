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

| Par | Ratio | Mínimo | |
|---|---|---|---|
| texto sobre fondo | 19.79 | 4.5 | ok |
| texto sobre `muted` | 18.15 | 4.5 | ok |
| `muted-foreground` sobre fondo | 4.91 | 4.5 | ok |
| `muted-foreground` sobre `muted` | 4.51 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 10.33 | 4.5 | ok |
| `primary` sobre fondo | 10.79 | 4.5 | ok |
| `primary` sobre `accent` | 9.44 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 4.56 | 4.5 | ok |
| `destructive` sobre fondo | 4.76 | 4.5 | ok |
| **borde de `--input` sobre fondo** | **1.26** | **3.0** | **no llega — excepción, abajo** |

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
