import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { Retrato } from './retrato'

const html = () => renderToStaticMarkup(<Retrato />)

/**
 * Lo que este archivo cuida no es el diseño: es que el retrato NO sea un dibujo.
 *
 * La landing promete "así se ve el producto". Si los números se escriben a mano
 * en el markup, el día que cambie el formateo de plata de la aplicación —una
 * coma, un símbolo, los decimales— la landing va a seguir mostrando el formato
 * viejo y nadie se va a enterar. Atando el markup a formatearPrecio, ese cambio
 * llega solo.
 */
describe('el retrato del punto de venta', () => {
  it('los precios salen del formateo real de la aplicación', () => {
    const markup = html()
    expect(markup).toContain(formatearPrecio('8500'))
    expect(markup).toContain(formatearPrecio('96500'))
    expect(markup).toContain(formatearPrecio('105000'))
  })

  it('el pago en dólares usa el formateo de dólares, con su cotización', () => {
    const markup = html()
    expect(markup).toContain(formatearDolares('50'))
    expect(markup).toContain(formatearPrecio('1000'))
  })

  it('las columnas de plata son tabulares, como en la pantalla', () => {
    expect(html()).toContain('tabular-nums')
  })

  // El nombre del local en Archivo es el ÚNICO uso de la fuente de display que
  // esta página tiene derecho a hacer: la regla dice que Archivo escribe
  // nombres de local, y acá hay uno.
  it('el cartel del local usa la clase de Archivo, no una fuente inventada', () => {
    expect(html()).toContain('cartel')
  })

  it('no es interactivo: es una imagen del producto, no el producto', () => {
    const markup = html()
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<input')
  })
})
