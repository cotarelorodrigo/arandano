import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { urlSuperusuario, urlApp, PASSWORD_OWNER, PASSWORD_APP } from './postgres-efimero'

const ejecutar = promisify(execFile)

async function correrScript(extra: string[] = []) {
  return ejecutar('scripts/setup-db-roles.sh', [
    `--url=${urlSuperusuario()}`,
    `--owner-password=${PASSWORD_OWNER}`,
    `--app-password=${PASSWORD_APP}`,
    ...extra,
  ])
}

async function atributos(rol: string) {
  const cliente = new Client({ connectionString: urlSuperusuario() })
  await cliente.connect()
  try {
    const { rows } = await cliente.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
         FROM pg_roles WHERE rolname = $1`,
      [rol],
    )
    return rows[0]
  } finally {
    await cliente.end()
  }
}

describe('setup-db-roles.sh', () => {
  beforeAll(async () => {
    // Dos corridas seguidas: la segunda prueba que es idempotente. Un script
    // de infraestructura que sólo funciona contra una base virgen no sirve
    // para prod, donde el volumen ya existe.
    await correrScript()
    await correrScript()
  })

  it('crea arandano_owner sin superusuario ni bypassrls', async () => {
    const a = await atributos('arandano_owner')
    expect(a).toBeDefined()
    expect(a.rolsuper).toBe(false)
    expect(a.rolbypassrls).toBe(false)
    expect(a.rolcreaterole).toBe(false)
    expect(a.rolcanlogin).toBe(true)
  })

  it('crea arandano_app sin superusuario ni bypassrls', async () => {
    const a = await atributos('arandano_app')
    expect(a.rolsuper).toBe(false)
    expect(a.rolbypassrls).toBe(false)
    expect(a.rolcreatedb).toBe(false)
    expect(a.rolcanlogin).toBe(true)
  })

  it('sin --con-createdb el owner no puede crear bases', async () => {
    await correrScript()
    expect((await atributos('arandano_owner')).rolcreatedb).toBe(false)
  })

  it('con --con-createdb el owner sí puede, para la shadow database', async () => {
    await correrScript(['--con-createdb'])
    expect((await atributos('arandano_owner')).rolcreatedb).toBe(true)
  })

  it('deja los default privileges para que las tablas futuras nazcan visibles', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        `SELECT array_to_string(d.defaclacl, ',') AS acl
           FROM pg_default_acl d
           JOIN pg_roles r ON r.oid = d.defaclrole
          WHERE r.rolname = 'arandano_owner' AND d.defaclobjtype = 'r'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].acl).toContain('arandano_app=arwd')
    } finally {
      await cliente.end()
    }
  })

  it('el rol de la app no puede crear tablas', async () => {
    const cliente = new Client({ connectionString: urlApp() })
    await cliente.connect()
    try {
      await expect(cliente.query('CREATE TABLE intruso (id int)')).rejects.toThrow(
        /permission denied|denegado/i,
      )
    } finally {
      await cliente.end()
    }
  })
})
