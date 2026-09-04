import { describe, it, expect } from 'vitest'
import { estadoDeInstalacion, esIOS } from './instalacion'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0'

describe('detectar iOS', () => {
  it('un iPhone es iOS', () => {
    expect(esIOS(IPHONE, 5)).toBe(true)
  })

  // Desde iPadOS 13 un iPad se anuncia como Macintosh. Sin este caso, el único
  // dispositivo donde la instalación es 100 % manual se quedaría sin
  // instrucciones — que es exactamente el defecto que la regla del ciclo móvil
  // prohíbe: una capacidad que desaparece y no reaparece en ningún lado.
  it('un iPad moderno miente y dice Macintosh, pero tiene pantalla táctil', () => {
    expect(esIOS(IPAD, 5)).toBe(true)
  })

  it('una Mac de escritorio no es iOS', () => {
    expect(esIOS(MAC, 0)).toBe(false)
  })

  it('un Android no es iOS', () => {
    expect(esIOS(ANDROID, 5)).toBe(false)
  })
})

describe('qué muestra el botón', () => {
  it('ya instalada: nada', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: true,
        promptDisponible: true,
        userAgent: ANDROID,
        puntosDeContacto: 5,
      }),
    ).toBe('oculto')
  })

  it('Chrome ofreció el prompt: se dispara', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: false,
        promptDisponible: true,
        userAgent: ANDROID,
        puntosDeContacto: 5,
      }),
    ).toBe('prompt')
  })

  it('iPhone: se explica el camino a mano', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: false,
        promptDisponible: false,
        userAgent: IPHONE,
        puntosDeContacto: 5,
      }),
    ).toBe('instrucciones')
  })

  // Firefox de escritorio, por ejemplo. Inventar instrucciones por navegador
  // sin poder verificarlas es peor que el silencio.
  it('un navegador sin ninguno de los dos caminos: nada', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: false,
        promptDisponible: false,
        userAgent: MAC,
        puntosDeContacto: 0,
      }),
    ).toBe('oculto')
  })
})
