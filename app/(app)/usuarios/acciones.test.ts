import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

/**
 * La Task 7 (capa de abajo) tuvo un hueco: una regla de seguridad sin ningún
 * test que la ejercitara. Acá está la misma clase de regla, una capa más
 * arriba: que la pantalla no se muestre no alcanza, porque una action se
 * invoca directo, sin pasar por ningún componente. Este archivo prueba que
 * `comoDuenio` —el helper que cada action llama antes de tocar nada— rechaza
 * de verdad a un EMPLEADO con una sesión REAL (login real, cookie real,
 * `getSession` real contra Postgres), no con un mock de `exigirDuenio` que
 * asumiría la conclusión.
 *
 * Lo único mockeado es la frontera con Next: `next/headers` (para inyectar la
 * cookie de sesión de cada caso, mismo patrón que app/login/acciones.test.ts
 * y lib/auth/sesion.test.ts), `next/navigation` (para poder distinguir
 * `forbidden()` de cualquier otro fallo, mismo patrón que app/page.test.tsx) y
 * `next/cache` (`revalidatePath` explota fuera de un request real de Next con
 * "Invariant: static generation store missing" — no es parte de la regla que
 * este archivo verifica).
 */

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Usuarios acciones test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(estado.cookie ? { cookie: estado.cookie } : undefined),
}))

const forbidden = vi.fn(() => {
  throw new Error('FORBIDDEN')
})
const redirect: (a: string) => never = vi.fn(() => {
  throw new Error('REDIRECT')
})
vi.mock('next/navigation', () => ({
  forbidden: () => forbidden(),
  redirect: (a: string) => redirect(a),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let altaEmpleado: typeof import('./acciones').altaEmpleado
let nuevaClave: typeof import('./acciones').nuevaClave
let baja: typeof import('./acciones').baja
let alta: typeof import('./acciones').alta
// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async. Es un valor inicial, no un dato con
// lógica: duplicar tres campos nulos cuesta menos que un export prohibido.
const INICIAL = { error: null, aviso: null }
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest
let administrar: typeof import('@/lib/usuarios/administrar')

let owner: Client
const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-acciones@ejemplo.test'
const MAIL_DUENO = 'duenia-acciones@ejemplo.test'
let empleadoId: string

beforeAll(async () => {
  // Mismo motivo que app/login/acciones.test.ts: lib/auth/para-tenant.ts
  // arrastra lib/db.ts, que arma su Pool leyendo DATABASE_URL al importarse;
  // DOMINIO_BASE lo necesita origenDelRequest para armar el baseURL.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({ altaEmpleado, nuevaClave, baja, alta } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  administrar = await import('@/lib/usuarios/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `usuarios-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  const empleado = await administrar.crearEmpleado({
    tenantId: estado.tenantId,
    origen,
    nombre: 'Un empleado',
    email: MAIL_EMPLEADO,
    clave: CLAVE,
    rol: 'EMPLEADO',
  })
  empleadoId = empleado.id
  await administrar.crearEmpleado({
    tenantId: estado.tenantId,
    origen,
    nombre: 'La dueña',
    email: MAIL_DUENO,
    clave: CLAVE,
    rol: 'DUENO',
  })
})

afterAll(async () => {
  await owner.end()
})

/** Login real contra Better Auth; devuelve la cookie de sesión, lista para
 *  que el mock de next/headers de arriba la sirva. Mismo extracto que hace
 *  test/auth.test.ts ("aislamiento de la sesión"). */
async function cookieDe(email: string): Promise<string> {
  const origen = await origenDelRequest(estado.subdominio)
  const r = await authParaTenant(estado.tenantId, origen).api.signInEmail({
    body: { email, password: CLAVE },
    asResponse: true,
  })
  const cookie = r.headers.get('set-cookie')
  if (!cookie) throw new Error('el login no devolvió cookie; el test no probaría nada')
  return cookie.split(';')[0]
}

function formulario(): FormData {
  const datos = new FormData()
  datos.set('usuarioId', empleadoId)
  datos.set('nombre', 'Alguien')
  datos.set('email', `alguien-${Date.now()}@ejemplo.test`)
  datos.set('clave', 'otra-clave-de-sobra')
  return datos
}

describe('cada action revalida el rol por su cuenta', () => {
  it('un EMPLEADO no puede dar de alta a otro, aunque invoque la action directo', async () => {
    estado.cookie = await cookieDe(MAIL_EMPLEADO)
    await expect(altaEmpleado(INICIAL, formulario())).rejects.toThrow('FORBIDDEN')
  })

  it('un EMPLEADO no puede resetear una clave', async () => {
    estado.cookie = await cookieDe(MAIL_EMPLEADO)
    await expect(nuevaClave(INICIAL, formulario())).rejects.toThrow('FORBIDDEN')
  })

  it('un EMPLEADO no puede desactivar a nadie', async () => {
    estado.cookie = await cookieDe(MAIL_EMPLEADO)
    await expect(baja(INICIAL, formulario())).rejects.toThrow('FORBIDDEN')
  })

  it('un EMPLEADO no puede reactivar a nadie', async () => {
    estado.cookie = await cookieDe(MAIL_EMPLEADO)
    await expect(alta(INICIAL, formulario())).rejects.toThrow('FORBIDDEN')
  })

  // El negativo de los cuatro de arriba: si el guard rechazara TODO, los
  // tests de EMPLEADO pasarían igual sin probar nada — hace falta un camino
  // que sí llegue a ejecutar la operación para que el resto tenga sentido.
  it('una DUEÑA sí puede: mismo camino, sin que el guard la frene', async () => {
    // Limpia lo que acumularon los cuatro casos de arriba: a esta altura del
    // describe, forbidden ya fue invocado varias veces con éxito — lo que
    // importa acá es que NO se invoque DE NUEVO en este caso puntual.
    forbidden.mockClear()
    estado.cookie = await cookieDe(MAIL_DUENO)
    const datos = new FormData()
    datos.set('usuarioId', empleadoId)
    datos.set('clave', 'clave-reseteada-de-sobra')

    const resultado = await nuevaClave(INICIAL, datos)

    expect(resultado.error).toBeNull()
    expect(forbidden).not.toHaveBeenCalled()
  })
})
