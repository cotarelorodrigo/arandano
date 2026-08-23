import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearPrecio, formatearCantidad, montoSinSigno } from '@/lib/formato/mostrar'
import { Retrato, TOTAL, ARTICULOS, UNIDADES, ITEMS } from './retrato'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const html = () => renderToStaticMarkup(<Retrato />)
const fuente = () => readFileSync(path.join(__dirname, './retrato.tsx'), 'utf8')

/**
 * Lo que este archivo cuida no es el diseño: es que el retrato NO sea un dibujo.
 *
 * La landing promete "así se ve el producto". Si los números se escriben a mano
 * en el markup, el día que cambie el formateo de plata de la aplicación —una
 * coma, un símbolo, los decimales— la landing va a seguir mostrando el formato
 * viejo y nadie se va a enterar. Atando el markup a formatearPrecio, ese cambio
 * llega solo.
 *
 * Este archivo se reescribió con el rediseño del carrito de /vender (ciclo del
 * cierre, Task 3): el retrato venía mostrando la versión VIEJA del carrito
 * (tabla pelada, sin stepper, sin chip de stock, sin banda de total), así que
 * cada aserción de acá cambió con el marcado nuevo. Ver el comentario largo de
 * `retrato.tsx` para el porqué de reconstruir el marcado en vez de importar
 * `punto-de-venta.tsx` directo.
 */
describe('el retrato del punto de venta', () => {
  it('los precios de cada línea salen del formateo real de la aplicación', () => {
    const markup = html()
    for (const item of ITEMS) {
      expect(markup).toContain(formatearPrecio(item.precio))
      expect(markup).toContain(formatearPrecio(item.subtotal))
    }
  })

  it('el total de la banda usa el mismo formateo, sin el signo (que es su propio elemento)', () => {
    const markup = html()
    expect(markup).toContain(montoSinSigno(formatearPrecio(TOTAL)))
  })

  it('la cantidad de cada línea sale de formatearCantidad, no de un string suelto', () => {
    const markup = html()
    for (const item of ITEMS) {
      expect(markup).toContain(formatearCantidad(item.cantidad))
    }
  })

  it('el total es la suma de los subtotales de las líneas', () => {
    const suma = ITEMS.reduce((acumulado, item) => acumulado + Number(item.subtotal), 0)
    expect(suma).toBe(Number(TOTAL))
  })

  it('el resumen "N artículos · N unidades" coincide con las líneas reales', () => {
    const markup = html()
    expect(ARTICULOS).toBe(ITEMS.length)
    expect(UNIDADES).toBe(ITEMS.reduce((acumulado, item) => acumulado + Number(item.cantidad), 0))
    expect(markup).toContain(`${ARTICULOS} artículos · ${UNIDADES} unidades`)
  })

  it('el chip ámbar "sin stock suficiente" aparece una sola vez, en la línea marcada', () => {
    const markup = html()
    const apariciones = markup.match(/sin stock suficiente/g) ?? []
    expect(apariciones).toHaveLength(1)
    // No sólo "una línea cualquiera": la que design/arandano.pen marca (nodo
    // `vLrse`) es la funda, no otra — si el flag se corriera a otro ítem, esta
    // aserción (y no sólo el conteo de arriba) lo tiene que atrapar.
    expect(ITEMS.filter((item) => item.sinStockSuficiente).map((item) => item.descripcion)).toEqual([
      'Funda silicona iPhone 13 · Negra',
    ])
  })

  it('un servicio (sin SKU) muestra "Servicio" en vez de un código', () => {
    const markup = html()
    expect(ITEMS.some((item) => item.sku === null)).toBe(true)
    expect(markup).toContain('Servicio')
  })

  // Verificación estática del fuente (no dinámica): bajo vitest los módulos de
  // CSS son un proxy identidad, así que `estilos.importe` no resuelve ninguna
  // regla real en runtime — lo único verificable es que el componente ESTÁ
  // acoplado al módulo, no a una clase hardcodeada.
  it('los precios, la cantidad y el total pagan el rol Importe (components/importe.module.css)', () => {
    const src = fuente()
    expect(src).toContain("import estilos from '@/components/importe.module.css'")
    // Conteo exacto y no sólo "aparece": las tres columnas de plata de CADA
    // línea (cantidad, precio, subtotal) tienen que pagar el rol — un
    // `estilos.importe` que sobreviva en un solo lugar (y se haya perdido en
    // otro) pasaría un `toContain` pero no este conteo.
    expect(src.match(/estilos\.importe/g)).toHaveLength(3)
    expect(src.match(/estilos\.signo/g)).toHaveLength(1)
    expect(src.match(/estilos\.total\b/g)).toHaveLength(1)
  })

  // El nombre del local ("Flor Celulares") ya NO se pinta adentro de esta
  // card: design/arandano.pen (nodo `qjo7l`, "Carrito real") arranca directo
  // en el encabezado hundido, sin cartel adentro. Ese dato se mudó a la barra
  // de navegador que envuelve al retrato (nodo `gnbEL`), que arma
  // `secciones.tsx` — no este archivo. Test para que nadie lo reintroduzca acá
  // por costumbre.
  it('ya no importa el módulo CSS del cartel: el nombre del local se mudó a la barra de navegador', () => {
    const src = fuente()
    expect(src).not.toContain("@/components/cartel.module.css'")
  })

  it('no es interactivo: es una imagen del producto, no el producto', () => {
    const markup = html()
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<input')
  })
})
