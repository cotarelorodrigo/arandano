import { Prisma, type Moneda } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { totalesDeItems, excedeEscala, subtotalItem, ESCALA_CANTIDAD } from './totales'
import { normalizarPagos, resolverPagosConRecargo, exigirQueCierren } from './pagos'
import type { PagoDeVenta } from './pagos'
import { exigirCliente, exigirUsuario } from './pertenencia'
import { crearClienteEn } from '@/lib/clientes/administrar'
import { ErrorDeCliente } from '@/lib/clientes/errores'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'
import { normalizarDetalle } from './detalle'
import { normalizarImei } from '@/lib/inventario/unidades'

export type ItemDeVenta = {
  articuloId: string
  cantidad: Prisma.Decimal
  /**
   * Qué unidad física sale, cuando el artículo se maneja por IMEI. Obligatorio
   * ahí y prohibido en el resto: un artículo sin serie que venga con unidadId
   * se RECHAZA en vez de ignorarse, por lo mismo que `ARTICULO_DESACTIVADO`
   * está separado de `ARTICULO_INEXISTENTE` — ignorar en silencio borra la
   * distinción que hace falta para diagnosticar.
   */
  unidadId?: string
  /**
   * El IMEI que quien cobra escaneó al vender una unidad sin identificar. Es
   * OPCIONAL a propósito: exigirlo convertiría cada venta en un trámite con el
   * cliente esperando, que es la fricción que este ciclo existe para sacar.
   * Sin él, la venta dice honestamente que no se sabe qué equipo salió.
   */
  imeiCapturado?: string
}
export type { PagoDeVenta } from './pagos'

export type EntradaCrearVenta = {
  tenantId: string
  // Por PARÁMETRO y no de una sesión: Auth.js todavía no existe, y esperar a
  // que exista frenaría este ciclo por algo que no cambia el diseño. Cuando
  // llegue el login, lo único que cambia es quién llama. Deuda explícita: hasta
  // entonces nada impide que un llamador pase el usuario de otro, y por eso la
  // UI no se construye antes que Auth.js.
  usuarioId: string
  // A lo sumo uno de los dos, y ninguno es lo normal: la mayoría de las ventas
  // de mostrador son a consumidor final, y el cobro no gana un paso
  // obligatorio. `clienteId` para el que ya está cargado; `clienteNuevo` para
  // el alta al vuelo del cobro (spec 2026-10-18-clientes-design.md, decisión
  // 6), que nace ADENTRO de la transacción de la venta —como el de la orden de
  // trabajo—, así que una venta que falla no deja un cliente huérfano.
  clienteId?: string
  clienteNuevo?: { nombre: string; telefono: string | null; aceptaOfertas: boolean }
  items: ItemDeVenta[]
  pagos: PagoDeVenta[]
  // Opcional: el motor no la inventa. Un llamador que no la manda acepta que
  // dos llamadas iguales creen dos ventas, que es lo correcto para un test o un
  // script; la pantalla sí la manda.
  claveIdempotencia?: string
  /**
   * Texto libre que el local anota sobre la venta. OPCIONAL a propósito, que es
   * lo contrario de lo que este repo decidió para `categoriaId` en
   * `editarArticulo`: allá el dato cruzaba dos pantallas y dos caminos de
   * lectura y olvidárselo fallaba en silencio; acá hay un solo escritor real
   * (`cobrar`) y decenas de llamadores de test y de seed a los que el campo no
   * les dice nada. Lo que cubre el hueco es un caso que va del FormData a la
   * fila (app/(app)/vender/acciones.test.ts).
   */
  detalle?: string
}

/**
 * El costo que una línea de venta congela, o NULL.
 *
 * Sólo pesos contra pesos: un ítem en pesos cuyo último costo también está en
 * pesos. Cualquier cruce de monedas —ítem en dólares, o último costo en
 * dólares— da NULL, porque `VentaItem.costoUnitario` es pesos y medir un costo
 * en dólares contra un precio en pesos (o al revés) exigiría una cotización.
 * Separada del `map` para que la regla se lea entera en un lugar.
 */
function costoEnPesosParaCongelar(
  monedaDelItem: Moneda,
  ultimo: { costoUnitario: Prisma.Decimal | null; monedaCosto: Moneda } | undefined,
): Prisma.Decimal | null {
  if (monedaDelItem !== 'ARS' || ultimo?.monedaCosto !== 'ARS') return null
  return ultimo.costoUnitario
}

export async function crearVenta(
  entrada: EntradaCrearVenta,
): Promise<{ id: string; numero: number }> {
  const { tenantId, usuarioId, clienteNuevo, items, pagos, claveIdempotencia, detalle } = entrada

  // Los dos a la vez es un llamador confundido —la pantalla manda uno u otro—,
  // y elegir uno en silencio sería adivinar a quién se le vendió.
  if (entrada.clienteId !== undefined && clienteNuevo !== undefined) {
    throw new ErrorDeVenta('CLIENTE_DOBLE', 'elegí un cliente o cargá uno nuevo, no los dos')
  }

  if (items.length === 0) {
    throw new ErrorDeVenta('SIN_ITEMS', 'una venta necesita al menos un ítem')
  }
  for (const i of items) {
    if (i.cantidad.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'CANTIDAD_INVALIDA',
        `la cantidad de ${i.articuloId} tiene que ser mayor que cero`,
      )
    }
    // ANTES de multiplicar, no después: `cantidad` se valida y se persiste en la
    // misma escala en que Postgres la guarda, así que el total que se calcula
    // acá es el que la fila va a explicar. Ver `excedeEscala` en totales.ts.
    if (excedeEscala(i.cantidad, ESCALA_CANTIDAD)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `la cantidad de ${i.articuloId} tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
      )
    }
  }
  // Normalizado ACÁ, antes de abrir la transacción, junto al resto de las
  // validaciones de dominio de los ítems, y alineado por ÍNDICE con `items`
  // (sin mutar la entrada del llamador: `items` es del llamador).
  //
  // Un valor vacío o sólo espacios NO es un error: es la AUSENCIA de
  // escaneo, y vale exactamente lo mismo que no mandar el campo. El
  // principio del ciclo es que el IMEI es opcional — quien cobra sin la caja
  // en la mano manda (o el formulario manda por él) un campo vacío, y ESE es
  // el caso por defecto, no uno malformado. Tratarlo como `IMEI_VACIO` sería
  // convertir el camino normal en un error, y además dejaría escapar un
  // `ErrorDeInventario` (el código de `normalizarImei`) por una función que
  // en todos los demás casos sólo tira `ErrorDeVenta` — que es justo lo que
  // `/vender` filtra en su `catch`.
  const imeisCapturados = items.map((i) => {
    if (i.imeiCapturado === undefined) return undefined
    const recortado = i.imeiCapturado.trim()
    if (recortado === '') return undefined
    return normalizarImei(i.imeiCapturado)
  })
  // Acá y no adentro de la transacción, por lo mismo que los IMEI de arriba:
  // es una regla de dominio sobre la entrada, no algo que dependa de nada que
  // la base tenga que decir. Y en el MOTOR y no en el server action, para que
  // cualquier llamador —pantalla, script, un módulo que llame a
  // `crearVentaDesde`— guarde el campo con la misma forma.
  const detalleGuardado = normalizarDetalle(detalle)
  // Un `imeiCapturado` SIN `unidadId` no tiene a qué unidad atarse: el bucle
  // que toma unidades más abajo saltea cualquier ítem sin `unidadId` (`if
  // (l.unidadId === undefined) continue`), así que sin este chequeo el
  // escaneo desaparecería en silencio, sin aviso — la misma familia de error
  // que "IMEI ya cargado en otra unidad": se rechaza en vez de ignorarse.
  items.forEach((i, idx) => {
    if (imeisCapturados[idx] !== undefined && i.unidadId === undefined) {
      throw new ErrorDeVenta(
        'UNIDAD_REQUERIDA',
        `capturaste un IMEI para el artículo ${i.articuloId} sin elegir la unidad: elegí qué ` +
          'equipo es',
      )
    }
  })
  // Dos líneas nombrando la misma unidad es malformado sin necesidad de
  // consultar nada: no hace falta la base para saber que el mismo equipo no
  // puede salir dos veces en el mismo carrito.
  //
  // `!== undefined` y no truthy: es la misma lectura que hace el guard de
  // `a.llevaSerie` más abajo, y las dos tienen que leer el campo IGUAL — con
  // truthy acá, un `unidadId: ''` se escapa de este chequeo y sin embargo
  // cuenta como "presente" para esa otra validación.
  const unidadesPedidas = items.flatMap((i) => (i.unidadId !== undefined ? [i.unidadId] : []))
  if (new Set(unidadesPedidas).size !== unidadesPedidas.length) {
    throw new ErrorDeVenta(
      'UNIDAD_REPETIDA',
      'el mismo equipo está dos veces en el carrito',
    )
  }
  // Mismo chequeo, ahora sobre el IMEI escaneado: dos ítems de unidades
  // DISTINTAS capturando el mismo IMEI son la misma clase de error que el
  // chequeo de arriba —el mismo equipo físico no puede salir dos veces—, sólo
  // que acá el duplicado se ve en el IMEI y no en el `unidadId`. Es un error
  // de carga (escanear la misma caja dos veces) y no necesita la base para
  // detectarse, así que va ACÁ, antes de la transacción, y no como un
  // `SELECT` más adelante. Reusa `UNIDAD_REPETIDA` y no un código nuevo: es
  // el mismo hecho de fondo —dos líneas del carrito reclamando el mismo
  // equipo— visto por el otro identificador.
  const imeisCapturadosPresentes = imeisCapturados.flatMap((im) => (im !== undefined ? [im] : []))
  if (new Set(imeisCapturadosPresentes).size !== imeisCapturadosPresentes.length) {
    throw new ErrorDeVenta(
      'UNIDAD_REPETIDA',
      'el mismo IMEI está dos veces en el carrito',
    )
  }
  const pagosNormalizados = normalizarPagos(pagos)

  try {
    return await enTransaccionDeTenant(tenantId, async (tx) => {
      // ANTES de tomar el correlativo y de tocar stock: si esta clave ya cobró,
      // no hay nada que hacer más que devolver lo que se hizo la primera vez.
      //
      // Adentro de la transacción, así que la lectura ve el estado consistente.
      // Dos submits simultáneos con la misma clave pueden pasar los dos por acá
      // sin encontrarse —la primera todavía no comiteó—, y por eso el índice
      // único de la base sigue siendo la defensa REAL: el segundo insert choca,
      // y el catch de afuera devuelve la venta del primero. Este chequeo es el
      // camino rápido del caso común (el doble click con medio segundo de
      // diferencia, o el F5 sobre el POST); el índice es el que cierra la
      // carrera exacta.
      if (claveIdempotencia !== undefined) {
        const yaExiste = await tx.venta.findFirst({
          where: { claveIdempotencia },
          select: { id: true, numero: true },
        })
        if (yaExiste) return yaExiste
      }

      // Las FKs hacia el cliente y el usuario, resueltas a mano: las de Postgres
      // no distinguen tenants. El porqué completo está en `pertenencia.ts`.
      //
      // El cliente nuevo nace acá: DESPUÉS del camino rápido de la
      // idempotencia —el doble click o el F5 sobre el POST devuelven la venta
      // de la primera vez sin crear un segundo cliente— y ANTES de
      // `proximoNumero`, que toma la fila del tenant (ver el orden de los
      // locks en `bloquearClave`, lib/clientes/administrar.ts). Si algo de lo
      // que sigue falla —stock, pagos que no cierran, un teléfono repetido—,
      // el rollback se lo lleva junto con la venta. Un `ErrorDeCliente` sale
      // tal cual: `cobrar` lo muestra.
      let clienteId = entrada.clienteId
      if (clienteNuevo !== undefined) {
        clienteId = (await crearClienteEn(tx, { tenantId, ...clienteNuevo })).id
      } else if (clienteId !== undefined) {
        await exigirCliente(tx, clienteId)
      }
      await exigirUsuario(tx, usuarioId)

      const pagosConRecargo = await resolverPagosConRecargo(tx, pagosNormalizados)

      const articulos = await tx.articulo.findMany({
        where: { id: { in: items.map((i) => i.articuloId) } },
      })
      const porId = new Map(articulos.map((a) => [a.id, a]))

      // El último costo conocido de cada artículo, para congelarlo en el ítem.
      //
      // `distinct` sobre `articuloId` con `orderBy` descendente devuelve la fila más
      // reciente de cada artículo en UNA consulta, sin un query por ítem.
      // `{ articuloId: 'asc' }` va primero porque `distinct` compila a
      // `DISTINCT ON`, que exige que la clave líder del orden sea la misma que
      // la del distinct.
      //
      // Desempate por `id` (`uuid(7)`, ordenable por tiempo): dos ingresos de
      // la misma transacción —o de la misma corrida de un seed/import— pueden
      // compartir `creadoEn` hasta el milisegundo, y sin el tercer campo
      // `DISTINCT ON` elige entre ellos de forma arbitraria. Mismo desempate
      // que la consulta del tile "Último costo" de
      // app/(app)/inventario/[id]/page.tsx — el filtro acá es más estricto,
      // porque además exige `motivo: 'INGRESO'`; hoy da lo mismo porque nada
      // más escribe `costoUnitario`, pero no es la misma consulta.
      //
      // El filtro es `costoUnitario: { not: null }` y no "el ingreso más reciente":
      // un ingreso cargado sin costo no borra lo que se sabía del anterior.
      //
      // Y NO filtra por `monedaCosto`, a propósito: el último costo es el que
      // vale hoy sea cual sea su moneda (ciclo del costo en dólares,
      // 2026-10-18). Filtrar por pesos haría que un artículo que se empezó a
      // comprar en dólares congele en cada venta un costo en pesos viejo, de
      // un precio de compra que ya no existe. Lo que se descarta por moneda se
      // descarta abajo, al armar la línea.
      const ultimosCostos = await tx.movimientoStock.findMany({
        where: {
          articuloId: { in: items.map((i) => i.articuloId) },
          motivo: 'INGRESO',
          costoUnitario: { not: null },
        },
        orderBy: [{ articuloId: 'asc' }, { creadoEn: 'desc' }, { id: 'desc' }],
        distinct: ['articuloId'],
        select: { articuloId: true, costoUnitario: true, monedaCosto: true },
      })
      const costoPorArticulo = new Map(ultimosCostos.map((m) => [m.articuloId, m]))

      // Congelar precio y descripción ACÁ. El artículo puede renombrarse o cambiar
      // de precio mañana; esta venta tiene que seguir diciendo lo de hoy.
      const lineas = items.map((i, idx) => {
        const a = porId.get(i.articuloId)
        if (!a) {
          throw new ErrorDeVenta(
            'ARTICULO_INEXISTENTE',
            `el artículo ${i.articuloId} no existe en este tenant`,
          )
        }
        // NO se filtra en el `where` del findMany de arriba, a propósito:
        // filtrar haría que el artículo desactivado simplemente no aparezca, y
        // el guard de `!a` lo reportaría como ARTICULO_INEXISTENTE — borrando
        // justo la distinción que este código existe para hacer.
        if (a.desactivadoEn) {
          throw new ErrorDeVenta(
            'ARTICULO_DESACTIVADO',
            `${a.nombre} está desactivado y no se puede vender`,
          )
        }
        if (a.llevaSerie) {
          if (i.unidadId === undefined) {
            throw new ErrorDeVenta(
              'UNIDAD_REQUERIDA',
              `${a.nombre} se vende por unidad: elegí cuál equipo sale`,
            )
          }
          if (!i.cantidad.equals(1)) {
            throw new ErrorDeVenta(
              'CANTIDAD_CON_SERIE',
              `${a.nombre} se vende de a una unidad: dos equipos son dos líneas`,
            )
          }
        } else if (i.unidadId !== undefined) {
          throw new ErrorDeVenta(
            'UNIDAD_NO_CORRESPONDE',
            `${a.nombre} no se maneja por IMEI`,
          )
        }
        return {
          articuloId: a.id,
          descripcion: a.nombre,
          cantidad: i.cantidad,
          precioUnitario: a.precio,
          moneda: a.moneda,
          esProducto: a.tipo === 'PRODUCTO',
          // Se congela sólo un costo en pesos para un ítem en pesos:
          // `VentaItem.costoUnitario` es pesos y alimenta `costoArs`, el margen
          // en pesos del dashboard. NULL para un ítem en dólares (el margen en
          // dólares quedó para otro ciclo, decisión 5 del spec del costo en
          // dólares) y NULL para un ítem en pesos cuyo último costo está en
          // dólares — sin esto, US$ 8 entrarían al margen como $ 8. Nada se
          // convierte: no hay una cotización guardada en la que confiar.
          costoUnitario: costoEnPesosParaCongelar(a.moneda, costoPorArticulo.get(a.id)),
          unidadId: i.unidadId,
          imeiCapturado: imeisCapturados[idx],
        }
      })

      const totales = totalesDeItems(lineas)
      // Las DOS columnas cubren exactamente los mismos ítems, y por eso se calculan
      // en el mismo reduce: el margen del período divide una contra la otra, así que
      // un ítem que entrara en una y no en la otra sesgaría el porcentaje sin que
      // nada lo dijera.
      const conCosto = lineas.reduce(
        (acc, l) =>
          l.costoUnitario === null
            ? acc
            : {
                costo: acc.costo.add(subtotalItem(l.cantidad, l.costoUnitario)),
                vendido: acc.vendido.add(subtotalItem(l.cantidad, l.precioUnitario)),
              },
        { costo: new Prisma.Decimal(0), vendido: new Prisma.Decimal(0) },
      )
      exigirQueCierren(pagosConRecargo, totales)
      const recargoTotal = pagosConRecargo.reduce(
        (acc, p) => acc.add(p.recargo),
        new Prisma.Decimal(0),
      )

      // TODO lo que se puede validar ya se validó: `proximoNumero` toma el lock
      // de la fila del tenant y lo retiene hasta el commit, o sea que serializa
      // todas las ventas de ese negocio. Cada consulta que se haga después es
      // tiempo que la otra caja pasa esperando, así que va lo más tarde posible.
      const numero = await proximoNumero(tx, tenantId)

      const venta = await tx.venta.create({
        data: {
          tenantId,
          numero,
          clienteId,
          usuarioId,
          claveIdempotencia,
          detalle: detalleGuardado,
          total: totales.ars,
          // La mercadería EN DÓLARES, a precio de lista. `total` es la mitad
          // en pesos de lo mismo, y ninguna venta anterior a este ciclo pasa a
          // decir otra cosa: sin ítems en dólares, `totales.usd` da cero.
          totalUsd: totales.usd,
          // La suma de los recargos de los pagos. `total` sigue siendo la
          // mercadería a precio de lista: son dos números distintos y este
          // ciclo existe justamente para no confundirlos.
          recargo: recargoTotal,
          // Caché de los ítems que SÍ tenían costo, calculado arriba en el mismo
          // reduce que `vendidoConCosto` — las dos cubren exactamente los mismos
          // ítems.
          costoArs: conCosto.costo,
          vendidoConCosto: conCosto.vendido,
          items: {
            create: lineas.map((l) => ({
              tenantId,
              articuloId: l.articuloId,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              moneda: l.moneda,
              costoUnitario: l.costoUnitario,
            })),
          },
          // Campo por campo, igual que los ítems dos líneas arriba: un
          // `...p` dejaría pasar cualquier propiedad de más que traiga un body
          // JSON ya parseado, y Prisma la rechaza con `PrismaClientValidationError`
          // —un 500 sin `codigo`— en vez del `ErrorDeVenta` que el resto de esta
          // función usa para todo lo demás.
          pagos: {
            create: pagosConRecargo.map((p) => ({
              tenantId,
              medio: p.medio,
              moneda: p.moneda,
              cubre: p.cubre,
              monto: p.monto,
              cotizacion: p.cotizacion,
              planDePagoId: p.planId,
              porcentaje: p.porcentaje,
              recargo: p.recargo,
            })),
          },
        },
      })

      // Ordenado por `articuloId`, igual que el `findMany` de `anularVenta`: el
      // `update` de abajo toma el lock de la fila del artículo, y dos
      // transacciones que tomen los mismos locks en orden distinto se
      // deadlockean (`40P01`), que sale como error crudo de Prisma. Un orden
      // total y común a todo el motor es lo que lo hace imposible. Los ítems de
      // la venta NO se reordenan: el ticket conserva el orden en que se
      // cargaron, y los `INSERT` de `venta_items` sólo toman locks compartidos
      // (`FOR KEY SHARE`), que no se bloquean entre sí.
      // Ordenado por articuloId y, en el empate, por unidadId: con serie un
      // carrito puede traer VARIAS líneas del MISMO artículo —CANTIDAD_CON_SERIE
      // lo fuerza: dos equipos son dos líneas—, así que el empate en articuloId
      // por sí solo dejaría el orden entre esas líneas librado al orden del
      // carrito. El desempate por unidadId es lo que hace que el orden sea
      // total de verdad y no dependa de en qué renglón se cargó cada equipo.
      const paraStock = lineas
        .filter((l) => l.esProducto)
        .sort((a, b) => {
          if (a.articuloId !== b.articuloId) return a.articuloId < b.articuloId ? -1 : 1
          const ua = a.unidadId ?? ''
          const ub = b.unidadId ?? ''
          return ua < ub ? -1 : ua > ub ? 1 : 0
        })

      // PRIMERO todas las unidades, DESPUÉS todos los artículos. Los dos
      // bucles recorren `paraStock` en el MISMO orden total; lo que los separa
      // es el orden en que se toman los dos TIPOS de lock, y ahí estaba el
      // deadlock.
      //
      // Con las dos escrituras entrelazadas —unidad, artículo, unidad,
      // artículo— dos líneas del mismo artículo (que `CANTIDAD_CON_SERIE`
      // vuelve obligatorias: dos teléfonos son dos líneas) tomaban `u1, A, u2,
      // A`, mientras `darDeBajaUnidad` (lib/inventario/stock.ts) toma `u2, A`.
      // Interleavadas: la venta tiene `u1` y `A` y espera `u2`; la baja tiene
      // `u2` y espera `A`. Ciclo, `40P01`, y sale como error crudo de Prisma
      // con la venta caída en el mostrador. Y `darDeBajaUnidad` es justamente
      // el escritor que NO pasa por `proximoNumero`, así que no hay ningún
      // lock de tenant que los serialice antes — es el que el comentario de
      // abajo nombra como la amenaza real.
      //
      // Tomando todas las unidades antes que cualquier artículo, el ciclo no
      // se puede formar: quien tenga las unidades avanza hasta el commit, y
      // quien no las tenga se lleva `count === 0` y se rechaza entero.
      for (const l of paraStock) {
        // La unidad se TOMA con un UPDATE condicional, no se lee y después se
        // escribe — pero OJO con contra quién: dos `crearVenta` del MISMO
        // tenant no son la amenaza. `proximoNumero`, más arriba, ya tomó el
        // lock exclusivo de la fila del tenant y lo retiene hasta el commit,
        // así que dos ventas de este negocio están serializadas ANTES de
        // llegar acá — la segunda, bajo READ COMMITTED, ve el estado ya
        // comiteado de la primera en cuanto reanuda.
        //
        // Lo que el UPDATE condicional defiende de verdad es un escritor que
        // NO pasa por `proximoNumero` y por lo tanto no toma ese lock:
        // `darDeBajaUnidad` (lib/inventario/stock.ts), que es el otro que
        // compite por una unidad LIBRE. Frente a él sí puede pasar que las dos
        // transacciones lean la misma unidad como libre sin que ninguna haya
        // comiteado todavía, y ahí sólo cierra que el WHERE se evalúe en el
        // momento de ESCRIBIR: la que pierde se lleva cero filas y su
        // operación entera se rechaza.
        //
        // `anularVenta` no está en esa lista, aunque tampoco tome el lock del
        // tenant: se mueve en la dirección contraria —libera unidades ya
        // VENDIDAS—, así que nunca disputa la misma fila que este UPDATE, que
        // sólo mira las libres.
        //
        // `paraStock` ya viene ordenado por articuloId con unidadId de
        // desempate (arriba), y con serie hay una línea por unidad, así que
        // los locks de unidad se toman en un orden derivado del mismo orden
        // total que usa todo el motor.
        if (l.unidadId === undefined) continue
        // Si quien cobra escaneó un IMEI, se chequea ANTES de tomar la unidad
        // que ningún OTRO equipo libre lo tenga ya.
        //
        // Esto NO se puede dejar en manos del índice parcial
        // (`unidades_articulo_imei_libre`, `WHERE venta_id IS NULL AND
        // baja_en IS NULL`) como hace `identificarUnidad`
        // (lib/inventario/unidades.ts): ese índice sólo cubre unidades
        // LIBRES, y el UPDATE de acá pone `ventaId` en la MISMA sentencia que
        // el `imei` — la fila resultante queda con `venta_id` NOT NULL, o sea
        // FUERA del índice, antes de que Postgres tenga oportunidad de
        // comparar el IMEI contra nada. Verificado a mano contra la base: el
        // UPDATE combinado corre limpio (sin ningún `P2002`) aun cuando el
        // IMEI ya está en otra unidad libre — al revés de lo que un chequeo
        // por `catch` asumiría. Por eso el chequeo va ACÁ, antes de escribir,
        // y no envolviendo el `updateMany`.
        //
        // La ventana de carrera acá es REAL, y hay que decirlo tal cual:
        // `proximoNumero`, más arriba, sólo serializa dos `crearVenta` DEL
        // MISMO tenant entre sí — ninguna otra puede colarse entre este
        // SELECT y el UPDATE de abajo. Pero `identificarUnidad` e
        // `ingresarStock` (lib/inventario/unidades.ts y
        // lib/inventario/stock.ts) también escriben IMEIs y NINGUNO de los
        // dos pasa por ese lock. Si uno de ellos identifica OTRA unidad
        // libre con este mismo IMEI justo en el instante entre este SELECT y
        // el UPDATE de abajo, el SELECT no lo ve (todavía no comiteó) y el
        // UPDATE sigue de largo: el resultado es una unidad VENDIDA y una
        // unidad LIBRE reclamando el mismo IMEI a la vez — exactamente el
        // estado que este chequeo existe para evitar. No se cierra en este
        // ciclo a propósito: hacerlo bien exigiría que `identificarUnidad` e
        // `ingresarStock` tomaran el mismo lock de tenant que `crearVenta`, y
        // el contrapeso es un escritor administrativo ocasional, no el
        // camino caliente del mostrador.
        if (l.imeiCapturado !== undefined) {
          // Primero, ¿la unidad que se está vendiendo YA tenía un IMEI
          // DISTINTO cargado? Si lo tiene, esto no es una identificación: es
          // una CORRECCIÓN, y las correcciones son trabajo de
          // `identificarUnidad` (lib/inventario/unidades.ts), a propósito, y
          // sólo sobre una unidad LIBRE — la captura al cobrar existe para
          // unidades que todavía no conocemos, no para pisar una identidad ya
          // asentada. Que el IMEI escaneado no coincida con el que la unidad
          // ya tenía es una señal de que algo está mal —se escaneó la caja
          // equivocada, o la unidad elegida en pantalla no es la que se tiene
          // en la mano— y tiene que frenar la venta para que una persona lo
          // mire, no resolverse en silencio a favor de lo último que llegó.
          // Es el mismo criterio que ya aplica el guard de `a.llevaSerie` más
          // arriba: un `unidadId` que no corresponde se RECHAZA, no se
          // ignora, para que la distinción quede diagnosticable.
          //
          // Escribir el MISMO IMEI que la unidad ya tenía NO es un conflicto:
          // es un no-op (`!== l.imeiCapturado`, no una comparación de
          // presencia), y una unidad ya identificada tiene que poder venderse
          // volviendo a escanear el mismo código sin que eso frene nada.
          const unidadObjetivo = await tx.unidadDeArticulo.findUnique({
            where: { id: l.unidadId },
            select: { imei: true },
          })
          if (
            unidadObjetivo &&
            unidadObjetivo.imei !== null &&
            unidadObjetivo.imei !== l.imeiCapturado
          ) {
            throw new ErrorDeVenta(
              'UNIDAD_NO_CORRESPONDE',
              `el IMEI escaneado (${l.imeiCapturado}) no es el que esta unidad ya tenía cargado ` +
                `(${unidadObjetivo.imei}): fijate qué equipo tenés en la mano antes de cobrar.`,
            )
          }

          // Segundo, ¿otra unidad libre distinta ya tiene este IMEI?
          const otraLibreConEseImei = await tx.unidadDeArticulo.findFirst({
            where: {
              imei: l.imeiCapturado,
              ventaId: null,
              bajaEn: null,
              id: { not: l.unidadId },
            },
            select: { id: true },
          })
          if (otraLibreConEseImei) {
            throw new ErrorDeVenta(
              'UNIDAD_NO_DISPONIBLE',
              `el IMEI ${l.imeiCapturado} ya está en otro equipo del stock`,
            )
          }
        }

        // El IMEI, si quien cobra lo escaneó, se escribe EN ESTE MISMO
        // `updateMany` — no en una sentencia aparte: es la misma fila, la
        // misma transacción y el mismo lock, y partirlo abriría una ventana
        // entre tomar la unidad e identificarla. `!== undefined` porque una
        // venta sin `imeiCapturado` no tiene que tocar el IMEI que la unidad
        // ya tuviera (una unidad identificada se puede vender sin volver a
        // escanearla).
        const tomada = await tx.unidadDeArticulo.updateMany({
          where: {
            id: l.unidadId,
            articuloId: l.articuloId,
            ventaId: null,
            bajaEn: null,
          },
          data: {
            ventaId: venta.id,
            ...(l.imeiCapturado !== undefined ? { imei: l.imeiCapturado } : {}),
          },
        })
        if (tomada.count !== 1) {
          // Cero filas tiene dos causas que el mostrador vive distinto: la
          // unidad no es de este artículo (o no existe), ya se vendió, o se
          // dio de baja (rota, robada, a garantía). La consulta que las
          // separa va acá y no antes: sólo corre en el camino excepcional.
          // Trae `bajaEn` a propósito — sin él, un equipo dado de baja
          // diría "se acaba de vender" en el cartel del mostrador, que es
          // simplemente falso: nadie lo vendió. No hace falta `ventaId`
          // para la otra rama: si no está de baja y de todos modos no
          // matcheó el UPDATE de arriba, sólo queda que esté vendida.
          const existe = await tx.unidadDeArticulo.findFirst({
            where: { id: l.unidadId, articuloId: l.articuloId },
            select: { imei: true, bajaEn: true },
          })
          if (!existe) {
            throw new ErrorDeVenta(
              'UNIDAD_INEXISTENTE',
              'ese equipo no es de este artículo. Recargá la pantalla y elegí de nuevo.',
            )
          }
          if (existe.bajaEn) {
            throw new ErrorDeVenta(
              'UNIDAD_NO_DISPONIBLE',
              `El equipo ${existe.imei} se dio de baja y ya no está en stock. Elegí otro.`,
            )
          }
          throw new ErrorDeVenta(
            'UNIDAD_NO_DISPONIBLE',
            `El equipo ${existe.imei} se acaba de vender. Elegí otro.`,
          )
        }
      }

      // El movimiento y el stock, sobre el MISMO `paraStock` y en el mismo
      // orden: acá recién se toman los locks de `articulos`, con todos los de
      // `unidades_articulo` ya tomados por el bucle de arriba.
      for (const l of paraStock) {
        await tx.movimientoStock.create({
          data: {
            tenantId,
            articuloId: l.articuloId,
            unidadId: l.unidadId,
            delta: l.cantidad.negated(),
            motivo: 'VENTA',
            ventaId: venta.id,
            usuarioId,
          },
        })
        // RELATIVO y no absoluto: `increment` genera `SET stock = stock + $1`, así
        // que dos ventas simultáneas del mismo artículo no se pisan. Un
        // `SET stock = $leido - $cantidad` perdería una de las dos, y el test de
        // concurrencia existe para atrapar exactamente ese cambio.
        //
        // Sin validar que alcance: el stock puede quedar negativo y eso no frena
        // la venta. Es decisión de negocio, no un olvido.
        await tx.articulo.update({
          where: { id: l.articuloId },
          data: { stock: { increment: l.cantidad.negated() } },
        })
      }

      return { id: venta.id, numero }
    })
  } catch (e) {
    // El choque de la clave NO es una falla: es la respuesta correcta llegando
    // dos veces. Se busca la venta que ya existe y se devuelve como si la
    // hubiera creado este llamador.
    //
    // ACÁ AFUERA y no adentro del callback: una violación de unicidad ABORTA la
    // transacción en Postgres, así que cualquier consulta posterior sobre esa
    // conexión falla con "current transaction is aborted". Es el mismo bug que
    // tuvo el contador de SKU en el ciclo de inventario.
    //
    // Y no hay carrera: si dos transacciones mandan la misma clave, la segunda
    // espera en el índice único hasta que la primera comitee o rollbackee. Si
    // comitea, el P2002 le llega con la fila del otro YA VISIBLE; si
    // rollbackea, inserta ella. El camino "chocó pero no la encuentro" no
    // existe — y si existiera, el `if` de abajo relanza en vez de mentir.
    //
    // **El mismo razonamiento vale para un `TELEFONO_REPETIDO` con
    // `clienteNuevo`** (review del ciclo de la solapa Clientes): en el doble
    // submit de verdad simultáneo —dos pestañas, un reintento de red—, la
    // segunda transacción espera el lock del teléfono (`bloquearClave`), la
    // primera comitea venta y cliente, y la segunda choca con SU PROPIO
    // cliente antes de llegar al índice único de la clave. Sin esto quien
    // cobra leía "ese teléfono ya lo tiene…" por una venta que sí salió. Si
    // la clave aparece, el choque era éste; si no, el teléfono era de otro y
    // el error se relanza tal cual.
    const esChoqueDeSuPropioCliente =
      clienteNuevo !== undefined && e instanceof ErrorDeCliente && e.codigo === 'TELEFONO_REPETIDO'
    if (claveIdempotencia !== undefined && (esP2002(e) || esChoqueDeSuPropioCliente)) {
      const yaExiste = await enTransaccionDeTenant(tenantId, async (tx) =>
        tx.venta.findFirst({
          where: { claveIdempotencia },
          select: { id: true, numero: true },
        }),
      )
      // Si la clave aparece ahora, el choque era éste y devolvemos esa venta.
      // Si NO aparece, el P2002 era de la otra unicidad —`(tenant_id, numero)`—
      // y relanzarlo es lo correcto: devolver algo ahí sería inventar.
      if (yaExiste) return yaExiste
    }
    throw traducirErrorDeBase(e)
  }
}

/**
 * Si es una violación de unicidad, cualquiera.
 *
 * No mira QUÉ unicidad, y no es pereza: bajo `arandano_app` Postgres retiene el
 * DETALLE del error porque la policy de RLS aplica al rol que consulta —
 * verificado en vivo en el ciclo de inventario—, así que `constraint.fields`
 * no está disponible. Quién chocó se decide después, buscando la clave: si
 * apareció, era ésta; si no, era el correlativo y el error se relanza.
 */
function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * El correlativo por tenant, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()`: contar ventas daría el mismo
 * número a dos transacciones concurrentes. Esto las serializa —toma el lock de
 * la fila del tenant— y a cambio no hay huecos ni repetidos.
 */
async function proximoNumero(tx: ClienteTx, tenantId: string): Promise<number> {
  const filas = await tx.$queryRaw<{ proximo_numero_venta: number }[]>`
    UPDATE tenants
       SET proximo_numero_venta = proximo_numero_venta + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_numero_venta - 1 AS proximo_numero_venta
  `
  // Cero filas significa que el tenant no existe, o que existe y RLS no lo deja
  // ver —que para el motor es lo mismo—. Sin este guard, `filas[0]` es
  // `undefined` y el llamador recibe un `TypeError` en vez de un `ErrorDeVenta`:
  // un 500 sin `codigo` justo en el único lugar de la función que habla SQL
  // crudo y no tiene a Prisma traduciendo por él.
  if (filas.length === 0) {
    throw new ErrorDeVenta('TENANT_INEXISTENTE', `el tenant ${tenantId} no existe`)
  }
  return filas[0].proximo_numero_venta
}
