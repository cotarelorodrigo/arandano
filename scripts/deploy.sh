#!/usr/bin/env bash
# El gate de deploy. Ver docs/superpowers/specs/2026-08-06-deploy-design.md.
#
# Sin feature flags, este script, el healthcheck y el rollback son la ÚNICA red
# entre un error y todos los clientes a la vez. Un paso decorativo acá no es un
# gate incompleto: es un gate que miente.
#
# Este script ORQUESTA y no decide: toda la lógica que decide algo vive en
# scripts/lib/deploy-comun.sh, con unitarios que corren sin Docker.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/deploy-comun.sh

TIPO_VERSION=patch
OBJETIVO=prod

uso() {
  cat >&2 <<'EOF'
uso: deploy.sh [--minor] [--objetivo=prod|ensayo]

  --minor     sube MINOR en vez de PATCH. MINOR es para lo que el cliente ve
              (pantalla nueva, módulo, feature); PATCH para todo lo demás.
  --objetivo  prod (default) o ensayo. Con ensayo corre la secuencia completa
              contra el stack descartable, sin tagear ni pushear.

códigos de salida — lo primero que conviene mirar en un cron o un CI:
  0  deploy ok, sin nada pendiente.
  1  abortó SIN tocar el objetivo (pasos 1-12): nada pasó, no hay nada que
     revisar en el objetivo mismo.
  2  uso inválido (argumentos).
  3  el rollback automático TAMBIÉN falló. El peor caso: puede hacer falta
     atención manual inmediata — ver el bloque que imprime qué imagen corría,
     a cuál intentó volver y qué comando correr.
  4  el objetivo quedó sirviendo la imagen NUEVA y sana, pero el tag de git
     no se pudo crear o pushear — pendiente, no dispara rollback.
  5  rollbackeó con éxito: el objetivo terminó sirviendo la imagen ANTERIOR,
     sana. Distinto de 1 a propósito — "no pasó nada" y "se migró, se
     promovió y se revirtió solo" son mañanas distintas, aunque las dos
     dejen al objetivo intacto.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --minor)      TIPO_VERSION=minor ;;
    --objetivo=*)
      OBJETIVO="${arg#*=}"
      # --objetivo= (vacío) no es lo mismo que omitir el flag: omitido, el
      # default sigue siendo "prod". Vacío quedaría indistinguible de eso y el
      # case de abajo lo rechazaría con "objetivo inválido: " en blanco, sin
      # decir que el problema es el flag vacío. Mismo guard que --a= en
      # rollback.sh, por el mismo motivo.
      [[ -n "$OBJETIVO" ]] || { error "--objetivo necesita un valor (prod o ensayo); vino vacío"; uso; }
      ;;
    -h|--help)    uso ;;
    *) error "argumento desconocido: $arg"; uso ;;
  esac
done

case "$OBJETIVO" in
  prod)   DIR=/srv/arandano/prod;   URL_SALUD=http://127.0.0.1;            TAGEA=true ;;
  ensayo) DIR=/srv/arandano/ensayo; URL_SALUD=http://100.64.81.63:3002;    TAGEA=false ;;
  *) error "objetivo inválido: $OBJETIVO"; uso ;;
esac

# Un solo deploy a la vez. A diferencia de backup.sh, que ante un lock tomado se
# saltea la corrida y sale con 0, acá se ABORTA: saltearse un deploy en silencio
# y devolver éxito es cómo alguien termina creyendo que promovió algo que nunca
# promovió.
#
# El fd 9 queda abierto durante TODO el script: eso es lo que mantiene el lock
# tomado. Pero un fd abierto con `exec` se hereda por cualquier hijo que este
# script lance (npm, npx, docker...) salvo que se cierre a propósito. Si algún
# hijo dejara un proceso huérfano vivo más allá de este script (un worker de
# vitest o de eslint mal reapeado, por ejemplo), ese huérfano se queda con el
# fd abierto y el lock nunca se libera del todo — la próxima corrida se niega
# con "ya hay un deploy corriendo" sin que haya nada corriendo de verdad. Por
# eso los comandos largos de acá para abajo lo cierran con `9>&-` explícito.
exec 9>/var/lock/arandano-deploy.lock
if ! flock -n 9; then
  error "ya hay un deploy corriendo"
  exit 1
fi

DEV_FRENADA=false

# Nombre y flag de la shadow database del paso 3, declarados ACÁ y no en el
# paso mismo: el trap corre pase lo que pase, incluida una señal a mitad del
# paso 3, y necesita poder nombrarla y saber si está viva sin importar en qué
# punto del script haya sido interrumpido.
SOMBRA=arandano-deploy-sombra
SOMBRA_ACTIVA=false

# Corre pase lo que pase, y preserva el código de salida original: si lo
# pisáramos con el del último comando de limpieza, un deploy fallido podría
# reportar éxito.
limpiar() {
  local codigo=$? rc=0 fallo_limpieza=false
  set +e
  # La shadow database primero: 512 MiB más 320 MiB de tmpfs pinchados en una
  # caja de 7.6 GB, justo en el momento en que alguien aborta un deploy y está
  # por reintentar. `docker rm -f` sobre un contenedor que ya no existe sale 0
  # en este host, así que no hay drama en llamarlo de más — lo que no puede
  # pasar es llamarlo de menos.
  if [[ "$SOMBRA_ACTIVA" == true ]]; then
    log "bajando la shadow database"
    docker rm -f "$SOMBRA" >/dev/null 2>&1
  fi
  if docker ps --filter name=arandano-stage --format '{{.Names}}' | grep -q .; then
    log "bajando arandano-stage"
    # IMAGE_TAG es obligatorio en compose.stage.yml (con `:?`) y Compose lo
    # exige para CUALQUIER subcomando, incluido `down` — lo interpola al
    # parsear el archivo, no sólo al levantar el servicio. `${SHA:-}` y no
    # `$SHA` a secas: si algo interrumpe el script ANTES de que la línea de
    # más abajo asigne SHA, esta función igual tiene que poder evaluarse bajo
    # `set -u` — aunque en la práctica el `if` de arriba ya garantiza que
    # sólo se llega acá si stage llegó a levantarse, y eso no pasa antes de
    # que SHA exista.
    #
    # SIN silenciar la salida ni el exit code: un `down -v` que fallara acá
    # se leía como éxito (stdout/stderr a /dev/null, código descartado) y
    # dejaba ~1,28 GB de tmpfs reservados — la aritmética de memoria del
    # PRÓXIMO deploy (prod 3200 + build 2048 + esos 1280 + sistema) deja de
    # cerrar sin que nada lo avise. Encontrado por revisión y reproducido:
    # con el `down` roto a propósito, el script igual imprimía "ensayo en
    # stage ok" y salía 0 con stage arriba. `rc` se captura explícito (no con
    # `||` en el `if`) porque `set +e` ya está activo en esta función.
    IMAGE_TAG="${SHA:-}" docker compose -f docker/compose.stage.yml down -v
    rc=$?
    if [[ "$rc" -ne 0 ]]; then
      fallo_limpieza=true
      error "no se pudo bajar arandano-stage (exit $rc) — quedó arriba con ~1,28 GB de tmpfs reservados; bajarlo a mano (docker compose -f docker/compose.stage.yml down -v) antes del próximo deploy"
    fi
  fi
  if [[ "$DEV_FRENADA" == true ]]; then
    log "volviendo a levantar arandano-dev"
    # --wait: sin él, `up -d` vuelve en cuanto los contenedores arrancan, no
    # cuando postgres está realmente healthy — un "éxito" acá sería débil.
    # Mismo motivo que el paso 8 con stage. Y sin silenciar salida ni exit
    # code, por la misma razón que el `down -v` de arriba: encontrado por
    # revisión, con el `up` roto a propósito el script igual terminaba en 0
    # sin decir que dev había quedado abajo.
    docker compose -f docker/compose.dev.yml up -d --wait
    rc=$?
    if [[ "$rc" -ne 0 ]]; then
      fallo_limpieza=true
      error "arandano-dev no volvió a levantar (exit $rc) — atenderlo a mano antes de reintentar deploy.sh"
    fi
  fi
  # Un deploy que terminó bien (codigo=0) pero dejó la limpieza a medias no es
  # un éxito: es justo el defecto que encontró la revisión — "ensayo en stage
  # ok" en pantalla y salida 0 con dev abajo. Si el codigo original YA era
  # distinto de 0, se respeta ese (es la causa raíz real); si era 0, una
  # limpieza rota lo vuelve 1 para que quien invoque el script (un cron, un
  # operador, un futuro CI) no lea éxito donde hay máquina rota.
  if [[ "$fallo_limpieza" == true && "$codigo" -eq 0 ]]; then
    codigo=1
  fi
  exit "$codigo"
}
trap limpiar EXIT

SHA=$(git rev-parse --short HEAD)
log "deploy $SHA -> $OBJETIVO (versión: $TIPO_VERSION)"

# ---------------------------------------------------------------------------
# Preflight: nada tocado todavía. Cualquier falla acá aborta y no deja rastro.
# ---------------------------------------------------------------------------

# Paso 1. La imagen se tagea con el SHA, así que buildear con cambios sin
# commitear produce una imagen cuya etiqueta apunta a un código que NO contiene
# — y esa etiqueta es lo que alguien lee para saber qué está corriendo.
# `git status --porcelain` y no `git diff` + `git diff --cached`: esos dos NO
# ven archivos sin trackear. Una migración nueva creada con
# `prisma migrate dev --create-only` (o escrita a mano) y nunca 'git add'eada
# es invisible para ellos, y por lo tanto también para el paso 2 de acá abajo
# (que hace `git diff` contra el último tag) — el SQL destructivo que traiga
# no lo lee ningún paso del gate, y sin embargo SÍ entra al contexto del build
# (prisma/ no está en .dockerignore) y termina copiado dentro de
# arandano-migrate:$SHA, listo para que `migrate deploy` lo aplique en
# producción bajo una etiqueta cuyo commit ni siquiera lo contiene.
# `--porcelain` sí ve no trackeados (con el mismo respeto de .gitignore que ya
# tenía `git status --short`), así que un archivo sin agregar frena acá igual
# que uno modificado.
log "paso 1/16: working tree limpio"
estado=$(git status --porcelain)
if [[ -n "$estado" ]]; then
  error "el working tree tiene cambios sin commitear (incluye no trackeados)"
  printf '%s\n' "$estado" >&2
  exit 1
fi

# Paso 2. El mismo chequeo que el hook de pre-commit, repetido acá porque
# --no-verify existe.
#
# --diff-filter=d (exclusión) y no ACM (inclusión): el hook de pre-commit tenía
# exactamente ACM y a un `git mv` puro de una migración (status R, sin cambio
# de contenido) le bastaba no estar en la lista para colarse sin pasar por el
# analizador. `d` es la única exclusión que hace falta: una migración BORRADA
# no tiene SQL que evaluar. Todo lo demás — agregado, modificado, renombrado
# puro o con cambios, tipo de archivo cambiado — trae contenido nuevo bajo esa
# ruta y tiene que pasar por acá.
log "paso 2/16: migraciones nuevas sin SQL destructivo"
ultimo_tag=$(git tag --list 'v1.*' --sort=-v:refname | head -1)
if [[ -n "$ultimo_tag" ]]; then
  migraciones_nuevas=$(git diff --name-only --diff-filter=d "$ultimo_tag..HEAD" \
                       -- 'prisma/migrations/**/migration.sql' || true)
else
  # Sin tags previos, todas las migraciones del repo son "nuevas".
  migraciones_nuevas=$(find prisma/migrations -name migration.sql | sort)
fi
if [[ -n "$migraciones_nuevas" ]]; then
  while IFS= read -r archivo; do
    # "motivo" y no "patrón": migracion_destructiva no siempre devuelve un
    # regex de la lista de patrones. El emparejamiento de constraints y el caso
    # de SQL no analizable devuelven una frase en prosa (ver el comentario de
    # la función en deploy-comun.sh), y "patrón: SQL no analizable: ..."
    # leería raro.
    if patron=$(migracion_destructiva "$(cat "$archivo")"); then
      error "migración destructiva en $archivo (motivo: $patron)"
      error "el rollback revierte la imagen, no la base: expand/contract es obligatorio"
      exit 1
    fi
  done <<< "$migraciones_nuevas"
  log "  $(wc -l <<< "$migraciones_nuevas") migración(es) nueva(s), todas aditivas"
else
  log "  sin migraciones nuevas"
fi

# Paso 3. Que schema.prisma no tenga cambios que ninguna migración capture.
# Alguien edita el modelo, se olvida de generar la migración y commitea; el
# deploy aplica cero migraciones y la app arranca contra un schema que no
# existe. Necesita una shadow database, que sale del mismo patrón efímero que
# usan verify-backup.sh y arandano-stage.
#
# Corre con `npx prisma` LOCAL — el mismo binario que ya usan los pasos 4 y 5
# — y no dentro de una imagen arandano-migrate:$SHA: esa imagen recién existe
# después del paso de build de la próxima tarea, así que en un deploy real
# todavía no está construida para el SHA nuevo en este punto del script.
# Corriendo local, el paso se queda exactamente donde la tabla de pasos del
# spec lo puso — adentro del preflight, antes de gastar nada — y no hace
# falta moverlo ni construir nada para probarlo.
log "paso 3/16: schema.prisma y migraciones sincronizados"
docker rm -f "$SOMBRA" >/dev/null 2>&1 || true
# -p 127.0.0.1::5432 y no un puerto fijo: Docker elige uno libre y sólo en
# loopback, así que dos corridas que se pisaran (el lock ya lo impide, pero un
# contenedor viejo de una corrida anterior sin tirar, no) no compiten por el
# mismo puerto, y nada fuera de esta máquina puede hablarle a esta base.
docker run -d --name "$SOMBRA" \
  --memory=512m --cpus=0.5 \
  --tmpfs /var/lib/postgresql/data:size=320m,mode=1777 \
  -e POSTGRES_USER=sombra -e POSTGRES_PASSWORD=sombra -e POSTGRES_DB=sombra \
  -e PGDATA=/var/lib/postgresql/data/pgdata \
  -p 127.0.0.1::5432 \
  postgres:17-alpine >/dev/null
SOMBRA_ACTIVA=true

# NO alcanza el primer pg_isready: el entrypoint levanta un servidor TEMPORAL
# para los scripts de init, lo apaga, y recién ahí arranca el DEFINITIVO. La
# señal inequívoca es la SEGUNDA aparición de esta línea.
for _ in $(seq 60); do
  listo=$(docker logs "$SOMBRA" 2>&1 | grep -c 'database system is ready to accept connections' || true)
  [[ "$listo" -ge 2 ]] && break
  sleep 1
done
if [[ "${listo:-0}" -lt 2 ]]; then
  docker rm -f "$SOMBRA" >/dev/null 2>&1
  SOMBRA_ACTIVA=false
  error "la shadow database no levantó en 60s"
  exit 1
fi

puerto_sombra=$(docker port "$SOMBRA" 5432/tcp | sed -nE 's/.*:([0-9]+)$/\1/p')
if [[ -z "$puerto_sombra" ]]; then
  docker rm -f "$SOMBRA" >/dev/null 2>&1
  SOMBRA_ACTIVA=false
  error "no se pudo leer el puerto publicado de la shadow database"
  exit 1
fi

# --to-schema (no --to-schema-datamodel) y SHADOW_DATABASE_URL por variable
# de entorno (no --shadow-database-url): en Prisma 7 el CLI de `migrate diff`
# cambió esas dos cosas. --to-schema-datamodel ya no existe (es --to-schema) y
# --shadow-database-url tampoco: el comando exige la shadow database en
# datasource.shadowDatabaseUrl de prisma.config.ts, no por flag — de ahí que
# prisma.config.ts lea SHADOW_DATABASE_URL. Verificado a mano contra el CLI
# real: con los nombres del brief original, `migrate diff` sale con
# "unknown or unexpected option" y "You must set datasource.shadowDatabaseUrl".
#
# `9>&-`: ver el comentario junto al `exec 9>` de más arriba — este es de los
# comandos largos que no debe heredar el fd del lock. La salida SÍ se
# captura (a diferencia de antes, que la tiraba a /dev/null): si el comando
# falla por algo que no sea "hay diferencias" (exit 2), es el único rastro
# de qué pasó y antes se perdía.
diff_salida=""
diff_rc=0
diff_salida=$(MIGRATE_DATABASE_URL="postgres://sombra:sombra@127.0.0.1:${puerto_sombra}/sombra" \
  SHADOW_DATABASE_URL="postgres://sombra:sombra@127.0.0.1:${puerto_sombra}/sombra" \
  npx prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema prisma/schema.prisma \
    --exit-code 2>&1 9>&-) || diff_rc=$?
docker rm -f "$SOMBRA" >/dev/null 2>&1
SOMBRA_ACTIVA=false

# migrate diff --exit-code: 0 = sin diferencias, 2 = hay diferencias,
# 1 = el comando falló.
if [[ "$diff_rc" -eq 2 ]]; then
  error "schema.prisma tiene cambios que ninguna migración captura"
  error "correr: npx prisma migrate dev --name <descripcion>"
  exit 1
elif [[ "$diff_rc" -ne 0 ]]; then
  error "no se pudo comparar el schema contra las migraciones (exit $diff_rc)"
  printf '%s\n' "$diff_salida" >&2
  exit 1
fi
log "  sin diferencias"

# Pasos 4 y 5.
# 9>&- en los tres: ver el comentario junto al `exec 9>` de más arriba. Son
# justo los candidatos más probables a dejar un worker huérfano (vitest,
# tsc --watch-like workers, eslint) que sobreviva a este script.
log "paso 4/16: npm test"
npm test 9>&-

log "paso 5/16: typecheck y lint"
npx tsc --noEmit 9>&-
npm run lint 9>&-

log "preflight ok"

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

# Paso 6. ANTES del build, no antes de stage. La aritmética no cierra de otra
# forma: prod 3200 + dev 2304 + build 2048 + ~1,1 GB de sistema ≈ 8,5 GB sobre
# una caja de 7,6 GB. Con dev abajo desde acá el pico queda en ~7,5 GB. De paso
# queda cubierta la regla de que dev y stage no corren juntos.
log "paso 6/16: frenando arandano-dev"
# DEV_FRENADA se marca ANTES del `down`, no después: si una señal interrumpe
# el script durante este `down` mismo, el trap tiene que saber que hay que
# intentar volver a levantar dev — marcarla después dejaría la corrida
# interrumpida con dev abajo y el flag todavía en false, y el trap no haría
# ni diría nada. El `up -d` del trap es idempotente, así que marcarla de más
# temprano no tiene costo.
DEV_FRENADA=true
docker compose -f docker/compose.dev.yml down

# Paso 7. --target explícito en las dos: `docker build` sin --target buildea la
# ÚLTIMA etapa del archivo, y el día que alguien agregue una al final,
# arandano-app pasaría a contener otra cosa sin que nada avise. Las banderas de
# recursos son las que efectivamente limitan en este host; nice, --cpuset-cpus
# y --memory son inertes acá y no avisan que lo son (ver Dockerfile y
# CLAUDE.md).
log "paso 7/16: buildeando arandano-app:$SHA y arandano-migrate:$SHA"
docker build --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --target runtime --build-arg GIT_SHA="$SHA" -t "arandano-app:$SHA" .
docker build --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --target migrate --build-arg GIT_SHA="$SHA" -t "arandano-migrate:$SHA" .

# ---------------------------------------------------------------------------
# Ensayo en stage: la migración se prueba sobre una base VIRGEN antes de tocar
# la de clientes. Si va a explotar, que explote acá.
# ---------------------------------------------------------------------------

log "paso 8/16: levantando arandano-stage y ensayando la migración"

# IMAGE_TAG se pasa INLINE a cada comando de stage y nunca con `export`:
# Docker Compose le da precedencia a una variable de entorno del shell por
# sobre el .env del stack, y una tarea posterior promueve a producción
# escribiendo IMAGE_TAG en /srv/arandano/prod/.env y corriendo compose ahí —
# un IMAGE_TAG exportado acá seguiría vivo en ese momento y le ganaría al
# .env recién escrito, promoviendo la imagen equivocada. Es el mismo defecto
# que ya apareció en rollback.sh (corregido ahí con `env -u IMAGE_TAG`, que
# sigue siendo belt-and-braces ahí aunque acá nunca se exporte — ver su
# comentario). Acá se evita de raíz no exportando nunca la variable.
#
# `down -v` PRIMERO, tolerante a que no haya nada que bajar (mismo patrón que
# el paso 3 con `docker rm -f "$SOMBRA" || true`): sin esto, un stage que
# quedó arriba de una corrida anterior — por la limpieza fallida que arregla
# el comentario del trap más arriba, un SIGKILL, un OOM o un reboot a mitad
# de una corrida — se REUSA en vez de recrearse. Encontrado por revisión y
# reproducido: contra un stage con la migración YA aplicada, este paso
# imprimía "No pending migrations to apply." y el gate salía verde sin haber
# ensayado nada — exactamente lo que este bloque de comentarios de arriba
# dice que stage existe para evitar.
IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml down -v >/dev/null 2>&1 || true
IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml up -d --wait postgres

# `--wait` de la línea de arriba confía en el healthcheck (`pg_isready`), que
# puede responder OK contra el servidor TEMPORAL que Postgres levanta para
# sus scripts de init, antes de apagarlo y arrancar recién ahí el DEFINITIVO
# — el mismo arranque en dos fases que el paso 3 ya sortea con la shadow
# database. En la ventana entre uno y otro, una conexión nueva se cae con
# "Connection refused" o "the database system is starting up" aunque compose
# ya haya marcado el contenedor healthy. Confirmado en la práctica contra
# arandano-stage real (ver task-8-report.md).
#
# `postgres_definitivo_listo` (deploy-comun.sh, con test unitario) cuenta la
# señal real en los logs en vez de reintentar a ciegas: un reintento a ciegas
# alrededor de setup-db-roles.sh imprime un `psql: error: Connection refused`
# en rojo en el camino FELIZ de todo deploy normal — entrena a mirar de
# reojo el único output que no puede mirarse de reojo — y además convierte
# una falla de CONFIGURACIÓN real (una contraseña mal escrita, por ejemplo)
# en un veredicto de timing: reintentarla 10 veces contra un rechazo de
# autenticación de verdad reporta "no prendió tras 10 intentos" en vez de la
# `FATAL: password authentication failed` que sí explica el problema.
# Determinístico y acotado: si esto no aparece en 30s, algo más grave está
# pasando y seguir esperando no lo arregla.
limite_postgres_stage=$(( $(date +%s) + 30 ))
until postgres_definitivo_listo "$(docker logs arandano-stage-postgres-1 2>&1)"; do
  if [[ "$(date +%s)" -ge "$limite_postgres_stage" ]]; then
    error "el Postgres de arandano-stage no terminó su arranque en dos fases en 30s"
    exit 1
  fi
  sleep 1
done

# Los roles de stage no existen: la base nace vacía en cada corrida (recién
# forzado un par de líneas más arriba). Las contraseñas están en claro en
# compose.stage.yml y eso es aceptable sólo acá, porque la base es efímera y
# nunca ve datos de clientes.
#
# COPLADO A compose.stage.yml: usuario, contraseñas y nombre de base de acá
# abajo (y el MIGRATE_DATABASE_URL un poco más abajo) tienen que coincidir
# EXACTO con las variables `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
# del servicio `postgres` de ese archivo. Si uno de los dos lados cambia sin
# el otro, esto no falla con un error claro — o bien setup-db-roles.sh no se
# conecta (con el fix de arriba, eso ya no se confunde con el arranque en dos
# fases porque ese wait ya pasó), o peor, se conecta contra un usuario que ya
# no es el que compose.stage.yml espera, y stage queda en un estado que no
# coincide con lo que la app de al lado tiene configurado.
scripts/setup-db-roles.sh \
  --network=arandano-stage_default \
  --url="postgres://arandano_stage:efimero-no-persiste@postgres:5432/arandano_stage" \
  --owner-password=efimero-owner \
  --app-password=efimero-app \
  --con-createdb

docker run --rm --network arandano-stage_default \
  -e MIGRATE_DATABASE_URL="postgres://arandano_owner:efimero-owner@postgres:5432/arandano_stage" \
  "arandano-migrate:$SHA" migrate deploy

# --wait espera al healthcheck del compose, no a que el contenedor arranque:
# sin eso el smoke test correría contra un Next todavía levantando, y las
# fallas intermitentes del gate se leen como bugs del código.
IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml up -d --wait app

# El host:puerto se LEE de compose en vez de repetirlo a mano (mismo patrón
# que ya usa el paso 3 con `docker port "$SOMBRA" 5432/tcp`): si alguien
# cambia el mapeo de puertos de compose.stage.yml, este comando lo sigue
# solo. Escribirlo literal acá es exactamente cómo esto termina probando un
# stack que ya no es el que compose.stage.yml describe.
url_stage=$(docker port arandano-stage-app-1 3000/tcp | head -1)
if [[ -z "$url_stage" ]]; then
  error "no se pudo leer el puerto publicado de arandano-stage-app-1"
  exit 1
fi

log "paso 9/16: smoke tests contra stage"
scripts/smoke.sh "http://${url_stage}" "$SHA"

IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml down -v
log "ensayo en stage ok"

# ---------------------------------------------------------------------------
# Producción. De acá en adelante el objetivo se toca de verdad.
# ---------------------------------------------------------------------------

# Sólo MIGRATE_DATABASE_URL hace falta de $DIR/.env para este tramo, y se lee
# con grep — NO con `set -a; . "$DIR/.env"; set +a` como decía el brief
# original. Ese sourceo hubiera EXPORTADO también IMAGE_TAG al entorno de este
# proceso, y esa exportación sigue viva cuando el paso 13 reescribe el archivo
# con `sed` más abajo: Compose le da precedencia a una variable de entorno del
# shell por sobre el .env de un stack, así que `docker compose up` de ese paso
# promovería el SHA viejo ya exportado en vez del que el sed acaba de escribir
# — la misma trampa que Task 8 evitó a propósito en el paso de stage y que
# rollback.sh neutraliza con `env -u IMAGE_TAG`. Leer sólo lo que hace falta,
# con grep, la evita de raíz en vez de defenderse después.
log "paso 10/16: migraciones del repo == migraciones del objetivo"

# `tail -n1` y no `-m1`: Compose y `set -a; .` toman la ÚLTIMA aparición de una
# clave duplicada, no la primera. El caso real es alguien arreglando una URL a
# mano agregando la línea corregida abajo de la vieja en vez de reemplazarla
# — con `-m1` este script migraría una base DISTINTA de la que la app
# termina usando, en silencio. El recorte de comillas de las dos líneas de
# abajo replica la otra normalización que hacen esos dos: un valor
# `KEY="valor"` o `KEY='valor'` llega SIN las comillas a la app y a Compose;
# `\S*` de grep no las saca solo.
MIGRATE_DATABASE_URL=$(grep -oP '^MIGRATE_DATABASE_URL=\K\S*' "$DIR/.env" | tail -n1 || true)
MIGRATE_DATABASE_URL="${MIGRATE_DATABASE_URL%\"}"; MIGRATE_DATABASE_URL="${MIGRATE_DATABASE_URL#\"}"
MIGRATE_DATABASE_URL="${MIGRATE_DATABASE_URL%\'}"; MIGRATE_DATABASE_URL="${MIGRATE_DATABASE_URL#\'}"
if [[ -z "$MIGRATE_DATABASE_URL" ]]; then
  error "$DIR/.env no define MIGRATE_DATABASE_URL (o está vacío); no se puede migrar contra $OBJETIVO"
  exit 1
fi
RED_OBJETIVO="arandano-${OBJETIVO}_default"

# `migrate status` sale 1 tanto para "hay migraciones pendientes" —el estado
# ESPERADO en cualquier deploy que traiga una migración nueva, y exactamente
# lo que los pasos 11-12 existen para resolver— como para "una migración
# quedó a medio aplicar", que NO hay que seguir. `set -e` no puede distinguir
# un exit code del otro, así que la salida y el código se capturan a mano en
# vez de dejar que el bare command decida.
#
# La CLASIFICACIÓN del texto vive en `veredicto_migrate_status`
# (deploy-comun.sh), no acá: es la única decisión de todo este gate que había
# quedado inline y sin test — anclada a texto en inglés que Prisma puede
# reformular en cualquier upgrade sin avisar, y ejercitarla de verdad exige
# Docker más una base viva, así que nadie iba a re-correr a mano la matriz de
# estados en el próximo upgrade. deploy.sh sigue siendo el único que habla
# con Docker; la función pura es la única que decide qué significa lo que
# Docker devolvió.
estado_migrate=""
rc_migrate=0
estado_migrate=$(docker run --rm --network "$RED_OBJETIVO" \
  -e MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" \
  "arandano-migrate:$SHA" migrate status 2>&1) || rc_migrate=$?
printf '%s\n' "$estado_migrate"

case "$(veredicto_migrate_status "$estado_migrate" "$rc_migrate")" in
  al_dia)
    log "  $OBJETIVO no tiene migraciones pendientes"
    ;;
  pendiente)
    log "  hay migraciones pendientes en $OBJETIVO; se aplican en el paso 12"
    ;;
  *)
    error "migrate status contra $OBJETIVO no dio un estado reconocido como seguro (rc=$rc_migrate, ver arriba)"
    exit 1
    ;;
esac

# `migrate status` sólo mira una dirección: ¿le falta al objetivo algo que el
# repo ya tiene? Nunca la otra: ¿tiene el objetivo algo aplicado que el repo
# YA NO tiene? Verificado contra una base real (ver el reporte de esta
# tarea): insertar una fila en _prisma_migrations para un nombre ausente del
# repo deja "Database schema is up to date!", exit 0 — invisible para el
# `case` de arriba. El bloqueante 9 de CLAUDE.md pide las dos direcciones, así
# que ésta se verifica con una consulta directa a la tabla que Prisma usa
# como historial. La COMPARACIÓN (`migraciones_sobrantes`) es la otra mitad
# que se movió a deploy-comun.sh; acá sólo quedan la consulta a Postgres y el
# `find`, que son justo lo que una función pura no puede hacer.
salida_bd=""
rc_bd=0
salida_bd=$(docker run --rm -i --network "$RED_OBJETIVO" postgres:17-alpine \
  psql "$MIGRATE_DATABASE_URL" --set=ON_ERROR_STOP=1 -tAc \
  "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name" \
  2>&1) || rc_bd=$?
if [[ "$rc_bd" -ne 0 ]]; then
  # Este mensaje exacto con exit 1 es el ÚNICO caso esperado: un objetivo
  # virgen que todavía no tiene la tabla, que es justo el estado que el `case`
  # de arriba ya aceptó como "pendiente" (verificado: una base recién creada
  # no necesita la tabla preexistente para que `migrate status` reporte
  # migraciones pendientes). Cualquier otra falla —contraseña, red, permisos,
  # un error de SQL distinto— no se puede distinguir de "esta consulta no dice
  # la verdad", y no saber es motivo para frenar, no para seguir.
  if [[ "$rc_bd" -eq 1 && "$salida_bd" == *'relation "_prisma_migrations" does not exist'* ]]; then
    log "  $OBJETIVO no tiene _prisma_migrations todavía (base virgen)"
    salida_bd=""
  else
    error "no se pudo verificar qué migraciones tiene aplicadas $OBJETIVO (exit $rc_bd)"
    printf '%s\n' "$salida_bd" >&2
    exit 1
  fi
fi
migraciones_repo=$(find prisma/migrations -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
sobrantes=$(migraciones_sobrantes "$salida_bd" "$migraciones_repo")
if [[ -n "$sobrantes" ]]; then
  error "$OBJETIVO tiene migraciones aplicadas que YA NO están en el repo:"
  printf '%s\n' "$sobrantes" >&2
  error "el repo tiene que ser EXACTAMENTE lo aplicado en el objetivo (CLAUDE.md, bloqueante 9)"
  exit 1
fi
log "  sin migraciones aplicadas de más"

# Leído ACÁ, antes del backup y la migración, y no recién antes del paso 13
# como en la versión anterior de este archivo: si el .env no tiene una línea
# IMAGE_TAG=, este script no va a poder rollbackear más adelante si algo sale
# mal en el paso 13 o el 14 — y es mejor enterarse de eso ANTES de tocar algo
# irreversible (el backup, la migración) que después, con la migración ya
# aplicada y sin poder decir a dónde volver. Mismo guard, mismo mensaje, que
# ya usa rollback.sh para el idéntico caso.
if ! grep -q '^IMAGE_TAG=' "$DIR/.env" 2>/dev/null; then
  error "$DIR/.env no tiene una línea IMAGE_TAG=; no se podría rollbackear si algo falla más adelante"
  error "revisá el archivo a mano antes de reintentar: necesita IMAGE_TAG=<sha>"
  exit 1
fi
# -m1 y \S* (no .*): con dos líneas IMAGE_TAG= (no debería pasar) se toma sólo
# la primera; \S* corta antes de un espacio final o un \r de un archivo CRLF
# en vez de arrastrarlo adentro del valor. A diferencia del read de
# MIGRATE_DATABASE_URL de arriba, esta clave la escriben sólo deploy.sh y
# rollback.sh, siempre como línea única — no hace falta la misma defensa
# contra un valor tocado a mano dos veces.
TAG_ANTERIOR=$(grep -m1 -oP '^IMAGE_TAG=\K\S*' "$DIR/.env")

# Paso 11. Contrato del spec de backups: si el backup falla, se aborta ANTES de
# migrar. Una migración sin backup previo es el escenario irreversible que esos
# scripts existen para evitar.
log "paso 11/16: backup pre-migración"
if [[ "$OBJETIVO" == prod ]]; then
  scripts/backup.sh --motivo=pre-migracion
else
  # En ensayo el backup igual CORRE —para que el paso se ejercite— pero contra
  # el prefijo test/ del bucket, para no ensuciar el histórico real de prod.
  # NUNCA --motivo=pre-migracion acá: ese motivo es lo que distingue, en el
  # histórico real, un backup que de verdad precedió a una migración de
  # producción.
  scripts/backup.sh --motivo=test
fi

# Paso 12. Sólo migrate deploy. Nunca migrate reset ni db push.
log "paso 12/16: migrate deploy contra $OBJETIVO"
docker run --rm --network "$RED_OBJETIVO" \
  -e MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" \
  "arandano-migrate:$SHA" migrate deploy

# ---------------------------------------------------------------------------
# Desde acá, una falla es ROLLBACK y no aborto: es el único tramo donde el
# objetivo ya cambió. Un aborto en el paso 12 deja schema nuevo con código
# viejo, que es el estado que expand/contract garantiza compatible.
#
# TAG_ANTERIOR ya se leyó más arriba, antes del backup — ver el comentario de
# ahí sobre por qué conviene enterarse de un .env malformado antes de tocar
# algo irreversible en vez de acá.
# ---------------------------------------------------------------------------

# El rollback automático NO reimplementa nada: invoca el mismo comando que
# correría una persona. Así el camino de emergencia es el que se ejercita.
rollback_y_salir() {
  error "$1"
  error "disparando rollback automático a $TAG_ANTERIOR"
  if scripts/rollback.sh --a="$TAG_ANTERIOR" --objetivo="$OBJETIVO"; then
    # Código propio (5, no 1): un "$?" de 1 es indistinguible de un aborto de
    # preflight donde el objetivo nunca se tocó. Acá SÍ se tocó — se migró, se
    # promovió, y recién ahí se revirtió solo — y aunque el objetivo terminó
    # sano, es una mañana distinta de "no pasó nada". Un cron o un CI que sólo
    # mira "$?" tiene que poder distinguir las dos sin leer el log.
    error "rollback ok: $OBJETIVO volvió a $TAG_ANTERIOR. NO se creó tag."
    exit 5
  else
    # Código propio (3, no 1 ni 5): acá no alcanza con "el deploy falló y se
    # revirtió" — la RED que existe justo para ese caso (el rollback
    # automático) TAMBIÉN falló. Puede hacer falta atención manual inmediata.
    # Mismo espíritu que rollback.sh: "sale con código propio" para su propio
    # peor caso.
    error "EL ROLLBACK TAMBIÉN FALLÓ. Ver el detalle de arriba."
    exit 3
  fi
}

log "paso 13/16: promoviendo arandano-app:$SHA (venía de $TAG_ANTERIOR)"
sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${SHA}|" "$DIR/.env"
# `env -u IMAGE_TAG`, belt-and-braces igual que en rollback.sh: este script no
# exporta IMAGE_TAG en ningún punto (ver el comentario del paso 10), pero si
# alguien lo tuviera exportado a mano en la shell que invoca deploy.sh, le
# ganaría al .env recién reescrito. Costo cero, defensa contra un error ajeno
# a este script.
if ! ( cd "$DIR" && env -u IMAGE_TAG docker compose up -d --force-recreate app ); then
  rollback_y_salir "la promoción falló"
fi

# Paso 14. Con plazo, no con reintentos infinitos: un healthcheck que espera
# para siempre no es un gate.
#
# La comparación de sha es el bloqueante 8: el healthcheck puede dar 200 desde
# el contenedor VIEJO si la promoción no reemplazó nada, y el deploy se
# declararía exitoso aunque lo que respondió nunca haya sido lo que pasó el
# smoke test.
log "paso 14/16: healthcheck de $OBJETIVO (plazo 90s)"
limite=$((SECONDS + 90))
salud=""
sano=false
while (( SECONDS < limite )); do
  salud=$(curl -fsS --max-time 5 "$URL_SALUD/api/health" 2>/dev/null) || salud=""
  if [[ -n "$salud" ]] && health_ok "$salud" \
     && [[ "$(sha_del_health "$salud")" == "$SHA" ]]; then
    sano=true
    break
  fi
  sleep 3
done
if [[ "$sano" != true ]]; then
  rollback_y_salir "el healthcheck no dio sano con sha=$SHA en 90s (último: ${salud:-<sin respuesta>})"
fi
log "  $OBJETIVO responde sano con sha=$SHA"

# ---------------------------------------------------------------------------
# Paso 15. El tag va DESPUÉS del healthcheck: significa "esto estuvo vivo y sano
# en producción", no "esto se intentó". Un deploy que rollbackea no consume
# número, así que la secuencia no tiene huecos.
#
# Una falla acá NO dispara rollback. Si el push falla —se cayó la red, venció el
# token— producción ya está viva y sana; revertirla por un problema de metadatos
# convertiría un fallo cosmético en una caída. Pero "no rollbackea" no es lo
# mismo que "no importa": si algo de acá falla, el script tiene que decirlo
# con un código de salida propio y NUNCA con "deploy ok" — un cron, un CI o un
# operador que sólo mira "$?" tiene que poder distinguir "todo terminó" de
# "producción está sana pero quedó un tag pendiente en el VPS, que desaparece
# con el VPS si nadie lo empuja" (CLAUDE.md).
# ---------------------------------------------------------------------------

PASO15_PENDIENTE=""

if [[ "$TAGEA" == true ]]; then
  log "paso 15/16: tag de git"
  # Sin guardar: bajo `set -e`, un `proxima_version` que falla (tag previo con
  # formato inesperado) mata el script ACÁ MISMO con sólo el mensaje que ya
  # imprime esa función — sin la reafirmación de "producción está sana" que sí
  # tienen las otras dos ramas de acá abajo, y sin la posibilidad de llegar al
  # cierre de más abajo que evita el "deploy ok" engañoso.
  VERSION=""
  if ! VERSION=$(proxima_version "$ultimo_tag" "$TIPO_VERSION"); then
    PASO15_PENDIENTE="no se pudo calcular la próxima versión a partir de '$ultimo_tag' (ver el error de arriba)"
    error "producción está sana; esto es metadatos, no dispara rollback"
  else
    nombres_migraciones=$(printf '%s\n' "$migraciones_nuevas" \
      | sed -nE 's|^prisma/migrations/([^/]+)/migration\.sql$|\1|p' | paste -sd' ' -)
    if git tag -a "$VERSION" -m "$(mensaje_de_tag "$SHA" "$nombres_migraciones")"; then
      log "  $VERSION creado"
      if git push origin "$VERSION"; then
        log "  $VERSION pusheado a origin"
      else
        PASO15_PENDIENTE="el tag $VERSION se creó pero NO se pudo pushear a origin -- reintentar: git push origin $VERSION"
        error "$PASO15_PENDIENTE"
        error "producción está sana; esto es metadatos, no dispara rollback"
      fi
    else
      PASO15_PENDIENTE="no se pudo crear el tag $VERSION"
      error "$PASO15_PENDIENTE"
      error "producción está sana; esto es metadatos, no dispara rollback"
    fi
  fi
else
  log "paso 15/16: objetivo=$OBJETIVO, no se tagea"
fi

log "paso 16/16: el trap vuelve a levantar arandano-dev"
if [[ -n "$PASO15_PENDIENTE" ]]; then
  # Código propio (4): ni el 1 de un aborto normal (acá NO abortó nada, el
  # objetivo está sirviendo el SHA nuevo) ni un 0 que un cron leería como
  # "todo terminó" con un tag que sólo existe en este checkout.
  error "deploy con pendiente: $OBJETIVO corriendo arandano-app:$SHA, pero $PASO15_PENDIENTE"
  exit 4
fi
log "deploy ok: $OBJETIVO corriendo arandano-app:$SHA"
