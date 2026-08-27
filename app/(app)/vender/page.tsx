import { exigirSesion } from '@/lib/auth/sesion'
import { ultimaCotizacionUsd } from '@/lib/ventas/buscar'
import { cajaAbierta } from '@/lib/caja/abrir-cerrar'
import { prismaParaTenant } from '@/lib/tenant/prisma'
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

  // Los chips de estado necesitan dos datos más, y los dos se leen acá por el
  // mismo motivo que el de arriba: la caja del turno (lib/caja/abrir-cerrar.ts)
  // y la cotización QUE FIJÓ EL DUEÑO hoy (Tenant.cotizacionUsd) — que no es
  // `cotizacionInicial`, esa es la última con la que se cobró un pago
  // (Pago.cotizacion, histórica). Las dos conviven a propósito: el comentario
  // de Tenant.cotizacionUsd en prisma/schema.prisma explica por qué no se
  // unifican.
  const [caja, tenant] = await Promise.all([
    cajaAbierta(sesion.tenant.id),
    prismaParaTenant(sesion.tenant.id).tenant.findUnique({
      where: { id: sesion.tenant.id },
      select: { cotizacionUsd: true, cotizacionUsdEn: true },
    }),
  ])

  // Esta pantalla NO renderiza su encabezado: lo renderiza `PuntoDeVenta`,
  // que es un componente cliente. En el teléfono el Topbar cambia con el paso
  // de la venta (dice "Vender" o "Cobro", y la hamburguesa se vuelve una
  // flecha de volver), y el paso vive en el estado de cliente — un componente
  // de servidor no tiene forma de enterarse. Es la única de las diez pantallas
  // donde pasa; ver el comentario en punto-de-venta.tsx.
  return (
    <PuntoDeVenta
      cotizacionInicial={cotizacionInicial}
      caja={caja ? { abiertaEn: caja.abiertaEn } : null}
      // .toString() y no el Decimal crudo: un componente CLIENTE no puede
      // recibir un Decimal de Prisma a través de la frontera, mismo motivo que
      // ArticuloVendible en lib/ventas/buscar.ts.
      cotizacionUsd={tenant?.cotizacionUsd?.toString() ?? null}
      cotizacionUsdEn={tenant?.cotizacionUsdEn ?? null}
    />
  )
}
