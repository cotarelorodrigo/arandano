import { formatearFecha } from '@/lib/formato/mostrar'
import estilos from './ticket.module.css'

// Separado de page.tsx a propósito: page.tsx importa prismaParaTenant, que
// arrastra lib/db.ts, y ese módulo construye su Pool AL IMPORTARSE, leyendo
// DATABASE_URL. Este archivo sólo importa formatearFecha y el CSS module, así
// que ticket.test.tsx puede renderizar CuerpoDelTicket sin arrastrar una base
// que ese test no necesita — mismo cuidado que test/inventario.test.ts
// documenta en su encabezado para lib/tenant/transaccion.

export type OrdenDelTicket = {
  numero: number
  equipoMarca: string
  equipoModelo: string
  equipoSerie: string | null
  // Está en el tipo aunque no se imprima: que el dato LLEGUE y la decisión de
  // no mostrarlo sea explícita es lo que el test verifica. Si no llegara, el
  // test pasaría por accidente y nadie sabría que la decisión sigue viva.
  claveDesbloqueo: string | null
  fallaDeclarada: string
  accesorios: string | null
  danosVisibles: string | null
  creadoEn: Date
  cliente: { nombre: string; telefono: string | null }
  recibidaPor: { nombre: string }
}

function Copia({
  orden,
  local,
  rotulo,
}: {
  orden: OrdenDelTicket
  local: string
  rotulo: string
}) {
  return (
    <div className={estilos.hoja}>
      <div style={{ textAlign: 'center' }}>
        <strong>{local}</strong>
        <div>Servicio técnico</div>
        <div className={estilos.numero}>#{orden.numero}</div>
        <div>{formatearFecha(orden.creadoEn)}</div>
      </div>

      <div className={estilos.corte}>{rotulo}</div>

      <div>
        <div>Cliente: {orden.cliente.nombre}</div>
        {orden.cliente.telefono ? <div>Tel: {orden.cliente.telefono}</div> : null}
        <div>
          Equipo: {orden.equipoMarca} {orden.equipoModelo}
        </div>
        {orden.equipoSerie ? <div>IMEI/Serie: {orden.equipoSerie}</div> : null}
        <div>Falla: {orden.fallaDeclarada}</div>
        {orden.accesorios ? <div>Accesorios: {orden.accesorios}</div> : null}
        {orden.danosVisibles ? <div>Estado: {orden.danosVisibles}</div> : null}
        <div>Recibió: {orden.recibidaPor.nombre}</div>
      </div>

      {rotulo.includes('LOCAL') ? <div className={estilos.firma}>Firma del cliente</div> : null}
    </div>
  )
}

/**
 * Exportado para el test: se renderiza sin base y sin sesión.
 *
 * Las DOS copias en una sola impresión: sobre un rollo continuo salen una
 * después de la otra, así que es un botón y no dos.
 */
export function CuerpoDelTicket({ orden, local }: { orden: OrdenDelTicket; local: string }) {
  return (
    <>
      <Copia orden={orden} local={local} rotulo="— COPIA CLIENTE —" />
      <Copia orden={orden} local={local} rotulo="— COPIA LOCAL —" />
    </>
  )
}
