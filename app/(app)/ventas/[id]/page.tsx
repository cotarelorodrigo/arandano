import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, TriangleAlert } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  formatearPrecio, formatearDolares, formatearCantidad, formatearHora, formatearFechaCorta,
} from '@/lib/formato/mostrar'
import { ROTULO_MEDIO, CONSUMIDOR_FINAL, type Medio } from '@/lib/ventas/medios'
import { ChipEstado } from '../chip-estado'
import { AnularVenta } from '../formularios'
import { esUuid } from '@/lib/uuid'

export const dynamic = 'force-dynamic'

const ROTULO_MONEDA: Record<'ARS' | 'USD', string> = { ARS: 'Pesos', USD: 'Dólares' }

/**
 * Si esta persona puede anular ESTA venta: sólo el dueño, y sólo mientras
 * siga cobrada. Extraída y exportada porque es el único pedazo de la regla
 * que se puede probar sin un request real (mismo criterio que las funciones
 * puras de app/(app)/ventas/page.tsx) — el guard de verdad, el que protege,
 * sigue viviendo en `exigirDuenio()` adentro de la action `anular()`; esto es
 * sólo lo que decide si la pantalla ofrece el botón.
 */
export function puedeAnular(rol: string, anuladaEn: Date | null): boolean {
  return rol === 'DUENO' && anuladaEn === null
}

/**
 * La columna "Cotización" de la tabla de pagos: sólo tiene sentido para un
 * pago en dólares — un pago en pesos no se tomó a ninguna cotización, y
 * mostrar "1" ahí sería inventar un dato que el pago no tiene.
 */
export function cotizacionVisible(p: { moneda: 'ARS' | 'USD'; cotizacion: string }): string {
  return p.moneda === 'USD' ? formatearPrecio(p.cotizacion) : '—'
}

/**
 * El subtítulo de un ítem vendido, bajo su nombre: el SKU si es un producto
 * con stock, o "Servicio" si no lo es — un servicio no tiene SKU de stock,
 * mismo criterio que ya usa el buscador de /vender para el mismo artículo.
 */
export function subtituloDeItem(articulo: { sku: string; tipo: 'PRODUCTO' | 'SERVICIO' }): string {
  return articulo.tipo === 'SERVICIO' ? 'Servicio' : `SKU ${articulo.sku}`
}

/**
 * Las cuatro filas de texto del panel Resumen. La quinta —Estado— no es
 * texto: es el `ChipEstado` compartido con el listado, así que queda afuera
 * de esta función y se renderiza aparte.
 */
export function filasDeResumen(v: {
  creadoEn: Date
  usuario: { nombre: string }
  cliente: { nombre: string } | null
}): { fecha: string; vendio: string; cliente: string; comprobante: string } {
  return {
    fecha: `${formatearFechaCorta(v.creadoEn)} · ${formatearHora(v.creadoEn)}`,
    vendio: v.usuario.nombre,
    cliente: v.cliente?.nombre ?? CONSUMIDOR_FINAL,
    // Fijo y no leído de ningún campo: no existe `model Factura` en el schema
    // (CLAUDE.md, "Decisiones abiertas del modelo de datos" y "Queda para el
    // ciclo de ventas: ... Factura"), y hoy NINGUNA venta tiene comprobante
    // fiscal, así que este texto es exactamente cierto para todas. El día que
    // ARCA se integre, este campo pasa a leer de un `facturaId` o similar —
    // no antes, porque hoy no hay ninguna forma de saber qué forma va a tener.
    comprobante: 'Sin factura ARCA',
  }
}

/** Una fila clave/valor del panel Resumen. */
function FilaResumen({ clave, children }: { clave: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-[18px] py-[11px] last:border-b-0">
      <span className="text-[12px] text-muted-foreground">{clave}</span>
      <span className="text-[13px] font-medium text-foreground">{children}</span>
    </div>
  )
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
      cliente: { select: { nombre: true } },
      items: {
        select: {
          id: true, descripcion: true, cantidad: true, precioUnitario: true,
          articulo: { select: { sku: true, tipo: true } },
        },
      },
      pagos: { select: { id: true, medio: true, moneda: true, monto: true, cotizacion: true } },
    },
  })
  // RLS ya filtró por tenant: "no existe" y "es de otro negocio" son el mismo
  // 404, y tienen que serlo — distinguirlos filtraría qué ids existen.
  if (!venta) notFound()

  const filas = filasDeResumen(venta)
  const anulada = venta.anuladaEn !== null

  return (
    <>
      <Encabezado titulo={`Venta #${venta.numero}`} />
      <div className="flex flex-col gap-4 p-6">
        <Link
          href="/ventas"
          className="flex w-fit items-center gap-[6px] text-[12px] font-semibold text-muted-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-[14px]" />
          Ventas
        </Link>

        {/* Fila: las dos columnas — qué se vendió/cómo se pagó a la
            izquierda, resumen y anulación a la derecha (design/arandano.pen,
            nodo `NjMl1`). */}
        <div className="flex items-start gap-4">
          <div className="flex flex-1 flex-col gap-4">
            <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-[18px] py-[13px]">
                <h2
                  style={{ fontFamily: 'var(--font-archivo)' }}
                  className="text-[15px] font-semibold text-foreground"
                >
                  Qué se vendió
                </h2>
              </div>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="h-auto px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Artículo
                    </TableHead>
                    <TableHead className="h-auto w-[100px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Cantidad
                    </TableHead>
                    <TableHead className="h-auto w-[130px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Precio
                    </TableHead>
                    <TableHead className="h-auto w-[140px] px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Subtotal
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Los datos CONGELADOS: lo que se cobró ese día, no lo que
                      el artículo vale hoy. Es para lo que VentaItem guarda
                      copia — el subtotal sí se recalcula acá (cantidad ×
                      precioUnitario CONGELADO), no porque el dato falte sino
                      porque es aritmética sobre lo que ya se guardó. */}
                  {venta.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="p-[11px] px-[7px] pl-[18px] whitespace-normal">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-medium text-foreground">{i.descripcion}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {subtituloDeItem(i.articulo)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: 'var(--font-archivo)' }}
                        className="p-[11px] px-[7px] text-right text-foreground tabular-nums"
                      >
                        {formatearCantidad(i.cantidad.toString())}
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: 'var(--font-archivo)' }}
                        className="p-[11px] px-[7px] text-right text-foreground-soft tabular-nums"
                      >
                        {formatearPrecio(i.precioUnitario.toString())}
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: 'var(--font-archivo)' }}
                        className="p-[11px] px-[7px] pr-[18px] text-right font-semibold text-foreground tabular-nums"
                      >
                        {formatearPrecio(i.cantidad.mul(i.precioUnitario).toFixed(2))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex items-center justify-between bg-muted px-[18px] py-[14px]">
                <span className="text-[10px] font-bold tracking-[1.2px] text-muted-foreground uppercase">
                  Total
                </span>
                <span
                  style={{ fontFamily: 'var(--font-archivo)' }}
                  className="text-[22px] font-semibold text-foreground tabular-nums"
                >
                  {formatearPrecio(venta.total.toString())}
                </span>
              </div>
            </div>

            <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-[18px] py-[13px]">
                <h2
                  style={{ fontFamily: 'var(--font-archivo)' }}
                  className="text-[15px] font-semibold text-foreground"
                >
                  Cómo se pagó
                </h2>
              </div>
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow className="bg-muted hover:bg-muted">
                    <TableHead className="h-auto px-[7px] py-3 pl-[18px] text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Medio
                    </TableHead>
                    <TableHead className="h-auto w-[110px] px-[7px] py-3 text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Moneda
                    </TableHead>
                    <TableHead className="h-auto w-[130px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Cotización
                    </TableHead>
                    <TableHead className="h-auto w-[130px] px-[7px] py-3 text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      Monto
                    </TableHead>
                    <TableHead className="h-auto w-[140px] px-[7px] py-3 pr-[18px] text-right text-[10px] font-bold tracking-[0.8px] text-muted-foreground uppercase">
                      En pesos
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {venta.pagos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="p-[11px] px-[7px] pl-[18px] text-foreground">
                        {ROTULO_MEDIO[p.medio as Medio]}
                      </TableCell>
                      <TableCell className="p-[11px] px-[7px] text-foreground">
                        {ROTULO_MONEDA[p.moneda]}
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: 'var(--font-archivo)' }}
                        className="p-[11px] px-[7px] text-right text-foreground-soft tabular-nums"
                      >
                        {cotizacionVisible({ moneda: p.moneda, cotizacion: p.cotizacion.toString() })}
                      </TableCell>
                      {/* Cada moneda con su formateador: `formatearPrecio` ya
                          emite el `$` de pesos, así que anteponerle "US$ " a
                          mano daba "US$ $ 0,80". */}
                      <TableCell
                        style={{ fontFamily: 'var(--font-archivo)' }}
                        className="p-[11px] px-[7px] text-right text-foreground tabular-nums"
                      >
                        {p.moneda === 'USD'
                          ? formatearDolares(p.monto.toString())
                          : formatearPrecio(p.monto.toString())}
                      </TableCell>
                      <TableCell
                        style={{ fontFamily: 'var(--font-archivo)' }}
                        className="p-[11px] px-[7px] pr-[18px] text-right font-semibold text-foreground tabular-nums"
                      >
                        {formatearPrecio(p.monto.mul(p.cotizacion).toFixed(2))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="flex w-[324px] shrink-0 flex-col gap-4">
            <div className="flex flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="border-b px-[18px] py-[13px]">
                <h2
                  style={{ fontFamily: 'var(--font-archivo)' }}
                  className="text-[15px] font-semibold text-foreground"
                >
                  Resumen
                </h2>
              </div>
              <div className="flex flex-col">
                <FilaResumen clave="Fecha">{filas.fecha}</FilaResumen>
                <FilaResumen clave="Vendió">{filas.vendio}</FilaResumen>
                <FilaResumen clave="Cliente">{filas.cliente}</FilaResumen>
                <FilaResumen clave="Estado">
                  <ChipEstado anulada={anulada} />
                </FilaResumen>
                <FilaResumen clave="Comprobante">{filas.comprobante}</FilaResumen>
              </div>
            </div>

            {/* Zona de riesgo (design/arandano.pen, nodo `TIlD3`): la maqueta
                sólo dibuja el texto de advertencia, sin ningún botón — no
                existe ningún frame de venta anulada contra el que confirmar
                si el botón va en otro lado, así que se lo deja exactamente
                donde el texto lo ubica (ver relevamiento.md, punto 6). Se
                oculta entera una vez anulada: no hay nada que advertir sobre
                una acción que ya no se puede tomar. El texto queda visible
                para cualquier rol —explica por qué un empleado no tiene el
                botón—, y el botón mismo sigue restringido al dueño. */}
            {!anulada && (
              <div className="flex flex-col gap-[9px] rounded-2xl bg-destructive-soft p-4">
                <div className="flex items-center gap-[7px]">
                  <TriangleAlert aria-hidden="true" className="size-[14px] text-destructive" />
                  <span className="text-[13px] font-bold text-destructive">Anular la venta</span>
                </div>
                <p className="text-[11px] leading-[1.45] text-destructive opacity-85">
                  El stock vuelve al inventario con movimientos compensatorios. Los
                  movimientos originales no se borran. Sólo el dueño puede hacerlo.
                </p>
                {puedeAnular(sesion.usuario.rol, venta.anuladaEn) && (
                  <AnularVenta ventaId={venta.id} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
