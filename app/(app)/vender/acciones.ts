'use server'

import { revalidatePath } from 'next/cache'
import { exigirSesion } from '@/lib/auth/sesion'
import { crearVenta } from '@/lib/ventas/crear'
import { ErrorDeVenta } from '@/lib/ventas/errores'
import { buscarArticulosVendibles, type ArticuloVendible } from '@/lib/ventas/buscar'
import { abrirCaja, cerrarCaja } from '@/lib/caja/abrir-cerrar'
import { ErrorDeCaja } from '@/lib/caja/errores'
import { aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'
import { esUuid } from '@/lib/uuid'
import type { MedioPago, Moneda } from '@/generated/prisma/client'

export type EstadoCobro = {
  error: string | null
  // La venta cobrada, para que la pantalla muestre el número y el enlace. Null
  // mientras no se haya cobrado nada.
  venta: { id: string; numero: number } | null
}

const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO'] as const
const MONEDAS = ['ARS', 'USD'] as const

/** Los errores que la persona puede corregir tipeando distinto se muestran; el
 *  resto se relanza, para que un bug de verdad llegue al log y no se aplane en
 *  un cartel rojo genérico. */
function traducir(e: unknown): EstadoCobro {
  if (e instanceof ErrorDeVenta || e instanceof ErrorDeFormato) {
    return { error: e.message, venta: null }
  }
  throw e
}

/**
 * Parsea el JSON de un campo y verifica que sea una lista.
 *
 * Un `JSON.parse` suelto sobre lo que viene del cliente tira `SyntaxError`, que
 * `traducir` relanzaría como 500. Un carrito mal formado es entrada inválida,
 * no un bug del servidor.
 */
function listaDeJson(datos: FormData, campo: string): unknown[] {
  let crudo: unknown
  try {
    crudo = JSON.parse(String(datos.get(campo) ?? ''))
  } catch {
    throw new ErrorDeVenta('SIN_ITEMS', `no se entendió el ${campo} que llegó`)
  }
  if (!Array.isArray(crudo)) {
    throw new ErrorDeVenta('SIN_ITEMS', `el ${campo} tiene que ser una lista`)
  }
  return crudo
}

export async function cobrar(_e: EstadoCobro, datos: FormData): Promise<EstadoCobro> {
  try {
    const sesion = await exigirSesion()

    const items = listaDeJson(datos, 'items').map((crudo) => {
      const i = crudo as { articuloId?: unknown; cantidad?: unknown }
      const articuloId = String(i.articuloId ?? '')
      // El mismo guard que el detalle de venta y el de artículo. Desde la
      // pantalla no llega otra cosa —los ids salen del buscador—, pero un POST
      // armado a mano sí, y Prisma rechaza un uuid mal formado con un código
      // que `traducirErrorDeBase` no traduce: no sería `ErrorDeVenta` ni
      // `ErrorDeFormato`, así que saldría por `traducir` como un 500 en vez de
      // como el error de dominio que corresponde.
      if (!esUuid(articuloId)) {
        throw new ErrorDeVenta('ARTICULO_INEXISTENTE', `no existe el artículo ${articuloId}`)
      }
      return {
        articuloId,
        cantidad: aDecimal(String(i.cantidad ?? ''), 'la cantidad'),
      }
    })

    const pagos = listaDeJson(datos, 'pagos').map((crudo) => {
      const p = crudo as {
        medio?: unknown
        moneda?: unknown
        cubre?: unknown
        base?: unknown
        cotizacion?: unknown
        planId?: unknown
      }
      const medio = String(p.medio ?? '')
      const moneda = String(p.moneda ?? '')
      // Ausente vale 'ARS', que es lo mismo que hace el motor
      // (`PagoDeVenta.cubre`) y lo que era toda venta antes de este ciclo. Un
      // JSON viejo —una pestaña que quedó abierta desde antes del deploy—
      // sigue cobrando exactamente como cobraba.
      const cubre = String(p.cubre ?? 'ARS')
      // Campo por campo y contra una lista blanca: lo que llega es un JSON que
      // armó el navegador, y Prisma rechazaría un enum inventado con un
      // PrismaClientValidationError —un 500 sin `codigo`— en vez del error de
      // dominio que el resto de esta función usa.
      if (!MEDIOS.includes(medio as MedioPago)) {
        throw new ErrorDeVenta('MONTO_INVALIDO', `medio de pago desconocido: ${medio}`)
      }
      if (!MONEDAS.includes(moneda as Moneda)) {
        throw new ErrorDeVenta('COTIZACION_INVALIDA', `moneda desconocida: ${moneda}`)
      }
      // La misma lista blanca que la moneda, por el mismo motivo: un enum
      // inventado lo rechazaría Prisma con un PrismaClientValidationError —un
      // 500 sin `codigo`— en vez del error de dominio que usa el resto de esta
      // función.
      if (!MONEDAS.includes(cubre as Moneda)) {
        throw new ErrorDeVenta('COTIZACION_INVALIDA', `moneda desconocida: ${cubre}`)
      }
      const planId = String(p.planId ?? '').trim()
      // Mismo guard que el articuloId: un uuid mal formado hace que Prisma tire
      // un error sin `codigo` —un 500— en vez del error de dominio que el resto
      // de esta función usa.
      if (planId !== '' && !esUuid(planId)) {
        // Mismo criterio que el mensaje homólogo de lib/ventas/crear.ts: sin
        // el id en el texto, porque este mensaje se muestra tal cual.
        throw new ErrorDeVenta(
          'PLAN_INEXISTENTE',
          'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
        )
      }
      return {
        medio: medio as MedioPago,
        moneda: moneda as Moneda,
        cubre: cubre as Moneda,
        base: aDecimal(String(p.base ?? ''), 'el monto del pago'),
        cotizacion: aDecimal(String(p.cotizacion ?? ''), 'la cotización'),
        planId: planId === '' ? undefined : planId,
      }
    })

    const clave = String(datos.get('clave') ?? '').trim()

    const venta = await crearVenta({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      items,
      pagos,
      // Vacía significa "sin clave", no "clave vacía": una cadena vacía
      // repetida haría que el segundo cobro devolviera el primero.
      claveIdempotencia: clave === '' ? undefined : clave,
    })

    revalidatePath('/ventas')
    return { error: null, venta }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * El buscador del punto de venta.
 *
 * Una action y no un route handler: es una lectura del tenant de la sesión, y
 * pasar por `exigirSesion` acá es lo que garantiza que nadie liste el catálogo
 * de otro negocio sin cookie.
 */
export async function buscarArticulos(texto: string): Promise<ArticuloVendible[]> {
  const sesion = await exigirSesion()
  return buscarArticulosVendibles(sesion.tenant.id, texto)
}

export type EstadoCaja = { error: string | null }

/** `abrirCaja`/`cerrarCaja` tiran `ErrorDeCaja`, salvo la pertenencia del
 *  usuario (`exigirUsuario`, compartida con el motor de ventas), que tira
 *  `ErrorDeVenta` — ver el comentario de `errores.ts` sobre por qué esa
 *  función no duplica su propia clase de error para esto. Cualquier otra
 *  cosa se relanza: un bug de verdad tiene que llegar al log, no aplanarse
 *  en un cartel genérico. */
function traducirErrorDeCaja(e: unknown): EstadoCaja {
  if (e instanceof ErrorDeCaja || e instanceof ErrorDeVenta) {
    return { error: e.message }
  }
  throw e
}

/**
 * Abre la caja del turno desde el chip del header de `/vender`.
 *
 * Cualquiera del local abre, dueño o empleado — decisión ya tomada en
 * `lib/caja/abrir-cerrar.ts`, esta action sólo la expone al formulario del
 * chip y traduce el resultado.
 */
export async function abrirCajaDesdeVender(_e: EstadoCaja, datos: FormData): Promise<EstadoCaja> {
  try {
    const sesion = await exigirSesion()
    const saldoInicial = String(datos.get('saldoInicial') ?? '0')
    await abrirCaja(sesion.tenant.id, sesion.usuario.id, saldoInicial)
    // Revalida /vender y no /caja: no existe esa pantalla todavía, y este
    // chip vive únicamente acá.
    revalidatePath('/vender')
    return { error: null }
  } catch (e) {
    return traducirErrorDeCaja(e)
  }
}

/** Cierra la caja del turno en curso, mismo chip.
 *
 * Sin ningún parámetro: no necesita ni el estado previo ni ningún campo del
 * formulario, y `useActionState` la acepta igual como action —una función
 * con MENOS parámetros que los que el llamador puede pasar es asignable al
 * tipo que React espera—, así que declarar `_e`/`datos` sin usarlos sería
 * puro ruido para el linter. */
export async function cerrarCajaDesdeVender(): Promise<EstadoCaja> {
  try {
    const sesion = await exigirSesion()
    await cerrarCaja(sesion.tenant.id, sesion.usuario.id)
    revalidatePath('/vender')
    return { error: null }
  } catch (e) {
    return traducirErrorDeCaja(e)
  }
}
