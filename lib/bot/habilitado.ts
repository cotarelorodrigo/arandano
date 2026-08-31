/**
 * En qué locales está habilitado el bot.
 *
 * **Es temporal y tiene fecha de defunción escrita**: existe para probar el bot
 * en producción con un solo local real antes de que lo vea todo el mundo.
 * Liberarlo a todos es borrar la línea `BOT_HABILITADO_EN` de
 * `docker/compose.prod.yml` y deployar — no hace falta tocar este archivo.
 *
 * **Sin lista, habilitado para todos.** El default es fail-OPEN, al revés de lo
 * que pediría la intuición, y la razón es concreta: `scripts/smoke.sh` barre
 * cada `app/(app)/**\/page.tsx` contra el canario de `arandano-stage` y exige
 * 200. Ese stack no declara la variable; con un default de "nadie", `/bot`
 * daría 404 ahí y TODO deploy haría rollback por una feature que ningún
 * cliente está usando todavía.
 *
 * Lo que hace aceptable ese fail-open es DÓNDE vive la variable en producción:
 * el bloque `environment:` versionado de `docker/compose.prod.yml`, y no el
 * `.env` del servidor. Viaja con el repo, así que no se pierde editando
 * credenciales a mano un martes a las once de la noche.
 *
 * **No es el sistema de permisos y no lo reemplaza.** El permiso `BOT` decide
 * a QUIÉN del local se le delega el bot; esto decide en qué locales existe
 * todavía. Un dueño tiene los siete permisos sin fila en `usuario_permisos`,
 * así que sin este gate la pantalla la vería el dueño de cualquier tenant.
 */
export function botHabilitadoEn(subdominio: string): boolean {
  const lista = (process.env.BOT_HABILITADO_EN ?? '').trim()
  if (!lista) return true

  return lista
    .split(',')
    .map((s) => s.trim().toLowerCase())
    // Los vacíos se descartan: una coma de más ("wafflespro,") no puede
    // convertirse en "el subdominio vacío está habilitado".
    .filter(Boolean)
    .includes(subdominio.trim().toLowerCase())
}
