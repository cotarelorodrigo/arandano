import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Landing } from './landing'

vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const BASE = { protocolo: 'https', dominio: 'arandano.app', puerto: '' } as const

const html = () => renderToStaticMarkup(<Landing base={BASE} whatsapp="5491155555555" />)

/**
 * Test de integración: que la página compone las siete secciones en el orden
 * correcto y no rompe al juntarlas. El copy literal de cada sección —el H2,
 * la bajada, los doce rubros, los cuatro precios— ya está probado por
 * sección en `secciones.test.tsx`; repetirlo acá sería el mismo test dos
 * veces con más setup.
 */
describe('la landing', () => {
  it('abre con el H1 del hero, literal', () => {
    expect(html()).toContain('Todo el local en un solo lugar')
  })

  it('las siete secciones aparecen, en orden', () => {
    const markup = html()
    const titulares = [
      'Todo el local en un solo lugar', // Hero
      'Un núcleo, tres módulos, rubros ilimitados', // Módulos
      'Tu rubro ya está adentro', // Rubros
      'Precios claros, en pesos', // Planes
      'El alta es instantánea', // Cierre
      'Términos · Privacidad · Estado del servicio', // Pie
    ]
    const posiciones = titulares.map((t) => markup.indexOf(t))
    expect(posiciones.every((p) => p !== -1)).toBe(true)
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b))
  })

  it('lista los cuatro planes, con precio', () => {
    const markup = html()
    for (const plan of ['Básico', 'Negocio', 'Profesional', 'Premium']) {
      expect(markup).toContain(plan)
    }
    expect(markup).toContain('$ 24.900')
    expect(markup).toContain('Más elegido')
  })

  it('nombra los tres módulos', () => {
    const markup = html()
    for (const modulo of ['Órdenes de trabajo', 'Turnos', 'Gastronomía']) {
      expect(markup).toContain(modulo)
    }
  })

  // Task 5: el formulario de un solo campo aparece dos veces —Hero y
  // Cierre— con un texto de botón distinto en cada uno, tal como pide
  // design/arandano.pen.
  it('el formulario aparece dos veces: en el Hero y en el Cierre', () => {
    const markup = html()
    const apariciones = markup.match(/name="contacto"/g) ?? []
    expect(apariciones).toHaveLength(2)
    expect(markup).toContain('Quiero probarlo')
    expect(markup).toContain('Empezar')
  })

  // El marcador que distingue una página de tenant de una del ápex, y que
  // scripts/smoke.sh usa: la landing NO puede tenerlo.
  it('no se hace pasar por una página de tenant', () => {
    expect(html()).not.toContain('data-testid="tenant-nombre"')
  })
})
