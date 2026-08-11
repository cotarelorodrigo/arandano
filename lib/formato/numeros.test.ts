import { describe, it, expect } from 'vitest'
import { aDecimal, aDecimalOpcional, ErrorDeFormato } from './numeros'

describe('aDecimal', () => {
  it('acepta un entero', () => {
    expect(aDecimal('1500', 'el precio').toString()).toBe('1500')
  })

  it('acepta la coma decimal, que es como se escribe acá', () => {
    expect(aDecimal('1500,50', 'el precio').toString()).toBe('1500.5')
  })

  it('acepta el punto decimal, que es lo que emite un input numérico', () => {
    expect(aDecimal('1500.50', 'el precio').toString()).toBe('1500.5')
  })

  it('acepta el formato argentino completo, con miles y decimales', () => {
    expect(aDecimal('1.500,50', 'el precio').toString()).toBe('1500.5')
  })

  it('ignora los espacios', () => {
    expect(aDecimal(' 1 500,50 ', 'el precio').toString()).toBe('1500.5')
  })

  // El caso que justifica todo el archivo: un separador seguido de EXACTAMENTE
  // tres dígitos es tan probablemente miles como decimales, y adivinar mal
  // deja un celular cargado a 850 pesos.
  it('rechaza lo ambiguo en vez de adivinar', () => {
    expect(() => aDecimal('850.000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
    expect(() => aDecimal('850,000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
  })

  it('dos decimales no son ambiguos', () => {
    expect(aDecimal('850.00', 'el precio').toString()).toBe('850')
  })

  it('cuatro decimales tampoco: nadie escribe miles con cuatro dígitos', () => {
    // La escala la valida el dominio (excedeEscala), no este archivo.
    expect(aDecimal('1.0005', 'la cantidad').toString()).toBe('1.0005')
  })

  it('rechaza el vacío, el negativo y la basura', () => {
    for (const malo of ['', '   ', '-5', 'abc', '1,5,5', '1..5', '5-']) {
      expect(() => aDecimal(malo, 'el precio'), `aceptó "${malo}"`).toThrowError(
        expect.objectContaining({ codigo: 'NUMERO_INVALIDO' }),
      )
    }
  })

  it('el error nombra el campo, porque es lo que la pantalla va a mostrar', () => {
    expect(() => aDecimal('abc', 'el precio')).toThrowError(/el precio/)
  })

  it('es un ErrorDeFormato, para que el llamador lo distinja de un bug', () => {
    expect(() => aDecimal('abc', 'el precio')).toThrowError(ErrorDeFormato)
  })

  // Dos o más separadores no son ambiguos: un decimal de verdad nunca lleva
  // dos. Y es el rango de precios de este vertical — un celular de un millón
  // y medio se escribe así.
  it('acepta los miles sin decimales', () => {
    expect(aDecimal('1.500.000', 'el precio').toString()).toBe('1500000')
    expect(aDecimal('12.345.678', 'el precio').toString()).toBe('12345678')
  })

  it('un solo separador sigue siendo ambiguo, que es el punto del módulo', () => {
    expect(() => aDecimal('850.000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
  })

  // Mezclar convenciones es donde se hace daño: no se acepta.
  it('rechaza los miles a la yanqui', () => {
    expect(() => aDecimal('1,500,000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_INVALIDO' }),
    )
  })

  // Tres decimales tiene que poder escribirse: `Decimal(12,3)` existe porque
  // medio kilo de harina no es un entero. Sólo es ambiguo si la parte entera
  // puede ser un grupo de miles.
  it('acepta tres decimales cuando la parte entera no puede ser miles', () => {
    expect(aDecimal('0,125', 'la cantidad').toString()).toBe('0.125')
    expect(aDecimal('1234,567', 'la cantidad').toString()).toBe('1234.567')
  })

  it('y los sigue rechazando cuando sí puede serlo', () => {
    for (const ambiguo of ['850.000', '850,000', '1.500', '12,345']) {
      expect(() => aDecimal(ambiguo, 'el precio'), `aceptó "${ambiguo}"`).toThrowError(
        expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
      )
    }
  })
})

describe('aDecimalOpcional', () => {
  it('el vacío es null y no un error: el campo es opcional', () => {
    expect(aDecimalOpcional('', 'el costo')).toBeNull()
    expect(aDecimalOpcional('   ', 'el costo')).toBeNull()
  })

  it('lo que no está vacío pasa por las mismas reglas', () => {
    expect(aDecimalOpcional('120,50', 'el costo')?.toString()).toBe('120.5')
    expect(() => aDecimalOpcional('850.000', 'el costo')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
  })
})
