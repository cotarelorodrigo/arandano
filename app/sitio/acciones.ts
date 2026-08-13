'use server'

import { headers } from 'next/headers'
import { guardarLead } from '@/lib/leads/guardar'
import { claveDeEnvio, envioBloqueado, registrarEnvio, revertirEnvio } from '@/lib/leads/limite'

export type EstadoLead = { error: string | null; enviado: boolean }

/** El campo que un bot completa y una persona no ve. El nombre parece de un
 *  formulario real a propósito: "honeypot" en el atributo lo delataría. */
const HONEYPOT = 'sitio-web'

/**
 * El techo por campo.
 *
 * Las columnas son TEXT y no tienen largo propio, así que sin esto el único
 * límite era el megabyte que Next le pone al cuerpo de un server action: con el
 * freno por IP en cinco envíos, son 5 MB por hora por IP que igual entran a la
 * base. Un tope por campo es la defensa más barata que hay y no le molesta a
 * nadie — ningún nombre ni rubro real se acerca a estos números.
 *
 * `mensaje` es el único que legítimamente puede ser largo: ahí alguien cuenta
 * de su negocio, y cortarlo en 120 sería perder justo la parte que sirve para
 * contestarle.
 *
 * Los mismos números van como `maxLength` en los inputs de formulario.tsx, que
 * es lo que hace que una persona vea el freno mientras escribe en vez de perder
 * lo que tipeó al mandar. Eso es comodidad; el freno de verdad es éste, porque
 * el atributo del input no lo respeta nadie que no use el formulario.
 */
const LARGOS: Record<string, number> = {
  nombre: 120,
  email: 200,
  whatsapp: 40,
  rubro: 120,
  mensaje: 2_000,
}

function texto(datos: FormData, campo: string): string {
  const v = datos.get(campo)
  return typeof v === 'string' ? v.trim() : ''
}

/** El primer campo que se pasa del tope, o null si están todos bien. */
function campoDesmedido(datos: FormData): string | null {
  for (const [campo, tope] of Object.entries(LARGOS)) {
    if (texto(datos, campo).length > tope) return campo
  }
  return null
}

/** Vacío es NULL y no cadena vacía: en la base "no dejó WhatsApp" y "dejó un
 *  WhatsApp vacío" tienen que ser el mismo estado, que es NULL. */
function opcional(datos: FormData, campo: string): string | null {
  return texto(datos, campo) || null
}

/**
 * El único camino por el que entra un interesado.
 *
 * El orden importa: honeypot, después validación, después límite. El bot no
 * llega a consumirle el cupo a nadie, y la persona a la que le falta el nombre
 * tampoco — sería el peor momento para gastarle un envío.
 *
 * La validación es mínima a propósito: nombre, un mail con arroba y el rubro.
 * Lo que sigue es una conversación humana, así que un mail mal tipeado se
 * arregla contestando, y un formulario que pelea es un formulario que no
 * convierte.
 */
export async function enviarLead(_estado: EstadoLead, datos: FormData): Promise<EstadoLead> {
  // Respuesta idéntica a la del envío bueno: un bot que recibe un error aprende
  // a esquivarlo.
  if (texto(datos, HONEYPOT)) return { error: null, enviado: true }

  const nombre = texto(datos, 'nombre')
  if (!nombre) return { error: 'Falta tu nombre.', enviado: false }

  const email = texto(datos, 'email')
  if (!email.includes('@')) return { error: 'Ese mail no parece un mail.', enviado: false }

  const rubro = texto(datos, 'rubro')
  if (!rubro) return { error: 'Contanos de qué es tu negocio.', enviado: false }

  // Después de las validaciones que le hablan a una persona y antes del límite
  // por IP: quien mandó un campo desmedido no llegó por el formulario, así que
  // no hace falta gastarle un cupo, pero tampoco tiene sentido explicarle a un
  // bot cuál campo fue.
  if (campoDesmedido(datos)) {
    return { error: 'Alguno de los campos es demasiado largo.', enviado: false }
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

  try {
    await guardarLead({
      nombre,
      email,
      whatsapp: opcional(datos, 'whatsapp'),
      rubro,
      mensaje: opcional(datos, 'mensaje'),
    })
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
