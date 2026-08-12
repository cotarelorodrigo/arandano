import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

// Las dos funciones que el componente importa viven en un archivo 'use server'.
// Su contrato ya lo fija app/(app)/vender/acciones.test.ts; acá sólo importa qué
// renderiza la pantalla, así que se mockean.
vi.mock('./acciones', () => ({
  cobrar: vi.fn(),
  buscarArticulos: vi.fn(async () => []),
}))

async function render() {
  const { PuntoDeVenta } = await import('./punto-de-venta')
  return renderToStaticMarkup(<PuntoDeVenta cotizacionInicial={null} />)
}

describe('el punto de venta', () => {
  it('renderiza con el carrito vacío', async () => {
    expect(await render()).toContain('Buscar artículo')
  })

  // El ancla de la pantalla. Está desde el carrito vacío y no sólo cuando hay
  // algo que cobrar: un ancla que aparece y desaparece no es un ancla — la
  // vista aprende dónde mirar porque el número está SIEMPRE en el mismo lugar.
  it('el pie de la cinta está desde el carrito vacío, en cero', async () => {
    const html = await render()
    expect(html).toMatch(/class="[^"]*total[^"]*"[^>]*>[^<]*0,00/)
  })

  // El tratamiento de display de la plata. `vitest.config.mts` no setea
  // `css`, así que rige el default `css: false`: acá el harness NO procesa el
  // CSS module, e importar components/importe.module.css devuelve un Proxy
  // que fabrica un className del tipo "_total_f2d38c" para CUALQUIER
  // propiedad que se le pida, exista la clase o no — el nombre "importe" que
  // `estilos.total` compone vía `composes` tampoco sobrevive a eso. Por eso
  // este caso mira el FUENTE en vez del HTML: es lo único que sigue
  // atrapando que el pie deje de usar `estilos.total` en un refactor, que es
  // lo único que el nombre del caso promete. Ese mismo agujero —un Proxy que
  // no distingue una clase real de una inventada— es exactamente lo que
  // test/tipografia.test.ts tapa del otro lado, leyendo el TEXTO del CSS para
  // comprobar que `.importe` y `.total` existen de verdad.
  it('el total lleva el tratamiento de importe', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8').replace(/\s+/g, '')
    expect(fuente).toContain('estilos.total}')
  })

  // El mismo problema que el caso de arriba resuelve para `estilos.total`,
  // pero para `estilos.importe`: el render de este archivo sólo monta el
  // carrito vacío, así que no hay ni una fila de <tbody> ni una FilaDePago en
  // el árbol — ningún <td> ni <Input> de plata llega a pintarse, y nada acá
  // mira el HTML. Sin este caso se puede borrar `${estilos.importe}` de los
  // dos <td> de la tabla (Precio y Subtotal) y de los tres <Input> de
  // FilaDePago (Monto, Cotización, Recibido) y los tests siguen en verde.
  // Por eso, igual que el caso del total, mira el FUENTE: cuenta cuántas
  // veces aparece `estilos.importe}` en vez de contar en el HTML renderizado.
  // Es un conteo, no una ubicación: si los siete `estilos.importe}` se
  // movieran al elemento equivocado (o se duplicaran en uno y faltaran en
  // otro) sin cambiar el total, este caso seguiría en verde.
  it('el rol importe cubre las columnas de plata y los campos de monto', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8').replace(/\s+/g, '')
    const apariciones = [...fuente.matchAll(/estilos\.importe\}/g)].length
    expect(
      apariciones,
      `estilos.importe} aparece ${apariciones} veces en el fuente y tiene que ` +
        `aparecer 7: el precio de la lista de resultados del buscador, las ` +
        `columnas Precio y Subtotal de la tabla, los campos Monto, Cotización ` +
        `y Recibido de FilaDePago, y el aviso de Vuelto.`,
    ).toBe(7)
  })

  // Una sola vez en pantalla. Antes estaba dos veces —la card de cobro y el
  // pie de la cinta— y en ninguna de las dos mandaba.
  it('el total no está también en la columna de cobro', async () => {
    const html = await render()
    const veces = [...html.matchAll(/class="[^"]*total[^"]*"/g)].length
    expect(veces, `el total aparece ${veces} veces y tiene que aparecer 1`).toBe(1)
  })
})
