import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Retrato } from './retrato'
import { ITEMS, LINEAS_INICIALES, subtotalDeLinea, totalDeLineas } from './carrito'
import { formatearPrecio, montoSinSigno } from '@/lib/formato/mostrar'

const html = () => renderToStaticMarkup(<Retrato />)
const fuente = () => readFileSync(path.join(process.cwd(), 'app/sitio/retrato.tsx'), 'utf8')

/**
 * El carrito del héroe, en su estado inicial.
 *
 * La aritmética que un click dispara vive en `./carrito` y se prueba en
 * `carrito.test.ts`, sin DOM. Acá se prueba lo otro: que el marcado que sale
 * del servidor sea el correcto, que los controles existan de verdad y que el
 * archivo no se vaya de las dos animaciones que justifican la dependencia.
 */
describe('el carrito del héroe', () => {
  it('los precios salen del formateo real del producto, no escritos a mano', () => {
    const salida = html()
    for (const item of ITEMS) {
      expect(salida).toContain(formatearPrecio(item.precio))
    }
  })

  it('los subtotales también', () => {
    const salida = html()
    for (const linea of LINEAS_INICIALES) {
      expect(salida).toContain(formatearPrecio(subtotalDeLinea(linea)))
    }
  })

  it('el total es el de las líneas iniciales, con el signo aparte', () => {
    expect(html()).toContain(montoSinSigno(formatearPrecio(totalDeLineas(LINEAS_INICIALES))))
  })

  it('el resumen dice cuatro artículos y cinco unidades', () => {
    expect(html()).toContain('4 artículos')
    expect(html()).toContain('5 unidades')
  })

  it('muestra los cuatro artículos', () => {
    const salida = html()
    for (const item of ITEMS) {
      expect(salida).toContain(item.descripcion)
    }
  })

  it('el ítem sin SKU se presenta como Servicio', () => {
    const salida = html()
    expect(salida).toContain('Servicio')
    expect(salida).not.toContain('SKU null')
  })

  it('el aviso de stock aparece una sola vez', () => {
    expect(html().match(/sin stock suficiente/g)).toHaveLength(1)
  })

  /**
   * LA DIFERENCIA CON EL RETRATO VIEJO, y el punto entero del rediseño: antes
   * este archivo afirmaba que NO había ningún `<button>` ni `<input>` —era un
   * dibujo del punto de venta, no el punto de venta—. Ahora los controles son
   * reales, y estos casos existen para que nadie los vuelva a convertir en
   * `<span>` "para simplificar".
   */
  describe('los controles son reales', () => {
    it('cada línea trae sus dos botones de cantidad, rotulados', () => {
      const salida = html()
      for (const item of ITEMS) {
        expect(salida).toContain(`Sumar una unidad de ${item.descripcion}`)
        expect(salida).toContain(`Restar una unidad de ${item.descripcion}`)
      }
    })

    it('cada línea se puede quitar, y el botón dice cuál', () => {
      const salida = html()
      for (const item of ITEMS) {
        expect(salida).toContain(`Quitar ${item.descripcion} del carrito`)
      }
    })

    it('el botón de restar arranca deshabilitado en las líneas de una unidad', () => {
      // Con cantidad 1 no hay a dónde bajar: el piso es 1, y quitar la línea
      // entera es la otra acción, con su propio botón.
      expect(html()).toContain('disabled')
    })

    it('el total se anuncia cuando cambia', () => {
      // Quien no ve la pantalla necesita enterarse de que tocar el stepper
      // movió la plata; es la consecuencia de lo que acaba de hacer.
      expect(html()).toContain('aria-live="polite"')
    })
  })

  /**
   * Un solo árbol para los dos anchos. Antes eran dos componentes —`Retrato` y
   * `RetratoMovil`— con el mismo dato renderizado dos veces en el DOM de cada
   * request; el ciclo del teléfono lo había consagrado como requisito.
   */
  describe('un solo árbol', () => {
    it('ya no existe un componente aparte para el teléfono', () => {
      // Sobre el fuente y no sobre el HTML: lo que se fue es el COMPONENTE, y
      // el docblock del archivo lo sigue nombrando para explicar qué cambió.
      expect(fuente()).not.toMatch(/export function RetratoMovil/)
    })

    it('cada artículo se dibuja una sola vez', () => {
      const salida = html()
      for (const item of ITEMS) {
        // `>texto<`: sólo el nodo de texto visible. La descripción vuelve a
        // aparecer, correctamente, dentro de los tres aria-label de la fila
        // ("Sumar una unidad de …", "Restar …", "Quitar … del carrito"), y esas
        // repeticiones no son marcado duplicado sino rótulos accesibles.
        const visible = salida.split(`>${item.descripcion}<`).length - 1
        expect(
          visible,
          `"${item.descripcion}" se dibuja ${visible} veces: volvió la ` +
            `duplicación de marcado que este rediseño sacó.`,
        ).toBe(1)
      }
    })

    it('el encabezado de columnas sólo se dibuja donde hay columnas', () => {
      expect(html()).toMatch(/hidden lg:grid/)
    })
  })

  /**
   * El acople con la pantalla real: las cuatro columnas de la derecha miden lo
   * mismo acá que en /vender. Si alguien las cambia allá y no acá, el carrito
   * de la landing deja de ser "el mismo punto de venta" y nadie se entera.
   */
  it('las columnas miden lo mismo que en /vender', () => {
    const vender = readFileSync(
      path.join(process.cwd(), 'app/(app)/vender/punto-de-venta.tsx'),
      'utf8',
    )
    // La plantilla de columnas fijas, tal cual: cantidad, precio, subtotal y
    // quitar. Es lo que hace cierta la frase "es el punto de venta" — si
    // alguien las cambia en /vender y no acá, el carrito de la landing deja de
    // ser el mismo y nadie se entera.
    const COLUMNAS = '104px_110px_130px_28px'
    expect(vender, `/vender ya no arma sus columnas con ${COLUMNAS}`).toContain(COLUMNAS)
    expect(fuente(), `el retrato ya no arma sus columnas con ${COLUMNAS}`).toContain(COLUMNAS)
    // Y el stepper, que es la única de esas medidas que además es un ancho
    // propio dentro de la celda.
    expect(vender).toContain('w-[104px]')
    expect(fuente()).toContain('w-[104px]')
  })

  it('la plata usa el rol tipográfico del punto de venta', () => {
    const codigo = fuente()
    expect(codigo).toContain("from '@/components/importe.module.css'")
    expect(codigo).toContain('estilos.total')
    expect(codigo).toContain('estilos.signo')
  })

  /**
   * El presupuesto de movimiento. `motion` entró por dos animaciones concretas
   * —la fila que se va y el aviso que aparece—, y la única forma de que una
   * dependencia acotada siga acotada es que algo lo verifique.
   */
  describe('el movimiento no se desborda', () => {
    it('respeta que el sistema pida no mover nada', () => {
      expect(fuente()).toContain('useReducedMotion')
    })

    it('la entrada al cargar no toca el layout ni la opacidad', () => {
      // La única animación que no responde a una acción. Anima SÓLO transform:
      // si alguien le suma `opacity` o `height`, la fila deja de estar pintada
      // desde el primer frame y el LCP de la única página indexable lo paga.
      const codigo = fuente()
      const desde = codigo.indexOf('const ENTRADA')
      expect(desde, 'ya no existe la transición de entrada').toBeGreaterThan(-1)
      const bloque = codigo.slice(codigo.indexOf('initial={sinMovimiento ? false : {'), codigo.indexOf('transition={{ ...ENTRADA'))
      expect(bloque).toContain('y: 10')
      expect(bloque).not.toContain('opacity')
      expect(bloque).not.toContain('height')
    })

    it('el carrito no se entera del scroll', () => {
      // La landing SÍ tiene revelados por scroll desde que el dueño del
      // producto eligió el paquete completo de movimiento, pero viven en
      // `movimiento.tsx` y son de las SECCIONES. El carrito queda afuera a
      // propósito: es el único lugar de la página donde el movimiento
      // responde a lo que la persona hace, y meterle una animación de scroll
      // encima mezclaría las dos cosas.
      expect(fuente()).not.toContain('whileInView')
      expect(fuente()).not.toContain('useScroll')
    })

    it('usa el componente liviano y no el pesado', () => {
      // `m` en vez de `motion`: el segundo arrastra el bundle completo. La
      // carga diferida de las features la hace UN solo `LazyMotion`, el de
      // `ProveedorDeMovimiento`, que envuelve la página entera — este archivo
      // tenía el suyo y cargaba un segundo paquete al pedo.
      const codigo = fuente()
      expect(codigo).toContain("from 'motion/react-m'")
      expect(codigo).not.toMatch(/\bmotion\.\w/)
      expect(codigo, 'la carga diferida vive en el proveedor, no acá').not.toContain('LazyMotion')
    })
  })
})
