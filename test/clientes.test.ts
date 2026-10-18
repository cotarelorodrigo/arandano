import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'
import { Prisma } from '@/generated/prisma/client'
import { ErrorDeCliente } from '@/lib/clientes/errores'
import { claveDeTelefono } from '@/lib/clientes/telefono'
import { formatearPrecio } from '@/lib/formato/mostrar'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
let crearCliente: typeof import('@/lib/clientes/administrar').crearCliente
let buscarClientes: typeof import('@/lib/clientes/administrar').buscarClientes
let crearOrden: typeof import('@/lib/ordenes-de-trabajo/crear').crearOrden
let editarCliente: typeof import('@/lib/clientes/administrar').editarCliente
let borrarCliente: typeof import('@/lib/clientes/administrar').borrarCliente
let clientesDelListado: typeof import('@/lib/clientes/consultar').clientesDelListado
let fichaDeCliente: typeof import('@/lib/clientes/consultar').fichaDeCliente
let crearVenta: typeof import('@/lib/ventas/crear').crearVenta
let anularVenta: typeof import('@/lib/ventas/anular').anularVenta
let cambiarClienteDeVenta: typeof import('@/lib/ventas/cliente').cambiarClienteDeVenta

let owner: Client
let tenantId: string
let otroTenantId: string
let usuarioId: string
let otroUsuarioId: string
// Un servicio (sin stock: siempre se puede vender), uno en cada local.
let servicio: string
let servicioDelOtro: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ crearCliente, buscarClientes } = await import('@/lib/clientes/administrar'))
  ;({ crearOrden } = await import('@/lib/ordenes-de-trabajo/crear'))
  ;({ editarCliente, borrarCliente } = await import('@/lib/clientes/administrar'))
  ;({ clientesDelListado, fichaDeCliente } = await import('@/lib/clientes/consultar'))
  ;({ crearVenta } = await import('@/lib/ventas/crear'))
  ;({ anularVenta } = await import('@/lib/ventas/anular'))
  ;({ cambiarClienteDeVenta } = await import('@/lib/ventas/cliente'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `clientes-${Date.now()}`)
  otroTenantId = await crearTenant(owner, `clientes-otro-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, `tecnico-clientes-${Date.now()}@ot.test`)
  otroUsuarioId = await crearUsuario(owner, otroTenantId, `otro-clientes-${Date.now()}@ot.test`)
  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'SRV-CLI', 'Cambio de pantalla', 'SERVICIO', 1000.00, 0, now(), now()),
            (gen_random_uuid(), $2, 'SRV-CLI', 'Servicio del otro', 'SERVICIO', 1000.00, 0, now(), now())
     RETURNING id, tenant_id, tipo`,
    [tenantId, otroTenantId],
  )
  type Fila = { id: string; tenant_id: string; tipo: string }
  servicio = a.rows.find((r: Fila) => r.tenant_id === tenantId).id
  servicioDelOtro = a.rows.find((r: Fila) => r.tenant_id === otroTenantId).id
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

// ---------------------------------------------------------------------------
// La solapa Clientes (spec 2026-10-18-clientes-design.md).
// ---------------------------------------------------------------------------

/** Un teléfono único por caso: el chequeo de repetidos es por tenant, y los
 *  casos comparten tenant. Diez dígitos que empiezan en 11. */
let secuencia = 0
function telefonoNuevo(): string {
  secuencia += 1
  return `11${String(Date.now() % 1e4).padStart(4, '0')}${String(secuencia).padStart(4, '0')}`
}
/** El mismo número, tipeado como lo dicta un cliente que agrega el país. */
function enOtroFormato(diez: string): string {
  return `+54 9 ${diez.slice(0, 2)} ${diez.slice(2, 6)}-${diez.slice(6)}`
}

const d = (v: string) => new Prisma.Decimal(v)
const pagoDe = (monto: string) => [
  { medio: 'EFECTIVO' as const, moneda: 'ARS' as const, base: d(monto), cotizacion: d('1') },
]

async function filaDe(id: string) {
  const { rows } = await owner.query(
    `SELECT nombre, telefono, telefono_clave, email, notas, acepta_ofertas FROM clientes WHERE id = $1`,
    [id],
  )
  return rows[0]
}

async function cuantosConClave(t: string, clave: string): Promise<number> {
  const { rows } = await owner.query(
    `SELECT count(*)::int AS n FROM clientes WHERE tenant_id = $1 AND telefono_clave = $2`,
    [t, clave],
  )
  return rows[0].n
}

describe('la clave del teléfono', () => {
  it('el alta la guarda con los últimos 10 dígitos, y el teléfono tal cual', async () => {
    const tel = telefonoNuevo()
    const c = await crearCliente({ tenantId, nombre: 'Con clave', telefono: enOtroFormato(tel) })
    const fila = await filaDe(c.id)
    expect(fila.telefono).toBe(enOtroFormato(tel))
    expect(fila.telefono_clave).toBe(tel)
  })

  it('con menos de 10 dígitos guarda el teléfono pero no la clave', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Sin código de área', telefono: '4455-6677' })
    const fila = await filaDe(c.id)
    expect(fila.telefono).toBe('4455-6677')
    expect(fila.telefono_clave).toBeNull()
  })

  // La migración rellenó las filas viejas con SQL; la aplicación escribe las
  // nuevas con TypeScript. Si las dos reglas difieren, un cliente viejo y uno
  // nuevo con el mismo número no chocarían. Se corre la expresión EXACTA de la
  // migración contra la base.
  it('la regla SQL del relleno da lo mismo que claveDeTelefono', async () => {
    for (const t of ['11 2233-4455', '+54 9 11 2233 4455', '5491122334455', '4455-6677', '', 'sin número']) {
      const { rows } = await owner.query(
        `SELECT CASE WHEN length(regexp_replace($1::text, '\\D', '', 'g')) >= 10
                     THEN right(regexp_replace($1::text, '\\D', '', 'g'), 10) END AS clave`,
        [t],
      )
      expect(rows[0].clave, t).toBe(claveDeTelefono(t))
    }
  })

  it('un cliente nuevo no acepta ofertas si nadie lo marcó', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Sin consentimiento', telefono: null })
    expect((await filaDe(c.id)).acepta_ofertas).toBe(false)
  })
})

describe('teléfonos repetidos', () => {
  it('el alta rechaza un teléfono que ya tiene otro cliente, en otro formato también, y lo nombra', async () => {
    const tel = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Rosa Primera', telefono: tel })
    const intento = crearCliente({ tenantId, nombre: 'Rosa Segunda', telefono: enOtroFormato(tel) })
    await expect(intento).rejects.toMatchObject({ codigo: 'TELEFONO_REPETIDO' })
    await expect(intento).rejects.toThrow(/Rosa Primera/)
    expect(await cuantosConClave(tenantId, tel)).toBe(1)
  })

  it('el mismo teléfono en OTRO local se acepta', async () => {
    const tel = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Acá', telefono: tel })
    await expect(
      crearCliente({ tenantId: otroTenantId, nombre: 'Allá', telefono: tel }),
    ).resolves.toMatchObject({ nombre: 'Allá' })
  })

  it('teléfonos de menos de 10 dígitos no chocan entre sí', async () => {
    await crearCliente({ tenantId, nombre: 'Corto uno', telefono: '4455-1234' })
    await expect(
      crearCliente({ tenantId, nombre: 'Corto dos', telefono: '4455-1234' }),
    ).resolves.toBeTruthy()
  })

  it('la edición rechaza el teléfono de otro cliente', async () => {
    const tel = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Dueña del número', telefono: tel })
    const otro = await crearCliente({ tenantId, nombre: 'Otro', telefono: null })
    await expect(
      editarCliente({
        tenantId, clienteId: otro.id, nombre: 'Otro', telefono: enOtroFormato(tel),
        email: null, notas: null, aceptaOfertas: false,
      }),
    ).rejects.toMatchObject({ codigo: 'TELEFONO_REPETIDO' })
    expect((await filaDe(otro.id)).telefono).toBeNull()
  })

  it('editar sin cambiar el propio teléfono no choca consigo mismo, y guarda el resto', async () => {
    const tel = telefonoNuevo()
    const c = await crearCliente({ tenantId, nombre: 'Marta', telefono: tel })
    await editarCliente({
      tenantId, clienteId: c.id, nombre: 'Marta Ríos', telefono: tel,
      email: 'marta@ejemplo.test', notas: 'Prefiere WhatsApp', aceptaOfertas: true,
    })
    expect(await filaDe(c.id)).toMatchObject({
      nombre: 'Marta Ríos', telefono_clave: tel, email: 'marta@ejemplo.test',
      notas: 'Prefiere WhatsApp', acepta_ofertas: true,
    })
  })

  it('editar recalcula la clave, y vaciar el teléfono la borra', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Cambia de número', telefono: telefonoNuevo() })
    const nuevo = telefonoNuevo()
    const base = { tenantId, clienteId: c.id, nombre: 'Cambia de número', email: null, notas: null, aceptaOfertas: false }
    await editarCliente({ ...base, telefono: enOtroFormato(nuevo) })
    expect((await filaDe(c.id)).telefono_clave).toBe(nuevo)
    await editarCliente({ ...base, telefono: '  ' })
    expect(await filaDe(c.id)).toMatchObject({ telefono: null, telefono_clave: null })
  })

  it('editar un cliente de otro local es "no existe"', async () => {
    const ajeno = await crearCliente({ tenantId: otroTenantId, nombre: 'Ajeno', telefono: null })
    await expect(
      editarCliente({
        tenantId, clienteId: ajeno.id, nombre: 'Pisado', telefono: null,
        email: null, notas: null, aceptaOfertas: false,
      }),
    ).rejects.toMatchObject({ codigo: 'CLIENTE_INEXISTENTE' })
    expect((await filaDe(ajeno.id)).nombre).toBe('Ajeno')
  })

  it('un email sin forma de email se rechaza', async () => {
    await expect(
      crearCliente({ tenantId, nombre: 'Mal mail', telefono: null, email: '1122334455' }),
    ).rejects.toMatchObject({ codigo: 'EMAIL_INVALIDO' })
  })

  // Las dos altas simultáneas del mismo número: sin el lock por clave, las dos
  // miran la tabla antes de que la otra comitee y entran las dos.
  it('dos altas simultáneas del mismo número: entra una sola', async () => {
    const tel = telefonoNuevo()
    const resultados = await Promise.allSettled([
      crearCliente({ tenantId, nombre: 'Carrera A', telefono: tel }),
      crearCliente({ tenantId, nombre: 'Carrera B', telefono: enOtroFormato(tel) }),
    ])
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await cuantosConClave(tenantId, tel)).toBe(1)
  })

  it('el alta de una orden con un cliente nuevo de teléfono repetido se rechaza con el mensaje, sin orden', async () => {
    const tel = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Cliente de siempre', telefono: tel })
    const { rows: antes } = await owner.query(
      `SELECT count(*)::int AS n FROM ordenes_de_trabajo WHERE tenant_id = $1`, [tenantId],
    )
    const intento = crearOrden({
      tenantId, usuarioId,
      clienteNuevo: { nombre: 'Cliente de siempre (otra vez)', telefono: enOtroFormato(tel) },
      equipoMarca: 'Motorola', equipoModelo: 'G54', fallaDeclarada: 'no prende',
    })
    await expect(intento).rejects.toMatchObject({ codigo: 'TELEFONO_REPETIDO' })
    await expect(intento).rejects.toThrow(/Cliente de siempre.*elegila/)
    const { rows: despues } = await owner.query(
      `SELECT count(*)::int AS n FROM ordenes_de_trabajo WHERE tenant_id = $1`, [tenantId],
    )
    expect(despues[0].n).toBe(antes[0].n)
    expect(await cuantosConClave(tenantId, tel)).toBe(1)
  })
})

describe('búsqueda extendida', () => {
  it('encuentra por email, sin importar mayúsculas', async () => {
    await crearCliente({ tenantId, nombre: 'Por mail', telefono: null, email: 'unico.busqueda@ejemplo.test' })
    const r = await buscarClientes(tenantId, 'UNICO.BUSQUEDA')
    expect(r.map((c) => c.nombre)).toEqual(['Por mail'])
  })

  it('encuentra por teléfono tipeado en otro formato', async () => {
    const tel = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Guardado con guiones', telefono: `${tel.slice(0, 2)} ${tel.slice(2, 6)}-${tel.slice(6)}` })
    expect((await buscarClientes(tenantId, tel)).map((c) => c.nombre)).toEqual(['Guardado con guiones'])
    expect((await buscarClientes(tenantId, enOtroFormato(tel))).map((c) => c.nombre)).toEqual([
      'Guardado con guiones',
    ])
  })
})

describe('el listado de /clientes', () => {
  let t: string
  beforeAll(async () => {
    t = await crearTenant(owner, `clientes-listado-${Date.now()}`)
    await crearCliente({ tenantId: t, nombre: 'Bruno Acepta', telefono: null, aceptaOfertas: true })
    await crearCliente({ tenantId: t, nombre: 'Ana No Acepta', telefono: null })
    await crearCliente({ tenantId: t, nombre: 'Carla Acepta', telefono: null, aceptaOfertas: true, email: 'carla@x.test' })
  })

  it('sin filtro trae todos, por nombre', async () => {
    const r = await clientesDelListado(t, { texto: '', soloAceptanOfertas: false })
    expect(r.clientes.map((c) => c.nombre)).toEqual(['Ana No Acepta', 'Bruno Acepta', 'Carla Acepta'])
    expect(r.total).toBe(3)
  })

  it('el filtro "aceptan ofertas" deja sólo a los que aceptaron', async () => {
    const r = await clientesDelListado(t, { texto: '', soloAceptanOfertas: true })
    expect(r.clientes.map((c) => c.nombre)).toEqual(['Bruno Acepta', 'Carla Acepta'])
  })

  it('el filtro y la búsqueda se combinan', async () => {
    const r = await clientesDelListado(t, { texto: 'carla@', soloAceptanOfertas: true })
    expect(r.clientes.map((c) => c.nombre)).toEqual(['Carla Acepta'])
  })

  it('con tope, el total sigue contando a todos', async () => {
    const r = await clientesDelListado(t, { texto: '', soloAceptanOfertas: false }, 2)
    expect(r.clientes).toHaveLength(2)
    expect(r.total).toBe(3)
  })
})

describe('venta con cliente nuevo', () => {
  it('crea el cliente en la misma transacción y la venta queda apuntándolo', async () => {
    const tel = telefonoNuevo()
    const v = await crearVenta({
      tenantId, usuarioId,
      clienteNuevo: { nombre: 'Comprador al vuelo', telefono: tel, aceptaOfertas: true },
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: pagoDe('1000'),
    })
    const { rows } = await owner.query(
      `SELECT c.nombre, c.acepta_ofertas, c.telefono_clave FROM ventas v JOIN clientes c ON c.id = v.cliente_id WHERE v.id = $1`,
      [v.id],
    )
    expect(rows[0]).toEqual({ nombre: 'Comprador al vuelo', acepta_ofertas: true, telefono_clave: tel })
  })

  it('si la venta falla, el cliente no queda', async () => {
    const tel = telefonoNuevo()
    await expect(
      crearVenta({
        tenantId, usuarioId,
        clienteNuevo: { nombre: 'No debería quedar', telefono: tel, aceptaOfertas: false },
        // Los pagos no cubren el total: el motor lo rechaza DESPUÉS de haber
        // creado el cliente (los pagos se resuelven más abajo en la misma
        // transacción).
        items: [{ articuloId: servicio, cantidad: d('1') }],
        pagos: pagoDe('500'),
      }),
    ).rejects.toMatchObject({ codigo: 'PAGOS_NO_CIERRAN' })
    expect(await cuantosConClave(tenantId, tel)).toBe(0)
  })

  it('con un teléfono repetido no quedan ni la venta ni un segundo cliente', async () => {
    const tel = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Ya estaba', telefono: tel })
    const { rows: antes } = await owner.query(`SELECT count(*)::int AS n FROM ventas WHERE tenant_id = $1`, [tenantId])
    await expect(
      crearVenta({
        tenantId, usuarioId,
        clienteNuevo: { nombre: 'Ya estaba (bis)', telefono: enOtroFormato(tel), aceptaOfertas: false },
        items: [{ articuloId: servicio, cantidad: d('1') }],
        pagos: pagoDe('1000'),
      }),
    ).rejects.toMatchObject({ codigo: 'TELEFONO_REPETIDO' })
    const { rows: despues } = await owner.query(`SELECT count(*)::int AS n FROM ventas WHERE tenant_id = $1`, [tenantId])
    expect(despues[0].n).toBe(antes[0].n)
    expect(await cuantosConClave(tenantId, tel)).toBe(1)
  })

  // El doble click: la segunda llamada con la misma clave devuelve la venta de
  // la primera SIN crear otro cliente.
  it('la misma clave de idempotencia no crea un segundo cliente', async () => {
    const tel = telefonoNuevo()
    const entrada = {
      tenantId, usuarioId,
      clienteNuevo: { nombre: 'Doble click', telefono: tel, aceptaOfertas: false },
      items: [{ articuloId: servicio, cantidad: d('1') }],
      pagos: pagoDe('1000'),
      claveIdempotencia: `clientes-${tel}`,
    }
    const a = await crearVenta(entrada)
    const b = await crearVenta(entrada)
    expect(b.id).toBe(a.id)
    expect(await cuantosConClave(tenantId, tel)).toBe(1)
  })

  it('clienteId y clienteNuevo juntos se rechazan', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Elegido', telefono: null })
    await expect(
      crearVenta({
        tenantId, usuarioId, clienteId: c.id,
        clienteNuevo: { nombre: 'Y otro', telefono: null, aceptaOfertas: false },
        items: [{ articuloId: servicio, cantidad: d('1') }],
        pagos: pagoDe('1000'),
      }),
    ).rejects.toMatchObject({ codigo: 'CLIENTE_DOBLE' })
  })
})

describe('asignar, cambiar y quitar el cliente de una venta cobrada', () => {
  async function estadoDeLaVenta(id: string) {
    const { rows } = await owner.query(
      `SELECT cliente_id, total::text, total_usd::text, recargo::text,
              (SELECT json_agg(json_build_object('medio', medio, 'monto', monto::text) ORDER BY id) FROM pagos WHERE venta_id = v.id) AS pagos
         FROM ventas v WHERE id = $1`,
      [id],
    )
    return rows[0]
  }

  it('asigna, cambia y quita sin tocar totales ni pagos', async () => {
    const v = await crearVenta({
      tenantId, usuarioId, items: [{ articuloId: servicio, cantidad: d('1') }], pagos: pagoDe('1000'),
    })
    const antes = await estadoDeLaVenta(v.id)
    expect(antes.cliente_id).toBeNull()
    const sinCliente = { ...antes, cliente_id: undefined }

    const a = await crearCliente({ tenantId, nombre: 'Primero', telefono: null })
    await cambiarClienteDeVenta({ tenantId, ventaId: v.id, cliente: { tipo: 'existente', id: a.id } })
    const conA = await estadoDeLaVenta(v.id)
    expect(conA.cliente_id).toBe(a.id)
    expect({ ...conA, cliente_id: undefined }).toEqual(sinCliente)

    const tel = telefonoNuevo()
    await cambiarClienteDeVenta({
      tenantId, ventaId: v.id, cliente: { tipo: 'nuevo', nombre: 'Segundo', telefono: tel, aceptaOfertas: true },
    })
    const conB = await estadoDeLaVenta(v.id)
    expect(conB.cliente_id).not.toBe(a.id)
    expect((await filaDe(conB.cliente_id)).telefono_clave).toBe(tel)

    await cambiarClienteDeVenta({ tenantId, ventaId: v.id, cliente: null })
    expect(await estadoDeLaVenta(v.id)).toEqual(antes)
  })

  it('no asigna un cliente de otro local', async () => {
    const v = await crearVenta({
      tenantId, usuarioId, items: [{ articuloId: servicio, cantidad: d('1') }], pagos: pagoDe('1000'),
    })
    const ajeno = await crearCliente({ tenantId: otroTenantId, nombre: 'De otro local', telefono: null })
    await expect(
      cambiarClienteDeVenta({ tenantId, ventaId: v.id, cliente: { tipo: 'existente', id: ajeno.id } }),
    ).rejects.toMatchObject({ codigo: 'CLIENTE_INEXISTENTE' })
    expect((await estadoDeLaVenta(v.id)).cliente_id).toBeNull()
  })

  it('una venta de otro local es "no existe", y el cliente nuevo no queda', async () => {
    const ajena = await crearVenta({
      tenantId: otroTenantId, usuarioId: otroUsuarioId,
      items: [{ articuloId: servicioDelOtro, cantidad: d('1') }], pagos: pagoDe('1000'),
    })
    const tel = telefonoNuevo()
    await expect(
      cambiarClienteDeVenta({
        tenantId, ventaId: ajena.id, cliente: { tipo: 'nuevo', nombre: 'Huérfano', telefono: tel, aceptaOfertas: false },
      }),
    ).rejects.toMatchObject({ codigo: 'VENTA_INEXISTENTE' })
    expect(await cuantosConClave(tenantId, tel)).toBe(0)
  })
})

describe('borrar un cliente', () => {
  it('sin historia se borra', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Cargado por error', telefono: null })
    await borrarCliente({ tenantId, clienteId: c.id })
    expect(await filaDe(c.id)).toBeUndefined()
  })

  it('con una venta (aunque esté anulada) se rechaza y dice cuántas', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Compró una vez', telefono: null })
    const v = await crearVenta({
      tenantId, usuarioId, clienteId: c.id,
      items: [{ articuloId: servicio, cantidad: d('1') }], pagos: pagoDe('1000'),
    })
    await anularVenta({ tenantId, ventaId: v.id, usuarioId })
    const intento = borrarCliente({ tenantId, clienteId: c.id })
    await expect(intento).rejects.toMatchObject({ codigo: 'CLIENTE_CON_HISTORIA' })
    await expect(intento).rejects.toThrow('Tiene 1 compra: no se puede borrar.')
    expect(await filaDe(c.id)).toBeTruthy()
  })

  it('con una orden de trabajo se rechaza', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Dejó un equipo', telefono: null })
    await crearOrden({
      tenantId, usuarioId, clienteId: c.id, equipoMarca: 'Apple', equipoModelo: 'iPhone 12', fallaDeclarada: 'pantalla',
    })
    await expect(borrarCliente({ tenantId, clienteId: c.id })).rejects.toThrow('Tiene 1 orden: no se puede borrar.')
  })

  it('uno de otro local es "no existe"', async () => {
    const ajeno = await crearCliente({ tenantId: otroTenantId, nombre: 'No se toca', telefono: null })
    await expect(borrarCliente({ tenantId, clienteId: ajeno.id })).rejects.toMatchObject({
      codigo: 'CLIENTE_INEXISTENTE',
    })
    expect(await filaDe(ajeno.id)).toBeTruthy()
  })
})

describe('la ficha del cliente', () => {
  it('lista sus ventas, con la anulada marcada, y no las de otro cliente', async () => {
    const yo = await crearCliente({ tenantId, nombre: 'Ficha propia', telefono: null })
    const otro = await crearCliente({ tenantId, nombre: 'Ficha ajena', telefono: null })
    const venta = (clienteId: string) =>
      crearVenta({ tenantId, usuarioId, clienteId, items: [{ articuloId: servicio, cantidad: d('1') }], pagos: pagoDe('1000') })
    const mia1 = await venta(yo.id)
    const mia2 = await venta(yo.id)
    const ajena = await venta(otro.id)
    await anularVenta({ tenantId, ventaId: mia1.id, usuarioId })
    await crearOrden({
      tenantId, usuarioId, clienteId: yo.id, equipoMarca: 'Samsung', equipoModelo: 'A15', fallaDeclarada: 'batería',
    })

    const ficha = await fichaDeCliente(tenantId, yo.id)
    expect(ficha).not.toBeNull()
    expect(ficha!.compras.map((c) => c.id).sort()).toEqual([mia1.id, mia2.id].sort())
    expect(ficha!.compras.map((c) => c.id)).not.toContain(ajena.id)
    expect(ficha!.compras.find((c) => c.id === mia1.id)!.anulada).toBe(true)
    expect(ficha!.compras.find((c) => c.id === mia2.id)).toMatchObject({ anulada: false, totalFormateado: formatearPrecio('1000') })
    expect(ficha!.ordenes.map((o) => o.equipo)).toEqual(['Samsung A15'])
    expect(ficha!.historia).toEqual({ ventas: 2, ordenes: 1 })
  })

  it('el listado cuenta compras sin las anuladas, con la fecha de la última', async () => {
    const t = await crearTenant(owner, `clientes-compras-${Date.now()}`)
    const u = await crearUsuario(owner, t, `cajera-${Date.now()}@x.test`)
    const { rows } = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'S', 'Servicio', 'SERVICIO', 10.00, 0, now(), now()) RETURNING id`,
      [t],
    )
    const c = await crearCliente({ tenantId: t, nombre: 'Cuenta compras', telefono: null })
    const venta = () =>
      crearVenta({ tenantId: t, usuarioId: u, clienteId: c.id, items: [{ articuloId: rows[0].id, cantidad: d('1') }], pagos: pagoDe('10') })
    await venta()
    const anulada = await venta()
    await anularVenta({ tenantId: t, ventaId: anulada.id, usuarioId: u })
    const [fila] = (await clientesDelListado(t, { texto: '', soloAceptanOfertas: false })).clientes
    expect(fila.compras).toBe(1)
    expect(fila.ultimaCompra).toBeInstanceOf(Date)
  })

  it('un cliente de otro local no tiene ficha', async () => {
    const ajeno = await crearCliente({ tenantId: otroTenantId, nombre: 'Sin ficha acá', telefono: null })
    expect(await fichaDeCliente(tenantId, ajeno.id)).toBeNull()
  })
})

// Review del ciclo: los repetidos de antes del chequeo (la recepción creaba
// clientes sin mirar) no pueden quedar congelados. Editar notas u ofertas de
// cualquiera de los dos tiene que andar; mudarse a OTRO número tomado, no.
describe('repetidos heredados', () => {
  it('se pueden editar sin cambiar el teléfono, y no pasarse a otro número tomado', async () => {
    const tel = telefonoNuevo()
    const { rows } = await owner.query(
      `INSERT INTO clientes (id, tenant_id, nombre, telefono, telefono_clave, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Viejo A', $2, $2, now(), now()),
              (gen_random_uuid(), $1, 'Viejo B', $3, $2, now(), now())
       RETURNING id`,
      [tenantId, tel, enOtroFormato(tel)],
    )
    for (const [i, r] of rows.entries()) {
      await editarCliente({
        tenantId, clienteId: r.id, nombre: `Viejo ${i}`, telefono: i === 0 ? tel : enOtroFormato(tel),
        email: null, notas: 'Prefiere la tarde', aceptaOfertas: true,
      })
      expect(await filaDe(r.id)).toMatchObject({ notas: 'Prefiere la tarde', acepta_ofertas: true })
    }
    const tomado = telefonoNuevo()
    await crearCliente({ tenantId, nombre: 'Dueño de otro número', telefono: tomado })
    await expect(
      editarCliente({
        tenantId, clienteId: rows[0].id, nombre: 'Viejo 0', telefono: tomado,
        email: null, notas: null, aceptaOfertas: false,
      }),
    ).rejects.toMatchObject({ codigo: 'TELEFONO_REPETIDO' })
  })
})
