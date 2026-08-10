'use server'

import { revalidatePath } from 'next/cache'
import { exigirDuenio } from '@/lib/auth/sesion'
import { origenDelRequest } from '@/lib/auth/origen'
import { crearEmpleado, resetearClave, desactivar, reactivar } from '@/lib/usuarios/administrar'
import { ErrorDeUsuario } from '@/lib/usuarios/errores'

export type EstadoUsuarios = { error: string | null; aviso: string | null }

const INICIAL: EstadoUsuarios = { error: null, aviso: null }

/** Cada action vuelve a exigir dueño: que la pantalla no se muestre no es una
 *  defensa, porque una action se puede invocar sin pasar por la pantalla. */
async function comoDuenio<T>(fn: (tenantId: string, origen: string) => Promise<T>) {
  const sesion = await exigirDuenio()
  // origenDelRequest necesita el subdominio YA resuelto (ver lib/auth/origen.ts);
  // sesion.subdominio es exactamente ese valor, el mismo que usa sesion.ts para
  // construirse a sí misma.
  const origen = await origenDelRequest(sesion.subdominio)
  return fn(sesion.tenant.id, origen)
}

function traducir(e: unknown): EstadoUsuarios {
  if (e instanceof ErrorDeUsuario) return { error: e.message, aviso: null }
  throw e
}

export async function altaEmpleado(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    const clave = String(datos.get('clave') ?? '')
    await comoDuenio((tenantId, origen) =>
      crearEmpleado({
        tenantId,
        origen,
        nombre: String(datos.get('nombre') ?? '').trim(),
        email: String(datos.get('email') ?? '').trim(),
        clave,
        rol: datos.get('rol') === 'DUENO' ? 'DUENO' : 'EMPLEADO',
      }),
    )
    revalidatePath('/usuarios')
    // La clave se muestra una sola vez: es el único momento en que existe en
    // texto plano, y el dueño se la tiene que pasar a la persona.
    return { error: null, aviso: `Usuario creado. Su contraseña es: ${clave}` }
  } catch (e) {
    return traducir(e)
  }
}

export async function nuevaClave(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    const clave = String(datos.get('clave') ?? '')
    await comoDuenio((tenantId, origen) =>
      resetearClave({ tenantId, origen, usuarioId: String(datos.get('usuarioId')), clave }),
    )
    revalidatePath('/usuarios')
    return { error: null, aviso: `Contraseña cambiada. La nueva es: ${clave}` }
  } catch (e) {
    return traducir(e)
  }
}

export async function baja(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    await comoDuenio((tenantId) => desactivar({ tenantId, usuarioId: String(datos.get('usuarioId')) }))
    revalidatePath('/usuarios')
    return { error: null, aviso: 'Usuario desactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function alta(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    await comoDuenio((tenantId) => reactivar({ tenantId, usuarioId: String(datos.get('usuarioId')) }))
    revalidatePath('/usuarios')
    return { error: null, aviso: 'Usuario reactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

export { INICIAL }
