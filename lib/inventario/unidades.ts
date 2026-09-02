import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeInventario, traducirErrorDeBase } from './errores'

export type UnidadLibre = { id: string; imei: string; ingresadaEn: Date }

/**
 * El IMEI tal como se guarda.
 *
 * Recorta los bordes y colapsa los espacios internos —un lector de código de
 * barras los mete, y "3551 2345" y "35512345" son el mismo equipo—, y no valida
 * NADA más. En particular NO exige quince dígitos: el mismo campo es el número
 * de serie de una notebook o de un electrodoméstico, que es la generalización
 * que el pedido original nombra. Validar la forma del IMEI cerraría esa puerta
 * a cambio de atajar un error de tipeo que el propio dueño ve al mirar la lista.
 */
export function normalizarImei(crudo: string): string {
  const limpio = crudo.trim().replace(/\s+/g, '')
  if (limpio === '') {
    throw new ErrorDeInventario('IMEI_VACIO', 'el IMEI no puede estar vacío')
  }
  return limpio
}

/** Normaliza la lista entera y rechaza repetidos DENTRO de ella. Exportada
 *  porque la usan los tres escritores de unidades: `prenderSerie` acá,
 *  `ingresarStock` (Task 3) y `crearArticulo` (Task 7). El índice
 *  parcial de la base atrapa el choque contra lo que ya está cargado; esto
 *  atrapa el que ni siquiera llega a la base, que es el más común: la misma
 *  caja escaneada dos veces. */
export function normalizarLista(imeis: string[]): string[] {
  const normalizados = imeis.map(normalizarImei)
  const vistos = new Set<string>()
  for (const i of normalizados) {
    if (vistos.has(i)) {
      throw new ErrorDeInventario('IMEI_REPETIDO', `el IMEI ${i} está dos veces en la lista`)
    }
    vistos.add(i)
  }
  return normalizados
}

/** El artículo, validado para llevar unidades. Interna, como su gemela de
 *  stock.ts: un servicio no tiene stock y por lo tanto no tiene unidades. */
async function exigirArticuloConUnidades(tx: ClienteTx, articuloId: string) {
  const articulo = await tx.articulo.findUnique({ where: { id: articuloId } })
  if (!articulo) {
    throw new ErrorDeInventario(
      'ARTICULO_INEXISTENTE',
      `el artículo ${articuloId} no existe en este tenant`,
    )
  }
  if (articulo.tipo === 'SERVICIO') {
    throw new ErrorDeInventario(
      'SERVICIO_SIN_STOCK',
      `${articulo.nombre} es un servicio y no lleva unidades`,
    )
  }
  return articulo
}

export async function unidadesLibres(
  tenantId: string,
  articuloId: string,
): Promise<UnidadLibre[]> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const filas = await tx.unidadDeArticulo.findMany({
      where: { articuloId, ventaId: null, bajaEn: null },
      // Más vieja primero: en un mostrador se vende lo que entró antes. Pero
      // `ingresadaEn` sale de `CURRENT_TIMESTAMP`, que en Postgres es la hora
      // de INICIO de la transacción — así que toda la tanda que crea
      // `crearUnidadesEnTx` (todas las unidades de un mismo `prenderSerie` o
      // `ingresarStock`) comparte el mismo valor exacto, y sin desempate el
      // orden entre ellas queda librado a lo que el heap scan devuelva. `id`
      // como segundo criterio lo resuelve de verdad: es `uuid(7)`, que
      // incorpora un timestamp en milisegundos más un contador monótono, así
      // que ordena por `id` dentro del empate es ordenar por el momento real
      // de inserción de cada fila, no por azar.
      orderBy: [{ ingresadaEn: 'asc' }, { id: 'asc' }],
      select: { id: true, imei: true, ingresadaEn: true },
    })
    return filas
  })
}

/** Crea las unidades dentro de una transacción ya abierta. La usa
 *  `ingresarStock`, que tiene que escribir el movimiento y las unidades juntos
 *  o no escribir nada. */
export async function crearUnidadesEnTx(
  tx: ClienteTx,
  datos: { tenantId: string; articuloId: string; imeis: string[]; usuarioId: string },
): Promise<void> {
  await tx.unidadDeArticulo.createMany({
    data: datos.imeis.map((imei) => ({
      tenantId: datos.tenantId,
      articuloId: datos.articuloId,
      imei,
      ingresadaPorId: datos.usuarioId,
    })),
  })
}

export async function prenderSerie(entrada: {
  tenantId: string
  articuloId: string
  imeis: string[]
  usuarioId: string
}): Promise<void> {
  const { tenantId, articuloId, usuarioId } = entrada
  const imeis = normalizarLista(entrada.imeis)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      const articulo = await exigirArticuloConUnidades(tx, articuloId)

      if (articulo.llevaSerie) {
        throw new ErrorDeInventario(
          'SERIE_YA_PRENDIDA',
          `${articulo.nombre} ya se maneja por IMEI`,
        )
      }

      // El stock se lee ADENTRO de la transacción, no se recibe del llamador:
      // entre que la pantalla se dibuja y alguien aprieta el botón puede haber
      // pasado una venta, y validar contra el número viejo dejaría el artículo
      // prendido con una unidad de menos. Es el mismo cuidado que ya tiene
      // `corregirStock`.
      const stock = articulo.stock
      if (stock.lessThan(0) || !stock.equals(stock.toDecimalPlaces(0))) {
        throw new ErrorDeInventario(
          'SERIE_STOCK_NO_ENTERO',
          `${articulo.nombre} tiene ${stock} en stock: para manejarlo por IMEI el stock ` +
            'tiene que ser un número entero de unidades, y no negativo',
        )
      }
      if (!stock.equals(imeis.length)) {
        throw new ErrorDeInventario(
          'SERIE_CONTEO_NO_COINCIDE',
          `hay ${stock} en stock y llegaron ${imeis.length} IMEI: tienen que ser los mismos`,
        )
      }

      await crearUnidadesEnTx(tx, { tenantId, articuloId, imeis, usuarioId })
      await tx.articulo.update({ where: { id: articuloId }, data: { llevaSerie: true } })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

export async function apagarSerie(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  const { tenantId, articuloId } = entrada

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      const articulo = await exigirArticuloConUnidades(tx, articuloId)

      // Apagar con unidades libres significa convertir cinco identidades en un
      // número 5 y tirar los IMEI. Es pérdida silenciosa de datos, y el caso
      // real de arrepentirse —"lo prendí y todavía no cargué nada"— tiene el
      // stock en cero y pasa por acá sin problema.
      const libres = await tx.unidadDeArticulo.count({
        where: { articuloId, ventaId: null, bajaEn: null },
      })
      if (libres > 0) {
        throw new ErrorDeInventario(
          'SERIE_CON_UNIDADES_LIBRES',
          `${articulo.nombre} tiene ${libres} unidades cargadas: dalas de baja antes de ` +
            'dejar de manejarlo por IMEI',
        )
      }

      await tx.articulo.update({ where: { id: articuloId }, data: { llevaSerie: false } })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
