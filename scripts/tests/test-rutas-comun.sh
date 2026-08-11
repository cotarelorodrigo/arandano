#!/usr/bin/env bash
# Tests de la derivación de rutas autenticadas.
#
# Contra directorios de FIXTURE y no contra app/ del repo: atar el test al
# árbol real lo convierte en una lista a mano por la puerta de atrás — cada
# pantalla nueva lo rompería, y la respuesta sería editar el test hasta que
# vuelva a pasar. Lo que se prueba acá es la derivación, no el contenido de
# app/.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/tests/lib-asserts.sh
source scripts/lib/rutas-comun.sh

# /var/tmp y no /tmp: regla del repo.
RAIZ="$(mktemp -d /var/tmp/arandano-rutas.XXXXXX)"
trap 'rm -rf "$RAIZ"' EXIT

# --- Fixture: la forma real de app/(app)/, más las dos que todavía no existen
# (un grupo anidado y una ruta con parámetro).
mkdir -p "$RAIZ/(app)/usuarios" \
         "$RAIZ/(app)/caja" \
         "$RAIZ/(app)/(reportes)/margen"
touch "$RAIZ/(app)/usuarios/page.tsx" \
      "$RAIZ/(app)/caja/page.tsx" \
      "$RAIZ/(app)/(reportes)/margen/page.tsx"
# Un archivo que NO es una página, para que el find no lo levante.
touch "$RAIZ/(app)/usuarios/formularios.tsx"

salida=$(rutas_autenticadas "$RAIZ/(app)")
check_eq "deriva una ruta por página, ordenadas" \
  $'/caja\n/margen\n/usuarios' "$salida"

check_true "el grupo anidado no aparece en la URL" \
  grep -qx '/margen' <<<"$salida"

check_false "un archivo que no es page.tsx no produce ruta" \
  grep -q 'formularios' <<<"$salida"

# --- Un directorio sin páginas falla, y no devuelve una lista vacía en verde.
# Es la mitad que hace que esto no sea decorativo: un barrido de cero rutas que
# reporta cero fallas es exactamente el modo de falla que este archivo existe
# para impedir.
VACIO="$(mktemp -d /var/tmp/arandano-rutas-vacio.XXXXXX)"
trap 'rm -rf "$RAIZ" "$VACIO"' EXIT
check_false "un directorio sin páginas falla" rutas_autenticadas "$VACIO"

# --- Una ruta con parámetro sin declarar falla.
mkdir -p "$RAIZ/(app)/ventas/[id]"
touch "$RAIZ/(app)/ventas/[id]/page.tsx"
check_false "una ruta con parámetro sin declarar falla" \
  rutas_autenticadas "$RAIZ/(app)"

# --- Declarada, se saltea y el resto sigue saliendo.
RUTAS_SIN_SMOKE['/ventas/[id]']='no hay de dónde sacar un id sin sembrar datos'
salida=$(rutas_autenticadas "$RAIZ/(app)")
check_eq "una ruta declarada se saltea, y las demás siguen" \
  $'/caja\n/margen\n/usuarios' "$salida"

# --- El ordenamiento es invariante al locale.
# LC_ALL=C cambia el orden de sort(): las rutas deben estar ordenadas después de
# la derivación, no antes. De lo contrario, (reportes)/margen queda al principio.
salida_c=$(LC_ALL=C rutas_autenticadas "$RAIZ/(app)")
check_eq "el ordenamiento es invariante al locale LC_ALL=C" \
  $'/caja\n/margen\n/usuarios' "$salida_c"

# Una exención sin razón escrita no es una exención revisable: tiene que fallar
# igual que una ruta con parámetro sin declarar.
mkdir -p "$RAIZ/(app)/ventas/[id]"
: > "$RAIZ/(app)/ventas/[id]/page.tsx"
RUTAS_SIN_SMOKE['/ventas/[id]']=''
check_false "una ruta declarada con razón vacía falla" \
  rutas_autenticadas "$RAIZ/(app)"
RUTAS_SIN_SMOKE['/ventas/[id]']='no hay id válido sin sembrar datos'
# Envuelta para que la lista de rutas no se mezcle con los ✓ del reporte: acá
# sólo importa el código de salida, y la salida en sí ya la cubren los casos de
# arriba con check_eq.
rutas_sin_imprimir() { rutas_autenticadas "$1" >/dev/null; }
check_true "la misma ruta, con razón escrita, pasa" \
  rutas_sin_imprimir "$RAIZ/(app)"
rm -rf "$RAIZ/(app)/ventas"
unset 'RUTAS_SIN_SMOKE[/ventas/[id]]'

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
