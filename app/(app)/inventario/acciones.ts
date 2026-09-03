'use server'

import { revalidatePath } from 'next/cache'
import type { Moneda } from '@/generated/prisma/client'
import { exigirSesion } from '@/lib/auth/sesion'
import { exigirPermiso, puede } from '@/lib/permisos/guarda'
import type { Permiso } from '@/lib/permisos/catalogo'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import {
  crearArticulo,
  editarArticulo,
  desactivarArticulo,
  reactivarArticulo,
} from '@/lib/inventario/articulos'
import {
  crearCategoria,
  renombrarCategoria,
  moverCategoria,
  borrarCategoria,
} from '@/lib/inventario/categorias'
import { ingresarStock, corregirStock, darDeBajaUnidad } from '@/lib/inventario/stock'
import { prenderSerie, apagarSerie } from '@/lib/inventario/unidades'
import { ErrorDeInventario } from '@/lib/inventario/errores'
import { aDecimal, aDecimalOpcional, ErrorDeFormato } from '@/lib/formato/numeros'
import { esUuid } from '@/lib/uuid'
import { calcularSaldos, detalleDeMovimiento, textoDeMotivo } from './historial'
import { formatearCantidad, formatearFechaCorta, formatearHora } from '@/lib/formato/mostrar'

export type EstadoInventario = { error: string | null; aviso: string | null }

// El valor inicial NO vive acá, aunque sea lo natural: este archivo es
// 'use server', y ahí Next.js convierte cada export en un endpoint RPC, así que
// sólo admite funciones async. Exportar una constante hace que el módulo falle
// al evaluarse —en runtime, con el build en verde— y tira abajo la pantalla
// entera. Vive en formularios.tsx, igual que en usuarios y en login.
// test/use-server.test.ts lo fija.

/**
 * Quien tenga el permiso. Reemplaza al viejo `comoDuenio`: el catálogo y el ABM
 * dejaron de ser "cosa del dueño" para pasar a ser algo que el dueño delega —
 * ver `docs/superpowers/specs/2026-08-26-permisos-por-usuario-design.md`.
 */
async function comoPuede<T>(
  permiso: Permiso,
  fn: (tenantId: string, usuarioId: string) => Promise<T>,
) {
  const sesion = await exigirPermiso(permiso)
  return fn(sesion.tenant.id, sesion.usuario.id)
}

/**
 * Cualquiera con sesión. Recibir una caja del proveedor y corregir un faltante
 * es operación del día, la hace quien está atendiendo, y no queda anónima:
 * el movimiento se firma con este `usuarioId`.
 */
async function conSesion<T>(fn: (tenantId: string, usuarioId: string) => Promise<T>) {
  const sesion = await exigirSesion()
  return fn(sesion.tenant.id, sesion.usuario.id)
}

/**
 * Sólo los errores de dominio se muestran; el resto se relanza.
 *
 * Tragar un error desconocido lo convertiría en un cartel rojo genérico en la
 * pantalla, y el bug quedaría sin llegar nunca a Sentry ni al log. Los dos que
 * SÍ se muestran son los dos que la persona puede corregir tipeando distinto.
 *
 * `ErrorDeVenta` NO está en la lista, y no es un olvido: el único que puede
 * llegar por acá es el `USUARIO_INEXISTENTE` de `exigirUsuario`, y con una
 * sesión válida no puede pasar —RLS garantiza que el usuario de la sesión es de
 * este tenant—. Si pasa, es un bug y tiene que verse como tal.
 */
function traducir(e: unknown): EstadoInventario {
  if (e instanceof ErrorDeInventario || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim()

/**
 * Valida `moneda` contra el enum antes de pasarla al motor.
 *
 * `Moneda` es un tipo de TypeScript, no algo que Prisma revise en tiempo de
 * ejecución antes de tocar la base — a diferencia del `tipo` de artículo
 * (`altaArticulo`, más abajo), que sí cae a un default seguro. Acá no: el
 * `<SelectorDeMoneda>` (components/selector-de-moneda.tsx) sólo puede emitir
 * "ARS" o "USD", así que llegar con otra cosa es un `FormData` armado a
 * mano, no un descuido de quien carga el precio. No hay nada que esa persona
 * pueda corregir tipeando distinto, así que no se traduce a
 * `ErrorDeInventario`: cae en el error genérico de la acción, como cualquier
 * otro bug real.
 *
 * **Y tampoco puede ser una pestaña vieja**, que es la otra sospecha
 * razonable: el id de un server action se genera en el BUILD, y este proyecto
 * no fija `deploymentId` ni `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`
 * (`next.config.ts`), así que cada deploy los renueva y una pestaña anterior
 * choca contra "Failed to find Server Action" antes de que Next decodifique
 * el cuerpo. El handler no llega a correr. Es el mismo hecho que se explica
 * al lado del default de `cubre` en `app/(app)/vender/acciones.ts`.
 */
function monedaDe(datos: FormData): Moneda {
  const valor = texto(datos, 'moneda')
  if (valor !== 'ARS' && valor !== 'USD') {
    throw new Error(`moneda inválida: "${valor}"`)
  }
  return valor
}

export async function altaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const tipo = datos.get('tipo') === 'SERVICIO' ? 'SERVICIO' : 'PRODUCTO'
    const llevaSerie = datos.get('llevaSerie') === 'on'
    // `getAll` y no `get`: el formulario postea un campo por línea, todos con
    // el mismo name. Los vacíos se descartan acá —la lista arranca con una
    // fila en blanco y quien no la usa no debería recibir un IMEI_VACIO.
    const imeis = datos.getAll('imeis').map(String).filter((i) => i.trim() !== '')
    const creado = await comoPuede('ARTICULOS_CREAR', async (tenantId, usuarioId) =>
      crearArticulo({
        tenantId,
        usuarioId,
        nombre: texto(datos, 'nombre'),
        tipo,
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        moneda: monedaDe(datos),
        sku: texto(datos, 'sku'),
        // La marca gana sobre el rubro cuando hay las dos: la rama más
        // específica es la que el artículo tiene que ocupar. Con el rubro
        // solo, el artículo cuelga del rubro, que es un caso válido.
        categoriaId: texto(datos, 'marcaId') || texto(datos, 'categoriaId') || null,
        facturaProveedor: texto(datos, 'facturaProveedor') || null,
        // El switch viaja tal cual llegó, sin filtrar por tipo: un SERVICIO
        // con el switch prendido tiene que rechazarse con SERVICIO_SIN_STOCK
        // adentro de `crearArticulo`, no perderse en silencio acá.
        llevaSerie,
        imeis: llevaSerie ? imeis : undefined,
        // Un servicio no lleva stock, y sin JavaScript los campos se ven
        // igual: se ignoran acá en vez de rechazar el alta por algo que la
        // persona no eligió mandar. Con el switch de IMEI prendido TAMBIÉN se
        // manda (Task 5 del ciclo "unidades sin identificar"): ya no se
        // excluye, porque pasa a ser el número que gobierna la carga
        // progresiva — `crearArticulo` completa la diferencia con unidades
        // sin identificar, o rechaza si llegaron más IMEI que stock.
        stockInicial:
          tipo === 'PRODUCTO'
            ? aDecimalOpcional(texto(datos, 'stockInicial'), 'el stock inicial')
            : null,
        // El costo se descarta si esta persona no puede cargarlo: el campo no
        // se le dibuja, pero el <input> viaja igual si alguien arma el POST a
        // mano. La UI esconde; esto es lo que autoriza.
        costoUnitario:
          tipo === 'PRODUCTO' && (await puede('COSTOS'))
            ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo')
            : null,
      }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: `Artículo creado con el código ${creado.sku}.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function guardarArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    // Sin guard de `esUuid` acá: a diferencia del bridge que este componente
    // reemplaza (Task 6), `editarArticulo` ya no se llama después de un
    // `findUnique` propio de este archivo —el que tiraba P2007 crudo ante un
    // id sin forma de uuid—. `editarArticulo` resuelve con `updateMany` y
    // traduce P2007/P2023 con `traducirErrorDeBase` en su propio catch, igual
    // que ya hacen `bajaArticulo` y `reactivarArticuloAccion` más abajo en
    // este archivo, sin guard previo.
    await comoPuede('ARTICULOS_EDITAR', (tenantId) =>
      editarArticulo({
        tenantId,
        articuloId,
        nombre: texto(datos, 'nombre'),
        sku: texto(datos, 'sku'),
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        // La marca gana sobre el rubro cuando hay las dos: la rama más
        // específica es la que el artículo tiene que ocupar. Con el rubro
        // solo, el artículo cuelga del rubro, que es un caso válido. Misma
        // línea que `altaArticulo`, a propósito.
        //
        // **Sin guarda de `CATEGORIAS`**, y eso es la decisión de este ciclo
        // (spec 2026-08-28): colgar un artículo de una rama que ya existe es
        // editar el artículo. `CATEGORIAS` guarda el ABM del árbol —crear,
        // renombrar, mover, borrar—, que es lo que su descripción dice. El
        // bypass que motivaba la guarda vieja era el texto libre creando
        // ramas al vuelo, y ese camino ya no existe.
        categoriaId: texto(datos, 'marcaId') || texto(datos, 'categoriaId') || null,
        // Ya no se lee del artículo actual (el `findUnique` bridge de la
        // Task 6): el `<SelectorDeMoneda>` de la ficha (Task 7) la manda
        // siempre, precargada con la moneda vigente. Sacar el bridge cierra
        // de paso la ventana TOCTOU que esa task había dejado anotada — leer
        // la moneda actual y guardarla de vuelta unos milisegundos después,
        // sin lock, podía pisar un cambio concurrente.
        moneda: monedaDe(datos),
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Cambios guardados.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function bajaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoPuede('ARTICULOS_EDITAR', (tenantId) => desactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo desactivado. Su historial queda intacto.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function reactivarArticuloAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoPuede('ARTICULOS_EDITAR', (tenantId) => reactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo reactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * Recibir mercadería. Task 8 del ciclo de unidades por IMEI: aprende a leer
 * `imeis` — el motor (`ingresarStock`) ya los acepta desde la Task 3, pero
 * hasta esa task nada en el medio se los pasaba. Es acá, y no en la Task 3 ni
 * en la 7, porque es acá donde `MoverStock` empieza a postearlos: sin ese
 * cambio la pantalla mandaba a una acción que los ignoraba en silencio.
 *
 * **Task 5 del ciclo "unidades sin identificar" cambió la señal.** Antes,
 * `MoverStock` dibujaba UNA de las dos ramas (cantidad o lista) y `has('imeis')`
 * alcanzaba para saber cuál. Ahora la card "Ingresar mercadería" ofrece las
 * DOS a la vez —cantidad y la lista progresiva, escanear es opcional—, así que
 * el campo `imeis` viaja SIEMPRE que esa card se dibuje, vacío o no: la
 * presencia del campo dejó de decir nada. La señal pasa a ser la lista YA
 * FILTRADA — si quedó al menos un IMEI real se manda esa lista, si no se
 * manda la cantidad tipeada. Nunca las dos juntas: el motor (`ingresarStock`)
 * las rechaza a propósito, así que acá no se manda ninguna "por las dudas".
 */
export async function ingresarMercaderia(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    // El parseo va ADENTRO del closure, no antes: `conSesion` es lo que
    // dispara `exigirSesion()`, y un `aDecimal` que tire primero haría que un
    // llamador sin sesión reciba un error de formato en vez del redirect al
    // login. El guard no puede depender de que lo que mandaron sea válido.
    const cantidadIngresada = await conSesion(async (tenantId, usuarioId) => {
      // Mismo parseo que `altaArticulo`: `getAll` y no `get`, con los vacíos
      // descartados. Con la lista sin nada escaneado (todo vacío, o el campo
      // ni siquiera presente porque `llevaSerie` es falso) `imeisFiltrados`
      // queda `[]` y se manda la cantidad.
      const imeisFiltrados = datos.getAll('imeis').map(String).filter((i) => i.trim() !== '')
      const imeis = imeisFiltrados.length > 0 ? imeisFiltrados : undefined
      const cantidad = imeis ? undefined : aDecimal(texto(datos, 'cantidad'), 'la cantidad')
      await ingresarStock({
        tenantId,
        articuloId,
        cantidad,
        imeis,
        usuarioId,
        // Mismo criterio que en `altaArticulo`: el servidor es quien decide
        // si el costo se guarda, no la pantalla que lo dibuja o no.
        costoUnitario: (await puede('COSTOS'))
          ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo')
          : null,
        nota: texto(datos, 'nota') || undefined,
      })
      return imeis ? imeis.length.toString() : cantidad!.toString()
    })
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `Ingresaron ${cantidadIngresada} unidades.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function corregirPorConteo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    // Mismo motivo que en ingresarMercaderia: el parseo va adentro del
    // closure para que un input inválido no se adelante al guard.
    const stockContado = await conSesion(async (tenantId, usuarioId) => {
      const stockContado = aDecimal(texto(datos, 'stockContado'), 'el conteo')
      await corregirStock({
        tenantId,
        articuloId,
        stockContado,
        usuarioId,
        nota: texto(datos, 'nota') || undefined,
      })
      return stockContado
    })
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `El stock quedó en ${stockContado.toString()}.` }
  } catch (e) {
    return traducir(e)
  }
}

/**
 * Las tres acciones de unidades por IMEI (Task 8). El switch mueve UN
 * artículo, igual que su precio y su moneda —así que viaja con
 * `ARTICULOS_EDITAR`, ningún permiso nuevo—; dar de baja una unidad queda
 * donde ya están `ingresarMercaderia` y `corregirPorConteo`: operación del
 * día, firmada con el `usuarioId` de quien la hace.
 */
export async function prenderSerieAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    // `prenderSerie` ya no acepta IMEIs (ciclo "unidades sin identificar",
    // Task 2): cuenta el stock y las unidades libres que ya haya, y crea la
    // diferencia sin identificar. El diálogo que sigue posteando un campo
    // `imeis` por unidad es UI vieja, todavía sin tocar — Task 6 la
    // reemplaza por la card sin diálogo; hasta entonces, esos campos llegan
    // y simplemente no se leen.
    await comoPuede('ARTICULOS_EDITAR', (tenantId, usuarioId) =>
      prenderSerie({ tenantId, articuloId, usuarioId }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Este artículo ahora se maneja por IMEI.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function apagarSerieAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoPuede('ARTICULOS_EDITAR', (tenantId) => apagarSerie({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Este artículo ya no se maneja por IMEI.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function darDeBajaUnidadAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await conSesion((tenantId, usuarioId) =>
      darDeBajaUnidad({
        tenantId,
        unidadId: texto(datos, 'unidadId'),
        usuarioId,
        nota: texto(datos, 'nota') || undefined,
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Unidad dada de baja.' }
  } catch (e) {
    return traducir(e)
  }
}

// "Usuario" al final y no mezclado en "Detalle": la pantalla funde quién y
// qué en una sola celda porque la maqueta la pide así (design/arandano.pen),
// pero el CSV se vende como "el historial completo" y es el artefacto
// auditable — ahí el nombre tiene que poder filtrarse y ordenarse como
// columna propia, no quedar adentro de un string armado para leer, no para
// procesar (I6 de la review).
const ENCABEZADO_CSV = ['Fecha', 'Motivo', 'Detalle', 'Cambio', 'Queda', 'Usuario']

/**
 * Un apóstrofe adelante si el valor arranca con `=`, `+`, `-` o `@`: sin él,
 * Excel y Google Sheets abren esos cuatro caracteres iniciales como el
 * comienzo de una fórmula en vez de como texto (inyección de fórmulas, ver
 * la guía de OWASP sobre CSV injection). No es un caso de laboratorio: la
 * columna "Cambio" de ESTE MISMO archivo emite "+5" literal en cada ingreso,
 * así que sin neutralizar, cualquier exportación con al menos un ingreso ya
 * dispara el problema — no hace falta una nota manipulada a propósito. El
 * apóstrofe fuerza texto sin mostrarse en la celda al abrirla en una
 * planilla, que es como Excel y Sheets leen un CSV (no sólo cómo se tipea a
 * mano).
 */
function neutralizarFormula(valor: string): string {
  return /^[=+\-@]/.test(valor) ? `'${valor}` : valor
}

/**
 * Comillas dobles si el valor trae coma, comilla o salto de línea (regla
 * estándar de CSV, RFC 4180); las comillas internas se duplican al doblarlas.
 *
 * Sin esto, una nota como "Factura A 0001-00023145 · Distribuidora Sur" —el
 * estilo real de este repo, CLAUDE.md— todavía anda porque no tiene coma,
 * pero alcanza con que UNA nota la tenga (o traiga comillas) para que la fila
 * se parta en dos al abrirla en una planilla, silenciosamente: ninguna
 * herramienta avisa "esto estaba mal separado", el importe simplemente cae
 * en la columna de al lado.
 */
function celdaCsv(valor: string): string {
  const segura = neutralizarFormula(valor)
  return /[",\r\n]/.test(segura) ? `"${segura.replace(/"/g, '""')}"` : segura
}

function filaCsv(campos: string[]): string {
  return campos.map(celdaCsv).join(',')
}

/**
 * `Date` → "21/08/2026 · 14:28", CON año — a propósito distinto de
 * `formatearFechaMovimiento` (historial.tsx), que da "21/08 · 14:28" porque
 * la tabla en pantalla lo pide así (design/arandano.pen). El CSV no tiene el
 * límite de filas de la tabla —"el sentido de exportar es llevarse TODO el
 * historial"—, así que un artículo con varios años de antigüedad exportaría
 * filas de 2024 y de 2026 indistinguibles entre sí sin el año (I7 de la
 * review). Mismo armado que ya usa `/ventas/[id]` para su panel Resumen: ver
 * el comentario de `formatearFechaCorta`.
 */
function fechaCsv(v: Date): string {
  return `${formatearFechaCorta(v)} · ${formatearHora(v)}`
}

/**
 * El historial completo de un artículo, como CSV — en memoria, sin librería,
 * sin endpoint nuevo y sin streaming (decisión ya tomada): arma el string
 * entero acá y lo devuelve; quien llama (el botón "Exportar CSV →" de la
 * ficha) lo convierte en una descarga del lado del cliente con un Blob.
 *
 * **Sin restringir a dueño, a propósito.** Es de sólo lectura y de datos que
 * la propia pantalla ya le muestra a cualquier sesión (`conSesion`, no
 * `comoPuede`): exportar a CSV lo mismo que ya está en la tabla no es una
 * capacidad nueva que alguien pueda abusar, a diferencia de editar el
 * artículo o desactivarlo.
 *
 * **A diferencia de la tabla en pantalla, acá no hay límite de filas.** La
 * tabla corta en `MOVIMIENTOS_VISIBLES` (page.tsx) porque es lo que entra
 * cómodo en una pantalla; el sentido de exportar es llevarse TODO el
 * historial, no el mismo recorte en otro formato.
 */
export async function exportarHistorialCsv(
  articuloId: string,
): Promise<{ csv: string; nombreArchivo: string }> {
  // Antes de `conSesion`, mismo motivo que en el resto del archivo: un id sin
  // forma de uuid llega crudo (esto no pasa por un <form>, lo llama el botón
  // directo con la prop), y Prisma lo rechazaría con P2007 sin este guard.
  if (!esUuid(articuloId)) {
    throw new ErrorDeInventario(
      'ARTICULO_INEXISTENTE',
      `el artículo ${articuloId} no existe en este tenant`,
    )
  }

  return conSesion(async (tenantId) => {
    const prisma = prismaParaTenant(tenantId)

    const articulo = await prisma.articulo.findUnique({
      where: { id: articuloId },
      select: { sku: true, stock: true },
    })
    if (!articulo) {
      throw new ErrorDeInventario(
        'ARTICULO_INEXISTENTE',
        `el artículo ${articuloId} no existe en este tenant`,
      )
    }

    const movimientos = await prisma.movimientoStock.findMany({
      where: { articuloId },
      // `id` como segundo criterio: mismo motivo que la consulta de
      // movimientos de `[id]/page.tsx` (ver su comentario) — `creado_en` es
      // la hora de inicio de transacción, así que sin desempate la pantalla y
      // este CSV podían mostrar "Queda" distinto para las mismas filas.
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      select: {
        delta: true, motivo: true, nota: true, creadoEn: true, costoUnitario: true,
        usuario: { select: { nombre: true } },
        venta: { select: { numero: true } },
      },
    })

    // Mismo cálculo que la tabla en pantalla (historial.ts, calcularSaldos):
    // el saldo de cada fila se reconstruye recorriendo los deltas hacia atrás
    // desde el stock actual, nunca se guarda.
    const saldos = calcularSaldos(
      movimientos.map((m) => m.delta),
      articulo.stock,
    )

    // El CSV es el mismo dato que la tabla en otro formato, así que respeta el
    // mismo permiso. La acción sigue detrás de `conSesion` —exportar lo que la
    // pantalla ya muestra no es una capacidad nueva— pero exporta lo que ESA
    // persona puede ver, no lo que ve un dueño.
    const conCostos = await puede('COSTOS')

    const filas = movimientos.map((m, i) => [
      fechaCsv(m.creadoEn),
      textoDeMotivo(m.motivo),
      detalleDeMovimiento(m, conCostos),
      (m.delta.greaterThan(0) ? '+' : '') + formatearCantidad(m.delta.toString()),
      formatearCantidad(saldos[i].toString()),
      // La consulta ya trae `usuario` para armar "Detalle" en pantalla; acá
      // se usa también para la columna propia, en las cuatro filas —incluida
      // ANULACION_VENTA (quién anuló) e INGRESO (quién recibió la
      // mercadería), que "Detalle" ya no muestra desde el rediseño de la
      // pantalla.
      m.usuario.nombre,
    ])

    const csv = [ENCABEZADO_CSV, ...filas].map(filaCsv).join('\r\n')
    return { csv, nombreArchivo: `historial-${articulo.sku}.csv` }
  })
}

/**
 * El ABM del árbol de categorías, las cuatro por `comoPuede('CATEGORIAS')`.
 *
 * **Que el panel no le dibuje los controles a un empleado no alcanza**: un
 * server action es un endpoint, y se puede llamar sin pasar por la pantalla.
 * El criterio es el mismo que ya rige para el alta y la edición de artículo —
 * el catálogo es decisión del negocio, igual que el precio, pero ahora es un
 * permiso delegable y no un privilegio fijo del rol.
 *
 * Los cinco códigos que puede tirar el módulo (`NOMBRE_VACIO`,
 * `CATEGORIA_REPETIDA`, `CATEGORIA_ANIDADA`, `CATEGORIA_CON_HIJAS`,
 * `CATEGORIA_CON_ARTICULOS`) son de dominio y la persona puede actuar sobre
 * ellos, así que salen por `traducir` y llegan como cartel, no como 500.
 */
export async function crearCategoriaAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const padre = texto(datos, 'padreId')
    await comoPuede('CATEGORIAS', (tenantId) =>
      crearCategoria({ tenantId, nombre: texto(datos, 'nombre'), padreId: padre || null }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: padre ? 'Marca creada.' : 'Categoría creada.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function renombrarCategoriaAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    await comoPuede('CATEGORIAS', (tenantId) =>
      renombrarCategoria({
        tenantId,
        categoriaId: texto(datos, 'categoriaId'),
        nombre: texto(datos, 'nombre'),
      }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: 'Nombre actualizado.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function moverCategoriaAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const destino = texto(datos, 'padreId')
    await comoPuede('CATEGORIAS', (tenantId) =>
      moverCategoria({
        tenantId,
        categoriaId: texto(datos, 'categoriaId'),
        padreId: destino || null,
      }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: 'Marca movida.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function borrarCategoriaAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    await comoPuede('CATEGORIAS', (tenantId) =>
      borrarCategoria({ tenantId, categoriaId: texto(datos, 'categoriaId') }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: 'Categoría borrada.' }
  } catch (e) {
    return traducir(e)
  }
}
