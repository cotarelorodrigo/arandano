'use server'

import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export type EstadoLogin = { error: string | null }

/**
 * Un solo mensaje para "no existe ese mail" y para "la contraseña está mal".
 * Distinguirlos convertiría el login en un oráculo de qué mails trabajan en este
 * local, que es justo lo que no queremos publicar.
 */
const GENERICO = 'Mail o contraseña incorrectos.'

export async function entrar(_estado: EstadoLogin, datos: FormData): Promise<EstadoLogin> {
  const email = String(datos.get('email') ?? '').trim()
  const clave = String(datos.get('clave') ?? '')
  if (!email || !clave) return { error: GENERICO }

  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') return { error: GENERICO }
  if (resolucion.tenant.estado === 'SUSPENDIDO') {
    return { error: 'Esta cuenta está suspendida.' }
  }

  const origen = await origenDelRequest(resolucion.subdominio)
  const auth = authParaTenant(resolucion.tenant.id, origen)

  // SIN asResponse: el plugin nextCookies() de authParaTenant es el que escribe
  // la cookie en la respuesta de la action. Con asResponse habría que propagar
  // el Set-Cookie a mano, y olvidarse de hacerlo da el peor síntoma posible —
  // el login responde bien y el navegador se queda sin sesión.
  try {
    await auth.api.signInEmail({
      body: { email, password: clave },
      headers: await headers(),
    })
  } catch (e) {
    // 429 es rate limit; cualquier otra cosa es credencial inválida y sale por
    // el mensaje genérico.
    const status = e && typeof e === 'object' && 'status' in e ? e.status : undefined
    if (status === 429 || status === 'TOO_MANY_REQUESTS') {
      return { error: 'Demasiados intentos. Esperá un minuto y volvé a probar.' }
    }
    return { error: GENERICO }
  }

  // Recién acá, con la contraseña ya validada, se puede decir que la cuenta está
  // desactivada: quien llegó hasta este punto demostró que la cuenta es suya, así
  // que el mensaje no filtra nada. Y le ahorra media hora pensando que se
  // equivocó de tecla.
  const db = prismaParaTenant(resolucion.tenant.id)
  const usuario = await db.user.findFirst({ where: { email } })
  if (usuario?.desactivadoEn) {
    await db.session.deleteMany({ where: { userId: usuario.id } })
    return { error: 'Tu usuario está desactivado. Pedile al dueño que lo reactive.' }
  }

  // redirect() tira una excepción de control de Next, así que va FUERA del
  // try: adentro, el catch la tomaría por un login fallido.
  redirect('/')
}
