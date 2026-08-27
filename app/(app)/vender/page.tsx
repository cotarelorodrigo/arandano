import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { ultimaCotizacionUsd } from '@/lib/ventas/buscar'
import { cajaAbierta } from '@/lib/caja/abrir-cerrar'
import { planesDelTenant } from '@/lib/planes/consultar'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { PuntoDeVenta } from './punto-de-venta'
import { ChipCaja } from './caja'

export const dynamic = 'force-dynamic'

export default async function Vender() {
  // El guard va acá aunque el layout de (app) ya lo aplique: es lo que hace que
  // esta página no dependa de dónde vive para estar protegida.
  const sesion = await exigirSesion()
  // Se lee acá, en el SERVIDOR, y se le pasa al componente: el cliente no
  // consulta la base, y así la pantalla llega con la cotización puesta en vez
  // de parpadear.
  const cotizacionInicial = await ultimaCotizacionUsd(sesion.tenant.id)

  // El chip del header necesita dos datos más, y los dos se leen acá por el
  // mismo motivo que el de arriba: la caja del turno (lib/caja/abrir-cerrar.ts)
  // y la cotización QUE FIJÓ EL DUEÑO hoy (Tenant.cotizacionUsd) — que no es
  // `cotizacionInicial`, esa es la última con la que se cobró un pago
  // (Pago.cotizacion, histórica). Las dos conviven a propósito: el comentario
  // de Tenant.cotizacionUsd en prisma/schema.prisma explica por qué no se
  // unifican.
  // Los planes van en la misma tanda, y por el mismo motivo: se leen en el
  // SERVIDOR y viajan como prop. Sin los desactivados —el default de
  // `planesDelTenant`—: un plan dado de baja no se puede usar para cobrar (el
  // motor lo rechaza con PLAN_INEXISTENTE), así que ofrecerlo sería ofrecer un
  // error. `PlanVisible` cruza a un componente cliente sin problema: sus campos
  // son string, number y Date, no Decimal (ver el comentario del tipo).
  const [caja, tenant, planes] = await Promise.all([
    cajaAbierta(sesion.tenant.id),
    prismaParaTenant(sesion.tenant.id).tenant.findUnique({
      where: { id: sesion.tenant.id },
      select: { cotizacionUsd: true, cotizacionUsdEn: true },
    }),
    planesDelTenant(sesion.tenant.id),
  ])

  return (
    <>
      {/* Sin subtítulo: la maqueta pide fecha Y hora ("14:32"), y un
          componente de servidor la renderiza una sola vez y la deja
          congelada — un reloj mentiroso arriba del punto de venta es peor
          que no tener reloj. Sigue sin resolverse: esta task cierra el chip
          de caja y los atajos, no el reloj. */}
      <Encabezado
        titulo="Vender"
        acciones={
          <ChipCaja
            caja={caja ? { abiertaEn: caja.abiertaEn } : null}
            // .toString() y no el Decimal crudo: un componente CLIENTE no
            // puede recibir un Decimal de Prisma a través de la frontera,
            // mismo motivo que ArticuloVendible en lib/ventas/buscar.ts.
            cotizacionUsd={tenant?.cotizacionUsd?.toString() ?? null}
            cotizacionUsdEn={tenant?.cotizacionUsdEn ?? null}
          />
        }
      />
      <div className="p-6">
        <PuntoDeVenta cotizacionInicial={cotizacionInicial} planes={planes} />
      </div>
    </>
  )
}
