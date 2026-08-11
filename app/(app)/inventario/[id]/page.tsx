import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { FormularioDeEdicion, AccionesDeArticulo, MoverStock } from '../formularios'
import { formatearPrecio, formatearCantidad, formatearFecha } from '@/lib/formato/mostrar'

export const dynamic = 'force-dynamic'

const MOVIMIENTOS_VISIBLES = 50

const NOMBRE_DE_MOTIVO: Record<string, string> = {
  VENTA: 'Venta',
  ANULACION_VENTA: 'Anulación de venta',
  AJUSTE: 'Ajuste',
  INGRESO: 'Ingreso',
}

export default async function DetalleDeArticulo({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params

  const prisma = prismaParaTenant(sesion.tenant.id)
  const articulo = await prisma.articulo.findUnique({ where: { id } })
  // RLS ya filtró por tenant, así que "no existe" y "es de otro negocio" son el
  // mismo 404 — y tienen que serlo: distinguirlos filtraría qué ids existen.
  if (!articulo) notFound()

  const movimientos = await prisma.movimientoStock.findMany({
    where: { articuloId: id },
    orderBy: { creadoEn: 'desc' },
    take: MOVIMIENTOS_VISIBLES,
    select: {
      id: true, delta: true, motivo: true, nota: true, creadoEn: true,
      usuario: { select: { nombre: true } },
      venta: { select: { numero: true } },
    },
  })

  const esDuenio = sesion.usuario.rol === 'DUENO'
  const esProducto = articulo.tipo === 'PRODUCTO'

  return (
    <main className="p-6">
      <Link href="/inventario" className="text-sm underline">
        ← Inventario
      </Link>

      <h1 className="mt-4 text-xl font-medium">{articulo.nombre}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {articulo.sku} · {esProducto ? 'Producto' : 'Servicio'} ·{' '}
        {formatearPrecio(articulo.precio.toString())}
      </p>

      {articulo.desactivadoEn && (
        <Alert className="mb-6 max-w-md">
          <AlertDescription>
            Este artículo está desactivado: no aparece en el listado ni se puede vender.
          </AlertDescription>
        </Alert>
      )}

      {esProducto && (
        <p className="mb-8 text-2xl tabular-nums">
          <span className={articulo.stock.lessThan(0) ? 'text-destructive' : undefined}>
            {formatearCantidad(articulo.stock.toString())}
          </span>{' '}
          <span className="text-sm text-muted-foreground">en stock</span>
        </p>
      )}

      {/* Mover stock va ARRIBA de editar: para un empleado es lo único que
          puede hacer en esta pantalla. */}
      {esProducto && !articulo.desactivadoEn && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-medium">Mover stock</h2>
          <MoverStock articuloId={articulo.id} />
        </section>
      )}

      {esDuenio && (
        <section className="mb-8">
          <FormularioDeEdicion
            articuloId={articulo.id}
            nombre={articulo.nombre}
            sku={articulo.sku}
            precio={articulo.precio.toString()}
          />
          <AccionesDeArticulo
            articuloId={articulo.id}
            desactivado={articulo.desactivadoEn !== null}
          />
        </section>
      )}

      {/* El bloque que responde "por qué tengo 3 y no 5", que es la pregunta
          que un dueño hace cuando el inventario no le cierra. Es para lo que la
          tabla es append-only. */}
      <section>
        <h2 className="mb-3 text-base font-medium">Historial</h2>
        {movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hubo movimientos de este artículo.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Fecha</th>
                <th>Motivo</th>
                <th className="text-right">Cambio</th>
                <th>Quién</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="py-2">{formatearFecha(m.creadoEn)}</td>
                  <td>{NOMBRE_DE_MOTIVO[m.motivo] ?? m.motivo}</td>
                  <td
                    className={`text-right tabular-nums ${
                      m.delta.lessThan(0) ? 'text-destructive' : ''
                    }`}
                  >
                    {/* El signo explícito en el positivo: la columna se lee de
                        un vistazo como "entró" o "salió". */}
                    {m.delta.greaterThan(0) ? '+' : ''}
                    {formatearCantidad(m.delta.toString())}
                  </td>
                  <td>{m.usuario.nombre}</td>
                  <td className="text-muted-foreground">
                    {m.venta ? `Venta #${m.venta.numero}` : (m.nota ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {movimientos.length === MOVIMIENTOS_VISIBLES && (
          <p className="mt-3 text-sm text-muted-foreground">
            Se muestran los últimos {MOVIMIENTOS_VISIBLES} movimientos.
          </p>
        )}
      </section>
    </main>
  )
}
