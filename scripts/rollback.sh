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
              Correrlo dos veces seguidas sin --a NO lleva dos versiones atrás:
              la segunda deriva el MISMO destino, y el script lo dice en vez de
              reportar un éxito que no hizo nada.
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
    --objetivo=*)
      # Mismo guard que --a= acá arriba y que --objetivo= en deploy.sh, por el
      # mismo motivo: vacío no es lo mismo que omitido. Omitido, el default es
      # "prod"; vacío quedaría indistinguible de eso y el `case` de abajo lo
      # rechazaría con "objetivo inválido: " en blanco, sin decir que el
      # problema fue una variable sin expandir en el comando de quien invoca.
      OBJETIVO="${arg#*=}"
      [[ -n "$OBJETIVO" ]] || { error "--objetivo necesita un valor (prod o ensayo); vino vacío"; uso; }
      ;;
    -h|--help)    uso ;;
    *) error "argumento desconocido: $arg"; uso ;;
  esac
done

# ATENCIÓN, futuro cutover de DNS: el URL_SALUD de `prod` es el mismo de
# deploy.sh y entra por el bloque `:80` del Caddyfile, que hoy es un
# `reverse_proxy` catch-all y tiene que pasar a ser `redir https://{host}{uri}`
# antes del cutover (CLAUDE.md, *Bloqueantes antes del cutover de DNS*, punto
# 2). El día que eso pase, este loop recibe un 308 con cuerpo vacío, `health_ok`
# lo rechaza y hasta un rollback que levantó perfecto reporta "NO VERIFICÓ EN
# 90s" — y como deploy.sh usa este mismo script como su rollback automático,
# ahí se convierte en su salida 3, el peor caso, sin que nada esté roto.
# Explicación completa en el comentario gemelo de deploy.sh: hay que cambiar
# las DOS líneas en el mismo commit que cambie el Caddyfile.
case "$OBJETIVO" in
  prod)   DIR=/srv/arandano/prod;   URL_SALUD=http://127.0.0.1 ;;
  ensayo) DIR=/srv/arandano/ensayo; URL_SALUD=http://100.64.81.63:3002 ;;
  *) error "objetivo inválido: $OBJETIVO"; uso ;;
esac

# Mismo motivo y mismo detalle que en deploy.sh (ver el comentario largo de
# ahí): sin el trap de INT, un SIGINT al PID de este script no lo frena — bash
# abandona la espera del hijo en curso y sigue con el comando SIGUIENTE.
# Reproducido acá también: se saltea el `docker compose up` y cae directo al
# loop de healthcheck, o se saltea el loop y reporta el peor caso sin haber
# esperado nada. Un rollback es lo último que puede improvisar. El de TERM va
# por simetría, igual que allá.
trap 'exit 130' INT
trap 'exit 143' TERM

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
#
# El `2>/dev/null` traga TANTO "no existe la clave" COMO "no se pudo leer el
# archivo" (permisos, symlink roto, etc.), así que el mensaje no distingue
# entre las dos — se avisan las dos posibilidades en vez de afirmar una que
# podría no ser cierta. Y se agrega el remedio real: acá no sirve --a=<sha>
# (eso resuelve DESTINO, no lo que le falta a este archivo), así que se le
# dice al operador exactamente qué mirar.
if ! grep -q '^IMAGE_TAG=' "$DIR/.env" 2>/dev/null; then
  error "no se pudo leer $DIR/.env o no tiene una línea IMAGE_TAG=; no se puede rollbackear ahí"
  error "revisá el archivo a mano: necesita una línea IMAGE_TAG=<sha> para poder reescribirse"
  exit 1
fi

# -m1 y \S* (no .*): con dos líneas IMAGE_TAG= (no debería pasar, pero el
# archivo lo permite) se toma sólo la primera y no las dos pegadas rompiendo
# el bloque de diagnóstico; \S* corta antes de un espacio final o un \r de un
# archivo CRLF en vez de arrastrarlo adentro de $ACTUAL.
#
# `|| true` y el chequeo de vacío aparte, no un `|| echo "(desconocido)"`
# pegado al grep: ese patrón sólo cubre "grep no encontró nada", pero acá el
# guard de arriba ya garantiza que la clave existe — el caso real que hay que
# cubrir es IMAGE_TAG= con valor VACÍO, donde \S* matchea igual (grep sale 0
# con una captura de cero caracteres) y el `||` nunca se dispara. Sin este
# fallback, ese caso imprime "venía de: " en blanco en vez de decir que no se
# pudo leer un valor.
ACTUAL=$(grep -m1 -oP '^IMAGE_TAG=\K\S*' "$DIR/.env" || true)

# Volver a donde ya estamos no es un rollback, y llamarlo "rollback ok" es peor
# que fallar. El caso real es correr esto DOS VECES sin argumentos: el destino
# sale del ANTEÚLTIMO tag las dos veces —el último sigue describiendo lo que se
# promovió, no lo que corre— así que la segunda corrida reescribe el .env con lo
# que ya está corriendo, recrea el contenedor con la MISMA imagen, el
# healthcheck da sano con ese sha y sale 0. Quien quería ir dos versiones atrás
# se queda una, convencido de que fue dos, y encima con la evidencia en contra:
# la app responde sana.
#
# No es una falla de la máquina, así que no hay nada que arreglar: lo único
# necesario es decirlo y no reportar éxito. Se chequea ANTES del `sed`, porque
# tocar el archivo para dejarlo igual no aporta nada.
#
# Para el rollback automático de deploy.sh esto sólo se dispara si el SHA que se
# estaba promoviendo era el que YA estaba corriendo (redeploy del mismo commit).
# Ahí el rollback de verdad no tiene a dónde ir, deploy.sh lo lee como "el
# rollback también falló" y sale 3 — que es lo correcto: producción quedó
# enferma y ninguna imagen anterior la va a salvar sola.
if [[ -n "$ACTUAL" && "$DESTINO" == "$ACTUAL" ]]; then
  error "$OBJETIVO ya está corriendo arandano-app:$DESTINO — esto no sería un rollback, sería un no-op"
  error "  stack:  $OBJETIVO ($DIR)"
  error "si querías ir MÁS atrás, elegí la imagen a mano:"
  error "  git tag --list 'v1.*' --sort=-v:refname          # las versiones, de la más nueva a la más vieja"
  error "  git tag -l --format='%(contents)' <tag>          # a qué imagen corresponde cada una"
  error "  scripts/rollback.sh --a=<sha> --objetivo=$OBJETIVO"
  exit 1
fi

[[ -n "$ACTUAL" ]] || ACTUAL="(desconocido)"
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
#
# `env -u IMAGE_TAG` y no un `docker compose up` a secas: Compose resuelve
# `${IMAGE_TAG}` primero contra el ENTORNO del proceso y sólo si no está ahí
# cae al `.env` — así que un IMAGE_TAG heredado desde el entorno le ganaría al
# valor que el sed de la línea de arriba acaba de escribir. deploy.sh HOY no
# exporta IMAGE_TAG en ningún punto — lo pasa inline a cada comando de stage,
# a propósito, para no arriesgar justo este defecto (ver el comentario donde
# lo hace) — así que esto es belt-and-braces: defensa contra que alguien lo
# tenga exportado a mano en su propia shell antes de invocar este script, o
# contra que un cambio futuro en deploy.sh vuelva a introducirlo sin que
# nadie repare en esta dependencia cruzada entre los dos scripts. El
# contrato entero de este script es "el .env es la fuente de verdad de lo
# que corre"; heredar el sha equivocado desde una variable de entorno lo
# rompe en silencio, y encima en el caso más común (la imagen heredada SÍ
# existe localmente, así que `up` no falla — recién lo atrapa la comparación
# de sha más abajo, 90 segundos después, sin que nada en pantalla diga por
# qué).
#
# `--no-deps`: sin él, este script IMPRIMÍA "la base de datos NO se toca" (ver
# más arriba) y acto seguido recreaba el contenedor de Postgres. El mensaje era
# literalmente falso. Encontrado por el ensayo completo (task-10), donde el
# Postgres de ensayo vive en tmpfs y el rollback terminaba de vaciar la base
# que intentaba salvar.
#
# El culpable NO es `--force-recreate` (medido: con el .env sin tocar, ese flag
# deja postgres intacto; con el .env reescrito, un `up app` pelado igual lo
# recrea). Es el `sed` de la línea de arriba: `postgres` y `app` comparten el
# mismo `env_file: .env`, así que reescribir IMAGE_TAG cambia el entorno
# computado DE LA BASE, Compose la ve driftada y la recrea al pasar por ella
# como dependencia de `app`. Explicación completa y las cuatro mediciones, en
# el paso 13 de deploy.sh.
#
# Mismo arreglo y mismo motivo que allá: un rollback vuelve la IMAGEN de la app
# a la anterior, y nada más — esa es justamente la razón por la que
# expand/contract es obligatorio.
if ! ( cd "$DIR" && env -u IMAGE_TAG docker compose up -d --no-deps --force-recreate app ); then
  fallar "EL ROLLBACK FALLÓ AL LEVANTAR EL CONTENEDOR (el .env YA quedó reescrito con IMAGE_TAG=$DESTINO)"
fi

# Mismo plazo que el healthcheck del deploy: 90s. Un rollback que espera para
# siempre no avisa que falló.
log "esperando a que $OBJETIVO responda sano"
limite=$((SECONDS + 90))
salud=""
while (( SECONDS < limite )); do
  # `-sS` y no `-fsS`, por el mismo motivo que el paso 14 de deploy.sh (ver el
  # comentario largo de ahí): `-f` descarta el cuerpo de un 503, que es donde
  # el healthcheck pone la causa. Y acá duele todavía más: este loop alimenta
  # el `último JSON:` del bloque de diagnóstico de `fallar`, o sea el texto que
  # alguien lee a las 11 de la noche cuando el rollback —la última red que
  # queda— no levantó. Ese campo decía "<sin respuesta>" en el peor momento
  # posible, teniendo la respuesta a mano.
  salud=$(curl -sS --max-time 5 "$URL_SALUD/api/health" 2>/dev/null) || salud=""
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
