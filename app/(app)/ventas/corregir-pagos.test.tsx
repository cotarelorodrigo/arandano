// Sin jsdom, como todo test de componente de este repo (ver el comentario de
// `app/(app)/ventas/grafico.test.tsx`): se renderiza con
// `renderToStaticMarkup` y NO hay forma de simular un click. Por eso las tres
// decisiones que importan del diálogo —cuánto falta, qué dice el chip, y si la
// venta tiene dos totales— viven como funciones PURAS exportadas, y los casos
// van contra ellas. No es una concesión al entorno de test: es lo que hace que
// la regla de plata sea verificable sin abrir un navegador, que es exactamente
// el punto ciego que este repo viene señalando ciclo a ciclo.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { dineroEnCentavos, cotizacionEnDiezMilesimas } from '@/lib/ventas/centavos'
import { TOPE_NOTA_DE_CORRECCION } from '@/lib/ventas/correccion'
// Los importes se esperan con el MISMO formateador que los imprime: `Intl`
// separa el símbolo con un espacio duro (U+00A0), así que un literal escrito a
// mano con un espacio común nunca matchea.
import { formatearPrecio, precioEnSuMoneda } from '@/lib/formato/mostrar'
import {
  faltanteEnCentavos,
  textoDelChip,
  hayDosTotales,
  pagoNuevo,
  aCobrarEnCentavos,
  planesDeLaFila,
  CuerpoDeCorreccion,
  type PagoParaCorregir,
} from './corregir-pagos'
import type { PlanVisible } from '@/lib/planes/consultar'

// Los nombres de campo son los de `FilaDePagoCentavos` en
// `lib/ventas/centavos.ts` —`baseCentavos` y `cotizacionDiezMilesimas`, no
// `base` y `cotizacion`—: el tipo lleva la unidad en el nombre a propósito,
// para que no se pueda pasar pesos donde van centavos.
const EN_PESOS = (base: string) => ({
  moneda: 'ARS' as const,
  cubre: 'ARS' as const,
  baseCentavos: dineroEnCentavos(base),
  cotizacionDiezMilesimas: cotizacionEnDiezMilesimas('1'),
})

describe('faltanteEnCentavos: el mismo espejo en enteros que usa /vender', () => {
  it('dice cuánto falta cuando el juego no cierra', () => {
    expect(faltanteEnCentavos([EN_PESOS('900')], { ars: 100000, usd: 0 })).toEqual({
      ars: 10000,
      usd: 0,
    })
  })

  it('da cero en las dos monedas cuando cierra', () => {
    expect(faltanteEnCentavos([EN_PESOS('1000')], { ars: 100000, usd: 0 })).toEqual({
      ars: 0,
      usd: 0,
    })
  })

  it('en negativo cuando sobra', () => {
    expect(faltanteEnCentavos([EN_PESOS('1100')], { ars: 100000, usd: 0 })).toEqual({
      ars: -10000,
      usd: 0,
    })
  })

  it('las dos monedas se miden por separado y no se compensan', () => {
    // Cierra en pesos y falta en dólares: NO cierra.
    const filas = [
      EN_PESOS('1000'),
      {
        moneda: 'USD' as const,
        cubre: 'USD' as const,
        baseCentavos: dineroEnCentavos('50'),
        cotizacionDiezMilesimas: cotizacionEnDiezMilesimas('1000'),
      },
    ]
    expect(faltanteEnCentavos(filas, { ars: 100000, usd: 30000 })).toEqual({
      ars: 0,
      usd: 25000,
    })
  })

  // El cruce: pesos entregados contra el total en dólares. La base va en
  // DÓLARES (`baseEnDolares` es verdadero en cuanto una punta es USD), así que
  // aporta dólares sin dividir nada — es la regla del motor, espejada.
  it('un pago en pesos que cubre el total en dólares aporta dólares, no pesos', () => {
    const cruce = {
      moneda: 'ARS' as const,
      cubre: 'USD' as const,
      baseCentavos: dineroEnCentavos('300'),
      cotizacionDiezMilesimas: cotizacionEnDiezMilesimas('1485'),
    }
    expect(faltanteEnCentavos([cruce], { ars: 0, usd: 30000 })).toEqual({ ars: 0, usd: 0 })
  })
})

describe('textoDelChip: lo que decide el cartel Y el botón de guardar', () => {
  it('null cuando cierra, que es lo que habilita guardar', () => {
    expect(textoDelChip({ ars: 0, usd: 0 })).toBeNull()
  })

  it('distingue faltar de sobrar', () => {
    expect(textoDelChip({ ars: 10000, usd: 0 })).toContain('Faltan')
    expect(textoDelChip({ ars: -10000, usd: 0 })).toContain('Sobran')
  })

  it('nombra las dos monedas cuando las dos están fuera de lugar', () => {
    const texto = textoDelChip({ ars: 10000, usd: -5000 })
    expect(texto).toContain(formatearPrecio('100'))
    expect(texto).toContain(precioEnSuMoneda('50', 'USD'))
  })

  // Un monto a medio tipear deja la cuenta en NaN. `NaN !== 0`, así que sin
  // esta rama el chip diría "Sobran $ NaN" — y, peor, `NaN === 0` es falso,
  // así que el botón queda deshabilitado igual: lo que falla sin la rama es el
  // cartel, no la guarda.
  it('un importe a medio tipear no se lee como que sobra plata', () => {
    const texto = textoDelChip({ ars: NaN, usd: 0 })
    expect(texto).not.toBeNull()
    expect(texto).not.toContain('NaN')
    expect(texto).not.toContain('Sobran')
  })
})

describe('hayDosTotales: sólo cuando la venta tiene mercadería en las dos monedas', () => {
  it('con una sola moneda no hay nada que elegir', () => {
    expect(hayDosTotales({ ars: 100000, usd: 0 })).toBe(false)
    expect(hayDosTotales({ ars: 0, usd: 30000 })).toBe(false)
  })

  it('con las dos, sí', () => {
    expect(hayDosTotales({ ars: 100000, usd: 30000 })).toBe(true)
  })
})

describe('pagoNuevo: la fila que nace al tocar "Agregar pago"', () => {
  /**
   * El invariante, en las TRES formas de venta: una fila nueva **nunca nace
   * cruzando**. Si naciera, su campo "Cotización" se dibujaría ya lleno con el
   * `'1'` que le corresponde a un pago que NO cruza — un dólar a un peso — y
   * nada de la pantalla ni del motor lo frenaría: el espejo del cliente no
   * divide (suma la base al total en dólares sin mirar la cotización) y
   * `normalizarPagos` sólo exige `cotizacion > 0`. Lo que quedaría guardado es
   * `Pago.cotizacion = 1` sobre los pesos que entraron de verdad, histórico e
   * inmutable.
   */
  it.each([
    ['sólo en pesos', { ars: 100000, usd: 0 }],
    ['sólo en dólares', { ars: 0, usd: 30000 }],
    ['mixta', { ars: 1500000, usd: 30000 }],
  ] as const)('en una venta %s, lo que entrega es lo que cubre', (_, totales) => {
    const fila = pagoNuevo(totales)
    expect(fila.moneda).toBe(fila.cubre)
  })

  // El caso insignia del producto —el iPhone a US$ 300— y el que tenía el bug:
  // la fila nace entregando dólares contra el total en dólares, no pesos.
  it('en una venta sólo en dólares nace en USD y no en pesos con cotización 1', () => {
    expect(pagoNuevo({ ars: 0, usd: 30000 })).toEqual({
      medio: 'EFECTIVO',
      moneda: 'USD',
      cubre: 'USD',
      base: '',
      cotizacion: '1',
      planId: null,
    })
  })

  // Con las DOS monedas manda pesos, que es el default de siempre y el que
  // deja elegir al selector de `Cubre` —que ahí sí se dibuja—.
  it('en una venta mixta nace en pesos contra el total en pesos', () => {
    const fila = pagoNuevo({ ars: 1500000, usd: 30000 })
    expect(fila.moneda).toBe('ARS')
    expect(fila.cubre).toBe('ARS')
  })

  // La base arranca VACÍA y no en cero: un cero silencioso es una línea que la
  // pantalla da por buena. `dineroEnCentavos('')` da NaN, así que el chip dice
  // que no se entiende y "Guardar" queda apagado hasta que alguien tipee.
  it('la base arranca vacía, así que la venta no puede cerrar sola', () => {
    expect(pagoNuevo({ ars: 100000, usd: 0 }).base).toBe('')
  })
})

describe('aCobrarEnCentavos: lo que se le pide a la persona por UNA fila', () => {
  const PLAN: PlanVisible = {
    id: 'plan-credito',
    nombre: 'Crédito 12 cuotas',
    medio: 'TARJETA_CREDITO',
    cuotas: 12,
    porcentaje: '40',
    orden: 1,
    desactivadoEn: null,
  }
  const DESCUENTO: PlanVisible = { ...PLAN, id: 'plan-contado', nombre: 'Contado', medio: 'EFECTIVO', cuotas: 1, porcentaje: '-10' }

  const FILA: PagoParaCorregir = {
    medio: 'TARJETA_CREDITO', moneda: 'ARS', cubre: 'ARS',
    base: '10000', cotizacion: '1', planId: null,
  }

  it('sin plan es la base: no hay nada que recargar', () => {
    expect(aCobrarEnCentavos(FILA, [PLAN])).toBe(1000000)
  })

  it('con un plan que no está en la lista tampoco recarga', () => {
    // Un plan dado de baja entre que la pantalla cargó y ahora: el selector ya
    // no lo ofrece. Mostrar la base es la respuesta correcta — inventar un
    // recargo con un porcentaje que no se tiene sería peor.
    expect(aCobrarEnCentavos({ ...FILA, planId: 'plan-borrado' }, [PLAN])).toBe(1000000)
  })

  it('con un plan del 40 % suma el recargo', () => {
    expect(aCobrarEnCentavos({ ...FILA, planId: PLAN.id }, [PLAN])).toBe(1400000)
  })

  // El descuento por pago contado, que este producto trata como caso de
  // primera clase: el porcentaje lleva signo y el resultado BAJA.
  it('con un plan negativo descuenta', () => {
    const fila = { ...FILA, medio: 'EFECTIVO' as const, planId: DESCUENTO.id }
    expect(aCobrarEnCentavos(fila, [DESCUENTO])).toBe(900000)
  })

  /**
   * **El porcentaje va sobre los PESOS QUE ENTREGA la fila, no sobre la
   * base**, y éste es el caso que lo distingue: un pago en pesos que cubre el
   * total en dólares tiene la base en DÓLARES (300), y el recargo del 40 % se
   * calcula sobre los $445.500 que entrega, no sobre 300. Es la misma cuenta
   * cuya versión de `/vender` produjo un bug de plata en el merge del ciclo
   * móvil, y el caso del feedback que originó el ciclo del precio en dólares:
   * el iPhone de US$ 300 en 12 cuotas al 40 % se cobra $623.700.
   */
  it('sobre un pago que cruza, el recargo va sobre los pesos entregados y no sobre la base', () => {
    const cruce: PagoParaCorregir = {
      medio: 'TARJETA_CREDITO', moneda: 'ARS', cubre: 'USD',
      base: '300', cotizacion: '1485', planId: PLAN.id,
    }
    expect(aCobrarEnCentavos(cruce, [PLAN])).toBe(62370000)
  })
})

describe('planesDeLaFila: no ofrecer lo que el servidor va a rechazar', () => {
  const CREDITO: PlanVisible = {
    id: 'p1', nombre: 'Crédito 12', medio: 'TARJETA_CREDITO', cuotas: 12,
    porcentaje: '40', orden: 1, desactivadoEn: null,
  }
  const EFECTIVO: PlanVisible = { ...CREDITO, id: 'p2', nombre: 'Contado', medio: 'EFECTIVO', cuotas: 1, porcentaje: '-10' }
  const TODOS = [CREDITO, EFECTIVO]

  it('ofrece los del medio de la fila y ninguno más (PLAN_NO_CORRESPONDE)', () => {
    expect(planesDeLaFila({ medio: 'TARJETA_CREDITO', moneda: 'ARS' }, TODOS)).toEqual([CREDITO])
    expect(planesDeLaFila({ medio: 'EFECTIVO', moneda: 'ARS' }, TODOS)).toEqual([EFECTIVO])
  })

  it('un medio sin planes cargados no ofrece ninguno: la fila no dibuja el selector', () => {
    expect(planesDeLaFila({ medio: 'TRANSFERENCIA', moneda: 'ARS' }, TODOS)).toEqual([])
  })

  // La segunda mitad de la regla: el motor prohíbe el plan sobre un pago
  // ENTREGADO en dólares (PLAN_EN_DOLARES), porque ahí el recargo saldría en
  // dólares y volver a pesos exigiría dividir.
  it('un pago entregado en dólares no ofrece ninguno, aunque su medio tenga', () => {
    expect(planesDeLaFila({ medio: 'TARJETA_CREDITO', moneda: 'USD' }, TODOS)).toEqual([])
  })

  // Y NO mira `cubre`: un pago en pesos contra el total en dólares lleva su
  // plan sin problema — es justamente el iPhone financiado en doce cuotas.
  // Filtrar también por `cubre` le sacaría al mostrador el caso más caro.
  it('un pago en pesos que cubre el total en dólares sí los ofrece', () => {
    expect(planesDeLaFila({ medio: 'TARJETA_CREDITO', moneda: 'ARS' }, TODOS)).toEqual([CREDITO])
  })
})

/**
 * El CUERPO del diálogo se renderiza suelto y no adentro de `<CorregirPagos>`,
 * por el mismo motivo que `CamposDePlan` en `/formas-de-pago` y
 * `FilasDePermisos` en `/usuarios`: `DialogContent` (Radix) sólo se monta
 * cuando el diálogo está ABIERTO, así que renderizar el diálogo cerrado no
 * vería nada de esto y el caso daría un falso verde en vez de un bug real.
 */
const PAGO_ARS: PagoParaCorregir = {
  medio: 'EFECTIVO',
  moneda: 'ARS',
  cubre: 'ARS',
  base: '94000.00',
  cotizacion: '1',
  planId: null,
}

function renderCuerpo(props: Partial<Parameters<typeof CuerpoDeCorreccion>[0]> = {}) {
  return renderToStaticMarkup(
    <CuerpoDeCorreccion
      ventaId="00000000-0000-4000-8000-000000000001"
      totalArs="94000.00"
      totalUsd="0"
      pagos={[PAGO_ARS]}
      planes={[]}
      hayPagoSinPorcentaje={false}
      onCerrar={() => {}}
      {...props}
    />,
  )
}

describe('CuerpoDeCorreccion', () => {
  it('avisa cuando un pago se cobró antes de que se guardara el porcentaje', () => {
    const html = renderCuerpo({ hayPagoSinPorcentaje: true })
    expect(html).toContain('se recalcula con el porcentaje de hoy')
  })

  it('no dice nada de porcentajes cuando todos los pagos lo tienen', () => {
    const html = renderCuerpo({ hayPagoSinPorcentaje: false })
    expect(html).not.toContain('porcentaje de hoy')
  })

  // La nota corta donde corta el servidor: `TOPE_NOTA_DE_CORRECCION` vive una
  // sola vez (lib/ventas/correccion.ts) y lo leen el motor y este control, así
  // que el corte del `maxLength` no puede desincronizarse del corte real.
  it('la nota declara el mismo tope que aplica el motor', () => {
    // Case-insensitive: `renderToStaticMarkup` emite el atributo tal como se
    // escribe en el JSX (`maxLength`), no en minúsculas.
    expect(renderCuerpo()).toMatch(new RegExp(`maxlength="${TOPE_NOTA_DE_CORRECCION}"`, 'i'))
  })

  // Un local que no usa nada de esto ve un diálogo simple: sin `Cubre` (la
  // venta tiene un solo total), sin cotización (el pago no cruza monedas) y
  // sin selector de plan (no hay planes cargados).
  it('con una venta en pesos y sin planes no dibuja ningún control de más', () => {
    const html = renderCuerpo()
    expect(html).not.toContain('Cubre')
    expect(html).not.toContain('Cotización')
    expect(html).not.toContain('Plan')
  })

  it('con las dos monedas ofrece elegir qué total cubre cada pago', () => {
    const html = renderCuerpo({
      totalArs: '15000.00',
      totalUsd: '300.00',
      pagos: [PAGO_ARS, { ...PAGO_ARS, cubre: 'USD', base: '300.00', cotizacion: '1485' }],
    })
    expect(html).toContain('Cubre')
    // El segundo pago cruza monedas: ahí sí hay una conversión que tipear.
    expect(html).toContain('Cotización')
  })

  it('el chip dice cuánto falta cuando los pagos no llegan al total', () => {
    const html = renderCuerpo({ pagos: [{ ...PAGO_ARS, base: '90000.00' }] })
    expect(html).toContain('Faltan')
    expect(html).toContain(formatearPrecio('4000'))
  })

  // Sobre el ATRIBUTO y no sobre la palabra suelta: las clases de shadcn
  // dicen `disabled:pointer-events-none` en todos los botones, así que un
  // `toContain('disabled')` daría verde siempre.
  const SUBMIT_APAGADO = /type="submit" disabled=""/

  it('guardar arranca deshabilitado mientras el juego no cierre', () => {
    const html = renderCuerpo({ pagos: [{ ...PAGO_ARS, base: '90000.00' }] })
    expect(html).toContain('Guardar la corrección')
    expect(html).toMatch(SUBMIT_APAGADO)
  })

  it('guardar arranca habilitado cuando los pagos ya cierran', () => {
    const html = renderCuerpo()
    expect(html).toContain('Guardar la corrección')
    expect(html).not.toMatch(SUBMIT_APAGADO)
  })
})
