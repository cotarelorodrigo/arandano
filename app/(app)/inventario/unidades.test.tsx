import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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
    const html = await renderCard([
      { id: 'u1', imei: '355000000000001', ingresadaEn: new Date('2026-09-01T12:00:00Z') },
    ])
    expect(html).toContain('355000000000001')
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

  // La regla del merge del ciclo móvil, contada en las dos direcciones: acá
  // no hay permiso de por medio, pero sí dos ejes de layout (escritorio y
  // teléfono) que necesitan su propia copia del botón.
  it('las DOS copias del botón de baja: escritorio y teléfono', async () => {
    const html = await renderCard([{ id: 'u1', imei: 'A', ingresadaEn: new Date() }])
    expect(html.split('Dar de baja').length - 1).toBe(2)
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
