import { describe, it, expect } from 'vitest'
import { porcentajesQueSuman100 } from './porcentajes'

describe('porcentajesQueSuman100', () => {
  it('reparte enteros que suman exactamente 100', () => {
    // Los mismos montos que la maqueta (design/arandano.pen, nodo `eyqV3`):
    // 48/30/14/8, que además ya suman 100 con el redondeo ingenuo — el caso
    // de abajo es el que de verdad prueba el método del resto mayor.
    const pcts = porcentajesQueSuman100([612400, 389700, 182400, 100000])
    expect(pcts).toEqual([48, 30, 14, 8])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('también suma 100 cuando el redondeo ingenuo NO daría 100', () => {
    // 1/3 de cada uno: redondeando cada tercio por separado da 33+33+33 = 99,
    // no 100. El resto mayor reparte el punto que falta a una de las tres
    // barras — la prueba de que el método hace algo distinto de
    // Math.round(x) en cada elemento.
    const pcts = porcentajesQueSuman100([1, 1, 1])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
    // Las tres partes son iguales, así que el punto de más cae en cualquiera
    // — lo que importa es que ninguna quede en 0 ni en 34+.
    expect(pcts.every((p) => p === 33 || p === 34)).toBe(true)
  })

  it('sin total no divide por cero', () => {
    expect(porcentajesQueSuman100([0, 0])).toEqual([0, 0])
    expect(porcentajesQueSuman100([])).toEqual([])
  })

  it('un total explícito igual a la suma da el mismo resultado que omitirlo', () => {
    // El caso real (GraficoDeMedios le pasa `Number(composicion.total)`, que
    // en la práctica coincide con la suma de las barras) no puede darse contra
    // valores que no sumen ~el total: el propio método del resto mayor asume
    // que `faltan` (100 menos la suma de los pisos) entra en `valores.length`,
    // así que un total muy distinto de la suma no es un caso que este método
    // sostenga — no es el defecto que este parámetro corrige.
    const valores = [612400, 389700, 182400, 100000]
    const suma = valores.reduce((a, b) => a + b, 0)
    expect(porcentajesQueSuman100(valores, suma)).toEqual(porcentajesQueSuman100(valores))
  })

  it('sin el segundo argumento, sigue sumando los valores (compatibilidad)', () => {
    const pcts = porcentajesQueSuman100([1, 1, 2])
    expect(pcts).toEqual([25, 25, 50])
  })
})
