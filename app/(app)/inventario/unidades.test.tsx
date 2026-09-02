import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearFechaCorta } from '@/lib/formato/mostrar'

// Mismo criterio que formularios.test.tsx: acciones.ts es 'use server' y su
// contrato ya lo prueba acciones.test.ts contra una base real. Acá sólo
// importa qué renderiza cada componente.
vi.mock('./acciones', () => ({
  altaArticulo: vi.fn(),
  guardarArticulo: vi.fn(),
  bajaArticulo: vi.fn(),
  reactivarArticuloAccion: vi.fn(),
  ingresarMercaderia: vi.fn(),
  corregirPorConteo: vi.fn(),
  exportarHistorialCsv: vi.fn(),
  prenderSerieAccion: vi.fn(),
  apagarSerieAccion: vi.fn(),
  darDeBajaUnidadAccion: vi.fn(),
}))

type Unidad = { id: string; imei: string; ingresadaEn: Date }

async function renderCard(unidades: Unidad[]) {
  const { CardDeUnidades } = await import('./unidades')
  return renderToStaticMarkup(<CardDeUnidades articuloId="a1" unidades={unidades} />)
}

describe('CardDeUnidades', () => {
  it('la card lista los IMEI libres con su fecha de ingreso', async () => {
    const fecha = new Date('2026-09-01T12:00:00Z')
    const html = await renderCard([{ id: 'u1', imei: '355000000000001', ingresadaEn: fecha }])
    expect(html).toContain('355000000000001')
    // Con la MISMA función que usa el componente, no una fecha escrita a
    // mano: así el caso no puede pasar de casualidad si `formatearFechaCorta`
    // se borrara del componente sin que nadie lo note.
    expect(html).toContain(formatearFechaCorta(fecha))
  })

  it('cada unidad ofrece darla de baja', async () => {
    const html = await renderCard([
      { id: 'u1', imei: '355000000000001', ingresadaEn: new Date() },
    ])
    expect(html).toContain('Dar de baja')
  })

  it('sin unidades, dice qué hacer en vez de mostrar una lista vacía', async () => {
    const html = await renderCard([])
    expect(html).toContain('Todavía no cargaste ninguna unidad')
  })

  // Finding 1 de la review de Task 8: la primera versión duplicaba el IMEI y
  // la fecha en dos `<div>` (uno `lg:hidden`, otro `hidden lg:flex`) para
  // conseguir el apilado en el teléfono, y eso manufacturaba dos copias del
  // botón que después había que probar que estuvieran gateadas igual —
  // exactamente el patrón que CLAUDE.md registra como descartado a propósito
  // ("Un solo árbol, no dos presentaciones"). La fila es UN solo árbol ahora
  // (un `<div>` interno `flex-col lg:flex-row` para el par IMEI/fecha), así
  // que el botón aparece UNA sola vez.
  it('el botón de baja aparece UNA sola vez: un solo árbol, no dos copias', async () => {
    const html = await renderCard([{ id: 'u1', imei: 'A', ingresadaEn: new Date() }])
    expect(html.split('Dar de baja').length - 1).toBe(1)
  })

  it('con más de 8 unidades libres aparece el filtro por IMEI', async () => {
    const nueve = Array.from({ length: 9 }, (_, i) => ({
      id: `u${i}`,
      imei: `35500000000000${i}`,
      ingresadaEn: new Date(),
    }))
    const html = await renderCard(nueve)
    expect(html).toContain('Filtrar por IMEI')
  })

  it('con 8 unidades o menos no aparece el filtro', async () => {
    const ocho = Array.from({ length: 8 }, (_, i) => ({
      id: `u${i}`,
      imei: `35500000000000${i}`,
      ingresadaEn: new Date(),
    }))
    const html = await renderCard(ocho)
    expect(html).not.toContain('Filtrar por IMEI')
  })

  it('la nota de la baja es UN solo campo, no uno por copia del botón', async () => {
    const html = await renderCard([{ id: 'u1', imei: 'A', ingresadaEn: new Date() }])
    expect([...html.matchAll(/name="nota"/g)]).toHaveLength(1)
  })
})

describe('SwitchDeSerie', () => {
  async function renderSwitch(extra: Partial<{ llevaSerie: boolean; puedeEditar: boolean }> = {}) {
    const { SwitchDeSerie } = await import('./unidades')
    return renderToStaticMarkup(
      <SwitchDeSerie
        articuloId="a1"
        llevaSerie={extra.llevaSerie ?? false}
        stock="3"
        puedeEditar={extra.puedeEditar ?? true}
      />,
    )
  }

  it('se renderiza con su rótulo', async () => {
    const html = await renderSwitch()
    expect(html).toContain('Lleva IMEI o número de serie')
  })

  it('sin ARTICULOS_EDITAR el switch queda deshabilitado', async () => {
    const html = await renderSwitch({ puedeEditar: false })
    // El propio <Switch> (Radix) es un <button role="switch">: deshabilitado
    // significa el atributo REAL `disabled=""` en ese botón — no la clase
    // utilitaria `data-disabled:opacity-50` que el componente ya trae
    // siempre, esté o no deshabilitado, y que también contiene la substring
    // "disabled".
    const inicio = html.indexOf('role="switch"')
    expect(inicio).toBeGreaterThan(-1)
    const cierre = html.indexOf('>', inicio)
    expect(html.slice(inicio, cierre)).toMatch(/\sdisabled=""/)
  })

  it('con ARTICULOS_EDITAR el switch NO está deshabilitado', async () => {
    const html = await renderSwitch({ puedeEditar: true })
    const inicio = html.indexOf('role="switch"')
    expect(inicio).toBeGreaterThan(-1)
    const cierre = html.indexOf('>', inicio)
    expect(html.slice(inicio, cierre)).not.toMatch(/\sdisabled=""/)
  })
})

/**
 * Finding 2 de la review de Task 8: la confirmación en dos pasos de "Dar de
 * baja" no tenía NINGUNA cobertura — ni `if (armado) return` +
 * `preventDefault()`, ni el rótulo cambiando a "Confirmar baja", ni el
 * desarme a los 3 segundos, ni la limpieza del timer al desmontar. Borrar
 * `if (armado) return` convierte el primer toque en una baja inmediata e
 * irreversible, y ningún test anterior lo notaba.
 *
 * `renderToStaticMarkup` no puede ejercitar un click ni el paso del tiempo
 * (no hay DOM, y este repo no suma jsdom sólo para esto) — mismo "cableado,
 * no ejercitable sin DOM" que ya usa `lista-de-imeis.test.tsx`.
 */
describe('FilaDeUnidad: la baja en dos pasos (cableado, no ejercitable sin DOM)', () => {
  const FUENTE = readFileSync('app/(app)/inventario/unidades.tsx', 'utf8')

  it('el primer toque JAMÁS envía: corta con preventDefault antes de armar', () => {
    expect(FUENTE).toMatch(/if \(armado\) return\s*\n\s*e\.preventDefault\(\)\s*\n\s*armarConfirmacion\(\)/)
  })

  it('armar cambia el rótulo a "Confirmar baja"', () => {
    expect(FUENTE).toContain("armado ? 'Confirmar baja' : 'Dar de baja'")
  })

  it('el botón cambia de variant al armarse, para que se note de verdad', () => {
    expect(FUENTE).toContain("variant={armado ? 'destructive' : 'ghost'}")
  })

  it('se desarma solo a los 3000ms', () => {
    expect(FUENTE).toMatch(/desarmar\.current = setTimeout\(\(\) => setArmado\(false\), 3000\)/)
  })

  it('armar cancela cualquier desarme pendiente antes de programar el nuevo', () => {
    expect(FUENTE).toMatch(
      /function armarConfirmacion\(\) \{\s*\n\s*setArmado\(true\)\s*\n\s*if \(desarmar\.current\) clearTimeout\(desarmar\.current\)/,
    )
  })

  it('el timer se limpia al desmontar la fila', () => {
    expect(FUENTE).toMatch(
      /useEffect\(\(\) => \(\) => \{\s*\n\s*if \(desarmar\.current\) clearTimeout\(desarmar\.current\)\s*\n\s*\}, \[\]\)/,
    )
  })
})
