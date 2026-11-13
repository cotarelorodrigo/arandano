import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { PasosDeIos } from './instalar'

const SIDEBAR = 'components/shell/sidebar-arandano.tsx'
const INSTALAR = 'components/shell/instalar.tsx'

describe('el botón de instalar', () => {
  const sidebar = readFileSync(SIDEBAR, 'utf8')
  const instalar = readFileSync(INSTALAR, 'utf8')

  it('está montado en el pie del sidebar', () => {
    expect(sidebar).toContain('<Instalar')
  })

  // Una sola copia, y no por descuido: components/ui/sidebar.tsx renderiza el
  // mismo {children} en el Sheet del teléfono y en el riel de escritorio. Si
  // alguna vez aparece una segunda, tiene que ser una decisión visible en el
  // diff y no un descubrimiento en producción — es la lección que dejó el merge
  // del ciclo móvil con las dos copias de "Anular orden".
  it('aparece una sola vez', () => {
    expect(sidebar.match(/<Instalar/g)).toHaveLength(1)
  })

  // La decisión vive en lib/pwa/instalacion.ts, que sí se puede probar sin DOM.
  // Un componente que la reimplemente por su cuenta deja esos ocho casos
  // probando algo que la pantalla no usa.
  it('no reimplementa la decisión: la importa', () => {
    expect(instalar).toContain('estadoDeInstalacion')
    expect(instalar).not.toContain('/iPad|iPhone|iPod/')
  })

  it('escucha el evento del que depende el camino de Chrome', () => {
    expect(instalar).toContain('beforeinstallprompt')
  })
})

/**
 * Los pasos del diálogo de iOS, como los dibuja `App / PWA · Instalar e ícono
 * (estados)` (`RVTcW`, nodo `svRju`): numerados con un círculo de 22 px en
 * `--primary-soft`, el ícono `share` sólo en el paso que lo nombra, y el texto
 * al lado. Antes el `<ol>` no mostraba números y el ícono del primer paso era
 * lo único que marcaba la línea (entrada 32 de
 * docs/correcciones-pendientes-del-pen.md).
 *
 * Se prueban sueltos y no adentro del diálogo: `DialogContent` (Radix) sólo se
 * monta abierto, así que el diálogo cerrado nunca los mostraría.
 */
describe('los pasos de iOS', () => {
  const html = renderToStaticMarkup(<PasosDeIos />)
  const pasos = html.match(/<li[\s>][\s\S]*?<\/li>/g) ?? []

  it('son tres, en una lista ordenada', () => {
    expect(html.startsWith('<ol')).toBe(true)
    expect(pasos).toHaveLength(3)
  })

  it('cada paso lleva su número visible, en el círculo de 22 px', () => {
    pasos.forEach((paso, i) => {
      expect(paso).toMatch(
        new RegExp(`<span class="[^"]*\\bsize-\\[22px\\][^"]*\\bbg-accent\\b[^"]*">${i + 1}</span>`),
      )
    })
  })

  it('el ícono de compartir va sólo en el paso que lo nombra', () => {
    expect(pasos[0]).toContain('lucide-share')
    expect(pasos[1]).not.toContain('<svg')
    expect(pasos[2]).not.toContain('<svg')
  })

  it('dice lo que dice la maqueta, con las comillas latinas', () => {
    expect(pasos[0]).toContain('Tocá Compartir.')
    expect(pasos[1]).toContain('Elegí «Agregar a inicio».')
    expect(pasos[2]).toContain('Confirmá con Agregar, arriba a la derecha.')
  })
})
