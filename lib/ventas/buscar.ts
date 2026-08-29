// lib/ventas/buscar.ts
import { prismaParaTenant } from '@/lib/tenant/prisma'

/**
 * Un artículo tal como lo necesita el punto de venta.
 *
 * La plata y el stock salen como STRING y no como `Prisma.Decimal`: esto lo
 * consume un componente cliente, que no puede recibir un Decimal a través del
 * borde sin perder el tipo. Convertir acá, en el borde, es más honesto que
 * dejar que la pantalla se arregle.
 */
export type ArticuloVendible = {
  id: string
  sku: string
  nombre: string
  precio: string
  moneda: 'ARS' | 'USD'
  stock: string
  esProducto: boolean
}

// Suficientes para elegir de un vistazo y pocas para que la lista no tape la
// pantalla. El que no encuentra lo suyo acá escribe dos letras más.
const RESULTADOS = 8

/**
 * Los artículos que se pueden vender, buscados por nombre o código.
 *
 * Filtra `desactivadoEn: null` — es el requisito que el ciclo de inventario
 * dejó escrito para éste. Un artículo desactivado tampoco se puede vender desde
 * el motor (`crearVenta` lo rechaza con ARTICULO_DESACTIVADO), así que las dos
 * mitades están: la pantalla no lo ofrece y el motor no lo acepta.
 */
export async function buscarArticulosVendibles(
  tenantId: string,
  texto: string,
): Promise<ArticuloVendible[]> {
  const busqueda = texto.trim()
  // Sin esto, el primer foco en el buscador traería el catálogo entero.
  if (busqueda === '') return []

  const articulos = await prismaParaTenant(tenantId).articulo.findMany({
    where: {
      desactivadoEn: null,
      OR: [
        { nombre: { contains: busqueda, mode: 'insensitive' } },
        { sku: { contains: busqueda, mode: 'insensitive' } },
      ],
    },
    orderBy: { nombre: 'asc' },
    take: RESULTADOS,
    select: { id: true, sku: true, nombre: true, precio: true, moneda: true, stock: true, tipo: true },
  })

  return articulos.map((a) => ({
    id: a.id,
    sku: a.sku,
    nombre: a.nombre,
    precio: a.precio.toString(),
    moneda: a.moneda,
    stock: a.stock.toString(),
    esProducto: a.tipo === 'PRODUCTO',
  }))
}
