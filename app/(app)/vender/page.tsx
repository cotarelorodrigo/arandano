import { exigirSesion } from '@/lib/auth/sesion'
import { cajaAbierta } from '@/lib/caja/abrir-cerrar'
import { planesDelTenant } from '@/lib/planes/consultar'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { historialDeCotizaciones } from '@/lib/cotizacion/consultar'
import { esCotizacionVieja } from '@/lib/cotizacion/reglas'
import { PuntoDeVenta } from './punto-de-venta'

export const dynamic = 'force-dynamic'

export default async function Vender() {
  // El guard va acá aunque el layout de (app) ya lo aplique: es lo que hace que
  // esta página no dependa de dónde vive para estar protegida.
  const sesion = await exigirSesion()

  // Los chips de estado necesitan dos datos más, y los dos se leen acá por el
  // mismo motivo que el de arriba: la caja del turno (lib/caja/abrir-cerrar.ts)
  // y la cotización del dólar DEL LOCAL con sus últimas cargas
  // (`CotizacionDelDolar`, ciclo del 2026-10-18 — antes era
  // `Tenant.cotizacionUsd`, que nunca tuvo escritor y quedó sin lector). Esa
  // cotización alimenta el chip del header Y, si es de hoy, arranca el campo
  // "Cotización" de un pago que cruza monedas (`cotizacionParaElCruce`,
  // lib/ventas/cruce.ts) — lo que se guarda en el pago sigue siendo lo que
  // quedó tipeado.
  // Los planes van en la misma tanda, y por el mismo motivo: se leen en el
  // SERVIDOR y viajan como prop. Sin los desactivados —el default de
  // `planesDelTenant`—: un plan dado de baja no se puede usar para cobrar (el
  // motor lo rechaza con PLAN_INEXISTENTE), así que ofrecerlo sería ofrecer un
  // error. `PlanVisible` cruza a un componente cliente sin problema: sus campos
  // son string, number y Date, no Decimal (ver el comentario del tipo).
  const [caja, historial, puedeCargar, planes] = await Promise.all([
    cajaAbierta(sesion.tenant.id),
    historialDeCotizaciones(sesion.tenant.id),
    puedeConSesion(sesion, 'COTIZACION'),
    planesDelTenant(sesion.tenant.id),
  ])

  // Esta pantalla NO renderiza su encabezado: lo renderiza `PuntoDeVenta`,
  // que es un componente cliente. En el teléfono el Topbar cambia con el paso
  // de la venta (dice "Vender" o "Cobro", y la hamburguesa se vuelve una
  // flecha de volver), y el paso vive en el estado de cliente — un componente
  // de servidor no tiene forma de enterarse. Es la única de las diez pantallas
  // donde pasa; ver el comentario en punto-de-venta.tsx.
  return (
    <PuntoDeVenta
      planes={planes}
      caja={caja ? { abiertaEn: caja.abiertaEn } : null}
      // `vieja` se decide ACÁ, con el reloj del servidor al armar la página,
      // para que el HTML del servidor y el del navegador pinten lo mismo; ver
      // el comentario de `CotizacionDeVender` (dolar.tsx) para lo que decide
      // el navegador por su cuenta. El valor ya viene como texto
      // (`historialDeCotizaciones`): un Decimal no cruza al cliente.
      cotizacion={{
        historial,
        vieja: esCotizacionVieja(historial[0] ?? null, new Date()),
        puedeCargar,
      }}
    />
  )
}
