#!/usr/bin/env bash
# Backup de producción: dump, cifrado, subida y aviso.
#
# Se invoca a mano, desde el timer arandano-backup.timer, y desde deploy.sh
# con --motivo=pre-migracion antes de `prisma migrate deploy`.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/backup-comun.sh

MOTIVO=""
CONSERVAR_TEMPORALES=false

uso() {
  cat >&2 <<'EOF'
uso: backup.sh --motivo=<nocturno|pre-migracion|test> [--conservar-temporales]

  --motivo               obligatorio. Entra en el nombre del objeto para que
                         el histórico distinga un backup de rutina de uno
                         tomado antes de una migración. `test` además manda
                         todo al prefijo test/ del bucket.
  --conservar-temporales no borra el directorio de trabajo al salir. Sólo
                         para depurar; deja el dump EN CLARO en disco.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --motivo=*)             MOTIVO="${arg#*=}" ;;
    --conservar-temporales) CONSERVAR_TEMPORALES=true ;;
    -h|--help)              uso ;;
    *) error "argumento desconocido: $arg"; uso ;;
  esac
done

[[ -n "$MOTIVO" ]] || { error "falta --motivo"; uso; }
PREFIJO=$(prefijo_motivo "$MOTIVO")

# El nocturno y un pre-migracion disparado por deploy.sh pueden coincidir.
# Dos pg_dump a la vez sobre 2 vCPU no se rompen entre sí, pero sí compiten
# por la memoria que el presupuesto ya tiene contada una sola vez.
#
# -n (no esperar) y no -w: si ya hay un backup corriendo, el segundo NO tiene
# que encolarse. Encolarse significaría que deploy.sh se queda colgado
# esperando al nocturno, y un deploy bloqueado es peor que un backup salteado
# cuando acaba de correr otro hace un minuto.
exec 9>/var/lock/arandano-backup.lock
if ! flock -n 9; then
  error "ya hay un backup corriendo; esta corrida se saltea"
  exit 1
fi

cargar_config
cargar_env_prod

TS=$(timestamp_utc)

# /var/tmp y NO mktemp a secas: en este host /tmp es tmpfs, así que el dump
# se escribiría en RAM contra el mismo presupuesto de memoria que el sistema
# cuida. Ver docs/superpowers/specs/2026-08-04-backups-design.md.
TRABAJO=$(mktemp -d -p /var/tmp arandano-backup.XXXXXXXX)

# Borra los temporales EN CLARO pase lo que pase, incluida una interrupción a
# mitad de camino. Es la única cosa que no puede quedar tirada en disco.
limpiar() {
  if [[ "$CONSERVAR_TEMPORALES" == true ]]; then
    log "temporales conservados en $TRABAJO (contienen el dump EN CLARO)"
  else
    rm -rf "$TRABAJO"
  fi
}
trap limpiar EXIT
# La unidad de systemd tiene TimeoutStartSec, así que una corrida colgada
# termina recibiendo SIGTERM. Sin este trap, bash muere ahí sin ejecutar el de
# EXIT y deja el dump EN CLARO tirado en /var/tmp — justo lo único que no puede
# quedar en disco. Convertir la señal en un `exit` prolijo dispara el de EXIT.
trap 'exit 143' TERM
trap 'exit 130' INT

log "backup $TS motivo=$MOTIVO prefijo=$PREFIJO"

# --- Paso 1: preflight ------------------------------------------------------
# Todo lo que puede faltar se comprueba ANTES de tocar nada. Un backup que
# falla al final ya gastó el dump; uno que falla acá no gastó nada.
preflight() {
  [[ -r "$ARANDANO_AGE_RECIPIENTS" ]] \
    || { error "no se puede leer $ARANDANO_AGE_RECIPIENTS"; return 1; }

  local destinatarios
  destinatarios=$(grep -c '^age1' "$ARANDANO_AGE_RECIPIENTS" || true)
  [[ "$destinatarios" -eq 2 ]] \
    || { error "se esperaban 2 destinatarios de age, hay $destinatarios"; return 1; }

  local salud
  salud=$(docker inspect -f '{{.State.Health.Status}}' "$ARANDANO_PROD_PG" 2>/dev/null || echo ausente)
  [[ "$salud" == healthy ]] \
    || { error "el Postgres de prod no está healthy (está: $salud)"; return 1; }

  # Cinco veces el tamaño de la base: el dump comprimido más su copia
  # cifrada, con margen. Es barato de comprobar y evita un disco lleno a
  # mitad del dump.
  local tam_base libre necesario
  tam_base=$(pg_efimero psql -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -tAq -c "SELECT pg_database_size(current_database());")
  necesario=$(( tam_base * 5 ))
  libre=$(( $(df --output=avail -B1 /var/tmp | tail -1) ))
  [[ "$libre" -gt "$necesario" ]] \
    || { error "poco espacio en /var/tmp: hay $libre bytes, hacen falta $necesario"; return 1; }

  log "preflight ok (base: $tam_base bytes, libre: $libre)"
}
preflight

# --- Pasos 2 y 4: los dos conteos -------------------------------------------
# El dump es un snapshot tomado ENTRE estos dos números, así que el conteo
# real de cada tabla adentro del dump tiene que caer entre ambos. Eso es lo
# que después le permite a verify-backup.sh exigir un límite DERIVADO en vez
# de una tolerancia inventada.
log "conteo previo"
CONTEO_PREVIO=$(conteos_prod)

# --- Paso 3: dump -----------------------------------------------------------
log "dump"
pg_efimero pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
  > "$TRABAJO/dump"

[[ -s "$TRABAJO/dump" ]] || { error "el dump salió vacío"; exit 1; }
log "dump: $(stat -c%s "$TRABAJO/dump") bytes"

log "conteo posterior"
CONTEO_POSTERIOR=$(conteos_prod)

# --- Globals: los roles del cluster -----------------------------------------
# `pg_dump` de una base NO incluye los roles: son objetos de cluster. Sin este
# archivo, una reconstrucción real recupera las tablas y pierde los roles con
# sus contraseñas — que en esta arquitectura son la frontera de aislamiento
# entre tenants — y un `pg_restore` de un dump con policies de RLS atadas a un
# rol inexistente falla la policy, sale con 1, y la deja afuera.
#
# Se toma DESPUÉS del dump y no antes por una razón chica: si el dump falla, no
# tiene sentido haber gastado nada; y los roles casi no cambian, así que el
# desfase de segundos entre uno y otro no tiene consecuencias.
#
# -l "$POSTGRES_DB" y no el default: pg_dumpall se conecta a la base "postgres"
# si no se le dice otra cosa, y no hay garantía de que exista en este cluster.
log "globals (roles del cluster)"
pg_efimero pg_dumpall --globals-only -h postgres -U "$POSTGRES_USER" \
  -l "$POSTGRES_DB" > "$TRABAJO/globals.sql"

[[ -s "$TRABAJO/globals.sql" ]] || { error "el dump de globals salió vacío"; exit 1; }
log "globals: $(stat -c%s "$TRABAJO/globals.sql") bytes"

# --- Manifiesto -------------------------------------------------------------
# La unión de las claves de los dos conteos, no la intersección: una tabla
# creada o borrada durante el dump tiene que aparecer igual, con 0 del lado
# donde no existía.
jq -n \
  --arg ts "$TS" \
  --arg motivo "$MOTIVO" \
  --arg base "$POSTGRES_DB" \
  --argjson previo "$CONTEO_PREVIO" \
  --argjson posterior "$CONTEO_POSTERIOR" \
  '{
     version: 1,
     timestamp: $ts,
     motivo: $motivo,
     base: $base,
     tablas: (
       (($previo | keys_unsorted) + ($posterior | keys_unsorted) | unique)
       | map({ key: ., value: { previo: ($previo[.] // 0), posterior: ($posterior[.] // 0) } })
       | from_entries
     )
   }' > "$TRABAJO/manifest.json"

log "manifiesto: $(jq -r '.tablas | length' "$TRABAJO/manifest.json") tablas"

# --- Paso 5: secretos -------------------------------------------------------
# El conjunto mínimo para reconstruir el servicio desde cero: sin el .env la
# base restaurada no se puede abrir, y sin el Caddyfile no hay TLS.
log "secretos"
tar -cf "$TRABAJO/secretos.tar" \
  -C /srv/arandano/prod .env Caddyfile

# --- Paso 6: cifrado --------------------------------------------------------
# Dos destinatarios: la clave de custodia (privada fuera del servidor) y la
# de verificación (privada en /etc/arandano/, sólo la usa verify-backup.sh).
# Con una sola, o no hay verificación automática o no hay resistencia a que
# alguien tome el VPS.
log "cifrado"
for f in dump globals.sql manifest.json secretos.tar; do
  age -R "$ARANDANO_AGE_RECIPIENTS" -o "$TRABAJO/$f.age" "$TRABAJO/$f"
done

# --- Paso 7: subida ---------------------------------------------------------
OBJ_DUMP=$(nombre_objeto "$PREFIJO" "$TS" "$MOTIVO" dump)
OBJ_MANIFEST=$(nombre_objeto "$PREFIJO" "$TS" "$MOTIVO" manifest)
OBJ_GLOBALS=$(nombre_objeto "$PREFIJO" "$TS" "$MOTIVO" globals)
OBJ_SECRETOS=$(nombre_objeto "$PREFIJO" "$TS" "$MOTIVO" secretos)

# Releer el tamaño del objeto YA SUBIDO y compararlo contra el local. Un
# `rclone copyto` que sale con 0 dice que el comando terminó, no que del otro
# lado haya quedado el archivo entero.
subir_verificando() {
  local local_path="$1" objeto="$2"
  # Declarado aparte y no en la misma línea que $objeto: bash expande todas
  # las palabras de un `local ... ` en el contexto de quien llama ANTES de
  # correr el builtin, así que "$objeto" ahí adentro leería la variable del
  # scope exterior (sin setear) y no la recién asignada un campo antes.
  local destino="hetzner:$ARANDANO_BUCKET/$objeto"
  local tam_local tam_remoto

  rclone copyto "$local_path" "$destino"

  tam_local=$(stat -c%s "$local_path")
  # lsjson y no `rclone size`: `size` está pensado para directorios y sobre la
  # ruta de un archivo suelto puede devolver 0 objetos, que se leería como
  # "subió vacío" cuando en realidad subió bien.
  tam_remoto=$(rclone lsjson "$destino" | jq -r '.[0].Size // 0')

  if [[ "$tam_local" != "$tam_remoto" ]]; then
    error "$objeto subió incompleto (local: $tam_local, remoto: $tam_remoto)"
    return 1
  fi
  log "subido $objeto ($tam_local bytes)"
}

subir_verificando "$TRABAJO/dump.age"          "$OBJ_DUMP"
subir_verificando "$TRABAJO/globals.sql.age"   "$OBJ_GLOBALS"
subir_verificando "$TRABAJO/manifest.json.age" "$OBJ_MANIFEST"
subir_verificando "$TRABAJO/secretos.tar.age"  "$OBJ_SECRETOS"

# --- Paso 8: expiración -----------------------------------------------------
# No hay nada acá, y es a propósito. La retención de 30 días la aplica una
# regla de ciclo de vida DEL BUCKET, no este script. Dos razones:
#
#   - La credencial que vive en el servidor no NECESITA permiso de borrado.
#     Ojo con la inferencia de más: hoy esa credencial SÍ puede borrar (el
#     bucket no tiene versionado, ni object lock, ni bucket policy), así que
#     esto no protege el histórico de alguien que tome root en el VPS. Ver
#     docs/runbook-backups.md, sección 1, para la mitigación pendiente.
#   - Un borrado desde el script que corriera aunque la subida fallara iría
#     comiéndose el histórico un día por vez hasta dejar el bucket vacío. El
#     sistema pensado para protegerte sería el que te deja sin nada, en
#     silencio.
#
# La suite `backup` de verify-infra.sh comprueba el EFECTO de la regla (que
# no haya objetos más viejos que la retención), no su configuración.

# --- Paso 9: ping -----------------------------------------------------------
# Únicamente si los ocho pasos anteriores salieron bien. `set -e` garantiza
# que cualquier falla previa ya salió del script sin llegar hasta acá.
#
# La alarma llega por AUSENCIA de señal, no por un mensaje de error que
# también podría fallar. Es lo que hace que un timer muerto, un disco lleno o
# un servidor apagado se detecten igual que un error del script — y es
# exactamente el modo de falla que un mail de error no cubre.
#
# Y SÓLO desde el prefijo real. El check de healthchecks.io significa "el
# histórico de producción tiene un backup nuevo"; una corrida con --motivo=test
# escribe únicamente en test/ y no puede afirmar eso. Pingar igual convertiría
# el paso de diagnóstico que el runbook manda correr cuando el dead man's
# switch avisa (sección 5, paso 4) en el comando que APAGA la alarma mientras
# prod/db/ sigue sin backups nuevos: el operador seguiría el procedimiento al
# pie de la letra y se quedaría sin la única señal que tenía.
if [[ "$PREFIJO" == prod ]]; then
  ping_dms "${ARANDANO_DMS_BACKUP_URL:-}"
  log "listo (dead man's switch pingado)"
else
  # Dicho en voz alta y no en silencio: un log que no menciona el ping no
  # distingue "no correspondía pingar" de "el ping se olvidó".
  log "listo (prefijo=$PREFIJO: NO se pinga el dead man's switch, que sólo habla del histórico de prod)"
fi
