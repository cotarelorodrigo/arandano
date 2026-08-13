import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PARES, EXCEPCIONES, ratios } from '@/scripts/contraste.mts'

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
    // El `/NN` opcional es la opacidad: `--primary/80` y `--primary` son
    // colores distintos y filas distintas, porque el usuario mira los dos.
    const m = linea.match(
      /^\|\s*`(--[a-z-]+(?:\/\d+)?)`\s+sobre\s+`(--[a-z-]+(?:\/\d+)?)`\s*\|\s*([\d.]+)\s*\|/,
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

/**
 * Los archivos de código donde un ratio puede aparecer escrito a mano.
 *
 * `app/` y `components/` enteros, sin excluir `components/ui/`: un ratio citado
 * adentro de un componente copiado de shadcn envejece igual que cualquier otro.
 */
function archivosDeCodigo(): string[] {
  return ['app', 'components'].flatMap((raiz) =>
    readdirSync(raiz, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.(ts|tsx|css)$/.test(f))
      .map((f) => join(raiz, f)),
  )
}

/** `2.33:1` en cualquier comentario. Los dos decimales son la convención que ya usa el repo. */
const CITA = /\d+\.\d{2}:1/g

describe('ningún comentario cita un ratio que ya no existe', () => {
  // El bug que este caso existe para que no vuelva, y es de esta misma rama:
  // la paleta oscura cambió todos los tokens, y el comentario del anillo de
  // foco de components/navegacion.tsx siguió afirmando 2.70:1 y 10.79:1, que
  // eran los números de la paleta clara. Los reales son 2.33 y 5.49. La rama
  // actualizó a mano los dos comentarios análogos —persiana.module.css y
  // cierre.module.css, los dos de 7.69 a 6.13— y se olvidó de éste, que es
  // exactamente el modo de falla de todo lo que se transcribe a mano.
  //
  // Es el último canal transcripto que quedaba. La tabla de
  // docs/sistema-de-diseno.md se genera y la atan los casos de arriba; los
  // comentarios del código no los ataba nadie. Y el daño no es cosmético: el
  // párrafo de navegacion.tsx sostiene una decisión de accesibilidad
  // load-bearing, así que quien verifique 10.79, encuentre 5.49 y deje de
  // creerle al párrafo pierde el motivo por el que ese anillo va opaco.
  //
  // Si un ratio legítimo no matchea, la respuesta es agregar el par a PARES
  // —que es lo que se hizo con --ring/50 sobre --background— y no aflojar
  // esta comparación. Un test doblado para dar verde es peor que no tenerlo.
  it('cada ratio escrito a mano en app/ o components/ es uno de los que PARES calcula', () => {
    const vigentes = new Set(ratios().map((r) => `${r.ratio.toFixed(2)}:1`))
    const viejos: string[] = []

    for (const archivo of archivosDeCodigo()) {
      for (const [cita] of readFileSync(archivo, 'utf8').matchAll(CITA)) {
        if (!vigentes.has(cita)) viejos.push(`${archivo}: ${cita}`)
      }
    }

    expect(
      viejos,
      `estos ratios están escritos en el código y no coinciden con ninguno de los ` +
        `que scripts/contraste.mts calcula sobre los tokens reales: ` +
        `${viejos.join(', ')}. O el comentario quedó viejo —corregilo con lo que ` +
        `imprime \`npm run contraste\`—, o el par que cita no está en PARES y hay ` +
        `que agregarlo. Los ratios vigentes son: ${[...vigentes].join(', ')}.`,
    ).toEqual([])
  })

  // La otra mitad: cero citas encontradas son cero comparaciones, y cero
  // comparaciones no fallan nunca. Es el mismo modo de falla que ya cuidan
  // `hay pares declarados` y `la tabla del documento no está vacía`.
  it('hay ratios citados que comparar', () => {
    const citas = archivosDeCodigo().flatMap((a) => [
      ...readFileSync(a, 'utf8').matchAll(CITA),
    ])
    expect(
      citas.length,
      'no se encontró un solo ratio escrito en app/ ni en components/. O se ' +
        'borraron todos los comentarios que citaban uno —y entonces este caso ya ' +
        'no cuida nada— o el regex dejó de matchear la forma en que se escriben.',
    ).toBeGreaterThan(0)
  })
})
