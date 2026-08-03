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

main() {
  local target="${1:-all}"
  case "$target" in
    host) suite_host ;;
    all)  suite_host ;;
    *) echo "suite desconocida: $target" >&2; exit 2 ;;
  esac

  printf '\n%s: \033[32m%d ok\033[0m, \033[31m%d fallan\033[0m\n' "$target" "$PASS" "$FAIL"
  [[ "$FAIL" -eq 0 ]]
}

main "$@"
