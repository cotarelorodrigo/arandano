import { describe, it, expect } from 'vitest'
import { inicialDe } from './inicial'

describe('la inicial del local', () => {
  it('es la primera letra, en mayúscula', () => {
    expect(inicialDe('Flor Celulares')).toBe('F')
  })

  it('ignora los espacios de los costados', () => {
    expect(inicialDe('  flor  ')).toBe('F')
  })

  // Un emoji acá haría que ImageResponse (emoji: 'twemoji' por default) salga
  // a buscar el glifo a un CDN externo en cada request de un endpoint público.
  // No es "no soportamos emoji": es que no queremos una request saliente por
  // ícono.
  it('rechaza emoji y cae a la marca', () => {
    expect(inicialDe('🍎 Manzana')).toBe('A')
  })

  it('con un nombre vacío cae a la marca', () => {
    expect(inicialDe('   ')).toBe('A')
  })

  it('acepta dígitos', () => {
    expect(inicialDe('24 Horas Celulares')).toBe('2')
  })

  it('rechaza símbolos y cae a la marca', () => {
    expect(inicialDe('·Punto')).toBe('A')
  })
})
