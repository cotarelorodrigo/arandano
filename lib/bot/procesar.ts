import { responder } from '@/lib/bot/agente'
import { historialDe, registrarSaliente } from '@/lib/bot/conversaciones'
import { enviarTexto } from '@/lib/bot/kapso'

/**
 * El trabajo que corre DESPUÉS del 200 del webhook, con `after()` de Next.
 *
 * Acá adentro sí hay red —dos llamadas: el modelo y Kapso—, y por eso está de
 * este lado: Kapso da diez segundos para contestar el webhook y reintenta a los
 * 10, 40 y 90 segundos si no los recibe. Contestar sincrónicamente le mandaría
 * al cliente la misma respuesta tres veces.
 *
 * EL LÍMITE CONOCIDO, escrito para que nadie lo descubra por las malas: si el
 * proceso muere entre el 200 y el final de esta función —un deploy, un OOM— el
 * mensaje queda guardado (así que el reintento de Kapso lo dedupea) y NUNCA se
 * contesta. Ése es el precio de `after()` en vez de una cola, y es exactamente
 * por lo que pg-boss está en el roadmap. No se mitiga con una columna
 * "pendiente" y un barredor que la recorra: eso ES una cola, mal hecha.
 *
 * Ninguna de las dos llamadas de red pasa por adentro de una transacción — el
 * pool tiene cinco conexiones y `lib/tenant/transaccion.ts` lo dice con todas
 * las letras.
 */
export async function procesarMensaje(entrada: {
  tenantId: string
  nombreLocal: string
  instrucciones: string
  phoneNumberId: string
  conversacionId: string
  waId: string
  texto: string
}): Promise<void> {
  let respuesta = ''
  try {
    const historial = await historialDe(entrada.tenantId, entrada.conversacionId)
    respuesta = await responder({
      tenantId: entrada.tenantId,
      nombreLocal: entrada.nombreLocal,
      instrucciones: entrada.instrucciones,
      historial,
      mensaje: entrada.texto,
    })

    if (!respuesta) {
      // El modelo no dijo nada. Callar es mejor que mandar un mensaje vacío.
      console.warn('[bot] el modelo devolvió una respuesta vacía')
      return
    }

    const wamid = await enviarTexto({
      phoneNumberId: entrada.phoneNumberId,
      a: entrada.waId,
      texto: respuesta,
    })

    await registrarSaliente(entrada.tenantId, {
      conversacionId: entrada.conversacionId,
      texto: respuesta,
      wamid,
      error: null,
    })
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e)
    console.error('[bot] no se pudo responder:', detalle)
    // Queda asentado el intento, con su error. La fila NO cuenta contra el tope
    // mensual (ver lib/bot/limites.ts): al cliente nunca le llegó nada.
    try {
      await registrarSaliente(entrada.tenantId, {
        conversacionId: entrada.conversacionId,
        texto: respuesta,
        wamid: null,
        error: detalle.slice(0, 500),
      })
    } catch (e2) {
      console.error('[bot] tampoco se pudo asentar el fallo:', e2)
    }
  }
}
