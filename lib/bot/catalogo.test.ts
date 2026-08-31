import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'
// `import type` y no un import de valor: éste se borra al compilar, así que no
// arrastra lib/db.ts —y con él el pool— antes de que el beforeAll fije
// DATABASE_URL. Un import estático de valor de este módulo deja el pool
// apuntando a ningún lado y todos los casos fallan con ECONNREFUSED.
import type { ArticuloParaElBot } from '@/lib/bot/catalogo'

let owner: Client
let tenantA: string
let tenantB: string
let buscarParaElBot: typeof import('@/lib/bot/catalogo').buscarParaElBot
let RESULTADOS_DEL_BOT: number

/**
 * Los SKU llevan prefijo propio (`BOT-…`) a propósito: la base efímera se
 * comparte entre archivos de test (`fileParallelism: false`), así que un SKU
 * genérico como `B-005` choca con el de otra suite y la hace fallar por un
 * motivo que no tiene nada que ver con lo que prueba. Ya pasó con
 * test/categorias-backfill.test.ts.
 */
async function crearArticulo(
  tenantId: string,
  campos: {
    sku: string
    nombre: string
    precio: string
    stock?: string
    tipo?: 'PRODUCTO' | 'SERVICIO'
    moneda?: 'ARS' | 'USD'
    desactivado?: boolean
  },
) {
  await owner.query(
    `INSERT INTO articulos
       (id, tenant_id, sku, nombre, tipo, precio, moneda, stock, desactivado_en, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, now(), now())`,
    [
      tenantId,
      campos.sku,
      campos.nombre,
      campos.tipo ?? 'PRODUCTO',
      campos.precio,
      campos.moneda ?? 'ARS',
      campos.stock ?? '0',
      campos.desactivado ? new Date() : null,
    ],
  )
}

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'bot-catalogo-a')
  tenantB = await crearTenant(owner, 'bot-catalogo-b')

  process.env.DATABASE_URL = urlApp()
  ;({ buscarParaElBot, RESULTADOS_DEL_BOT } = await import('@/lib/bot/catalogo'))

  await crearArticulo(tenantA, { sku: 'BOT-001', nombre: 'Funda iPhone 13', precio: '12000.00', stock: '20' })
  await crearArticulo(tenantA, { sku: 'BOT-002', nombre: 'Funda iPhone 14', precio: '13000.00', stock: '3' })
  await crearArticulo(tenantA, { sku: 'BOT-003', nombre: 'Funda iPhone 15', precio: '14000.00', stock: '0' })
  await crearArticulo(tenantA, {
    sku: 'BOT-004',
    nombre: 'Funda iPhone vieja',
    precio: '9000.00',
    stock: '50',
    desactivado: true,
  })
  await crearArticulo(tenantA, {
    sku: 'BOT-005',
    nombre: 'Cambio de pantalla',
    precio: '30000.00',
    tipo: 'SERVICIO',
  })
  await crearArticulo(tenantA, {
    sku: 'BOT-006',
    nombre: 'iPhone 13 usado',
    precio: '300.00',
    moneda: 'USD',
    stock: '2',
  })
  await crearArticulo(tenantA, {
    sku: 'BOT-007',
    nombre: 'Cambio de módulo · Mano de obra',
    precio: '185000.00',
    tipo: 'SERVICIO',
  })
  await crearArticulo(tenantA, { sku: 'BOT-008', nombre: 'Batería original iPhone 11', precio: '112500.00', stock: '4' })
  // Del otro local, con un nombre que matchea la misma búsqueda.
  await crearArticulo(tenantB, { sku: 'C-001', nombre: 'Funda del otro local', precio: '1.00', stock: '99' })
})

afterAll(async () => {
  await owner.end()
})

describe('lo que el bot puede ver del catálogo', () => {
  /**
   * El caso más importante del ciclo, y por eso compara el CONJUNTO DE CLAVES
   * por igualdad en vez de afirmar que falta alguna en particular.
   *
   * `expect(o).not.toHaveProperty('costo')` sólo atrapa el campo que a alguien
   * se le ocurrió nombrar. La igualdad atrapa el que nadie pensó: el día que
   * `buscarArticulosVendibles` sume una columna al `select` —o que alguien
   * cambie el `map` por un spread— este caso se pone rojo antes de que ese
   * campo salga por WhatsApp.
   */
  it('devuelve exactamente las claves permitidas, y ninguna más', async () => {
    const [producto] = await buscarParaElBot(tenantA, 'Funda iPhone 13')
    expect(Object.keys(producto).sort()).toEqual(['disponibilidad', 'nombre', 'precio'])

    const [servicio] = await buscarParaElBot(tenantA, 'Cambio de pantalla')
    expect(Object.keys(servicio).sort()).toEqual(['nombre', 'precio'])
  })

  it('nunca expone el stock numérico, ni el sku, ni el id', async () => {
    const encontrados = await buscarParaElBot(tenantA, 'Funda')
    const serializado = JSON.stringify(encontrados)
    expect(serializado, 'el stock exacto se filtró al bot').not.toMatch(/"stock"/)
    expect(serializado, 'el sku se filtró al bot').not.toMatch(/BOT-00/)
  })

  it('traduce el stock a disponibilidad cualitativa', async () => {
    const porNombre = async (texto: string) => (await buscarParaElBot(tenantA, texto))[0]
    expect((await porNombre('Funda iPhone 13')).disponibilidad).toBe('hay')
    expect((await porNombre('Funda iPhone 14')).disponibilidad).toBe('quedan pocas')
    expect((await porNombre('Funda iPhone 15')).disponibilidad).toBe('no hay')
  })

  it('un servicio no lleva disponibilidad: no tiene stock que informar', async () => {
    const [servicio] = await buscarParaElBot(tenantA, 'Cambio de pantalla')
    expect(servicio.disponibilidad).toBeUndefined()
  })

  it('un artículo desactivado no existe para el bot', async () => {
    const nombres = (await buscarParaElBot(tenantA, 'Funda iPhone')).map((a) => a.nombre)
    expect(nombres, 'el bot ofreció un artículo dado de baja').not.toContain('Funda iPhone vieja')
  })

  /**
   * El precio llega formateado desde el servidor para que el modelo no tenga
   * que decidir el símbolo ni el separador. Un artículo en dólares tiene que
   * decir US$ y no convertirse a pesos: fuera de una venta no hay cotización de
   * la cual derivar un equivalente, y un número inventado es peor que ninguno.
   */
  it('el precio viene formateado, y un artículo en dólares dice dólares', async () => {
    const [enPesos] = await buscarParaElBot(tenantA, 'Funda iPhone 13')
    expect(enPesos.precio).toContain('$')

    const [enDolares] = await buscarParaElBot(tenantA, 'iPhone 13 usado')
    expect(enDolares.precio, 'un precio en dólares se mostró como pesos').toContain('US$')
  })

  it('no ve el catálogo de otro local', async () => {
    const nombres = (await buscarParaElBot(tenantA, 'Funda')).map((a) => a.nombre)
    expect(nombres, 'RLS no filtró: el bot vio el catálogo del local de al lado').not.toContain(
      'Funda del otro local',
    )
  })

  it('trae pocos resultados: un mensaje de WhatsApp no es un listado', async () => {
    const encontrados: ArticuloParaElBot[] = await buscarParaElBot(tenantA, 'a')
    expect(encontrados.length).toBeLessThanOrEqual(RESULTADOS_DEL_BOT)
  })

  it('sin texto no consulta nada', async () => {
    expect(await buscarParaElBot(tenantA, '   ')).toEqual([])
  })
})

/**
 * Los dos defectos que encontró la primera corrida real del bot contra el
 * catálogo del canario, y que ningún test veía porque ninguno pasaba una frase.
 */
describe('la búsqueda entiende cómo escribe la gente por WhatsApp', () => {
  /**
   * El primero: el `contains` de la frase entera. Un cliente preguntó "tenés
   * fundas para iphone 13?" y el bot contestó que no había, con la funda de
   * iPhone 13 en el catálogo — ningún nombre contiene esa cadena literal.
   */
  it('una frase entera encuentra el artículo, no sólo la palabra suelta', async () => {
    const nombres = (await buscarParaElBot(tenantA, 'tenés fundas para iphone 13?')).map((a) => a.nombre)
    expect(nombres, 'la frase de un cliente no encontró el artículo').toContain('Funda iPhone 13')
  })

  /**
   * El segundo: `mode: 'insensitive'` ignora mayúsculas, NO tildes. El catálogo
   * se carga con ortografía y por WhatsApp nadie las escribe.
   */
  it('sin tildes encuentra lo que en el catálogo va con tilde', async () => {
    const sinTilde = (await buscarParaElBot(tenantA, 'hacen cambio de modulo?')).map((a) => a.nombre)
    expect(sinTilde, '"modulo" no encontró "módulo"').toContain('Cambio de módulo · Mano de obra')

    const bateria = (await buscarParaElBot(tenantA, 'tenes bateria de iphone')).map((a) => a.nombre)
    expect(bateria, '"bateria" no encontró "Batería"').toContain('Batería original iPhone 11')
  })

  it('y al revés: con tilde encuentra igual', async () => {
    const nombres = (await buscarParaElBot(tenantA, 'cambio de módulo')).map((a) => a.nombre)
    expect(nombres).toContain('Cambio de módulo · Mano de obra')
  })

  /**
   * `AND` y no `OR`: cada palabra ACOTA. Con `OR`, "funda iphone" traería todos
   * los iPhone del local además de todas las fundas, y el bot le leería al
   * cliente medio catálogo.
   */
  it('cada palabra acota en vez de sumar', async () => {
    const nombres = (await buscarParaElBot(tenantA, 'funda iphone 13')).map((a) => a.nombre)
    expect(nombres).toContain('Funda iPhone 13')
    expect(nombres, 'trajo una batería cuando le pidieron una funda').not.toContain(
      'Batería original iPhone 11',
    )
  })

  /**
   * Si al descartar las palabras vacías no queda ninguna, se cae a la frase
   * entera. Un `AND: []` en Prisma no filtra nada y devolvería el catálogo
   * completo — que es lo peor que puede pasar acá.
   */
  it('un saludo suelto no devuelve el catálogo entero', async () => {
    const encontrados = await buscarParaElBot(tenantA, 'hola buenas')
    expect(encontrados, 'un saludo trajo artículos').toHaveLength(0)
  })
})
