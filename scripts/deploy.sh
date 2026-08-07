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
    --objetivo=*) OBJETIVO="${arg#*=}" ;;
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
exec 9>/var/lock/arandano-deploy.lock
if ! flock -n 9; then
  error "ya hay un deploy corriendo"
  exit 1
fi

DEV_FRENADA=false

# Corre pase lo que pase, y preserva el código de salida original: si lo
# pisáramos con el del último comando de limpieza, un deploy fallido podría
# reportar éxito.
limpiar() {
  local codigo=$?
  set +e
  if docker ps --filter name=arandano-stage --format '{{.Names}}' | grep -q .; then
    log "bajando arandano-stage"
    docker compose -f docker/compose.stage.yml down -v >/dev/null 2>&1
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
log "paso 1/16: working tree limpio"
if ! git diff --quiet || ! git diff --cached --quiet; then
  error "el working tree tiene cambios sin commitear"
  git status --short >&2
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
# NOTA DE ORDEN: este paso usa arandano-migrate:$SHA, que recién se buildea en
# el paso de build (Task 8). En un deploy real esa imagen todavía no existe
# para el SHA nuevo — la Task 8 mueve este paso después del build. Queda acá,
# en su lugar final, para poder probar la lógica ahora mismo contra una imagen
# que ya existe de un SHA anterior.
log "paso 3/16: schema.prisma y migraciones sincronizados"
SOMBRA=arandano-deploy-sombra
docker rm -f "$SOMBRA" >/dev/null 2>&1 || true
docker run -d --name "$SOMBRA" \
  --memory=512m --cpus=0.5 \
  --tmpfs /var/lib/postgresql/data:size=320m,mode=1777 \
  -e POSTGRES_USER=sombra -e POSTGRES_PASSWORD=sombra -e POSTGRES_DB=sombra \
  -e PGDATA=/var/lib/postgresql/data/pgdata \
  postgres:17-alpine >/dev/null

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
  error "la shadow database no levantó en 60s"
  exit 1
fi

# --to-schema (no --to-schema-datamodel) y SHADOW_DATABASE_URL por variable
# (no --shadow-database-url): en Prisma 7 el CLI de `migrate diff` cambió esas
# dos cosas. --to-schema-datamodel ya no existe (es --to-schema) y
# --shadow-database-url tampoco: el comando exige la shadow database en
# datasource.shadowDatabaseUrl de prisma.config.ts, no por flag — de ahí que
# prisma.config.ts lea SHADOW_DATABASE_URL. Verificado a mano contra el CLI
# real: con los nombres del brief original, `migrate diff` sale con
# "unknown or unexpected option" y "You must set datasource.shadowDatabaseUrl".
diff_rc=0
docker run --rm --network container:"$SOMBRA" \
  -v "$PWD/prisma:/app/prisma:ro" \
  -e MIGRATE_DATABASE_URL="postgres://sombra:sombra@127.0.0.1:5432/sombra" \
  -e SHADOW_DATABASE_URL="postgres://sombra:sombra@127.0.0.1:5432/sombra" \
  "arandano-migrate:$SHA" migrate diff \
    --from-migrations prisma/migrations \
    --to-schema prisma/schema.prisma \
    --exit-code >/dev/null 2>&1 || diff_rc=$?
docker rm -f "$SOMBRA" >/dev/null 2>&1

# migrate diff --exit-code: 0 = sin diferencias, 2 = hay diferencias,
# 1 = el comando falló.
if [[ "$diff_rc" -eq 2 ]]; then
  error "schema.prisma tiene cambios que ninguna migración captura"
  error "correr: npx prisma migrate dev --name <descripcion>"
  exit 1
elif [[ "$diff_rc" -ne 0 ]]; then
  error "no se pudo comparar el schema contra las migraciones (exit $diff_rc)"
  exit 1
fi
log "  sin diferencias"

# Pasos 4 y 5.
log "paso 4/16: npm test"
npm test

log "paso 5/16: typecheck y lint"
npx tsc --noEmit
npm run lint

log "preflight ok"
