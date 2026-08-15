'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSesion, exigirDuenio } from '@/lib/auth/sesion'
import { crearOrden } from '@/lib/ordenes-de-trabajo/crear'
import { cambiarEstado, guardarDiagnostico, anularOrden } from '@/lib/ordenes-de-trabajo/operaciones'
import { ErrorDeOrden } from '@/lib/ordenes-de-trabajo/errores'
import { ErrorDeCliente } from '@/lib/clientes/errores'
import { aDecimalOpcional, ErrorDeFormato } from '@/lib/formato/numeros'
import type { EstadoOrden } from '@/generated/prisma/client'
import { ESTADOS } from '@/lib/ordenes-de-trabajo/estados'

export type EstadoServicio = { error: string | null; aviso: string | null }

// El valor inicial NO se exporta desde acá: este archivo es 'use server', y ahí
// Next convierte cada export en un endpoint RPC, así que sólo admite funciones
// async. Vive en formularios.tsx. Lo fija test/use-server.test.ts.

/**
 * Sólo los errores de dominio se muestran; el resto se relanza.
 *
 * Tragar un error desconocido lo convertiría en un cartel rojo genérico y el
 * bug quedaría sin llegar nunca a Sentry ni al log. Los tres que SÍ se muestran
 * son los que la persona puede corregir tipeando distinto.
 */
function traducir(e: unknown): EstadoServicio {
  if (e instanceof ErrorDeOrden || e instanceof ErrorDeCliente || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim()

function esEstado(v: string): v is EstadoOrden {
  return (ESTADOS as readonly string[]).includes(v)
}

export async function recibirEquipo(
  _e: EstadoServicio,
  datos: FormData,
): Promise<EstadoServicio> {
  const sesion = await exigirSesion()
  let destino: string | null = null
  try {
    // El cliente puede venir elegido de la lista o escrito para crear al vuelo.
    // Nunca los dos: si vino id, se usa ese.
    //
    // El alta al vuelo NO se hace acá: se le pasa a crearOrden, que la resuelve
    // adentro de la transacción de la orden y después del camino rápido de la
    // idempotencia. Creado antes y comiteado aparte, el segundo submit de un
    // doble click creaba un segundo "Juan Pérez" y recién después devolvía la
    // orden que ya existía — la clave protegía la orden y no al cliente.
    const clienteId = texto(datos, 'clienteId')

    const orden = await crearOrden({
      // De la SESIÓN y nunca del formulario, que lo manda el navegador.
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ...(clienteId
        ? { clienteId }
        : {
            clienteNuevo: {
              nombre: texto(datos, 'clienteNombre'),
              telefono: texto(datos, 'clienteTelefono') || null,
            },
          }),
      equipoMarca: texto(datos, 'equipoMarca'),
      equipoModelo: texto(datos, 'equipoModelo'),
      equipoSerie: texto(datos, 'equipoSerie') || null,
      claveDesbloqueo: texto(datos, 'claveDesbloqueo') || null,
      fallaDeclarada: texto(datos, 'fallaDeclarada'),
      accesorios: texto(datos, 'accesorios') || null,
      danosVisibles: texto(datos, 'danosVisibles') || null,
      claveIdempotencia: texto(datos, 'claveIdempotencia') || undefined,
    })
    revalidatePath('/servicio-tecnico')
    destino = `/servicio-tecnico/${orden.id}/ticket`
  } catch (e) {
    return traducir(e)
  }
  // FUERA del try: redirect() señaliza con una excepción, y adentro del catch
  // `traducir` la relanzaría como si fuera un bug. Es el mismo cuidado que ya
  // tiene app/login/acciones.ts.
  redirect(destino)
}

export async function moverEstado(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio> {
  const sesion = await exigirSesion()
  try {
    const hasta = texto(datos, 'hasta')
    if (!esEstado(hasta)) {
      return { error: 'ese estado no existe', aviso: null }
    }
    await cambiarEstado({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ordenId: texto(datos, 'ordenId'),
      hasta,
      nota: texto(datos, 'nota') || null,
    })
    revalidatePath('/servicio-tecnico')
    return { error: null, aviso: 'Listo, la orden se movió.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function diagnosticar(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio> {
  const sesion = await exigirSesion()
  try {
    await guardarDiagnostico({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ordenId: texto(datos, 'ordenId'),
      diagnostico: texto(datos, 'diagnostico'),
      montoEstimado: aDecimalOpcional(texto(datos, 'montoEstimado'), 'el monto estimado'),
    })
    revalidatePath('/servicio-tecnico')
    return { error: null, aviso: 'Diagnóstico guardado.' }
  } catch (e) {
    return traducir(e)
  }
}

/** Sólo el dueño: anular es lo único destructivo del módulo. Mismo corte que
 *  la anulación de una venta. */
export async function anular(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio> {
  const sesion = await exigirDuenio()
  try {
    await anularOrden({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ordenId: texto(datos, 'ordenId'),
    })
    revalidatePath('/servicio-tecnico')
    return { error: null, aviso: 'Orden anulada.' }
  } catch (e) {
    return traducir(e)
  }
}
