// Puro: importa sólo las funciones exportadas de page.tsx, nunca el
// componente de página en sí —es un Server Component async que abre sesión y
// consulta Prisma, y este repo no tiene el arnés para montarlo fuera de un
// request real (mismo criterio que ya documentan las funciones puras de
// app/(app)/vender/punto-de-venta.tsx: se prueba la REGLA, no el cableado
// completo de principio a fin, que queda cubierto por scripts/smoke.sh).
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  rangoDeChip, chipActivo, pieDeCobradas, pieDeAnuladas, rotuloDeMedios, ventanaDePaginas,
} from './page'

const HOY = '2026-08-21'

describe('rangoDeChip', () => {
  it('"hoy" es un solo día', () => {
    expect(rangoDeChip('hoy', HOY)).toEqual({ desde: HOY, hasta: HOY })
  })

  it('"7dias" son los últimos 7 días, HOY incluido', () => {
    // Del 15 al 21 son 7 días (21, 20, 19, 18, 17, 16, 15), no 6 ni 8: por eso
    // resta 6 días y no 7.
    expect(rangoDeChip('7dias', HOY)).toEqual({ desde: '2026-08-15', hasta: HOY })
  })

  it('"estemes" arranca el día 1 del mes de hoy', () => {
    expect(rangoDeChip('estemes', HOY)).toEqual({ desde: '2026-08-01', hasta: HOY })
  })

  it('"7dias" cruza el borde de mes sin perderse', () => {
    expect(rangoDeChip('7dias', '2026-09-02')).toEqual({ desde: '2026-08-27', hasta: '2026-09-02' })
  })
})

describe('chipActivo', () => {
  it('reconoce el rango que arma cada chip', () => {
    expect(chipActivo(HOY, HOY, HOY)).toBe('hoy')
    expect(chipActivo('2026-08-15', HOY, HOY)).toBe('7dias')
    expect(chipActivo('2026-08-01', HOY, HOY)).toBe('estemes')
  })

  it('ningún chip para un rango tipeado a mano', () => {
    expect(chipActivo('2026-08-10', '2026-08-12', HOY)).toBeNull()
  })
})

describe('pieDeCobradas', () => {
  it('calcula el promedio sobre lo cobrado', () => {
    // Los mismos números que design/arandano.pen, nodo `nINsZ`: 44 ventas
    // cobradas por $ 1.284.500,00 en total dan $ 29.193,18 de promedio. Sin
    // el string exacto (el espacio entre "$" y el número es NBSP, cosa de
    // ICU, no del formateador) — mismo criterio que lib/formato/mostrar.test.ts.
    const pie = pieDeCobradas('1284500', 44)
    expect(pie).toMatch(/^promedio \$/)
    expect(pie).toContain('29.193,18')
  })

  it('sin ninguna venta cobrada no hay promedio que mostrar, y no NaN', () => {
    // Todo el período pudo haberse anulado entero: 0 cobradas es un estado
    // real, no un caso imposible. "promedio $ NaN" es peor que ningún pie.
    expect(pieDeCobradas('0', 0)).toBeUndefined()
  })

  // Minor 3 de la review de Task 8: `Number(sumaCobradas) / cobradas` seguido
  // de `.toFixed(2)` es aritmética de punto flotante sobre plata, contra la
  // regla del ciclo ("plata en Decimal, nunca number con decimales"). No es un
  // caso de laboratorio: 2010 / 2000 = 1,005 EXACTO en decimal (redondea a
  // 1,01 con ROUND_HALF_UP, la regla que usa el resto del motor), pero el
  // double más cercano a 1.005 es un poquito MENOR, así que
  // `(2010/2000).toFixed(2)` da "1.00" en JS — confirmado en el propio
  // intérprete node antes de este fix. Con Decimal.div + redondearDinero (la
  // MISMA función que usa el resto de lib/ventas/totales.ts) el promedio
  // redondea para el lado correcto.
  it('redondea el promedio con la MISMA regla que el resto de la plata (ROUND_HALF_UP), no con Number().toFixed()', () => {
    const pie = pieDeCobradas('2010', 2000)
    expect(pie).toContain('1,01')
    expect(pie).not.toContain('1,00')
  })
})

describe('pieDeAnuladas', () => {
  it('formatea lo devuelto, no el total del período', () => {
    const pie = pieDeAnuladas('61200')
    expect(pie).toContain('61.200,00')
    expect(pie).toContain('devueltos')
  })

  it('sin anuladas, devuelve $ 0,00 y no rompe', () => {
    expect(pieDeAnuladas('0')).toContain('0,00')
  })
})

describe('rotuloDeMedios', () => {
  it('un solo medio en pesos', () => {
    expect(rotuloDeMedios([{ medio: 'EFECTIVO', moneda: 'ARS' }])).toBe('Efectivo')
  })

  it('un medio con algún pago en dólares lo marca', () => {
    // La fila #1040 del relevamiento: "Efectivo · US$" — dos pagos en
    // efectivo, uno en pesos y otro en dólares, es UN medio con la marca.
    expect(
      rotuloDeMedios([
        { medio: 'EFECTIVO', moneda: 'ARS' },
        { medio: 'EFECTIVO', moneda: 'USD' },
      ]),
    ).toBe('Efectivo · US$')
  })

  it('dos medios distintos se listan los dos, en el orden de los pagos', () => {
    expect(
      rotuloDeMedios([
        { medio: 'TRANSFERENCIA', moneda: 'ARS' },
        { medio: 'EFECTIVO', moneda: 'ARS' },
      ]),
    ).toBe('Transferencia + Efectivo')
  })

  it('sin pagos, una raya y no una cadena vacía', () => {
    expect(rotuloDeMedios([])).toBe('—')
  })

  it('rotula en castellano, nunca el nombre del enum', () => {
    expect(rotuloDeMedios([{ medio: 'TARJETA_CREDITO', moneda: 'ARS' }])).not.toContain('TARJETA')
  })
})

describe('ventanaDePaginas', () => {
  it('sin páginas, ventana vacía', () => {
    expect(ventanaDePaginas(1, 0)).toEqual([])
  })

  it('con pocas páginas, las muestra todas', () => {
    expect(ventanaDePaginas(1, 3)).toEqual([1, 2, 3])
  })

  it('centra la ventana en la página actual', () => {
    expect(ventanaDePaginas(5, 10)).toEqual([3, 4, 5, 6, 7])
  })

  it('no se pasa del límite inferior', () => {
    expect(ventanaDePaginas(1, 10)).toEqual([1, 2, 3, 4, 5])
  })

  it('no se pasa del límite superior', () => {
    expect(ventanaDePaginas(10, 10)).toEqual([6, 7, 8, 9, 10])
  })
})

// Task 8 (las ventas muestran el recargo): mismo criterio que el bloque de
// regresión de app/(app)/ventas/[id]/page.test.tsx — la pantalla es un Server
// Component async que abre sesión y consulta Prisma, así que lo que un test
// puro no puede aserverar (que la columna Total y el tile de arriba usen
// `totalCobrado()`, y que el select pida `recargo`) se cablea leyendo el
// fuente como texto.
describe('la columna Total y el tile del período muestran lo cobrado', () => {
  const fuente = readFileSync('app/(app)/ventas/page.tsx', 'utf8')

  it('el select del listado pide recargo', () => {
    expect(fuente).toContain(
      'id: true, numero: true, total: true, recargo: true, creadoEn: true, anuladaEn: true,',
    )
  })

  it('la celda Total usa totalCobrado(v), no v.total a secas', () => {
    expect(fuente).toContain('formatearPrecio(totalCobrado(v).toString())')
    expect(fuente).not.toContain('formatearPrecio(v.total.toString())')
  })

  it('el tile "Total del período" muestra sumaCobrada', () => {
    const posTile = fuente.indexOf('rotulo="Total del período"')
    const posValor = fuente.indexOf('valor={formatearPrecio(sumaCobrada.toString())}', posTile)
    expect(posValor).toBeGreaterThan(posTile)
  })

  // Los dos call sites que van MÁS ALLÁ de lo que pedía el brief (el brief
  // sólo nombraba la columna Total y el tile de arriba): sin este par, revertir
  // cualquiera de los dos a la expresión vieja (`suma._sum.total` /
  // `devueltas._sum.total` a secas) deja el resto de la suite en verde — nada
  // más lo notaría. Mismo criterio que la celda Total: positivo + negativo,
  // para que no alcance con que la cadena nueva aparezca en CUALQUIER lado del
  // archivo.
  it('el pie de "Ventas cobradas" recibe sumaCobrada, no suma._sum.total a secas', () => {
    expect(fuente).toContain('pieDeCobradas(sumaCobrada.toString(), cobradas)')
    expect(fuente).not.toContain("pieDeCobradas((suma._sum.total ?? '0').toString(), cobradas)")
  })

  it('el pie de "Anuladas" recibe devueltoCobrado, no devueltas._sum.total a secas', () => {
    expect(fuente).toContain('pieDeAnuladas(devueltoCobrado.toString())')
    expect(fuente).not.toContain("pieDeAnuladas((devueltas._sum.total ?? '0').toString())")
  })
})
