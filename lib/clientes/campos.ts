import { normalizarTextoLibre } from '@/lib/texto/libre'
import { ErrorDeCliente } from './errores'
import { claveDeTelefono } from './telefono'

/**
 * Los campos de un cliente, ya limpios para guardar, y sus topes.
 *
 * **Puro** —sólo importa módulos sin Prisma—, para que los formularios
 * `'use client'` usen los mismos topes en su `maxLength` que el servidor usa
 * para cortar: el corte no puede ser una sorpresa.
 *
 * **Lo que pasa el tope se corta, no se rechaza**, con la misma mecánica que el
 * detalle de una venta (`normalizarTextoLibre`, lib/texto/libre.ts): el
 * `maxLength` ya impide llegar acá desde la pantalla, y esto es la red para un
 * POST armado a mano. Lo que SÍ se rechaza es lo que no se puede guardar con
 * sentido: un nombre vacío y un email sin forma de email.
 */

export const TOPE_NOMBRE = 120
/** Sobra para "+54 9 11 2233-4455 (de la hija)": el teléfono se guarda como
 *  se tipeó, y la gente le agrega aclaraciones. */
export const TOPE_TELEFONO = 40
export const TOPE_EMAIL = 200
export const TOPE_NOTAS = 1000

export type CamposDeCliente = {
  nombre: string
  telefono: string | null
  email: string | null
  notas: string | null
  aceptaOfertas: boolean
}

export type CamposLimpios = CamposDeCliente & { telefonoClave: string | null }

/**
 * Un email "con forma de email": algo, una arroba, algo, sin espacios. Nada
 * más estricto a propósito: la regla completa del RFC rechaza direcciones
 * reales y acepta otras que ningún proveedor entrega, y lo que este chequeo
 * tiene que atajar es el teléfono tipeado en el campo equivocado.
 */
const FORMA_DE_EMAIL = /^[^\s@]+@[^\s@]+$/

export function limpiarCampos(c: CamposDeCliente): CamposLimpios {
  // Un nombre con saltos de línea es un pegado desde otro lado: se aplanan
  // antes de cortar, para que el listado no muestre un nombre en dos renglones.
  const nombre = normalizarTextoLibre(c.nombre.replace(/\s+/g, ' '), TOPE_NOMBRE)
  if (nombre === null) {
    throw new ErrorDeCliente('NOMBRE_VACIO', 'El cliente necesita un nombre.')
  }
  const telefono = normalizarTextoLibre(c.telefono?.replace(/\s+/g, ' '), TOPE_TELEFONO)
  const email = normalizarTextoLibre(c.email, TOPE_EMAIL)
  if (email !== null && !FORMA_DE_EMAIL.test(email)) {
    throw new ErrorDeCliente(
      'EMAIL_INVALIDO',
      `"${email}" no parece un email: tiene que tener una @ y no llevar espacios.`,
    )
  }
  return {
    nombre,
    telefono,
    email,
    notas: normalizarTextoLibre(c.notas, TOPE_NOTAS),
    aceptaOfertas: c.aceptaOfertas,
    telefonoClave: claveDeTelefono(telefono),
  }
}
