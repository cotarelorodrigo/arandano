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
  CuerpoDeCorreccion,
  type PagoParaCorregir,
} from './corregir-pagos'

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
