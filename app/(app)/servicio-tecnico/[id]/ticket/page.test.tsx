// Whitebox sobre el FUENTE: Ticket es un Server Component async con sesión y
// Prisma reales, sin arnés en este repo para montarlo fuera de un request —
// mismo criterio que app/(app)/ventas/[id]/page.test.tsx.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

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
  // Multilínea y no [^>]*: accionMovil viaja como objeto, en varias líneas.
  // \s obligatorio después de "Encabezado" (y no "<Encabezado>" pelado): así
  // una mención al componente en un comentario de más arriba no puede colar
  // como si fuera la apertura de la etiqueta real.
  const etiqueta = fuente.match(/<Encabezado\s[\s\S]*?\/>/)?.[0]

  it('existe el <Encabezado> de esta pantalla', () => {
    expect(etiqueta, `no se encontró <Encabezado ... /> en: ${fuente}`).toBeTruthy()
  })

  it('vuelve a la ficha de la orden, no al tablero', () => {
    expect(etiqueta).toContain('atras={`/servicio-tecnico/${id}`}')
  })

  // La ranura derecha de esta pantalla es la excepción tono='accion' del
  // grupo "printer": en /servicio-tecnico/[id] y /ventas/[id] el mismo ícono
  // es tono='suave' (acción secundaria); acá ES la acción de la pantalla.
  it('la ranura derecha del teléfono es "printer", tono acción', () => {
    expect(etiqueta).toContain('icono: Printer')
    expect(etiqueta).toContain("tono: 'accion'")
  })

  it('el href del ícono de imprimir es esta misma pantalla', () => {
    // `href:` (propiedad de objeto), no `href={` (atributo JSX): accionMovil
    // viaja como objeto literal, no como prop directa del Encabezado.
    expect(etiqueta).toContain('href: `/servicio-tecnico/${id}/ticket`')
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
