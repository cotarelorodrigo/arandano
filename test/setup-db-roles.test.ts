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

  // Un ALTER DEFAULT PRIVILEGES es fila guardada en la base, no una
  // declaración que se re-evalúe: sacar el GRANT del script no le hace nada a
  // una base que YA corrió la versión anterior (Task 5b), que le había dado a
  // arandano_app el default privilege de EXECUTE sobre funciones más el GRANT
  // amplio sobre las que ya existían. Medido en dev y en ensayo (review de
  // esta task): las dos quedaron con esa fila para siempre, y toda función
  // NUEVA seguía naciendo ejecutable por la app —el problema que este fix
  // existe para cerrar— porque nadie la había revocado. Este test arma ese
  // estado viejo a mano y prueba que el script converge encima, no sólo que
  // arranca bien desde una base virgen.
  it('converge desde una base que ya tenía el default privilege y el grant amplio de la versión anterior', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    const owner = new Client({ connectionString: urlOwner() })
    await cliente.connect()
    await owner.connect()
    try {
      // Una función cualquiera, ajena a lo que setup-db-roles.sh nombra, que
      // representa cualquier función que ya existiera en esa base vieja.
      await owner.query(
        `CREATE FUNCTION test_convergencia_vieja() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`,
      )
      try {
        // El estado que dejaba la versión de la Task 5b: default privilege de
        // EXECUTE sobre funciones futuras, más el GRANT amplio sobre las que ya
        // existían al momento de correr (alcanza también a resolver_tenant).
        await cliente.query(
          `ALTER DEFAULT PRIVILEGES FOR ROLE arandano_owner IN SCHEMA public
             GRANT EXECUTE ON FUNCTIONS TO arandano_app`,
        )
        await cliente.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO arandano_app')

        // Precondición: si esto no diera true, el resto del test no probaría
        // nada — confirma que el estado viejo realmente le dio EXECUTE a la
        // función suelta antes de correr el script arreglado encima.
        const antes = await cliente.query(
          `SELECT has_function_privilege('arandano_app', 'test_convergencia_vieja()', 'EXECUTE') AS app`,
        )
        expect(antes.rows[0].app).toBe(true)

        await correrScript()

        const { rows } = await cliente.query(`
          SELECT (SELECT count(*)::int FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole
                   WHERE r.rolname = 'arandano_owner' AND d.defaclobjtype = 'f') AS filas_default,
                 has_function_privilege('arandano_app', 'resolver_tenant(text)', 'EXECUTE') AS resolver,
                 has_function_privilege('arandano_app', 'test_convergencia_vieja()', 'EXECUTE') AS suelta
        `)
        expect(rows[0].filas_default).toBe(0)
        expect(rows[0].resolver).toBe(true)
        expect(rows[0].suelta).toBe(false)
      } finally {
        await owner.query('DROP FUNCTION test_convergencia_vieja()')
      }
    } finally {
      await cliente.end()
      await owner.end()
    }
  })

  // El comportamiento real, sin taparlo: una función nueva nace ejecutable
  // por PUBLIC (Postgres se lo da a todo el mundo al crearla, y el REVOKE por
  // default privilege de arriba es inerte para objetos que todavía no
  // existen — ver el comentario largo de setup-db-roles.sh). Lo que la
  // cierra es la PRÓXIMA corrida del script, con su REVOKE EXECUTE ON ALL
  // FUNCTIONS en bloque contra lo que ya existe — no un default privilege, y
  // no un GRANT amplio a arandano_app: la vuelta a correr cierra PUBLIC sin
  // regalarle nada a la app. Es la prueba de que sumar una función SECURITY
  // DEFINER no le regala acceso a la app aunque nadie se acuerde de revocar
  // PUBLIC a mano.
  it('una función nueva nace abierta a PUBLIC, y la corrida siguiente la cierra sin darle EXECUTE a la app', async () => {
    const owner = new Client({ connectionString: urlOwner() })
    await owner.connect()
    try {
      await owner.query(
        `CREATE FUNCTION test_sin_grant_amplio() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$`,
      )
      try {
        const antes = await owner.query(
          `SELECT has_function_privilege('public', 'test_sin_grant_amplio()', 'EXECUTE') AS publico`,
        )
        expect(antes.rows[0].publico).toBe(true)

        await correrScript()

        const { rows } = await owner.query(
          `SELECT has_function_privilege('public', 'test_sin_grant_amplio()', 'EXECUTE') AS publico,
                  has_function_privilege('arandano_app', 'test_sin_grant_amplio()', 'EXECUTE') AS app`,
        )
        expect(rows[0].publico).toBe(false)
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

  // Append-only sostenido por la base y no por un comentario del schema.
  //
  // Probado por COMPORTAMIENTO —corriendo el UPDATE y el DELETE con el rol real
  // de la app— y no con has_table_privilege: mirar el catálogo es volver a
  // verificar la forma en vez del efecto, que es justo el defecto que este
  // arreglo viene a cerrar. Postgres chequea el privilegio al planificar, así
  // que el error salta aunque no haya ninguna fila que tocar; por eso no hacen
  // falta fixtures.
  //
  // Que el INSERT siga funcionando lo prueba test/ventas.test.ts entero, que
  // escribe movimientos en casi todos sus casos y comparte esta misma base: si
  // el REVOKE se pasara de alcance, ese archivo se cae completo. Un INSERT acá
  // sería una copia peor —necesitaría tenant, artículo y usuario a mano— de algo
  // que ya está cubierto.
  describe('movimientos_stock es append-only', () => {
    it('la app no puede editar ni borrar, y sí leer', async () => {
      const app = new Client({ connectionString: urlApp() })
      await app.connect()
      try {
        await expect(app.query('UPDATE movimientos_stock SET nota = nota')).rejects.toThrow(
          /permission denied|denegado/i,
        )
        await expect(app.query('DELETE FROM movimientos_stock')).rejects.toThrow(
          /permission denied|denegado/i,
        )
        // La otra mitad: si el REVOKE se hubiera llevado puesto el SELECT, los
        // dos asserts de arriba pasarían igual y la app no podría ni mostrar el
        // historial que esta tabla existe para guardar.
        await expect(app.query('SELECT 1 FROM movimientos_stock')).resolves.toBeDefined()
      } finally {
        await app.end()
      }
    })

    it('las demás tablas siguen siendo editables por la app', async () => {
      // El contraste que hace significativo al test de arriba: sin esto, un
      // REVOKE demasiado amplio —o un rol al que nunca se le otorgó nada— daría
      // los mismos rojos y el mismo verde.
      const app = new Client({ connectionString: urlApp() })
      await app.connect()
      try {
        await expect(app.query('UPDATE articulos SET nombre = nombre')).resolves.toBeDefined()
        await expect(app.query('DELETE FROM clientes WHERE false')).resolves.toBeDefined()
      } finally {
        await app.end()
      }
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
