import { describe, it, expect } from 'vitest'
import {
  ITEMS, LINEAS_INICIALES, MAXIMO_POR_LINEA, faltaStock, itemPorId,
  subtotalDeLinea, totalDeLineas, unidadesDeLineas,
} from './carrito'

/**
 * La aritmética del carrito del héroe.
 *
 * POR QUÉ ESTOS CASOS EXISTEN Y NO SON UN TEST DE COMPONENTE. El carrito ahora
 * se opera —se suben cantidades, se saca una línea, el total se rehace—, y el
 * repo no corre jsdom desde que el rediseño de /ventas sacó la última
 * excepción de `vitest.config.mts`. La respuesta no es traerlo de vuelta para
 * simular clicks: es que la lógica que un click dispara viva en funciones
 * puras, acá, donde se prueba sin DOM y sin simulacros. `retrato.test.tsx`
 * cubre lo otro —que el marcado inicial sea el correcto— y entre los dos queda
 * cubierto lo que importa.
 */
describe('el carrito del héroe', () => {
  it('las cantidades iniciales dan los 103.900 de la maqueta', () => {
    expect(totalDeLineas(LINEAS_INICIALES)).toBe('103900')
  })

  it('las líneas iniciales apuntan a ítems que existen', () => {
    for (const linea of LINEAS_INICIALES) {
      expect(() => itemPorId(linea.id)).not.toThrow()
    }
    expect(LINEAS_INICIALES).toHaveLength(ITEMS.length)
  })

  it('un id que no existe falla fuerte en vez de devolver una fila vacía', () => {
    expect(() => itemPorId('no-existe')).toThrow(/no-existe/)
  })

  it('el subtotal es el precio por la cantidad', () => {
    expect(subtotalDeLinea({ id: 'cargador', cantidad: 2 })).toBe('37000')
    expect(subtotalDeLinea({ id: 'cargador', cantidad: 1 })).toBe('18500')
  })

  // El caso que el rediseño hace posible: tocar el stepper mueve el total. Sin
  // esto, "el carrito se opera" sería una afirmación que ningún test sostiene.
  it('subir una cantidad mueve el total', () => {
    const conUnCargadorMas = LINEAS_INICIALES.map((linea) =>
      linea.id === 'cargador' ? { ...linea, cantidad: 3 } : linea,
    )
    expect(totalDeLineas(conUnCargadorMas)).toBe('122400')
  })

  it('sacar una línea le resta al total exactamente su subtotal', () => {
    const sinManoDeObra = LINEAS_INICIALES.filter((linea) => linea.id !== 'mano-de-obra')
    expect(totalDeLineas(sinManoDeObra)).toBe('58900')
  })

  it('un carrito vacío vale cero y no rompe', () => {
    expect(totalDeLineas([])).toBe('0')
    expect(unidadesDeLineas([])).toBe(0)
  })

  it('las unidades no son la cantidad de artículos', () => {
    // Cuatro artículos, cinco unidades: el cargador va por dos.
    expect(LINEAS_INICIALES).toHaveLength(4)
    expect(unidadesDeLineas(LINEAS_INICIALES)).toBe(5)
  })

  describe('el aviso de stock', () => {
    it('avisa cuando la cantidad pedida supera lo que hay', () => {
      // El cargador tiene 3.
      expect(faltaStock({ id: 'cargador', cantidad: 3 })).toBe(false)
      expect(faltaStock({ id: 'cargador', cantidad: 4 })).toBe(true)
    })

    it('la funda avisa desde el arranque, que es lo que dibuja la maqueta', () => {
      expect(faltaStock({ id: 'funda', cantidad: 1 })).toBe(true)
    })

    // Un servicio no descuenta stock, así que no puede faltar por más que se
    // pidan veinte: es la misma regla que aplica /vender de verdad.
    it('un servicio nunca avisa', () => {
      expect(itemPorId('mano-de-obra').stock).toBeNull()
      expect(faltaStock({ id: 'mano-de-obra', cantidad: 20 })).toBe(false)
    })

    it('exactamente uno de los cuatro ítems arranca avisando', () => {
      expect(LINEAS_INICIALES.filter(faltaStock)).toHaveLength(1)
    })
  })

  it('el tope por línea deja lugar para que el aviso aparezca', () => {
    // Si el tope fuera 1, subir la cantidad no podría enseñar nada — y el
    // aviso de stock del cargador es justamente lo que el carrito tiene para
    // mostrar cuando alguien lo toca.
    const conStock = ITEMS.filter((item) => item.stock !== null)
    expect(conStock.length).toBeGreaterThan(0)
    for (const item of conStock) {
      expect(MAXIMO_POR_LINEA).toBeGreaterThan(item.stock as number)
    }
  })
})
