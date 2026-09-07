import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { ANCHO_MINIMO_DOS_COLUMNAS, NOMBRE_DEL_CONTENEDOR } from '@/hooks/use-dos-columnas'

/**
 * Compila el CSS real del proyecto contra las clases reales de la pantalla.
 *
 * POR QUÉ NO ALCANZA CON MIRAR EL FUENTE: una variante de Tailwind que no
 * existe no emite nada y no falla. Un `@cobro/ventas:` con una ese de más, o un
 * `--container-cobro` que quedó fuera del bloque `@theme`, dejan la pantalla en
 * una sola columna en TODOS los anchos, y ningún caso que lea el .tsx lo vería:
 * las clases estarían escritas igual.
 *
 * `source(none)` + un `@source` puntual en vez del escaneo automático: sin eso
 * Tailwind recorre el repo entero y este caso pasaría a tardar segundos.
 *
 * `@source` resuelve su ruta relativa AL PROPIO `app/globals.css` (a la
 * carpeta `app/`), no al cwd del proceso — verificado contra 4.3.3 real: con
 * `@source "app/(app)/vender/punto-de-venta.tsx"` (relativo al cwd, como si
 * fuera la ruta del repo) Tailwind busca
 * `app/app/(app)/vender/punto-de-venta.tsx`, no encuentra nada, y **no
 * falla**: compila igual, sin la consulta, en silencio — exactamente el modo
 * de falla que este caso existe para atrapar. Por eso la ruta se arma con
 * `path.resolve`, absoluta, que no depende de la base implícita de `@source`.
 */
const GLOBALS = 'app/globals.css'
const PANTALLA = path.resolve('app/(app)/vender/punto-de-venta.tsx')

async function compilar(): Promise<string> {
  const original = readFileSync(GLOBALS, 'utf8')
  const acotado = original.replace(
    '@import "tailwindcss";',
    `@import "tailwindcss" source(none);\n@source "${PANTALLA}";`,
  )
  const resultado = await postcss([tailwind()]).process(acotado, {
    from: path.resolve(GLOBALS),
  })
  return resultado.css
}

describe('el container query de /vender llega al CSS', () => {
  it('emite la consulta contra el contenedor con nombre y el umbral declarado', async () => {
    const css = await compilar()
    expect(css).toContain(`container-name: ${NOMBRE_DEL_CONTENEDOR}`)
    expect(css).toContain(
      `@container ${NOMBRE_DEL_CONTENEDOR} (width >= ${ANCHO_MINIMO_DOS_COLUMNAS}px)`,
    )
  })

  it('la fila y el panel están adentro de esa consulta', async () => {
    const css = await compilar()
    const bloques = css.split(
      `@container ${NOMBRE_DEL_CONTENEDOR} (width >= ${ANCHO_MINIMO_DOS_COLUMNAS}px)`,
    )
    const dentro = bloques.slice(1).join('\n')
    expect(dentro, 'la fila no pasa a flex-row en ningún ancho').toContain('flex-direction: row')
    // `w-96` no resuelve a `var(--container-sm)` en esta versión (Tailwind
    // 4.3.3 la emite como `calc(var(--spacing) * 96)`): se afirma la clase
    // escapada, que es lo que de verdad importa — que la regla exista
    // adentro del bloque del container query.
    expect(dentro, 'el panel no recupera sus 384 px').toContain('.\\@cobro\\/venta\\:w-96')
  })
})
