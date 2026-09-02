import type { RolUsuario } from './sesion'

/**
 * Dónde aterriza una sesión recién abierta.
 *
 * **Una sola función para los DOS lugares que redirigen** —el `/` de un tenant
 * con sesión y el final del server action de login—, y no un literal repetido
 * en cada uno. Este repo ya pagó dos veces el peaje de una regla escrita dos
 * veces: el merge del ciclo móvil dejó una de las dos copias de "Anular orden"
 * atada al permiso equivocado, y el ciclo del dashboard tuvo que rulear el
 * mismo fallback de moneda en /ventas y otra vez, ocho tasks después, en
 * /dashboard. Dos redirects que pueden discrepar son ese mismo defecto
 * esperando.
 *
 * El dueño abre en el tablero y quien atiende el mostrador en el punto de
 * venta: cada uno donde trabaja. Un empleado sigue llegando a /dashboard por
 * el sidebar —no es una restricción de acceso, es dónde aterriza—, y esa es la
 * diferencia con `exigirDuenio()` (lib/auth/sesion.ts), que sí cierra una
 * pantalla.
 */
export function destinoAlEntrar(rol: RolUsuario): string {
  return rol === 'DUENO' ? '/dashboard' : '/vender'
}
