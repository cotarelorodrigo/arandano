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
  conFirma,
}: {
  orden: OrdenDelTicket
  local: string
  rotulo: string
  // Explícito y no deducido del rótulo: que la firma dependa de un string que
  // se muestra ata el comportamiento a la redacción, y cualquiera que retoque
  // el texto del papel le saca el renglón de la firma al local sin saberlo.
  conFirma: boolean
}) {
  return (
    <div className={estilos.hoja}>
      {/* El rótulo, ARRIBA de la copia y no en la línea de corte: es el título
          de lo que sigue. Ver el comentario de CuerpoDelTicket. */}
      <div className={estilos.rotulo}>{rotulo}</div>

      <div style={{ textAlign: 'center' }}>
        <strong>{local}</strong>
        <div>Servicio técnico</div>
        <div className={estilos.numero}>#{orden.numero}</div>
        <div>{formatearFecha(orden.creadoEn)}</div>
      </div>

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

      {conFirma ? <div className={estilos.firma}>Firma del cliente</div> : null}
    </div>
  )
}

/**
 * Exportado para el test: se renderiza sin base y sin sesión.
 *
 * Las DOS copias en una sola impresión: sobre un rollo continuo salen una
 * después de la otra, así que es un botón y no dos.
 *
 * La línea de corte va UNA VEZ Y ENTRE LAS DOS COPIAS, que es lo único que la
 * hace servir para algo. Antes vivía adentro de cada copia, entre su encabezado
 * y su cuerpo: el rollo salía
 *
 *     [local, #42, fecha]  ---- COPIA CLIENTE ----  [cliente, equipo, falla]
 *     [local, #42, fecha]  ---- COPIA LOCAL   ----  [cliente, equipo, falla]
 *
 * o sea que quien cortara por la línea rotulada "COPIA LOCAL" le arrancaba el
 * encabezado a la copia del local — donde está el #42 grande, y siendo ésa
 * justamente la que queda pegada al equipo en el estante. El spec pide las
 * copias "separadas por la línea de corte".
 */
export function CuerpoDelTicket({ orden, local }: { orden: OrdenDelTicket; local: string }) {
  return (
    <>
      <Copia orden={orden} local={local} rotulo="— COPIA CLIENTE —" conFirma={false} />
      <div className={estilos.corte}>— cortar acá —</div>
      <Copia orden={orden} local={local} rotulo="— COPIA LOCAL —" conFirma />
    </>
  )
}
