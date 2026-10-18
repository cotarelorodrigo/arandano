import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeCaja } from './errores'
import { efectivoDelTurno } from './efectivo'
import { normalizarNota, validarMonto, validarMontoOpcional } from './montos'

type Decimal = Prisma.Decimal

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
  // Desde el ciclo del arqueo, las reglas viven en `validarMonto`
  // (./montos.ts), compartidas con el cierre y los movimientos. Ésta queda
  // como el nombre de la regla de la apertura y el código que sale.
  return validarMonto(saldoInicial, 'el saldo inicial', 'SALDO_INVALIDO')
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
  // Ciclo del arqueo (spec, decisión 3): la apertura en dólares, plegada en
  // el formulario ("+ dólares"). Opcional y vacío = 0, para que el local que
  // no maneja dólares —y todo llamador de antes de este ciclo— abra igual.
  saldoInicialUsd: string = '',
): Promise<{ id: string }> {
  const monto = validarSaldoInicial(saldoInicial)
  const montoUsd = validarMontoOpcional(saldoInicialUsd, 'el saldo inicial en dólares', 'SALDO_INVALIDO')

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
        data: { tenantId, abiertaPorId: usuarioId, saldoInicial: monto, saldoInicialUsd: montoUsd },
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
 * El arqueo tal como llega del formulario de cierre: textos, por moneda.
 *
 * `contadoArs` es obligatorio (spec, decisión 4). Los campos en dólares y los
 * retirados vacíos son cero: el formulario no muestra la columna de dólares
 * cuando el turno no tuvo ninguno (`huboDolares`), y "no retiré nada" es dejar
 * el campo vacío. Cuando la columna SÍ se muestra, el contado en dólares es
 * `required` en el formulario; el servidor no puede saber si se mostró, y leer
 * su ausencia como cero es la lectura segura: si en ese turno había dólares, el
 * arqueo lo dice como faltante en vez de impedir el cierre.
 */
export type ArqueoTipeado = {
  contadoArs: string
  contadoUsd?: string | null
  retiradoArs?: string | null
  retiradoUsd?: string | null
  nota?: string | null
}

type ArqueoValidado = {
  contadoArs: Decimal
  contadoUsd: Decimal
  retiradoArs: Decimal
  retiradoUsd: Decimal
  notaCierre: string | null
}

/**
 * Las reglas del arqueo que no dependen de la base, ANTES de abrir la
 * transacción: contado ≥ 0, retirado ≥ 0 y retirado ≤ contado, por moneda.
 *
 * Retirar más de lo contado se rechaza y la diferencia no (spec, decisión 4):
 * la diferencia es un DATO del turno —faltan $ 200, y eso es justamente lo que
 * el arqueo existe para mostrar—, mientras que retirar $ 50.000 de un cajón
 * donde se contaron $ 45.000 deja el "queda" en negativo, y eso no es un dato:
 * es un error de tipeo.
 */
function validarArqueo(a: ArqueoTipeado): ArqueoValidado {
  const contadoArs = validarMonto(a.contadoArs, 'el efectivo contado en pesos', 'MONTO_INVALIDO')
  const contadoUsd = validarMontoOpcional(a.contadoUsd, 'el efectivo contado en dólares', 'MONTO_INVALIDO')
  const retiradoArs = validarMontoOpcional(a.retiradoArs, 'lo retirado en pesos', 'MONTO_INVALIDO')
  const retiradoUsd = validarMontoOpcional(a.retiradoUsd, 'lo retirado en dólares', 'MONTO_INVALIDO')
  if (retiradoArs.greaterThan(contadoArs)) {
    throw new ErrorDeCaja(
      'RETIRO_MAYOR_QUE_CONTADO',
      'no se puede retirar más pesos de los que se contaron',
    )
  }
  if (retiradoUsd.greaterThan(contadoUsd)) {
    throw new ErrorDeCaja(
      'RETIRO_MAYOR_QUE_CONTADO',
      'no se puede retirar más dólares de los que se contaron',
    )
  }
  return { contadoArs, contadoUsd, retiradoArs, retiradoUsd, notaCierre: normalizarNota(a.nota) }
}

/**
 * Cierra la caja del turno en curso, con su arqueo.
 *
 * Mismo criterio que `abrirCaja`: cualquiera del local cierra, no sólo quien
 * la abrió — el que se va del turno puede no ser el mismo que lo empezó.
 *
 * **El arqueo es obligatorio, también en la firma.** La primera versión de
 * este ciclo lo dejaba opcional "para no romper a un formulario cacheado
 * durante el deploy", y eso era un bypass permanente: cualquier sesión podía
 * cerrar sin contar con sólo no mandar el campo. Y no compraba nada: el id de
 * una server action cambia en cada build, así que un formulario de la imagen
 * anterior falla igual contra la nueva (hallazgo de la review del ciclo). Sin
 * contado en pesos no hay cierre.
 *
 * **El esperado que se guarda es el recalculado acá adentro**, después de
 * bloquear la fila de la caja con el `UPDATE` del cierre. Si entró un cobro
 * entre que la persona abrió el formulario y apretó "Cerrar", el esperado
 * guardado lo incluye — y la diferencia guardada es la que corresponde a lo
 * que de verdad pasó, no a lo que mostraba la pantalla. Un movimiento de caja
 * concurrente espera este lock o lo hace esperar (ver `registrarMovimiento`).
 * Un COBRO concurrente no: `crearVenta` no toca la caja (no la exige), así
 * que una venta que commitea después de este recálculo con un `creado_en`
 * anterior al cierre no queda en el esperado de nadie. Es una ventana de
 * milisegundos, y la diferencia que produciría la muestra el arqueo.
 *
 * `cerradaEn` sale del reloj del PROCESO (`new Date()`), mientras que
 * `creado_en` de ventas y pagos lo escribe el `now()` de Postgres. Los dos
 * contenedores leen el reloj del mismo host, y el esperado no depende de esa
 * marca (se calcula sin cota superior); queda anotado en el spec.
 */
export async function cerrarCaja(
  tenantId: string,
  usuarioId: string,
  arqueo: ArqueoTipeado,
): Promise<{ id: string }> {
  // Validado afuera de la transacción: un error de tipeo no tiene por qué
  // tomar una conexión ni un lock.
  const validado = validarArqueo(arqueo)

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
    // dos round-trips separados. `updateManyAndReturn` (Prisma 7) devuelve la
    // fila afectada en el mismo viaje —y desde el arqueo, también lo que la
    // cuenta del esperado necesita—, así que no hace falta ninguna lectura
    // aparte.
    //
    // Sobre qué prueba y qué no prueba esto contra cierres concurrentes DE
    // VERDAD: el pool de lib/db.ts está en `max: 5`, así que llamadas
    // concurrentes por encima de eso se serializan en la cola del pool y no
    // llegan a competir por la misma fila al mismo tiempo — es lo que explica
    // por qué los tests de este archivo no usan promesas concurrentes contra
    // `cerrarCaja` para ejercitar la carrera (ver el comentario del test 'el
    // mecanismo', que sí la ejercita con dos conexiones propias).
    const cerradas = await tx.caja.updateManyAndReturn({
      where: { cerradaEn: null },
      data: { cerradaEn: new Date(), cerradaPorId: usuarioId },
      select: { id: true, abiertaEn: true, saldoInicial: true, saldoInicialUsd: true },
    })
    // El índice único parcial garantiza a lo sumo una fila con `cerradaEn`
    // null por tenant, así que esto nunca da más de un elemento. Vacío
    // significa "no había ninguna caja abierta" y también "otra llamada ya la
    // cerró antes de que esta corriera" — mismo código para las dos, igual
    // que documenta `errores.ts`.
    if (cerradas.length === 0) {
      throw new ErrorDeCaja('SIN_CAJA_ABIERTA', 'no hay ninguna caja abierta para cerrar')
    }
    const caja = cerradas[0]

    // La fila ya está bloqueada por el UPDATE de arriba hasta el commit:
    // ningún movimiento de caja entra entre esta cuenta y la escritura.
    const { actual } = await efectivoDelTurno(tx, caja)
    await tx.caja.update({
      where: { id: caja.id },
      data: { ...validado, esperadoArs: actual.ars, esperadoUsd: actual.usd },
      select: { id: true },
    })

    return { id: caja.id }
  })
}

/**
 * Con cuánto conviene abrir el turno que viene: lo que quedó en el cajón al
 * cerrar el anterior (contado − retirado), por moneda, como texto listo para
 * el campo (spec, decisión 3).
 *
 * Mira **el último cierre**, y si ése se cerró sin arqueo (una caja de antes
 * de este ciclo, que no tienen arqueo) devuelve `null` en vez
 * de buscar uno más viejo: lo que quedó hace tres días no es lo que hay hoy en
 * el cajón, y una sugerencia vieja es peor que un campo vacío. Sólo sugiere:
 * el campo se puede cambiar, y el que abre es quien sabe lo que hay.
 *
 * Una de las dos preguntas abiertas para el cliente (si lo que queda pasa como
 * apertura del día siguiente): si la respuesta es que no, apagarla es dejar de
 * llamar a esta función desde /vender.
 */
export async function aperturaSugerida(
  tenantId: string,
): Promise<{ ars: string; usd: string } | null> {
  const ultima = await prismaParaTenant(tenantId).caja.findFirst({
    where: { cerradaEn: { not: null } },
    orderBy: { cerradaEn: 'desc' },
    select: { contadoArs: true, contadoUsd: true, retiradoArs: true, retiradoUsd: true },
  })
  if (!ultima || ultima.contadoArs === null) return null
  const cero = new Prisma.Decimal(0)
  const ars = ultima.contadoArs.sub(ultima.retiradoArs ?? cero)
  const usd = (ultima.contadoUsd ?? cero).sub(ultima.retiradoUsd ?? cero)
  return { ars: ars.toFixed(2), usd: usd.toFixed(2) }
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
): Promise<{ id: string; abiertaEn: Date; saldoInicial: Decimal; saldoInicialUsd: Decimal } | null> {
  return prismaParaTenant(tenantId).caja.findFirst({
    where: { cerradaEn: null },
    select: { id: true, abiertaEn: true, saldoInicial: true, saldoInicialUsd: true },
  })
}

function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}
