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

**El color de un arándano**: el azul-violeta de la fruta, sobre papel claro.
Entra saturado en tres lugares y en ninguno más — acciones, foco y selección—,
más el violeta **profundo** que ancla una sola zona por pantalla. Todo el resto
es gris tintado del mismo hue. La contención es la decisión, no una etapa: es lo
que deja margen para que el rojo de un error se destaque de verdad.

**Por qué claro y no oscuro.** La paleta anterior era oscura, y el motivo
escrito era "lo que menos cansa en una pantalla que se mira ocho horas". El
argumento no sobrevivió al lugar donde el producto se usa: un mostrador de
calle, con vidriera detrás y luz de día encima. Sobre una pantalla que compite
con el sol, el fondo oscuro no descansa — refleja. Y el punto de venta se opera
con alguien esperando del otro lado, o sea que lo que importa no es la fatiga a
las seis horas sino leer un número en un segundo.

**Tres superficies, no dos.** El fondo del lienzo (`--background`), el papel de
los paneles (`--card`) y el hundido de los encabezados de tabla
(`--muted`/`--secondary`). Con dos, un encabezado de tabla necesitaba un borde
más para separarse; con tres, se separa por material.

**Tres niveles de texto, no dos.** `--foreground` para el dato,
`--foreground-soft` para rótulos y navegación, `--muted-foreground` para meta y
pie. La paleta anterior tenía dos, y todo lo del medio caía en un extremo: o
competía con el dato o se leía como deshabilitado.

**Un ancla de contenido por pantalla, y una identidad que no cuenta contra esa
regla.** `--marca` —el violeta profundo— entra una sola vez por pantalla
alrededor del número que ESA pantalla existe para mostrar: la banda del total
en `/vender`, el tile "Total del período" en `/ventas`, el stock en la ficha de
un artículo, el estado actual en una orden. Es la regla que reemplaza al "cada
card con su borde": si dos cosas de la misma pantalla piden el ancla, es que no
está claro cuál es el dato. Hay una excepción declarada, no una grieta: el
avatar del pie del sidebar (`components/shell/sidebar-arandano.tsx`), presente
en las diez pantallas a la vez porque es chrome del shell —ancla la identidad
de quién está adentro del sistema— y no el dato de la pantalla actual. El
porqué no rompe la regla, y por qué el `.pen` es quien lo decide, vive más
abajo en *Dónde se usa*.

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
la vista, que es justo lo que la contención compra. `--marca` es mucho más
oscuro que `--primary` y eso lo aleja de "control" y lo acerca a "material". Es
el mismo arándano a otra distancia, no un color nuevo.

**Dónde se usa, y la regla cambió con el rediseño.** Antes eran dos superficies
de marca —el login y la franja de cierre del sitio— y la sección decía que una
**tercera** obligaba a rediscutir la regla. Llegó esa tercera, y la discusión se
dio: la regla nueva no es "dos superficies y no más", es **una por pantalla, y
siempre alrededor del dato principal**.

**El rediseño del shell (2026-08-21) sumó una séptima, y ésta no encaja en el
mismo molde que las otras seis.** El avatar del pie del sidebar
(`components/shell/sidebar-arandano.tsx:89`) pinta su fondo con `var(--marca)`.
Verificado contra `design/arandano.pen` —frame `Shell/Sidebar`— y no a ojo: el
avatar está pintado con la variable `ar-primary-deep`, que es exactamente
`--marca` (`#2A1760`, la misma equivalencia que ata `test/maqueta.test.ts`). El
`.pen` manda, así que lo que se ajusta es esta regla, no el color del avatar.
La diferencia con las otras seis es que el avatar no es **por pantalla**: está
en las diez a la vez, porque es chrome del shell —ancla quién está adentro del
sistema— y no el dato que cada pantalla en particular existe para mostrar.

| Superficie | Qué ancla |
|---|---|
| Paño del login (`app/login/persiana.module.css`) | El nombre del local |
| Franja de cierre del sitio (`app/sitio/cierre.module.css`) | La conversión |
| Avatar del pie del sidebar (`components/shell/sidebar-arandano.tsx`) | Quién está adentro — en las diez pantallas, no en una sola |
| Banda del total en `/vender` | El importe que se dice en voz alta |
| Tile "Total del período" en `/ventas` | Lo que entró en el período |
| Bloque de stock en la ficha de un artículo | Cuánto hay |
| Estado actual en la ficha de una orden | En qué anda el equipo |
| Card "Núcleo" en la landing (`app/sitio/secciones.tsx`, sección Módulos) | El núcleo del producto — la landing no tiene un dato operativo que anclar |
| Card "Profesional" en Planes, landing (`app/sitio/secciones.tsx`) | El plan recomendado |

**Y eso reescribe "no se usa dos veces en la misma vista", sin aflojarlo.** La
regla sigue rigiendo entera entre las seis anclas de **contenido**: dos de
ellas conviviendo en la misma pantalla siguen siendo un problema de jerarquía
sin resolver, exactamente como antes. Lo que cambia es que el avatar no cuenta
contra esa cuenta —es identidad persistente, no una segunda ancla de contenido
compitiendo por la misma pantalla—, así que el día que se construya la banda
del total de `/vender` esa pantalla va a mostrar **dos** superficies de
`--marca` a la vez (el avatar arriba, la banda abajo) y eso es lo esperado, no
una regresión de esta regla: una ancla quién sos, la otra ancla qué estás
mirando. `--marca` **sigue sin ser** un fondo de pantalla y **sigue sin**
entrar en nada que no sea una identidad o un dato principal — eso no cambió.

**Y la landing del ápex suma dos superficies más (Task 4 del cierre del
rediseño, 2026-08-22), sin que la cuenta se rompa por otro motivo.** Antes de
este ciclo la franja de Cierre era la única marca del sitio público; ahora
`design/arandano.pen` (frame `Sitio / Landing`, consultado en vivo) dibuja
además la card "Núcleo" —dentro de la sección Módulos— y la card
"Profesional" —la destacada de Planes— con el mismo `$ar-primary-deep`, o sea
`--marca`. Tres superficies en un solo documento HTML, y la regla de arriba
sigue sin aflojarse: lo que cambia es la unidad de cuenta. Una pantalla de
aplicación es un solo encuadre que se mira entero de una vez —por eso "dos
anclas ahí" es sin remedio un problema de jerarquía—, pero la landing es una
página que se recorre con scroll, banda por banda, y el Cierre nunca está a
la vista al mismo tiempo que Módulos o Planes. La cuenta que importa —"¿hay
dos cosas compitiendo por la misma mirada, en el mismo momento?"— sigue dando
como máximo una por vez, igual que en cualquier pantalla de la aplicación; lo
que deja de valer, sólo acá, es medirla contra el documento entero en lugar de
contra la banda visible. Y ninguna de las dos ancla un número: la card
Núcleo ancla la idea que sostiene el producto (núcleo + módulos), la card
Profesional ancla la recomendación de precio — ninguna compite con la
conversión, que sigue siendo lo único que el Cierre ancla.

**Lo que esto NO habilita** (hallazgo (a) de la review final del cierre: una
regla que no puede rechazar nada no es una regla). En la landing: como máximo
**una** superficie de marca por sección, nunca dos secciones **consecutivas**
—Planes y Cierre lo son, y conviven en pantalla en ciertas posiciones de
scroll; ahí el argumento de "la banda visible" es más débil de lo que este
documento admitía antes de esta vuelta—, y la superficie tiene que anclar algo
propio de ESA sección (la idea que la sostiene, o su recomendación), no
"decorar la pantalla porque quedaba sosa". Una card violeta puesta porque
"convenía un poco de color acá" —sin una idea, un precio o un dato propios de
la sección detrás— es exactamente la deriva que esta regla existe para frenar,
no una tercera excepción más.

**Y lleva sus propios colores de texto encima** — `--marca-foreground`,
`--marca-soft` y `--marca-dim`— en vez de reusar `--foreground`. La confusión
que eso evita ya costó un bug: sobre la paleta oscura, `--foreground` servía
para las dos cosas, y al aclarar el fondo cualquiera que hubiera escrito
`--foreground` sobre el paño se quedaba con texto casi negro sobre violeta
profundo. Ahora el token dice sobre qué va.

## Los tokens

<!-- tokens:inicio -->

| Token | Valor |
|---|---|
| `--background` | `#F6F5F9` |
| `--card` | `#FFFFFF` |
| `--popover` | `#FFFFFF` |
| `--secondary` | `#EEEBF4` |
| `--muted` | `#EEEBF4` |
| `--foreground` | `#171221` |
| `--foreground-soft` | `#4A4358` |
| `--muted-foreground` | `#6B6478` |
| `--card-foreground` | `#171221` |
| `--popover-foreground` | `#171221` |
| `--secondary-foreground` | `#171221` |
| `--primary` | `#4A2AA5` |
| `--primary-foreground` | `#FFFFFF` |
| `--primary-hover` | `#3B2183` |
| `--accent` | `#EDE8FB` |
| `--accent-foreground` | `#4A2AA5` |
| `--ring` | `#4A2AA5` |
| `--marca` | `#2A1760` |
| `--marca-foreground` | `#FFFFFF` |
| `--marca-soft` | `#B6A6E8` |
| `--marca-dim` | `#9C8BD6` |
| `--marca-halo` | `#6A4FB9` |
| `--ok` | `#0F7048` |
| `--ok-soft` | `#E1F3EA` |
| `--warn` | `#9A5B00` |
| `--warn-soft` | `#FBF0DC` |
| `--destructive` | `#B32318` |
| `--destructive-soft` | `#FDE9E7` |
| `--border` | `#E3E0EC` |
| `--input` | `#CFCADD` |
| `--sidebar` | `#FFFFFF` |
| `--sidebar-foreground` | `#171221` |
| `--sidebar-primary` | `#4A2AA5` |
| `--sidebar-accent` | `#EDE8FB` |
| `--sidebar-accent-foreground` | `#4A2AA5` |
| `--sidebar-border` | `#E3E0EC` |
| `--sidebar-ring` | `#4A2AA5` |
| `--radius` | `0.625rem` |

<!-- tokens:fin -->

Los marcadores de arriba y abajo no son decoración: el parser del test busca la
tabla entre ellos, porque este documento tiene otras tablas y agarrar "la
primera" se rompe el día que alguien reordene secciones.

### Los tokens del sidebar

El sidebar de shadcn referencia sus colores por nombre propio: `bg-sidebar`,
`text-sidebar-foreground`, `data-[active=true]:bg-sidebar-accent`. No alcanza
con que el color exista bajo otro token — tiene que existir con **ese** nombre
o la utilidad no resuelve a nada.

Ninguno de los siete es un color nuevo. Cada uno toma el de la variable de
`design/arandano.pen` que la maqueta ya usa en ese lugar del paño, y
`test/maqueta.test.ts` los ata a esa variable en las dos direcciones. Un
`--sidebar-*` con un valor que la maqueta no tenga rompe el build.

Estos siete reemplazan al caso `no quedan tokens de sidebar` de
`test/sistema-de-diseno.test.ts`, que existió justamente hasta que hubo un
componente que los usara.

**Son siete y no los ocho que trae `shadcn add sidebar`.** El octavo,
`--sidebar-primary-foreground`, se podó en el cierre del ciclo del shell
(2026-08-21): el único uso real de `--sidebar-primary` es texto —el rótulo
"ARÁNDANO" de la marca del sidebar, que no es el cartel (el nombre del local,
debajo, en otro token)—, no hay ningún fondo pintado con ese color, y sin un
fondo `--sidebar-primary` no hay superficie que necesite un color "encima". El
candidato natural para usarlo era el avatar del pie, pero pinta su fondo con
`--marca` y su texto con `--marca-foreground` — los dos resuelven a `#FFFFFF`
igual que `--sidebar-primary-foreground`, así que a la vista no cambia nada,
pero el token que corresponde semánticamente es el que ya estaba puesto. Es
exactamente el riesgo que el párrafo de arriba nombra sin decirlo: reintroducir
los ocho tokens de shadcn no significa que un componente real los use a los
ocho.

### Dónde entra el arándano

| Token | Hex | Dónde se ve |
|---|---|---|
| `--primary` | `#4A2AA5` | Botón de acción, links, número de orden y de venta |
| `--primary-hover` | `#3B2183` | El botón de acción, apuntado |
| `--ring` | `#4A2AA5` | Anillo de foco — lo más visible al operar con teclado |
| `--accent` | `#EDE8FB` | Fila seleccionada, pestaña activa, chips de estado neutro-positivo |
| `--marca` | `#2A1760` | El ancla de cada pantalla, una sola vez. Ver arriba |

Lo que los distingue es luminosidad, no tono: es un solo color de marca visto a
cinco distancias.

### Los tres estados

`--ok`, `--warn` y `--destructive`, cada uno con su fondo tenue (`-soft`).
**Existen como tokens y no como colores sueltos en un componente** porque son la
diferencia entre un aviso que se lee y un `<p>` gris, que es lo que había antes
en todas las pantallas.

| Token | Hex | Dónde se ve |
|---|---|---|
| `--ok` sobre `--ok-soft` | `#0F7048` / `#E1F3EA` | El vuelto, la caja abierta, una venta cobrada, un ingreso de mercadería |
| `--warn` sobre `--warn-soft` | `#9A5B00` / `#FBF0DC` | Stock insuficiente al vender, la clave que se muestra una sola vez, un ajuste por conteo |
| `--destructive` sobre `--destructive-soft` | `#B32318` / `#FDE9E7` | El faltante del cobro, una venta anulada, stock negativo, la zona de anular |

**El ámbar no es un rojo suave, y esa distinción es load-bearing.** Vender sin
stock está permitido a propósito —el motor lo permite y la pantalla no puede ser
más estricta que el motor sin volverse mentirosa—, así que el aviso tiene que
decir "mirá esto" y no "esto está mal". El rojo se reserva para lo que de verdad
no cierra: una venta que no suma, un stock negativo, una anulación.

### Contraste

Los pares se midieron convirtiendo cada hex a **el byte que se pinta** →
luminancia relativa → ratio WCAG 2.1, que es lo que reportan axe y Lighthouse.

**Ya no hay un script que los recalcule.** `scripts/contraste.mts` y
`test/contraste.test.ts` se borraron con el rediseño, y conviene decir por qué
en vez de dejarlo como una poda silenciosa: aquel mecanismo medía **una lista de
pares declarada a mano**, así que sólo cubría lo que alguien se acordó de
escribir. El único bug de accesibilidad real que tuvo el producto —dos utilidades
usando `--primary-foreground` como "el color claro" sobre el paño de marca, en
1.39:1— **no lo encontró el script**: lo encontró un grep, porque los dos colores
seguían siendo colores válidos y el par no estaba en la lista. Lo que sí atrapó
algo sobrevivió: el caso que prohíbe nombrar `--primary-foreground` fuera de
`components/ui/`, en `test/sistema-de-diseno.test.ts`.

Los valores de esta tabla se midieron una vez, al elegir la paleta, y son parte
de la decisión escrita:

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 16.90 | 4.5 | ok |
| `--foreground` sobre `--card` | 18.34 | 4.5 | ok |
| `--foreground` sobre `--muted` | 15.57 | 4.5 | ok |
| `--foreground-soft` sobre `--background` | 8.66 | 4.5 | ok |
| `--foreground-soft` sobre `--card` | 9.40 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 5.20 | 4.5 | ok |
| `--muted-foreground` sobre `--card` | 5.65 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 4.79 | 4.5 | ok |
| `--primary` sobre `--background` | 8.93 | 4.5 | ok |
| `--primary` sobre `--card` | 9.70 | 4.5 | ok |
| `--primary` sobre `--accent` | 8.10 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 9.70 | 4.5 | ok |
| `--marca-foreground` sobre `--marca` | 15.11 | 4.5 | ok |
| `--marca-soft` sobre `--marca` | 6.91 | 4.5 | ok |
| `--marca-dim` sobre `--marca` | 5.09 | 4.5 | ok |
| `--ok` sobre `--ok-soft` | 5.31 | 4.5 | ok |
| `--ok` sobre `--card` | 6.12 | 4.5 | ok |
| `--warn` sobre `--warn-soft` | 4.81 | 4.5 | ok |
| `--warn` sobre `--card` | 5.43 | 4.5 | ok |
| `--destructive` sobre `--destructive-soft` | 5.67 | 4.5 | ok |
| `--destructive` sobre `--card` | 6.62 | 4.5 | ok |
| `--ring` sobre `--card` | 9.70 | 3.0 | ok |
| `--input` sobre `--card` | 1.60 | 3.0 | **excepción declarada** |

**`--muted-foreground` es el token que más costó.** El valor de la maqueta
(`#7A7389`) daba 4.17 sobre el fondo y 3.84 sobre el hundido: no llegaba en dos
de sus tres superficies, y el hundido es justamente donde vive el encabezado de
cada tabla. Se oscureció a `#6B6478`, que deja 5.20 / 5.65 / 4.79. El cambio se
hizo también en `design/arandano.pen`, para que la maqueta y el código no se
separen en el primer día.

**Una excepción**, con su razón y con lo que la haría caducar:

**`--input` sobre `--card` da 1.60**, contra los 3:1 que WCAG 1.4.11 pide
para identificar un control. Es el mismo caso que ya traía la paleta anterior
(1.63) y se acepta por lo mismo: el borde tenue es deliberado, y todo campo
lleva `<Label>` asociado más anillo de foco de marca, así que el borde no es
el único indicio de que ahí hay un input. **Revisar** ante un reporte real de
gente que no encuentra los campos, o ante una auditoría formal.

### El ticket de servicio técnico no usa tokens

`app/(app)/servicio-tecnico/[id]/ticket/ticket.module.css` es la única
superficie del producto que escribe colores literales: `#000` sobre `#fff`.

**Por qué**: una impresora térmica quema un solo color y el fondo es el papel.
No hay tema que aplicar — un token ahí no significaría nada. Con la paleta clara
los valores se parecen más que antes, y eso **no** vuelve la excepción
innecesaria: `--background` no es blanco papel y `--foreground` no es negro
tinta, así que heredarlos imprimiría un gris lavado sobre un fondo que la
térmica no puede quemar.

**Qué la haría caducar**: que el ticket deje de imprimirse y pase a ser sólo una
pantalla, o que aparezca una impresora a color. Ninguna de las dos está prevista.

## Tipografía

**La pila del sistema**, que es la que Tailwind define para `font-sans`:

```
-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
'Noto Sans', Arial, sans-serif, y las cuatro familias de emoji
```

No es un default que quedó: es una decisión. Cero bytes, cero salto de fuente al
cargar, y se ve nativa en el Windows del mostrador igual que en el Android del
dueño. **Sigue siendo la pila del cuerpo de toda la aplicación**: botones y
texto corrido no la abandonan en ninguna pantalla; cuatro roles salían hacia
Archivo antes de este ciclo: el cartel —el nombre del local—, que desde el
ciclo del cartel paga Archivo también en
el header de la aplicación y no sólo en el login; el importe —la plata—, que
desde ese ciclo paga Archivo en `/vender`: ahí los importes de la tabla y de
la lista de resultados, la banda del total (monto y signo, cada uno con su
propio tamaño), los campos de monto, cotización y recibido del formulario de
cobro, y los chips de vuelto, faltante y la equivalencia de un pago en
dólares, van en Archivo y no en la pila del sistema; el título de pantalla
(`h1`), que desde el encabezado de 66 px de ese ciclo paga Archivo en las
diez pantallas de la aplicación y no la pila del sistema que pagaba antes (ver
*La cara de display: Archivo* más abajo); y, del rediseño de `/vender`
(`app/(app)/vender/cobro.module.css`), el título de la card de Cobro y el
texto del botón "Cobrar" — dos rótulos que no son plata ni el `h1` de la
pantalla, así que no encajaban en ninguno de los otros roles.

**El rediseño de `/ventas` y `/ventas/[id]` sumó seis roles más**, los seis en
`app/(app)/ventas/tipografia.module.css` y los seis SIN `font-stretch` propio
(ver el porqué en *La cara de display: Archivo*): el título de card (los
encabezados "Qué se vendió", "Cómo se pagó", "Resumen", "Últimas ventas" y
"Cómo entró la plata" — 15 px, peso 600); el valor de los tiles del resumen
del período (32 px el tile de marca, 26 px los otros dos, tracking -0.6 px);
los montos de tabla del listado y del detalle (14 px, heredado de `text-sm`
de `<Table>`, sin tamaño propio); la banda de Total del detalle de venta
(22 px, peso 600); los números de paginación (13 px, peso 600); y la
cotización de cada pago en la tabla "Cómo se pagó" (14 px, mismo tratamiento
que un monto de tabla pero un dato distinto: una tasa de cambio, no plata).
Con éstos son **diez** los roles que Archivo cubre en total.

**El rediseño de `/inventario` (este ciclo) sumó dos roles más**, los dos en
`app/(app)/inventario/tipografia.module.css`: el código, precio y stock de la
tabla del listado (14 px, heredado de `text-sm` de `<Table>` igual que un monto
de tabla, pero con un rango de peso propio — 400 a 700 según la columna y el
estado de la fila, porque acá el peso también dice "negativo" o "desactivado",
algo que ningún rol anterior necesitaba); y el número de paginación de esta
pantalla (13 px, peso 600 — el mismo tratamiento que ya usa `/ventas`, con una
fila propia en la escala porque son pantallas distintas, aunque comparten el
mismo rótulo en negrita: `MODULOS_POR_ROL` en `test/tipografia.test.ts` las
junta bajo una sola clave a propósito, con un módulo CSS por pantalla). Con
éstos son **doce** los roles que Archivo cubre en total.

**El rediseño de `/servicio-tecnico` (Task 2 del ciclo de las tres pantallas)
sumó dos roles más**, los dos en
`app/(app)/servicio-tecnico/tipografia.module.css`: el número de orden de la
columna ORDEN del listado (14 px, heredado de `text-sm` de `<Table>` igual
que un monto de tabla, peso 700 y en `--primary` porque además es el link a
la ficha de la orden) y el conteo de cada chip de filtro, tanto el de
"Abiertas" como el de cada estado (12 px, peso 700). El título de card de esa
misma pantalla ("Equipos en el local") y su paginación no son roles nuevos:
reusan *Título de card* y *Número de paginación* respectivamente, que suman
así su cuarta y su tercera pantalla. Con los dos roles nuevos son **catorce**
los roles que Archivo cubre en total.

**El cierre del rediseño (Usuarios y Login) sumó un rol más.** El título de
card de `/usuarios` ("El equipo del local", "Agregar a alguien") no es un rol
nuevo: reusa *Título de card* (`app/(app)/usuarios/tipografia.module.css`),
que suma así su quinta pantalla. Consultado en vivo con el MCP de Pencil —y a
diferencia de lo que decía el relevamiento escrito de ese ciclo—, la tercera
card de esa misma pantalla ("Dos reglas que el sistema no deja romper") NO
paga Archivo: usa la pila del sistema a 13 px/700, así que queda fuera de
esta tabla. Lo que sí es nuevo es el H1 "Entrar" del login (28 px/600, sin
`font-stretch` propio, en `app/login/persiana.module.css`). Con este último
son **quince** los roles que Archivo cubre en total.

**La landing (Tasks 3-5 del cierre del rediseño) sumó siete roles más**,
todos en `app/sitio/secciones.tsx` salvo donde se aclara, y ninguno con
`font-stretch` propio (mismo motivo que Cobro y los roles de /ventas: no le
piden nada al eje `wdth`): el H1 del Hero (62 px/700, tracking -2 px); el
título de sección que comparten Módulos, Rubros y Planes (38 px/700, tracking
-1 px — una sola fila para los tres, porque es literalmente el mismo
componente, `TituloDeSeccion`, no tres tamaños elegidos por separado); el H2
del Cierre (44 px/700, tracking -1.4 px, `app/sitio/cierre.module.css`); la
marca "Arándano" del Nav (17 px/700); el título de la card "Núcleo" (20 px,
`text-xl`, sin tamaño arbitrario propio); el título de cada card de módulo
—Órdenes de trabajo, Turnos, Gastronomía— (19 px/600); y el monto de cada
plan en Planes (32 px/700, tracking -1 px). El retrato del carrito
(`app/sitio/retrato.tsx`, Task 3) **no** suma un rol nuevo: reusa *Importe*
letra por letra, con el mismo `components/importe.module.css` que
`punto-de-venta.tsx` — es una reconstrucción del carrito real, no una
pantalla con su propia decisión tipográfica. Con los siete de la landing son
**veintidós** los roles que Archivo cubre en total.

`--font-heading: var(--font-sans)`: los demás títulos —los que no son ninguno
de los veintidós roles ya contados— usan la misma familia.

### La escala

Los roles, con su cara y su tamaño. Un texto que no encaja en ninguno de estos
roles es señal de que falta una decisión, no de que falte un tamaño.

<!-- escala:inicio -->

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Cartel** — nombre del local | Archivo | 19 px en el cartel del sidebar, igual en los dos anchos; en el paño del login, 32 px en el teléfono y `clamp(40 px, 7vw, 88 px)` en escritorio | 600, `font-stretch: 112%` |
| Título de pantalla (`h1`) | Archivo | 17 px en el teléfono, 21 px en escritorio | 600 |
| Pestaña de navegación | sistema | 14 px | 500; activa 600 |
| Nombre de usuario, inicial del avatar — pie del sidebar | sistema | 13 px | 600 |
| Rol del usuario (pie del sidebar), subtítulo del encabezado | sistema | 11 px | 400, `--muted-foreground` |
| Rótulo "ARÁNDANO", stack · sha — pie del sidebar | sistema | 10 px | 700 el rótulo (`tracking-[0.16em]`); 400 stack · sha, `--muted-foreground` |
| Meta — texto que acompaña a un dato sin competirle | sistema | 12 px | 400; `--muted-foreground` en superficie clara, `--marca-dim` sobre la banda oscura del total |
| **Importe** — plata en el punto de venta | Archivo | 42 px el monto de la banda del total; 24 px su signo; 15 px los chips de vuelto y faltante; 14 px la columna | 600 el monto y los chips, 500 el signo, 400 la columna; `font-stretch: 85%`, `tabular-nums` |
| **Cobro** — título de la card y texto del botón "Cobrar" | Archivo | 16 px el título; 17 px el botón; 14 px el encabezado del carrito, que existe **sólo** en el teléfono | 600 |
| **Título de card** — encabezados de card en /ventas, /ventas/[id], /inventario/nuevo, /inventario/[id], /servicio-tecnico, /usuarios y /formas-de-pago | Archivo | 15 px en los dos anchos; con una excepción en /usuarios que se da vuelta según el ancho — ver la nota debajo de la tabla | 600 |
| **Valor de tile** — resumen del período en /ventas; ficha de /inventario/[id] | Archivo | en /ventas, 30 px el tile de marca en el teléfono y 32 en escritorio, 24 y 26 los otros dos; en la ficha de /inventario/[id], 34 px el tile de marca en los dos anchos y 19/24 el otro — la maqueta de esa pantalla usa un tamaño distinto para su tile de marca | 600, tracking -0.6 px, `tabular-nums` |
| **Monto de tabla** — listado de /ventas y detalle de /ventas/[id] | Archivo | 15 px en el teléfono, 14 px en escritorio (ver la nota del `<Table>` debajo de la tabla) | 400 a 600 según la columna, `tabular-nums` |
| **Banda de Total** — pie de la tabla "Qué se vendió" en /ventas/[id] | Archivo | 22 px | 600, `tabular-nums` |
| **Número de paginación** — /ventas | Archivo | 13 px | 600 |
| **Cotización** — columna de la tabla "Cómo se pagó" en /ventas/[id] | Archivo | 14 px; en el teléfono esa columna no existe — la cotización va como texto dentro de la línea de meta del pago, en la pila del sistema (ver la nota del `<Table>` debajo de la tabla) | 400, `tabular-nums` |
| **Código/precio/stock de tabla** — listado de /inventario | Archivo | 14 px el precio en los dos anchos y el código y el stock en escritorio; en el teléfono el stock baja a 12 px en la línea de meta y el código deja de pagar esta cara —va como texto de esa misma línea, en la pila del sistema | 400 a 700 según la columna y el estado de la fila, `tabular-nums` |
| **Número de paginación** — /inventario | Archivo | 13 px | 600 |
| **Número de paginación** — /servicio-tecnico | Archivo | 13 px | 600 |
| **Número de orden** — columna ORDEN del listado de /servicio-tecnico | Archivo | 14 px en los dos anchos | 700 |
| **Conteo de chip** — chips de filtro del tablero de /servicio-tecnico | Archivo | 12 px en la pastilla de escritorio; 17 px en la card de la grilla del teléfono, donde el conteo pasa a ser el dato principal y el rótulo baja a 10 px | 700 en escritorio; 600 en el teléfono |
| **H1 de login** — título "Entrar" del formulario | Archivo | 26 px en el teléfono, 28 px en escritorio | 600 |
| **H1 del Hero** — "Todo el local en un solo lugar", landing | Archivo | 36 px en el teléfono, 62 px en escritorio | 600 sin tracking en el teléfono; 700 y tracking -2 px en escritorio |
| **Título de sección** — H2 compartido por Módulos, Rubros y Planes, landing | Archivo | 26 px en el teléfono, 38 px en escritorio | 600 sin tracking en el teléfono; 700 y tracking -1 px en escritorio |
| **H2 del Cierre** — "El alta es instantánea", landing | Archivo | 28 px en el teléfono, 44 px en escritorio | 600 sin tracking en el teléfono; 700 y tracking -1.4 px en escritorio |
| **Marca del Nav** — "Arándano", landing | Archivo | 16 px en el teléfono, 17 px en escritorio | 600 en el teléfono, 700 en escritorio |
| **Título de la card Núcleo** — landing | Archivo | 17 px en el teléfono, 20 px (`text-xl`) en escritorio | 600 |
| **Título de card de módulo** — Órdenes de trabajo / Turnos / Gastronomía, landing | Archivo | 19 px | 600 |
| **Monto del plan** — precio de cada card en Planes, landing | Archivo | 32 px | 700, tracking -1 px |

<!-- escala:fin -->

**Un rol, dos tamaños: la columna "Tamaño" dice los dos cuando difieren
(ciclo del teléfono, 2026-08-26).** Hasta ese ciclo cada rol tenía un número
solo, porque había una sola maqueta. Ahora hay dos —`design/arandano.pen`
dibuja las trece pantallas en 1440 px y en 390— y el corte entre ellas es
único, 1024 px, así que un rol que se achica en el teléfono declara acá sus
dos valores en vez de mudarse a un rol nuevo. **Que cambie de tamaño no lo
convierte en otro rol**: sigue siendo el mismo texto, con la misma función,
en una pantalla más angosta. Un rol nuevo se justifica cuando cambia lo que el
texto *es* —como pasó con los seis de `/ventas`, párrafo de abajo—, no cuando
cambia cuánto espacio hay. Y al revés: un rol que dice un solo número lo dice
para los dos anchos, y eso también es una decisión — el Cartel del sidebar
(19 px), el Importe (42/24/15/14), la Banda de Total (22 px), los tres
números de paginación (13 px) y el título de card de módulo (19 px) se ven
igual en un teléfono que en una pantalla de escritorio, a propósito.

**La excepción de `/usuarios` se da vuelta según el ancho, y los dos lados
están bien.** De los tres títulos de card de esa pantalla, en **escritorio**
sólo dos pagan Archivo ("El equipo del local" y "Agregar a alguien", 15 px/600):
el tercero, "Dos reglas que el sistema no deja romper", usa la pila del sistema
a 13 px/700 — no es un olvido, es lo que dibuja su nodo de escritorio,
consultado en vivo con el MCP de Pencil. En el **teléfono** la maqueta decide lo
contrario: el nodo `hiqxF` del frame `NIyHG` le da a ese mismo título
`$ar-display`/14/600, o sea que ahí los tres títulos pagan Archivo.

No hay ninguna de las dos versiones que corregir. Son **dos frames distintos
con una decisión distinta cada uno**, y las dos son la autoridad en su ancho —
la misma regla de siempre, aplicada a un archivo que ahora tiene dos maquetas.
El código lo implementa con una `@media (min-width: 1024px)` adentro de
`app/(app)/usuarios/tipografia.module.css` (la clase `.tituloDeReglas`), y no
con un `lg:font-sans` suelto en el JSX, por una razón que vale para cualquier
inversión futura: un CSS Module y las utilidades de Tailwind no tienen orden de
carga garantizado **entre archivos**, así que competir por cascada entre los dos
no tendría un ganador determinístico; con las dos reglas en el mismo archivo, el
orden es fijo.

**La nota del `<Table>`: tres roles decían de dónde heredaban su tamaño, y esa
frase caducó.** *Monto de tabla*, *Cotización*, *Código/precio/stock de tabla* y
*Número de orden* declaraban "14 px (heredado de `text-sm` de `<Table>`, sin
tamaño propio)". El ciclo del teléfono sacó `<Table>` de shadcn de los cuatro
listados y del carrito —pasaron a `grid` + `display: contents`, para que el
mismo árbol sea una tabla arriba de 1024 y una tarjeta apilada abajo—, así que
ya no hay ningún `<Table>` del que heredar: el tamaño lo declara cada celda.

Y eso dejó una deuda que conviene tener escrita acá y no sólo en el reporte de
un ciclo, porque es el modo de falla que más veces se repitió: **DIEZ celdas de
escritorio, repartidas en DOS pantallas, se quedaron sin tamaño propio al
desaparecer el `<Table>`** y pasaron a heredar los 16 px del navegador en vez de
los 14 que declara su rol.

- **`/ventas/[id]`, ocho**: Cantidad, Precio y Subtotal de "Qué se vendió";
  Medio, Moneda, Cotización, Monto y En pesos de "Cómo se pagó".
- **`/inventario`, dos**: Cambio y Queda del historial de movimientos
  (`historial.tsx`). El listado de esa misma pantalla (`page.tsx`) **sí** había
  repuesto el `text-sm` explícito al hacer el cambio; el historial, que es otro
  archivo, no — y por eso la primera versión de esta nota, que decía
  "`/inventario` sí lo repuso", era cierta a medias y dejaba dos celdas
  desprotegidas.

`/vender` es la única que no lo necesitó: su carrito vive dentro de un `<Card>`,
que trae `text-sm` propio.

**Las diez están corregidas** (ola final del ciclo del teléfono): cada celda
declara `text-sm` sin prefijo, porque los 14 px valen en los dos anchos —son los
de escritorio de antes de la rama, y en el teléfono esas celdas están ocultas.
**La tabla de arriba siempre dijo 14 px porque el documento es la fuente de
verdad**: lo que había que corregir era el código, no esa fila.

Y la lección que vale más que el arreglo, porque es la que se escapó tres veces:
**lo que se pierde al sacar un componente contenedor no son sólo sus clases,
sino las propiedades heredables que le daba gratis a todo lo de adentro.** El
ciclo repuso cuatro pérdidas de `<TableRow>`/`<TableCell>` —que eran clases
visibles en el diff— y se le escaparon éstas, que nunca fueron una clase de
ninguna celda. Ante un cambio así, la pregunta no es "¿qué clases borré?" sino
"¿qué heredaban de acá?": `font-size`, `color`, `text-align`, `white-space`,
`font-family`, `line-height`.

**Los seis roles de arriba son nuevos y no una extensión de *Importe*, a
propósito.** La plata de `/ventas` y `/ventas/[id]` también es dinero en
Archivo con `tabular-nums`, así que la pregunta obvia es por qué no entra en
el rol que ya existe para eso. Dos motivos, no uno:

- *Importe* está definido, en su propia fila de esta tabla, como "plata en el
  **punto de venta**" — y `font-stretch: 85%` es parte de esa definición, no un
  detalle suelto: el rol completo lo eligió *La cara de display: Archivo* más
  abajo por el eje de ancho (112% el cartel, 85% la plata), pensado para el
  número que hay que leer rápido y de un vistazo en una pantalla de cobro. Las
  dos pantallas de este ciclo son un HISTORIAL, no el momento de cobrar: la
  plata ahí compite por espacio con una fila entera de columnas, no con el
  resto de una pantalla de mostrador.
- Estirar *Importe* para que cubra esto también volvería su definición
  ambigua: ¿el rol es "toda la plata de la aplicación" o "la plata del punto de
  venta"? Cualquiera de las dos respuestas invalida alguna de sus dos
  menciones existentes (la fila de la escala, que dice "punto de venta"; el
  párrafo de *La cara de display: Archivo*, que ata el 85% a esa pantalla en
  particular). Un rol nuevo sin `font-stretch` dice lo mismo con las mismas
  palabras que ya estaban escritas, y no las contradice.

Los marcadores no son decoración: el documento tiene varias tablas y un parser
que agarre "la primera" se rompe el día que alguien reordene secciones. Es el
mismo mecanismo que ya usa `<!-- tokens:inicio -->`.

**La fila *Meta* volvió, pero no por el mismo motivo que se fue (ciclo de los
residuales, 2026-08-21).** El ciclo del shell había borrado la fila "Identidad,
meta, pie · sistema · 12 px · 400" porque describía el pie del shell viejo, y
ese pie no existe más. Lo que no se fue con él es el tamaño: `text-xs` (12 px)
sigue en el código, en la aclaración bajo la clave de desbloqueo y bajo el
buscador de `app/(app)/servicio-tecnico/`, bajo el botón del formulario de
`app/sitio/formulario.tsx`, bajo la letra chica del Hero ("5 días gratis · sin
tarjeta...") y en el pie de la landing (`Pie()`, `app/sitio/secciones.tsx` —
se movió de `landing.tsx` en el cierre del rediseño, y pasó de una línea a
dos: la marca y los links, cada una su propio `<span>`). Todos comparten la
misma fórmula exacta —`text-xs text-muted-foreground`, sin tracking ni
mayúsculas—, pero no comparten una posición: uno cuelga bajo un campo, otro
bajo un botón, otro es la letra chica de una sección, el último es la leyenda
de toda la página. Lo que los une no es dónde caen sino qué son: texto
secundario que acompaña a un dato o a una pantalla sin competirle por
atención.

**Y por eso el nombre del rol no dice "bajo".** El `.pen` respalda el tamaño
con tres nodos del cuerpo de `App / Vender` (frame `Fe3bW`), y los tres están
en geometrías distintas entre sí: "Detalle" (`P7CvWx`, `4 artículos · 5
unidades`) sí cuelga debajo del importe de la banda del total; "Conteo"
(`NyUYT`, `2 pagos`) está en la **misma fila** que el título "Cobro", no
debajo; y "Entran" (`sQIAg`) está **al lado** de su monto, no debajo. Nombrar
el rol por la geometría del primer caso que se miró habría dejado a los otros
dos afuera de lo que la fila promete, así que el nombre describe la función
—acompaña sin competir— y no la posición, que varía caso a caso.

El color tampoco es uno solo. `--muted-foreground` es el tono en toda
superficie clara —y el que usan los cuatro casos del código, todos sobre
`--card` o `--background`—, pero "Detalle" vive sobre la banda oscura del
total (`fill: $ar-primary-deep`) y ahí el `.pen` lo pinta con `#9C8BD6`, que es
`--marca-dim`, no `--marca-soft`: de los dos tintes de marca la maqueta eligió
el más apagado (`--marca-dim`, un escalón por debajo de `--marca-soft`
`#B6A6E8`), no el más claro. La tabla dice las dos cosas, y no sólo la
primera.

**Y quedaron afuera, a propósito, otros cuatro usos de `text-xs` que el mismo
grep encuentra y que NO son este rol** —forzarlos acá taparía la diferencia en
vez de mostrarla:

- Los encabezados de columna del carrito (`ARTÍCULO`/`CANTIDAD`/`PRECIO`/
  `SUBTOTAL`) y el rótulo "Total" de la banda usan **10 px**, peso 700, con
  tracking ancho y mayúsculas — el mismo tratamiento que ya tiene el rótulo
  "ARÁNDANO" del pie del sidebar, no el de *Meta*. Los dos vivían en `text-xs`
  sin ese tracking hasta que cada uno se corrigió por separado: los
  encabezados en el ciclo del stepper de cantidad, y el rótulo "Total" en el
  rediseño de la banda del total. **Y el tracking de los dos es distinto a
  propósito**: `0.8px` los encabezados, `1.4px` el rótulo "Total" — el `.pen`
  no los iguala, así que el código tampoco. **El retrato de la landing
  (`app/sitio/retrato.tsx`, Task 3 del cierre) es el segundo consumidor de las
  dos**, letra por letra: es una reconstrucción del mismo carrito con los
  mismos valores, no un tamaño elegido de nuevo.
- El rótulo "Arándano" de `app/not-found.tsx` usa `text-xs
  tracking-[0.06em] uppercase` — una firma trackeada, emparentada con
  `.firma` de `app/sitio/cierre.module.css` (12 px, peso 500, tracking
  0.18em, mayúsculas, `--marca-dim`), no con *Meta*. **El otro consumidor que
  este párrafo citaba —el *kicker* de `app/sitio/secciones.tsx`— se borró en
  la Task 4 del cierre del rediseño**, junto con toda la sección "Lo que
  hace" que lo usaba: la landing nueva no tiene ningún bloque de eyebrow +
  título con rayita, así que `not-found.tsx` queda como el único consumidor
  de este patrón, no como uno de dos.

**El *Importe* usa la otra punta del mismo eje.** Archivo se eligió por su eje
`wdth` porque *"un local argentino tiene el nombre pintado a lo ancho del
frente"*; ese eje tiene otra punta, y ahí vive el otro objeto del rubro: el
número angosto que sale impreso en la cinta de la registradora. 112 % el nombre,
85 % la plata. Una sola cara cumpliendo dos roles opuestos, distinguidos por el
eje que motivó elegirla.

El rol *Importe*, tal cual está definido —con su `font-stretch: 85%`—, se
aplica **sólo en `/vender`**, y sigue siendo así después de este ciclo: un rol
nuevo aplicado a medias es una inconsistencia visible; aplicado a una pantalla
y declarado como tal es una decisión. `/inventario` sigue en la pila del
sistema hasta que tenga su propio ciclo. `/ventas` y `/ventas/[id]` **sí**
pagan Archivo desde el rediseño de esas dos pantallas —seis roles propios,
sin el `font-stretch` de *Importe*—, y la sección *La cara de display:
Archivo* de más abajo es la que los cuenta a todos.

**El cartel manda sobre el título de la pantalla, y sigue siendo la
decisión — ya no por tamaño.** Este párrafo comparaba números porque cartel y
título compartían la misma fila de un header horizontal. Desde que el sidebar
movió esa fila a una columna aparte (*el layout monta el sidebar y jubila el
header horizontal*), los dos viven en ejes distintos: el cartel en su propia
columna, arriba de la navegación; el título en la franja de contenido, hoy en
el Topbar del encabezado (`components/shell/encabezado.tsx`, este ciclo). A
19 px contra 21 px el cartel ya ni siquiera es el número más grande, y no
necesita serlo: manda porque es lo único que hay en su bloque y está en las
diez pantallas sin excepción, mientras que `Inventario` es sólo dónde estás
parado en ésta (ver `components/cartel.module.css`, que ya lo dice así desde
que bajó a 19 px). Es la misma jerarquía que declara el login —el negocio del
cliente es el héroe, la plataforma no firma—, sostenida las ocho horas en vez
de los ocho segundos.

**Enmienda (ciclo de la cinta, 2026-08-12): el contenido puede pesar más que el
cartel cuando el contenido es el punto.** El total del punto de venta va en
40 px, contra los 19 del cartel. La razón de la regla original es sobre el
shell —compara el nombre del local con el título de la pantalla, o sea cromo
contra cromo—, y el total no es cromo: es el valor de la transacción en curso,
el número que se dice en voz alta cien veces por día.

**El límite, que es la mitad de la enmienda.** Hoy esto es **un número en una
sola pantalla**. Una segunda pantalla que quiera el suyo no estira esta
excepción: reabre la discusión. Si aparece un segundo importe en 40 px fuera de
`/vender`, esta sección dejó de describir el sistema.

### La cara de display: Archivo

Lo que el párrafo de arriba anticipaba —*"adoptar una fuente propia más adelante
es aditivo y barato"*— pasó, y no se quedó en un solo lugar: hoy son **diez
roles** repartidos en **seis módulos CSS**. Cuatro roles ya existían, en
cinco módulos —Cartel usa dos (`app/login/persiana.module.css` y
`components/cartel.module.css`), y Importe, Título de pantalla y Cobro uno
cada uno—; los seis roles nuevos de este ciclo comparten un sexto módulo,
`app/(app)/ventas/tipografia.module.css`, del rediseño de `/ventas` y
`/ventas/[id]`.

**Archivo**, de [Omnibus-Type](https://www.omnibus-type.com/), foundry de Buenos
Aires. Los diez roles están en la tabla de arriba. **Dos** le piden un ancho
propio al eje `wdth`: el nombre del local (`font-stretch: 112%`) y el importe
del punto de venta (`85%`) — los dos extremos opuestos del mismo eje, ver más
abajo. Los otros **ocho** se quedan en el 100 % por default: el título de
pantalla (`h1`, desde el encabezado de un ciclo anterior), el título y el
botón de la card de Cobro, y los seis roles nuevos de `/ventas` y
`/ventas/[id]` (título de card, valor de tile, monto de tabla, banda de
Total, número de paginación, cotización) — ninguno de éstos necesita
comprimirse ni expandirse, sólo la cara. Los distingue el eje de ancho
—cuando lo piden— y el tamaño, no la familia: los diez comparten la misma
`font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif`.

**Ya no es sólo `/vender`.** Antes de este ciclo, el único lugar donde una
tabla o una columna de plata pagaba Archivo era `/vender` (vía el rol
Importe). El listado de `/ventas` y el detalle de `/ventas/[id]` ahora
también: sus tablas, sus tiles y su paginación son Archivo, con los seis
roles nuevos de arriba — ninguno de ellos usa el rol Importe ni su
`font-stretch`, por el motivo que la tabla de la escala ya explica en la nota
debajo de esa fila. `/inventario` es la única pantalla con tablas de datos
que sigue enteramente en la pila del sistema.

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
consumidores son **seis** módulos CSS —`app/login/persiana.module.css`,
`components/cartel.module.css`, `components/importe.module.css`,
`components/shell/encabezado.module.css`,
`app/(app)/vender/cobro.module.css` y
`app/(app)/ventas/tipografia.module.css`— y ninguno lo querría igual: además
de la familia, los tres primeros necesitan su propio `font-stretch` o su
tracking, y los otros tres no —ni el título de pantalla, ni Cobro, ni los
seis roles de `/ventas` tienen eje de ancho propio en el `.pen`—, así que
ninguna utilidad de Tailwind referenciaría el token. Un token de `@theme` que
ninguna utilidad referencia es un token muerto. Los seis consumen
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

Excepción, y es angosta: un valor de **hairline atado al ancho de un borde** no
es un paso de espaciado y no cae bajo esta regla. Hoy es un solo caso, de 1 px:

- `gap-px` en la grilla de tiles de `/ventas` — la junta de 1 px **es** la línea
  divisoria: los tiles van sobre un `bg-border` y lo que se ve por las juntas es
  ese fondo, en vez de tres bordes que haya que hacer coincidir.

**Hasta el rediseño del shell (2026-08-21) eran dos.** El otro caso era
`-mb-px` en el riel de pestañas de `components/navegacion.tsx`: solapaba el
`border-b` de 1 px del `<header>` horizontal para que el subrayado de 2 px de
la pestaña activa se apoyara en el riel en vez de dibujar una segunda línea un
pixel más arriba. Ese `<header>` y ese riel no existen más —la navegación pasó
de pestañas horizontales a un `<ul>` vertical en el sidebar, sin subrayado que
solapar—, así que el caso se borró junto con el código que lo justificaba, y no
quedó reemplazado por ningún otro: el sidebar no tiene un borde propio que
algún elemento necesite tapar.

El número no sale de elegir un punto de la escala: sale de medir el borde que
se tapa o que se dibuja, exactamente como `border-b-2` tampoco sale de la
escala de espaciado y nadie lo llamaría una violación. El límite es ese y no
más: cubre un valor de 1 px derivado de un borde real, no una puerta para colar
cualquier valor que no esté en la lista.

**Tampoco son espaciado las dimensiones dibujadas.** El ancho de una regla
decorativa o de una pista de grilla es una medida de la cosa, no un hueco entre
cosas: se elige contra lo que tiene al lado y no contra la escala. Los dos
casos que este párrafo citaba —el `w-11` de la rayita del *kicker* y las pistas
`grid-cols-[2.5rem_minmax(0,12rem)_minmax(0,1fr)]` de "Lo que hace"— vivían los
dos en `app/sitio/secciones.tsx`, y los dos se borraron en la Task 4 del
cierre del rediseño: la landing entera se reescribió contra las siete
secciones de `design/arandano.pen`, y ninguna de las dos estructuras
sobrevivió al cambio de copy. El principio sigue valiendo, con un caso que sí
sigue en pie: las columnas de `app/sitio/retrato.tsx` (`w-[104px]` la
cantidad, `w-[110px]` el precio, `w-[130px]` el subtotal, réplica exacta de
`punto-de-venta.tsx`) están medidas contra lo que cada una tiene que
contener —un stepper, un monto, un monto más ancho—, no contra la escala.

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

**Enmienda (ciclo de la paleta oscura, 2026-08-13): lo que exime es ser el
adentro de un componente, no vivir en `components/ui/`.** El párrafo anterior
ataba la excepción a la carpeta, y eso alcanzaba mientras todos los componentes
chicos vinieran de shadcn. Este ciclo escribió dos que no existen ahí —el **chip**
de estado (`px-2.5 py-0.5 text-[11px]`: "Cobrada"/"Anulada" en `/ventas`, "el más
elegido" en los planes de la landing) y el **tile** del resumen del período
(`mt-0.5` entre rótulo, valor y pie)— y les aplica la misma lógica que a los
`gap-1.5` de shadcn: son decisiones internas de un elemento chico, repetido y
autocontenido, donde 4 px de paso mínimo es más de lo que la pieza mide de aire.
**El límite, que es la mitad de la enmienda**: cubre el *adentro* de esa pieza,
nunca la composición que la rodea —márgenes entre bloques, gutters, ritmo de
sección—, que sigue entera en el subconjunto. Si la lista de piezas exentas
crece más allá de chip y tile, la que está mal es esta enmienda y no la escala.

Lo que **no** se exceptúa, para que el precedente quede del lado correcto: la
landing entró en este mismo ciclo con `py-5` en las filas numeradas de *Seis
cosas, todos los días*, y eso es composición de pantalla con un valor fuera de la
lista. Se corrigió a `py-6`, que es lo que la regla manda hacer y no requiere
ninguna justificación aparte.

**Segunda enmienda (ciclo del rediseño del shell, 2026-08-21): la lista creció
más allá de chip y tile, así que —tal cual anticipaba el límite de arriba— la
que estaba mal era la enmienda, no la escala.** El shell trajo valores que no
son un paso de la escala y que tampoco son el adentro de un elemento chico y
repetido: `p-[9px]`, `gap-[11px]`, `rounded-[9px]` y `size-[17px]` en el ítem de
navegación; `pt-[22px]` y `px-5` en el bloque Marca del sidebar; `pb-[18px]` en
su pie; `px-7` y `h-[66px]` en el Topbar del encabezado
(`components/shell/encabezado.tsx`). Ninguno se repite muchas veces en la misma
pantalla como un chip o un tile —cada uno aparece una sola vez, porque el shell
mismo es único—, así que "chico, repetido y autocontenido" no los describe.

**Lo que sí los describe, y reemplaza a la regla de 2026-08-13:** lo que exime
a un valor no es el tamaño de la pieza ni que se repita — es que el número **no
salga de elegir un punto en el código, sino de transcribir una medida que
`design/arandano.pen` ya fija** para ese frame. El chip y el tile seguían siendo
casos legítimos bajo esta regla más amplia —sus valores también salen de medir
la pieza, no de inventar un espaciado—, así que no hace falta desandar nada de
lo que ya estaba escrito: lo que cambia es describir la excepción por el
**origen** del número y no por el **tamaño** de la pieza que lo usa. Cuando el
`.pen` dicta una medida exacta para un frame —y `design/arandano.pen` es la
autoridad sobre esto y no el código, según la regla de CLAUDE.md—, transcribirla
no viola la escala; redondearla para "cumplir" un paso que el diseño no pidió
sería la violación real, y perdería exactamente la fidelidad al frame que
justifica tener un `.pen` en el repo.

**El límite sigue siendo el mismo, sólo que mejor dicho:** la escala de 4 px
sigue rigiendo todo el espaciado que el código **inventa** —la composición de
pantallas, los gutters entre bloques, el ritmo de una sección—, que sigue
entera en el subconjunto. Lo que queda afuera es sólo lo que el `.pen` ya midió
por su cuenta.

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

**El eje izquierdo del shell, corregido con el rediseño (2026-08-21): no hay un
solo gutter, hay cuatro.** Esta sección decía que cartel, pestañas y contenido
arrancaban todos en los mismos 24 px de `px-6` en `app/(app)/layout.tsx`, y que
el pie compartía ese mismo `px-6` con su contenido en `text-right`. Las cuatro
afirmaciones son falsas contra el shell de hoy: `app/(app)/layout.tsx` no tiene
ningún `px-6` —ya no hay una franja horizontal que lo necesite—, y cada bloque
entra por su propio inset, tomado del frame que le corresponde en
`design/arandano.pen`:

| Bloque | Inset horizontal | De dónde sale |
|---|---|---|
| Cartel (`SidebarHeader`, sidebar-arandano.tsx) | `px-5` — 20 px | frame Marca, `pad:[22,20,18,20]` |
| Pie (`SidebarFooter`, sidebar-arandano.tsx) | `px-4` — 16 px | frame Pie, `pad:[16,16,18,16]` |
| Encabezado de pantalla (`encabezado.tsx`) | `px-7` — 28 px | frame Topbar, `pad:[0,28]` |
| Cuerpo de cada pantalla | `p-6` (o `px-6`) — 24 px | elegido por pantalla, no por el shell |

**"Todo arranca en el mismo eje" ya no aplica, y no por descuido: dejó de ser
la idea que el shell persigue.** El sidebar y el contenido son dos columnas
separadas por 248 px, no una sola franja donde un gutter compartido evitara que
las cosas se vieran descalzadas entre sí —que era el motivo original de la
regla vieja, escrita para un header horizontal que ya no existe—. Y el pie
**no** es `text-right`: `components/contexto.tsx` (el stack y el sha) es un
`<p>` sin alineación propia, a la izquierda igual que el nombre y el rol que
tiene arriba en el mismo bloque.

`--radius: 0.625rem`, con la escala derivada de 7 pasos que vive en
`@theme inline`. No hay razón de marca para moverla.

## Las clases `dark:` de shadcn

**La paleta de este producto es clara, y aun así no hay "modo claro".** No es un
juego de palabras: hay **una sola cara**, la que declara el `:root` de
`app/globals.css`, y no existe ningún activador que cambie a otra. El bloque
`.dark` de shadcn se borró en el ciclo del sistema de diseño —definía 28
variables y nada aplicaba la clase— y no volvió ni con la paleta oscura
(2026-08-13) ni con el rediseño: cada paleta se escribió **adentro** del único
`:root`, que es lo que mantiene un solo lugar donde vive un color.

Lo que **sí** se queda es `@custom-variant dark (&:is(.dark *))`, y esa línea es
load-bearing: sin ella, `dark:` vuelve al default de Tailwind v4
(`prefers-color-scheme`) y las 5 clases `dark:` que traen `button.tsx` e
`input.tsx` se activarían solas en cualquiera con el sistema en oscuro. Con
ella, apuntan a una clase que nadie pone y quedan inertes.

**Y con la paleta clara el riesgo dejó de ser teórico.** Mientras la paleta era
oscura, esas cinco reglas activándose solas habrían producido algo parecido a lo
que ya se veía —mal, pero parecido—. Ahora producirían inputs oscuros adentro de
paneles blancos en cualquier usuario que tenga el sistema en oscuro, que es la
mayoría de los teléfonos. Es el mismo motivo por el que `color-scheme: light`
está declarado explícitamente en `html`, y no por costumbre.

Si alguna vez se pide una **segunda** cara —con activador y persistencia—, es su
propio ciclo, y ahí lo primero que hay que resolver es esta línea, no los
tokens.

## De dónde salen estos valores

De `design/arandano.pen`, que es el archivo de Pencil donde se diseñaron las
trece pantallas del producto antes de escribir una sola línea de CSS. Los hexes
de la tabla normativa y los del `.pen` son **los mismos strings**, y por eso la
paleta se escribe en hex y no en `oklch`: dos representaciones del mismo color
son dos lugares donde el redondeo puede diferir.

**Y está atado.** `test/maqueta.test.ts` compara el bloque de variables del
`.pen` contra el `:root` del CSS en las dos direcciones, con un mapa explícito
de equivalencias (`ar-primary` ↔ `--primary`, `--ring`, `--accent-foreground`)
y dos listas de excepciones con su razón escrita: `SIN_TOKEN` para las
variables de la maqueta que no son colores —las dos familias tipográficas— y
`SOLO_EN_CSS` para los tokens que se decidieron escribiendo código, que hoy son
el hover del botón y los dos textos sobre el paño de marca.

**Mira sólo las variables, nunca la geometría**, y eso es deliberado: un test que
comparara posiciones o textos se rompería con cada movimiento de un frame, y un
test que se rompe por moverse es el que se termina ignorando. Mover una card no
cambia un color; cambiar un color sí. Ver `design/LEEME.md`.

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

**El contraste tuvo su propio mecanismo, y se borró con el rediseño.** Vale
dejar la historia entera, porque la conclusión es sobre qué tipo de test
conviene escribir y no sobre esta paleta.

La tabla de ratios se escribió a mano y se desincronizó: la review encontró que
cuatro de diez no correspondían a los tokens del CSS. Corregirlos no arreglaba
la causa, así que se sumó `scripts/contraste.mts`, que los calculaba desde los
tokens reales, y `test/contraste.test.ts`, que comparaba esa salida contra el
documento. Funcionó para lo que se construyó: la tabla dejó de poder mentir, y
el mecanismo atrapó de verdad varias cosas —la medición en continuo contra los
8 bits del navegador, los pares con opacidad que nadie miraba, un
`--muted-foreground` que no llegaba sobre `--accent`—.

**Y aun así no atrapó el único bug de accesibilidad real que tuvo el producto.**
Al pasar a la paleta oscura, `--primary-foreground` se dio vuelta y dos
utilidades de `app/sitio/secciones.tsx` lo seguían usando sobre el paño de marca
porque era "el color claro": 1.39:1 sobre el título que convierte. El script no
lo vio, y no podía verlo: mide **los pares que alguien declaró**, y ese par no
estaba en la lista porque nadie sabía que existía. Lo encontró un grep a mano.

La lección, que es la razón del borrado: **el valor no estaba en calcular
ratios, estaba en prohibir el nombre.** Lo que quedó es el caso *nadie toma
`--primary-foreground` por "el color claro"*, que revisa todo `app/` y
`components/` salvo `components/ui/` y no depende de que alguien haya previsto
el par. La tabla de contraste sigue en el documento, medida una vez al elegir la
paleta, como parte de la decisión escrita — no como una aserción que el gate
sostenga.

**Lo que sí sobrevivió del script** es `tokensDelCss()`, que vive ahora en
`scripts/tokens.mts` y lo importan `test/sistema-de-diseno.test.ts` y
`test/opengraph.test.ts`. Es la pieza que cerró el agujero más filoso que tuvo
este mecanismo, y sigue valiendo entera: los parsers viejos buscaban el bloque
con `/^:root\s*\{…/m`, que matchea **el primero**, y en CSS gana **el último**.
Agregar al final de `app/globals.css`

```css
:root { --primary: #ff6600; --inventado: #808080; }
```

dejaba todos los casos **en verde** con la aplicación sirviendo un naranja como
color de acción y un token que ningún documento declaraba. Un
`@media (prefers-color-scheme: dark) { :root { … } }` pasaba igual de entero.
`tokensDelCss()` exige **un** `:root` y **de primer nivel**. Verificado por
efecto, revirtiendo cada mutación antes de la siguiente:

| Mutación en `app/globals.css` | Resultado |
|---|---|
| El `:root` de arriba pegado al final | rojo en `hay un solo bloque :root, y de primer nivel` — *"app/globals.css tiene 2 bloques :root y tiene que tener exactamente 1…"* |
| `@media (prefers-color-scheme: dark) { :root { … } }` al final | el mismo rojo, más los 4 casos de `el documento y el CSS declaran lo mismo`, que dependen del mismo parser |
| El único `:root` envuelto en un `@media` | rojo en el mismo caso, por la otra rama — *"app/globals.css tiene el bloque :root anidado adentro de otra regla…"* |

**`test/maqueta.test.ts`** ata `design/arandano.pen` a `app/globals.css`. Tres
defectos metidos a mano al escribirlo, corridos y revertidos uno por vez:

| # | Defecto | Dónde | Caso que falló |
|---|---|---|---|
| 1 | `ar-primary` a `#FF6600` | sólo `design/arandano.pen` | `cada variable de la maqueta tiene el mismo valor que su token` — *"design/arandano.pen pinta ar-primary de #FF6600 y app/globals.css pinta --primary de #4A2AA5"* |
| 2 | `--inventado: #808080;` agregado a `:root` | sólo `app/globals.css` | `todo token de color del CSS está en la maqueta, o exceptuado con su razón` — *"app/globals.css define tokens que la maqueta no conoce: --inventado"* |
| 3 | El bloque `variables` del `.pen` vaciado | sólo `design/arandano.pen` | **Tres casos a la vez**, que es el modo de falla que importa: `la maqueta declara variables de color` (0 parseadas), `cada variable…` (*"no define la variable ar-bg"*) y `no hay excepciones de más` — sin variables, las dos excepciones de `SIN_TOKEN` pasan a nombrar cosas que no existen |

El defecto 2 vale por los dos sentidos: es el que atrapa un color elegido
escribiendo código. El 3 es el que impide el verde por vacío — dos listas vacías
son iguales, así que un parser que dejó de matchear daría verde sobre una maqueta
rota.

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

**Las dos series del gráfico — miradas el 2026-08-14**, al cerrar el ciclo del
panel "Cómo entró la plata" que existía entonces. Confirmado a ojo lo que
ningún test puede juzgar: que las barras tenían alto de verdad —el punto donde
el `ResponsiveContainer` se rompía sin que jsdom lo notara, porque ahí adentro
medía un contenedor que no existe— y que el tramo de `--chart-2` se despegaba
del fondo, que era exactamente el límite que su excepción de contraste
declarada aceptaba.

**Los importes al lado de las barras quedaron pendientes de una segunda
mirada**, y conviene que se sepa: cuando se hizo esta verificación, sólo se
imprimían dos de los cuatro —recharts no emitía rectángulo para un tramo de
valor 0, y sin rectángulo tampoco su rótulo—. Lo levantó la review, se
arregló y quedó cubierto por un caso, pero el arreglo cambió lo que se dibujaba
(cuatro rótulos en vez de dos, y más margen a la derecha para que el más largo
no se cortara), así que esa parte quedó sin una segunda mirada.

**Todo este bloque quedó superado, no vigente**: el panel se reescribió sin
`recharts` (2026-08-22, `app/(app)/ventas/grafico.tsx`) —una barra `Progress`
de shadcn por medio de pago, sin segunda serie ni apilado— y en el mismo ciclo
se sacó `recharts` del repo entero (`components/ui/chart.tsx`, `--chart-1` y
`--chart-2`, CLAUDE.md). Se deja el párrafo como registro de qué se verificó y
cuándo, no como descripción del panel actual — borrarlo perdería la evidencia
de que esta clase de verificación visual se hizo alguna vez.

**Y cómo se llegó, que otra vez no fue lo obvio.** El stack de dev sirve
`/root/arandano`, o sea la rama principal, así que una feature en un worktree
no se ve ahí. Se miró levantando la build de producción del worktree en un
contenedor aparte sobre la red de dev, publicado sólo en la IP de Tailscale y
con sus propios límites de CPU y memoria para no pelearle a prod. Dos cosas que
costaron y no se deducen: `next build` produce `output: standalone`, así que el
comando es `node server.js` y hay que copiarle `.next/static` y `public` al
lado, como hace el `Dockerfile`; y con dos `package-lock.json` en el árbol,
Next infiere la raíz del workspace en `/root/arandano` y anida el standalone
bajo `.next/standalone/.claude/worktrees/<rama>/`. Además el canario de dev
arrancaba **sin una sola venta** —tenía catálogo desde la verificación
anterior, pero ninguna venta ni ningún pago—, y sin pagos este panel no se
dibuja, que es lo correcto. Las ventas sintéticas las siembra
`scripts/sembrar-ventas-dev.mts`, con dólares en dos de los cuatro medios
porque una composición de una sola moneda no ejercita ni la pila, ni la
leyenda, ni la segunda serie.

Comprobado además por HTTP contra esa misma build, que es lo que dejó la
verificación cerrada de los dos lados: el panel suma **$ 2.628.838**, el mismo
número que el tile "Total del período" saca por otro camino y otra consulta.
Dos números de la misma pantalla que no cerraran serían peor que no mostrar
ninguno.

**2026-08-11.**
