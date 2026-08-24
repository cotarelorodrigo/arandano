import type { ClienteTx } from '@/lib/tenant/transaccion'
import { ErrorDeInventario } from './errores'

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
