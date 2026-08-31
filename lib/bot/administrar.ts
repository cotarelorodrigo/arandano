import { prismaParaTenant } from '@/lib/tenant/prisma'
import { origenDelRequest } from '@/lib/auth/origen'
import { ErrorDeBot } from '@/lib/bot/errores'
import { TOPE_INSTRUCCIONES } from '@/lib/bot/prompt'
import {
  borrarWebhook,
  crearCustomer,
  crearEnlaceDeConexion,
  crearWebhookDeMensajes,
  kapsoConfigurado,
  numerosDelCustomer,
  type NumeroConectado,
} from '@/lib/bot/kapso'

/** La ruta del webhook. Un solo lugar: lo que se registra en Kapso y lo que la
 *  aplicación sirve tienen que ser el mismo string. */
export const RUTA_WEBHOOK = '/api/whatsapp/webhook'

/**
 * El origen con el que se registra el webhook en Kapso.
 *
 * `BOT_WEBHOOK_BASE_URL` existe para dev: Kapso llama desde internet, y los
 * stacks de desarrollo escuchan sólo en la IP de Tailscale, así que ahí hay que
 * apuntar a un túnel. En producción la variable queda sin definir y la URL se
 * deriva del subdominio real, que es lo que hace que `tenantDelRequest()` pueda
 * resolver el tenant del otro lado.
 */
async function urlDelWebhook(subdominio: string): Promise<string> {
  const override = process.env.BOT_WEBHOOK_BASE_URL
  const base = override
    ? `${override.replace(/\/+$/, '')}`.replace('{sub}', subdominio)
    : await origenDelRequest(subdominio)
  return `${base}${RUTA_WEBHOOK}`
}

export type BotDelLocal = {
  kapsoCustomerId: string | null
  phoneNumberId: string | null
  numeroVisible: string | null
  conectadoEn: Date | null
  activo: boolean
  instrucciones: string
  topeMensual: number
}

const VACIO: BotDelLocal = {
  kapsoCustomerId: null,
  phoneNumberId: null,
  numeroVisible: null,
  conectadoEn: null,
  activo: false,
  instrucciones: '',
  topeMensual: 1000,
}

const CAMPOS = {
  kapsoCustomerId: true,
  phoneNumberId: true,
  numeroVisible: true,
  conectadoEn: true,
  activo: true,
  instrucciones: true,
  topeMensual: true,
} as const

/**
 * El bot del local, o el estado vacío si nunca se tocó la pantalla.
 *
 * Devuelve un objeto y no `null` para que la pantalla no tenga que ramificar
 * antes de empezar: un local sin fila y uno con fila recién creada se ven
 * exactamente igual. Y no crea la fila al leer — un GET no escribe.
 *
 * NUNCA devuelve `webhookSecreto`: este tipo es lo que viaja a la pantalla, y
 * el secreto es la única columna del schema cuya fuga convierte a un tenant en
 * otro (con él se pueden firmar webhooks a nombre del local).
 */
export async function botDelLocal(tenantId: string): Promise<BotDelLocal> {
  const fila = await prismaParaTenant(tenantId).botDeWhatsapp.findUnique({
    where: { tenantId },
    select: CAMPOS,
  })
  return fila ?? VACIO
}

/**
 * El enlace de onboarding que el dueño abre para conectar su número.
 *
 * Sólo por acción explícita, nunca al renderizar: crear un enlace REVOCA el
 * anterior, así que generarlo en cada visita anularía el que el dueño se acaba
 * de mandar al teléfono — y el signup necesita la cuenta de Facebook del
 * negocio, que casi nunca está en la computadora del mostrador.
 */
export async function generarEnlace(entrada: {
  tenantId: string
  nombreLocal: string
  subdominio: string
}): Promise<string> {
  if (!kapsoConfigurado()) {
    throw new ErrorDeBot('SIN_INTEGRACION', 'La integración con WhatsApp no está configurada en este servidor.')
  }

  const prisma = prismaParaTenant(entrada.tenantId)
  const bot = await prisma.botDeWhatsapp.findUnique({
    where: { tenantId: entrada.tenantId },
    select: { kapsoCustomerId: true, phoneNumberId: true },
  })
  if (bot?.phoneNumberId) {
    throw new ErrorDeBot('YA_CONECTADO', 'Este local ya tiene un número conectado.')
  }

  // El customer sobrevive a una desconexión: reconectar no tiene por qué crear
  // uno nuevo, y dos customers para el mismo local dejarían números repartidos
  // entre los dos.
  const customerId =
    bot?.kapsoCustomerId ??
    (await crearCustomer({ tenantId: entrada.tenantId, nombre: entrada.nombreLocal }))

  const volverA = `${await origenDelRequest(entrada.subdominio)}/bot`
  const enlace = await crearEnlaceDeConexion({ customerId, urlDeVuelta: volverA })

  await prisma.botDeWhatsapp.upsert({
    where: { tenantId: entrada.tenantId },
    create: { tenantId: entrada.tenantId, kapsoCustomerId: customerId },
    update: { kapsoCustomerId: customerId },
  })

  return enlace.url
}

/** Los números que Kapso dice que este local conectó. La fuente de verdad del
 *  paso de confirmación. */
export async function numerosDisponibles(tenantId: string): Promise<NumeroConectado[]> {
  if (!kapsoConfigurado()) return []
  const bot = await prismaParaTenant(tenantId).botDeWhatsapp.findUnique({
    where: { tenantId },
    select: { kapsoCustomerId: true },
  })
  if (!bot?.kapsoCustomerId) return []
  return numerosDelCustomer(bot.kapsoCustomerId)
}

/**
 * Deja el número conectado y registra el webhook.
 *
 * El `phoneNumberId` que llega es una SELECCIÓN entre lo que Kapso dice que es
 * de este local, no una afirmación: se re-consulta y se verifica que esté en la
 * lista. Sin ese chequeo, este POST tendría exactamente el mismo agujero que
 * tendría escribir desde el redirect —un id ajeno conectaría el número de otro
 * comercio— y el formulario es tan falsificable como una query string.
 *
 * Todas las llamadas de red van ANTES de la escritura, y la escritura es una
 * sola: `lib/tenant/transaccion.ts` lo dice con todas las letras y el pool
 * tiene cinco conexiones.
 */
export async function confirmarNumero(entrada: {
  tenantId: string
  subdominio: string
  phoneNumberId: string
}): Promise<void> {
  if (!kapsoConfigurado()) {
    throw new ErrorDeBot('SIN_INTEGRACION', 'La integración con WhatsApp no está configurada en este servidor.')
  }

  const disponibles = await numerosDisponibles(entrada.tenantId)
  const elegido = disponibles.find((n) => n.phoneNumberId === entrada.phoneNumberId)
  if (!elegido) {
    throw new ErrorDeBot('NUMERO_AJENO', 'Ese número no figura entre los de este local.')
  }

  const webhook = await crearWebhookDeMensajes({
    phoneNumberId: elegido.phoneNumberId,
    url: await urlDelWebhook(entrada.subdominio),
  })

  await prismaParaTenant(entrada.tenantId).botDeWhatsapp.update({
    where: { tenantId: entrada.tenantId },
    data: {
      phoneNumberId: elegido.phoneNumberId,
      numeroVisible: elegido.numeroVisible,
      wabaId: elegido.wabaId,
      webhookId: webhook.id,
      webhookSecreto: webhook.secreto,
      conectadoEn: new Date(),
      // Conectar el número y ponerlo a contestarles a los clientes son dos
      // decisiones. Un bot que arranca contestando en el mismo segundo, con la
      // información del local todavía vacía, contesta "no sé" a la primera
      // pregunta que le hagan.
      activo: false,
    },
  })
}

/**
 * Desconecta el número.
 *
 * Limpia lo local aunque falle el borrado remoto, y esa asimetría es
 * deliberada: el estado local es lo ÚNICO que decide si contestamos —el webhook
 * devuelve 404 sin `phoneNumberId` contra el cual comparar—, así que un webhook
 * huérfano en Kapso no puede hacer hablar al bot. Lo que el dueño pidió es
 * dejar de responder, y eso lo garantiza borrar nuestra fila.
 */
export async function desconectar(tenantId: string): Promise<void> {
  const prisma = prismaParaTenant(tenantId)
  const bot = await prisma.botDeWhatsapp.findUnique({
    where: { tenantId },
    select: { webhookId: true },
  })
  // El try/catch va ACÁ y no sólo adentro de `borrarWebhook`: ahí se toleran
  // los errores de Kapso, pero cualquier otro —un timeout sin envolver, un bug—
  // se propagaría y dejaría el número conectado localmente, que es exactamente
  // lo contrario de lo que el dueño pidió. La garantía tiene que estar donde se
  // promete.
  if (bot?.webhookId && kapsoConfigurado()) {
    try {
      await borrarWebhook(bot.webhookId)
    } catch (e) {
      console.error('[bot] falló el borrado del webhook en Kapso; se desconecta igual:', e)
    }
  }

  await prisma.botDeWhatsapp.update({
    where: { tenantId },
    data: {
      phoneNumberId: null,
      numeroVisible: null,
      wabaId: null,
      webhookId: null,
      webhookSecreto: null,
      conectadoEn: null,
      activo: false,
    },
  })
}

export async function alternarActivo(tenantId: string, activo: boolean): Promise<void> {
  const prisma = prismaParaTenant(tenantId)
  if (activo) {
    const bot = await prisma.botDeWhatsapp.findUnique({
      where: { tenantId },
      select: { phoneNumberId: true },
    })
    if (!bot?.phoneNumberId) {
      throw new ErrorDeBot('SIN_NUMERO', 'Conectá un número antes de prender el bot.')
    }
  }
  await prisma.botDeWhatsapp.update({ where: { tenantId }, data: { activo } })
}

/** Lo que el bot cuenta del local. Se puede escribir antes de conectar: cargar
 *  los horarios mientras se espera el enlace es lo natural. */
export async function guardarInstrucciones(tenantId: string, texto: string): Promise<void> {
  const limpio = texto.trim()
  if (limpio.length > TOPE_INSTRUCCIONES) {
    throw new ErrorDeBot(
      'INSTRUCCIONES_LARGAS',
      `La información del local no puede pasar de ${TOPE_INSTRUCCIONES} caracteres.`,
    )
  }
  await prismaParaTenant(tenantId).botDeWhatsapp.upsert({
    where: { tenantId },
    create: { tenantId, instrucciones: limpio },
    update: { instrucciones: limpio },
  })
}
