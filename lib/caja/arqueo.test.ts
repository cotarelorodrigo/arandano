import { describe, it, expect } from 'vitest'
import { canonicoACentavos, diferencia, queda, textoDeDiferencia, tipeadoACentavos } from './arqueo'

/** `Intl` separa el signo con un espacio duro (U+00A0). */
const legible = (s: string) => s.replace(/ /g, ' ')

describe('las cuentas del arqueo', () => {
  it('diferencia es contado − esperado, y queda es contado − retirado', () => {
    expect(diferencia(5_500_000, 5_500_000)).toBe(0)
    expect(diferencia(5_480_000, 5_500_000)).toBe(-20_000)
    expect(queda(5_500_000, 4_500_000)).toBe(1_000_000)
  })

  it('la diferencia se dice en palabras', () => {
    expect(textoDeDiferencia(0, 'ARS')).toBe('cuadra')
    expect(legible(textoDeDiferencia(20_000, 'ARS'))).toBe('sobran $ 200,00')
    expect(legible(textoDeDiferencia(-20_000, 'ARS'))).toBe('faltan $ 200,00')
    expect(legible(textoDeDiferencia(-150, 'USD'))).toBe('faltan US$ 1,50')
  })

  // El esperado puede ser negativo (un egreso mayor que lo que había), y lo
  // escribe el servidor: no pasa por la gramática de tipeo, que rechaza el
  // signo.
  it('un canónico negativo se lee con su signo', () => {
    expect(canonicoACentavos('-200.00')).toBe(-20_000)
    expect(canonicoACentavos('55000.5')).toBe(5_500_050)
  })

  it('lo tipeado pasa por la gramática del servidor: vacío es cero, lo ambiguo no se adivina', () => {
    expect(tipeadoACentavos('')).toBe(0)
    expect(tipeadoACentavos('1.500,50')).toBe(150_050)
    expect(tipeadoACentavos('54.800')).toBeNaN()
  })
})
