import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearPrecio, formatearDolares } from '@/lib/formato/mostrar'
import { Retrato, TOTAL, EN_PESOS, EN_DOLARES_EN_PESOS } from './retrato'
import { readFileSync } from 'node:fs'
import path from 'node:path'

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

  // Verifica que el componente está acoplado al módulo de CSS de Archivo,
  // no a una clase hardcodeada o un invento propio. Esto es una verificación
  // estática del fuente, no dinámica de runtime, porque bajo vitest los módulos
  // de CSS son un proxy identidad y no verifican nada.
  it('el cartel importa y usa el módulo de cartel.module.css', () => {
    const fuente = readFileSync(path.join(__dirname, './retrato.tsx'), 'utf8')
    expect(fuente).toContain("import estilos from '@/components/cartel.module.css'")
    expect(fuente).toContain('className={estilos.cartel}')
  })

  it('los pagos suman el total', () => {
    // TOTAL debe ser EN_PESOS + EN_DOLARES_EN_PESOS
    const total = parseInt(TOTAL, 10)
    const enPesos = parseInt(EN_PESOS, 10)
    const enDolaresEnPesos = parseInt(EN_DOLARES_EN_PESOS, 10)
    expect(enPesos + enDolaresEnPesos).toBe(total)
  })

  it('no es interactivo: es una imagen del producto, no el producto', () => {
    const markup = html()
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<input')
  })
})
