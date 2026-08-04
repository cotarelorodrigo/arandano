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

# El nombre del contenedor es fijo, así que dos corridas simultáneas no se
# ignoran entre sí: la segunda falla al crearlo y su `trap` de limpieza borra el
# contenedor de la PRIMERA a mitad del restore. Es decir, la corrida sana termina
# reportando un backup roto — el peor falso negativo posible en el único
# mecanismo que prueba que los backups sirven.
#
# Lock PROPIO y distinto del de backup.sh: la verificación y el backup no
# compiten por lo mismo (uno lee el bucket y levanta un Postgres descartable, el
# otro dumpea producción), y compartir lock haría que un backup en curso saltee
# la verificación semanal entera.
#
# -n y no -w, igual que en backup.sh: si ya hay una verificación corriendo, la
# segunda no tiene nada que aportar esperando.
exec 8>/var/lock/arandano-verify-backup.lock
if ! flock -n 8; then
  error "ya hay una verificación corriendo; esta corrida se saltea"
  exit 1
fi

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
# Los globals son parte del backup, no un extra: sin ellos el pg_restore de un
# dump con policies de RLS atadas a un rol de aplicación falla. Que la bajada
# sea obligatoria (y no un `|| true`) es a propósito: un backup al que le falta
# el objeto de roles NO es un backup verificable.
rclone copyto "hetzner:$ARANDANO_BUCKET/$PREFIJO/db/$BASE.globals.sql.age" \
  "$TRABAJO/globals.sql.age"

age -d -i "$ARANDANO_AGE_VERIFY_KEY" -o "$TRABAJO/dump" "$TRABAJO/dump.age"
age -d -i "$ARANDANO_AGE_VERIFY_KEY" -o "$TRABAJO/manifest.json" "$TRABAJO/manifest.json.age"
age -d -i "$ARANDANO_AGE_VERIFY_KEY" -o "$TRABAJO/globals.sql" "$TRABAJO/globals.sql.age"

# `has("tablas")` en la MISMA guarda que la versión, y no más abajo: un
# manifiesto sin esa clave verificaba en verde. `.tablas | length` sobre una
# clave ausente devuelve 0 sin error, y el `while … done < <(jq …)` de más
# abajo tampoco lo salva, porque una sustitución de proceso no participa de
# `pipefail` y su fallo no llega al script. O sea: cero tablas comparadas y
# verificación exitosa sobre un manifiesto que no dice nada.
jq -e '.version == 1 and has("tablas")' "$TRABAJO/manifest.json" >/dev/null \
  || { error "el manifiesto no tiene version 1 con la clave 'tablas'"; exit 1; }

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

# --- Roles, ANTES del restore -----------------------------------------------
# El orden no es negociable: las policies de RLS que trae el dump nombran roles,
# y `CREATE POLICY … TO app_rls` contra un cluster que no tiene ese rol falla
# con "role does not exist", hace salir a pg_restore con 1 y deja la policy sin
# crear. Reproducido en contenedores limpios antes de escribir esto.
#
# ON_ERROR_STOP queda en 0 a propósito y el veredicto se saca leyendo la salida,
# no el exit code (psql sale 0 igual): --globals-only incluye el rol
# superusuario del cluster de ORIGEN, que puede llamarse igual que el de esta
# base descartable, y entonces su CREATE ROLE choca. Ese choque es esperado y no
# significa nada; cualquier OTRO error sí, y por eso se filtra por el mensaje
# exacto en vez de ignorar todo el paso.
#
# El `ALTER ROLE … PASSWORD` que viene detrás puede cambiarle la contraseña al
# superusuario de esta base si los nombres coinciden. No rompe nada porque todo
# lo que sigue entra por el socket local del contenedor, que la imagen deja en
# `trust`; el `-e PGPASSWORD` de los `docker exec` no se usa para autenticar.
log "aplicando globals (roles del cluster)"
docker cp "$TRABAJO/globals.sql" "$CONTENEDOR:/tmp/globals.sql"
salida_globals=$(docker exec "$CONTENEDOR" \
  psql -U verificacion -d verificacion -f /tmp/globals.sql 2>&1) || true

errores_globals=$(printf '%s\n' "$salida_globals" \
  | grep 'ERROR:' | grep -vE 'ERROR: +role ".+" already exists' || true)
if [[ -n "$errores_globals" ]]; then
  error "el archivo de globals dio errores que no son colisiones de rol:"
  printf '%s\n' "$errores_globals" >&2
  exit 1
fi
log "globals aplicados ($(docker exec "$CONTENEDOR" psql -U verificacion -d verificacion -tAq \
  -c 'SELECT count(*) FROM pg_roles;') roles en el cluster descartable)"

# --- Restaurar --------------------------------------------------------------
# --no-owner --no-acl se mantiene aunque los roles ahora existan: lo que se
# verifica acá es que los DATOS estén enteros, y hacer depender esa prueba de
# los permisos del cluster de origen le sumaría un modo de falla que no tiene
# nada que ver con el backup. En una reconstrucción REAL estos dos flags NO van
# — ver docs/runbook-backups.md, sección 4.
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
#
# Y sólo desde el prefijo real, por lo mismo que en backup.sh: el check afirma
# "el último backup del histórico de producción restaura bien". Una corrida con
# --prefijo=test verifica otra cosa (un artefacto de prueba, posiblemente de
# hace días) y no puede firmar esa afirmación. Si pingara igual, el comando que
# el runbook manda usar para diagnosticar apagaría la alarma que lo convocó.
if [[ "$PREFIJO" == prod ]]; then
  ping_dms "${ARANDANO_DMS_VERIFY_URL:-}"
  log "verificación ok sobre $ULTIMO (dead man's switch pingado)"
else
  log "verificación ok sobre $ULTIMO (prefijo=$PREFIJO: NO se pinga el dead man's switch, que sólo habla del histórico de prod)"
fi
