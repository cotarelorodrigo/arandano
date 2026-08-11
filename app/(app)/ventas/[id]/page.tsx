import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { formatearPrecio, formatearCantidad, formatearFecha } from '@/lib/formato/mostrar'
import { AnularVenta } from '../formularios'

export const dynamic = 'force-dynamic'

const NOMBRE_DE_MEDIO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA_DEBITO: 'Débito',
  TARJETA_CREDITO: 'Crédito',
}

// Mismo guard que el detalle de artículo y por el mismo motivo: `/ventas/foo`
// es algo que alguien escribe en la barra de direcciones, y sin esto Prisma
// rechaza el valor con P2007 y la pantalla se cae con un 500.
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function DetalleDeVenta({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  if (!ES_UUID.test(id)) notFound()

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
    <main className="p-6">
      <Link href="/ventas" className="text-sm underline">← Ventas</Link>

      <h1 className="mt-4 text-xl font-medium">Venta #{venta.numero}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {formatearFecha(venta.creadoEn)} · {venta.usuario.nombre}
      </p>

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
                <td className="text-right tabular-nums">
                  {p.moneda === 'USD' ? 'US$ ' : ''}
                  {formatearPrecio(p.monto.toString())}
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
    </main>
  )
}
