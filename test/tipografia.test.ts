import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

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
