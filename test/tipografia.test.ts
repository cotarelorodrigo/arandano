import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const LAYOUT = 'app/layout.tsx'

/**
 * El fuente sin espacios y con las comillas unificadas.
 *
 * Comparar contra el archivo tal cual sería pelearle al formateador: el día que
 * prettier parta el objeto de `declarations` en dos líneas, el rojo hablaría del
 * formato y no del descriptor, que es lo único que importa acá.
 */
function compacto(ruta: string): string {
  return readFileSync(ruta, 'utf8')
    .replace(/\s+/g, '')
    .replace(/['"]/g, '"')
}

describe('el eje de ancho de Archivo está activado', () => {
  it('app/layout.tsx declara el descriptor font-stretch', () => {
    expect(
      compacto(LAYOUT),
      `${LAYOUT} dejó de declarar el descriptor font-stretch de Archivo en ` +
        `localFont({ declarations }). Sin él el eje wdth no se activa: los ` +
        `font-stretch de components/cartel.module.css y ` +
        `app/login/persiana.module.css dejan de tener efecto y NO avisa — se ve ` +
        `una Archivo de ancho normal y parece una decisión de diseño.`,
    ).toContain('prop:"font-stretch",value:"62%125%"')
  })
})

const DOC = 'docs/sistema-de-diseno.md'
const INICIO = '<!-- escala:inicio -->'
const FIN = '<!-- escala:fin -->'

/**
 * Qué módulo CSS implementa cada rol de la tabla.
 *
 * El test no puede deducirlo: la tabla habla de ROLES y el CSS habla de
 * ARCHIVOS. Este mapa es el puente, y que haya que tocarlo para sumar un rol
 * con cara propia es parte del punto — obliga a decir dónde vive.
 */
const MODULOS_POR_ROL: Record<string, string[]> = {
  Cartel: ['app/login/persiana.module.css', 'components/cartel.module.css'],
  Importe: ['components/importe.module.css'],
  'Título de pantalla': ['components/shell/encabezado.module.css'],
  // Sin font-stretch (ver el comentario del propio módulo), así que nunca
  // aparece vía anchosDelDoc() — está acá sólo para que "ningún módulo
  // declara un ancho que el documento no documente" sepa que este archivo SÍ
  // tiene un rol escrito, y no lo marque como un consumidor fantasma de
  // var(--font-archivo).
  Cobro: ['app/(app)/vender/cobro.module.css'],
}

/** Rol → `font-stretch`, leído de la tabla normativa entre marcadores. */
function anchosDelDoc(): Map<string, string> {
  const texto = readFileSync(DOC, 'utf8')
  const desde = texto.indexOf(INICIO)
  const hasta = texto.indexOf(FIN)
  if (desde === -1 || hasta === -1 || hasta < desde) {
    throw new Error(
      `${DOC} no tiene los marcadores ${INICIO} … ${FIN} alrededor de la tabla ` +
        `de la escala, o están al revés. Sin ellos no hay nada contra qué ` +
        `comparar los módulos CSS.`,
    )
  }
  const anchos = new Map<string, string>()
  for (const linea of texto.slice(desde, hasta).split('\n')) {
    const rol = linea.match(/^\|\s*\*\*([^*]+)\*\*/)
    const ancho = linea.match(/`font-stretch:\s*([\d.]+%)`/)
    if (rol && ancho) anchos.set(rol[1].trim(), ancho[1])
  }
  return anchos
}

/** Todos los módulos CSS del repo, sin node_modules ni directorios ocultos. */
function modulosDelRepo(dir = '.', encontrados: string[] = []): string[] {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) modulosDelRepo(ruta, encontrados)
    else if (entrada.name.endsWith('.module.css')) encontrados.push(ruta)
  }
  return encontrados
}

function anchosDeArchivo(ruta: string): string[] {
  const css = readFileSync(ruta, 'utf8')
  return [...css.matchAll(/font-stretch:\s*([\d.]+%)/g)].map((m) => m[1])
}

/**
 * Si el módulo consume la cara de display, sea cual sea el motivo.
 *
 * El disparador de la vigilancia es ÉSTE y no "declara font-stretch": un
 * módulo que meta `font-family: var(--font-archivo)` y se olvide el
 * font-stretch no queda en un ancho documentado por accidente, queda en el
 * 100% por default del navegador — la cara de display normal, sin declarar,
 * sin fila en la tabla de la escala y sin que nadie se entere. Si el gate
 * sólo mirara font-stretch, ese módulo pasaría entero desapercibido.
 */
function usaArchivo(ruta: string): boolean {
  return readFileSync(ruta, 'utf8').includes('var(--font-archivo)')
}

describe('la escala tipográfica y los módulos declaran lo mismo', () => {
  // Fail-closed, igual que `la tabla del documento no está vacía` del test de
  // color: un parser que no encuentra filas devuelve un Map vacío, y sobre un
  // Map vacío los dos casos de abajo pasan sin mirar nada.
  it('la tabla de la escala no está vacía', () => {
    expect(
      anchosDelDoc().size,
      `no se parseó ningún rol con font-stretch de la tabla de la escala de ` +
        `${DOC}. O la tabla quedó vacía, o cambió el formato de las filas y el ` +
        `regex dejó de matchear.`,
    ).toBeGreaterThan(0)
  })

  // Fail-closed del otro lado de la comparación: si el barrido del filesystem
  // se rompiera (ruta base equivocada, filtro de más) devolvería `[]`, y sobre
  // una lista vacía los casos de abajo recorrerían cero archivos y pasarían
  // sin mirar nada — el mismo modo de falla que el caso de arriba cubre para
  // la tabla del documento.
  it('el barrido de módulos CSS no viene vacío', () => {
    expect(
      modulosDelRepo().length,
      `modulosDelRepo() no encontró ningún archivo .module.css en el repo. ` +
        `Hay al menos persiana, cartel e importe, así que una lista vacía es el ` +
        `barrido roto, no el repo sin módulos CSS.`,
    ).toBeGreaterThan(0)
  })

  it('todo rol con ancho propio lo declara igual en su módulo', () => {
    for (const [rol, ancho] of anchosDelDoc()) {
      const modulos = MODULOS_POR_ROL[rol]
      expect(
        modulos,
        `${DOC} declara el rol "${rol}" con font-stretch: ${ancho}, y ` +
          `MODULOS_POR_ROL no dice qué módulo CSS lo implementa. Agregalo ahí, ` +
          `o el rol nuevo queda sin vigilancia.`,
      ).toBeDefined()
      for (const ruta of modulos) {
        const declarados = anchosDeArchivo(ruta)
        expect(
          declarados,
          `${DOC} declara "${rol}" con font-stretch: ${ancho}, y ${ruta} ` +
            `declara ${declarados.length ? declarados.join(', ') : 'ninguno'}. ` +
            `El documento es la fuente de verdad: si el ancho cambió, cambialo ` +
            `en los dos.`,
        ).toContain(ancho)
      }
    }
  })

  it('ningún módulo declara un ancho que el documento no documente', () => {
    const documentados = new Set(anchosDelDoc().values())
    const mapeados = new Set(Object.values(MODULOS_POR_ROL).flat())
    for (const ruta of modulosDelRepo()) {
      // El disparador es CONSUMIR la cara de display (`usaArchivo`), no
      // declarar font-stretch: ver el comentario de esa función.
      if (!usaArchivo(ruta)) continue
      expect(
        mapeados.has(ruta),
        `${ruta} usa var(--font-archivo) y no figura en MODULOS_POR_ROL. Un ` +
          `consumidor de la cara de display que no corresponde a ningún rol ` +
          `escrito es exactamente lo que la tabla de la escala existe para ` +
          `impedir.`,
      ).toBe(true)
      for (const ancho of anchosDeArchivo(ruta)) {
        expect(
          documentados.has(ancho),
          `${ruta} declara font-stretch: ${ancho}, que no figura en la tabla de ` +
            `la escala de ${DOC}.`,
        ).toBe(true)
      }
    }
  })
})

describe('el CSS module del importe declara de verdad lo que el TSX referencia', () => {
  // vitest corre con `css: false`: importar un .module.css devuelve un Proxy
  // que fabrica `_<clave>_<hash>` para CUALQUIER propiedad que se le pida,
  // exista la clase o no. Verificado a mano: renombrando `.total` a
  // `.totalRenombrado` en components/importe.module.css, sin tocar el TSX,
  // los tests de arriba (que sólo miran `estilos.total}` en el FUENTE del
  // TSX, o el className fabricado por el Proxy) siguen en verde — cuando en
  // el build real, con Lightning CSS procesando el módulo de verdad,
  // `estilos.total` sería `undefined` y el pie se renderizaría con
  // `class="undefined text-right"`: sin Archivo, sin 85%, sin cifras
  // tabulares, sin 40 px y sin peso 600, y ningún test lo notaría. Este caso
  // lee el TEXTO del CSS —no el módulo importado— y comprueba que los
  // selectores existen de verdad, que es lo único que cierra ese agujero.
  const RUTA_CSS = 'components/importe.module.css'

  it.each(['.importe', '.total'])('declara el selector %s', (selector) => {
    const css = readFileSync(RUTA_CSS, 'utf8')
    const propiedad = selector.slice(1)
    expect(
      css.includes(`${selector} {`),
      `${RUTA_CSS} no declara ${selector}. ` +
        `app/(app)/vender/punto-de-venta.tsx referencia estilos.${propiedad} — ` +
        `pero vitest corre con css: false, así que un CSS module fabrica un ` +
        `className para CUALQUIER propiedad, exista la clase o no. En el build ` +
        `real esa clase sería undefined y el rol Importe desaparecería sin que ` +
        `ningún test lo note.`,
    ).toBe(true)
  })
})

describe('el CSS module del encabezado declara de verdad lo que el TSX referencia', () => {
  // Mismo agujero que el bloque de arriba, mismo cierre: components/shell/
  // encabezado.tsx referencia estilos.titulo del Proxy que css: false fabrica,
  // así que un .titulo renombrado en el módulo (o nunca escrito) seguiría en
  // verde ahí. Sólo leer el TEXTO del CSS lo destapa.
  const RUTA_CSS = 'components/shell/encabezado.module.css'
  const RUTA_TSX = 'components/shell/encabezado.tsx'

  it('declara el selector .titulo', () => {
    const css = readFileSync(RUTA_CSS, 'utf8')
    expect(
      css.includes('.titulo {'),
      `${RUTA_CSS} no declara .titulo. ${RUTA_TSX} referencia estilos.titulo — ` +
        `pero vitest corre con css: false, así que un CSS module fabrica un ` +
        `className para CUALQUIER propiedad, exista la clase o no. En el build ` +
        `real esa clase sería undefined y el <h1> de las diez pantallas se ` +
        `quedaría sin Archivo, sin 21 px y sin peso 600, sin que ningún test lo ` +
        `note.`,
    ).toBe(true)
  })

  it(`${RUTA_TSX} referencia estilos.titulo`, () => {
    expect(readFileSync(RUTA_TSX, 'utf8')).toContain('estilos.titulo')
  })
})
