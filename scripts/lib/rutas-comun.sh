#!/usr/bin/env bash
# Las rutas autenticadas de la aplicación, derivadas del sistema de archivos.
#
# Existe para que smoke.sh no lleve una lista a mano: una pantalla nueva queda
# cubierta por el gate sin que nadie se acuerde de nada. Es el mismo criterio
# que test/rutas-con-guard.test.ts aplica al guard de sesión.
#
# Vive acá y no adentro de smoke.sh porque un archivo de test no puede sourcear
# smoke.sh: ese script ejecuta sus casos al sourcearse. Mismo reparto que
# scripts/lib/deploy-comun.sh y scripts/tests/test-deploy-comun.sh.
#
# Este archivo sólo define funciones y la lista blanca. No ejecuta nada.

# Rutas con segmento dinámico que el smoke NO pide, cada una con su razón.
#
# Escrita a mano a propósito: pedir /ventas/[id] a ciegas es imposible —no hay
# de dónde sacar un id válido sin sembrar datos, y sembrar datos convierte el
# smoke en una suite de fixtures—, así que la exención es legítima. Pero tiene
# que ser una decisión VISIBLE EN EL DIFF, no algo que el script deduzca solo.
# Mismo patrón que SIN_TENANT_ID en test/rls-cobertura.test.ts y
# FUERA_DEL_GRUPO en test/rutas-con-guard.test.ts.
#
# Arranca vacía: hoy no hay ninguna ruta con parámetro. Existe para que la
# primera sea una decisión y no un olvido.
declare -A RUTAS_SIN_SMOKE=()

# Imprime una ruta por línea, ordenadas.
#
# Falla —y no devuelve una lista vacía— si el directorio no tiene ninguna
# página: un barrido de cero rutas que reporta cero fallas es exactamente el
# modo de falla que esto existe para impedir. Falla también si aparece una ruta
# con parámetro que nadie declaró en RUTAS_SIN_SMOKE.
rutas_autenticadas() {
  local raiz="${1:?falta el directorio del grupo, p.ej. 'app/(app)'}"
  local archivo ruta parte
  local -a partes salida rutas=()
  local encontradas=0

  while IFS= read -r archivo; do
    encontradas=$((encontradas + 1))
    ruta="${archivo#"$raiz"}"
    ruta="${ruta%/page.tsx}"

    # Los segmentos entre paréntesis son grupos de rutas: organizan carpetas y
    # NO aparecen en la URL. Se sacan segmento por segmento porque puede haber
    # grupos anidados adentro del grupo raíz.
    salida=()
    IFS='/' read -ra partes <<<"$ruta"
    for parte in "${partes[@]}"; do
      [[ -z "$parte" ]] && continue
      [[ "$parte" == '('*')' ]] && continue
      salida+=("$parte")
    done
    if [[ "${#salida[@]}" -eq 0 ]]; then
      ruta='/'
    else
      ruta="/$(IFS=/; printf '%s' "${salida[*]}")"
    fi

    if [[ "$ruta" == *'['* ]]; then
      if [[ -z "${RUTAS_SIN_SMOKE[$ruta]+declarada}" ]]; then
        printf 'ruta con parámetro sin declarar: %s\n' "$ruta" >&2
        printf '  No se puede pedir a ciegas. Si es correcto no cubrirla, declarala en\n' >&2
        printf '  RUTAS_SIN_SMOKE (scripts/lib/rutas-comun.sh) con su razón escrita.\n' >&2
        return 1
      fi
      continue
    fi

    rutas+=("$ruta")
  done < <(find "$raiz" -name page.tsx | sort)

  if [[ "$encontradas" -eq 0 ]]; then
    printf 'no se encontró ninguna page.tsx bajo %s\n' "$raiz" >&2
    return 1
  fi

  if [[ "${#rutas[@]}" -gt 0 ]]; then
    printf '%s\n' "${rutas[@]}" | sort
  fi
}
