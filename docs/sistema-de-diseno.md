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

**Un ancla por pantalla.** `--marca` —el violeta profundo— entra una sola vez
en cada pantalla, alrededor del número que esa pantalla existe para mostrar: la
banda del total en `/vender`, el tile "Total del período" en `/ventas`, el stock
en la ficha de un artículo, el estado actual en una orden. Es la regla que
reemplaza al "cada card con su borde": si dos cosas de la misma pantalla piden
el ancla, es que no está claro cuál es el dato.

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

| Superficie | Qué ancla |
|---|---|
| Paño del login (`app/login/persiana.module.css`) | El nombre del local |
| Franja de cierre del sitio (`app/sitio/cierre.module.css`) | La conversión |
| Banda del total en `/vender` | El importe que se dice en voz alta |
| Tile "Total del período" en `/ventas` | Lo que entró en el período |
| Bloque de stock en la ficha de un artículo | Cuánto hay |
| Estado actual en la ficha de una orden | En qué anda el equipo |

Lo que la regla prohíbe sigue siendo lo mismo y es lo que importa: `--marca`
**no** es un fondo de pantalla, **no** se usa dos veces en la misma vista, y
**no** entra en nada que no sea el dato principal. Una pantalla con dos anclas
no tiene un problema de color: tiene un problema de jerarquía.

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
| `--ok` | `#0F7048` |
| `--ok-soft` | `#E1F3EA` |
| `--warn` | `#9A5B00` |
| `--warn-soft` | `#FBF0DC` |
| `--destructive` | `#B32318` |
| `--destructive-soft` | `#FDE9E7` |
| `--border` | `#E3E0EC` |
| `--input` | `#CFCADD` |
| `--chart-1` | `#4A2AA5` |
| `--chart-2` | `#8A6FD4` |
| `--sidebar` | `#FFFFFF` |
| `--sidebar-foreground` | `#171221` |
| `--sidebar-primary` | `#4A2AA5` |
| `--sidebar-primary-foreground` | `#FFFFFF` |
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

Ninguno de los ocho es un color nuevo. Cada uno toma el de la variable de
`design/arandano.pen` que la maqueta ya usa en ese lugar del paño, y
`test/maqueta.test.ts` los ata a esa variable en las dos direcciones. Un
`--sidebar-*` con un valor que la maqueta no tenga rompe el build.

Estos ocho reemplazan al caso `no quedan tokens de sidebar` de
`test/sistema-de-diseno.test.ts`, que existió justamente hasta que hubo un
componente que los usara.

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
| `--chart-2` sobre `--card` | 3.96 | 3.0 | ok |
| `--input` sobre `--card` | 1.60 | 3.0 | **excepción declarada** |
| `--chart-1` sobre `--chart-2` | 2.45 | 3.0 | **excepción declarada** |

**`--muted-foreground` es el token que más costó.** El valor de la maqueta
(`#7A7389`) daba 4.17 sobre el fondo y 3.84 sobre el hundido: no llegaba en dos
de sus tres superficies, y el hundido es justamente donde vive el encabezado de
cada tabla. Se oscureció a `#6B6478`, que deja 5.20 / 5.65 / 4.79. El cambio se
hizo también en `design/arandano.pen`, para que la maqueta y el código no se
separen en el primer día.

**Las dos excepciones**, cada una con su razón y con lo que la haría caducar:

1. **`--input` sobre `--card` da 1.60**, contra los 3:1 que WCAG 1.4.11 pide
   para identificar un control. Es el mismo caso que ya traía la paleta anterior
   (1.63) y se acepta por lo mismo: el borde tenue es deliberado, y todo campo
   lleva `<Label>` asociado más anillo de foco de marca, así que el borde no es
   el único indicio de que ahí hay un input. **Revisar** ante un reporte real de
   gente que no encuentra los campos, o ante una auditoría formal.

2. **`--chart-1` sobre `--chart-2` da 2.45**, y el par está acá para dejar dicho
   que **los dos tramos no se tocan**: entre uno y otro va un separador de 2 px
   pintado de `--card`, así que el par adyacente que el usuario mira de verdad es
   cada tramo contra `--card`, que sí llega. El separador es load-bearing, no
   decoración, y lo asegura un caso de `app/(app)/ventas/grafico.test.tsx`.

**Lo que la paleta clara arregló solo**: la serie de dólares del gráfico
(`--chart-2`) pasó de 2.52 a **3.96** contra la superficie. Era la excepción que
la sección de gráficos declaraba con más incomodidad, y su propia nota decía
*"revisar si alguna vez se define una paleta clara, donde la serie oscura pasaría
a ser justamente la que contrasta"*. Eso pasó.

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

## Los colores del gráfico

`--chart-1` y `--chart-2` son las dos series del panel **"Cómo entró la plata"**
de `/ventas`: lo cobrado en pesos y lo cobrado en dólares, apilados en la misma
barra. Son los únicos tokens del sistema donde **el color es el dato** y no la
jerarquía — en todo el resto de la aplicación el color señala una acción o una
superficie.

| Token | Hex | Serie |
|---|---|---|
| `--chart-1` | `#4A2AA5` | Pesos. Es el arándano de `--primary`, con el mismo valor |
| `--chart-2` | `#8A6FD4` | Dólares |

**Las dos se separan por luminosidad, en el mismo hue.** No es fidelidad
decorativa a la paleta monocroma: es la decisión que más protege al que mira. La
distancia de luminosidad es la única que sobrevive a cualquier daltonismo, o sea
que las dos barras se distinguen para todo el mundo. La alternativa se midió en
vez de suponerse: separarlas por **hue** —un cian contra el arándano— pasaba el
contraste contra la superficie con holgura y a cambio dejaba **ΔE 8.1 bajo
deuteranopía**, dos barras que un daltónico no distingue. Se prefirió el par que
todos distinguen.

**Con la paleta clara se dieron vuelta, y eso arregló la excepción más
incómoda.** Sobre fondo oscuro, separar por luminosidad obligaba a que una de
las dos series fuera **la oscura**, y esa era la que no llegaba a 3:1 contra la
superficie: `--chart-2` daba 2.52 y estaba declarada como excepción, con una
nota que decía *"revisar si alguna vez se define una paleta clara, donde la
serie oscura pasaría a ser justamente la que contrasta"*. Sobre papel, la serie
secundaria es la **clara** y da **3.96**. La excepción dejó de existir sin que
hubiera que aflojar nada.

**Queda una, y es la de siempre**: `--chart-1` sobre `--chart-2` da 2.45, y el
par está declarado para dejar dicho que **los dos tramos no se tocan** — entre
uno y otro va un separador de 2 px pintado de `--card`, así que el par adyacente
que el usuario mira de verdad es cada tramo contra `--card`. El separador es
load-bearing, no decoración, y lo asegura un caso de
`app/(app)/ventas/grafico.test.tsx`: borrarlo deja esta razón en falso y rompe
el test.

**La mitigación sigue puesta aunque la excepción se haya ido**, porque nunca fue
solamente una mitigación: cada barra lleva su importe impreso al lado, la
leyenda aparece apenas existe la segunda serie, el tooltip desglosa pesos y
dólares, y `app/(app)/ventas/grafico.tsx` renderiza además una **tabla** con los
mismos números — que es el componente y no un extra: recharts no dibuja nada en
el servidor, así que sin ella el panel sería un rectángulo vacío para quien
llegue antes de que hidrate o con el JavaScript caído.

**Y no están en `@theme`**, a diferencia del resto de la paleta: no los consume
ninguna utilidad de Tailwind sino el `color:` del `ChartConfig` de
`components/ui/chart.tsx`, que emite `var(--chart-N)` directo. Es el mismo caso
que `--marca`. Un token en `@theme` que nada referencia es un token muerto, que
es lo que el caso "no quedan tokens de sidebar" de
`test/sistema-de-diseno.test.ts` existe para evitar.

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
mismo mecanismo que ya usa `<!-- tokens:inicio -->`.

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

Excepción, y es angosta: un valor de **hairline atado al ancho de un borde** no
es un paso de espaciado y no cae bajo esta regla. Son dos casos, los dos de 1 px:

- `-mb-px` en el riel de pestañas de `components/navegacion.tsx` — solapa el
  `border-b` de 1 px del `<header>` para que el subrayado de 2 px de la pestaña
  activa se apoye en el riel en vez de dibujar una segunda línea un pixel más
  arriba.
- `gap-px` en la grilla de tiles de `/ventas` — la junta de 1 px **es** la línea
  divisoria: los tiles van sobre un `bg-border` y lo que se ve por las juntas es
  ese fondo, en vez de tres bordes que haya que hacer coincidir.

En los dos, el número no sale de elegir un punto de la escala: sale de medir el
borde que se tapa o que se dibuja, exactamente como `border-b-2` tampoco sale de
la escala de espaciado y nadie lo llamaría una violación. El límite es ese y no
más: cubre un valor de 1 px derivado de un borde real, no una puerta para colar
cualquier valor que no esté en la lista.

**Tampoco son espaciado las dimensiones dibujadas.** El ancho de una regla
decorativa o de una pista de grilla es una medida de la cosa, no un hueco entre
cosas: se elige contra lo que tiene al lado y no contra la escala. Los casos son
de `app/sitio/secciones.tsx` — el `w-11` de la rayita del kicker (44 px de
regla, medidos contra el texto que acompaña) y las pistas
`grid-cols-[2.5rem_minmax(0,12rem)_minmax(0,1fr)]` de las filas numeradas, donde
2.5rem es el ancho fijo del número de orden y 12rem el tope del título, elegido
sobre el más largo. Los **huecos** de esa misma grilla sí están en la escala
(`gap-x-8`), y ahí es donde la regla manda.

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
de equivalencias (`ar-primary` ↔ `--primary`, `--ring`, `--accent-foreground`,
`--chart-1`) y dos listas de excepciones con su razón escrita: `SIN_TOKEN` para
las variables de la maqueta que no son colores —las dos familias tipográficas— y
`SOLO_EN_CSS` para los tokens que se decidieron escribiendo código, que hoy son
el hover del botón, los dos textos sobre el paño de marca y la segunda serie del
gráfico.

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
panel "Cómo entró la plata". Confirmado a ojo lo que ningún test puede juzgar:
que las barras tienen alto de verdad —el punto donde el `ResponsiveContainer`
se rompería sin que jsdom lo note, porque ahí adentro mide un contenedor que no
existe— y que el tramo de `--chart-2` se despega del fondo, que es exactamente
el límite que su excepción de contraste declarada acepta.

**Los importes al lado de las barras quedaron pendientes de una segunda
mirada**, y conviene que se sepa: cuando se hizo esta verificación, sólo se
imprimían dos de los cuatro —recharts no emite rectángulo para un tramo de
valor 0, y sin rectángulo tampoco su rótulo—. Lo levantó la review, está
arreglado y cubierto por un caso, pero el arreglo cambió lo que se dibuja
(cuatro rótulos en vez de dos, y más margen a la derecha para que el más largo
no se corte), así que esa parte todavía no la miró nadie.

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
