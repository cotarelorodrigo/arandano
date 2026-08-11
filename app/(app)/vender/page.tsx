import { exigirSesion } from '@/lib/auth/sesion'
import { ultimaCotizacionUsd } from '@/lib/ventas/buscar'
import { PuntoDeVenta } from './punto-de-venta'

export const dynamic = 'force-dynamic'

export default async function Vender() {
  // El guard va acá aunque el layout de (app) ya lo aplique: es lo que hace que
  // esta página no dependa de dónde vive para estar protegida.
  const sesion = await exigirSesion()
  // Se lee acá, en el SERVIDOR, y se le pasa al componente: el cliente no
  // consulta la base, y así la pantalla llega con la cotización puesta en vez
  // de parpadear.
  const cotizacionInicial = await ultimaCotizacionUsd(sesion.tenant.id)

  return (
    <main className="p-6">
      <h1 className="mb-6 text-xl font-medium">Vender</h1>
      <PuntoDeVenta cotizacionInicial={cotizacionInicial} />
    </main>
  )
}
