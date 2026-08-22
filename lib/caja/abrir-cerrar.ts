import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeCaja } from './errores'

type Decimal = Prisma.Decimal

// La misma escala que el resto de la plata del motor: Decimal(12,2). No
// importamos ESCALA_DINERO de lib/ventas/totales.ts para no atar lib/caja a
// lib/ventas por un número — este comentario es lo que evita que se
// desincronicen si la columna cambia.
const ESCALA_SALDO = 2
// Decimal(12,2): 12 dígitos totales, 2 de escala, 10 que le quedan a la parte
// entera. Sin este chequeo, un saldo con más dígitos enteros llega crudo a
// Postgres y sale como un error de desborde sin código de dominio.
const DIGITOS_ENTEROS_MAXIMOS = 10

/**
 * Valida el saldo con el que abre el turno. Nunca negativo (una caja no
 * arranca debiendo) y dentro de la precisión de la columna — las dos cosas
 * que antes entraban crudas.
 */
function validarSaldoInicial(saldoInicial: string): Decimal {
  const monto = new Prisma.Decimal(saldoInicial)
  if (monto.isNegative()) {
    throw new ErrorDeCaja('SALDO_INVALIDO', 'el saldo inicial no puede ser negativo')
  }
  if (monto.decimalPlaces() > ESCALA_SALDO) {
    throw new ErrorDeCaja(
      'SALDO_INVALIDO',
      `el saldo inicial tiene a lo sumo ${ESCALA_SALDO} decimales`,
    )
  }
  const digitosEnteros = monto.trunc().abs().toFixed(0).length
  if (digitosEnteros > DIGITOS_ENTEROS_MAXIMOS) {
    throw new ErrorDeCaja(
      'SALDO_INVALIDO',
      `el saldo inicial no puede tener más de ${DIGITOS_ENTEROS_MAXIMOS} dígitos enteros`,
    )
  }
  return monto
}

/**
 * Abre la caja del turno.
 *
 * Cualquiera del local abre, dueño o empleado: en un mostrador abre el que
 * llega primero. La fila registra quién fue (`abiertaPorId`), así que la
 * trazabilidad no se pierde — y sin arqueo todavía no hay plata que cuadrar,
 * que es lo único que justificaría restringirlo a uno de los dos roles.
 *
 * La regla "una sola caja abierta por tenant" NO se valida acá adentro: la
 * sostiene `cajas_una_abierta_por_tenant`, el índice único parcial de la
 * migración. Un chequeo previo en la aplicación (un `findFirst` antes del
 * `create`) deja pasar la carrera exacta que este índice existe para cerrar —
 * dos pestañas apretando "Abrir caja" en el mismo segundo pasan las dos por
 * cualquier `if`, y sólo la base ve las dos escrituras a la vez.
 */
export async function abrirCaja(
  tenantId: string,
  usuarioId: string,
  saldoInicial: string,
): Promise<{ id: string }> {
  const monto = validarSaldoInicial(saldoInicial)

  try {
    return await enTransaccionDeTenant(tenantId, async (tx) => {
      // La FK de Postgres a `users` no distingue tenants: sus triggers corren
      // como DUEÑO de la tabla referenciada, exento de RLS. Sin este chequeo,
      // un usuarioId de OTRO tenant entra sin que nada se queje, y el que
      // paga no es quien lo hizo: es el otro negocio, que después no puede
      // dar de baja a su empleado porque `onDelete: Restrict` apunta a una
      // fila que RLS le esconde. Ver lib/ventas/pertenencia.ts.
      await exigirUsuario(tx, usuarioId)

      return tx.caja.create({
        data: { tenantId, abiertaPorId: usuarioId, saldoInicial: monto },
        select: { id: true },
      })
    })
  } catch (e) {
    // El choque del índice único no es "otro error de Postgres": es la
    // carrera de arriba, resuelta. No hace falta discriminar qué unicidad
    // chocó —a diferencia de `articulos`, `cajas` tiene un único índice
    // único (el parcial de arriba)—, así que un P2002 acá sólo puede ser
    // éste.
    if (esP2002(e)) {
      throw new ErrorDeCaja('CAJA_YA_ABIERTA', 'ya hay una caja abierta en este local', {
        cause: e,
      })
    }
    throw e
  }
}

/**
 * Cierra la caja del turno en curso.
 *
 * Mismo criterio que `abrirCaja`: cualquiera del local cierra, no sólo quien
 * la abrió — el que se va del turno puede no ser el mismo que lo empezó.
 */
export async function cerrarCaja(tenantId: string, usuarioId: string): Promise<{ id: string }> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    // Mismo argumento que en abrirCaja: sin esto, un usuarioId ajeno queda
    // escrito en cerradaPorId sin que nada lo note.
    await exigirUsuario(tx, usuarioId)

    const abierta = await tx.caja.findFirst({
      where: { cerradaEn: null },
      select: { id: true },
    })
    if (!abierta) {
      throw new ErrorDeCaja('SIN_CAJA_ABIERTA', 'no hay ninguna caja abierta para cerrar')
    }

    // `updateMany` con `cerradaEn: null` REPETIDO en el where —no un
    // `update({ where: { id } })` liso— es lo que cierra la carrera de varios
    // cierres concurrentes: el `findFirst` de arriba puede ver la misma fila
    // abierta desde varias llamadas a la vez, pero sólo la que llegue primero a
    // este UPDATE todavía encuentra `cerrada_en IS NULL` — el resto actualiza
    // cero filas, en vez de pisarle la fecha y el usuario a la primera. Medido:
    // con `update({ where: { id } })` liso, 15 cierres concurrentes sobre la
    // misma caja daban 15 "éxitos" — Prisma actualiza por id sin mirar ninguna
    // otra condición, así que cada uno pisaba al anterior sin quejarse.
    const resultado = await tx.caja.updateMany({
      where: { id: abierta.id, cerradaEn: null },
      data: { cerradaEn: new Date(), cerradaPorId: usuarioId },
    })
    if (resultado.count === 0) {
      throw new ErrorDeCaja('SIN_CAJA_ABIERTA', 'no hay ninguna caja abierta para cerrar')
    }

    return { id: abierta.id }
  })
}

/**
 * La caja del turno en curso, o null si no hay ninguna abierta. Es lo que
 * consume el chip "Caja abierta" del header de /vender.
 *
 * Va por `prismaParaTenant` y no por una transacción propia: es una sola
 * lectura, sin nada que atomizar contra otra escritura.
 */
export async function cajaAbierta(
  tenantId: string,
): Promise<{ id: string; abiertaEn: Date; saldoInicial: Decimal } | null> {
  return prismaParaTenant(tenantId).caja.findFirst({
    where: { cerradaEn: null },
    select: { id: true, abiertaEn: true, saldoInicial: true },
  })
}

function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}
