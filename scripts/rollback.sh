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
    --a=*)
      DESTINO="${arg#*=}"
      # --a= (vacío) NO es lo mismo que omitir el flag: omitido, DESTINO se
      # deriva del anteúltimo tag más abajo; vacío a propósito quedaría
      # indistinguible de eso y terminaría derivando igual, en silencio. El
      # caso real es un `rollback.sh --a=$SHA` a las 11pm con $SHA sin setear
      # — el `set -u` del operador no salva nada porque la expansión ya pasó
      # antes de que este script vea el argumento.
      [[ -n "$DESTINO" ]] || { error "--a necesita un valor (sha); vino vacío"; uso; }
      ;;
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
  # `|| { ... }` y no una asignación suelta: bajo `set -e` una asignación que
  # falla mata el script ahí mismo, con el único mensaje que ya haya impreso
  # imagen_de_tag (que no dice CUÁL tag, ni que --a= es la salida). Pasa de
  # verdad con un tag liviano en vez de anotado — lo que produce alguien
  # tageando a mano en vez de dejar que deploy.sh anote — porque `%(contents)`
  # de un tag liviano no es el mensaje del tag (no tiene uno): es el mensaje
  # del COMMIT al que apunta, que jamás va a tener la línea 'imagen: ...'.
  DESTINO=$(imagen_de_tag "$(git tag -l --format='%(contents)' "$anteultimo")") || {
    error "el tag $anteultimo no dice a qué imagen volver (¿es liviano en vez de anotado?)"
    error "si sabés a qué imagen volver, pasala: rollback.sh --a=<sha>"
    exit 1
  }
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

# Que el .env tenga la clave a reescribir, sin lo cual el sed de más abajo
# sale 0 sin cambiar UNA LÍNEA: un no-op silencioso que deja al operador
# creyendo que hizo el rollback. El caso real es deploy.sh: exporta
# IMAGE_TAG=<sha nuevo> en su propio entorno para el paso de stage, y si
# después invoca `rollback.sh --a=<sha viejo>` contra un .env sin la clave,
# `docker compose up` interpola esa variable de ENTORNO en vez de leer el
# archivo — el stack vuelve a levantar exactamente con la imagen de la que se
# suponía que estábamos saliendo.
if ! grep -q '^IMAGE_TAG=' "$DIR/.env" 2>/dev/null; then
  error "$DIR/.env no existe o no tiene una línea IMAGE_TAG=; no se puede rollbackear ahí"
  exit 1
fi

# -m1 y \S* (no .*): con dos líneas IMAGE_TAG= (no debería pasar, pero el
# archivo lo permite) se toma sólo la primera y no las dos pegadas rompiendo
# el bloque de diagnóstico; \S* corta antes de un espacio final o un \r de un
# archivo CRLF en vez de arrastrarlo adentro de $ACTUAL.
ACTUAL=$(grep -m1 -oP '^IMAGE_TAG=\K\S*' "$DIR/.env")
log "rollback en $OBJETIVO: $ACTUAL -> $DESTINO"
log "la base de datos NO se toca"

# Bloque de diagnóstico compartido entre las DOS formas de fallar de acá para
# abajo: se agota el plazo de 90s, o el propio `docker compose up` sale mal.
# Un solo lugar evita que las dos ramas se desincronicen y una se quede sin
# alguno de los datos que la otra sí imprime.
fallar() {
  local motivo="$1" salud_actual="${2:-}"
  error "$motivo"
  error "  stack:        $OBJETIVO ($DIR)"
  error "  venía de:     $ACTUAL"
  error "  se intentó:   $DESTINO"
  error "  último JSON:  ${salud_actual:-<sin respuesta>}"
  error ""
  error "para ver qué pasa:  docker compose -f $DIR/docker-compose.yml logs --tail=50 app"
  error "para probar otra:   scripts/rollback.sh --a=<sha> --objetivo=$OBJETIVO"
  exit 1
}

sed -i "s|^IMAGE_TAG=.*|IMAGE_TAG=${DESTINO}|" "$DIR/.env"
# Envuelto en `if !` y no suelto: bajo `set -e` un `docker compose up` que
# falla mataría el script ACÁ MISMO, después de que el .env ya quedó
# reescrito y antes de llegar al bloque accionable de más abajo — el operador
# se queda sin saber a qué volvió el archivo ni qué comando correr después.
if ! ( cd "$DIR" && docker compose up -d --force-recreate app ); then
  fallar "EL ROLLBACK FALLÓ AL LEVANTAR EL CONTENEDOR (el .env YA quedó reescrito con IMAGE_TAG=$DESTINO)"
fi

# Mismo plazo que el healthcheck del deploy: 90s. Un rollback que espera para
# siempre no avisa que falló.
log "esperando a que $OBJETIVO responda sano"
limite=$((SECONDS + 90))
salud=""
while (( SECONDS < limite )); do
  salud=$(curl -fsS --max-time 5 "$URL_SALUD/api/health" 2>/dev/null) || salud=""
  if [[ -n "$salud" ]] && health_ok "$salud"; then
    # stderr silenciado ACÁ, no en la lib: sha_del_health hace bien en avisar
    # cuando falta info.sha, pero adentro de este loop de 3s en 3s esa misma
    # línea se repite ~30 veces antes de llegar al mensaje que sí importa. El
    # bloque de `fallar` ya muestra el JSON completo si esto nunca matchea.
    sha_actual=$(sha_del_health "$salud" 2>/dev/null) || sha_actual=""
    if [[ "$sha_actual" == "$DESTINO" ]]; then
      log "rollback ok: $OBJETIVO responde sano con sha=$DESTINO"
      exit 0
    fi
  fi
  sleep 3
done

# El peor caso. No reintenta ni entra en loop: lo único útil acá es que una
# persona tenga los datos sin salir a buscarlos.
fallar "EL ROLLBACK NO VERIFICÓ EN 90s" "$salud"
