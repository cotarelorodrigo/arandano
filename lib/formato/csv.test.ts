import { describe, it, expect } from 'vitest'
import { filaCsv } from './csv'

describe('el CSV escapa por RFC 4180', () => {
  it('encomilla lo que lleva coma, comilla o salto de línea', () => {
    expect(filaCsv(['1042', 'Pérez, Ana', 'dijo "hola"'])).toBe(
      '1042,"Pérez, Ana","dijo ""hola"""',
    )
  })

  it('deja pasar lo que no necesita comillas', () => {
    expect(filaCsv(['1042', 'Efectivo'])).toBe('1042,Efectivo')
  })

  // Un nombre que arranca con "=" es el caso real de CSV injection (guía de
  // OWASP), no de laboratorio: cualquier cliente o nota cargada así alcanza
  // para dispararlo en cuanto esa fila entre a un CSV.
  it('neutraliza una celda que arranca con =, +, - o @ para que una planilla no la lea como fórmula', () => {
    expect(filaCsv(['=HOY()'])).toBe("'=HOY()")
    expect(filaCsv(['+1', '-1', '@x'])).toBe("'+1,'-1,'@x")
  })
})
