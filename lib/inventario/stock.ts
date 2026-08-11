import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { excedeEscala, ESCALA_CANTIDAD, ESCALA_DINERO } from '@/lib/ventas/totales'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { traducirErrorDeBase } from '@/lib/ventas/errores'
import { ErrorDeInventario } from './errores'

type Decimal = Prisma.Decimal

/**
 * El artículo, validado para mover stock.
 *
 * Devuelve la fila porque `corregirStock` necesita el stock del momento y
 * leerlo dos veces sería pedirle a Postgres lo mismo con el lock ya tomado.
 *
 * Exportado a nivel de módulo y no público: la Task 4 (`articulos.ts`) escribe
 * su propio camino de alta, que crea el artículo y no lo busca.
 */
async function exigirArticuloConStock(tx: ClienteTx, articuloId: string) {
  const articulo = await tx.articulo.findUnique({ where: { id: articuloId } })
  if (!articulo) {
    throw new ErrorDeInventario(
      'ARTICULO_INEXISTENTE',
      `el artículo ${articuloId} no existe en este tenant`,
    )
  }
  // Un servicio no tiene stock: `lib/ventas/crear.ts` filtra por `esProducto`
  // y no le genera movimientos al venderlo. Darle stock por otra vía crearía
  // un número que después nadie descuenta nunca.
  if (articulo.tipo === 'SERVICIO') {
    throw new ErrorDeInventario(
      'SERVICIO_SIN_STOCK',
      `${articulo.nombre} es un servicio y no lleva stock`,
    )
  }
  return articulo
}

/**
 * Las dos escrituras que todo movimiento hace, juntas y en el mismo orden.
 *
 * Recibe el cliente transaccional en vez de abrir la transacción: es lo que
 * permite que `corregirStock` lea el stock y escriba el movimiento adentro de
 * la misma, que es de donde sale que el delta se calcule contra el número real
 * y no contra el que la pantalla dibujó hace un minuto.
 *
 * El UPDATE es RELATIVO (`increment`) y no absoluto, incluso cuando el llamador
 * conoce el valor final: `SET stock = stock + $1` deja que dos movimientos
 * simultáneos del mismo artículo no se pisen. Un `SET stock = $contado`
 * perdería la venta que haya comiteado en el medio.
 */
async function aplicarMovimiento(
  tx: ClienteTx,
  datos: {
    tenantId: string
    articuloId: string
    delta: Decimal
    motivo: 'AJUSTE' | 'INGRESO'
    usuarioId: string
    nota?: string
    costoUnitario?: Decimal | null
  },
): Promise<void> {
  await tx.movimientoStock.create({
    data: {
      tenantId: datos.tenantId,
      articuloId: datos.articuloId,
      delta: datos.delta,
      motivo: datos.motivo,
      usuarioId: datos.usuarioId,
      nota: datos.nota,
      costoUnitario: datos.costoUnitario ?? null,
    },
  })
  await tx.articulo.update({
    where: { id: datos.articuloId },
    data: { stock: { increment: datos.delta } },
  })
}

/** El costo tiene que ser un número que la columna pueda guardar, o nada. */
function validarCosto(costoUnitario: Decimal | null | undefined): void {
  if (costoUnitario === null || costoUnitario === undefined) return
  if (costoUnitario.lessThan(0)) {
    throw new ErrorDeInventario('COSTO_INVALIDO', 'el costo no puede ser negativo')
  }
  if (excedeEscala(costoUnitario, ESCALA_DINERO)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el costo tiene a lo sumo ${ESCALA_DINERO} decimales`,
    )
  }
}

/**
 * El movimiento crudo, con su delta y su motivo. Mudada desde
 * `lib/ventas/anular.ts`, donde había quedado por ser la misma task que la
 * escribió — no tiene nada que ver con anular una venta.
 *
 * Sigue pública porque es la vía de escape para un movimiento que las dos
 * funciones de arriba no modelan.
 */
export async function ajustarStock(entrada: {
  tenantId: string
  articuloId: string
  delta: Decimal
  motivo: 'AJUSTE' | 'INGRESO'
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, delta, motivo, usuarioId, nota } = entrada

  // El tipo de `motivo` sólo protege a los llamadores tipados. Uno que venga de
  // un body JSON ya parseado pasa 'VENTA' sin que TypeScript se entere, y crea
  // un movimiento con motivo VENTA y `ventaId` null: eso rompe la invariante
  // sobre la que está construido el filtro de `anularVenta`
  // (`{ ventaId, motivo: 'VENTA' }`), que da por hecho que todo movimiento
  // VENTA pertenece a una venta.
  if (motivo !== 'AJUSTE' && motivo !== 'INGRESO') {
    throw new ErrorDeInventario(
      'MOTIVO_INVALIDO',
      `ajustarStock sólo acepta AJUSTE o INGRESO, no ${motivo}`,
    )
  }
  if (excedeEscala(delta, ESCALA_CANTIDAD)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el delta tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
    )
  }

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      await exigirArticuloConStock(tx, articuloId)
      await aplicarMovimiento(tx, { tenantId, articuloId, delta, motivo, usuarioId, nota })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

/** Recibir mercadería. Es el único camino que escribe `costoUnitario`. */
export async function ingresarStock(entrada: {
  tenantId: string
  articuloId: string
  cantidad: Decimal
  usuarioId: string
  costoUnitario?: Decimal | null
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, cantidad, usuarioId, costoUnitario, nota } = entrada

  if (cantidad.lessThanOrEqualTo(0)) {
    throw new ErrorDeInventario(
      'CANTIDAD_INVALIDA',
      'la cantidad que ingresa tiene que ser mayor que cero',
    )
  }
  if (excedeEscala(cantidad, ESCALA_CANTIDAD)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `la cantidad tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
    )
  }
  validarCosto(costoUnitario)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      await exigirArticuloConStock(tx, articuloId)
      await aplicarMovimiento(tx, {
        tenantId, articuloId, delta: cantidad, motivo: 'INGRESO', usuarioId, nota, costoUnitario,
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

/**
 * El recuento: la persona dice cuánto hay, no cuánto falta.
 *
 * El delta se calcula ADENTRO de la transacción. Pedirle el delta al llamador
 * obligaría a leer el stock en la pantalla y restarlo en el navegador, y entre
 * que la pantalla se dibuja y alguien aprieta el botón puede haber pasado una
 * venta: la corrección se calcularía contra un número viejo y dejaría el
 * inventario peor de como estaba.
 */
export async function corregirStock(entrada: {
  tenantId: string
  articuloId: string
  stockContado: Decimal
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, stockContado, usuarioId, nota } = entrada

  if (stockContado.lessThan(0)) {
    throw new ErrorDeInventario(
      'CANTIDAD_INVALIDA',
      'no se pueden contar menos de cero unidades',
    )
  }
  if (excedeEscala(stockContado, ESCALA_CANTIDAD)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el conteo tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
    )
  }

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      const articulo = await exigirArticuloConStock(tx, articuloId)

      const delta = stockContado.minus(articulo.stock)
      // Un conteo que confirma lo que ya había no es un evento del inventario.
      // Escribir un movimiento de delta cero ensuciaría el historial que este
      // ciclo construye justamente para poder leerlo.
      if (delta.isZero()) return

      await aplicarMovimiento(tx, {
        tenantId, articuloId, delta, motivo: 'AJUSTE', usuarioId, nota,
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
