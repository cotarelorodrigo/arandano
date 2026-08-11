'use server'

import { revalidatePath } from 'next/cache'
import { exigirSesion, exigirDuenio } from '@/lib/auth/sesion'
import {
  crearArticulo,
  editarArticulo,
  desactivarArticulo,
  reactivarArticulo,
} from '@/lib/inventario/articulos'
import { ingresarStock, corregirStock } from '@/lib/inventario/stock'
import { ErrorDeInventario } from '@/lib/inventario/errores'
import { aDecimal, aDecimalOpcional, ErrorDeFormato } from '@/lib/formato/numeros'

export type EstadoInventario = { error: string | null; aviso: string | null }

// El valor inicial NO vive acá, aunque sea lo natural: este archivo es
// 'use server', y ahí Next.js convierte cada export en un endpoint RPC, así que
// sólo admite funciones async. Exportar una constante hace que el módulo falle
// al evaluarse —en runtime, con el build en verde— y tira abajo la pantalla
// entera. Vive en formularios.tsx, igual que en usuarios y en login.
// test/use-server.test.ts lo fija.

/** Sólo el dueño: el precio es plata y el catálogo es decisión del negocio. */
async function comoDuenio<T>(fn: (tenantId: string, usuarioId: string) => Promise<T>) {
  const sesion = await exigirDuenio()
  return fn(sesion.tenant.id, sesion.usuario.id)
}

/**
 * Cualquiera con sesión. Recibir una caja del proveedor y corregir un faltante
 * es operación del día, la hace quien está atendiendo, y no queda anónima:
 * el movimiento se firma con este `usuarioId`.
 */
async function conSesion<T>(fn: (tenantId: string, usuarioId: string) => Promise<T>) {
  const sesion = await exigirSesion()
  return fn(sesion.tenant.id, sesion.usuario.id)
}

/**
 * Sólo los errores de dominio se muestran; el resto se relanza.
 *
 * Tragar un error desconocido lo convertiría en un cartel rojo genérico en la
 * pantalla, y el bug quedaría sin llegar nunca a Sentry ni al log. Los dos que
 * SÍ se muestran son los dos que la persona puede corregir tipeando distinto.
 *
 * `ErrorDeVenta` NO está en la lista, y no es un olvido: el único que puede
 * llegar por acá es el `USUARIO_INEXISTENTE` de `exigirUsuario`, y con una
 * sesión válida no puede pasar —RLS garantiza que el usuario de la sesión es de
 * este tenant—. Si pasa, es un bug y tiene que verse como tal.
 */
function traducir(e: unknown): EstadoInventario {
  if (e instanceof ErrorDeInventario || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim()

export async function altaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const tipo = datos.get('tipo') === 'SERVICIO' ? 'SERVICIO' : 'PRODUCTO'
    const creado = await comoDuenio((tenantId, usuarioId) =>
      crearArticulo({
        tenantId,
        usuarioId,
        nombre: texto(datos, 'nombre'),
        tipo,
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        sku: texto(datos, 'sku'),
        // Un servicio no lleva stock, y sin JavaScript los campos se ven
        // igual: se ignoran acá en vez de rechazar el alta por algo que la
        // persona no eligió mandar.
        stockInicial:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'stockInicial'), 'el stock inicial') : null,
        costoUnitario:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo') : null,
      }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: `Artículo creado con el código ${creado.sku}.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function guardarArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoDuenio((tenantId) =>
      editarArticulo({
        tenantId,
        articuloId,
        nombre: texto(datos, 'nombre'),
        sku: texto(datos, 'sku'),
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Cambios guardados.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function bajaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoDuenio((tenantId) => desactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo desactivado. Su historial queda intacto.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function reactivarArticuloAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoDuenio((tenantId) => reactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo reactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function ingresarMercaderia(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    const cantidad = aDecimal(texto(datos, 'cantidad'), 'la cantidad')
    await conSesion((tenantId, usuarioId) =>
      ingresarStock({
        tenantId,
        articuloId,
        cantidad,
        usuarioId,
        costoUnitario: aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo'),
        nota: texto(datos, 'nota') || undefined,
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `Ingresaron ${cantidad.toString()} unidades.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function corregirPorConteo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    const stockContado = aDecimal(texto(datos, 'stockContado'), 'el conteo')
    await conSesion((tenantId, usuarioId) =>
      corregirStock({
        tenantId,
        articuloId,
        stockContado,
        usuarioId,
        nota: texto(datos, 'nota') || undefined,
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `El stock quedó en ${stockContado.toString()}.` }
  } catch (e) {
    return traducir(e)
  }
}
