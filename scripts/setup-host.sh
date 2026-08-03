#!/usr/bin/env bash
# Provisioning del host. Idempotente: correrlo dos veces no rompe nada.
# Se versiona para que la máquina sea reproducible — si el VPS se pierde,
# esto es lo que lo reconstruye.
set -euo pipefail

[[ $EUID -eq 0 ]] || { echo "Correr como root" >&2; exit 1; }

readonly SWAPFILE=/swapfile
readonly SWAP_SIZE=4G

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
  echo 'vm.swappiness=10' > /etc/sysctl.d/99-ngf-swappiness.conf
  sysctl -q -w vm.swappiness=10
}

setup_docker() {
  if command -v docker >/dev/null 2>&1; then
    echo "docker ya instalado, salteando instalación"
  else
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

  # Rotación a nivel daemon, no sólo en cada compose: un contenedor
  # levantado a mano tampoco puede llenar el disco.
  # live-restore: reiniciar el daemon no tira los contenedores de prod.
  cat > /etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true
}
JSON

  systemctl enable --now docker
  systemctl restart docker
}

setup_swap
setup_docker
echo "listo"
