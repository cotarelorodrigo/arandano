'use server'

import { revalidatePath } from 'next/cache'
import { exigirSesion, exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import {
  crearArticulo,
  editarArticulo,
  desactivarArticulo,
  reactivarArticulo,
} from '@/lib/inventario/articulos'
import { ingresarStock, corregirStock } from '@/lib/inventario/stock'
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

/** Sólo el dueño: el precio es plata y el catálogo es decisión del negocio. */
async function comoDuenio<T>(fn: (tenantId: string, usuarioId: string) => Promise<T>) {
  const sesion = await exigirDuenio()
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

export async function altaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const tipo = datos.get('tipo') === 'SERVICIO' ? 'SERVICIO' : 'PRODUCTO'
    const creado = await comoDuenio((tenantId, usuarioId) =>
      crearArticulo({
        tenantId,
        usuarioId,
        nombre: texto(datos, 'nombre'),
        tipo,
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        sku: texto(datos, 'sku'),
        categoria: texto(datos, 'categoria') || null,
        // Un servicio no lleva stock, y sin JavaScript los campos se ven
        // igual: se ignoran acá en vez de rechazar el alta por algo que la
        // persona no eligió mandar.
        stockInicial:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'stockInicial'), 'el stock inicial') : null,
        costoUnitario:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo') : null,
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
    await comoDuenio((tenantId) =>
      editarArticulo({
        tenantId,
        articuloId,
        nombre: texto(datos, 'nombre'),
        sku: texto(datos, 'sku'),
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        categoria: texto(datos, 'categoria') || null,
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
    await comoDuenio((tenantId) => desactivarArticulo({ tenantId, articuloId }))
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
    await comoDuenio((tenantId) => reactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo reactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

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
    const cantidad = await conSesion(async (tenantId, usuarioId) => {
      const cantidad = aDecimal(texto(datos, 'cantidad'), 'la cantidad')
      await ingresarStock({
        tenantId,
        articuloId,
        cantidad,
        usuarioId,
        costoUnitario: aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo'),
        nota: texto(datos, 'nota') || undefined,
      })
      return cantidad
    })
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `Ingresaron ${cantidad.toString()} unidades.` }
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
 * `comoDuenio`): exportar a CSV lo mismo que ya está en la tabla no es una
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

    const filas = movimientos.map((m, i) => [
      fechaCsv(m.creadoEn),
      textoDeMotivo(m.motivo),
      detalleDeMovimiento(m),
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
