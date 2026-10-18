'use server'

import { revalidatePath } from 'next/cache'
import { exigirSesion } from '@/lib/auth/sesion'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { cargarCotizacion } from '@/lib/cotizacion/administrar'
import { ErrorDeCotizacion } from '@/lib/cotizacion/errores'
import { crearVenta } from '@/lib/ventas/crear'
import { ErrorDeVenta } from '@/lib/ventas/errores'
import { buscarArticulosVendibles, type ArticuloVendible } from '@/lib/ventas/buscar'
import { unidadesLibres, type UnidadLibre } from '@/lib/inventario/unidades'
import { abrirCaja, cerrarCaja } from '@/lib/caja/abrir-cerrar'
import { registrarMovimiento } from '@/lib/caja/movimientos'
import { ErrorDeCaja } from '@/lib/caja/errores'
import { aCotizacion, aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'
import { esUuid } from '@/lib/uuid'
import { formatearCotizacion } from '@/lib/formato/mostrar'
import { ErrorDeCliente } from '@/lib/clientes/errores'
import type { MedioPago, Moneda } from '@/generated/prisma/client'

export type EstadoCobro = {
  error: string | null
  // La venta cobrada, para que la pantalla muestre el número y el enlace. Null
  // mientras no se haya cobrado nada.
  venta: { id: string; numero: number } | null
}

const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO'] as const
const MONEDAS = ['ARS', 'USD'] as const

/** Los errores que la persona puede corregir tipeando distinto se muestran; el
 *  resto se relanza, para que un bug de verdad llegue al log y no se aplane en
 *  un cartel rojo genérico. */
function traducir(e: unknown): EstadoCobro {
  // `ErrorDeCliente` desde el ciclo de la solapa Clientes: el cliente nuevo del
  // cobro nace adentro de la transacción de la venta, y un teléfono repetido o
  // un nombre vacío son cosas que quien cobra corrige tipeando distinto.
  if (e instanceof ErrorDeVenta || e instanceof ErrorDeFormato || e instanceof ErrorDeCliente) {
    return { error: e.message, venta: null }
  }
  throw e
}

/**
 * Parsea el JSON de un campo y verifica que sea una lista.
 *
 * Un `JSON.parse` suelto sobre lo que viene del cliente tira `SyntaxError`, que
 * `traducir` relanzaría como 500. Un carrito mal formado es entrada inválida,
 * no un bug del servidor.
 */
function listaDeJson(datos: FormData, campo: string): unknown[] {
  let crudo: unknown
  try {
    crudo = JSON.parse(String(datos.get(campo) ?? ''))
  } catch {
    throw new ErrorDeVenta('SIN_ITEMS', `no se entendió el ${campo} que llegó`)
  }
  if (!Array.isArray(crudo)) {
    throw new ErrorDeVenta('SIN_ITEMS', `el ${campo} tiene que ser una lista`)
  }
  return crudo
}

/**
 * El cliente del cobro, si quien cobra eligió o cargó uno: `clienteId` (uno
 * existente) o `clienteNuevo` (JSON con nombre, teléfono y si acepta ofertas).
 *
 * **Los dos vacíos —el caso de casi toda venta de mostrador— dan `{}`**, y la
 * llamada a `crearVenta` queda idéntica a la de antes de que existiera el
 * campo: el cobro no ganó ningún paso obligatorio ni ningún modo de fallar
 * nuevo para quien no lo toca (spec 2026-10-18-clientes-design.md, decisión 6).
 *
 * Los dos llenos los rechaza el motor (`CLIENTE_DOBLE`); acá no se elige uno
 * en silencio.
 *
 * Mismos guards que el resto de esta función: un id que no es uuid es "ese
 * cliente no existe" y no un 500 de Prisma, y un JSON ilegible es entrada
 * inválida.
 */
function clienteDelCobro(datos: FormData): {
  clienteId?: string
  clienteNuevo?: { nombre: string; telefono: string | null; aceptaOfertas: boolean }
} {
  const clienteId = String(datos.get('clienteId') ?? '').trim()
  const crudoNuevo = String(datos.get('clienteNuevo') ?? '').trim()
  const salida: ReturnType<typeof clienteDelCobro> = {}

  if (clienteId !== '') {
    if (!esUuid(clienteId)) {
      throw new ErrorDeVenta('CLIENTE_INEXISTENTE', 'Ese cliente ya no existe. Elegí otro o cargalo de nuevo.')
    }
    salida.clienteId = clienteId
  }
  if (crudoNuevo !== '') {
    let n: { nombre?: unknown; telefono?: unknown; aceptaOfertas?: unknown }
    try {
      n = JSON.parse(crudoNuevo)
    } catch {
      throw new ErrorDeCliente('NOMBRE_VACIO', 'No se entendió el cliente nuevo que llegó.')
    }
    if (n === null || typeof n !== 'object') {
      throw new ErrorDeCliente('NOMBRE_VACIO', 'No se entendió el cliente nuevo que llegó.')
    }
    salida.clienteNuevo = {
      nombre: typeof n.nombre === 'string' ? n.nombre : '',
      telefono: typeof n.telefono === 'string' ? n.telefono : null,
      // Sólo `true` es sí: cualquier otra cosa —ausente, "true" como texto,
      // un número— es no. El consentimiento no se infiere.
      aceptaOfertas: n.aceptaOfertas === true,
    }
  }
  return salida
}

export async function cobrar(_e: EstadoCobro, datos: FormData): Promise<EstadoCobro> {
  try {
    const sesion = await exigirSesion()

    const items = listaDeJson(datos, 'items').map((crudo) => {
      const i = crudo as {
        articuloId?: unknown
        cantidad?: unknown
        unidadId?: unknown
        imeiCapturado?: unknown
      }
      const articuloId = String(i.articuloId ?? '')
      // El mismo guard que el detalle de venta y el de artículo. Desde la
      // pantalla no llega otra cosa —los ids salen del buscador—, pero un POST
      // armado a mano sí, y Prisma rechaza un uuid mal formado con un código
      // que `traducirErrorDeBase` no traduce: no sería `ErrorDeVenta` ni
      // `ErrorDeFormato`, así que saldría por `traducir` como un 500 en vez de
      // como el error de dominio que corresponde.
      if (!esUuid(articuloId)) {
        throw new ErrorDeVenta('ARTICULO_INEXISTENTE', `no existe el artículo ${articuloId}`)
      }
      // `undefined` es "sin unidad" (artículo sin serie); cualquier otra cosa
      // tiene que ser un uuid. Mismo guard que el articuloId de arriba: sin
      // él, un POST armado a mano con basura acá llega a Prisma y sale como
      // error sin `codigo`, o sea un 500 donde correspondía un cartel del
      // mostrador.
      const unidadId = i.unidadId === undefined ? undefined : String(i.unidadId)
      if (unidadId !== undefined && !esUuid(unidadId)) {
        throw new ErrorDeVenta('UNIDAD_INEXISTENTE', 'ese equipo no existe')
      }
      // El IMEI escaneado en el mostrador (Task 7 del ciclo "unidades sin
      // identificar"). Acá NO hay `esUuid` que valga: es texto libre a
      // propósito, porque el mismo campo es el número de serie de una
      // notebook o de un electrodoméstico (ver `normalizarImei`,
      // lib/inventario/unidades.ts). Lo que sí hace falta es que un valor que
      // no es texto no se convierta en un IMEI inventado: `String({})` es
      // "[object Object]", que el motor aceptaría y GRABARÍA como el número
      // de serie de un equipo real. Ausente o `null` valen lo mismo —no se
      // escaneó nada—, y el motor trata la cadena vacía igual (ver
      // `imeisCapturados` en lib/ventas/crear.ts), que es lo que manda un
      // `<input>` en blanco: el camino por defecto de este ciclo no puede ser
      // un error.
      const crudoImei = i.imeiCapturado
      if (
        crudoImei !== undefined &&
        crudoImei !== null &&
        typeof crudoImei !== 'string' &&
        typeof crudoImei !== 'number'
      ) {
        throw new ErrorDeVenta('SIN_ITEMS', 'no se entendió el IMEI que llegó')
      }
      const imeiCapturado =
        crudoImei === undefined || crudoImei === null ? undefined : String(crudoImei)

      return {
        articuloId,
        cantidad: aDecimal(String(i.cantidad ?? ''), 'la cantidad'),
        unidadId,
        imeiCapturado,
      }
    })

    const pagos = listaDeJson(datos, 'pagos').map((crudo) => {
      const p = crudo as {
        medio?: unknown
        moneda?: unknown
        cubre?: unknown
        base?: unknown
        cotizacion?: unknown
        planId?: unknown
      }
      const medio = String(p.medio ?? '')
      const moneda = String(p.moneda ?? '')
      // Ausente vale 'ARS', que es lo mismo que hace el motor
      // (`PagoDeVenta.cubre`, opcional con el mismo default) y lo que era toda
      // venta antes de este ciclo: el default está para que las dos puntas
      // digan lo mismo, no para tapar un campo que falte.
      //
      // **Lo que este default NO cubre, aunque la primera versión de este
      // comentario lo afirmara: una pestaña abierta desde antes del deploy.**
      // Un server action se identifica por un id que se genera EN EL BUILD, y
      // este proyecto no fija `deploymentId` ni
      // `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (`next.config.ts`), así que cada
      // deploy los renueva. La pestaña vieja postea un id que la imagen nueva
      // no tiene en su module map, y Next tira "Failed to find Server Action"
      // ANTES de decodificar el cuerpo: este handler no llega a correr, y por
      // lo tanto tampoco llega a defaultear nada. Es el mismo hecho —y no uno
      // contrario— que sostiene el `Error` pelado de `monedaDe` en
      // `app/(app)/inventario/acciones.ts`.
      const cubre = String(p.cubre ?? 'ARS')
      // Campo por campo y contra una lista blanca: lo que llega es un JSON que
      // armó el navegador, y Prisma rechazaría un enum inventado con un
      // PrismaClientValidationError —un 500 sin `codigo`— en vez del error de
      // dominio que el resto de esta función usa.
      if (!MEDIOS.includes(medio as MedioPago)) {
        throw new ErrorDeVenta('MONTO_INVALIDO', `medio de pago desconocido: ${medio}`)
      }
      if (!MONEDAS.includes(moneda as Moneda)) {
        throw new ErrorDeVenta('COTIZACION_INVALIDA', `moneda desconocida: ${moneda}`)
      }
      // La misma lista blanca que la moneda, por el mismo motivo: un enum
      // inventado lo rechazaría Prisma con un PrismaClientValidationError —un
      // 500 sin `codigo`— en vez del error de dominio que usa el resto de esta
      // función.
      if (!MONEDAS.includes(cubre as Moneda)) {
        throw new ErrorDeVenta('COTIZACION_INVALIDA', `moneda desconocida: ${cubre}`)
      }
      const planId = String(p.planId ?? '').trim()
      // Mismo guard que el articuloId: un uuid mal formado hace que Prisma tire
      // un error sin `codigo` —un 500— en vez del error de dominio que el resto
      // de esta función usa.
      if (planId !== '' && !esUuid(planId)) {
        // Mismo criterio que el mensaje homólogo de lib/ventas/crear.ts: sin
        // el id en el texto, porque este mensaje se muestra tal cual.
        throw new ErrorDeVenta(
          'PLAN_INEXISTENTE',
          'Ese plan de pago ya no está disponible. Recargá la pantalla y elegí otro.',
        )
      }
      return {
        medio: medio as MedioPago,
        moneda: moneda as Moneda,
        cubre: cubre as Moneda,
        base: aDecimal(String(p.base ?? ''), 'el monto del pago'),
        // La gramática de cotización y no la compartida: "1.450" es mil
        // cuatrocientos cincuenta, como lo lee la pantalla
        // (`cotizacionEnDiezMilesimas`). Ver `aCotizacionCanonica`.
        cotizacion: aCotizacion(String(p.cotizacion ?? ''), 'la cotización'),
        planId: planId === '' ? undefined : planId,
      }
    })

    const clave = String(datos.get('clave') ?? '').trim()

    // Sin validar ni cortar acá: el saneo y el tope viven en el motor
    // (`normalizarDetalle`, lib/ventas/detalle.ts), que es el que los aplica
    // para TODOS sus llamadores. Repetirlos acá sería la segunda copia de la
    // misma regla, que es exactamente la forma de defecto que este repo ya pagó
    // con las dos implementaciones del selector de categoría.
    const detalle = String(datos.get('detalle') ?? '')

    const cliente = clienteDelCobro(datos)

    const venta = await crearVenta({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ...cliente,
      items,
      pagos,
      // Vacía significa "sin clave", no "clave vacía": una cadena vacía
      // repetida haría que el segundo cobro devolviera el primero.
      claveIdempotencia: clave === '' ? undefined : clave,
      detalle,
    })

    revalidatePath('/ventas')
    return { error: null, venta }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * El buscador del punto de venta.
 *
 * Una action y no un route handler: es una lectura del tenant de la sesión, y
 * pasar por `exigirSesion` acá es lo que garantiza que nadie liste el catálogo
 * de otro negocio sin cookie.
 */
export async function buscarArticulos(texto: string): Promise<ArticuloVendible[]> {
  const sesion = await exigirSesion()
  return buscarArticulosVendibles(sesion.tenant.id, texto)
}

/**
 * Las unidades libres de un artículo con serie, para el selector del carrito.
 *
 * Se llama cuando el artículo se agregó por nombre y no por escaneo: ahí el
 * carrito no tiene ya elegida una unidad (a diferencia de `a.unidad`, que sólo
 * viene con un IMEI exacto) y hay que ofrecer de cuáles hay.
 */
export async function unidadesDeArticulo(articuloId: string): Promise<UnidadLibre[]> {
  const sesion = await exigirSesion()
  return unidadesLibres(sesion.tenant.id, articuloId)
}

export type EstadoCaja = { error: string | null }

/** `abrirCaja`/`cerrarCaja`/`registrarMovimiento` tiran `ErrorDeCaja`, salvo
 *  la pertenencia del usuario (`exigirUsuario`, compartida con el motor de
 *  ventas), que tira `ErrorDeVenta` — ver el comentario de `errores.ts` sobre
 *  por qué esa función no duplica su propia clase de error para esto.
 *  Cualquier otra cosa se relanza: un bug de verdad tiene que llegar al log,
 *  no aplanarse en un cartel genérico. */
function traducirErrorDeCaja(e: unknown): EstadoCaja {
  if (e instanceof ErrorDeCaja || e instanceof ErrorDeVenta) {
    return { error: e.message }
  }
  throw e
}

/**
 * Las pantallas que muestran la caja: `/vender` (el chip, su panel y la hoja
 * del teléfono) y `/caja` (el historial de cierres, desde el ciclo del arqueo).
 * Toda action que cambia la caja revalida las dos, en un solo lugar para que
 * una nueva no se olvide de la segunda.
 */
function revalidarCaja() {
  revalidatePath('/vender')
  revalidatePath('/caja')
}

/**
 * Abre la caja del turno desde el chip del header de `/vender`.
 *
 * Cualquiera del local abre, dueño o empleado — decisión ya tomada en
 * `lib/caja/abrir-cerrar.ts`, esta action sólo la expone al formulario del
 * chip y traduce el resultado. `saldoInicialUsd` es el campo plegado en
 * "+ dólares" (ciclo del arqueo): ausente o vacío abre sin dólares, que es lo
 * que manda un formulario de antes del deploy.
 */
export async function abrirCajaDesdeVender(_e: EstadoCaja, datos: FormData): Promise<EstadoCaja> {
  try {
    const sesion = await exigirSesion()
    const saldoInicial = String(datos.get('saldoInicial') ?? '0')
    const saldoInicialUsd = String(datos.get('saldoInicialUsd') ?? '')
    await abrirCaja(sesion.tenant.id, sesion.usuario.id, saldoInicial, saldoInicialUsd)
    revalidarCaja()
    return { error: null }
  } catch (e) {
    return traducirErrorDeCaja(e)
  }
}

/**
 * Cierra la caja del turno en curso, con el arqueo del formulario de cierre
 * (spec 2026-10-18-arqueo-de-caja-design.md, decisión 4).
 *
 * **Sin contado en pesos no hay cierre**: un campo ausente se lee como vacío,
 * y `cerrarCaja` lo rechaza con un cartel. La primera versión cerraba sin
 * arqueo cuando el campo faltaba, para un formulario viejo cacheado durante el
 * deploy; era un bypass permanente (cualquier sesión cerraba sin contar con
 * sólo omitir el campo) y no servía para lo que decía, porque el id de una
 * server action cambia en cada build. Hallazgo de la review del ciclo.
 */
export async function cerrarCajaDesdeVender(_e: EstadoCaja, datos: FormData): Promise<EstadoCaja> {
  try {
    const sesion = await exigirSesion()
    const texto = (campo: string) => {
      const v = datos.get(campo)
      return typeof v === 'string' ? v : null
    }
    await cerrarCaja(sesion.tenant.id, sesion.usuario.id, {
      contadoArs: texto('contadoArs') ?? '',
      contadoUsd: texto('contadoUsd'),
      retiradoArs: texto('retiradoArs'),
      retiradoUsd: texto('retiradoUsd'),
      nota: texto('notaCierre'),
    })
    revalidarCaja()
    return { error: null }
  } catch (e) {
    return traducirErrorDeCaja(e)
  }
}

/**
 * Registra un ingreso, un egreso o un retiro en la caja abierta, desde el
 * panel de la caja (spec, decisión 2). Sin permiso, igual que abrir y cerrar:
 * cualquiera del local registra, cada movimiento lleva quién fue, y el arqueo
 * es el control.
 */
export async function registrarMovimientoDesdeVender(
  _e: EstadoCaja,
  datos: FormData,
): Promise<EstadoCaja> {
  try {
    const sesion = await exigirSesion()
    await registrarMovimiento(sesion.tenant.id, sesion.usuario.id, {
      tipo: String(datos.get('tipo') ?? ''),
      moneda: String(datos.get('moneda') ?? ''),
      monto: String(datos.get('monto') ?? ''),
      nota: String(datos.get('nota') ?? ''),
    })
    revalidarCaja()
    return { error: null }
  } catch (e) {
    return traducirErrorDeCaja(e)
  }
}

/**
 * Lo que vuelve de cargar la cotización del dólar. Tres estados y no dos:
 * además de error y éxito está la PREGUNTA del tope de cordura —"¿es
 * correcta?"—, que no es un error (la carga puede ser legítima) y que la
 * pantalla contesta reenviando el mismo valor con `confirmada`.
 */
export type EstadoCotizacion = {
  error: string | null
  confirmar: string | null
  aviso: string | null
}

/**
 * Carga la cotización del dólar del local desde el chip "USD" de `/vender`
 * (spec 2026-10-18-cotizacion-del-dolar, decisiones 2 y 3).
 *
 * **Exige `COTIZACION` acá**, aunque la pantalla esconda el campo a quien no
 * lo tiene: una action se puede invocar sin pasar por la pantalla. Sin el
 * permiso, `forbidden()` —se relanza y lo resuelve Next—, igual que el resto
 * de las actions con permiso.
 *
 * `confirmada` es el campo que manda el botón "Sí, cargar" del tope de
 * cordura: sólo `"1"` vale, cualquier otra cosa es "sin confirmar", por lo
 * mismo que el consentimiento del cliente no se infiere.
 *
 * Revalida `/vender` (el chip y el cobro), `/inventario` (el equivalente en
 * pesos y el margen de la ficha) y `/plan-canje` (la calculadora arranca con
 * ella): las tres pantallas leen la vigente, y una que quede con la vieja
 * cotizaría con el dólar de ayer en su próxima carga. `'layout'` en inventario
 * para que alcance también a cada ficha.
 */
export async function cargarCotizacionDesdeVender(
  _e: EstadoCotizacion,
  datos: FormData,
): Promise<EstadoCotizacion> {
  try {
    const sesion = await exigirPermiso('COTIZACION')
    const carga = await cargarCotizacion({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      texto: String(datos.get('valor') ?? ''),
      confirmada: String(datos.get('confirmada') ?? '') === '1',
    })
    revalidatePath('/vender')
    revalidatePath('/inventario', 'layout')
    revalidatePath('/plan-canje')
    return { error: null, confirmar: null, aviso: `Quedó cargada: ${formatearCotizacion(carga.valor)}.` }
  } catch (e) {
    if (e instanceof ErrorDeCotizacion && (e.codigo === 'SALTO_GRANDE' || e.codigo === 'INVEROSIMIL')) {
      return { error: null, confirmar: e.message, aviso: null }
    }
    // `ErrorDeVenta` por la pertenencia del usuario (`exigirUsuario`), el
    // mismo caso que `traducirErrorDeCaja`. Todo lo demás se relanza: un bug
    // de verdad tiene que llegar al log.
    if (e instanceof ErrorDeCotizacion || e instanceof ErrorDeFormato || e instanceof ErrorDeVenta) {
      return { error: e.message, confirmar: null, aviso: null }
    }
    throw e
  }
}
