import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant, crearUsuario } from '@/test/datos'

let owner: Client
let tenantA: string
let tenantB: string
let usuarioA: string
let usuarioB: string
let abrirCaja: typeof import('@/lib/caja/abrir-cerrar').abrirCaja
let cerrarCaja: typeof import('@/lib/caja/abrir-cerrar').cerrarCaja
let cajaAbierta: typeof import('@/lib/caja/abrir-cerrar').cajaAbierta

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'caja-a')
  tenantB = await crearTenant(owner, 'caja-b')
  usuarioA = await crearUsuario(owner, tenantA, 'flor@caja-a.test')
  usuarioB = await crearUsuario(owner, tenantB, 'ruben@caja-b.test')

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import, no después.
  process.env.DATABASE_URL = urlApp()
  ;({ abrirCaja, cerrarCaja, cajaAbierta } = await import('@/lib/caja/abrir-cerrar'))
})

afterAll(async () => {
  await owner.end()
})

// Cada caso arranca sin caja abierta: el índice parcial es por tenant, así que
// una caja que quedó abierta de un caso anterior hace fallar al siguiente por
// el motivo equivocado.
beforeEach(async () => {
  await owner.query('DELETE FROM cajas')
})

describe('abrir y cerrar la caja', () => {
  it('abrir deja la caja con cerradaEn en null', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    const abierta = await cajaAbierta(tenantA)
    expect(abierta?.id).toBe(id)
    expect(abierta?.saldoInicial.toString()).toBe('15000')
  })

  it('sin caja abierta, cajaAbierta() devuelve null', async () => {
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  it('cerrar la deja con la fecha y con quién la cerró', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    const fila = await owner.query('SELECT cerrada_en, cerrada_por_id FROM cajas WHERE id = $1', [id])
    expect(fila.rows[0].cerrada_en).not.toBeNull()
    expect(fila.rows[0].cerrada_por_id).toBe(usuarioA)
  })

  it('después de cerrar, cajaAbierta() vuelve a dar null', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  it('se puede abrir una caja nueva después de cerrar la anterior', async () => {
    const primera = await abrirCaja(tenantA, usuarioA, '15000.00')
    await cerrarCaja(tenantA, usuarioA)
    const segunda = await abrirCaja(tenantA, usuarioA, '20000.00')
    expect(segunda.id).not.toBe(primera.id)
    expect((await cajaAbierta(tenantA))?.id).toBe(segunda.id)
  })

  // El caso que justifica el índice único parcial. Sin el índice, esto pasa —
  // y el paso 8 del plan hace comprobar exactamente eso.
  it('no deja abrir dos cajas a la vez en el mismo tenant', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await expect(abrirCaja(tenantA, usuarioA, '20000.00')).rejects.toThrow(/ya hay una caja abierta/i)
  })

  // El índice es POR TENANT, no global: dos locales distintos abren a la vez.
  it('dos tenants pueden tener cada uno su caja abierta', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await abrirCaja(tenantB, usuarioB, '9000.00')
    expect(await cajaAbierta(tenantA)).not.toBeNull()
    expect(await cajaAbierta(tenantB)).not.toBeNull()
  })

  it('cerrar sin caja abierta falla con un error claro', async () => {
    await expect(cerrarCaja(tenantA, usuarioA)).rejects.toThrow(/no hay ninguna caja abierta/i)
  })

  // Cualquiera del local abre y cierra, dueño o empleado: en un mostrador abre
  // el que llega primero. La fila registra quién fue, así que la trazabilidad
  // no se pierde, y sin arqueo todavía no hay plata que cuadrar — que es lo
  // único que justificaría restringirlo.
  it('un empleado puede abrir y cerrar', async () => {
    const empleado = await crearUsuario(owner, tenantA, 'nahuel@caja-a.test', 'EMPLEADO')
    await abrirCaja(tenantA, empleado, '15000.00')
    expect(await cajaAbierta(tenantA)).not.toBeNull()
    await cerrarCaja(tenantA, empleado)
    expect(await cajaAbierta(tenantA)).toBeNull()
  })
})
