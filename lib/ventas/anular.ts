import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'

export async function anularVenta(entrada: {
  tenantId: string
  ventaId: string
  usuarioId: string
}): Promise<void> {
  const { tenantId, ventaId, usuarioId } = entrada

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      // Antes del UPDATE, porque el UPDATE escribe `anulada_por_id`: dejarlo
      // para después sería escribir la FK ajena que este chequeo existe para
      // impedir.
      await exigirUsuario(tx, usuarioId)

      // Idempotente: el reintento de un click es más probable que la mala
      // intención, y anular dos veces no puede duplicar la devolución de stock.
      //
      // La condición viaja DENTRO del UPDATE, no en un `if` sobre lo que devolvió
      // un `findUnique`. Leer y después decidir deja una ventana entre las dos
      // sentencias, y bajo READ COMMITTED —el nivel por defecto, que
      // `enTransaccionDeTenant` no cambia— dos anulaciones simultáneas de la misma
      // venta la leen sin anular las dos, y las dos compensan: doble
      // `ANULACION_VENTA` y stock acreditado dos veces. Un doble click en "anular"
      // alcanza para producirlo. Así, en cambio, la segunda transacción espera el
      // lock de la fila, vuelve a evaluar el `WHERE` cuando la primera comitea, se
      // lleva cero filas y no compensa nada. Es el mismo recurso que usa
      // `proximoNumero` en `crear.ts` para serializar contra su propia carrera.
      //
      // `now()` acá es el reloj de POSTGRES, mientras que el `creadoEn` de los
      // movimientos compensatorios de más abajo sale del `@default(now())` de
      // Prisma, que lo resuelve en NODE. Son dos relojes distintos y no están
      // sincronizados: en esta misma máquina da lo mismo, pero no hay que deducir
      // de una comparación de timestamps que un movimiento pasó antes o después
      // de la anulación que lo generó. Lo que los ata es la transacción, no la hora.
      const marcadas = await tx.$queryRaw<{ id: string }[]>`
        UPDATE ventas
           SET anulada_en = now(), anulada_por_id = ${usuarioId}::uuid
         WHERE id = ${ventaId}::uuid AND anulada_en IS NULL
        RETURNING id
      `

      if (marcadas.length === 0) {
        // Cero filas tiene dos causas que el llamador no vive igual: la venta ya
        // estaba anulada (no-op silencioso) o no existe en este tenant (error).
        // El UPDATE no las distingue, así que la consulta que las separa va acá y
        // no antes — sólo corre en el camino excepcional, y como es dentro de la
        // misma transacción ve el commit de quien haya ganado la carrera.
        const existe = await tx.venta.findUnique({
          where: { id: ventaId },
          select: { id: true },
        })
        if (!existe) {
          throw new ErrorDeVenta(
            'VENTA_INEXISTENTE',
            `la venta ${ventaId} no existe en este tenant`,
          )
        }
        return
      }

      // Se compensan LOS MOVIMIENTOS QUE LA VENTA GENERÓ, no los ítems.
      // Recorrer los ítems de nuevo daría distinto si el tipo del artículo cambió
      // de PRODUCTO a SERVICIO desde entonces; derivarlo de los movimientos
      // garantiza que las dos mitades coincidan siempre.
      //
      // El `orderBy` no es cosmético: el `update` de abajo toma el lock de la
      // fila del artículo (y, con serie, el `update` de la unidad toma el de
      // esa fila), y sin un orden fijo dos escritores que comparten artículos
      // o unidades los toman en orden distinto y se deadlockean (`40P01`), que
      // sale como error crudo de Prisma. Es el mismo orden —por `articuloId`
      // y, en el empate, por `unidadId`— que usa `crearVenta` en `paraStock`, y
      // tiene que seguir siéndolo: un orden total sirve si es el MISMO en todo
      // el motor. El empate hace falta por lo mismo que allá: con serie una
      // venta puede traer VARIAS líneas del MISMO artículo (una por unidad), y
      // `anularVenta` —a diferencia de `crearVenta`— no toma ningún lock de
      // tenant antes de llegar acá, así que es el escritor que de verdad puede
      // interleavearse con otro.
      const movimientos = await tx.movimientoStock.findMany({
        where: { ventaId, motivo: 'VENTA' },
        orderBy: [{ articuloId: 'asc' }, { unidadId: 'asc' }],
      })

      for (const m of movimientos) {
        await tx.movimientoStock.create({
          data: {
            tenantId,
            articuloId: m.articuloId,
            unidadId: m.unidadId,
            delta: m.delta.negated(),
            motivo: 'ANULACION_VENTA',
            ventaId,
            usuarioId,
          },
        })
        await tx.articulo.update({
          where: { id: m.articuloId },
          data: { stock: { increment: m.delta.negated() } },
        })

        // La unidad vuelve a la vitrina. Va DENTRO del mismo bucle que
        // compensa el stock —y no en un update aparte— porque las dos mitades
        // tienen que moverse juntas o no moverse: una unidad libre con el stock
        // sin devolver es exactamente la desincronización que el invariante
        // existe para impedir.
        //
        // Es idempotente por el guard de arriba: si la venta ya estaba anulada,
        // el UPDATE de `ventas` se llevó cero filas y no llegamos acá.
        if (m.unidadId !== null) {
          await tx.unidadDeArticulo.update({
            where: { id: m.unidadId },
            data: { ventaId: null },
          })
        }
      }
    })
  } catch (e) {
    // El caso de borde real: mientras la venta estuvo viva, el local RECOMPRÓ
    // el mismo equipo y lo cargó de nuevo. Liberar el vendido dejaría dos
    // unidades libres con el mismo IMEI, que es justo lo que el índice parcial
    // impide. Sin esta traducción sale un P2002 crudo —un 500 sin `codigo`— en
    // lugar de un cartel que dice qué pasó.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ErrorDeVenta(
        'UNIDAD_NO_DISPONIBLE',
        'no se puede anular: uno de los equipos de esta venta volvió a cargarse en el ' +
          'stock. Dalo de baja desde la ficha del artículo y anulá de nuevo.',
      )
    }
    throw traducirErrorDeBase(e)
  }
}
