import { describe, it, expect } from 'vitest'
import { TOPE_NOTA_DE_CORRECCION, normalizarNotaDeCorreccion } from './correccion'
import { normalizarDetalle, TOPE_DETALLE } from './detalle'

describe('normalizarNotaDeCorreccion', () => {
  it('devuelve el texto tal cual cuando ya viene limpio', () => {
    expect(normalizarNotaDeCorreccion('puse efectivo y era transferencia')).toBe(
      'puse efectivo y era transferencia',
    )
  })

  it('recorta los espacios de los bordes', () => {
    expect(normalizarNotaDeCorreccion('  era transferencia  ')).toBe('era transferencia')
  })

  // Las tres formas de "no escribió nada" dan lo mismo: la ausencia del dato.
  // `EdicionDeVenta.nota` es nullable justamente porque el motivo es opcional.
  it('trata vacío, sólo espacios y ausente como la ausencia del dato', () => {
    expect(normalizarNotaDeCorreccion('')).toBeNull()
    expect(normalizarNotaDeCorreccion('   \n  ')).toBeNull()
    expect(normalizarNotaDeCorreccion(undefined)).toBeNull()
    expect(normalizarNotaDeCorreccion(null)).toBeNull()
  })

  it('corta en el tope en vez de rechazar', () => {
    const largo = 'a'.repeat(TOPE_NOTA_DE_CORRECCION + 50)
    expect(normalizarNotaDeCorreccion(largo)).toHaveLength(TOPE_NOTA_DE_CORRECCION)
  })

  it('normaliza CRLF y CR sueltos a LF', () => {
    expect(normalizarNotaDeCorreccion('era débito\r\nno crédito')).toBe('era débito\nno crédito')
    expect(normalizarNotaDeCorreccion('era débito\rno crédito')).toBe('era débito\nno crédito')
  })

  // 300 y no los 500 del detalle: el detalle guarda un dato de entrega, y esto
  // es una frase que explica por qué se corrigió. Que sean distintos es el
  // motivo por el que la mecánica se generalizó con el tope COMO PARÁMETRO en
  // vez de copiarse.
  it('el tope es 300, distinto del del detalle de venta', () => {
    expect(TOPE_NOTA_DE_CORRECCION).toBe(300)
    expect(TOPE_NOTA_DE_CORRECCION).not.toBe(TOPE_DETALLE)
  })

  // Los dos consumidores comparten la mecánica y difieren SÓLO en el tope: un
  // texto que entra en los dos tiene que salir idéntico de los dos, o la
  // generalización no lo es.
  it('coincide con el detalle de venta en todo lo que no sea el tope', () => {
    for (const caso of ['  hola  ', 'a\r\nb', '', '   ', 'sin nada que tocar']) {
      expect(normalizarNotaDeCorreccion(caso)).toBe(normalizarDetalle(caso))
    }
  })
})
