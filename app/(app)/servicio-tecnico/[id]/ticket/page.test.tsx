// Whitebox sobre el FUENTE: Ticket es un Server Component async con sesión y
// Prisma reales, sin arnés en este repo para montarlo fuera de un request —
// mismo criterio que app/(app)/ventas/[id]/page.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { BotonImprimir } from './imprimir'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'

const RUTA_PAGE = 'app/(app)/servicio-tecnico/[id]/ticket/page.tsx'
const RUTA_CSS = 'app/(app)/servicio-tecnico/[id]/ticket/ticket.module.css'
const fuente = readFileSync(RUTA_PAGE, 'utf8')

/**
 * Task 9 del ciclo móvil (design/arandano.pen, frame `kNPwE`): esta pantalla
 * no tenía ningún `<Encabezado>` antes de este ciclo —ni en escritorio ni en
 * el teléfono—, así que sumarlo es la novedad del ciclo para las dos
 * maquetas (spec `2026-08-26-movil-design.md`, §6: "Suma el Topbar con
 * printer"), y no una regresión de aspecto en escritorio.
 */
describe('el Encabezado del ticket (Task 9 del ciclo móvil)', () => {
  // Multilínea y no [^>]*: las props viajan en varias líneas. \s obligatorio
  // después de "Encabezado" (y no "<Encabezado>" pelado): así una mención al
  // componente en un comentario de más arriba no puede colar como si fuera la
  // apertura de la etiqueta real. Y el cierre pide `/>` AL PRINCIPIO DE UNA
  // LÍNEA: desde que `controlMovil` recibe un elemento (`<BotonImprimir />`),
  // un `\/>` a secas cortaba la etiqueta en el `/>` de esa prop y dejaba
  // afuera todo lo que viniera después.
  const etiqueta = fuente.match(/<Encabezado\s[\s\S]*?\n\s*\/>/)?.[0]

  it('existe el <Encabezado> de esta pantalla', () => {
    expect(etiqueta, `no se encontró <Encabezado ... /> en: ${fuente}`).toBeTruthy()
  })

  it('vuelve a la ficha de la orden, no al tablero', () => {
    expect(etiqueta).toContain('atras={`/servicio-tecnico/${id}`}')
  })

  // La ranura derecha de esta pantalla es un CONTROL, no un link: imprimir no
  // es ir a ninguna URL, es un efecto sobre la página en la que ya se está.
  // La primera versión de esta pantalla lo puso como `accionMovil` con href a
  // su propia URL, y funcionaba de casualidad —el `<a>` pelado forzaba una
  // recarga completa de documento, que remontaba `ImprimirAlCargar`—; desde
  // que el Encabezado navega con `Link`, esa casualidad se termina.
  it('la ranura derecha del teléfono es un control, no un link a esta misma URL', () => {
    expect(etiqueta).toContain('controlMovil={<BotonImprimir />}')
    expect(etiqueta, 'accionMovil es SIEMPRE un link a otra URL: acá no hay ninguna').not.toContain(
      'accionMovil',
    )
  })

  // El Encabezado del ticket NO puede entrar al área imprimible: va con la
  // clase print:hidden, la misma que oculta el shell al imprimir.
  it('el Encabezado no entra al área imprimible: va con print:hidden', () => {
    const desde = fuente.indexOf('<Encabezado')
    const envoltorio = fuente.lastIndexOf('<div', desde)
    const cierreApertura = fuente.indexOf('>', envoltorio)
    expect(envoltorio).toBeGreaterThan(-1)
    expect(fuente.slice(envoltorio, cierreApertura)).toContain('print:hidden')
  })
})

/**
 * Task 9 del ciclo móvil: el cuerpo del ticket entra en un envoltorio con la
 * geometría de excepción que declara el plan —padding [16,44], gap 14—, pero
 * ese envoltorio se disuelve (`display: contents`) tanto en escritorio
 * (`lg:contents`) como al imprimir (`print:contents`): ni cambia el aspecto
 * de hoy en escritorio, ni le agrega un solo píxel de margen al papel.
 */
describe('el cuerpo del ticket, mobile-first (Task 9 del ciclo móvil)', () => {
  it('tiene la geometría de excepción del plan (padding [16,44], gap 14)', () => {
    expect(fuente).toContain('px-[44px]')
    expect(fuente).toContain('py-4')
    expect(fuente).toContain('gap-[14px]')
  })

  it('se disuelve en escritorio y al imprimir, sin afectar ninguno de los dos', () => {
    expect(fuente).toContain('lg:contents')
    expect(fuente).toContain('print:contents')
  })
})

/**
 * El caso que más fácil se rompe sin que nadie lo note hasta que sale un
 * papel mal cortado: el CSS de impresión de esta pantalla no se toca. Un hash
 * y no una lista de selectores — así cualquier cambio, hasta un espacio, lo
 * atrapa.
 *
 * EL HASH SE REBASELINEÓ UNA VEZ, en la Task 13 del mismo ciclo, y esa es la
 * única forma legítima de cambiarlo: la Task 9 dejó falsa una PREMISA del
 * comentario de ese archivo —decía que esta pantalla "nunca renderiza un
 * <Encabezado>", y esa misma task le sumó uno—, y la Task 9 tenía prohibido
 * tocarlo. La corrección fue de comentario y nada más: se verificó que el
 * archivo, con los comentarios eliminados, quedara idéntico byte a byte al de
 * antes. Un hash nuevo sin esa verificación es exactamente lo que este caso
 * existe para impedir.
 */
describe('ticket.module.css no cambia de reglas (Task 9 del ciclo móvil)', () => {
  it('sigue byte a byte igual', () => {
    const contenido = readFileSync(RUTA_CSS, 'utf8')
    const hash = createHash('sha256').update(contenido).digest('hex')
    expect(hash).toBe('7b46c4e684bd001711ede0641b90ed890615dc6857d343bb31e6e55002998aa0')
  })
})

/**
 * El botón de imprimir de la ranura derecha del teléfono, hallazgo I2 de la
 * review final del ciclo móvil.
 *
 * Antes de esta ola el botón NO tenía comportamiento propio: era un
 * `accionMovil` con `href` a la misma URL, y abría el diálogo de impresión
 * sólo porque el `<a>` pelado del Encabezado forzaba una recarga completa de
 * documento y esa recarga remontaba `ImprimirAlCargar`. Pasar el Encabezado a
 * `Link` (hallazgo I3, la misma ola) rompía eso en silencio: Next resuelve la
 * navegación como misma-ruta, no remonta nada, y ningún test caía.
 *
 * Por eso este caso afirma sobre el `onClick`, que es el mecanismo, y no
 * sobre el HTML, que es el aspecto: con el botón renderizado igual pero sin
 * handler, el aspecto sigue verde y el botón no imprime nada.
 */
describe('BotonImprimir (hallazgo I2 de la review final)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('llama a window.print() cuando se lo toca', () => {
    const imprimir = vi.fn()
    // El entorno de vitest es 'node': no hay window. Se stubea el mínimo que
    // el handler toca, que es justamente lo que este caso quiere observar.
    vi.stubGlobal('window', { print: imprimir })

    const elemento = BotonImprimir() as ReactElement<{ onClick?: () => void }>
    expect(elemento.props.onClick, 'el botón no tiene onClick: no imprime nada').toBeTypeOf(
      'function',
    )
    elemento.props.onClick?.()

    expect(imprimir).toHaveBeenCalledTimes(1)
  })

  it('es un <button type="button">, no un link', () => {
    const html = renderToStaticMarkup(<BotonImprimir />)
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
    expect(html, 'un <a> volvería a atar el imprimir a una navegación').not.toContain('<a ')
    expect(html).toContain('aria-label="Imprimir"')
  })

  it('comparte la geometría de la ranura y el tono de acción de la maqueta', () => {
    const html = renderToStaticMarkup(<BotonImprimir />)
    for (const clase of CLASES_RANURA_MOVIL.split(' ')) {
      expect(html, `falta la clase de ranura ${clase}`).toContain(clase)
    }
    // tono 'accion' (relleno de --primary), el mismo que tenía como
    // accionMovil: es LA acción de esta pantalla, no una secundaria.
    expect(html).toContain('bg-primary')
    expect(html).toContain('text-primary-foreground')
  })
})
