import { prismaParaTenant } from '@/lib/tenant/prisma'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import type { MotivoSinRespuesta } from '@/generated/prisma/client'
import type { TurnoDelHistorial } from '@/lib/bot/agente'

/**
 * El libro de lo que el bot y los clientes se dijeron.
 *
 * Sin bandeja, esta tabla es la ÚNICA forma de contestar "¿qué le dijo el bot a
 * mi cliente?" cuando alguien reclama — por eso es append-only en la base
 * (scripts/setup-db-roles.sh) y no sólo por convención.
 *
 * Y es también la memoria del agente: no hay checkpointer de LangChain. El de
 * memoria muere con cada deploy, y el de Postgres crearía tablas fuera de
 * Prisma, sin `tenant_id` y sin policies —la primera tabla del schema que nadie
 * migró—. Como el historial hay que guardarlo igual para auditar, usarlo
 * también como memoria evita que auditoría y memoria puedan divergir: son las
 * mismas filas.
 */

/** Cuántos turnos ve el modelo. */
const TURNOS_DE_HISTORIAL = 20

/**
 * Y de cuánto tiempo atrás, lo que resulte más chico.
 *
 * Una conversación de WhatsApp es de larga vida: el mismo contacto vuelve a
 * escribir el mes que viene. Replayar tres semanas cuesta tokens en cada turno
 * y confunde al modelo con precios que ya cambiaron.
 */
const HORAS_DE_HISTORIAL = 12

export type EntranteRegistrado = {
  conversacionId: string
  /** false cuando el wamid ya estaba: es un reintento de Kapso, no un mensaje nuevo. */
  esNuevo: boolean
}

/**
 * Guarda el mensaje del cliente y devuelve su conversación.
 *
 * Todo pasa antes del 200 del webhook y sin una sola llamada de red: la
 * idempotencia tiene que vivir en la parte que el reintento de Kapso puede
 * observar. Si el dedupe estuviera adentro del `after()`, dos reintentos
 * pasarían los dos el camino sincrónico y el agente correría dos veces.
 */
export async function registrarEntrante(
  tenantId: string,
  entrada: {
    waId: string
    kapsoConversacionId: string | null
    nombreContacto: string | null
    wamid: string
    texto: string
    motivo: MotivoSinRespuesta | null
  },
): Promise<EntranteRegistrado> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const conversacion = await tx.conversacionBot.upsert({
      where: { tenantId_waId: { tenantId, waId: entrada.waId } },
      create: {
        tenantId,
        waId: entrada.waId,
        kapsoConversacionId: entrada.kapsoConversacionId,
        nombreContacto: entrada.nombreContacto,
      },
      update: {
        ultimoMensajeEn: new Date(),
        // El nombre del contacto puede cambiar; el id de Kapso se completa si
        // antes no lo teníamos, pero no se pisa con null.
        ...(entrada.nombreContacto ? { nombreContacto: entrada.nombreContacto } : {}),
        ...(entrada.kapsoConversacionId
          ? { kapsoConversacionId: entrada.kapsoConversacionId }
          : {}),
      },
      select: { id: true },
    })

    // `skipDuplicates` es ON CONFLICT DO NOTHING contra @@unique([tenantId, wamid]),
    // y `count === 0` es exactamente "este mensaje ya lo teníamos". Es el mismo
    // mecanismo que Venta.claveIdempotencia, por el mismo motivo: allá impide
    // cobrar dos veces, acá impide contestar dos veces.
    const { count } = await tx.mensajeBot.createMany({
      data: [
        {
          tenantId,
          conversacionId: conversacion.id,
          direccion: 'ENTRANTE',
          texto: entrada.texto,
          wamid: entrada.wamid,
          motivo: entrada.motivo,
        },
      ],
      skipDuplicates: true,
    })

    return { conversacionId: conversacion.id, esNuevo: count > 0 }
  })
}

/** Deja asentada la respuesta —o el intento fallido— del bot. */
export async function registrarSaliente(
  tenantId: string,
  entrada: {
    conversacionId: string
    texto: string
    wamid: string | null
    error: string | null
  },
): Promise<void> {
  await prismaParaTenant(tenantId).mensajeBot.create({
    data: {
      tenantId,
      conversacionId: entrada.conversacionId,
      direccion: 'SALIENTE',
      texto: entrada.texto,
      wamid: entrada.wamid,
      error: entrada.error,
    },
  })
}

/**
 * El historial que ve el modelo, del más viejo al más nuevo.
 *
 * NO incluye los entrantes que no se contestaron (los que tienen `motivo`): si
 * el bot estuvo apagado tres días, esos veinte mensajes sin respuesta no son
 * una conversación, y meterlos haría que al prenderlo el modelo crea que viene
 * ignorando al cliente. Sí quedan en la tabla, que es lo que le permite al
 * dueño ver cuántos perdió.
 */
export async function historialDe(
  tenantId: string,
  conversacionId: string,
): Promise<TurnoDelHistorial[]> {
  const desde = new Date(Date.now() - HORAS_DE_HISTORIAL * 60 * 60 * 1000)

  const filas = await prismaParaTenant(tenantId).mensajeBot.findMany({
    where: { conversacionId, creadoEn: { gte: desde }, motivo: null, error: null },
    orderBy: { creadoEn: 'desc' },
    take: TURNOS_DE_HISTORIAL,
    select: { direccion: true, texto: true },
  })

  return filas
    .reverse()
    .map((f) => ({ rol: f.direccion === 'ENTRANTE' ? 'cliente' : 'bot', texto: f.texto }))
}
