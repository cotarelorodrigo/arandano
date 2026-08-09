import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

let owner: Client
let app: Client
let idFlor: string

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  app = new Client({ connectionString: urlApp() })
  await owner.connect()
  await app.connect()
  idFlor = await crearTenant(owner, 'resolver-flor')
  await crearTenant(owner, 'resolver-juan')
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('resolver_tenant', () => {
  it('devuelve el tenant por subdominio exacto, sin GUC puesto', async () => {
    const { rows } = await app.query('SELECT id, nombre, estado FROM resolver_tenant($1)', [
      'resolver-flor',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(idFlor)
    expect(rows[0].estado).toBe('TRIAL')
  })

  it('devuelve cero filas para un subdominio inexistente', async () => {
    const { rows } = await app.query('SELECT id FROM resolver_tenant($1)', ['no-existe'])
    expect(rows).toHaveLength(0)
  })

  // El caso decisivo: la puerta tiene que ser del ancho del problema. Si esto
  // devolviera filas, la aplicación podría listar todos los clientes.
  it('no habilita a enumerar: tenants sigue cerrada para arandano_app', async () => {
    const { rows } = await app.query('SELECT count(*)::int AS n FROM tenants')
    expect(rows[0].n).toBe(0)
  })

  // El argumento se evalúa como arandano_app, con RLS aplicado, así que la
  // subconsulta devuelve NULL y la función no se puede torcer para enumerar.
  it('no se la puede torcer pasándole una subconsulta sobre tenants', async () => {
    const { rows } = await app.query(
      'SELECT id FROM resolver_tenant((SELECT subdominio FROM tenants LIMIT 1))',
    )
    expect(rows).toHaveLength(0)
  })

  it('es propiedad de arandano_owner', async () => {
    const { rows } = await owner.query(`
      SELECT pg_get_userbyid(p.proowner) AS dueno
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'resolver_tenant'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0].dueno).toBe('arandano_owner')
  })

  it('corre como SECURITY DEFINER con search_path fijado', async () => {
    const { rows } = await owner.query(`
      SELECT p.prosecdef AS secdef, p.proconfig AS config
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'resolver_tenant'
    `)
    expect(rows[0].secdef).toBe(true)
    // Sin search_path fijado, quien llama puede anteponer un esquema propio y
    // hacer que el cuerpo resuelva `tenants` a una tabla suya, ejecutada con
    // los privilegios del dueño.
    expect(rows[0].config).toEqual(['search_path=public, pg_temp'])
  })

  // Postgres otorga EXECUTE a PUBLIC por defecto al crear una función. Sin
  // el REVOKE, la puerta queda abierta para cualquier rol futuro.
  it('no le da EXECUTE a PUBLIC', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('public', 'resolver_tenant(text)', 'EXECUTE') AS publico,
             has_function_privilege('arandano_app', 'resolver_tenant(text)', 'EXECUTE') AS app
    `)
    expect(rows[0].publico).toBe(false)
    expect(rows[0].app).toBe(true)
  })
})
