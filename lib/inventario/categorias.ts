import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { ErrorDeInventario, traducirErrorDeBase } from './errores'

/** El separador de niveles: el middot que la maqueta ya usa en
 *  "Accesorios · Protección". */
export const SEPARADOR = '·'

/** Cómo se vuelve a escribir un nivel plegado. Con espacios, que es la forma
 *  que se muestra; el parseo tolera las dos. */
const SEPARADOR_VISIBLE = ` ${SEPARADOR} `

export type CategoriaPartida = { raiz: string; hija: string | null }

/**
 * Parte el texto libre de `Articulo.categoria` en los dos niveles del árbol.
 *
 * Una sola regla, sin casos especiales: partir por el separador, trimear cada
 * segmento, **descartar los vacíos**, y de lo que queda el primero es la raíz
 * y el resto —unido de nuevo— es la hija. De ahí salen todos los bordes: un
 * texto sin separador da una raíz sola, `"· Samsung"` da `Samsung` sin hija
 * porque el segmento vacío se cae, y un tercer nivel se pliega adentro de la
 * hija en vez de tirarse.
 *
 * Plegar y no descartar es la decisión que importa: `"A · B · C"` da
 * `A` > `B · C`. Queda feo, pero no borra en silencio algo que alguien
 * escribió — y el modelo tiene dos niveles, no tres.
 */
export function partirCategoria(texto: string | null | undefined): CategoriaPartida | null {
  const segmentos = (texto ?? '')
    .split(SEPARADOR)
    .map((s) => s.trim())
    .filter((s) => s !== '')

  if (segmentos.length === 0) return null

  const [raiz, ...resto] = segmentos
  return { raiz, hija: resto.length > 0 ? resto.join(SEPARADOR_VISIBLE) : null }
}

/**
 * El texto tal como queda guardado: la forma canónica de la rama, o `null` si
 * el texto no produce ninguna.
 *
 * **Normaliza a propósito, no sólo trimea.** Mientras `articulos.categoria` (el
 * texto) y `articulos.categoria_id` (el árbol) convivan —expand/contract—,
 * tienen que decir siempre lo mismo. Sin esto, "Fundas·Samsung" y
 * "Fundas · Samsung" crean UNA sola rama, correctamente, pero el listado los
 * muestra distinto: el árbol dice que son la misma categoría y la pantalla dice
 * que no.
 *
 * Y un texto que no produce ninguna rama —"·", " · · "— tampoco puede quedar
 * como texto: dejaría un "·" suelto bajo el nombre del artículo, con el árbol
 * sin ningún lugar donde ponerlo. O las dos columnas dicen "sin categoría", o
 * ninguna lo dice.
 */
export function textoDeCategoria(texto: string | null | undefined): string | null {
  const partida = partirCategoria(texto)
  if (partida === null) return null
  return partida.hija === null ? partida.raiz : partida.raiz + SEPARADOR_VISIBLE + partida.hija
}

/**
 * Busca o crea la rama del árbol que corresponde al texto, y devuelve el id de
 * la HOJA — o el de la raíz si el texto no trae hija, o `null` si no trae nada.
 *
 * Existe para que el árbol se vaya poblando solo mientras los formularios
 * siguen mandando texto libre: sin esto, todo artículo cargado entre este
 * deploy y el de la UI nacería sin rama y el ciclo siguiente tendría que correr
 * un segundo backfill.
 *
 * **El INSERT va con `ON CONFLICT DO NOTHING`, y eso es load-bearing.**
 * `crearArticulo` tiene una invariante escrita en un comentario largo: adentro
 * de su transacción un P2002 no puede ser otra cosa que el SKU. `esSkuRepetido`
 * se apoya en eso — bajo `arandano_app` devuelve `true` para CUALQUIER P2002,
 * porque RLS hace que Postgres retenga el `DETAIL` del error y los nombres de
 * columna nunca lleguen. Un `create` normal de Prisma acá haría que una
 * colisión de categoría se leyera como "SKU repetido": el alta reintentaría
 * cinco veces con SKUs distintos, chocaría siempre por lo mismo, y terminaría
 * diciendo "no se pudo generar un código libre" — un mensaje que no tiene nada
 * que ver con lo que pasó. Con `ON CONFLICT` no se tira P2002 nunca y la
 * invariante sigue en pie.
 *
 * Y resuelve la carrera de paso: bajo READ COMMITTED —el default de Postgres—
 * el INSERT bloqueado por otra transacción que todavía no comiteó se destraba
 * al commit de esa otra, no inserta nada, y el SELECT posterior SÍ ve la fila
 * recién comiteada.
 *
 * **Corre adentro de la transacción del artículo, no en una propia.** La
 * alternativa —una transacción separada, como hace `proximoSku`— dejaría
 * categorías fantasma cada vez que el alta falla después de resolverlas. Un
 * hueco en la secuencia de SKU no se ve nunca; una categoría vacía la ve el
 * dueño la primera vez que abre el árbol.
 */
export async function asegurarCategoria(
  tx: ClienteTx,
  tenantId: string,
  texto: string | null | undefined,
): Promise<string | null> {
  const partida = partirCategoria(texto)
  if (partida === null) return null

  const raizId = await asegurarFila(tx, tenantId, partida.raiz, null)
  if (partida.hija === null) return raizId
  return asegurarFila(tx, tenantId, partida.hija, raizId)
}

/**
 * Una fila del árbol, buscada o creada. `padreId` null es una raíz.
 *
 * El id lo genera `gen_random_uuid()` (v4) y no el `uuid(7)` que produce
 * Prisma, porque el INSERT es crudo — ver arriba por qué tiene que serlo. Nada
 * depende de la versión del uuid: `esUuid` sólo mira la forma, y `test/datos.ts`
 * ya inserta tenants y usuarios así.
 */
async function asegurarFila(
  tx: ClienteTx,
  tenantId: string,
  nombre: string,
  padreId: string | null,
): Promise<string> {
  const insertadas = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${nombre}, ${padreId}::uuid, now(), now())
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  if (insertadas.length > 0) return insertadas[0].id

  // No insertó, así que ya existía. `IS NOT DISTINCT FROM` y no `=` porque
  // `padre_id` es NULL en las raíces, y `NULL = NULL` no es true: con `=` esta
  // consulta devolvería cero filas justo para las raíces, que son la mitad de
  // los casos.
  const existentes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM categorias
     WHERE tenant_id = ${tenantId}::uuid
       AND nombre = ${nombre}
       AND padre_id IS NOT DISTINCT FROM ${padreId}::uuid
     LIMIT 1
  `
  if (existentes.length === 0) {
    // Inalcanzable: adentro de la transacción, entre el INSERT que chocó y este
    // SELECT, la fila no se puede haber ido. Explícito igual — un
    // `existentes[0].id` sobre un array vacío sería un TypeError sin nada que
    // lo explique, en un archivo que habla SQL crudo.
    throw new ErrorDeInventario(
      'CATEGORIA_INDETERMINADA',
      `no se pudo resolver la categoría ${nombre}`,
    )
  }
  return existentes[0].id
}

/** Una rama del árbol tal como la dibuja el panel: con su cuenta ya resuelta. */
export type RamaConHijas = {
  id: string
  nombre: string
  cuenta: number
  hijas: { id: string; nombre: string; cuenta: number }[]
}

type Alcance = { verInactivos: boolean }

/** El filtro de artículos que comparten el árbol y el listado, para que los
 *  números de los dos hablen del mismo conjunto de filas. */
const dondeArticulos = ({ verInactivos }: Alcance) => (verInactivos ? {} : { desactivadoEn: null })

/**
 * El árbol del local, con la cuenta de artículos de cada rama.
 *
 * **Un solo `groupBy` y la suma en JavaScript**, no una consulta por rama: con
 * veinte rubros y sus marcas serían sesenta consultas para dibujar una columna.
 *
 * Y **nada de `$queryRaw`** para esto: la extensión de `lib/tenant/prisma.ts`
 * intercepta operaciones de modelo para setear `arandano.tenant_id`, no raw
 * queries, así que una consulta cruda sin esa variable choca contra RLS y
 * devuelve cero filas **en silencio**. Ya pasó en `/ventas` y en `/inventario`;
 * no hace falta una tercera.
 *
 * **La cuenta de un rubro incluye la de sus marcas**, más los artículos
 * colgados del rubro mismo. Si no cerrara, el número de arriba no coincidiría
 * con la suma de abajo y el árbol dejaría de servir para decidir.
 */
export async function arbolDeCategorias(
  tenantId: string,
  alcance: Alcance,
): Promise<RamaConHijas[]> {
  const prisma = prismaParaTenant(tenantId)

  const [categorias, porCategoria] = await Promise.all([
    prisma.categoria.findMany({
      select: { id: true, nombre: true, padreId: true },
      orderBy: { nombre: 'asc' },
    }),
    prisma.articulo.groupBy({
      by: ['categoriaId'],
      where: { ...dondeArticulos(alcance), categoriaId: { not: null } },
      _count: { _all: true },
    }),
  ])

  const propios = new Map<string, number>()
  for (const fila of porCategoria) {
    if (fila.categoriaId) propios.set(fila.categoriaId, fila._count._all)
  }

  const hijasPorPadre = new Map<string, RamaConHijas['hijas']>()
  for (const c of categorias) {
    if (!c.padreId) continue
    const lista = hijasPorPadre.get(c.padreId) ?? []
    lista.push({ id: c.id, nombre: c.nombre, cuenta: propios.get(c.id) ?? 0 })
    hijasPorPadre.set(c.padreId, lista)
  }

  return categorias
    .filter((c) => c.padreId === null)
    .map((raiz) => {
      const hijas = hijasPorPadre.get(raiz.id) ?? []
      return {
        id: raiz.id,
        nombre: raiz.nombre,
        // Lo propio MÁS lo de las marcas: ver el comentario de arriba.
        cuenta: (propios.get(raiz.id) ?? 0) + hijas.reduce((t, h) => t + h.cuenta, 0),
        hijas,
      }
    })
}

/** Cuántos artículos no cuelgan de ninguna rama. Es la fila del pie del panel,
 *  que sólo se dibuja si este número es mayor que cero. */
export async function cuentaSinCategoria(tenantId: string, alcance: Alcance): Promise<number> {
  return prismaParaTenant(tenantId).articulo.count({
    where: { ...dondeArticulos(alcance), categoriaId: null },
  })
}

function exigirNombreDeCategoria(nombre: string): string {
  const limpio = nombre.trim()
  if (limpio === '') {
    throw new ErrorDeInventario('NOMBRE_VACIO', 'la categoría necesita un nombre')
  }
  return limpio
}

/** La fila, o el error de dominio. `findFirst` y no `findUnique` para que un id
 *  de otro tenant —que RLS vuelve invisible— salga como "no existe" y no como
 *  un P2025 crudo que nadie atrapa. */
async function exigirCategoria(tx: ClienteTx, categoriaId: string) {
  const c = await tx.categoria.findFirst({
    where: { id: categoriaId },
    select: { id: true, nombre: true, padreId: true },
  })
  if (!c) {
    throw new ErrorDeInventario(
      'CATEGORIA_INEXISTENTE',
      `la categoría ${categoriaId} no existe en este tenant`,
    )
  }
  return c
}

/** Traduce el choque de unicidad —cualquiera de los dos índices, el normal de
 *  las hijas y el parcial de las raíces— al error del módulo. */
function esCategoriaRepetida(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

export async function crearCategoria({
  tenantId,
  nombre,
  padreId,
}: {
  tenantId: string
  nombre: string
  padreId: string | null
}): Promise<{ id: string }> {
  const limpio = exigirNombreDeCategoria(nombre)
  try {
    return await enTransaccionDeTenant(tenantId, async (tx) => {
      if (padreId) {
        const padre = await exigirCategoria(tx, padreId)
        // Colgar de una hija sería el tercer nivel. Misma regla que
        // `moverCategoria`, chequeada acá porque el padre llega del cliente.
        if (padre.padreId !== null) {
          throw new ErrorDeInventario(
            'CATEGORIA_ANIDADA',
            `${padre.nombre} ya es una marca: no puede tener marcas adentro`,
          )
        }
      }
      const creada = await tx.categoria.create({
        data: { tenantId, nombre: limpio, padreId },
        select: { id: true },
      })
      return creada
    })
  } catch (e) {
    if (esCategoriaRepetida(e)) {
      throw new ErrorDeInventario('CATEGORIA_REPETIDA', `${limpio} ya existe acá`)
    }
    throw traducirErrorDeBase(e)
  }
}

export async function renombrarCategoria({
  tenantId,
  categoriaId,
  nombre,
}: {
  tenantId: string
  categoriaId: string
  nombre: string
}): Promise<void> {
  const limpio = exigirNombreDeCategoria(nombre)
  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirCategoria(tx, categoriaId)
      await tx.categoria.updateMany({ where: { id: categoriaId }, data: { nombre: limpio } })
    })
  } catch (e) {
    if (esCategoriaRepetida(e)) {
      throw new ErrorDeInventario('CATEGORIA_REPETIDA', `${limpio} ya existe acá`)
    }
    throw traducirErrorDeBase(e)
  }
}

/**
 * Cambia de rubro una marca.
 *
 * **Sólo marcas**: mover un rubro debajo de otro crearía un tercer nivel, y el
 * modelo tiene dos. Ésta es la validación explícita que el ciclo del modelo
 * dejó sin escribir a propósito —no tenía ningún llamador, porque
 * `asegurarCategoria` estructuralmente no puede producir tres niveles— y entra
 * acá, con el primer escritor capaz de violarla.
 */
export async function moverCategoria({
  tenantId,
  categoriaId,
  padreId,
}: {
  tenantId: string
  categoriaId: string
  padreId: string | null
}): Promise<void> {
  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      const propia = await exigirCategoria(tx, categoriaId)
      if (propia.padreId === null) {
        throw new ErrorDeInventario(
          'CATEGORIA_ANIDADA',
          `${propia.nombre} es un rubro: sólo se pueden mover las marcas`,
        )
      }
      if (padreId !== null) {
        const destino = await exigirCategoria(tx, padreId)
        if (destino.padreId !== null) {
          throw new ErrorDeInventario(
            'CATEGORIA_ANIDADA',
            `${destino.nombre} es una marca: no puede tener marcas adentro`,
          )
        }
      }
      await tx.categoria.updateMany({ where: { id: categoriaId }, data: { padreId } })
    })
  } catch (e) {
    if (esCategoriaRepetida(e)) {
      throw new ErrorDeInventario('CATEGORIA_REPETIDA', 'ese rubro ya tiene una marca con ese nombre')
    }
    throw traducirErrorDeBase(e)
  }
}

/**
 * Borra una rama vacía.
 *
 * Los dos rechazos se chequean **antes** en vez de dejar que salte la FK, y no
 * es desconfianza del `ON DELETE RESTRICT` —que sigue siendo la garantía real—:
 * es para poder decir **cuántos** artículos hay. Un "no se puede borrar" sin el
 * número no le dice al dueño si tiene que mover uno o cuarenta.
 */
export async function borrarCategoria({
  tenantId,
  categoriaId,
}: {
  tenantId: string
  categoriaId: string
}): Promise<void> {
  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      const propia = await exigirCategoria(tx, categoriaId)

      const hijas = await tx.categoria.count({ where: { padreId: categoriaId } })
      if (hijas > 0) {
        throw new ErrorDeInventario(
          'CATEGORIA_CON_HIJAS',
          hijas === 1
            ? `${propia.nombre} tiene 1 marca adentro. Borrala o movela antes.`
            : `${propia.nombre} tiene ${hijas} marcas adentro. Borralas o movelas antes.`,
        )
      }

      // Sin filtrar por desactivadoEn: un artículo dado de baja sigue
      // apuntando a la categoría, así que la FK lo frenaría igual. Contarlo
      // acá es lo que hace que el mensaje coincida con lo que va a pasar.
      const articulos = await tx.articulo.count({ where: { categoriaId } })
      if (articulos > 0) {
        throw new ErrorDeInventario(
          'CATEGORIA_CON_ARTICULOS',
          articulos === 1
            ? `${propia.nombre} tiene 1 artículo. Movelo antes de borrarla.`
            : `${propia.nombre} tiene ${articulos} artículos. Movelos antes de borrarla.`,
        )
      }

      await tx.categoria.deleteMany({ where: { id: categoriaId } })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

/**
 * Resuelve una rama ELEGIDA (por id) a su id validado y su texto canónico.
 *
 * Es la contraparte de `asegurarCategoria` para el camino de la pantalla: allá
 * el texto crea la rama, acá la rama ya existe y se toma su nombre. Devuelve
 * las dos cosas juntas porque el llamador necesita las dos —el id para la FK y
 * el texto para la columna que sigue viva hasta el contract— y resolverlas por
 * separado sería consultar dos veces lo mismo.
 *
 * Un id de otro tenant no resuelve a ninguna fila (RLS lo vuelve invisible) y
 * sale como `CATEGORIA_INEXISTENTE`, no como una FK reventando con un código
 * que nadie atrapa.
 */
export async function ramaElegida(
  tx: ClienteTx,
  categoriaId: string,
): Promise<{ id: string; texto: string }> {
  const propia = await tx.categoria.findFirst({
    where: { id: categoriaId },
    select: { id: true, nombre: true, padre: { select: { nombre: true } } },
  })
  if (!propia) {
    throw new ErrorDeInventario(
      'CATEGORIA_INEXISTENTE',
      `la categoría ${categoriaId} no existe en este tenant`,
    )
  }
  return {
    id: propia.id,
    texto: propia.padre ? `${propia.padre.nombre}${SEPARADOR_VISIBLE}${propia.nombre}` : propia.nombre,
  }
}
