import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { excedeEscala, ESCALA_DINERO, ESCALA_CANTIDAD } from '@/lib/ventas/totales'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeInventario, traducirErrorDeBase } from './errores'

type Decimal = Prisma.Decimal

export type EntradaCrearArticulo = {
  tenantId: string
  // Quién lo dio de alta. Se usa para firmar el movimiento del stock inicial:
  // `MovimientoStock.usuarioId` es obligatorio, y con razón — un movimiento
  // sin autor no se puede auditar.
  usuarioId: string
  nombre: string
  tipo: 'PRODUCTO' | 'SERVICIO'
  precio: Decimal
  sku?: string
  stockInicial?: Decimal | null
  costoUnitario?: Decimal | null
}

// Cuántas veces se salta el correlativo antes de rendirse. Agotar cinco
// seguidos significa que alguien tipeó a mano una racha de códigos con esta
// misma forma, y ahí el mensaje de error es mejor respuesta que seguir
// contando para siempre.
const INTENTOS_SKU = 5

function exigirNombre(nombre: string): string {
  const limpio = nombre.trim()
  if (limpio === '') {
    throw new ErrorDeInventario('NOMBRE_VACIO', 'el artículo necesita un nombre')
  }
  return limpio
}

function exigirPrecio(precio: Decimal): void {
  if (precio.lessThan(0)) {
    throw new ErrorDeInventario('PRECIO_INVALIDO', 'el precio no puede ser negativo')
  }
  if (excedeEscala(precio, ESCALA_DINERO)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el precio tiene a lo sumo ${ESCALA_DINERO} decimales`,
    )
  }
}

/**
 * El correlativo del SKU, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()` de artículos: contar les daría el
 * mismo número a dos altas concurrentes, y con `desactivadoEn` en juego
 * llegaría a repetir uno ya usado. Es el mismo mecanismo —y la misma razón—
 * que `proximoNumero` en lib/ventas/crear.ts.
 */
async function proximoSku(tx: ClienteTx, tenantId: string): Promise<string> {
  const filas = await tx.$queryRaw<{ proximo: number }[]>`
    UPDATE tenants
       SET proximo_sku_articulo = proximo_sku_articulo + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_sku_articulo - 1 AS proximo
  `
  // Cero filas significa que el tenant no existe, o que existe y RLS no lo deja
  // ver —que para el motor es lo mismo—. Sin este guard, `filas[0]` es
  // `undefined` y el llamador recibe un TypeError en vez de un
  // ErrorDeInventario, justo en la única línea que habla SQL crudo.
  if (filas.length === 0) {
    throw new ErrorDeInventario('TENANT_INEXISTENTE', `el tenant ${tenantId} no existe`)
  }
  return `A-${String(filas[0].proximo).padStart(4, '0')}`
}

/**
 * Si el error es la unicidad de `(tenant_id, sku)` y no otra cosa.
 *
 * `lib/db.ts` conecta SIEMPRE por `@prisma/adapter-pg` (acá y en producción:
 * no hay otro motor). Con ese adapter, Prisma NO arma `meta.target` con los
 * nombres de columna como hace el motor nativo — sólo reenvía el texto crudo
 * de Postgres en `meta.driverAdapterError.cause.originalMessage`. Ahí sí
 * viaja el nombre de la constraint, y Postgres lo arma solo a partir de
 * `@@unique([tenantId, sku])`: `articulos_tenant_id_sku_key`. Buscar ESE
 * nombre —y no `meta.target`, que acá siempre viene vacío— es lo que evita
 * que cualquier otra unicidad futura de `Articulo` se lea como un choque de
 * SKU.
 */
function esSkuRepetido(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const meta = e.meta as
    | { driverAdapterError?: { cause?: { originalMessage?: string } }; target?: unknown }
    | undefined
  const mensajeCrudo = meta?.driverAdapterError?.cause?.originalMessage ?? ''
  return (
    mensajeCrudo.includes('articulos_tenant_id_sku_key') ||
    // Por si algún día vuelve a poblarse `target` (otro adapter, otra
    // versión de Prisma): cubre las dos formas sin duplicar el chequeo.
    JSON.stringify(meta?.target ?? '').includes('sku')
  )
}

/**
 * Alta de artículo, con su stock inicial si lo tiene.
 *
 * **El reintento envuelve a la transacción entera y no vive adentro**, y eso no
 * es estilo: una violación de unicidad ABORTA la transacción en Postgres, así
 * que después del error ninguna sentencia más funciona sobre esa conexión.
 * Reintentar adentro fallaría con "current transaction is aborted".
 *
 * **Y el número del SKU se pide en SU PROPIA transacción, separada de la que
 * crea el artículo.** Si el `UPDATE` de `proximoSku` viviera en la misma
 * transacción que el `INSERT`, un choque de unicidad haría ROLLBACK de las dos
 * sentencias juntas —el avance del contador incluido—, porque eso es lo que
 * significa que la transacción entera se aborte. El reintento volvería a pedir
 * exactamente el mismo número, una y otra vez, hasta agotar los intentos sin
 * moverse nunca: el contador NO "ya avanzó" si la transacción que lo avanzó
 * nunca comiteó. Separar el `UPDATE` en su propia transacción, que comitea
 * apenas se ejecuta, es lo que hace que cada intento pida un número distinto.
 *
 * Sólo se reintenta el SKU AUTOGENERADO. Uno tipeado a mano que choca devuelve
 * `SKU_REPETIDO` sin más: cambiarle el código al que lo escribió sería decidir
 * por él.
 */
export async function crearArticulo(
  entrada: EntradaCrearArticulo,
): Promise<{ id: string; sku: string }> {
  const { tenantId, usuarioId, tipo, precio, stockInicial, costoUnitario } = entrada

  const nombre = exigirNombre(entrada.nombre)
  exigirPrecio(precio)

  const skuTipeado = entrada.sku?.trim()

  if (stockInicial !== null && stockInicial !== undefined) {
    if (tipo === 'SERVICIO') {
      throw new ErrorDeInventario(
        'SERVICIO_SIN_STOCK',
        'un servicio no lleva stock: dejá el stock inicial vacío',
      )
    }
    if (stockInicial.lessThan(0)) {
      throw new ErrorDeInventario('CANTIDAD_INVALIDA', 'el stock inicial no puede ser negativo')
    }
    if (excedeEscala(stockInicial, ESCALA_CANTIDAD)) {
      throw new ErrorDeInventario(
        'ESCALA_EXCEDIDA',
        `el stock inicial tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
      )
    }
  }
  if (costoUnitario !== null && costoUnitario !== undefined) {
    if (costoUnitario.lessThan(0)) {
      throw new ErrorDeInventario('COSTO_INVALIDO', 'el costo no puede ser negativo')
    }
    if (excedeEscala(costoUnitario, ESCALA_DINERO)) {
      throw new ErrorDeInventario(
        'ESCALA_EXCEDIDA',
        `el costo tiene a lo sumo ${ESCALA_DINERO} decimales`,
      )
    }
  }

  for (let intento = 1; intento <= INTENTOS_SKU; intento++) {
    // Transacción propia y ya comiteada al volver: si el INSERT de más abajo
    // choca, este número no se pierde con el rollback de esa otra transacción.
    const sku = skuTipeado && skuTipeado !== ''
      ? skuTipeado
      : await enTransaccionDeTenant(tenantId, (tx) => proximoSku(tx, tenantId))

    try {
      return await enTransaccionDeTenant(tenantId, async (tx) => {
        await exigirUsuario(tx, usuarioId)

        const articulo = await tx.articulo.create({
          data: { tenantId, sku, nombre, tipo, precio },
        })

        // El stock inicial NO se escribe en la columna: nace como movimiento,
        // en esta misma transacción. La invariante del motor es que el stock
        // es la suma de sus movimientos, y un artículo que nace con 5 sin nada
        // que lo explique es justo la pregunta que la tabla append-only existe
        // para poder responder.
        if (stockInicial && stockInicial.greaterThan(0)) {
          await tx.movimientoStock.create({
            data: {
              tenantId,
              articuloId: articulo.id,
              delta: stockInicial,
              motivo: 'INGRESO',
              usuarioId,
              costoUnitario: costoUnitario ?? null,
              nota: 'stock inicial',
            },
          })
          await tx.articulo.update({
            where: { id: articulo.id },
            data: { stock: { increment: stockInicial } },
          })
        }

        return { id: articulo.id, sku }
      })
    } catch (e) {
      if (!esSkuRepetido(e)) throw traducirErrorDeBase(e)
      // Tipeado a mano: es un choque real y quien lo escribió tiene que verlo.
      if (skuTipeado && skuTipeado !== '') {
        throw new ErrorDeInventario('SKU_REPETIDO', `el código ${skuTipeado} ya está usado`)
      }
      // Autogenerado: alguien tipeó a mano un código con esta forma. Se saltea
      // y se prueba con el siguiente; el contador ya avanzó.
      if (intento === INTENTOS_SKU) {
        throw new ErrorDeInventario(
          'SKU_REPETIDO',
          'no se pudo generar un código libre: escribí uno a mano',
        )
      }
    }
  }
  // Inalcanzable: el for de arriba retorna o tira. Existe para que TypeScript
  // vea un retorno en todos los caminos.
  throw new ErrorDeInventario('SKU_REPETIDO', 'no se pudo generar un código libre')
}

/** El tipo NO está y no es un olvido: ver el comentario del test. */
export async function editarArticulo(entrada: {
  tenantId: string
  articuloId: string
  nombre: string
  sku: string
  precio: Decimal
}): Promise<void> {
  const { tenantId, articuloId, precio } = entrada

  const nombre = exigirNombre(entrada.nombre)
  exigirPrecio(precio)

  const sku = entrada.sku.trim()
  if (sku === '') {
    // No se autogenera acá: el artículo ya tiene un código, y vaciar el campo
    // es más probablemente un error de la persona que un pedido de uno nuevo.
    throw new ErrorDeInventario('SKU_VACIO', 'el código no puede quedar vacío')
  }

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      // `updateMany` y no `update`: con RLS, un id de otro tenant no existe
      // para esta conexión, y `update` tira P2025 — un error de Prisma sin
      // `codigo`. Contar filas afectadas deja decirlo con el error del módulo.
      const { count } = await tx.articulo.updateMany({
        where: { id: articuloId },
        data: { nombre, sku, precio },
      })
      if (count === 0) {
        throw new ErrorDeInventario(
          'ARTICULO_INEXISTENTE',
          `el artículo ${articuloId} no existe en este tenant`,
        )
      }
    })
  } catch (e) {
    if (esSkuRepetido(e)) {
      throw new ErrorDeInventario('SKU_REPETIDO', `el código ${sku} ya está usado`)
    }
    throw traducirErrorDeBase(e)
  }
}

async function marcarBaja(tenantId: string, articuloId: string, valor: Date | null): Promise<void> {
  await enTransaccionDeTenant(tenantId, async (tx) => {
    const { count } = await tx.articulo.updateMany({
      where: { id: articuloId },
      data: { desactivadoEn: valor },
    })
    if (count === 0) {
      throw new ErrorDeInventario(
        'ARTICULO_INEXISTENTE',
        `el artículo ${articuloId} no existe en este tenant`,
      )
    }
  })
}

/** El artículo deja de ofrecerse. Su historial y sus ventas quedan intactos:
 *  las FKs son Restrict a propósito y borrarlo se llevaría lo que se vendió. */
export async function desactivarArticulo(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  await marcarBaja(entrada.tenantId, entrada.articuloId, new Date())
}

export async function reactivarArticulo(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  await marcarBaja(entrada.tenantId, entrada.articuloId, null)
}
