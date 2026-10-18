import { DIGITOS_DE_LA_CLAVE, digitosDe, ultimos10 } from '@/lib/texto/telefono'

/**
 * La clave de duplicados de un teléfono: sus últimos 10 dígitos, o `null`.
 *
 * Es lo que se guarda en `clientes.telefono_clave` en cada alta y edición, y
 * con lo que se decide si dos clientes tienen "el mismo número". El criterio
 * es el de `coinciden` (`lib/bot/numeros-de-prueba.ts`) y sale de las mismas
 * dos funciones (`lib/texto/telefono.ts`): "11 2233-4455", "+54 9 11 2233 4455"
 * y "1122334455" dan la misma clave.
 *
 * **Menos de 10 dígitos da `null`**, y el teléfono se guarda igual, tal cual
 * se tipeó: sin código de área no hay con qué compararlo sin falsos positivos
 * —"4455-6677" puede ser de Rosario o de Córdoba—, así que no participa de los
 * duplicados. Es el mismo límite que el bot ya aplica para no habilitar a
 * todos los números que terminen igual.
 *
 * La migración que creó la columna rellenó las filas viejas con la misma regla
 * escrita en SQL (`right(regexp_replace(telefono, '\D', '', 'g'), 10)` con al
 * menos 10 dígitos); `test/clientes.test.ts` fija que las dos coinciden.
 *
 * **Puro**, sin Prisma: lo importa el selector de clientes (`'use client'`).
 */
export function claveDeTelefono(telefono: string | null | undefined): string | null {
  if (!telefono) return null
  const digitos = digitosDe(telefono)
  if (digitos.length < DIGITOS_DE_LA_CLAVE) return null
  return ultimos10(digitos)
}
