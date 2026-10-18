import { Prisma } from '@/generated/prisma/client'
import { aDecimal } from '@/lib/formato/numeros'
import { estaVacio } from '@/lib/formato/gramatica'
import { formatearCotizacion } from '@/lib/formato/mostrar'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { excedeEscala, ESCALA_DINERO } from '@/lib/ventas/totales'
import { ErrorDeCotizacion } from './errores'
import { esSaltoGrande, SALTO_QUE_PIDE_CONFIRMAR_PORCENTAJE } from './reglas'

/**
 * Lo único que escribe la cotización del dólar: una fila nueva. Nunca se edita
 * ni se borra una (el rol de la app ni siquiera puede, ver
 * `scripts/setup-db-roles.sh`); corregir es cargar otra.
 *
 * La action que llama acá exige el permiso `COTIZACION` antes. Esta función no
 * lo mira: recibe el `usuarioId` ya autenticado, igual que el resto de los
 * `lib/*` que escriben.
 *
 * **`CotizacionDelDolar` no está en `MODELOS_CON_TENANT`** (lib/tenant/prisma.ts),
 * igual que las tablas del plan canje: el `create` pasa `tenantId` explícito, y
 * adentro de `enTransaccionDeTenant` no hay extensión que lo complete de todos
 * modos. Detrás está el WITH CHECK de la policy.
 */

/** Lo que entra en `Decimal(12, 2)`: diez dígitos enteros. Más que eso no es
 *  un dólar, es un typo — y Postgres lo rechazaría como 500. */
const VALOR_MAXIMO = new Prisma.Decimal('9999999999.99')

/**
 * El texto del campo, ya validado: la gramática compartida de `lib/formato`
 * (coma decimal, punto de miles, rechazo de lo ambiguo, la misma de los
 * precios), mayor que cero y con hasta dos decimales —la escala de la
 * columna—. Más decimales se RECHAZAN y no se redondean, por lo mismo que
 * `excedeEscala`: lo que se quiso escribir lo sabe la persona.
 */
export function leerCotizacion(texto: string): Prisma.Decimal {
  if (estaVacio(texto)) throw new ErrorDeCotizacion('VALOR_INVALIDO', 'Falta la cotización.')
  const valor = aDecimal(texto, 'la cotización')
  if (valor.lessThanOrEqualTo(0)) {
    throw new ErrorDeCotizacion('VALOR_INVALIDO', 'La cotización tiene que ser mayor que cero.')
  }
  if (excedeEscala(valor, ESCALA_DINERO)) {
    throw new ErrorDeCotizacion('VALOR_INVALIDO', 'La cotización va con hasta dos decimales: 1450,50.')
  }
  if (valor.greaterThan(VALOR_MAXIMO)) {
    throw new ErrorDeCotizacion('VALOR_INVALIDO', `Esa cotización no entra: "${texto}".`)
  }
  return valor
}

/**
 * Carga una cotización nueva, que pasa a ser la vigente.
 *
 * **El tope de cordura** (`esSaltoGrande`): si difiere en más de la mitad de la
 * vigente y no vino `confirmada`, tira `SALTO_GRANDE` sin escribir nada, con el
 * mensaje que la pantalla muestra al lado del botón de confirmar. Se chequea
 * ACÁ y no en la pantalla porque la pantalla puede estar mostrando una vigente
 * de hace una hora: la comparación tiene que ser contra la que está en la base.
 *
 * En una transacción para que la vigente leída y la fila escrita sean del
 * mismo instante. Dos cargas simultáneas no se bloquean entre sí, a propósito:
 * es una tabla que sólo crece, y la peor consecuencia es que la segunda se
 * compare contra la penúltima en vez de contra la primera.
 */
export async function cargarCotizacion(e: {
  tenantId: string
  usuarioId: string
  texto: string
  confirmada: boolean
}): Promise<{ id: string; valor: string; creadaEn: Date }> {
  const valor = leerCotizacion(e.texto)
  return enTransaccionDeTenant(e.tenantId, async (tx) => {
    // La FK a `users` NO pasa por RLS (Postgres chequea las FK como owner), así
    // que sin esto un `usuarioId` de otro local quedaría firmando una carga de
    // éste. Desde la action no llega otra cosa que el de la sesión; es la
    // misma red que pone el motor de ventas, con su mismo error (ver
    // `exigirUsuario`, lib/ventas/pertenencia.ts).
    await exigirUsuario(tx, e.usuarioId)
    const vigente = await tx.cotizacionDelDolar.findFirst({
      orderBy: [{ creadaEn: 'desc' }, { id: 'desc' }],
      select: { valor: true },
    })
    const anterior = vigente ? vigente.valor.toString() : null
    if (!e.confirmada && esSaltoGrande(valor.toString(), anterior)) {
      throw new ErrorDeCotizacion(
        'SALTO_GRANDE',
        `${formatearCotizacion(valor.toString())} es más de un ${SALTO_QUE_PIDE_CONFIRMAR_PORCENTAJE} % distinta de la ` +
          `vigente (${formatearCotizacion(anterior!)}). ¿Es correcta?`,
      )
    }
    const fila = await tx.cotizacionDelDolar.create({
      data: { tenantId: e.tenantId, valor, cargadaPorId: e.usuarioId },
      select: { id: true, valor: true, creadaEn: true },
    })
    return { id: fila.id, valor: fila.valor.toString(), creadaEn: fila.creadaEn }
  })
}
