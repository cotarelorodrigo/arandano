import { describe, it, expect } from 'vitest'
import { partirCategoria, textoDeCategoria } from './categorias'

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

describe('textoDeCategoria', () => {
  // Es lo que hace que el texto guardado y el árbol no se contradigan nunca
  // mientras las dos columnas convivan: las tres formas de escribir lo mismo
  // se guardan igual, y apuntan a la misma rama.
  it('normaliza las tres formas de escribir la misma rama', () => {
    for (const forma of ['Fundas · Samsung', 'Fundas·Samsung', '  Fundas   ·   Samsung  ']) {
      expect(textoDeCategoria(forma)).toBe('Fundas · Samsung')
    }
  })

  it('deja una raíz sola tal cual, trimeada', () => {
    expect(textoDeCategoria('  Cables  ')).toBe('Cables')
  })

  it('reescribe el tercer nivel plegado, igual que el árbol', () => {
    expect(textoDeCategoria('Accesorios·Fundas·Samsung')).toBe('Accesorios · Fundas · Samsung')
  })

  // Un texto que no produce rama tampoco puede quedar como texto: dejaría un
  // "·" suelto bajo el nombre del artículo, sin nada en el árbol que le
  // corresponda.
  it('lo que no produce ninguna rama va a null', () => {
    for (const basura of ['', '   ', '·', ' · · ', null, undefined]) {
      expect(textoDeCategoria(basura)).toBeNull()
    }
  })
})
