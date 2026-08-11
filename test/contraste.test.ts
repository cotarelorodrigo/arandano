import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { PARES, EXCEPCIONES, nombreDelPar, ratios } from '@/scripts/contraste.mts'

const DOC = 'docs/sistema-de-diseno.md'
const INICIO = '<!-- contraste:inicio -->'
const FIN = '<!-- contraste:fin -->'

/** Los ratios que DECLARA la tabla de contraste del documento. */
function ratiosDelDoc(): Map<string, number> {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(`${DOC} no tiene los marcadores ${INICIO} … ${FIN}`)
  }
  const filas = new Map<string, number>()
  for (const linea of texto.slice(desde, hasta).split('\n')) {
    const m = linea.match(
      /^\|\s*`(--[a-z-]+)`\s+sobre\s+`(--[a-z-]+)`\s*\|\s*([\d.]+)\s*\|/,
    )
    if (m) filas.set(`${m[1]} sobre ${m[2]}`, Number(m[3]))
  }
  return filas
}

describe('el contraste de la paleta', () => {
  let calculados: ReturnType<typeof ratios>
  let doc: Map<string, number>

  beforeAll(() => {
    calculados = ratios()
    doc = ratiosDelDoc()
  })

  // Las dos mitades que hacen que esto no sea decorativo: una lista vacía y una
  // tabla vacía dan cero comparaciones, y cero comparaciones no fallan nunca.
  it('hay pares declarados', () => {
    expect(PARES.length).toBeGreaterThan(0)
  })

  it('la tabla del documento no está vacía', () => {
    expect(
      doc.size,
      `no se parseó ninguna fila de la tabla de contraste de ${DOC}`,
    ).toBeGreaterThan(0)
  })

  it('cada par llega a su mínimo, o está exceptuado con su razón escrita', () => {
    for (const r of calculados) {
      if (r.llega) continue
      const razon = EXCEPCIONES[r.nombre]
      expect(
        razon,
        `${r.nombre} da ${r.ratio.toFixed(2)} contra un mínimo de ${r.minimo}, y no ` +
          `está en EXCEPCIONES (scripts/contraste.mts). Una excepción de ` +
          `accesibilidad sin razón escrita no es revisable: o se corrige el token, ` +
          `o se declara por qué se acepta.`,
      ).toBeTruthy()
    }
  })

  it('no hay excepciones de más', () => {
    // Una excepción que ya no hace falta es una deuda que quedó cobrando sin
    // que nadie se entere de que se pagó.
    const fallan = new Set(calculados.filter((r) => !r.llega).map((r) => r.nombre))
    const sobran = Object.keys(EXCEPCIONES).filter((n) => !fallan.has(n))
    expect(
      sobran,
      `estas excepciones ya no corresponden porque el par pasa el mínimo: ` +
        `${sobran.join(', ')}. Borralas de EXCEPCIONES.`,
    ).toEqual([])
  })

  it('el documento declara el ratio que el cálculo produce', () => {
    for (const r of calculados) {
      expect(
        doc.get(r.nombre),
        `${DOC} declara ${doc.get(r.nombre) ?? 'nada'} para ${r.nombre}, y el ` +
          `cálculo sobre los tokens reales da ${r.ratio.toFixed(2)}. La tabla se ` +
          `presenta como medida: no se transcribe a mano.`,
      ).toBe(Number(r.ratio.toFixed(2)))
    }
  })

  it('el documento no declara pares que el cálculo no cubre', () => {
    const nombres = new Set(calculados.map((r) => r.nombre))
    const sobran = [...doc.keys()].filter((n) => !nombres.has(n))
    expect(sobran, `filas sin par correspondiente en PARES: ${sobran.join(', ')}`).toEqual(
      [],
    )
  })
})
