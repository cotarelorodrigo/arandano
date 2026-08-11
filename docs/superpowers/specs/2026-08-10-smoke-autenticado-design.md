# Spec: el smoke test autenticado

Fecha: 2026-08-10

Que el gate del deploy abra cada pantalla de la aplicación **con una sesión de
verdad** antes de promover la imagen, y que la lista de pantallas salga del
sistema de archivos en vez de mantenerse a mano.

## Por qué existe

El 2026-08-10 se deployó a producción una pantalla que no cargaba.
`app/(app)/usuarios/acciones.ts` exportaba una constante desde un archivo
`'use server'`, y Next.js convierte cada export de esos archivos en un endpoint
RPC: el módulo falla **al evaluarse**, en runtime, y tira abajo toda pantalla que
lo importe.

Las cuatro etapas del gate dieron verde: `npm test`, `tsc --noEmit`, `eslint` y
`npm run build`. Los smoke tests también, porque no hay ninguno que pida
`/usuarios`. La imagen que se promovió estaba construida sobre el código roto, y
el error apareció recién cuando una persona hizo click.

`test/use-server.test.ts` (commit `dc9d4af`) cierra **esa** falla: lee el fuente
y exige que todo export de un archivo `'use server'` sea una función async.
Cierra la causa concreta, no la clase. Cualquier otra forma de romper una
pantalla en runtime —un import circular, un componente de servidor que llama a
algo de cliente, una query que explota con el schema nuevo— vuelve a pasar por el
mismo agujero: **ninguna pantalla de la aplicación se abre nunca antes de que la
abra un cliente.**

Este ciclo cierra la clase.

## Estado del que se parte

Verificado sobre el repo al escribir este spec:

- `scripts/smoke.sh` tiene 12 casos. **Ninguno tiene sesión.** Los dos que tocan
  una pantalla de tenant piden `/login` (`caso_tenant_resuelve`,
  `caso_tenant_no_cacheable`) justamente porque es la única que se puede pedir
  sin credenciales; `caso_home_exige_sesion` verifica que `/` redirija, o sea
  verifica la **ausencia** de sesión.
- Las pantallas autenticadas que existen hoy son dos: `app/(app)/usuarios/page.tsx`
  y `app/page.tsx` (que para un tenant llama a `exigirSesion()` por su cuenta).
- El paso 8 de `deploy.sh` ya crea el canario de stage con `crear-tenant.mts`
  adentro de la imagen `arandano-migrate:$SHA`, sobre la red del stack. **No le
  define contraseña**, así que hoy ese canario no puede entrar a ningún lado.
- `scripts/definir-clave.mts` ya corre adentro de esa imagen: la etapa `migrate`
  del `Dockerfile` lleva `scripts/`, `lib/`, el cliente de Prisma generado y
  `tsconfig.json` — se sumaron en Task 11 exactamente para esto.
- El layout de `app/(app)/` renderiza `{sesion.tenant.nombre}` en su encabezado,
  pero **sin `data-testid`**. El de `/login` sí lo tiene
  (`data-testid="tenant-nombre"`), y es lo que `caso_tenant_resuelve` busca.
- `test/rutas-con-guard.test.ts` ya recorre `app/` buscando `page.tsx` y ya
  mantiene una lista blanca escrita a mano con la razón de cada excepción.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| De dónde sale la lista de pantallas | Glob sobre `app/(app)/**/page.tsx`, más `/` | Una pantalla nueva queda cubierta sin que nadie se acuerde de nada. Es lo mismo que ya hace `rutas-con-guard` |
| Rutas con parámetro | Lista blanca con la razón escrita | No se pueden pedir a ciegas; y la exención tiene que ser visible en el diff |
| Dónde corre | **Sólo contra `arandano-stage`** | Acá se escribe: hay login, y podría haber más. Nunca contra una base con datos de clientes |
| Contra qué tenant | El canario de stage, con contraseña fija | Ya lo crea el paso 8, con el mismo script versionado que crea tenants en producción |
| Quién le pone la clave | `definir-clave.mts`, en el paso 8, adentro de `arandano-migrate:$SHA` | El Postgres de stage no publica puerto: la imagen es el único lugar desde donde se le llega |
| Qué asierta cada caso | `200` **más** el nombre del local en el cuerpo | Un 200 solo no distingue una pantalla de un error manejado |
| Cómo se lleva la sesión | Header `Cookie:` extraído a mano del `set-cookie` | Explícito, y no depende de cómo curl indexa su cookie jar cuando el `Host` no es el host de la conexión |

## La lista de pantallas

Un glob sobre `app/(app)/**/page.tsx`, convertido a ruta — los grupos de rutas no
afectan la URL, así que `app/(app)/usuarios/page.tsx` es `/usuarios`.

Con dos salvedades que hay que escribir:

**`/` también entra**, aunque no viva bajo el grupo. Es una pantalla autenticada;
está afuera porque el ápex llega por esa misma ruta y no tiene sesión. Es la misma
excepción que ya declara `test/rutas-con-guard.test.ts`, y por el mismo motivo.

**Las rutas con segmento dinámico** (`/ventas/[id]` el día que exista) no se
pueden pedir a ciegas: no hay de dónde sacar un `id` válido sin sembrar datos, y
sembrar datos convierte el smoke en una suite de fixtures. Van en una lista
blanca **con su razón escrita**, igual que `SIN_TENANT_ID` en
`test/rls-cobertura.test.ts` y `FUERA_DEL_GRUPO` en `test/rutas-con-guard.test.ts`.
Hoy no hay ninguna; la lista arranca vacía y existe para que la primera sea una
decisión y no un olvido.

El glob no lo hace `smoke.sh`: bash recorriendo `app/` con la sintaxis de rutas de
Next es más frágil que el problema que resuelve, y además `smoke.sh` corre desde
el host mientras las rutas viven en el repo. La lista se genera y se le pasa; el
detalle de cómo, en el plan.

**Lo que hace que esto no sea decorativo**: si el glob no encuentra nada, el paso
falla. Un smoke que recorre cero rutas y reporta cero fallas es exactamente el
modo de falla que este ciclo existe para impedir — es la misma mitad que ya
llevan `rutas-con-guard` y `use-server` (`expect(archivos.length).toBeGreaterThan(0)`).

## La sesión

El paso 8 ya crea el canario de stage. Se le suma, inmediatamente después,
definirle la contraseña con `definir-clave.mts` en la misma imagen y sobre la
misma red, con un literal fijo del estilo de `efimero-salud` y `efimero-app`, que
ya viven versionados en `docker/compose.stage.yml` por el mismo motivo: base
efímera, nace vacía en cada corrida, nunca ve datos de clientes, y el stack sólo
escucha en la IP de Tailscale.

Va **antes** de `up -d --wait app`, igual que el alta del canario y por la misma
razón de orden: es el último momento en que la base se toca antes de que el
healthcheck del compose empiece a mirarla.

Una diferencia con el alta del canario que hay que respetar: `crear-tenant.mts`
corre con `MIGRATE_DATABASE_URL` (owner), y `definir-clave.mts` corre con
`DATABASE_URL` (`arandano_app`) **a propósito** — todo pasa por la API de Better
Auth y por lo tanto por RLS. Es el mismo camino que va a recorrer el login real.

Después `smoke.sh` hace un POST a `/api/auth/sign-in/email` con el `Host` del
canario, se queda con el `set-cookie`, y pide cada ruta con él.

**Un detalle a verificar en la implementación, no a asumir**: Better Auth valida
el origen de los requests que mutan, y `curl` no manda `Origin` por su cuenta. Si
hace falta, se manda explícito, y tiene que ser exactamente el que arma
`lib/auth/origen.ts` para ese stack —`http://canario.stage.arandano.app:3001`,
con el puerto de `PUERTO_PUBLICO`—, no el que uno supondría mirando la URL de la
conexión. Si el login devuelve algo que no es una cookie, el caso falla con ese
mensaje y no con un 404 tres casos más abajo.

## Qué asierta cada ruta

`200`, **más** un marcador que pruebe que es la pantalla de verdad.

El marcador es el nombre del local: el layout de `(app)` lo renderiza en su
encabezado, así que aparece en toda pantalla autenticada, y `smoke.sh` ya lo
recibe por argumento — el mismo valor que usa `caso_tenant_resuelve`, y el mismo
que el paso 8 acaba de escribir en la base. Hay que sumarle el
`data-testid="tenant-nombre"` al layout, que hoy no lo tiene.

Un 200 pelado no alcanza: Next puede devolver 200 sirviendo un `not-found`.

**Corrección posterior a la implementación** (review de la Task 3). Este párrafo
decía además que el marcador cubría "un error de servidor manejado por un
`error.tsx` futuro", y eso es falso para las rutas de `(app)`. Un boundary de
segmento se monta *adentro* del layout de su segmento: si mañana existiera
`app/(app)/error.tsx`, el layout —y el marcador con él— se renderizaría igual,
con 200, y el barrido daría verde sobre una pantalla rota. Hoy funciona porque
no hay ningún boundary así y todo sube al de la raíz, que no renderiza el layout
de `(app)`. O sea: para `/` el marcador prueba que la **página** renderizó
(vive en `app/page.tsx`), y para las rutas de `(app)` prueba que el **layout**
renderizó y que la página no tiró. `test/boundaries-app.test.ts` falla si
alguien agrega uno de esos boundaries, para que la decisión de mudar el marcador
del layout a cada página se tome ahí y no se descubra en producción.

**Lo que no se puede usar como marcador de falla, y hay que dejarlo escrito
porque ya costó una tarde**: buscar el texto del 404 en el cuerpo. Next incluye
el boundary de "not found" en el payload de *toda* página, incluidas las que
funcionan. Un chequeo así da rojo siempre.

## Qué pasa cuando falla

Corta el paso 9, que va **antes** de tocar producción: sin backup, sin
`migrate deploy`, sin promoción. El stack de stage se baja y el deploy termina
sin tag, como cualquier otra falla del gate.

Con esto, el bug del 2026-08-10 se hubiera visto como `/usuarios` devolviendo 500
en stage, con el deploy frenado ahí.

## Lo que este ciclo NO cubre

Vale escribirlo para que nadie lea de más en el verde de este paso:

- **No es un test de navegador.** No ejecuta JavaScript, así que un componente de
  cliente que explote al hidratar pasa igual. El bug que motivó el ciclo era de
  servidor, y los de esa familia son los que tiran la pantalla entera.
- **No prueba interacciones.** Abre pantallas; no crea un usuario, no carga una
  venta, no emite una factura. Esos casos entran cuando exista ese código, como
  ya dice `CLAUDE.md`.
- **No cubre rutas con parámetro.** Por diseño, ver más arriba.
- **No corre contra producción.** Un smoke autenticado escribe; contra prod eso
  es una sesión real en la base de un cliente. La verificación en el canario de
  producción sigue siendo manual, como hasta ahora.

## Riesgos que quedan escritos

- **El marcador es un `data-testid` en un layout.** Si alguien lo borra
  refactorizando el encabezado, todos los casos fallan a la vez y el deploy se
  frena por algo que no es una regresión. Es el costo de tener un marcador
  estable, y es el mismo trato que ya se aceptó para `/login`. Un comentario en
  el layout tiene que decir quién lo usa.
- **La contraseña del canario de stage queda versionada.** Es aceptable por lo
  mismo que `efimero-app`, `efimero-owner` y `efimero-salud`, y por nada más: si
  algún día ese stack dejara de ser efímero o dejara de estar detrás de
  Tailscale, esto se convierte en un problema. El comentario tiene que nombrar
  las dos condiciones, no sólo repetir "es efímero".
- **El paso 9 se vuelve más lento y con más superficie.** Cada pantalla nueva
  suma un request. Es deseado —esa es la feature— pero significa que una pantalla
  lenta o intermitente ahora puede frenar deploys. Si eso pasa, la respuesta es
  arreglar la pantalla, no aflojar el caso.

## Fuera de alcance

- El 404 posterior al login que quedó abierto: es un bug de navegación en el
  navegador, no algo que un smoke sin JavaScript pueda ver. Sigue su propio hilo.
- `www.arandano.app`, que hoy devuelve 404 y necesita un site block de una línea
  en Caddy.
- Todo lo anotado en `docs/superpowers/specs/2026-08-10-autenticacion-pendientes.md`.
