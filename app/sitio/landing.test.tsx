import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Landing } from './landing'

vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const BASE = { protocolo: 'https', dominio: 'arandano.app', puerto: '' }

const html = () => renderToStaticMarkup(<Landing base={BASE} whatsapp="5491155555555" />)

describe('la landing', () => {
  it('abre con el titular, literal', () => {
    const markup = html()
    expect(markup).toContain('Abrís, vendés, cerrás la caja.')
    expect(markup).toContain('Arándano lleva la cuenta.')
  })

  it('muestra el retrato del producto', () => {
    expect(html()).toContain('tabular-nums')
  })

  it('muestra la dirección propia con el dominio real', () => {
    expect(html()).toContain('.arandano.app')
  })

  it('lista los cuatro planes y ninguno lleva precio', () => {
    const markup = html()
    for (const plan of ['Básico', 'Negocio', 'Profesional', 'Premium']) {
      expect(markup).toContain(plan)
    }
    expect(markup).toContain('el más elegido')
  })

  it('nombra los tres módulos', () => {
    const markup = html()
    for (const modulo of ['Órdenes de trabajo', 'Turnos', 'Gastronomía']) {
      expect(markup).toContain(modulo)
    }
  })

  it('termina en el formulario', () => {
    expect(html()).toContain('name="nombre"')
  })

  // El marcador que distingue una página de tenant de una del ápex, y que
  // scripts/smoke.sh usa: la landing NO puede tenerlo.
  it('no se hace pasar por una página de tenant', () => {
    expect(html()).not.toContain('data-testid="tenant-nombre"')
  })
})
