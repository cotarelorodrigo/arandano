# Las maquetas

`arandano.pen` es el archivo de [Pencil](https://pencil.dev) donde se diseñan
las pantallas antes de escribirlas. Vive en el repo y no en un Figma por una
razón sola: **para que el diff se vea**. Una maqueta que vive afuera se
desactualiza sin que nadie se entere, y a los tres meses nadie sabe si lo que
está en el archivo es lo que se construyó o lo que se descartó.

## Qué hay adentro

Las trece pantallas que el producto tiene hoy, **dos veces**: una en la maqueta
de escritorio de 1440 px y otra en la del teléfono de 390 px. La lista de lo que
hace cada una vive en `docs/pantallas.md`, no acá.

### Escritorio — 1440 px

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

### Teléfono — 390 px

Quince frames, y son quince y no trece por dos razones que conviene leer antes
de buscar la que falta: `/vender` se parte en dos porque en el teléfono el cobro
es **pantalla propia**, y el drawer de navegación **no tiene ruta** — es un
estado del shell que en escritorio no existe, porque ahí el sidebar está
siempre a la vista.

| Frame | Ruta |
|---|---|
| `Móvil / Vender` | `/vender` |
| `Móvil / Vender · Cobro` | `/vender`, con el paso en cobro (`?paso=cobro`) |
| `Móvil / Ventas` | `/ventas` |
| `Móvil / Venta detalle` | `/ventas/[id]` |
| `Móvil / Inventario` | `/inventario` |
| `Móvil / Artículo nuevo` | `/inventario/nuevo` |
| `Móvil / Artículo ficha` | `/inventario/[id]` |
| `Móvil / Servicio Técnico` | `/servicio-tecnico` |
| `Móvil / Recibir equipo` | `/servicio-tecnico/nuevo` |
| `Móvil / Orden ficha` | `/servicio-tecnico/[id]` |
| `Móvil / Ticket 80 mm` | `/servicio-tecnico/[id]/ticket` |
| `Móvil / Usuarios` | `/usuarios` |
| `Móvil / Login` | `/login` |
| `Móvil / Sitio · Landing` | `/` en el ápex |
| `Móvil / Menú (drawer)` | ninguna — el shell abierto sobre el velo |

Los frames móviles se diseñaron **después** de los de escritorio, y son la
autoridad para el teléfono con la misma regla de siempre. Cuál manda se decide
por ancho, no por antigüedad: la maqueta de escritorio sigue siendo la autoridad
de 1024 px para arriba y la del teléfono de ahí para abajo. El código las sirve
a las dos desde un solo árbol, mobile-first (ver `CLAUDE.md`, la entrada del
ciclo del teléfono).

### Los dos componentes reusables

| Componente | Quién lo instancia |
|---|---|
| `Shell/Sidebar` | Las **diez** pantallas de aplicación de escritorio (el ticket de 80 mm y el login no llevan shell), **más `Móvil / Menú (drawer)`** — el drawer del teléfono no es un segundo diseño de la navegación, es el mismo paño sobre un velo |
| `Móvil/Topbar` | Los **doce** frames `Móvil /` que llevan la franja de 56 px — todos menos el login, el drawer y la landing |

Cada instancia sólo overridea lo suyo: el sidebar, cuál entrada está activa; el
Topbar, título, subtítulo e íconos de las dos ranuras. Si la navegación cambia,
cambia en un lugar; si cambia la franja de arriba, también.

**Y el código los trata igual que la maqueta**: `components/shell/encabezado.tsx`
es una sola franja que sirve a los dos anchos (`h-14 lg:h-[66px]`), no dos
componentes — de la misma forma que `kyXe1` no es un frame nuevo por pantalla.
Una pantalla de aplicación instancia el Topbar exactamente como instancia el
`Shell/Sidebar`: no lo redibuja, le pasa props.

**Hay además un frame suelto, `PRUEBA` (`WFcZP`)**, que no documenta ninguna
pantalla — es un resto de trabajo de diseño. No lo mira ningún test ni ningún
ciclo; se puede borrar en Pencil cuando alguien tenga el archivo abierto.

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
| `ar-primary` | `--primary`, `--ring` |
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
