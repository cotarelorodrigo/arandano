'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@/generated/prisma/client'
import type { MedioPago, Moneda } from '@/generated/prisma/client'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { anularVenta } from '@/lib/ventas/anular'
import { reemplazarPagos } from '@/lib/ventas/editar'
import { normalizarDetalle } from '@/lib/ventas/detalle'
import { ErrorDeVenta } from '@/lib/ventas/errores'
import { esUuid } from '@/lib/uuid'
import { cambiarClienteDeVenta } from '@/lib/ventas/cliente'
import { ErrorDeCliente } from '@/lib/clientes/errores'

export type EstadoAnulacion = { error: string | null; aviso: string | null }

/**
 * Anular una venta.
 *
 * Detrás de `VENTAS_ANULAR`, y el guard va acá y no sólo en la pantalla: una
 * action se invoca sin pasar por ningún componente. Anular devuelve el stock
 * y da de baja plata cobrada del período, así que sigue siendo peligroso —
 * pero ahora es el dueño quien decide si lo delega, en vez de que lo decida
 * el código. Ver el mismo razonamiento en app/(app)/usuarios/acciones.ts.
 */
export async function anular(
  _e: EstadoAnulacion,
  datos: FormData,
): Promise<EstadoAnulacion> {
  try {
    const sesion = await exigirPermiso('VENTAS_ANULAR')
    const ventaId = String(datos.get('ventaId') ?? '').trim()
    await anularVenta({ tenantId: sesion.tenant.id, ventaId, usuarioId: sesion.usuario.id })
    revalidatePath('/ventas')
    revalidatePath(`/ventas/${ventaId}`)
    // El stock vuelve por movimientos compensatorios, no borrando los
    // originales: por eso se puede decir que "volvió" sin mentir.
    return { error: null, aviso: 'Venta anulada. El stock volvió al inventario.' }
  } catch (e) {
    if (e instanceof ErrorDeVenta) return { error: e.message, aviso: null }
    throw e
  }
}

/** El mismo texto para el id mal formado y para la venta de otro local: son el
 *  mismo caso para quien mira la pantalla, y distinguirlos filtraría qué ids
 *  existen. */
const NO_EXISTE = 'Esa venta no existe.'

export type EstadoDetalle = { error: string | null; aviso: string | null }

/**
 * Guardar el detalle de una venta ya cobrada.
 *
 * **Hasta ahora, lo único que le pasaba a una venta después del cobro era
 * anularse.** `anular` también escribe sobre una venta cerrada
 * (`anuladaEn`/`anuladaPorId`), pero cambia su ESTADO — lo que esto estrena es
 * distinto: es la primera vez que se EDITA el contenido de una venta ya
 * cobrada. Lo que la hace segura es su alcance: actualiza UNA columna, la de
 * texto libre, filtrada por id y por tenant, y no toca ninguna otra. Nada de lo
 * que el motor de ventas garantiza —que los pagos cierren contra los totales,
 * que el stock haya bajado, que la clave de idempotencia sea única— pasa por
 * esta columna ni puede cambiar por ella.
 *
 * **Sin permiso propio**, detrás de `exigirSesion` como `ingresarMercaderia` y
 * `corregirPorConteo`. La regla de este repo es delegar por lo que la acción
 * MUEVE: `PLANES_PAGO` existe aparte porque mueve el precio de todo el
 * catálogo, `ARTICULOS_BORRAR` porque no se deshace. Esto mueve una columna de
 * texto y se corrige tipeando de nuevo.
 *
 * **Y funciona también sobre una venta anulada**, a propósito: el detalle no es
 * parte de lo que se cobró, y una venta anulada es justamente aquella sobre la
 * que alguien va a querer dejar escrito qué pasó.
 *
 * **Sin rastro de quién editó ni de qué decía antes.** Es un campo, no una
 * tabla-libro: una corrección pisa lo anterior. Está aceptado en el spec del
 * ciclo, con la salida escrita por si algún día hace falta.
 */
export async function guardarDetalle(entrada: {
  ventaId: string
  detalle: string
}): Promise<EstadoDetalle> {
  const sesion = await exigirSesion()
  const { ventaId, detalle } = entrada
  // El mismo guard que el resto de las pantallas con id en la URL: sin esto,
  // Prisma rechaza un uuid mal formado con un error que nadie traduce y la
  // acción sale como 500 en vez de como el aviso que corresponde. El mensaje es
  // EL MISMO que el de la venta ajena, unas líneas más abajo: distinguirlos
  // filtraría qué ids existen.
  if (!esUuid(ventaId)) return { error: NO_EXISTE, aviso: null }

  // `updateMany` y no `update`: RLS ya filtra por tenant, así que la venta de
  // otro local simplemente no aparece — con `update` eso sería una excepción
  // P2025 (un 500), y con `updateMany` es `count === 0`, que es exactamente el
  // mismo caso que un id inventado.
  const { count } = await prismaParaTenant(sesion.tenant.id).venta.updateMany({
    where: { id: ventaId },
    data: { detalle: normalizarDetalle(detalle) },
  })
  if (count === 0) return { error: NO_EXISTE, aviso: null }

  revalidatePath(`/ventas/${ventaId}`)
  return { error: null, aviso: 'Detalles guardados.' }
}

export type EstadoCliente = { error: string | null; aviso: string | null }

/**
 * Asignar, cambiar o quitar el cliente de una venta ya cobrada.
 *
 * **Sin permiso propio**, detrás de `exigirSesion` como `guardarDetalle`, y por
 * el mismo motivo: no mueve plata ni stock, se corrige eligiendo de nuevo, y
 * el motor (`cambiarClienteDeVenta`, lib/ventas/cliente.ts) sólo toca
 * `cliente_id`. Lo puede hacer quien cobró la venta, que es quien sabe a quién
 * se la vendió.
 *
 * `cliente` llega como argumento de un server action, o sea JSON armado por el
 * navegador: se lee campo por campo, sin confiar en la forma. `null` es
 * "consumidor final".
 */
export async function asignarCliente(entrada: {
  ventaId: string
  cliente: unknown
}): Promise<EstadoCliente> {
  const sesion = await exigirSesion()
  const { ventaId } = entrada
  if (!esUuid(ventaId)) return { error: NO_EXISTE, aviso: null }

  const c = entrada.cliente as
    | { tipo?: unknown; id?: unknown; nombre?: unknown; telefono?: unknown; aceptaOfertas?: unknown }
    | null
  let cliente: Parameters<typeof cambiarClienteDeVenta>[0]['cliente']
  if (c === null) {
    cliente = null
  } else if (c?.tipo === 'existente' && typeof c.id === 'string' && esUuid(c.id)) {
    cliente = { tipo: 'existente', id: c.id }
  } else if (c?.tipo === 'nuevo') {
    cliente = {
      tipo: 'nuevo',
      nombre: typeof c.nombre === 'string' ? c.nombre : '',
      telefono: typeof c.telefono === 'string' ? c.telefono : null,
      aceptaOfertas: c.aceptaOfertas === true,
    }
  } else {
    return { error: CLIENTE_NO_EXISTE, aviso: null }
  }

  try {
    await cambiarClienteDeVenta({ tenantId: sesion.tenant.id, ventaId, cliente })
  } catch (e) {
    if (e instanceof ErrorDeCliente) return { error: e.message, aviso: null }
    if (e instanceof ErrorDeVenta) {
      // `exigirCliente` trae el id en su mensaje (es para el log); a la
      // pantalla va el texto de siempre.
      if (e.codigo === 'CLIENTE_INEXISTENTE') return { error: CLIENTE_NO_EXISTE, aviso: null }
      if (e.codigo === 'VENTA_INEXISTENTE') return { error: NO_EXISTE, aviso: null }
    }
    throw e
  }

  revalidatePath(`/ventas/${ventaId}`)
  revalidatePath('/ventas')
  // La ficha del cliente lista sus compras: la del que entra y la del que sale.
  revalidatePath('/clientes', 'layout')
  return {
    error: null,
    aviso: cliente === null ? 'La venta quedó sin cliente.' : 'Cliente guardado en la venta.',
  }
}

const CLIENTE_NO_EXISTE = 'Ese cliente ya no existe. Buscalo de nuevo.'

// Lista blanca de medios/monedas, igual que `cobrar`
// (app/(app)/vender/acciones.ts) y por el mismo motivo: sin este chequeo, un
// enum inventado llega intacto hasta `reemplazarPagos`, que lo pasa a Prisma,
// que lo rechaza con un `PrismaClientValidationError` — un 500 sin `codigo`,
// en vez del aviso que el resto de esta función usa para todo lo demás.
const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO'] as const
const MONEDAS = ['ARS', 'USD'] as const

export type EstadoCorreccion = { error: string | null; aviso: string | null }

/**
 * Corregir cómo se pagó una venta.
 *
 * **Detrás de `VENTAS_EDITAR`, y el guard va acá y no sólo en la pantalla**:
 * una action se invoca sin pasar por ningún componente, y esto mueve plata ya
 * cobrada. Es la misma lección de las dos copias de un botón que dejó escrita
 * el merge del ciclo móvil.
 *
 * **Los importes llegan como string.** Un `number` de JS no representa la plata
 * sin perder centavos; el servidor los convierte a `Decimal` y el motor valida
 * la escala. Mismo criterio que el cobro.
 *
 * **`medio`/`moneda`/`cubre` y `planId` se validan ACÁ, antes de llegar al
 * motor** — igual que ya hace `cobrar` para el mismo problema: un valor fuera
 * del enum, o un `planId` que no tiene forma de uuid, lo rechazaría Prisma
 * recién adentro de `reemplazarPagos` (en el `createMany` de pagos o en el
 * `findMany({ where: { id: { in: [...] } } })` de `resolverPagosConRecargo`),
 * con un error sin `codigo` que saldría como 500 en vez del aviso que
 * corresponde.
 */
export async function corregirPagos(entrada: {
  ventaId: string
  pagos: {
    medio: string
    moneda: string
    cubre: string
    base: string
    cotizacion: string
    planId: string | null
  }[]
  nota: string
}): Promise<EstadoCorreccion> {
  const sesion = await exigirPermiso('VENTAS_EDITAR')
  const { ventaId, pagos, nota } = entrada
  // Mismo guard que `guardarDetalle`, con el mismo mensaje: distinguir un id
  // mal formado de uno de otro tenant filtraría qué ids existen.
  if (!esUuid(ventaId)) return { error: NO_EXISTE, aviso: null }

  try {
    const normalizados = pagos.map((p) => {
      if (!MEDIOS.includes(p.medio as MedioPago)) {
        throw new ErrorDeVenta('MONTO_INVALIDO', `medio de pago desconocido: ${p.medio}`)
      }
      if (!MONEDAS.includes(p.moneda as Moneda)) {
        throw new ErrorDeVenta('COTIZACION_INVALIDA', `moneda desconocida: ${p.moneda}`)
      }
      if (!MONEDAS.includes(p.cubre as Moneda)) {
        throw new ErrorDeVenta('COTIZACION_INVALIDA', `moneda desconocida: ${p.cubre}`)
      }
      if (p.planId !== null && !esUuid(p.planId)) {
        // Mismo mensaje que usa `cobrar` para el mismo caso: sin el id, que
        // no le dice nada a quien está corrigiendo la venta.
        throw new ErrorDeVenta(
          'PLAN_INEXISTENTE',
          'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
        )
      }
      return {
        medio: p.medio as MedioPago,
        moneda: p.moneda as Moneda,
        cubre: p.cubre as Moneda,
        base: new Prisma.Decimal(p.base),
        cotizacion: new Prisma.Decimal(p.cotizacion),
        planId: p.planId ?? undefined,
      }
    })

    await reemplazarPagos({
      tenantId: sesion.tenant.id,
      ventaId,
      usuarioId: sesion.usuario.id,
      // Cruda: `reemplazarPagos` es quien la normaliza (trim, tope, vacío →
      // null). Normalizarla acá también sería la segunda implementación de la
      // misma regla — el defecto que este ciclo entero existe para no repetir.
      nota,
      pagos: normalizados,
    })
  } catch (e) {
    // Un `ventaId` bien formado pero ajeno o inexistente no lo frena el
    // guard de arriba: llega hasta acá y `reemplazarPagos` lo rechaza con
    // `VENTA_INEXISTENTE`, cuyo mensaje lleva el uuid y "no existe en este
    // tenant" — diagnóstico útil en el log del servidor (mismo criterio que
    // `PLAN_INEXISTENTE` en lib/ventas/pagos.ts), pero que un cartel no puede
    // repetir: le contaría el modelo de aislamiento a quien prueba ids. Por
    // eso este caso, y sólo éste, se traduce a `NO_EXISTE` en vez de
    // devolver `e.message` — el MISMO texto que ya usa el guard de arriba
    // para el id mal formado, que es justo lo que evita que los dos caminos
    // se puedan distinguir desde afuera.
    if (e instanceof ErrorDeVenta && e.codigo === 'VENTA_INEXISTENTE') {
      return { error: NO_EXISTE, aviso: null }
    }
    if (e instanceof ErrorDeVenta) return { error: e.message, aviso: null }
    // Un importe que no es un número tira un error crudo desde el
    // constructor de `Decimal` (`decimal.js`, "[DecimalError] Invalid
    // argument"): sale como aviso y no como 500, igual que el resto de lo que
    // puede llegar mal formado de afuera.
    if (e instanceof Error && e.name === 'Error' && /Decimal/.test(e.message)) {
      return { error: 'Revisá los importes: hay uno que no es un número.', aviso: null }
    }
    throw e
  }

  revalidatePath('/ventas')
  revalidatePath(`/ventas/${ventaId}`)
  return { error: null, aviso: 'Listo: se corrigió cómo se pagó esta venta.' }
}
