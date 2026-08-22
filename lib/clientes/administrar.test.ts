import { describe, it, expect } from 'vitest'
import { rotuloOrdenesPrevias } from './administrar'

describe('rotuloOrdenesPrevias', () => {
  it('singular con exactamente una orden previa', () => {
    expect(rotuloOrdenesPrevias(1)).toBe('1 orden previa')
  })

  it('plural con varias', () => {
    expect(rotuloOrdenesPrevias(3)).toBe('3 órdenes previas')
  })

  // El caso que el brief de la Task 3 pide explícitamente: un cliente sin
  // órdenes previas no puede mostrar un conteo falso. "0 órdenes previas" es
  // el texto real y correcto para ese caso, no un string que se omite ni un
  // "1" inventado.
  it('cero también es plural, y es un número real, no un hueco', () => {
    expect(rotuloOrdenesPrevias(0)).toBe('0 órdenes previas')
  })
})
