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

suite_logs() {
  suite_header "Logs: rotación efectiva"

  # Chequeo 5 de la spec: que dev no pueda llenar el disco.
  #
  # OJO: no sirve mirar .HostConfig.LogConfig.Config del contenedor — la
  # rotación está puesta como default del daemon, y ahí sale vacío. Que el
  # default exista ya lo chequea suite_host; acá se mide el comportamiento
  # real, que es lo único que prueba que funciona.
  docker rm -f ngf-logspam >/dev/null 2>&1 || true
  docker run -d --name ngf-logspam alpine sh -c \
    'i=0; while [ $i -lt 60000 ]; do head -c 1000 /dev/zero | tr "\0" "x"; echo; i=$((i+1)); done' \
    >/dev/null 2>&1
  docker wait ngf-logspam >/dev/null 2>&1

  local logpath total
  logpath=$(docker inspect ngf-logspam --format '{{.LogPath}}' 2>/dev/null)
  if [[ -n "$logpath" && -f "$logpath" ]]; then
    # 3 archivos de 10m = 31 MB de techo, con margen de redondeo.
    total=$(du -cm "$logpath"* 2>/dev/null | tail -1 | awk '{print $1}')
    if [[ "${total:-9999}" -le 33 ]]; then
      ok "60 MB de logs quedaron en ${total} MB en disco (rotación activa)"
    else
      bad "60 MB de logs dejaron ${total} MB en disco (rotación NO activa)"
    fi
  else
    bad "no se pudo leer el LogPath del contenedor de prueba"
  fi
  docker rm -f ngf-logspam >/dev/null 2>&1 || true
}

suite_stress() {
  suite_header "Estrés: prod aguanta con dev saturada"

  # Chequeo 2 de la spec: el cgroup mata al contenedor, no el OOM del kernel.
  # `tail /dev/zero` aloca memoria sin techo — a diferencia de escribir en
  # /dev/shm, que se topa con su límite de 64m y falla por otra razón.
  #
  # Antes de confiar en dmesg hay que confirmar que el buffer del kernel
  # sea legible: con `kernel.dmesg_restrict=1` y sin privilegio, `dmesg`
  # no imprime nada y sale con error — si eso no se detecta, "antes" y
  # "después" quedan los dos en 0 y el chequeo aprueba sin haber medido
  # nada. Fix Round 1 (Finding 3): se verifica el buffer por adelantado y,
  # si no es legible, el chequeo se reporta fallado (no silenciosamente
  # verde) en vez de compararlo igual.
  local exit_code dmesg_before dmesg_after dmesg_readable=1
  dmesg >/dev/null 2>&1 || dmesg_readable=0
  if [[ "$dmesg_readable" -eq 1 ]]; then
    # Mayúscula deliberada: distingue el OOM global del kernel
    # ("Out of memory: Killed process") del OOM de memcg
    # ("Memory cgroup out of memory: Killed process", con minúscula en
    # "out"). Sólo el primero indica que el kernel eligió víctima fuera
    # del cgroup; "corregir" el case rompería justo lo que este chequeo
    # mide.
    dmesg_before=$(dmesg 2>/dev/null | grep -c 'Out of memory' || true)
  fi

  docker run --rm --memory=64m --name ngf-memhog alpine \
    sh -c 'tail /dev/zero' >/dev/null 2>&1
  exit_code=$?
  check_eq "contenedor excedido muere por el cgroup (137)" "137" "$exit_code"

  if [[ "$dmesg_readable" -eq 1 ]]; then
    dmesg_after=$(dmesg 2>/dev/null | grep -c 'Out of memory' || true)
    check_eq "el OOM del kernel no eligió víctima" "$dmesg_before" "$dmesg_after"
  else
    bad "no se puede leer el buffer del kernel (dmesg restringido) — chequeo de OOM sin datos, no cuenta como aprobado"
  fi

  # Chequeo 1 de la spec: p95 de /api/health bajo 500ms con dev saturada.
  docker run --rm -d --name ngf-cpuhog --cpus=1 --cpu-shares=256 \
    alpine sh -c 'while true; do :; done' >/dev/null 2>&1

  # Fix Round 1 (Finding 2): antes sólo se medía time_total. Una conexión
  # rechazada o un 500 rápido registran una latencia BAJA y mejorarían el
  # p95 reportado justo durante la caída que este chequeo debería detectar.
  # Ahora se captura el código de estado junto con el tiempo, y cualquier
  # respuesta que no sea 200 cuenta como falla de un chequeo aparte, para
  # que "lento" y "roto" no se confundan en un solo veredicto.
  local times=() sample code t p95 idx non200=0
  for _ in $(seq 1 20); do
    sample=$(curl -sk -o /dev/null -w '%{http_code} %{time_total}' https://localhost/api/health)
    code=${sample%% *}
    t=${sample##* }
    [[ "$code" == "200" ]] || non200=$((non200 + 1))
    times+=("$(printf '%.0f' "$(echo "$t * 1000" | bc -l)")")
  done
  docker rm -f ngf-cpuhog >/dev/null 2>&1

  check_eq "las 20 requests bajo carga devuelven 200" "0" "$non200"

  idx=$(printf '%s\n' "${times[@]}" | sort -n | tail -2 | head -1)
  p95=$idx
  if [[ "$p95" -lt 500 ]]; then
    ok "p95 de prod bajo carga: ${p95}ms (< 500ms)"
  else
    bad "p95 de prod bajo carga: ${p95}ms (>= 500ms)"
  fi

  # Chequeo 6 de la spec — el más importante: el healthcheck no miente.
  #
  # Fix Round 1 (Finding 1): esto para el Postgres REAL de producción. Sin
  # un trap, un Ctrl+C en esta ventana o un /api/health que se cuelga en
  # vez de responder dejan la línea de `start postgres` sin ejecutarse, y
  # prod queda caída sin red de recuperación — exactamente la caída que
  # este script existe para prevenir. El trap de EXIT arranca Postgres sin
  # condiciones pase lo que pase; INT y TERM sólo convierten la señal en
  # un `exit` prolijo, que a su vez dispara el trap de EXIT. Se arma justo
  # antes de parar Postgres y se desarma después del restart normal, para
  # que una corrida sana no le pegue un segundo restart de más.
  trap 'docker compose -p ngf-prod start postgres >/dev/null 2>&1' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  docker compose -p ngf-prod stop postgres >/dev/null 2>&1
  sleep 3
  # --max-time: un /api/health colgado no puede estirar la ventana en la
  # que Postgres de prod está parado de forma indefinida.
  code=$(curl -sk -o /tmp/ngf-degraded.json -w '%{http_code}' --max-time 10 \
    https://localhost/api/health)
  check_eq "con Postgres caído el healthcheck da 503" "503" "$code"
  check_cmd "identifica que el check roto es postgres" \
    grep -q '"name":"postgres","ok":false' /tmp/ngf-degraded.json
  docker compose -p ngf-prod start postgres >/dev/null 2>&1
  trap - EXIT INT TERM
}

main() {
  local target="${1:-all}"

  # Fix Round 1 (Finding 4): suite_logs y suite_stress usan alpine:latest
  # para sus contenedores descartables. Si el operador ya la tenía en el
  # host, no es nuestra y no se toca; si la trajo esta corrida, se borra
  # al final para no dejar imágenes de prueba tiradas. Se mide antes de
  # correr cualquier suite, sea cual sea el target.
  local alpine_pre_existing=1
  docker image inspect alpine:latest >/dev/null 2>&1 || alpine_pre_existing=0

  case "$target" in
    host) suite_host ;;
    app) suite_app ;;
    network) suite_network ;;
    limits) suite_limits ;;
    isolation) suite_isolation ;;
    logs) suite_logs ;;
    stress) suite_stress ;;
    all)  suite_host; suite_app; suite_network; suite_limits; suite_isolation; suite_logs; suite_stress ;;
    *) echo "suite desconocida: $target" >&2; exit 2 ;;
  esac

  if [[ "$alpine_pre_existing" -eq 0 ]]; then
    docker rmi alpine:latest >/dev/null 2>&1 || true
  fi

  printf '\n%s: \033[32m%d ok\033[0m, \033[31m%d fallan\033[0m\n' "$target" "$PASS" "$FAIL"
  [[ "$FAIL" -eq 0 ]]
}

main "$@"
