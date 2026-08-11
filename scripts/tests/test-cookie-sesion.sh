#!/usr/bin/env bash
# Tests de cookie_de_sesion (scripts/lib/cookie-sesion.sh).
#
# `set -o pipefail` acá NO es copiar y pegar: es la condición bajo la cual el
# bug que motivó estos tests existe. Sin pipefail, un SIGPIPE en una etapa
# intermedia pasa desapercibido y el caso del cuerpo grande daría verde siempre,
# probando nada.
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
source scripts/tests/lib-asserts.sh
source scripts/lib/cookie-sesion.sh

# La forma real de lo que devuelve Better Auth en un login exitoso.
cabecera_ok() {
  printf 'HTTP/1.1 200 OK\r\n'
  printf 'content-type: application/json\r\n'
  printf 'set-cookie: better-auth.session_token=abc123; Path=/; HttpOnly; SameSite=Lax\r\n'
}

cookie=$(cabecera_ok | cookie_de_sesion)
check_eq "extrae nombre=valor y descarta los atributos" \
  'better-auth.session_token=abc123' "$cookie"

# EL CASO QUE IMPORTA. Un cuerpo grande es lo que hace que el escritor siga
# escribiendo cuando una etapa que corta temprano ya cerró la lectura. Con la
# forma vieja (`grep -m1`) esto sale 141 bajo pipefail y quien llama se queda
# con la cadena vacía, teniendo la cookie correcta a mano.
cuerpo_grande=$(head -c 400000 /dev/zero | tr '\0' 'x')
salida=$({ cabecera_ok; printf '\r\n%s\n' "$cuerpo_grande"; } | cookie_de_sesion)
codigo=$?
check_eq "con un cuerpo grande, la pipeline NO sale en 141 (SIGPIPE)" 0 "$codigo"
check_eq "con un cuerpo grande, la cookie sale igual" \
  'better-auth.session_token=abc123' "$salida"

# El prefijo __Secure- se lo antepone Better Auth cuando la cookie es segura.
# Buscar el nombre completo `better-auth.session_token=` anclado al principio
# lo perdería.
cookie=$(printf 'set-cookie: __Secure-better-auth.session_token=xyz; Path=/\r\n' \
  | cookie_de_sesion)
check_eq "encuentra la cookie con prefijo __Secure-" \
  '__Secure-better-auth.session_token=xyz' "$cookie"

# El señuelo del cookie cache. Si algún día se prende, sale ANTES o DESPUÉS sin
# garantía de orden: tomar "la primera Set-Cookie" agarraría la equivocada.
cookie=$(printf 'set-cookie: better-auth.session_data=señuelo; Path=/\r\nset-cookie: better-auth.session_token=abc123; Path=/\r\n' \
  | cookie_de_sesion)
check_eq "ignora session_data y toma session_token" \
  'better-auth.session_token=abc123' "$cookie"

# Un atributo posterior no puede hacerse pasar por el par nombre=valor.
cookie=$(printf 'set-cookie: otra=1; comentario=session_token=falso\r\nset-cookie: better-auth.session_token=abc123; Path=/\r\n' \
  | cookie_de_sesion)
check_eq "un atributo que menciona session_token no cuenta como la cookie" \
  'better-auth.session_token=abc123' "$cookie"

# Un login fallido: 401 y ningún Set-Cookie de sesión. Tiene que fallar, para
# que caso_login_devuelve_sesion diga "el login se rompió" UNA vez en vez de
# mandar el rojo a las N pantallas.
check_false "sin cookie de sesión, falla" \
  bash -c 'source scripts/lib/cookie-sesion.sh
    printf "HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\n" | cookie_de_sesion'

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
