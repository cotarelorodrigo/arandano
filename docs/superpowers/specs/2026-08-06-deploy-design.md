# Spec: `deploy.sh` — el gate de deploy

Fecha: 2026-08-06

Diseño del comando que promueve código a producción: un gate encadenado que
buildea una vez, ensaya la migración contra una base descartable, promueve esa
misma imagen, verifica que lo que respondió sea lo que promovió, deja un tag de
git y rollbackea solo si algo falla.

Es el último de los bloqueantes grandes antes del primer tenant real. Los otros
dos ya están cerrados: los backups (2026-08-04) y el schema del núcleo con su
aislamiento por RLS (2026-08-06, aplicado en producción).

## Por qué esto importa más de lo que parece

No hay feature flags. La decisión está tomada y documentada en `CLAUDE.md`, y
tiene una consecuencia directa: **el gate del deploy, el healthcheck y el
rollback automático son la única red que existe**. No hay liberación gradual, no
hay un subconjunto de clientes que sirva de canario antes que el resto. Cada
deploy alcanza a todos a la vez.

Eso mueve a `deploy.sh` de "script de conveniencia" a "el mecanismo que decide
si un error llega o no a los clientes". Un gate con un paso decorativo no es un
gate incompleto: es un gate que miente, porque quien lo corre cree que lo
protege.

## Estado del que se parte

Verificado sobre el repo y el VPS al escribir este spec:

- **Producción corre `arandano-app:25297f7`**, promovida a mano en el ciclo
  anterior. El healthcheck reporta `status: ok` con los checks `postgres`
  (`db=arandano_prod`) y `rol` (`rol=arandano_app`).
- **No hay ningún tag de git.** El historial de versiones arranca con este
  ciclo.
- **Existen exactamente dos rutas**: `/` y `/api/health`. Las pantallas que
  `CLAUDE.md` enumera como smoke tests —login, alta de venta, factura, orden de
  trabajo, catálogo público— todavía no existen.
- **`docker/compose.stage.yml` ya está escrito esperando este script.** Su
  comentario dice explícitamente que los roles de ese stack no existen hasta
  que `deploy.sh` corra `scripts/setup-db-roles.sh` contra su Postgres efímero,
  y su healthcheck existe para que `docker compose up --wait` no devuelva antes
  de que la app atienda.
- **`scripts/setup-db-roles.sh` acepta `--network`** desde el ciclo anterior,
  que es lo que le permite alcanzar un Postgres que no publica puerto.
- **El `Dockerfile` tiene cuatro etapas** —`deps`, `build`, `migrate`,
  `runtime`— con `runtime` última a propósito, y los builds pasan `--target`
  explícito. Ver el runbook: no respetarlo produjo una imagen del CLI de Prisma
  etiquetada como la app.
- **`scripts/tests/test-backup-comun.sh` no está enganchado a nada.** Ni
  `npm test` ni `verify-infra.sh` lo ejecutan.
- **`backup.sh --motivo=pre-migracion` es el contrato** que dejó definido el
  spec de backups, incluida la regla de que si ese backup falla, el deploy
  aborta antes de migrar.

## Decisiones tomadas

Las que salieron del diseño de este ciclo, con su razón:

1. **Los smoke tests nacen con contenido real, no vacíos.** Se prueba lo que
   hoy sí existe —healthcheck con todos sus checks en `ok`, la migración
   aplicándose sobre una base virgen, la app conectada sin privilegios, ninguna
   tabla sin RLS, la home respondiendo— y cada feature futura suma su caso. Un
   paso que hoy no prueba nada es un paso que nadie se acuerda de llenar
   después.
2. **El rollback manual sale del tag de git anterior**, no de un archivo de
   estado paralelo. `CLAUDE.md` ya define que el mensaje del tag anotado lleva
   la imagen promovida y las migraciones que corrieron, así que el historial ya
   existe — y como los tags se pushean a `origin`, sobrevive al VPS, que es
   justo el escenario donde más se necesita.
3. **`deploy.sh` tagea desde el primer deploy**, haya tenants o no. La
   alternativa dejaba el rollback con dos modos según la época, y el modo sin
   tags —el que nunca se ejercitaría después— sería el único disponible
   justamente ahora.
4. **La lógica peligrosa vive en una lib de funciones puras.** Mismo patrón que
   `backup.sh` / `verify-backup.sh` / `lib/backup-comun.sh`: los tests corren en
   milisegundos, sin Docker y sin red, así que nadie tiene motivo para
   saltearlos.
5. **El ensayo en stage va antes de tocar producción**, corrigiendo el orden
   documentado. Ver más abajo.

## Arquitectura

| Archivo | Qué es |
|---|---|
| `scripts/deploy.sh` | El orquestador. La secuencia y nada más. |
| `scripts/rollback.sh` | El comando de una línea para volver atrás. |
| `scripts/lib/deploy-comun.sh` | Funciones puras y formato compartido. Sin efectos. |
| `scripts/smoke.sh` | Los smoke tests, contra una URL base que recibe por argumento. |
| `scripts/tests/test-deploy-comun.sh` | Unitarios de la lib. |
| `docker/compose.ensayo.yml` | Stack descartable con la forma de prod, para probar el deploy. |
| `.githooks/pre-commit` | Sólo el chequeo de migración destructiva. |

### La lib: qué entra y qué no

Entra todo lo que **decide** algo y nada que **ejecute**:

```
proxima_version  <ultimo_tag> <minor|patch>  -> v1.MINOR.PATCH
migracion_destructiva  "<sql>"               -> sí/no + qué patrón encontró
mensaje_de_tag   <sha> <migraciones>         -> el texto del tag anotado
imagen_de_tag    "<mensaje>"                 -> el sha
health_ok        "<json>"                    -> sí/no
sha_del_health   "<json>"                    -> el sha
```

`proxima_version` con el último tag **vacío** devuelve `v1.0.0`, sea cual sea el
segundo argumento. Ese es el caso del primer deploy y no es una excepción a
manejar en el llamador: si viviera en `deploy.sh` en vez de en la lib, no
tendría test.

`mensaje_de_tag` e `imagen_de_tag` son inversas y por eso viven juntas:
`deploy.sh` escribe el mensaje y `rollback.sh` lo lee. Es el mismo argumento por
el que existe `backup-comun.sh` — lo que dos scripts se dicen entre sí es
*formato*, y mantenerlo en dos archivos es exactamente cómo se desincroniza, en
silencio, hasta el día que haga falta.

`sha_del_health` y `health_ok` parsean el JSON que hoy devuelve `/api/health`:

```json
{"status":"ok",
 "checks":[{"name":"postgres","ok":true,"durationMs":1,"detail":"db=arandano_prod"},
           {"name":"rol","ok":true,"durationMs":5,"detail":"rol=arandano_app"}],
 "info":{"sha":"25297f7","uptimeS":327}}
```

## La secuencia del gate

| # | Paso | Si falla |
|---|---|---|
| **Preflight — nada tocado todavía** ||
| 1 | Working tree limpio (`git diff --quiet`) | aborta |
| 2 | Migraciones nuevas sin SQL destructivo | aborta |
| 3 | `schema.prisma` sin cambios que ninguna migración capture (shadow database) | aborta |
| 4 | `npm test` | aborta |
| 5 | `npx tsc --noEmit` y `npm run lint` | aborta |
| **Build** ||
| 6 | Frenar `arandano-dev` | aborta |
| 7 | Buildear `arandano-app` y `arandano-migrate` con `--target`, `GIT_SHA` y el slice | aborta |
| **Ensayo en stage** ||
| 8 | Levantar `arandano-stage`, crear sus roles, `migrate deploy` sobre base virgen | aborta |
| 9 | `smoke.sh` contra stage; bajar stage con `-v` | aborta |
| **Producción** ||
| 10 | `migrate status` contra prod: el repo y prod coinciden | aborta |
| 11 | `backup.sh --motivo=pre-migracion` | aborta |
| 12 | `migrate deploy` contra prod | aborta |
| 13 | Promover: `IMAGE_TAG` en el `.env` y recrear la app | **rollback** |
| 14 | Healthcheck de prod, e `info.sha` == tag promovido | **rollback** |
| 15 | Tag anotado `v1.x.y` y push a `origin` | **avisa, no rollback** |
| 16 | Volver a levantar `arandano-dev` | siempre, vía `trap` |

### De dónde sale la shadow database del paso 3

El chequeo canónico es
`prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code`, y
necesita una base descartable donde reproducir el historial de migraciones. Sale
del **mismo patrón que ya usan `verify-backup.sh` y `arandano-stage`**: un
`postgres:17-alpine` efímero, con los datos en tmpfs, levantado y tirado dentro
del paso. No se reutiliza el Postgres de stage, porque stage todavía no está
arriba en el paso 3 — y adelantarlo ataría un chequeo de preflight, que hoy no
toca nada, al ciclo de vida de un stack.

### El ensayo va antes que producción

`CLAUDE.md` documenta el orden `backup → migrate deploy → smoke test contra
stage`, o sea que producción se migra **antes** de que la imagen se valide en
stage. No es incorrecto —expand/contract lo hace seguro, porque el código viejo
tolera el schema nuevo— pero invertirlo no cuesta nada y compra que la migración
se ensaye sobre una base virgen antes de tocar la de clientes. Si va a explotar,
que explote en stage.

Este spec corrige ese orden. La lógica de por qué el orden viejo *también* era
seguro sigue valiendo y es la que sostiene el paso 12: aun cuando la migración
de prod corre antes de la promoción, un aborto ahí deja producción con schema
nuevo y código viejo, que es un estado compatible por construcción.

### Frenar dev es el primer paso, no un paso intermedio

Bloqueante 6 de `CLAUDE.md`, con su aritmética: prod 3200 MiB + dev 2304 + build
2048 + ~1,1 GB de sistema ≈ 8,5 GB sobre una caja de 7,6 GB. Con dev abajo desde
antes del build el pico queda en ~7,5 GB. De paso queda cubierta la regla de que
dev y stage no corren juntos, porque stage viene después del build.

### Semántica de fallos

Tres zonas, con tres comportamientos distintos:

- **Pasos 1–12: abortar.** Producción sigue con su imagen anterior y no hay nada
  que revertir. Un aborto en el 12 deja prod con schema nuevo y código viejo —
  el estado que expand/contract garantiza compatible.
- **Pasos 13–14: rollback automático.** Es el único tramo donde producción ya
  cambió. El healthcheck del paso 14 tiene **plazo de 90 segundos**: si no
  contesta `status: ok` con el `info.sha` correcto dentro de ese plazo, eso *es*
  el fallo. Un healthcheck que espera para siempre no es un gate.
- **Paso 15: avisar, nunca rollback.** Si el `git push` del tag falla,
  producción ya está viva y sana. Revertirla por un problema de metadatos
  convertiría un fallo cosmético en una caída. Sale con código propio y un
  mensaje que dice qué quedó pendiente.

### Concurrencia

`flock` sobre un lock propio. A diferencia de `backup.sh`, que ante un lock
tomado se saltea la corrida y devuelve 0, **`deploy.sh` aborta con error**:
saltearse un deploy en silencio y salir bien es cómo alguien termina creyendo
que promovió algo que nunca promovió.

### El `trap` de salida

Corre siempre, con cualquier resultado: baja `arandano-stage` con `-v` si quedó
arriba, vuelve a levantar `arandano-dev`, y **preserva el código de salida
original** en vez de enmascararlo con el del último comando de limpieza.

## `rollback.sh`

**El rollback automático de `deploy.sh` no usa los tags.** Antes de promover,
`deploy.sh` lee el `IMAGE_TAG` que hay en el `.env` y se lo guarda: ese es su
destino, un valor exacto que no hay que inferir. Eso además resuelve solo el
deploy #1, que no tiene tag anterior pero sí tiene un `IMAGE_TAG` previo.

**Los tags son para el rollback manual**, días después, cuando el operador ya no
tiene ese contexto en pantalla:

- `scripts/rollback.sh` sin argumentos va al anteúltimo tag y extrae la imagen
  de su mensaje con `imagen_de_tag`.
- `scripts/rollback.sh --a=<sha>` va a donde se le diga.

Los dos caminos terminan en la misma función que usa `deploy.sh`, así que el
rollback automático y el manual son el mismo código: si uno funciona, el otro
también.

**El rollback no toca la base de datos. Nunca**, y lo dice en su salida. Esa es
exactamente la razón por la que el paso 2 del gate se niega ante una migración
destructiva: si el schema nuevo no soporta el código viejo, revertir la imagen
no alcanza y no queda ninguna red. El chequeo barato de arriba es lo que
sostiene la garantía de acá abajo.

**Si el rollback falla** —el peor caso— no reintenta ni entra en loop. Sale con
código propio e imprime qué imagen corría, a cuál intentó volver y qué comando
correr a mano. En ese punto lo único útil es que una persona tenga los datos sin
ir a buscarlos.

## Versionado y tags

Formato `v1.MINOR.PATCH`, derivado del último tag por `proxima_version`.
`deploy.sh --minor` sube MINOR; el default es PATCH, que es lo más frecuente y
el default seguro. MAJOR se queda en 1.

El tag se crea **después** del healthcheck, nunca antes: un tag significa "esto
estuvo vivo y sano en producción", no "esto se intentó". Un deploy que
rollbackea no consume número, así que la secuencia no tiene huecos.

Es anotado, y el mensaje carga lo que el SHA no dice:

```
v1.0.1

imagen: arandano-app:25297f7
migraciones: 20260804205911_inicial
```

`imagen_de_tag` parsea exactamente ese formato. Si alguien cambia el mensaje sin
cambiar la función, el rollback manual deja de encontrar a dónde volver — por eso
las dos funciones son inversas y viven en el mismo archivo, con tests que las
recorren en los dos sentidos.

## `--objetivo`: probar el deploy sin producción

`--objetivo` parametriza cuatro cosas: qué compose, qué `.env`, contra qué URL
hace el healthcheck, y si tagea git.

- `--objetivo=prod` (default): `/srv/arandano/prod`, tagea y pushea.
- `--objetivo=ensayo`: `docker/compose.ensayo.yml` con base efímera, **no tagea
  ni pushea**, y el backup va con `--motivo=test` para no ensuciar el histórico.

Con `ensayo` corre la secuencia **completa y real** —frena dev, buildea, ensaya
en stage, migra, promueve, verifica, y rollbackea si algo falla— sin tocar
producción. Es la única forma de ejercitar la coreografía, que es donde vive el
riesgo de un deploy: los unitarios cubren cada decisión por separado, pero el
orden de los pasos no lo prueba ningún test unitario.

**La memoria cierra porque dev está abajo.** Una corrida de ensayo no reemplaza
a producción: prod sigue arriba sirviendo, y el ensayo se suma. En el tramo del
paso 8 al 9 pueden coexistir los dos stacks descartables, así que el pico es
prod 3200 + stage 1280 + ensayo 1280 + ~1,1 GB de sistema ≈ **6,9 GB sobre 7,6**.
Entra, pero sólo porque el paso 6 frenó `arandano-dev` y sus 2304 MiB. Por eso
`compose.ensayo.yml` hereda **los límites de stage** (app 768 MiB, Postgres 512
MiB con tmpfs de 320 MiB) y no los de prod.
El stack de ensayo existe para probar la secuencia, no para medir rendimiento, y
copiarle los límites a prod haría que la caja no alcance. Escucha sólo en la IP
de Tailscale, como dev y stage.

## Smoke tests

`scripts/smoke.sh <url_base>` corre contra stage en el paso 9. Los casos que
existen hoy:

- `/api/health` devuelve 200 con `status: ok` y **todos** los checks en `ok`.
- El check `rol` reporta `arandano_app` — o sea que la app no quedó conectada
  con privilegios y las policies de RLS aplican.
- La migración se aplicó sobre la base virgen de stage.
- Ninguna tabla del schema `public` quedó sin RLS, salvo `_prisma_migrations`.
- `/` devuelve 200.

Se escribe con un caso por función y una lista, de modo que sumar uno sea
agregar una función. Cuando existan login, ventas, facturación, órdenes de
trabajo y catálogo público, sus casos entran acá — y ese es el momento en que
esta sección del spec deja de estar corta.

## El hook de pre-commit

Sólo el chequeo de migración destructiva, que es el único de los tres que no
necesita levantar nada: lee el SQL de las migraciones nuevas y busca patrones.

Los otros dos no van al hook, a propósito. El de schema contra migraciones
necesita una shadow database, y un hook que levanta un Postgres en cada commit
sobre 2 vCPU termina con alguien usando `--no-verify` — y un hook desactivado no
protege nada. El de migraciones contra producción exige apuntar herramientas de
desarrollo a la base de prod con sus credenciales, que es justo la separación
que este proyecto construye a propósito; su único lugar legítimo es `deploy.sh`.

El hook vive en `.githooks/` (versionado) y se activa con
`git config core.hooksPath .githooks`. Esa línea va en `scripts/setup-host.sh`,
porque un hook que hay que acordarse de instalar no está instalado.

## Testing

En orden de costo:

1. **`scripts/tests/test-deploy-comun.sh`** — unitarios de la lib. Milisegundos,
   sin Docker, sin red. Cubren `proxima_version` (patch, minor, primer tag),
   `migracion_destructiva` (los patrones que sí y los que no), el ida y vuelta
   `mensaje_de_tag` → `imagen_de_tag`, y el parseo del healthcheck incluido el
   caso de un check en `false`.
2. **`scripts/smoke.sh`** — se ejercita solo, cada vez que corre el gate.
3. **`deploy.sh --objetivo=ensayo`** — la corrida completa. Lento y caro; se
   corre a mano antes de confiarle producción y cada vez que se toca la
   secuencia.

**Los tests de bash se enganchan a `npm test`.** Hoy
`scripts/tests/test-backup-comun.sh` no lo corre nadie: ni `npm test` ni
`verify-infra.sh`. Como `npm test` es el paso 4 de este mismo gate, engancharlos
ahí los pone en el camino crítico. Sin eso, los unitarios de `deploy.sh`
nacerían con el mismo problema: escritos, verdes el día que se escribieron, y
nunca más.

## Correcciones a `CLAUDE.md`

Este spec deja dos cosas del documento maestro desactualizadas, y hay que
corregirlas en el mismo ciclo:

1. **Dónde corren los smoke tests.** La línea que dice que corren contra
   `arandano-dev` contradice a otras tres que dicen `arandano-stage`, y es
   además imposible: el bloqueante 6 exige que dev esté abajo durante todo el
   deploy. Queda `arandano-stage`.
2. **Cuándo arranca la numeración.** Dice que `v1.0.0` llega "con el primer
   deploy que sirva a un tenant real". Pasa a ser el primer deploy que corra por
   el gate, por lo dicho en *Decisiones tomadas*.

También conviene anotar el orden corregido (ensayo en stage antes de migrar
prod) donde hoy figura el viejo.

## Fuera de alcance

Explícitamente, para que no se lea como olvido:

- **Los smoke tests de las pantallas que no existen.** Login, ventas,
  facturación contra homologación, órdenes de trabajo y catálogo público entran
  cuando exista el código que prueban.
- **Deploys a `arandano-dev`.** Dev corre `next dev` sobre el workspace; no hay
  imagen que promover.
- **Automatizar la ventana de deploy.** `CLAUDE.md` define que los deploys van
  temprano o de noche, hora Argentina. Es una regla operativa, no un chequeo del
  script: un gate que se niega por horario es un gate que alguien va a puentear
  el día que haya una urgencia real.
- **Notificaciones.** Sentry y el uptime check externo son su propio ciclo.
- **Rollback de la base de datos.** No existe y no va a existir: la defensa es
  expand/contract, verificada por el paso 2 del gate.
