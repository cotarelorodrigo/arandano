import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Prisma } from '@/generated/prisma/client'
import { formatearPrecio } from '@/lib/formato/mostrar'
import {
  ChipMotivo,
  textoDeMotivo,
  formatearFechaMovimiento,
  detalleDeMovimiento,
  calcularSaldos,
  filaDeMovimiento,
  HistorialDeMovimientos,
  type FilaDeMovimiento,
} from './historial'

const d = (v: string) => new Prisma.Decimal(v)

describe('calcularSaldos (Task 5 del rediseño: la columna "Queda")', () => {
  // El caso encadenado del relevamiento (sección 1.c), en el mismo orden en
  // que la consulta real trae los movimientos: `creadoEn desc`, o sea del más
  // nuevo al más viejo. HOkal (venta, -1) es el más nuevo y deja el stock en
  // 48 — el mismo número que el tile "En stock". VukbC (ingreso, +24) queda
  // en 49; s8WsU (ajuste, -3) en 25; S2LS3L (anulación, +1) en 28. Los cuatro
  // saldos encadenan exacto: 48-(-1)=49, 49-24=25, 25-(-3)=28.
  it('cierra contra el stock actual recorriendo los deltas hacia atrás', () => {
    const deltasDesc = [d('-1'), d('24'), d('-3'), d('1')]
    const saldos = calcularSaldos(deltasDesc, d('48'))
    expect(saldos.map((s) => s.toString())).toEqual(['48', '49', '25', '28'])
  })

  it('sin movimientos, no rompe: da un arreglo vacío', () => {
    expect(calcularSaldos([], d('48'))).toEqual([])
  })

  it('un solo movimiento: su saldo ES el stock actual', () => {
    const saldos = calcularSaldos([d('5')], d('10'))
    expect(saldos[0].toString()).toBe('10')
  })
})

describe('detalleDeMovimiento (Task 5 del rediseño: la celda "Detalle")', () => {
  const usuario = { nombre: 'Florencia' }

  it('VENTA: número de venta y quién la hizo', () => {
    expect(
      detalleDeMovimiento({
        motivo: 'VENTA', nota: null, costoUnitario: null, usuario, venta: { numero: 1042 },
      }, true),
    ).toBe('Venta #1042 · Florencia')
  })

  it('ANULACION_VENTA: sólo el número de venta, sin el usuario', () => {
    expect(
      detalleDeMovimiento({
        motivo: 'ANULACION_VENTA', nota: null, costoUnitario: null, usuario, venta: { numero: 1002 },
      }, true),
    ).toBe('Anulación de la venta #1002')
  })

  it('INGRESO con nota y costo: los combina, sin nombrar a quién lo hizo', () => {
    const texto = detalleDeMovimiento({
      motivo: 'INGRESO',
      nota: 'Factura A 0001-00023145',
      costoUnitario: d('7400'),
      usuario,
      venta: null,
    }, true)
    // formatearPrecio() y no un literal con espacio a mano: Intl mete un
    // espacio de no separación (NBSP) entre "$" y el número, y un literal
    // con espacio normal nunca iguala byte a byte.
    expect(texto).toBe(`Factura A 0001-00023145 · ${formatearPrecio('7400')} c/u`)
  })

  it('INGRESO sin nota ni costo: cae a quién lo hizo, la celda no queda vacía', () => {
    expect(
      detalleDeMovimiento({ motivo: 'INGRESO', nota: null, costoUnitario: null, usuario, venta: null }, true),
    ).toBe('Ingreso · Florencia')
  })

  it('AJUSTE con nota: nota y quién contó', () => {
    expect(
      detalleDeMovimiento({
        motivo: 'AJUSTE', nota: 'Conteo de fin de mes', costoUnitario: null, usuario, venta: null,
      }, true),
    ).toBe('Conteo de fin de mes · Florencia')
  })

  it('AJUSTE sin nota: sólo quién contó', () => {
    expect(
      detalleDeMovimiento({ motivo: 'AJUSTE', nota: null, costoUnitario: null, usuario, venta: null }, true),
    ).toBe('Florencia')
  })
})

describe('el costo en la celda Detalle', () => {
  const INGRESO = {
    motivo: 'INGRESO',
    nota: 'Factura A-0001',
    costoUnitario: new Prisma.Decimal('7400'),
    usuario: { nombre: 'Ana' },
    venta: null,
  }

  it('con permiso, el costo va junto a la nota', () => {
    expect(detalleDeMovimiento(INGRESO, true)).toContain('7.400')
    expect(detalleDeMovimiento(INGRESO, true)).toContain('Factura A-0001')
  })

  it('sin permiso, queda la nota y desaparece el costo', () => {
    expect(detalleDeMovimiento(INGRESO, false)).toBe('Factura A-0001')
  })

  // El caso que importa de verdad: sin nota Y sin permiso, la celda no puede
  // quedar vacía. Cae al mismo fallback que ya existe para un ingreso al que
  // nadie le cargó el costo, así que no revela por omisión que hay un costo
  // escondido — se ve idéntico a un ingreso sin costo.
  it('sin nota y sin permiso, cae al fallback de siempre', () => {
    expect(detalleDeMovimiento({ ...INGRESO, nota: null }, false)).toBe('Ingreso · Ana')
  })

  // Los otros motivos no llevan costo, así que el permiso no los toca.
  it('una venta se ve igual con permiso y sin él', () => {
    const venta = {
      motivo: 'VENTA', nota: null, costoUnitario: null,
      usuario: { nombre: 'Ana' }, venta: { numero: 12 },
    }
    expect(detalleDeMovimiento(venta, false)).toBe(detalleDeMovimiento(venta, true))
  })
})

describe('formatearFechaMovimiento', () => {
  it('día y mes con cero a la izquierda, sin año, unidos a la hora con " · "', () => {
    // 21/08/2026 14:28 en Buenos Aires (UTC-3) es las 17:28 UTC.
    expect(formatearFechaMovimiento(new Date('2026-08-21T17:28:00Z'))).toBe('21/08 · 14:28')
  })
})

describe('ChipMotivo', () => {
  it.each([
    ['VENTA', 'Venta'],
    ['INGRESO', 'Ingreso'],
    ['AJUSTE', 'Ajuste'],
    ['ANULACION_VENTA', 'Anulación'],
  ])('%s se ve como "%s"', (motivo, texto) => {
    expect(renderToStaticMarkup(<ChipMotivo motivo={motivo} />)).toContain(texto)
  })

  it('un motivo desconocido no revienta: se ve como texto plano', () => {
    expect(renderToStaticMarkup(<ChipMotivo motivo="OTRO" />)).toContain('OTRO')
  })
})

describe('textoDeMotivo', () => {
  it('devuelve el texto plano, sin ícono', () => {
    expect(textoDeMotivo('VENTA')).toBe('Venta')
    expect(textoDeMotivo('ANULACION_VENTA')).toBe('Anulación')
  })
})

/**
 * Task 7 del ciclo móvil: la fila del historial ya resuelta a texto, la
 * misma idea que `FilaDeVenta`/`ItemVendido` en /ventas — así
 * `HistorialDeMovimientos` (más abajo) puede renderizarse sin Prisma ni
 * sesión, y esta función queda testeable con Decimales reales, sin pasar por
 * un render.
 */
describe('filaDeMovimiento (Task 7 del ciclo móvil)', () => {
  const base = {
    id: 'm1',
    motivo: 'VENTA',
    nota: null,
    costoUnitario: null,
    usuario: { nombre: 'Florencia' },
    venta: { numero: 1042 },
    creadoEn: new Date('2026-08-21T17:28:00Z'),
  }

  it('arma fecha, motivo, detalle, cambio (con signo) y queda, a partir del movimiento y el saldo', () => {
    const fila = filaDeMovimiento({ ...base, delta: d('-1') }, d('48'), true)
    expect(fila).toEqual<FilaDeMovimiento>({
      id: 'm1',
      fechaTexto: '21/08 · 14:28',
      motivo: 'VENTA',
      detalleTexto: 'Venta #1042 · Florencia',
      cambioTexto: '-1',
      negativo: true,
      quedaTexto: '48',
    })
  })

  it('un delta positivo lleva el signo "+" y negativo=false', () => {
    const fila = filaDeMovimiento(
      { ...base, motivo: 'INGRESO', venta: null, delta: d('24') },
      d('49'),
      true,
    )
    expect(fila.cambioTexto).toBe('+24')
    expect(fila.negativo).toBe(false)
  })

  // Ciclo de permisos (2026-08-26): el costo de un INGRESO se resuelve a
  // texto ACÁ, no en el JSX, así que si `mostrarCostos` no llegara hasta
  // `detalleDeMovimiento` el número viajaría igual al HTML del teléfono y de
  // escritorio (las dos leen la MISMA `FilaDeMovimiento`). Este caso es lo
  // que ata el cableado.
  it('sin el permiso COSTOS, el detalle del ingreso no lleva el costo', () => {
    const ingreso = {
      ...base,
      motivo: 'INGRESO',
      venta: null,
      nota: 'Factura A-0001',
      costoUnitario: d('7400'),
      delta: d('24'),
    }
    expect(filaDeMovimiento(ingreso, d('49'), true).detalleTexto).toContain('7.400')
    expect(filaDeMovimiento(ingreso, d('49'), false).detalleTexto).toBe('Factura A-0001')
  })
})

/**
 * Task 7 del ciclo móvil: la card completa del historial, extraída de
 * `[id]/page.tsx` como componente puro y renderizable (sin Prisma, sin
 * sesión) — mismo criterio que `Listado` de este mismo módulo (docblock de
 * cabecera de `page.tsx`) y que evita la trampa de dos reviews de este ciclo:
 * cubrir el patrón grid + `display:contents` por `readFileSync` en vez de por
 * HTML real.
 */
describe('HistorialDeMovimientos (Task 7 del ciclo móvil)', () => {
  const FILA: FilaDeMovimiento = {
    id: 'm1',
    fechaTexto: '21/08 · 14:28',
    motivo: 'VENTA',
    detalleTexto: 'Venta #1042 · Florencia',
    cambioTexto: '-1',
    negativo: true,
    quedaTexto: '48',
  }

  it('sin filas, muestra el vacío y no el grid', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(html).toContain('Todavía no hubo movimientos de este artículo.')
    expect(html).not.toContain('role="table"')
  })

  it('con filas, arma el grid con role="table"/"row"/"columnheader"/"cell" (patrón de la Task 4)', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[FILA]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(html).toContain('role="table"')
    expect(html).toContain('role="columnheader"')
    // 5 celdas de escritorio por fila (Fecha, Motivo, Detalle, Cambio, Queda).
    expect([...html.matchAll(/role="cell"/g)]).toHaveLength(5)
  })

  it('el motivo se ve con ChipMotivo (badge), no como texto plano', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[FILA]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(html).toContain('Venta')
    expect(html).toMatch(/<span[^>]*>[\s\S]*?Venta[\s\S]*?<\/span>/)
  })

  it('el cambio negativo pinta destructive y el positivo ok', () => {
    const negativo = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[FILA]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(negativo).toContain('text-destructive')

    const positiva: FilaDeMovimiento = { ...FILA, id: 'm2', cambioTexto: '+24', negativo: false }
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[positiva]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(html).toContain('text-ok')
  })

  it('con el límite alcanzado, avisa cuántos se muestran', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[FILA]} limiteAlcanzado={true} limiteVisible={50} />,
    )
    expect(html).toContain('Se muestran los últimos 50 movimientos')
  })

  it('sin alcanzar el límite, no muestra el aviso', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[FILA]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(html).not.toContain('Se muestran los últimos')
  })

  it('la acción (Exportar CSV) se arma afuera y se recibe ya lista, en el encabezado', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos
        filas={[FILA]}
        limiteAlcanzado={false}
        limiteVisible={50}
        accion={<button type="button">Exportar CSV →</button>}
      />,
    )
    const posTitulo = html.indexOf('Historial de movimientos')
    const posAccion = html.indexOf('Exportar CSV →')
    expect(posTitulo).toBeGreaterThan(-1)
    expect(posAccion).toBeGreaterThan(posTitulo)
  })

  // Las cuatro reglas del docblock de `Listado` (app/(app)/ventas/page.tsx):
  // el borde va en las celdas, no en la fila (display:contents no pinta), y
  // todo group-hover/transition lleva el prefijo lg:.
  it('el borde y el hover llevan el prefijo lg: (display:contents no pinta nada propio)', () => {
    const html = renderToStaticMarkup(
      <HistorialDeMovimientos filas={[FILA]} limiteAlcanzado={false} limiteVisible={50} />,
    )
    expect(html).toContain('lg:border-b')
    expect(html).toContain('lg:group-hover:bg-muted/50')
    expect(html).toContain('lg:transition-colors')
    expect(html).not.toMatch(/max-lg:/)
  })
})
