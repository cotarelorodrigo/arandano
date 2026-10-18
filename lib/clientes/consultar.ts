import type { Prisma } from '@/generated/prisma/client'
import type { EstadoOrden } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { cobradoDePagos, formatearTotales } from '@/lib/ventas/cobrado'
import { dondeBusca } from './filtros'

/** Lo que la pantalla y el CSV filtran. */
export type FiltroDeClientes = {
  texto: string
  /** Sólo los que aceptaron recibir ofertas: la lista a la que se le puede
   *  escribir. */
  soloAceptanOfertas: boolean
}

function dondeFiltra(f: FiltroDeClientes): Prisma.ClienteWhereInput {
  const busca = dondeBusca(f.texto)
  return {
    ...(busca ?? {}),
    ...(f.soloAceptanOfertas ? { aceptaOfertas: true } : {}),
  }
}

/** Un cliente del listado, con lo que el listado y el CSV muestran de él. */
export type ClienteDelListado = {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  notas: string | null
  aceptaOfertas: boolean
  creadoEn: Date
  /** Las ventas NO anuladas: una venta anulada no es una compra. */
  compras: number
  /** La fecha de la última venta no anulada, o null si nunca compró. */
  ultimaCompra: Date | null
}

/**
 * El listado de /clientes y el CSV: el mismo `where` (búsqueda + filtro de
 * ofertas) y la misma forma, para que el CSV sea exactamente lo que la
 * pantalla muestra filtrado.
 *
 * `limite` para la pantalla; sin él, todos (el CSV). El CSV sin tope por el
 * mismo motivo escrito en `exportarVentas` (app/(app)/dashboard/acciones.ts):
 * uno recortado sin decirlo miente sobre lo que dice exportar. Un local de
 * este producto tiene cientos o pocos miles de clientes, no millones.
 *
 * Por nombre, que es como se busca a alguien en una lista de contactos; a
 * igual nombre, el más viejo primero.
 */
export async function clientesDelListado(
  tenantId: string,
  filtro: FiltroDeClientes,
  limite?: number,
): Promise<{ clientes: ClienteDelListado[]; total: number }> {
  const where = dondeFiltra(filtro)
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const [filas, total] = await Promise.all([
      tx.cliente.findMany({
        where,
        orderBy: [{ nombre: 'asc' }, { creadoEn: 'asc' }],
        take: limite,
        select: {
          id: true, nombre: true, telefono: true, email: true, notas: true,
          aceptaOfertas: true, creadoEn: true,
          _count: { select: { ventas: { where: { anuladaEn: null } } } },
          ventas: {
            where: { anuladaEn: null },
            orderBy: { creadoEn: 'desc' },
            take: 1,
            select: { creadoEn: true },
          },
        },
      }),
      // Contado aparte sólo cuando hay tope: sin él, `filas.length` YA es el
      // total, y una segunda consulta sería trabajo de más.
      limite === undefined ? Promise.resolve(null) : tx.cliente.count({ where }),
    ])
    return {
      clientes: filas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        telefono: c.telefono,
        email: c.email,
        notas: c.notas,
        aceptaOfertas: c.aceptaOfertas,
        creadoEn: c.creadoEn,
        compras: c._count.ventas,
        ultimaCompra: c.ventas[0]?.creadoEn ?? null,
      })),
      total: total ?? filas.length,
    }
  })
}

/** Cuántas compras muestra la ficha. Más que eso es un cliente mayorista, y la
 *  ficha dice cuántas hay en total y que se ven las últimas. */
export const TOPE_COMPRAS_EN_LA_FICHA = 100

export type CompraDeLaFicha = {
  id: string
  numero: number
  creadoEn: Date
  anulada: boolean
  /** La plata que entró, en su moneda o en las dos: `formatearTotales` de
   *  `cobradoDePagos`, el mismo renglón que el detalle de la venta. */
  totalFormateado: string
}

export type OrdenDeLaFicha = {
  id: string
  numero: number
  creadoEn: Date
  estado: EstadoOrden
  anulada: boolean
  equipo: string
}

export type FichaDeCliente = {
  cliente: {
    id: string
    nombre: string
    telefono: string | null
    email: string | null
    notas: string | null
    aceptaOfertas: boolean
    creadoEn: Date
  }
  compras: CompraDeLaFicha[]
  ordenes: OrdenDeLaFicha[]
  /** TODAS las ventas y órdenes, anuladas incluidas: es lo que decide si se
   *  puede borrar (la FK las cuenta a todas). */
  historia: { ventas: number; ordenes: number }
}

/**
 * La ficha de un cliente: sus datos, sus compras y sus órdenes de servicio
 * técnico —que ya existen y son la otra mitad de su historia—.
 *
 * `null` si no existe o es de otro tenant (RLS ya filtró): el llamador lo
 * traduce a `notFound()` sin distinguir los dos casos.
 *
 * Las compras incluyen las anuladas, marcadas como tales: esconderlas haría que
 * el conteo de la historia ("tiene 3 compras") no coincida con lo que se ve.
 */
export async function fichaDeCliente(tenantId: string, clienteId: string): Promise<FichaDeCliente | null> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const c = await tx.cliente.findUnique({
      where: { id: clienteId },
      select: {
        id: true, nombre: true, telefono: true, email: true, notas: true,
        aceptaOfertas: true, creadoEn: true,
        _count: { select: { ventas: true, ordenes: true } },
        ventas: {
          orderBy: { creadoEn: 'desc' },
          take: TOPE_COMPRAS_EN_LA_FICHA,
          select: {
            id: true, numero: true, creadoEn: true, anuladaEn: true,
            pagos: { select: { moneda: true, monto: true } },
          },
        },
        ordenes: {
          orderBy: { creadoEn: 'desc' },
          take: TOPE_COMPRAS_EN_LA_FICHA,
          select: {
            id: true, numero: true, creadoEn: true, estado: true, anuladaEn: true,
            equipoMarca: true, equipoModelo: true,
          },
        },
      },
    })
    if (!c) return null
    return {
      cliente: {
        id: c.id, nombre: c.nombre, telefono: c.telefono, email: c.email,
        notas: c.notas, aceptaOfertas: c.aceptaOfertas, creadoEn: c.creadoEn,
      },
      compras: c.ventas.map((v) => ({
        id: v.id,
        numero: v.numero,
        creadoEn: v.creadoEn,
        anulada: v.anuladaEn !== null,
        totalFormateado: formatearTotales(cobradoDePagos(v.pagos)),
      })),
      ordenes: c.ordenes.map((o) => ({
        id: o.id,
        numero: o.numero,
        creadoEn: o.creadoEn,
        estado: o.estado,
        anulada: o.anuladaEn !== null,
        equipo: `${o.equipoMarca} ${o.equipoModelo}`,
      })),
      historia: { ventas: c._count.ventas, ordenes: c._count.ordenes },
    }
  })
}
