import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirSesion } from '@/lib/auth/sesion'
import { fichaDeCliente, type FichaDeCliente } from '@/lib/clientes/consultar'
import { rotuloDeHistoria } from '@/lib/clientes/rotulos'
import { formatearFechaCorta } from '@/lib/formato/mostrar'
import { NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { esUuid } from '@/lib/uuid'
import { ChipEstado } from '../../ventas/chip-estado'
import { BorrarCliente, FormularioDeLaFicha, type ClienteEditable } from '../formularios'
import estilos from '../tipografia.module.css'

export const dynamic = 'force-dynamic'

/** Una compra de la ficha, ya en texto. */
export type CompraVisible = { id: string; numero: number; fecha: string; total: string; anulada: boolean }
/** Una orden de la ficha, ya en texto. */
export type OrdenVisible = { id: string; numero: number; fecha: string; equipo: string; estado: string }

/**
 * Lo que `FichaDelCliente` necesita, resuelto a texto a partir de la consulta
 * (`fichaDeCliente`). Separada del Server Component para que el test la sostenga
 * sin sesión ni base, mismo criterio que `datosDelDetalle` en `/ventas/[id]`.
 *
 * `historia` es `null` sin ventas ni órdenes —se puede borrar— y si no, el
 * texto de por qué no ("3 compras y 1 orden").
 */
export function propsDeLaFicha(f: FichaDeCliente) {
  const historia =
    f.historia.ventas === 0 && f.historia.ordenes === 0
      ? null
      : rotuloDeHistoria(f.historia.ventas, f.historia.ordenes)
  return {
    cliente: {
      id: f.cliente.id,
      nombre: f.cliente.nombre,
      telefono: f.cliente.telefono,
      email: f.cliente.email,
      notas: f.cliente.notas,
      aceptaOfertas: f.cliente.aceptaOfertas,
    } satisfies ClienteEditable,
    alta: formatearFechaCorta(f.cliente.creadoEn),
    compras: f.compras.map((v) => ({
      id: v.id,
      numero: v.numero,
      fecha: formatearFechaCorta(v.creadoEn),
      total: v.totalFormateado,
      anulada: v.anulada,
    })),
    totalDeCompras: f.historia.ventas,
    ordenes: f.ordenes.map((o) => ({
      id: o.id,
      numero: o.numero,
      fecha: formatearFechaCorta(o.creadoEn),
      equipo: o.equipo,
      estado: o.anulada ? 'Anulada' : NOMBRE_ESTADO[o.estado],
    })),
    totalDeOrdenes: f.historia.ordenes,
    historia,
  }
}

function Card({ titulo, children, className = '' }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border bg-card ${className}`}>
      <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
        <h2 className={`${estilos.tituloDeCard} text-foreground`}>{titulo}</h2>
      </div>
      {children}
    </div>
  )
}

/** "Se ven las últimas 100 de 140" cuando la ficha recortó; nada si no. */
function avisoDeTope(mostradas: number, total: number, que: string): string | null {
  return mostradas < total ? `Se ven las últimas ${mostradas} de ${total} ${que}.` : null
}

/**
 * La ficha: los datos editables, las compras y las órdenes de servicio
 * técnico —la otra mitad de la historia de ese cliente—, y "Borrar" para el
 * dueño.
 *
 * Dos columnas en escritorio (la historia a la izquierda, los datos a la
 * derecha, como el detalle de una venta) y apiladas en el teléfono con los
 * datos primero: quien abre la ficha desde el mostrador casi siempre viene a
 * corregir un teléfono.
 *
 * Las compras anuladas se ven, con el mismo chip que `/ventas`: esconderlas
 * haría que el "tiene 3 compras" de abajo no coincida con lo que se lee arriba.
 */
export function FichaDelCliente({
  cliente, compras, totalDeCompras, ordenes, totalDeOrdenes, historia, esDuenio,
}: ReturnType<typeof propsDeLaFicha> & { esDuenio: boolean }) {
  const avisoCompras = avisoDeTope(compras.length, totalDeCompras, 'compras')
  const avisoOrdenes = avisoDeTope(ordenes.length, totalDeOrdenes, 'órdenes')
  return (
    <div className="flex flex-col gap-3 p-[14px] lg:flex-row lg:items-start lg:gap-4 lg:p-6">
      <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-none lg:flex-1 lg:gap-4">
        <Card titulo="Compras">
          {compras.length === 0 ? (
            <p className="px-[14px] py-6 text-center text-[13px] text-muted-foreground lg:px-[18px]">
              Todavía no tiene compras a su nombre. Se le asignan al cobrar, o después desde el
              detalle de la venta.
            </p>
          ) : (
            <>
              {avisoCompras && <p className="border-b px-[14px] py-2 text-xs text-muted-foreground lg:px-[18px]">{avisoCompras}</p>}
              <ul className="flex flex-col divide-y">
                {compras.map((v) => (
                  <li key={v.id}>
                    <Link
                      href={`/ventas/${v.id}`}
                      className="flex items-center gap-3 px-[14px] py-[11px] transition-colors hover:bg-muted/50 lg:px-[18px]"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm font-medium text-foreground">Venta #{v.numero}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{v.fecha}</span>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`text-[13px] font-semibold tabular-nums ${v.anulada ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                        >
                          {v.total}
                        </span>
                        {v.anulada && <ChipEstado anulada />}
                      </div>
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* Sólo si dejó algún equipo: un cliente de mostrador de un kiosco no
            tiene por qué ver una card vacía de servicio técnico. */}
        {ordenes.length > 0 && (
          <Card titulo="Servicio técnico">
            {avisoOrdenes && <p className="border-b px-[14px] py-2 text-xs text-muted-foreground lg:px-[18px]">{avisoOrdenes}</p>}
            <ul className="flex flex-col divide-y">
              {ordenes.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/servicio-tecnico/${o.id}`}
                    className="flex items-center gap-3 px-[14px] py-[11px] transition-colors hover:bg-muted/50 lg:px-[18px]"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        Orden #{o.numero} · {o.equipo}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">{o.fecha}</span>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-foreground-soft">{o.estado}</span>
                    <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <div className="order-1 flex flex-col gap-3 lg:order-none lg:w-[360px] lg:shrink-0 lg:gap-4">
        <Card titulo="Datos">
          <div className="p-[14px] lg:p-4">
            <FormularioDeLaFicha cliente={cliente} />
          </div>
        </Card>
        {esDuenio && (
          <Card titulo="Borrar">
            <div className="p-[14px] lg:p-4">
              <BorrarCliente clienteId={cliente.id} historia={historia} />
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

export default async function FichaDeClientePage({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  // `/clientes/foo` se tipea en la barra de direcciones: sin esto Prisma
  // rechaza el valor con P2007 y la pantalla se cae con un 500.
  if (!esUuid(id)) notFound()

  const ficha = await fichaDeCliente(sesion.tenant.id, id)
  // RLS ya filtró: "no existe" y "es de otro negocio" son el mismo 404.
  if (!ficha) notFound()
  const props = propsDeLaFicha(ficha)

  return (
    <>
      <Encabezado
        titulo={ficha.cliente.nombre}
        subtitulo={`Cliente desde el ${props.alta}`}
        atras="/clientes"
      />
      <FichaDelCliente {...props} esDuenio={sesion.usuario.rol === 'DUENO'} />
    </>
  )
}
