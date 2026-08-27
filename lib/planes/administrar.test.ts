import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
let otroTenantId: string
let crearPlan: typeof import('@/lib/planes/administrar').crearPlan
let editarPlan: typeof import('@/lib/planes/administrar').editarPlan
let desactivarPlan: typeof import('@/lib/planes/administrar').desactivarPlan
let reactivarPlan: typeof import('@/lib/planes/administrar').reactivarPlan
let planesDelTenant: typeof import('@/lib/planes/consultar').planesDelTenant

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'planes-a')
  otroTenantId = await crearTenant(owner, 'planes-b')

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import, no después — mismo motivo que
  // lib/caja/abrir-cerrar.test.ts.
  process.env.DATABASE_URL = urlApp()
  ;({ crearPlan, editarPlan, desactivarPlan, reactivarPlan } = await import('@/lib/planes/administrar'))
  ;({ planesDelTenant } = await import('@/lib/planes/consultar'))
})

afterAll(async () => {
  await owner.end()
})

describe('crearPlan', () => {
  it('crea el plan y lo devuelve en planesDelTenant', async () => {
    await crearPlan({
      tenantId, nombre: 'Crédito 6 cuotas', medio: 'TARJETA_CREDITO',
      cuotas: 6, recargoPorcentaje: new Prisma.Decimal('40'),
    })
    const planes = await planesDelTenant(tenantId)
    expect(planes.map((p) => p.nombre)).toContain('Crédito 6 cuotas')
    expect(planes[0].porcentaje).toBe('40')
  })

  it('rechaza un porcentaje de -100 o menos: el pago quedaría en cero o negativo', async () => {
    await expect(
      crearPlan({ tenantId, nombre: 'Regalado', medio: 'EFECTIVO', cuotas: 1,
                  recargoPorcentaje: new Prisma.Decimal('-100') }),
    ).rejects.toMatchObject({ codigo: 'PORCENTAJE_INVALIDO' })
  })

  it('rechaza un porcentaje con más de tres decimales', async () => {
    await expect(
      crearPlan({ tenantId, nombre: 'Fino', medio: 'EFECTIVO', cuotas: 1,
                  recargoPorcentaje: new Prisma.Decimal('10.0001') }),
    ).rejects.toMatchObject({ codigo: 'PORCENTAJE_INVALIDO' })
  })

  it('rechaza cuotas menores a 1', async () => {
    await expect(
      crearPlan({ tenantId, nombre: 'Cero', medio: 'TARJETA_CREDITO', cuotas: 0,
                  recargoPorcentaje: new Prisma.Decimal('10') }),
    ).rejects.toMatchObject({ codigo: 'CUOTAS_INVALIDAS' })
  })

  it('rechaza un nombre repetido para el mismo medio', async () => {
    const entrada = { tenantId, nombre: 'Crédito 3 cuotas', medio: 'TARJETA_CREDITO' as const,
                      cuotas: 3, recargoPorcentaje: new Prisma.Decimal('25') }
    await crearPlan(entrada)
    await expect(crearPlan(entrada)).rejects.toMatchObject({ codigo: 'NOMBRE_REPETIDO' })
  })

  it('el mismo nombre en OTRO medio sí se puede', async () => {
    await crearPlan({ tenantId, nombre: 'Contado', medio: 'EFECTIVO', cuotas: 1,
                      recargoPorcentaje: new Prisma.Decimal('-10') })
    await expect(
      crearPlan({ tenantId, nombre: 'Contado', medio: 'TRANSFERENCIA', cuotas: 1,
                  recargoPorcentaje: new Prisma.Decimal('-5') }),
    ).resolves.toBeDefined()
  })
})

describe('desactivarPlan', () => {
  it('lo saca de la lista y lo devuelve con incluirDesactivados', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Viejo', medio: 'EFECTIVO', cuotas: 1,
                                     recargoPorcentaje: new Prisma.Decimal('5') })
    await desactivarPlan({ tenantId, id })
    expect((await planesDelTenant(tenantId)).map((p) => p.id)).not.toContain(id)
    expect(
      (await planesDelTenant(tenantId, { incluirDesactivados: true })).map((p) => p.id),
    ).toContain(id)
  })

  // Idempotente por lo mismo que `otorgar`/`revocar`: la pantalla lo dispara
  // desde un menú y dos clicks rápidos mandan la orden dos veces.
  it('desactivar dos veces no falla', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Dos veces', medio: 'EFECTIVO', cuotas: 1,
                                     recargoPorcentaje: new Prisma.Decimal('5') })
    await desactivarPlan({ tenantId, id })
    await expect(desactivarPlan({ tenantId, id })).resolves.toBeUndefined()
  })
})

// No está en la lista de casos del brief, pero `reactivarPlan` es una función
// pública más (parte de las "Produces" del task) y quedaba sin ningún test:
// el mismo mecanismo que `desactivarPlan` (updateMany + filtro de estado),
// así que se cubre con la misma pareja de casos — el efecto y la idempotencia.
describe('reactivarPlan', () => {
  it('vuelve a mostrar un plan desactivado', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Vuelve', medio: 'EFECTIVO', cuotas: 1,
                                     recargoPorcentaje: new Prisma.Decimal('5') })
    await desactivarPlan({ tenantId, id })
    expect((await planesDelTenant(tenantId)).map((p) => p.id)).not.toContain(id)

    await reactivarPlan({ tenantId, id })
    expect((await planesDelTenant(tenantId)).map((p) => p.id)).toContain(id)
  })

  it('reactivar dos veces no falla', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Vuelve dos veces', medio: 'EFECTIVO', cuotas: 1,
                                     recargoPorcentaje: new Prisma.Decimal('5') })
    await desactivarPlan({ tenantId, id })
    await reactivarPlan({ tenantId, id })
    await expect(reactivarPlan({ tenantId, id })).resolves.toBeUndefined()
  })
})

describe('editarPlan', () => {
  it('cambia el porcentaje sin tocar las ventas ya cobradas', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Editable', medio: 'TARJETA_CREDITO',
                                     cuotas: 3, recargoPorcentaje: new Prisma.Decimal('25') })
    await editarPlan({ tenantId, id, nombre: 'Editable', cuotas: 3,
                       recargoPorcentaje: new Prisma.Decimal('30'), orden: 1 })
    const plan = (await planesDelTenant(tenantId)).find((p) => p.id === id)
    expect(plan?.porcentaje).toBe('30')
  })

  // No sólo "no está" — el where de editarPlan no filtra por tenant, y sin RLS
  // esto encontraría la fila igual (es de OTRO tenant, no inexistente).
  // Confirmarlo requiere ver, en la misma corrida, que el plan SÍ existe: el
  // it siguiente lo hace leyéndolo con el dueño real inmediatamente después.
  it('sobre un plan de otro tenant no encuentra nada', async () => {
    const { id: planDelPrimero } = await crearPlan({
      tenantId, nombre: 'Del primero', medio: 'EFECTIVO', cuotas: 1,
      recargoPorcentaje: new Prisma.Decimal('5'),
    })
    await expect(
      editarPlan({ tenantId: otroTenantId, id: planDelPrimero, nombre: 'X', cuotas: 1,
                   recargoPorcentaje: new Prisma.Decimal('1'), orden: 0 }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })

    // La fila sigue intacta y visible para su propio tenant: no es que RLS
    // esconda la existencia del plan por completo, es que otroTenantId no
    // puede TOCARLO — la policy filtra por tenant_id, no borra nada.
    const propio = (await planesDelTenant(tenantId)).find((p) => p.id === planDelPrimero)
    expect(propio?.nombre).toBe('Del primero')
  })
})
