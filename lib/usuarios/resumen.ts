type UsuarioParaContar = { rol: 'DUENO' | 'EMPLEADO'; desactivadoEn: Date | null }

/**
 * Cuántos dueños siguen activos.
 *
 * Función aparte y no un `.filter(...).length` inline en la pantalla: es
 * exactamente el tipo de línea que alguien "simplifica" sin querer. Sacar el
 * `desactivadoEn === null` deja el conteo mintiendo — un dueño dado de baja
 * seguiría contando como activo en el subtítulo de `/usuarios`, y ahí no hay
 * ningún otro número al lado que lo contradiga.
 *
 * Recibe la lista ya traída y no una consulta propia: `/usuarios` ya hizo el
 * `findMany` completo para dibujar la tabla, así que contar en memoria es
 * gratis y una consulta aparte sería duplicar el viaje a la base.
 */
export function contarDuenosActivos(usuarios: readonly UsuarioParaContar[]): number {
  return usuarios.filter((u) => u.rol === 'DUENO' && u.desactivadoEn === null).length
}
