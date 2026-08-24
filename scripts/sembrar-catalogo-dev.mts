/**
 * Catálogo sintético para mirar la aplicación en dev:
 * `npm run catalogo:sembrar -- <tenantId> <usuarioId>`.
 *
 * **Es el que faltaba de los tres**, y su ausencia no era gratis: los otros dos
 * sembradores lo daban por hecho —`sembrar-ventas-dev.mts` arranca con un
 * `porSku('A-0001')!` que explota con un `TypeError` si el catálogo está
 * vacío—, y `docs/sistema-de-diseno.md` deja anotado, en la verificación visual
 * del punto de venta, que "el canario de dev arranca sin catálogo, así que hay
 * que sembrarlo antes". Eso venía siendo un párrafo que había que releer y un
 * INSERT que había que escribir a mano cada vez.
 *
 * **Sólo dev.** Escribe artículos de mentira; correrlo contra una base con
 * datos de clientes ensucia el inventario de alguien.
 *
 * Los SKU van de `A-0001` a `A-0007` porque son exactamente los que nombran las
 * recetas de `sembrar-ventas-dev.mts`. Los dos archivos están acoplados por ese
 * literal, y está bien que lo estén: sembrar el catálogo con otros códigos
 * dejaría el sembrador de ventas roto de una forma que sólo se ve al correrlo.
 * `A-0008` es la excepción y por eso va último: existe para el árbol de
 * categorías, ninguna venta lo nombra, y agregarlo no le toca nada al otro
 * sembrador — pero un `A-0009` que SÍ quiera venderse hay que darlo de alta en
 * los dos lados.
 *
 * Importes de distinta cantidad de dígitos a propósito —de $ 990 a $ 899.999—
 * porque con montos parejos no se puede ver si las columnas de números bailan.
 * Es la misma lección que ya dejaron anotada los otros dos sembradores, y la
 * razón por la que este archivo existe en vez de ser cinco INSERT.
 *
 * Un SERVICIO y un artículo con STOCK NEGATIVO entre ellos, que son los dos
 * casos que la pantalla dibuja distinto: el servicio lleva un guion en la
 * columna de stock —nunca un 0, que se leería como faltante— y el negativo
 * pinta el aviso. Sin ellos, `/inventario` sembrado se ve como una tabla
 * uniforme y no ejercita nada de lo que hay que mirar.
 *
 * **Las categorías siguen el mismo criterio**, ahora que arman un árbol de dos
 * niveles (tabla `categorias`): están elegidas para que el árbol sembrado tenga
 * los cuatro casos que la pantalla va a tener que dibujar distinto, y no siete
 * ramas iguales.
 *
 * - Un rubro con DOS marcas hermanas (`Fundas` → Apple y Samsung), que es lo
 *   único que ejercita el anidado de verdad y el conteo de una raíz sumando sus
 *   hijas.
 * - La MISMA marca bajo tres rubros distintos (Apple en Fundas, en Vidrios
 *   templados y en Repuestos). Son tres filas distintas, no una compartida, y
 *   confundirlas es el error fácil de cometer en la pantalla.
 * - Dos rubros SIN marca (`Cables`, `Cargadores`), que el cliente nombró
 *   sueltos: un artículo colgado de una raíz es un caso normal.
 * - Uno SIN categoría (el servicio), porque "sin categoría" es una rama más y
 *   siempre va a haber alguien ahí.
 */
import { Prisma } from '@/generated/prisma/client'
import { crearArticulo } from '@/lib/inventario/articulos'
import { ajustarStock } from '@/lib/inventario/stock'
import { prisma } from '@/lib/db'

const d = (v: string) => new Prisma.Decimal(v)

// Por argumento y no resueltos acá: la app conecta como `arandano_app`, sobre
// el que RLS aplica, así que un `findFirst` de tenants sin GUC no devuelve
// nada. Los ids salen de psql, que entra con el rol dueño. Mismo criterio que
// los otros dos sembradores.
const [tenantId, usuarioId] = process.argv.slice(2)
if (!tenantId || !usuarioId) {
  throw new Error('uso: sembrar-catalogo-dev.mts <tenantId> <usuarioId>')
}

type Receta = {
  sku: string
  nombre: string
  tipo: 'PRODUCTO' | 'SERVICIO'
  precio: string
  stockInicial: string | null
  costoUnitario: string | null
  /** Ventas de mentira que dejan el stock abajo de cero, para ver el aviso. */
  vendidoDeMas?: string
  /** El texto de categoría, que además arma el árbol (tabla `categorias`).
   *  `null` a propósito en una de las recetas: "sin categoría" es una rama más
   *  del árbol y va a existir siempre. */
  categoria: string | null
}

const RECETAS: Receta[] = [
  {
    sku: 'A-0001',
    categoria: 'Vidrios templados · Apple',
    nombre: 'Vidrio templado 9H · iPhone 13',
    tipo: 'PRODUCTO',
    precio: '4500',
    stockInicial: '48',
    costoUnitario: '2600',
  },
  {
    sku: 'A-0002',
    // Sin marca: el cliente nombró "cables, cargadores" sueltos, así que un
    // artículo colgado de una RAÍZ es un caso normal y el árbol lo dibuja.
    categoria: 'Cargadores',
    nombre: 'Cargador 20W USB-C Baseus',
    tipo: 'PRODUCTO',
    precio: '8900',
    stockInicial: '12',
    costoUnitario: '5100',
  },
  {
    sku: 'A-0003',
    categoria: 'Fundas · Apple',
    // Largo a propósito: es el que muestra si la columna de nombre desborda.
    nombre: 'Funda silicona antigolpe iPhone 13 / 13 Pro · Negra',
    tipo: 'PRODUCTO',
    precio: '23750',
    stockInicial: '3',
    costoUnitario: '14000',
    // Queda en -2: el caso que pinta el stock en rojo y suma al aviso del
    // subtítulo de /inventario.
    vendidoDeMas: '5',
  },
  {
    sku: 'A-0004',
    categoria: 'Celulares · Samsung',
    nombre: 'Samsung Galaxy A54 128 GB',
    tipo: 'PRODUCTO',
    // El más caro, que es el que ejercita los seis dígitos.
    precio: '899999',
    stockInicial: '2',
    costoUnitario: '640000',
  },
  {
    sku: 'A-0005',
    categoria: 'Repuestos · Apple',
    nombre: 'Batería original iPhone 11',
    tipo: 'PRODUCTO',
    precio: '112500',
    stockInicial: '7',
    costoUnitario: '78000',
  },
  {
    sku: 'A-0006',
    // El único SIN categoría, y no es un olvido: "Sin categoría" es una rama
    // más del árbol, y sin ningún artículo ahí la pantalla no la ejercita.
    categoria: null,
    nombre: 'Cambio de módulo · Mano de obra',
    // El único SERVICIO: su columna de stock es un guion, no un 0.
    tipo: 'SERVICIO',
    precio: '185000',
    stockInicial: null,
    costoUnitario: null,
  },
  {
    sku: 'A-0007',
    categoria: 'Cables',
    // El más barato, que es el otro extremo de la columna de precios.
    nombre: 'Cable Lightning 1m',
    tipo: 'PRODUCTO',
    precio: '990',
    stockInicial: '31',
    costoUnitario: '420',
  },
  {
    // El octavo, y el único que no nombra `sembrar-ventas-dev.mts`. Existe por
    // el ÁRBOL, no por el listado: es la segunda marca de un rubro que ya
    // tiene una, así que "Fundas" pasa a tener dos hijas y un conteo de dos.
    // Con siete artículos en siete rubros distintos, cada rama contaba uno y
    // la pantalla no ejercitaba ni las hermanas ni la suma de una raíz.
    sku: 'A-0008',
    categoria: 'Fundas · Samsung',
    nombre: 'Funda rígida Galaxy A54',
    tipo: 'PRODUCTO',
    precio: '15900',
    stockInicial: '9',
    costoUnitario: '8700',
  },
]

for (const receta of RECETAS) {
  const { id, sku } = await crearArticulo({
    tenantId,
    usuarioId,
    nombre: receta.nombre,
    sku: receta.sku,
    tipo: receta.tipo,
    precio: d(receta.precio),
    categoria: receta.categoria,
    stockInicial: receta.stockInicial === null ? null : d(receta.stockInicial),
    costoUnitario: receta.costoUnitario === null ? null : d(receta.costoUnitario),
  })

  if (receta.vendidoDeMas) {
    // Por `ajustarStock` y con motivo AJUSTE, no con un UPDATE al campo: el
    // stock es un caché de la suma de sus movimientos, y dejarlo en negativo
    // sin el movimiento que lo explica rompe la invariante que
    // test/ventas.test.ts comprueba.
    await ajustarStock({
      tenantId,
      usuarioId,
      articuloId: id,
      delta: d(`-${receta.vendidoDeMas}`),
      motivo: 'AJUSTE',
      nota: 'faltante detectado en el conteo (dato sintético de dev)',
    })
  }

  console.log(`${sku} → ${receta.nombre}`)
}

await prisma.$disconnect()
