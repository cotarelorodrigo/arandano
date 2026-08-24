import { describe, it, expect } from 'vitest'
import { partirCategoria } from './categorias'

describe('partirCategoria', () => {
  it('parte "raíz · hija" en sus dos niveles', () => {
    expect(partirCategoria('Fundas · Samsung')).toEqual({ raiz: 'Fundas', hija: 'Samsung' })
  })

  // El separador es el `·`, no `" · "`: quien lo escribe pegado quiso decir lo
  // mismo, y castigarlo por no poner espacios sería inventar una regla.
  it('no exige espacios alrededor del separador', () => {
    expect(partirCategoria('Fundas·Samsung')).toEqual({ raiz: 'Fundas', hija: 'Samsung' })
  })

  it('sin separador devuelve una raíz sola', () => {
    expect(partirCategoria('Cables')).toEqual({ raiz: 'Cables', hija: null })
  })

  // El tercer nivel se pliega adentro de la hija en vez de descartarse: es
  // feo, pero no pierde lo que la persona escribió.
  it('pliega el tercer nivel dentro de la hija', () => {
    expect(partirCategoria('Accesorios · Fundas · Samsung')).toEqual({
      raiz: 'Accesorios',
      hija: 'Fundas · Samsung',
    })
  })

  it('descarta los segmentos vacíos, así que una raíz vacía no existe', () => {
    expect(partirCategoria('· Samsung')).toEqual({ raiz: 'Samsung', hija: null })
    expect(partirCategoria('A ·  · B')).toEqual({ raiz: 'A', hija: 'B' })
  })

  it('trimea cada segmento', () => {
    expect(partirCategoria('   Fundas   ·   Samsung   ')).toEqual({
      raiz: 'Fundas',
      hija: 'Samsung',
    })
  })

  // Mismo criterio que `limpiarCategoria` para el texto: vacío y "sólo
  // espacios" son la misma "no hay categoría", y el árbol lo hereda en vez de
  // inventar el suyo.
  it('sin ningún segmento no hay categoría', () => {
    for (const vacio of ['', '   ', '·', ' · · ', null, undefined]) {
      expect(partirCategoria(vacio)).toBeNull()
    }
  })
})
