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
DOMINIO_BASE="${3:-}"
SUBDOMINIO_CANARIO="${4:-}"
if [[ -z "$URL_BASE" || -z "$SHA_ESPERADO" || -z "$DOMINIO_BASE" || -z "$SUBDOMINIO_CANARIO" ]]; then
  echo "uso: smoke.sh <url_base> <sha_esperado> <dominio_base> <subdominio_canario>" >&2
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

# El check que comprueba que RLS está filtrando en las dos direcciones. Si
# falla, el aislamiento entre tenants no aplica.
caso_check_tenant() {
  printf '%s' "$SALUD" | jq -e '
    [.checks[] | select(.name == "tenant")] | length == 1
    and (.[0].ok == true)
  ' >/dev/null 2>&1
}

# El Host es obligatorio a partir de la resolución por subdominio: sin él, la
# request llega con la IP:puerto del stack, que es un dominio ajeno y responde
# 404. No es un workaround del test — es el mismo camino que hace un cliente.
caso_home_responde() {
  curl -fsS --max-time 10 -o /dev/null \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/"
}

caso_tenant_resuelve() {
  curl -fsS --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/" \
    | grep -q 'data-testid="tenant-nombre"'
}

caso_subdominio_inexistente_404() {
  local code
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Host: no-existe-jamas.${DOMINIO_BASE}" "$URL_BASE/")
  [[ "$code" == "404" ]]
}

caso_host_ajeno_404() {
  local code
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Host: ejemplo.com" "$URL_BASE/")
  [[ "$code" == "404" ]]
}

# Una página de tenant guardada por una cache compartida y servida a otro
# tenant es una fuga de datos entre clientes — el modo de falla que todo el
# resto de este diseño existe para impedir. Leer headers() ya obliga a Next a
# renderizar dinámicamente; esto verifica que la respuesta que sale por el cable
# lo diga, que es lo único que una cache intermedia va a mirar.
#
# La aserción es "no es cacheable públicamente" y no una comparación literal
# contra el Cache-Control que emite Next hoy: lo que importa es la propiedad, y
# atarse al texto exacto convierte un cambio de wording de Next en un deploy
# rollbackeado sin ninguna regresión real.
caso_tenant_no_cacheable() {
  local cc
  cc=$(curl -sI --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/" \
       | tr -d '\r' | grep -i '^cache-control:' | head -1)
  [[ -n "$cc" ]] \
    && ! grep -qiE 'public|s-maxage' <<<"$cc" \
    && grep -qiE 'no-store|private' <<<"$cc"
}

printf '\n\033[1mSmoke: %s\033[0m\n' "$URL_BASE"
for caso in \
  caso_health_responde \
  caso_health_sano \
  caso_sha_esperado \
  caso_rol_sin_privilegios \
  caso_check_tenant \
  caso_home_responde \
  caso_tenant_resuelve \
  caso_subdominio_inexistente_404 \
  caso_host_ajeno_404 \
  caso_tenant_no_cacheable
do
  if "$caso"; then ok "$caso"; else bad "$caso"; fi
done

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
