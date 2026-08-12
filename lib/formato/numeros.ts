import { Prisma } from '@/generated/prisma/client'
import { aDecimalCanonico, estaVacio, ErrorDeFormato } from './gramatica'

// Re-exportados desde acá para que los llamadores que ya importaban
// `ErrorDeFormato` de este archivo sigan andando: la gramática se mudó a
// gramatica.ts —que no importa Prisma, para que la pueda usar el punto de venta
// en el navegador— y este archivo quedó como la envoltura que le pone
// `Prisma.Decimal` encima. La clase es LA MISMA, así que un `instanceof`
// contra cualquiera de los dos módulos da lo mismo.
export { ErrorDeFormato }
export type { CodigoErrorDeFormato } from './gramatica'

/**
 * El texto de un campo, convertido a `Decimal`.
 *
 * Las reglas —qué es un número, qué es ambiguo, por qué— viven en
 * `gramatica.ts`. Acá sólo queda la conversión al tipo que la base guarda.
 */
export function aDecimal(texto: string, campo: string): Prisma.Decimal {
  return new Prisma.Decimal(aDecimalCanonico(texto, campo))
}

/** Igual, pero el vacío es `null` y no un error: el campo es opcional. */
export function aDecimalOpcional(texto: string, campo: string): Prisma.Decimal | null {
  return estaVacio(texto) ? null : aDecimal(texto, campo)
}
