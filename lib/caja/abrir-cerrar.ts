import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ESCALA_DINERO, excedeEscala } from '@/lib/ventas/totales'
import { aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'
import { ErrorDeCaja } from './errores'

type Decimal = Prisma.Decimal

// Decimal(12,2): 12 dígitos totales, ESCALA_DINERO (2) de escala, 10 que le
// quedan a la parte entera. Sin este chequeo, un saldo con más dígitos
// enteros llega crudo a Postgres y sale como un error de desborde sin código
// de dominio.
const DIGITOS_ENTEROS_MAXIMOS = 10

/**
 * Valida el saldo con el que abre el turno.
 *
 * El texto pasa primero por `aDecimal` (lib/formato/numeros.ts) — la misma
 * gramática que ya usan inventario y ventas para cualquier campo de plata—, y
 * no por `new Prisma.Decimal()` crudo. Ese cambio es lo que hace que ya NO
 * entren `'NaN'` (decimal.js lo acepta, y el signo de NaN es `null`: el
 * chequeo de abajo decía que no era negativo), `'0x10'` ni `'1_000'`
 * (decimal.js parsea hexadecimal y guiones bajos) ni `'Infinity'` — y lo que
 * hace que sí entre `'1,50'`, que antes se rechazaba y así es como se escribe
 * la plata en Argentina.
 *
 * `ErrorDeFormato` se traduce acá a `ErrorDeCaja/SALDO_INVALIDO`: el resto
 * del módulo, y cualquier UI futura, sólo necesitan conocer un código de
 * error para este campo, no dos.
 *
 * Lo que `aDecimal` no valida —porque no conoce la escala de esta columna en
 * particular— son las dos reglas de abajo: nunca negativo (una caja no
 * arranca debiendo) y dentro de la precisión de `Decimal(12,2)`. La gramática
 * de `aDecimal` ya no deja pasar ningún signo, así que en la práctica el
 * chequeo de negativo no tiene hoy ningún valor que lo dispare — se deja
 * puesto porque es una regla de negocio propia de la caja, no un accidente de
 * cómo está escrita la gramática, y no depende de que ésta se mantenga igual.
 */
function validarSaldoInicial(saldoInicial: string): Decimal {
  let monto: Decimal
  try {
    monto = aDecimal(saldoInicial, 'el saldo inicial')
  } catch (e) {
    if (e instanceof ErrorDeFormato) {
      throw new ErrorDeCaja('SALDO_INVALIDO', e.message, { cause: e })
    }
    throw e
  }
  if (monto.isNegative()) {
    throw new ErrorDeCaja('SALDO_INVALIDO', 'el saldo inicial no puede ser negativo')
  }
  if (excedeEscala(monto, ESCALA_DINERO)) {
    throw new ErrorDeCaja(
      'SALDO_INVALIDO',
      `el saldo inicial tiene a lo sumo ${ESCALA_DINERO} decimales`,
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
    // carrera de arriba, resuelta. `cajas` tiene DOS índices únicos —
    // `cajas_pkey` (el id) y `cajas_una_abierta_por_tenant` (el parcial de
    // arriba), no uno solo—, pero no hace falta discriminar cuál chocó: el id
    // lo generamos nosotros con `uuid(7)` recién acá adentro, así que un
    // P2002 contra `cajas_pkey` no tiene forma de ocurrir en la práctica, y un
    // P2002 real sólo puede ser el parcial.
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

    // UN SOLO statement, sin `findFirst` previo: `cerradaEn: null` es el
    // ÚNICO selector de la fila, así que no hay ventana entre "leer cuál está
    // abierta" y "escribir el cierre" donde otra llamada se cuele. La versión
    // de antes SÍ tenía esa ventana aunque el `updateMany` repitiera el
    // filtro: la fila a actualizar ya quedaba fijada por el id que trajo la
    // lectura previa, así que ese `updateMany` protegía contra un cierre
    // concurrente de OTRA transacción, pero la propia función seguía atada a
    // dos round-trips separados — exactamente lo que este comentario, en la
    // versión anterior, no dejaba ver. `updateManyAndReturn` (Prisma 7)
    // devuelve la fila afectada en el mismo viaje, así que no hace falta
    // ninguna lectura aparte para saber qué id cerramos.
    //
    // Sobre qué prueba y qué no prueba esto contra cierres concurrentes DE
    // VERDAD: el pool de lib/db.ts está en `max: 5`, así que llamadas
    // concurrentes por encima de eso se serializan en la cola del pool y no
    // llegan a competir por la misma fila al mismo tiempo — es lo que explica
    // por qué los tests de este archivo no usan promesas concurrentes contra
    // `cerrarCaja` para ejercitar la carrera (ver el comentario del test 'el
    // mecanismo' más abajo, que sí la ejercita con dos conexiones propias).
    const cerradas = await tx.caja.updateManyAndReturn({
      where: { cerradaEn: null },
      data: { cerradaEn: new Date(), cerradaPorId: usuarioId },
      select: { id: true },
    })
    // El índice único parcial garantiza a lo sumo una fila con `cerradaEn`
    // null por tenant, así que esto nunca da más de un elemento. Vacío
    // significa "no había ninguna caja abierta" y también "otra llamada ya la
    // cerró antes de que esta corriera" — mismo código para las dos, igual
    // que documenta `errores.ts`.
    if (cerradas.length === 0) {
      throw new ErrorDeCaja('SIN_CAJA_ABIERTA', 'no hay ninguna caja abierta para cerrar')
    }

    return { id: cerradas[0].id }
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
