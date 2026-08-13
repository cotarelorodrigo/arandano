import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'

/**
 * `leads` es la primera tabla del schema SIN `tenant_id`: un interesado no es
 * cliente de nadie todavía. Eso la deja fuera del alcance de la policy
 * `tenant_aislamiento`, así que lo único que impide que la aplicación lea la
 * lista entera de interesados es el privilegio.
 *
 * Este archivo es el que sostiene esa afirmación. Si alguien saca el REVOKE de
 * scripts/setup-db-roles.sh, acá se ve.
 */

let owner: Client
let app: Client

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  app = new Client({ connectionString: urlApp() })
  await owner.connect()
  await app.connect()
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

const INSERT = `INSERT INTO leads (id, nombre, email, whatsapp, rubro, mensaje, creado_en)
                VALUES (gen_random_uuid(), $1, $2, NULL, 'kiosco', NULL, now())`

describe('privilegios sobre leads', () => {
  it('el rol de la aplicación puede insertar', async () => {
    await expect(app.query(INSERT, ['Alta', 'alta@ejemplo.test'])).resolves.toBeTruthy()
  })

  it('el rol de la aplicación NO puede leer', async () => {
    await expect(app.query('SELECT * FROM leads')).rejects.toMatchObject({ code: '42501' })
  })

  // El caso que explica por qué lib/leads/guardar.ts usa createMany y no
  // create(): Prisma emite INSERT ... RETURNING, y RETURNING exige SELECT
  // sobre las columnas devueltas. Sin este test, alguien "arregla" el guardar
  // volviendo a create() y la landing se rompe recién en producción.
  it('el INSERT ... RETURNING falla, y por eso el alta no puede usar create()', async () => {
    await expect(
      app.query(`${INSERT} RETURNING id`, ['Returning', 'returning@ejemplo.test']),
    ).rejects.toMatchObject({ code: '42501' })
  })

  it('el rol de la aplicación NO puede modificar ni borrar', async () => {
    await expect(app.query(`UPDATE leads SET nombre = 'x'`)).rejects.toMatchObject({ code: '42501' })
    await expect(app.query('DELETE FROM leads')).rejects.toMatchObject({ code: '42501' })
  })

  it('el owner sí lee: es como se leen los leads', async () => {
    await owner.query(INSERT, ['Del owner', 'owner@ejemplo.test'])
    const { rows } = await owner.query('SELECT nombre FROM leads ORDER BY creado_en')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('la tabla no tiene RLS, y es a propósito: no hay tenant por el que filtrar', async () => {
    const { rows } = await owner.query(
      `SELECT relrowsecurity AS rls FROM pg_class WHERE relname = 'leads'`,
    )
    expect(rows[0].rls).toBe(false)
  })
})
