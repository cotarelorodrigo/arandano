import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeInventario, traducirErrorDeBase } from './errores'

export type UnidadLibre = { id: string; imei: string | null; ingresadaEn: Date }

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

/**
 * Crea las unidades dentro de una transacción ya abierta. La usan los tres
 * escritores: `ingresarStock`, `crearArticulo` y `prenderSerie` acá abajo —
 * todos tienen que escribir el movimiento, el stock y las unidades juntos o no
 * escribir nada.
 *
 * **El choque contra el índice parcial `unidades_articulo_imei_libre` se
 * traduce ACÁ, y no en `traducirErrorDeBase`.** Es el único lugar del motor que
 * sabe que el `P2002` habla de un IMEI: `traducirErrorDeBase` lo recibe sin
 * ningún contexto —bajo `arandano_app` Postgres retiene el `DETAIL` del error,
 * así que no hay `fields` que mirar (ver `esSkuRepetido` en articulos.ts)— y no
 * podría distinguirlo del choque del SKU. Esa ambigüedad no es teórica: es
 * exactamente la que hacía que un IMEI repetido en el alta saliera como "el
 * código A-0007 ya está usado".
 *
 * Sin esta traducción, escanear un equipo que ya está en la vitrina devolvía
 * un `PrismaClientKnownRequestError` crudo, que `traducir()`
 * (app/(app)/inventario/acciones.ts) relanza por no ser un `ErrorDeInventario`:
 * el mostrador veía el error boundary de Next en vez de un cartel.
 *
 * El IMEI concreto se averigua ANTES del insert y no después, y no es una
 * preferencia: una violación de unicidad ABORTA la transacción en Postgres, así
 * que en el `catch` ya no se puede consultar nada —el mismo hallazgo que
 * documenta `lib/ventas/crear.ts`—. El `catch` sólo relanza. La consulta previa
 * es el camino rápido del caso común (el equipo YA estaba cargado cuando se
 * escaneó) y el índice sigue siendo la defensa real de la carrera exacta (dos
 * cajas cargando el mismo IMEI a la vez), igual que con la idempotencia del
 * cobro.
 *
 * `imeis` acepta `null` por elemento: es lo que usa `prenderSerie` para crear
 * unidades SIN identificar. Un `null` nunca puede "estar repetido" —en
 * Postgres los `NULL` no chocan entre sí, ver el índice parcial— así que el
 * chequeo previo se hace sólo contra los IMEI reales de la lista: el cliente
 * de Prisma ni siquiera acepta un `null` dentro de un filtro `in` (lo rechaza
 * en la capa de validación, antes de llegar a la base), y da igual, porque un
 * `null` nunca podría chocar contra nada.
 */
export async function crearUnidadesEnTx(
  tx: ClienteTx,
  datos: { tenantId: string; articuloId: string; imeis: (string | null)[]; usuarioId: string },
): Promise<void> {
  const imeisReales = datos.imeis.filter((imei): imei is string => imei !== null)

  // SIN filtrar por `articuloId`, a propósito: el índice parcial es por
  // `(tenant_id, imei)`, así que el mismo IMEI libre colgado de OTRO artículo
  // choca igual — y ése es justo el caso que más confunde si el mensaje no lo
  // nombra.
  //
  // Con la lista vacía (todo `null`, el caso de `prenderSerie` sin IMEIs) ni
  // siquiera hace falta consultar: no hay ningún IMEI real que pueda chocar.
  const yaLibres = imeisReales.length === 0 ? [] : await tx.unidadDeArticulo.findMany({
    where: { imei: { in: imeisReales }, ventaId: null, bajaEn: null },
    select: { imei: true },
  })
  if (yaLibres.length > 0) {
    const repetidos = yaLibres.map((u) => u.imei)
    throw new ErrorDeInventario(
      'IMEI_REPETIDO',
      repetidos.length === 1
        ? `el IMEI ${repetidos[0]} ya está en el stock: si es otro equipo revisá el número, y ` +
          'si es el mismo ya lo tenés cargado'
        : `estos IMEI ya están en el stock: ${repetidos.join(', ')}. Sacalos de la lista o ` +
          'revisá los números',
    )
  }

  try {
    await tx.unidadDeArticulo.createMany({
      data: datos.imeis.map((imei) => ({
        tenantId: datos.tenantId,
        articuloId: datos.articuloId,
        imei,
        ingresadaPorId: datos.usuarioId,
      })),
    })
  } catch (e) {
    // Acá sólo puede llegar la carrera: el chequeo de arriba no lo vio porque
    // la otra caja todavía no había comiteado. No se puede decir CUÁL IMEI es
    // —la transacción está abortada y no admite una consulta más—, así que el
    // mensaje dice lo que sí es cierto y qué hacer.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ErrorDeInventario(
        'IMEI_REPETIDO',
        'alguno de esos IMEI se acaba de cargar desde otra pantalla: recargá y revisá cuáles ' +
          'faltan',
      )
    }
    throw e
  }
}

export async function prenderSerie(entrada: {
  tenantId: string
  articuloId: string
  usuarioId: string
}): Promise<void> {
  const { tenantId, articuloId, usuarioId } = entrada

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

      // Ya NO se pide ningún IMEI acá: el principio de este ciclo es que se
      // capturan cuando el equipo está en la mano, no antes. Prender crea
      // `stock - libresExistentes` unidades SIN identificar y listo.
      //
      // Cómo puede existir una unidad libre en un artículo cuyo switch está
      // APAGADO, que es lo que suena imposible: `apagarSerie` sólo mira las
      // LIBRES, y una unidad atada a una venta viva no lo es. Vendidas todas
      // —libres 0, stock 0—, el switch se apaga sin protestar; si después el
      // cliente devuelve el equipo y se anula la venta, `anularVenta` la
      // devuelve a la vitrina (`ventaId = null`) y sube el stock. El artículo
      // queda sin serie y con una unidad libre (hallazgo C1 de la review de
      // rama del ciclo anterior). Contarla acá es lo que evita crear una
      // segunda fila para el mismo equipo.
      //
      // Si `stock < libresExistentes` —el mismo estado huérfano, pero con el
      // stock bajado por una vía que no es serie mientras tanto— no hay
      // ninguna cantidad no negativa que crear: se rechaza, y la salida es dar
      // de baja las unidades sobrantes desde la card, que ahora se muestra
      // aunque el switch esté apagado.
      const libresExistentes = await tx.unidadDeArticulo.count({
        where: { articuloId, ventaId: null, bajaEn: null },
      })
      const faltan = stock.minus(libresExistentes)
      if (faltan.lessThan(0)) {
        throw new ErrorDeInventario(
          'SERIE_CONTEO_NO_COINCIDE',
          `${articulo.nombre} tiene ${libresExistentes} unidades cargadas y sólo ` +
            `${stock} en stock: da de baja las que sobran antes de manejarlo por IMEI`,
        )
      }

      await crearUnidadesEnTx(tx, {
        tenantId, articuloId, usuarioId,
        imeis: Array.from({ length: faltan.toNumber() }, () => null),
      })
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

/**
 * Carga o CORRIGE el IMEI de una unidad libre — el otro camino de captura,
 * oportunista: se completa cuando el equipo aparece, no antes.
 *
 * Sólo mientras esté LIBRE. Una vez vendida o dada de baja el IMEI queda
 * congelado, por lo mismo que `VentaItem` congela descripción y precio: la
 * venta de marzo tiene que seguir diciendo qué equipo salió, aunque alguien
 * corrija un typo en otro lado después.
 *
 * La condición va DENTRO del `updateMany` y no en un `if` sobre un
 * `findUnique`: leer y después decidir deja una ventana entre las dos
 * sentencias, y bajo READ COMMITTED la unidad se puede vender en el medio.
 * Mismo recurso que `darDeBajaUnidad`.
 *
 * **El choque contra el índice** al escribir un IMEI que ya tiene otra unidad
 * libre sale como `P2002` desde este mismo `updateMany`, así que necesita su
 * propia traducción a `IMEI_REPETIDO` — la de `crearUnidadesEnTx` no lo cubre,
 * porque esta función no pasa por ahí. El `catch` sólo relanza, nunca
 * consulta: la violación aborta la transacción, igual que documenta
 * `crearUnidadesEnTx` acá arriba.
 */
export async function identificarUnidad(entrada: {
  tenantId: string
  unidadId: string
  imei: string
  usuarioId: string
}): Promise<void> {
  const { tenantId, unidadId, usuarioId } = entrada
  const imei = normalizarImei(entrada.imei)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)

      const tocadas = await tx.unidadDeArticulo.updateMany({
        where: { id: unidadId, ventaId: null, bajaEn: null },
        data: { imei },
      })
      if (tocadas.count !== 1) {
        const existe = await tx.unidadDeArticulo.findUnique({ where: { id: unidadId } })
        if (!existe) {
          throw new ErrorDeInventario(
            'UNIDAD_INEXISTENTE',
            `la unidad ${unidadId} no existe en este tenant`,
          )
        }
        throw new ErrorDeInventario(
          'UNIDAD_NO_DISPONIBLE',
          'ese equipo ya salió del stock: su IMEI no se puede cambiar',
        )
      }
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ErrorDeInventario(
        'IMEI_REPETIDO',
        `el IMEI ${imei} ya está en el stock: si es otro equipo revisá el número, y si es el ` +
          'mismo ya lo tenés cargado',
      )
    }
    throw traducirErrorDeBase(e)
  }
}
