import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import {
  urlSuperusuario,
  urlSuperusuarioInterna,
  urlOwner,
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

  // Lo opuesto del caso de tablas de arriba, y a propósito: una función
  // SECURITY DEFINER no tiene una segunda puerta como RLS en las tablas —es
  // la vía por la que la app lee lo que RLS le esconde por diseño—, así que
  // un default privilege que la hiciera ejecutable de entrada haría nacer
  // ejecutable a toda función futura sin que nadie lo decida. La ausencia de
  // esta fila es lo que prueba que el grant es por nombre y no por default
  // privilege.
  it('no deja default privilege de EXECUTE sobre funciones para arandano_owner', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        `SELECT 1
           FROM pg_default_acl d
           JOIN pg_roles r ON r.oid = d.defaclrole
          WHERE r.rolname = 'arandano_owner' AND d.defaclobjtype = 'f'`,
      )
      expect(rows).toHaveLength(0)
    } finally {
      await cliente.end()
    }
  })

  // Nombrado por el estado final (arandano_app puede, PUBLIC no) y no por el
  // mecanismo: la aserción no puede distinguir un GRANT por nombre de un
  // default privilege, así que el nombre tampoco debe prometerlo.
  it('resolver_tenant queda ejecutable para arandano_app y cerrado para PUBLIC', async () => {
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

  // La prueba de que sumar una función SECURITY DEFINER no le regala acceso a
  // la app: una función que setup-db-roles.sh nunca nombró se queda sin
  // EXECUTE para arandano_app, aunque la haya creado arandano_owner (el mismo
  // dueño de resolver_tenant) después de que el script corrió.
  //
  // El REVOKE ALL ... FROM PUBLIC de acá abajo replica lo que hace CUALQUIER
  // migración real que agregue una función SECURITY DEFINER (ver
  // prisma/migrations/20260808203015_resolver_tenant/migration.sql): Postgres
  // le da EXECUTE a PUBLIC al crear la función, y esa es la única línea que lo
  // cierra — el REVOKE por default privilege de setup-db-roles.sh no alcanza a
  // una función que no existía cuando el script corrió. Sin este REVOKE acá, el
  // test estaría midiendo ese hueco de PUBLIC (que no es lo que arandano_app
  // hereda de sí mismo) y no lo que realmente hace falta probar: que
  // arandano_app no tiene un privilegio PROPIO sobre una función que
  // setup-db-roles.sh nunca nombró.
  it('una función nueva de arandano_owner que el script no nombra no le da EXECUTE a la app', async () => {
    const owner = new Client({ connectionString: urlOwner() })
    await owner.connect()
    try {
      await owner.query(
        `CREATE FUNCTION test_sin_grant_amplio() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`,
      )
      try {
        await owner.query('REVOKE ALL ON FUNCTION test_sin_grant_amplio() FROM PUBLIC')
        const { rows } = await owner.query(
          `SELECT has_function_privilege('arandano_app', 'test_sin_grant_amplio()', 'EXECUTE') AS app`,
        )
        expect(rows[0].app).toBe(false)
      } finally {
        await owner.query('DROP FUNCTION test_sin_grant_amplio()')
      }
    } finally {
      await owner.end()
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
