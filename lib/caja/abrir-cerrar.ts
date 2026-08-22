import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'

type Decimal = Prisma.Decimal

/**
 * Abre la caja del turno.
 *
 * Cualquiera del local abre, dueño o empleado: en un mostrador abre el que
 * llega primero. La fila registra quién fue (`abiertaPorId`), así que la
 * trazabilidad no se pierde — y sin arqueo todavía no hay plata que cuadrar,
 * que es lo único que justificaría restringirlo a uno de los dos roles.
 *
 * La regla "una sola caja abierta por tenant" NO se valida acá adentro: la
 * sostiene `cajas_una_abierta_por_tenant`, el índice único parcial de la
 * migración. Un chequeo previo en la aplicación (un `findFirst` antes del
 * `create`) deja pasar la carrera exacta que este índice existe para cerrar —
 * dos pestañas apretando "Abrir caja" en el mismo segundo pasan las dos por
 * cualquier `if`, y sólo la base ve las dos escrituras a la vez.
 */
export async function abrirCaja(
  tenantId: string,
  usuarioId: string,
  saldoInicial: string,
): Promise<{ id: string }> {
  try {
    return await prismaParaTenant(tenantId).caja.create({
      data: { tenantId, abiertaPorId: usuarioId, saldoInicial },
      select: { id: true },
    })
  } catch (e) {
    // El choque del índice único no es "otro error de Postgres": es la
    // carrera de arriba, resuelta. Un P2002 crudo con el nombre del índice
    // adentro no le sirve a nadie que no lea SQL.
    if (esP2002(e)) {
      throw new Error('ya hay una caja abierta en este local')
    }
    throw e
  }
}

/**
 * Cierra la caja del turno en curso.
 *
 * Mismo criterio que `abrirCaja`: cualquiera del local cierra, no sólo quien
 * la abrió — el que se va del turno puede no ser el mismo que lo empezó.
 */
export async function cerrarCaja(tenantId: string, usuarioId: string): Promise<{ id: string }> {
  const db = prismaParaTenant(tenantId)

  const abierta = await db.caja.findFirst({
    where: { cerradaEn: null },
    select: { id: true },
  })
  if (!abierta) {
    throw new Error('no hay ninguna caja abierta para cerrar')
  }

  await db.caja.update({
    where: { id: abierta.id },
    data: { cerradaEn: new Date(), cerradaPorId: usuarioId },
  })

  return { id: abierta.id }
}

/**
 * La caja del turno en curso, o null si no hay ninguna abierta. Es lo que
 * consume el chip "Caja abierta" del header de /vender.
 */
export async function cajaAbierta(
  tenantId: string,
): Promise<{ id: string; abiertaEn: Date; saldoInicial: Decimal } | null> {
  return prismaParaTenant(tenantId).caja.findFirst({
    where: { cerradaEn: null },
    select: { id: true, abiertaEn: true, saldoInicial: true },
  })
}

function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}
