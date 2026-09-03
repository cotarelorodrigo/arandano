import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import {
  totalesDeItems,
  totalesDePagos,
  montoEntregado,
  recargoDePago,
  excedeEscala,
  ESCALA_CANTIDAD,
  ESCALA_DINERO,
  ESCALA_COTIZACION,
} from './totales'
import { exigirCliente, exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'
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
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  /**
   * Lo que este pago cubre de la venta, A PRECIO DE LISTA. Va **en dólares si
   * el pago toca dólares de algún lado** (`moneda` o `cubre`), y en pesos si
   * no toca ninguno — ver `baseEnDolares` en totales.ts, que es donde vive esa
   * regla y por qué nada divide. NO es lo que entra a la caja: eso es
   * `montoEntregado(p) + recargo`, y lo calcula el servidor.
   */
  base: Prisma.Decimal
  cotizacion: Prisma.Decimal
  /**
   * Cuál de los dos totales paga esta fila. Ausente vale `ARS`, que es lo que
   * era toda venta antes de este ciclo — así ningún llamador viejo cambia.
   */
  cubre?: Moneda
  /** El plan con el que se cobra esta parte. Sin plan, precio de lista. */
  planId?: string
}

export type EntradaCrearVenta = {
  tenantId: string
  // Por PARÁMETRO y no de una sesión: Auth.js todavía no existe, y esperar a
  // que exista frenaría este ciclo por algo que no cambia el diseño. Cuando
  // llegue el login, lo único que cambia es quién llama. Deuda explícita: hasta
  // entonces nada impide que un llamador pase el usuario de otro, y por eso la
  // UI no se construye antes que Auth.js.
  usuarioId: string
  clienteId?: string
  items: ItemDeVenta[]
  pagos: PagoDeVenta[]
  // Opcional: el motor no la inventa. Un llamador que no la manda acepta que
  // dos llamadas iguales creen dos ventas, que es lo correcto para un test o un
  // script; la pantalla sí la manda.
  claveIdempotencia?: string
}

export async function crearVenta(
  entrada: EntradaCrearVenta,
): Promise<{ id: string; numero: number }> {
  const { tenantId, usuarioId, clienteId, items, pagos, claveIdempotencia } = entrada

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
  // Normalizado ACÁ, una sola vez: `cubre` ausente vale `ARS`, que es lo que
  // era toda venta antes de este ciclo, y de acá en más ningún otro lugar de
  // la función repite el `?? 'ARS'`.
  const pagosNormalizados = pagos.map((p) => ({ ...p, cubre: p.cubre ?? 'ARS' }))

  // Invariantes del DOMINIO, no del transporte, y por eso viven acá y no en un
  // validador de la capa HTTP que todavía no existe: un pago negativo cierra la
  // suma contra el total —`[+900000 EFECTIVO, -899000 TARJETA]` contra un total
  // de 1000— y deja la caja pidiendo 900 mil pesos en efectivo que nunca
  // entraron. Y una cotización en cero deja un pago en dólares del que ya no se
  // puede reconstruir a qué valor se tomó, que es exactamente lo que el campo
  // existe para guardar. Una devolución es una venta anulada, no un pago en
  // negativo.
  for (const p of pagosNormalizados) {
    if (p.base.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'MONTO_INVALIDO',
        `el monto de un pago ${p.medio} tiene que ser mayor que cero`,
      )
    }
    if (p.cotizacion.lessThanOrEqualTo(0)) {
      throw new ErrorDeVenta(
        'COTIZACION_INVALIDA',
        `la cotización de un pago ${p.moneda} tiene que ser mayor que cero`,
      )
    }
    if (excedeEscala(p.base, ESCALA_DINERO)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `el monto de un pago ${p.medio} tiene a lo sumo ${ESCALA_DINERO} decimales`,
      )
    }
    if (excedeEscala(p.cotizacion, ESCALA_COTIZACION)) {
      throw new ErrorDeVenta(
        'ESCALA_EXCEDIDA',
        `la cotización de un pago ${p.moneda} tiene a lo sumo ${ESCALA_COTIZACION} decimales`,
      )
    }
  }

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
      if (clienteId !== undefined) await exigirCliente(tx, clienteId)
      await exigirUsuario(tx, usuarioId)

      // Los planes, de una sola consulta y adentro de la transacción del
      // tenant: RLS ya filtra por tenant, así que el plan de otro local
      // simplemente no aparece y cae en PLAN_INEXISTENTE, igual que uno
      // inventado. Son la misma situación para quien está cobrando.
      const idsDePlan = [
        ...new Set(pagosNormalizados.flatMap((p) => (p.planId ? [p.planId] : []))),
      ]
      const planes = idsDePlan.length
        ? await tx.planDePago.findMany({ where: { id: { in: idsDePlan } } })
        : []
      const planPorId = new Map(planes.map((p) => [p.id, p]))

      const pagosConRecargo = pagosNormalizados.map((p) => {
        if (p.planId === undefined) {
          return { ...p, recargo: new Prisma.Decimal(0), monto: montoEntregado(p) }
        }
        const plan = planPorId.get(p.planId)
        // Desactivado se trata como inexistente A PROPÓSITO, al revés que con
        // los artículos: un plan dado de baja no se reactiva para cobrar una
        // venta, se elige otro. La distinción no le cambiaría la salida a nadie.
        if (!plan || plan.desactivadoEn) {
          // Sin el UUID en el mensaje: `traducir` (app/(app)/vender/acciones.ts)
          // muestra `e.message` tal cual en el cartel del mostrador, y un id
          // opaco no le dice nada a quien está cobrando ni le indica qué hacer.
          // El caso real es que el dueño dio de baja el plan desde otra
          // pestaña mientras el mostrador tenía la pantalla abierta, y la
          // salida es recargar y elegir otro. El id sí queda en el log del
          // servidor, que es donde se lo necesita para diagnosticar.
          throw new ErrorDeVenta(
            'PLAN_INEXISTENTE',
            'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
          )
        }
        if (plan.medio !== p.medio) {
          throw new ErrorDeVenta(
            'PLAN_NO_CORRESPONDE',
            `${plan.nombre} es un plan de ${plan.medio} y el pago es ${p.medio}`,
          )
        }
        // Sólo la MONEDA, ya no también la cotización. Un pago en pesos que
        // cubre el total en dólares lleva la cotización de verdad, y el
        // recargo se calcula sobre los pesos que efectivamente se entregan
        // —`montoEntregado`—, así que la cuenta cierra igual y sin dividir.
        // Lo que sigue prohibido es el plan sobre un pago ENTREGADO en
        // dólares: ahí el recargo saldría en dólares y volver a pesos sí
        // exigiría una división.
        if (p.moneda !== 'ARS') {
          throw new ErrorDeVenta(
            'PLAN_EN_DOLARES',
            'un pago con plan tiene que entregarse en pesos: el recargo va sobre la parte en pesos',
          )
        }
        const enPesos = montoEntregado(p)
        const recargo = recargoDePago(enPesos, plan.recargoPorcentaje)
        return { ...p, recargo, monto: enPesos.add(recargo) }
      })

      const articulos = await tx.articulo.findMany({
        where: { id: { in: items.map((i) => i.articuloId) } },
      })
      const porId = new Map(articulos.map((a) => [a.id, a]))

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
          unidadId: i.unidadId,
          imeiCapturado: imeisCapturados[idx],
        }
      })

      const totales = totalesDeItems(lineas)
      // Contra las BASES y no contra los montos: el recargo no es mercadería.
      // Y ahora son DOS comparaciones, una por moneda: una venta que cierra en
      // pesos y no en dólares es tan inválida como la que no cierra a secas.
      const cubierto = totalesDePagos(pagosConRecargo)
      if (!cubierto.ars.equals(totales.ars)) {
        throw new ErrorDeVenta(
          'PAGOS_NO_CIERRAN',
          `los pagos en pesos suman ${cubierto.ars} y el total en pesos es ${totales.ars}`,
        )
      }
      if (!cubierto.usd.equals(totales.usd)) {
        throw new ErrorDeVenta(
          'PAGOS_NO_CIERRAN',
          `los pagos en dólares suman ${cubierto.usd} y el total en dólares es ${totales.usd}`,
        )
      }
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
          total: totales.ars,
          // La mercadería EN DÓLARES, a precio de lista. `total` es la mitad
          // en pesos de lo mismo, y ninguna venta anterior a este ciclo pasa a
          // decir otra cosa: sin ítems en dólares, `totales.usd` da cero.
          totalUsd: totales.usd,
          // La suma de los recargos de los pagos. `total` sigue siendo la
          // mercadería a precio de lista: son dos números distintos y este
          // ciclo existe justamente para no confundirlos.
          recargo: recargoTotal,
          items: {
            create: lineas.map((l) => ({
              tenantId,
              articuloId: l.articuloId,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              moneda: l.moneda,
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
    if (claveIdempotencia !== undefined && esP2002(e)) {
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
