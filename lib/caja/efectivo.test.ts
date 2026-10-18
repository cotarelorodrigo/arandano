import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant, crearUsuario } from '@/test/datos'

/**
 * El efectivo del turno y el cierre con arqueo (spec
 * docs/superpowers/specs/2026-10-18-arqueo-de-caja-design.md), contra la base
 * efímera: las reglas del cobrado son cláusulas de un `where`, y un `where` sólo
 * se prueba contra Postgres.
 *
 * Las ventas se insertan CRUDAS con el owner, sin pasar por `crearVenta`: lo
 * que importa acá son las fechas (`creado_en` de la venta, de sus pagos, y
 * `anulada_en`), y fijarlas a mano es la única forma de armar "una venta de un
 * turno anterior anulada en éste" sin esperar de verdad. El motor de ventas
 * tiene su propia cobertura en test/ventas.test.ts.
 */

let owner: Client
let tenantA: string
let tenantB: string
let usuarioA: string
let usuarioB: string
let mod: typeof import('@/lib/caja/abrir-cerrar')
let efectivo: typeof import('@/lib/caja/efectivo')
let movimientos: typeof import('@/lib/caja/movimientos')

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'arqueo-a')
  tenantB = await crearTenant(owner, 'arqueo-b')
  usuarioA = await crearUsuario(owner, tenantA, 'flor@arqueo-a.test')
  usuarioB = await crearUsuario(owner, tenantB, 'ruben@arqueo-b.test')

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import (mismo motivo que abrir-cerrar.test.ts).
  process.env.DATABASE_URL = urlApp()
  mod = await import('@/lib/caja/abrir-cerrar')
  efectivo = await import('@/lib/caja/efectivo')
  movimientos = await import('@/lib/caja/movimientos')
})

afterAll(async () => {
  await owner.end()
})

// Sólo los tenants de este archivo: la base es compartida entre archivos
// (fileParallelism: false, pero una sola base), y los movimientos primero por
// la FK RESTRICT hacia cajas.
beforeEach(async () => {
  const ts = [tenantA, tenantB]
  await owner.query('DELETE FROM movimientos_de_caja WHERE tenant_id = ANY($1)', [ts])
  await owner.query('DELETE FROM cajas WHERE tenant_id = ANY($1)', [ts])
  await owner.query('DELETE FROM pagos WHERE tenant_id = ANY($1)', [ts])
  await owner.query('DELETE FROM ventas WHERE tenant_id = ANY($1)', [ts])
})

let proximoNumero = 1

type PagoCrudo = {
  medio?: 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA_DEBITO' | 'TARJETA_CREDITO'
  moneda?: 'ARS' | 'USD'
  monto: string
  // El `creado_en` del pago, por defecto el de la venta. Distinto sólo para
  // simular una edición, que recrea los pagos con `creadoEn = ahora`.
  creadoEn?: string
}

/**
 * Una venta con sus pagos, insertada cruda. `creadoEn` y `anuladaEn` son
 * expresiones SQL relativas a `now()` (`"now() - interval '2 hours'"`), que es
 * el mismo reloj con el que Postgres escribe `abierta_en`.
 */
async function venta(
  tenantId: string,
  usuarioId: string,
  pagos: PagoCrudo[],
  { creadoEn = 'now()', anuladaEn = 'NULL' }: { creadoEn?: string; anuladaEn?: string } = {},
): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, anulada_en, creado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, 0, ${anuladaEn}, ${creadoEn}) RETURNING id`,
    [tenantId, proximoNumero++, usuarioId],
  )
  const ventaId = rows[0].id
  for (const p of pagos) {
    await owner.query(
      `INSERT INTO pagos (id, tenant_id, venta_id, medio, moneda, monto, cotizacion, creado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 1, ${p.creadoEn ?? creadoEn})`,
      [tenantId, ventaId, p.medio ?? 'EFECTIVO', p.moneda ?? 'ARS', p.monto],
    )
  }
  return ventaId
}

/** El efectivo del turno abierto de un tenant, con los montos como texto. */
async function actual(tenantId: string) {
  const t = await efectivo.turnoEnCurso(tenantId)
  if (!t) throw new Error('no hay caja abierta')
  const e = t.efectivo
  const txt = (x: { ars: { toFixed(n: number): string }; usd: { toFixed(n: number): string } }) => ({
    ars: x.ars.toFixed(2),
    usd: x.usd.toFixed(2),
  })
  return {
    apertura: txt(e.apertura),
    cobrado: txt(e.cobrado),
    devuelto: txt(e.devuelto),
    ingresos: txt(e.ingresos),
    egresos: txt(e.egresos),
    retiros: txt(e.retiros),
    actual: txt(e.actual),
    hubo: efectivo.huboDolares(e),
  }
}

async function filaDeCaja(id: string) {
  const { rows } = await owner.query(
    `SELECT cerrada_en, esperado_ars, esperado_usd, contado_ars, contado_usd,
            retirado_ars, retirado_usd, nota_cierre
     FROM cajas WHERE id = $1`,
    [id],
  )
  return rows[0]
}

describe('el ejemplo del pedido', () => {
  // Textual del audio del cliente: "abro con 10.000, vendo 50.000 en
  // efectivo, saco 5.000 para el delivery: tengo que tener 55.000. Cuento
  // 55.000, me llevo 45.000, quedan 10.000".
  it('apertura 10.000 + ventas 50.000 − egreso 5.000 = 55.000; contado 55.000, retiro 45.000 → queda 10.000, diferencia 0', async () => {
    const { id } = await mod.abrirCaja(tenantA, usuarioA, '10000')
    await venta(tenantA, usuarioA, [{ monto: '30000' }])
    await venta(tenantA, usuarioA, [{ monto: '20000' }])
    await movimientos.registrarMovimiento(tenantA, usuarioA, {
      tipo: 'EGRESO', moneda: 'ARS', monto: '5000', nota: 'Delivery',
    })

    const e = await actual(tenantA)
    expect(e.apertura.ars).toBe('10000.00')
    expect(e.cobrado.ars).toBe('50000.00')
    expect(e.egresos.ars).toBe('5000.00')
    expect(e.actual.ars).toBe('55000.00')

    await mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '55000', retiradoArs: '45000' })

    const fila = await filaDeCaja(id)
    expect(fila.cerrada_en).not.toBeNull()
    expect(fila.esperado_ars).toBe('55000.00')
    expect(fila.contado_ars).toBe('55000.00')
    expect(fila.retirado_ars).toBe('45000.00')

    // Diferencia y "queda" se derivan, no se guardan: acá con la misma
    // aritmética que usan la pantalla del cierre y /caja.
    const { canonicoACentavos, diferencia, queda, textoDeDiferencia } = await import('./arqueo')
    const dif = diferencia(canonicoACentavos(fila.contado_ars), canonicoACentavos(fila.esperado_ars))
    expect(dif).toBe(0)
    expect(textoDeDiferencia(dif, 'ARS')).toBe('cuadra')
    expect(queda(canonicoACentavos(fila.contado_ars), canonicoACentavos(fila.retirado_ars))).toBe(1_000_000)

    // Y lo que queda es la apertura sugerida del turno siguiente.
    expect(await mod.aperturaSugerida(tenantA)).toEqual({ ars: '10000.00', usd: '0.00' })
  })
})

describe('el cobrado del turno', () => {
  it('sólo cuenta EFECTIVO: transferencia y tarjetas no pasan por el cajón', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await venta(tenantA, usuarioA, [
      { medio: 'EFECTIVO', monto: '1000' },
      { medio: 'TRANSFERENCIA', monto: '2000' },
      { medio: 'TARJETA_DEBITO', monto: '3000' },
      { medio: 'TARJETA_CREDITO', monto: '4000' },
    ])
    expect((await actual(tenantA)).cobrado.ars).toBe('1000.00')
  })

  it('por moneda: los dólares en efectivo van a su pila y no se suman a los pesos', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await venta(tenantA, usuarioA, [{ moneda: 'USD', monto: '300' }, { monto: '1000' }])
    const e = await actual(tenantA)
    expect(e.cobrado).toEqual({ ars: '1000.00', usd: '300.00' })
    expect(e.actual).toEqual({ ars: '1000.00', usd: '300.00' })
    expect(e.hubo).toBe(true)
  })

  it('sin un solo dólar, el turno dice que no hubo (la columna no se muestra)', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '500')
    await venta(tenantA, usuarioA, [{ monto: '1000' }])
    expect((await actual(tenantA)).hubo).toBe(false)
  })

  it('sólo las ventas de la ventana: una creada antes de abrir no suma', async () => {
    await venta(tenantA, usuarioA, [{ monto: '9999' }], { creadoEn: "now() - interval '2 hours'" })
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await venta(tenantA, usuarioA, [{ monto: '100' }])
    expect((await actual(tenantA)).cobrado.ars).toBe('100.00')
  })

  it('una venta creada y anulada en el mismo turno no suma', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await venta(tenantA, usuarioA, [{ monto: '700' }], { anuladaEn: 'now()' })
    await venta(tenantA, usuarioA, [{ monto: '100' }])
    const e = await actual(tenantA)
    expect(e.cobrado.ars).toBe('100.00')
    // Y tampoco se resta como devolución: nunca salió de otro cajón.
    expect(e.devuelto.ars).toBe('0.00')
  })

  it('una venta de un turno anterior anulada en éste resta: la plata sale de este cajón', async () => {
    await venta(tenantA, usuarioA, [{ monto: '800' }], { creadoEn: "now() - interval '1 day'" })
    // Abre DESPUÉS de la venta y la anulación cae dentro del turno. Se anula
    // con un UPDATE posterior a la apertura para que `anulada_en` quede
    // adentro de la ventana con el mismo reloj que `abierta_en`.
    await mod.abrirCaja(tenantA, usuarioA, '1000')
    await owner.query(`UPDATE ventas SET anulada_en = now() WHERE tenant_id = $1`, [tenantA])
    const e = await actual(tenantA)
    expect(e.devuelto.ars).toBe('800.00')
    expect(e.cobrado.ars).toBe('0.00')
    expect(e.actual.ars).toBe('200.00')
  })

  // Hallazgo de la review: anulada en el hueco entre el cierre de A y la
  // apertura de B, no se restaba en ningún lado, y lo que quedó de A (la
  // apertura de B) la seguía incluyendo.
  it('una venta del turno anterior anulada entre los dos turnos resta en el siguiente', async () => {
    // Turno A, cerrado hace una hora, con una venta adentro.
    const { rows } = await owner.query(
      `INSERT INTO cajas (id, tenant_id, abierta_en, abierta_por_id, saldo_inicial, cerrada_en, cerrada_por_id, creado_en)
       VALUES (gen_random_uuid(), $1, now() - interval '3 hours', $2, 0, now() - interval '1 hour', $2, now())
       RETURNING id`,
      [tenantA, usuarioA],
    )
    expect(rows).toHaveLength(1)
    await venta(tenantA, usuarioA, [{ monto: '800' }], {
      creadoEn: "now() - interval '2 hours'",
      anuladaEn: "now() - interval '30 minutes'",
    })
    // Una venta creada Y anulada en el hueco nunca estuvo en un cajón contado.
    await venta(tenantA, usuarioA, [{ monto: '50' }], {
      creadoEn: "now() - interval '40 minutes'",
      anuladaEn: "now() - interval '20 minutes'",
    })
    await mod.abrirCaja(tenantA, usuarioA, '1000')
    const e = await actual(tenantA)
    expect(e.devuelto.ars).toBe('800.00')
    expect(e.actual.ars).toBe('200.00')
  })

  it('una venta de un turno anterior anulada ANTES de abrir éste no toca este cajón', async () => {
    await venta(tenantA, usuarioA, [{ monto: '800' }], {
      creadoEn: "now() - interval '1 day'",
      anuladaEn: "now() - interval '1 hour'",
    })
    await mod.abrirCaja(tenantA, usuarioA, '1000')
    expect((await actual(tenantA)).devuelto.ars).toBe('0.00')
  })

  // La razón por la que se filtra por `Venta.creadoEn` y no por
  // `Pago.creadoEn`: lib/ventas/editar.ts recrea los pagos con creadoEn =
  // ahora. Filtrando por el pago, corregir hoy una venta de ayer metía su
  // efectivo en el cajón de hoy.
  it('una venta de otro turno editada durante éste no se mueve de turno', async () => {
    await venta(tenantA, usuarioA, [{ monto: '5000', creadoEn: "now() + interval '1 minute'" }], {
      creadoEn: "now() - interval '1 day'",
    })
    await mod.abrirCaja(tenantA, usuarioA, '0')
    expect((await actual(tenantA)).cobrado.ars).toBe('0.00')
  })

  it('otro tenant no suma, ni sus ventas ni sus movimientos', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await mod.abrirCaja(tenantB, usuarioB, '0')
    await venta(tenantB, usuarioB, [{ monto: '4000' }])
    await movimientos.registrarMovimiento(tenantB, usuarioB, { tipo: 'INGRESO', moneda: 'ARS', monto: '300' })
    await venta(tenantA, usuarioA, [{ monto: '10' }])
    const a = await actual(tenantA)
    expect(a.cobrado.ars).toBe('10.00')
    expect(a.ingresos.ars).toBe('0.00')
    const b = await actual(tenantB)
    expect(b.actual.ars).toBe('4300.00')
  })

  it('ingresos suman y retiros restan, cada uno en su moneda', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '1000', '50')
    await movimientos.registrarMovimiento(tenantA, usuarioA, { tipo: 'INGRESO', moneda: 'ARS', monto: '500' })
    await movimientos.registrarMovimiento(tenantA, usuarioA, { tipo: 'RETIRO', moneda: 'USD', monto: '20' })
    const e = await actual(tenantA)
    expect(e.apertura).toEqual({ ars: '1000.00', usd: '50.00' })
    expect(e.actual).toEqual({ ars: '1500.00', usd: '30.00' })
  })

  it('sin caja abierta, no hay turno', async () => {
    expect(await efectivo.turnoEnCurso(tenantA)).toBeNull()
  })
})

describe('el cierre con arqueo', () => {
  it('guarda contado, retirado y nota por moneda, y el esperado', async () => {
    const { id } = await mod.abrirCaja(tenantA, usuarioA, '0', '100')
    await venta(tenantA, usuarioA, [{ moneda: 'USD', monto: '200' }])
    await mod.cerrarCaja(tenantA, usuarioA, {
      contadoArs: '0', contadoUsd: '300', retiradoArs: '', retiradoUsd: '250', nota: '  Todo ok  ',
    })
    const fila = await filaDeCaja(id)
    expect(fila.esperado_usd).toBe('300.00')
    expect(fila.contado_usd).toBe('300.00')
    expect(fila.retirado_usd).toBe('250.00')
    // Vacío es cero, no NULL: el cierre SÍ tuvo arqueo.
    expect(fila.retirado_ars).toBe('0.00')
    expect(fila.nota_cierre).toBe('Todo ok')
  })

  it('retirado mayor que contado se rechaza, y la caja sigue abierta', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '1000')
    await expect(
      mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '1000', retiradoArs: '1000.01' }),
    ).rejects.toMatchObject({ codigo: 'RETIRO_MAYOR_QUE_CONTADO' })
    await expect(
      mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '1000', contadoUsd: '5', retiradoUsd: '6' }),
    ).rejects.toMatchObject({ codigo: 'RETIRO_MAYOR_QUE_CONTADO' })
    expect(await mod.cajaAbierta(tenantA)).not.toBeNull()
  })

  it('el contado en pesos es obligatorio y no negativo', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await expect(mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '' })).rejects.toMatchObject({
      codigo: 'MONTO_INVALIDO',
    })
    await expect(mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '-5' })).rejects.toMatchObject({
      codigo: 'MONTO_INVALIDO',
    })
    expect(await mod.cajaAbierta(tenantA)).not.toBeNull()
  })

  // La diferencia es un DATO del turno, no un error: el arqueo existe para
  // mostrarla, y una caja que no se puede cerrar porque faltan $ 200 es una
  // caja que queda abierta hasta el día siguiente.
  it('una diferencia distinta de cero no bloquea el cierre', async () => {
    const { id } = await mod.abrirCaja(tenantA, usuarioA, '1000')
    await mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '800' })
    const fila = await filaDeCaja(id)
    expect(fila.cerrada_en).not.toBeNull()
    expect(fila.esperado_ars).toBe('1000.00')
    expect(fila.contado_ars).toBe('800.00')
  })

  // Spec, decisión 4: el esperado se calcula al abrir el formulario Y se
  // recalcula en la transacción del cierre, y el que se guarda es el segundo.
  it('el esperado guardado es el recalculado en la transacción, no el que mostraba la pantalla', async () => {
    const { id } = await mod.abrirCaja(tenantA, usuarioA, '1000')
    const enPantalla = await actual(tenantA)
    expect(enPantalla.actual.ars).toBe('1000.00')
    // Mientras la persona cuenta, entra un cobro.
    await venta(tenantA, usuarioA, [{ monto: '250' }])
    await mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '1000' })
    expect((await filaDeCaja(id)).esperado_ars).toBe('1250.00')
  })
})

describe('la apertura sugerida', () => {
  it('es lo que quedó en el último cierre (contado − retirado), por moneda', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0', '10')
    await mod.cerrarCaja(tenantA, usuarioA, {
      contadoArs: '12000', retiradoArs: '2000', contadoUsd: '10', retiradoUsd: '',
    })
    expect(await mod.aperturaSugerida(tenantA)).toEqual({ ars: '10000.00', usd: '10.00' })
  })

  it('sin ningún cierre, no hay sugerencia', async () => {
    expect(await mod.aperturaSugerida(tenantA)).toBeNull()
  })

  // Lo que quedó hace tres días no es lo que hay hoy: si el último cierre
  // fue sin arqueo, no se busca uno más viejo. Desde la review ya no se
  // puede cerrar sin arqueo, pero las cajas cerradas antes de este ciclo
  // existen así: el segundo cierre se escribe crudo, como quedaron ellas.
  it('si el último cierre fue sin arqueo, tampoco (aunque uno anterior lo tenga)', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '0')
    await mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '5000' })
    await mod.abrirCaja(tenantA, usuarioA, '5000')
    await owner.query(
      `UPDATE cajas SET cerrada_en = now(), cerrada_por_id = $2 WHERE tenant_id = $1 AND cerrada_en IS NULL`,
      [tenantA, usuarioA],
    )
    expect(await mod.aperturaSugerida(tenantA)).toBeNull()
  })

  it('es del local: el cierre de otro tenant no se sugiere acá', async () => {
    await mod.abrirCaja(tenantB, usuarioB, '0')
    await mod.cerrarCaja(tenantB, usuarioB, { contadoArs: '777' })
    expect(await mod.aperturaSugerida(tenantA)).toBeNull()
  })
})

describe('la apertura en dólares', () => {
  it('vacía es cero, y con valor se guarda aparte de los pesos', async () => {
    await mod.abrirCaja(tenantA, usuarioA, '100')
    expect((await mod.cajaAbierta(tenantA))?.saldoInicialUsd.toString()).toBe('0')
    await mod.cerrarCaja(tenantA, usuarioA, { contadoArs: '100' })
    await mod.abrirCaja(tenantA, usuarioA, '100', '25,50')
    expect((await mod.cajaAbierta(tenantA))?.saldoInicialUsd.toString()).toBe('25.5')
  })

  it('rechaza un valor que no es plata, con el código de la apertura', async () => {
    await expect(mod.abrirCaja(tenantA, usuarioA, '100', 'abc')).rejects.toMatchObject({
      codigo: 'SALDO_INVALIDO',
    })
  })
})
