import { prismaParaTenant } from '@/lib/tenant/prisma'
import type { MonedaDeCanje } from './calculo'

/**
 * La tabla del plan canje tal como la miran las dos pantallas.
 *
 * Los valores van como `string` (el `toString()` del Decimal) y no como
 * `Decimal`, por lo mismo que `PlanVisible.porcentaje`: esto cruza a un
 * componente cliente, y el `Decimal` de Prisma no viaja sin arrastrar el
 * cliente de Prisma al bundle.
 *
 * `valores` es un mapa por id de rango y no un arreglo alineado con `rangos`:
 * una celda vacía es AUSENCIA de clave, que es exactamente lo que es en la base
 * (no hay fila), y nadie tiene que acordarse de en qué posición iba cada rango.
 */
export type RangoVisible = { id: string; minimo: number; maximo: number }
export type ModeloVisible = { id: string; nombre: string; valores: Record<string, string> }
export type TablaDeCanje = {
  moneda: MonedaDeCanje
  rangos: RangoVisible[]
  modelos: ModeloVisible[]
}

/** La moneda de una tabla que nadie configuró todavía. Ver el comentario de
 *  `ConfiguracionDeCanje` en el schema: el pedido es de un local que vende
 *  iPhones en dólares. Repetido del `@default(USD)` de la columna a propósito
 *  —la fila puede no existir, y entonces el default de la columna no llega a
 *  aplicarse—, y atado a él por el test "sin configurar es USD". */
export const MONEDA_POR_DEFECTO: MonedaDeCanje = 'USD'

// Español y numérico: "iPhone 8" antes que "iPhone 11", que es como se piensa
// una línea de modelos, y sin distinguir mayúsculas — "iphone 14" no se va al
// final de la lista por estar escrito en minúscula.
const POR_NOMBRE = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/**
 * La tabla entera de un local: la moneda, los rangos de mayor a menor batería
 * y los modelos con sus celdas.
 *
 * **Tres lecturas y no una transacción**: es una pantalla que se mira, no una
 * cuenta que se cierra. Si el dueño borra un rango entre la primera y la
 * tercera, la peor consecuencia es una clave en `valores` que ninguna columna
 * dibuja — y el próximo render ya no la trae.
 *
 * Los rangos se ordenan por `minimo` descendente. Como no se solapan (lo
 * garantiza `lib/canje/administrar.ts`), ese orden es total: no hace falta
 * desempate.
 */
export async function tablaDeCanje(tenantId: string): Promise<TablaDeCanje> {
  const db = prismaParaTenant(tenantId)
  const [configuracion, rangos, modelos] = await Promise.all([
    db.configuracionDeCanje.findUnique({ where: { tenantId }, select: { moneda: true } }),
    db.rangoDeBateria.findMany({
      orderBy: { minimo: 'desc' },
      select: { id: true, minimo: true, maximo: true },
    }),
    db.modeloDeCanje.findMany({
      select: { id: true, nombre: true, valores: { select: { rangoId: true, valor: true } } },
    }),
  ])

  return {
    moneda: configuracion?.moneda ?? MONEDA_POR_DEFECTO,
    rangos,
    modelos: modelos
      .map((m) => ({
        id: m.id,
        nombre: m.nombre,
        valores: Object.fromEntries(m.valores.map((v) => [v.rangoId, v.valor.toString()])),
      }))
      .sort((a, b) => POR_NOMBRE.compare(a.nombre, b.nombre)),
  }
}
