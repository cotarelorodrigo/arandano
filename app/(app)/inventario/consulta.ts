/**
 * El query string de `/inventario` —leerlo y armarlo—, en un módulo **sin
 * `'use client'`** y sin ninguna dependencia de servidor.
 *
 * Vive separado de `panel-categorias.tsx` a propósito, y no es prolijidad: ese
 * archivo lleva `'use client'`, y una función exportada desde ahí **no se
 * puede invocar desde un Server Component** — llega como un proxy y Next tira
 * "Attempted to call categoriaDeQuery() from the server but categoriaDeQuery
 * is on the client". `page.tsx` la necesita para leer el query string antes de
 * consultar, así que tiene que estar de este lado.
 *
 * Es la dirección INVERSA del bug que cubre `test/limite-cliente-servidor.ts`
 * (un módulo cliente arrastrando `pg` al bundle), y por eso aquel test no la
 * veía: acá no hay ningún import pesado, sólo un borde que no se puede cruzar.
 *
 * Tampoco puede vivir en `lib/inventario/categorias.ts`: ese módulo importa
 * `prismaParaTenant`, así que el panel —que SÍ es cliente— arrastraría `pg` al
 * bundle apenas importara `SIN_CATEGORIA` como valor. Un archivo propio y sin
 * dependencias es lo único que sirve a los dos lados.
 */
import { esUuid } from '@/lib/uuid'

/** El filtro de tipo (design/arandano.pen, nodo `OgOlK`): `null` es "Todos". */
export type TipoFiltro = 'PRODUCTO' | 'SERVICIO'

/**
 * El `?tipo=` del query string, o `null` para "Todos".
 *
 * Cualquier valor que no sea uno de los dos válidos cae en "Todos" en vez de
 * filtrar por algo que no existe: mismo criterio que `fechaOhoy` en `/ventas`
 * y el clamp de `?p` — un query string escrito a mano no puede servir un 500
 * ni un listado vacío por un typo.
 */
export function tipoDeQuery(valor: string | undefined): TipoFiltro | null {
  return valor === 'PRODUCTO' || valor === 'SERVICIO' ? valor : null
}

/** Los filtros que ya están puestos, y que todo link de la pantalla conserva. */
export type FiltrosActivos = {
  busqueda: string
  verInactivos: boolean
  tipo: TipoFiltro | null
  cat?: string | null
}

/**
 * El link a `/inventario` con el filtro que corresponda — usado por la
 * paginación, las tabs de Tipo y el panel de categorías. Cada filtro es un
 * parámetro más del query string, no un mecanismo nuevo.
 *
 * **Vive acá y no en `page.tsx`** porque el panel de categorías es un Client
 * Component y la necesita: pasársela como prop no es opción — Next rechaza
 * mandar funciones a un componente cliente ("Functions cannot be passed
 * directly to Client Components").
 */
export function hrefListado({
  busqueda,
  verInactivos,
  tipo,
  cat = null,
  pagina,
  conservarPagina = false,
}: FiltrosActivos & {
  pagina?: number
  /** Sólo la paginación la conserva. Ver el comentario de abajo. */
  conservarPagina?: boolean
}): string {
  const u = new URLSearchParams()
  if (busqueda) u.set('q', busqueda)
  if (verInactivos) u.set('inactivos', '1')
  if (tipo) u.set('tipo', tipo)
  if (cat) u.set('cat', cat)
  // Cambiar de rama o de filtro DESCARTA la página, y sólo la paginación pide
  // conservarla: quedarse en la página 3 de un listado que ahora tiene ocho
  // artículos muestra un vacío que parece un error.
  if (conservarPagina && pagina && pagina > 1) u.set('p', String(pagina))
  const s = u.toString()
  return s ? `/inventario?${s}` : '/inventario'
}

/** El valor reservado de `?cat` para "los que no cuelgan de ninguna rama". No
 *  es un uuid a propósito: `categoriaDeQuery` los distingue por la forma. */
export const SIN_CATEGORIA = 'sin'

/**
 * El `?cat=` del query string, o `null` para "Todos".
 *
 * Mismo criterio que `tipoDeQuery` y que el clamp de `?p`: cualquier valor que
 * no sea un uuid o la palabra reservada cae en "Todos" en vez de filtrar por
 * algo que no existe. Un query string escrito a mano no puede servir un 500 ni
 * un listado vacío por un typo.
 *
 * Que el uuid EXISTA no se chequea acá: un id bien formado de una categoría
 * borrada —o de otro tenant, que RLS vuelve invisible— filtra a cero
 * resultados, y de eso se encarga el estado vacío, que además ofrece salida.
 */
export function categoriaDeQuery(valor: string | undefined): string | null {
  if (valor === SIN_CATEGORIA) return SIN_CATEGORIA
  return valor && esUuid(valor) ? valor : null
}
