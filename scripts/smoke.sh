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
source scripts/lib/rutas-comun.sh
source scripts/lib/cookie-sesion.sh

URL_BASE="${1:-}"
SHA_ESPERADO="${2:-}"
DOMINIO_BASE="${3:-}"
SUBDOMINIO_CANARIO="${4:-}"
# El nombre, no sólo el subdominio: sin él, caso_tenant_resuelve sólo podía
# verificar que ALGÚN tenant salió en el cuerpo, no que fue el canario. Un
# nombre hardcodeado o el de otro tenant hubiera pasado igual.
NOMBRE_CANARIO="${5:-}"
if [[ -z "$URL_BASE" || -z "$SHA_ESPERADO" || -z "$DOMINIO_BASE" || -z "$SUBDOMINIO_CANARIO" || -z "$NOMBRE_CANARIO" ]]; then
  echo "uso: smoke.sh <url_base> <sha_esperado> <dominio_base> <subdominio_canario> <nombre_canario>" >&2
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
# El token llega por entorno, no por argumento: un argumento queda visible en
# `ps`. Sin él, /api/health devuelve sólo el veredicto y los casos que miran
# .checks[] y el sha fallan — que es lo correcto: significa que el smoke test
# no está probando lo que cree.
SALUD=$(curl -fsS --max-time 10 \
  -H "X-Arandano-Salud: ${ARANDANO_SALUD_TOKEN:?falta ARANDANO_SALUD_TOKEN}" \
  "$URL_BASE/api/health" 2>/dev/null) || SALUD=""

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

# El Host del APEX, no el del canario: caso_tenant_resuelve (más abajo) ya
# pega al Host del canario y verifica algo más fuerte que un curl -f solo, así
# que este caso quedaría enteramente subsumido si repitiera el mismo Host.
# En vez de duplicar, cubre la otra rama que no tenía ningún caso: el apex
# responde 200 con el placeholder y el cuerpo NO trae los testids de una
# página de tenant — si algún día el apex resolviera por error a un tenant
# (el bug inverso al que este ciclo entero existe para impedir), esto lo
# atrapa.
caso_home_responde() {
  local cuerpo
  cuerpo=$(curl -fsS --max-time 10 -H "Host: ${DOMINIO_BASE}" "$URL_BASE/") || return 1
  ! grep -q 'data-testid="tenant-nombre"' <<<"$cuerpo"
}

# El Host es obligatorio a partir de la resolución por subdominio: sin él, la
# request llega con la IP:puerto del stack, que es un dominio ajeno y responde
# 404. No es un workaround del test — es el mismo camino que hace un cliente.
#
# Contra /login y no contra /: desde el ciclo de autenticación, / exige sesión
# y redirige (caso_home_exige_sesion, más abajo, cubre esa rama). /login es
# ahora la página de tenant que se puede pedir sin credenciales, y muestra el
# nombre del local exactamente por esto.
#
# grep -F contra "testid>nombre" y no sólo contra el testid suelto: una
# regresión que renderizara un tenant hardcodeado o el tenant equivocado
# hubiera dejado pasar igual un chequeo que sólo mirara que EL ATRIBUTO está
# presente. El nombre viene por argumento (Task 7, hallazgo de review) y no
# hardcodeado acá, para no mantener dos copias del mismo literal que
# `deploy.sh` ya usa al dar de alta el canario de stage.
caso_tenant_resuelve() {
  curl -fsS --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/login" \
    | grep -qF "data-testid=\"tenant-nombre\">${NOMBRE_CANARIO}"
}

# Sin sesión, la home de un tenant no puede servir la aplicación: tiene que
# mandar al login. Si esto devolviera 200, el guard no estaría puesto — y
# sería indistinguible de que sí lo está, porque la página renderiza igual.
caso_home_exige_sesion() {
  local destino
  destino=$(curl -s -o /dev/null --max-time 10 -w '%{redirect_url}' \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/")
  [[ "$destino" == */login ]]
}

# El ápex no tiene login, y no puede delatar nada distinto de una ruta que no
# existe. CLAUDE.md ya tenía anotado que los casos de login entran acá cuando
# exista el login; éste y el de arriba son los primeros.
caso_login_no_existe_en_apex() {
  local code
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Host: ${DOMINIO_BASE}" "$URL_BASE/login")
  [[ "$code" == "404" ]]
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
# Contra /login y no contra /, por el mismo motivo que caso_tenant_resuelve:
# sobre una redirección esto mediría los headers del 307, no los de una página
# de tenant.
#
# La aserción es "no es cacheable públicamente" y no una comparación literal
# contra el Cache-Control que emite Next hoy: lo que importa es la propiedad, y
# atarse al texto exacto convierte un cambio de wording de Next en un deploy
# rollbackeado sin ninguna regresión real.
caso_tenant_no_cacheable() {
  local cc
  cc=$(curl -sI --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/login" \
       | tr -d '\r' | grep -i '^cache-control:' | head -1)
  [[ -n "$cc" ]] \
    && ! grep -qiE 'public|s-maxage' <<<"$cc" \
    && grep -qiE 'no-store|private' <<<"$cc"
}

# --- La aplicación, con una sesión de verdad -------------------------------
#
# Todo lo de arriba mira pantallas que se sirven SIN credenciales. Hasta acá,
# ninguna pantalla de la aplicación se abría nunca antes de que la abriera un
# cliente: el 2026-08-10 se promovió una imagen con /usuarios rota y las cuatro
# etapas del gate en verde, porque el defecto era de runtime y nadie pedía esa
# URL. Ver docs/superpowers/specs/2026-08-10-smoke-autenticado-design.md.

# La clave la define deploy.sh en el paso 8, con definir-clave.mts adentro de la
# imagen de migración. Literal duplicado ahí y acá, igual que efimero-salud:
# base efímera que nace vacía en cada corrida, y stack que sólo escucha en la IP
# de Tailscale. Si alguna de esas dos condiciones deja de valer, esto deja de
# ser aceptable.
CLAVE_CANARIO=efimero-clave-canario
MAIL_CANARIO=canario@arandano.app
HOST_CANARIO="${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}"

# Sin header Origin y sin Cookie, a propósito: el chequeo de origen de Better
# Auth se saltea cuando el request no trae Cookie (ver lib/auth/opciones.ts,
# donde eso está documentado como el agujero que disabledPaths vino a tapar).
# Mandar un Origin acá sólo agregaría una forma de equivocarse — tendría que ser
# EXACTAMENTE el que arma lib/auth/origen.ts para este stack, con PUERTO_PUBLICO
# incluido, y no el de la URL de la conexión.
#
# El login se hace UNA sola vez y la cookie se reusa: /sign-in/email tiene un
# rate limit de 5 por minuto (opciones.ts), así que un login por pantalla
# empezaría a dar 429 en cuanto haya seis pantallas — y esa falla se leería como
# una regresión de la aplicación.
#
# La respuesta se captura APARTE de la extracción, y no en una sola pipeline con
# el curl adentro: así el código de salida del curl se lee solo, sin mezclarse
# con el de la extracción — que fue exactamente cómo un SIGPIPE río arriba
# terminó borrando una cookie válida (ver scripts/lib/cookie-sesion.sh, que
# lleva la historia completa y los tests que la cubren).
RESPUESTA_LOGIN=$(curl -s -i --max-time 15 \
  -H "Host: ${HOST_CANARIO}" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"${MAIL_CANARIO}\",\"password\":\"${CLAVE_CANARIO}\"}" \
  "$URL_BASE/api/auth/sign-in/email" 2>/dev/null) || RESPUESTA_LOGIN=""

COOKIE_SESION=$(printf '%s\n' "$RESPUESTA_LOGIN" | cookie_de_sesion) || COOKIE_SESION=""

# Su propio caso, y no un chequeo silencioso adentro de los de abajo: si el
# login se rompe, esto tiene que decir "el login se rompió" una vez, y no
# hacer fallar N pantallas con un mensaje que habla de la pantalla equivocada.
caso_login_devuelve_sesion() {
  [[ -n "$COOKIE_SESION" ]]
}

# Cada pantalla de la aplicación, con la sesión de verdad.
#
# 200 NO alcanza: Next devuelve 200 sirviendo un not-found. El marcador es el
# nombre del local — el mismo valor que el paso 8 acaba de escribir en la base,
# y el mismo argumento que ya usa caso_tenant_resuelve.
#
# QUÉ CUBRE ESTO, EXACTAMENTE. Para `/` el marcador lo emite la página
# (app/page.tsx), así que la aserción prueba que la PÁGINA renderizó. Para las
# rutas de (app) lo emite el layout (app/(app)/layout.tsx), así que prueba que
# el layout renderizó y que la página no tiró: una página que devuelva
# contenido vacío sin lanzar excepción pasa en verde. Hoy alcanza porque
# notFound() y las excepciones no manejadas caen en el boundary de la RAÍZ, que
# no renderiza el layout de (app) — de ahí el rojo. Pero un `error.tsx` o un
# `not-found.tsx` DENTRO de (app) se montarían adentro de ese layout: el
# marcador saldría igual, con 200, y este barrido se volvería verde sobre una
# pantalla rota. No existe ninguno de los dos hoy, y test/boundaries-app.test.ts
# falla si alguien agrega uno, justamente para que esa decisión no se tome sin
# mirar esta línea.
#
# NO se busca el texto del 404 en el cuerpo, y esto costó una tarde: Next
# incluye el boundary de "not found" en el payload de TODA página, incluidas
# las que funcionan. Un chequeo así da rojo siempre.
#
# Sin `-L`, y no por casualidad: app/login/formulario.tsx lleva el MISMO
# marcador, así que con redirects habilitados cualquier ruta que rebotara a
# /login pasaría en verde. Una redirección tiene que ser rojo acá.
caso_pantalla() {
  local ruta="$1" respuesta codigo cuerpo
  [[ -n "$COOKIE_SESION" ]] || return 1
  respuesta=$(curl -s --max-time 15 -w $'\n%{http_code}' \
    -H "Host: ${HOST_CANARIO}" \
    -H "Cookie: ${COOKIE_SESION}" \
    "${URL_BASE}${ruta}" 2>/dev/null) || return 1
  codigo="${respuesta##*$'\n'}"
  cuerpo="${respuesta%$'\n'*}"
  [[ "$codigo" == "200" ]] || return 1
  grep -qF "data-testid=\"tenant-nombre\">${NOMBRE_CANARIO}" <<<"$cuerpo"
}

# La lista sale del sistema de archivos, no de acá: ver scripts/lib/rutas-comun.sh.
# Si la derivación falla —cero páginas, o una ruta con parámetro sin declarar—
# el smoke entero corta acá, antes de reportar ningún verde.
RUTAS_APP_CRUDAS=$(rutas_autenticadas 'app/(app)') || {
  printf '\n\033[31mno se pudo derivar la lista de rutas autenticadas\033[0m\n' >&2
  exit 1
}
# `/` primero, y a mano: no vive bajo (app) —el ápex llega por esa misma ruta y
# no tiene sesión— pero para un tenant es una pantalla autenticada, porque llama
# a exigirSesion() por su cuenta. Es la misma excepción, con la misma razón, que
# declara FUERA_DEL_GRUPO en test/rutas-con-guard.test.ts.
#
# El bucle y no `mapfile`: si TODAS las páginas del grupo estuvieran declaradas
# en RUTAS_SIN_SMOKE, la salida sería un string vacío y `mapfile` dejaría un
# elemento vacío que se pediría como "$URL_BASE" pelado — o sea `/` otra vez,
# reportado con un nombre que no dice nada.
#
# Si algún día `/` se mudara bajo (app), esta línea tiene que salir: quedarían
# dos casos `pantalla /`, los dos verdes, y el segundo no probaría nada.
#
# La lista sale del ÁRBOL DE TRABAJO, no de la imagen que se está por promover.
# Contra el gate son lo mismo, porque el paso 1 exige working tree limpio y el
# build sale de ese mismo commit. Corrido a mano desde otro checkout, en cambio,
# este barrido puede pedir rutas que la imagen no tiene: eso es un rojo honesto,
# pero habla del checkout y no de la imagen.
RUTAS_APP=('/')
while IFS= read -r ruta_derivada; do
  [[ -n "$ruta_derivada" ]] && RUTAS_APP+=("$ruta_derivada")
done <<<"$RUTAS_APP_CRUDAS"

printf '\n\033[1mSmoke: %s\033[0m\n' "$URL_BASE"
for caso in \
  caso_health_responde \
  caso_health_sano \
  caso_sha_esperado \
  caso_rol_sin_privilegios \
  caso_check_tenant \
  caso_home_responde \
  caso_home_exige_sesion \
  caso_tenant_resuelve \
  caso_login_no_existe_en_apex \
  caso_subdominio_inexistente_404 \
  caso_host_ajeno_404 \
  caso_tenant_no_cacheable \
  caso_login_devuelve_sesion
do
  if "$caso"; then ok "$caso"; else bad "$caso"; fi
done

# Un caso por pantalla, con su ruta en el nombre: cuando esto falla, el renglón
# rojo ya dice cuál pantalla, sin abrir un log.
for ruta in "${RUTAS_APP[@]}"; do
  if caso_pantalla "$ruta"; then ok "pantalla ${ruta}"; else bad "pantalla ${ruta}"; fi
done

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
