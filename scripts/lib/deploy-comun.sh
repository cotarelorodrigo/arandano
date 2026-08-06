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
# contra este schema" (la lista de patrones de abajo es una implementación de
# ESE criterio, no el criterio en sí — si aparece un caso nuevo que lo cumple,
# el patrón que falta se agrega, no se discute el criterio). Por eso entran los
# renames, que no borran nada: el rollback revierte la imagen y no la base, así
# que una columna renombrada deja a la imagen vieja consultando algo que ya no
# existe. Por la misma razón entra SET NOT NULL: Prisma lo emite cada vez que
# un campo opcional pasa a requerido, y la imagen vieja sigue insertando filas
# sin esa columna — el caso más común de todos, y el que más duele si se
# escapa.
migracion_destructiva() {
  local sql="${1:-}"

  # Los comentarios se sacan ANTES de buscar. Un "-- acá iba un DROP COLUMN" en
  # una nota no es una migración destructiva; frenar el deploy por eso enseña a
  # ignorar el chequeo. Los de bloque se sacan primero porque pueden contener
  # un `--` adentro.
  #
  # Límite conocido y no cerrado del todo: si un `--` apareciera DENTRO de un
  # literal de string (algo que Prisma nunca emite, pero una migración de
  # datos o de RLS escrita a mano sí podría), este `sed` se comería el resto
  # de la línea, incluido un `;` real, y `tr '\n' ' '` fusionaría dos
  # sentencias en una. Por eso ningún patrón de abajo usa un comodín sin fondo
  # tipo `[^;]*` que pueda cruzar esa fusión: donde hace falta separar un
  # identificador de columna del resto de la sentencia (ALTER COLUMN ...
  # TYPE), el patrón exige que venga entre comillas dobles pegado a "COLUMN"
  # en vez de admitir cualquier cosa hasta el próximo `;`. Lo que queda
  # abierto DESPUÉS de ese cierre sólo puede sobre-disparar, nunca
  # sub-disparar: la búsqueda es por keyword sobre texto ya aplanado, y una
  # fusión espuria sólo puede crear una adyacencia que no existía en el SQL
  # original (falso positivo, frena algo inocente), nunca borrar un keyword
  # destructivo que sí estaba (falso negativo, dejar pasar algo peligroso).
  # Es una categoría de problema distinta y mucho más barata: un gate
  # conservador que a veces frena de más se nota y se revisa a mano; uno que
  # deja pasar de menos no se nota hasta que ya es tarde.
  #
  # Fallar CERRADO si la etapa de `perl` se rompe (el caso real: falta del
  # PATH), chequeando SU exit code puntual — no si el resultado final quedó
  # vacío. Esto importa porque una migración que es PURAMENTE un comentario
  # (lo que escribe `prisma migrate dev --create-only` en una migración
  # vacía: "-- This is an empty migration.") también queda vacía después de
  # limpiar, y confundir esos dos casos convertía un comentario inocente en
  # "fallando cerrado (¿falta perl?)" — un falso positivo que además mentía
  # sobre la causa, el mismo tipo de ruido que enseña a saltear el gate.
  #
  # Este chequeo depende de que `perl` sea la ÚLTIMA etapa de ESTE pipeline:
  # `$(...)` propaga el exit code del último comando de la tubería. Agregar
  # algo después de `perl` acá (otro `sed`, por ejemplo) volvería este `if`
  # ciego a que `perl` fallara, en silencio.
  local sin_bloques
  if ! sin_bloques=$(printf '%s' "$sql" | perl -0777 -pe 's{/\*.*?\*/}{ }gs' 2>/dev/null); then
    error "migracion_destructiva: perl falló limpiando comentarios de bloque (¿falta del PATH?); fallando cerrado"
    printf 'pipeline de limpieza roto (perl falló)\n'
    return 0
  fi

  # Misma lógica para la segunda tubería: `sed` y `tr` no fallan casi nunca,
  # pero "casi nunca" no es "nunca" en una máquina que buildea con 2 GiB de
  # cupo (ver CLAUDE.md) — un `fork: Cannot allocate memory` acá deja pasar
  # una migración destructiva por el único gate que existe. `set -o pipefail`
  # va DENTRO del subshell del command substitution, no afuera: así no toca
  # las opciones del script que haya sourceado esta lib. Con las tres etapas
  # sanas el pipe sale 0 igual que antes, aunque el resultado sea texto
  # vacío (el caso de la migración de puro comentario sigue leyendo aditiva).
  local limpio
  if ! limpio=$(set -o pipefail; printf '%s' "$sin_bloques" | sed -e 's|--.*$||' | tr '\n' ' '); then
    error "migracion_destructiva: sed o tr fallaron limpiando comentarios de línea; fallando cerrado"
    printf 'pipeline de limpieza roto (sed o tr fallaron)\n'
    return 0
  fi

  # DROP CONSTRAINT seguido de un ADD CONSTRAINT del MISMO nombre en la misma
  # migración no es destructivo: es el patrón que Prisma emite para cualquier
  # cambio de relación (agregar onDelete: Cascade, volver opcional una FK) —
  # recrea la constraint, no la elimina, y el código anterior no depende de que
  # exista con ese nombre puntual entre un statement y el otro. Bloquearlo es
  # justo el tipo de falso positivo que enseña a saltear el gate. Un DROP
  # CONSTRAINT sin su ADD sigue siendo destructivo, y uno cuyo nombre no
  # podemos extraer entre comillas (Prisma siempre cita identificadores; algo
  # escrito a mano podría no hacerlo) se trata como destructivo por no poder
  # verificar el emparejamiento — de nuevo, fallar cerrado y no abierto.
  if printf '%s' "$limpio" | grep -qiE 'DROP[[:space:]]+CONSTRAINT'; then
    local dropeadas agregadas nombre sin_nombre
    dropeadas=$(printf '%s' "$limpio" \
      | grep -oiE 'DROP[[:space:]]+CONSTRAINT[[:space:]]+"[^"]+"' \
      | sed -E 's/.*"([^"]+)"/\1/')
    agregadas=$(printf '%s' "$limpio" \
      | grep -oiE 'ADD[[:space:]]+CONSTRAINT[[:space:]]+"[^"]+"' \
      | sed -E 's/.*"([^"]+)"/\1/')

    sin_nombre=$(printf '%s' "$limpio" | grep -oiE 'DROP[[:space:]]+CONSTRAINT' | wc -l)
    if [[ "$sin_nombre" -gt "$(printf '%s\n' "$dropeadas" | grep -c . || true)" ]]; then
      printf 'DROP CONSTRAINT sin nombre entre comillas (no se puede verificar el emparejamiento)\n'
      return 0
    fi

    while IFS= read -r nombre; do
      [[ -n "$nombre" ]] || continue
      if ! grep -qxF "$nombre" <<<"$agregadas"; then
        printf 'DROP CONSTRAINT "%s" sin ADD CONSTRAINT correspondiente\n' "$nombre"
        return 0
      fi
    done <<<"$dropeadas"
  fi

  local patron
  for patron in \
    'DROP[[:space:]]+COLUMN' \
    'DROP[[:space:]]+TABLE' \
    'DROP[[:space:]]+SCHEMA' \
    'DROP[[:space:]]+TYPE' \
    'DROP[[:space:]]+INDEX' \
    'DROP[[:space:]]+VIEW' \
    'DROP[[:space:]]+DEFAULT' \
    '\bTRUNCATE\b' \
    'RENAME[[:space:]]+TO' \
    'RENAME[[:space:]]+COLUMN' \
    'RENAME[[:space:]]+VALUE' \
    'SET[[:space:]]+NOT[[:space:]]+NULL' \
    'ALTER[[:space:]]+COLUMN[[:space:]]+"[^"]+"[[:space:]]+(SET[[:space:]]+DATA[[:space:]]+)?TYPE[[:space:]]'
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
