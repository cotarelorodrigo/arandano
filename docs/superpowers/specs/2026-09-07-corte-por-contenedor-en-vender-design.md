# Spec: `/vender` decide por el espacio que tiene, no por el ancho del monitor

Sale del feedback textual del dueño del producto: *"hay veces que si estas en
/ventas depende el tamaño de la pamtalla la caja de cobro donde seleccionas
como paga el cliente no aparece o queda oculta"*. La pantalla es `/vender` —
`/ventas` no tiene panel de cobro—, y el ancho donde lo vio es **~960 px**: un
monitor Full HD con el navegador a media pantalla.

## El defecto

Abajo de 1024 px de viewport, `/vender` sirve el layout de teléfono, donde el
cobro es un paso propio al que se entra por el botón del pie. A 960 px el panel
no está al lado del carrito, y eso es exactamente lo que se reportó.

Hasta acá suena a "es el diseño". Lo que lo convierte en defecto es **por qué
está puesto ahí ese número**. `hooks/use-mobile.ts:13` lo explica en su propio
comentario: *"A 768 px de viewport al carrito le quedan apenas 136 px... A 1024
le quedan 392, que es el mínimo que funciona"*. Esa cuenta es
`1024 − 248 (sidebar) − 384 (panel)`, y tiene dos errores.

**El primero es aritmético**: le faltan el `lg:p-6` del cuerpo (48 px) y el
`gap-[18px]` de la fila. A 1024 px reales al carrito le quedan **326**, no 392
— por debajo del mínimo que el propio comentario fija.

**El segundo es el que importa, y da vuelta la premisa.** La cuenta le descuenta
248 px al sidebar *también abajo de 1024*, y ahí el sidebar no ocupa nada:
`components/ui/sidebar.tsx:171` lo renderiza como `Sheet` —un panel portaleado,
cero px en el flujo— cuando `useIsMobile()` da verdadero. El ancho disponible
para el cuerpo no crece de forma monótona con el viewport: **un píxel más de
ventana le saca 267 px al cuerpo**, justo al cruzar el corte.

La columna "cuerpo" es el ancho que queda **ya descontado el padding de hoy**,
que también salta en el corte (28 px de `px-[14px]` abajo, 48 de `lg:p-6`
arriba):

| viewport | sidebar | cuerpo disponible | carrito si hubiera dos columnas |
|---|---|---|---|
| 960 (el del reporte) | `Sheet`, 0 px | 932 | **530** |
| 1023 | `Sheet`, 0 px | 995 | 593 |
| **1024** | **248 px en flujo** | **728** | **326** |
| 1200 | 248 px | 904 | 502 |
| 1220 | 248 px | 924 | 522 |

O sea: **el corte está puesto en el único ancho donde el espacio empeora**. A
960 el carrito tendría 530 px —más que a 1024 y más que a 1200— y es ahí donde
el panel se esconde. Y del otro lado, entre 1024 y ~1090, las dos columnas se
prenden con un carrito por debajo del mínimo declarado; como ninguna de las dos
tiene `min-w-0` ni `shrink-0`, ahí el panel se comprime por debajo de sus 384 px
de diseño y, según cuánto mida el mínimo real del carrito, puede llegar a
desbordar la fila y salirse de la pantalla.

**La conclusión que ordena todo el ciclo: un solo corte sobre el viewport no
puede ser correcto acá.** No hay número que sirva para los dos regímenes,
porque el sidebar parte la relación entre viewport y espacio en dos.

## El principio: son dos preguntas distintas, no una respondida dos veces

CLAUDE.md fija como decisión escrita, del ciclo móvil: *"Un solo corte, 1024 px...
Un corte para el CSS y otro para el JavaScript es la clase de desincronización
que nadie ve hasta que alguien mira desde un ancho intermedio."* Este ciclo
revisa esa decisión, y la revisión sólo es legítima si no reintroduce lo que esa
regla evitaba. No lo hace, porque lo que se separa no son dos respuestas a una
pregunta sino dos preguntas:

- **"¿El sidebar es un panel flotante?"** es del **viewport**. La contesta
  `useIsMobile()` en 1024 y **no se toca**: abajo de ese ancho el sidebar es un
  `Sheet`, y por eso el Topbar tiene que mostrar la hamburguesa — es el único
  camino a la navegación.
- **"¿Entran las dos columnas?"** es del **espacio que tiene el cuerpo**. El
  viewport no la contesta, por lo de arriba.

Lo que hoy está mal no es tener un solo corte: es que un solo corte contesta las
dos preguntas, y una de las dos la contesta mal en los dos extremos.

## Las seis decisiones

### 1. El corte de `/vender` pasa a container query — no se baja el breakpoint

**La alternativa descartada** era bajar el corte de esta pantalla a ~880 px con
un breakpoint propio de viewport. A 960 habría entregado el mismo resultado y
sin mecanismo nuevo, pero **no arregla la banda 1024–1090**: ahí el sidebar
vuelve al flujo y las dos columnas siguen prendiéndose sin espacio, así que
habría que taparla aparte con un `overflow-x-auto` en la card del carrito.
Termina siendo la misma cantidad de ediciones resolviendo la mitad del problema,
y deja el número atado a un supuesto sobre el sidebar que ya demostró ser el
error original.

Un container query contesta las dos bandas con una sola regla, sin nombrar
ningún régimen — y de yapa acierta en un caso que ninguna media query puede
cubrir: **colapsar el sidebar devuelve el panel**, porque el espacio
efectivamente apareció.

### 2. El sidebar y el Topbar se quedan mirando el viewport

`components/shell/encabezado.tsx` y sus trece `lg:` **no se tocan**: los
comparten las diez pantallas y responden a la pregunta del viewport.
`hooks/use-mobile.ts` sigue en 1024, y `components/shell/encabezado.test.tsx:199`
—que afirma ese 1024— **tiene que seguir en verde**: es la evidencia de que la
pregunta del viewport no se movió.

`app/(app)/vender/caja.tsx` tampoco se toca, y su caso es la confirmación de que
el corte entre las dos preguntas cae en un lugar real y no arbitrario: sus dos
`lg:hidden` (`ChipsDeEstado` en `caja.tsx:335` y el disparador de
`ControlDeCaja`) son las copias móviles de lo que en escritorio vive en el
`acciones` del Topbar, que `Encabezado` envuelve en `hidden lg:flex`. Moverlas al
contenedor las desincronizaría de su pareja: a 960 los chips aparecerían dos
veces o ninguna.

### 3. El número vive una sola vez, como `--container-cobro`

Tailwind v4.3 (`tailwindcss ^4.3.3`) trae container queries de fábrica: la clase
`@container`, variantes arbitrarias `@min-[850px]:` y tamaños propios declarados
como variables `--container-*` del tema.

**Se usa el tamaño con nombre, no el arbitrario.** Un `@min-[850px]:` repetido en
noventa clases es el mismo número escrito noventa veces, que es exactamente lo
que este repo ya rechazó para el `version` de `package.json` contra el tag de git
y para el conteo de pantallas de la maqueta. `--container-cobro` en
`app/globals.css` lo deja en un solo lugar, y las clases lo nombran
(`@cobro/venta:flex-row`).

**El contenedor se nombra (`@container/venta`), y no es prolijidad.** Una consulta
sin nombre resuelve contra el contenedor **más cercano**, y
`components/ui/card.tsx:28` ya establece uno: `CardHeader` lleva
`@container/card-header`. `/vender` no usa `CardHeader` hoy, pero el día que lo
use, cualquier `@cobro:` que quedara adentro pasaría a preguntar por el ancho de
un encabezado de card en vez de por el del cuerpo — en silencio, sin ningún
error. Nombrar el contenedor y apuntarle por nombre cierra esa puerta antes de
que se abra.

### 4. El umbral es 850, derivado de constantes que el proyecto ya fijó

`48` del `p-6` + `392` (el mínimo del carrito que declara `hooks/use-mobile.ts`)
+ `18` del gap + `384` del panel = **842**, redondeado a **850**. No es una
estimación nueva: es la aritmética que el ciclo móvil quiso hacer, completa.

Lo que da, contra el estado de hoy. La columna "contenedor" es el ancho del
`SidebarInset`, que es contra lo que se compara el umbral — **sin** descontar
padding, por la decisión 6:

| ventana | sidebar | contenedor | hoy | con el cambio |
|---|---|---|---|---|
| **960** | `Sheet` | 960 | teléfono | **dos columnas, carrito 510** |
| 1023 | `Sheet` | 1023 | teléfono | dos columnas, carrito 573 |
| 1024 | 248 px | 776 | dos columnas, carrito 326 | teléfono |
| 1097 | 248 px | 849 | dos columnas, carrito 399 | teléfono |
| 1098 | 248 px | 850 | dos columnas, carrito 400 | dos columnas, carrito 400 |
| 1280 | 248 px | 1032 | dos columnas, carrito 582 | igual |
| 1024, sidebar colapsado | 0 | 1024 | teléfono | **dos columnas, carrito 574** |

El layout ancho vuelve, con el sidebar abierto, a partir de **1098 px de
ventana** (850 + los 248 del sidebar).

**El número es lo único de este ciclo que ningún test puede juzgar.** 850 es
defendible en papel; si el `min-content` real del carrito resulta mayor que los
392 declarados, hay que subirlo. Eso lo mide una persona en un navegador (ver
*Verificación*).

### 5. El lado JavaScript observa el mismo elemento, no el viewport

`app/(app)/vender/punto-de-venta.tsx:1006` lee hoy el corte desde JavaScript:
`const enTelefono = useIsMobile()`, que en `:1013` produce `pasoVisible` y desde
ahí gobierna cuatro props del `<Encabezado>` — el título ("Vender" / "Cobro"), el
subtítulo con el total, la flecha de volver y `controlMovil`.

Si el CSS pasa al contenedor y ese `useIsMobile()` se queda en el viewport, los
dos se desincronizan justo en la banda que este ciclo arregla: a 960 px con las
dos columnas a la vista, un `?paso=cobro` en la URL dejaría el Topbar diciendo
"Cobro" con flecha de volver. Es el modo de falla de las dos copias de un botón
que CLAUDE.md ya documentó, con `tsc` y el gate entero en verde.

`enTelefono` pasa entonces a un `ResizeObserver` sobre el mismo envoltorio que
lleva el `@container`, contra la misma constante. **Son dos mecanismos leyendo un
número, no dos números**: la constante de TypeScript y `--container-cobro` quedan
atadas por un caso en las dos direcciones, que es el mismo mecanismo con el que
este repo ata `design/arandano.pen` a `app/globals.css`.

**El costo aceptado**: el servidor no tiene ancho que medir, así que el primer
render asume el layout ancho y se corrige al montar — exactamente lo que ya hace
`useIsMobile()` con su `getServerSnapshot()`, que devuelve `false`. No es una
regresión; es el mismo comportamiento con otra fuente.

### 6. El contenedor no lleva padding

El `@container/venta` va en un envoltorio **sin padding**, con el `<div>` del
cuerpo —el que hoy lleva `px-[14px] py-3 lg:gap-[18px] lg:p-6`— adentro. Si el
contenedor midiera su propio padding y ese padding además cambiara por container
query, la consulta dependería de su propio resultado. Con el envoltorio afuera,
el ancho consultado es el del `SidebarInset` y no depende de nada que la consulta
decida.

## El alcance

**Se toca:**

- **`app/(app)/vender/punto-de-venta.tsx`** — los noventa `lg:`. Se revisaron uno
  por uno y **todos pertenecen a la pregunta del contenedor**: la fila
  (`:1801`), la visibilidad de las dos cards (`:1818` y `:2325`), el switch de
  tarjetas a tabla del carrito (`lg:contents`,
  `lg:grid-cols-[1fr_104px_110px_130px_28px]`, y los `lg:border-b` /
  `lg:group-hover:` / `lg:h-full` que devuelven a mano lo que `display: contents`
  se lleva), el pie del teléfono y el padding del cuerpo. Ninguno es del Topbar.
  Más el envoltorio nuevo y el reemplazo de `useIsMobile()`.
- **`app/globals.css`** — `--container-cobro`, una vez.
- **Un hook nuevo** para el ancho observado, al lado de `hooks/use-mobile.ts`.
- **Tests y documentación** (abajo).

**No se toca:** `components/shell/encabezado.tsx`, `hooks/use-mobile.ts`,
`app/(app)/vender/caja.tsx`, `components/ui/sidebar.tsx` y las otras nueve
pantallas. Cada uno con su razón en la decisión 2.

## Lo que cambia a la vista, incluido lo que empeora

- **A 850–1024 px aparecen las dos columnas.** Es el objetivo del ciclo.
- **A 1024–1097 px se pasa a ver el layout de teléfono, donde hoy hay dos
  columnas.** Es el costo real y va escrito, no disimulado: es una capacidad que
  hoy está y mañana no. Es la respuesta correcta en casi toda la banda —el
  carrito va de 326 px a 399, y está por debajo de los 392 declarados hasta los
  1090— y tiene salida a mano: colapsando el sidebar vuelve. **Los últimos ocho
  píxeles de la banda (1090–1097) son el precio de redondear 842 a 850**: ahí el
  carrito estaría apenas por encima del mínimo y aun así cae al layout de
  teléfono. Se acepta a cambio de un umbral que se pueda decir en voz alta.
- **Lo que hoy pasa en esa banda no se pudo medir**, y conviene decirlo así: se
  sabe con certeza que el carrito queda debajo de los 392 px; no se sabe si
  además desborda, porque eso depende del `min-content` real del carrito y medirlo
  necesita un navegador. El cambio reemplaza una banda cuyo resultado depende del
  contenido por una respuesta definida.
- **Un local que trabaja maximizado en 1280 o más no ve ninguna diferencia.**

## Riesgos

- **`container-type: inline-size` crea un contexto de contención**, y eso cambia
  el origen de cualquier `position: fixed` descendiente. Los popovers de Radix y
  los `Sheet`/`Dialog` portalean al `body`, así que quedan afuera; el pie y el
  encabezado son `sticky`, que no se ve afectado. **Hay que comprobarlo, no
  asumirlo**: un `Select` del panel de cobro anclado en el lugar equivocado sería
  el síntoma.
- **Una variante de Tailwind que no existe no emite CSS y no da error.** Si
  `@cobro/venta:` estuviera mal escrito, la pantalla se serviría con el layout de
  teléfono en todos los anchos y el gate entero quedaría en verde. La red es un
  caso que mire el CSS generado, no sólo el fuente (ver abajo).
- **El worktree no sirve para mirarlo.** `arandano-dev` bind-montea
  `/root/arandano`, así que la verificación visual va después del merge, como en
  los ciclos anteriores.

## Cómo se ata

- **El bloque de `app/(app)/vender/punto-de-venta.test.tsx:2019` se reescribe.**
  Hoy afirma literalmente `flex flex-col gap-[18px] lg:flex-row`, los dos
  `hidden lg:flex`, `lg:w-96` y que no aparezca ningún `md:`/`sm:`/`xl:`/`max-lg:`.
  Pasa a afirmar las variantes de contenedor y, **en la dirección inversa, que no
  quede ningún `lg:` en ese archivo** — sin las dos direcciones, una clase que se
  quedara atrás pasaría igual, que es el defecto que este mismo repo ya pagó con
  las dos copias de "Anular orden".
- **Un caso nuevo ata el número en las dos direcciones**: la constante de
  TypeScript contra `--container-cobro` de `app/globals.css`, y que el archivo no
  use ningún `@min-[NNNpx]` literal — el píxel se escribe una vez o no se escribe.
- **Un caso mira el CSS generado**, no el fuente, y exige que contenga la regla
  `@container` con el umbral. Es la única red contra una variante mal escrita.
- **`components/shell/encabezado.test.tsx:199` sigue en verde sin tocarse**, y eso
  es parte de la afirmación del ciclo: la pregunta del viewport no se movió.
- **`test/responsive.test.ts` sigue sirviendo sin cambios**, pero por un motivo
  más angosto del que parece: ese caso sólo mira `w-[Npx]`, `min-w-[Npx]` y
  `basis-[Npx]`, y ninguna de las clases que este ciclo convierte es de esa
  familia. **Su punto ciego nuevo, que va anotado en el propio archivo**: la
  clase de caracteres del prefijo de variante de su regex no incluye la `/`, así
  que un `@cobro/venta:w-[400px]` futuro le resultaría invisible — ni prefijado
  ni suelto. El día que se agregue un ancho fijo con esta variante, hay que
  sumarle la `/` a ese regex.
- **Documentación**: la sección `/vender` de `docs/pantallas.md`, y una entrada en
  CLAUDE.md que registre la revisión de la decisión "un solo corte, 1024 px" —
  con el porqué, para que no se lea como que la regla se abandonó.

## Verificación

**Lo que ningún test contesta, y es justo el número.** Con el navegador en 960,
1024, 1098 y 1280, y una vez más a 1024 con el sidebar colapsado:

1. Que a 960 las dos columnas entren y el carrito con 510 px no se vea apretado.
2. Que a 1024 el layout de teléfono aparezca completo —pie con "Cobrar →",
   encabezado del carrito, tarjetas en vez de tabla— y no a medias.
3. Que a 1098 —el borde exacto, donde el carrito queda en 400 px— el panel mida
   sus 384 y nada desborde. Es el ancho que decide si el 850 se sostiene o hay
   que subirlo.
4. Que colapsar el sidebar a 1024 devuelva las dos columnas.
5. Que los `Select` de medio, moneda, cubre y plan se abran anclados donde
   corresponde en los cuatro anchos (el riesgo de la contención).
6. Que redimensionar de 960 a 1024 en medio de un cobro no pierda el carrito.

El catálogo del canario de dev hay que sembrarlo antes
(`scripts/sembrar-catalogo-dev.mts`), y con nombres largos: con nombres cortos no
se puede ver dónde está el `min-content` real del carrito, que es lo que valida o
corrige el 850.

## Deploy

**Sin migración, sin columna y sin permiso nuevo.** Es presentación pura: no toca
el schema, ni una server action, ni una consulta. El ciclo entero se revierte
revirtiendo la imagen, así que no hay nada de expand/contract que coordinar.
`lib/permisos/catalogo.ts` no crece.

## Lo que este ciclo NO hace

- **No lleva las otras nueve pantallas al contenedor.** Ninguna tiene dos
  columnas que compitan por el ancho como ésta. El disparador para volver sobre
  alguna es concreto: que a un ancho intermedio se le vea el mismo síntoma.
- **No le pone `min-w-0` ni `shrink-0` a las dos columnas.** Con el corte
  decidido por el espacio real, no queda ningún ancho donde la fila arranque sin
  lugar, así que serían una defensa contra un caso que dejó de existir. Sumarlas
  es aditivo si alguna vez reaparece.
- **No toca `design/arandano.pen`.** La maqueta dibuja 1440 y 390, o sea los dos
  extremos, y no dice nada sobre los anchos intermedios — ni podría: un frame
  estático no modela un rango. No es una divergencia que corregir, así que no va
  a `docs/correcciones-pendientes-del-pen.md`.
- **No arregla la aritmética del comentario de `hooks/use-mobile.ts`** más allá
  de lo necesario: ese archivo conserva su corte de 1024 porque contesta la otra
  pregunta, pero su comentario —que hoy justifica el número con la cuenta
  equivocada— sí se corrige, porque es la fuente del malentendido.
