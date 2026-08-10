import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeUsuario } from '@/lib/usuarios/errores'

let administrar: typeof import('@/lib/usuarios/administrar')
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant

const ORIGEN = 'http://usuarios.arandano.test'
const CLAVE = 'una-clave-larga'

let owner: Client
let tenantId: string
let duenioId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  administrar = await import('@/lib/usuarios/administrar')
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `usuarios-${Date.now()}`)

  const { id } = await administrar.crearEmpleado({
    tenantId, origen: ORIGEN,
    nombre: 'La dueña', email: 'duenia@ejemplo.test', clave: CLAVE, rol: 'DUENO',
  })
  duenioId = id
})

afterAll(async () => { await owner.end() })

describe('alta de empleado', () => {
  it('crea el usuario con su rol y su credencial', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Un empleado', email: 'empleado@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })

    const { rows } = await owner.query('SELECT rol FROM users WHERE id = $1', [id])
    expect(rows[0].rol).toBe('EMPLEADO')

    const r = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'empleado@ejemplo.test', password: CLAVE },
      asResponse: true,
    })
    expect(r.status).toBe(200)
  })

  it('rechaza un mail repetido dentro del mismo local', async () => {
    await expect(
      administrar.crearEmpleado({
        tenantId, origen: ORIGEN,
        nombre: 'Otro', email: 'empleado@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
      }),
    ).rejects.toMatchObject({ codigo: 'MAIL_REPETIDO' })
  })

  it('rechaza una clave más corta que 8', async () => {
    await expect(
      administrar.crearEmpleado({
        tenantId, origen: ORIGEN,
        nombre: 'Corto', email: 'corto@ejemplo.test', clave: 'abc', rol: 'EMPLEADO',
      }),
    ).rejects.toBeInstanceOf(ErrorDeUsuario)
  })

  it('el alta NO deja logueado al empleado nuevo', async () => {
    // signUpEmail devuelve una sesión. Si se dejara pasar, el dueño terminaría
    // navegando como el empleado que acaba de crear.
    const antes = await owner.query('SELECT count(*)::int n FROM sessions WHERE tenant_id = $1', [tenantId])
    await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Sin sesión', email: 'sinsesion@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    const despues = await owner.query('SELECT count(*)::int n FROM sessions WHERE tenant_id = $1', [tenantId])
    expect(despues.rows[0].n).toBe(antes.rows[0].n)
  })
})

describe('desactivar', () => {
  it('marca la fila en vez de borrarla', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Se va', email: 'seva@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await administrar.desactivar({ tenantId, usuarioId: id })

    const { rows } = await owner.query('SELECT desactivado_en FROM users WHERE id = $1', [id])
    expect(rows, 'la fila se borró; tiene que sobrevivir por las FK de ventas').toHaveLength(1)
    expect(rows[0].desactivado_en).not.toBeNull()
  })

  it('reactivar la deja como estaba', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Vuelve', email: 'vuelve@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await administrar.desactivar({ tenantId, usuarioId: id })
    await administrar.reactivar({ tenantId, usuarioId: id })

    const { rows } = await owner.query('SELECT desactivado_en FROM users WHERE id = $1', [id])
    expect(rows[0].desactivado_en).toBeNull()
  })

  it('no se puede desactivar al último dueño activo, y no toca nada al rechazar', async () => {
    // Sin esta regla, un local queda sin nadie que pueda administrar usuarios,
    // y el único arreglo es un comando en el servidor.
    //
    // Sesión propia del dueño para poder afirmar después que sigue viva: sin
    // login previo no habría nada que este test pudiera distinguir de "las
    // maté igual, no había ninguna".
    await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'duenia@ejemplo.test', password: CLAVE }, asResponse: true,
    })
    const sesionesAntes = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [duenioId])
    expect(sesionesAntes.rows[0].n).toBeGreaterThan(0)

    await expect(
      administrar.desactivar({ tenantId, usuarioId: duenioId }),
    ).rejects.toMatchObject({ codigo: 'ULTIMO_DUENO' })

    // No basta con que rechace: la guarda tiene que frenar ANTES de escribir
    // nada. Un refactor que moviera el chequeo después del UPDATE (o del
    // borrado de sesiones) seguiría rechazando el llamado — el `expect` de
    // arriba seguiría en verde — mientras deja al dueño desactivado o sin
    // sesión igual. Estas dos aserciones son las que atraparían esa
    // regresión.
    const { rows } = await owner.query('SELECT desactivado_en FROM users WHERE id = $1', [duenioId])
    expect(rows[0].desactivado_en).toBeNull()

    const sesionesDespues = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [duenioId])
    expect(sesionesDespues.rows[0].n).toBe(sesionesAntes.rows[0].n)
  })

  it('desactivar mata las sesiones abiertas de esa persona', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Con sesión', email: 'consesion@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'consesion@ejemplo.test', password: CLAVE }, asResponse: true,
    })
    const antes = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [id])
    expect(antes.rows[0].n).toBeGreaterThan(0)

    await administrar.desactivar({ tenantId, usuarioId: id })

    const despues = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [id])
    expect(despues.rows[0].n).toBe(0)
  })

  // Bajo READ COMMITTED, un `count()` sin lock no alcanza: dos transacciones
  // concurrentes leerían el mismo snapshot (2 dueños activos), las dos
  // pasarían el chequeo, y las dos escribirían — el local se queda sin
  // ninguno, porque cada una actualiza una fila distinta y no hay conflicto
  // de escritura que las frene. Este test SOLAPA las dos desactivaciones —lo
  // que un doble click, o dos personas administrando a la vez, produce—; en
  // secuencia (llamando una y esperando a que termine antes de la otra) nunca
  // ejercitaría la ventana entre leer y decidir, y daría verde con o sin el
  // FOR UPDATE. Mismo patrón que "dos anulaciones simultáneas compensan una
  // sola vez" en test/ventas.test.ts.
  it('desactivar a los dos únicos dueños en simultáneo deja exactamente uno activo', async () => {
    const { id: otroDuenio } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'El otro dueño', email: 'otrodueno@ejemplo.test', clave: CLAVE, rol: 'DUENO',
    })

    const resultados = await Promise.allSettled([
      administrar.desactivar({ tenantId, usuarioId: duenioId }),
      administrar.desactivar({ tenantId, usuarioId: otroDuenio }),
    ])

    // La que pierde la carrera queda protegida por el MISMO guard que ya
    // prueba el test de arriba — no por suerte de que Postgres la haya
    // corrido después. Exactamente una de las dos tiene que rechazar.
    const rechazados = resultados.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )
    expect(rechazados).toHaveLength(1)
    expect(rechazados[0].reason).toMatchObject({ codigo: 'ULTIMO_DUENO' })

    // El valor exacto (ni cero ni dos) es justamente el síntoma de la carrera
    // sin el lock: sobre ese bug, esta cuenta daba 0.
    const { rows } = await owner.query(
      'SELECT count(*)::int n FROM users WHERE id = ANY($1) AND desactivado_en IS NULL',
      [[duenioId, otroDuenio]],
    )
    expect(rows[0].n, 'el local se quedó sin dueños activos, o con los dos').toBe(1)
  })
})

describe('resetear la clave', () => {
  it('la nueva sirve, la vieja no, y las sesiones abiertas se caen', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Olvidadizo', email: 'olvido@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'olvido@ejemplo.test', password: CLAVE }, asResponse: true,
    })

    // El id de LA sesión vieja, capturado antes del reseteo. Contar filas no
    // sirve: el login con la clave nueva crea una, y un conteo no distingue
    // "la vieja murió y nació otra" de "las dos siguen vivas".
    const previa = await owner.query('SELECT id FROM sessions WHERE user_id = $1', [id])
    expect(previa.rows, 'el login no dejó sesión; el test no probaría nada').toHaveLength(1)
    const sesionVieja: string = previa.rows[0].id

    const nueva = 'otra-clave-larga'
    await administrar.resetearClave({ tenantId, origen: ORIGEN, usuarioId: id, clave: nueva })

    // La vieja ya no existe: resetearle la clave a alguien que se fue tiene que
    // sacarlo de donde esté.
    const quedo = await owner.query('SELECT id FROM sessions WHERE id = $1', [sesionVieja])
    expect(quedo.rows, 'la sesión anterior al reseteo sobrevivió').toHaveLength(0)

    // La nueva sirve...
    const conNueva = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'olvido@ejemplo.test', password: nueva }, asResponse: true,
    })
    expect(conNueva.status).toBe(200)

    // ...y la vieja no.
    const conVieja = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'olvido@ejemplo.test', password: CLAVE }, asResponse: true,
    }).catch(() => ({ status: 401 }))
    expect(conVieja.status).not.toBe(200)
  })

  /**
   * El motivo entero de la rama `createAccount` de `resetearClave`: un usuario
   * nacido sin fila en `accounts` — el mismo caso que motiva
   * `scripts/definir-clave.mts`, ahí con `crear-tenant.mts` insertando al
   * dueño con SQL pelado. El test de arriba corre sobre alguien dado de alta
   * con `crearEmpleado`, que YA pasó por `signUpEmail` y por lo tanto ya tiene
   * credencial: no ejercita esta rama. Este test recrea la fila "cruda" a
   * mano, mismo INSERT que usa el script (y que ya usan test/auth.test.ts y
   * test/rls.test.ts para lo mismo).
   */
  it('define la PRIMERA contraseña de alguien sin fila en accounts', async () => {
    const { rows } = await owner.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Sin credencial', 'sincredencial@ejemplo.test', 'EMPLEADO', now(), now())
       RETURNING id`,
      [tenantId],
    )
    const id: string = rows[0].id

    const primera = 'primera-clave-larga'
    await administrar.resetearClave({ tenantId, origen: ORIGEN, usuarioId: id, clave: primera })

    const r = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'sincredencial@ejemplo.test', password: primera },
      asResponse: true,
    })
    expect(r.status).toBe(200)
  })
})
