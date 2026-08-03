import type { HealthInfo } from './types'

/**
 * Contexto del proceso que está respondiendo. NO es un check.
 *
 * Antes esto vivía en la lista de checks bajo el nombre "app", y no podía
 * fallar: su `run` no tiene ninguna rama que lance. Un check que siempre pasa
 * no discrimina nada — sube la cuenta de "cosas verdes" sin aportar una sola
 * señal, y le da al que lee el reporte la impresión de que se verificó algo
 * más de lo que se verificó. El dato en sí (qué código está sirviendo y desde
 * cuándo) sí vale, así que se reporta como lo que es: información.
 *
 * `sha` va en null y no en "dev" cuando falta: el Dockerfile exige GIT_SHA, así
 * que en una imagen de verdad siempre está. Un null es "esto no salió de un
 * build", que es información distinta de un SHA cualquiera.
 */
export function healthInfo(): HealthInfo {
  return {
    sha: process.env.GIT_SHA ?? null,
    uptimeS: Math.round(process.uptime()),
  }
}
