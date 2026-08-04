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

setup_swap
setup_docker
setup_build_slice
setup_backup_tools
echo "listo"
