#!/usr/bin/env bash
# Contrato compartido entre backup.sh y verify-backup.sh.
#
# Lo que comparten estos dos scripts NO es estado de runtime: es FORMATO. Uno
# escribe los nombres de objeto y el manifiesto, el otro los lee. Duplicar eso
# en dos archivos es exactamente cómo se desincronizan, y el modo de falla
# sería que la verificación deje de encontrar lo que el backup guardó — en
# silencio, hasta el día que haga falta restaurar.
#
# Este archivo sólo define funciones. No ejecuta nada al sourcearse.

# Sourcearlo dos veces no debe romper por los `readonly`. Con `if` explícito
# y no `[[ ... ]] && return`: bajo `set -e` esa forma depende de una excepción
# sutil de errexit para las listas `&&`, y no vale apoyarse en eso.
if [[ -n "${BACKUP_COMUN_CARGADO:-}" ]]; then
  return 0
fi
readonly BACKUP_COMUN_CARGADO=1

readonly ARANDANO_CONF=/etc/arandano/backup.env
readonly ARANDANO_PROD_ENV=/srv/arandano/prod/.env
readonly ARANDANO_PG_IMAGE=postgres:17-alpine
readonly ARANDANO_PROD_NET=arandano-prod_default
readonly ARANDANO_PROD_PG=arandano-prod-postgres-1

# Un JSON {tabla: conteo} de todo el schema public, en UNA sola consulta.
# query_to_xml corre un count(*) por tabla del lado del servidor; la
# alternativa era un round-trip por tabla desde bash.
# coalesce para que una base sin tablas devuelva {} y no NULL — hoy
# arandano_prod está exactamente así.
readonly SQL_CONTEOS="
SELECT coalesce(json_object_agg(t, n), '{}'::json)::text FROM (
  SELECT c.relname AS t,
         (xpath('/row/c/text()',
                query_to_xml(format('SELECT count(*) AS c FROM public.%I', c.relname),
                             false, true, '')))[1]::text::bigint AS n
  FROM pg_class c
  JOIN pg_namespace ns ON ns.oid = c.relnamespace
  WHERE ns.nspname = 'public' AND c.relkind = 'r'
) s;"

log() { printf '%s  %s\n' "$(date -u +%H:%M:%S)" "$*"; }
error() { printf '%s  ERROR: %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }

timestamp_utc() { date -u +%Y-%m-%dT%H-%M-%SZ; }

# Sourcea la config y falla ruidosamente si falta algo. Que falte una
# variable tiene que abortar en el preflight, no a mitad de una subida.
cargar_config() {
  if [[ ! -r "$ARANDANO_CONF" ]]; then
    error "no se puede leer $ARANDANO_CONF"
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ARANDANO_CONF"
  set +a

  local faltan=() v
  for v in ARANDANO_BUCKET ARANDANO_AGE_RECIPIENTS ARANDANO_AGE_VERIFY_KEY \
           RCLONE_CONFIG_HETZNER_TYPE RCLONE_CONFIG_HETZNER_ENDPOINT \
           RCLONE_CONFIG_HETZNER_ACCESS_KEY_ID \
           RCLONE_CONFIG_HETZNER_SECRET_ACCESS_KEY; do
    [[ -n "${!v:-}" ]] || faltan+=("$v")
  done
  if [[ ${#faltan[@]} -gt 0 ]]; then
    error "faltan variables en $ARANDANO_CONF: ${faltan[*]}"
    return 1
  fi
}

# Credenciales de la base de producción. Se leen del .env que ya usa el
# stack; nunca se duplican en backup.env.
cargar_env_prod() {
  if [[ ! -r "$ARANDANO_PROD_ENV" ]]; then
    error "no se puede leer $ARANDANO_PROD_ENV"
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ARANDANO_PROD_ENV"
  set +a
  [[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_PASSWORD:-}" && -n "${POSTGRES_DB:-}" ]] || {
    error "$ARANDANO_PROD_ENV no define POSTGRES_USER/PASSWORD/DB"
    return 1
  }
}

# test es el único motivo que además cambia el prefijo: sus objetos no deben
# entrar en el histórico real ni contar para la expiración.
prefijo_motivo() {
  case "${1:-}" in
    nocturno|pre-migracion) echo prod ;;
    test)                   echo test ;;
    *) error "motivo inválido: ${1:-<vacío>} (válidos: nocturno, pre-migracion, test)"; return 2 ;;
  esac
}

# Ordenables alfabéticamente, que acá es lo mismo que cronológicamente.
nombre_objeto() {
  local prefijo="${1:-}" ts="${2:-}" motivo="${3:-}" tipo="${4:-}"
  case "$tipo" in
    dump)     echo "$prefijo/db/$ts-$motivo.dump.age" ;;
    manifest) echo "$prefijo/db/$ts-$motivo.manifest.json.age" ;;
    secretos) echo "$prefijo/secretos/$ts.tar.age" ;;
    *) error "tipo de objeto inválido: ${tipo:-<vacío>}"; return 2 ;;
  esac
}

# min(previo,posterior) <= restaurado <= max(previo,posterior).
#
# El dump es un snapshot consistente tomado en algún instante ENTRE los dos
# conteos, así que el valor real tiene que caer entre ambos. Es un límite
# derivado de la mecánica del dump, no una tolerancia inventada: la banda se
# abre sola tanto como haya escrito el negocio durante el dump, y ni un poco
# más. No asume previo <= posterior, porque una tabla puede encoger.
conteo_en_banda() {
  local previo="$1" posterior="$2" restaurado="$3" min max
  if (( previo <= posterior )); then min=$previo; max=$posterior
  else min=$posterior; max=$previo; fi
  (( restaurado >= min && restaurado <= max ))
}

# El ping es la señal de vida. Una URL vacía tiene que ser un ERROR y no un
# no-op: si no, un backup.env mal escrito produce backups que nunca avisan y
# un dead man's switch que suena para siempre sin causa visible.
ping_dms() {
  local url="${1:-}"
  if [[ -z "$url" ]]; then
    error "ping_dms recibió una URL vacía"
    return 1
  fi
  curl -fsS --retry 3 --retry-delay 5 --max-time 30 "$url" >/dev/null
}

# Un cliente de Postgres efímero sobre la red de prod. El host no tiene psql
# ni pg_dump y no hace falta que los tenga; además la imagen garantiza que la
# versión del cliente coincida con la del servidor.
#
# Contenedor APARTE y no `docker exec` en el Postgres de producción: el dump
# no debe competir contra el mem_limit de 1536 MiB de la base que está
# sirviendo clientes.
#
# --memory y --cpus SÍ funcionan en `docker run`. Son inertes en
# `docker build`, que es otro comando (ver docs/runbook-stacks.md).
pg_efimero() {
  docker run --rm --network "$ARANDANO_PROD_NET" \
    --memory=512m --cpus=0.5 \
    -e PGPASSWORD="$POSTGRES_PASSWORD" \
    "$ARANDANO_PG_IMAGE" "$@"
}

# Devuelve el JSON {tabla: conteo} de la base de producción.
conteos_prod() {
  pg_efimero psql -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    -tAq -c "$SQL_CONTEOS"
}
