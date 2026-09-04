import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { costoTotalDeArticulo } from './valuacion'

const d = (v: string) => new Prisma.Decimal(v)

describe('costoTotalDeArticulo', () => {
  it('multiplica el stock por el último costo conocido', () => {
    expect(costoTotalDeArticulo(d('30'), d('7400'))?.toString()).toBe('222000')
  })

  // La diferencia entre "no se sabe" y "no vale nada". Un cero acá afirmaría
  // que la mercadería no vale plata, que es otra cosa — mismo criterio que
  // `textoDeMargen` y `margenDe`, que devuelven null en vez de 0 %.
  it('sin costo cargado no hay número, y no es cero', () => {
    expect(costoTotalDeArticulo(d('30'), null)).toBeNull()
  })

  // Vender sin stock no está frenado (lib/ventas/crear.ts), así que el stock
  // puede quedar negativo. Eso es un error de carga, no mercadería que valga
  // plata negativa: restarla del total del local lo achicaría sin que nadie
  // sepa por qué.
  it('un stock negativo cuenta como cero, no resta', () => {
    expect(costoTotalDeArticulo(d('-2'), d('7400'))?.toString()).toBe('0')
  })

  // El otro lado del clamp: acá SÍ se sabe el costo y SÍ se puede afirmar el
  // número, y el número es cero. El tile se dibuja diciendo $ 0,00, coherente
  // con el "En stock: 0" de al lado.
  it('stock cero con costo cargado es cero, no null', () => {
    expect(costoTotalDeArticulo(d('0'), d('7400'))?.toString()).toBe('0')
  })

  // `stock` es Decimal(12,3) y `costoUnitario` Decimal(12,2), así que el
  // producto puede tener cinco decimales: 1,5 × 333,33 = 499,995. La plata se
  // muestra con dos, y el redondeo tiene que ser el mismo que usa el resto del
  // motor (redondearDinero, ROUND_HALF_UP).
  it('redondea a dos decimales con el mismo criterio que el resto de la plata', () => {
    expect(costoTotalDeArticulo(d('1.5'), d('333.33'))?.toString()).toBe('500')
  })
})
