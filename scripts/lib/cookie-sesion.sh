#!/usr/bin/env bash
# La extracción de la cookie de sesión de una respuesta HTTP cruda.
#
# Vive acá y no adentro de smoke.sh porque un archivo de test no puede sourcear
# smoke.sh: ese script ejecuta sus casos al sourcearse. Mismo reparto que
# scripts/lib/rutas-comun.sh y scripts/tests/test-rutas-comun.sh.
#
# Este archivo sólo define una función. No ejecuta nada.

# Imprime `nombre=valor` de la cookie de sesión que venga en una respuesta HTTP
# cruda (headers incluidos, o sea `curl -i`), leída por stdin. Devuelve 1 si no
# hay ninguna.
#
# --- Por qué esta función existe en vez de ser una línea suelta ---
#
# Se busca la cookie POR NOMBRE (`session_token=`) y no "la primera Set-Cookie".
# Hoy sale una sola —`session.cookieCache` no está configurado y
# `crossSubDomainCookies` está apagado (lib/auth/opciones.ts)—, pero nada de eso
# está pinneado: el día que se prenda el cookie cache, quedarse con la primera
# tomaría `session_data` y TODAS las pantallas se pondrían rojas con un mensaje
# que habla de la aplicación. Y al revés: sin filtrar por nombre, un login
# FALLIDO que devolviera cualquier Set-Cookie daría una cookie "válida" y
# mandaría el rojo a las N pantallas en vez de decir "el login se rompió" una
# sola vez. El `[^;]*` acota al par nombre=valor para que un atributo posterior
# no cuente; `session_token` y no el nombre completo, para no atarse al prefijo
# `better-auth.` que la librería puede renombrar (ni al `__Secure-` que le
# antepone cuando la cookie es segura).
#
# --- Y por qué NINGUNA etapa corta la lectura antes de tiempo ---
#
# Esto no es prolijidad. Bajo `set -o pipefail`, cualquier etapa que salga
# temprano le manda SIGPIPE al escritor de arriba y la pipeline entera reporta
# 141 aunque la última etapa ya haya impreso la cookie correcta. Quien llama
# hace `|| COOKIE_SESION=""` y pisa un valor bueno con uno vacío.
#
# Lo peor es que es una CARRERA contra el tamaño del cuerpo de la respuesta, así
# que no falla siempre: falla a veces. Un gate intermitente da rojo sobre código
# sano y enseña a re-correrlo hasta que salga verde, que es exactamente cómo un
# gate deja de ser un gate.
#
# Ya mordió dos veces, con las dos formas "obvias":
#   curl | tr | grep      | head -1   ← head corta a grep
#   curl | tr | grep -m1  | sed       ← grep -m1 corta a tr, y a curl detrás
# Medido: `yes x | tr x y | grep -m1 y` deja PIPESTATUS en `141 141 0`.
#
# Por eso: nada de `-m1`, `head`, `q` de sed ni `exit` de awk. `grep` sin -m1
# lee todo; `sed -n '1s//p'` imprime sólo la primera y sigue leyendo; `cut` lee
# todo. Un `grep` sin match devuelve 1, que acá es la respuesta correcta: no
# hubo cookie. scripts/tests/test-cookie-sesion.sh cubre el caso del cuerpo
# grande, que es el único que reproduce la carrera.
#
# El "no hubo cookie" se decide mirando el CONTENIDO y no el código de salida de
# la pipeline, a propósito: delegarlo en el `pipefail` de quien llama haría que
# la función fallara o no según las opciones de shell del caller — sourceada
# desde un test sin pipefail devolvía 0 con la cadena vacía. Además el contenido
# es el dato de verdad: una cookie vacía no sirve para entrar, salga la pipeline
# como salga.
cookie_de_sesion() {
  local cookie
  cookie=$(tr -d '\r' \
    | grep -i '^set-cookie: *[^;]*session_token=' \
    | sed -n '1s/^[Ss]et-[Cc]ookie: *//p' \
    | cut -d';' -f1) || true
  [[ -n "$cookie" ]] || return 1
  printf '%s\n' "$cookie"
}
