import { describe, it, expect } from 'vitest'
import {
  RANGOS_SUGERIDOS,
  leerBateria,
  rangoParaBateria,
  seSolapan,
  rotuloDeRango,
  calcularCanje,
} from './calculo'
import { ErrorDeCanje } from './errores'

// Los rangos sugeridos con un id, como llegan de la base: `rangoParaBateria`
// devuelve el MISMO objeto que encontró, y el id es lo que la calculadora usa
// para buscar el valor de la celda.
const SUGERIDOS = RANGOS_SUGERIDOS.map((r, i) => ({ ...r, id: `r${i}` }))

describe('RANGOS_SUGERIDOS', () => {
  it('son los cinco del pedido, de mayor a menor batería', () => {
    expect(RANGOS_SUGERIDOS).toEqual([
      { minimo: 100, maximo: 100 },
      { minimo: 90, maximo: 99 },
      { minimo: 85, maximo: 89 },
      { minimo: 80, maximo: 84 },
      { minimo: 0, maximo: 79 },
    ])
  })

  // Si los sugeridos se solaparan, el botón que los carga chocaría contra la
  // misma validación que protege la tabla: el dueño tocaría "Usar los rangos
  // sugeridos" y recibiría un error que no puede corregir.
  it('no se solapan entre sí y cubren de 0 a 100 sin huecos', () => {
    for (let i = 0; i < RANGOS_SUGERIDOS.length; i++) {
      for (let j = i + 1; j < RANGOS_SUGERIDOS.length; j++) {
        expect(seSolapan(RANGOS_SUGERIDOS[i], RANGOS_SUGERIDOS[j])).toBe(false)
      }
    }
    for (let b = 0; b <= 100; b++) expect(rangoParaBateria(SUGERIDOS, b), `${b} %`).not.toBeNull()
  })
})

describe('rangoParaBateria', () => {
  // Los bordes de cada rango, de los dos lados: el error típico de un rango
  // cerrado es tratar uno de los extremos como abierto, y eso sólo se ve
  // parado exactamente en el borde.
  it.each([
    [100, 'r0'],
    [99, 'r1'],
    [90, 'r1'],
    [89, 'r2'],
    [85, 'r2'],
    [84, 'r3'],
    [80, 'r3'],
    [79, 'r4'],
    [0, 'r4'],
  ])('%i %% cae en %s', (bateria, id) => {
    expect(rangoParaBateria(SUGERIDOS, bateria)?.id).toBe(id)
  })

  // Un local que no toma equipos con menos de 80 % no carga ese rango: el
  // hueco no es un error, es "no se cotiza".
  it('un porcentaje en un hueco no cae en ningún rango', () => {
    const sinElUltimo = SUGERIDOS.slice(0, 4)
    expect(rangoParaBateria(sinElUltimo, 79)).toBeNull()
    expect(rangoParaBateria(sinElUltimo, 50)).toBeNull()
    expect(rangoParaBateria(sinElUltimo, 80)?.id).toBe('r3')
  })

  it('sin rangos no hay rango', () => {
    expect(rangoParaBateria([], 88)).toBeNull()
  })

  // Lo que la pantalla ya filtró con `leerBateria` no llega acá; si llega, es
  // un bug del llamador y tiene que hacer ruido en vez de devolver "sin
  // cotización", que se leería como un dato.
  it.each([88.5, -1, 101, Number.NaN])('rechaza %s', (bateria) => {
    expect(() => rangoParaBateria(SUGERIDOS, bateria)).toThrow(ErrorDeCanje)
  })
})

describe('leerBateria', () => {
  it.each([
    ['88', 88],
    [' 88 ', 88],
    ['88%', 88],
    ['88 %', 88],
    ['0', 0],
    ['100', 100],
  ])('"%s" es %i', (texto, bateria) => {
    expect(leerBateria(texto)).toEqual({ ok: true, bateria })
  })

  // El caso del spec: la batería del iPhone se lee en enteros. "88,5" es un
  // número, pero no una batería, y el mensaje tiene que decir eso y no "no es
  // un número".
  it('rechaza "88,5" diciendo que va en enteros', () => {
    const r = leerBateria('88,5')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje).toMatch(/entero/)
  })

  it.each(['', '   ', '101', '-5', 'ochenta', '8 8', '1e2'])('rechaza "%s"', (texto) => {
    const r = leerBateria(texto)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mensaje.length).toBeGreaterThan(0)
  })
})

describe('seSolapan', () => {
  it('dos rangos que comparten un borde se solapan: los dos son cerrados', () => {
    expect(seSolapan({ minimo: 80, maximo: 90 }, { minimo: 90, maximo: 99 })).toBe(true)
  })

  it('uno adentro del otro se solapa', () => {
    expect(seSolapan({ minimo: 0, maximo: 100 }, { minimo: 85, maximo: 89 })).toBe(true)
  })

  it('pegados sin compartir borde no se solapan', () => {
    expect(seSolapan({ minimo: 80, maximo: 84 }, { minimo: 85, maximo: 89 })).toBe(false)
  })
})

describe('rotuloDeRango', () => {
  it.each([
    [{ minimo: 100, maximo: 100 }, '100 %'],
    [{ minimo: 90, maximo: 99 }, '90–99 %'],
    [{ minimo: 0, maximo: 79 }, 'Menos de 80 %'],
    [{ minimo: 0, maximo: 100 }, '0–100 %'],
    [{ minimo: 50, maximo: 50 }, '50 %'],
  ])('%o se lee "%s"', (rango, rotulo) => {
    expect(rotuloDeRango(rango)).toBe(rotulo)
  })
})

describe('calcularCanje', () => {
  // El ejemplo literal del pedido.
  it('iPhone 16 a USD 1000 menos un iPhone 14 cotizado USD 400: paga USD 600', () => {
    const r = calcularCanje({
      precio: { monto: '1000', moneda: 'USD' },
      valor: { monto: '400', moneda: 'USD' },
      dolar: '',
    })
    expect(r).toEqual({
      tipo: 'CALCULADO',
      sentido: 'PAGA_EL_CLIENTE',
      precio: { monto: '1000.00', moneda: 'USD' },
      valor: { monto: '400.00', moneda: 'USD' },
      valorEnMonedaDelEquipo: { monto: '400.00', moneda: 'USD' },
      diferencia: { monto: '600.00', moneda: 'USD' },
      dolar: null,
    })
  })

  // Sin cotización NO es un error: es la respuesta "consultá al encargado".
  it('sin valor cargado devuelve SIN_COTIZACION, con el precio para mostrarlo igual', () => {
    expect(
      calcularCanje({ precio: { monto: '1000', moneda: 'USD' }, valor: null, dolar: '' }),
    ).toEqual({ tipo: 'SIN_COTIZACION', precio: { monto: '1000.00', moneda: 'USD' } })
  })

  // Un usado mejor que el equipo que se lleva: el local le devuelve la
  // diferencia. Se muestra como lo que es, nunca como un número negativo.
  it('si el usado vale más, la diferencia es lo que el local devuelve, en positivo', () => {
    const r = calcularCanje({
      precio: { monto: '300', moneda: 'USD' },
      valor: { monto: '450.50', moneda: 'USD' },
      dolar: '',
    })
    expect(r).toMatchObject({
      tipo: 'CALCULADO',
      sentido: 'DEVUELVE_EL_LOCAL',
      diferencia: { monto: '150.50', moneda: 'USD' },
    })
  })

  it('si valen lo mismo, no paga nadie', () => {
    const r = calcularCanje({
      precio: { monto: '400', moneda: 'USD' },
      valor: { monto: '400', moneda: 'USD' },
      dolar: '',
    })
    expect(r).toMatchObject({ tipo: 'CALCULADO', sentido: 'NADA', diferencia: { monto: '0.00' } })
  })

  describe('con monedas distintas', () => {
    // Sin dólar tipeado no se inventa ninguno: se muestran los dos números en
    // su moneda y no hay diferencia.
    it('sin dólar tipeado no hay diferencia: FALTA_DOLAR con los dos montos en su moneda', () => {
      expect(
        calcularCanje({
          precio: { monto: '1500000', moneda: 'ARS' },
          valor: { monto: '400', moneda: 'USD' },
          dolar: '',
        }),
      ).toEqual({
        tipo: 'FALTA_DOLAR',
        motivo: 'FALTA',
        precio: { monto: '1500000.00', moneda: 'ARS' },
        valor: { monto: '400.00', moneda: 'USD' },
      })
    })

    it.each([['mil'], ['0'], ['1.500']])('un dólar "%s" no sirve para convertir', (dolar) => {
      const r = calcularCanje({
        precio: { monto: '1500000', moneda: 'ARS' },
        valor: { monto: '400', moneda: 'USD' },
        dolar,
      })
      expect(r).toMatchObject({ tipo: 'FALTA_DOLAR', motivo: 'ILEGIBLE' })
    })

    // Equipo en pesos, tabla en dólares: el usado se pasa a pesos y la
    // diferencia sale en pesos, la moneda del equipo.
    it('equipo en pesos y tabla en dólares: la diferencia sale en pesos', () => {
      const r = calcularCanje({
        precio: { monto: '1500000', moneda: 'ARS' },
        valor: { monto: '400', moneda: 'USD' },
        dolar: '1250',
      })
      expect(r).toEqual({
        tipo: 'CALCULADO',
        sentido: 'PAGA_EL_CLIENTE',
        precio: { monto: '1500000.00', moneda: 'ARS' },
        valor: { monto: '400.00', moneda: 'USD' },
        valorEnMonedaDelEquipo: { monto: '500000.00', moneda: 'ARS' },
        diferencia: { monto: '1000000.00', moneda: 'ARS' },
        dolar: '1250',
      })
    })

    // Y al revés: equipo en dólares, tabla en pesos. El usado se pasa a
    // dólares, redondeado al centavo.
    it('equipo en dólares y tabla en pesos: la diferencia sale en dólares', () => {
      const r = calcularCanje({
        precio: { monto: '1000', moneda: 'USD' },
        valor: { monto: '500000', moneda: 'ARS' },
        dolar: '1.250,50',
      })
      // 500.000 / 1.250,50 = 399,840063… → 399,84
      expect(r).toMatchObject({
        tipo: 'CALCULADO',
        sentido: 'PAGA_EL_CLIENTE',
        valorEnMonedaDelEquipo: { monto: '399.84', moneda: 'USD' },
        diferencia: { monto: '600.16', moneda: 'USD' },
        dolar: '1250.50',
      })
    })

    // Con la misma moneda, lo que se haya tipeado en el dólar no entra en la
    // cuenta: el campo ni se muestra, y un número viejo no puede mover nada.
    it('con la misma moneda el dólar tipeado se ignora', () => {
      const r = calcularCanje({
        precio: { monto: '1000', moneda: 'USD' },
        valor: { monto: '400', moneda: 'USD' },
        dolar: 'cualquier cosa',
      })
      expect(r).toMatchObject({ tipo: 'CALCULADO', dolar: null, diferencia: { monto: '600.00' } })
    })
  })
})
