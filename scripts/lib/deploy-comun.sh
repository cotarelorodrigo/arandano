#!/usr/bin/env bash
# Lógica de decisión compartida entre deploy.sh y rollback.sh.
#
# Sólo funciones PURAS: reciben strings, devuelven strings o un código de
# salida, y no tocan Docker, la red, git ni el disco. Eso es lo que permite que
# scripts/tests/test-deploy-comun.sh corra en milisegundos, y por lo tanto que
# nadie tenga excusa para saltearlo.
#
# mensaje_de_tag e imagen_de_tag son INVERSAS y viven juntas a propósito:
# deploy.sh escribe el mensaje del tag y rollback.sh lo lee. Separarlas en dos
# archivos es exactamente cómo se desincronizan, y el modo de falla sería que
# el rollback manual no encuentre a dónde volver — descubierto justo el día que
# hace falta.
#
# Este archivo sólo define funciones. No ejecuta nada al sourcearse.

log()   { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
error() { printf '%s  ERROR: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

# La próxima versión, derivada del último tag. Con el tag vacío devuelve
# v1.0.0: ese es el primer deploy, y el caso vive acá y no en el llamador
# justamente para que tenga test.
#
# MAJOR se queda en 1 por decisión de producto (CLAUDE.md): esto es un SaaS sin
# API pública. Un tag v2.x.y es señal de que algo lo escribió a mano, así que se
# rechaza en vez de interpretarse.
proxima_version() {
  local ultimo="${1:-}" tipo="${2:-}"

  case "$tipo" in
    minor|patch) ;;
    *) error "tipo de versión inválido: '${tipo}' (válidos: minor, patch)"; return 1 ;;
  esac

  if [[ -z "$ultimo" ]]; then
    printf 'v1.0.0\n'
    return 0
  fi

  if [[ ! "$ultimo" =~ ^v1\.([0-9]+)\.([0-9]+)$ ]]; then
    error "tag con formato inesperado: '${ultimo}' (se espera v1.MINOR.PATCH)"
    return 1
  fi

  local minor="${BASH_REMATCH[1]}" patch="${BASH_REMATCH[2]}"
  # $((...)) y no concatenación de strings: v1.0.9 + patch es v1.0.10.
  if [[ "$tipo" == minor ]]; then
    printf 'v1.%d.0\n' "$((minor + 1))"
  else
    printf 'v1.%d.%d\n' "$minor" "$((patch + 1))"
  fi
}

# ¿El SQL trae algo que rompa el rollback? Exit 0 si SÍ encontró (y lo imprime),
# exit 1 si está limpio. Es la convención de grep, no la de un booleano: en bash
# "encontré" y "todo bien" no pueden ser el mismo 0.
#
# El criterio no es "destruye datos" sino "el código ANTERIOR deja de funcionar
# contra este schema". Por eso entran los renames, que no borran nada: el
# rollback revierte la imagen y no la base, así que una columna renombrada deja
# a la imagen vieja consultando algo que ya no existe.
migracion_destructiva() {
  local sql="${1:-}"

  # Los comentarios se sacan ANTES de buscar. Un "-- acá iba un DROP COLUMN" en
  # una nota no es una migración destructiva; frenar el deploy por eso enseña a
  # ignorar el chequeo. Los de bloque se sacan primero porque pueden contener
  # un `--` adentro.
  local limpio
  limpio=$(printf '%s' "$sql" \
    | perl -0777 -pe 's{/\*.*?\*/}{ }gs' \
    | sed -e 's|--.*$||' \
    | tr '\n' ' ')

  local patron
  for patron in \
    'DROP[[:space:]]+COLUMN' \
    'DROP[[:space:]]+TABLE' \
    'DROP[[:space:]]+SCHEMA' \
    'DROP[[:space:]]+CONSTRAINT' \
    'TRUNCATE' \
    'RENAME[[:space:]]+TO' \
    'RENAME[[:space:]]+COLUMN' \
    'ALTER[[:space:]]+COLUMN[[:space:]]+[^;]*[[:space:]]TYPE[[:space:]]'
  do
    if printf '%s' "$limpio" | grep -qiE "$patron"; then
      printf '%s\n' "$patron"
      return 0
    fi
  done

  return 1
}

# El cuerpo del tag anotado. Lleva lo que el SHA no dice: qué imagen se promovió
# y qué migraciones corrieron en ese deploy. Es lo primero que alguien quiere
# leer a las 11 de la noche.
mensaje_de_tag() {
  local sha="${1:-}" migraciones="${2:-}"
  [[ -n "$sha" ]] || { error "mensaje_de_tag necesita un sha"; return 1; }
  [[ -n "$migraciones" ]] || migraciones="(ninguna)"
  printf 'imagen: arandano-app:%s\nmigraciones: %s\n' "$sha" "$migraciones"
}

# La inversa de mensaje_de_tag: de dónde saca rollback.sh a qué imagen volver.
imagen_de_tag() {
  local mensaje="${1:-}" sha
  sha=$(printf '%s\n' "$mensaje" \
        | sed -nE 's|^imagen: arandano-app:([0-9a-f]+)[[:space:]]*$|\1|p' \
        | head -1)
  if [[ -z "$sha" ]]; then
    error "el mensaje del tag no tiene una línea 'imagen: arandano-app:<sha>'"
    return 1
  fi
  printf '%s\n' "$sha"
}

# Sano es: status ok, AL MENOS un check, y NINGÚN check en false.
#
# Los tres a la vez, y no sólo el status: un `status: ok` con un check caído
# dejaría pasar un deploy con la app conectada como superusuario, que es
# exactamente lo que el check `rol` existe para atrapar. Y cero checks no es
# salud, es ausencia de evidencia.
health_ok() {
  local json="${1:-}"
  printf '%s' "$json" | jq -e '
    .status == "ok"
    and (.checks | length) > 0
    and ([.checks[] | select(.ok != true)] | length) == 0
  ' >/dev/null 2>&1
}

# El SHA que la app dice estar corriendo. deploy.sh lo compara contra el tag que
# promovió: sin eso, un healthcheck en 200 desde el contenedor VIEJO se lee como
# deploy exitoso.
sha_del_health() {
  local json="${1:-}" sha
  sha=$(printf '%s' "$json" | jq -re '.info.sha // empty' 2>/dev/null) || true
  if [[ -z "$sha" ]]; then
    error "el healthcheck no reportó info.sha"
    return 1
  fi
  printf '%s\n' "$sha"
}
