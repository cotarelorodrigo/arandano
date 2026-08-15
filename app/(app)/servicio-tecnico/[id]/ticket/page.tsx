import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { esUuid } from '@/lib/uuid'
import { ImprimirAlCargar } from './imprimir'
import { CuerpoDelTicket } from './cuerpo'

export const dynamic = 'force-dynamic'

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // Mismo guard que el detalle, y hace falta igual acá: un id sin forma de uuid
  // lo rechaza Prisma antes de consultar, y eso es un 500 en vez de un 404.
  if (!esUuid(id)) notFound()

  const prisma = prismaParaTenant(sesion.tenant.id)

  const orden = await prisma.ordenDeTrabajo.findFirst({
    where: { id },
    select: {
      numero: true,
      equipoMarca: true, equipoModelo: true, equipoSerie: true, claveDesbloqueo: true,
      fallaDeclarada: true, accesorios: true, danosVisibles: true, creadoEn: true,
      cliente: { select: { nombre: true, telefono: true } },
      recibidaPor: { select: { nombre: true } },
    },
  })
  if (!orden) notFound()

  return (
    <>
      <ImprimirAlCargar />
      <CuerpoDelTicket orden={orden} local={sesion.tenant.nombre} />
    </>
  )
}
