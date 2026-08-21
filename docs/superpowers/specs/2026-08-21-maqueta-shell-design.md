# Spec: la maqueta entra al código — el shell

`design/arandano.pen` tiene trece pantallas diseñadas y el código sirve diez de
ellas con el layout viejo. La paleta ya se repintó —los tokens de
`app/globals.css` son los mismos hex que las variables `ar-*` del `.pen`, y
`test/maqueta.test.ts` los ata en las dos direcciones—, así que lo que falta no
es color: es estructura.

Este spec cubre el **primer ciclo de nueve**: el shell. Reemplaza el header
horizontal con pestañas por el sidebar de 248 px que la maqueta dibuja, y con él
cambian las diez pantallas que lo llevan, a la vez, sin que ninguna cambie de
contenido todavía.

## Alcance, y por qué este corte

El rediseño completo son doce pantallas, tres migraciones y un shell nuevo. En
un solo deploy sería el deploy más grande que este proyecto haya hecho, y sin
feature flags el tamaño del deploy es literalmente el radio de daño
(CLAUDE.md, *Cómo se manejan los cambios una vez en producción*).

El corte es el shell solo, porque es la única pieza que las diez pantallas de
aplicación comparten: hacerla primero significa que los ocho ciclos siguientes trabajan
contra un marco que ya está en producción y verificado, en vez de contra uno
que se está moviendo debajo.

Los nueve ciclos, en orden:

| # | Ciclo | Qué entrega |
|---|---|---|
| **1** | **Shell** | este spec |
| 2 | Migraciones | `Articulo.categoria`, `Caja`, `Tenant.cotizacionUsd`. Sólo schema |
| 3 | `/vender` | carrito, buscador con lector, panel de cobro, banda del total |
| 4 | `/ventas` + `/ventas/[id]` | tiles, chips de período, panel de medios de pago, detalle en dos columnas |
| 5 | `/inventario` + `/nuevo` + `/[id]` | tabs, chips de stock, ficha con tiles, último costo y movimiento mensual |
| 6 | `/servicio-tecnico` + `/nuevo` + `/[id]` | chips por estado, paño de estado con transiciones, bitácora |
| 7 | `/usuarios` | tabla del equipo y panel de alta a la derecha |
| 8 | `/login` | persiana sobre el paño de marca |
| 9 | Landing del ápex | ya construida; el ciclo mide la brecha real contra el frame |

El ciclo 2 va segundo y no repartido entre los ciclos de pantalla, y eso es
expand/contract y no prolijidad: la migración aditiva se deploya **antes** que
el código que la usa, así el rollback automático siempre tiene a dónde volver.
Una columna nueva que viaja en el mismo deploy que la pantalla que la lee deja
al rollback revirtiendo la imagen contra un schema que la imagen anterior no
conoce.

**Diez y no trece.** El `.pen` tiene trece frames de pantalla, y tres no llevan
shell: `/login` es la pantalla partida con el paño de marca, el ticket de 80 mm
es papel, y la landing del ápex no es de la aplicación. Las que instancian el
`Shell/Sidebar` son diez.

**`/servicio-tecnico/[id]/ticket` no está en la lista, y no es un olvido.** La
maqueta lo dice con todas las letras en su propio frame: *"la única superficie
del producto que no usa los tokens del sistema: una térmica quema un solo color
y el fondo es el papel"*. Ya está construido, ya es correcto, y el rediseño no
lo toca.

## Estado del que se parte

- `app/(app)/layout.tsx` arma un `<header>` de dos filas: identidad arriba
  (nombre del local, usuario, botón de salir) y `<Navegacion>` abajo, más un
  `<footer>` con `<Contexto>` (stack y sha del deploy).
- `components/navegacion.tsx` son cinco pestañas horizontales con subrayado de
  2 px en la activa. Es `'use client'` porque la pestaña activa sale de
  `usePathname()`, y es el punto de extensión que CLAUDE.md promete para el
  registry de módulos.
- `components/ui/` tiene seis componentes: `alert`, `button`, `card`, `chart`,
  `input`, `label`.
- `app/globals.css` tiene la paleta clara completa y **ningún** token
  `--sidebar-*`: `test/sistema-de-diseno.test.ts` los prohíbe explícitamente.

## Decisiones

### El sidebar viene de shadcn, no se escribe a mano

Las dos salidas eran legítimas y el propio test lo anticipaba — el comentario
del caso `no quedan tokens de sidebar` dice *"Vuelven solos con `npx shadcn add
sidebar`, y ahí se documentan"*.

Se eligió el componente de shadcn. Cuesta ~700 líneas y cuatro componentes de
dependencia que la maqueta no dibuja, y a cambio el proyecto no mantiene un
sidebar propio: el comportamiento de pantalla chica, el foco por teclado y la
semántica de `nav` vienen resueltos y siguen la misma línea que el resto de
`components/ui/`, que es de dónde salió el resto de la interfaz.

La consecuencia es que los ocho tokens `--sidebar-*` vuelven, con lo que eso
obliga — ver *Los tokens*.

### El ancho es 248 px y no los 256 del default

La maqueta dibuja `248`. shadcn trae `--sidebar-width: 16rem`, que son 256. Se
pisa a `15.5rem` en el `style` del `SidebarProvider`.

Ocho pixeles no se ven de a uno, pero el ancho del sidebar es lo que fija dónde
arranca **toda** la aplicación: dejarlo en 256 significa que ninguna de las diez
pantallas siguientes va a poder calzar contra su frame sin que sobre o falte
siempre lo mismo, y a la tercera pantalla nadie se acuerda de por qué.

### El colapso existe pero no se expone

`collapsible="offcanvas"` es el default de shadcn y se deja. En desktop **no
hay** `SidebarTrigger` visible: la maqueta no dibuja un botón de colapsar, y un
control que el diseño no tiene es un control que nadie decidió.

Abajo de 768 px shadcn detecta mobile solo y convierte el sidebar en un `Sheet`
con su trigger. Eso es comportamiento gratis que llega con la decisión de
arriba, y es mejor que lo que se pidió para pantalla chica —"que aguante"—, así
que queda: `SidebarTrigger` con `md:hidden`.

**Lo que NO se hace es diseñar el mobile.** Las tablas no se vuelven tarjetas,
`/vender` no se reordena. La maqueta tiene un solo tamaño (1440×900) y todo lo
que se invente por fuera de eso deja al `.pen` describiendo un producto que ya
no es — que es exactamente lo que `design/LEEME.md` dice que el archivo está en
el repo para evitar.

### El cartel baja de 24 px a 19, y el comentario se reescribe

`components/cartel.module.css` documenta en tres párrafos por qué el nombre del
local va en 24 px: *"A 20 empata con el `<h1>` de las pantallas y la inversión
no se lee. A 32 la fila crece lo suficiente como para pedir que las pestañas
suban a la misma fila, que ya es otro diseño."*

Ese razonamiento era sobre un header horizontal donde el cartel competía con el
`<h1>` de la pantalla **en la misma fila**. En una columna propia no compite con
nada: el `<h1>` vive en el topbar, a 248 px de distancia y en otro eje. La
maqueta dibuja 19 px, y a 19 px la inversión de jerarquía se sigue leyendo
porque el cartel es lo único que hay en su bloque.

El número cambia y el comentario también: dejarlo diciendo "por qué 24" arriba
de un `1.1875rem` es peor que no tener comentario, porque el próximo que lo lea
va a creer que el archivo se desincronizó y va a "arreglarlo" para atrás.

Lo que **no** cambia es el tratamiento: `--font-archivo`, `font-stretch: 112%`,
peso 600. Sigue siendo el mismo cartel que la persiana del login descubre.

### `Navegacion` cambia de forma, no de rol

Sigue siendo `'use client'`, sigue resolviendo la pestaña activa con
`usePathname()` y sigue exportando `estaActiva()` con la comparación por
prefijo. Sus doce casos de test pasan sin tocarse.

Lo único que cambia es que cada entrada de `PESTANAS` suma un ícono, y que el
render deja de ser `<Link>` con subrayado y pasa a ser `SidebarMenuButton` con
`isActive`.

Sigue siendo el punto de extensión del registry de módulos. Cuando Turnos sume
sus pestañas, entran por esta lista, ahora con ícono.

Los íconos los nombra la maqueta y son de **lucide**, que ya es dependencia:

| Pestaña | Ícono |
|---|---|
| Vender | `shopping-cart` |
| Ventas | `receipt-text` |
| Inventario | `package` |
| Servicio Técnico | `wrench` |
| Usuarios | `users` |
| Salir | `log-out` |

### Los `data-testid` se mudan sin renombrarse

`tenant-nombre` y `usuario-nombre` los busca `scripts/smoke.sh` en **cada**
pantalla autenticada del gate, para distinguir una página real de un 200 vacío
—Next devuelve 200 sirviendo un not-found—. Cambian de lugar en el DOM y no
cambian de nombre.

`tenant-nombre` conserva además la regla que ya tiene escrita en el layout: el
atributo va **último** en el elemento, porque el grep del smoke busca el `>`
pegado al nombre.

`<Contexto>` se muda del `<footer>` al `SidebarFooter`, que es donde la maqueta
pone `v1.4.2 · prod`. Sus dos `data-testid` viajan intactos; los mira
`app/(app)/layout.test.tsx`.

### Sólo entran los componentes que el shell usa

```
npx shadcn add sidebar avatar
```

`sidebar` arrastra `sheet`, `tooltip`, `separator` y `skeleton`; `input` y
`button` ya están.

`table`, `badge`, `tabs`, `select`, `checkbox`, `textarea` y `pagination` **no
entran en este ciclo**, aunque la maqueta los use en las pantallas. Entran en el
ciclo de la pantalla que los referencia. Diez componentes en `components/ui/`
que ningún archivo importa son la misma clase de peso muerto que los tokens que
este mismo spec se encarga de podar: cuestan revisión en cada PR y no hacen
nada.

### Lo que no entra, y por qué

- **El colapso en desktop** — ver arriba.
- **El diseño mobile** — ver arriba.
- **El contenido de las diez pantallas.** Cada una cambia su `<h1>` por
  `<Encabezado>` y nada más: después de este ciclo se ven con sidebar,
  encabezado nuevo y su cuerpo viejo adentro. Es deliberado — el shell es lo que
  se quiere verificar en producción sin nada más encima.
- **Las acciones que la maqueta inventa.** Los cuatro botones que ya viven en la
  fila del título suben con él; los que la maqueta agrega y no existen todavía
  ("Ingresar mercadería", "Imprimir", "Anular venta") llegan en el ciclo de su
  pantalla.
- **Las migraciones.** Son el ciclo 2. Este ciclo no toca `prisma/schema.prisma`.
- **Los `<h1>` desparejos como problema de estilo.** Hoy seis pantallas usan
  `text-xl font-medium` y tres `text-2xl font-semibold`. El `<Encabezado>` los
  unifica por venir de un solo componente, y eso es efecto de la mudanza y no
  un objetivo: nadie va a auditar tamaños de fuente en este ciclo.

## El shell

La anatomía sale del `.pen`, no de mirar la imagen:

```
frame App / Vender [1440x900] fill:$ar-bg
  ref Sidebar [248 x fill]          fill:$ar-surface
  frame Columna [fill x fill]
    frame Topbar [fill x 66]        fill:$ar-surface  pad:[0,28]
    frame Cuerpo [fill x fill]      pad:24  gap:18
```

Y el sidebar por dentro:

| Bloque | Geometría | Contenido |
|---|---|---|
| Marca | `pad:[22,20,18,20] gap:2` | "ARÁNDANO" 10 px en `--primary`; nombre del local 19 px en `--foreground` |
| Nav | `pad:[6,12] gap:2` | ítems `pad:[9,12] gap:11 radius:9`, ícono 17 px |
| Espaciador | `fill` | — |
| Pie | `pad:[16,16,18,16] gap:10` | avatar 32 px circular en `--marca` con la inicial; nombre 13 px; rol 11 px; botón salir 16 px |
| Versión | — | `v1.4.2 · prod`, 10 px en `--muted-foreground` |

El mapeo a shadcn:

| Maqueta | shadcn |
|---|---|
| Sidebar | `SidebarProvider` + `Sidebar` |
| Marca | `SidebarHeader` |
| Nav | `SidebarContent > SidebarGroup > SidebarMenu > SidebarMenuButton isActive` |
| Pie + Versión | `SidebarFooter` |
| Columna | `SidebarInset` |

**El ítem activo no se distingue sólo por color.** El fondo `--accent` más el
ícono y el rótulo en `--primary` es lo que la maqueta dibuja, y encima va
`aria-current="page"`, que es lo único que un lector de pantalla anuncia. El
layout viejo ya lo tenía y no se pierde en la mudanza.

### El encabezado de pantalla

El topbar de 66 px es idéntico en las diez pantallas: título, subtítulo debajo,
acciones a la derecha. Se crea como componente propio en este ciclo —
`components/shell/encabezado.tsx` — con tres props: `titulo`, `subtitulo` y
`acciones` como `ReactNode`.

**Lo renderiza cada pantalla, no el layout**, y eso no es una preferencia: un
layout de Next no tiene forma de saber el título de la pantalla que envuelve.
Pasarlo por contexto obligaría al layout a ser `'use client'` — hoy es de
servidor y ahí hace `exigirSesion()` — y un slot paralelo sería un archivo más
por ruta para mover un string.

Así que las diez pantallas **sí** se tocan en este ciclo, y el alcance real es:
cada `page.tsx` cambia su `<h1>` suelto por `<Encabezado titulo=… subtitulo=…/>`
como primer hijo. Es mecánico y no cambia qué dice ninguna pantalla.

Las **acciones** sí entran, y por un motivo que se vio al leer las pantallas:
cuatro de las diez ya tienen su botón en la misma fila del `<h1>`, dentro del
mismo `flex justify-between` — "Vender" en `/ventas`, "Artículo nuevo" en
`/inventario`, "Recibir un equipo" en `/servicio-tecnico` y "Reimprimir ticket"
en la ficha de orden. Para ésas, subir el botón al encabezado es el mismo
movimiento mecánico que subir el título, no un rediseño.

Lo que **no** entra son las acciones que la maqueta agrega y hoy no existen
—"Ingresar mercadería" en `/inventario`, "Imprimir" y "Anular venta" en la ficha
de venta, "Cancelar" en los formularios—. Ésas llegan con el ciclo de su
pantalla.

## Los tokens

Los ocho vuelven. Ninguno se inventa un valor: cada uno toma el de una variable
que la maqueta ya tiene, y entra en `EQUIVALENCIAS` de `test/maqueta.test.ts`
bajo esa variable. **Ninguno va a `SOLO_EN_CSS`**, porque ninguno se decide
escribiendo código.

| Token | Valor | Variable del `.pen` | Dónde se ve |
|---|---|---|---|
| `--sidebar` | `#FFFFFF` | `ar-surface` | el paño |
| `--sidebar-foreground` | `#171221` | `ar-ink` | nombre del local |
| `--sidebar-primary` | `#4A2AA5` | `ar-primary` | "ARÁNDANO" |
| `--sidebar-primary-foreground` | `#FFFFFF` | `ar-on-primary` | inicial del avatar |
| `--sidebar-accent` | `#EDE8FB` | `ar-primary-soft` | fondo del ítem activo |
| `--sidebar-accent-foreground` | `#4A2AA5` | `ar-primary` | ícono y rótulo activos |
| `--sidebar-border` | `#E3E0EC` | `ar-line` | línea contra el contenido |
| `--sidebar-ring` | `#4A2AA5` | `ar-primary` | foco |

Más sus `--color-sidebar-*` en `@theme inline`, sin los cuales `bg-sidebar` no
existe como utilidad de Tailwind.

### La poda es parte del ciclo, no una mejora posterior

Después de implementar, `grep` sobre `app/` y `components/`. **El token que
ningún archivo referencie se borra del CSS**, aunque `components/ui/sidebar.tsx`
lo nombre en un subcomponente que este proyecto no usa.

Es la parte que no se puede saltear. El caso `no quedan tokens de sidebar`
existía precisamente porque había ocho tokens declarados que ningún componente
usaba; reintroducir los ocho, usar cinco y borrar el test que lo detectaba no
es cerrar ese caso: es apagarlo y quedarse con el problema que lo motivó.

El caso se borra de `test/sistema-de-diseno.test.ts`, y los que sobrevivan a la
poda se documentan en `docs/sistema-de-diseno.md` — que el caso *"todo token del
CSS está documentado"* compara contra el CSS en las dos direcciones, así que un
token que entre sin su fila rompe el build igual.

## Cómo se verifica

| Qué | Qué pasa con él |
|---|---|
| `test/maqueta.test.ts` | los tokens que sobrevivan a la poda entran en `EQUIVALENCIAS`; el caso *"todo token del CSS está en la maqueta"* los cubre solo |
| `test/sistema-de-diseno.test.ts` | se borra el caso `no quedan tokens de sidebar`; el par de casos que compara con `docs/sistema-de-diseno.md` obliga a documentarlos |
| `app/(app)/layout.test.tsx` | nueve casos, reescritos contra el sidebar. Los cuatro que asertan `data-testid` cambian de selector y **no** de testid |
| `components/navegacion.test.tsx` | doce casos pasan sin cambios; suma uno que asegura que cada pestaña lleva su ícono |
| `scripts/smoke.sh` | no se toca. Si un testid se pierde en la mudanza, fallan de golpe todos los casos de pantalla del gate — que es el comportamiento que se quiere |
| `docs/pantallas.md` | las diez pantallas cambian su `<h1>` por `<Encabezado>` y ninguna cambia lo que dice, así que ninguna sección cambia de contenido. El shell no está en ese inventario y no debe estarlo: es lo que las pantallas comparten, no una pantalla |

**Casos nuevos** en `app/(app)/layout.test.tsx`:

- el sidebar marca la entrada activa con `aria-current="page"`
- el pie muestra la inicial del usuario en el avatar
- el trigger de mobile no se renderiza visible en desktop (`md:hidden`)
- el ancho declarado es `15.5rem` y no el default de shadcn

### Lo que ningún test puede hacer

Ninguno de estos casos juzga si el sidebar **se ve** como la maqueta. Eso lo
verifica una persona en un navegador, y CLAUDE.md ya dejó anotado de la vez
pasada lo que costó tiempo:

- Se entra por el **subdominio del tenant**, no por `http://100.64.81.63:3000`,
  que devuelve 404 desde el cutover de tenants por `Host` y es correcto que lo
  haga.
- El canario de dev arranca sin catálogo: hay que sembrarlo antes
  (`npm run catalogo:sembrar`) y con importes de **distinta cantidad de
  dígitos**, porque con montos parejos no se ve si las columnas de números
  bailan.

Para este ciclo se mira: las cinco entradas del nav con su ícono, la activa
distinguible, el pie con avatar y versión, el encabezado de 66 px con título y
subtítulo en cada una, y que las diez pantallas sigan abriendo con su contenido
viejo adentro del marco nuevo.

## Migración y deploy

Este ciclo **no toca el schema**. No hay migración, así que el `pg_dump` previo
del gate corre igual pero no tiene nada que proteger, y el rollback es
puramente de imagen.

Es un deploy **MINOR**: el cliente ve una pantalla distinta. Por la regla de
versionado de CLAUDE.md, `deploy.sh` lo deriva del último tag.

## Lo que sigue

El ciclo 2 son las tres migraciones aditivas, y ya tienen forma decidida:

- **`Articulo.categoria String?`** — texto libre, no tabla. La maqueta muestra
  dos niveles ("Accesorios · Protección") y un solo campo alcanza; el segundo
  nivel se escribe adentro si el dueño lo quiere.
- **`Caja`** — apertura y cierre nada más: `abiertaEn`, `abiertaPorId`,
  `saldoInicial`, `cerradaEn`, `cerradaPorId`. La regla de una sola caja abierta
  por tenant va como **índice único parcial**
  (`CREATE UNIQUE INDEX … WHERE cerrada_en IS NULL`), SQL a mano dentro de la
  migración generada: Prisma no lo declara, y como validación de aplicación dos
  pestañas abren caja dos veces.
- **`Tenant.cotizacionUsd Decimal(12,2)?` + `cotizacionUsdEn`** — el segundo no
  lo pide la maqueta y va igual: un dólar en el header sin saber de cuándo es,
  es peor que no mostrarlo.

Las tres tablas necesitan sus policies de RLS; `test/rls-cobertura.test.ts`
falla si `Caja` aparece sin `tenant_id` protegido.

**Y una desviación de la maqueta que hay que devolver al `.pen` cuando llegue el
ciclo 5**: la categoría se muestra en el listado de `/inventario` y en el
subtítulo de la ficha, pero el formulario de alta **no la tiene** y el card
"Datos" de la ficha tampoco. Un campo que se muestra y no se puede cargar nace
siempre vacío. El campo entra en los dos lugares, y el `.pen` se actualiza —
si no, el archivo empieza a describir un producto que no es, que es justo lo que
`design/LEEME.md` dice que existe para evitar.

## Riesgos

- **Este ciclo toca las diez pantallas a la vez**, dos veces: el shell que las
  envuelve y el `<h1>` de cada una. Es el que más radio de daño tiene de los
  nueve, y por eso va primero y solo: cuanto menos lleve encima, más fácil es
  saber qué lo rompió. La mitigación real es que no cambia ni una línea de
  lógica ni un server action — sólo dónde se dibujan las cosas.
- **Los tokens pueden volver a morir.** La poda por grep es un paso manual
  dentro del ciclo, no un test. Si se saltea, el proyecto queda con tokens
  declarados que nadie usa y sin el caso que lo detectaba, que es peor que antes
  de empezar.
- **`components/ui/sidebar.tsx` es código de terceros de ~700 líneas.** shadcn
  se copia al repo, así que a partir de acá es nuestro para mantener: un bug
  suyo no se arregla actualizando una dependencia.
- **El `.pen` y el código pueden divergir en el sentido contrario.** El test
  mira sólo colores, a propósito. La geometría —248 px, los paddings, los 66 px
  del topbar— no la ata nada, así que si alguien cambia el ancho del sidebar en
  el CSS, el archivo de diseño no se entera. La defensa es la de siempre: el
  cambio de layout se mira en la aplicación, no en el diff.
