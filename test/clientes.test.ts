import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'
import { ErrorDeCliente } from '@/lib/clientes/errores'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
let crearCliente: typeof import('@/lib/clientes/administrar').crearCliente
let buscarClientes: typeof import('@/lib/clientes/administrar').buscarClientes
let crearOrden: typeof import('@/lib/ordenes-de-trabajo/crear').crearOrden

let owner: Client
let tenantId: string
let otroTenantId: string
let usuarioId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ crearCliente, buscarClientes } = await import('@/lib/clientes/administrar'))
  ;({ crearOrden } = await import('@/lib/ordenes-de-trabajo/crear'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `clientes-${Date.now()}`)
  otroTenantId = await crearTenant(owner, `clientes-otro-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, `tecnico-clientes-${Date.now()}@ot.test`)
})

afterAll(async () => {
  await owner.end()
})

describe('alta de cliente', () => {
  it('crea el cliente y devuelve su id', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Juan Pérez', telefono: '1155667788' })
    expect(c.id).toBeTruthy()
    expect(c.nombre).toBe('Juan Pérez')
  })

  it('rechaza el nombre vacío', async () => {
    await expect(crearCliente({ tenantId, nombre: '   ', telefono: null })).rejects.toThrow(
      ErrorDeCliente,
    )
  })

  it('acepta el teléfono en null: no todo cliente lo deja', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Sin teléfono', telefono: null })
    expect(c.id).toBeTruthy()
  })
})

describe('búsqueda de clientes', () => {
  beforeAll(async () => {
    await crearCliente({ tenantId, nombre: 'Ana Gómez', telefono: '1144332211' })
    await crearCliente({ tenantId, nombre: 'Ana María López', telefono: '1199887766' })
    await crearCliente({ tenantId: otroTenantId, nombre: 'Ana Ajena', telefono: '1100000000' })
  })

  it('encuentra por nombre, sin importar mayúsculas', async () => {
    const r = await buscarClientes(tenantId, 'ana')
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r.every((c) => c.nombre.toLowerCase().includes('ana'))).toBe(true)
  })

  it('encuentra por teléfono', async () => {
    const r = await buscarClientes(tenantId, '1144332211')
    expect(r).toHaveLength(1)
    expect(r[0].nombre).toBe('Ana Gómez')
  })

  it('NO ve los clientes de otro tenant', async () => {
    // El corazón del multi-tenant: el nombre existe, y aun así no aparece.
    const r = await buscarClientes(tenantId, 'Ana Ajena')
    expect(r).toHaveLength(0)
  })

  it('con la búsqueda vacía no devuelve nada', async () => {
    // Y NO todos: un buscador que sin texto vuelca la tabla entera es un scan
    // sobre la pantalla más caliente del módulo.
    expect(await buscarClientes(tenantId, '   ')).toHaveLength(0)
  })
})

// Task 3 del rediseño de Servicio Técnico: el buscador de "Recibir equipo"
// pide "N órdenes previas" (design/arandano.pen, nodos `zjJc0`/`C8k7w`), y
// ese conteo se resuelve acá — no en la pantalla — para que la ficha de la
// orden (Task 4) lo pida de la misma forma.
describe('ordenesPrevias del resultado del buscador', () => {
  it('cuenta las órdenes reales del cliente, no un número fijo', async () => {
    const equipo = { equipoMarca: 'Samsung', equipoModelo: 'A54', fallaDeclarada: 'no carga' }
    const c = await crearCliente({ tenantId, nombre: 'Marcos Conteo', telefono: '1155551111' })
    await crearOrden({ tenantId, usuarioId, clienteId: c.id, ...equipo })
    await crearOrden({ tenantId, usuarioId, clienteId: c.id, ...equipo })

    const r = await buscarClientes(tenantId, 'Marcos Conteo')
    expect(r).toHaveLength(1)
    expect(r[0].ordenesPrevias).toBe(2)
  })

  // El caso que el brief pide explícitamente: sin órdenes, el conteo tiene
  // que ser el 0 real, no un valor inventado (undefined coaccionado a texto,
  // o un fallback que parezca un dato cuando no lo es).
  it('un cliente sin ninguna orden todavía cuenta 0, no un conteo falso', async () => {
    await crearCliente({ tenantId, nombre: 'Marcos Sin Ordenes', telefono: '1155552222' })
    const r = await buscarClientes(tenantId, 'Marcos Sin Ordenes')
    expect(r).toHaveLength(1)
    expect(r[0].ordenesPrevias).toBe(0)
  })
})
