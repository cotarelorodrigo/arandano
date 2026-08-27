import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { excedeEscala, ESCALA_DINERO, ESCALA_CANTIDAD } from '@/lib/ventas/totales'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeInventario, traducirErrorDeBase } from './errores'
import { asegurarCategoria, ramaElegida, textoDeCategoria } from './categorias'

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
  // Sigue llegando como texto libre —"Accesorios · Protección", con el " · "
  // tipeado a mano por quien carga el artículo—, pero ya no se guarda sólo
  // como texto: `asegurarCategoria` lo parte y arma con él la rama del árbol
  // (tabla `categorias`), y el artículo queda apuntando a la hoja. El texto se
  // sigue escribiendo igual mientras dure el expand/contract — es lo que hace
  // que un rollback a la imagen anterior encuentre el dato. Nullable: la
  // mayoría de los artículos que ya existen no la tienen y ninguno se rompe
  // sin ella.
  categoria?: string | null
  /**
   * La rama ELEGIDA del árbol, que es como manda la pantalla desde que existe
   * el panel de categorías. Cuando llega, **gana sobre `categoria`**: el texto
   * pasa a derivarse del nombre de la rama en vez de crearla.
   *
   * Los dos caminos conviven a propósito y no es transitorio: `categoria`
   * (texto) lo sigue usando `scripts/sembrar-catalogo-dev.mts`, y un seed no
   * es una pantalla — pedirle que resuelva ids antes de sembrar sería
   * complicarlo por nada.
   */
  categoriaId?: string | null
  stockInicial?: Decimal | null
  costoUnitario?: Decimal | null
  /**
   * El comprobante con el que entró la mercadería. No es una columna: va como
   * NOTA del movimiento de stock inicial, que es exactamente para lo que
   * `MovimientoStock.nota` existe y lo que el ingreso de mercadería de la
   * ficha ya hace.
   */
  facturaProveedor?: string | null
}

/**
 * El texto de categoría tal como se guarda.
 *
 * Vacío o sólo espacios va como NULL y no como cadena vacía: son la misma "no
 * hay categoría" y el listado y la ficha sólo tienen que chequear un caso, no
 * dos. Desde que existe el árbol, además NORMALIZA a la forma canónica de la
 * rama —ver `textoDeCategoria`—, así el texto y `categoria_id` nunca se
 * contradicen mientras los dos convivan.
 */
const limpiarCategoria = textoDeCategoria

/** La nota del movimiento de stock inicial, con el comprobante si lo hay.
 *  Concatenada y no en un campo propio: `MovimientoStock.nota` es texto libre
 *  a propósito, y el historial de la ficha ya lo muestra tal cual. */
function notaDelStockInicial(factura: string | null | undefined): string {
  const limpia = factura?.trim()
  return limpia ? `stock inicial · ${limpia}` : 'stock inicial'
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
 * El correlativo del SKU. Un `UPDATE … RETURNING` y no un `count()` de
 * artículos: contar les daría el mismo número a dos altas concurrentes, y con
 * `desactivadoEn` en juego llegaría a repetir uno ya usado.
 *
 * **A propósito distinto de `proximoNumero` (lib/ventas/crear.ts), aunque el
 * `UPDATE … RETURNING` se vea igual.** `proximoNumero` corre DENTRO de la
 * transacción que crea la venta, y ahí eso es lo correcto: si la venta falla,
 * todo se deshace junto, número incluido, y `Venta.numero` nunca tiene
 * huecos — CLAUDE.md lo pide así porque la gente dice "la venta 123" por
 * teléfono. Acá, en cambio, el llamador (`crearArticulo`) ejecuta esta
 * función en SU PROPIA transacción, separada de la que hace el `INSERT` del
 * artículo, y la comitea antes de intentarlo. Es a propósito: si el `UPDATE`
 * viviera adentro de la transacción del `INSERT`, un choque de unicidad
 * abortaría las dos sentencias juntas —el avance del contador incluido— y el
 * reintento de `crearArticulo` volvería a pedir el mismo número para
 * siempre, en un bucle que no converge.
 *
 * La consecuencia que compra esa separación: **la secuencia de SKU puede
 * tener huecos.** Un número que ya comiteó se pierde igual si el alta falla
 * después por otra razón —un `USUARIO_INEXISTENTE`, un desborde, una
 * conexión caída—, porque para entonces ya no hay vuelta atrás posible sobre
 * el contador. Eso es aceptable acá y no en `proximoNumero` por lo que es
 * cada número: el SKU es un código opaco que nadie cuenta ni nombra por
 * teléfono, así que un hueco no cuesta nada; el número de venta si.
 * Armonizar las dos funciones —hacia cualquiera de los dos lados— rompe una
 * de las dos garantías.
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
 * `meta.target` NUNCA se puebla acá: `lib/db.ts` conecta SIEMPRE por
 * `@prisma/adapter-pg` (este archivo y producción, no hay otro motor), y con
 * ese adapter Prisma 7 arma el `meta` de un error del adapter como
 * `{ driverAdapterError }`, no con `target` como hace el motor nativo.
 *
 * El equivalente estructurado SÍ existe, un nivel más adentro: para `23505`
 * (unique_violation), `@prisma/adapter-pg` parsea el `DETAIL` que manda
 * Postgres y arma `cause.constraint = { fields: [...] }` con los nombres de
 * columna — el mismo dato que `meta.target`, a otra profundidad. Leer eso, y
 * no rasguñar un nombre de índice del mensaje de texto, es lo que no se
 * rompe en silencio si algún día cambia cómo Postgres o Prisma arman esa
 * frase.
 *
 * Bajo `arandano_app` —el único rol con el que `lib/db.ts` conecta, acá y en
 * producción— `cause.constraint.fields` está SIEMPRE ausente. No es un borde:
 * es la rama que corre en todos los casos, en este deploy. La causa es RLS,
 * no los `GRANT`: `arandano_app` sí tiene `SELECT` sobre `articulos`
 * (`scripts/setup-db-roles.sh` se lo otorga sobre todas las tablas), pero
 * Postgres retiene el `DETAIL` del error —y con él, `fields`— cuando la
 * policy de RLS aplica al rol que corre la consulta. Comprobado en vivo
 * contra `arandano-dev-postgres-1`: el mismo INSERT duplicado como
 * `arandano_app` no trae ningún `DETAIL` ni con `VERBOSITY verbose`; como
 * superusuario con `BYPASSRLS` sí lo trae.
 *
 * Así que lo que sostiene esta función, hoy, es sólo el argumento de la
 * unicidad única: `articulos` tiene UNA sola (`@@unique([tenantId, sku])`) y
 * `movimientos_stock` ninguna, así que adentro de esta transacción un P2002
 * no puede ser otra cosa que el SKU. El chequeo de `campos` queda como red
 * LATENTE, no activa: para el día que aparezca una segunda unicidad en
 * `Articulo`, o que esto corra bajo un rol no sujeto a RLS —una migración,
 * un script de mantenimiento—, donde `fields` sí puede llegar poblado y
 * discriminar de verdad.
 */
function esSkuRepetido(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false
  const campos = (
    e.meta as { driverAdapterError?: { cause?: { constraint?: { fields?: string[] } } } } | undefined
  )?.driverAdapterError?.cause?.constraint?.fields
  return campos === undefined || campos.includes('sku')
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
  const categoria = limpiarCategoria(entrada.categoria)

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

        // Antes del create y en la MISMA transacción: si el alta se cae por
        // el choque de SKU de más abajo, la rama recién creada se va con el
        // rollback en vez de quedar colgando vacía en el árbol.
        //
        // Con `categoriaId` no se crea nada: la rama ya existe y sólo se toma
        // su nombre para el texto. Sin él, el texto libre la crea, que es el
        // camino que usa el seed.
        const rama = entrada.categoriaId
          ? await ramaElegida(tx, entrada.categoriaId)
          : { id: await asegurarCategoria(tx, tenantId, categoria), texto: categoria }

        const articulo = await tx.articulo.create({
          data: {
            tenantId, sku, nombre, tipo, precio,
            categoria: rama.texto,
            categoriaId: rama.id,
          },
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
              nota: notaDelStockInicial(entrada.facturaProveedor),
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

/**
 * El tipo NO está y no es un olvido: ver el comentario del test.
 *
 * `categoria` distingue `undefined` de `null`, y la diferencia es a propósito:
 * `undefined` es "no toques la categoría de este artículo" —lo que manda
 * `guardarArticulo` cuando quien edita no tiene el permiso `CATEGORIAS`—,
 * mientras que `null` o un string SÍ la tocan (la vacían o le arman una rama
 * nueva con `asegurarCategoria`). Sin la distinción, alguien con
 * `ARTICULOS_EDITAR` y sin `CATEGORIAS` podía escribir texto libre en el campo
 * y crear rubros y marcas al vuelo saltando el permiso que se supone que lo
 * autoriza — el mismo bypass que el switch le promete al dueño que no existe.
 */
export async function editarArticulo(entrada: {
  tenantId: string
  articuloId: string
  nombre: string
  sku: string
  precio: Decimal
  categoria?: string | null
}): Promise<void> {
  const { tenantId, articuloId, precio } = entrada

  const nombre = exigirNombre(entrada.nombre)
  exigirPrecio(precio)
  const tocaCategoria = entrada.categoria !== undefined
  const categoria = tocaCategoria ? limpiarCategoria(entrada.categoria) : undefined

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
      //
      // `categoria`/`categoriaId` sólo entran a `data` cuando `tocaCategoria`
      // es verdadero: un `undefined` explícito en `data` ya se comporta como
      // "no tocar" para Prisma, pero llamar a `asegurarCategoria` igual
      // insertaría una rama nueva sin necesidad — mejor no llamarlo.
      const data: Prisma.ArticuloUncheckedUpdateManyInput = { nombre, sku, precio }
      if (tocaCategoria) {
        data.categoriaId = await asegurarCategoria(tx, tenantId, categoria)
        data.categoria = categoria
      }

      const { count } = await tx.articulo.updateMany({
        where: { id: articuloId },
        data,
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
  try {
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
  } catch (e) {
    // Sin este catch, un articuloId sin forma de uuid (bajaArticulo y
    // reactivarArticuloAccion lo leen crudo del FormData) tira P2007 crudo:
    // el `updateMany` de arriba nunca llega a devolver `count`, así que el
    // ARTICULO_INEXISTENTE de este mismo bloque no lo atrapa. Mismo caso que
    // editarArticulo, un poco más abajo.
    throw traducirErrorDeBase(e)
  }
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
