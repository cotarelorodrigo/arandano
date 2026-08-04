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
