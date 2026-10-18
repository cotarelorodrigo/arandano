import type { Moneda, TipoMovimientoCaja } from '@/generated/prisma/client'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeCaja } from './errores'
import { normalizarNota, validarMonto } from './montos'

/** Los valores del enum, escritos acá para validar lo que llega de un
 *  formulario antes de que Prisma tire un error de validación sin código. */
export const TIPOS_DE_MOVIMIENTO = ['INGRESO', 'EGRESO', 'RETIRO'] as const satisfies readonly TipoMovimientoCaja[]
const MONEDAS = ['ARS', 'USD'] as const satisfies readonly Moneda[]

export type MovimientoTipeado = {
  tipo: string
  moneda: string
  monto: string
  nota?: string | null
}

/**
 * Registra un ingreso, un egreso o un retiro en la caja abierta (spec
 * 2026-10-18-arqueo-de-caja-design.md, decisión 2).
 *
 * - **Sólo con una caja abierta**: un movimiento es plata que entra o sale del
 *   cajón de un turno; sin turno no hay contra qué cuadrarlo.
 * - **Monto > 0**: el sentido lo da el tipo, nunca el signo (CHECK en la base
 *   como red, `validarMonto` + el cero de acá como la regla legible).
 * - **Egreso con nota**: un egreso sin motivo es el que nadie puede explicar
 *   después. Ingreso y retiro la llevan opcional.
 * - **Cualquiera del local registra** (decisión del spec, igual que abrir y
 *   cerrar): cada movimiento lleva quién fue, y el arqueo es el control. Por
 *   eso no hay permiso, y `test/permisos-en-las-dos-copias.test.ts` sigue
 *   diciendo que las dos copias del control de caja no llevan guarda.
 *
 * No se editan ni se borran: un error se corrige con el movimiento contrario.
 * Lo sostiene el REVOKE de scripts/setup-db-roles.sh.
 *
 * **El bloqueo de la fila de la caja**, que es lo único no obvio de esta
 * función: sin él, un movimiento que se registra MIENTRAS otro cierra la caja
 * podía leer la caja como abierta, el cierre calcular su esperado sin el
 * movimiento y commitear, y el movimiento entrar después colgado de una caja
 * ya cerrada, fuera de su arqueo para siempre. El `UPDATE … SET cerrada_en =
 * NULL WHERE cerrada_en IS NULL` no cambia nada, pero toma el lock de la fila
 * igual que el `UPDATE` del cierre, así que los dos se serializan:
 *
 * - si el cierre llegó primero, este `UPDATE` espera su commit, re-evalúa el
 *   `WHERE` (READ COMMITTED) y no encuentra ninguna abierta → SIN_CAJA_ABIERTA;
 * - si el movimiento llegó primero, el cierre espera, y su recálculo del
 *   esperado ya ve el movimiento commiteado.
 *
 * Un `findFirst` + `create` (la versión obvia) no toma ningún lock: la FK del
 * insert toma un `FOR KEY SHARE`, que no choca con el `UPDATE` del cierre
 * porque éste no cambia la clave. `lib/caja/movimientos.test.ts` lo prueba con
 * una conexión propia que cierra la caja a mitad de camino.
 */
export async function registrarMovimiento(
  tenantId: string,
  usuarioId: string,
  m: MovimientoTipeado,
): Promise<{ id: string }> {
  const tipo = TIPOS_DE_MOVIMIENTO.find((t) => t === m.tipo)
  if (!tipo) throw new ErrorDeCaja('MOVIMIENTO_INVALIDO', 'el tipo de movimiento no es ninguno de los que existen')
  const moneda = MONEDAS.find((x) => x === m.moneda)
  if (!moneda) throw new ErrorDeCaja('MOVIMIENTO_INVALIDO', 'la moneda del movimiento no es pesos ni dólares')

  const monto = validarMonto(m.monto, 'el monto', 'MONTO_INVALIDO')
  if (monto.isZero()) {
    throw new ErrorDeCaja('MONTO_INVALIDO', 'el monto tiene que ser mayor que cero')
  }
  const nota = normalizarNota(m.nota)
  if (tipo === 'EGRESO' && nota === null) {
    throw new ErrorDeCaja('NOTA_INVALIDA', 'un egreso necesita el motivo: ¿en qué se gastó?')
  }

  return enTransaccionDeTenant(tenantId, async (tx) => {
    // Mismo motivo que en abrirCaja: la FK a `users` no distingue tenants.
    await exigirUsuario(tx, usuarioId)

    // El lock: ver el docblock. `cerradaEn: null` es a la vez el selector y el
    // "dato" que se escribe, así que la fila queda exactamente como estaba.
    const abiertas = await tx.caja.updateManyAndReturn({
      where: { cerradaEn: null },
      data: { cerradaEn: null },
      select: { id: true },
    })
    if (abiertas.length === 0) {
      throw new ErrorDeCaja(
        'SIN_CAJA_ABIERTA',
        'no hay ninguna caja abierta: abrila para registrar un movimiento',
      )
    }

    return tx.movimientoDeCaja.create({
      data: { tenantId, cajaId: abiertas[0].id, tipo, moneda, monto, nota, usuarioId },
      select: { id: true },
    })
  })
}
