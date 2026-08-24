import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'
import { crearTenant } from './datos'

const INICIO = '-- >>> BACKFILL'
const FIN = '-- <<< BACKFILL'

/**
 * El bloque de backfill, extraído del archivo de migración REAL.
 *
 * La base de los tests arranca vacía, así que `migrate deploy` nunca ejercita
 * este SQL con datos adentro: sin este archivo, el backfill sería la única
 * parte de la migración que nadie corre nunca contra filas de verdad hasta que
 * la corra producción. Se lee del archivo y no se reescribe acá a propósito —
 * una reimplementación paralela puede diverger del SQL que se deploya, y
 * entonces el test verde no significaría nada. Mismo criterio que
 * `scripts/definir-clave.binario.test.ts`, que spawnea el binario real.
 */
function sqlDelBackfill(): string {
  const base = join(process.cwd(), 'prisma/migrations')
  const dir = readdirSync(base).find((d) => d.endsWith('_categorias'))
  expect(dir, 'no está la migración _categorias').toBeTruthy()
  const sql = readFileSync(join(base, dir!, 'migration.sql'), 'utf8')
  const desde = sql.indexOf(INICIO)
  const hasta = sql.indexOf(FIN)
  expect(desde, 'la migración no tiene el marcador de inicio del backfill').toBeGreaterThan(-1)
  expect(hasta, 'la migración no tiene el marcador de fin del backfill').toBeGreaterThan(desde)
  return sql.slice(desde + INICIO.length, hasta)
}

let cliente: Client
let tenantId: string
let otroId: string

async function sembrar(tenant: string, sku: string, categoria: string | null): Promise<string> {
  const { rows } = await cliente.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, categoria, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $2, 'PRODUCTO', 1000, 0, $3, now(), now())
     RETURNING id`,
    [tenant, sku, categoria],
  )
  return rows[0].id
}

/** La rama a la que quedó colgado un artículo, escrita como la escribiría una
 *  pantalla: "Padre · Hija", o sólo el nombre si cuelga de una raíz. */
async function ramaDe(articuloId: string): Promise<string | null> {
  const { rows } = await cliente.query(
    `SELECT coalesce(p.nombre || ' · ', '') || c.nombre AS rama
       FROM articulos a
       JOIN categorias c ON c.id = a.categoria_id
       LEFT JOIN categorias p ON p.id = c.padre_id
      WHERE a.id = $1`,
    [articuloId],
  )
  return rows.length === 0 ? null : rows[0].rama
}

beforeAll(async () => {
  cliente = new Client({ connectionString: urlOwner() })
  await cliente.connect()
  tenantId = await crearTenant(cliente, 'backfill-uno')
  otroId = await crearTenant(cliente, 'backfill-dos')
})

afterAll(async () => {
  await cliente.end()
})

describe('el backfill de categorías', () => {
  it('convierte el texto libre en el árbol y engancha cada artículo', async () => {
    const conMarca = await sembrar(tenantId, 'B-001', 'Fundas · Samsung')
    const otraMarca = await sembrar(tenantId, 'B-002', 'Fundas · Motorola')
    const hermano = await sembrar(tenantId, 'B-003', 'Fundas · Samsung')
    const sinMarca = await sembrar(tenantId, 'B-004', 'Cables')
    const pegado = await sembrar(tenantId, 'B-005', 'Cargadores·Xiaomi')
    const tresNiveles = await sembrar(tenantId, 'B-006', 'Accesorios · Fundas · Samsung')
    const raizVacia = await sembrar(tenantId, 'B-007', '· Genéricos')
    const conEspacios = await sembrar(tenantId, 'B-008', '   Vidrios templados   ·   Samsung   ')
    const sinNada = await sembrar(tenantId, 'B-009', null)
    const soloEspacios = await sembrar(tenantId, 'B-010', '   ')
    const soloSeparador = await sembrar(tenantId, 'B-011', ' · · ')
    // El local de al lado con la MISMA categoría: tiene que quedar con su
    // propia fila, no compartir la del otro.
    const ajeno = await sembrar(otroId, 'B-012', 'Fundas · Samsung')

    await cliente.query(sqlDelBackfill())

    expect(await ramaDe(conMarca)).toBe('Fundas · Samsung')
    expect(await ramaDe(otraMarca)).toBe('Fundas · Motorola')
    expect(await ramaDe(sinMarca)).toBe('Cables')
    expect(await ramaDe(pegado)).toBe('Cargadores · Xiaomi')
    expect(await ramaDe(tresNiveles)).toBe('Accesorios · Fundas · Samsung')
    expect(await ramaDe(raizVacia)).toBe('Genéricos')
    expect(await ramaDe(conEspacios)).toBe('Vidrios templados · Samsung')
    expect(await ramaDe(sinNada)).toBeNull()
    expect(await ramaDe(soloEspacios)).toBeNull()
    expect(await ramaDe(soloSeparador)).toBeNull()

    // Dos artículos de la misma categoría comparten la fila. Si no, el árbol
    // crece una rama por artículo.
    const { rows: comp } = await cliente.query(
      `SELECT id, categoria_id FROM articulos WHERE id = ANY($1::uuid[])`,
      [[conMarca, hermano]],
    )
    expect(comp[0].categoria_id).toBe(comp[1].categoria_id)

    // "Fundas" es UNA raíz por tenant, no una por artículo ni una por marca.
    const { rows: raices } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias
        WHERE tenant_id = $1 AND nombre = 'Fundas' AND padre_id IS NULL`,
      [tenantId],
    )
    expect(raices[0].n).toBe(1)

    // ...y cuelgan de ella las dos marcas, no una.
    const { rows: marcas } = await cliente.query(
      `SELECT c.nombre FROM categorias c
         JOIN categorias p ON p.id = c.padre_id
        WHERE c.tenant_id = $1 AND p.nombre = 'Fundas' ORDER BY c.nombre`,
      [tenantId],
    )
    expect(marcas.map((m) => m.nombre)).toEqual(['Motorola', 'Samsung'])

    // El local de al lado tiene su propia rama, distinta, con el mismo nombre.
    const { rows: cruzado } = await cliente.query(
      `SELECT (SELECT categoria_id FROM articulos WHERE id = $1) AS suya,
              (SELECT categoria_id FROM articulos WHERE id = $2) AS nuestra`,
      [ajeno, conMarca],
    )
    expect(cruzado[0].suya).not.toBe(cruzado[0].nuestra)
    expect(await ramaDe(ajeno)).toBe('Fundas · Samsung')
  })

  // Idempotente: el `deploy.sh` puede reintentar, y una migración que no se
  // puede repetir es una que hay que arreglar a mano a las 11 de la noche.
  it('correrlo dos veces no duplica ni mueve nada', async () => {
    const { rows: antes } = await cliente.query(`SELECT count(*)::int AS n FROM categorias`)
    const previo = await cliente.query(
      `SELECT id, categoria_id FROM articulos ORDER BY sku`,
    )

    await cliente.query(sqlDelBackfill())

    const { rows: despues } = await cliente.query(`SELECT count(*)::int AS n FROM categorias`)
    expect(despues[0].n).toBe(antes[0].n)

    const posterior = await cliente.query(`SELECT id, categoria_id FROM articulos ORDER BY sku`)
    expect(posterior.rows).toEqual(previo.rows)
  })

  // Un artículo cargado DESPUÉS del backfill —o sea, en la ventana entre los
  // dos deploys, si algo lo dejó sin rama— se engancha en la corrida
  // siguiente, y sin tocar a los que ya estaban.
  it('engancha un artículo nuevo sin rama, reusando el árbol existente', async () => {
    const tardio = await sembrar(tenantId, 'B-013', 'Fundas · Samsung')
    const { rows: antes } = await cliente.query(`SELECT count(*)::int AS n FROM categorias`)

    await cliente.query(sqlDelBackfill())

    expect(await ramaDe(tardio)).toBe('Fundas · Samsung')
    const { rows: despues } = await cliente.query(`SELECT count(*)::int AS n FROM categorias`)
    expect(despues[0].n, 'el backfill creó una rama que ya existía').toBe(antes[0].n)
  })
})
