import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { hexDelToken } from '@/scripts/tokens.mts'

const OG = 'app/opengraph-image.tsx'

describe('la tarjeta social no se desincroniza de la paleta', () => {
  const fuente = readFileSync(OG, 'utf8')

  // Satori (el motor de next/og) no resuelve var(--marca), así que el hex está
  // duplicado a mano a propósito. El archivo lo advertía desde el ciclo de la
  // landing —"se desincroniza del color de marca sin que nadie se entere"— y
  // hasta el ciclo de la paleta oscura nada lo comprobaba: el repintado entero
  // habría dejado la tarjeta con el arándano viejo, en silencio.
  it('el fondo es exactamente --marca', () => {
    const esperado = hexDelToken('--marca')
    expect(
      fuente,
      `${OG} tiene que pintar backgroundColor: '${esperado}', que es --marca ` +
        `convertido a hex. Si el token cambió, este archivo es el segundo lugar a tocar.`,
    ).toContain(`backgroundColor: '${esperado}'`)
  })

  it('el texto es exactamente --marca-foreground', () => {
    // --marca-foreground y no --foreground: el paño de marca es una superficie
    // oscura, y --foreground es el texto sobre las superficies CLARAS. Con la
    // paleta oscura los dos coincidían y la distinción no se notaba; con la
    // clara, usar --foreground acá pinta el título de casi negro sobre el paño.
    const esperado = hexDelToken('--marca-foreground')
    expect(
      fuente,
      `${OG} tiene que pintar color: '${esperado}', que es --marca-foreground ` +
        `convertido a hex. Es el texto que va sobre el paño de marca; --foreground ` +
        `es el que va sobre las superficies claras y acá quedaría ilegible.`,
    ).toContain(`color: '${esperado}'`)
  })
})
