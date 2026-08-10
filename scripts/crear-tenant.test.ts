import { describe, it, expect } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { parsearArgumentos } from './crear-tenant.mts'
import { urlOwner } from '../test/postgres-efimero'

const ejecutar = promisify(execFile)

const BASE = [
  '--subdominio=flor',
  '--nombre=Flor Celulares',
  '--duenio=flor@ejemplo.com',
  '--duenio-nombre=Flor',
]

describe('parsearArgumentos', () => {
  it('acepta el caso mínimo y deja módulos vacío', () => {
    const r = parsearArgumentos(BASE)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.args.subdominio).toBe('flor')
      expect(r.args.nombre).toBe('Flor Celulares')
      expect(r.args.modulos).toEqual([])
      expect(r.args.duenio).toBe('flor@ejemplo.com')
    }
  })

  it('normaliza el mail del dueño a minúsculas', () => {
    // Better Auth guarda y busca el mail en minúsculas SIEMPRE (ver el
    // comentario en parsearArgumentos). Este INSERT es SQL pelado y es el
    // único punto que podría dejar una fila mixed-case que después ni
    // `usuario:clave` ni el login puedan encontrar.
    const r = parsearArgumentos([
      '--subdominio=flor',
      '--nombre=Flor Celulares',
      '--duenio=Flor@Ejemplo.COM',
      '--duenio-nombre=Flor',
    ])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.duenio).toBe('flor@ejemplo.com')
  })

  it('parsea varios módulos separados por coma', () => {
    const r = parsearArgumentos([...BASE, '--modulos=ORDENES_DE_TRABAJO,TURNOS'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.modulos).toEqual(['ORDENES_DE_TRABAJO', 'TURNOS'])
  })

  it('rechaza un módulo que no existe en el enum', () => {
    const r = parsearArgumentos([...BASE, '--modulos=PELUQUERIA'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('PELUQUERIA')
  })

  it('rechaza un subdominio inválido con el motivo de validarSubdominio', () => {
    const r = parsearArgumentos(['--subdominio=WWW', ...BASE.slice(1)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('minúsculas')
  })

  it('rechaza un subdominio reservado', () => {
    const r = parsearArgumentos(['--subdominio=admin', ...BASE.slice(1)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('reservado')
  })

  it('exige los obligatorios', () => {
    for (const faltante of ['--subdominio', '--nombre', '--duenio', '--duenio-nombre']) {
      const r = parsearArgumentos(BASE.filter((a) => !a.startsWith(faltante + '=')))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toContain(faltante)
    }
  })

  it('rechaza un flag desconocido en vez de ignorarlo', () => {
    // Ignorarlo en silencio convierte un `--modulo=` (sin s) en un tenant sin
    // módulos que nadie entiende por qué quedó así.
    const r = parsearArgumentos([...BASE, '--preset=servicio-tecnico'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--preset')
  })
})

/**
 * El binario real, no la función exportada — mismo motivo que
 * scripts/definir-clave.test.ts (Task 11). Éste sí funcionaba con `node`
 * pelado (evita Prisma a propósito, ver el comentario de cabecera del
 * script), pero nunca se había ejercitado como proceso tampoco: comparte el
 * runner (`tsx`) con `usuario:clave` desde este mismo ciclo, y dos comandos
 * operativos con dos formas de arrancar es la clase de diferencia que le
 * cuesta una noche a quien no se acuerde cuál era cuál.
 */
describe('el binario (npx tsx scripts/crear-tenant.mts)', () => {
  const envDelProceso = () => ({ ...process.env, MIGRATE_DATABASE_URL: urlOwner() })

  it('con argumentos válidos, crea el tenant y el dueño, y sale con código 0', async () => {
    const owner = new Client({ connectionString: urlOwner() })
    await owner.connect()
    try {
      const subdominio = `binario-tenant-${Date.now()}`
      const { stdout } = await ejecutar(
        'npx',
        [
          'tsx',
          'scripts/crear-tenant.mts',
          `--subdominio=${subdominio}`,
          '--nombre=Tenant del binario',
          '--duenio=dueno-tenant-binario@ejemplo.test',
          '--duenio-nombre=Dueño Binario',
        ],
        { env: envDelProceso() },
      )
      expect(stdout).toContain('tenant creado')

      // El efecto: la fila realmente quedó en la base, con el dueño.
      const { rows } = await owner.query(
        `SELECT t.id, u.email, u.rol FROM tenants t
         JOIN users u ON u.tenant_id = t.id
         WHERE t.subdominio = $1`,
        [subdominio],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].email).toBe('dueno-tenant-binario@ejemplo.test')
      expect(rows[0].rol).toBe('DUENO')
    } finally {
      await owner.end()
    }
  }, 30_000)

  it('con un subdominio repetido, sale con código distinto de 0 y un mensaje legible en stderr, no un stack trace', async () => {
    const owner = new Client({ connectionString: urlOwner() })
    await owner.connect()
    try {
      const subdominio = `binario-duplicado-${Date.now()}`
      const argumentos = [
        'tsx',
        'scripts/crear-tenant.mts',
        `--subdominio=${subdominio}`,
        '--nombre=Original',
        '--duenio=original@ejemplo.test',
        '--duenio-nombre=Original',
      ]
      await ejecutar('npx', argumentos, { env: envDelProceso() })

      // La segunda alta con el mismo subdominio choca contra el @unique de
      // verdad: es un fallo que sólo puede pasar tocando la base, no algo
      // que el parseo de argumentos ya hubiera atajado.
      await expect(ejecutar('npx', argumentos, { env: envDelProceso() })).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(`ya existe un tenant con el subdominio "${subdominio}"`),
      })
    } finally {
      await owner.end()
    }
  }, 30_000)
})
