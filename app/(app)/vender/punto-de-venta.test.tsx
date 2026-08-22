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
  // mira el HTML. Sin este caso se puede borrar `${estilos.importe}` de las
  // celdas de la tabla (Precio y Subtotal), del valor del stepper de cantidad
  // y de los tres <Input> de FilaDePago (Monto, Cotización, Recibido) y los
  // tests siguen en verde. Por eso, igual que el caso del total, mira el
  // FUENTE: cuenta cuántas veces aparece `estilos.importe}` en vez de contar
  // en el HTML renderizado. Es un conteo, no una ubicación: si los ocho
  // `estilos.importe}` se movieran al elemento equivocado (o se duplicaran en
  // uno y faltaran en otro) sin cambiar el total, este caso seguiría en
  // verde.
  //
  // Subió de 7 a 8 en la Task 2 del rediseño de /vender: el stepper de
  // cantidad agrega un octavo lugar (design/arandano.pen, nodo `xxvlC` y
  // análogos, "Valor" — fuente Archivo, igual que el resto de la plata de la
  // cinta) que antes no existía porque la cantidad era un <Input> de texto
  // libre sin tratamiento de importe.
  it('el rol importe cubre las columnas de plata y los campos de monto', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8').replace(/\s+/g, '')
    const apariciones = [...fuente.matchAll(/estilos\.importe\}/g)].length
    expect(
      apariciones,
      `estilos.importe} aparece ${apariciones} veces en el fuente y tiene que ` +
        `aparecer 8: el precio de la lista de resultados del buscador, las ` +
        `columnas Precio y Subtotal de la tabla, el valor del stepper de ` +
        `cantidad, los campos Monto, Cotización y Recibido de FilaDePago, y el ` +
        `aviso de Vuelto.`,
    ).toBe(8)
  })

  // Una sola vez en pantalla. Antes estaba dos veces —la card de cobro y el
  // pie de la cinta— y en ninguna de las dos mandaba.
  it('el total no está también en la columna de cobro', async () => {
    const html = await render()
    const veces = [...html.matchAll(/class="[^"]*total[^"]*"/g)].length
    expect(veces, `el total aparece ${veces} veces y tiene que aparecer 1`).toBe(1)
  })

  // El buscador es lo primero que se mira en este mostrador, y el chip "F2"
  // es la promesa de un atajo real, no un adorno: el carrito arranca vacío,
  // así que el buscador —a diferencia de una fila de la cinta— SÍ se puede
  // ver en este render.
  it('el buscador ofrece el atajo F2', async () => {
    const html = await render()
    expect(html).toMatch(/F2/)
    expect(html).toContain('Escaneá un código o buscá por nombre')
  })

  // Con el carrito vacío no hay ninguna fila que renderizar (lineas === []),
  // así que —igual que los dos casos de estilos.importe/estilos.total de
  // arriba— esto mira el FUENTE en vez del HTML. `SKU ${l.sku}` tiene que
  // aparecer en el bloque "Meta" de la fila, no sólo en la lista de
  // resultados del buscador (que ya lo mostraba antes de esta task).
  it('cada fila del carrito muestra el SKU del artículo', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(
      fuente,
      'la fila de la cinta tiene que mostrar el SKU del artículo bajo el ' +
        'nombre (o "Servicio" si no es un producto con stock), no sólo en la ' +
        'lista de resultados del buscador.',
    ).toMatch(/SKU\s*\$\{l\.sku\}/)
  })

  // El defecto concreto que docs/sistema-de-diseno.md prohíbe por nombre:
  // "el ámbar no es un rojo suave". Este aviso es de "hay que mirar", no de
  // "no se puede seguir" —vender con stock negativo está permitido acá—, así
  // que el rojo (reservado a lo que sí bloquea, como "cantidad inválida") no
  // puede aparecer cerca de él. Mira el FUENTE por la misma razón que el
  // caso de arriba: sin cart no hay fila que renderizar.
  it('el aviso de stock insuficiente va en ámbar, no en rojo', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('sin stock suficiente')
    expect(posicion, 'el texto "sin stock suficiente" tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(Math.max(0, posicion - 400), posicion)
    expect(contexto, 'el aviso de stock no puede usar el color de "impide seguir"').not.toMatch(
      /text-destructive/,
    )
    expect(contexto, 'el aviso de stock tiene que pintarse con el token ámbar').toMatch(/text-warn/)
    expect(contexto, 'el fondo del chip tiene que ser el ámbar tenue').toMatch(/bg-warn-soft/)
  })

  // El stepper agrega botones [-]/[+], pero el "valor" del medio tiene que
  // seguir siendo un <input> editable y no un texto fijo: el motor admite
  // cantidades con hasta tres decimales a propósito (lib/formato/mostrar.ts:
  // "Medio kilo de harina necesita los decimales"), y +1/-1 no alcanza para
  // tipear "0,5". Comprobar que los botones existen JUNTO con el <Input> es
  // lo que hace que este caso falle de verdad contra el código viejo (que ya
  // tenía un <Input> de cantidad, pero sin ningún stepper alrededor).
  it('la cantidad se puede escribir a mano, no sólo con los botones', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/aria-label=\{`Restar una unidad a/)
    expect(fuente).toMatch(/aria-label=\{`Sumar una unidad a/)
    expect(fuente).toMatch(/<Input[\s\S]*?value=\{l\.cantidad\}/)
  })

  // La aritmética del paso, probada directo y no a través del render: este
  // harness usa renderToStaticMarkup (ver la nota de ticket.test.tsx), que no
  // ejecuta handlers de clic, así que la única forma de comprobar que
  // "sumar" y "restar" mueven de a una unidad de verdad es llamar la función
  // pura que los dos botones invocan.
  it('los botones del stepper suben y bajan de a uno', async () => {
    const { pasoDeCantidad } = await import('./punto-de-venta')
    expect(pasoDeCantidad('1', 1)).toBe('2')
    expect(pasoDeCantidad('2', -1)).toBe('1')
    expect(pasoDeCantidad('1.5', 1)).toBe('2.5')
    // Una cantidad que la gramática no entiende no se toca: sumar o restar
    // sobre NaN propagaría basura al campo, mismo criterio que ya usa
    // `agregar()` al reescanear un artículo con la cantidad a medio tipear.
    expect(pasoDeCantidad('abc', 1)).toBe('abc')
  })
})
