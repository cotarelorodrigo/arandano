import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

let owner: Client
let app: Client
let tenantA: string
let tenantB: string
let empleadoA: string
let empleadoB: string

/** Igual que test/rls.test.ts: la GUC fijada adentro de una transacción, que es
 *  como corre la app en producción. */
async function comoTenant(tenantId: string | null, sql: string, params: unknown[] = []) {
  await app.query('BEGIN')
  try {
    if (tenantId !== null) {
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
    }
    const res = await app.query(sql, params)
    await app.query('COMMIT')
    return res
  } catch (e) {
    await app.query('ROLLBACK')
    throw e
  }
}

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  app = new Client({ connectionString: urlApp() })
  await owner.connect()
  await app.connect()

  tenantA = await crearTenant(owner, 'permisos-a')
  tenantB = await crearTenant(owner, 'permisos-b')
  empleadoA = await crearUsuario(owner, tenantA, 'empleado@permisos-a.test', 'EMPLEADO')
  empleadoB = await crearUsuario(owner, tenantB, 'empleado@permisos-b.test', 'EMPLEADO')
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('la tabla usuario_permisos', () => {
  it('acepta los seis valores del enum', async () => {
    const claves = [
      'ARTICULOS_CREAR', 'ARTICULOS_EDITAR', 'COSTOS',
      'CATEGORIAS', 'VENTAS_ANULAR', 'ORDENES_ANULAR',
    ]
    for (const clave of claves) {
      await comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, $3, now())`,
        [tenantA, empleadoA, clave],
      )
    }
    const { rows } = await comoTenant(
      tenantA,
      `SELECT count(*)::int AS n FROM usuario_permisos WHERE usuario_id = $1`,
      [empleadoA],
    )
    expect(rows[0].n).toBe(6)
  })

  it('rechaza un permiso que no está en el enum', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, 'BORRAR_TODO', now())`,
        [tenantA, empleadoA],
      ),
    ).rejects.toThrow()
  })

  // La clave primaria compuesta: otorgar dos veces el mismo permiso no puede
  // dejar dos filas, porque "revocar" es un DELETE y una fila duplicada
  // sobreviviría a la revocación.
  it('no deja otorgar dos veces el mismo permiso', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, 'COSTOS', now())`,
        [tenantA, empleadoA],
      ),
    ).rejects.toThrow()
  })

  it('un tenant no ve los permisos de otro', async () => {
    await comoTenant(
      tenantB,
      `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
       VALUES ($1, $2, 'COSTOS', now())`,
      [tenantB, empleadoB],
    )
    const { rows } = await comoTenant(
      tenantA,
      `SELECT count(*)::int AS n FROM usuario_permisos WHERE usuario_id = $1`,
      [empleadoB],
    )
    expect(rows[0].n).toBe(0)
  })

  // Sin GUC no pasa ninguna fila: la policy falla cerrado, igual que el resto.
  it('sin la GUC seteada no se ve nada', async () => {
    const { rows } = await comoTenant(null, `SELECT count(*)::int AS n FROM usuario_permisos`)
    expect(rows[0].n).toBe(0)
  })
})

let permisosDe: typeof import('@/lib/permisos/consultar').permisosDe
let otorgar: typeof import('@/lib/permisos/administrar').otorgar
let revocar: typeof import('@/lib/permisos/administrar').revocar
let ErrorDePermiso: typeof import('@/lib/permisos/errores').ErrorDePermiso

describe('otorgar, revocar y leer', () => {
  let duenio: string
  let nuevo: string

  beforeAll(async () => {
    process.env.DATABASE_URL = urlApp()
    ;({ permisosDe } = await import('@/lib/permisos/consultar'))
    ;({ otorgar, revocar } = await import('@/lib/permisos/administrar'))
    ;({ ErrorDePermiso } = await import('@/lib/permisos/errores'))

    duenio = await crearUsuario(owner, tenantA, 'duenio@permisos-a.test', 'DUENO')
    nuevo = await crearUsuario(owner, tenantA, 'nuevo@permisos-a.test', 'EMPLEADO')
  })

  it('un empleado nuevo no tiene ninguno', async () => {
    expect([...(await permisosDe(tenantA, nuevo))]).toEqual([])
  })

  it('otorgar deja el permiso y revocar lo saca', async () => {
    await otorgar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'COSTOS' })
    expect(await permisosDe(tenantA, nuevo)).toEqual(new Set(['COSTOS']))

    await revocar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'COSTOS' })
    expect([...(await permisosDe(tenantA, nuevo))]).toEqual([])
  })

  // Los dos son idempotentes porque la pantalla los dispara desde un switch, y
  // dos clicks rápidos mandan la misma orden dos veces. Otorgar dos veces
  // chocaría contra la clave primaria; revocar algo que no está borraría cero
  // filas y Prisma tiraría P2025.
  it('otorgar dos veces no falla', async () => {
    await otorgar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'CATEGORIAS' })
    await otorgar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'CATEGORIAS' })
    expect(await permisosDe(tenantA, nuevo)).toEqual(new Set(['CATEGORIAS']))
  })

  it('revocar algo que no está no falla', async () => {
    await revocar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'VENTAS_ANULAR' })
    expect(await permisosDe(tenantA, nuevo)).toEqual(new Set(['CATEGORIAS']))
  })

  // Un dueño puede todo por construcción; darle una fila sería dejar dato
  // muerto que además miente si algún día alguien lo lee sin la guarda.
  it('no deja otorgarle a un dueño', async () => {
    await expect(
      otorgar({ tenantId: tenantA, usuarioId: duenio, permiso: 'COSTOS' }),
    ).rejects.toThrow(ErrorDePermiso)
  })

  it('no deja otorgarle a alguien de otro tenant', async () => {
    await expect(
      otorgar({ tenantId: tenantA, usuarioId: empleadoB, permiso: 'COSTOS' }),
    ).rejects.toThrow(ErrorDePermiso)
  })
})
