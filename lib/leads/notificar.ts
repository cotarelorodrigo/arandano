import type { LeadNuevo } from './guardar'

/**
 * El aviso de que llegó un interesado, detrás de una interfaz.
 *
 * Mismo criterio que `billing/emitirFactura()`: hoy hay UN adaptador y escribe
 * un log estructurado. El de la Cloud API de Meta entra cuando exista la cuenta
 * —hay un WhatsApp Business común, no la API—, y ese día se cambia este archivo
 * y ningún otro.
 *
 * La firma es `Promise<void>` y no devuelve nada a propósito: quien llama no
 * puede tomar decisiones con el resultado de un aviso. Si falla, `guardarLead`
 * lo loguea y sigue; el lead ya está guardado, que es lo único que no se puede
 * perder.
 */
export async function notificarLead(lead: LeadNuevo): Promise<void> {
  console.info(
    '[lead] interesado nuevo:',
    JSON.stringify({ nombre: lead.nombre, email: lead.email, rubro: lead.rubro }),
  )
}
