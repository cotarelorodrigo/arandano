import { prismaParaTenant } from '@/lib/tenant/prisma'

/**
 * Los cortes que deciden si el bot contesta. Los cuatro se resuelven con
 * lecturas locales, sin una sola llamada de red: se evalúan ANTES del 200 del
 * webhook, que tiene diez segundos de presupuesto.
 */

/**
 * Cuántas veces puede contestarle el bot al MISMO número en una hora.
 *
 * Es el corte que el tope mensual no cubre. El número del local está en
 * coexistencia —sigue en el celular del dueño—, así que del otro lado puede
 * haber otra automatización, y un ping-pong entre dos bots se come mil
 * respuestas en una tarde sin que nadie mire. Doce por hora deja pasar
 * cualquier conversación humana: nadie hace doce preguntas distintas en una
 * hora por WhatsApp a un local.
 */
export const TOPE_POR_CONVERSACION_POR_HORA = 12

/**
 * El primer instante del mes, en hora de Buenos Aires.
 *
 * Mismo criterio que `diasEnElLocal` (lib/ordenes-de-trabajo/antiguedad.ts): el
 * servidor corre en Ashburn, así que sin el huso declarado el mes cambiaría
 * unas horas antes y las respuestas de esa madrugada se contarían contra el mes
 * equivocado. Argentina no tiene DST desde 2009, así que `-03:00` es siempre el
 * mismo offset.
 */
export function inicioDelMes(ahora: Date = new Date()): Date {
  const [anio, mes] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  })
    .format(ahora)
    .split('-')
  return new Date(`${anio}-${mes}-01T00:00:00-03:00`)
}

/**
 * Cuántas respuestas dio el bot este mes.
 *
 * Se CUENTAN las filas, no hay contador con reset. Es la misma preferencia que
 * el repo ya escribió dos veces —`Articulo.stock` es "apenas el caché de la
 * suma de sus movimientos", y la columna "Queda" del historial se reconstruye—
 * y acá el argumento es todavía más fuerte: los mensajes hay que guardarlos de
 * todos modos, así que un contador sería un caché de algo ya escrito, con una
 * ventana de reset que sólo puede desincronizarse. El modo de falla de esa
 * versión —"el contador dice 1000 y hay 12 filas"— no lo descubre nadie hasta
 * que un local reclama que su bot dejó de contestar.
 *
 * `error: null` es lo que hace que una respuesta que NO llegó al cliente no
 * consuma cupo: no se le puede cobrar al local algo que su cliente nunca vio.
 */
export async function respuestasDelMes(tenantId: string, ahora: Date = new Date()): Promise<number> {
  return prismaParaTenant(tenantId).mensajeBot.count({
    where: { direccion: 'SALIENTE', error: null, creadoEn: { gte: inicioDelMes(ahora) } },
  })
}

/**
 * Cuántas veces le contestó el bot a ESTE NÚMERO en la última hora.
 *
 * Se consulta por `waId` y no por el id de la conversación a propósito: así
 * este corte —como los otros tres— se evalúa ANTES de insertar el mensaje
 * entrante, y el motivo se escribe en la misma fila que lo crea. La versión que
 * lo evaluaba después necesitaba un UPDATE para anotar el motivo, y
 * `mensajes_bot` no lo admite: es tabla-libro, con REVOKE UPDATE en
 * scripts/setup-db-roles.sh. O sea que aquella versión fallaba siempre, en
 * silencio, sobre el único corte que defiende del bucle de coexistencia.
 *
 * Una conversación que todavía no existe da cero, que es la respuesta correcta.
 */
export async function respuestasDeLaUltimaHora(
  tenantId: string,
  waId: string,
  ahora: Date = new Date(),
): Promise<number> {
  return prismaParaTenant(tenantId).mensajeBot.count({
    where: {
      conversacion: { waId },
      direccion: 'SALIENTE',
      error: null,
      creadoEn: { gte: new Date(ahora.getTime() - 60 * 60 * 1000) },
    },
  })
}
