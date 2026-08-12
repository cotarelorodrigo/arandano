'use server'

import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { claveDeIntento, loginBloqueado, registrarLoginFallido } from '@/lib/auth/limite-de-intentos'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export type EstadoLogin = {
  error: string | null
  /**
   * El mail que se acaba de intentar, para volver a pintarlo en el campo.
   *
   * React 19 resetea los inputs no controlados de un `<form action>` cuando la
   * action termina, así que sin esto un error vaciaba LOS DOS campos y quien
   * erraba una letra de la contraseña tenía que reescribir también el mail.
   *
   * **Acá NO va la contraseña, y no es un olvido.** El estado de una action
   * viaja al cliente en la carga RSC: devolverla la escribiría en el HTML de
   * la página. Vaciar el campo de contraseña ante un error es además lo que
   * corresponde. `acciones.test.ts` lo cuida serializando el estado entero y
   * buscando la clave adentro, así que un campo nuevo que la arrastre se cae
   * solo.
   */
  email?: string
}

/**
 * Un solo mensaje para "no existe ese mail" y para "la contraseña está mal".
 * Distinguirlos convertiría el login en un oráculo de qué mails trabajan en este
 * local, que es justo lo que no queremos publicar.
 */
const GENERICO = 'Mail o contraseña incorrectos.'

const DEMASIADOS = 'Demasiados intentos. Esperá un minuto y volvé a probar.'

export async function entrar(_estado: EstadoLogin, datos: FormData): Promise<EstadoLogin> {
  // Minúsculas acá arriba, una sola vez, y no sólo por prolijidad: Better Auth
  // normaliza el mail internamente antes de buscar, así que `signInEmail`
  // autentica perfecto a quien escribe `Flor@Ejemplo.com`, pero la consulta de
  // más abajo —la nuestra, contra una columna String con comparación sensible
  // a mayúsculas— no encontraba esa fila, se salteaba el chequeo de
  // desactivación y mandaba a la persona a `/`, donde el guard la rebotaba a
  // /login sin decirle por qué. Es la misma invariante que ya rige en el alta
  // de tenants y en el alta de empleados; lo que faltaba era que llegara hasta
  // este camino.
  const email = String(datos.get('email') ?? '').trim().toLowerCase()
  const clave = String(datos.get('clave') ?? '')

  // Todo camino de error sale por acá, y por eso el mail vuelve siempre sin
  // que haya que acordarse en cada `return`: un return suelto que se olvide de
  // devolverlo deja el campo vacío otra vez, que es justo el defecto que este
  // eco existe para arreglar.
  const falla = (error: string): EstadoLogin => ({ error, email })

  if (!email || !clave) return falla(GENERICO)

  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') return falla(GENERICO)
  if (resolucion.tenant.estado === 'SUSPENDIDO') {
    return falla('Esta cuenta está suspendida.')
  }

  const origen = await origenDelRequest(resolucion.subdominio)
  const auth = authParaTenant(resolucion.tenant.id, origen)

  // El freno de fuerza bruta va ACÁ y no en la configuración de Better Auth:
  // el limitador de la librería corre en el onRequest de su router, y esta
  // action no pasa por el router (ver lib/auth/limite-de-intentos.ts, que
  // explica lo medido y por qué el contador es propio). Se consulta antes de
  // llamar a signInEmail para que un intento de más no cueste un hash de
  // scrypt.
  const cabeceras = await headers()
  const limite = claveDeIntento(resolucion.tenant.id, cabeceras)
  if (loginBloqueado(limite)) return falla(DEMASIADOS)

  // SIN asResponse: el plugin nextCookies() de authParaTenant es el que escribe
  // la cookie en la respuesta de la action. Con asResponse habría que propagar
  // el Set-Cookie a mano, y olvidarse de hacerlo da el peor síntoma posible —
  // el login responde bien y el navegador se queda sin sesión.
  try {
    await auth.api.signInEmail({
      body: { email, password: clave },
      headers: cabeceras,
    })
  } catch {
    // Toda falla suma al contador, no sólo la credencial inválida: distinguir
    // por código de error dejaría el freno atado a la forma exacta que hoy
    // tiene una excepción de la librería, y el modo de falla de equivocarse
    // sería un login SIN freno. Si lo que falla es la base, el login está roto
    // igual y contarlo no le saca nada a nadie.
    registrarLoginFallido(limite)
    return falla(GENERICO)
  }

  // Recién acá, con la contraseña ya validada, se puede decir que la cuenta está
  // desactivada: quien llegó hasta este punto demostró que la cuenta es suya, así
  // que el mensaje no filtra nada. Y le ahorra media hora pensando que se
  // equivocó de tecla.
  const db = prismaParaTenant(resolucion.tenant.id)
  const usuario = await db.user.findFirst({ where: { email } })
  if (usuario?.desactivadoEn) {
    // nextCookies() ya escribió la cookie de sesión como efecto del
    // signInEmail de arriba —antes de que este chequeo corriera—, así que el
    // navegador se va a ir con una cookie que apunta a una sesión que acá
    // abajo borramos del lado del servidor. Es inofensivo: sesionActual()
    // no encuentra la fila y la trata como sin sesión en el request
    // siguiente (ver lib/auth/sesion.ts). Pero es lo que explica ver, en la
    // pestaña de red, un Set-Cookie en la misma respuesta que este error.
    await db.session.deleteMany({ where: { userId: usuario.id } })
    return falla('Tu usuario está desactivado. Pedile al dueño que lo reactive.')
  }

  // redirect() tira una excepción de control de Next, así que va FUERA del
  // try: adentro, el catch la tomaría por un login fallido.
  //
  // A /vender y no a `/`: `/` sólo redirige acá, así que pasar por ahí era un
  // salto de servidor de más en cada login.
  redirect('/vender')
}
