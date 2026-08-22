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
  // y el paso 8 del brief hace comprobar exactamente eso (documentado en el
  // reporte de la task).
  it('no deja abrir dos cajas a la vez en el mismo tenant', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')
    await expect(abrirCaja(tenantA, usuarioA, '20000.00')).rejects.toMatchObject({
      codigo: 'CAJA_YA_ABIERTA',
    })
  })

  // El índice es POR TENANT, no global: dos locales distintos abren a la vez,
  // y CADA UNO ve la SUYA — no sólo "alguna caja no nula" (ver el hallazgo I2
  // de la review: ese assert más débil habría pasado igual con la policy
  // rota y A leyendo la caja de B). El aislamiento en sí, a nivel de base y
  // no de esta función, tiene su propia sonda en test/rls.test.ts.
  it('dos tenants pueden tener cada uno su caja abierta, y son cajas distintas', async () => {
    const deA = await abrirCaja(tenantA, usuarioA, '15000.00')
    const deB = await abrirCaja(tenantB, usuarioB, '9000.00')

    const abiertaA = await cajaAbierta(tenantA)
    const abiertaB = await cajaAbierta(tenantB)
    expect(abiertaA?.id).toBe(deA.id)
    expect(abiertaB?.id).toBe(deB.id)
    expect(abiertaA?.id).not.toBe(abiertaB?.id)
    expect(abiertaA?.saldoInicial.toString()).toBe('15000')
    expect(abiertaB?.saldoInicial.toString()).toBe('9000')
  })

  it('cerrar sin caja abierta falla con un error claro', async () => {
    await expect(cerrarCaja(tenantA, usuarioA)).rejects.toMatchObject({
      codigo: 'SIN_CAJA_ABIERTA',
    })
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

  // C1 de la review: la FK de Postgres hacia `users` no distingue tenants —
  // sus triggers corren como dueño de la tabla, exento de RLS—, así que sin
  // `exigirUsuario` esto entraba sin quejarse y el tenant B quedaba con un
  // empleado que no puede dar de baja (onDelete: Restrict contra una fila que
  // RLS le esconde). Ver lib/ventas/pertenencia.ts.
  describe('el usuario tiene que ser del tenant', () => {
    it('abrirCaja rechaza un usuario de otro tenant', async () => {
      await expect(abrirCaja(tenantA, usuarioB, '15000.00')).rejects.toMatchObject({
        codigo: 'USUARIO_INEXISTENTE',
      })
      // Y no queda una caja huérfana: la transacción entera se descarta.
      expect(await cajaAbierta(tenantA)).toBeNull()
    })

    it('cerrarCaja rechaza un usuario de otro tenant', async () => {
      await abrirCaja(tenantA, usuarioA, '15000.00')
      await expect(cerrarCaja(tenantA, usuarioB)).rejects.toMatchObject({
        codigo: 'USUARIO_INEXISTENTE',
      })
      // Y la caja de A sigue abierta: el rechazo no la tocó.
      expect(await cajaAbierta(tenantA)).not.toBeNull()
    })
  })

  // I3 de la review: sin el `updateMany` con `cerradaEn: null` repetido en el
  // where, dos cierres concurrentes A VECES alcanzan a mostrar la carrera y a
  // veces no —depende de si el segundo `findFirst` corre antes o después de
  // que el primero comitee, y con sólo dos llamadas el timing de este entorno
  // (Postgres en Docker, localhost) tiende a serializarlas por casualidad—.
  // Con QUINCE concurrentes sobre la misma caja el efecto deja de depender de
  // la suerte: medido a mano con `update({ where: { id } })` liso (sin el
  // `cerradaEn: null` del fix), las quince "ganaban" —Prisma actualiza por id
  // sin mirar ninguna otra condición, así que cada una pisaba a la anterior
  // sin quejarse—. Con el fix puesto, siempre gana exactamente una.
  it('quince cierres concurrentes de la misma caja: gana exactamente uno', async () => {
    await abrirCaja(tenantA, usuarioA, '15000.00')

    const N = 15
    const resultados = await Promise.allSettled(
      Array.from({ length: N }, () => cerrarCaja(tenantA, usuarioA)),
    )
    const estados = resultados.map((r) => r.status)
    expect(estados.filter((s) => s === 'fulfilled')).toHaveLength(1)
    expect(estados.filter((s) => s === 'rejected')).toHaveLength(N - 1)

    for (const r of resultados) {
      if (r.status === 'rejected') {
        expect(r.reason).toMatchObject({ codigo: 'SIN_CAJA_ABIERTA' })
      }
    }

    // Y la caja quedó cerrada UNA vez, no reescrita por ninguno de los catorce
    // que perdieron.
    expect(await cajaAbierta(tenantA)).toBeNull()
  })

  describe('el saldo inicial', () => {
    it('rechaza un saldo negativo', async () => {
      await expect(abrirCaja(tenantA, usuarioA, '-1.00')).rejects.toMatchObject({
        codigo: 'SALDO_INVALIDO',
      })
    })

    it('rechaza más de dos decimales', async () => {
      await expect(abrirCaja(tenantA, usuarioA, '100.005')).rejects.toMatchObject({
        codigo: 'SALDO_INVALIDO',
      })
    })

    it('rechaza más de diez dígitos enteros', async () => {
      await expect(abrirCaja(tenantA, usuarioA, '12345678901.00')).rejects.toMatchObject({
        codigo: 'SALDO_INVALIDO',
      })
    })

    it('acepta cero: un turno puede arrancar sin efectivo', async () => {
      const { id } = await abrirCaja(tenantA, usuarioA, '0.00')
      expect((await cajaAbierta(tenantA))?.id).toBe(id)
    })
  })
})
