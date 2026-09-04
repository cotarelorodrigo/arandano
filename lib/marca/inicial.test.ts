import { describe, it, expect } from 'vitest'
import { inicialDe } from './inicial'

describe('la inicial del local', () => {
  it('es la primera letra, en mayúscula', () => {
    expect(inicialDe('Flor Celulares')).toBe('F')
  })

  it('ignora los espacios de los costados', () => {
    expect(inicialDe('  flor  ')).toBe('F')
  })

  // charAt(0) parte un carácter fuera del plano básico por la mitad y devuelve
  // media unidad de código, que el navegador dibuja como un rombo con un signo
  // de pregunta. Un nombre de local con emoji no es raro.
  it('no parte al medio un carácter fuera del plano básico', () => {
    expect(inicialDe('🍎 Manzana')).toBe('🍎')
  })

  it('con un nombre vacío cae a la marca', () => {
    expect(inicialDe('   ')).toBe('A')
  })
})
