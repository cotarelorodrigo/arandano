import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CotizacionDeVender } from './dolar'

// acciones.ts es 'use server' y su contrato lo fija cotizacion.test.ts contra
// una base real; acá sólo importa qué se renderiza.
vi.mock('./acciones', () => ({ cargarCotizacionDesdeVender: vi.fn() }))

const FUENTE = readFileSync('app/(app)/vender/dolar.tsx', 'utf8')

const DE_HOY = { id: 'c2', valor: '1450', creadaEn: new Date('2026-10-18T17:32:00Z'), cargadaPor: 'La dueña' }
const ANTERIOR = { id: 'c1', valor: '1420', creadaEn: new Date('2026-10-15T13:05:00Z'), cargadaPor: 'El encargado' }

function cotizacion(c: Partial<CotizacionDeVender> = {}): CotizacionDeVender {
  return { historial: [DE_HOY, ANTERIOR], vieja: false, puedeCargar: true, ...c }
}

async function chip(c: CotizacionDeVender) {
  const { ChipCotizacion } = await import('./dolar')
  return renderToStaticMarkup(<ChipCotizacion cotizacion={c} />)
}

async function chipMovil(c: CotizacionDeVender) {
  const { ChipCotizacionMovil } = await import('./dolar')
  return renderToStaticMarkup(<ChipCotizacionMovil cotizacion={c} />)
}

async function panel(c: CotizacionDeVender) {
  const { PanelDeCotizacion } = await import('./dolar')
  return renderToStaticMarkup(<PanelDeCotizacion cotizacion={c} />)
}

describe('el chip "USD" del header', () => {
  it('es un botón que abre el diálogo, con el valor de la vigente', async () => {
    const html = await chip(cotizacion())
    expect(html).toMatch(/^<button/)
    expect(html).toContain('aria-haspopup="dialog"')
    expect(html).toContain('USD')
    expect(html).toContain('1.450')
    // De hoy: sin ámbar y sin fecha.
    expect(html).not.toContain('bg-warn-soft')
    expect(html).not.toContain('18/10')
    expect(html).toContain('de hoy')
  })

  it('vieja: ámbar y con la fecha escrita en el chip', async () => {
    const html = await chip(cotizacion({ historial: [ANTERIOR], vieja: true }))
    expect(html).toContain('bg-warn-soft')
    expect(html).toContain('text-warn')
    expect(html).toContain('15/10')
    expect(html).toContain('no es de hoy')
  })

  it('sin ninguna: ámbar y "—", sin inventar un número', async () => {
    const html = await chip(cotizacion({ historial: [], vieja: true }))
    expect(html).toContain('bg-warn-soft')
    expect(html).toContain('—')
    expect(html).toContain('sin cargar')
    expect(html).not.toMatch(/\d\.\d{3}/)
  })

  // El POS se opera con teclado. Radix devuelve el foco al disparador al
  // cerrar, y con el foco en un <button> Enter no cobra (la allow-list de
  // `puedeDispararCobroDesdeFoco` sólo deja <body>) — reabría el diálogo.
  // Por fuente: el contenido de un Dialog vive en un Portal que
  // renderToStaticMarkup no monta.
  it('al cerrarse no le devuelve el foco al chip, para que Enter vuelva a cobrar', () => {
    expect(FUENTE).toMatch(/onCloseAutoFocus=\{\(e\) => e\.preventDefault\(\)\}/)
    // Y es un Dialog de Radix, el overlay que `hayOverlayDeRadixAbierto`
    // reconoce por [role="dialog"] mientras está abierto (verificado contra el
    // paquete instalado en caja.test.tsx).
    expect(FUENTE).toContain('<DialogContent')
  })
})

describe('el chip del cuerpo del teléfono', () => {
  it('es de sólo lectura, con el mismo valor y el mismo ámbar', async () => {
    const hoy = await chipMovil(cotizacion())
    expect(hoy).not.toContain('<button')
    expect(hoy).toContain('bg-card')
    expect(hoy).toContain('1.450')

    const vieja = await chipMovil(cotizacion({ historial: [ANTERIOR], vieja: true }))
    expect(vieja).toContain('bg-warn-soft')
    expect(vieja).toContain('15/10')
  })
})

describe('el panel de la cotización', () => {
  it('muestra la vigente con quién la cargó, y las últimas cargas con fecha, hora, valor y quién', async () => {
    const html = await panel(cotizacion())
    expect(html).toContain('US$ 1 =')
    expect(html).toContain('Cargada hoy a las 14:32 por La dueña')
    expect(html).toContain('Últimas cargas')
    // Las dos filas del historial, la más nueva primero.
    expect(html.indexOf('18/10/2026 14:32')).toBeGreaterThan(-1)
    expect(html.indexOf('15/10/2026 10:05')).toBeGreaterThan(html.indexOf('18/10/2026 14:32'))
    expect(html).toContain('El encargado')
    expect(html).toContain('1.420')
  })

  it('con el permiso, el campo para cargar una nueva', async () => {
    const html = await panel(cotizacion())
    expect(html).toContain('name="valor"')
    expect(html).toContain('Cargar')
  })

  it('sin el permiso, lo mismo sin el campo', async () => {
    const html = await panel(cotizacion({ puedeCargar: false }))
    expect(html).not.toContain('name="valor"')
    expect(html).not.toContain('<form')
    expect(html).toContain('Actualizar la cotización del dólar')
    // Y el historial lo ve igual: es la mitad del pedido.
    expect(html).toContain('Últimas cargas')
    expect(html).toContain('Cargada hoy')
  })

  it('vieja: lo dice con la fecha completa y avisa que el cobro no la usa sola', async () => {
    const html = await panel(cotizacion({ historial: [ANTERIOR], vieja: true }))
    expect(html).toContain('Cargada el 15/10/2026 a las 10:05 por El encargado')
    expect(html).toContain('No es de hoy')
  })

  it('sin ninguna: lo dice, y no muestra historial', async () => {
    const html = await panel(cotizacion({ historial: [], vieja: true }))
    expect(html).toContain('Todavía no hay ninguna cargada')
    expect(html).not.toContain('Últimas cargas')
  })

  // La confirmación del tope de cordura viaja SÓLO si se aprieta ese botón:
  // Enter en el campo envía con el primero, "Cargar", sin confirmar.
  it('la confirmación es un segundo botón con name="confirmada", después de "Cargar"', () => {
    const cargar = FUENTE.indexOf("{enviando ? 'Cargando…' : 'Cargar'}")
    const confirmar = FUENTE.indexOf('name="confirmada" value="1"')
    expect(cargar).toBeGreaterThan(-1)
    expect(confirmar).toBeGreaterThan(cargar)
    expect(FUENTE).not.toMatch(/type="hidden" name="confirmada"/)
  })

  it('los mensajes llevan su rol: el error y la pregunta se anuncian', () => {
    expect(FUENTE).toMatch(/<span role="alert"[^>]*>\s*\{estado\.error\}/)
    expect(FUENTE).toMatch(/<div role="alert"[^>]*>\s*<span[^>]*>\{pregunta\}/)
    expect(FUENTE).toMatch(/<span role="status"[^>]*>\s*\{estado\.aviso\}/)
  })
})
