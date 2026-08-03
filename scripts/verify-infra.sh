#!/usr/bin/env bash
# Verificación re-ejecutable de la infraestructura.
# CLAUDE.md: los límites son la única defensa entre un build y un cliente
# caído, así que comprobar que siguen puestos es parte del checklist de
# deploy — no algo que se configura una vez y se olvida.
set -uo pipefail

readonly TS_IP=100.64.81.63
readonly PUBLIC_IP=178.156.251.41

PASS=0
FAIL=0

suite_header() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

# check_cmd "descripción" comando...  → pasa si el comando sale con 0
check_cmd() {
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then ok "$desc"; else bad "$desc"; fi
}

# check_eq "descripción" esperado obtenido
check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    ok "$desc"
  else
    bad "$desc (esperado: $expected, obtenido: $actual)"
  fi
}

# check_ge "descripción" mínimo obtenido
check_ge() {
  local desc="$1" minimum="$2" actual="$3"
  if [[ "$actual" -ge "$minimum" ]]; then
    ok "$desc"
  else
    bad "$desc (mínimo: $minimum, obtenido: $actual)"
  fi
}

suite_host() {
  suite_header "Host: swap y Docker"

  local swap_mb
  swap_mb=$(free -m | awk '/^Swap:/ {print $2}')
  check_ge "swap de al menos 4 GB" 4000 "${swap_mb:-0}"

  check_eq "vm.swappiness en 10" "10" "$(sysctl -n vm.swappiness 2>/dev/null || echo NA)"
  check_cmd "swap persistida en /etc/fstab" grep -q '^/swapfile' /etc/fstab

  check_cmd "docker instalado" command -v docker
  check_cmd "plugin docker compose disponible" docker compose version

  local log_max live_restore
  log_max=$(docker info --format '{{.LoggingDriver}}' 2>/dev/null || echo NA)
  check_eq "log driver json-file" "json-file" "$log_max"

  check_cmd "daemon.json con rotación de logs" \
    grep -q '"max-size"' /etc/docker/daemon.json
  live_restore=$(docker info --format '{{.LiveRestoreEnabled}}' 2>/dev/null || echo NA)
  check_eq "live-restore activado" "true" "$live_restore"
}

suite_app() {
  suite_header "App: healthcheck con contenido real"

  local code body
  code=$(curl -s -o /tmp/ngf-health.json -w '%{http_code}' \
    "http://$TS_IP:3000/api/health" 2>/dev/null || echo 000)
  check_eq "healthcheck de dev devuelve 200" "200" "$code"

  body=$(cat /tmp/ngf-health.json 2>/dev/null || echo '{}')
  check_cmd "reporta el check de app" grep -q '"name":"app"' /tmp/ngf-health.json
  check_cmd "reporta el check de postgres" \
    grep -q '"name":"postgres"' /tmp/ngf-health.json
  check_cmd "el check de app expone el SHA" grep -q 'sha=' /tmp/ngf-health.json
}

suite_network() {
  suite_header "Red: dev y stage sólo por Tailscale"

  # Chequeo 4 de la spec: el bind, no el firewall, es lo que protege.
  local bad_binds
  bad_binds=$(ss -ltn 2>/dev/null | awk '{print $4}' \
    | grep -E '^(0\.0\.0\.0|\*):(3000|3001|5433)$' | wc -l)
  check_eq "puertos de dev/stage no escuchan en 0.0.0.0" "0" "$bad_binds"

  check_cmd "puerto 3000 escucha en la IP de Tailscale" \
    bash -c "ss -ltn | grep -q '$TS_IP:3000'"

  # Desde la IP pública debe rechazar la conexión.
  if timeout 3 bash -c "</dev/tcp/$PUBLIC_IP/3000" 2>/dev/null; then
    bad "puerto 3000 alcanzable desde la IP pública"
  else
    ok "puerto 3000 no alcanzable desde la IP pública"
  fi
}

suite_limits() {
  suite_header "Límites: prod por peso, dev por cap duro"

  # mem_limit se lee en bytes desde la API de Docker.
  local dev_app_mem prod_pg_mem prod_pg_oom dev_app_cpu
  dev_app_mem=$(docker inspect ngf-dev-app-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "dev app con 1536m de límite" "1610612736" "$dev_app_mem"

  prod_pg_mem=$(docker inspect ngf-prod-postgres-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "prod postgres con 1536m de límite" "1610612736" "$prod_pg_mem"

  prod_pg_oom=$(docker inspect ngf-prod-postgres-1 \
    --format '{{.HostConfig.OomScoreAdj}}' 2>/dev/null || echo 0)
  check_eq "prod postgres con oom_score_adj -500" "-500" "$prod_pg_oom"

  # NanoCpus: 0.75 core = 750000000
  dev_app_cpu=$(docker inspect ngf-dev-app-1 \
    --format '{{.HostConfig.NanoCpus}}' 2>/dev/null || echo 0)
  check_eq "dev app capada a 0.75 cores" "750000000" "$dev_app_cpu"

  # Prod NO debe tener cap: gana por peso, no por reserva.
  local prod_app_cpu
  prod_app_cpu=$(docker inspect ngf-prod-app-1 \
    --format '{{.HostConfig.NanoCpus}}' 2>/dev/null || echo -1)
  check_eq "prod app sin cap de CPU" "0" "$prod_app_cpu"
}

suite_isolation() {
  suite_header "Aislamiento entre stacks"

  check_cmd "volumen de prod existe" docker volume inspect ngf-prod_pgdata
  check_cmd "volumen de dev existe" docker volume inspect ngf-dev_pgdata

  # Redes separadas: dev no puede resolver el Postgres de prod.
  local dev_net prod_net
  dev_net=$(docker network ls --format '{{.Name}}' | grep -c '^ngf-dev_default$')
  prod_net=$(docker network ls --format '{{.Name}}' | grep -c '^ngf-prod_default$')
  check_eq "dev tiene su propia red" "1" "$dev_net"
  check_eq "prod tiene su propia red" "1" "$prod_net"

  if docker exec ngf-dev-app-1 getent hosts postgres 2>/dev/null \
     | grep -q .; then
    # Resuelve, pero debe ser el postgres de dev, no el de prod.
    local resolved dev_pg_ip
    resolved=$(docker exec ngf-dev-app-1 getent hosts postgres | awk '{print $1}')
    dev_pg_ip=$(docker inspect ngf-dev-postgres-1 \
      --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
    check_eq "dev resuelve su propio postgres" "$dev_pg_ip" "$resolved"
  else
    bad "dev no resuelve ningún postgres"
  fi
}

main() {
  local target="${1:-all}"
  case "$target" in
    host) suite_host ;;
    app) suite_app ;;
    network) suite_network ;;
    limits) suite_limits ;;
    isolation) suite_isolation ;;
    all)  suite_host; suite_app; suite_network; suite_limits; suite_isolation ;;
    *) echo "suite desconocida: $target" >&2; exit 2 ;;
  esac

  printf '\n%s: \033[32m%d ok\033[0m, \033[31m%d fallan\033[0m\n' "$target" "$PASS" "$FAIL"
  [[ "$FAIL" -eq 0 ]]
}

main "$@"
