// Puro: importa sólo las funciones exportadas de page.tsx, nunca el
// componente de página en sí —es un Server Component async que abre sesión y
// consulta Prisma, y este repo no tiene el arnés para montarlo fuera de un
// request real (mismo criterio que ya documentan las funciones puras de
// app/(app)/vender/punto-de-venta.tsx: se prueba la REGLA, no el cableado
// completo de principio a fin, que queda cubierto por scripts/smoke.sh).
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
