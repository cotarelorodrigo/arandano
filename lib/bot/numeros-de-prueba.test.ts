import { describe, it, expect } from 'vitest'
import {
  coincideConAlguno,
  coinciden,
  digitosDe,
  mostrarNumeroDePrueba,
  ultimos10,
  validarNumeroDePrueba,
} from './numeros-de-prueba'

describe('digitosDe', () => {
  it('se queda sólo con los dígitos, sea cual sea la forma de tipearlo', () => {
    expect(digitosDe('+54 9 (11) 2233-4455')).toBe('5491122334455')
    expect(digitosDe('11 2233 4455')).toBe('1122334455')
    expect(digitosDe('')).toBe('')
  })
})

describe('validarNumeroDePrueba', () => {
  it('acepta 10 dígitos (código de área + número) y guarda los dígitos', () => {
    expect(validarNumeroDePrueba('11 2233-4455')).toEqual({ ok: true, digitos: '1122334455' })
  })

  it('acepta el número internacional completo', () => {
    expect(validarNumeroDePrueba('+54 9 11 2233-4455')).toEqual({ ok: true, digitos: '5491122334455' })
  })

  it('rechaza un número sin código de área', () => {
    expect(validarNumeroDePrueba('2233-4455')).toEqual({ ok: false, problema: 'NUMERO_CORTO' })
  })

  it('rechaza más de 15 dígitos, el largo máximo de E.164', () => {
    expect(validarNumeroDePrueba('1234567890123456')).toEqual({ ok: false, problema: 'NUMERO_LARGO' })
  })

  it('acepta exactamente 15', () => {
    expect(validarNumeroDePrueba('123456789012345')).toEqual({ ok: true, digitos: '123456789012345' })
  })
})

describe('coinciden', () => {
  it('iguala lo que tipea el dueño con el waId que entrega Kapso', () => {
    expect(coinciden('+5491122334455', '11 2233-4455')).toBe(true)
    expect(coinciden('5491122334455', '+54 9 11 2233 4455')).toBe(true)
  })

  it('no iguala dos números distintos', () => {
    expect(coinciden('+5491122334455', '11 2233-4456')).toBe(false)
  })

  /**
   * El límite de la comparación, fijado a propósito (spec, decisión 2): con el
   * 0 y el 15 los últimos 10 dígitos son otros. La red es la pantalla, que
   * muestra "Todavía no escribió" en ese número — no una heurística que adivine
   * el largo del código de área.
   */
  it('NO iguala el número tipeado con 0 y 15', () => {
    expect(coinciden('+5491122334455', '011 15 2233-4455')).toBe(false)
  })

  it('un número de menos de 10 dígitos no coincide con nada, ni consigo mismo', () => {
    expect(coinciden('2233-4455', '2233-4455')).toBe(false)
  })
})

describe('coincideConAlguno', () => {
  it('encuentra el waId en la lista', () => {
    expect(coincideConAlguno('+5491122334455', ['1199998888', '1122334455'])).toBe(true)
  })

  it('con la lista vacía no coincide nadie', () => {
    expect(coincideConAlguno('+5491122334455', [])).toBe(false)
  })
})

describe('mostrarNumeroDePrueba', () => {
  it('muestra los últimos 10 dígitos partidos antes de los cuatro finales', () => {
    expect(mostrarNumeroDePrueba('5491122334455')).toBe('112233-4455')
    expect(mostrarNumeroDePrueba('3514445566')).toBe('351444-5566')
  })

  it('ultimos10 no inventa dígitos cuando hay menos', () => {
    expect(ultimos10('12345')).toBe('12345')
  })
})
