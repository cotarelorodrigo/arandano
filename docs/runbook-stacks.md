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
- **`arandano-dev` se frena antes de que arranque el BUILD**, no antes de stage. La memoria no cierra de otra forma: prod (3200 MiB) + dev (2304) + el build (2048) + ~1.1 GB de sistema ≈ 8.5 GB sobre una caja de 7.6 GB. Con dev abajo el pico queda en ~7.5 GB, que es el número que documenta el presupuesto. Como el build es el primer paso del deploy y stage viene después, frenar dev al principio también cubre la regla vieja de que dev y stage no corren juntos (sus límites de CPU sumados pasan de un core: dev 0.75 + 0.25, stage 0.5 + 0.25). Se vuelve a levantar `arandano-dev` recién al terminar el deploy. `scripts/deploy.sh` ya hace esta secuencia solo, en su paso 6/16 y en el trap de limpieza — ver *Deploy y rollback* más abajo.
- Producción no se edita: se corre una imagen. Nada de editores en `/srv/arandano/prod/` — ese directorio sólo tiene `docker-compose.yml`, `.env`, el `Caddyfile` y los volúmenes, sin código fuente.
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

## `scripts/setup-host.sh`: la receta de reproducción de la máquina

Es el script que deja el VPS en el estado que estos stacks asumen: swap, Docker instalado desde el repo oficial, rotación de logs a nivel del daemon, `live-restore` y el slice `arandanobuild.slice` que capea los builds. Es **idempotente** — correrlo dos veces no rompe nada, cada paso chequea su propio estado antes de actuar — porque su razón de ser es poder reconstruir el servidor si se pierde, no sólo documentar cómo se armó una vez.

```bash
sudo scripts/setup-host.sh
```

## Verificar que la infra sigue sana

```bash
./scripts/verify-infra.sh all
```

Corre 54 checks en nueve suites (host, app, network, limits, build, isolation, env, logs, stress). Correrlo después de cada deploy — es lo que detecta que alguien aflojó un límite; acordarse no es un mecanismo.

Cada suite se puede correr sola pasándola por nombre (`./scripts/verify-infra.sh build`), que es lo práctico mientras se trabaja: `all` incluye la suite de estrés, y esa frena el Postgres de producción.

**Atención**: la suite de estrés **frena el Postgres de producción brevemente** para simular una caída y confirmar que dev no lo tumba por contención de recursos. Lo reinicia solo al terminar, y un `trap` cubre una interrupción a mitad de camino (Ctrl+C o `TERM`) para que Postgres no quede parado de forma indefinida. Aun así, quien lo corra tiene que saber que el script toca producción — no es sólo un chequeo de lectura, y no debería sorprender que `arandano-prod-postgres-1` aparezca detenido por unos segundos mientras corre.

**No correr dos instancias a la vez.** Los contenedores de prueba ya llevan nombre único por corrida (`arandano-logspam-$$`, `arandano-memhog-$$`, `arandano-cpuhog-$$`), así que dos corridas simultáneas ya no se pisan entre sí. Lo que sigue sin poder solaparse es la suite de estrés: **frena el Postgres de producción**, y dos corridas encimadas pueden dejar una parando la base justo cuando la otra da por sentado que está arriba.

## Deploy y rollback

```bash
scripts/deploy.sh                     # patch: fixes, refactors, migraciones aditivas
scripts/deploy.sh --minor             # minor: algo que el cliente ve
scripts/deploy.sh --objetivo=ensayo   # la secuencia completa, sin tocar prod
```

El script frena `arandano-dev` al arrancar (paso 6/16, antes del build — ver
la regla de arriba) y lo vuelve a levantar al terminar, pase lo que pase.
Toma un `flock`: si ya hay un deploy corriendo, **aborta** en vez de
saltearse la corrida — salir con 0 sin haber promovido es cómo alguien cree
que deployó algo que nunca deployó.

Los 16 pasos, en orden: working tree limpio → migraciones nuevas sin SQL
destructivo → `schema.prisma` sincronizado con las migraciones (shadow
database local, mismo patrón que `verify-backup.sh`) → `npm test` →
typecheck y lint → frenar `arandano-dev` → build de `arandano-app` y
`arandano-migrate` tageados con el SHA → levantar `arandano-stage` y ensayar
la migración → smoke tests contra stage → migraciones del repo == migraciones
del objetivo, en las dos direcciones → backup pre-migración → `migrate
deploy` contra el objetivo → promoción de la imagen → healthcheck con
comparación de SHA → tag de git (salteado con `--objetivo=ensayo`, que
tampoco pushea nada) → el trap vuelve a levantar `arandano-dev`. El chequeo
de schema (paso 3) corre con el `npx prisma` del propio repo, así que se
queda en el preflight en vez de esperar a que exista una imagen buildeada.

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
en el comentario del paso 13 de `scripts/deploy.sh`.

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

`arandano.app` hoy no resuelve — `dig arandano.app` devuelve NXDOMAIN, medido el 2026-08-07 (ver *Bloqueantes antes del cutover de DNS* en `CLAUDE.md`, punto 1, para qué falta confirmar antes de asumir que sólo falta apuntarlo) — así que el `Caddyfile` de prod sirve únicamente el host `localhost` con `tls internal` (certificado interno, no público). Cuando el DNS del dominio real apunte al servidor, el cutover es agregar un site block nuevo para el dominio con DNS-01, dejando el de `localhost` intacto para diagnóstico local — no reemplazar el bloque existente.
