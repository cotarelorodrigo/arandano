import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  formatearPrecio, formatearDolares, formatearCantidad, formatearFecha,
} from '@/lib/formato/mostrar'
import { AnularVenta } from '../formularios'
import { esUuid } from '@/lib/uuid'

export const dynamic = 'force-dynamic'

const NOMBRE_DE_MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_DEBITO: 'Débito',
  TARJETA_CREDITO: 'Crédito',
}

export default async function DetalleDeVenta({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // Mismo guard que el detalle de artículo y por el mismo motivo: `/ventas/foo`
  // es algo que alguien escribe en la barra de direcciones, y sin esto Prisma
  // rechaza el valor con P2007 y la pantalla se cae con un 500.
  if (!esUuid(id)) notFound()

  const venta = await prismaParaTenant(sesion.tenant.id).venta.findUnique({
    where: { id },
    select: {
      id: true, numero: true, total: true, creadoEn: true, anuladaEn: true,
      usuario: { select: { nombre: true } },
      anuladaPor: { select: { nombre: true } },
      items: { select: { id: true, descripcion: true, cantidad: true, precioUnitario: true } },
      pagos: { select: { id: true, medio: true, moneda: true, monto: true, cotizacion: true } },
    },
  })
  // RLS ya filtró por tenant: "no existe" y "es de otro negocio" son el mismo
  // 404, y tienen que serlo — distinguirlos filtraría qué ids existen.
  if (!venta) notFound()

  return (
    <>
      <Encabezado
        titulo={`Venta #${venta.numero}`}
        subtitulo={
          <>
            {formatearFecha(venta.creadoEn)} · {venta.usuario.nombre}
          </>
        }
      />
      <div className="p-6">
        {/* mb-6: el margen inferior que antes traía el <p> del subtítulo
            (ahora en el Encabezado) y que el cuerpo sigue necesitando. */}
        <Link href="/ventas" className="mb-6 block text-sm underline">← Ventas</Link>

        {venta.anuladaEn && (
          <Alert className="mb-6 max-w-md">
            <AlertDescription>
              Anulada el {formatearFecha(venta.anuladaEn)}
              {venta.anuladaPor ? ` por ${venta.anuladaPor.nombre}` : ''}.
            </AlertDescription>
          </Alert>
        )}

        <section className="mb-8">
          <h2 className="mb-3 text-base font-medium">Qué se vendió</h2>
          {/* Los datos CONGELADOS: lo que se cobró ese día, no lo que el artículo
              vale hoy. Es para lo que VentaItem guarda copia. */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2">Artículo</th>
                <th scope="col" className="text-right">Cantidad</th>
                <th scope="col" className="text-right">Precio</th>
              </tr>
            </thead>
            <tbody>
              {venta.items.map((i) => (
                <tr key={i.id} className="border-b">
                  <td className="py-2">{i.descripcion}</td>
                  <td className="text-right tabular-nums">{formatearCantidad(i.cantidad.toString())}</td>
                  <td className="text-right tabular-nums">{formatearPrecio(i.precioUnitario.toString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-lg tabular-nums">
            Total: <span className="font-medium">{formatearPrecio(venta.total.toString())}</span>
          </p>
        </section>

        <section>
          <h2 className="mb-3 text-base font-medium">Cómo se pagó</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th scope="col" className="py-2">Medio</th>
                <th scope="col" className="text-right">Monto</th>
                <th scope="col" className="text-right">En pesos</th>
              </tr>
            </thead>
            <tbody>
              {venta.pagos.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2">
                    {NOMBRE_DE_MEDIO[p.medio] ?? p.medio}
                    {p.moneda === 'USD' && (
                      <span className="ml-2 text-muted-foreground">
                        a {formatearPrecio(p.cotizacion.toString())}
                      </span>
                    )}
                  </td>
                  {/* Cada moneda con su formateador: `formatearPrecio` ya emite
                      el `$` de pesos, así que anteponerle "US$ " a mano daba
                      "US$ $ 0,80". La cotización de al lado sí va en pesos —una
                      cotización es cuántos pesos vale un dólar—, y por eso sigue
                      con `formatearPrecio`. */}
                  <td className="text-right tabular-nums">
                    {p.moneda === 'USD'
                      ? formatearDolares(p.monto.toString())
                      : formatearPrecio(p.monto.toString())}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatearPrecio(p.monto.mul(p.cotizacion).toFixed(2))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {sesion.usuario.rol === 'DUENO' && !venta.anuladaEn && <AnularVenta ventaId={venta.id} />}
      </div>
    </>
  )
}
