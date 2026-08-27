import { Prisma } from '@/generated/prisma/client'
import type { MedioPago } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { excedeEscala, ESCALA_PORCENTAJE } from '@/lib/ventas/totales'
import { ErrorDePlan } from './errores'

/** Exclusivo: en -100 % el pago queda en cero, y por debajo el local pagaría
 *  por vender. Se valida acá, al guardar, y no al cobrar: es donde la persona
 *  tiene el número delante y lo puede corregir. */
const PORCENTAJE_MINIMO = new Prisma.Decimal('-100')
/** Lo que entra en Decimal(6,3). Más que eso no es un recargo, es un typo. */
const PORCENTAJE_MAXIMO = new Prisma.Decimal('999.999')
/** Doce cuotas es lo habitual; 120 es holgura, no un límite pensado. */
const CUOTAS_MAXIMAS = 120

export type EntradaDePlan = {
  tenantId: string
  nombre: string
  medio: MedioPago
  cuotas: number
  recargoPorcentaje: Prisma.Decimal
  orden?: number
}

export type EdicionDePlan = Omit<EntradaDePlan, 'medio'> & { id: string; orden: number }

function validar(e: { nombre: string; cuotas: number; recargoPorcentaje: Prisma.Decimal }) {
  if (e.nombre.trim() === '') {
    throw new ErrorDePlan('NOMBRE_VACIO', 'El plan necesita un nombre.')
  }
  if (!Number.isInteger(e.cuotas) || e.cuotas < 1 || e.cuotas > CUOTAS_MAXIMAS) {
    throw new ErrorDePlan('CUOTAS_INVALIDAS', 'Las cuotas van de 1 a 120.')
  }
  if (
    e.recargoPorcentaje.lessThanOrEqualTo(PORCENTAJE_MINIMO) ||
    e.recargoPorcentaje.greaterThan(PORCENTAJE_MAXIMO)
  ) {
    throw new ErrorDePlan(
      'PORCENTAJE_INVALIDO',
      'El recargo va de -99,999 % a 999,999 %.',
    )
  }
  if (excedeEscala(e.recargoPorcentaje, ESCALA_PORCENTAJE)) {
    throw new ErrorDePlan(
      'PORCENTAJE_INVALIDO',
      'El recargo tiene a lo sumo tres decimales.',
    )
  }
}

/** P2002 = violación de unicidad. Acá sólo puede ser (tenant_id, medio, nombre):
 *  es la única de esta tabla, así que no hace falta mirar qué constraint fue —
 *  y bajo `arandano_app` ese detalle no está disponible de todos modos (ver
 *  `esP2002` en lib/ventas/crear.ts). */
function esRepetido(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

export async function crearPlan(e: EntradaDePlan): Promise<{ id: string }> {
  validar(e)
  try {
    const creado = await prismaParaTenant(e.tenantId).planDePago.create({
      // tenantId explícito: PlanDePago no está en MODELOS_CON_TENANT
      // (lib/tenant/prisma.ts), así que la extensión no lo autocompleta.
      data: {
        tenantId: e.tenantId,
        nombre: e.nombre.trim(),
        medio: e.medio,
        cuotas: e.cuotas,
        recargoPorcentaje: e.recargoPorcentaje,
        orden: e.orden ?? 0,
      },
      select: { id: true },
    })
    return creado
  } catch (err) {
    if (esRepetido(err)) {
      throw new ErrorDePlan('NOMBRE_REPETIDO', `Ya hay un plan que se llama "${e.nombre.trim()}".`)
    }
    throw err
  }
}

export async function editarPlan(e: EdicionDePlan): Promise<void> {
  validar(e)
  try {
    // updateMany y no update: `update` tira P2025 sobre una fila que no existe,
    // pero también sobre una que existe y RLS no deja ver — y ésas son la misma
    // situación para el llamador. `count` cero las cubre a las dos con un solo
    // error propio.
    const { count } = await prismaParaTenant(e.tenantId).planDePago.updateMany({
      where: { id: e.id },
      data: {
        nombre: e.nombre.trim(),
        cuotas: e.cuotas,
        recargoPorcentaje: e.recargoPorcentaje,
        orden: e.orden,
      },
    })
    if (count === 0) throw new ErrorDePlan('PLAN_INEXISTENTE', 'Ese plan no está en este local.')
  } catch (err) {
    if (esRepetido(err)) {
      throw new ErrorDePlan('NOMBRE_REPETIDO', `Ya hay un plan que se llama "${e.nombre.trim()}".`)
    }
    throw err
  }
}

/** Idempotente: `updateMany` sobre cero filas no se queja, y dos clicks
 *  seguidos en el menú mandan la orden dos veces. */
export async function desactivarPlan({ tenantId, id }: { tenantId: string; id: string }): Promise<void> {
  await prismaParaTenant(tenantId).planDePago.updateMany({
    where: { id, desactivadoEn: null },
    data: { desactivadoEn: new Date() },
  })
}

export async function reactivarPlan({ tenantId, id }: { tenantId: string; id: string }): Promise<void> {
  await prismaParaTenant(tenantId).planDePago.updateMany({
    where: { id, desactivadoEn: { not: null } },
    data: { desactivadoEn: null },
  })
}
