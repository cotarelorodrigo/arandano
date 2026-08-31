import { createAgent } from 'langchain'
import { tool } from '@langchain/core/tools'
import { ChatAnthropic } from '@langchain/anthropic'
import { z } from 'zod'
import { buscarParaElBot } from '@/lib/bot/catalogo'
import { construirPrompt } from '@/lib/bot/prompt'

/**
 * El agente que contesta. Una sola herramienta, y ésa es la decisión de diseño
 * que importa — ver el docblock de `lib/bot/catalogo.ts`.
 */

/**
 * El id EXACTO, sin sufijo de fecha.
 *
 * `claude-haiku-4-5` y no `claude-haiku-4-5-20251001`: el snapshot fechado
 * queda viejo solo y nadie se entera hasta que deja de existir. Va como
 * constante y NO como variable de entorno a propósito: un modelo configurable
 * por entorno es la forma de correr en producción uno distinto del que se probó.
 *
 * Haiku y no Opus: esto es buscar en un catálogo y redactar tres renglones. La
 * diferencia es ~US$0,007 contra ~US$0,032 por mensaje, o sea US$7 contra US$32
 * por local por mes con el tope en 1000 — y el costo escala con cada cliente que
 * suma el plan que incluye el bot.
 */
export const MODELO = 'claude-haiku-4-5'

/** Una respuesta de WhatsApp son tres renglones. El techo es para que un modelo
 *  que se entusiasma no mande un ensayo, y para que el costo no dependa de eso. */
const TOPE_DE_SALIDA = 400

/**
 * Cuántos pasos puede dar el bucle.
 *
 * Seis permiten dos búsquedas y una respuesta, y ésta es la razón honesta por
 * la que acá hay un agente y no una sola llamada con una tool: la búsqueda es un
 * `contains` sobre nombre y SKU, así que "funda de iphone" puede no matchear
 * "Funda iPhone 13 Pro". El bucle le deja al modelo reintentar con otros
 * términos, que es lo que haría una persona. Más de seis no es más servicial:
 * es un bucle patológico gastando plata.
 */
const PASOS_MAXIMOS = 6

/** Techo de pared para toda la corrida. Sin esto, una llamada colgada retiene
 *  memoria del proceso indefinidamente. */
const TIMEOUT_MS = 30_000

export function modeloConfigurado(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

export type TurnoDelHistorial = { rol: 'cliente' | 'bot'; texto: string }

/**
 * Corre el agente y devuelve lo que hay que mandarle al cliente.
 *
 * `tenantId` va capturado en el closure de la herramienta y NUNCA es un
 * parámetro que el modelo pueda elegir: si lo fuera, bastaría con convencerlo de
 * pasar otro para leerle el catálogo al local de al lado. Es el mismo motivo por
 * el que la extensión de Prisma ata el tenant a la transacción en vez de
 * confiar en que cada consulta se acuerde de filtrar.
 */
export async function responder(entrada: {
  tenantId: string
  nombreLocal: string
  instrucciones: string
  historial: TurnoDelHistorial[]
  mensaje: string
}): Promise<string> {
  const buscarArticulos = tool(
    async ({ texto }: { texto: string }) =>
      JSON.stringify(await buscarParaElBot(entrada.tenantId, texto)),
    {
      name: 'buscar_articulos',
      description:
        'Busca en el catálogo del local, que incluye tanto PRODUCTOS como ' +
        'SERVICIOS (reparaciones, mano de obra). Devuelve el nombre, el precio ya ' +
        'formateado y si hay disponibilidad. Usala ante cualquier pregunta sobre ' +
        'qué vende o qué hace el local, incluidas "¿tenés…?", "¿hacen…?" y ' +
        '"¿cuánto sale…?". Buscá con pocas palabras clave, no con la frase entera ' +
        'del cliente.',
      schema: z.object({
        texto: z
          .string()
          .min(1)
          .max(80)
          .describe('Lo que el cliente nombró: parte del nombre del artículo o su código.'),
      }),
    },
  )

  const agente = createAgent({
    model: new ChatAnthropic({
      model: MODELO,
      maxTokens: TOPE_DE_SALIDA,
      // Un precio no es una oportunidad de ser creativo. Vale saber que este
      // parámetro ata el código a esta generación de modelos: los posteriores a
      // la línea 4.5/4.6 rechazan `temperature`.
      temperature: 0,
    }),
    tools: [buscarArticulos],
    systemPrompt: construirPrompt({
      nombreLocal: entrada.nombreLocal,
      instrucciones: entrada.instrucciones,
    }),
  })

  const salida = await agente.invoke(
    {
      messages: [
        ...entrada.historial.map((t) => ({
          role: t.rol === 'cliente' ? ('user' as const) : ('assistant' as const),
          content: t.texto,
        })),
        { role: 'user' as const, content: entrada.mensaje },
      ],
    },
    { recursionLimit: PASOS_MAXIMOS, signal: AbortSignal.timeout(TIMEOUT_MS) },
  )

  const ultimo = salida.messages.at(-1)
  const texto = typeof ultimo?.content === 'string'
    ? ultimo.content
    : (ultimo?.content ?? [])
        .map((p: unknown) =>
          typeof p === 'object' && p !== null && 'text' in p ? String((p as { text: unknown }).text) : '',
        )
        .join('')

  return texto.trim()
}
