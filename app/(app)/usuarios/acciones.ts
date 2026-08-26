'use server'

import { revalidatePath } from 'next/cache'
import { exigirDuenio } from '@/lib/auth/sesion'
import { origenDelRequest } from '@/lib/auth/origen'
import { crearEmpleado, resetearClave, desactivar, reactivar } from '@/lib/usuarios/administrar'
import { ErrorDeUsuario } from '@/lib/usuarios/errores'
import { comoPermiso } from '@/lib/permisos/catalogo'
import { otorgar, revocar } from '@/lib/permisos/administrar'
import { ErrorDePermiso } from '@/lib/permisos/errores'

export type EstadoUsuarios = {
  error: string | null
  aviso: string | null
  /**
   * La clave que se acaba de generar (alta o reseteo), en texto plano.
   *
   * Separado de `aviso` a propósito: la maqueta pinta este caso en un bloque
   * ámbar propio, con botón de copiar y la advertencia de que la clave se
   * muestra una sola vez — un `string` suelto no alcanza para eso, la pantalla
   * necesita el nombre y la clave por separado para armar el mensaje y para
   * que el botón "Copiar" copie SÓLO la clave, no la oración entera.
   */
  claveGenerada: { nombre: string; clave: string } | null
}

// El valor inicial NO vive acá, aunque sea lo natural: este archivo es
// 'use server', y ahí Next.js convierte cada export en un endpoint RPC, así que
// sólo admite funciones async. Exportar una constante hace que el módulo falle
// al evaluarse —en runtime, con el build en verde— y tira abajo la pantalla
// entera. Vive en formularios.tsx, que es quien lo usa, igual que en la pantalla
// de login. test/use-server.test.ts lo fija.

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
  if (e instanceof ErrorDeUsuario) return { error: e.message, aviso: null, claveGenerada: null }
  throw e
}

export async function altaEmpleado(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    const clave = String(datos.get('clave') ?? '')
    const nombre = String(datos.get('nombre') ?? '').trim()
    await comoDuenio((tenantId, origen) =>
      crearEmpleado({
        tenantId,
        origen,
        nombre,
        email: String(datos.get('email') ?? '').trim(),
        clave,
        rol: datos.get('rol') === 'DUENO' ? 'DUENO' : 'EMPLEADO',
      }),
    )
    revalidatePath('/usuarios')
    // La clave se muestra una sola vez: es el único momento en que existe en
    // texto plano, y el dueño se la tiene que pasar a la persona. Estructurada
    // (nombre + clave) y no un string armado acá: quien la muestra es la
    // pantalla, no esta action — ver el comentario de EstadoUsuarios.
    return { error: null, aviso: null, claveGenerada: { nombre, clave } }
  } catch (e) {
    return traducir(e)
  }
}

export async function nuevaClave(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    const clave = String(datos.get('clave') ?? '')
    // El nombre viaja en un campo oculto del propio formulario de la fila
    // (ver formularios.tsx): la fila ya lo tiene en pantalla, así que pedirlo
    // acá de nuevo con un SELECT a la base sería releer un dato que el
    // llamador ya tenía.
    const nombre = String(datos.get('nombre') ?? '')
    await comoDuenio((tenantId, origen) =>
      resetearClave({ tenantId, origen, usuarioId: String(datos.get('usuarioId')), clave }),
    )
    revalidatePath('/usuarios')
    return { error: null, aviso: null, claveGenerada: { nombre, clave } }
  } catch (e) {
    return traducir(e)
  }
}

export async function baja(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    await comoDuenio((tenantId) => desactivar({ tenantId, usuarioId: String(datos.get('usuarioId')) }))
    revalidatePath('/usuarios')
    return { error: null, aviso: 'Usuario desactivado.', claveGenerada: null }
  } catch (e) {
    return traducir(e)
  }
}

export async function alta(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    await comoDuenio((tenantId) => reactivar({ tenantId, usuarioId: String(datos.get('usuarioId')) }))
    revalidatePath('/usuarios')
    return { error: null, aviso: 'Usuario reactivado.', claveGenerada: null }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * Prende o apaga un permiso de un empleado.
 *
 * **Sigue detrás de `comoDuenio`, y eso no es delegable**: un permiso que
 * habilita a repartir permisos es una escalada de privilegios con pasos de
 * más. `/usuarios` entera se queda en DUENO.
 */
export async function cambiarPermiso(
  _e: EstadoUsuarios,
  datos: FormData,
): Promise<EstadoUsuarios> {
  try {
    const usuarioId = String(datos.get('usuarioId') ?? '').trim()
    // El permiso llega por FormData: es texto de afuera hasta que el catálogo
    // lo reconoce. Sin esto, un valor inventado llegaría hasta el enum de
    // Postgres y volvería como 500 en vez de como cartel.
    const permiso = comoPermiso(String(datos.get('permiso') ?? ''))
    if (!permiso) {
      return { error: 'Ese permiso no existe.', aviso: null, claveGenerada: null }
    }
    const prender = datos.get('otorgar') === '1'

    await comoDuenio((tenantId) =>
      prender
        ? otorgar({ tenantId, usuarioId, permiso })
        : revocar({ tenantId, usuarioId, permiso }),
    )
    revalidatePath('/usuarios')
    return {
      error: null,
      aviso: prender ? 'Permiso otorgado.' : 'Permiso revocado.',
      claveGenerada: null,
    }
  } catch (e) {
    if (e instanceof ErrorDePermiso) {
      return { error: e.message, aviso: null, claveGenerada: null }
    }
    return traducir(e)
  }
}

