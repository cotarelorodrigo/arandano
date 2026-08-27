'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@/generated/prisma/client'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { crearPlan, editarPlan, desactivarPlan, reactivarPlan } from '@/lib/planes/administrar'
import { ErrorDePlan } from '@/lib/planes/errores'
import { ErrorDeFormato } from '@/lib/formato/numeros'
import { MEDIOS, type Medio } from '@/lib/ventas/medios'
import { esUuid } from '@/lib/uuid'

export type EstadoPlanes = { error: string | null; aviso: string | null }

// El valor inicial NO vive acá: este archivo es 'use server' y ahí Next
// convierte cada export en un endpoint RPC, así que sólo admite funciones async
// (test/use-server.test.ts lo fija). Vive en formularios.tsx.

/**
 * Sólo los errores que la persona puede corregir tipeando distinto se
 * muestran; el resto se relanza, para que un bug de verdad llegue al log en vez
 * de aplanarse en un cartel rojo genérico.
 *
 * La validación del porcentaje y de las cuotas vive en `lib/planes/administrar.ts`
 * y no se repite acá: acá sólo se traduce lo que ese módulo tira.
 */
function traducir(e: unknown): EstadoPlanes {
  if (e instanceof ErrorDePlan || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

/** El medio llega por FormData: es texto de afuera hasta que el catálogo lo
 *  reconoce. Sin esto, un valor inventado llegaría hasta el enum de Postgres y
 *  volvería como 500 en vez de como cartel. */
function medioDe(datos: FormData): Medio {
  const medio = String(datos.get('medio') ?? '')
  if (!(MEDIOS as readonly string[]).includes(medio)) {
    throw new ErrorDePlan('MEDIO_INVALIDO', `Esa forma de pago no existe: "${medio}".`)
  }
  return medio as Medio
}

function cuotasDe(datos: FormData): number {
  const crudo = String(datos.get('cuotas') ?? '1').trim()
  // Number() y no parseInt: parseInt("3 cuotas") da 3 en silencio, y lo que se
  // quiere acá es rechazar lo que no sea un número entero pelado.
  const cuotas = Number(crudo)
  if (!Number.isInteger(cuotas)) {
    // El mensaje habla de lo que ESTE guard mira, no del rango: `3,5` —el error
    // realista— no se arregla leyendo "van de 1 a 120". El rango lo valida
    // `lib/planes/administrar.ts`, y su redacción vive sólo ahí.
    throw new ErrorDePlan('CUOTAS_INVALIDAS', 'Las cuotas tienen que ser un número entero.')
  }
  return cuotas
}

/**
 * Un número con signo y, si lleva, decimales. Sin separador de miles: ver el
 * comentario de `porcentajeDe`. La coma y el punto valen lo mismo.
 *
 * **El `+` se acepta y no sólo el `-`**: la tabla muestra `+40%`
 * (`formatearPorcentaje`), así que quien retipee lo que está leyendo escribe
 * `+40` — rechazárselo sería castigarlo por copiar lo que la pantalla le
 * mostró. `Prisma.Decimal` lo normaliza a `40` sin más.
 *
 * La cantidad de decimales no se topea acá aunque la columna sea `Decimal(6,3)`:
 * `validar` (lib/planes/administrar.ts) ya rechaza el cuarto decimal con el
 * mensaje que dice qué hacer, y duplicar el límite en dos lugares es lo que los
 * desincroniza.
 */
const RECARGO_TIPEADO = /^[+-]?\d+(?:[.,]\d+)?$/

/**
 * El recargo tipeado, con su signo.
 *
 * **NO pasa por `aDecimal`** —la gramática compartida de `lib/formato`— y eso
 * es deliberado: `aDecimalCanonico` rechaza el signo por diseño ("nada de lo
 * que este parser alimenta —precio, cantidad ingresada, stock contado— puede
 * serlo"), y el porcentaje del plan SÍ lo lleva: −10 % es el descuento por pago
 * contado, tan común acá como el recargo por cuotas. Extender esa gramática
 * para aceptar signos abriría negativos en precio, cantidad y stock, que es
 * justo lo que ese archivo decidió cerrar (Ruling 3 de este ciclo).
 *
 * Tampoco hereda su rechazo de lo ambiguo, y por un motivo que sólo vale acá:
 * esa gramática rechaza un separador seguido de tres dígitos (`999.999`)
 * porque tanto puede ser miles como decimales — un celular de `850.000` no
 * puede quedar cargado a 850. **Un porcentaje no tiene esa ambigüedad**: está
 * topeado en 999,999, así que nunca lleva separador de miles y el separador
 * sólo puede ser el decimal. Sin esta excepción, un recargo de tres decimales
 * sería inentrable en el único campo que `Decimal(6,3)` existe para guardar.
 */
function porcentajeDe(datos: FormData): Prisma.Decimal {
  // `.trim()` y NO `replace(/\s/g, '')`: sacar TODOS los espacios convierte
  // `4 0` en cuarenta y `1 3,7` en trece coma siete, o sea acepta un error de
  // tipeo como si fuera otro número. Es la misma regla que `lib/formato/
  // gramatica.ts` aplica a la plata —rechazar en vez de adivinar—, y la que ya
  // usa `cuotasDe` acá arriba.
  const crudo = String(datos.get('porcentaje') ?? '').trim()
  if (crudo === '') {
    throw new ErrorDeFormato('NUMERO_INVALIDO', 'Falta el recargo.')
  }
  if (!RECARGO_TIPEADO.test(crudo)) {
    throw new ErrorDeFormato(
      'NUMERO_INVALIDO',
      `El recargo no es un número: "${crudo}". Escribilo como 40, 13,755 o -10.`,
    )
  }
  return new Prisma.Decimal(crudo.replace(',', '.'))
}

/** El orden del mostrador, sólo en la edición. Mismo criterio que `cuotasDe`:
 *  un valor que no parsea llegaría a Prisma como NaN y volvería como 500. */
function ordenDe(datos: FormData): number {
  const orden = Number(String(datos.get('orden') ?? '0').trim())
  if (!Number.isInteger(orden)) {
    throw new ErrorDePlan('ORDEN_INVALIDO', 'El orden tiene que ser un número entero.')
  }
  return orden
}

/** El id de una fila, ya comprobado. Mismo guard que en `cobrar()`: un uuid mal
 *  formado hace que Prisma tire un error sin `codigo` —un 500— en vez del error
 *  de dominio que el resto de este archivo usa. */
function idDe(datos: FormData): string {
  const id = String(datos.get('id') ?? '')
  if (!esUuid(id)) throw new ErrorDePlan('PLAN_INEXISTENTE', 'Ese plan no está en este local.')
  return id
}

/** Cada action vuelve a exigir el permiso: que la pantalla no se muestre no es
 *  una defensa, porque una action se puede invocar sin pasar por la pantalla. */
export async function altaDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    const nombre = String(datos.get('nombre') ?? '').trim()
    const cuotas = cuotasDe(datos)
    await crearPlan({
      tenantId: sesion.tenant.id,
      nombre,
      medio: medioDe(datos),
      cuotas,
      recargoPorcentaje: porcentajeDe(datos),
      // El orden sale de las cuotas y no de un campo propio: es lo que hace que
      // 3 cuotas salga antes que 12 sin que nadie ordene nada a mano. La
      // edición sí lo deja tocar.
      orden: cuotas,
    })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: `"${nombre}" quedó disponible en el mostrador.` }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * El `medio` NO se edita: cambiar de medio es dar de baja y crear otro.
 *
 * El medio es lo que define contra qué pagos sirve el plan, y moverlo dejaría
 * las ventas viejas apuntando a un plan que ya no describe cómo se cobraron.
 */
export async function edicionDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    const id = idDe(datos)
    const nombre = String(datos.get('nombre') ?? '').trim()
    await editarPlan({
      tenantId: sesion.tenant.id,
      id,
      nombre,
      cuotas: cuotasDe(datos),
      recargoPorcentaje: porcentajeDe(datos),
      orden: ordenDe(datos),
    })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: `"${nombre}" quedó actualizado.` }
  } catch (e) {
    return traducir(e)
  }
}

/** Baja LÓGICA: un plan que ya cobró ventas es indestructible por la FK
 *  Restrict de `pagos`, y esas ventas tienen que seguir diciendo con qué plan
 *  se cobraron. */
export async function bajaDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    await desactivarPlan({ tenantId: sesion.tenant.id, id: idDe(datos) })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: 'El plan ya no se ofrece en el mostrador.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function reactivacionDePlan(
  _e: EstadoPlanes,
  datos: FormData,
): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    await reactivarPlan({ tenantId: sesion.tenant.id, id: idDe(datos) })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: 'El plan vuelve al mostrador.' }
  } catch (e) {
    return traducir(e)
  }
}
