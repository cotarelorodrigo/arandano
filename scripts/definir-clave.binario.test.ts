import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { urlOwner, urlApp } from '../test/postgres-efimero'
import { crearTenant } from '../test/datos'

const ejecutar = promisify(execFile)

/**
 * El binario real, no la función exportada — en su propio archivo (ver el
 * comentario al final de scripts/definir-clave.test.ts para el porqué).
 *
 * El hallazgo que motiva esto (Task 11, ciclo de autenticación):
 * `definirClave` (la función) se ejercita bajo vitest en `test/auth.test.ts`,
 * y vitest resuelve el alias `@/` con su propio `resolve.alias`
 * (vitest.config.mts). `parsearArgumentosCLI` se ejercita puro, sin tocar
 * Node en serio. Pero nada corría alguna vez el BINARIO completo con el
 * runner real — primero `node` pelado, ahora `tsx` (ver package.json y el
 * porqué en docs/runbook-stacks.md) — así que el comando que un operador
 * realmente tipea nunca se probó. Con `node` pelado fallaba con
 * `ERR_MODULE_NOT_FOUND` ANTES de tocar la base, para CUALQUIER invocación,
 * y ningún test lo notaba. Éste sí: spawnea `npx tsx
 * scripts/definir-clave.mts` como lo haría un operador, contra la base
 * efímera que ya levantó test/global-setup.ts.
 */
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant

beforeAll(async () => {
  // Mismo motivo que test/auth.test.ts y app/login/acciones.test.ts:
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool de `pg` UNA
  // SOLA VEZ, al importarse, leyendo DATABASE_URL. Fijarla ANTES del import,
  // no después — un import estático de estos módulos arriba del archivo
  // hubiera cacheado el Pool con la URL equivocada para siempre.
  process.env.DATABASE_URL = urlApp()
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
})

function envDelProceso() {
  return {
    ...process.env,
    DATABASE_URL: urlApp(),
    // No hay navegador acá: sólo alimenta el baseURL interno de Better Auth
    // (ver el comentario de origenDelRequest para el porqué de esa forma).
    // Mismo valor que usa vitest.config.mts para el resto de la suite: no
    // protege nada real, y sin él la construcción de la instancia falla.
    BETTER_AUTH_SECRET: 'secreto-solo-para-tests-sin-valor-real',
    DOMINIO_BASE: 'arandano.test',
  }
}

describe('el binario (npx tsx scripts/definir-clave.mts)', () => {
  it('con argumentos válidos, define la contraseña, sale con código 0, y la clave sirve para entrar', async () => {
    const owner = new Client({ connectionString: urlOwner() })
    await owner.connect()
    try {
      const subdominio = `binario-ok-${Date.now()}`
      const tenantId = await crearTenant(owner, subdominio)
      const email = 'dueno-binario@ejemplo.test'
      const clave = 'ClaveDelBinario123'

      // Sin credenciales, igual que hace crear-tenant.mts: el binario bajo
      // prueba es justamente el que tiene que ponérselas.
      await owner.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Dueño Binario', $2, 'DUENO', now(), now())`,
        [tenantId, email],
      )

      const { stdout } = await ejecutar(
        'npx',
        [
          'tsx',
          'scripts/definir-clave.mts',
          `--subdominio=${subdominio}`,
          `--email=${email}`,
          `--clave=${clave}`,
        ],
        { env: envDelProceso() },
      )
      expect(stdout).toContain('contraseña definida')

      // El efecto, no sólo la forma: la clave que puso el BINARIO —en su
      // propio proceso de Node, contra su propia instancia de Better Auth—
      // tiene que servir para entrar de verdad, verificado con la misma API
      // que usa el login (app/login/acciones.ts).
      const respuesta = await authParaTenant(tenantId, 'http://arandano.test').api.signInEmail({
        body: { email, password: clave },
        asResponse: true,
      })
      expect(respuesta.status).toBe(200)
    } finally {
      await owner.end()
    }
  }, 30_000)

  it('con un usuario inexistente, sale con código distinto de 0, un mensaje legible en stderr, y sin stack trace de resolución de módulos', async () => {
    const owner = new Client({ connectionString: urlOwner() })
    await owner.connect()
    try {
      const subdominio = `binario-sin-usuario-${Date.now()}`
      await crearTenant(owner, subdominio)

      const argumentos = [
        'tsx',
        'scripts/definir-clave.mts',
        `--subdominio=${subdominio}`,
        '--email=no-existe@ejemplo.test',
        '--clave=algo-largo-123',
      ]

      // Una sola corrida para las tres aserciones: el binario es un proceso
      // hijo real de varios segundos, y lanzarlo dos veces para afirmar tres
      // cosas sobre LA MISMA falla duplicaba ese costo dentro del gate sin
      // sumar cobertura (hallazgo de la review de Task 11).
      let error: { code?: number; stderr?: string } | undefined
      try {
        await ejecutar('npx', argumentos, { env: envDelProceso() })
      } catch (e) {
        error = e as { code?: number; stderr?: string }
      }

      // Si el comando NO tiró, esto tiene que fallar el test de forma
      // legible, sin quedar atrapado en ningún catch de más arriba: antes,
      // esta comprobación vivía como `expect.unreachable()` DENTRO del
      // `try` cuyo `catch` hacía las aserciones — si algún día el mock se
      // rompiera y el comando saliera 0, ese `catch` se habría tragado la
      // falla de `expect.unreachable()` y la habría reportado como si fuera
      // otra cosa.
      if (!error) {
        throw new Error('tenía que fallar: el usuario no existe, y el comando salió con código 0')
      }

      expect(error.code).toBe(1)
      expect(error.stderr).toContain('no existe un usuario con el mail')

      // El caso puntual que este ciclo encontró: el comando podía morir
      // ANTES de llegar al mensaje de arriba, con un stack trace de
      // ERR_MODULE_NOT_FOUND en vez de un error legible — para CUALQUIER
      // invocación, no sólo ésta.
      expect(error.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
      expect(error.stderr).not.toContain(' at ')
    } finally {
      await owner.end()
    }
  }, 30_000)
})
