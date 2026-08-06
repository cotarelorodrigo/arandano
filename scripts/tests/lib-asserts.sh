#!/usr/bin/env bash
# Helpers de aserción compartidos por los tests de bash del repo (test-*.sh).
#
# Lo que comparten estos archivos NO es lógica de negocio: es el mecanismo
# para reportar OK/FALLA. Duplicar ok/bad/check_eq/check_true/check_false en
# cada archivo de test es exactamente cómo se desincronizan — el día que se
# ajuste un detalle acá (el color, el mensaje de "esperado/obtenido") en una
# sola de las copias y no en la otra, los tests dejan de leerse igual entre
# sí, y nadie se entera hasta que compara corridas a mano.
#
# Sólo define funciones y los contadores PASS/FAIL. No ejecuta nada al
# sourcearse. Sin guardia de doble source (a diferencia de
# scripts/lib/backup-comun.sh): cada archivo de test corre en su propio
# proceso bash — correr-todos.sh los invoca con `bash "$archivo"`, no los
# sourcea — así que este archivo nunca se sourcea dos veces en el mismo
# proceso.

PASS=0
FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL + 1)); }

check_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then ok "$desc"
  else bad "$desc (esperado: $expected, obtenido: $actual)"; fi
}
check_true()  { if "${@:2}"; then ok "$1"; else bad "$1 (esperaba éxito)"; fi; }
# stderr silenciado: los casos que deben fallar imprimen su propio mensaje de
# error, y verlos mezclados con los ✓ hace que una corrida sana parezca rota.
check_false() { if "${@:2}" 2>/dev/null; then bad "$1 (esperaba fallo)"; else ok "$1"; fi; }
