import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

/**
 * Las actions de la caja de `/vender` (ciclo del arqueo, 2026-10-18): abrir
 * con dólares, registrar un movimiento y cerrar con arqueo, con login real de
 * un EMPLEADO —la decisión es que cualquiera del local las usa, y un mock de
 * la sesión no probaría eso—. Las reglas de fondo están en lib/caja/*.test.ts;
 * acá, lo que la action le agrega: qué campos lee, qué hace con el formulario
 * viejo, qué revalida y qué cartel devuelve.
 */

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Caja acciones test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(estado.cookie ? { cookie: estado.cookie } : undefined),
}))

vi.mock('next/navigation', () => ({
  forbidden: () => {
    throw new Error('FORBIDDEN')
  },
  redirect: () => {
    throw new Error('REDIRECT')
  },
}))

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath: (r: string, t?: string) => revalidatePath(r, t) }))

let acciones: typeof import('./acciones')
let owner: Client

const INICIAL = { error: null }
const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-caja@ejemplo.test'

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'
  acciones = await import('./acciones')
  const { authParaTenant } = await import('@/lib/auth/para-tenant')
  const { origenDelRequest } = await import('@/lib/auth/origen')
  const administrar = await import('@/lib/usuarios/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  const subdominio = `caja-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un vendedor',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  const r = await authParaTenant(estado.tenantId, origen).api.signInEmail({
    body: { email: MAIL_EMPLEADO, password: CLAVE },
    asResponse: true,
  })
  const cookie = r.headers.get('set-cookie')
  if (!cookie) throw new Error('el login no devolvió cookie; el test no probaría nada')
  estado.cookie = cookie.split(';')[0]
})

afterAll(async () => {
  await owner.end()
})

beforeEach(async () => {
  await owner.query('DELETE FROM movimientos_de_caja WHERE tenant_id = $1', [estado.tenantId])
  await owner.query('DELETE FROM cajas WHERE tenant_id = $1', [estado.tenantId])
  revalidatePath.mockClear()
})

function formulario(campos: Record<string, string>): FormData {
  const datos = new FormData()
  for (const [k, v] of Object.entries(campos)) datos.set(k, v)
  return datos
}

async function laCaja() {
  const { rows } = await owner.query(
    `SELECT saldo_inicial, saldo_inicial_usd, cerrada_en, esperado_ars, contado_ars, retirado_ars,
            contado_usd, nota_cierre
     FROM cajas WHERE tenant_id = $1 ORDER BY abierta_en DESC LIMIT 1`,
    [estado.tenantId],
  )
  return rows[0]
}

describe('las actions de la caja', () => {
  it('abre con pesos y dólares, y revalida /vender y /caja', async () => {
    const r = await acciones.abrirCajaDesdeVender(
      INICIAL,
      formulario({ saldoInicial: '10000', saldoInicialUsd: '50' }),
    )
    expect(r).toEqual({ error: null })
    const c = await laCaja()
    expect(c.saldo_inicial).toBe('10000.00')
    expect(c.saldo_inicial_usd).toBe('50.00')
    expect(revalidatePath).toHaveBeenCalledWith('/vender', undefined)
    expect(revalidatePath).toHaveBeenCalledWith('/caja', undefined)
  })

  // Lo que manda el formulario de antes del deploy: sin el campo de dólares.
  it('sin el campo de dólares abre como antes, en cero', async () => {
    await acciones.abrirCajaDesdeVender(INICIAL, formulario({ saldoInicial: '100' }))
    expect((await laCaja()).saldo_inicial_usd).toBe('0.00')
  })

  it('registra un egreso, y uno sin motivo vuelve como cartel', async () => {
    await acciones.abrirCajaDesdeVender(INICIAL, formulario({ saldoInicial: '10000' }))
    revalidatePath.mockClear()
    const sinNota = await acciones.registrarMovimientoDesdeVender(
      INICIAL,
      formulario({ tipo: 'EGRESO', moneda: 'ARS', monto: '5000', nota: '' }),
    )
    expect(sinNota.error).toMatch(/motivo/)
    expect(revalidatePath).not.toHaveBeenCalled()

    const r = await acciones.registrarMovimientoDesdeVender(
      INICIAL,
      formulario({ tipo: 'EGRESO', moneda: 'ARS', monto: '5000', nota: 'Delivery' }),
    )
    expect(r).toEqual({ error: null })
    expect(revalidatePath).toHaveBeenCalledWith('/caja', undefined)
    const { rows } = await owner.query('SELECT monto, nota FROM movimientos_de_caja WHERE tenant_id = $1', [estado.tenantId])
    expect(rows).toEqual([{ monto: '5000.00', nota: 'Delivery' }])
  })

  it('sin caja, registrar un movimiento vuelve como cartel', async () => {
    const r = await acciones.registrarMovimientoDesdeVender(
      INICIAL,
      formulario({ tipo: 'INGRESO', moneda: 'ARS', monto: '100' }),
    )
    expect(r.error).toMatch(/no hay ninguna caja abierta/)
  })

  it('cierra con el arqueo del formulario', async () => {
    await acciones.abrirCajaDesdeVender(INICIAL, formulario({ saldoInicial: '10000' }))
    const r = await acciones.cerrarCajaDesdeVender(
      INICIAL,
      formulario({ contadoArs: '9.800,00', retiradoArs: '5000', notaCierre: 'Faltó cambio' }),
    )
    expect(r).toEqual({ error: null })
    const c = await laCaja()
    expect(c.cerrada_en).not.toBeNull()
    expect(c.esperado_ars).toBe('10000.00')
    expect(c.contado_ars).toBe('9800.00')
    expect(c.retirado_ars).toBe('5000.00')
    // El campo de dólares no vino (la columna no se mostró): cero, no NULL.
    expect(c.contado_usd).toBe('0.00')
    expect(c.nota_cierre).toBe('Faltó cambio')
  })

  // El formulario nuevo con el contado vacío es un error que se le muestra a
  // la persona — no un cierre sin contar.
  it('con el contado vacío no cierra, y lo dice', async () => {
    await acciones.abrirCajaDesdeVender(INICIAL, formulario({ saldoInicial: '0' }))
    const r = await acciones.cerrarCajaDesdeVender(INICIAL, formulario({ contadoArs: '' }))
    expect(r.error).toMatch(/efectivo contado en pesos/)
    expect((await laCaja()).cerrada_en).toBeNull()
  })

  it('retirar más de lo contado no cierra, y lo dice', async () => {
    await acciones.abrirCajaDesdeVender(INICIAL, formulario({ saldoInicial: '0' }))
    const r = await acciones.cerrarCajaDesdeVender(
      INICIAL,
      formulario({ contadoArs: '100', retiradoArs: '200' }),
    )
    expect(r.error).toMatch(/retirar más/)
    expect((await laCaja()).cerrada_en).toBeNull()
  })

  // Hallazgo de la review: cerrar sin el campo del contado era un bypass
  // permanente del arqueo (el "formulario viejo" que decía cubrir no existe:
  // el id de la action cambia en cada build). Ausente es vacío, y vacío no
  // cierra.
  it('sin el campo del contado no cierra: no hay cierre sin arqueo', async () => {
    await acciones.abrirCajaDesdeVender(INICIAL, formulario({ saldoInicial: '0' }))
    const r = await acciones.cerrarCajaDesdeVender(INICIAL, new FormData())
    expect(r.error).toMatch(/efectivo contado en pesos/)
    expect((await laCaja()).cerrada_en).toBeNull()
  })
})
