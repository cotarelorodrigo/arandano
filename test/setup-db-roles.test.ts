import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import {
  urlSuperusuario,
  urlSuperusuarioInterna,
  urlApp,
  CONTENEDOR,
  PASSWORD_OWNER,
  PASSWORD_APP,
} from './postgres-efimero'

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

  // Mismo mecanismo que el test anterior pero para funciones: una migración no
  // puede otorgar el EXECUTE con un GRANT que nombre a arandano_app (rompería
  // sobre la shadow database y sobre un pg_restore sin roles), así que el
  // default privilege es la única vía. defaclobjtype = 'f' es funciones; el ACL
  // con grantee vacío (p.ej. `=X/arandano_owner`) es la entrada de PUBLIC, y su
  // ausencia es lo que prueba que el REVOKE de PUBLIC también quedó como default.
  it('deja los default privileges para que las funciones futuras nazcan ejecutables sólo por la app', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        `SELECT array_to_string(d.defaclacl, ',') AS acl
           FROM pg_default_acl d
           JOIN pg_roles r ON r.oid = d.defaclrole
          WHERE r.rolname = 'arandano_owner' AND d.defaclobjtype = 'f'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].acl).toContain('arandano_app=X')
      expect(rows[0].acl).not.toMatch(/(^|,)=X/)
    } finally {
      await cliente.end()
    }
  })

  it('resolver_tenant queda ejecutable para arandano_app y cerrado para PUBLIC, por default privileges y no por GRANT en la migración', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        `SELECT has_function_privilege('arandano_app', 'resolver_tenant(text)', 'EXECUTE') AS app,
                has_function_privilege('public', 'resolver_tenant(text)', 'EXECUTE') AS publico`,
      )
      expect(rows[0].app).toBe(true)
      expect(rows[0].publico).toBe(false)
    } finally {
      await cliente.end()
    }
  })

  // El Postgres de producción no publica ningún puerto al host, así que
  // --network=host —el default— no puede alcanzarlo por más que la URL sea
  // correcta. Estos dos tests fijan que la red sea elegible, porque de eso
  // depende que este script sirva contra prod y, después, dentro de deploy.sh.
  describe('--network', () => {
    it('alcanza una base que no publica puerto', async () => {
      await ejecutar('scripts/setup-db-roles.sh', [
        `--network=container:${CONTENEDOR}`,
        `--url=${urlSuperusuarioInterna()}`,
        `--owner-password=${PASSWORD_OWNER}`,
        `--app-password=${PASSWORD_APP}`,
      ])
      expect((await atributos('arandano_owner')).rolcanlogin).toBe(true)
    })

    it('sin el flag, esa misma URL no llega', async () => {
      // La contracara del test anterior: prueba que lo que hizo la diferencia
      // fue el flag y no que la URL interna funcione por casualidad desde el
      // host. Sin esto, el test de arriba pasaría igual con el flag ignorado.
      await expect(
        ejecutar('scripts/setup-db-roles.sh', [
          `--url=${urlSuperusuarioInterna()}`,
          `--owner-password=${PASSWORD_OWNER}`,
          `--app-password=${PASSWORD_APP}`,
        ]),
      ).rejects.toThrow()
    })
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
