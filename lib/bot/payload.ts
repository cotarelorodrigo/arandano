/**
 * Lo que hace falta entender del webhook de Kapso, y nada más.
 *
 * Todo lo que llega acá es texto de afuera hasta que se valida — mismo criterio
 * que los parsers de FormData de las server actions. Un campo que no viene con
 * la forma esperada se descarta y el mensaje se ignora; nunca se asume.
 */

export type MensajeEntrante = {
  wamid: string
  /** El teléfono del cliente, como lo entrega Kapso (+549…). */
  waId: string
  kapsoConversacionId: string | null
  nombreContacto: string | null
  /** El texto ya resuelto. Vacío si el mensaje no tenía nada que leer. */
  texto: string
}

function comoTexto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/**
 * El `phone_number_id` del sobre, que se cruza contra el del local.
 *
 * En un evento suelto está en la raíz; en un LOTE no —el sobre del lote sólo
 * lleva `type`, `batch`, `data` y `batch_info`, y el número viaja adentro de
 * cada elemento—. Se mira primero la raíz y después el primer elemento, que es
 * lo que hace que el cruce funcione en los dos formatos.
 *
 * Que el cruce falle no es inocuo: devuelve 404 y el mensaje del cliente se
 * pierde. Pasó exactamente eso la primera vez que un WhatsApp real entró.
 */
export function phoneNumberIdDe(cuerpo: unknown): string | null {
  const raiz = obj(cuerpo)
  if (!raiz) return null
  const enLaRaiz = comoTexto(raiz.phone_number_id)
  if (enLaRaiz) return enLaRaiz

  const lista = listaDelLote(raiz)
  const primero = lista && obj(lista[0])
  return primero ? comoTexto(primero.phone_number_id) : null
}

/**
 * El array de eventos de un lote, si el cuerpo es uno.
 *
 * La clave es `data`, y eso NO estaba documentado: Kapso declara los headers del
 * lote (`X-Webhook-Batch`, `X-Batch-Size`) pero no la forma del cuerpo. Este
 * ciclo la adivinó defensivamente aceptando `messages`, `events` y `batch`, y
 * las tres estaban mal — el manejo defensivo no alcanzó, y la única forma de
 * saberlo fue que un mensaje real entrara. Las tres se conservan igual: no
 * cuestan nada y el día que Kapso cambie el nombre, el bot no se queda mudo.
 *
 * `batch` está en el sobre real como BOOLEANO (`"batch": true`), así que el
 * `Array.isArray` de abajo es lo que impide confundirlo con la lista.
 */
function listaDelLote(raiz: Record<string, unknown>): unknown[] | null {
  for (const clave of ['data', 'messages', 'events', 'batch'] as const) {
    const lista = raiz[clave]
    if (Array.isArray(lista)) return lista
  }
  return null
}

/**
 * Un evento de Kapso → cero o un mensaje entrante.
 *
 * El texto sale de `message.kapso.content` y NO de `text.body`, con éste como
 * respaldo. `content` es la representación en texto de CUALQUIER tipo de
 * mensaje, y eso incluye el transcript de un audio — que en Argentina es la
 * forma más común de preguntar un precio por WhatsApp. Leer sólo `text.body`
 * dejaría mudo justamente al caso frecuente.
 */
function mensajeDeEvento(evento: unknown): MensajeEntrante | null {
  const raiz = obj(evento)
  if (!raiz) return null

  const mensaje = obj(raiz.message)
  const conversacion = obj(raiz.conversation)
  if (!mensaje || !conversacion) return null

  const wamid = comoTexto(mensaje.id)
  const waId = comoTexto(conversacion.phone_number)
  if (!wamid || !waId) return null

  const kapso = obj(mensaje.kapso)
  // Sólo lo que escribió el cliente. Un `outbound` que vuelve como eco —el
  // propio dueño contestando desde su celular, que en coexistencia también pasa
  // por Kapso— no es algo a lo que el bot tenga que responder.
  if (kapso && comoTexto(kapso.direction) === 'outbound') return null

  const texto =
    comoTexto(kapso?.content) ??
    comoTexto(obj(mensaje.text)?.body) ??
    comoTexto(obj(kapso?.transcript)?.text) ??
    ''

  return {
    wamid,
    waId,
    kapsoConversacionId: comoTexto(conversacion.id),
    // En los dos lugares: la documentación lo pone en `conversation.kapso`, y el
    // sobre real lo trae suelto en `conversation`. Es menor —el nombre no
    // decide nada— pero se arregla igual, porque es el que la pantalla va a
    // mostrar el día que exista la bandeja.
    nombreContacto:
      comoTexto(conversacion.contact_name) ?? comoTexto(obj(conversacion.kapso)?.contact_name),
    texto,
  }
}

/**
 * Los mensajes de un webhook, venga solo o agrupado.
 *
 * El buffering de Kapso agrupa los mensajes seguidos del mismo cliente ("hola" /
 * "tenés fundas?" / "de iPhone 13") en una sola entrega. El sobre real —
 * confirmado con un WhatsApp de verdad, porque la documentación no lo trae— es
 * `{ type, batch: true, data: [ … ], batch_info: { … } }`, y el
 * `phone_number_id` viaja adentro de cada elemento, NO en la raíz.
 *
 * Se aceptan además el array pelado y las otras claves posibles, por lo mismo
 * que antes: no cuestan nada y el día que Kapso las cambie el bot no se queda
 * mudo. Lo que este ciclo aprendió es que eso NO alcanza como red — las tres
 * claves que se adivinaron estaban mal, y el síntoma fue un 404 silencioso
 * sobre el mensaje de un cliente.
 */
export function mensajesDelWebhook(cuerpo: unknown): MensajeEntrante[] {
  if (Array.isArray(cuerpo)) {
    return cuerpo.map(mensajeDeEvento).filter((m): m is MensajeEntrante => m !== null)
  }

  const raiz = obj(cuerpo)
  if (!raiz) return []

  const lista = listaDelLote(raiz)
  if (lista) {
    return lista
      .map((e) => mensajeDeEvento(obj(e)?.message ? e : { ...raiz, message: e }))
      .filter((m): m is MensajeEntrante => m !== null)
  }

  const uno = mensajeDeEvento(raiz)
  return uno ? [uno] : []
}
