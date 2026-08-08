import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runChecks } from '@/lib/health/runChecks'

// El check de postgres habla con el pool real; acá sólo interesa qué hace con
// la respuesta, no que haya una base levantada.
const query = vi.fn()
const clienteQuery = vi.fn()
const release = vi.fn()
vi.mock('@/lib/db', () => ({
  pool: {
    query: (...a: unknown[]) => query(...a),
    // El check de tenant necesita la MISMA conexión para las dos mitades:
    // set_config(..., true) es local a la transacción, y pool.query() no
    // garantiza que dos llamadas caigan en el mismo cliente.
    connect: async () => ({
      query: (...a: unknown[]) => clienteQuery(...a),
      release: () => release(),
    }),
  },
}))

async function correrPostgresCheck() {
  const { checks } = await import('@/lib/health/checks')
  // Sólo el check de postgres: desde que se sumó el check de tenant, `checks`
  // trae un tercero que también puede fallar (p. ej. sin
  // TENANT_CANARIO_SUBDOMINIO, que este describe no define), y estos tests
  // afirman sobre `report.status` en conjunto — aislar el check bajo prueba es
  // lo que hace que esa afirmación siga hablando sólo de postgres.
  const check = checks.find((c) => c.name === 'postgres')!
  return runChecks([check])
}

describe('check de postgres', () => {
  const entornoOriginal = process.env.ARANDANO_DB_ESPERADA

  beforeEach(() => {
    query.mockReset()
    vi.resetModules()
  })

  afterEach(() => {
    if (entornoOriginal === undefined) delete process.env.ARANDANO_DB_ESPERADA
    else process.env.ARANDANO_DB_ESPERADA = entornoOriginal
  })

  it('pasa y reporta la base cuando la identidad coincide', async () => {
    process.env.ARANDANO_DB_ESPERADA = 'arandano_prod'
    query.mockResolvedValue({ rows: [{ db: 'arandano_prod' }] })

    const report = await correrPostgresCheck()

    expect(report.status).toBe('ok')
    expect(report.checks[0].detail).toBe('db=arandano_prod')
  })

  it('falla cuando responde una base distinta de la esperada', async () => {
    // El escenario real: una app de prod con DATABASE_URL apuntando al
    // Postgres de dev. Con `SELECT 1` esto devolvía 200 y sano.
    process.env.ARANDANO_DB_ESPERADA = 'arandano_prod'
    query.mockResolvedValue({ rows: [{ db: 'arandano_dev' }] })

    const report = await correrPostgresCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].ok).toBe(false)
    expect(report.checks[0].detail).toContain('arandano_dev')
    expect(report.checks[0].detail).toContain('arandano_prod')
  })

  it('falla si ARANDANO_DB_ESPERADA no está definida, en vez de asumir que está bien', async () => {
    delete process.env.ARANDANO_DB_ESPERADA
    query.mockResolvedValue({ rows: [{ db: 'arandano_prod' }] })

    const report = await correrPostgresCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toContain('ARANDANO_DB_ESPERADA')
  })
})

describe('check de identidad del rol', () => {
  beforeEach(() => {
    query.mockReset()
    vi.resetModules()
    process.env.ARANDANO_DB_ESPERADA = 'arandano_prod'
  })

  function respuestaDeRol(fila: Record<string, unknown>) {
    query.mockImplementation((sql: string) => {
      if (String(sql).includes('current_database')) {
        return Promise.resolve({ rows: [{ db: 'arandano_prod' }] })
      }
      return Promise.resolve({ rows: [fila] })
    })
  }

  it('pasa con un rol sin privilegios', async () => {
    respuestaDeRol({ rol: 'arandano_app', super: false, bypassrls: false, es_dueno: false })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    const rol = reporte.checks.find((c) => c.name === 'rol')
    expect(rol?.ok).toBe(true)
    expect(rol?.detail).toBe('rol=arandano_app')
  })

  it('falla si el rol es superusuario, porque RLS se ignoraría en silencio', async () => {
    respuestaDeRol({ rol: 'arandano_dev', super: true, bypassrls: false, es_dueno: false })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    const rol = reporte.checks.find((c) => c.name === 'rol')
    expect(rol?.ok).toBe(false)
    expect(rol?.detail).toMatch(/superusuario/i)
  })

  it('falla si el rol tiene BYPASSRLS', async () => {
    respuestaDeRol({ rol: 'arandano_app', super: false, bypassrls: true, es_dueno: false })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    expect(reporte.checks.find((c) => c.name === 'rol')?.detail).toMatch(/bypassrls/i)
  })

  it('falla si el rol es dueño de las tablas, porque el dueño está exento', async () => {
    respuestaDeRol({ rol: 'arandano_owner', super: false, bypassrls: false, es_dueno: true })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    expect(reporte.checks.find((c) => c.name === 'rol')?.detail).toMatch(/due/i)
  })
})

describe('check de tenant', () => {
  const original = process.env.TENANT_CANARIO_SUBDOMINIO

  beforeEach(() => {
    query.mockReset()
    clienteQuery.mockReset()
    release.mockReset()
    vi.resetModules()
    process.env.TENANT_CANARIO_SUBDOMINIO = 'canario'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.TENANT_CANARIO_SUBDOMINIO
    else process.env.TENANT_CANARIO_SUBDOMINIO = original
  })

  async function correrTenantCheck() {
    const { checks } = await import('@/lib/health/checks')
    const check = checks.find((c) => c.name === 'tenant')!
    const { runChecks } = await import('@/lib/health/runChecks')
    return runChecks([check])
  }

  /** Programa las respuestas de la conexión dedicada: BEGIN, set_config,
   *  count propio, set_config, count ajeno, ROLLBACK. */
  function conCuentas(propio: number, ajeno: number) {
    clienteQuery.mockImplementation((sql: string) => {
      if (/count/.test(sql)) {
        const n = clienteQuery.mock.calls.filter((c) => /count/.test(c[0] as string)).length
        return Promise.resolve({ rows: [{ n: n === 1 ? propio : ajeno }] })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  it('pasa cuando el canario existe y RLS filtra en las dos direcciones', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    conCuentas(1, 0)

    const report = await correrTenantCheck()

    expect(report.status).toBe('ok')
    expect(report.checks[0].detail).toBe('canario=canario')
    expect(release).toHaveBeenCalled()
  })

  it('falla si el canario no existe', async () => {
    query.mockResolvedValue({ rows: [] })

    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toContain('canario')
  })

  // La mitad que hace que este check valga algo. Sin ella, el check pasa
  // igual con RLS apagado — que es exactamente el estado que existe para
  // detectar.
  it('falla si con un tenant_id inventado igual ve filas', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    conCuentas(1, 3)

    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toMatch(/RLS/)
  })

  it('falla si con el tenant_id del canario no ve su propia fila', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    conCuentas(0, 0)

    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
  })

  it('falla ruidosamente si falta TENANT_CANARIO_SUBDOMINIO', async () => {
    delete process.env.TENANT_CANARIO_SUBDOMINIO
    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toContain('TENANT_CANARIO_SUBDOMINIO')
  })

  it('suelta la conexión aunque falle', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    clienteQuery.mockRejectedValue(new Error('se cayó la base'))

    await correrTenantCheck()

    expect(release).toHaveBeenCalled()
  })
})
