'use server'

import { revalidatePath } from 'next/cache'
import { exigirDuenio } from '@/lib/auth/sesion'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { ErrorDeBot } from '@/lib/bot/errores'
import { ErrorDeKapso } from '@/lib/bot/kapso'
import {
  alternarActivo,
  confirmarNumero,
  desconectar,
  generarEnlace,
  guardarInstrucciones,
} from '@/lib/bot/administrar'

/**
 * Las acciones de `/bot`.
 *
 * **Cada una vuelve a exigir lo suyo.** Que la pantalla no se muestre no es una
 * defensa: una server action es un endpoint y se invoca sin pasar por la
 * pantalla. Y el reparto no es uniforme, a propósito — conectar y desconectar
 * son `exigirDuenio()` porque mueven la identidad de WhatsApp del local y una
 * relación con un tercero; prender, apagar y editar lo que el bot responde son
 * `exigirPermiso('BOT')` porque operan el negocio. Es la misma regla que separó
 * `PLANES_PAGO` de `ARTICULOS_EDITAR`: se delega lo que opera el negocio, no lo
 * que reparte poder.
 */

export type EstadoBot = {
  error: string | null
  aviso: string | null
  /** El enlace de onboarding, cuando la acción lo acaba de generar. */
  enlace: string | null
}

/**
 * Estas acciones reciben ARGUMENTOS TIPADOS y no `(estado, FormData)`.
 *
 * La firma de dos parámetros que usan /formas-de-pago y /usuarios existe para
 * `useActionState`, que la exige. Acá ninguna acción se dispara desde un
 * `<form action={...}>` —son todas botones y un switch, con `useTransition`—,
 * así que esa firma no compraría nada y obligaría a empaquetar un booleano en
 * un FormData para volver a leerlo como texto del otro lado.
 */

/**
 * Sólo los errores corregibles se muestran; el resto se relanza para que llegue
 * al log. Un `ErrorDeKapso` es corregible en el sentido que importa: el dueño
 * puede reintentar, y su mensaje ya viene redactado en castellano.
 */
function traducir(e: unknown): EstadoBot {
  if (e instanceof ErrorDeBot || e instanceof ErrorDeKapso) {
    return { error: e.message, aviso: null, enlace: null }
  }
  throw e
}

export async function generarEnlaceDeConexion(): Promise<EstadoBot> {
  try {
    const sesion = await exigirDuenio()
    const url = await generarEnlace({
      tenantId: sesion.tenant.id,
      nombreLocal: sesion.tenant.nombre,
      subdominio: sesion.subdominio,
    })
    revalidatePath('/bot')
    return {
      error: null,
      aviso: 'Abrí el enlace y entrá con la cuenta de Facebook del negocio.',
      enlace: url,
    }
  } catch (e) {
    return traducir(e)
  }
}

export async function confirmarNumeroDelLocal(phoneNumberId: string): Promise<EstadoBot> {
  try {
    const sesion = await exigirDuenio()
    await confirmarNumero({
      tenantId: sesion.tenant.id,
      subdominio: sesion.subdominio,
      phoneNumberId,
    })
    revalidatePath('/bot')
    return {
      error: null,
      aviso: 'Número conectado. Prendé el bot cuando quieras que empiece a contestar.',
      enlace: null,
    }
  } catch (e) {
    return traducir(e)
  }
}

export async function desconectarNumero(): Promise<EstadoBot> {
  try {
    const sesion = await exigirDuenio()
    await desconectar(sesion.tenant.id)
    revalidatePath('/bot')
    return { error: null, aviso: 'El número quedó desconectado.', enlace: null }
  } catch (e) {
    return traducir(e)
  }
}

export async function prenderOApagar(activo: boolean): Promise<EstadoBot> {
  try {
    const sesion = await exigirPermiso('BOT')
    await alternarActivo(sesion.tenant.id, activo)
    revalidatePath('/bot')
    return {
      error: null,
      aviso: activo ? 'El bot está contestando.' : 'El bot dejó de contestar.',
      enlace: null,
    }
  } catch (e) {
    return traducir(e)
  }
}

export async function guardarInformacionDelLocal(instrucciones: string): Promise<EstadoBot> {
  try {
    const sesion = await exigirPermiso('BOT')
    await guardarInstrucciones(sesion.tenant.id, instrucciones)
    revalidatePath('/bot')
    return { error: null, aviso: 'Guardado.', enlace: null }
  } catch (e) {
    return traducir(e)
  }
}
