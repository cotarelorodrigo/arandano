import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'
import type { Sesion } from '@/lib/auth/sesion'

let puedeConSesion: typeof import('@/lib/permisos/guarda').puedeConSesion
let otorgar: typeof import('@/lib/permisos/administrar').otorgar

let owner: Client
let tenantId: string
let duenio: string
let empleado: string

/** Una sesión mínima: la guarda sólo mira tenant.id, usuario.id y usuario.rol. */
function sesionDe(usuarioId: string, rol: 'DUENO' | 'EMPLEADO'): Sesion {
  return {
    tenant: { id: tenantId } as Sesion['tenant'],
    subdominio: 'guarda',
    usuario: { id: usuarioId, nombre: 'x', email: 'x@guarda.test', rol },
  }
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ puedeConSesion } = await import('@/lib/permisos/guarda'))
  ;({ otorgar } = await import('@/lib/permisos/administrar'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'guarda')
  duenio = await crearUsuario(owner, tenantId, 'duenio@guarda.test', 'DUENO')
  empleado = await crearUsuario(owner, tenantId, 'empleado@guarda.test', 'EMPLEADO')
})

afterAll(async () => {
  await owner.end()
})

describe('la guarda de permisos', () => {
  it('un dueño puede todo, sin tener ninguna fila', async () => {
    for (const p of ['ARTICULOS_CREAR', 'COSTOS', 'VENTAS_ANULAR'] as const) {
      expect(await puedeConSesion(sesionDe(duenio, 'DUENO'), p)).toBe(true)
    }
  })

  it('un empleado sin la fila no puede', async () => {
    expect(await puedeConSesion(sesionDe(empleado, 'EMPLEADO'), 'ARTICULOS_CREAR')).toBe(false)
  })

  it('un empleado con la fila puede, y sólo ese permiso', async () => {
    await otorgar({ tenantId, usuarioId: empleado, permiso: 'ARTICULOS_CREAR' })
    expect(await puedeConSesion(sesionDe(empleado, 'EMPLEADO'), 'ARTICULOS_CREAR')).toBe(true)
    expect(await puedeConSesion(sesionDe(empleado, 'EMPLEADO'), 'COSTOS')).toBe(false)
  })
})

describe('el contrato de exigirPermiso y puede', () => {
  const FUENTE = readFileSync('lib/permisos/guarda.ts', 'utf8')

  // forbidden() y no redirect(): el 403 es lo que ya usa exigirDuenio, y
  // mandar a login a alguien que YA está logueado es un bucle disfrazado.
  it('exigirPermiso tira forbidden(), no redirige', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function exigirPermiso'))
    expect(cuerpo).toContain('forbidden()')
    expect(cuerpo).not.toContain('redirect(')
  })
})
