import { describe, it, expect } from 'vitest'
import { esModo, leyendaDelModo, subtituloDelModo, tocarModo } from './modo'

describe('esModo', () => {
  it('acepta los tres modos y nada más', () => {
    expect(esModo('APAGADO')).toBe(true)
    expect(esModo('PRUEBA')).toBe(true)
    expect(esModo('TODOS')).toBe(true)
    expect(esModo('ENCENDIDO')).toBe(false)
    expect(esModo('')).toBe(false)
    expect(esModo(undefined)).toBe(false)
  })
})

/**
 * El doble toque para pasar a Todos (spec, decisión 6). Es la única transición
 * que manda el bot a clientes reales, y con un segmentado un toque de más sobre
 * la opción vecina alcanza para hacerlo sin querer.
 */
describe('tocarModo', () => {
  it('el primer toque en Todos arma la confirmación y NO cambia el modo', () => {
    expect(tocarModo({ modo: 'PRUEBA', armadoTodos: false }, 'TODOS')).toEqual({
      cambiarA: null,
      armadoTodos: true,
    })
  })

  it('el segundo toque en Todos confirma', () => {
    expect(tocarModo({ modo: 'PRUEBA', armadoTodos: true }, 'TODOS')).toEqual({
      cambiarA: 'TODOS',
      armadoTodos: false,
    })
  })

  it('también desde Apagado hacen falta dos toques', () => {
    expect(tocarModo({ modo: 'APAGADO', armadoTodos: false }, 'TODOS').cambiarA).toBeNull()
  })

  it('tocar otra opción con la confirmación armada la desarma y cambia a esa', () => {
    expect(tocarModo({ modo: 'PRUEBA', armadoTodos: true }, 'APAGADO')).toEqual({
      cambiarA: 'APAGADO',
      armadoTodos: false,
    })
  })

  it('bajar a Sólo prueba o a Apagado es inmediato: es la dirección segura', () => {
    expect(tocarModo({ modo: 'TODOS', armadoTodos: false }, 'PRUEBA').cambiarA).toBe('PRUEBA')
    expect(tocarModo({ modo: 'TODOS', armadoTodos: false }, 'APAGADO').cambiarA).toBe('APAGADO')
    expect(tocarModo({ modo: 'APAGADO', armadoTodos: false }, 'PRUEBA').cambiarA).toBe('PRUEBA')
  })

  it('tocar el modo que ya está no hace nada', () => {
    expect(tocarModo({ modo: 'TODOS', armadoTodos: false }, 'TODOS')).toEqual({
      cambiarA: null,
      armadoTodos: false,
    })
  })
})

describe('leyendaDelModo', () => {
  it('dice qué pasa con el próximo mensaje en cada modo', () => {
    expect(leyendaDelModo({ modo: 'APAGADO', cantidadNumeros: 0, armadoTodos: false })).toBe(
      'No le contesta a nadie. Los mensajes quedan guardados.',
    )
    expect(leyendaDelModo({ modo: 'PRUEBA', cantidadNumeros: 2, armadoTodos: false })).toBe(
      'Contesta sólo a los números de prueba.',
    )
    expect(leyendaDelModo({ modo: 'TODOS', cantidadNumeros: 2, armadoTodos: false })).toBe(
      'Les contesta a todos los que escriban.',
    )
  })

  it('en prueba sin números avisa que no le contesta a nadie', () => {
    expect(leyendaDelModo({ modo: 'PRUEBA', cantidadNumeros: 0, armadoTodos: false })).toBe(
      'Todavía no cargaste ningún número de prueba: no le contesta a nadie.',
    )
  })

  it('con la confirmación armada, la leyenda pide el segundo toque', () => {
    expect(leyendaDelModo({ modo: 'PRUEBA', cantidadNumeros: 2, armadoTodos: true })).toBe(
      'Tocá de nuevo para que les conteste a todos.',
    )
  })
})

describe('subtituloDelModo', () => {
  it('nombra el estado en el encabezado', () => {
    expect(subtituloDelModo('APAGADO')).toBe('Apagado')
    expect(subtituloDelModo('PRUEBA')).toBe('En prueba')
    expect(subtituloDelModo('TODOS')).toBe('Contestando')
  })
})
