import { prisma } from '@/lib/db'
import { notificarLead } from './notificar'

/**
 * `nombre`, `email` y `rubro` son nullable desde la Task 5 del cierre del
 * rediseño: el formulario de la landing pasó a un solo campo, y ese campo se
 * clasifica y se guarda en `email` O en `whatsapp` (nunca los dos a la vez)
 * — ver `app/sitio/acciones.ts`. `nombre` y `rubro` ya no tienen de dónde
 * salir. Ver el comentario del modelo `Lead` en prisma/schema.prisma.
 */
export type LeadNuevo = {
  nombre: string | null
  email: string | null
  whatsapp: string | null
  rubro: string | null
  mensaje: string | null
}

/**
 * Guarda el interesado y avisa.
 *
 * Usa el cliente BASE de Prisma y no `prismaParaTenant`, porque acá no hay
 * tenant: quien completa el formulario del ápex no es de nadie todavía. Es la
 * única escritura de la aplicación que corre así, y puede hacerlo porque la
 * tabla no tiene policy de aislamiento (ver el comentario del modelo).
 *
 * **`createMany` y no `create`, y no es estilo.** `create()` emite
 * `INSERT ... RETURNING`, y `RETURNING` exige `SELECT` sobre las columnas que
 * devuelve. `arandano_app` no tiene SELECT sobre `leads` (scripts/setup-db-roles.sh),
 * así que `create()` falla con "permission denied for table leads" — un error
 * que apunta al INSERT y manda a investigar para el lado equivocado.
 * `test/leads-privilegios.test.ts` fija ese comportamiento.
 *
 * El aviso va DESPUÉS del insert y envuelto: un interesado no se pierde porque
 * un mensaje no salió.
 */
export async function guardarLead(lead: LeadNuevo): Promise<void> {
  await prisma.lead.createMany({ data: [lead] })

  try {
    await notificarLead(lead)
  } catch (e) {
    console.error('[lead] guardado, pero el aviso falló:', e)
  }
}
