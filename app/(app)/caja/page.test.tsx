import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { FilaDeCierre, periodoDelFiltro, SinCierres } from './page'
import type { CierreDeCaja } from '@/lib/caja/historial'

/**
 * `Caja` (el default export) es un Server Component async que abre sesión con
 * `exigirDuenio()` y consulta Prisma — este repo no tiene el arnés para
 * montarlo fuera de un request real (mismo criterio que
 * app/(app)/usuarios/page.test.tsx). La guarda se fija sobre el FUENTE; la
 * consulta, contra la base, en lib/caja/historial.test.ts; y lo que se dibuja,
 * con los componentes exportados.
 */

const FUENTE = readFileSync('app/(app)/caja/page.tsx', 'utf8')
const legible = (html: string) => html.replace(/ /g, ' ')

describe('/caja es sólo del dueño', () => {
  // Spec, decisión 5: las diferencias de caja de cada empleado son
  // información de gestión. La pestaña se esconde (navegacion.test.tsx), y la
  // página re-exige porque la URL se tipea.
  it('la página exige dueño, no sólo sesión', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export default async function Caja'))
    expect(cuerpo).toContain('await exigirDuenio()')
    expect(cuerpo).not.toContain('exigirSesion()')
  })
})

describe('el filtro por fecha', () => {
  it('por defecto, los últimos 30 días con hoy incluido', () => {
    const p = periodoDelFiltro({}, '2026-10-18')
    expect(p.dDesde).toBe('2026-09-19')
    expect(p.dHasta).toBe('2026-10-18')
    // El "hasta" entra entero: se corta al inicio del día siguiente, en hora
    // argentina.
    expect(p.desde.toISOString()).toBe('2026-09-19T03:00:00.000Z')
    expect(p.hasta.toISOString()).toBe('2026-10-19T03:00:00.000Z')
  })

  it('respeta el rango pedido', () => {
    const p = periodoDelFiltro({ desde: '2026-10-01', hasta: '2026-10-05' }, '2026-10-18')
    expect([p.dDesde, p.dHasta]).toEqual(['2026-10-01', '2026-10-05'])
  })

  it('lo malformado cae al default, y un rango dado vuelta se endereza', () => {
    expect(periodoDelFiltro({ desde: '2026-13-45' }, '2026-10-18').dDesde).toBe('2026-09-19')
    const p = periodoDelFiltro({ desde: '2026-10-20', hasta: '2026-10-10' }, '2026-10-18')
    expect([p.dDesde, p.dHasta]).toEqual(['2026-10-10', '2026-10-20'])
  })

  it('es un formulario GET con desde y hasta: funciona sin JavaScript', () => {
    expect(FUENTE).toContain('<form method="get"')
    expect(FUENTE).toContain('name="desde"')
    expect(FUENTE).toContain('name="hasta"')
  })
})

function cierre(c: Partial<CierreDeCaja> = {}): CierreDeCaja {
  return {
    id: 'c1',
    abiertaEn: new Date('2026-10-18T12:00:00Z'),
    cerradaEn: new Date('2026-10-18T23:00:00Z'),
    abiertaPor: 'Flor',
    cerradaPor: 'Nahuel',
    apertura: { ars: '10000.00', usd: '0.00' },
    arqueo: {
      esperado: { ars: '55000.00', usd: '0.00' },
      contado: { ars: '55000.00', usd: '0.00' },
      retirado: { ars: '45000.00', usd: '0.00' },
      nota: null,
    },
    movimientos: [],
    conDolares: false,
    ...c,
  }
}

function fila(c: CierreDeCaja, conDolares = false) {
  return legible(renderToStaticMarkup(<FilaDeCierre cierre={c} conDolares={conDolares} />))
}

describe('una fila del historial', () => {
  // El ejemplo del pedido, visto desde el historial.
  it('fecha, quiénes y las seis cifras: cuadra y quedan 10.000', () => {
    const html = fila(cierre())
    expect(html).toContain('18/10/2026 09:00 → 20:00')
    expect(html).toContain('Abrió Flor · cerró Nahuel')
    for (const r of ['Apertura', 'Esperado', 'Contado', 'Diferencia', 'Retirado', 'Queda']) {
      expect(html).toContain(r)
    }
    expect(html).toContain('cuadra')
    expect(html).toContain('$ 10.000,00')
    expect(html).not.toContain('bg-warn-soft')
  })

  // Spec, decisión 5: la diferencia resaltada si no es cero.
  it('una diferencia distinta de cero va resaltada, en ámbar', () => {
    const html = fila(
      cierre({
        arqueo: {
          esperado: { ars: '55000.00', usd: '0.00' },
          contado: { ars: '54800.00', usd: '0.00' },
          retirado: { ars: '0.00', usd: '0.00' },
          nota: 'Faltó cambio',
        },
      }),
    )
    expect(html).toMatch(/bg-warn-soft[^>]*>faltan \$ 200,00/)
    expect(html).toContain('Nota: Faltó cambio')
  })

  it('una caja cerrada sin arqueo lo dice, y no inventa cifras', () => {
    const html = fila(cierre({ arqueo: null }))
    expect(html).toContain('Cerrada sin arqueo.')
    expect(html).not.toContain('Esperado')
  })

  it('los dólares, sólo si la pantalla los tiene', () => {
    expect(fila(cierre())).not.toContain('Dólares')
    expect(fila(cierre(), true)).toContain('Dólares')
  })

  it('los movimientos van plegados en el detalle de la caja', () => {
    const html = fila(
      cierre({
        movimientos: [
          {
            id: 'm1', tipo: 'EGRESO', moneda: 'ARS', monto: '5000.00', nota: 'Delivery',
            usuario: 'Flor', creadoEn: new Date('2026-10-18T15:00:00Z'),
          },
        ],
      }),
    )
    expect(html).toContain('<details')
    expect(html).toContain('1 movimiento')
    expect(html).toContain('− $ 5.000,00')
  })

  it('sin cierres, dice dónde se abre y cierra la caja', () => {
    expect(renderToStaticMarkup(<SinCierres />)).toContain('desde Vender')
  })
})
