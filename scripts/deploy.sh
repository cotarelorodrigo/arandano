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
  local codigo=$?
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
    # parsear el archivo, no sólo al levantar el servicio. Sin pasarlo acá
    # este `down -v` fallaría en silencio (stdout/stderr van a /dev/null y
    # `set +e` ya está activo) y la limpieza dejaría stage arriba. `${SHA:-}`
    # y no `$SHA` a secas: si algo interrumpe el script ANTES de que la línea
    # de más abajo asigne SHA, esta función igual tiene que poder evaluarse
    # bajo `set -u` — aunque en la práctica el `if` de arriba ya garantiza que
    # sólo se llega acá si stage llegó a levantarse, y eso no pasa antes de
    # que SHA exista.
    IMAGE_TAG="${SHA:-}" docker compose -f docker/compose.stage.yml down -v >/dev/null 2>&1
  fi
  if [[ "$DEV_FRENADA" == true ]]; then
    log "volviendo a levantar arandano-dev"
    docker compose -f docker/compose.dev.yml up -d >/dev/null 2>&1
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
docker compose -f docker/compose.dev.yml down
DEV_FRENADA=true

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
# que ya apareció en rollback.sh (corregido ahí con `env -u IMAGE_TAG`); acá
# se evita de raíz no exportando nunca la variable.
IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml up -d --wait postgres

# Los roles de stage no existen: la base nace vacía en cada corrida. Las
# contraseñas están en claro en compose.stage.yml y eso es aceptable sólo acá,
# porque la base es efímera y nunca ve datos de clientes.
#
# Reintenta unas pocas veces a propósito: `--wait` de acá arriba confía en el
# healthcheck (`pg_isready`), y `pg_isready` puede responder OK contra el
# servidor TEMPORAL que Postgres levanta para sus scripts de init, antes de
# apagarlo y arrancar recién ahí el DEFINITIVO — el mismo arranque en dos
# fases que el paso 3 ya tiene que sortear con la shadow database (ver su
# comentario, "la señal inequívoca es la SEGUNDA aparición de esta línea").
# En la ventana entre uno y otro, una conexión nueva se cae con "Connection
# refused" o "the database system is starting up" aunque compose ya haya
# marcado el contenedor healthy. Confirmado en la práctica: sin este retry,
# esto se reprodujo en 3 de 4 corridas reales contra stage. setup-db-roles.sh
# es idempotente a propósito (ver su propio comentario), así que reintentarlo
# es más simple y más robusto que enseñarle a `--wait` a distinguir las dos
# fases del arranque de Postgres.
intentos_roles=0
until scripts/setup-db-roles.sh \
  --network=arandano-stage_default \
  --url="postgres://arandano_stage:efimero-no-persiste@postgres:5432/arandano_stage" \
  --owner-password=efimero-owner \
  --app-password=efimero-app \
  --con-createdb; do
  intentos_roles=$((intentos_roles + 1))
  if [[ "$intentos_roles" -ge 10 ]]; then
    error "setup-db-roles.sh contra arandano-stage no prendió tras $intentos_roles intentos"
    exit 1
  fi
  sleep 2
done

docker run --rm --network arandano-stage_default \
  -e MIGRATE_DATABASE_URL="postgres://arandano_owner:efimero-owner@postgres:5432/arandano_stage" \
  "arandano-migrate:$SHA" migrate deploy

# --wait espera al healthcheck del compose, no a que el contenedor arranque:
# sin eso el smoke test correría contra un Next todavía levantando, y las
# fallas intermitentes del gate se leen como bugs del código.
IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml up -d --wait app

log "paso 9/16: smoke tests contra stage"
scripts/smoke.sh http://100.64.81.63:3001 "$SHA"

IMAGE_TAG="$SHA" docker compose -f docker/compose.stage.yml down -v
log "ensayo en stage ok"
