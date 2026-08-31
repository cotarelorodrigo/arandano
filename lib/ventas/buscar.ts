// lib/ventas/buscar.ts
import { Prisma } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'

/**
 * Un artículo tal como lo necesita el punto de venta.
 *
 * La plata y el stock salen como STRING y no como `Prisma.Decimal`: esto lo
 * consume un componente cliente, que no puede recibir un Decimal a través del
 * borde sin perder el tipo. Convertir acá, en el borde, es más honesto que
 * dejar que la pantalla se arregle.
 */
export type ArticuloVendible = {
  id: string
  sku: string
  nombre: string
  precio: string
  moneda: 'ARS' | 'USD'
  stock: string
  esProducto: boolean
}

// Suficientes para elegir de un vistazo y pocas para que la lista no tape la
// pantalla. El que no encuentra lo suyo acá escribe dos letras más.
const RESULTADOS = 8

/**
 * Palabras que no aportan nada a una búsqueda y que en una frase de WhatsApp
 * aparecen casi siempre. Sin descartarlas, "tenés fundas para iphone" exigiría
 * que el nombre del artículo contenga "tenés" y "para".
 */
const VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'para', 'por', 'con', 'sin', 'y', 'o', 'a', 'al', 'en', 'que', 'tenes',
  'tienen', 'tiene', 'hay', 'me', 'te', 'lo', 'su', 'mi', 'es',
  'hola', 'buenas', 'precio', 'cuanto', 'sale', 'vale',
  'hacen', 'hace', 'arreglan', 'arregla', 'venden', 'vende', 'trabajan',
  'necesito', 'quiero', 'busco', 'buscaba', 'queria', 'consulta', 'algun',
  'alguna', 'cuesta', 'cuestan', 'salen', 'valen', 'gracias', 'porfa',
])

/**
 * Las formas en que una palabra puede aparecer en el catálogo, con y sin tilde.
 *
 * `mode: 'insensitive'` de Postgres ignora MAYÚSCULAS, no tildes: `modulo` no
 * matchea `módulo`. Y eso no es un caso de borde — es el caso normal. El
 * catálogo se carga con ortografía ("Cambio de módulo", "Batería original") y
 * por WhatsApp nadie pone tildes. Se descubrió corriendo el bot: preguntó
 * "hacen cambio de modulo?" y contestó que no lo hacía, con el servicio cargado.
 *
 * La salida es la palabra sin tildes MÁS una variante por cada vocal acentuada,
 * una por vez: en español una palabra lleva a lo sumo una tilde, así que no
 * hace falta el producto cartesiano. Una palabra de cinco vocales da seis
 * patrones, y ahí se corta —más que eso deja de ser una palabra que alguien
 * tipea en un WhatsApp y empieza a ser un `where` caro por nada.
 *
 * La alternativa real era la extensión `unaccent` de Postgres, que resuelve
 * esto de raíz y para todo el producto. Se descartó PARA ESTE CICLO por dónde
 * habría que instalarla: `CREATE EXTENSION` pide superusuario, y las
 * migraciones corren como `arandano_owner`, que deliberadamente no lo es. Eso
 * la manda a `scripts/setup-db-roles.sh` —el único que corre con el
 * superusuario— y convierte una búsqueda en un cambio de infraestructura, con
 * su índice funcional y su `$queryRaw` (que además no pasa por la extensión de
 * tenant). Queda anotado como lo que hay que hacer si esto se queda corto.
 */
const VOCALES: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' }

function sinTildes(p: string): string {
  return p.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function variantes(palabra: string): string[] {
  const base = sinTildes(palabra)
  const posiciones = [...base].flatMap((c, i) => (VOCALES[c] ? [i] : []))
  if (posiciones.length === 0 || posiciones.length > 5) return [base]
  return [
    base,
    ...posiciones.map((i) => base.slice(0, i) + VOCALES[base[i]!] + base.slice(i + 1)),
  ]
}

/**
 * Una condición por palabra significativa, todas exigidas (`AND`).
 *
 * Existe porque el `contains` de la frase entera NO sirve para lenguaje
 * natural, y eso se descubrió corriendo el bot: un cliente escribió "tenés
 * fundas para iphone 13?" y el bot contestó que no había, con la funda de
 * iPhone 13 en el catálogo — porque ningún nombre contiene esa cadena literal.
 *
 * `AND` y no `OR` para que "funda iphone" no traiga todos los iPhone del local
 * más todas las fundas: cada palabra ACOTA. Si después de descartar las vacías
 * no queda ninguna, se cae a la frase entera en vez de devolver el catálogo
 * completo — que es lo que pasaría con un `AND: []`.
 *
 * Se singulariza de forma tosca (`fundas` → `funda`) porque el cliente pregunta
 * en plural y el catálogo se carga en singular. No es un lematizador y no
 * pretende serlo: quitarle la `s` final a una palabra de más de tres letras
 * cubre el caso real sin traer una dependencia.
 */
function condicionesPorPalabra(texto: string): Prisma.ArticuloWhereInput[] {
  const palabras = texto
    .toLowerCase()
    .replace(/[¿?¡!.,;:()]/g, ' ')
    .split(/\s+/)
    // Las vacías se comparan sin tildes para que "tenés" y "tenes" sean la
    // misma palabra descartable.
    .filter((p) => p.length >= 2 && !VACIAS.has(sinTildes(p)))
    .map((p) => (p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p))

  if (palabras.length === 0) {
    return [
      {
        OR: [
          { nombre: { contains: texto, mode: 'insensitive' } },
          { sku: { contains: texto, mode: 'insensitive' } },
        ],
      },
    ]
  }

  return palabras.map((p) => ({
    OR: variantes(p).flatMap((v) => [
      { nombre: { contains: v, mode: 'insensitive' as const } },
      { sku: { contains: v, mode: 'insensitive' as const } },
    ]),
  }))
}

/**
 * Los artículos que se pueden vender, buscados por nombre o código.
 *
 * Filtra `desactivadoEn: null` — es el requisito que el ciclo de inventario
 * dejó escrito para éste. Un artículo desactivado tampoco se puede vender desde
 * el motor (`crearVenta` lo rechaza con ARTICULO_DESACTIVADO), así que las dos
 * mitades están: la pantalla no lo ofrece y el motor no lo acepta.
 *
 * `opciones.porPalabras` cambia el `contains` de la frase entera por un `AND`
 * de condiciones, una por palabra significativa. Lo usa el bot y NO el punto de
 * venta, y esa asimetría es deliberada: en el mostrador se tipean dos letras o
 * se pasa un código de barras, donde la frase entera es exactamente lo que se
 * quiere; por WhatsApp llega una oración.
 *
 * `opciones.limite` es un tercer parámetro OPCIONAL, así que el punto de venta
 * —el llamador original— no cambia una línea y sigue trayendo sus 8. Lo agregó
 * el bot de WhatsApp, que pide menos: ocho artículos en un mensaje son un muro
 * de texto que nadie lee, y cada uno además se paga en tokens en cada turno de
 * la conversación. Los dos números viven donde se justifican —el default acá, el
 * del bot en lib/bot/catalogo.ts— en vez de un promedio que no le sirve a
 * ninguno de los dos.
 */
export async function buscarArticulosVendibles(
  tenantId: string,
  texto: string,
  opciones: { limite?: number; porPalabras?: boolean } = {},
): Promise<ArticuloVendible[]> {
  const busqueda = texto.trim()
  // Sin esto, el primer foco en el buscador traería el catálogo entero.
  if (busqueda === '') return []

  const prisma = prismaParaTenant(tenantId)
  const take = opciones.limite ?? RESULTADOS
  const SELECT = {
    id: true, sku: true, nombre: true, precio: true, moneda: true, stock: true, tipo: true,
  } as const

  let articulos
  if (opciones.porPalabras) {
    const condiciones = condicionesPorPalabra(busqueda)
    // Primero EXIGIENDO todas las palabras, que es la búsqueda precisa.
    articulos = await prisma.articulo.findMany({
      where: { desactivadoEn: null, AND: condiciones },
      orderBy: { nombre: 'asc' },
      take,
      select: SELECT,
    })
    // Y si no dio nada, con CUALQUIERA de ellas.
    //
    // Los dos pasos y no sólo el segundo: el `AND` es el que hace que "funda
    // iphone" no traiga todos los iPhone del local, y el `OR` es el que hace
    // que una palabra que nadie previó no tire abajo la búsqueda entera. Ése
    // fue el defecto: "hacen cambio de modulo?" no devolvía NADA porque el
    // `AND` exigía también "hacen", y ampliar la lista de palabras vacías para
    // taparlo es un juego que siempre se pierde — siempre falta una.
    if (articulos.length === 0 && condiciones.length > 1) {
      articulos = await prisma.articulo.findMany({
        where: { desactivadoEn: null, OR: condiciones },
        orderBy: { nombre: 'asc' },
        take,
        select: SELECT,
      })
    }
  } else {
    articulos = await prisma.articulo.findMany({
      where: {
        desactivadoEn: null,
        OR: [
          { nombre: { contains: busqueda, mode: 'insensitive' } },
          { sku: { contains: busqueda, mode: 'insensitive' } },
        ],
      },
      orderBy: { nombre: 'asc' },
      take,
      select: SELECT,
    })
  }

  return articulos.map((a) => ({
    id: a.id,
    sku: a.sku,
    nombre: a.nombre,
    precio: a.precio.toString(),
    moneda: a.moneda,
    stock: a.stock.toString(),
    esProducto: a.tipo === 'PRODUCTO',
  }))
}
