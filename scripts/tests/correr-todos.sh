#!/usr/bin/env bash
# Corre todos los tests de bash del repo.
#
# Descubre por glob y no por lista: una lista es un lugar donde olvidarse de
# agregar el archivo nuevo, y un test que nadie corre es peor que no tenerlo,
# porque igual da la sensación de estar cubierto.
#
# Sin `set -e`: si un archivo falla, los demás tienen que correr igual. Ver
# todas las fallas de una vez es la diferencia entre un arreglo y cinco.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

fallas=0
for archivo in scripts/tests/test-*.sh; do
  [[ -e "$archivo" ]] || { echo "no hay tests de bash que correr" >&2; exit 1; }
  printf '\n\033[1m%s\033[0m\n' "$archivo"
  bash "$archivo" || fallas=$((fallas + 1))
done

if [[ "$fallas" -ne 0 ]]; then
  printf '\n\033[31m%d archivo(s) de test de bash fallan\033[0m\n' "$fallas"
  exit 1
fi
