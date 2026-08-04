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

# check_ne "descripción" prohibido obtenido → pasa si NO son iguales
check_ne() {
  local desc="$1" forbidden="$2" actual="$3"
  if [[ "$forbidden" != "$actual" ]]; then
    ok "$desc"
  else
    bad "$desc (ambos valen: $actual)"
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

  # Borrar antes de pedir: si curl no puede conectar, no escribe el archivo y
  # los greps de abajo leerían el JSON de una corrida anterior. El exit code
  # global igual saldría mal por el chequeo del 200, pero la salida mostraría
  # tres pass espurios al lado del fail — y lo que alguien lee a las 11 de la
  # noche es la salida, no el exit code.
  rm -f /tmp/arandano-health.json

  local code
  code=$(curl -s -o /tmp/arandano-health.json -w '%{http_code}' \
    "http://$TS_IP:3000/api/health" 2>/dev/null || echo 000)
  check_eq "healthcheck de dev devuelve 200" "200" "$code"

  check_cmd "reporta el check de postgres" \
    grep -q '"name":"postgres"' /tmp/arandano-health.json
  # El SHA ahora viaja en `info`, no como un check verde: no puede fallar, así
  # que no vota el veredicto.
  check_cmd "expone el SHA como info, no como check" \
    grep -q '"info":{"sha":' /tmp/arandano-health.json
  check_cmd "el SHA/uptime ya no se reporta como un check" \
    bash -c '! grep -q "\"name\":\"app\"" /tmp/arandano-health.json'
  # El check de postgres confirma identidad de base, no sólo alcanzabilidad.
  check_cmd "el check de postgres confirma contra qué base habla" \
    grep -q '"detail":"db=arandano_dev"' /tmp/arandano-health.json
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
  dev_app_mem=$(docker inspect arandano-dev-app-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "dev app con 1536m de límite" "1610612736" "$dev_app_mem"

  prod_pg_mem=$(docker inspect arandano-prod-postgres-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "prod postgres con 1536m de límite" "1610612736" "$prod_pg_mem"

  prod_pg_oom=$(docker inspect arandano-prod-postgres-1 \
    --format '{{.HostConfig.OomScoreAdj}}' 2>/dev/null || echo 0)
  check_eq "prod postgres con oom_score_adj -500" "-500" "$prod_pg_oom"

  # NanoCpus: 0.75 core = 750000000
  dev_app_cpu=$(docker inspect arandano-dev-app-1 \
    --format '{{.HostConfig.NanoCpus}}' 2>/dev/null || echo 0)
  check_eq "dev app capada a 0.75 cores" "750000000" "$dev_app_cpu"

  # Prod NO debe tener cap: gana por peso, no por reserva.
  local prod_app_cpu
  prod_app_cpu=$(docker inspect arandano-prod-app-1 \
    --format '{{.HostConfig.NanoCpus}}' 2>/dev/null || echo -1)
  check_eq "prod app sin cap de CPU" "0" "$prod_app_cpu"

  # Los cuatro límites de memoria que faltaban. Se declaran trece en los
  # compose; chequear cinco y suponer los otros ocho es justo la forma en que
  # un límite aflojado pasa desapercibido.
  local prod_app_mem caddy_mem dev_pg_mem dev_pg_cpu
  prod_app_mem=$(docker inspect arandano-prod-app-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "prod app con 1536m de límite" "1610612736" "$prod_app_mem"

  caddy_mem=$(docker inspect arandano-prod-caddy-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "prod caddy con 128m de límite" "134217728" "$caddy_mem"

  dev_pg_mem=$(docker inspect arandano-dev-postgres-1 \
    --format '{{.HostConfig.Memory}}' 2>/dev/null || echo 0)
  check_eq "dev postgres con 768m de límite" "805306368" "$dev_pg_mem"

  dev_pg_cpu=$(docker inspect arandano-dev-postgres-1 \
    --format '{{.HostConfig.NanoCpus}}' 2>/dev/null || echo 0)
  check_eq "dev postgres capado a 0.25 cores" "250000000" "$dev_pg_cpu"

  # cpu_shares, que no tenía NINGUNA cobertura. Es el chequeo que más
  # importa de este suite: prod corre a propósito SIN cap de CPU, así que el
  # peso relativo es el mecanismo entero por el que prod le gana a dev bajo
  # contención. Si alguien empareja los shares, prod deja de tener prioridad
  # y nada más en el sistema lo nota.
  local shares
  for par in \
    "arandano-prod-app-1:1024" "arandano-prod-postgres-1:1024" "arandano-prod-caddy-1:1024" \
    "arandano-dev-app-1:256" "arandano-dev-postgres-1:256"; do
    shares=$(docker inspect "${par%%:*}" \
      --format '{{.HostConfig.CpuShares}}' 2>/dev/null || echo NA)
    check_eq "${par%%:*} con cpu_shares ${par##*:}" "${par##*:}" "$shares"
  done
}

suite_env() {
  suite_header "Separación de entornos: prod no es un directorio que se edita"

  local prod_dir=/srv/arandano/prod

  # "Producción no es un directorio donde se edita: es una imagen que se
  # corre" (CLAUDE.md). Si aparece código fuente ahí, alguien ya empezó a
  # tratarlo como un workspace y el siguiente paso es un `next dev` sobre lo
  # que un cliente está usando.
  local fuente
  fuente=$(find "$prod_dir" -maxdepth 2 \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \
       -o -name 'package.json' -o -name 'node_modules' \) 2>/dev/null | wc -l)
  check_eq "no hay código fuente en $prod_dir" "0" "$fuente"

  local modo
  modo=$(stat -c '%a' "$prod_dir/.env" 2>/dev/null || echo NA)
  check_eq "el .env de prod es 600" "600" "$modo"

  # La copia a /srv es MANUAL, así que el drift es cuestión de tiempo, no de
  # descuido. Que el repo y lo que realmente corre digan lo mismo es lo único
  # que hace que leer el repo sirva para saber qué está pasando en prod.
  check_cmd "el compose de prod no derivó respecto del repo" \
    diff -q docker/compose.prod.yml "$prod_dir/docker-compose.yml"
  check_cmd "el Caddyfile de prod no derivó respecto del repo" \
    diff -q docker/Caddyfile "$prod_dir/Caddyfile"

  # Credenciales distintas entre entornos, empezando por las de la base
  # (CLAUDE.md). Si coinciden, prod y dev están a un typo de compartir datos.
  local dev_url prod_url
  dev_url=$(docker exec arandano-dev-app-1 printenv DATABASE_URL 2>/dev/null || echo NA-dev)
  prod_url=$(docker exec arandano-prod-app-1 printenv DATABASE_URL 2>/dev/null || echo NA-prod)
  check_ne "dev y prod no comparten DATABASE_URL" "$dev_url" "$prod_url"

  # Y que cada app sepa contra qué base debe estar hablando: es lo que
  # convierte el check de postgres en una prueba de identidad y no sólo de
  # alcanzabilidad.
  check_eq "dev espera su propia base" "arandano_dev" \
    "$(docker exec arandano-dev-app-1 printenv ARANDANO_DB_ESPERADA 2>/dev/null || echo NA)"
  check_eq "prod espera su propia base" "arandano_prod" \
    "$(docker exec arandano-prod-app-1 printenv ARANDANO_DB_ESPERADA 2>/dev/null || echo NA)"
}

suite_build() {
  suite_header "Builds: el presupuesto se aplica de verdad"

  # El build es el consumidor más grande del presupuesto (2 GiB y un core),
  # corre en CADA deploy y compite con clientes reales sobre 2 vCPU. Durante
  # toda la rama estuvo documentado como
  # `nice -n 15 docker build --cpuset-cpus=0 --memory=2g`, y las tres piezas
  # son inertes: `nice` afecta al cliente de la CLI y no a BuildKit (que vive
  # dentro de dockerd), y `docker build` es `docker buildx build`, cuya lista
  # de banderas no tiene ni --cpuset-cpus ni --memory — las traga sin warning
  # y sale con 0. Este suite existe para que eso no pueda repetirse: no
  # comprueba que el comando esté escrito, comprueba el límite EFECTIVO.

  # Primera mitad: el slice de systemd, que es el techo agregado del build.
  # Sin guiones en el nombre a propósito (ver setup-host.sh): con guion,
  # systemd lo colgaría de arandano.slice y la ruta dejaría de coincidir con la que
  # resuelve --cgroup-parent.
  local slice_mem slice_cpu
  slice_mem=$(cat /sys/fs/cgroup/arandanobuild.slice/memory.max 2>/dev/null || echo NA)
  check_eq "el slice de build capea la memoria en 2 GiB" "2147483648" "$slice_mem"

  slice_cpu=$(cat /sys/fs/cgroup/arandanobuild.slice/cpu.max 2>/dev/null || echo NA)
  check_eq "el slice de build capea la CPU en un core" "100000 100000" "$slice_cpu"

  check_cmd "el slice de build sobrevive un reboot (enabled)" \
    systemctl is-enabled arandanobuild.slice

  # Segunda mitad, la que realmente prueba algo: leer el límite DESDE ADENTRO
  # de un build de verdad. Que el slice tenga el número correcto no dice nada
  # si el build no termina adentro del slice.
  local ctx salida mem cpu
  ctx=$(mktemp -d)
  cat > "$ctx/Dockerfile" <<'DOCKERFILE'
FROM alpine:latest
RUN sleep 1 && echo "ARANDANO_MEM_MAX=$(cat /sys/fs/cgroup/memory.max)" && \
    echo "ARANDANO_CPU_MAX=$(cat /sys/fs/cgroup/cpu.max)"
DOCKERFILE

  # Se tagea a propósito, aunque la imagen no se use: con el driver `docker`,
  # buildx exporta igual al image store, así que un build sin -t no deja
  # "nada" — deja una imagen colgada (<none>) por cada corrida. Con un tag
  # propio se puede borrar sin ambigüedad y sin tocar imágenes ajenas.
  # --no-cache es obligatorio: un RUN cacheado reimprimiría el resultado de la
  # corrida anterior en vez de medir esta, que es como este chequeo dejaría de
  # medir el presente sin dejar de estar verde.
  local tag="arandano-verify-build-$$:tmp"
  trap 'docker rmi -f "$tag" >/dev/null 2>&1; trap - RETURN' RETURN

  # OJO — no borrar este bloque pensando que es redundante con los dos
  # `check_eq` de memory.max/cpu.max de más abajo: esos sólo prueban el
  # número que `--resource` le pidió a BuildKit, no DÓNDE vive el proceso.
  # Si alguien borra `--cgroup-parent=arandanobuild.slice` del comando documentado
  # pero deja los `--resource`, BuildKit arranca el RUN igual, con esos
  # mismos límites... colgado de otro cgroup. El techo AGREGADO del slice
  # (el que capea la suma de builds concurrentes, no cada uno por separado)
  # desaparece en silencio y los dos checks de abajo seguirían en verde.
  # Por eso hace falta mirar dónde cuelga el proceso, no sólo qué límite
  # reporta: se lanza el build en background y, mientras el RUN sigue vivo,
  # se comprueba que `/sys/fs/cgroup/arandanobuild.slice/buildkit/` tenga un
  # subdirectorio propio del build (algo como .../buildkit/<id>/) — ahí es
  # donde BuildKit cuelga el proceso del RUN cuando `--cgroup-parent` sí se
  # aplicó. Tiene que ser `-type d`: el propio `buildkit/` ya existe siempre
  # como cgroup vacío (con sus archivos de control de kernel, que `find`
  # sin filtro por tipo cuenta igual que un subdirectorio real), así que sin
  # el filtro este chequeo daría siempre verde, con o sin `--cgroup-parent`
  # — se verificó ese falso positivo a mano antes de dejar el filtro puesto.
  # El `sleep 1` del Dockerfile de arriba sólo le da a este polling una
  # ventana real para observarlo antes de que el build termine.
  local salida_file build_pid intentos=0 en_slice=0
  salida_file=$(mktemp)
  docker build --no-cache --progress=plain \
    --cgroup-parent=arandanobuild.slice \
    --resource memory=2g --resource cpu-quota=100000 \
    -t "$tag" -f "$ctx/Dockerfile" "$ctx" >"$salida_file" 2>&1 &
  build_pid=$!

  while kill -0 "$build_pid" 2>/dev/null && [[ "$intentos" -lt 150 ]]; do
    if find /sys/fs/cgroup/arandanobuild.slice/buildkit -mindepth 1 -maxdepth 1 \
         -type d 2>/dev/null | grep -q .; then
      en_slice=1
      break
    fi
    sleep 0.1
    intentos=$((intentos + 1))
  done

  wait "$build_pid"
  salida=$(cat "$salida_file")
  rm -f "$salida_file"
  rm -rf "$ctx"

  check_eq "el proceso del build cuelga de arandanobuild.slice (no sólo --resource)" \
    "1" "$en_slice"

  # Sólo las líneas de SALIDA del paso, no el eco del comando. Con
  # --progress=plain BuildKit imprime primero el Dockerfile del RUN (que
  # contiene literalmente "ARANDANO_MEM_MAX=$(cat ...)") y después el resultado;
  # las líneas de resultado son las que llevan el prefijo "#<n> <segundos> ".
  # Sin este filtro el eco matchea primero y el chequeo lee basura.
  local lineas
  lineas=$(printf '%s\n' "$salida" | grep -E '^#[0-9]+ [0-9]+\.[0-9]+ ARANDANO_')
  mem=$(printf '%s\n' "$lineas" | sed -n 's/.*ARANDANO_MEM_MAX=\(.*\)$/\1/p' | head -1)
  cpu=$(printf '%s\n' "$lineas" | sed -n 's/.*ARANDANO_CPU_MAX=\(.*\)$/\1/p' | head -1)

  check_eq "el build ve 2 GiB de memory.max desde adentro" \
    "2147483648" "${mem:-NA}"
  check_eq "el build ve un core de cpu.max desde adentro" \
    "100000 100000" "${cpu:-NA}"
}

suite_isolation() {
  suite_header "Aislamiento entre stacks"

  check_cmd "volumen de prod existe" docker volume inspect arandano-prod_pgdata
  check_cmd "volumen de dev existe" docker volume inspect arandano-dev_pgdata

  # Redes separadas: dev no puede resolver el Postgres de prod.
  local dev_net prod_net
  dev_net=$(docker network ls --format '{{.Name}}' | grep -c '^arandano-dev_default$')
  prod_net=$(docker network ls --format '{{.Name}}' | grep -c '^arandano-prod_default$')
  check_eq "dev tiene su propia red" "1" "$dev_net"
  check_eq "prod tiene su propia red" "1" "$prod_net"

  if docker exec arandano-dev-app-1 getent hosts postgres 2>/dev/null \
     | grep -q .; then
    # Resuelve, pero debe ser el postgres de dev, no el de prod.
    local resolved dev_pg_ip
    resolved=$(docker exec arandano-dev-app-1 getent hosts postgres | awk '{print $1}')
    dev_pg_ip=$(docker inspect arandano-dev-postgres-1 \
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
  # Nombre único por corrida más trap de limpieza. Con un nombre fijo, la
  # colisión realista no es un humano contra otro: es `deploy.sh` corriendo
  # este script mientras alguien lo corre a mano. Las dos corridas se pisan el
  # contenedor y una reporta "rotación NO activa" — un falso negativo sobre
  # justo el mecanismo que evita que dev llene el disco.
  local logspam="arandano-logspam-$$"
  # El `trap - RETURN` dentro del propio handler no es adorno: un trap de
  # RETURN queda registrado a nivel shell, no de la funcion que lo puso, asi
  # que sin desarmarlo vuelve a dispararse cuando retorna la SIGUIENTE funcion
  # — ahi `$logspam` ya salio de scope y, con `set -u`, el script muere con
  # "unbound variable" despues de haber pasado los 54 checks. Un gate que sale
  # 1 habiendo aprobado todo es peor que no tenerlo.
  trap 'docker rm -f "$logspam" >/dev/null 2>&1; trap - RETURN' RETURN

  docker run -d --name "$logspam" alpine sh -c \
    'i=0; while [ $i -lt 60000 ]; do head -c 1000 /dev/zero | tr "\0" "x"; echo; i=$((i+1)); done' \
    >/dev/null 2>&1
  docker wait "$logspam" >/dev/null 2>&1

  local logpath total
  logpath=$(docker inspect "$logspam" --format '{{.LogPath}}' 2>/dev/null)
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

  # Nombres únicos, por el mismo motivo que en suite_logs.
  docker run --rm --memory=64m --name "arandano-memhog-$$" alpine \
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
  local cpuhog="arandano-cpuhog-$$"
  docker run --rm -d --name "$cpuhog" --cpus=1 --cpu-shares=256 \
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
  docker rm -f "$cpuhog" >/dev/null 2>&1

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
  trap 'docker compose -p arandano-prod start postgres >/dev/null 2>&1' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  docker compose -p arandano-prod stop postgres >/dev/null 2>&1
  sleep 3
  # Mismo motivo que en suite_app: sin borrarlo antes, un curl que no conecta
  # deja el grep de abajo leyendo el JSON de la corrida anterior y aprobando
  # sobre evidencia vieja.
  rm -f /tmp/arandano-degraded.json
  # --max-time: un /api/health colgado no puede estirar la ventana en la
  # que Postgres de prod está parado de forma indefinida.
  code=$(curl -sk -o /tmp/arandano-degraded.json -w '%{http_code}' --max-time 10 \
    https://localhost/api/health)
  check_eq "con Postgres caído el healthcheck da 503" "503" "$code"
  check_cmd "identifica que el check roto es postgres" \
    grep -q '"name":"postgres","ok":false' /tmp/arandano-degraded.json
  docker compose -p arandano-prod start postgres >/dev/null 2>&1
  trap - EXIT INT TERM
}

suite_backup() {
  suite_header "Backups: herramientas, claves y frescura"

  # El host no traía ninguna de las tres. Sin ellas backup.sh no arranca, y
  # el modo de falla sería descubrirlo a las 04:00 de una madrugada.
  check_cmd "age instalado" command -v age
  check_cmd "rclone instalado" command -v rclone
  check_cmd "jq instalado" command -v jq

  # /tmp es tmpfs en este host: un dump ahí se escribe en RAM y rompe el
  # presupuesto de memoria. /var/tmp tiene que estar en disco.
  local fstype_vartmp
  fstype_vartmp=$(df --output=fstype /var/tmp 2>/dev/null | tail -1 | tr -d ' ')
  check_ne "/var/tmp no es tmpfs" "tmpfs" "$fstype_vartmp"
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
    build) suite_build ;;
    isolation) suite_isolation ;;
    env) suite_env ;;
    logs) suite_logs ;;
    stress) suite_stress ;;
    backup) suite_backup ;;
    all)  suite_host; suite_app; suite_network; suite_limits; suite_build; suite_isolation; suite_env; suite_logs; suite_stress; suite_backup ;;
    *) echo "suite desconocida: $target" >&2; exit 2 ;;
  esac

  if [[ "$alpine_pre_existing" -eq 0 ]]; then
    docker rmi alpine:latest >/dev/null 2>&1 || true
  fi

  printf '\n%s: \033[32m%d ok\033[0m, \033[31m%d fallan\033[0m\n' "$target" "$PASS" "$FAIL"
  [[ "$FAIL" -eq 0 ]]
}

main "$@"
