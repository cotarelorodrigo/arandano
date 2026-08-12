import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { urlOwner } from '../test/postgres-efimero'

const ejecutar = promisify(execFile)

/**
 * Se spawnea el BINARIO, no se importa la función.
 *
 * Es la lección de la Task 11 del ciclo de autenticación: `usuario:clave`
 * estaba probado como función bajo vitest —que resuelve `@/` con su propio
 * alias— y el comando real salía con ERR_MODULE_NOT_FOUND antes de tocar la
 * base. Un test que no corre el comando como lo corre una persona no prueba que
 * el comando ande.
 */
let owner: Client

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  await owner.query(
    `INSERT INTO leads (id, nombre, email, whatsapp, rubro, mensaje, creado_en)
     VALUES (gen_random_uuid(), 'Listado', 'listado@ejemplo.test', NULL, 'kiosco', NULL, now())`,
  )
})

afterAll(async () => {
  await owner.end()
})

const env = () => ({ ...process.env, MIGRATE_DATABASE_URL: urlOwner() })

describe('npm run leads', () => {
  it('lista los leads', async () => {
    const { stdout } = await ejecutar('npx', ['tsx', 'scripts/leads.mts'], { env: env() })
    expect(stdout).toContain('listado@ejemplo.test')
    expect(stdout).toContain('kiosco')
  })

  it('sin MIGRATE_DATABASE_URL falla con un error que dice qué falta', async () => {
    const sinUrl = { ...process.env }
    delete sinUrl.MIGRATE_DATABASE_URL
    await expect(
      ejecutar('npx', ['tsx', 'scripts/leads.mts'], { env: sinUrl }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('MIGRATE_DATABASE_URL') })
  })
})
