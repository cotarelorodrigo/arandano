import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { IndiceDeRubros } from './rubros'
import { MODULOS, RUBROS, loQueFalta } from './datos'

const html = () => renderToStaticMarkup(<IndiceDeRubros />)
const fuente = () => readFileSync(path.join(process.cwd(), 'app/sitio/rubros.tsx'), 'utf8')

/**
 * El índice de rubros, que es lo único de la página que se reordena.
 *
 * El estado inicial es "Todos", así que lo que se prueba acá —lo que sale del
 * servidor— es también lo que ve alguien sin JavaScript: la lista completa.
 * Filtrar es lo que se pierde sin JS; leer no.
 */
describe('el índice de rubros', () => {
  it('sin tocar nada muestra los doce', () => {
    const salida = html()
    expect(RUBROS).toHaveLength(12)
    for (const rubro of RUBROS) expect(salida).toContain(rubro.titulo)
  })

  it('es una lista y no una grilla de tarjetas', () => {
    const salida = html()
    expect(salida.match(/<li/g)).toHaveLength(12)
    expect(salida).not.toContain('rounded-[13px]')
  })

  describe('los filtros', () => {
    /**
     * Uno por módulo, más "Todos" y "Sólo núcleo". Salen de `MODULOS`: el día
     * que exista un cuarto módulo el filtro aparece solo, que es la misma regla
     * por la que el texto de cada rubro se deriva en vez de escribirse.
     */
    it('hay uno por módulo, más Todos y Sólo núcleo', () => {
      const salida = html()
      expect(salida).toContain('Todos')
      expect(salida).toContain('Sólo núcleo')
      for (const modulo of MODULOS) expect(salida).toContain(modulo.titulo)
      expect(salida.match(/aria-pressed=/g)).toHaveLength(MODULOS.length + 2)
    })

    it('cada uno dice a cuántos rubros alcanza', () => {
      const salida = html()
      // "Todos" tiene que decir 12, y "Sólo núcleo" los cinco que no activan
      // ningún módulo. Un conteo que no cierre con la lista es peor que no
      // tenerlo: invita a tocar un filtro que no va a mostrar nada.
      expect(salida).toMatch(/Todos<[^>]*>12</)
      const soloNucleo = RUBROS.filter((rubro) => rubro.modulos.length === 0).length
      expect(soloNucleo).toBe(5)
      expect(salida).toMatch(new RegExp(`Sólo núcleo<[^>]*>${soloNucleo}<`))
    })

    it('arranca con Todos elegido', () => {
      expect(html()).toMatch(/aria-pressed="true"[^>]*>Todos/)
      expect(html().match(/aria-pressed="true"/g)).toHaveLength(1)
    })

    it('son botones de verdad, no divs con onClick', () => {
      expect(html().match(/<button/g)?.length).toBe(MODULOS.length + 2)
    })
  })

  it('sigue diciendo qué módulo le falta a cada rubro', () => {
    const salida = html()
    const esperan = RUBROS.filter((rubro) => loQueFalta(rubro.modulos).length > 0)
    expect(salida.match(/, en camino/g)).toHaveLength(esperan.length)
  })

  /**
   * La animación de layout es la razón por la que el proveedor carga `domMax`
   * en vez del paquete chico. Si alguien la saca, hay que bajar las features
   * también — si no, la página paga un bundle más grande por nada.
   */
  describe('la animación de layout', () => {
    it('las filas se reacomodan con FLIP', () => {
      expect(fuente()).toContain('layout={!sinMovimiento}')
    })

    it('y el proveedor carga las features que FLIP necesita', () => {
      const movimiento = readFileSync(path.join(process.cwd(), 'app/sitio/movimiento.tsx'), 'utf8')
      expect(
        movimiento,
        'el índice usa `layout`, que no existe en domAnimation',
      ).toContain('features={domMax}')
    })

    it('se apaga con la preferencia del sistema', () => {
      expect(fuente()).toContain('useReducedMotion')
    })
  })
})
