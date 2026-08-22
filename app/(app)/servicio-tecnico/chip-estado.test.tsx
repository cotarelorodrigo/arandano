import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ESTADOS, ESTADO_VISUAL, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { ChipEstadoFila } from './chip-estado'

/**
 * El bug que este archivo existe para que no vuelva: la versión a medio
 * escribir de `ChipEstadoFila` tenía
 * `{estado === 'RECIBIDO' ? 'Recibido' : undefined}` en vez de
 * `NOMBRE_ESTADO[estado]` — ocho de los nueve estados renderizaban un chip
 * VACÍO, con su ícono y su color pero SIN texto. Un test que sólo probara
 * "el chip existe" o que sólo mirara RECIBIDO no lo hubiera atrapado: hay
 * que recorrer los nueve, uno por uno.
 */
describe('ChipEstadoFila', () => {
  it.each(ESTADOS)('%s muestra su nombre en castellano', (estado) => {
    const html = renderToStaticMarkup(<ChipEstadoFila estado={estado} />)
    expect(html).toContain(NOMBRE_ESTADO[estado])
  })

  it.each(ESTADOS)('%s pinta con TODAS las clases que ESTADO_VISUAL le declara', (estado) => {
    const html = renderToStaticMarkup(<ChipEstadoFila estado={estado} />)
    // No alcanza con una sola clase: dos estados pueden compartir el mismo
    // fondo (Recibido y En diagnóstico comparten bg-muted) y sólo el texto
    // y el ícono los distinguen — pero ninguno puede faltar.
    for (const clase of ESTADO_VISUAL[estado].clase.split(' ')) {
      expect(html, `${estado} no tiene la clase ${clase}`).toContain(clase)
    }
  })

  it.each(ESTADOS)('%s incluye un ícono', (estado) => {
    const html = renderToStaticMarkup(<ChipEstadoFila estado={estado} />)
    expect(html).toContain('<svg')
  })

  // Recibido y En diagnóstico comparten exactamente el mismo par fondo/texto
  // (bg-muted text-foreground-soft) en ESTADO_VISUAL: el color solo no
  // alcanza para saber cuál es cuál. El ícono (Inbox vs. Search) y el
  // rótulo sí los distinguen, y por eso el HTML completo tiene que diferir.
  it('dos estados con el mismo color se distinguen igual (el ícono y el rótulo, no el fondo)', () => {
    const recibido = renderToStaticMarkup(<ChipEstadoFila estado="RECIBIDO" />)
    const diagnostico = renderToStaticMarkup(<ChipEstadoFila estado="EN_DIAGNOSTICO" />)
    expect(ESTADO_VISUAL.RECIBIDO.clase).toBe(ESTADO_VISUAL.EN_DIAGNOSTICO.clase)
    expect(recibido).not.toBe(diagnostico)
  })

  // Hallazgo M7 de la review final: `badgeVariants` trae `[&>svg]:size-3!`
  // con `!important`, que gana por especificidad de selector sobre una clase
  // puesta en el propio ícono (`size-[11px]`) — el chip renderizaba a 12px, no
  // a los 11 que pide la maqueta. La corrección va en la clase del `<Badge>`
  // (tailwind-merge descarta el `size-3!` de base al ver el mismo modificador
  // `[&>svg]` de nuevo), así que lo que hay que comprobar es que el `size-3!`
  // de base ya NO sobrevive al merge, no que "algo diga 11px" en el fuente.
  it.each(ESTADOS)('%s renderiza su ícono a 11px, sin el size-3! que impone Badge por default', (estado) => {
    const html = renderToStaticMarkup(<ChipEstadoFila estado={estado} />)
    // El atributo class sale HTML-escapado (`&` -> `&amp;`, `>` -> `&gt;`) en
    // el markup estático, así que se busca el fragmento que sobrevive intacto
    // a ese escape.
    expect(html).toContain('size-[11px]!')
    expect(html).not.toContain('size-3!')
  })
})
