import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Landing } from './landing'

vi.mock('./acciones', () => ({ enviarLead: vi.fn() }))

const BASE = { protocolo: 'https', dominio: 'arandano.app', puerto: '' } as const
const html = () => renderToStaticMarkup(<Landing base={BASE} whatsapp="5491155555555" />)

/**
 * Test de integración: que la página compone las siete secciones en orden y no
 * rompe al juntarlas. El copy de cada una ya está probado por sección en
 * `nav.test.tsx`, `hero.test.tsx` y `secciones.test.tsx`; repetirlo acá sería
 * el mismo test dos veces con más setup.
 */
describe('la landing', () => {
  it('abre con el H1 del hero', () => {
    expect(html()).toContain('Todo el local en un solo lugar')
  })

  // El frame raíz del .pen (vDLU8) pinta $ar-surface y sólo DOS secciones
  // (Módulos, Planes) pintan $ar-bg. El <body> es bg-background, así que sin
  // este fondo propio la página entera terminaría en gris y el bandeado
  // blanco/gris/blanco/gris/marca/blanco no existiría.
  it('la raíz pinta papel y no el gris del body', () => {
    expect(html()).toContain('min-h-full bg-card')
  })

  it('las siete secciones van en orden', () => {
    const salida = html()
    const orden = [
      'Todo el local en un solo lugar',
      'Un núcleo, tres módulos, rubros ilimitados',
      'Tu rubro ya está adentro',
      'Precios claros, en pesos',
      'Probalo con tu propio local',
      'Arándano, Buenos Aires',
    ]
    const posiciones = orden.map((texto) => salida.indexOf(texto))
    for (const posicion of posiciones) expect(posicion).toBeGreaterThan(-1)
    expect(posiciones).toEqual([...posiciones].sort((a, b) => a - b))
  })

  it('el formulario aparece dos veces, con el mismo verbo las dos', () => {
    const salida = html()
    expect(salida.match(/name="contacto"/g)).toHaveLength(2)
    // Un solo nombre para una sola acción: antes eran "Quiero probarlo" arriba
    // y "Empezar" abajo, más "Probar 5 días" en el Nav y en los planes — tres
    // verbos para lo mismo.
    expect(salida.match(/Que me escriban/g)).toHaveLength(2)
    expect(salida).not.toContain('Quiero probarlo')
    expect(salida).not.toContain('>Empezar<')
  })

  it('no filtra el cartel de un tenant', () => {
    expect(html()).not.toContain('data-testid="tenant-nombre"')
  })

  it('ningún id se repite en el documento', () => {
    const ids = [...html().matchAll(/\sid="([^"]+)"/g)].map((coincidencia) => coincidencia[1])
    expect(new Set(ids).size, `ids repetidos: ${ids.join(', ')}`).toBe(ids.length)
  })

  it('el ancla del formulario existe una sola vez y es la sección del Cierre', () => {
    const salida = html()
    expect(salida.match(/id="contacto"/g)).toHaveLength(1)
    expect(salida).toMatch(/<section id="contacto"/)
  })

  /**
   * LA REGLA DEL SISTEMA DE DISEÑO, hecha test.
   *
   * `docs/sistema-de-diseno.md` fija que puede haber como máximo una
   * superficie de `--marca` por sección y NUNCA en dos secciones consecutivas,
   * y el propio documento admitía que Planes y Cierre lo eran — "ahí el
   * argumento es más débil". Hasta este rediseño la página tenía tres paños:
   * la card Núcleo, la card Profesional y la franja del Cierre.
   *
   * Ahora son dos y no son consecutivas: la banda del Total adentro del
   * carrito (ancla la plata, y vive en el Hero) y la franja del Cierre (ancla
   * la conversión). Sin este caso, la tercera vuelve la próxima vez que
   * alguien quiera "un poco de color acá".
   */
  describe('el arándano como superficie', () => {
    it('la página pinta un solo paño de marca en línea, el del total', () => {
      const paños = html().match(/background-color:var\(--marca\)/g)
      expect(
        paños,
        `la landing pinta ${paños?.length ?? 0} superficies de --marca en línea. ` +
          `La única que corresponde es la banda del Total del carrito; la del ` +
          `Cierre se pinta desde cierre.module.css.`,
      ).toHaveLength(1)
    })

    it('la otra es la franja del Cierre, y se pinta desde su módulo', () => {
      const css = readFileSync(path.join(process.cwd(), 'app/sitio/cierre.module.css'), 'utf8')
      expect(css).toContain('var(--marca)')
    })

    it('no quedan paños en Módulos ni en Planes', () => {
      const secciones = readFileSync(path.join(process.cwd(), 'app/sitio/secciones.tsx'), 'utf8')
      expect(secciones).not.toContain("backgroundColor: 'var(--marca)'")
    })
  })

  /**
   * El acople con el gate: `scripts/smoke.sh` decide si el ápex está sano
   * mirando el HTML real. Si el campo deja de llamarse `contacto`, el paso 9
   * del deploy falla en producción y no acá — así que el contrato se verifica
   * leyendo el propio script, no copiando sus greps a mano.
   */
  it('cumple lo que el smoke test del deploy le exige al ápex', () => {
    const smoke = readFileSync(path.join(process.cwd(), 'scripts/smoke.sh'), 'utf8')
    const desde = smoke.indexOf('caso_home_responde()')
    expect(desde, 'scripts/smoke.sh ya no tiene caso_home_responde()').toBeGreaterThan(-1)
    const cuerpo = smoke.slice(desde, smoke.indexOf('\n}', desde))
    const patrones = [...cuerpo.matchAll(/grep -q\s+'([^']+)'/g)].map((m) => m[1])
    expect(patrones.length, `no se encontraron los grep de caso_home_responde()`).toBeGreaterThan(0)

    const salida = html()
    for (const patron of patrones) {
      if (cuerpo.includes(`! `) && patron.includes('tenant-nombre')) {
        expect(salida, `el ápex no puede traer ${patron}`).not.toContain(patron)
      } else {
        expect(salida, `el ápex tiene que traer ${patron}`).toContain(patron)
      }
    }
  })
})
