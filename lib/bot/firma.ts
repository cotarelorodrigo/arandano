import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

/** El header con el que Kapso firma cada webhook. En minúscula porque la API
 *  `Headers` de Node normaliza los nombres al leerlos. */
export const HEADER_FIRMA = 'x-webhook-signature'

/**
 * Se comparan los DIGESTS y no las firmas.
 *
 * Mismo razonamiento que `lib/health/autorizacion.ts:14-21`, y acá es todavía
 * más necesario: el header lo controla quien manda el request, así que puede
 * medir cualquier cosa, y `timingSafeEqual` TIRA si los dos buffers no miden lo
 * mismo. Chequear el largo antes filtraría la longitud por tiempo y, peor,
 * convertiría un header corto en una excepción no capturada. Hasheando, los dos
 * lados miden 32 bytes siempre: no hay early return que observar y nunca lanza.
 */
function huella(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest()
}

/**
 * ¿Este cuerpo lo firmó Kapso con el secreto de este local?
 *
 * `crudo` tienen que ser los BYTES TAL COMO LLEGARON. Parsear el JSON y volver
 * a serializarlo cambia el espaciado y el orden de las claves, y la firma deja
 * de validar — o, peor, alguien "arregla" el síntoma comparando contra lo
 * reserializado y la verificación pasa a no verificar nada.
 *
 * Falla cerrado: sin secreto, sin header o con un HMAC distinto, es `false`.
 */
export function firmaValida(
  crudo: string,
  recibida: string | null,
  secreto: string | null,
): boolean {
  if (!secreto || !recibida) return false
  const esperada = createHmac('sha256', secreto).update(crudo, 'utf8').digest('hex')
  return timingSafeEqual(huella(recibida), huella(esperada))
}
