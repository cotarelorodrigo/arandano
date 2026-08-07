#!/usr/bin/env bash
# Volver a una imagen anterior. Un comando, una línea.
#
# Lo usan dos: el operador cuando el healthcheck no vio algo, y deploy.sh como
# su rollback automático. Es el MISMO código a propósito — si el automático
# tuviera su propia copia, el camino que se ejercita todos los días sería el
# que nunca se usa en una emergencia.
#
# NO TOCA LA BASE DE DATOS. Nunca. Revierte la imagen y nada más. Por eso el
# gate de deploy.sh se niega ante una migración destructiva: si el schema nuevo
# no soporta el código viejo, esto no alcanza y no queda ninguna red.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/deploy-comun.sh

DESTINO=""
OBJETIVO=prod

uso() {
  cat >&2 <<'EOF'
uso: rollback.sh [--a=<sha>] [--objetivo=prod|ensayo]

  --a         sha de la imagen a la que volver. Sin esto, se deriva del
              ANTEÚLTIMO tag de git: el último describe lo que está corriendo.
  --objetivo  qué stack. prod (default) o ensayo.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --a=*)        DESTINO="${arg#*=}" ;;
    --objetivo=*) OBJETIVO="${arg#*=}" ;;
    -h|--help)    uso ;;
    *) error "argumento desconocido: $arg"; uso ;;
  esac
done

case "$OBJETIVO" in
  prod)   DIR=/srv/arandano/prod;   URL_SALUD=http://127.0.0.1 ;;
  ensayo) DIR=/srv/arandano/ensayo; URL_SALUD=http://100.64.81.63:3002 ;;
  *) error "objetivo inválido: $OBJETIVO"; uso ;;
esac

# Sin --a: el ANTEÚLTIMO tag. El último describe lo que está corriendo ahora,
# así que volver ahí no sería volver a ningún lado.
if [[ -z "$DESTINO" ]]; then
  anteultimo=$(git tag --list 'v1.*' --sort=-v:refname | sed -n '2p')
  if [[ -z "$anteultimo" ]]; then
    error "no hay un tag anterior al que volver (hacen falta al menos dos)"
    error "si sabés a qué imagen volver, pasala: rollback.sh --a=<sha>"
    exit 1
  fi
  DESTINO=$(imagen_de_tag "$(git tag -l --format='%(contents)' "$anteultimo")")
  log "destino derivado de $anteultimo: $DESTINO"
fi

# Que la imagen exista ANTES de tocar el .env. Escribir un IMAGE_TAG que apunta
# a una imagen inexistente deja el stack sin poder levantar, y convierte un
# rollback en una caída más larga.
if ! docker image inspect "arandano-app:$DESTINO" >/dev/null 2>&1; then
  error "la imagen arandano-app:$DESTINO no existe en este host"
  error "imágenes disponibles:"
  docker images arandano-app --format '  {{.Tag}}  ({{.CreatedAt}})' >&2
  exit 1
fi

ACTUAL=$(grep -oP '^IMAGE_TAG=\K.*' "$DIR/.env" || echo "(desconocido)")
log "rollback en $OBJETIVO: $ACTUAL -> $DESTINO"
log "la base de datos NO se toca"

sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${DESTINO}|" "$DIR/.env"
( cd "$DIR" && docker compose up -d --force-recreate app )

# Mismo plazo que el healthcheck del deploy: 90s. Un rollback que espera para
# siempre no avisa que falló.
log "esperando a que $OBJETIVO responda sano"
limite=$((SECONDS + 90))
salud=""
while (( SECONDS < limite )); do
  salud=$(curl -fsS --max-time 5 "$URL_SALUD/api/health" 2>/dev/null) || salud=""
  if [[ -n "$salud" ]] && health_ok "$salud" \
     && [[ "$(sha_del_health "$salud")" == "$DESTINO" ]]; then
    log "rollback ok: $OBJETIVO responde sano con sha=$DESTINO"
    exit 0
  fi
  sleep 3
done

# El peor caso. No reintenta ni entra en loop: lo único útil acá es que una
# persona tenga los datos sin salir a buscarlos.
error "EL ROLLBACK NO VERIFICÓ EN 90s"
error "  stack:        $OBJETIVO ($DIR)"
error "  venía de:     $ACTUAL"
error "  se intentó:   $DESTINO"
error "  último JSON:  ${salud:-<sin respuesta>}"
error ""
error "para ver qué pasa:  docker compose -f $DIR/docker-compose.yml logs --tail=50 app"
error "para probar otra:   scripts/rollback.sh --a=<sha> --objetivo=$OBJETIVO"
exit 1
