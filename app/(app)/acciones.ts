'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'

/**
 * Cerrar sesión.
 *
 * La sesión dura 12 horas porque la máquina del mostrador queda abierta todo
 * el día (ver `SEGUNDOS_DE_SESION`), pero eso no cubre lo que pasa a media
 * tarde: un cambio de turno, o alguien que entró desde el teléfono de un
 * cliente. Sin un botón, la única salida era esperar a que la sesión venciera
 * o pedirle al dueño un reseteo de contraseña.
 *
 * Borra la fila de `sessions` del lado del servidor —no sólo la cookie—, así
 * que la sesión deja de valer aunque alguien se hubiera quedado con el token.
 * La cookie la limpia `nextCookies()` (lib/auth/para-tenant.ts), el mismo
 * plugin que la escribe al entrar.
 */
export async function salir(): Promise<void> {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'tenant') {
    const origen = await origenDelRequest(resolucion.subdominio)
    try {
      await authParaTenant(resolucion.tenant.id, origen).api.signOut({ headers: await headers() })
    } catch {
      // Que no haya sesión que cerrar (cookie vencida, sesión ya borrada por
      // una desactivación) no es un error para quien apretó el botón: lo que
      // pidió es quedar afuera, y afuera va a quedar igual. Cualquier otra
      // falla tampoco tiene que dejarlo trabado adentro.
    }
  }

  // FUERA del try: redirect() tira una excepción de control de Next, y adentro
  // el catch la tomaría por un fallo del signOut.
  redirect('/login')
}
