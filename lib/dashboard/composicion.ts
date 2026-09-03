import { Prisma } from '@/generated/prisma/client'
// `import type`, no de valor: mismo motivo que lib/dashboard/metricas.ts y
// lib/ventas/cobrado.ts — acá `prismaParaTenant` sólo aparece dentro de un
// `ReturnType<typeof ...>`. Con un import de valor, un componente cliente que
// importara algo de este archivo arrastraría `lib/tenant/prisma.ts` a su
// bundle.
import type { prismaParaTenant } from '@/lib/tenant/prisma'
import type { MonedaElegida } from '@/lib/ventas/medios'
import { subtotalItem } from '@/lib/ventas/totales'
import { filtroDe, type Periodo } from './rango'

type Decimal = Prisma.Decimal
type PrismaDeTenant = ReturnType<typeof prismaParaTenant>

/**
 * Una fila del `groupBy` de ítems vendidos por `[articuloId, precioUnitario,
 * moneda]`.
 *
 * El precio va en la CLAVE y no en un `_sum`, por lo mismo que documenta
 * `FilaDePagos` en `lib/ventas/composicion.ts`: es lo que mantiene el
 * redondeo POR GRUPO y hace que la suma cierre contra los tiles del resto del
 * dashboard. Un artículo que cambió de precio a mitad de mes llega en dos
 * filas, y el número de grupos está acotado por el CATÁLOGO, no por el
 * volumen de ventas.
 */
export type FilaDeItems = {
  articuloId: string
  precioUnitario: Decimal
  moneda: 'ARS' | 'USD'
  _sum: { cantidad: Decimal | null }
}

/** Lo vendido de un artículo en el período, en una sola moneda. */
export type VendidoPorArticulo = { articuloId: string; unidades: Decimal; importe: Decimal }

/**
 * Junta las filas del `groupBy` por artículo, descarta la moneda que no es la
 * elegida, y ordena de mayor a menor importe.
 *
 * El importe de cada grupo sale de `subtotalItem` —nunca de
 * `cantidad.mul(precio)` a mano—: el motor compara totales de ítems contra
 * totales de pagos por igualdad, así que el redondeo tiene que ocurrir en el
 * mismo momento y de la misma forma en todos lados.
 */
export function agruparPorArticulo(filas: FilaDeItems[], moneda: MonedaElegida): VendidoPorArticulo[] {
  const buscada: 'ARS' | 'USD' = moneda === 'usd' ? 'USD' : 'ARS'
  const porArticulo = new Map<string, VendidoPorArticulo>()

  for (const f of filas) {
    if (f.moneda !== buscada) continue
    const cantidad = f._sum.cantidad
    // `_sum.cantidad` es `null` en un grupo vacío. No debería pasar con un
    // `groupBy` real —cada grupo nace de al menos una fila—, pero Prisma lo
    // tipa nullable y construir un Decimal desde `null` explota.
    if (cantidad === null) continue

    const importe = subtotalItem(cantidad, f.precioUnitario)
    const previo = porArticulo.get(f.articuloId)
    porArticulo.set(f.articuloId, previo
      ? { articuloId: f.articuloId, unidades: previo.unidades.add(cantidad), importe: previo.importe.add(importe) }
      : { articuloId: f.articuloId, unidades: cantidad, importe })
  }

  return [...porArticulo.values()].sort((a, b) => b.importe.comparedTo(a.importe))
}

/** Los ítems vendidos del período, la materia prima de este módulo. */
export async function itemsDelPeriodo(prisma: PrismaDeTenant, periodo: Periodo): Promise<FilaDeItems[]> {
  return prisma.ventaItem.groupBy({
    by: ['articuloId', 'precioUnitario', 'moneda'],
    // `anuladaEn: null` es la regla que este módulo existe para proteger:
    // una venta anulada no es plata que entró, y por eso vive en una función
    // exportada con su propio test en la base efímera —no inline en un Server
    // Component, que ningún test puede llamar (ver el hallazgo I3 que ya cita
    // metricasDelPeriodo).
    where: { venta: { ...filtroDe(periodo), anuladaEn: null } },
    _sum: { cantidad: true },
  })
}

/**
 * A qué rama del árbol de categorías cuelga cada artículo, ya resuelta a
 * RAÍZ.
 *
 * Un artículo colgado de una HOJA (una marca, "Samsung") suma a su RAÍZ
 * ("Celulares") — `padre?.nombre ?? nombre` —, que es como el panel de
 * `/inventario` ya cuenta. Uno sin `categoriaId` no aparece en el mapa; el
 * llamador lo resuelve al rótulo sintético que elija `elegirRotuloSintetico`
 * contra `CANDIDATOS_SIN_CATEGORIA`, no a un literal fijo — ver esa función,
 * más abajo, para el motivo.
 */
export async function ramaPorArticulo(prisma: PrismaDeTenant, ids: string[]): Promise<Map<string, string>> {
  const articulos = await prisma.articulo.findMany({
    where: { id: { in: ids } },
    select: { id: true, categoriaArbol: { select: { nombre: true, padre: { select: { nombre: true } } } } },
  })

  const mapa = new Map<string, string>()
  for (const a of articulos) {
    if (!a.categoriaArbol) continue
    mapa.set(a.id, a.categoriaArbol.padre?.nombre ?? a.categoriaArbol.nombre)
  }
  return mapa
}

/** Cuántos gajos dibuja el anillo como máximo, cola "Otros" incluida. */
export const MAX_GAJOS = 5

/**
 * Candidatas para el rótulo del agregado "Otros" del anillo, en orden de
 * preferencia. `Categoria.nombre` es texto libre: un local puede tener un
 * rubro literalmente nombrado "Otros" —o "Otros accesorios", abreviado—, así
 * que la primera candidata sola no alcanza (Ruling N de la review de la Task
 * 9). Una lista con MÁS de una alternativa es lo que además cierra el caso de
 * segundo orden que quedó diferido en esa misma review: un local con ramas
 * reales llamadas "Otros" **y** "Otras categorías" a la vez agota las dos
 * primeras y necesita la tercera. `elegirRotuloSintetico`, más abajo, recorre
 * esta lista contra los nombres reales presentes en los datos del local.
 */
export const CANDIDATOS_OTROS = ['Otros', 'Otras categorías', 'Otros artículos'] as const
/** El rótulo del agregado en el caso común, sin ninguna colisión. */
export const ROTULO_OTROS: string = CANDIDATOS_OTROS[0]
/** El rótulo del agregado cuando la primera candidata colisiona con una rama real. */
export const ROTULO_OTROS_AGRUPADO: string = CANDIDATOS_OTROS[1]

/**
 * Candidatas para el balde de artículos sin `categoriaId`, en el mismo orden
 * de preferencia que `CANDIDATOS_OTROS` y por el mismo motivo: un local puede
 * tener una rama real llamada "Sin categoría" —un catch-all tan plausible
 * como cualquier otro rubro—, y hasta la review final del ciclo esa colisión
 * no tenía salida (a diferencia de "Otros", que sí la tenía desde la Task 9).
 * Sin ella, la mercadería sin categorizar del local se sumaba en silencio
 * DENTRO del gajo de esa rama real, sin forma de distinguir una cosa de la
 * otra.
 */
export const CANDIDATOS_SIN_CATEGORIA = ['Sin categoría', 'Sin categorizar', 'Artículos sin categoría'] as const
/** El balde en el caso común, sin ninguna colisión. */
export const SIN_CATEGORIA: string = CANDIDATOS_SIN_CATEGORIA[0]

/**
 * Elige, de una lista de candidatas en orden de preferencia, la primera que
 * NO coincida con el nombre de ninguna rama real presente en los datos.
 *
 * Es el mecanismo ÚNICO detrás de los dos rótulos sintéticos de este
 * módulo —el agregado "Otros" y el balde `SIN_CATEGORIA`—, unificados en la
 * review final del ciclo: antes cada uno resolvía su colisión por separado
 * (uno la resolvía, el otro ni la intentaba), y las dos son exactamente el
 * mismo problema — una etiqueta que el código inventa puede coincidir con un
 * nombre que el local ya usa de verdad.
 *
 * Si TODAS las candidatas colisionan —un local con una rama real para cada
 * alternativa de la lista, un caso extremo pero posible con texto libre
 * ilimitado— se devuelve la última candidata igual: no hay forma de
 * garantizar cero colisión contra un catálogo de nombres sin límite, y no
 * devolver ningún rótulo sería peor que uno que, en ese caso extremo,
 * todavía puede colisionar.
 */
export function elegirRotuloSintetico(
  candidatas: readonly string[],
  nombresReales: ReadonlySet<string>,
): string {
  return candidatas.find((c) => !nombresReales.has(c)) ?? candidatas[candidatas.length - 1]
}

/**
 * Suma lo vendido por rama —RAÍZ, ya resuelta por `ramaPorArticulo`—,
 * ordenado de mayor a menor importe.
 *
 * Exportada y no inline en `app/(app)/dashboard/page.tsx` (el Server
 * Component async que la llama) por la misma regla que ya rige
 * `itemsDelPeriodo` en este archivo: una regla de negocio en un componente
 * async no la puede llamar ningún test — ver el hallazgo I3 que cita ese
 * docblock. Acá la regla es la elección del balde de "sin categoría": se
 * calcula ADENTRO de esta función, contra las ramas reales de `vendido`, no
 * antes — es la única forma de saber qué nombres colisionan sin haber armado
 * todavía la lista.
 */
export function sumarPorRama(
  vendido: VendidoPorArticulo[],
  ramas: ReadonlyMap<string, string>,
): { rotulo: string; importe: Decimal }[] {
  const rotuloSinCategoria = elegirRotuloSintetico(CANDIDATOS_SIN_CATEGORIA, new Set(ramas.values()))

  const suma = new Map<string, Decimal>()
  for (const v of vendido) {
    const rama = ramas.get(v.articuloId) ?? rotuloSinCategoria
    suma.set(rama, (suma.get(rama) ?? new Prisma.Decimal(0)).add(v.importe))
  }

  return [...suma.entries()]
    .map(([rotulo, importe]) => ({ rotulo, importe }))
    .sort((a, b) => b.importe.comparedTo(a.importe))
}

/**
 * Recorta a `MAX_GAJOS`, sumando la cola en un gajo agregado cuando hay más
 * de cinco ramas.
 *
 * Asume `porCategoria` ya ordenado de mayor a menor —lo arma el llamador a
 * partir de `agruparPorArticulo`, que ya ordena— así que la cola son
 * exactamente las ramas más chicas.
 *
 * El agregado toma la primera candidata de `CANDIDATOS_OTROS` que no
 * coincida con ninguna rama de la entrada —en cualquier posición, no sólo en
 * la cola—, vía `elegirRotuloSintetico`. Agrupar una rama chica real llamada
 * "Otros" dentro de la cola sigue siendo correcto —es exactamente lo que la
 * cola es, "todo lo demás"—; lo que no puede pasar es que el agregado y esa
 * rama se vuelvan indistinguibles para quien lee el anillo.
 */
export function repartirEnGajos(
  porCategoria: { rotulo: string; importe: Decimal }[],
): { rotulo: string; importe: Decimal }[] {
  if (porCategoria.length <= MAX_GAJOS) return porCategoria

  const primeros = porCategoria.slice(0, MAX_GAJOS - 1)
  const cola = porCategoria.slice(MAX_GAJOS - 1)
  const otros = cola.reduce((acc, c) => acc.add(c.importe), new Prisma.Decimal(0))
  const nombresReales = new Set(porCategoria.map((c) => c.rotulo))
  const rotuloDelAgregado = elegirRotuloSintetico(CANDIDATOS_OTROS, nombresReales)
  return [...primeros, { rotulo: rotuloDelAgregado, importe: otros }]
}

/**
 * El gajo más grande de una lista YA recortada por `repartirEnGajos` — NO
 * necesariamente el primero de la lista.
 *
 * `repartirEnGajos` agrega la cola en un único gajo "Otros" al FINAL del
 * array, sin ordenarlo de nuevo contra los que quedaron primeros: con
 * muchas ramas chicas, esa cola agregada puede pesar más que la rama que
 * encabeza la lista. Asumir `gajos[0]` ahí muestra en el centro del anillo
 * una categoría que no es la que más vendió — Minor 3 de la review de esta
 * task, que también pidió el caso que lo prueba (ver el test de este
 * archivo).
 *
 * Compara con `Decimal.greaterThan`, no con `Number(...)`: es la misma regla
 * de siempre (Minor 1 de la review) — la comparación exacta está disponible
 * antes de convertir a `string` para la vista, así que usarla acá no cuesta
 * nada.
 */
export function gajoMasGrande<T extends { importe: Decimal }>(gajos: T[]): T | null {
  if (gajos.length === 0) return null
  return gajos.reduce((max, g) => (g.importe.greaterThan(max.importe) ? g : max))
}

/** Cuántas filas dibuja el top de artículos. */
export const TOP_DE_ARTICULOS = 5

/** Una fila del top, ya lista para mostrar. */
export type FilaDeTop = { nombre: string; unidades: string; importe: string; ancho: number }

/**
 * Los cinco artículos más vendidos, con el largo de barra relativo al
 * PRIMERO —no al total—, que es lo que la maqueta dibuja: un ranking, no una
 * composición que tenga que sumar 100.
 *
 * Redondeado a entero, y **0 si el primero está en cero** para no dividir por
 * cero: sin la guarda el ancho sale `NaN`, y React lo escribe crudo en el
 * `style`.
 */
export function topDeArticulos(vendido: VendidoPorArticulo[], nombres: Map<string, string>): FilaDeTop[] {
  const primeros = vendido.slice(0, TOP_DE_ARTICULOS)
  const importeDelPrimero = primeros[0]?.importe ?? new Prisma.Decimal(0)

  return primeros.map((v) => ({
    nombre: nombres.get(v.articuloId) ?? '—',
    unidades: v.unidades.toString(),
    importe: v.importe.toString(),
    ancho: importeDelPrimero.isZero()
      ? 0
      : Number(v.importe.div(importeDelPrimero).mul(100).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)),
  }))
}
