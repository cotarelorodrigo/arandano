# Las maquetas

`arandano.pen` es el archivo de [Pencil](https://pencil.dev) donde se diseñan
las pantallas antes de escribirlas. Vive en el repo y no en un Figma por una
razón sola: **para que el diff se vea**. Una maqueta que vive afuera se
desactualiza sin que nadie se entere, y a los tres meses nadie sabe si lo que
está en el archivo es lo que se construyó o lo que se descartó.

## Qué hay adentro

Trece pantallas, que son todas las que el producto tiene hoy — la lista y lo que
hace cada una vive en `docs/pantallas.md`, no acá:

| Frame | Ruta |
|---|---|
| `App / Vender` | `/vender` |
| `App / Ventas` | `/ventas` |
| `App / Venta detalle` | `/ventas/[id]` |
| `App / Inventario` | `/inventario` |
| `App / Artículo nuevo` | `/inventario/nuevo` |
| `App / Artículo ficha` | `/inventario/[id]` |
| `App / Servicio Técnico` | `/servicio-tecnico` |
| `App / Recibir equipo` | `/servicio-tecnico/nuevo` |
| `App / Orden ficha` | `/servicio-tecnico/[id]` |
| `App / Ticket 80 mm` | `/servicio-tecnico/[id]/ticket` |
| `App / Usuarios` | `/usuarios` |
| `App / Login` | `/login` |
| `Sitio / Landing` | `/` en el ápex |

Más `Shell/Sidebar`, que es un componente reusable: las once pantallas de
aplicación lo instancian y sólo overridean cuál entrada está activa. Si la
navegación cambia, cambia en un lugar.

## Los colores

Las variables del `.pen` llevan prefijo `ar-` (`ar-primary`, `ar-ink-2`,
`ar-warn-soft`) y los tokens del CSS llevan los nombres de shadcn
(`--primary`, `--foreground-soft`, `--warn-soft`). **Los valores son los mismos
strings de hex**, y por eso `app/globals.css` escribe hex y no `oklch`: dos
representaciones del mismo color son dos lugares donde el redondeo puede
diferir.

La correspondencia:

| `.pen` | CSS |
|---|---|
| `ar-bg` | `--background` |
| `ar-surface` | `--card`, `--popover` |
| `ar-sunken` | `--muted`, `--secondary` |
| `ar-ink` | `--foreground` |
| `ar-ink-2` | `--foreground-soft` |
| `ar-ink-3` | `--muted-foreground` |
| `ar-line` | `--border` |
| `ar-line-strong` | `--input` |
| `ar-primary` | `--primary`, `--ring`, `--chart-1` |
| `ar-primary-deep` | `--marca` |
| `ar-primary-soft` | `--accent` |
| `ar-ok`, `ar-ok-soft` | `--ok`, `--ok-soft` |
| `ar-warn`, `ar-warn-soft` | `--warn`, `--warn-soft` |
| `ar-danger`, `ar-danger-soft` | `--destructive`, `--destructive-soft` |

**`test/maqueta.test.ts` ata las dos listas**, en las dos direcciones: una
variable de la maqueta con distinto valor que su token rompe el build, y un
token del CSS que la maqueta no conozca también — porque eso significa que se
decidió un color escribiendo código, sin pasar por el diseño. Puede ser
legítimo; tiene que estar dicho, en `SOLO_EN_CSS` y con su razón.

**Mira sólo el bloque de variables, nunca la geometría**, y eso es lo que lo
hace sostenible: mover una card no cambia un color, así que el test no se rompe
por moverse. Un test que comparara posiciones o textos sería el que la gente
termina ignorando.

Ya hizo falta una vez, antes de existir: `ar-ink-3` era `#7A7389` en la maqueta
y no llegaba a 4.5:1 sobre dos de sus tres superficies. Se corrigió a `#6B6478`
**en los dos lados el mismo día**, a mano. Con el test, la segunda mitad de esa
frase deja de depender de que alguien se acuerde.

## Cómo se abre

Con Pencil. El archivo es JSON, así que un diff de git es legible para cambios
chicos —un color, un texto— y ruidoso para cambios de layout. Eso está bien: los
cambios de layout se miran en la aplicación, no en el diff.
