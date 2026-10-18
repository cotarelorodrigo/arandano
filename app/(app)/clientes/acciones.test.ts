import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Clientes test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(estado.cookie ? { cookie: estado.cookie } : undefined),
}))

const forbidden = vi.fn(() => {
  throw new Error('FORBIDDEN')
})
const redirect = vi.fn((a: string) => {
  throw new Error(`REDIRECT ${a}`)
})
vi.mock('next/navigation', () => ({
  forbidden: () => forbidden(),
  redirect: (a: string) => redirect(a),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let acciones: typeof import('./acciones')
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-clientes@ejemplo.test'
const MAIL_DUENO = 'duenia-clientes@ejemplo.test'

let owner: Client
let cookieEmpleado: string
let cookieDuenio: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  acciones = await import('./acciones')
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `clientes-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un vendedor',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })
  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
  cookieDuenio = await cookieDe(MAIL_DUENO)
})

afterAll(async () => {
  await owner.end()
})

/** Login real contra Better Auth; mismo extracto que plan-canje. */
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

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData()
  for (const [k, v] of Object.entries(campos)) datos.set(k, v)
  return datos
}

async function idDe(nombre: string): Promise<string> {
  const r = await owner.query(`SELECT id FROM clientes WHERE tenant_id = $1 AND nombre = $2`, [estado.tenantId, nombre])
  return r.rows[0]?.id
}

describe('alta y edición: cualquier sesión', () => {
  it('un EMPLEADO da de alta, con el consentimiento del checkbox', async () => {
    estado.cookie = cookieEmpleado
    const r = await acciones.altaDeCliente(
      INICIAL,
      formulario({ nombre: 'Alta del vendedor', telefono: '11 4000-0001', email: '', notas: 'nota', aceptaOfertas: '1' }),
    )
    expect(r).toEqual({ error: null, aviso: 'Cliente cargado.' })
    const f = await owner.query(`SELECT acepta_ofertas, notas, email FROM clientes WHERE id = $1`, [await idDe('Alta del vendedor')])
    expect(f.rows[0]).toEqual({ acepta_ofertas: true, notas: 'nota', email: null })
  })

  it('el checkbox destildado no manda nada, y eso es "no acepta"', async () => {
    estado.cookie = cookieEmpleado
    await acciones.altaDeCliente(INICIAL, formulario({ nombre: 'Sin tilde', telefono: '' }))
    const f = await owner.query(`SELECT acepta_ofertas FROM clientes WHERE id = $1`, [await idDe('Sin tilde')])
    expect(f.rows[0].acepta_ofertas).toBe(false)
  })

  it('un teléfono repetido vuelve como cartel', async () => {
    estado.cookie = cookieEmpleado
    const r = await acciones.altaDeCliente(INICIAL, formulario({ nombre: 'Repetido', telefono: '+54 9 11 4000-0001' }))
    expect(r.error).toMatch(/Alta del vendedor/)
  })

  it('un EMPLEADO edita la ficha', async () => {
    estado.cookie = cookieEmpleado
    const id = await idDe('Sin tilde')
    const r = await acciones.edicionDeCliente(
      INICIAL,
      formulario({ id, nombre: 'Con tilde ahora', telefono: '', email: 'a@b.test', notas: '', aceptaOfertas: '1' }),
    )
    expect(r.error).toBeNull()
    const f = await owner.query(`SELECT nombre, acepta_ofertas FROM clientes WHERE id = $1`, [id])
    expect(f.rows[0]).toEqual({ nombre: 'Con tilde ahora', acepta_ofertas: true })
  })

  it('un id mal formado es "no existe", no un 500', async () => {
    estado.cookie = cookieEmpleado
    const r = await acciones.edicionDeCliente(INICIAL, formulario({ id: 'nada', nombre: 'x' }))
    expect(r.error).toMatch(/ya no existe/)
  })

  it('sin sesión, redirige al login', async () => {
    estado.cookie = ''
    await expect(acciones.altaDeCliente(INICIAL, formulario({ nombre: 'x' }))).rejects.toThrow('REDIRECT /login')
    await expect(acciones.buscarClientesDelLocal('x')).rejects.toThrow('REDIRECT /login')
  })

  it('el buscador encuentra con sesión de empleado', async () => {
    estado.cookie = cookieEmpleado
    const r = await acciones.buscarClientesDelLocal('1140000001')
    expect(r.map((c) => c.nombre)).toEqual(['Alta del vendedor'])
  })
})

describe('exportar y borrar: sólo el dueño', () => {
  it('un EMPLEADO no puede exportar', async () => {
    estado.cookie = cookieEmpleado
    forbidden.mockClear()
    await expect(acciones.exportarClientes({ texto: '', soloAceptanOfertas: false })).rejects.toThrow('FORBIDDEN')
    expect(forbidden).toHaveBeenCalled()
  })

  it('un EMPLEADO no puede borrar, y el cliente queda', async () => {
    estado.cookie = cookieEmpleado
    await acciones.altaDeCliente(INICIAL, formulario({ nombre: 'No lo borra el vendedor' }))
    const id = await idDe('No lo borra el vendedor')
    await expect(acciones.bajaDeCliente(INICIAL, formulario({ id }))).rejects.toThrow('FORBIDDEN')
    expect(await idDe('No lo borra el vendedor')).toBe(id)
  })

  it('la dueña exporta, con el filtro aplicado', async () => {
    estado.cookie = cookieDuenio
    const todos = await acciones.exportarClientes({ texto: '', soloAceptanOfertas: false })
    const filas = todos.split('\r\n')
    expect(filas[0]).toBe('Nombre,Teléfono,Email,Acepta ofertas,Fecha de alta,Compras,Última compra,Notas')
    expect(todos).toContain('No lo borra el vendedor')

    const conOfertas = await acciones.exportarClientes({ texto: '', soloAceptanOfertas: true })
    expect(conOfertas).toContain('Alta del vendedor')
    expect(conOfertas).not.toContain('No lo borra el vendedor')

    const buscado = await acciones.exportarClientes({ texto: 'con tilde', soloAceptanOfertas: false })
    expect(buscado.split('\r\n')).toHaveLength(2)
  })

  it('la dueña borra uno sin historia y vuelve al listado', async () => {
    estado.cookie = cookieDuenio
    const id = await idDe('No lo borra el vendedor')
    await expect(acciones.bajaDeCliente(INICIAL, formulario({ id }))).rejects.toThrow('REDIRECT /clientes')
    expect(await idDe('No lo borra el vendedor')).toBeUndefined()
  })

  it('a la dueña, uno con historia le vuelve como cartel', async () => {
    estado.cookie = cookieDuenio
    const id = await idDe('Alta del vendedor')
    const u = await owner.query(`SELECT id FROM users WHERE tenant_id = $1 LIMIT 1`, [estado.tenantId])
    await owner.query(
      `INSERT INTO ventas (id, tenant_id, numero, usuario_id, cliente_id, total, creado_en)
       VALUES (gen_random_uuid(), $1, 1, $2, $3, 10.00, now())`,
      [estado.tenantId, u.rows[0].id, id],
    )
    const r = await acciones.bajaDeCliente(INICIAL, formulario({ id }))
    expect(r.error).toBe('Tiene 1 compra: no se puede borrar.')
  })
})
