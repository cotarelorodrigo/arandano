'use server'

import { revalidatePath } from 'next/cache'
import { exigirSesion } from '@/lib/auth/sesion'
import { crearVenta } from '@/lib/ventas/crear'
import { ErrorDeVenta } from '@/lib/ventas/errores'
import { buscarArticulosVendibles, type ArticuloVendible } from '@/lib/ventas/buscar'
import { aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'
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
      return {
        articuloId: String(i.articuloId ?? ''),
        cantidad: aDecimal(String(i.cantidad ?? ''), 'la cantidad'),
      }
    })

    const pagos = listaDeJson(datos, 'pagos').map((crudo) => {
      const p = crudo as { medio?: unknown; moneda?: unknown; monto?: unknown; cotizacion?: unknown }
      const medio = String(p.medio ?? '')
      const moneda = String(p.moneda ?? '')
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
      return {
        medio: medio as MedioPago,
        moneda: moneda as Moneda,
        monto: aDecimal(String(p.monto ?? ''), 'el monto del pago'),
        cotizacion: aDecimal(String(p.cotizacion ?? ''), 'la cotización'),
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
