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
 * script), pero nunca se había ejercitado como proceso tampoco.
 *
 * Comparte el runner (`tsx`) con `usuario:clave` en TODOS los call sites, no
 * sólo en `package.json`: también en los dos `docker run --entrypoint` de
 * `scripts/deploy.sh` (pasos 8 y 14), que hasta esta misma corrección seguían
 * en `node` pelado — la review de Task 11 lo marcó como el mismo bug un
 * archivo más allá, verificado buildeando la etapa `migrate` del Dockerfile
 * (que necesitó sumar `tsconfig.json` al `COPY`, sin el cual `tsx` resuelve
 * los imports sin extensión pero NO el alias `@/`) y corriendo el comando
 * adentro. Dos comandos operativos con formas de arrancar distintas entre sí
 * — o el mismo comando arrancando distinto según quién lo invoque — es la
 * clase de diferencia que le cuesta una noche a quien no se acuerde cuál era
 * cuál.
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

  it('con un subdominio repetido, sale con código distinto de 0, un mensaje legible en stderr, y sin stack trace de resolución de módulos', async () => {
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
      // Esta primera corrida no es el duplicado del comentario de más abajo
      // sobre "una sola corrida por falla" (scripts/definir-clave.binario.test.ts):
      // ACÁ las dos invocaciones tienen un propósito distinto cada una — la
      // primera arma la precondición (el subdominio ya existe), la segunda es
      // la que efectivamente se está probando.
      await ejecutar('npx', argumentos, { env: envDelProceso() })

      // La segunda alta con el mismo subdominio choca contra el @unique de
      // verdad: es un fallo que sólo puede pasar tocando la base, no algo
      // que el parseo de argumentos ya hubiera atajado.
      let error: { code?: number; stderr?: string } | undefined
      try {
        await ejecutar('npx', argumentos, { env: envDelProceso() })
      } catch (e) {
        error = e as { code?: number; stderr?: string }
      }
      if (!error) {
        throw new Error('tenía que fallar: el subdominio ya existe, y el comando salió con código 0')
      }

      expect(error.code).toBe(1)
      expect(error.stderr).toContain(`ya existe un tenant con el subdominio "${subdominio}"`)

      // Mismo motivo que scripts/definir-clave.binario.test.ts: el runbook
      // documenta esta propiedad para los DOS binarios operativos, así que
      // los DOS tests la aseguran — no sólo el que originalmente encontró el
      // bug. Es justo el archivo donde la review de Task 11 señaló que el
      // mismo bug podía repetirse "un archivo más allá" si `crear-tenant.mts`
      // ganara un `@/` mañana.
      expect(error.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
      expect(error.stderr).not.toContain(' at ')
    } finally {
      await owner.end()
    }
  }, 30_000)
})
