# Spec: instalar el local como app

**Fecha**: 2026-09-04

**Origen**: pregunta del dueño del producto — *"es posible que nuestros clientes
puedan instalar su negocio como pwa?"*.

La respuesta corta es que sí, y que este stack es un caso casi ideal por una
decisión que se tomó por otro motivo: **cada local es su propio origen**
(`flor.arandano.app`), con TLS válido desde el cutover del wildcard
(2026-08-10). Un navegador trata cada subdominio como una aplicación distinta,
así que cada dueño instala **su** negocio —con el nombre y el ícono de su
local, no con los de Arándano—, y el aislamiento entre locales lo da la misma
frontera de origen que ya usa Better Auth. Nada de esto habría sido barato con
el tenant en el path.

## El principio

**Un local que instala la app no obtiene ninguna capacidad nueva: obtiene un
lugar donde entrar.** Este ciclo no construye funcionamiento sin internet, ni
notificaciones, ni nada que cambie lo que el producto hace. Construye que el
producto tenga ícono propio en la pantalla de inicio del celular del dueño y se
abra sin la barra del navegador encima.

Vale escribirlo porque "PWA" arrastra un repertorio entero de expectativas —
offline, push, sincronización— y ninguna entra acá.

## Lo que se verificó antes de diseñar

Un spike descartable contra `arandano-dev` (Next 16.2.12), ya revertido:

- **El manifest dinámico por `Host` funciona** con la convención
  `app/manifest.ts` más `export const dynamic = 'force-dynamic'`.
  `canario.dev.arandano.app` devolvió `{"name":"Canario"…}` y
  `dev.arandano.app` devolvió el genérico, con `content-type:
  application/manifest+json`.
- **`tenantDelRequest()` sirve tal cual adentro del manifest.** No hizo falta
  ningún camino nuevo de resolución de tenant.
- **`notFound()` funciona dentro de la convención**: tenant 200, ápex 404,
  subdominio inexistente 404. Esto es lo que descartó tener que escribir un
  route handler propio en `/manifest.webmanifest`.
- **Next inyecta `<link rel="manifest">` solo**, sin tocar `app/layout.tsx`.
- **`ImageResponse` genera los íconos por tenant**: PNG de 192 y 512 con la
  inicial del local sobre `--marca`, 3 KB y 12 KB.
- **El pie del sidebar es una sola copia.** En `components/ui/sidebar.tsx` el
  `Sheet` del teléfono y el riel de escritorio renderizan el mismo
  `{children}`, así que la regla de las dos copias —la que dejó escrita el
  merge del ciclo móvil— no aplica a este botón.

## Las cinco piezas

| Pieza | Archivo | Qué hace |
|---|---|---|
| Manifest | `app/manifest.ts` | Nombre e íconos del local, resuelto por `Host` |
| Íconos | `app/icono/[tamano]/route.tsx` | 192 y 512 generados con la inicial |
| Service worker | `public/sw.js` | Existir, y servir la pantalla sin conexión |
| Pantalla offline | `app/sin-conexion/page.tsx` | Estática, sin datos de ningún local |
| Botón "Instalar" | pie del `SidebarFooter` | Dispara el prompt, o explica el camino de iOS |

## El manifest

```
name / short_name   nombre del local
start_url           /
scope               /
display             standalone
theme_color         --marca         (#2A1760)
background_color    --background    (#F6F5F9)
icons               /icono/192, /icono/512 (any y maskable)
```

### `start_url` es `/`, y eso ahorra una decisión entera

La pregunta obvia es a qué pantalla abre la app instalada, y parecía necesitar
una respuesta por rol: el dueño trabaja en `/dashboard` y quien atiende en
`/vender`. Un manifest es uno solo por origen, así que no puede ramificar.

No hace falta: **`app/page.tsx` ya resuelve eso**. Resuelve el tenant, rebota al
suspendido con `forbidden()`, exige sesión y redirige con `destinoAlEntrar()`
(`lib/auth/destino.ts`), que es la función que ya centraliza los tres lugares
que redirigen. El manifest apunta a `/` y cada persona aterriza donde trabaja,
sin que el manifest sepa de roles y sin sumar un cuarto lugar que pueda
discrepar de los otros tres — que es exactamente lo que el docblock de esa
función existe para impedir.

### Fuera de un tenant, 404

Ápex, subdominios reservados, inexistentes y ajenos no tienen manifest.

Se descartó servir un manifest genérico "Arándano" para el ápex: dejaría la
**página de ventas del producto** instalable como si fuera el producto, que es
una confusión que no le sirve a nadie. La landing se comparte por link, no se
instala.

## Los íconos

Generados y no archivos en `public/`, por la razón que ya dejó escrita
`app/opengraph-image.tsx`: un binario a mano se desincroniza del color de marca
sin que nadie se entere.

La inicial del local en blanco sobre `--marca`, centrada. Es el mismo
tratamiento que el avatar del pie del sidebar, así que el ícono de la pantalla
de inicio y el de adentro de la app se parecen entre sí sin que nadie lo haya
coordinado.

**Se descartó que el local suba su logo**, y no por falta de ganas: hoy no
existe ningún camino de subida de archivos en el producto. Habría que resolver
almacenamiento, tamaños, recorte y qué se muestra mientras no hay logo — es un
ciclo propio. **El disparador para hacerlo**: que un dueño con logo hecho pida
verlo ahí. Nada de este ciclo lo bloquea: el logo cargado pisaría al generado y
la inicial quedaría de default permanente, que es lo que hoy hace falta igual
para el local que no tiene logo.

### Los hex entran a `test/opengraph.test.ts`

Satori no resuelve custom properties de CSS, así que los colores van copiados a
mano en hex, igual que en `app/opengraph-image.tsx`. Eso ya tiene su red: ese
test convierte los tokens reales a hex y los compara contra el archivo. **El
ícono se suma al mismo caso**, para que un repintado de la paleta que se olvide
de acá rompa el build en vez de servir en silencio el color viejo — que es
exactamente el peaje que la paleta ya pagó una vez.

### El tamaño se valida contra una lista de dos, no contra un rango

Sólo 192 y 512. Un endpoint que genera una imagen del tamaño que le pidan es
trabajo de CPU gratis para cualquiera que lo descubra, sobre una caja de 2 vCPU
donde dev, stage y producción comparten los mismos dos cores. La primera
versión del spike aceptaba de 16 a 1024 y eso es justamente lo que no hay que
dejar.

### `maskable` sale del mismo endpoint

Android recorta el ícono contra un círculo del 80 % del lado. Con la inicial
centrada a la mitad del tamaño de fuente, la altura de mayúscula queda alrededor
del 35 % del lado — bien adentro de la zona segura —, así que la misma imagen
sirve para `any` y para `maskable` sin generar una variante aparte. Si al
implementar se ve recortada en un Android real, la salida es bajar el tamaño de
fuente de la variante maskable, no cambiar el diseño.

## El service worker

Hace exactamente dos cosas, y conviene enumerar también las que no hace porque
es lo que lo mantiene auditable:

- **`install`**: cachea **una** URL, `/sin-conexion`. Nada más.
- **`fetch`**: interviene sólo en navegaciones `GET` (`request.mode ===
  'navigate' && request.method === 'GET'`). Intenta la red; si falla, devuelve
  la página cacheada. Para todo lo demás no llama a `respondWith`, así que el
  navegador hace lo de siempre: `/api/*`, los server actions, las imágenes y la
  fuente pasan sin que el SW los toque.
- **Nada de tenant se cachea nunca.** No existe ninguna rama de código que
  guarde HTML de un local.

El filtro por `GET` no es prolijidad: un formulario enviado sin JavaScript es
una navegación `POST`, y devolverle una página cacheada de `GET` es una
respuesta que no corresponde a lo que se pidió.

El nombre de la caché lleva una constante de versión que se sube cuando cambia
el archivo, y `activate` borra las cachés de versiones anteriores.

### El riesgo, que contradice el modelo de rollback del proyecto

Todo lo demás de este repo se revierte revirtiendo la imagen. **Un service
worker no.** Queda instalado en el navegador del dueño y sobrevive al rollback
automático del healthcheck, que es la única red que este proyecto tiene por
decisión escrita (*Cómo se manejan los cambios una vez en producción*). Un SW
mal hecho es la primera cosa que este producto puede desplegar y no puede
deshacer.

Dos defensas, y ninguna es opcional:

1. **Trivialidad.** El SW es tan chico que se lee entero de una sentada. No
   cachea HTML, no cachea assets, no tiene estrategias. Todo lo que podría
   quedar viejo, no existe.
2. **Un deploy de desactivación documentado** en la sección *Deploy y rollback*
   de `docs/runbook-stacks.md`: reemplazar el cuerpo de `public/sw.js` por uno
   que llame a `self.registration.unregister()` y limpie sus cachés. No es un
   rollback —es un deploy hacia adelante, y pasa el mismo gate—, y está escrito
   de antemano justamente porque el momento de escribirlo no es cuando hace
   falta.

### Por qué el SW entra, si Chrome ya no lo exige

Chrome sacó la exigencia de service worker para instalar **desde el menú del
navegador** (v108 en Android, v112 en escritorio). Lo que todavía la pide es la
heurística que dispara `beforeinstallprompt`, que es el evento del que depende
tener un botón "Instalar" adentro del producto.

O sea que el SW no compra instalabilidad —eso ya lo da el manifest— sino
**descubribilidad**: sin él, la feature existe pero sólo la encuentra quien
sepa buscar en el menú de Chrome. Con él, el producto puede ofrecerla.

Se descartó `next-pwa` y Serwist: traen Workbox y un repertorio de estrategias
de caché que son exactamente lo que este diseño no quiere, en un repo que sacó
`recharts` por menos.

## La pantalla sin conexión

Instalada como app, sin internet la ventana queda mostrando el error del
navegador, sin marca y sin explicación. Un local con wifi malo lo va a ver, y
en una ventana sin barra de direcciones se lee como que la app se rompió.

`app/sin-conexion/page.tsx` es **estática de verdad**: sin `headers()`, sin
sesión y **sin el nombre del local**. Si nombrara al local sería dinámica, y el
SW estaría cacheando un dato de tenant — que es la única línea que este diseño
no cruza. El costo es que la pantalla dice "Arándano" y no el nombre del
negocio; es el costo correcto.

Sin botón de reintentar ni recarga automática: son código que vive fuera del
gate de deploy para ahorrar un gesto que el navegador ya tiene.

### Se pinta sola, y eso no es una preferencia de estilo

El SW cachea el **HTML** de `/sin-conexion`, no los archivos que ese HTML
referencia. Las hojas de estilo y los chunks que emite Next llevan hash en el
nombre y cambian en cada build, así que no hay ninguna lista de URLs que se
pueda cachear en `install` y siga siendo válida después del deploy siguiente.

Servida desde la caché sin conexión, esa página encontraría su
`<link rel="stylesheet">` inalcanzable y se vería **sin estilos** — cosa que
nadie descubriría en dev, donde la red anda.

Así que la pantalla lleva su estilo adentro, sin depender de ninguna clase de
Tailwind ni de ningún archivo externo. Los colores se copian en hex de los
tokens, como ya hacen `app/opengraph-image.tsx` y los íconos de este mismo
ciclo, y por la misma razón entran al caso de `test/opengraph.test.ts`.

Cachear los assets con nombre hasheado sería la otra salida, y es la que
convierte al SW en lo que este diseño decidió que no sea: algo que mantiene un
manifiesto de archivos y que puede quedar viejo.

**Toca dos redes del repo, las dos a propósito.** Hay que sumarle su sección a
`docs/pantallas.md` (`test/pantallas.test.ts` la ata en las dos direcciones) y
su entrada con razón escrita a `FUERA_DEL_GRUPO` en
`test/rutas-con-guard.test.ts` — no lleva guard de sesión porque tiene que poder
servirse desde la caché a alguien sin conexión, o sea sin ninguna posibilidad de
validar nada. No entra al barrido de `scripts/smoke.sh`, que sólo recorre
`app/(app)/**/page.tsx`.

## El botón

Vive en el `SidebarFooter`, junto a la identidad del local — que es donde ya
vive lo que habla del local. Una sola copia para los dos anchos (ver *Lo que se
verificó*).

Tres estados:

- **Ya instalada** (`display-mode: standalone`): no dibuja nada. Un botón para
  instalar lo que ya está instalado es ruido permanente.
- **El navegador ofreció `beforeinstallprompt`**: el botón lo dispara.
- **iOS**: abre las instrucciones con el ícono real de Compartir. Safari no
  tiene ningún prompt y nunca lo va a tener; el único camino es *Compartir →
  Agregar a inicio*, a mano.

En un navegador que no soporta ninguno de los dos caminos —Firefox de
escritorio— no dibuja nada. Inventar instrucciones por navegador sin poder
verificarlas es peor que el silencio.

**Por qué iOS se atiende y no se ignora**: es la regla que este proyecto ya
aplicó cinco veces en el ciclo del teléfono — *una capacidad que desaparece en
un dispositivo y no reaparece en ningún lado es un defecto, no una
simplificación*. Y acá muerde especialmente: el primer vertical es locales de
celulares, así que el dueño tiene bastantes chances de usar un iPhone.

Se descartó el aviso descartable arriba de todo. Es más descubrible en el
teléfono —donde instalar más importa— pero suma estado que recordar, una
superficie más en la pantalla de cobro, y el caso de quien lo cierra sin querer
y se queda sin forma de encontrarlo.

## Permisos

**Ninguno nuevo.** `lib/permisos/catalogo.ts` no crece.

Instalar no mueve nada del negocio: es una preferencia del dispositivo de quien
está sentado ahí, no una capacidad que un dueño reparta entre sus empleados. Es
la misma forma de razonar que ya separó `PLANES_PAGO` de `ARTICULOS_EDITAR` —
se delega por lo que la acción mueve—, aplicada a algo que no mueve nada.

Un empleado con sesión puede instalar la app en su propio teléfono, y eso es lo
correcto: es el que está en el mostrador.

## Sin migración

Este ciclo no toca el schema, ni una server action, ni una consulta. Se revierte
entero revirtiendo la imagen — con la única excepción del service worker, que
tiene su propio camino de desactivación escrito más arriba.

## Cómo se verifica

Automático:

- **El manifest, en las dos direcciones**: con `Host` de tenant devuelve el
  nombre de ese local; con el ápex y con un subdominio inexistente devuelve 404.
  Es la propiedad que más fácil se rompe sin que nada avise, porque un manifest
  que devuelve 200 siempre pasa desapercibido.
- **Los hex del ícono contra los tokens reales**, sumados al caso que ya existe
  en `test/opengraph.test.ts`.
- **La pantalla sin conexión no nombra a ningún local**: afirmar que el HTML
  entero no contiene el nombre del tenant, literalmente y no por inferencia — el
  mismo patrón que usa `test/ventas.test.ts` con la palabra "IMEI".
- **El service worker no cachea nada de tenant**: un caso por fuente sobre
  `public/sw.js`, que afirma que la única URL cacheada es la de la pantalla sin
  conexión. Es el mismo mecanismo que `test/permisos-en-las-dos-copias.test.ts`,
  que verifica por fuente lo que no se puede renderizar.
- **`scripts/smoke.sh` suma un caso**: `/manifest.webmanifest` contra el canario
  de `arandano-stage` devuelve 200 y el nombre del canario en el cuerpo.

Manual, y esta vez **hace falta un teléfono de verdad**, porque nada de lo que
importa se puede afirmar desde el gate:

- Que Chrome en Android ofrezca instalar y que el ícono de la pantalla de inicio
  sea la inicial del local, no el de Arándano.
- Que la app abierta desde ese ícono no muestre barra de direcciones y aterrice
  en el tablero con un dueño y en el punto de venta con un empleado.
- Que el botón desaparezca una vez instalada.
- Que en un iPhone el botón muestre las instrucciones y que el camino que
  describen sea el que Safari realmente tiene.
- Que con el modo avión prendido la app instalada muestre la pantalla sin
  conexión y no el error del navegador — **y que se vea pintada**, no como HTML
  pelado. Es lo único que confirma que el estilo inline alcanzó, y no hay forma
  de afirmarlo desde el gate: en dev la red siempre anda.
- Que el ícono maskable no quede recortado en un Android que use máscara
  circular.

**Y hay un obstáculo concreto**: la instalación exige HTTPS, y `arandano-dev`
se sirve por HTTP sobre Tailscale — el wildcard `*.arandano.app` no cubre
`canario.dev.arandano.app`, porque un wildcard de DNS es de una sola etiqueta.
Así que la verificación manual se hace **contra el tenant canario de
producción, después del deploy**, que es donde este proyecto ya dice que se mira
primero. Lo que sí se puede mirar en dev es todo lo que no depende del prompt:
el manifest servido, los íconos, la pantalla sin conexión y los tres estados del
botón.

## Lo que este ciclo NO hace

- **No funciona sin internet.** Cobrar offline y sincronizar después es otro
  producto, y toca el punto de venta, que es la pantalla donde este proyecto
  menos quiere improvisar. La pantalla sin conexión es un cartel, no una
  capacidad.
- **No manda notificaciones push.** Es lo primero que alguien va a pedir apenas
  escuche "PWA", y es su propio ciclo: permisos del navegador, suscripciones por
  dispositivo, y algo que decida qué vale la pena notificar.
- **No deja instalar el ápex.**
- **No permite subir un logo.** Ver el disparador más arriba.
- **No dibuja nada en `design/arandano.pen`**, que no tiene frames para el botón
  del pie, el diálogo de iOS, la pantalla sin conexión ni el ícono. Se anota
  como entrada **32** de `docs/correcciones-pendientes-del-pen.md`. Sigue
  pendiente de antes que una persona guarde y commitee la maqueta viva desde
  Pencil — el MCP lee, no persiste.
