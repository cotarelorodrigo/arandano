import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { ANCHO_MINIMO_DOS_COLUMNAS, NOMBRE_DEL_CONTENEDOR } from '@/hooks/use-dos-columnas'

/**
 * Compila el CSS real del proyecto contra las clases reales de la pantalla.
 *
 * POR QUÉ NO ALCANZA CON MIRAR EL FUENTE: una variante de Tailwind mal
 * escrita no necesariamente deja de emitir CSS — depende de CUÁL mitad está
 * mal. Un `--container-cobro` que quedara fuera del bloque `@theme` sí deja a
 * Tailwind sin tamaño que resolver y no emite la consulta. Pero un
 * `@cobro/ventas:` con una ese de más en el NOMBRE del contenedor SÍ compila:
 * Tailwind acepta cualquier nombre después de la `/` sin verificar que exista
 * algún `@container/ventas` en el árbol, así que emite
 * `@container ventas (width >= 850px) { .\@cobro\/ventas\:flex-row {…} }`
 * contra un contenedor que nadie declara — la regla nunca dispara, porque
 * ningún ancestro se llama así, y la pantalla queda en una sola columna en
 * TODOS los anchos sin que nada avise. Los dos errores dejan la pantalla
 * igual de rota; ningún caso que lea el .tsx ve la diferencia, porque las
 * clases están escritas igual en el fuente.
 *
 * Y ESTE MISMO CASO tenía la versión anterior del error: comparaba con
 * `css.split(header)` y afirmaba propiedades CSS sueltas (`flex-direction:
 * row`) en vez de nombres de clase. Con el `ventas` de más, Tailwind emite
 * el bloque `@container ventas (...)` INMEDIATAMENTE DESPUÉS del bloque
 * `@container venta (...)` real (que queda vacío de la fila, porque la
 * clase que la pone en `flex-row` ahora apunta al contenedor equivocado), y
 * `split(header).slice(1).join('\n')` no corta en la llave de cierre: se
 * lleva TODO lo que sigue en el archivo, `@container ventas` incluido. Ahí
 * vuelve a aparecer `flex-direction: row`, y una propiedad suelta no sabe
 * decir de qué contenedor vino. Por eso este archivo balancea llaves para
 * cortar en el cierre real, y afirma el NOMBRE DE CLASE escapado
 * (`.\@cobro\/venta\:flex-row`), que sí lleva el nombre del contenedor
 * adentro — una propiedad no.
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

/**
 * Extrae el CONTENIDO de cada bloque `${header} { … }`, balanceando llaves
 * desde la primera `{` que sigue al header hasta su cierre real — no hasta
 * la próxima aparición del header ni hasta el final del archivo.
 *
 * Por qué hace falta esto y no `css.split(header)`: Tailwind puede emitir
 * más de un `@container` con nombres parecidos uno detrás del otro (el caso
 * real: `venta` y, si alguien escribe mal la variante, `ventas`), y un
 * `split` no distingue "adentro de ESTE bloque" de "en cualquier lado del
 * archivo después de este punto". Devuelve la concatenación de todos los
 * bloques que matcheen el header exacto (hoy hay uno solo, pero no asume
 * que siga siendo así).
 */
function contenidoDeBloques(css: string, header: string): string {
  const partes: string[] = []
  let desde = 0
  for (;;) {
    const inicioHeader = css.indexOf(header, desde)
    if (inicioHeader === -1) break
    const apertura = css.indexOf('{', inicioHeader + header.length)
    if (apertura === -1) break
    let profundidad = 1
    let i = apertura + 1
    while (i < css.length && profundidad > 0) {
      if (css[i] === '{') profundidad++
      else if (css[i] === '}') profundidad--
      i++
    }
    partes.push(css.slice(apertura + 1, i - 1))
    desde = i
  }
  return partes.join('\n')
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
    const dentro = contenidoDeBloques(
      css,
      `@container ${NOMBRE_DEL_CONTENEDOR} (width >= ${ANCHO_MINIMO_DOS_COLUMNAS}px)`,
    )
    // Nombres de CLASE escapados, no propiedades CSS sueltas: una propiedad
    // como `flex-direction: row` no dice de qué contenedor vino y aparecería
    // igual si la variante apuntara a `ventas` en vez de `venta` (ver el
    // docblock). El nombre de clase escapado lleva el nombre del contenedor
    // adentro (`\@cobro\/venta\:`), así que sólo matchea si la regla es la
    // correcta.
    expect(dentro, 'la fila no pasa a @cobro/venta:flex-row').toContain(
      '.\\@cobro\\/venta\\:flex-row',
    )
    expect(dentro, 'el panel no recupera sus 384 px (@cobro/venta:w-96)').toContain(
      '.\\@cobro\\/venta\\:w-96',
    )
  })
})
