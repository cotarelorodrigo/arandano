/**
 * Ventas sintéticas para mirar /ventas en dev: `npm run ventas:sembrar`.
 *
 * Nació como descartable —el encabezado decía "no se commitea", y la review
 * levantó que estaba commiteado y encima citado por ruta en
 * docs/sistema-de-diseno.md—. Se queda: el canario de dev arranca sin una sola
 * venta, y sin pagos el panel "Cómo entró la plata" no se dibuja, así que sin
 * esto cada verificación visual futura vuelve a escribirlo.
 *
 * **Sólo dev.** Escribe ventas de mentira; correrlo contra una base con datos
 * de clientes ensucia la caja de alguien.
 *
 * Importes de distinta cantidad de dígitos a propósito: con montos parejos no
 * se puede ver si las columnas de números bailan (lección anotada en CLAUDE.md
 * al cerrar la verificación visual del punto de venta).
 */
import { Prisma } from '@/generated/prisma/client'
import { crearVenta } from '@/lib/ventas/crear'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { prisma } from '@/lib/db'

const d = (v: string) => new Prisma.Decimal(v)
const COTIZACION = d('1450')

// Por argumento: la app conecta como `arandano_app`, sobre el que RLS aplica,
// así que un `findFirst` de tenants sin GUC no devuelve nada. Los ids salen de
// psql, que entra con el rol dueño.
const [tenantId, usuarioId] = process.argv.slice(2)
if (!tenantId || !usuarioId) throw new Error('uso: sembrar-ventas-dev.mts <tenantId> <usuarioId>')

const arts = await prismaParaTenant(tenantId).articulo.findMany({ orderBy: { sku: 'asc' } })
const porSku = (sku: string) => arts.find((a) => a.sku === sku)!.id

type Receta = {
  items: [string, string][]
  pagos: [
    'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_DEBITO' | 'TARJETA_CREDITO',
    'ARS' | 'USD',
    string,
  ][]
}

const RECETAS: Receta[] = [
  // Efectivo, que es el que más entra en un local de mostrador.
  { items: [['A-0001', '2']], pagos: [['EFECTIVO', 'ARS', '9000']] },
  { items: [['A-0007', '1']], pagos: [['EFECTIVO', 'ARS', '990']] },
  { items: [['A-0002', '3']], pagos: [['EFECTIVO', 'ARS', '26700']] },
  { items: [['A-0006', '1']], pagos: [['EFECTIVO', 'ARS', '185000']] },
  { items: [['A-0003', '2']], pagos: [['EFECTIVO', 'ARS', '47500']] },
  // Crédito: el equipo caro, que es lo que se financia.
  { items: [['A-0004', '1']], pagos: [['TARJETA_CREDITO', 'ARS', '899999']] },
  { items: [['A-0005', '1']], pagos: [['TARJETA_CREDITO', 'ARS', '112500']] },
  // Transferencia.
  { items: [['A-0005', '1']], pagos: [['TRANSFERENCIA', 'ARS', '112500']] },
  { items: [['A-0003', '1']], pagos: [['TRANSFERENCIA', 'ARS', '23750']] },
  // Débito, el más chico de los cuatro.
  { items: [['A-0001', '1']], pagos: [['TARJETA_DEBITO', 'ARS', '4500']] },
  { items: [['A-0002', '1']], pagos: [['TARJETA_DEBITO', 'ARS', '8900']] },
  // Dólares: minoría, que es como se ve en un local real. Uno partido entre
  // pesos y dólares, que es el caso que el punto de venta soporta.
  // Los montos en dólares son redondos y los pesos cubren el resto: el total de
  // los pagos se compara por IGUALDAD contra el de los ítems, así que un
  // 620,69 × 1450 que da 900.000,50 contra un artículo de 899.999 no cierra.
  {
    items: [['A-0004', '1']],
    pagos: [
      ['EFECTIVO', 'USD', '500'],
      ['EFECTIVO', 'ARS', '174999'],
    ],
  },
  {
    items: [['A-0006', '1']],
    pagos: [
      ['EFECTIVO', 'USD', '100'],
      ['EFECTIVO', 'ARS', '40000'],
    ],
  },
  {
    items: [['A-0005', '1']],
    pagos: [
      ['TRANSFERENCIA', 'USD', '50'],
      ['TRANSFERENCIA', 'ARS', '40000'],
    ],
  },
]

for (const receta of RECETAS) {
  const { numero } = await crearVenta({
    tenantId,
    usuarioId,
    items: receta.items.map(([sku, cantidad]) => ({
      articuloId: porSku(sku),
      cantidad: d(cantidad),
    })),
    pagos: receta.pagos.map(([medio, moneda, monto]) => ({
      medio,
      moneda,
      monto: d(monto),
      cotizacion: moneda === 'USD' ? COTIZACION : d('1'),
    })),
  })
  console.log(`venta #${numero}`)
}

await prisma.$disconnect()
