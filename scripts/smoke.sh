#!/usr/bin/env bash
# Smoke tests: los caminos que más duelen, contra un stack ya levantado.
#
# Recibe la URL base por argumento en vez de fijarla, porque el mismo archivo
# corre contra arandano-stage durante el gate y podría correr contra cualquier
# otro stack. Nunca contra producción con datos de clientes: acá se escribe.
#
# Un caso por función, y la lista abajo. Sumar un caso es agregar una función y
# un renglón. Hoy cubre /api/health, las pantallas sin credenciales, un login
# real contra /api/auth/sign-in/email y —con esa sesión— cada pantalla de
# app/(app)/**/page.tsx, caso_home_redirige_a_vender (/ ya no es una pantalla
# propia, así que lo que se cubre es el redirect), y el login POR LA PANTALLA,
# que es lo único que ejercita el redirect de un server action. Lo que falta
# (venta, factura, orden de trabajo, catálogo público) entra cuando exista ese
# código.
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
# El mail, por argumento y no como literal acá: deploy.sh lo tiene en
# MAIL_CANARIO y es el MISMO con el que le define la clave al canario de stage
# en el paso 8. Repetirlo acá sería mantener dos copias que fallan cerrado pero
# con un mensaje que habla de otra cosa ("el login se rompió").
MAIL_CANARIO="${6:-}"
if [[ -z "$URL_BASE" || -z "$SHA_ESPERADO" || -z "$DOMINIO_BASE" || -z "$SUBDOMINIO_CANARIO" || -z "$NOMBRE_CANARIO" || -z "$MAIL_CANARIO" ]]; then
  echo "uso: smoke.sh <url_base> <sha_esperado> <dominio_base> <subdominio_canario> <nombre_canario> <mail_canario>" >&2
  exit 2
fi

PASS=0
FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }
# Ni ok ni bad: no toca ningún contador. Sólo se usa para lo que no se pudo
# ejercitar porque ya falló algo río arriba, y ese algo ya sumó su propio rojo —
# así el gate sigue frenando sin que el renglón omitido finja un verde.
omit() { printf '  \033[33m–\033[0m %s\n' "$1"; }

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
# responde 200 con la landing, y no con el placeholder de antes de este ciclo.
#
# El ápex sirve la landing, y eso son DOS afirmaciones que hay que hacer
# juntas: que no es una página de tenant (el testid ausente) y que es la
# landing de verdad (el <Formulario> presente). Sin la segunda, un ápex que
# sirviera una página en blanco pasaba igual — que es exactamente lo que
# servía antes de este ciclo.
#
# `name="contacto"` y no `name="nombre"`: la Task 5 del cierre del rediseño
# achicó el formulario de cinco campos a uno solo, y este grep se quedó
# buscando un campo que ya no existe (Critical de la review final). El caso
# se llama caso_home_responde, así que el rojo hablaba de "la home no
# responde" mientras la home respondía perfecto — el peor modo de falla
# posible en un gate. Y como `npm test` no corre este script, nada lo vio
# hasta que alguien deployó. `app/sitio/landing.test.tsx` ata este mismo
# patrón al markup real, para que la próxima vez que diverja se note acá.
# Y ahora es "el <Formulario>" en singular ya no aplica: la landing lo
# renderiza DOS veces (Hero y Cierre) desde este mismo ciclo, pero un solo
# grep alcanza para las dos porque el campo se llama igual en las dos.
caso_home_responde() {
  local cuerpo
  cuerpo=$(curl -fsS --max-time 10 -H "Host: ${DOMINIO_BASE}" "$URL_BASE/") || return 1
  ! grep -q 'data-testid="tenant-nombre"' <<<"$cuerpo" || return 1
  grep -q 'name="contacto"' <<<"$cuerpo"
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
#
# El cuerpo se captura ANTES de greppearlo, y no `curl | grep -qF`: `grep -q`
# sale apenas encuentra el match, le manda SIGPIPE al curl que todavía está
# escribiendo, y bajo `set -o pipefail` la función devuelve 141 CON el marcador
# presente en el cuerpo. Es la misma carrera que documenta
# scripts/lib/cookie-sesion.sh, y acá el retorno de la pipeline ES el retorno de
# la función, así que no hay nada que la absorba. Hoy no muerde porque /login es
# chica, pero eso crece con cada componente que se le sume — o sea que el gate
# se volvería intermitente sin que nadie tocara esta línea.
caso_tenant_resuelve() {
  local cuerpo
  cuerpo=$(curl -fsS --max-time 10 \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/login") || return 1
  grep -qF "data-testid=\"tenant-nombre\">${NOMBRE_CANARIO}" <<<"$cuerpo"
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

# El home es la aplicación abierta en la pestaña por defecto, así que `/` con
# sesión tiene que mandar a /vender. Se afirma el DESTINO y no sólo que hubo
# un redirect: un rebote a /login también sería un redirect, y significaría
# que el guard se rompió.
caso_home_redirige_a_vender() {
  local destino
  destino=$(curl -s -o /dev/null --max-time 10 -w '%{redirect_url}' \
    -H "Cookie: ${COOKIE_SESION}" \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/")
  [[ "$destino" == */vender ]]
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

# El 404 Y la página propia, en el mismo caso.
#
# El código solo no alcanza desde que existe app/not-found.tsx: sin el marcador,
# este caso pasaría igual con el 404 pelado de Next —que es el que se ve en
# cualquier deploy de Vercel—, o sea que el gate no distinguiría si nuestra
# página existe. Borrarla dejaría el gate entero en verde.
#
# El marcador es "pagina-404" y NO el texto del cuerpo: Next incluye el payload
# de ese boundary en TODA página, así que buscar el texto acá funcionaría pero
# entrenaría a buscarlo también donde da rojo siempre (ver el comentario de
# caso_pantalla). Un data-testid es lo mismo para este caso y no tiene esa
# trampa.
#
# Se busca el marcador PELADO y no `data-testid="pagina-404"`, y no es
# tolerancia: el boundary de la raíz no se sirve como HTML. Medido contra
# arandano-ensayo con una imagen de producción, el 404 llega con
# `<html id="__next_error__">`, el `<body>` vacío y TODO el árbol en el payload
# de Flight — donde el atributo aparece como `\"data-testid\":\"pagina-404\"`.
# La versión con comillas daba rojo contra un build real y verde contra nada.
# Esta forma es verdadera en las dos.
#
# El cuerpo se captura ANTES de greppearlo, por la carrera de SIGPIPE que ya
# documenta caso_tenant_resuelve: `curl | grep -q` devuelve 141 bajo pipefail
# CON el marcador presente.
caso_subdominio_inexistente_404() {
  local respuesta codigo cuerpo
  respuesta=$(curl -s --max-time 10 -w $'\n%{http_code}' \
    -H "Host: no-existe-jamas.${DOMINIO_BASE}" "$URL_BASE/") || return 1
  codigo="${respuesta##*$'\n'}"
  cuerpo="${respuesta%$'\n'*}"
  [[ "$codigo" == "404" ]] || return 1
  grep -qF 'pagina-404' <<<"$cuerpo"
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
#
# El `head -1` de acá abajo sí es seguro, a diferencia del de la extracción de la
# cookie: el código de salida de la pipeline se descarta —la decisión se toma
# después, mirando `$cc`— así que un 141 por SIGPIPE no puede volver rojo un caso
# sano. Queda anotado para que nadie lo "arregle" ni copie el patrón a un lugar
# donde el retorno de la pipeline sí sea el del caso.
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

# El login POR LA PANTALLA, no por la API — el único caso que ejercita el
# redirect de un server action.
#
# POR QUÉ EXISTE. caso_login_devuelve_sesion entra por
# /api/auth/sign-in/email, que es un endpoint común y corriente: nunca pasa
# por app/login/acciones.ts ni por el redirect('/vender') del final. Y ese
# redirect es lo único que ejercita el camino que Next resuelve con un
# fetch() contra sí mismo.
#
# SIN header Origin, por el mismo motivo que el login de arriba: Next deja
# pasar un action sin Origin (loguea un warning), y mandarlo obligaría a
# armarlo EXACTAMENTE igual al de la conexión —esquema y puerto incluidos— o
# el chequeo CSRF aborta el action y este caso daría rojo hablando de otra cosa.
#
# LOS TRES CAMPOS son el formato con el que React serializa los argumentos de
# un action invocado desde el cliente (`encodeReply`): `0` lleva los argumentos
# con la FormData por referencia, y sus entradas van aparte con prefijo `_1_`.
# Es formato interno de React: si un día una actualización lo cambia, este caso
# se va a poner rojo con la acción devolviendo el estado de error en vez de un
# 303. Es el precio de cubrir el camino de verdad, y el rojo apunta acá.
caso_login_por_la_pantalla() {
  local html id respuesta codigo cuerpo
  html=$(curl -s --max-time 15 -H "Host: ${HOST_CANARIO}" "$URL_BASE/login") || return 1
  # El id del action sale del HTML que sirve la propia imagen: hardcodearlo
  # sería fijar un hash que cambia en cada build.
  id=$(grep -o 'name="\$ACTION_[0-9]*:0"[^>]*value="{&quot;id&quot;:&quot;[a-f0-9]*' <<<"$html" \
    | sed 's/.*&quot;//' | head -1)
  [[ -n "$id" ]] || return 1

  respuesta=$(curl -s --max-time 15 -w $'\n%{http_code}' \
    -H "Host: ${HOST_CANARIO}" \
    -H "Next-Action: ${id}" \
    -F "_1_email=${MAIL_CANARIO}" \
    -F "_1_clave=${CLAVE_CANARIO}" \
    -F '0=[{"error":null},"$K1"]' \
    "$URL_BASE/login" 2>/dev/null) || return 1
  codigo="${respuesta##*$'\n'}"
  cuerpo="${respuesta%$'\n'*}"

  # 303 y no 200: un 200 es el action devolviendo { error } sin redirigir, o
  # sea que el login falló o que el encoding de arriba dejó de valer.
  [[ "$codigo" == "303" ]] || return 1
  # OJO al diagnosticar un rojo acá: el cuerpo trae el render incrustado del
  # DESTINO del redirect, y desde este ciclo el destino es /vender —que
  # consulta la base— y no / —que era estático—. Un /vender roto pinta este
  # caso de rojo diciendo "login por la pantalla" y no habla del punto de venta.
  # El nombre del local prueba que el render incrustado resolvió el tenant
  # —era exactamente lo que fallaba—, y usuario-nombre prueba que además es la
  # home autenticada y no la pantalla de login: /login lleva el MISMO marcador
  # tenant-nombre (ver app/login/formulario.tsx), así que sin este segundo
  # grep un rebote al login pasaría en verde. Es la misma trampa por la que el
  # barrido de pantallas corre sin `-L`.
  grep -qF "\"tenant-nombre\",\"children\":\"${NOMBRE_CANARIO}\"" <<<"$cuerpo" &&
    grep -qF 'usuario-nombre' <<<"$cuerpo"
}

# Cada pantalla de la aplicación, con la sesión de verdad.
#
# 200 NO alcanza: Next devuelve 200 sirviendo un not-found. El marcador es el
# nombre del local — el mismo valor que el paso 8 acaba de escribir en la base,
# y el mismo argumento que ya usa caso_tenant_resuelve.
#
# QUÉ CUBRE ESTO, EXACTAMENTE. El marcador lo emite el layout del grupo
# (app/(app)/layout.tsx), así que la aserción prueba que ESE layout renderizó y
# que la página no tiró: una página que devuelva contenido vacío sin lanzar
# excepción pasa en verde. Hoy alcanza porque notFound() y las excepciones no
# manejadas caen en el boundary de la RAÍZ, que no renderiza el layout de (app)
# — de ahí el rojo. Pero un `error.tsx` o un `not-found.tsx` DENTRO de (app) se
# montarían adentro de ese layout: el marcador saldría igual, con 200, y este
# barrido se volvería verde sobre una pantalla rota. No existe ninguno de los
# dos hoy, y test/boundaries-app.test.ts falla si alguien agrega uno,
# justamente para que esa decisión no se tome sin mirar esta línea.
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
  # Redundante con el `if` que decide si el barrido corre, y a propósito: sin
  # esto, llamar a caso_pantalla desde otro lado pediría la ruta SIN cookie y un
  # 200 anónimo se leería como pantalla sana. Falla cerrado por su cuenta.
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
# El bucle y no `mapfile`: si TODAS las páginas del grupo estuvieran declaradas
# en RUTAS_SIN_SMOKE, la salida sería un string vacío y `mapfile` dejaría un
# elemento vacío que se pediría como "$URL_BASE" pelado — o sea `/` pedido sin
# ruta, reportado con un nombre que no dice nada.
#
# La lista sale del ÁRBOL DE TRABAJO, no de la imagen que se está por promover.
# Contra el gate son lo mismo, porque el paso 1 exige working tree limpio y el
# build sale de ese mismo commit. Corrido a mano desde otro checkout, en cambio,
# este barrido puede pedir rutas que la imagen no tiene: eso es un rojo honesto,
# pero habla del checkout y no de la imagen.
#
# `/` NO va acá desde que redirige a /vender: el barrido abre cada ruta sin
# `-L` y exige 200. Su contrato lo fija caso_home_redirige_a_vender, que es
# una aserción más fuerte que la vieja —"algo renderizó con el nombre del
# local"— porque nombra el destino.
RUTAS_APP=()
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
  caso_login_devuelve_sesion \
  caso_login_por_la_pantalla
do
  if "$caso"; then ok "$caso"; else bad "$caso"; fi
done

# Un caso por pantalla, con su ruta en el nombre: cuando esto falla, el renglón
# rojo ya dice cuál pantalla, sin abrir un log.
#
# Sin sesión el barrido no corre, y eso es deliberado: cada pantalla daría rojo
# por la misma causa única —el login— y el abanico esconde el diagnóstico atrás
# de N renglones que hablan de la pantalla equivocada. Ya pasó: el runbook
# documenta el flake del SIGPIPE como "TRES rojos… y a primera vista parecía que
# el login se había roto", y el ruido crece con cada pantalla que se agregue.
#
# No afloja el gate: caso_login_devuelve_sesion ya sumó su rojo unas líneas más
# arriba, así que FAIL ya es distinto de cero y el smoke igual sale con 1.
if [[ -n "$COOKIE_SESION" ]]; then
  if caso_home_redirige_a_vender; then ok "/ manda a /vender"; else bad "/ manda a /vender"; fi
  for ruta in "${RUTAS_APP[@]}"; do
    if caso_pantalla "$ruta"; then ok "pantalla ${ruta}"; else bad "pantalla ${ruta}"; fi
  done
else
  # +1: sin sesión tampoco corre caso_home_redirige_a_vender, no sólo el
  # barrido de RUTAS_APP — el conteo tiene que incluirlo o miente de menos.
  omit "$((${#RUTAS_APP[@]} + 1)) chequeos omitidos: sin sesión (ver caso_login_devuelve_sesion)"
fi

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
