import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeOrden } from '@/lib/ordenes-de-trabajo/errores'

let crearOrden: typeof import('@/lib/ordenes-de-trabajo/crear').crearOrden
let crearCliente: typeof import('@/lib/clientes/administrar').crearCliente

let owner: Client
let tenantId: string
let usuarioId: string
let clienteId: string
let otroTenantId: string
let clienteAjeno: string

const equipo = {
  equipoMarca: 'Samsung',
  equipoModelo: 'A54',
  fallaDeclarada: 'no carga',
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ crearOrden } = await import('@/lib/ordenes-de-trabajo/crear'))
  ;({ crearCliente } = await import('@/lib/clientes/administrar'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `ordenes-${Date.now()}`)
  otroTenantId = await crearTenant(owner, `ordenes-otro-${Date.now()}`)

  const u = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Técnico', 't@ot.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId],
  )
  usuarioId = u.rows[0].id
  clienteId = (await crearCliente({ tenantId, nombre: 'Juan', telefono: '111' })).id
  clienteAjeno = (await crearCliente({ tenantId: otroTenantId, nombre: 'Ajeno', telefono: '2' })).id
})

afterAll(async () => {
  await owner.end()
})

describe('alta de una orden', () => {
  it('numera desde 1 y sigue de a uno, sin huecos', async () => {
    const a = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const b = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    expect(b.numero).toBe(a.numero + 1)
  })

  it('nace en RECIBIDO con su evento de apertura', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const { rows } = await owner.query(
      `SELECT e.desde, e.hasta, e.usuario_id, o.estado
         FROM eventos_orden e JOIN ordenes_de_trabajo o ON o.id = e.orden_id
        WHERE e.orden_id = $1`,
      [o.id],
    )
    expect(rows).toHaveLength(1)
    // desde en null: el alta no viene de ningún estado.
    expect(rows[0].desde).toBeNull()
    expect(rows[0].hasta).toBe('RECIBIDO')
    expect(rows[0].estado).toBe('RECIBIDO')
    expect(rows[0].usuario_id).toBe(usuarioId)
  })

  it('la misma clave de idempotencia devuelve la orden que ya existe', async () => {
    const clave = `clave-${Date.now()}`
    const a = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave })
    const b = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave })
    expect(b.id).toBe(a.id)
    expect(b.numero).toBe(a.numero)
  })

  it('dos altas simultáneas con la misma clave crean UNA sola orden', async () => {
    // La carrera real del doble click. El chequeo previo puede no verlas
    // encontrarse: la defensa que cierra es el índice único de la base.
    const clave = `carrera-${Date.now()}`
    const [a, b] = await Promise.all([
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave }),
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave }),
    ])
    expect(b.id).toBe(a.id)
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM ordenes_de_trabajo WHERE clave_idempotencia = $1`,
      [clave],
    )
    expect(rows[0].n).toBe(1)
  })

  it('sin clave, dos altas iguales son dos órdenes distintas', async () => {
    // Correcto y no un defecto: dos clientes pueden traer el mismo modelo con
    // la misma falla el mismo día. La clave la manda la pantalla, no el motor.
    const a = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const b = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    expect(b.id).not.toBe(a.id)
  })

  it('rechaza la falla declarada vacía', async () => {
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, fallaDeclarada: '  ' }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('rechaza marca o modelo vacíos', async () => {
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, equipoMarca: '' }),
    ).rejects.toThrow(ErrorDeOrden)
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, equipoModelo: '' }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('rechaza un cliente de otro tenant', async () => {
    // Las FKs de Postgres no distinguen tenants: el chequeo es nuestro.
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId: clienteAjeno, ...equipo }),
    ).rejects.toThrow()
  })
})
