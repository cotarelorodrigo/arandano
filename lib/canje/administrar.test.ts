import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantId: string
let otroTenantId: string
let canje: typeof import('@/lib/canje/administrar')
let tablaDeCanje: typeof import('@/lib/canje/consultar').tablaDeCanje

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `canje-a-${Date.now()}`)
  otroTenantId = await crearTenant(owner, `canje-b-${Date.now()}`)

  // El pool de lib/db.ts se arma al importar, leyendo DATABASE_URL: hay que
  // fijarla ANTES del import. Mismo motivo que lib/planes/administrar.test.ts.
  process.env.DATABASE_URL = urlApp()
  canje = await import('@/lib/canje/administrar')
  ;({ tablaDeCanje } = await import('@/lib/canje/consultar'))
})

afterAll(async () => {
  await owner.end()
})

/** Cada caso arranca con la tabla del tenant A vacía: los rangos se validan
 *  contra TODOS los del tenant, así que un rango que dejó el caso anterior
 *  haría fallar al siguiente por un motivo que no es el suyo. Se borra como
 *  owner, que no pasa por RLS. */
beforeEach(async () => {
  for (const t of ['valores_de_canje', 'modelos_de_canje', 'rangos_de_bateria', 'configuraciones_de_canje']) {
    await owner.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId])
  }
})

const D = (v: string) => new Prisma.Decimal(v)

describe('rangos de batería', () => {
  it('crea un rango y la tabla lo devuelve', async () => {
    await canje.crearRango({ tenantId, minimo: 90, maximo: 99 })
    const tabla = await tablaDeCanje(tenantId)
    expect(tabla.rangos.map((r) => [r.minimo, r.maximo])).toEqual([[90, 99]])
  })

  it('la tabla los ordena de mayor a menor batería, cargados en cualquier orden', async () => {
    await canje.crearRango({ tenantId, minimo: 0, maximo: 79 })
    await canje.crearRango({ tenantId, minimo: 100, maximo: 100 })
    await canje.crearRango({ tenantId, minimo: 80, maximo: 99 })
    const tabla = await tablaDeCanje(tenantId)
    expect(tabla.rangos.map((r) => r.minimo)).toEqual([100, 80, 0])
  })

  it.each([
    [91, 95, 'adentro de otro'],
    [80, 90, 'compartiendo el borde de abajo'],
    [99, 100, 'compartiendo el borde de arriba'],
    [0, 100, 'tapándolo entero'],
  ])('rechaza un rango que se solapa (%i–%i, %s)', async (minimo, maximo) => {
    await canje.crearRango({ tenantId, minimo: 90, maximo: 99 })
    await expect(canje.crearRango({ tenantId, minimo, maximo })).rejects.toMatchObject({
      codigo: 'RANGO_SOLAPADO',
    })
  })

  it('el mensaje del solapamiento nombra el rango con el que choca', async () => {
    await canje.crearRango({ tenantId, minimo: 85, maximo: 89 })
    await expect(canje.crearRango({ tenantId, minimo: 80, maximo: 86 })).rejects.toThrow(/85–89 %/)
  })

  // Los huecos se permiten: un local puede no tomar equipos con menos de 80 %.
  it('acepta rangos con un hueco en el medio', async () => {
    await canje.crearRango({ tenantId, minimo: 90, maximo: 100 })
    await expect(canje.crearRango({ tenantId, minimo: 50, maximo: 79 })).resolves.toBeDefined()
  })

  it.each([
    [80, 70],
    [-1, 50],
    [50, 101],
    [80.5, 90],
  ])('rechaza el rango %s–%s', async (minimo, maximo) => {
    await expect(canje.crearRango({ tenantId, minimo, maximo })).rejects.toMatchObject({
      codigo: 'RANGO_INVALIDO',
    })
  })

  // El solapamiento es POR TENANT: el rango de otro local no existe para éste.
  it('un rango igual en otro tenant no choca', async () => {
    await canje.crearRango({ tenantId: otroTenantId, minimo: 90, maximo: 99 })
    await expect(canje.crearRango({ tenantId, minimo: 90, maximo: 99 })).resolves.toBeDefined()
    await owner.query('DELETE FROM rangos_de_bateria WHERE tenant_id = $1', [otroTenantId])
  })

  it('editar un rango no choca consigo mismo, pero sí con los demás', async () => {
    const { id } = await canje.crearRango({ tenantId, minimo: 90, maximo: 99 })
    await canje.crearRango({ tenantId, minimo: 80, maximo: 84 })
    await expect(canje.editarRango({ tenantId, id, minimo: 88, maximo: 99 })).resolves.toBeUndefined()
    await expect(canje.editarRango({ tenantId, id, minimo: 84, maximo: 99 })).rejects.toMatchObject({
      codigo: 'RANGO_SOLAPADO',
    })
    const tabla = await tablaDeCanje(tenantId)
    expect(tabla.rangos.find((r) => r.id === id)).toMatchObject({ minimo: 88, maximo: 99 })
  })

  it('editar un rango que no existe dice RANGO_INEXISTENTE', async () => {
    await expect(
      canje.editarRango({ tenantId, id: '01900000-0000-7000-8000-000000000000', minimo: 1, maximo: 2 }),
    ).rejects.toMatchObject({ codigo: 'RANGO_INEXISTENTE' })
  })

  // Dos altas simultáneas que se solapan entre sí: cada una, mirando sola,
  // ve la tabla vacía. El lock por tenant es lo que hace que una espere a la
  // otra y la segunda vea la primera.
  //
  // Con dos `crearRango` en un Promise.all la carrera casi nunca se da —la
  // primera termina antes de que la segunda lea—, y el caso daba verde aun sin
  // el lock (probado sacándolo). Así que la otra alta la hace este test a
  // mano: toma el MISMO lock, inserta un rango que se solapa y recién
  // entonces confirma. Si `crearRango` no esperara ese lock, leería la tabla
  // vacía y entraría.
  it('un alta espera a la otra transacción que tiene el lock, y ve su rango', async () => {
    const otra = new Client({ connectionString: urlApp() })
    await otra.connect()
    try {
      await otra.query('BEGIN')
      await otra.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
      await otra.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `plan-canje:rangos:${tenantId}`,
      ])
      await otra.query(
        `INSERT INTO rangos_de_bateria (id, tenant_id, minimo, maximo, actualizado_en)
         VALUES (gen_random_uuid(), $1, 80, 90, now())`,
        [tenantId],
      )
      const alta = canje.crearRango({ tenantId, minimo: 85, maximo: 95 })
      // Tiempo de sobra para que el alta llegue a pedir el lock y se quede
      // esperando; sin lock, en este lapso ya habría leído y escrito.
      await new Promise((r) => setTimeout(r, 300))
      await otra.query('COMMIT')
      await expect(alta).rejects.toMatchObject({ codigo: 'RANGO_SOLAPADO' })
    } finally {
      await otra.end()
    }
    expect((await tablaDeCanje(tenantId)).rangos).toHaveLength(1)
  })

  it('borrar un rango se lleva sus valores y deja los de los demás', async () => {
    const alto = await canje.crearRango({ tenantId, minimo: 90, maximo: 100 })
    const bajo = await canje.crearRango({ tenantId, minimo: 0, maximo: 89 })
    const { id } = await canje.guardarModelo({
      tenantId, id: null, nombre: 'iPhone 13',
      valores: [{ rangoId: alto.id, valor: D('350') }, { rangoId: bajo.id, valor: D('250') }],
    })
    await canje.borrarRango({ tenantId, id: bajo.id })
    const modelo = (await tablaDeCanje(tenantId)).modelos.find((m) => m.id === id)
    expect(modelo?.valores).toEqual({ [alto.id]: '350' })
  })
})

describe('cargarRangosSugeridos', () => {
  it('carga los cinco sugeridos sobre una tabla de rangos vacía', async () => {
    await canje.cargarRangosSugeridos({ tenantId })
    const tabla = await tablaDeCanje(tenantId)
    expect(tabla.rangos.map((r) => [r.minimo, r.maximo])).toEqual([
      [100, 100], [90, 99], [85, 89], [80, 84], [0, 79],
    ])
  })

  // Con rangos ya cargados, los sugeridos chocarían con alguno o se
  // mezclarían con los del dueño: el botón sólo existe para empezar.
  it('con algún rango ya cargado se niega, sin cargar nada', async () => {
    await canje.crearRango({ tenantId, minimo: 95, maximo: 100 })
    await expect(canje.cargarRangosSugeridos({ tenantId })).rejects.toMatchObject({
      codigo: 'RANGOS_YA_CARGADOS',
    })
    expect((await tablaDeCanje(tenantId)).rangos).toHaveLength(1)
  })
})

describe('modelos', () => {
  it('guarda un modelo nuevo con su fila de valores', async () => {
    const r = await canje.crearRango({ tenantId, minimo: 85, maximo: 89 })
    const { id } = await canje.guardarModelo({
      tenantId, id: null, nombre: '  iPhone 14  ', valores: [{ rangoId: r.id, valor: D('400') }],
    })
    const tabla = await tablaDeCanje(tenantId)
    expect(tabla.modelos).toEqual([{ id, nombre: 'iPhone 14', valores: { [r.id]: '400' } }])
  })

  it.each(['iPhone 14', 'iphone 14', 'IPHONE 14'])(
    'rechaza "%s" si ya hay un "iPhone 14": sin distinguir mayúsculas',
    async (repetido) => {
      await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 14', valores: [] })
      await expect(
        canje.guardarModelo({ tenantId, id: null, nombre: repetido, valores: [] }),
      ).rejects.toMatchObject({ codigo: 'NOMBRE_REPETIDO' })
    },
  )

  // La red de abajo: si la aplicación se olvidara de chequear, el índice de
  // expresión de la migración igual rechaza el duplicado.
  it('la base rechaza el duplicado sin distinguir mayúsculas aunque nadie chequee antes', async () => {
    await owner.query(
      `INSERT INTO modelos_de_canje (id, tenant_id, nombre, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'iPhone 15', now())`,
      [tenantId],
    )
    await expect(
      owner.query(
        `INSERT INTO modelos_de_canje (id, tenant_id, nombre, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'IPHONE 15', now())`,
        [tenantId],
      ),
    ).rejects.toThrow(/modelos_de_canje_tenant_id_nombre_sin_mayusculas_key/)
  })

  it('renombrar un modelo a su mismo nombre con otras mayúsculas no choca consigo mismo', async () => {
    const { id } = await canje.guardarModelo({ tenantId, id: null, nombre: 'iphone 12', valores: [] })
    await expect(
      canje.guardarModelo({ tenantId, id, nombre: 'iPhone 12', valores: [] }),
    ).resolves.toEqual({ id })
    expect((await tablaDeCanje(tenantId)).modelos[0].nombre).toBe('iPhone 12')
  })

  it('renombrar a un nombre de otro modelo choca', async () => {
    await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 12', valores: [] })
    const { id } = await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 13', valores: [] })
    await expect(
      canje.guardarModelo({ tenantId, id, nombre: 'IPHONE 12', valores: [] }),
    ).rejects.toMatchObject({ codigo: 'NOMBRE_REPETIDO' })
  })

  it('el mismo nombre en otro tenant sí se puede', async () => {
    await canje.guardarModelo({ tenantId: otroTenantId, id: null, nombre: 'iPhone 11', valores: [] })
    await expect(
      canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 11', valores: [] }),
    ).resolves.toBeDefined()
    await owner.query('DELETE FROM modelos_de_canje WHERE tenant_id = $1', [otroTenantId])
  })

  it.each(['', '   '])('rechaza un nombre vacío ("%s")', async (nombre) => {
    await expect(canje.guardarModelo({ tenantId, id: null, nombre, valores: [] })).rejects.toMatchObject({
      codigo: 'NOMBRE_VACIO',
    })
  })

  it('rechaza un nombre de más de 80 caracteres', async () => {
    await expect(
      canje.guardarModelo({ tenantId, id: null, nombre: 'x'.repeat(81), valores: [] }),
    ).rejects.toMatchObject({ codigo: 'NOMBRE_LARGO' })
  })

  // Una celda vacía es "no se toma ese equipo en ese rango": borra el valor.
  it('guardar la fila con una celda vacía borra el valor que había', async () => {
    const a = await canje.crearRango({ tenantId, minimo: 90, maximo: 100 })
    const b = await canje.crearRango({ tenantId, minimo: 0, maximo: 89 })
    const { id } = await canje.guardarModelo({
      tenantId, id: null, nombre: 'iPhone 13',
      valores: [{ rangoId: a.id, valor: D('350') }, { rangoId: b.id, valor: D('250') }],
    })
    await canje.guardarModelo({
      tenantId, id, nombre: 'iPhone 13',
      valores: [{ rangoId: a.id, valor: D('360.50') }, { rangoId: b.id, valor: null }],
    })
    expect((await tablaDeCanje(tenantId)).modelos[0].valores).toEqual({ [a.id]: '360.5' })
  })

  // Un cero SÍ es un valor: "lo tomamos, pero no te reconocemos nada".
  it('un valor cero se guarda: no es lo mismo que la celda vacía', async () => {
    const r = await canje.crearRango({ tenantId, minimo: 0, maximo: 79 })
    await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 7', valores: [{ rangoId: r.id, valor: D('0') }] })
    expect((await tablaDeCanje(tenantId)).modelos[0].valores).toEqual({ [r.id]: '0' })
  })

  it.each([['-1'], ['10.001'], ['10000000000']])('rechaza el valor %s', async (valor) => {
    const r = await canje.crearRango({ tenantId, minimo: 0, maximo: 79 })
    await expect(
      canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone X', valores: [{ rangoId: r.id, valor: D(valor) }] }),
    ).rejects.toMatchObject({ codigo: 'VALOR_INVALIDO' })
    // La fila es atómica: un valor inválido no deja el modelo creado a medias.
    expect((await tablaDeCanje(tenantId)).modelos).toHaveLength(0)
  })

  it('un valor contra un rango que ya no existe rechaza la fila entera', async () => {
    const r = await canje.crearRango({ tenantId, minimo: 0, maximo: 79 })
    await canje.borrarRango({ tenantId, id: r.id })
    await expect(
      canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone XR', valores: [{ rangoId: r.id, valor: D('100') }] }),
    ).rejects.toMatchObject({ codigo: 'RANGO_INEXISTENTE' })
    expect((await tablaDeCanje(tenantId)).modelos).toHaveLength(0)
  })

  // La FK de valores_de_canje no mira el tenant (un chequeo de FK no pasa por
  // RLS), así que un id de OTRO local tiene que frenarse antes, en la
  // aplicación — o el tenant A podría escribir un valor colgado del modelo de B.
  it('no se puede escribir la fila de un modelo de otro tenant', async () => {
    const ajeno = await canje.guardarModelo({ tenantId: otroTenantId, id: null, nombre: 'Ajeno', valores: [] })
    await expect(
      canje.guardarModelo({ tenantId, id: ajeno.id, nombre: 'Robado', valores: [] }),
    ).rejects.toMatchObject({ codigo: 'MODELO_INEXISTENTE' })
    const { rows } = await owner.query('SELECT nombre FROM modelos_de_canje WHERE id = $1', [ajeno.id])
    expect(rows[0].nombre).toBe('Ajeno')
    await owner.query('DELETE FROM modelos_de_canje WHERE tenant_id = $1', [otroTenantId])
  })

  it('no se puede colgar un valor de un rango de otro tenant', async () => {
    const ajeno = await canje.crearRango({ tenantId: otroTenantId, minimo: 0, maximo: 100 })
    await expect(
      canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone SE', valores: [{ rangoId: ajeno.id, valor: D('100') }] }),
    ).rejects.toMatchObject({ codigo: 'RANGO_INEXISTENTE' })
    await owner.query('DELETE FROM rangos_de_bateria WHERE tenant_id = $1', [otroTenantId])
  })

  it('borrar un modelo se lleva sus valores', async () => {
    const r = await canje.crearRango({ tenantId, minimo: 0, maximo: 100 })
    const { id } = await canje.guardarModelo({
      tenantId, id: null, nombre: 'iPhone 8', valores: [{ rangoId: r.id, valor: D('80') }],
    })
    await canje.borrarModelo({ tenantId, id })
    const { rows } = await owner.query('SELECT count(*)::int AS n FROM valores_de_canje WHERE modelo_id = $1', [id])
    expect(rows[0].n).toBe(0)
    expect((await tablaDeCanje(tenantId)).modelos).toHaveLength(0)
  })

  it('la tabla ordena los modelos por nombre, con los números como números', async () => {
    for (const nombre of ['iPhone 11', 'iPhone 8', 'Galaxy S23', 'iPhone 14 Pro']) {
      await canje.guardarModelo({ tenantId, id: null, nombre, valores: [] })
    }
    expect((await tablaDeCanje(tenantId)).modelos.map((m) => m.nombre)).toEqual([
      'Galaxy S23', 'iPhone 8', 'iPhone 11', 'iPhone 14 Pro',
    ])
  })
})

describe('la moneda de la tabla', () => {
  it('sin configurar es USD', async () => {
    expect((await tablaDeCanje(tenantId)).moneda).toBe('USD')
  })

  it('se cambia y se vuelve a cambiar, sin tocar los valores', async () => {
    const r = await canje.crearRango({ tenantId, minimo: 0, maximo: 100 })
    await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 13', valores: [{ rangoId: r.id, valor: D('400') }] })
    await canje.cambiarMonedaDeCanje({ tenantId, moneda: 'ARS' })
    let tabla = await tablaDeCanje(tenantId)
    expect(tabla.moneda).toBe('ARS')
    // No se convierte: no hay cotización guardada de la cual hacerlo.
    expect(tabla.modelos[0].valores[r.id]).toBe('400')
    await canje.cambiarMonedaDeCanje({ tenantId, moneda: 'USD' })
    tabla = await tablaDeCanje(tenantId)
    expect(tabla.moneda).toBe('USD')
  })
})

describe('aislamiento entre tenants (RLS)', () => {
  // Las cuatro tablas, mirando como arandano_app con la GUC de un tenant: el
  // otro no ve nada de lo que cargó el primero.
  it('el tenant B no ve ni rangos, ni modelos, ni valores, ni la moneda del tenant A', async () => {
    const r = await canje.crearRango({ tenantId, minimo: 0, maximo: 100 })
    await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 13', valores: [{ rangoId: r.id, valor: D('400') }] })
    await canje.cambiarMonedaDeCanje({ tenantId, moneda: 'ARS' })

    const delOtro = await tablaDeCanje(otroTenantId)
    expect(delOtro).toEqual({ moneda: 'USD', rangos: [], modelos: [] })

    const app = new Client({ connectionString: urlApp() })
    await app.connect()
    try {
      await app.query('BEGIN')
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [otroTenantId])
      for (const t of ['rangos_de_bateria', 'modelos_de_canje', 'valores_de_canje', 'configuraciones_de_canje']) {
        const { rows } = await app.query(`SELECT count(*)::int AS n FROM ${t}`)
        expect(rows[0].n, `${t}: B ve filas de A`).toBe(0)
      }
      await app.query('ROLLBACK')
      // Y sin GUC no se ve nada: falla cerrado.
      for (const t of ['rangos_de_bateria', 'modelos_de_canje', 'valores_de_canje', 'configuraciones_de_canje']) {
        const { rows } = await app.query(`SELECT count(*)::int AS n FROM ${t}`)
        expect(rows[0].n, `${t}: sin GUC se ven filas`).toBe(0)
      }
    } finally {
      await app.end()
    }
  })

  it('el tenant B no puede insertar filas con el tenant_id de A', async () => {
    const app = new Client({ connectionString: urlApp() })
    await app.connect()
    try {
      await app.query('BEGIN')
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [otroTenantId])
      await expect(
        app.query(
          `INSERT INTO rangos_de_bateria (id, tenant_id, minimo, maximo, actualizado_en)
           VALUES (gen_random_uuid(), $1, 0, 10, now())`,
          [tenantId],
        ),
      ).rejects.toThrow(/row-level security/)
      await app.query('ROLLBACK')
    } finally {
      await app.end()
    }
  })

  it('el tenant B no puede borrar los modelos de A', async () => {
    const { id } = await canje.guardarModelo({ tenantId, id: null, nombre: 'iPhone 13', valores: [] })
    await canje.borrarModelo({ tenantId: otroTenantId, id })
    expect((await tablaDeCanje(tenantId)).modelos.map((m) => m.id)).toEqual([id])
  })
})
