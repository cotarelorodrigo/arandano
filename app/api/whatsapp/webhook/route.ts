import { after } from 'next/server'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { firmaValida, HEADER_FIRMA } from '@/lib/bot/firma'
import { mensajesDelWebhook, phoneNumberIdDe, type MensajeEntrante } from '@/lib/bot/payload'
import { registrarEntrante } from '@/lib/bot/conversaciones'
import {
  respuestasDelMes,
  respuestasDeLaUltimaHora,
  TOPE_POR_CONVERSACION_POR_HORA,
} from '@/lib/bot/limites'
import { modeloConfigurado } from '@/lib/bot/agente'
import { botHabilitadoEn } from '@/lib/bot/habilitado'
import { procesarMensaje } from '@/lib/bot/procesar'
import type { MotivoSinRespuesta } from '@/generated/prisma/client'

/**
 * Por acá entran los mensajes que los clientes le escriben al local.
 *
 * Es el primer endpoint del repo que recibe tráfico de un tercero, así que vale
 * dejar escritas las tres reglas que lo gobiernan:
 *
 * 1. **NADA DE RED ANTES DEL 200.** Kapso da diez segundos y reintenta a los 10,
 *    40 y 90 segundos. Todo lo que pasa acá abajo son lecturas y escrituras
 *    locales; el modelo y el envío viven en `after()`. Este camino no puede
 *    crecer.
 * 2. **Falla cerrado y sin delatar.** Todo rechazo es un 404 genérico, nunca un
 *    401: un "no autorizado" confirmaría que existe un modo autenticado y que
 *    vale la pena insistir. Mismo criterio que `lib/health/autorizacion.ts:29-31`
 *    y que `app/api/auth/[...all]/route.ts:16-18`.
 * 3. **Tres verificaciones, no una.** El `Host` dice de qué local es la URL, la
 *    firma dice que el cuerpo lo mandó Kapso, y el `phone_number_id` dice que es
 *    de ESTE local. Las tres tienen que dar.
 *
 * El tenant se resuelve por SUBDOMINIO: el webhook se registra en Kapso con la
 * URL del tenant (`https://<sub>.arandano.app/api/whatsapp/webhook`), así que
 * `tenantDelRequest()` lo resuelve con la maquinaria que ya existe. La
 * alternativa —una URL única en el ápex y una segunda función SECURITY DEFINER
 * que resolviera el tenant desde el `phone_number_id`— pedía repartir el secreto
 * de firma a partir de un dato que viaja en el propio request, y dejaría dos
 * mecanismos de resolución de tenant en el repo, que es como divergen.
 */

// Un webhook cacheado no es un webhook.
export const dynamic = 'force-dynamic'

/** Todo rechazo se ve igual desde afuera. */
function nada(): Response {
  return new Response('no encontrado', { status: 404 })
}

export async function POST(request: Request): Promise<Response> {
  // Los BYTES CRUDOS. Nunca `await request.json()` y después `JSON.stringify`:
  // eso reserializa, cambia el espaciado y la firma deja de validar.
  const crudo = await request.text()

  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') return nada()
  if (resolucion.tenant.estado === 'SUSPENDIDO') return nada()
  // El gate del rollout, con el mismo 404 genérico que todo el resto de los
  // rechazos. Hoy es redundante —un local fuera de la lista nunca pudo conectar
  // un número, así que Kapso no le manda nada— y va igual: es la última de las
  // cinco puertas del bot, y deja de depender de que nadie haya conectado nada.
  // Ver lib/bot/habilitado.ts.
  if (!botHabilitadoEn(resolucion.subdominio)) return nada()

  const tenantId = resolucion.tenant.id
  const bot = await prismaParaTenant(tenantId).botDeWhatsapp.findUnique({
    where: { tenantId },
    select: {
      phoneNumberId: true,
      numeroVisible: true,
      webhookSecreto: true,
      activo: true,
      instrucciones: true,
      topeMensual: true,
    },
  })
  if (!bot?.phoneNumberId || !bot.webhookSecreto) return nada()

  if (!firmaValida(crudo, request.headers.get(HEADER_FIRMA), bot.webhookSecreto)) return nada()

  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(crudo)
  } catch {
    // Con la firma ya válida, un cuerpo ilegible es un problema de Kapso.
    // Reintentar no lo va a arreglar, así que 200 y queda en el log: devolver
    // un error acá compraría el ciclo de reintentos de 10/40/90 segundos a
    // cambio de nada.
    console.error('[bot] webhook con firma válida y JSON ilegible')
    return new Response('ok', { status: 200 })
  }

  // El segundo factor: la firma dice "lo mandó Kapso", esto dice "y es de este
  // local". Sin este cruce, el secreto de un tenant serviría para meterle
  // mensajes a otro.
  if (phoneNumberIdDe(cuerpo) !== bot.phoneNumberId) return nada()

  const entrantes = mensajesDelWebhook(cuerpo)
  if (entrantes.length === 0) return new Response('ok', { status: 200 })

  for (const entrante of entrantes) {
    await atender(entrante, {
      tenantId,
      nombreLocal: resolucion.tenant.nombre,
      phoneNumberId: bot.phoneNumberId,
      numeroVisible: bot.numeroVisible,
      activo: bot.activo,
      instrucciones: bot.instrucciones,
      topeMensual: bot.topeMensual,
    })
  }

  return new Response('ok', { status: 200 })
}

type Local = {
  tenantId: string
  nombreLocal: string
  phoneNumberId: string
  numeroVisible: string | null
  activo: boolean
  instrucciones: string
  topeMensual: number
}

/**
 * Guarda el mensaje y decide si se contesta. En ese orden: **guardar siempre,
 * decidir después**.
 *
 * Es lo que le permite a la pantalla decirle al dueño "te escribieron 40 veces
 * mientras el bot estaba apagado", que es el dato con el que decide prenderlo o
 * subirse el tope. Un mensaje que se descarta sin registrar no deja forma de
 * saber que existió.
 */
async function atender(entrante: MensajeEntrante, local: Local): Promise<void> {
  // El freno más barato contra el bucle de coexistencia: el número sigue en el
  // celular del dueño, así que un eco del propio local no puede disparar una
  // respuesta que a su vez vuelva a entrar.
  if (local.numeroVisible && entrante.waId === local.numeroVisible) return

  const motivo = await evaluarCorte(entrante, local)

  const { conversacionId, esNuevo } = await registrarEntrante(local.tenantId, {
    waId: entrante.waId,
    kapsoConversacionId: entrante.kapsoConversacionId,
    nombreContacto: entrante.nombreContacto,
    wamid: entrante.wamid,
    texto: entrante.texto,
    motivo,
  })

  // `esNuevo === false` es un reintento de Kapso sobre un mensaje que ya
  // teníamos. Es la única defensa contra contestar dos veces, y vive de este
  // lado del 200 a propósito: adentro de `after()` dos reintentos habrían
  // pasado los dos el camino sincrónico.
  if (!esNuevo || motivo !== null) return

  after(() =>
    procesarMensaje({
      tenantId: local.tenantId,
      nombreLocal: local.nombreLocal,
      instrucciones: local.instrucciones,
      phoneNumberId: local.phoneNumberId,
      conversacionId,
      waId: entrante.waId,
      texto: entrante.texto,
    }),
  )
}

/**
 * Los cuatro cortes, TODOS antes de insertar.
 *
 * Que se evalúen antes no es una optimización: el motivo se escribe en la misma
 * fila que crea el mensaje, y `mensajes_bot` no admite UPDATE (es tabla-libro,
 * ver scripts/setup-db-roles.sh). Anotar el motivo después exigiría un UPDATE
 * que el rol de la app no tiene, y fallaría en silencio.
 *
 * Los cuatro son lecturas locales: ninguno gasta un solo milisegundo de red del
 * presupuesto de diez segundos del webhook.
 */
async function evaluarCorte(
  entrante: MensajeEntrante,
  local: Local,
): Promise<MotivoSinRespuesta | null> {
  if (!local.activo) return 'BOT_APAGADO'
  if (entrante.texto === '') return 'SIN_TEXTO'
  if (!modeloConfigurado()) return 'SIN_MODELO'
  if ((await respuestasDelMes(local.tenantId)) >= local.topeMensual) return 'TOPE_MENSUAL'
  if (
    (await respuestasDeLaUltimaHora(local.tenantId, entrante.waId)) >=
    TOPE_POR_CONVERSACION_POR_HORA
  ) {
    return 'TOPE_CONVERSACION'
  }
  return null
}
