import { forbidden } from 'next/navigation'
import { exigirSesion, type Sesion } from '@/lib/auth/sesion'
import { permisosDe } from './consultar'
import type { Permiso } from './catalogo'

/**
 * Si esta sesión puede o no.
 *
 * **Un DUENO da verdadero sin tocar la tabla**, y no es un atajo de
 * performance: es lo que garantiza que un dueño no pueda quedarse afuera de su
 * propio local, y lo que hace que dar de alta un tenant no tenga que otorgar
 * nada. El único código que consulta `usuario_permisos` es el que evalúa a un
 * EMPLEADO.
 *
 * Recibe la sesión en vez de resolverla: es la forma testeable de las tres, y
 * la que usan las pantallas que ya tienen la sesión en la mano.
 */
export async function puedeConSesion(sesion: Sesion, permiso: Permiso): Promise<boolean> {
  if (sesion.usuario.rol === 'DUENO') return true
  return (await permisosDe(sesion.tenant.id, sesion.usuario.id)).has(permiso)
}

/** Para pintar: devuelve booleano y no corta el render. */
export async function puede(permiso: Permiso): Promise<boolean> {
  return puedeConSesion(await exigirSesion(), permiso)
}

/**
 * La sesión de alguien que puede, o 403.
 *
 * Reemplaza a `exigirDuenio()` en las once guardas delegables. `exigirDuenio()`
 * sigue existiendo y sigue guardando `/usuarios`: un permiso que habilita a
 * repartir permisos es una escalada de privilegios con pasos de más.
 */
export async function exigirPermiso(permiso: Permiso): Promise<Sesion> {
  const sesion = await exigirSesion()
  if (!(await puedeConSesion(sesion, permiso))) forbidden()
  return sesion
}
