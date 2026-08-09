import { createHash, timingSafeEqual } from 'node:crypto'

/**
 * El header que habilita el nivel detallado de /api/health.
 *
 * En minúscula porque la API `Headers` de Node normaliza los nombres al
 * leerlos: `request.headers.get('X-Arandano-Salud')` y
 * `.get('x-arandano-salud')` devuelven lo mismo, pero tener la constante en
 * minúscula evita que alguien la compare a mano contra una clave cruda.
 */
export const HEADER_SALUD = 'x-arandano-salud'

/**
 * Se comparan los DIGESTS y no los tokens.
 *
 * `timingSafeEqual` exige que los dos buffers midan lo mismo, así que la forma
 * ingenua es chequear el largo antes — y ese chequeo filtra la longitud del
 * token a quien mida los tiempos de respuesta. Hasheando primero, los dos lados
 * siempre miden 32 bytes: no hay early return que observar, y la comparación
 * nunca lanza.
 */
function huella(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest()
}

/**
 * ¿Esta request puede ver el detalle del healthcheck?
 *
 * Falla cerrado: sin la variable configurada, o sin header, la respuesta es la
 * anónima. Nunca un 401 — devolver "no autorizado" confirmaría que existe un
 * modo autenticado y que vale la pena insistir. El anónimo no confirma nada.
 *
 * Que la ausencia de configuración se comporte igual que un token incorrecto
 * es deliberado: un `.env` incompleto en producción tiene que producir un
 * deploy que aborta —el gate no recibe `info.sha` y no puede comparar—, no un
 * sistema que parece sano.
 */
export function detalleAutorizado(recibido: string | null): boolean {
  const esperado = process.env.ARANDANO_SALUD_TOKEN
  if (!esperado || !recibido) return false
  return timingSafeEqual(huella(recibido), huella(esperado))
}
