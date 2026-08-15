import { randomUUID } from 'node:crypto'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { recibirEquipo } from '../acciones'
import { FormularioRecepcion } from '../formularios'

export const dynamic = 'force-dynamic'

// Cuántos clientes ofrece el desplegable. Es una lista para elegir de un
// vistazo; el buscador completo es el ciclo de /clientes.
const CLIENTES_A_LA_MANO = 50

export default async function RecibirEquipo() {
  const sesion = await exigirSesion()
  const prisma = prismaParaTenant(sesion.tenant.id)

  const clientes = await prisma.cliente.findMany({
    orderBy: { nombre: 'asc' },
    take: CLIENTES_A_LA_MANO,
    select: { id: true, nombre: true, telefono: true },
  })

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Recibir un equipo</h1>
      {/* La clave se genera EN EL SERVIDOR, una vez por carga de la pantalla:
          si la generara el cliente en cada render, cambiaría con cada
          re-render y no serviría para nada. */}
      <FormularioRecepcion
        accion={recibirEquipo}
        clientes={clientes}
        claveIdempotencia={randomUUID()}
      />
    </main>
  )
}
