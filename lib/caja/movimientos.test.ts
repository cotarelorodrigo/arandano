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
let registrarMovimiento: typeof import('@/lib/caja/movimientos').registrarMovimiento

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'movcaja-a')
  tenantB = await crearTenant(owner, 'movcaja-b')
  usuarioA = await crearUsuario(owner, tenantA, 'flor@movcaja-a.test')
  usuarioB = await crearUsuario(owner, tenantB, 'ruben@movcaja-b.test')

  // DATABASE_URL antes del import: el pool de lib/db.ts la lee al cargarse.
  process.env.DATABASE_URL = urlApp()
  ;({ abrirCaja, cerrarCaja } = await import('@/lib/caja/abrir-cerrar'))
  ;({ registrarMovimiento } = await import('@/lib/caja/movimientos'))
})

afterAll(async () => {
  await owner.end()
})

beforeEach(async () => {
  const ts = [tenantA, tenantB]
  await owner.query('DELETE FROM movimientos_de_caja WHERE tenant_id = ANY($1)', [ts])
  await owner.query('DELETE FROM cajas WHERE tenant_id = ANY($1)', [ts])
})

async function movimientosDe(tenantId: string) {
  const { rows } = await owner.query(
    'SELECT tipo, moneda, monto, nota, usuario_id, caja_id FROM movimientos_de_caja WHERE tenant_id = $1',
    [tenantId],
  )
  return rows
}

describe('registrar un movimiento de caja', () => {
  it('con caja abierta, queda colgado de ESA caja y con quién lo hizo', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '0')
    await registrarMovimiento(tenantA, usuarioA, { tipo: 'RETIRO', moneda: 'ARS', monto: '1.500,50' })
    const [m] = await movimientosDe(tenantA)
    expect(m).toMatchObject({ tipo: 'RETIRO', moneda: 'ARS', monto: '1500.50', caja_id: id, usuario_id: usuarioA })
    // Retiro sin nota: la nota sólo es obligatoria para el egreso.
    expect(m.nota).toBeNull()
  })

  it('sin caja abierta no se registra', async () => {
    await expect(
      registrarMovimiento(tenantA, usuarioA, { tipo: 'INGRESO', moneda: 'ARS', monto: '100' }),
    ).rejects.toMatchObject({ codigo: 'SIN_CAJA_ABIERTA' })
    expect(await movimientosDe(tenantA)).toHaveLength(0)
  })

  it('con la caja de OTRO local abierta tampoco: la caja es del tenant', async () => {
    await abrirCaja(tenantB, usuarioB, '0')
    await expect(
      registrarMovimiento(tenantA, usuarioA, { tipo: 'INGRESO', moneda: 'ARS', monto: '100' }),
    ).rejects.toMatchObject({ codigo: 'SIN_CAJA_ABIERTA' })
  })

  it('el monto tiene que ser mayor que cero', async () => {
    await abrirCaja(tenantA, usuarioA, '0')
    for (const monto of ['0', '0,00', '', 'abc', '-5']) {
      await expect(
        registrarMovimiento(tenantA, usuarioA, { tipo: 'INGRESO', moneda: 'ARS', monto }),
        `el monto "${monto}" tendría que rechazarse`,
      ).rejects.toMatchObject({ codigo: 'MONTO_INVALIDO' })
    }
    expect(await movimientosDe(tenantA)).toHaveLength(0)
  })

  it('un egreso sin nota no se registra; con nota sí', async () => {
    await abrirCaja(tenantA, usuarioA, '0')
    for (const nota of [undefined, '', '   ']) {
      await expect(
        registrarMovimiento(tenantA, usuarioA, { tipo: 'EGRESO', moneda: 'ARS', monto: '5000', nota }),
      ).rejects.toMatchObject({ codigo: 'NOTA_INVALIDA' })
    }
    await registrarMovimiento(tenantA, usuarioA, { tipo: 'EGRESO', moneda: 'ARS', monto: '5000', nota: ' Delivery ' })
    const [m] = await movimientosDe(tenantA)
    expect(m.nota).toBe('Delivery')
  })

  it('un tipo o una moneda que no existen se rechazan con código', async () => {
    await abrirCaja(tenantA, usuarioA, '0')
    await expect(
      registrarMovimiento(tenantA, usuarioA, { tipo: 'PRESTAMO', moneda: 'ARS', monto: '1' }),
    ).rejects.toMatchObject({ codigo: 'MOVIMIENTO_INVALIDO' })
    await expect(
      registrarMovimiento(tenantA, usuarioA, { tipo: 'INGRESO', moneda: 'EUR', monto: '1' }),
    ).rejects.toMatchObject({ codigo: 'MOVIMIENTO_INVALIDO' })
  })

  it('un usuario de otro tenant no registra en esta caja', async () => {
    await abrirCaja(tenantA, usuarioA, '0')
    await expect(
      registrarMovimiento(tenantA, usuarioB, { tipo: 'INGRESO', moneda: 'ARS', monto: '1' }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })
  })

  it('un empleado también registra: el control es el arqueo, no un permiso', async () => {
    const empleado = await crearUsuario(owner, tenantA, 'nahuel@movcaja-a.test', 'EMPLEADO')
    await abrirCaja(tenantA, empleado, '0')
    await registrarMovimiento(tenantA, empleado, { tipo: 'EGRESO', moneda: 'USD', monto: '10', nota: 'Flete' })
    expect(await movimientosDe(tenantA)).toHaveLength(1)
  })

  // La carrera que el `UPDATE … SET cerrada_en = NULL` de registrarMovimiento
  // existe para cerrar. Con una conexión propia se cierra la caja SIN
  // commitear; el movimiento lanzado en ese momento tiene que quedarse
  // esperando el lock de la fila y, cuando el cierre commitea, re-evaluar y
  // rechazar. Con la versión obvia (findFirst + create) el movimiento entraba
  // colgado de una caja ya cerrada, fuera de su arqueo.
  it('un movimiento que llega mientras otro cierra la caja espera y se rechaza', async () => {
    await abrirCaja(tenantA, usuarioA, '0')
    const cierre = new Client({ connectionString: urlApp() })
    await cierre.connect()
    try {
      await cierre.query('BEGIN')
      await cierre.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantA])
      await cierre.query(
        'UPDATE cajas SET cerrada_en = now(), cerrada_por_id = $1 WHERE cerrada_en IS NULL',
        [usuarioA],
      )

      let terminado = false
      const enCurso = registrarMovimiento(tenantA, usuarioA, {
        tipo: 'INGRESO', moneda: 'ARS', monto: '100',
      }).finally(() => {
        terminado = true
      })
      // Que de verdad esté esperando el lock, y no que haya terminado antes.
      await new Promise((r) => setTimeout(r, 400))
      expect(terminado, 'el movimiento no esperó el lock del cierre').toBe(false)

      await cierre.query('COMMIT')
      await expect(enCurso).rejects.toMatchObject({ codigo: 'SIN_CAJA_ABIERTA' })
      expect(await movimientosDe(tenantA)).toHaveLength(0)
    } finally {
      await cierre.end()
    }
  })

  // La otra mitad: si el movimiento llegó primero, el cierre lo espera y su
  // esperado recalculado lo incluye.
  it('si el movimiento llegó primero, el esperado del cierre lo incluye', async () => {
    const { id } = await abrirCaja(tenantA, usuarioA, '1000')
    await registrarMovimiento(tenantA, usuarioA, { tipo: 'EGRESO', moneda: 'ARS', monto: '300', nota: 'Limpieza' })
    await cerrarCaja(tenantA, usuarioA, { contadoArs: '700' })
    const { rows } = await owner.query('SELECT esperado_ars FROM cajas WHERE id = $1', [id])
    expect(rows[0].esperado_ars).toBe('700.00')
  })
})
