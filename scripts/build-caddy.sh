#!/usr/bin/env bash
# Buildea la imagen propia de Caddy: la oficial no trae ningún módulo de DNS, y
# sin uno no se puede emitir un certificado wildcard — que es lo que hace que un
# tenant nuevo funcione sin esperar una emisión.
#
# Se tagea por VERSIÓN y no por SHA de git, y no la buildea deploy.sh: el proxy
# cambia en su propio ritmo, no en el del código de la app. Un deploy que
# rebuildeara Caddy pagaría un build de Go sobre 2 vCPU por algo que no cambió, y
# el tag quedaría diciendo un SHA que no tiene nada que ver con el proxy.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# EL ÚNICO LUGAR donde vive la versión. Alimenta los dos FROM del Dockerfile y
# el tag de salida.
readonly CADDY_VERSION=2.11.4
readonly IMAGEN="arandano-caddy:${CADDY_VERSION}-hetzner"

echo "buildeando $IMAGEN"

# Las banderas de recursos son las que efectivamente limitan en este host.
# `nice`, `--cpuset-cpus` y `--memory` son INERTES en `docker build` acá y no
# avisan que lo son — el hallazgo que motivó arandanobuild.slice. Ver
# docs/runbook-stacks.md.
docker build \
  --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --build-arg CADDY_VERSION="$CADDY_VERSION" \
  -f docker/Dockerfile.caddy \
  -t "$IMAGEN" .

# Que el build salga con 0 NO significa que el módulo haya quedado adentro: un
# `xcaddy build` que compila pero no registra el plugin produce una imagen que se
# ve idéntica a una buena. La diferencia se descubriría al renovar, o sea 60 días
# después y sin nadie mirando. Por eso se comprueba acá, contra el binario real.
if ! docker run --rm "$IMAGEN" caddy list-modules | grep -q '^dns.providers.hetzner$'; then
  echo "ERROR: $IMAGEN no trae dns.providers.hetzner; el wildcard no se va a poder emitir" >&2
  exit 1
fi

echo "listo: $IMAGEN, con dns.providers.hetzner"
