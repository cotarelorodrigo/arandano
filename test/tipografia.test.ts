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
      const declarados = anchosDeArchivo(ruta)
      if (declarados.length === 0) continue
      expect(
        mapeados.has(ruta),
        `${ruta} declara font-stretch y no figura en MODULOS_POR_ROL. Un ancho ` +
          `de Archivo que no corresponde a ningún rol escrito es exactamente lo ` +
          `que la tabla de la escala existe para impedir.`,
      ).toBe(true)
      for (const ancho of declarados) {
        expect(
          documentados.has(ancho),
          `${ruta} declara font-stretch: ${ancho}, que no figura en la tabla de ` +
            `la escala de ${DOC}.`,
        ).toBe(true)
      }
    }
  })
})
