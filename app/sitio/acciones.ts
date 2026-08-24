'use server'

import { headers } from 'next/headers'
import { guardarLead } from '@/lib/leads/guardar'
import { claveDeEnvio, envioBloqueado, registrarEnvio, revertirEnvio } from '@/lib/leads/limite'

export type EstadoLead = { error: string | null; enviado: boolean }

/** El campo que un bot completa y una persona no ve. El nombre parece de un
 *  formulario real a propósito: "honeypot" en el atributo lo delataría. */
const HONEYPOT = 'sitio-web'

/**
 * El techo del único campo del formulario (Task 5 del cierre del rediseño).
 *
 * Antes había un techo por campo (nombre 120, email 200, whatsapp 40, rubro
 * 120, mensaje 2000): con un solo campo que puede ser cualquiera de los dos
 * primeros, el techo es el más generoso de los dos —200, el de `email`—
 * porque a esta altura todavía no se sabe qué es lo que se tipeó. La columna
 * es TEXT y no tiene largo propio, así que sin esto el único límite seguía
 * siendo el megabyte que Next le pone al cuerpo de un server action.
 *
 * El mismo número va como `maxLength` en el input de formulario.tsx, que es
 * lo que hace que una persona vea el freno mientras escribe en vez de perder
 * lo que tipeó al mandar. Eso es comodidad; el freno de verdad es éste.
 */
const LARGO_CONTACTO = 200

function texto(datos: FormData, campo: string): string {
  const v = datos.get(campo)
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * A qué columna va el único campo del formulario, según su forma.
 *
 * "Parece mail" = tiene arroba — mismo criterio laxo que ya usaba la
 * validación de cinco campos (`email.includes('@')`, la versión anterior de
 * este archivo): el formulario no pelea, y esto no empieza a hacerlo ahora.
 * Cualquier otra cosa (un número, "+54 9 11...", un nombre de usuario de
 * Instagram) se guarda como WhatsApp — no porque se valide que sea un
 * teléfono, sino porque no hay una tercera columna donde ponerlo y "no es un
 * mail" es la única otra pregunta que hace falta contestar.
 *
 * Devuelve las dos columnas siempre —una con el valor, la otra en null— para
 * que `guardarLead` nunca reciba las dos a la vez: un contacto es una cosa o
 * la otra, nunca ambas.
 */
function clasificarContacto(valor: string): { email: string | null; whatsapp: string | null } {
  if (valor.includes('@')) return { email: valor, whatsapp: null }
  return { email: null, whatsapp: valor }
}

/**
 * El único camino por el que entra un interesado.
 *
 * El orden importa: honeypot, después validación, después límite. El bot no
 * llega a consumirle el cupo a nadie, y la persona a la que le falta el
 * contacto tampoco — sería el peor momento para gastarle un envío.
 *
 * La validación es mínima a propósito, más todavía que antes: un solo campo,
 * no vacío. Lo que sigue es una conversación humana (WhatsApp o mail), así
 * que no hace falta pelearle el formato — eso es lo que ya decidió la
 * versión de cinco campos para el mail ("Ese mail no parece un mail" sólo
 * miraba la arroba) y esta versión lo extiende al resto: no hay nada más
 * que validar.
 */
export async function enviarLead(_estado: EstadoLead, datos: FormData): Promise<EstadoLead> {
  // Respuesta idéntica a la del envío bueno: un bot que recibe un error aprende
  // a esquivarlo.
  if (texto(datos, HONEYPOT)) return { error: null, enviado: true }

  const contacto = texto(datos, 'contacto')
  if (!contacto) return { error: 'Dejanos tu WhatsApp o tu mail.', enviado: false }

  // Después de la validación que le habla a una persona y antes del límite
  // por IP: quien mandó un contacto desmedido no llegó por el formulario, así
  // que no hace falta gastarle un cupo.
  if (contacto.length > LARGO_CONTACTO) {
    return { error: 'Eso es demasiado largo para ser un WhatsApp o un mail.', enviado: false }
  }

  const clave = claveDeEnvio(await headers())
  if (envioBloqueado(clave)) {
    return {
      error: 'Recibimos varios mensajes desde tu conexión. Probá de nuevo en un rato, o escribinos por WhatsApp.',
      enviado: false,
    }
  }

  // El cupo se toma ACÁ, antes del alta, y no después: el `await` de abajo es un
  // punto donde Node cambia de tarea, así que con el registro al final una
  // ráfaga simultánea desde la misma IP lee el contador en cero y entra entera
  // (medido: veinte de veinte). Ver `registrarEnvio`.
  registrarEnvio(clave)

  const { email, whatsapp } = clasificarContacto(contacto)

  try {
    // nombre, rubro y mensaje quedan en NULL: el formulario de un solo campo ya
    // no los pide, y la migración `lead_de_un_campo` dejó esas tres columnas
    // nullable para esto (prisma/schema.prisma, modelo Lead).
    await guardarLead({ nombre: null, email, whatsapp, rubro: null, mensaje: null })
  } catch (error) {
    // Sin este catch la excepción sube hasta el render —`useActionState` la
    // vuelve a tirar— y Next reemplaza la landing entera por su pantalla de
    // error: el visitante pierde el formulario justo cuando quería escribirnos.
    // No hay error.tsx que lo contenga, y ponerlo sería atajar el problema un
    // nivel más arriba y con menos información: acá sabemos que lo único que
    // falló fue guardar, así que el resto de la página puede seguir en pie.
    revertirEnvio(clave)
    console.error('[leads] no se pudo guardar el lead', error)
    return {
      error: 'No pudimos recibir tus datos. Probá de nuevo en un minuto, o escribinos por WhatsApp.',
      enviado: false,
    }
  }

  return { error: null, enviado: true }
}
