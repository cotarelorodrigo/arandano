import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
// La misma conversión que usa la tabla de contraste, no una copia: dos
// implementaciones de oklch → sRGB se desincronizan, y el día que pase, este
// test compararía contra un color que la aplicación no pinta.
import { tokensDelCss, aRgb } from '@/scripts/contraste.mts'

const OG = 'app/opengraph-image.tsx'

/** El token, como los seis dígitos hex que Satori necesita. */
function hexDelToken(nombre: string): string {
  const valor = tokensDelCss().get(nombre)
  if (!valor) throw new Error(`app/globals.css no define ${nombre}`)
  return '#' + aRgb(valor).map((b) => b.toString(16).padStart(2, '0')).join('')
}

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

  it('el texto es exactamente --foreground', () => {
    const esperado = hexDelToken('--foreground')
    expect(
      fuente,
      `${OG} tiene que pintar color: '${esperado}', que es --foreground convertido ` +
        `a hex. Usaba --primary-foreground, que con la paleta oscura pasó a ser casi ` +
        `negro: texto negro sobre el paño de marca.`,
    ).toContain(`color: '${esperado}'`)
  })
})
