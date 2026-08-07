#!/usr/bin/env bash
# Smoke tests: los caminos que más duelen, contra un stack ya levantado.
#
# Recibe la URL base por argumento en vez de fijarla, porque el mismo archivo
# corre contra arandano-stage durante el gate y podría correr contra cualquier
# otro stack. Nunca contra producción con datos de clientes: acá se escribe.
#
# Un caso por función, y la lista abajo. Sumar un caso es agregar una función y
# un renglón — eso importa porque hoy sólo existen /api/health y /, y la lista
# de verdad (login, venta, factura, orden de trabajo, catálogo) llega cuando
# exista ese código.
#
# ok/bad/PASS/FAIL van inline y NO se sourcean desde scripts/tests/lib-asserts.sh,
# a propósito: ese archivo se declara a sí mismo compartido entre los
# test-*.sh que corren bajo correr-todos.sh, y ese contrato (un proceso bash
# por archivo, invocado con `bash "$archivo"`, nunca sourceado dos veces) es
# el de la suite de tests, no el de un script operativo que deploy.sh invoca
# con argumentos. verify-infra.sh —el otro script operativo de este repo con
# la misma forma de reportar casos— ya resuelve esto igual: define su propio
# ok/bad en vez de sourcear lib-asserts.sh. Cuatro líneas duplicadas pesan
# menos que atarse a un contrato ajeno.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
source scripts/lib/deploy-comun.sh

URL_BASE="${1:-}"
SHA_ESPERADO="${2:-}"
if [[ -z "$URL_BASE" || -z "$SHA_ESPERADO" ]]; then
  echo "uso: smoke.sh <url_base> <sha_esperado>" >&2
  exit 2
fi

PASS=0
FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

# Una sola llamada al healthcheck, reusada por varios casos: cada request es un
# ida y vuelta a Postgres con un pool de máximo 5, y golpearlo cuatro veces
# para preguntar cuatro cosas del mismo JSON no prueba nada extra.
#
# Si el stack está caído o no contesta a tiempo, SALUD queda vacío y cada caso
# que depende de él (health_sano, sha_esperado, rol_sin_privilegios) falla por
# su cuenta con health_ok/sha_del_health fallando cerrado sobre un string
# vacío — no es un cuelgue ni una cascada muda, son fallas explícitas, una por
# caso, con --max-time cortando la espera.
SALUD=$(curl -fsS --max-time 10 "$URL_BASE/api/health" 2>/dev/null) || SALUD=""

caso_health_responde() {
  [[ -n "$SALUD" ]]
}

caso_health_sano() {
  health_ok "$SALUD"
}

# Que la app esté hablando con la base que cree, y no con la de otro stack.
caso_sha_esperado() {
  local sha
  sha=$(sha_del_health "$SALUD") || return 1
  [[ "$sha" == "$SHA_ESPERADO" ]]
}

# El check `rol` reporta con qué rol está conectada. Si dice superusuario, las
# policies de RLS no aplican y el aislamiento entre tenants es decorativo.
caso_rol_sin_privilegios() {
  printf '%s' "$SALUD" | jq -e '
    [.checks[] | select(.name == "rol")] | length == 1
    and (.[0].ok == true)
    and (.[0].detail | test("rol=arandano_app"))
  ' >/dev/null 2>&1
}

caso_home_responde() {
  curl -fsS --max-time 10 -o /dev/null "$URL_BASE/"
}

printf '\n\033[1mSmoke: %s\033[0m\n' "$URL_BASE"
for caso in \
  caso_health_responde \
  caso_health_sano \
  caso_sha_esperado \
  caso_rol_sin_privilegios \
  caso_home_responde
do
  if "$caso"; then ok "$caso"; else bad "$caso"; fi
done

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
