#!/usr/bin/env bash
# Tests unitarios de la lógica pura de backup-comun.sh.
# Corre sin Docker, sin red y sin /etc/arandano: es lo único de este sistema
# que se puede probar sin infraestructura, así que se prueba en serio.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/lib/backup-comun.sh
# ok/bad/check_eq/check_true/check_false y los contadores PASS/FAIL están en
# lib-asserts.sh, no acá: un futuro test-*.sh los va a necesitar también, y
# duplicarlos verbatim en un segundo archivo es cómo dos copias se
# desincronizan sin que nadie lo note.
source scripts/tests/lib-asserts.sh

printf '\n\033[1mprefijo_motivo\033[0m\n'
check_eq "nocturno va al prefijo real"      "prod" "$(prefijo_motivo nocturno)"
check_eq "pre-migracion va al prefijo real" "prod" "$(prefijo_motivo pre-migracion)"
check_eq "test va a su propio prefijo"      "test" "$(prefijo_motivo test)"
check_false "un motivo inventado es error" prefijo_motivo cualquiera

printf '\n\033[1mnombre_objeto\033[0m\n'
check_eq "dump" \
  "prod/db/2026-08-04T04-00-00Z-nocturno.dump.age" \
  "$(nombre_objeto prod 2026-08-04T04-00-00Z nocturno dump)"
check_eq "manifiesto" \
  "prod/db/2026-08-04T04-00-00Z-nocturno.manifest.json.age" \
  "$(nombre_objeto prod 2026-08-04T04-00-00Z nocturno manifest)"
# Los roles son objetos de CLUSTER y pg_dump no los incluye, así que van en su
# propio objeto. Lleva motivo y vive en db/ igual que el dump: es parte del
# mismo backup de la base y se recupera junto con él, nunca por separado.
check_eq "globals" \
  "prod/db/2026-08-04T04-00-00Z-nocturno.globals.sql.age" \
  "$(nombre_objeto prod 2026-08-04T04-00-00Z nocturno globals)"
# No puede colarse en el `sort | tail -1` con el que verify-backup.sh busca el
# último dump: ese listado filtra por '*.dump.age'. Si el nombre del globals
# matcheara ese patrón, la verificación intentaría restaurar un archivo SQL de
# roles como si fuera un dump -Fc.
GLOBALS_DE_PRUEBA=$(nombre_objeto prod 2026-08-04T04-00-00Z nocturno globals)
check_eq "el globals no matchea el filtro '*.dump.age'" "no" \
  "$(case "$GLOBALS_DE_PRUEBA" in *.dump.age) echo si ;; *) echo no ;; esac)"
# Los secretos NO llevan motivo: son el mismo par de archivos siempre, y
# meter el motivo sólo haría que el nombre mintiera sobre su contenido.
check_eq "secretos" \
  "prod/secretos/2026-08-04T04-00-00Z.tar.age" \
  "$(nombre_objeto prod 2026-08-04T04-00-00Z nocturno secretos)"
check_false "un tipo inventado es error" nombre_objeto prod 2026-08-04T04-00-00Z nocturno cualquiera

printf '\n\033[1mconteo_en_banda\033[0m\n'
# El dump es un snapshot tomado ENTRE los dos conteos, así que el valor real
# tiene que caer entre ambos. Es un límite derivado, no una tolerancia.
check_true  "base quieta: 10,10 acepta 10"          conteo_en_banda 10 10 10
check_false "base quieta: 10,10 rechaza 11"         conteo_en_banda 10 10 11
check_false "base quieta: 10,10 rechaza 9"          conteo_en_banda 10 10 9
check_true  "creciendo: 10,14 acepta 12"            conteo_en_banda 10 14 12
check_true  "creciendo: 10,14 acepta el borde 10"   conteo_en_banda 10 14 10
check_true  "creciendo: 10,14 acepta el borde 14"   conteo_en_banda 10 14 14
check_false "creciendo: 10,14 rechaza 15"           conteo_en_banda 10 14 15
# Una tabla puede ENCOGER durante el dump (un borrado), así que la banda no
# puede asumir que posterior >= previo.
check_true  "encogiendo: 14,10 acepta 12"           conteo_en_banda 14 10 12
check_false "encogiendo: 14,10 rechaza 15"          conteo_en_banda 14 10 15
check_true  "tabla vacía: 0,0 acepta 0"             conteo_en_banda 0 0 0
check_false "tabla vacía: 0,0 rechaza 1"            conteo_en_banda 0 0 1

printf '\n\033[1mtimestamp_utc\033[0m\n'
check_true "el formato es AAAA-MM-DDTHH-MM-SSZ" \
  grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}Z$' <<<"$(timestamp_utc)"
# Ordenable alfabéticamente == ordenable cronológicamente. De eso depende que
# verify-backup.sh encuentre el más reciente con un `sort | tail -1`.
check_true "ordena cronológicamente" \
  test "prod/db/2026-08-04T04-00-00Z-nocturno.dump.age" '<' "prod/db/2026-08-04T05-00-00Z-nocturno.dump.age"

printf '\n\033[1mping_dms\033[0m\n'
check_false "una URL vacía es error, no un no-op silencioso" ping_dms ""

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
