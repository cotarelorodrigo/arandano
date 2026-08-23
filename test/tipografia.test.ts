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
  // Task 2 del cierre: el H1 "Entrar" vive en el mismo módulo que el Cartel
  // (persiana.module.css es el único CSS module que admite el brief de esa
  // task), sin font-stretch propio — mismo motivo que Cobro/Título de card
  // más arriba, sólo hace falta acá para que el chequeo de "consumidor
  // fantasma" no lo marque.
  'H1 de login': ['app/login/persiana.module.css'],
  Importe: ['components/importe.module.css'],
  'Título de pantalla': ['components/shell/encabezado.module.css'],
  // Sin font-stretch (ver el comentario del propio módulo), así que nunca
  // aparece vía anchosDelDoc() — está acá sólo para que "ningún módulo
  // declara un ancho que el documento no documente" sepa que este archivo SÍ
  // tiene un rol escrito, y no lo marque como un consumidor fantasma de
  // var(--font-archivo).
  Cobro: ['app/(app)/vender/cobro.module.css'],
  // Los seis roles del rediseño de /ventas y /ventas/[id], los seis en el
  // mismo módulo compartido y los seis sin font-stretch propio (mismo motivo
  // que Cobro, arriba): ninguno le pide un ancho al eje `wdth`, así que
  // ninguno aparece vía anchosDelDoc() — están acá sólo para que el chequeo
  // de "consumidor fantasma" los reconozca.
  // La cuarta pantalla, servicio-tecnico/tipografia.module.css, se sumó acá
  // mismo en el rediseño de /servicio-tecnico (Task 2 del ciclo de las tres
  // pantallas) en vez de abrir una segunda clave — mismo criterio que ya
  // explica el comentario de "Número de paginación" más abajo: es el MISMO
  // rol (15 px, peso 600), no uno nuevo por pantalla.
  // La quinta pantalla (Task 1 del cierre): app/(app)/usuarios/
  // tipografia.module.css, sumado igual que las tres anteriores — sólo dos
  // de los tres títulos de card de esa pantalla pagan Archivo (ver el
  // comentario del propio módulo: "Dos reglas..." usa la pila del sistema,
  // hallazgo de consultar el .pen en vivo).
  'Título de card': [
    'app/(app)/ventas/tipografia.module.css',
    'app/(app)/inventario/tipografia.module.css',
    'app/(app)/servicio-tecnico/tipografia.module.css',
    'app/(app)/usuarios/tipografia.module.css',
  ],
  'Valor de tile': ['app/(app)/ventas/tipografia.module.css'],
  'Monto de tabla': ['app/(app)/ventas/tipografia.module.css'],
  'Banda de Total': ['app/(app)/ventas/tipografia.module.css'],
  // Mismo rótulo en negrita que la fila de /ventas (el texto entre `**` no
  // lleva el "— /ventas"/"— /inventario"/"— /servicio-tecnico" del final):
  // las tres pantallas comparten el nombre del rol, cada una con su propio
  // módulo, así que el arreglo suma el archivo en vez de abrir una clave
  // nueva. La tercera entrada (servicio-tecnico) se sumó en la fix wave de la
  // review final (hallazgo M3): la paginación de esa pantalla ya pagaba
  // Archivo con el mismo tratamiento (13 px, peso 600) pero no tenía fila
  // propia en la tabla de la escala.
  'Número de paginación': [
    'app/(app)/ventas/tipografia.module.css',
    'app/(app)/inventario/tipografia.module.css',
    'app/(app)/servicio-tecnico/tipografia.module.css',
  ],
  Cotización: ['app/(app)/ventas/tipografia.module.css'],
  // Rediseño de /inventario (Task 2): mismo motivo que Cobro/los roles de
  // /ventas de arriba — sin font-stretch propio, así que sólo hace falta acá
  // para que el chequeo de "consumidor fantasma" no lo marque.
  'Código/precio/stock de tabla': ['app/(app)/inventario/tipografia.module.css'],
  // Dos roles nuevos del rediseño de /servicio-tecnico (Task 2 del ciclo de
  // las tres pantallas), mismo motivo que Cobro/los de /ventas e /inventario
  // de arriba — sin font-stretch propio, sólo hace falta acá para que el
  // chequeo de "consumidor fantasma" no marque este módulo.
  'Número de orden': ['app/(app)/servicio-tecnico/tipografia.module.css'],
  'Conteo de chip': ['app/(app)/servicio-tecnico/tipografia.module.css'],
}

/**
 * Rol → `font-stretch`, leído de la tabla normativa entre marcadores.
 *
 * Recibe el TEXTO como parámetro (por defecto, el propio `DOC`) sólo para que
 * el caso de más abajo pueda ejercitarla contra una tabla sintética sin tocar
 * el documento real.
 */
function anchosDelDoc(texto: string = readFileSync(DOC, 'utf8')): Map<string, string> {
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
    if (!rol || !ancho) continue
    const clave = rol[1].trim()
    const valor = ancho[1]
    const previo = anchos.get(clave)
    // Dos filas pueden compartir el mismo rótulo en negrita (dos pantallas,
    // un mismo rol — "Número de paginación" hoy) sin que sea un problema,
    // mientras ninguna de las dos declare font-stretch: MODULOS_POR_ROL ya
    // las junta bajo una sola clave a propósito (ver su comentario). Lo que
    // no puede pasar en silencio es que las dos EMPIECEN a declarar un
    // font-stretch y sea distinto entre sí — un Map sólo guarda un valor por
    // clave, y sobreescribir sin avisar dejaría la primera fila sin ningún
    // chequeo real contra su módulo CSS (hallazgo de la review del rediseño
    // de /inventario, minors).
    if (previo !== undefined && previo !== valor) {
      throw new Error(
        `${DOC} tiene dos filas con el rótulo "${clave}" en negrita y ` +
          `font-stretch distinto (${previo} y ${valor}). anchosDelDoc() sólo ` +
          `puede guardar un valor por rótulo — si de verdad son dos anchos ` +
          `distintos, dales rótulos distintos en negrita (no sólo el ` +
          `"— /pantalla" del final, que queda afuera de los **...**).`,
      )
    }
    anchos.set(clave, valor)
  }
  return anchos
}

describe('anchosDelDoc detecta filas con el mismo rótulo y font-stretch distinto', () => {
  const tabla = (filas: string[]) => [INICIO, ...filas, FIN].join('\n')

  it('dos filas con el mismo rótulo y el MISMO font-stretch no chocan', () => {
    const texto = tabla([
      '| **Cartel** — nombre del local | Archivo | 19 px | 600, `font-stretch: 112%` |',
      '| **Cartel** — repetido a propósito para este test | Archivo | 19 px | 600, `font-stretch: 112%` |',
    ])
    expect(() => anchosDelDoc(texto)).not.toThrow()
    expect(anchosDelDoc(texto).get('Cartel')).toBe('112%')
  })

  // El caso que el minor de la review pide explícitamente: hoy "Número de
  // paginación" aparece dos veces sin font-stretch (por eso el Map de
  // anchosDelDoc() nunca las ve), pero el día que una de las dos declare un
  // ancho propio DISTINTO de la otra, sobreescribir en silencio dejaría la
  // primera fila sin ningún chequeo contra su módulo CSS.
  it('dos filas con el mismo rótulo y font-stretch DISTINTO explota, no se sobreescribe en silencio', () => {
    const texto = tabla([
      '| **Número de paginación** — /ventas | Archivo | 13 px | 600, `font-stretch: 100%` |',
      '| **Número de paginación** — /inventario | Archivo | 13 px | 600, `font-stretch: 90%` |',
    ])
    expect(() => anchosDelDoc(texto)).toThrow(/rótulo "Número de paginación"[\s\S]*distinto/)
  })
})

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

describe('el CSS module de tipografía de /ventas declara de verdad lo que el TSX referencia', () => {
  // Mismo agujero que los dos bloques de arriba: los tres consumidores
  // (page.tsx, [id]/page.tsx, grafico.tsx) referencian estilos.archivo y
  // estilos.tituloDeCard del Proxy que css: false fabrica, así que una clase
  // renombrada o nunca escrita en el módulo seguiría en verde en cualquier
  // test que sólo mire el className fabricado. Sólo leer el TEXTO del CSS lo
  // destapa.
  const RUTA_CSS = 'app/(app)/ventas/tipografia.module.css'
  const CONSUMIDORES = [
    'app/(app)/ventas/page.tsx',
    'app/(app)/ventas/[id]/page.tsx',
    'app/(app)/ventas/grafico.tsx',
  ]

  it.each(['.archivo', '.tituloDeCard'])('declara el selector %s', (selector) => {
    const css = readFileSync(RUTA_CSS, 'utf8')
    expect(
      css.includes(`${selector} {`),
      `${RUTA_CSS} no declara ${selector}. Sin la clase de verdad, el build ` +
        `real dejaría estilos.${selector.slice(1)} en undefined y las 19 ` +
        `apariciones de Archivo en /ventas y /ventas/[id] volverían a caer al ` +
        `default del navegador, sin fallback, sin que ningún test lo note.`,
    ).toBe(true)
  })

  it.each(CONSUMIDORES)('%s importa el módulo', (ruta) => {
    expect(readFileSync(ruta, 'utf8')).toMatch(/from '\.\.?\/tipografia\.module\.css'/)
  })
})
