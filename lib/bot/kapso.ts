import { randomBytes } from 'node:crypto'

/**
 * El cliente de Kapso, que es la capa de WhatsApp del bot.
 *
 * Kapso es Tech Provider de Meta: cada local conecta SU número con un enlace de
 * onboarding y nosotros nunca vemos sus credenciales de Facebook. Su modelo es
 * un *customer* por cada cliente nuestro, así que el mapeo contra el tenant es
 * 1:1 y una sola API key de Arándano alcanza para todos los locales — no hay
 * una credencial por tenant que guardar.
 *
 * Es la PRIMERA llamada HTTP saliente del repo, así que vale decir qué se eligió
 * y qué no: se usa `fetch` detrás de esta interfaz y NO el SDK
 * `@kapso/whatsapp-cloud-api`. Mismo criterio que `lib/leads/notificar.ts` y que
 * `billing/emitirFactura()`: son cinco endpoints y un POST, y el día que Kapso
 * haya que reemplazarlo se cambia este archivo y ningún otro. Un SDK acá sería
 * una dependencia más para envolver `fetch`.
 */

const BASE_POR_DEFECTO = 'https://api.kapso.ai'

/** La versión de la Graph API sobre la que Kapso proxea los envíos. */
const VERSION_META = 'v24.0'

/**
 * Un error de Kapso que el llamador puede mostrar.
 *
 * Lleva el status para que la pantalla pueda distinguir "el número ya está
 * tomado" (422) de "Kapso está caído" (5xx), pero el `message` ya viene
 * redactado en castellano: nada de esto se le muestra a un cliente del local,
 * pero sí al dueño, y "Kapso API request failed (status=422)" no le dice nada.
 */
export class ErrorDeKapso extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detalle?: string,
  ) {
    super(message)
    this.name = 'ErrorDeKapso'
  }
}

/**
 * ¿Hay credenciales de Kapso en este stack?
 *
 * Existe porque la respuesta correcta cuando faltan NO es romper: `/bot` entra
 * sola al barrido de `scripts/smoke.sh` (las rutas salen del sistema de
 * archivos, ver scripts/lib/rutas-comun.sh) y ese barrido corre contra
 * `arandano-stage`, que no tiene esta variable. La pantalla tiene que devolver
 * 200 igual, avisando que el bot todavía no está disponible. Mismo criterio que
 * `WHATSAPP_CONTACTO` en la landing.
 */
export function kapsoConfigurado(): boolean {
  return Boolean(process.env.KAPSO_API_KEY)
}

function credenciales(): { base: string; clave: string } {
  const clave = process.env.KAPSO_API_KEY
  if (!clave) {
    throw new ErrorDeKapso('El bot todavía no está disponible en este entorno.', null)
  }
  const base = (process.env.KAPSO_API_BASE_URL || BASE_POR_DEFECTO).replace(/\/+$/, '')
  return { base, clave }
}

/**
 * Una llamada a Kapso, con el error ya traducido.
 *
 * El timeout es explícito y no el del runtime: esto lo llaman un Server
 * Component (el render de `/bot`) y un webhook que tiene diez segundos para
 * contestar. Una llamada colgada sin techo deja la pantalla en blanco o se come
 * el presupuesto entero del webhook.
 */
async function pedir<T>(
  ruta: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const { base, clave } = credenciales()
  const url = new URL(`${base}${ruta}`)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)

  let respuesta: Response
  try {
    respuesta = await fetch(url, {
      method: init.method ?? 'GET',
      headers: { 'X-API-Key': clave, 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
  } catch (e) {
    throw new ErrorDeKapso(
      'No se pudo conectar con WhatsApp. Probá de nuevo en un rato.',
      null,
      e instanceof Error ? e.message : String(e),
    )
  }

  const texto = await respuesta.text()
  if (!respuesta.ok) {
    throw new ErrorDeKapso(
      `WhatsApp rechazó la operación (${respuesta.status}).`,
      respuesta.status,
      texto.slice(0, 500),
    )
  }
  return (texto ? JSON.parse(texto) : {}) as T
}

/** Crea el customer de Kapso que representa a este local. */
export async function crearCustomer(entrada: {
  tenantId: string
  nombre: string
}): Promise<string> {
  const r = await pedir<{ data: { id: string } }>('/platform/v1/customers', {
    method: 'POST',
    // `external_customer_id` es nuestro tenant.id: es lo que hace que el
    // customer de Kapso y el tenant sean el mismo objeto visto desde dos lados,
    // y lo que permite reconstruir el vínculo desde el panel de Kapso cuando
    // alguien tenga que mirar por qué un local no recibe mensajes.
    body: { customer: { name: entrada.nombre, external_customer_id: entrada.tenantId } },
  })
  return r.data.id
}

export type EnlaceDeConexion = { url: string; expiraEn: string | null }

/**
 * El enlace que el dueño abre para conectar su número.
 *
 * `coexistence` y no `dedicated`: el local sigue usando la app de WhatsApp
 * Business en su celular Y el bot contesta por API sobre el MISMO número. Es lo
 * único realista para alguien que ya tiene su número con clientes cargados —
 * "dedicado" le sacaría el WhatsApp del teléfono a cambio de un throughput
 * (1000 msg/s contra 5) que ningún comercio de este tamaño necesita.
 *
 * `provision_phone_number: false` porque el local trae el suyo; el
 * aprovisionamiento de Kapso da números de Estados Unidos, que no le sirven a
 * nadie acá.
 */
export async function crearEnlaceDeConexion(entrada: {
  customerId: string
  urlDeVuelta: string
}): Promise<EnlaceDeConexion> {
  const r = await pedir<{ data: { url: string; expires_at?: string } }>(
    `/platform/v1/customers/${encodeURIComponent(entrada.customerId)}/setup_links`,
    {
      method: 'POST',
      body: {
        setup_link: {
          language: 'es',
          allowed_connection_types: ['coexistence'],
          provision_phone_number: false,
          success_redirect_url: entrada.urlDeVuelta,
          failure_redirect_url: entrada.urlDeVuelta,
        },
      },
    },
  )
  return { url: r.data.url, expiraEn: r.data.expires_at ?? null }
}

export type NumeroConectado = {
  phoneNumberId: string
  numeroVisible: string | null
  wabaId: string | null
}

/**
 * Los números que este customer tiene conectados en Kapso.
 *
 * Es la fuente de verdad del paso de confirmación, y por eso existe: el redirect
 * del onboarding vuelve con `phone_number_id` en la query, pero eso es texto que
 * manda el navegador y un valor falseado conectaría el número de otro local.
 * Preguntarle a Kapso es lo único que no se puede falsificar — y de paso resuelve
 * el caso de la pestaña cerrada a mitad del signup: el dueño vuelve cuando
 * quiera y el número lo está esperando.
 */
export async function numerosDelCustomer(customerId: string): Promise<NumeroConectado[]> {
  const r = await pedir<{
    data: Array<{
      id?: string
      phone_number_id?: string
      display_phone_number?: string
      business_account_id?: string
    }>
  }>('/platform/v1/whatsapp/phone_numbers', { query: { customer_id: customerId } })

  return (r.data ?? [])
    .map((c) => ({
      phoneNumberId: c.phone_number_id || c.id || '',
      numeroVisible: c.display_phone_number ?? null,
      wabaId: c.business_account_id ?? null,
    }))
    .filter((n) => n.phoneNumberId !== '')
}

export type WebhookCreado = { id: string; secreto: string }

/**
 * El webhook por el que llegan los mensajes de los clientes del local.
 *
 * Va a nivel de NÚMERO y no de proyecto, y no es una preferencia: los eventos
 * `whatsapp.message.*` no se entregan por webhooks de proyecto (ver
 * references/webhooks-reference.md). De ahí sale que la URL pueda llevar el
 * subdominio del tenant, que es lo que después permite resolverlo con
 * `tenantDelRequest()` sin inventar una segunda función SECURITY DEFINER.
 *
 * El buffer de 8 segundos es plata: quien pregunta por WhatsApp escribe "hola",
 * "tenés fundas?" y "de iPhone 13" en tres mensajes seguidos. Sin buffer son
 * tres corridas del agente —tres respuestas y tres veces el costo— y encima la
 * primera contesta antes de saber qué le preguntaron.
 */
export async function crearWebhookDeMensajes(entrada: {
  phoneNumberId: string
  url: string
}): Promise<WebhookCreado> {
  // EL SECRETO LO GENERAMOS NOSOTROS, y no es una preferencia: Kapso no lo
  // genera. Crear el webhook sin `secret_key` devuelve
  // `422 {"error":"Secret key can't be blank"}` — se descubrió en la primera
  // conexión real contra su API, y resuelve en la dirección más simple la duda
  // que este ciclo había dejado anotada (si el POST devolvía el secreto).
  //
  // Que lo generemos acá es mejor que recibirlo: lo conocemos con certeza en vez
  // de depender de leerlo de una respuesta cuya forma no controlamos, no existe
  // el modo de falla de "se muestra una sola vez", y rotarlo es volver a llamar
  // a esta función. 32 bytes de `randomBytes` es la misma clase de secreto que
  // BETTER_AUTH_SECRET.
  const secreto = randomBytes(32).toString('hex')

  const r = await pedir<{ data: Record<string, unknown> }>(
    `/platform/v1/whatsapp/phone_numbers/${encodeURIComponent(entrada.phoneNumberId)}/webhooks`,
    {
      method: 'POST',
      body: {
        whatsapp_webhook: {
          url: entrada.url,
          secret_key: secreto,
          events: ['whatsapp.message.received'],
          payload_version: 'v2',
          active: true,
          buffer_enabled: true,
          buffer_window_seconds: 8,
          max_buffer_size: 10,
        },
      },
    },
  )

  const id = (r.data ?? {}).id as string | undefined
  if (!id) {
    throw new ErrorDeKapso(
      'WhatsApp no devolvió el identificador del webhook. Probá conectar de nuevo.',
      null,
      JSON.stringify(Object.keys(r.data ?? {})),
    )
  }
  // El secreto es el que mandamos, no uno que haya que leer de la respuesta.
  return { id, secreto }
}

/** Da de baja el webhook al desconectar. Tolera que ya no exista. */
export async function borrarWebhook(webhookId: string): Promise<void> {
  try {
    await pedir(`/platform/v1/whatsapp/webhooks/${encodeURIComponent(webhookId)}`, {
      method: 'DELETE',
    })
  } catch (e) {
    // Un webhook que ya no está es el estado que se buscaba. Cualquier otro
    // error tampoco puede frenar una desconexión: lo que el dueño pidió es
    // dejar de recibir mensajes, y eso lo garantiza borrar la fila nuestra.
    if (!(e instanceof ErrorDeKapso)) throw e
    console.warn('[bot] no se pudo borrar el webhook en Kapso:', e.detalle ?? e.message)
  }
}

/** Manda un mensaje de texto por el número del local. */
export async function enviarTexto(entrada: {
  phoneNumberId: string
  a: string
  texto: string
}): Promise<string | null> {
  const r = await pedir<{ messages?: Array<{ id?: string }> }>(
    `/meta/whatsapp/${VERSION_META}/${encodeURIComponent(entrada.phoneNumberId)}/messages`,
    {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: entrada.a,
        type: 'text',
        text: { body: entrada.texto },
      },
    },
  )
  return r.messages?.[0]?.id ?? null
}
