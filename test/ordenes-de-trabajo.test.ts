import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeOrden } from '@/lib/ordenes-de-trabajo/errores'

let crearOrden: typeof import('@/lib/ordenes-de-trabajo/crear').crearOrden
let crearCliente: typeof import('@/lib/clientes/administrar').crearCliente
let cambiarEstado: typeof import('@/lib/ordenes-de-trabajo/operaciones').cambiarEstado
let guardarDiagnostico: typeof import('@/lib/ordenes-de-trabajo/operaciones').guardarDiagnostico
let anularOrden: typeof import('@/lib/ordenes-de-trabajo/operaciones').anularOrden

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
  ;({ cambiarEstado, guardarDiagnostico, anularOrden } = await import(
    '@/lib/ordenes-de-trabajo/operaciones'
  ))

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

  it('el cliente nuevo nace con la orden, y el submit repetido no crea un segundo', async () => {
    // El escenario que la clave de idempotencia nombra —doble click, F5 sobre
    // el POST, reintento de red— protegía la orden y no al cliente: el alta del
    // cliente se comiteaba antes, en su propia transacción, así que el segundo
    // submit creaba otro "Juan Pérez" y recién después devolvía la orden que ya
    // existía. Un equipo, una orden, y dos clientes que nadie puede fusionar
    // porque /clientes todavía no existe.
    const clave = `cliente-nuevo-${Date.now()}`
    const nombre = `Repetido ${Date.now()}`
    const a = await crearOrden({
      tenantId,
      usuarioId,
      clienteNuevo: { nombre, telefono: '1177889900' },
      ...equipo,
      claveIdempotencia: clave,
    })
    const b = await crearOrden({
      tenantId,
      usuarioId,
      clienteNuevo: { nombre, telefono: '1177889900' },
      ...equipo,
      claveIdempotencia: clave,
    })

    expect(b.id).toBe(a.id)
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM clientes WHERE tenant_id = $1 AND nombre = $2`,
      [tenantId, nombre],
    )
    expect(rows[0].n).toBe(1)
    // Y la orden quedó colgada de ESE cliente, no de ninguno: sin esta mitad,
    // un alta que no creara ningún cliente daría el mismo 1 si el nombre no
    // existiera.
    const orden = await owner.query(
      `SELECT c.nombre FROM ordenes_de_trabajo o JOIN clientes c ON c.id = o.cliente_id
        WHERE o.id = $1`,
      [a.id],
    )
    expect(orden.rows[0].nombre).toBe(nombre)
  })

  it('una orden que falla no deja al cliente nuevo suelto', async () => {
    // La otra mitad del mismo cambio: con el cliente comiteado aparte, toda
    // falla posterior al alta dejaba un Cliente huérfano en la tabla. Adentro
    // de la transacción de la orden, se va con ella.
    const nombre = `Huérfano ${Date.now()}`
    await expect(
      crearOrden({
        tenantId,
        // Un usuario que no existe en este tenant: falla DESPUÉS de crear al
        // cliente, que es exactamente el hueco.
        usuarioId: '00000000-0000-0000-0000-000000000000',
        clienteNuevo: { nombre, telefono: null },
        ...equipo,
      }),
    ).rejects.toThrow()
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM clientes WHERE tenant_id = $1 AND nombre = $2`,
      [tenantId, nombre],
    )
    expect(rows[0].n).toBe(0)
  })

  it('rechaza el alta sin cliente elegido ni cliente nuevo', async () => {
    await expect(crearOrden({ tenantId, usuarioId, ...equipo })).rejects.toThrow(ErrorDeOrden)
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

async function estadoDe(ordenId: string): Promise<string> {
  const { rows } = await owner.query(`SELECT estado FROM ordenes_de_trabajo WHERE id = $1`, [
    ordenId,
  ])
  return rows[0].estado
}

describe('cambiar de estado', () => {
  it('avanza y deja su línea en la bitácora', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta: 'EN_DIAGNOSTICO' })

    expect(await estadoDe(o.id)).toBe('EN_DIAGNOSTICO')
    const { rows } = await owner.query(
      `SELECT desde, hasta, nota FROM eventos_orden WHERE orden_id = $1 ORDER BY creado_en`,
      [o.id],
    )
    expect(rows).toHaveLength(2)
    expect(rows[1].desde).toBe('RECIBIDO')
    expect(rows[1].hasta).toBe('EN_DIAGNOSTICO')
  })

  it('guarda la nota del cambio', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await cambiarEstado({
      tenantId,
      usuarioId,
      ordenId: o.id,
      hasta: 'EN_DIAGNOSTICO',
      nota: 'el cliente lo dejó a las 10',
    })
    const { rows } = await owner.query(
      `SELECT nota FROM eventos_orden WHERE orden_id = $1 ORDER BY creado_en DESC LIMIT 1`,
      [o.id],
    )
    expect(rows[0].nota).toBe('el cliente lo dejó a las 10')
  })

  it('rechaza el salto que el grafo no permite, y no toca la orden', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await expect(
      cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta: 'ENTREGADO' }),
    ).rejects.toThrow(ErrorDeOrden)
    // Lo que importa no es el throw: es que la orden siga como estaba.
    expect(await estadoDe(o.id)).toBe('RECIBIDO')
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM eventos_orden WHERE orden_id = $1`,
      [o.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('deja volver un equipo entregado a reparación: es la garantía', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    for (const hasta of ['EN_REPARACION', 'LISTO', 'ENTREGADO', 'EN_REPARACION'] as const) {
      await cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta })
    }
    expect(await estadoDe(o.id)).toBe('EN_REPARACION')
  })

  it('una orden anulada no cambia más de estado', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await anularOrden({ tenantId, usuarioId, ordenId: o.id })
    await expect(
      cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta: 'EN_DIAGNOSTICO' }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('un ordenId que no tiene forma de uuid es ORDEN_INEXISTENTE, no un 500', async () => {
    // El campo escondido del formulario se puede reescribir. Sin el guard,
    // Prisma rechaza el valor por el tipo de la columna ANTES de consultar, con
    // un error crudo que `traducir` relanza como 500 en vez de mostrarlo como
    // el error de dominio que corresponde.
    for (const basura of ['foo', '', '1 OR 1=1', '../../etc/passwd']) {
      await expect(
        cambiarEstado({ tenantId, usuarioId, ordenId: basura, hasta: 'EN_DIAGNOSTICO' }),
      ).rejects.toThrow(ErrorDeOrden)
    }
    // Y las otras dos operaciones entran por el mismo traerAbierta.
    await expect(anularOrden({ tenantId, usuarioId, ordenId: 'foo' })).rejects.toThrow(ErrorDeOrden)
    await expect(
      guardarDiagnostico({
        tenantId,
        usuarioId,
        ordenId: 'foo',
        diagnostico: 'x',
        montoEstimado: null,
      }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('no toca una orden de otro tenant', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    // Con el tenant equivocado, RLS no deja ver la fila: es indistinguible de
    // que no exista, y ésa es la respuesta honesta.
    await expect(
      cambiarEstado({
        tenantId: otroTenantId,
        usuarioId,
        ordenId: o.id,
        hasta: 'EN_DIAGNOSTICO',
      }),
    ).rejects.toThrow(ErrorDeOrden)
    expect(await estadoDe(o.id)).toBe('RECIBIDO')
  })
})

describe('diagnóstico y presupuesto', () => {
  it('guarda el diagnóstico y el monto', async () => {
    const { Prisma } = await import('@/generated/prisma/client')
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await guardarDiagnostico({
      tenantId,
      usuarioId,
      ordenId: o.id,
      diagnostico: 'pin de carga suelto',
      montoEstimado: new Prisma.Decimal('35000.00'),
    })
    const { rows } = await owner.query(
      `SELECT diagnostico, monto_estimado FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    expect(rows[0].diagnostico).toBe('pin de carga suelto')
    expect(String(rows[0].monto_estimado)).toBe('35000.00')
  })

  it('NO cambia el estado: cargar el diagnóstico no es una transición', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await guardarDiagnostico({
      tenantId,
      usuarioId,
      ordenId: o.id,
      diagnostico: 'pantalla rota',
      montoEstimado: null,
    })
    expect(await estadoDe(o.id)).toBe('RECIBIDO')
  })

  it('rechaza un monto negativo', async () => {
    const { Prisma } = await import('@/generated/prisma/client')
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await expect(
      guardarDiagnostico({
        tenantId,
        usuarioId,
        ordenId: o.id,
        diagnostico: 'x',
        montoEstimado: new Prisma.Decimal('-1'),
      }),
    ).rejects.toThrow(ErrorDeOrden)
  })
})

describe('anulación', () => {
  it('marca quién y cuándo, y no deja evento', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const antes = await owner.query(
      `SELECT count(*)::int AS n FROM eventos_orden WHERE orden_id = $1`,
      [o.id],
    )
    await anularOrden({ tenantId, usuarioId, ordenId: o.id })

    const { rows } = await owner.query(
      `SELECT anulada_en, anulada_por_id, estado FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    expect(rows[0].anulada_en).not.toBeNull()
    expect(rows[0].anulada_por_id).toBe(usuarioId)
    // El estado NO se pisa: anular es una columna, no un estado.
    expect(rows[0].estado).toBe('RECIBIDO')

    // Sin evento: EventoOrden registra transiciones, y anular no lo es.
    const despues = await owner.query(
      `SELECT count(*)::int AS n FROM eventos_orden WHERE orden_id = $1`,
      [o.id],
    )
    expect(despues.rows[0].n).toBe(antes.rows[0].n)
  })

  it('anular dos veces no cambia quién la anuló', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await anularOrden({ tenantId, usuarioId, ordenId: o.id })
    const primera = await owner.query(
      `SELECT anulada_en FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    await expect(anularOrden({ tenantId, usuarioId, ordenId: o.id })).rejects.toThrow(ErrorDeOrden)
    const segunda = await owner.query(
      `SELECT anulada_en FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    expect(String(segunda.rows[0].anulada_en)).toBe(String(primera.rows[0].anulada_en))
  })
})
