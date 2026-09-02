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
 * `A-0008`, `A-0009` y `A-0010` son las excepciones y por eso van últimos:
 * existen para el árbol de categorías, el precio en dólares y las unidades por
 * IMEI respectivamente, ninguna venta los nombra, y agregarlos no le toca nada
 * al otro sembrador — pero un `A-0011` que SÍ quiera venderse hay que darlo de
 * alta en los dos lados.
 *
 * Importes de distinta cantidad de dígitos a propósito —de $ 990 a $ 899.999—
 * porque con montos parejos no se puede ver si las columnas de números bailan.
 * Es la misma lección que ya dejaron anotada los otros dos sembradores, y la
 * razón por la que este archivo existe en vez de ser cinco INSERT. `A-0009`
 * suma el otro eje de esa misma lección: **US$ 300**, tres dígitos y otro
 * símbolo, que es lo único que deja ver si la columna de precios se desalinea
 * cuando conviven las dos monedas.
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
 * - La MISMA marca bajo cuatro rubros distintos (Apple en Fundas, en Vidrios
 *   templados, en Repuestos y en Celulares). Son cuatro filas distintas, no una
 *   compartida, y confundirlas es el error fácil de cometer en la pantalla.
 * - Dos rubros SIN marca (`Cables`, `Cargadores`), que el cliente nombró
 *   sueltos: un artículo colgado de una raíz es un caso normal.
 * - Uno SIN categoría (el servicio), porque "sin categoría" es una rama más y
 *   siempre va a haber alguien ahí.
 *
 * **Y uno en DÓLARES** (`A-0009`, ciclo del precio en USD, 2026-08-29), que es
 * el que le da a la verificación manual contra qué mirar: sin ningún artículo
 * marcado en dólares la feature entera es invisible —el selector de `Cubre` no
 * se dibuja, la banda del total sigue teniendo una sola línea y el margen nunca
 * llega al caso nuevo—, así que sembrar sólo pesos deja el ciclo sin nada que
 * verificar. Lleva costo cargado **a propósito**, aunque el costo se guarde
 * siempre en pesos: es lo único que ejercita el "sin margen para un artículo en
 * dólares" del tile, que es la costura declarada con la deuda del costo. Con el
 * costo vacío el tile cae en "ningún ingreso cargó el costo todavía" y esa rama
 * no se mira nunca.
 *
 * **Y uno CON SERIE** (`A-0010`, ciclo de unidades por IMEI, 2026-09-02): tres
 * unidades ya cargadas, con IMEI de quince dígitos —el largo real— distintos
 * entre sí. Es el mismo criterio que ya justificó a `A-0009`: sin un artículo
 * con `llevaSerie` la card "Unidades" de `/inventario/[id]`, el escaneo exacto
 * de `/vender` y la línea del carrito sin stepper quedan invisibles en dev.
 * `stockInicial` va `null` a propósito —`crearArticulo` RECHAZA un stock
 * suelto junto con el switch prendido (`SERIE_REQUIERE_IMEIS`): el stock nace
 * del largo de la lista de IMEI, no de un número aparte.
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
  /** En qué moneda está `precio`. Ausente vale pesos, igual que en
   *  `crearArticulo`: son ocho de nueve recetas, y repetir `'ARS'` en todas
   *  sería ruido sobre el único caso que importa mirar. */
  moneda?: 'ARS' | 'USD'
  stockInicial: string | null
  costoUnitario: string | null
  /** Ventas de mentira que dejan el stock abajo de cero, para ver el aviso. */
  vendidoDeMas?: string
  /** El texto de categoría, que además arma el árbol (tabla `categorias`).
   *  `null` a propósito en una de las recetas: "sin categoría" es una rama más
   *  del árbol y va a existir siempre. */
  categoria: string | null
  /** Task 10 (unidades por IMEI): si este artículo se maneja por unidad.
   *  Ausente vale `false`, igual que en `crearArticulo` — es una sola receta
   *  de nueve la que lo necesita. */
  llevaSerie?: boolean
  /** Los IMEI de las unidades, sólo junto con `llevaSerie: true`. Reemplaza a
   *  `stockInicial`, que queda en `null`: el stock nace del largo de esta
   *  lista, no de un número aparte. */
  imeis?: string[]
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
  {
    // El noveno, y el único EN DÓLARES. Es el artículo del feedback que
    // originó el ciclo ("si lo compro en usd y lo cargo en pesos tengo que
    // estar modificando el precio todo el tiempo"), y el que aparece en los
    // tres números del spec: US$ 300 de lista, US$ 420 con el plan de 12
    // cuotas al 40 %, $ 623.700 cobrados en pesos a 1485.
    sku: 'A-0009',
    // Bajo un rubro que YA existe (Celulares, que hoy sólo tiene Samsung), así
    // que además deja el árbol con un segundo rubro de dos marcas hermanas.
    categoria: 'Celulares · Apple',
    nombre: 'iPhone 13 128 GB',
    tipo: 'PRODUCTO',
    moneda: 'USD',
    // Tres dígitos, que es el ancho que ninguno de los otros ocho tiene: los
    // precios en pesos van de 3 a 6 dígitos, pero éste llega además con otro
    // símbolo delante ("US$"), que es lo que hace bailar la columna si algo
    // está mal alineado.
    precio: '300',
    stockInicial: '4',
    // En PESOS, como todo costo (lib/inventario/stock.ts no conoce monedas).
    // Es lo que deja ver el "sin margen para un artículo en dólares" del tile.
    costoUnitario: '385000',
  },
  {
    // El décimo, y el único CON SERIE. Es el artículo del feedback de este
    // ciclo ("cada unidad con su IMEI, podríamos seleccionar cuál estamos
    // vendiendo"), y el que le da a la verificación manual contra qué mirar:
    // sin él, la card "Unidades", el escaneo exacto de /vender y la línea del
    // carrito sin stepper son invisibles en dev.
    sku: 'A-0010',
    // Bajo el mismo rubro que A-0009: dos marcas hermanas ya existentes
    // (Apple, Samsung), sin abrir una rama nueva sólo para este artículo.
    categoria: 'Celulares · Apple',
    nombre: 'iPhone 14 Pro 256 GB',
    tipo: 'PRODUCTO',
    precio: '950000',
    llevaSerie: true,
    // Quince dígitos cada uno —el largo real de un IMEI— y distintos entre
    // sí: el índice único parcial (tenant_id, imei) WHERE libre rechazaría
    // un duplicado, y acá no hay ninguno a propósito.
    imeis: ['350123456789011', '350123456789012', '350123456789013'],
    // `null` y no un número: `crearArticulo` RECHAZA un stock suelto junto
    // con `llevaSerie` (`SERIE_REQUIERE_IMEIS`) — el stock nace de `imeis`.
    stockInicial: null,
    costoUnitario: '700000',
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
    // Sin `?? 'ARS'`: `crearArticulo` ya toma pesos como default para el campo
    // ausente, y repetirlo acá sería una segunda copia del mismo default.
    moneda: receta.moneda,
    categoria: receta.categoria,
    stockInicial: receta.stockInicial === null ? null : d(receta.stockInicial),
    costoUnitario: receta.costoUnitario === null ? null : d(receta.costoUnitario),
    // Sin `?? false`/`?? []`, mismo motivo que `moneda`: `crearArticulo` ya
    // toma esos defaults para las ocho recetas que no llevan serie.
    llevaSerie: receta.llevaSerie,
    imeis: receta.imeis,
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
