#!/usr/bin/env bash
# Verificación semanal: baja el último backup, lo restaura en un Postgres
# descartable y compara los conteos contra el manifiesto.
#
# Un backup que nunca se restauró no es un backup. Esto es el test de
# integración del sistema entero, y corre contra artefactos reales.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/backup-comun.sh

PREFIJO=prod
for arg in "$@"; do
  case "$arg" in
    --prefijo=*) PREFIJO="${arg#*=}" ;;
    -h|--help)   echo "uso: verify-backup.sh [--prefijo=<prod|test>]" >&2; exit 2 ;;
    *) error "argumento desconocido: $arg"; exit 2 ;;
  esac
done
[[ "$PREFIJO" == prod || "$PREFIJO" == test ]] \
  || { error "prefijo inválido: $PREFIJO"; exit 2; }

cargar_config
cargar_env_prod

readonly CONTENEDOR=arandano-verify-pg

# /var/tmp, no /tmp: acá se escribe el dump DESCIFRADO, y /tmp es tmpfs.
TRABAJO=$(mktemp -d -p /var/tmp arandano-verify.XXXXXXXX)

limpiar() {
  docker rm -f "$CONTENEDOR" >/dev/null 2>&1 || true
  rm -rf "$TRABAJO"
}
trap limpiar EXIT

# --- Encontrar el más reciente ---------------------------------------------
# Los nombres son ordenables alfabéticamente == cronológicamente, así que
# `sort | tail -1` alcanza y no hace falta pedirle fechas al proveedor.
log "buscando el último backup en $PREFIJO/db/"
ULTIMO=$(rclone lsf "hetzner:$ARANDANO_BUCKET/$PREFIJO/db/" --include '*.dump.age' \
         | sort | tail -1)
[[ -n "$ULTIMO" ]] || { error "no hay ningún backup en $PREFIJO/db/"; exit 1; }

BASE="${ULTIMO%.dump.age}"
log "verificando $ULTIMO"

# --- Bajar y descifrar ------------------------------------------------------
rclone copyto "hetzner:$ARANDANO_BUCKET/$PREFIJO/db/$ULTIMO" "$TRABAJO/dump.age"
rclone copyto "hetzner:$ARANDANO_BUCKET/$PREFIJO/db/$BASE.manifest.json.age" \
  "$TRABAJO/manifest.json.age"

age -d -i "$ARANDANO_AGE_VERIFY_KEY" -o "$TRABAJO/dump" "$TRABAJO/dump.age"
age -d -i "$ARANDANO_AGE_VERIFY_KEY" -o "$TRABAJO/manifest.json" "$TRABAJO/manifest.json.age"

jq -e '.version == 1' "$TRABAJO/manifest.json" >/dev/null \
  || { error "el manifiesto no tiene version 1"; exit 1; }

# --- Guarda anti-vacío ------------------------------------------------------
# Un dump vacío también restaura limpio, así que sin esto la verificación
# pasaría en verde para siempre sobre un backup que no guarda nada.
#
# Está expresada contra el ESTADO VIVO de producción y no contra una
# constante en el script, a propósito: hoy arandano_prod tiene 0 tablas y la
# guarda no exige nada. El día que aterrice el schema de Prisma empieza a
# exigir sola, sin que nadie se tenga que acordar de actualizar un número.
TABLAS_PROD=$(conteos_prod | jq 'length')
TABLAS_MANIFIESTO=$(jq '.tablas | length' "$TRABAJO/manifest.json")
if [[ "$TABLAS_PROD" -gt 0 && "$TABLAS_MANIFIESTO" -eq 0 ]]; then
  error "producción tiene $TABLAS_PROD tablas y el manifiesto ninguna: el backup está vacío"
  exit 1
fi
log "guarda anti-vacío ok (prod: $TABLAS_PROD tablas, manifiesto: $TABLAS_MANIFIESTO)"

# --- Postgres descartable ---------------------------------------------------
# tmpfs de 320m bajo --memory=512m, con PGDATA en un SUBDIRECTORIO: son los
# mismos valores ya probados en compose.stage.yml. Las páginas de tmpfs se
# cargan contra la memoria del cgroup y no son page cache descartable, así
# que cuentan 1:1 contra el límite; igualar los dos números hace que el
# cgroup mate al contenedor antes de llenar el tmpfs. Montar el tmpfs
# directo sobre el directorio de datos lo deja como root y initdb falla.
log "levantando Postgres descartable"
docker run -d --name "$CONTENEDOR" \
  --memory=512m --cpus=0.5 \
  --tmpfs /var/lib/postgresql/data:size=320m,mode=1777 \
  -e POSTGRES_USER=verificacion \
  -e POSTGRES_PASSWORD=verificacion \
  -e POSTGRES_DB=verificacion \
  -e PGDATA=/var/lib/postgresql/data/pgdata \
  "$ARANDANO_PG_IMAGE" >/dev/null

# Esperar por CONDICIÓN, no por un sleep arbitrario — pero NO alcanza con el
# primer pg_isready en verde. El entrypoint de esta imagen levanta un
# servidor TEMPORAL para correr los scripts de init (crear la base
# "verificacion"), lo apaga, y recién ahí arranca el DEFINITIVO; pg_isready
# contesta "accepting connections" contra los dos por igual, mismo socket,
# dos vidas. Cortar en el primer verde es una carrera: puede caer justo
# cuando el temporal está apagándose y dejar el `pg_restore` de más abajo
# contra un server que ya respondió "the database system is shutting down"
# (reproducido: dos corridas idénticas, la primera falló así, la segunda no).
# La señal inequívoca es la SEGUNDA aparición de esta línea de log, que sólo
# la emite el servidor definitivo.
contador_listo() {
  docker logs "$CONTENEDOR" 2>&1 \
    | grep -c 'database system is ready to accept connections' || true
}
for _ in $(seq 1 60); do
  [[ "$(contador_listo)" -ge 2 ]] && break
  sleep 1
done
[[ "$(contador_listo)" -ge 2 ]] \
  || { error "el Postgres descartable no levantó en 60s"; exit 1; }

# --- Restaurar --------------------------------------------------------------
# --no-owner --no-acl porque esta base no tiene los roles de producción. El
# dump SÍ los preserva, que es lo que corresponde para una recuperación real;
# lo que se relaja es la restauración de prueba, no lo guardado.
log "restaurando"
docker cp "$TRABAJO/dump" "$CONTENEDOR:/tmp/dump"
docker exec -e PGPASSWORD=verificacion "$CONTENEDOR" \
  pg_restore --no-owner --no-acl -U verificacion -d verificacion /tmp/dump

# --- Comparar ---------------------------------------------------------------
CONTEOS_RESTAURADOS=$(docker exec -e PGPASSWORD=verificacion "$CONTENEDOR" \
  psql -U verificacion -d verificacion -tAq -c "$SQL_CONTEOS")

fallas=0
while IFS=$'\t' read -r tabla previo posterior; do
  restaurado=$(jq -r --arg t "$tabla" '.[$t] // "ausente"' <<<"$CONTEOS_RESTAURADOS")

  if [[ "$restaurado" == ausente ]]; then
    error "la tabla $tabla del manifiesto no existe en la base restaurada"
    fallas=$((fallas + 1))
  elif conteo_en_banda "$previo" "$posterior" "$restaurado"; then
    log "  ✓ $tabla: $restaurado (banda $previo..$posterior)"
  else
    error "  ✗ $tabla: $restaurado fuera de la banda $previo..$posterior"
    fallas=$((fallas + 1))
  fi
done < <(jq -r '.tablas | to_entries[] | "\(.key)\t\(.value.previo)\t\(.value.posterior)"' \
         "$TRABAJO/manifest.json")

[[ "$fallas" -eq 0 ]] || { error "$fallas tabla(s) no verifican"; exit 1; }

# Su PROPIO check, distinto del de backup.sh. Si compartieran uno, una
# verificación sana taparía un backup que dejó de correr — justo la falla que
# hay que ver.
ping_dms "${ARANDANO_DMS_VERIFY_URL:-}"
log "verificación ok sobre $ULTIMO"
