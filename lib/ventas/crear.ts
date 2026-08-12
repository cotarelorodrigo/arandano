import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import {
  totalDeItems,
  totalDePagos,
  excedeEscala,
  ESCALA_CANTIDAD,
  ESCALA_DINERO,
  ESCALA_COTIZACION,
} from './totales'
import { exigirCliente, exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'

export type ItemDeVenta = { articuloId: string; cantidad: Prisma.Decimal }
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  monto: Prisma.Decimal
  cotizacion: Prisma.Decimal
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
  // Invariantes del DOMINIO, no del transporte, y por eso viven acá y no en un
  // validador de la capa HTTP que todavía no existe: un pago negativo cierra la
  // suma contra el total —`[+900000 EFECTIVO, -899000 TARJETA]` contra un total
  // de 1000— y deja la caja pidiendo 900 mil pesos en efectivo que nunca
  // entraron. Y una cotización en cero deja un pago en dólares del que ya no se
  // puede reconstruir a qué valor se tomó, que es exactamente lo que el campo
  // existe para guardar. Una devolución es una venta anulada, no un pago en
  // negativo.
  for (const p of pagos) {
    if (p.monto.lessThanOrEqualTo(0)) {
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
    if (excedeEscala(p.monto, ESCALA_DINERO)) {
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

      const articulos = await tx.articulo.findMany({
        where: { id: { in: items.map((i) => i.articuloId) } },
      })
      const porId = new Map(articulos.map((a) => [a.id, a]))

      // Congelar precio y descripción ACÁ. El artículo puede renombrarse o cambiar
      // de precio mañana; esta venta tiene que seguir diciendo lo de hoy.
      const lineas = items.map((i) => {
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
        return {
          articuloId: a.id,
          descripcion: a.nombre,
          cantidad: i.cantidad,
          precioUnitario: a.precio,
          esProducto: a.tipo === 'PRODUCTO',
        }
      })

      const total = totalDeItems(lineas)
      if (!totalDePagos(pagos).equals(total)) {
        throw new ErrorDeVenta(
          'PAGOS_NO_CIERRAN',
          `los pagos suman ${totalDePagos(pagos)} y el total es ${total}`,
        )
      }

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
          total,
          items: {
            create: lineas.map((l) => ({
              tenantId,
              articuloId: l.articuloId,
              descripcion: l.descripcion,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
            })),
          },
          // Campo por campo, igual que los ítems dos líneas arriba: un
          // `...p` dejaría pasar cualquier propiedad de más que traiga un body
          // JSON ya parseado, y Prisma la rechaza con `PrismaClientValidationError`
          // —un 500 sin `codigo`— en vez del `ErrorDeVenta` que el resto de esta
          // función usa para todo lo demás.
          pagos: {
            create: pagos.map((p) => ({
              tenantId,
              medio: p.medio,
              moneda: p.moneda,
              monto: p.monto,
              cotizacion: p.cotizacion,
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
      const paraStock = lineas
        .filter((l) => l.esProducto)
        .sort((a, b) => (a.articuloId < b.articuloId ? -1 : a.articuloId > b.articuloId ? 1 : 0))

      for (const l of paraStock) {
        await tx.movimientoStock.create({
          data: {
            tenantId,
            articuloId: l.articuloId,
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
