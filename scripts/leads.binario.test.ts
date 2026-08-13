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

  // El servidor está en Ashburn y los interesados son argentinos. Un lead
  // dejado a las 22:30 del 12 en Buenos Aires es el 13 a la 01:30 en UTC, así
  // que imprimir en UTC le cambia el DÍA a la mitad de los leads de la tarde.
  // Es el mismo motivo por el que lib/formato/mostrar.ts declara el huso.
  it('muestra la fecha en hora argentina y no en UTC', async () => {
    await owner.query(
      `INSERT INTO leads (id, nombre, email, rubro, creado_en)
       VALUES (gen_random_uuid(), 'Tarde', 'tarde@ejemplo.test', 'kiosco',
               '2026-08-13T01:30:00Z')`,
    )
    const { stdout } = await ejecutar('npx', ['tsx', 'scripts/leads.mts'], { env: env() })
    const linea = stdout.split('\n').find((l) => l.includes('tarde@ejemplo.test'))!
    // El día es lo que estaba mal: en UTC este lead cae el 13, en Buenos Aires
    // el 12. La hora se afirma en el formato de la aplicación (12 horas, el de
    // formatearFecha) y no en 24, para no fijar acá un detalle que pertenece a
    // lib/formato/mostrar.ts.
    expect(linea).toContain('12/8/26')
    expect(linea).not.toContain('13/8/26')
    expect(linea).toContain('10:30')
  })

  // El formulario es público y no filtra caracteres, así que lo que llega acá
  // lo eligió un desconocido. Sin limpiar, un lead puede llevar secuencias ANSI
  // que la terminal de quien corre el comando EJECUTA: mover el cursor, borrar
  // la pantalla, cambiar el título. Se ve raro en un demo y es una vía de
  // ocultamiento — un lead puede taparle la línea a otro.
  it('no deja pasar secuencias de control a la terminal', async () => {
    await owner.query(
      `INSERT INTO leads (id, nombre, email, rubro, creado_en)
       VALUES (gen_random_uuid(), $1, 'ansi@ejemplo.test', 'kiosco', now())`,
      // \u001b[2J es "borrá la pantalla"; \u0007 hace sonar la campana.
      ['Mala\u001b[2Jgente\u0007'],
    )
    const { stdout } = await ejecutar('npx', ['tsx', 'scripts/leads.mts'], { env: env() })
    const linea = stdout.split('\n').find((l) => l.includes('ansi@ejemplo.test'))!
    expect(linea).not.toContain('\u001b')
    expect(linea).not.toContain('\u0007')
    // Y el texto legible sobrevive: limpiar no puede significar borrar el lead.
    expect(linea).toContain('Mala')
    expect(linea).toContain('gente')
  })

  it('sin MIGRATE_DATABASE_URL falla con un error que dice qué falta', async () => {
    const sinUrl = { ...process.env }
    delete sinUrl.MIGRATE_DATABASE_URL
    await expect(
      ejecutar('npx', ['tsx', 'scripts/leads.mts'], { env: sinUrl }),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('MIGRATE_DATABASE_URL') })
  })
})
