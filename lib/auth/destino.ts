import type { RolUsuario } from './sesion'

/**
 * Dónde aterriza una sesión recién abierta.
 *
 * **Una sola función para los TRES lugares que redirigen** —el `/` de un
 * tenant con sesión, el final del server action de login, y `/login` cuando
 * quien lo abre YA tiene sesión (favorito, botón Atrás, "Entrar a mi local"
 * del ápex)—, y no un literal repetido en cada uno. Este repo ya pagó el
 * peaje de una regla escrita más de una vez, más de una vez: el merge del
 * ciclo móvil dejó una de las dos copias de "Anular orden" atada al permiso
 * equivocado, el ciclo del dashboard tuvo que rulear el mismo fallback de
 * moneda en /ventas y otra vez, ocho tasks después, en /dashboard — y el
 * primer borrador de ESTE archivo contaba "dos lugares" y se olvidó del
 * tercero (`app/login/page.tsx`), en un ciclo cuyo tema es exactamente ése.
 * Redirects que pueden discrepar son ese mismo defecto esperando, sin
 * importar cuántos haya.
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
