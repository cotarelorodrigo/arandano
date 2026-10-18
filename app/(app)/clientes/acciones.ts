'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirDuenio, exigirSesion } from '@/lib/auth/sesion'
import {
  borrarCliente, buscarClientes, crearCliente, editarCliente, type ClienteEncontrado,
} from '@/lib/clientes/administrar'
import { clientesDelListado } from '@/lib/clientes/consultar'
import { ErrorDeCliente } from '@/lib/clientes/errores'
import { filaCsv } from '@/lib/formato/csv'
import { esUuid } from '@/lib/uuid'
import { ENCABEZADO_CSV_CLIENTES, filaDeCliente } from './csv'

export type EstadoClientes = { error: string | null; aviso: string | null }

// El valor inicial NO vive acá: este archivo es 'use server' y Next convierte
// cada export en un endpoint RPC, así que sólo admite funciones async
// (test/use-server.test.ts lo fija). Vive en formularios.tsx.

/**
 * Sólo los errores que la persona puede corregir tipeando distinto se
 * muestran; el resto se relanza, para que un bug de verdad llegue al log en vez
 * de aplanarse en un cartel rojo genérico. `forbidden()` y `redirect()`
 * incluidos: se relanzan y los resuelve Next.
 */
function traducir(e: unknown): EstadoClientes {
  if (e instanceof ErrorDeCliente) return { error: e.message, aviso: null }
  throw e
}

/** Los campos del formulario de alta y de la ficha, iguales en los dos.
 *  El checkbox nativo manda "1" tildado y nada destildado. */
function camposDe(datos: FormData) {
  const texto = (campo: string) => String(datos.get(campo) ?? '')
  return {
    nombre: texto('nombre'),
    telefono: texto('telefono'),
    email: texto('email'),
    notas: texto('notas'),
    aceptaOfertas: datos.get('aceptaOfertas') === '1',
  }
}

/** El id de la ficha, ya comprobado: un uuid mal formado hace que Prisma tire
 *  un error sin `codigo` —un 500— en vez del aviso que corresponde. */
function idDe(datos: FormData): string {
  const id = String(datos.get('id') ?? '')
  if (!esUuid(id)) throw new ErrorDeCliente('CLIENTE_INEXISTENTE', 'Ese cliente ya no existe. Volvé al listado.')
  return id
}

/**
 * Alta desde /clientes. **Cualquier usuario con sesión**: el vendedor ya puede
 * crear clientes al cobrar y al recibir un equipo, y negárselo acá sería una
 * puerta cerrada con la de al lado abierta (spec, decisión 4).
 */
export async function altaDeCliente(_e: EstadoClientes, datos: FormData): Promise<EstadoClientes> {
  try {
    const sesion = await exigirSesion()
    await crearCliente({ tenantId: sesion.tenant.id, ...camposDe(datos) })
    revalidatePath('/clientes')
    return { error: null, aviso: 'Cliente cargado.' }
  } catch (e) {
    return traducir(e)
  }
}

/** Edición desde la ficha. Cualquier sesión, por lo mismo que el alta. */
export async function edicionDeCliente(_e: EstadoClientes, datos: FormData): Promise<EstadoClientes> {
  try {
    const sesion = await exigirSesion()
    const clienteId = idDe(datos)
    await editarCliente({ tenantId: sesion.tenant.id, clienteId, ...camposDe(datos) })
    revalidatePath('/clientes')
    revalidatePath(`/clientes/${clienteId}`)
    return { error: null, aviso: 'Cambios guardados.' }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * Borrar un cliente sin historia. **Sólo el dueño** (`exigirDuenio`), igual
 * que exportar: no se deshace, y la lista de contactos es del local. No es un
 * permiso delegable en este ciclo (spec, decisión 4).
 *
 * El `redirect` va AFUERA del try: tira una excepción de control que
 * `traducir` relanzaría igual, pero así se lee qué pasa con el éxito.
 */
export async function bajaDeCliente(_e: EstadoClientes, datos: FormData): Promise<EstadoClientes> {
  try {
    const sesion = await exigirDuenio()
    await borrarCliente({ tenantId: sesion.tenant.id, clienteId: idDe(datos) })
    revalidatePath('/clientes')
  } catch (e) {
    return traducir(e)
  }
  redirect('/clientes')
}

/**
 * El CSV de clientes, con la búsqueda y el filtro que estén aplicados en el
 * listado (spec, decisión 7).
 *
 * **Sólo el dueño**: es la base entera de contactos del local en un archivo
 * que sale del sistema y sigue circulando, el mismo criterio que
 * `exportarVentas` del dashboard. Esconder el botón es una de las dos puertas;
 * ésta es la que protege, porque una server action es un endpoint.
 *
 * Sin tope, por lo que explica `clientesDelListado`. Devuelve el texto sin
 * BOM: el BOM lo agrega el botón al armar el Blob, como los otros dos CSV.
 */
export async function exportarClientes(filtro: { texto: string; soloAceptanOfertas: boolean }): Promise<string> {
  const sesion = await exigirDuenio()
  const { clientes } = await clientesDelListado(sesion.tenant.id, {
    texto: typeof filtro?.texto === 'string' ? filtro.texto : '',
    soloAceptanOfertas: filtro?.soloAceptanOfertas === true,
  })
  return [ENCABEZADO_CSV_CLIENTES, ...clientes.map(filaDeCliente)].map(filaCsv).join('\r\n')
}

/**
 * El buscador del selector de cliente (`elegir-cliente.tsx`), que usan el cobro
 * de /vender y el detalle de una venta. Una action y no un route handler: es
 * una lectura del tenant de la sesión, y `exigirSesion` es lo que garantiza
 * que nadie liste los clientes de otro negocio sin cookie. Mismo criterio que
 * `buscarArticulos` de /vender.
 */
export async function buscarClientesDelLocal(texto: string): Promise<ClienteEncontrado[]> {
  const sesion = await exigirSesion()
  return buscarClientes(sesion.tenant.id, typeof texto === 'string' ? texto : '', 8)
}
