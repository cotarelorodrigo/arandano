import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TitularTipeado, Revelar, TarjetaAnimada } from './movimiento'

const fuente = () => readFileSync(path.join(process.cwd(), 'app/sitio/movimiento.tsx'), 'utf8')

/**
 * El movimiento decorativo de la landing.
 *
 * Estos casos existen por una razón concreta: el paquete completo de
 * movimiento —titular tipeado, revelados por scroll— pone en riesgo dos cosas
 * que no pueden romperse, y ninguna de las dos se nota mirando la página.
 * Un titular que se tipea puede dejar el H1 vacío para un buscador, y un
 * revelado por scroll puede dejar una sección invisible para siempre si el
 * disparador no llega a activarse.
 */
describe('el titular tipeado', () => {
  const html = () =>
    renderToStaticMarkup(<TitularTipeado texto="Todo el local en un solo lugar" className="x" />)

  /**
   * EL CASO QUE MÁS IMPORTA. Ésta es la única página que el producto indexa
   * (`test/indexacion.test.ts`), y su H1 es la señal más fuerte que le da a un
   * buscador. Si el titular sólo existiera después de que corra el JavaScript,
   * el HTML que ve un crawler tendría un H1 vacío.
   */
  it('el texto completo viaja en el HTML, no lo escribe el JavaScript', () => {
    expect(html()).toContain('Todo el local en un solo lugar')
  })

  it('y lo hace en un elemento que un lector de pantalla lee entero', () => {
    // sr-only: visible para la tecnología asistiva, invisible en pantalla. La
    // copia que se tipea va aria-hidden, para que nadie escuche el titular
    // letra por letra.
    expect(html()).toMatch(/class="sr-only">Todo el local en un solo lugar</)
    expect(html()).toContain('aria-hidden="true"')
  })

  it('sigue siendo un h1', () => {
    expect(html()).toMatch(/^<h1/)
  })

  /**
   * La caja se reserva antes de tipear. Sin esto cada letra empuja el layout y
   * la página entera baila mientras escribe — que además es exactamente lo que
   * mide Cumulative Layout Shift.
   */
  it('reserva la caja del titular terminado antes de escribirlo', () => {
    expect(html()).toMatch(/class="invisible">Todo el local en un solo lugar</)
  })
})

describe('el revelado por scroll', () => {
  /**
   * El modo de falla de un revelado por scroll es que la sección no aparezca
   * nunca. `once: true` hace que una vez revelada se quede revelada, y el
   * margen negativo la adelanta para que una sección que ya está en pantalla
   * al cargar no espere a que alguien scrollee.
   */
  it('revela una sola vez y no vuelve a esconder', () => {
    expect(fuente()).toContain('once: true')
  })

  it('se adelanta al borde de la pantalla', () => {
    expect(fuente()).toMatch(/margin: '-\d+px'/)
  })

  /**
   * El peor modo de falla de esta página: cuatro de las siete secciones salen
   * del servidor en opacity 0 y dependen del JavaScript para aparecer. Sin él
   * quedarían invisibles para siempre y la página se vería a la mitad sin
   * avisar.
   */
  it('cada sección revelada queda marcada para el seguro de <noscript>', () => {
    expect(renderToStaticMarkup(<Revelar className="x">y</Revelar>)).toContain('data-revelar')
  })

  it('y el seguro existe y las devuelve a la vista', () => {
    const codigo = fuente()
    expect(codigo).toContain('<noscript>')
    expect(codigo).toContain('[data-revelar]{opacity:1!important;transform:none!important}')
  })

  it('mantiene la clase que le pasan, así no rompe el layout de la sección', () => {
    // `Revelar` reemplaza al contenedor de la sección, no se mete adentro: si
    // se comiera el className, las secciones perderían su flex y su gap.
    const salida = renderToStaticMarkup(<Revelar className="flex flex-col gap-4">x</Revelar>)
    expect(salida).toContain('flex flex-col gap-4')
  })
})

describe('con el movimiento apagado', () => {
  /**
   * El criterio que fijó la persiana del login: apagado, lo que queda tiene
   * que ser una pantalla correcta, no una a medio construir. Acá eso significa
   * que el titular aparezca entero y que ninguna sección quede escondida.
   */
  it('las tres piezas consultan la preferencia del sistema', () => {
    const codigo = fuente()
    expect(codigo.match(/useReducedMotion\(\)/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('el titular se deriva y no se agenda cuando está apagado', () => {
    // Sin esto habría un setState sincrónico dentro del efecto — un render en
    // cascada de más, y el lint del repo lo rechaza.
    expect(fuente()).toContain('sinMovimiento ? texto.length : escritas')
  })

  it('la barra de progreso directamente no se dibuja', () => {
    expect(fuente()).toMatch(/if \(sinMovimiento\) return null/)
  })
})

describe('la tarjeta con puntero', () => {
  it('mantiene la clase y el elemento que le piden', () => {
    const salida = renderToStaticMarkup(
      <TarjetaAnimada as="li" className="borde">
        x
      </TarjetaAnimada>,
    )
    expect(salida).toMatch(/^<li/)
    expect(salida).toContain('borde')
  })

  it('sólo mueve la posición, no escala', () => {
    // Un `scale` sobre una card con borde deja el borde borroso en pantallas
    // no densas, que es la mitad de los monitores de un mostrador.
    const codigo = fuente()
    expect(codigo).toContain('whileHover={{ y: -3 }}')
    expect(codigo).not.toContain('whileHover={{ scale')
  })
})
