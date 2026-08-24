import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
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

  // I5 de la review final: el frame raíz del .pen (vDLU8) pinta $ar-surface
  // (--card); sin esto la landing entera terminaba en --background (el
  // <body> es bg-background), y las dos bg-background de Módulos/Planes no
  // pintaban nada distinto de lo que ya había — el bandeado blanco/gris de
  // la maqueta desaparecía por completo.
  it('la raíz pinta bg-card: sin esto el bandeado blanco/gris desaparece', () => {
    const markup = html()
    const raiz = markup.match(/^<div class="([^"]*)"/)?.[1]
    expect(raiz, 'no se encontró el <div> raíz de la landing').toBeTruthy()
    expect(raiz).toContain('bg-card')
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

  // Critical C2 de la review final: `Formulario` cableaba `id="contacto"` a
  // mano, y esta página lo renderiza dos veces (Hero y Cierre) más el
  // `<section id="contacto">` del propio Cierre — tres elementos con el mismo
  // id. Como un fragmento resuelve al PRIMERO en orden de documento, los
  // cinco `href="#contacto"` (el CTA del Nav y los cuatro de Planes) saltaban
  // al input del Hero en vez de bajar al Cierre, y el `<label>` del Cierre
  // quedaba asociado al input equivocado. La regla general —ningún id se
  // repite en el documento— es más fuerte que afirmar sólo el caso de
  // "contacto": también hubiera atrapado el mismo choque en "sitio-web" (el
  // honeypot, que también se duplica).
  it('ningún id se repite en toda la página (Critical C2 del cierre)', () => {
    const markup = html()
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
    expect(ids.length).toBeGreaterThan(0)
    const duplicados = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(duplicados).toEqual([])
  })

  // Y en particular, el único id="contacto" que sobrevive es el de la
  // <section> del Cierre —el ancla de los cinco CTA—, no el de ningún input.
  it('id="contacto" lo lleva sólo la <section> del Cierre, no ningún input', () => {
    const markup = html()
    const apariciones = markup.match(/\sid="contacto"/g) ?? []
    expect(apariciones).toHaveLength(1)
    const idx = markup.indexOf('id="contacto"')
    expect(markup.slice(Math.max(0, idx - 12), idx)).toContain('<section')
  })

  // Ata scripts/smoke.sh (paso 9 del gate de deploy) al markup real: C1 de la
  // review final fue exactamente este acople roto — smoke.sh buscaba
  // `name="nombre"`, un campo que la Task 5 de este mismo ciclo había
  // borrado, y ningún `npm test` lo vio porque nada corre smoke.sh. Este test
  // no copia el patrón a mano: lo LEE del script y lo corre contra el HTML de
  // verdad, así que un futuro cambio de campo en cualquiera de los dos lados
  // se nota acá, no en el próximo deploy.
  it('el patrón que scripts/smoke.sh busca en la home (caso_home_responde) existe de verdad', () => {
    const smoke = readFileSync(path.join(process.cwd(), 'scripts/smoke.sh'), 'utf8')
    const funcion = smoke.match(/caso_home_responde\(\) \{[\s\S]*?\n\}/)?.[0]
    expect(funcion, 'no se encontró caso_home_responde() en scripts/smoke.sh').toBeTruthy()
    const patrones = [...funcion!.matchAll(/grep -q '([^']+)'/g)].map((m) => m[1])
    expect(patrones, 'caso_home_responde no tiene los dos grep -q esperados').toHaveLength(2)
    const [negado, exigido] = patrones
    expect(negado).toBe('data-testid="tenant-nombre"')
    expect(exigido).toBe('name="contacto"')
    expect(html()).not.toContain(negado)
    expect(html()).toContain(exigido)
  })
})
