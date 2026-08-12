# Spec: el cartel en el shell

El shell de la aplicación —el header que se ve en las siete pantallas de
`app/(app)`— no tiene
identidad. Es la única parte del sistema que está siempre a la vista, y hoy es
texto gris sin jerarquía. Este ciclo le da la que ya tiene el login, y la da
**con tipografía y nada más**: ningún color nuevo, ningún material nuevo,
ninguna pantalla tocada.

## Alcance

- `app/(app)/layout.tsx`: el header y el pie.
- `components/navegacion.tsx`: el riel de pestañas.
- `components/cartel.module.css`: nuevo.
- `docs/sistema-de-diseno.md` y dos comentarios que hoy afirman algo que deja
  de ser cierto.

Cero archivos de `app/(app)/**/page.tsx`. Ninguna pantalla cambia.

## Estado del que se parte

El header son dos filas de ~88 px:

```
┌────────────────────────────────────────────────────────────┐
│ Flor Celulares                  Rodrigo · Dueño   [Salir]  │
│ Vender  Ventas  Inventario  Usuarios          dev · a1b2c3 │
├────────────────────────────────────────────────────────────┤
│ Inventario                                [Artículo nuevo] │
```

Lo que está mal, en orden de cuánto importa:

1. **El nombre del local pesa lo mismo que el nombre del usuario.** Es un
   `<span className="font-medium">` de 14 px al lado de un `<span
   className="text-sm text-muted-foreground">`. En el login ese mismo nombre es
   el héroe de la pantalla, en Archivo expandida a `clamp(2.5rem, 7vw, 5.5rem)`.
   La continuidad se corta en el primer click.
2. **`stack · sha` compite con la navegación.** Comparte fila con las pestañas y
   es el segundo bloque más ancho del header. Es un artefacto de deploy: tiene
   que existir, no tiene que estar ahí.
3. **La pestaña activa dibuja dos líneas.** Su `border-b-2` queda un pixel
   arriba del `border-b` del `<header>`, así que el subrayado flota en vez de
   apoyarse en el riel.
4. **Las pestañas no tienen `focus-visible`.** Quedan con el outline del
   navegador, sobre un producto que se opera con teclado en un mostrador y cuyo
   sistema de diseño llama al anillo de foco *"lo más visible al operar con
   teclado"*.

## La decisión: el cartel no se apaga

La persiana sube una vez, en el login, y descubre el nombre del local. **Adentro,
ese cartel se queda**: misma cara, mismo eje expandido, más chico, arriba a la
izquierda de todas las pantallas. Y es lo más grande que hay en la aplicación
—**más grande que el título de la pantalla**—, que es la decisión y no un
accidente de tamaños.

`Inventario` no es dónde estás: es dónde estás parado *adentro de tu local*. La
jerarquía que el login ya declaró —el negocio del cliente es el héroe, la
plataforma no firma en ningún lado— pasa de durar ocho segundos a regir las ocho
horas.

### La escala tipográfica

Hoy no está escrita en ningún lado. Queda así, y entra a
`docs/sistema-de-diseno.md`:

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Cartel** — nombre del local | Archivo | 24 px | 600, `font-stretch: 112%`, tracking −0.01em |
| Título de pantalla (`h1`) | sistema | 20 px | 500 — **no se toca** |
| Pestaña | sistema | 14 px | 500; activa 600 |
| Identidad, meta, pie | sistema | 12 px | 400, `--muted-foreground` |

Archivo entra en **un solo rol nuevo y en ninguno más**: el nombre del local.
Títulos, tablas, botones y campos siguen en la pila del sistema. La regla del
documento —*"se usa para una cosa"*— no cambia; cambia en cuántos lugares se ve
esa cosa.

El tracking es −0.01em y no el −0.022em del login: es la misma cara a 24 px en
vez de a 88, y a ese tamaño un tracking tan cerrado empasta.

### Por qué 24 px, y no 20 ni 32

A 20 px empata con el `h1` de las pantallas y la inversión de jerarquía no se
lee — parecería que el nombre del local *también* es un título. A 32 px la fila
del header crece lo suficiente como para pedir que las pestañas suban a la misma
fila, y eso ya es otro diseño. **24 px es el tamaño que gana contra el `h1` sin
obligar a tocar ninguna pantalla**, que es exactamente lo que compra que este
ciclo no toque cinco archivos en uso.

## El header

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  FLOR CELULARES                      Rodrigo · Dueño   Salir │  24 px Archivo 112%
│                                                              │
│  Vender   Ventas   Inventario   Usuarios                     │  14 px
│  ▔▔▔▔▔▔                                                      │  2 px --primary
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Inventario                                 [Artículo nuevo] │  20 px, sin tocar
│  …                                                           │
│                                                              │
│                                               dev · a1b2c3d  │  12 px, al pie
└──────────────────────────────────────────────────────────────┘
```

### El cartel

`components/cartel.module.css`, con la misma forma que
`app/login/persiana.module.css` y por el mismo motivo escrito en `globals.css`:
`@theme` es `inline`, así que `var(--font-display)` no existiría fuera de una
utilidad de Tailwind.

```css
.cartel {
  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  font-weight: 600;
  font-stretch: 112%;
  font-size: 1.5rem;
  line-height: 1.1;
  letter-spacing: -0.01em;
}
```

En el markup:

```tsx
<span
  className={`${estilos.cartel} truncate`}
  title={sesion.tenant.nombre}
  data-testid="tenant-nombre"
>
  {sesion.tenant.nombre}
</span>
```

Tres cosas que no son estéticas:

- **`data-testid` queda ÚLTIMO y el nombre es texto directo**, sin ningún
  elemento en el medio. `scripts/smoke.sh` lo grepea como
  `data-testid="tenant-nombre">${NOMBRE_CANARIO}` en tres casos (líneas 121,
  152 y 371) y `app/(app)/layout.test.tsx` en uno. Es la misma restricción que
  ya lleva anotada `app/login/page.tsx`.
- **Sigue siendo `<span>` y no `<h1>`.** Cada pantalla tiene el suyo; dos `h1`
  le mienten al outline del documento. Pesa más a la vista sin pesar más
  semánticamente.
- **`truncate` con el nombre completo en `title`.** Un nombre largo en 360 px de
  ancho no puede empujar a Salir fuera de la pantalla. El bloque de la derecha
  lleva `shrink-0` y el contenedor `min-w-0`, que es lo que hace que el que
  ceda sea el cartel y no el botón.

A la derecha, `Rodrigo · Dueño` baja de 14 a 12 px y Salir queda en `ghost`. No
es que el usuario importe menos: es que hoy compite con el nombre del local.
`--muted-foreground` sobre `--background` da 5.17 — el par ya está medido en la
tabla de contraste y no cambia por bajar el tamaño.

### El riel de pestañas

```tsx
<nav className="-mb-px flex items-center gap-1 overflow-x-auto text-sm">
```

- **`-mb-px`**: el subrayado de 2 px de la pestaña activa se solapa con el borde
  inferior del `<header>` en vez de flotar un pixel arriba. Es lo que lo hace
  leer como una pestaña apoyada en el riel y no como dos líneas paralelas.
- **Activa**: `border-primary font-semibold text-foreground`. **Inactiva**:
  `border-transparent font-medium text-muted-foreground hover:text-foreground`.
  El peso hace la mitad del trabajo, así el subrayado no tiene que hacerlo todo.
- **`overflow-x-auto`**: con cuatro pestañas sobra lugar, pero el comentario de
  `components/navegacion.tsx` promete que las pestañas de Órdenes de Trabajo
  entran por esa misma lista. Hoy sale gratis; el día que sobren, ya está.
- **Foco propio**, que hoy no existe: anillo de marca de 3 px al 50 %, sobre
  `--ring`.

**El foco va INSET, y el motivo es mecánico**: `overflow-x-auto` computa el eje
de bloque a `auto` también, así que un anillo dibujado por fuera de la caja del
link se recorta arriba y abajo — y encima podría aparecer una barra de scroll
vertical. Un anillo interior no lo toca el overflow. La utilidad exacta hay que
verificarla contra la versión de Tailwind instalada (`inset-ring-*` en v4); si
no está, el fallback es un `focus-visible:shadow-[inset_0_0_0_3px_…]` armado con
`color-mix` sobre `--ring`, nunca un color crudo.

Eso responde de paso **la pregunta que el ciclo anterior dejó abierta para
verificar a ojo**: el anillo de foco es un halo redondeado alrededor del texto y
la pestaña activa es una barra recta abajo. No se confunden porque no comparten
forma — no porque tengan colores distintos, que no los tienen: los dos son
`--primary`.

## El marco: el pie y el eje izquierdo

El marco resultó chico, y conviene que quede escrito por qué y no que parezca
esquivado. Con el cartel a 24 px, el `h1` de 20 px de cada pantalla queda
subordinado **sin tocar un solo archivo de pantalla**. Así que el marco aporta
dos cosas:

1. **`stack · sha` baja al pie.** `<footer className="px-6 py-3">` con
   `<Contexto className="text-right text-xs text-muted-foreground" />`, después
   del `flex-1` que ya tiene el layout, así que se hunde al fondo. Deja de
   competir con la navegación y sigue siendo la verificación humana más barata
   después de un deploy. Los `data-testid` `stack` y `sha` viajan intactos.
2. **El eje izquierdo queda explícito.** Cartel, pestañas y contenido arrancan
   todos en los mismos 24 px de gutter. Hoy coinciden por casualidad —cada
   pantalla trae su propio `p-6`—; queda escrito en el sistema de diseño como
   regla del shell, para que la próxima pantalla no invente otro.

## Lo que cambia en el sistema de diseño

`docs/sistema-de-diseno.md` es fuente de verdad y no puede quedar mintiendo:

- **La sección *La cara de display: Archivo*** dice *"Se usa para una cosa: el
  nombre del local en la pantalla de login. Ninguna otra pantalla la carga."*
  Pasa a: el nombre del local, en el login **y en el header de la aplicación**.
- **La fila *Dónde pesa*** dice *"En el login. No en el punto de venta ni en
  inventario"*. Pasa a: en toda pantalla. Con el detalle honesto de que en la
  sesión normal viene cacheada del login, pero **una sesión con cookie viva
  entra derecho a `/vender` y ahí paga los 90 KB**.
- **La sección *Tipografía*** suma la tabla de escala de más arriba.
- **`app/layout.tsx`** tiene el mismo par de afirmaciones en su comentario
  (*"Entra en un solo lugar… La descarga ocurre en el login, no en el punto de
  venta"*). Se corrigen en el mismo commit.
- **`app/globals.css`** dice *"Si una segunda pantalla los necesita, ahí entran
  acá"* sobre `--font-display` y `--color-marca`. Ahora hay una segunda
  pantalla y **el token sigue sin entrar**, porque se consume desde un módulo
  CSS y ninguna utilidad de Tailwind lo referenciaría. El comentario pasa a
  decir eso, que es más útil que la promesa que reemplaza.

**Ningún token cambia de valor y no entra ninguno nuevo**, así que
`test/sistema-de-diseno.test.ts` no se toca. El cartel es `--foreground` sobre
`--background` (19.80), la meta es `--muted-foreground` sobre `--background`
(5.17) y el subrayado es `--primary` sobre `--background` (10.79); los tres ya
estaban medidos.

**Corrección de la revisión final: esto no era cierto para la tabla de
contraste.** El párrafo original decía acá "tampoco hay pares de contraste
nuevos", y era falso: el anillo de foco de las pestañas sí introduce uno,
`--ring` sobre `--background`, que no tenía fila propia porque hasta esa
revisión el anillo era translúcido (`--ring/50`, sin par medido). Al pasar a
opaco (hallazgo 1 de esa revisión) el par pasa a valer 10.79 —el mismo valor
que `--primary` sobre `--background`, porque son el mismo token— y **sí**
entra a `PARES` en `scripts/contraste.mts` y a la tabla del documento, con
mínimo 3.0 por ser un indicador no textual (WCAG 1.4.11).

`--marca` sigue apareciendo en un solo lugar. Lo que cruza el umbral es la
tipografía, no el color.

## Lo que toca el gate

Nada que agregar a `scripts/smoke.sh`. El barrido autenticado ya abre cada
pantalla de `app/(app)/**/page.tsx` y busca el marcador del nombre del local en
el cuerpo: **si el cartel se rompe, fallan todos los casos de pantalla a la
vez**, que es la cobertura que este cambio necesita y ya tiene.

Lo que sí hay que cuidar al escribirlo es no romper la forma exacta del grep
—ver *El cartel*—, y que el caso de la línea 330, que busca el nombre en el
payload de RSC (`"tenant-nombre","children":"…"`), sigue dependiendo de que el
nombre sea el hijo directo.

## Tests

Sobre lo que ya existe en `app/(app)/layout.test.tsx` y
`components/navegacion.test.tsx`:

- **El cartel sigue cumpliendo la forma del grep.** El caso que ya existe
  (`data-testid="tenant-nombre">Local de prueba`) cubre esto tal cual está: no
  hace falta uno nuevo, pero sí verificar que sigue pasando con `title` y
  `className` delante.
- **`stack · sha` está DESPUÉS del contenido.** `html.indexOf('contenido') <
  html.indexOf('data-testid="stack"')`. Es la forma no frágil de afirmar que
  bajó al pie: no mira clases ni estilos, mira orden en el documento. Sin esto,
  alguien lo devuelve al header y la suite queda verde.
- **Las pestañas llevan indicador de foco.** Una aserción sobre la clase, que es
  frágil a propósito y va con su comentario: es lo único que impide que
  `focus-visible` desaparezca en un refactor de estilos sin que nada se queje.
  Si la utilidad de Tailwind cambia de nombre, el test se actualiza — eso es el
  costo, y se paga.
- **El cartel recibe el tratamiento de display.** Antes de escribirlo hay que
  ver **cómo resuelve vitest los módulos CSS** en este repo: si devuelve el
  nombre de clase, se asserta; si devuelve `undefined`, no se inventa un test
  que no prueba nada y la verificación queda a ojo, anotada abajo.

## Riesgo y deploy

Presentacional puro: no hay migración, no hay server action nueva, no cambia
ninguna consulta. Pero **toca el shell de las siete pantallas a la vez**, que
según CLAUDE.md es la categoría peligrosa —código en uso— y no la de una
pantalla nueva en una ruta nueva. El modo de falla realista no es visual sino el
grep del gate, y ése falla ruidoso y temprano, en stage, antes de tocar
producción.

Sale como **PATCH**. Es un juicio y conviene dejarlo escrito: la regla de
CLAUDE.md reserva MINOR para *"algo que el cliente ve (pantalla nueva, módulo,
feature)"*, y esto es visible pero no es ninguna de las tres — no habilita nada
que antes no se pudiera hacer.

## Descartado

- **La persiana enrollada**: una tira de 6 px de `--marca` acanalada en el borde
  superior, el rollo que queda a la vista cuando la persiana está arriba. Era la
  dirección más memorable y la que más se parecía a este producto y a ningún
  otro. Se descartó porque obligaba a rediscutir la regla del documento —*el
  arándano como paño vive en un solo lugar*— y la contrapropuesta —*como paño
  donde no se mira, como trazo donde sí*— es una decisión de sistema de diseño,
  no de un ciclo de navbar. **Queda disponible**: si el header en tipografía
  sola se ve plano, es lo primero para volver a mirar.
- **El header pintado de `--muted`**, para que el cartel se apoye en un plano.
  Se ve más "diseñado" de entrada y no cuesta ningún color nuevo, pero es una
  superficie nueva y este ciclo eligió tipografía y nada más. Es el ajuste más
  barato si la franja queda pobre.
- **Normalizar el encabezado de las siete pantallas** en un componente
  compartido. Es lo correcto y va a hacer falta, pero acá significaba tocar
  siete archivos en uso para un ciclo cuyo objetivo era el shell. El cartel a
  24 px consigue la subordinación sin eso.
- **El cartel en mayúsculas.** Un cartel de local suele estar en mayúsculas y
  hubiera reforzado la lectura, pero el nombre lo escribe el cliente:
  `iPhone Doctor` en mayúsculas pierde información que él puso a propósito. Se
  respeta como lo cargó, igual que en el login.
- **Un token `--font-display` en `@theme inline`.** Lo anticipaba el comentario
  de `globals.css`, pero sigue sin haber una sola utilidad de Tailwind que lo
  use: el cartel necesita `font-stretch` y tracking propios, o sea un módulo CSS
  igual. Un token que nadie referencia es el token muerto que
  `test/sistema-de-diseno.test.ts` existe para impedir.
- **Todo en una sola fila.** Más compacto, pero mete el cartel adentro de una
  barra de herramientas y ahí deja de leerse como cartel. Además el riel de
  pestañas tiene que poder crecer con los módulos.

## Verificación

Lo mecánico lo cubren los tests y el gate. Lo que **ningún test puede
responder**, y queda para una persona sobre el canario después del deploy:

- Que el cartel se lea como un cartel y no como un `h1` grande. Es la pregunta
  que decide si esta dirección funcionó.
- **El salto de fuente.** Con `display: swap` y una sesión que entra derecho a
  `/vender` sin pasar por el login, el nombre aparece primero en la pila del
  sistema y salta a Archivo. A 24 px eso se ve. Hay que mirarlo con la caché
  vacía y decidir si molesta.

  **Corrección de la revisión final**: acá decía que el ajuste era
  `adjustFontFallback`, y es falso — en `next/font/local` esa opción es
  *opt-out* (`nextFontLocalFontLoader` sólo la desactiva si se le pasa
  `false`; ver `node_modules/next/dist/compiled/@next/font/dist/local/loader.js`),
  así que ya está activa sin que nadie la haya tocado: el `--font-archivo` que
  emite `next/font` ya trae una familia de fallback con `size-adjust` antes de
  la pila que declara `components/cartel.module.css`, y el swap ya viene
  compensado en métricas. Lo que se ve al saltar es un cambio de forma de
  glifo, no un salto de layout. Si eso molesta, la perilla real es
  `display: 'optional'` o `'block'` en el `localFont` de `app/layout.tsx`.
- Que el anillo de foco al tabular por las pestañas no se confunda con la
  pestaña activa.
- Un nombre de local largo en 360 px de ancho: que trunque el cartel y no
  empuje a Salir fuera de la pantalla.

Es la misma clase de pendiente que dejaron el ciclo del sistema de diseño y el
del home, y por el mismo motivo: nadie miró todavía esta aplicación con los
ojos.
