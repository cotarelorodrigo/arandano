import { exigirSesion } from '@/lib/auth/sesion'
import { PuntoDeVenta } from './punto-de-venta'

export const dynamic = 'force-dynamic'

export default async function Vender() {
  // El guard va acá aunque el layout de (app) ya lo aplique: es lo que hace que
  // esta página no dependa de dónde vive para estar protegida.
  await exigirSesion()

  return (
    <main className="p-6">
      <h1 className="mb-6 text-xl font-medium">Vender</h1>
      <PuntoDeVenta />
    </main>
  )
}
