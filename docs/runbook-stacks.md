# Runbook: los stacks

| Stack | Levantar | Escucha en |
|---|---|---|
| dev | `docker compose -f docker/compose.dev.yml up -d` | `http://100.64.81.63:3000` |
| stage | `IMAGE_TAG=<sha> docker compose -f docker/compose.stage.yml up -d` | `http://100.64.81.63:3001` |
| ensayo | `IMAGE_TAG=<sha> docker compose -f docker/compose.ensayo.yml up -d` | `http://100.64.81.63:3002` |
| prod | `cd /srv/arandano/prod && docker compose up -d` | `https://<ip-pública>` (hoy sólo `https://localhost`, ver más abajo) |

`arandano-ensayo` es descartable, igual que stage: existe únicamente para que
`scripts/deploy.sh --objetivo=ensayo` corra la secuencia completa del gate
—incluida la promoción— sin tocar clientes. Escucha sólo en la IP de
Tailscale, nunca en internet. Ver *Deploy y rollback* más abajo.

## Reglas

- **Cuidado con `down -v` desde el workspace.** Los cuatro compose declaran `name:`, así que `-f` solo ya resuelve el proyecto correcto y `-p` es redundante. El riesgo real es otro: `docker compose -f docker/compose.prod.yml down -v`, tipeado desde `/root/arandano`, apunta a **los volúmenes de producción** — `arandano-prod_pgdata` incluido. Es un archivo de dev que borra datos de clientes. Antes de cualquier `down -v`, mirar **qué compose** dice el `-f`, no desde qué directorio se está corriendo.
- **`arandano-dev` se frena antes de que arranque el BUILD**, no antes de stage. La memoria no cierra de otra forma: prod (3200 MiB) + dev (2304) + el build (2048) + ~1.1 GB de sistema ≈ 8.5 GB sobre una caja de 7.6 GB. Con dev abajo el pico queda en ~7.5 GB, que es el número que documenta el presupuesto. Como el build es el primer paso del deploy y stage viene después, frenar dev al principio también cubre la regla vieja de que dev y stage no corren juntos (sus límites de CPU sumados pasan de un core: dev 0.75 + 0.25, stage 0.5 + 0.25). Se vuelve a levantar `arandano-dev` recién al terminar el deploy. `scripts/deploy.sh` ya hace esta secuencia solo, en su paso 6/18 y en el trap de limpieza — ver *Deploy y rollback* más abajo.
- Producción no se edita: se corre una imagen. Nada de editores en `/srv/arandano/prod/` — ese directorio sólo tiene `docker-compose.yml`, `.env`, el `Caddyfile` y los volúmenes, sin código fuente.
- **El `.env` de cada stack necesita `ARANDANO_SALUD_TOKEN`** (generado con `openssl rand -hex 32`), además de las credenciales de la base: sin él `/api/health` responde sólo el veredicto, el gate no recibe `info.sha` y `deploy.sh` **aborta antes de buildear**. Es requisito duro desde el cutover, no una opción — quien reconstruya `/srv/arandano/prod` o `/srv/arandano/ensayo` tiene que ponerlo en el `.env` nuevo. Rotarlo: ver *Rotar el token del healthcheck* más abajo.
- **El `.env` de cada stack necesita `BETTER_AUTH_SECRET`** (generado con `openssl rand -hex 32`), desde el ciclo de autenticación: es con lo que Better Auth firma las cookies de sesión (`lib/auth/para-tenant.ts`). Distinto por stack, como toda credencial — si dev y prod compartieran el secreto, una cookie fabricada en dev valdría contra los datos de clientes. En dev va en `.env.dev`; en stage va inline en `docker/compose.stage.yml` (Postgres efímero, mismo criterio que sus otras credenciales inline); en ensayo y en prod llega por el `.env` de cada uno, igual que `ARANDANO_SALUD_TOKEN` — quien reconstruya `/srv/arandano/prod` o `/srv/arandano/ensayo` tiene que ponerlo ahí. `scripts/verify-infra.sh env` comprueba que exista en dev y en prod, y que no coincidan, pero esa suite no la corre `deploy.sh` — el requisito duro es el preflight de abajo. `deploy.sh` **aborta antes de buildear** si falta en el `.env` del objetivo (`secreto_auth_presente`, junto a `token_salud` — mismo momento, mismo motivo). Es requisito duro porque, sin este chequeo, nada más del gate lo detecta: el healthcheck mira Postgres, el rol y el tenant, no autenticación, y los smoke tests corren contra `arandano-stage`, que lo lleva inline en su compose y no en un `.env` — un `/srv/arandano/prod/.env` sin la línea hubiera promovido y tageado una release con TODAS las páginas de tenant en 500 (Better Auth tira error al construir cualquier instancia por tenant sin el secreto). Hallazgo de la review de Task 11 sobre el gate que la propia task había armado — la misma clase de trampa que ya describen los *Bloqueantes antes del cutover de DNS* de `CLAUDE.md`.
- **`PUERTO_PUBLICO` es el puerto con el que el navegador llega a cada stack**, y Better Auth lo necesita para armar su `baseURL` (`lib/auth/origen.ts`). Vale `3000` en dev, `3001` en stage y `3002` en ensayo — el mismo puerto que cada uno publica en `ports` — y en **producción queda SIN DEFINIR a propósito**: 443 es implícito en `https://`, y ponerle un default ahí rompería el `baseURL` de prod en silencio. Va directo en el `environment:` de cada `docker/compose.*.yml`, no en ningún `.env` — no es una credencial, es topología del stack.
- Buildear siempre con el presupuesto de recursos puesto (ver la sección de abajo — el comando importa, las banderas "obvias" no hacen nada):

  ```bash
  docker build \
    --cgroup-parent=arandanobuild.slice \
    --resource memory=2g --resource cpu-quota=100000 \
    --target runtime \
    --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
    -t arandano-app:$(git rev-parse --short HEAD) .
  ```

## `arandano-stage`: el Postgres es efímero por diseño

`arandano-stage` corre la imagen ya buildeada — nunca se rebuildea para esto — contra un Postgres propio en `tmpfs`, no contra la base de `arandano-dev`. Dos motivos:

- **Aislamiento**: la base de dev suele tener trabajo en curso; correr el smoke test ahí lo contaminaría (y viceversa).
- **Estado conocido**: cada corrida de stage arranca de una base vacía, que es justo lo que valida que una migración funcione de punta a punta, no que "funcione porque ya estaba parcialmente aplicada".

Se levanta pasando el tag de la imagen a probar — `IMAGE_TAG` es el SHA corto con el que se buildeó (no existe un tag `latest`: `IMAGE_TAG` es obligatorio, `compose.stage.yml` no arranca sin él). Por ejemplo, para probar la misma imagen que hoy corre en prod (`arandano-app:0acc47d`):

```bash
IMAGE_TAG=0acc47d docker compose -f docker/compose.stage.yml up -d
```

Y se tira abajo con `-v`, siempre — dejar el volumen vivo entre corridas contradice el propósito de arrancar de un estado conocido:

```bash
docker compose -f docker/compose.stage.yml -p arandano-stage down -v
```

Como el `tmpfs` vive en RAM, `down -v` no deja nada residual en disco; el estado desaparece apenas el contenedor se detiene.

## El presupuesto de recursos del build: qué anda y qué no

El build es el consumidor más grande del presupuesto (2 GiB y un core entero), corre en **cada deploy**, y compite con clientes reales sobre 2 vCPU. Las banderas que uno esperaría usar para capearlo **no hacen nada sobre esta máquina**, y lo peor es que fallan en silencio:

| Mecanismo | Qué pasa en realidad |
|---|---|
| `nice -n 15 docker build …` | Inerte. `nice` baja la prioridad del **cliente** de la CLI. El trabajo real lo corre BuildKit embebido dentro de `dockerd` (driver `docker`), así que los procesos del build heredan la prioridad de `dockerd`. |
| `docker build --cpuset-cpus=0 --memory=2g …` | Inerte. `docker build` hoy es `docker buildx build`, y su lista de banderas **no tiene** ni `--cpuset-cpus` ni `--memory`. Tampoco las rechaza: `docker build --cpuset-cpus=999 --memory=1 <ctx>` — 999 cores sobre una caja de 2, 1 byte de RAM — sale con **0** y sin un solo warning. |

Lo que sí ata, verificado leyendo el límite **desde adentro** de un build:

- `--resource memory=2g --resource cpu-quota=100000` fija el límite de cada contenedor de `RUN`.
- `--cgroup-parent=arandanobuild.slice` mete el árbol entero del build dentro del slice de systemd que crea `scripts/setup-host.sh`, que es el **techo agregado**: un multi-stage puede correr etapas en paralelo y, sin el slice, cada una se llevaría su propio `--resource` completo.

```
#5 [2/2] RUN echo "memory.max = $(cat /sys/fs/cgroup/memory.max)" && ...
#5 0.264 memory.max = 2147483648
#5 0.265 cpu.max    = 100000 100000
```

**El nombre del slice no lleva guiones a propósito.** systemd lee el guion como jerarquía: `arandano-build.slice` colgaría de `arandano.slice` y su cgroup real viviría en `/sys/fs/cgroup/arandano.slice/arandano-build.slice`, que **no** es la ruta que resuelve `--cgroup-parent=arandano-build.slice`. En ese caso Docker crea un cgroup crudo homónimo en el tope, sin ningún límite, y el build corre libre aparentando estar en el slice. Sin guion las dos rutas son la misma (`/sys/fs/cgroup/arandanobuild.slice`) y no hay ambigüedad posible.

Y por eso el slice va `enable`ado, no sólo `start`ado: si no está activo cuando arranca un build, Docker crea el cgroup igual y el build queda sin capar, sin avisar. `scripts/verify-infra.sh build` comprueba las dos mitades contra un build real, así que un slice caído se detecta en vez de suponerse.

## Buildear la imagen: `GIT_SHA` es obligatorio

La imagen se tagea con el SHA corto de git, y el Dockerfile falla el build si no se lo pasa — a propósito, no es un bug:

```bash
docker build \
  --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --target runtime \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  -t arandano-app:$(git rev-parse --short HEAD) .
```

Sin este argumento no hay forma de que `/api/health` reporte qué código está corriendo, y ese dato es el que distingue "la app respondió" de "la app que se esperaba respondió". `deploy.sh` también se niega a arrancar el build si el working tree está sucio (`git status --porcelain`, no `git diff` + `git diff --cached`: esos dos no ven archivos sin trackear, y una migración nunca `git add`eada es justo el caso que hay que frenar acá): buildear con cambios sin commitear tagea la imagen con un SHA que no describe lo que realmente contiene.

**`--target runtime` tampoco es opcional.** `docker build` sin `--target` buildea la **última** etapa del Dockerfile, no la que uno tiene en la cabeza. Cuando la etapa `migrate` quedó al final del archivo, este mismo comando produjo el CLI de Prisma —1,36 GB, con `ENTRYPOINT ["npx","prisma"]`— etiquetado como `arandano-app:<sha>` y listo para promoverse a producción. El Dockerfile ahora deja `runtime` último a propósito, pero las dos defensas van juntas: la de adentro se pierde en cuanto alguien agrega una etapa al final.

La imagen de migración sale del mismo SHA, con la otra etapa:

```bash
docker build \
  --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --target migrate \
  --build-arg GIT_SHA=$(git rev-parse --short HEAD) \
  -t arandano-migrate:$(git rev-parse --short HEAD) .
```

## Los dos roles de Postgres

La app **no** se conecta con el superusuario del stack. Hay dos roles, y la separación es lo que hace que las policias de RLS signifiquen algo — Postgres las ignora para un superusuario o para un rol con `BYPASSRLS`.

| Rol | Quién lo usa | Para qué |
|---|---|---|
| `arandano_owner` | La imagen `arandano-migrate`, vía `MIGRATE_DATABASE_URL` | Es dueño de las tablas y corre `prisma migrate deploy`. **Sin `CREATEDB` en producción**: `migrate deploy` no usa shadow database, así que sería privilegio regalado. |
| `arandano_app` | La app, vía `DATABASE_URL` | El único sobre el que las policies efectivamente aplican. No es dueño de ninguna tabla y no puede crearlas. |

El superusuario del stack (`POSTGRES_USER`) queda sólo para tareas administrativas: crear los roles y los backups.

`scripts/setup-db-roles.sh` los crea y **es idempotente** — se puede volver a correr sobre una base que ya los tiene, por ejemplo para rotar contraseñas. Contra dev o la base de tests alcanza el default; contra producción hay que pasarle la red, porque ese Postgres no publica ningún puerto al host:

```bash
set -a; . /srv/arandano/prod/.env; set +a
scripts/setup-db-roles.sh \
  --network=arandano-prod_default \
  --url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  --owner-password=... --app-password=...
```

Las contraseñas se generan con `openssl rand -hex`, no con `-base64`: el alfabeto base64 incluye `/` y `+`, que dentro de una URL de conexión rompen el parseo o se malinterpretan en silencio.

Que esto siga en pie lo verifica `scripts/verify-infra.sh roles`, y en producción el check `rol` de `/api/health`, que falla si la app quedó conectada como superusuario, con `BYPASSRLS` o como dueña de las tablas.

### El `EXECUTE` de una función nueva no es automático

Las tablas nuevas heredan privilegios vía `ALTER DEFAULT PRIVILEGES` (arriba),
pero las funciones no: es deliberado. Una función `SECURITY DEFINER` es
exactamente la superficie por la que la app lee lo que RLS le esconde a
propósito — la vía que SALTEA el aislamiento, no una que el aislamiento
proteja —, así que un default privilege que le diera `EXECUTE` a
`arandano_app` haría que toda función futura naciera ejecutable sin que nadie
lo decidiera: fallar abierto justo donde el resto del proyecto falla cerrado.

`scripts/setup-db-roles.sh` sólo hace los `REVOKE` generales; el `GRANT
EXECUTE` va **por nombre**, función por función, en un bloque `DO` al final
del script (hoy sólo `resolver_tenant`). **Quien agregue una función
`SECURITY DEFINER` nueva tiene que sumar su propia línea ahí.** Si no lo
hace, la app recibe `permission denied for function ...`.

Para `resolver_tenant` el gate SÍ lo atrapa antes de llegar a producción: el
paso 8 corre `setup-db-roles.sh` contra stage una segunda vez, después de
migrar, así que el `GRANT` por nombre ya está aplicado ahí; y el paso 9
corre los smoke tests, con `caso_check_tenant` exigiendo que el check
`tenant` del healthcheck esté en `ok` — ese check llama a
`resolver_tenant()` (`lib/health/checks.ts`), así que si el `GRANT` faltara
el gate moriría ahí mismo, en el paso 9 contra stage, mucho antes de tocar
el objetivo real. Lo que el gate **no** cubre es una función nueva que
todavía no esté ejercitada por ningún smoke test propio: para ésa, sin un
caso en `scripts/smoke.sh` que la llame, el primer síntoma de un `GRANT`
olvidado sí es el `permission denied` contra el objetivo real, porque
`setup-db-roles.sh` corre ahí recién en el paso 13 (después de la
migración) y nada anterior la ejercita.

El heredoc con ese SQL va **entre comillas** (`<<'EOF'`, no `<<EOF`). Con
comillas, bash no expande absolutamente nada de su contenido: ni variables,
ni comillas invertidas, ni `$(...)`. Sin ellas, cualquier backtick que
aparezca adentro —incluso dentro de un comentario SQL, no sólo en código— se
ejecuta como comando en el **host**, con los privilegios de este script. Ya
pasó una vez en este ciclo: un comentario que mencionaba `` `prisma migrate
dev` `` entre comillas invertidas hacía que bash intentara correr `prisma`
de verdad cada vez que el script corría.

## `scripts/setup-host.sh`: la receta de reproducción de la máquina

Es el script que deja el VPS en el estado que estos stacks asumen: swap, Docker instalado desde el repo oficial, rotación de logs a nivel del daemon, `live-restore` y el slice `arandanobuild.slice` que capea los builds. Es **idempotente** — correrlo dos veces no rompe nada, cada paso chequea su propio estado antes de actuar — porque su razón de ser es poder reconstruir el servidor si se pierde, no sólo documentar cómo se armó una vez.

```bash
sudo scripts/setup-host.sh
```

## Verificar que la infra sigue sana

```bash
./scripts/verify-infra.sh all
```

Corre once suites: host, app, network, limits, build, isolation, env, logs, stress, backup y roles. (Acá decía "54 checks en nueve suites": el número quedó viejo apenas se sumaron suites y checks, y nadie vuelve a contarlos — un total escrito a mano es un dato que miente en silencio. El total real lo imprime el propio script al terminar.) Correrlo después de cada deploy — es lo que detecta que alguien aflojó un límite; acordarse no es un mecanismo.

Cada suite se puede correr sola pasándola por nombre (`./scripts/verify-infra.sh build`), que es lo práctico mientras se trabaja: `all` incluye la suite de estrés, y esa frena el Postgres de producción.

**Atención**: la suite de estrés **frena el Postgres de producción brevemente** para simular una caída y confirmar que dev no lo tumba por contención de recursos. Lo reinicia solo al terminar, y un `trap` cubre una interrupción a mitad de camino (Ctrl+C o `TERM`) para que Postgres no quede parado de forma indefinida. Aun así, quien lo corra tiene que saber que el script toca producción — no es sólo un chequeo de lectura, y no debería sorprender que `arandano-prod-postgres-1` aparezca detenido por unos segundos mientras corre.

**No correr dos instancias a la vez.** Los contenedores de prueba ya llevan nombre único por corrida (`arandano-logspam-$$`, `arandano-memhog-$$`, `arandano-cpuhog-$$`), así que dos corridas simultáneas ya no se pisan entre sí. Lo que sigue sin poder solaparse es la suite de estrés: **frena el Postgres de producción**, y dos corridas encimadas pueden dejar una parando la base justo cuando la otra da por sentado que está arriba.

## Preparar `arandano-ensayo` desde cero

`scripts/deploy.sh --objetivo=ensayo` da por sentadas dos cosas que no
declara en ningún lado, y las dos se cobraron de verdad durante este ciclo:

1. **El stack objetivo ya está levantado.** El paso 10/18 corre `migrate
   status` con `docker run --network arandano-ensayo_default ...`. Si el
   stack no está arriba, esa red todavía no existe, y el gate muere ahí con
   `network arandano-ensayo_default not found` — **después** de haber
   frenado `arandano-dev` (paso 6), buildeado `arandano-app` y
   `arandano-migrate` (paso 7), ensayado la migración completa contra
   stage —roles, `migrate deploy`, alta del canario de stage— (paso 8) y
   corrido los smoke tests (paso 9). Nada de eso se revierte solo.
2. **Ese objetivo ya tiene los roles creados.** El mismo paso 10 se conecta
   como `arandano_owner` para correr `migrate status`, pero ese rol recién lo
   crea el paso 13 — que corre DESPUÉS. Contra un `arandano-ensayo` recién
   levantado, sin roles todavía (su Postgres vive en `tmpfs`, así que un
   `down -v` se los lleva puestos), el paso 10 falla igual, esta vez por
   autenticación en lugar de por red.

Dejarlo listo desde cero, antes de correr el gate:

```bash
IMAGE_TAG=<sha> docker compose -f docker/compose.ensayo.yml up -d

set -a; . /srv/arandano/ensayo/.env; set +a
OWNER_PASSWORD=$(echo "$MIGRATE_DATABASE_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')
APP_PASSWORD=$(echo "$DATABASE_URL" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')
scripts/setup-db-roles.sh --network=arandano-ensayo_default \
  --url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  --owner-password="$OWNER_PASSWORD" --app-password="$APP_PASSWORD"
```

`/srv/arandano/ensayo/.env` no tiene las contraseñas de `arandano_owner` ni
de `arandano_app` sueltas en variables propias — sólo dentro de
`MIGRATE_DATABASE_URL` y `DATABASE_URL` — así que hay que extraerlas de ahí
en vez de inventarlas. `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` sí
están sueltas: son las del superusuario del stack, que `env_file` le pasa al
contenedor de `postgres`. `setup-db-roles.sh` es idempotente, así que correr
esto contra un `arandano-ensayo` que ya tiene los roles no rompe nada — es
justo lo que hace el paso 13 del propio gate en cada corrida.

## Deploy y rollback

```bash
scripts/deploy.sh                     # patch: fixes, refactors, migraciones aditivas
scripts/deploy.sh --minor             # minor: algo que el cliente ve
scripts/deploy.sh --objetivo=ensayo   # la secuencia completa, sin tocar prod
```

El script frena `arandano-dev` al arrancar (paso 6/18, antes del build — ver
la regla de arriba) y lo vuelve a levantar al terminar, pase lo que pase.
Toma un `flock`: si ya hay un deploy corriendo, **aborta** en vez de
saltearse la corrida — salir con 0 sin haber promovido es cómo alguien cree
que deployó algo que nunca deployó.

Los 18 pasos, en orden: working tree limpio → migraciones nuevas sin SQL
destructivo → `schema.prisma` sincronizado con las migraciones (shadow
database local, mismo patrón que `verify-backup.sh`), el diagrama al día y —
sólo con `--objetivo=prod`— el `Caddyfile` de `/srv/arandano/prod` idéntico al
del repo → `npm test` →
typecheck y lint → frenar `arandano-dev` → build de `arandano-app` y
`arandano-migrate` tageados con el SHA → levantar `arandano-stage` y ensayar
la migración → smoke tests contra stage → migraciones del repo == migraciones
del objetivo, en las dos direcciones → backup pre-migración → `migrate
deploy` contra el objetivo → `setup-db-roles.sh` contra el objetivo (el
EXECUTE de las funciones se otorga por nombre, y esta corrida post-migración
es la que lo aplica — ver la Task 5c) → alta del tenant canario contra el
objetivo, tolerando que ya exista (Task 6: sin esto, el check de tenant del
healthcheck no tiene a qué canario apuntar la primera vez que se deploya
contra un objetivo nuevo) → promoción de la imagen → healthcheck
con comparación de SHA, y —sólo en `prod`— el `:80` respondiendo `308` → tag
de git (salteado con `--objetivo=ensayo`, que
tampoco pushea nada) → el trap vuelve a levantar `arandano-dev`. El chequeo
de schema (paso 3) corre con el `npx prisma` del propio repo, así que se
queda en el preflight en vez de esperar a que exista una imagen buildeada.

**Las dos afirmaciones sobre el `Caddyfile` (pasos 3 y 16) son la única
cobertura que el gate tiene del proxy.** Hasta el cutover, `URL_SALUD` entraba
por el bloque `:80`, así que un `:80` roto rompía el deploy: la configuración
de Caddy tenía cobertura *accidental*. Al rutear el gate por `localhost:443`
esa cobertura desapareció, y el `Caddyfile` quedó siendo la única parte de la
configuración de producción que se entrega a mano y que el gate ya no veía —
alguien podía volver el `:80` a `reverse_proxy app:3000` y todos los deploys
siguientes reportaban 18/18 en verde mientras producción servía la app en texto
plano. El paso 3 compara el **archivo** (`diff` contra el repo, aborta y no
toca nada) y el paso 16 comprueba el **comportamiento** (el `308`), porque un
`cp` sin `caddy reload` deja el archivo bien y el proxy mal. Van adentro de esos
pasos y no como pasos nuevos para no renumerar dieciocho pasos y sus referencias
cruzadas — mismo criterio que ya tenía el diagrama dentro del paso 3.

**Cambiar `docker/Caddyfile` obliga a copiarlo a `/srv/arandano/prod`**, en la
misma sesión y no "después": desde que existe el paso 3, un `Caddyfile` del repo
que difiera del de producción **aborta todo deploy de prod**, incluido un
hotfix. La copia es manual a propósito (producción no es un checkout), y el
`reload` es la mitad que se olvida:

```bash
cp docker/Caddyfile /srv/arandano/prod/Caddyfile
( cd /srv/arandano/prod && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile )
./scripts/verify-infra.sh network   # el 308 y el certificado, ya recargados
./scripts/verify-infra.sh env       # que el archivo copiado sea igual al del repo
```

**El canario es dato de producción load-bearing, no un dato de prueba
descartable.** Desde que el check `tenant` del healthcheck existe (Task 6),
el paso 14 da de alta (o confirma que ya existe) un tenant con subdominio
`canario` contra el objetivo real en cada deploy, y el healthcheck lo
resuelve por ese subdominio exacto en cada request. Borrar esa fila o
renombrar su `subdominio` a mano —desde Prisma Studio, un `UPDATE` suelto,
lo que sea— hace que el check de tenant falle: la app entera pasa a
`degraded`, el healthcheck responde 503, y eso dispara tanto el rollback
automático del PRÓXIMO deploy (que no encuentra el canario y revierte un
código sano) como el uptime check externo. Si algún día hace falta borrar o
renombrar el canario a propósito, hacerlo en el mismo deploy que actualiza
`TENANT_CANARIO_SUBDOMINIO` en los `docker/compose.*.yml` — nunca por
separado.

**Tres zonas de fallo.** Hasta `migrate deploy` inclusive, una falla aborta y no
hay nada que revertir: producción sigue con su imagen anterior, y si la
migración llegó a correr, el schema nuevo con el código viejo es un estado
compatible por construcción (expand/contract). Desde la promoción, una falla
dispara el rollback automático. La creación del tag es la excepción: si falla,
producción ya está sana y **no** se rollbackea.

**Códigos de salida** — lo primero que conviene mirar a las 11 de la noche,
porque cada uno dice algo distinto sobre qué le pasó a producción (ver
`scripts/deploy.sh --help` para el texto completo):

| Código | Significado | ¿Tocó el objetivo? |
|---|---|---|
| `0` | Deploy ok, sin nada pendiente. | Sí — imagen nueva, sana, tageada. |
| `1` | Abortó en los pasos 1-12, antes de tocar el objetivo. | No — nada que revisar ahí. |
| `2` | Uso inválido (argumentos). | No. |
| `3` | El rollback automático **también** falló. | Indeterminado — el peor caso; el script imprime qué imagen corría, a cuál intentó volver y qué comando correr. Atención manual inmediata. |
| `4` | El objetivo quedó sirviendo la imagen **nueva y sana**, pero el tag de git no se pudo crear o pushear. | Sí, correctamente — sólo el tag queda pendiente, no dispara rollback. |
| `5` | Rollbackeó con éxito. | Sí — terminó sirviendo la imagen **anterior**, sana. |
| `6` | El deploy salió bien, pero la **limpieza de la máquina** falló: `arandano-dev` no volvió a levantar, `arandano-stage` quedó arriba, o las dos. | Sí, correctamente — el objetivo sirve la imagen nueva y sana; lo roto es el entorno de trabajo del servidor. |
| `130` / `143` | Interrumpido por señal (Ctrl-C / `TERM`). Frena donde estaba y corre la limpieza igual. | Depende de qué paso lo agarró — el log dice cuál fue el último. |

`1` y `5` dejan las dos al objetivo intacto, pero son mañanas distintas: "no
pasó nada" contra "se migró, se promovió y se revirtió solo". `4` y `6` son la
otra distinción que importa: en las dos el objetivo está bien y lo que falta es
otra cosa, pero se arreglan distinto — el `4` con un `git push origin <tag>`, el
`6` con un `docker compose -f docker/compose.dev.yml up -d --wait` (o bajando
`arandano-stage`) en el servidor. Por eso son códigos distintos y no uno solo:
un código compartido obliga a leer el log para saber cuál de las dos cosas hacer.

Que `6` exista es un arreglo, no un detalle: hasta la revisión final de la rama
ese caso salía `1`, o sea el código documentado como "abortó sin tocar el
objetivo, nada pasó" — con producción sirviendo código nuevo bajo un tag nuevo,
porque la limpieza corre **después** de la promoción, el healthcheck y el tag.

**`--no-deps` en la promoción y en el rollback no es una optimización, es
obligatorio — no sacarlo.** Sin él, `docker compose up -d --force-recreate
app` recrea también el contenedor de Postgres. La causa **no** es
`--force-recreate`: es que `postgres` y `app` comparten el mismo `env_file:
.env`, así que reescribir `IMAGE_TAG` para promover cambia el entorno
*computado* de postgres, Compose lo ve driftado respecto del contenedor vivo,
y lo recrea al pasar por él como dependencia de `app`. En producción eso
reinicia la base de los clientes en cada deploy sin ninguna necesidad — una
promoción cambia la imagen de la app, no la de la base. El detalle completo,
con las cuatro mediciones que descartan `--force-recreate` como causa, está
en el comentario del paso 15 de `scripts/deploy.sh`.

**Rollback a mano**, para lo que el healthcheck no ve:

```bash
scripts/rollback.sh            # al anteúltimo tag
scripts/rollback.sh --a=<sha>  # a una imagen concreta
```

No toca la base de datos. Nunca. Por eso el gate se niega ante una migración
destructiva: si el schema nuevo no soporta el código viejo, revertir la imagen
no alcanza.

**El hook de pre-commit** frena una migración destructiva antes de que entre al
repo. Se activa con `git config core.hooksPath .githooks`, que ya está en
`scripts/setup-host.sh`. Es una red temprana, no la definitiva — sólo cubre
migraciones destructivas, no los otros chequeos del gate — y `deploy.sh`
vuelve a chequear lo mismo porque `--no-verify` existe.

### Rotar el token del healthcheck

`ARANDANO_SALUD_TOKEN` habilita el nivel detallado de `/api/health` — los
checks con su detalle y el `sha`. Sin él, el endpoint devuelve sólo el
veredicto, y `deploy.sh` no puede comparar el sha contra la imagen que
promovió.

```bash
source /root/arandano/scripts/lib/deploy-comun.sh
ENV=/srv/arandano/prod/.env

# 0. El guard, y no es opcional: un `sed -i "s/^ARANDANO_SALUD_TOKEN=.*/.../"`
#    sobre un archivo que NO tiene esa línea es un no-op silencioso con salida
#    0. Sin este grep, el paso 1 no cambia nada, el 2 recrea la app con el
#    token VIEJO y el 3 la verifica leyendo el mismo archivo sin cambiar: sale
#    todo bien y el token filtrado sigue vigente. Es el mismo modo de falla
#    contra el que `scripts/rollback.sh` se protege antes de su propio `sed`
#    sobre `IMAGE_TAG`.
grep -q '^ARANDANO_SALUD_TOKEN=' "$ENV" || {
  echo "ERROR: $ENV no tiene una línea ARANDANO_SALUD_TOKEN=; agregarla a mano antes de rotar" >&2
  return 1 2>/dev/null || exit 1
}

# 1. Guardar el valor ANTERIOR y reemplazarlo
ANTES=$(token_salud /srv/arandano/prod)
sed -i "s/^ARANDANO_SALUD_TOKEN=.*/ARANDANO_SALUD_TOKEN=$(openssl rand -hex 32)/" "$ENV"

# 2. Recrear la app para que lo tome (env_file se lee al arrancar)
( cd /srv/arandano/prod && docker compose up -d --no-deps --force-recreate app )

# 3. Comprobar que el token CAMBIÓ y que el nivel detallado sigue respondiendo
#    con el nuevo. Comparar antes/después es lo que distingue "roté" de "leí
#    dos veces el mismo archivo": pedir sólo el detalle responde igual de bien
#    con el token viejo intacto.
DESPUES=$(token_salud /srv/arandano/prod)
[ "$ANTES" != "$DESPUES" ] && echo "ok: el token cambió" || echo "ERROR: el token NO cambió"
CA=$(mktemp -p /var/tmp ca.XXXXXX)
extraer_ca_caddy /srv/arandano/prod "$CA"
consultar_salud https://localhost "$DESPUES" "$CA" | head -c 120
rm -f "$CA"
unset ANTES DESPUES
```

Los valores no se imprimen en ningún paso — se comparan. Y `unset` al final,
para no dejar el token viejo y el nuevo colgados en la shell de quien rotó.

No hace falta tocar el uptime check externo: monitorea con el nivel anónimo, a
propósito, para que rotar este token no lo ponga en rojo. El token de stage
(`efimero-salud`) no se rota: vive en claro en `docker/compose.stage.yml` y en
`scripts/deploy.sh` porque ese stack es efímero y nunca ve datos de clientes.

### Rotar el token de Hetzner DNS

`HETZNER_DNS_TOKEN` es con lo que Caddy resuelve el desafío DNS-01 que emite y
**renueva** el wildcard `*.arandano.app`. Si queda inválido no pasa nada visible
hasta que toque renovar; ahí el certificado vence y todo cliente ve un TLS roto.

Ojo con el alcance: es un token de la **Cloud API de Hetzner**, que se emite a
nivel de proyecto y **no se puede acotar a una zona**. Quien lo tenga puede
tocar todo el DNS de la cuenta.

```bash
ENV=/srv/arandano/prod/.env

# 0. El mismo guard que la rotación del token de salud, por el mismo motivo: un
#    sed sobre un archivo sin esa línea es un no-op silencioso con salida 0, y
#    los pasos siguientes "andarían" con el token viejo.
grep -q '^HETZNER_DNS_TOKEN=' "$ENV" || {
  echo "ERROR: $ENV no tiene una línea HETZNER_DNS_TOKEN=; agregarla a mano antes de rotar" >&2
  exit 1
}

# 1. Generar el token nuevo en la consola de Hetzner (Security → API tokens,
#    permisos de lectura y escritura) y reemplazar la línea. No se imprime.
sed -i "s|^HETZNER_DNS_TOKEN=.*|HETZNER_DNS_TOKEN=EL_NUEVO|" "$ENV"

# 2. Recrear Caddy: env_file se lee al arrancar el contenedor, no en caliente.
( cd /srv/arandano/prod && docker compose up -d --no-deps --force-recreate caddy )

# 3. Forzar una emisión para probar el token de verdad. Recrear el contenedor NO
#    alcanza: con el certificado vigente Caddy no tiene motivo para pedir otro,
#    así que un token roto no se nota hasta la renovación. Hay que borrar el
#    certificado del almacén — es el mismo mecanismo que el cutover necesitó
#    para pasar del emisor de staging al de producción.
( cd /srv/arandano/prod && docker compose exec -T caddy \
    tar -cf - -C /data/caddy certificates > /var/tmp/caddy-certs-previos.tar )
( cd /srv/arandano/prod && docker compose exec -T caddy \
    rm -rf /data/caddy/certificates/acme-v02.api.letsencrypt.org-directory )
( cd /srv/arandano/prod && docker compose restart caddy )

# 4. Verificar contra las CA públicas, que es lo que ve un cliente.
./scripts/verify-infra.sh network
```

**Al leer el log de Caddy, mirá el campo `"level"` y no la palabra `error`**:
Caddy emite líneas `"level":"info"` que *contienen* un campo `error` explicando
por qué crea la cuenta ACME. Filtrar por la palabra da un falso rojo.

Y **borrá el token viejo en la consola de Hetzner**, no sólo del archivo: sacarlo
del `.env` deja de usarlo, no lo invalida.

### Rebuildear la imagen de Caddy

Hace falta cuando sale una versión nueva de Caddy o del módulo de DNS. No la
buildea `deploy.sh`: el proxy no cambia con cada commit de la aplicación, y
tagearlo con el SHA de git diría un SHA que no tiene nada que ver con el proxy.

```bash
# 1. Cambiar readonly CADDY_VERSION en scripts/build-caddy.sh
# 2. Buildear (el script verifica solo que la imagen traiga dns.providers.hetzner)
./scripts/build-caddy.sh
```

**Actualizá el tag de `image:` en `docker/compose.prod.yml` en el MISMO commit.**
`verify-infra.sh network` compara el tag del compose contra el que produce
`build-caddy.sh`, así que si difieren el deploy aborta — que es lo que se quiere,
pero es una tarde perdida si te enterás en el paso 3 del gate.

El `/v2` del módulo tampoco es opcional: `caddy-dns/hetzner` sin sufijo resuelve
a la v1, que habla contra la API de Hetzner DNS que ya está de baja. Con la v1
compilada adentro el build **sale bien** y el módulo aparece igual en
`caddy list-modules` —el id del módulo no cambió entre versiones—, así que la
imagen mala es indistinguible de la buena hasta que falla una emisión.

## El diagrama de la base

`docs/schema.md` es **generado**, no escrito. Se regenera con:

```bash
scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md
```

No editarlo a mano: la próxima regeneración se lleva el cambio puesto. Si hace
falta explicar algo que el diagrama no dice, el lugar es el spec del schema del
núcleo, que es donde está el modelo de aislamiento.

**Sale del DDL que produce `prisma migrate diff`, no del schema.** Por eso los
nombres y los tipos son los de Postgres (`tenant_modules`, `timestamptz(3)`) y
no los de Prisma: el documento describe la base, y se genera de lo que
efectivamente la crea. `migrate diff --from-empty` no necesita ninguna base de
datos y tarda alrededor de un segundo y medio.

Se verifica en dos lugares, así que no puede quedar desactualizado en silencio:
el hook de pre-commit cuando el commit toca el schema o el propio diagrama, y el
paso 3 de `deploy.sh` siempre. Los dos imprimen el diff y el comando para
regenerar. El hook compara el contenido **stageado** contra el stageado — si
comparara el del disco, regenerar y hacer `git add` sólo del schema pasaría el
chequeo.

**Lo que el diagrama no muestra son las policies de RLS.** Viven en el SQL
escrito a mano de las migraciones, no en el schema, así que `migrate diff` no
las emite — y son justamente lo que aísla un tenant de otro.

## Certificado de producción, hoy

Desde el 2026-08-10 el `Caddyfile` de prod tiene **dos** site blocks, y la
distinción importa cada vez que alguien diagnostica un problema de TLS:

- `arandano.app, *.arandano.app` — el que ven los clientes. Certificado wildcard
  de Let's Encrypt, emitido y renovado por DNS-01 contra Hetzner.
- `localhost:443` — con `tls internal`, o sea la CA **interna** de Caddy. Es por
  donde entra el poll del healthcheck de `deploy.sh` y `rollback.sh`, y se dejó a
  propósito: un gate que dependa del DNS público y de una CA pública se bloquea
  por causas ajenas al código.

**Que `localhost` valide no dice nada sobre el certificado de los clientes.** Son
site blocks distintos con CA distintas. Por eso el gate tiene además los dos
chequeos contra el hostname real con las CA públicas — ver el punto 1 de
*Bloqueantes antes del cutover de DNS* en `CLAUDE.md`.

Para mirar el certificado que recibe un cliente, sin depender del DNS público:

```bash
curl -sI --resolve arandano.app:443:127.0.0.1 https://arandano.app/ | head -1
curl -s -o /dev/null -w 'ssl_verify=%{ssl_verify_result}\n' \
  --resolve canario.arandano.app:443:127.0.0.1 https://canario.arandano.app/
```

Un `ssl_verify=0` sin `-k` ni `--cacert` es lo único equivalente a lo que hace un
navegador.

## Tenants y subdominios

Desde el 2026-08-08 la aplicación resuelve el tenant del header `Host` contra
`DOMINIO_BASE`, que cada compose fija: `arandano.app` en prod,
`dev.arandano.app` en dev, `stage.arandano.app` en stage y ensayo.

### La IP pelada dejó de servir la app

`http://100.64.81.63:3000` ahora responde **404**, y es correcto: ese host no
termina en `dev.arandano.app`, así que es un dominio ajeno. No hay —ni va a
haber— un camino de resolución exclusivo de dev; un atajo así se filtra a
producción y ahí es una forma de suplantar tenants.

### Llegar a un tenant desde la terminal

No hace falta DNS:

```bash
curl -H 'Host: canario.dev.arandano.app' http://100.64.81.63:3000/
```

### Llegar a un tenant desde el navegador

Ahí sí hace falta que el nombre resuelva. En el `/etc/hosts` de tu máquina:

```
100.64.81.63  canario.dev.arandano.app
```

Los archivos hosts no tienen wildcards, así que va una línea por subdominio de
prueba. Con dos o tres alcanza. Se evaluó `sslip.io` para tener el wildcard
gratis y se descartó: `100.64.81.63` está en el rango CGNAT, que muchos
resolvers filtran por protección de rebinding, y fallaría de forma intermitente.

### Crear un tenant

`MIGRATE_DATABASE_URL` sale de `.env.dev` porque el alta corre como
`arandano_owner`, igual que las migraciones — la aplicación nunca crea tenants.

**Ojo con el host.** `.env.dev` trae `MIGRATE_DATABASE_URL` apuntando a
`@postgres:5432` — el nombre de servicio de Compose, que sólo resuelve DESDE
DENTRO de la red de `arandano-dev`, nunca desde el host. Corriendo esto en el
VPS (fuera de un contenedor), hay que reescribirlo a la IP de Tailscale y el
puerto que dev publica para Postgres, `@100.64.81.63:5433`
(`docker/compose.dev.yml`, servicio `postgres` — no confundir con el `3000`
de la tabla del principio, que es el de la app):

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL .env.dev | cut -d= -f2- | sed 's/@postgres:5432/@100.64.81.63:5433/')" \
DOMINIO_BASE=dev.arandano.app \
  npm run tenant:crear -- --subdominio=flor --nombre="Flor Celulares" \
    --modulos=ORDENES_DE_TRABAJO --duenio=flor@ejemplo.com --duenio-nombre="Flor"
```

El dueño se crea sin contraseña: `tenant:crear` corre como `arandano_owner`,
con `pg` pelado, y no tiene de dónde sacar un hash en el formato correcto que
Better Auth después pueda verificar. Definirla es el paso siguiente.

### Definir la contraseña de un usuario

`npm run usuario:clave` es el que lo hace — corre como la aplicación
(`DATABASE_URL`, o sea `arandano_app`) y pasa por la API de Better Auth, así
que también pasa por RLS. Es además el recupero del dueño: mientras no haya
proveedor de mail, no hay otro camino para resetear una contraseña olvidada
más que correr este mismo comando de nuevo.

```bash
DATABASE_URL="$(grep -m1 ^DATABASE_URL .env.dev | cut -d= -f2- | sed 's/@postgres:5432/@100.64.81.63:5433/')" \
BETTER_AUTH_SECRET="$(grep -m1 BETTER_AUTH_SECRET .env.dev | cut -d= -f2-)" \
DOMINIO_BASE=dev.arandano.app \
  npm run usuario:clave -- --subdominio=flor --email=flor@ejemplo.com
```

Sin `--clave`, genera una al azar y la imprime junto con la URL de login.
**La contraseña se imprime una sola vez y no se guarda en ningún lado** — es
el único momento en que existe en texto plano. Si se pierde, el camino no es
buscarla: es correr el comando de nuevo.

#### En producción (y en ensayo), desde la imagen de migración

El bloque de arriba es el de **dev**, y en producción no sirve: el Postgres de
prod **no publica puertos**, así que desde el host no se le llega, y el
workspace del repo no es lo que corre ahí (`/srv/arandano/prod/` no tiene
código). El único camino es el mismo que ya usa `deploy.sh` para el alta del
canario: correr el comando **adentro de `arandano-migrate:<sha>`**, enganchado
a la red del stack.

```bash
# El SHA que está corriendo, leído del contenedor mismo: la imagen de
# migración se buildea con el mismo tag que la de la app.
SHA=$(docker inspect --format '{{.Config.Image}}' arandano-prod-app-1 | cut -d: -f2)
docker run --rm --network arandano-prod_default \
  -e DATABASE_URL="$(grep -m1 ^DATABASE_URL /srv/arandano/prod/.env | cut -d= -f2-)" \
  -e BETTER_AUTH_SECRET="$(grep -m1 ^BETTER_AUTH_SECRET /srv/arandano/prod/.env | cut -d= -f2-)" \
  -e DOMINIO_BASE=arandano.app \
  --entrypoint npx "arandano-migrate:$SHA" \
  tsx scripts/definir-clave.mts --subdominio=flor --email=flor@ejemplo.com
```

`--entrypoint npx` porque el ENTRYPOINT de esa imagen es `npx prisma` (mismo
patrón que los pasos 8 y 14 de `deploy.sh`), y `DATABASE_URL` —no
`MIGRATE_DATABASE_URL`— porque este comando corre **como la aplicación**, o sea
pasando por RLS. El host de la URL que hay en `/srv/arandano/prod/.env` ya es
el nombre del servicio (`@postgres:5432`), que es exactamente lo que resuelve
desde adentro de esa red: acá no hay que reescribirlo como en dev.

**Esto recién funciona desde el ciclo de autenticación.** La etapa `migrate`
del Dockerfile no corría `prisma generate` y `.dockerignore` excluye
`generated`, así que la imagen que el deploy ya usaba para `crear-tenant.mts`
—que evita Prisma a propósito— **no podía correr `definir-clave.mts`**, que sí
lo arrastra vía `lib/db.ts`. Es el hallazgo de Task 11 una capa más afuera: el
comando andaba para quien escribe el código y no para quien opera el producto,
incluido el **tenant canario** que el deploy crea en producción y que
CLAUDE.md manda verificar a mano después de cada deploy. El arreglo es un
`RUN npx prisma generate` en esa etapa, y está verificado del modo en que hay
que verificar estas cosas: buildeando la imagen y corriendo el comando adentro,
contra una base con las migraciones aplicadas, hasta comprobar que la clave
que puso **entra de verdad** por la misma API que usa el login.

**Corre con `tsx`, no con `node` pelado — y esto no es un detalle menor.**
`tenant:crear` y `usuario:clave` (`package.json`) invocan
`tsx scripts/<archivo>.mts` desde el ciclo de autenticación (Task 11).
Hasta esa task, los dos corrían con
`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON`, y `usuario:clave`
**no llegaba a ejecutarse nunca**: `lib/auth/para-tenant.ts` importa
`@/lib/tenant/prisma` con el alias de `tsconfig.json`, que `node` pelado no
resuelve — sale con `ERR_MODULE_NOT_FOUND` antes de tocar la base, para
CUALQUIER invocación. Reescribir esa línea a una ruta relativa con extensión
no alcanzaba: un nivel más adentro, el cliente de Prisma generado
(`generated/prisma/client.ts`) usa imports relativos SIN extensión
(`./enums`, `./internal/class`) — válidos para un bundler
(webpack/turbopack/Vite, que es como corren tanto Next como `vitest`) pero
inválidos para la resolución ESM nativa de Node. Ésa es la razón de
`importFileExtension = ""` en `prisma/schema.prisma`: es **load-bearing para
la aplicación** (el comentario del propio schema lo dice) y no es la pieza
que había que tocar. `tenant:crear` nunca tuvo este problema porque
deliberadamente evita Prisma y usa `pg` pelado (ver el comentario de
cabecera de `scripts/crear-tenant.mts`); `definir-clave.mts` necesita la API
de Better Auth para calcular el hash con el algoritmo correcto, así que no
podía evitar el mismo camino. La salida fue sumar `tsx` (`devDependency`) como
runner de los dos: resuelve los `paths` de `tsconfig.json` y los imports sin
extensión sin pelearle a la configuración de Prisma. Se evaluó `vite-node`
como alternativa —reutilizaría la misma resolución que ya usa `vitest.config.mts`—
y se descartó: sin un `--config` explícito no resuelve el alias tampoco, y
apuntándolo al `vitest.config.mts` del repo el binario corre pero no hace
NADA — el guard `import.meta.url === file://${process.argv[1]}` que los dos
scripts usan para saber que los invocaron como programa (y no como módulo
importado por un test) nunca se cumple bajo `vite-node`, así que sale con
código 0 sin haber tocado la base. `tsx` no tiene ninguno de los dos
problemas, sin configuración adicional.

**La lección, no sólo el parche.** `definirClave` (la función) está probada
bajo vitest en `test/auth.test.ts` desde que existe, y vitest resuelve `@/`
con su propio `resolve.alias` (`vitest.config.mts`) — así que esa cobertura
nunca podía notar que el BINARIO, invocado con el runner real, no llegaba a
ejecutarse. Nadie lo había corrido como comando hasta la verificación manual
de Task 11. Por eso ahora hay un test que sí lo hace, por cada uno de los dos
scripts: `scripts/definir-clave.binario.test.ts` y la sección "el binario"
de `scripts/crear-tenant.test.ts` spawnean el comando real
(`npx tsx scripts/<archivo>.mts ...`) como proceso hijo contra la base
efímera de test, y comprueban el efecto — que la clave puesta por el binario
sirve para entrar de verdad, con la misma API que usa el login — y no sólo
que el proceso salió con código 0. Cada uno suma además el camino de error:
un usuario o un subdominio que no existe tiene que salir con código distinto
de cero y un mensaje legible en `stderr`, nunca un stack trace de resolución
de módulos — que es exactamente el síntoma que este hallazgo tenía y que
antes no hacía fallar ningún test.

### El tenant canario

Es el tenant al que apunta el check `tenant` del healthcheck, y se identifica
con `TENANT_CANARIO_SUBDOMINIO` (vale `canario` en los cuatro stacks). El check
no se conforma con que una query filtrada devuelva datos —eso pasa igual con RLS
apagado—: comprueba que con el `tenant_id` del canario la base devuelva 1 fila
de `tenants` y con uno inventado devuelva 0.

- En **stage** lo crea `deploy.sh` solo, dentro del paso 8, contra la base
  efímera — nace de nuevo en cada corrida.
- En **ensayo** y en **prod** lo crea el paso 14/18, contra el objetivo real,
  tolerando que ya exista (ver *Preparar `arandano-ensayo` desde cero* más
  arriba para las dos precondiciones que ese paso da por sentadas). Es
  justamente lo que evita el escenario que motivó agregarlo (Task 6): sin
  este paso, el primer deploy que promoviera el check de tenant migraba,
  otorgaba y promovía sin que nada hubiera creado el canario contra el
  objetivo real, y el healthcheck (paso 16) fallaba con "el tenant canario
  no existe en esta base" — rollback automático de un deploy sano. Con el
  paso 14 en el gate, ni ensayo ni prod necesitan un alta manual previa,
  ni siquiera en el primer deploy que introduce el check.
- En **dev** sí hay que crearlo a mano, una vez, con el comando de arriba
  (con `--subdominio=canario` en vez de `flor`): `deploy.sh` nunca corre
  contra dev, así que ningún paso automático lo va a crear ahí.

**La fila del canario es dato de producción load-bearing, no un dato de
prueba descartable.** Detalle completo, y por qué no se puede borrar ni
renombrar por fuera de un deploy, en *Deploy y rollback* más arriba.
