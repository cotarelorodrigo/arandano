import { exigirSesion } from '@/lib/auth/sesion'
import { aperturaSugerida } from '@/lib/caja/abrir-cerrar'
import { huboDolares, turnoEnCurso, type TurnoEnCurso } from '@/lib/caja/efectivo'
import type { Totales } from '@/lib/ventas/totales'
import type { CajaDelChip } from './caja'
import { planesDelTenant } from '@/lib/planes/consultar'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { historialDeCotizaciones } from '@/lib/cotizacion/consultar'
import { esCotizacionVieja } from '@/lib/cotizacion/reglas'
import { PuntoDeVenta } from './punto-de-venta'

export const dynamic = 'force-dynamic'

/** Un `{ ars, usd }` de Decimals, como texto: un Decimal no cruza al cliente. */
function aTexto(t: Totales) {
  return { ars: t.ars.toFixed(2), usd: t.usd.toFixed(2) }
}

/**
 * El turno en curso tal como lo consume `caja.tsx` (`CajaDelChip`): todo como
 * texto, y `conDolares` decidido acá con la misma regla para el chip, el panel
 * y el cierre (`huboDolares`, spec del arqueo, decisión 3). Exportada para que
 * un test la ejercite sin montar la página.
 */
export function cajaDelChip(t: TurnoEnCurso): CajaDelChip {
  const e = t.efectivo
  return {
    abiertaEn: t.caja.abiertaEn,
    abiertaPor: t.caja.abiertaPor,
    conDolares: huboDolares(e),
    efectivo: {
      apertura: aTexto(e.apertura),
      cobrado: aTexto(e.cobrado),
      devuelto: aTexto(e.devuelto),
      ingresos: aTexto(e.ingresos),
      egresos: aTexto(e.egresos),
      retiros: aTexto(e.retiros),
      actual: aTexto(e.actual),
    },
    movimientos: t.movimientos,
  }
}

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
  //
  // La caja, desde el ciclo del arqueo (2026-10-18), es el turno con su
  // efectivo y sus movimientos (`turnoEnCurso`, lib/caja/efectivo.ts), y la
  // apertura sugerida para cuando no hay ninguna abierta (lo que quedó en el
  // último cierre). Las dos van en la misma tanda: la sugerida es una lectura
  // de una fila, y pedirla sólo "si no hay caja" serializaría dos viajes.
  const [turno, sugerida, historial, puedeCargar, planes] = await Promise.all([
    turnoEnCurso(sesion.tenant.id),
    aperturaSugerida(sesion.tenant.id),
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
      caja={turno ? cajaDelChip(turno) : null}
      aperturaSugerida={sugerida}
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
