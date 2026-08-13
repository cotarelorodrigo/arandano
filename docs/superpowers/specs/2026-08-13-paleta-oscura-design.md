# Spec: el paño oscuro — la paleta

Arándano es un producto claro por decisión escrita: el modo oscuro se borró en
el ciclo del sistema de diseño (2026-08-11) porque definía 28 variables y nada
aplicaba la clase `.dark`. Este ciclo lo da vuelta, y no reponiendo aquel
mecanismo: **la paleta oscura reemplaza a la clara en el mismo `:root`.** No hay
bloque `.dark`, no hay `@media`, no hay toggle. El producto tiene una sola cara
y ahora es oscura.

La referencia sigue siendo la misma fruta. La maqueta
(`Diseño MVP Arándano`, proyecto de claude.ai/design, sobre el design system
*Nocturne*) usa `#9184d9` como acento, que es `oklch(0.660 0.124 290)`: el mismo
arándano que ya vive en `--primary`, subido de 0.37 a 0.66 de luminosidad para
poder pisar un fondo oscuro. Nada de esto es un color nuevo. Es el mismo color
mirado desde el otro lado.

## Alcance

- `app/globals.css`: los 19 valores de color del `:root` (`--radius` no cambia),
  un token nuevo, una entrada en `@theme inline` y la declaración `color-scheme`.
- `docs/sistema-de-diseno.md`: la tabla de tokens, la de contraste, la regla de
  croma 0 y la sección *El arándano como superficie*.
- `scripts/contraste.mts`: `PARES` y el texto de la excepción de `--input`.
- `components/ui/button.tsx`: el hover del variante `default`.
- `app/login/persiana.module.css` y `app/sitio/cierre.module.css`: el flip de
  `--primary-foreground`, y el sombreado de los listones.
- `app/opengraph-image.tsx`: el hex de marca, que hoy está duplicado a mano.
- `app/(app)/ventas/page.tsx` y `app/(app)/inventario/page.tsx`: los deltas
  estructurales de la maqueta.
- `app/sitio/secciones.tsx`: *Lo que hace* pasa a filas numeradas, más los
  kickers y el chip de plan.
- `test/`: dos casos nuevos.

Cero cambios en `lib/**`, en los server actions, en el schema y en el motor de
ventas. **Ninguna pantalla cambia de comportamiento**: los mismos controles, los
mismos clicks, los mismos estados.

## Estado del que se parte

Dos hechos hacen que este ciclo sea tratable, y conviene dejarlos escritos
porque son lo que se pierde si alguien los erosiona después.

**No hay un solo color hardcodeado en la aplicación.** Ni un `text-red-500`, ni
un hex suelto en un `.tsx`. Hasta la persiana compone con `color-mix()` sobre
tokens. Cambiar los valores del `:root` repinta el producto entero.

**El shell ya tiene la forma de la maqueta.** Cartel con el nombre del local
arriba a la izquierda, `usuario · rol` y *Salir* a la derecha, pestañas con
subrayado de 2 px abajo, pie con `entorno · sha` — todo eso existe. La maqueta
se dibujó mirando la aplicación, así que la estructura no se rehace.

La única excepción a "no hay colores hardcodeados" es `app/opengraph-image.tsx`,
y está documentada en el propio archivo: Satori no lee variables CSS. Ver *Dos
roturas silenciosas*.

## La decisión: hue 287 en todo, croma 0 se cae

La regla vigente dice: *"todo el resto es gris neutro puro"*, croma 0, y el único
neutral tintado es `--accent`. Los grises de Nocturne no son puros — `#161826`
es croma 0.028 a hue 278, `#9397ab` croma 0.030 a hue 277 — y esa diferencia no
es un detalle de implementación: sobre fondo oscuro un gris de croma 0 lee
apagado, y el tinte es parte de por qué la maqueta se ve bien.

**Se adopta el tinte y se le corrige el hue a 287.** Nocturne tiñe a 277 y acenta
a 290, o sea que corre dos familias. Acá corre una sola: los grises, el acento,
el foco y el paño de marca comparten hue 287, y lo que los distingue es croma y
luminosidad. La frase *"un solo color de marca visto a varias distancias"*
sobrevive intacta; lo que se reescribe es la que promete croma 0.

**El límite de la regla nueva.** El tinte de los neutros llega hasta croma
**0.030**. Un token de cromo por encima de eso deja de ser un gris tintado y pasa
a ser un color, y ahí la contención que este documento defiende se empieza a
perder de a poco. `--accent` (0.060) es la excepción declarada, por la misma
razón por la que ya era el único tintado: es la fila seleccionada, y tiene que
distinguirse de `--muted` sin depender sólo de la luminosidad.

## Los tokens

Veintiuno, contra los veinte de hoy. El que entra es `--primary-hover`, y su
porqué está en *El hover andaba para atrás*.

| Token | Claro (hoy) | Oscuro |
|---|---|---|
| `--background` | `oklch(1 0 0)` | `oklch(0.214 0.025 287)` |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.935 0.008 287)` |
| `--card` | `oklch(1 0 0)` | `oklch(0.245 0.028 287)` |
| `--card-foreground` | `oklch(0.145 0 0)` | `oklch(0.935 0.008 287)` |
| `--popover` | `oklch(1 0 0)` | `oklch(0.245 0.028 287)` |
| `--popover-foreground` | `oklch(0.145 0 0)` | `oklch(0.935 0.008 287)` |
| `--primary` | `oklch(0.37 0.10 287)` | `oklch(0.66 0.124 287)` |
| `--primary-foreground` | `oklch(0.985 0 0)` | `oklch(0.20 0.03 287)` |
| `--primary-hover` | — | `oklch(0.72 0.105 287)` |
| `--marca` | `oklch(0.28 0.09 287)` | `oklch(0.32 0.095 287)` |
| `--secondary` | `oklch(0.97 0 0)` | `oklch(0.30 0.025 287)` |
| `--secondary-foreground` | `oklch(0.205 0 0)` | `oklch(0.935 0.008 287)` |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.268 0.024 287)` |
| `--muted-foreground` | `oklch(0.535 0 0)` | `oklch(0.70 0.030 287)` |
| `--accent` | `oklch(0.955 0.012 287)` | `oklch(0.27 0.060 287)` |
| `--accent-foreground` | `oklch(0.37 0.10 287)` | `oklch(0.66 0.124 287)` |
| `--destructive` | `oklch(0.577 0.245 27.325)` | `oklch(0.70 0.160 22)` |
| `--border` | `oklch(0.922 0 0)` | `oklch(0.381 0.019 287)` |
| `--input` | `oklch(0.922 0 0)` | `oklch(0.381 0.019 287)` |
| `--ring` | `oklch(0.37 0.10 287)` | `oklch(0.66 0.124 287)` |
| `--radius` | `0.625rem` | sin cambio |

`--accent-foreground` sigue siendo exactamente `--primary`, como hoy: la relación
entre los dos no cambia, sólo su valor.

`--destructive` es el único token fuera del hue de marca — hue 22 — y así tiene
que ser: el rojo del error existe justamente para no pertenecer a la familia.

**Sigue habiendo exactamente un `:root`, de primer nivel.** El parser de
`scripts/contraste.mts` lo exige y tira un error con nombre propio si aparece un
segundo o si queda anidado en un `@media`. Ese chequeo se escribió cuando el
modo oscuro se borró, para que no volviera por la puerta de atrás; este ciclo lo
deja en pie y entra por la puerta de adelante.

`@custom-variant dark (&:is(.dark *))` se queda como está, y por el mismo motivo
que ya está escrito en el archivo: las cinco clases `dark:` que shadcn dejó en
`button.tsx` e `input.tsx` apuntan a una clase que nadie pone, y quedan inertes.
Sin esa línea volverían al default de Tailwind v4 —`prefers-color-scheme`— y se
activarían solas. Que ahora la paleta sea oscura no las vuelve correctas: fueron
escritas para *otra* paleta oscura, la de shadcn.

## Lo que el flip de `--primary-foreground` arrastra

Sobre fondo claro, `--primary` es oscuro y su texto es claro. Sobre fondo oscuro
eso se da vuelta, y no por gusto: **`--primary` también es el color de los links
y del subrayado de la pestaña activa**, así que tiene que llegar a 4.5 *sobre el
fondo*. Un violeta oscuro no llega — medido, a L=0.55 da 3.47 — así que `--primary`
es forzosamente el violeta claro y `--primary-foreground` pasa a ser casi negro.

Ese flip rompe dos cosas que ningún test ve, porque las dos usaban
`--primary-foreground` como sinónimo de "el color claro".

### La persiana

`app/login/persiana.module.css` lo usa para el brillo de los listones y para la
firma *Arándano*; `app/sitio/cierre.module.css` para el texto de la franja. Los
cuatro usos **se mudan a `--foreground`**, que es el color claro de verdad. El
par vigilado deja de ser `--primary-foreground sobre --marca` y pasa a
`--foreground sobre --marca`.

Y hay una segunda rotura, más sutil, en el mismo archivo: el surco de los
listones se dibuja con `color-mix(in srgb, var(--foreground) 26%, transparent)`,
o sea "una línea oscura sobre el paño". Con `--foreground` casi blanco **el surco
se vuelve claro** y la persiana deja de leer como persiana — quedan dos brillos
paralelos y ningún relieve. El sombreado se rederiva: el surco desde
`--background` (el color oscuro que ahora existe) y el brillo desde
`--foreground`. Es un cambio de *qué token* compone cada capa, no de las
proporciones, que se conservan como referencia y se ajustan a ojo en la
verificación visual.

`--marca` sube de 0.28 a 0.32 por la misma razón: contra un fondo de 0.214, un
paño de 0.28 casi no se despega. En 0.32 vuelve a ser un material apoyado sobre
otro. Es además la luminosidad del único paño saturado de la maqueta
(`#262a60`, `oklch(0.314 0.094 276)`), así que el número no sale de la nada.

**Las dos superficies de marca sobreviven**, y con ellas la sección *El arándano
como superficie*: el login sigue teniendo su persiana y la landing su franja de
cierre. La regla de esa sección —si aparece una tercera superficie, se rediscute
en vez de estirarse— no se toca.

### El hover andaba para atrás

`hover:bg-primary/80` sobre fondo claro *aclara* el botón. Sobre fondo oscuro lo
acerca al fondo: **el botón retrocede cuando lo apuntás**, que es lo contrario de
lo que un hover comunica. Y además no llega — `--primary-foreground` sobre
`--primary/80` da 4.08.

Se resuelve con un token, `--primary-hover`, que aclara en vez de transparentar:
7.11. Un token y no un `color-mix()` inline porque el archivo de la persiana ya
dejó escrita la regla — *un color que no está escrito en ningún lado es un color
que nadie puede revisar* — y porque el tipo `Par` de `scripts/contraste.mts` mide
tokens: expresado como token, el hover entra a la tabla de contraste sin tocar
el mecanismo.

Requiere `--color-primary-hover: var(--primary-hover)` en `@theme inline`, para
que exista la utilidad `hover:bg-primary-hover`. Esa entrada es la que lo salva
del caso *no quedan tokens muertos* del test: un token de `@theme` que ninguna
utilidad referencia es lo que ese caso existe para prohibir, y éste sí se
referencia.

Los otros hovers ya andan para el lado correcto y no se tocan: `secondary` usa
`color-mix(in oklch, var(--secondary), var(--foreground) 5%)`, que sobre oscuro
aclara.

## La tabla de contraste

Los ratios los produce `scripts/contraste.mts` desde los tokens reales, y la
tabla del documento se regenera desde esa salida — no se transcribe. Los valores
esperados con esta paleta:

| Par | Ratio | Mínimo | |
|---|---|---|---|
| `--foreground` sobre `--background` | 14.63 | 4.5 | ok |
| `--foreground` sobre `--muted` | 12.63 | 4.5 | ok |
| `--muted-foreground` sobre `--background` | 6.59 | 4.5 | ok |
| `--muted-foreground` sobre `--muted` | 5.69 | 4.5 | ok |
| `--muted-foreground` sobre `--accent` | 5.69 | 4.5 | ok |
| `--primary-foreground` sobre `--primary` | 5.64 | 4.5 | ok |
| `--primary-foreground` sobre `--primary-hover` | 7.11 | 4.5 | ok |
| `--foreground` sobre `--marca` | 10.83 | 4.5 | ok |
| `--foreground/70` sobre `--marca` | 6.13 | 4.5 | ok |
| `--primary` sobre `--background` | 5.49 | 4.5 | ok |
| `--primary` sobre `--accent` | 4.74 | 4.5 | ok |
| `--primary-foreground` sobre `--destructive` | 6.31 | 4.5 | ok |
| `--destructive` sobre `--background` | 6.14 | 4.5 | ok |
| `--destructive/90` sobre `--card` | 4.86 | 4.5 | ok |
| `--destructive` sobre `--destructive/10` | 5.36 | 4.5 | ok |
| `--input` sobre `--background` | 1.77 | 3.0 | **excepción declarada** |
| `--ring` sobre `--background` | 5.49 | 3.0 | ok |

Tres cambios en `PARES`, todos con razón:

1. Los dos pares de `--marca` cambian de texto: `--primary-foreground` →
   `--foreground`, por el flip.
2. `--primary-foreground sobre --primary/80` → `sobre --primary-hover`.
3. **Entra un par nuevo**: `--destructive sobre --destructive/10`, que es el
   botón *Desactivar artículo* — `bg-destructive/10 text-destructive` en
   `components/ui/button.tsx`. Hoy ese control existe y ningún par lo cubría; con
   la paleta clara zafaba, y con una nueva merece medirse en vez de suponerse.

**El par más justo pasa a ser `--primary sobre --accent`, con 4.74** — el violeta
sobre la fila seleccionada. Es el que fija cuánto más se puede aclarar `--accent`
antes de romper algo, y ocupa el lugar que en la paleta clara tenía
`--muted-foreground sobre --accent`.

**La excepción de `--input` se conserva, y mejora**: de 1.26 a 1.77, todavía por
debajo de los 3:1 que pide WCAG 1.4.11 para el borde de un control. La razón se
reescribe —ya no es "el look liviano de shadcn" sino el borde tenue que la
maqueta usa (`#e9e9ed` al 16 %)— pero la mitigación es la misma y sigue siendo
cierta: todo campo lleva `<Label>` asociado y anillo de foco de marca. Se revisa
ante un reporte real o una auditoría formal.

## Los deltas estructurales

Lo demás se repinta solo. Esto no:

**Ventas** (`app/(app)/ventas/page.tsx`)

- Tres tiles arriba de la tabla: *Total del período* (con el pie "sin contar las
  anuladas"), *Ventas cobradas* y *Anuladas*. Reemplazan la línea suelta que hoy
  vive debajo de la tabla. Los dos conteos salen de datos que la página ya tiene;
  el total ya se calcula.
- Subtítulo bajo el `h1` con el período y el conteo de ventas.
- El estado pasa de texto pelado a chip: *Cobrada* en neutro, *Anulada* con
  contorno en `--destructive`. Sin componente nuevo de shadcn — un `<span>` con
  tokens alcanza, y una `Badge` sería una dependencia para tres usos.

**Inventario** (`app/(app)/inventario/page.tsx`)

- Subtítulo bajo el `h1` con el conteo de artículos activos y cuántos tienen
  stock negativo. El conteo de negativos es una consulta nueva.
- El stock negativo en rojo **ya existe** y no se toca. El checkbox *Ver
  desactivados*, tampoco.

**Landing** (`app/sitio/secciones.tsx`)

- *Lo que hace* pasa de cards a seis filas numeradas 01–06, bajo el título
  *"Seis cosas, todos los días"*, con *Lo que hace* como kicker.
- Kickers con su rayita al margen en las secciones que los tienen en la maqueta.
- Chip *"el más elegido"* en el plan Profesional, que el texto de la landing ya
  afirmaba en prosa.

Los conteos de la maqueta (`128 artículos`, `6 ventas`, `#1048`) son datos de
ejemplo, no valores a reproducir.

## Dos roturas silenciosas

**El hex del OG está duplicado a mano.** `app/opengraph-image.tsx` pinta
`backgroundColor: '#271f52'`, que es exactamente el `--marca` de hoy, porque
Satori no lee variables CSS. El propio archivo advierte que se puede cambiar "el
color de marca sin que nadie se entere", y después nadie escribió el test. Con
este ciclo la tarjeta social se quedaría con el arándano viejo, en silencio. El
hex nuevo es `#312860`, y va con un caso que lo compare contra el token.

**Falta `color-scheme: dark`.** Sin esa declaración el navegador sigue pintando
de claro lo que la hoja de estilos no controla: los scrollbars, el selector
nativo de `<input type="date">` —que Ventas usa en *Desde* y *Hasta*— y el lienzo
antes del primer paint, que es un flash blanco en cada carga. Va en la regla
`html` de `@layer base`, no adentro del `:root`: así el bloque de tokens sigue
conteniendo tokens y nada más.

## Tests

Pasan sin tocarse, y eso es parte del diseño:

- `test/sistema-de-diseno.test.ts`, los ocho casos. En particular *no hay bloque
  `.dark`* y *hay un solo `:root`, y de primer nivel*: la paleta oscura entra
  reemplazando valores, así que ninguno de los dos se ve afectado. Los dos casos
  de doble dirección —todo token del documento está en el CSS con el mismo valor,
  todo token del CSS está documentado— cubren solos el token nuevo.
- `test/tipografia.test.ts`: la tipografía no cambia.
- `test/contraste.test.ts`: los seis casos siguen valiendo. Cambia `PARES` y
  cambia la tabla, y el test es justamente lo que comprueba que cambiaron juntos.

Dos casos nuevos:

1. **El hex del OG contra `--marca`.** Convierte el `oklch` del token a sus tres
   bytes y lo compara contra el hex literal de `app/opengraph-image.tsx`. La
   conversión reusa la de `scripts/contraste.mts` en vez de reimplementarse — es
   la misma matemática, y dos copias se desincronizan. Requiere exportar la
   función que hoy es privada del módulo.
2. **`color-scheme: dark` presente en `app/globals.css`.** Un caso chico contra
   un modo de falla que sólo se ve en un navegador de verdad, no en jsdom.

## Lo que NO cambia

- **La tipografía.** La maqueta usa Inter porque es el default de Nocturne, no
  porque alguien lo haya decidido para Arándano. La pila del sistema se queda con
  su razón ya escrita —cero bytes, cero salto de fuente, se ve nativa en el
  Windows del mostrador—, y Archivo se queda en sus dos roles. Los tamaños de la
  escala tampoco se tocan: el total del punto de venta sigue en 40 px y no en los
  44 de la maqueta, porque 40 es el número que la tabla normativa declara y la
  maqueta no trae un argumento para moverlo.
- **El botón de acción sigue relleno**, contra el `.btn-primary` de contorno de
  Nocturne. La regla escrita dice que el botón es lo único accionable a la vista,
  y en un mostrador *Cobrar* se aprieta cientos de veces por día. De contorno
  además se distingue poco del secundario, que también es de contorno.
- **Ningún comportamiento.** Sin cambios en lógica, validaciones, permisos ni
  consultas — salvo el conteo de stock negativo que el subtítulo de Inventario
  necesita.
- El dominio de la maqueta dice `arandano.com`; el real es `arandano.app` y no
  se toca.

## Descartado

- **Reponer el modo oscuro con clase `.dark` o `prefers-color-scheme`.** Es
  exactamente lo que se borró en el ciclo del sistema de diseño, y por un motivo
  que sigue en pie: duplica cada token, duplica la tabla de contraste y agrega un
  mecanismo de conmutación que nadie pidió. Un producto, una cara.
- **Copiar los valores de Nocturne tal cual.** Deja dos hues corriendo —277 en
  todo el cromo, 290 en el acento— y con eso se cae la afirmación de que hay un
  solo color de marca. Se prefirió derivar a hue 287, que además aterriza casi
  encima: `--primary` da `#8e85da` contra el `#9184d9` de la maqueta.
- **Resolver el hover oscureciendo `--primary-foreground` hasta que el par
  pase.** Llega recién en L=0.12, con 4.58 y sin holgura, y no arregla lo que
  estaba mal: el botón seguiría retrocediendo al apuntarlo.
- **Sacar el par `--primary-foreground sobre --destructive`**, que hoy no lo
  realiza ningún componente —el variante destructivo es `bg-destructive/10`—. Se
  conserva: es la red que atrapa un destructivo relleno el día que aparezca, y
  sacarlo es una limpieza que no pertenece a este ciclo.
- **Adoptar los componentes de Nocturne** (`.card`, `.table`, `.tag`, `.input`).
  Son CSS plano pensado para maquetas sin build; el repo tiene shadcn copiado
  adentro, con accesibilidad y foco ya resueltos por Radix. Se toman los colores
  y la disposición, no las clases.

## Verificación

`npm test`, `npm run typecheck` y `npm run contraste` tienen que dar verde, y el
hook de pre-commit también. Pero el gate no puede decidir lo único que importa
acá, así que la verificación **es visual y la hace una persona**, con el
precedente del ciclo del punto de venta:

- Entrando **por el subdominio del tenant** (`http://<canario>.<host>:3000`), no
  por la IP pelada, que devuelve 404 a propósito desde el cutover por `Host`.
- Con **catálogo sembrado** e importes de distinta cantidad de dígitos: con
  montos parejos no se ve si las columnas de números bailan.
- Las cinco superficies, en este orden: **login** (la persiana, que es lo que más
  riesgo tiene), **`/vender`**, **`/ventas`**, **`/inventario`** y la **landing**
  del ápex.
- Cuatro preguntas concretas, que son las que ningún test contesta: ¿la persiana
  todavía lee como una persiana, con relieve y no con dos brillos? ¿El botón de
  acción se distingue del secundario de un vistazo? ¿El anillo de foco se ve al
  tabular? ¿La fila seleccionada se distingue de la fila normal?
- Y el selector de fecha de `/ventas` **abierto**, que es donde se comprueba que
  `color-scheme` hizo efecto.

Lo que este spec no promete es que el resultado guste. La paleta está derivada y
medida; "se ve bien" se decide mirándola, y ese paso es parte del ciclo, no un
trámite posterior.

## Riesgo y deploy

Es el ciclo con **más superficie visible y menos riesgo de datos** que tuvo el
proyecto: toca todas las pantallas y ninguna consulta, ningún permiso y ningún
registro. No hay migración, así que expand/contract no aplica y el rollback a la
imagen anterior alcanza y sobra.

El riesgo real es estético y se materializa entero en el primer cliente que
abra la aplicación, porque sin feature flags un deploy alcanza a todos a la vez.
La mitigación es la verificación visual de arriba, hecha **antes** del deploy
contra `arandano-dev`, y la mirada al canario inmediatamente después.

Es un **MINOR**: el cliente ve algo distinto en cada pantalla.
