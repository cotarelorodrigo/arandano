import { describe, it, expect, beforeAll } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

const DOC = 'docs/pantallas.md'
const INICIO = '<!-- pantallas:inicio -->'
const FIN = '<!-- pantallas:fin -->'

// Las cuatro extensiones que Next resuelve, no sólo .tsx: una página escrita
// como page.ts es una ruta igual de navegable. Mismo supuesto que
// test/rutas-con-guard.test.ts y que el find de scripts/lib/rutas-comun.sh.
//
// `forbidden` y `unauthorized` NO entran, y ahí este check se aparta del de
// guardas a propósito: las renderiza Next ante forbidden()/unauthorized(), no
// son rutas que alguien navegue, y no hay features que documentarles.
const ES_PAGINA = /^page\.(tsx|ts|jsx|js)$/

/**
 * Las rutas de la aplicación, derivadas del sistema de archivos.
 *
 * Derivadas y no escritas a mano por lo mismo que `rutas_autenticadas` de
 * scripts/lib/rutas-comun.sh: una lista a mano deja una pantalla nueva fuera
 * del check sin decir una palabra, que es el modo de falla que este archivo
 * existe para impedir.
 *
 * Los grupos de ruta —`(app)`— no aparecen en la URL, así que se descartan.
 */
function rutas(dir = 'app', acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      rutas(completo, acumulado)
    } else if (ES_PAGINA.test(entrada)) {
      const partes = path
        .dirname(completo)
        .split(path.sep)
        .slice(1)
        .filter((p) => !(p.startsWith('(') && p.endsWith(')')))
      acumulado.push('/' + partes.join('/'))
    }
  }
  return acumulado
}

/**
 * Las rutas que DECLARA el documento, por sus encabezados `## \`/…\``.
 *
 * Entre marcadores y no "todos los `##` del archivo": el documento tiene además
 * secciones de prosa con encabezado propio, y un parser que agarre cualquiera
 * se rompe el día que alguien sume una. Mismo reparto que el de
 * test/sistema-de-diseno.test.ts.
 */
function rutasDelDoc(): string[] {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(
      `${DOC} no tiene los marcadores ${INICIO} … ${FIN} alrededor de las secciones ` +
        `de pantalla, o están al revés. Sin ellos no hay nada contra qué comparar app/.`,
    )
  }
  return texto
    .slice(desde, hasta)
    .split('\n')
    .map((l) => l.match(/^## `([^`]+)`/)?.[1])
    .filter((r): r is string => Boolean(r))
}

describe('el documento de pantallas y app/ declaran lo mismo', () => {
  let enElCodigo: string[]
  let enElDoc: string[]

  beforeAll(() => {
    enElCodigo = rutas()
    enElDoc = rutasDelDoc()
  })

  // Las dos mitades que hacen que esto no sea decorativo: dos listas vacías son
  // iguales, y el test daría verde sobre un documento roto o un parser que dejó
  // de matchear. Es el mismo modo de falla que ya cerraron `rutas_autenticadas`
  // y los dos casos "no está vacía" de test/sistema-de-diseno.test.ts.
  it('encuentra páginas en app/', () => {
    expect(enElCodigo.length).toBeGreaterThan(0)
  })

  it('el documento declara pantallas', () => {
    expect(
      enElDoc.length,
      `no se parseó ninguna sección de ${DOC}. O quedó vacío, o cambió el formato ` +
        `de los encabezados y el regex dejó de matchear.`,
    ).toBeGreaterThan(0)
  })

  it('toda pantalla del código está documentada', () => {
    const sinDocumentar = enElCodigo.filter((r) => !enElDoc.includes(r))
    expect(
      sinDocumentar,
      `estas pantallas existen en app/ y ${DOC} no las describe: ` +
        `${sinDocumentar.join(', ')}. Una pantalla que nadie documentó es una que ` +
        `nadie sabe que existe hasta que la encuentra por accidente. Agregá una ` +
        `sección "## \`<ruta>\`" entre los marcadores.`,
    ).toEqual([])
  })

  it('toda pantalla documentada existe en el código', () => {
    const fantasmas = enElDoc.filter((r) => !enElCodigo.includes(r))
    expect(
      fantasmas,
      `${DOC} describe pantallas que ya no existen en app/: ${fantasmas.join(', ')}. ` +
        `Un documento que promete una pantalla borrada es peor que no tenerlo: ` +
        `manda a buscar algo que no está.`,
    ).toEqual([])
  })

  it('ninguna sección aparece dos veces', () => {
    // Un duplicado hace que las dos comparaciones de arriba pasen igual —el
    // `includes` no cuenta— mientras el documento tiene dos descripciones de la
    // misma pantalla, que van a divergir.
    const repetidas = enElDoc.filter((r, i) => enElDoc.indexOf(r) !== i)
    expect(repetidas, `${DOC} tiene dos secciones para: ${repetidas.join(', ')}`).toEqual([])
  })
})
