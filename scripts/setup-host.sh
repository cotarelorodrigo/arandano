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

setup_swap
echo "listo"
