'use server'

import { revalidatePath } from 'next/cache'
import { exigirPermiso } from '@/lib/permisos/guarda'
import {
  borrarModelo,
  borrarRango,
  cambiarMonedaDeCanje,
  cargarRangosSugeridos,
  crearRango,
  editarRango,
  guardarModelo,
  type CeldaDeCanje,
} from '@/lib/canje/administrar'
import { ErrorDeCanje } from '@/lib/canje/errores'
import { aDecimalOpcional, ErrorDeFormato } from '@/lib/formato/numeros'
import { esUuid } from '@/lib/uuid'

export type EstadoCanje = { error: string | null; aviso: string | null }

// El valor inicial NO vive acá: este archivo es 'use server' y Next convierte
// cada export en un endpoint RPC, así que sólo admite funciones async
// (test/use-server.test.ts lo fija). Vive en formularios.tsx.

/** Prefijo de los campos de valor de una fila: `valor:<id del rango>`. Una
 *  celda por rango, con el id en el nombre del campo, porque la fila se manda
 *  entera y el servidor tiene que saber a qué columna va cada número sin
 *  depender del orden en que el navegador arme el FormData. Repetido en
 *  formularios.tsx, que es quien arma los campos — este archivo no puede
 *  exportar una constante. */
const PREFIJO_VALOR = 'valor:'

/**
 * Sólo los errores que la persona puede corregir tipeando distinto se
 * muestran; el resto se relanza, para que un bug de verdad llegue al log en vez
 * de aplanarse en un cartel rojo genérico. `forbidden()` incluido: se relanza
 * y lo resuelve Next.
 */
function traducir(e: unknown): EstadoCanje {
  if (e instanceof ErrorDeCanje || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

/** Las dos pantallas leen la tabla: la de valores la muestra, la calculadora
 *  cotiza con ella. Revalidar sólo la primera dejaría a un vendedor con la
 *  calculadora abierta cotizando el precio de ayer en su próxima carga. */
function revalidar(): void {
  revalidatePath('/plan-canje/valores')
  revalidatePath('/plan-canje')
}

/** El id de una fila, ya comprobado. Un uuid mal formado hace que Prisma tire
 *  un error sin `codigo` —un 500— en vez del error de dominio. */
function idDe(datos: FormData, codigo: 'RANGO_INEXISTENTE' | 'MODELO_INEXISTENTE'): string {
  const id = String(datos.get('id') ?? '')
  if (!esUuid(id)) {
    throw new ErrorDeCanje(codigo, 'Esa fila ya no está en la tabla. Recargá la pantalla.')
  }
  return id
}

/**
 * Un borde del rango. `Number()` y no `parseInt`: `parseInt("85,5")` da 85 en
 * silencio. El "%" final se acepta porque la cabecera de la tabla lo muestra y
 * quien retipea lo que lee lo escribe — mismo criterio que `leerBateria`.
 * Que sea entero y esté entre 0 y 100 lo valida `lib/canje/administrar.ts`,
 * con su único mensaje.
 */
function bordeDe(datos: FormData, campo: 'minimo' | 'maximo'): number {
  const crudo = String(datos.get(campo) ?? '').trim().replace(/\s*%$/, '')
  const rotulo = campo === 'minimo' ? 'desde' : 'hasta'
  if (crudo === '') throw new ErrorDeCanje('RANGO_INVALIDO', `Falta el porcentaje "${rotulo}".`)
  const n = Number(crudo)
  if (!Number.isInteger(n)) {
    throw new ErrorDeCanje('RANGO_INVALIDO', `El porcentaje "${rotulo}" va en números enteros: 85, no "${crudo}".`)
  }
  return n
}

/**
 * Las celdas de una fila. Cada campo `valor:<rangoId>` que llega es una celda
 * que la persona tenía delante: vacía es `null` ("no se toma ese equipo en
 * ese rango") y con número pasa por la gramática compartida de `lib/formato`
 * —coma decimal, punto de miles, rechazo de lo ambiguo—, la misma de los
 * precios. El rango y el tope los valida `lib/canje/administrar.ts`.
 */
function celdasDe(datos: FormData): CeldaDeCanje[] {
  const celdas: CeldaDeCanje[] = []
  for (const [clave, crudo] of datos.entries()) {
    if (!clave.startsWith(PREFIJO_VALOR)) continue
    const rangoId = clave.slice(PREFIJO_VALOR.length)
    if (!esUuid(rangoId)) {
      throw new ErrorDeCanje('RANGO_INEXISTENTE', 'Uno de los rangos cambió. Recargá la pantalla.')
    }
    celdas.push({ rangoId, valor: aDecimalOpcional(String(crudo), 'el valor') })
  }
  return celdas
}

/** Cada action vuelve a exigir el permiso: que la pantalla no se muestre no es
 *  una defensa, porque una action se puede invocar sin pasar por la pantalla. */
export async function altaDeRango(_e: EstadoCanje, datos: FormData): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    await crearRango({ tenantId: sesion.tenant.id, minimo: bordeDe(datos, 'minimo'), maximo: bordeDe(datos, 'maximo') })
    revalidar()
    return { error: null, aviso: 'El rango quedó en la tabla.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function edicionDeRango(_e: EstadoCanje, datos: FormData): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    await editarRango({
      tenantId: sesion.tenant.id,
      id: idDe(datos, 'RANGO_INEXISTENTE'),
      minimo: bordeDe(datos, 'minimo'),
      maximo: bordeDe(datos, 'maximo'),
    })
    revalidar()
    return { error: null, aviso: 'El rango quedó actualizado. Sus valores no cambiaron.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function bajaDeRango(_e: EstadoCanje, datos: FormData): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    await borrarRango({ tenantId: sesion.tenant.id, id: idDe(datos, 'RANGO_INEXISTENTE') })
    revalidar()
    return { error: null, aviso: 'El rango y sus valores salieron de la tabla.' }
  } catch (e) {
    return traducir(e)
  }
}

/** Sin parámetros: no lee nada del formulario. La pantalla la llama a través
 *  del mismo `ejecutar` que las demás, que le pasa estado y FormData — una
 *  función de menos parámetros es asignable a ese tipo, y los ignora. */
export async function usoDeRangosSugeridos(): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    await cargarRangosSugeridos({ tenantId: sesion.tenant.id })
    revalidar()
    return { error: null, aviso: 'Quedaron los cinco rangos sugeridos. Se pueden editar.' }
  } catch (e) {
    return traducir(e)
  }
}

/** La fila entera: el nombre y todas sus celdas, en una transacción. Sin `id`
 *  (o vacío) es un modelo nuevo. */
export async function guardadoDeModelo(_e: EstadoCanje, datos: FormData): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    const nuevo = String(datos.get('id') ?? '') === ''
    const nombre = String(datos.get('nombre') ?? '')
    await guardarModelo({
      tenantId: sesion.tenant.id,
      id: nuevo ? null : idDe(datos, 'MODELO_INEXISTENTE'),
      nombre,
      valores: celdasDe(datos),
    })
    revalidar()
    return {
      error: null,
      aviso: nuevo ? `"${nombre.trim()}" quedó en la tabla.` : `"${nombre.trim()}" quedó actualizado.`,
    }
  } catch (e) {
    return traducir(e)
  }
}

export async function bajaDeModelo(_e: EstadoCanje, datos: FormData): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    await borrarModelo({ tenantId: sesion.tenant.id, id: idDe(datos, 'MODELO_INEXISTENTE') })
    revalidar()
    return { error: null, aviso: 'El modelo y sus valores salieron de la tabla.' }
  } catch (e) {
    return traducir(e)
  }
}

/** La moneda llega por FormData: es texto de afuera hasta que se reconoce. */
export async function cambioDeMoneda(_e: EstadoCanje, datos: FormData): Promise<EstadoCanje> {
  try {
    const sesion = await exigirPermiso('CANJE_VALORES')
    const moneda = String(datos.get('moneda') ?? '')
    if (moneda !== 'ARS' && moneda !== 'USD') {
      throw new ErrorDeCanje('MONEDA_INVALIDA', `Esa moneda no existe: "${moneda}".`)
    }
    await cambiarMonedaDeCanje({ tenantId: sesion.tenant.id, moneda })
    revalidar()
    return {
      error: null,
      aviso: `La tabla quedó en ${moneda === 'USD' ? 'dólares' : 'pesos'}. Los números no se convirtieron.`,
    }
  } catch (e) {
    return traducir(e)
  }
}
