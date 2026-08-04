#!/usr/bin/env bash
# Provisioning del host. Idempotente: correrlo dos veces no rompe nada.
# Se versiona para que la máquina sea reproducible — si el VPS se pierde,
# esto es lo que lo reconstruye.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Correr como root" >&2; exit 1; }

readonly SWAPFILE=/swapfile
readonly SWAP_SIZE=4G

# El presupuesto de recursos de los builds, en un slice de systemd. El nombre
# NO lleva guiones a propósito: systemd interpreta el guion como jerarquía
# ("arandano-build.slice" cuelga de "arandano.slice" y su cgroup real queda en
# /sys/fs/cgroup/arandano.slice/arandano-build.slice). Sin guion el cgroup queda en el
# tope, /sys/fs/cgroup/arandanobuild.slice, que es exactamente la ruta que resuelve
# `docker build --cgroup-parent=arandanobuild.slice`. Con guion las dos rutas NO
# coinciden: Docker crea un cgroup crudo homónimo en el tope, sin límite
# ninguno, y el build queda sin capar mientras aparenta estar en el slice.
readonly BUILD_SLICE=arandanobuild.slice
readonly BUILD_SLICE_UNIT=/etc/systemd/system/arandanobuild.slice

setup_swap() {
  if swapon --show --noheadings | grep -q "$SWAPFILE"; then
    echo "swap ya activa, salteando"
  else
    echo "creando swapfile de $SWAP_SIZE"
    fallocate -l "$SWAP_SIZE" "$SWAPFILE"
    chmod 600 "$SWAPFILE"
    mkswap "$SWAPFILE"
    swapon "$SWAPFILE"
  fi

  # Persistir el montaje
  grep -q "^$SWAPFILE" /etc/fstab || echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab

  # swappiness bajo a propósito: la swap está para absorber el pico de un
  # build, no para que el kernel pagine Postgres de forma proactiva.
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-arandano-swappiness.conf
  sysctl -q -w vm.swappiness=10
}

setup_docker() {
  local recien_instalado=false

  if command -v docker >/dev/null 2>&1; then
    echo "docker ya instalado, salteando instalación"
  else
    recien_instalado=true
    echo "instalando docker desde el repositorio oficial"
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
      docker-buildx-plugin docker-compose-plugin
  fi

  # enable --now sólo tiene sentido en la instalación original: si docker ya
  # está instalado, el servicio ya está habilitado y corriendo (o el restart
  # de más abajo se encarga si hace falta).
  if [[ "$recien_instalado" == true ]]; then
    systemctl enable --now docker
  fi

  # Rotación a nivel daemon, no sólo en cada compose: un contenedor
  # levantado a mano tampoco puede llenar el disco.
  # live-restore: reiniciar el daemon no tira los contenedores de prod.
  #
  # DUEÑO ÚNICO: este script se considera el único dueño de
  # /etc/docker/daemon.json y lo sobrescribe entero, no lo mergea. Cualquier
  # clave agregada a mano (registry-mirrors, insecure-registries, dns…) se
  # pierde en la próxima corrida, y además el bloque de abajo detecta la
  # diferencia y REINICIA el daemon para aplicar "su" versión. Si hace falta
  # una clave nueva, va acá adentro y se commitea — no se edita el archivo
  # del host.
  local daemon_json_nuevo
  daemon_json_nuevo=$(mktemp)
  cat > "$daemon_json_nuevo" <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
JSON

  # El restart es condicional a propósito, no una optimización cosmética:
  # la protección de live-restore la determina la configuración que el
  # daemon ya tenía cargada al momento de morir, no la que el próximo arranque
  # va a leer. Por eso el restart que hace la transición de "sin live-restore"
  # a "con live-restore" no está protegido por live-restore y tira abajo los
  # contenedores corriendo. En estado estable (el archivo ya es el correcto)
  # no hay que reiniciar nada — sólo reinstalar y reiniciar cuando el
  # contenido realmente cambia.
  if [[ -f /etc/docker/daemon.json ]] && cmp -s "$daemon_json_nuevo" /etc/docker/daemon.json; then
    echo "daemon.json ya tiene la configuración correcta, se saltea el restart"
    rm -f "$daemon_json_nuevo"
  else
    install -m 0644 "$daemon_json_nuevo" /etc/docker/daemon.json
    rm -f "$daemon_json_nuevo"
    systemctl restart docker
  fi
}

# El presupuesto de los builds: 2 GiB y un core, sobre una caja de 2 vCPU
# donde producción está atendiendo clientes al mismo tiempo.
#
# Por qué un slice de systemd y no las banderas que uno esperaría:
#
# - `nice -n 15 docker build` NO hace nada. `nice` baja la prioridad del
#   CLIENTE de la CLI; el trabajo real lo ejecuta BuildKit embebido dentro de
#   dockerd (driver "docker"), así que los procesos del build heredan la
#   prioridad de dockerd, no la del comando que uno tipeó.
# - `docker build --cpuset-cpus=… --memory=…` NO hace nada. `docker build` es
#   hoy `docker buildx build`, y su lista de banderas no incluye ninguna de las
#   dos. Peor: no las rechaza. `docker build --cpuset-cpus=999 --memory=1` sale
#   con 0 sobre esta máquina de 2 cores, sin un solo warning.
#
# Lo que sí se verificó que ata, leyendo el límite DESDE ADENTRO del build:
#
# - `--resource memory=…,cpu-quota=…` fija el límite de cada contenedor de RUN.
# - `--cgroup-parent=arandanobuild.slice` mete todo el árbol del build dentro de este
#   slice, que es el techo agregado — un multi-stage puede correr etapas en
#   paralelo, y sin el slice cada una se llevaría su propio `--resource` entero.
#
# `scripts/verify-infra.sh build` comprueba las dos cosas contra un build real.
setup_build_slice() {
  local unit_nueva
  unit_nueva=$(mktemp)
  cat > "$unit_nueva" <<'UNIT'
[Unit]
Description=Presupuesto de recursos de los builds de Arándano

[Slice]
MemoryMax=2G
CPUQuota=100%

[Install]
WantedBy=multi-user.target
UNIT

  if [[ -f "$BUILD_SLICE_UNIT" ]] && cmp -s "$unit_nueva" "$BUILD_SLICE_UNIT"; then
    echo "$BUILD_SLICE ya tiene la configuración correcta"
    rm -f "$unit_nueva"
  else
    install -m 0644 "$unit_nueva" "$BUILD_SLICE_UNIT"
    rm -f "$unit_nueva"
    systemctl daemon-reload
  fi

  # `enable` (no sólo `start`) porque el modo de falla es silencioso: si el
  # slice no está activo cuando arranca un build, Docker crea el cgroup crudo
  # igual y el build corre SIN límite, sin avisar. Un reboot no puede dejar la
  # máquina en ese estado.
  systemctl enable --now "$BUILD_SLICE" >/dev/null 2>&1 \
    || systemctl start "$BUILD_SLICE"
}

# Los roles de Postgres del stack de dev, para que reconstruir el host desde
# cero también deje ese stack completo y no a medio armar a la espera de que
# alguien recuerde correr setup-db-roles.sh a mano.
#
# Sólo dev: producción NO entra acá — su .env vive fuera del repo, en
# /srv/arandano/prod/, y sus contraseñas se generan una sola vez (Task 10).
# Stage tampoco: nace vacío en cada corrida de deploy.sh contra un Postgres
# efímero, así que sus roles los crea deploy.sh, no este script.
#
# .env.dev no está versionado, así que en un host recién clonado puede no
# existir todavía — en ese caso no hay nada que hacer acá y se saltea, sin
# romper la re-ejecutabilidad del resto del script. Lo mismo si el Postgres
# de dev todavía no está levantado: setup-host.sh configura el HOST, no
# arranca los stacks de Compose, así que en la primera corrida sobre una
# máquina nueva es normal que el contenedor no exista todavía.
setup_db_roles_dev() {
  local script_dir repo_dir env_file
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_dir="$(dirname "$script_dir")"
  env_file="$repo_dir/.env.dev"

  if [[ ! -r "$env_file" ]]; then
    echo "no existe $env_file, salteando roles de dev (correr setup-db-roles.sh a mano cuando exista)"
    return 0
  fi

  if ! docker ps --format '{{.Names}}' | grep -qx 'arandano-dev-postgres-1'; then
    echo "arandano-dev-postgres-1 no está corriendo, salteando roles de dev"
    return 0
  fi

  ( set -a; . "$env_file"; set +a
    "$script_dir/setup-db-roles.sh" \
      --url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@100.64.81.63:5433/${POSTGRES_DB}" \
      --owner-password="${ARANDANO_OWNER_PASSWORD}" \
      --app-password="${ARANDANO_APP_PASSWORD}" \
      --con-createdb
  )
}

# Las tres herramientas del sistema de backups. Van por apt y no por
# instaladores propios: son paquetes de Ubuntu con actualizaciones de
# seguridad, y este script tiene que poder correr dos veces sin efectos.
#
# /etc/arandano/ en 0700 y no 0755: adentro viven la clave privada de
# verificación y las credenciales del bucket. Que el directorio sea
# root-only es la primera de las dos capas; los permisos de cada archivo
# son la segunda.
#
# La detección de "ya instalado" es `command -v`, no `dpkg -s`: `dpkg -s`
# sale con 0 para cualquier paquete con entrada en la base de dpkg, incluso
# uno removido sin --purge (estado "rc", "deinstall ok config-files"). Con
# `dpkg -s` este script diría "ya instalados, salteando" sobre un host al
# que le sacaron el binario, que es exactamente el caso en que se lo vuelve
# a correr para reconstruir la máquina. `command -v` es además el mismo
# criterio que ya usa `suite_backup` en verify-infra.sh — los dos scripts
# tienen que poder coincidir en si una herramienta está presente.
setup_backup_tools() {
  local faltan=()
  for pkg in age rclone jq; do
    command -v "$pkg" >/dev/null 2>&1 || faltan+=("$pkg")
  done

  if [[ ${#faltan[@]} -eq 0 ]]; then
    echo "age, rclone y jq ya instalados, salteando"
  else
    echo "instalando: ${faltan[*]}"
    apt-get update -qq
    apt-get install -y -qq "${faltan[@]}"
  fi

  install -d -m 0700 -o root -g root /etc/arandano
}

# Los timers del sistema de backups.
#
# Persistent=true en los dos: si el servidor estuvo apagado a la hora del
# disparo, la corrida perdida se recupera al arrancar en vez de saltearse. Un
# backup que no corre porque la máquina estaba caída es exactamente el día en
# que más falta hace.
#
# Los horarios son UTC. Los clientes son comercios argentinos (UTC-3) que
# trabajan de 9 a 20: 04:00 UTC son las 01:00 ART y 05:00 UTC del domingo son
# las 02:00 ART. Fuera de la ventana de uso en ambos casos.
setup_backup_timers() {
  local cambio=false

  _instalar_unidad() {
    # `destino` en su propia línea por lo mismo que en subir_verificando: un
    # `local a=… b=…$a` expande `$a` desde el scope exterior, no desde la
    # asignación de al lado.
    local nombre="$1" contenido="$2"
    local destino="/etc/systemd/system/$nombre"
    local tmp; tmp=$(mktemp)
    printf '%s' "$contenido" > "$tmp"
    if [[ -f "$destino" ]] && cmp -s "$tmp" "$destino"; then
      rm -f "$tmp"
    else
      install -m 0644 "$tmp" "$destino"
      rm -f "$tmp"
      cambio=true
    fi
  }

  _instalar_unidad arandano-backup.service "$(cat <<'UNIT'
[Unit]
Description=Backup nocturno de la base de producción de Arándano
# El script necesita Docker para el contenedor efímero del dump.
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/root/arandano/scripts/backup.sh --motivo=nocturno
# Un oneshot arranca con TimeoutStartSec=infinity, y acá eso no es "paciencia":
# es que un pg_dump o un rclone colgado corre para siempre reteniendo
# /var/lock/arandano-backup.lock, y a partir de ese momento TODA corrida
# posterior sale 1 — incluido el backup pre-migración, así que todo deploy
# queda bloqueado hasta que alguien mire el servidor.
#
# 30 minutos: la base entera hoy son kilobytes y el backup completo tarda
# segundos, así que esto es dos órdenes de magnitud de margen sobre lo real y
# aguanta que la base crezca mucho antes de quedar corto. Revisarlo si el dump
# alguna vez se acerca; un timeout que se dispara sobre un backup sano sería
# peor que no tenerlo.
TimeoutStartSec=1800
# Los logs van a journald, que ya tiene rotación configurada. Sin esto el
# diagnóstico de un backup fallido sería adivinar.
StandardOutput=journal
StandardError=journal
UNIT
)"

  _instalar_unidad arandano-backup.timer "$(cat <<'UNIT'
[Unit]
Description=Dispara el backup nocturno a las 04:00 UTC (01:00 ART)

[Timer]
OnCalendar=*-*-* 04:00:00 UTC
Persistent=true
# Hasta 5 minutos de dispersión: no hay nada más compitiendo a esa hora, pero
# evita que el minuto exacto sea un patrón.
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT
)"

  _instalar_unidad arandano-verify-backup.service "$(cat <<'UNIT'
[Unit]
Description=Verificación semanal del último backup de Arándano
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/root/arandano/scripts/verify-backup.sh
# Mismo motivo que en el backup, con más margen: la verificación baja objetos
# del bucket, levanta un Postgres descartable (con hasta 60s de espera propia) y
# restaura. Una hora es holgado para todo eso y sigue siendo finito, que es lo
# único que importa: colgada para siempre, la unidad se queda con su lock y
# ninguna verificación posterior vuelve a correr — el dead man's switch avisaría
# recién a la semana siguiente.
TimeoutStartSec=3600
StandardOutput=journal
StandardError=journal
UNIT
)"

  _instalar_unidad arandano-verify-backup.timer "$(cat <<'UNIT'
[Unit]
Description=Dispara la verificación los domingos a las 05:00 UTC (02:00 ART)

[Timer]
OnCalendar=Sun *-*-* 05:00:00 UTC
Persistent=true
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
UNIT
)"

  if [[ "$cambio" == true ]]; then
    systemctl daemon-reload
  else
    echo "los timers de backup ya tienen la configuración correcta"
  fi

  # enable --now y no sólo enable: `enable` solo deja el timer armado recién
  # para el próximo reboot.
  systemctl enable --now arandano-backup.timer >/dev/null
  systemctl enable --now arandano-verify-backup.timer >/dev/null
}

setup_swap
setup_docker
setup_db_roles_dev
setup_build_slice
setup_backup_tools
setup_backup_timers
echo "listo"
