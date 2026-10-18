import { describe, it, expect } from 'vitest'
import { claveDeTelefono } from './telefono'

describe('claveDeTelefono', () => {
  // Las formas reales en que se dicta un celular de Buenos Aires en el
  // mostrador: todas tienen que dar la MISMA clave, o el chequeo de repetidos
  // deja pasar al mismo cliente cargado dos veces.
  it.each([
    ['1122334455'],
    ['11 2233-4455'],
    ['11-2233-4455'],
    ['(11) 2233 4455'],
    ['+54 11 2233-4455'],
    ['+54 9 11 2233 4455'],
    ['5491122334455'],
    ['011 2233-4455'],
  ])('"%s" da 1122334455', (tipeado) => {
    expect(claveDeTelefono(tipeado)).toBe('1122334455')
  })

  it('un número del interior con código de área de cuatro dígitos', () => {
    expect(claveDeTelefono('+54 9 2966 12-3456')).toBe('2966123456')
  })

  // El límite: sin código de área no hay clave, y no se inventa una con los
  // dígitos que hay.
  it('con menos de 10 dígitos no hay clave', () => {
    expect(claveDeTelefono('4455-6677')).toBeNull()
    expect(claveDeTelefono('123456789')).toBeNull()
  })

  it('vacío, sólo espacios, sin dígitos o ausente no tiene clave', () => {
    expect(claveDeTelefono('')).toBeNull()
    expect(claveDeTelefono('   ')).toBeNull()
    expect(claveDeTelefono('no tiene')).toBeNull()
    expect(claveDeTelefono(null)).toBeNull()
    expect(claveDeTelefono(undefined)).toBeNull()
  })

  // El caso conocido que NO se salva, escrito para que nadie crea que sí: con
  // el 15 adelante los últimos 10 dígitos son otros.
  it('el 15 tipeado no se saca: es otra clave', () => {
    expect(claveDeTelefono('011 15 2233-4455')).toBe('1522334455')
  })
})
