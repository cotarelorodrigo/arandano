import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearPrecio } from '@/lib/formato/mostrar'
import type { PlanVisible } from '@/lib/planes/consultar'
import type { Linea } from './punto-de-venta'
import { SidebarProvider } from '@/components/ui/sidebar'

// Las funciones que el componente importa viven en un archivo 'use server'.
// Su contrato ya lo fija app/(app)/vender/acciones.test.ts; acá sólo importa qué
// renderiza la pantalla, así que se mockean. Las dos de caja entraron cuando el
// <Encabezado> —y con él el chip y el menú de caja— pasó a renderizarse desde
// este componente y no desde page.tsx.
vi.mock('./acciones', () => ({
  cobrar: vi.fn(),
  buscarArticulos: vi.fn(async () => []),
  unidadesDeArticulo: vi.fn(async () => []),
  abrirCajaDesdeVender: vi.fn(),
  cerrarCajaDesdeVender: vi.fn(),
}))

// Dos planes con la forma exacta que devuelve `planesDelTenant`
// (lib/planes/consultar.ts), incluido el `porcentaje` como texto CANÓNICO
// ('40', '-10' — nunca '40.000'), que es lo que esa función garantiza.
const PLAN_CREDITO: PlanVisible = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Crédito 3 cuotas',
  medio: 'TARJETA_CREDITO',
  cuotas: 3,
  porcentaje: '40',
  orden: 0,
  desactivadoEn: null,
}

// De EFECTIVO a propósito: el único pago que este harness llega a renderizar
// es el que arranca solo, que es en efectivo y en pesos (ver el caso "el
// encabezado cuenta cuántos pagos hay cargados"), así que un plan de efectivo
// es el único que se puede ver OFRECIDO de verdad. Y con descuento (-10 %),
// que es el otro lado del recargo y el que rompería una cuenta que asuma
// positivos.
const PLAN_CONTADO: PlanVisible = {
  id: '22222222-2222-4222-8222-222222222222',
  nombre: 'Contado',
  medio: 'EFECTIVO',
  cuotas: 1,
  porcentaje: '-10',
  orden: 0,
  desactivadoEn: null,
}

const FUENTE = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')

/**
 * Una fila del panel de cobro que NO cruza monedas: entrega pesos contra el
 * total en pesos.
 *
 * Es lo único que existía antes de este ciclo —cuando una fila era `{ base,
 * cotizacion, planId }` y `cubre` no existía—, así que los casos de recargo,
 * vuelto y pie que ya estaban escritos siguen describiendo exactamente el
 * mismo pago. Los casos del CRUCE arman su fila a mano, para que se vea de
 * qué lado va cada moneda.
 */
function enPesos(base: string, planId: string | null = null) {
  return { moneda: 'ARS' as const, cubre: 'ARS' as const, base, cotizacion: '1', planId }
}

// El mismo fuente sin comentarios, para los casos que buscan la AUSENCIA de
// una utilidad de Tailwind. Este archivo explica en prosa por qué NO usa `md:`
// ni `max-lg:`, y también qué trae `Input` por default (`md:text-sm`), así que
// un `not.toMatch(/\bmd:/)` sobre el texto crudo se dispara contra la
// explicación en vez de contra una clase real — un rojo por la razón
// equivocada, que es peor que no tener el caso.
const SIN_COMENTARIOS = FUENTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// El <SidebarProvider> lo pone app/(app)/layout.tsx alrededor de cada
// page.tsx; acá hace falta porque el <Encabezado> que ahora renderiza este
// componente trae el SidebarTrigger, y ése llama a useSidebar(), que tira sin
// un provider como ancestro (mismo helper que components/shell/encabezado.test.tsx).
async function render(
  props: { caja?: { abiertaEn: Date } | null; planes?: PlanVisible[] } = {},
) {
  const { PuntoDeVenta } = await import('./punto-de-venta')
  return renderToStaticMarkup(
    <SidebarProvider>
      <PuntoDeVenta
        planes={props.planes ?? []}
        caja={props.caja ?? null}
        cotizacionUsd={null}
        cotizacionUsdEn={null}
      />
    </SidebarProvider>,
  )
}

/**
 * Renderiza `<PuntoDeVenta>` con el carrito YA armado, vía `lineasIniciales`
 * —una prop SÓLO PARA TESTS (ver su comentario en `punto-de-venta.tsx`)—: es
 * lo único que permite afirmar sobre una línea con serie sin simular clics
 * en un archivo que se prueba con `renderToStaticMarkup`, sin jsdom.
 *
 * Cada línea es PARCIAL: los campos que no hacen a lo que el caso prueba
 * (sku, precio, moneda, stock, esProducto) se completan con un default común,
 * así que un caso de la línea con serie sólo tiene que nombrar lo que le
 * importa.
 */
async function renderConCarrito(lineas: Partial<Linea>[]) {
  const { PuntoDeVenta } = await import('./punto-de-venta')
  const completas: Linea[] = lineas.map((l, i) => ({
    articuloId: `articulo-${i}`,
    sku: `SKU-${i}`,
    descripcion: 'Artículo de prueba',
    precio: '1000',
    moneda: 'ARS',
    stock: '5',
    esProducto: true,
    cantidad: '1',
    llevaSerie: false,
    ...l,
  }))
  return renderToStaticMarkup(
    <SidebarProvider>
      <PuntoDeVenta
        planes={[]}
        caja={null}
        cotizacionUsd={null}
        cotizacionUsdEn={null}
        lineasIniciales={completas}
      />
    </SidebarProvider>,
  )
}

/**
 * Renderiza la lista del selector de unidad con esas unidades.
 *
 * Es el CUERPO del diálogo y no el diálogo entero: abrirlo de verdad exige un
 * click sobre un resultado del buscador y una respuesta de `unidadesDeArticulo`
 * —dos cosas que `renderToStaticMarkup` no puede hacer—, así que el
 * agrupamiento (que es lo que la Task 7 decide) vive en un componente
 * exportado que se renderiza solo. Mismo criterio que `itemsParaCobrar`:
 * sacar a una función/componente puro lo que no se puede afirmar a través de
 * la pantalla completa.
 */
async function renderSelector(unidades: { id: string; imei: string | null; ingresadaEn: Date }[]) {
  const { UnidadesDelSelector } = await import('./punto-de-venta')
  return renderToStaticMarkup(<UnidadesDelSelector unidades={unidades} onElegir={() => {}} />)
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
  // MINOR de la review final: este mensaje quedó desactualizado dos veces
  // sin que el número (8) se enterara, y por pura coincidencia. La
  // extracción de `CampoMonto` (Task 4) consolidó los tres sitios de Monto/
  // Cotización/Recibido en UNA sola definición —de 8 bajó a 6—, y después
  // el chip de Faltante/Sobrante y el renglón "Entran $X" sumaron cada uno
  // el suyo —de 6 volvió a 8—. El total dio el mismo número por casualidad;
  // la lista de abajo es la que hoy describe esos 8 sitios de verdad.
  // Subió de 8 a 9 en la Task 6 de precios por forma de pago: el pie del panel
  // de cobro (Mercadería / Recargo / Total a cobrar) suma un noveno sitio —uno
  // solo, porque las tres líneas salen de un `.map` sobre
  // `lineasDelPieDeCobro`, no de tres bloques escritos a mano—. Y de 9 a 10 al
  // mergear con el ciclo del teléfono, con el renglón "A cobrar $X" de cada
  // fila de pago (ver el arreglo del vuelto, más abajo).
  it('el rol importe cubre las columnas de plata y los campos de monto', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8').replace(/\s+/g, '')
    const apariciones = [...fuente.matchAll(/estilos\.importe\}/g)].length
    expect(
      apariciones,
      `estilos.importe} aparece ${apariciones} veces en el fuente y tiene que ` +
        `aparecer 9: el precio de la lista de resultados del buscador, las ` +
        `columnas Precio y Subtotal de la tabla, el valor del stepper de ` +
        `cantidad, la definición de \`CampoMonto\` (una sola, compartida por ` +
        `Monto, Cotización y Recibido de FilaDePago), el chip de Vuelto, el ` +
        `chip de Faltante/Sobrante, el renglón "Entran $X", el renglón ` +
        `"A cobrar $X", y el monto de cada línea del pie del cobro.`,
    ).toBe(10)
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

  // El listener de `window` en sí (enganchar keydown, preventDefault, mover
  // el foco de verdad) NO está probado acá: es DOM real y este repo no corre
  // jsdom (ver la nota de `ticket.test.tsx`). Lo que SÍ se puede probar sin
  // jsdom es la regla pura que decide qué tecla dispara el atajo — y es lo
  // único que un test de este archivo puede afirmar en verdad sin mentir
  // sobre la cobertura.
  it('F2 es el atajo que enfoca el buscador, y ninguna otra tecla lo es', async () => {
    const { esAtajoDeBuscador } = await import('./punto-de-venta')
    expect(esAtajoDeBuscador('F2')).toBe(true)
    expect(esAtajoDeBuscador('F1')).toBe(false)
    expect(esAtajoDeBuscador('Enter')).toBe(false)
    expect(esAtajoDeBuscador('f2')).toBe(false)
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
    // Los botones ya no llevan "Restar"/"Sumar" tipeado al lado de
    // aria-label —eso ahora vive en PASOS_STEPPER, ver el test de más
    // abajo—, así que lo que este caso puede comprobar es que existen (el
    // .map sobre el array) y que el <Input> del valor sigue ahí, editable.
    expect(fuente).toMatch(/PASOS_STEPPER\.map\(/)
    expect(fuente).toMatch(/aria-label=\{`\$\{verbo\} una unidad a/)
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

  // El defecto real que encontró la review de esta task: con dos <button>
  // casi idénticos escritos a mano (uno con `-1`, el otro con `1`), invertir
  // el signo de uno solo —el "−" suma, el "+" resta— dejaba los 722 tests de
  // entonces en verde. `pasoDeCantidad` probada aislada (el caso de arriba)
  // nunca importa QUÉ botón le pasa qué delta; eso es el CABLEADO, no la
  // aritmética.
  //
  // La corrección: el cableado pasa a ser el array `PASOS_STEPPER`,
  // renderizado con un `.map()` en vez de dos bloques JSX duplicados. Este
  // test mira ESE array directo, sin jsdom ni fireEvent — si alguien invierte
  // los dos deltas (o el orden de las entradas), esto se cae, porque ya no
  // hay ningún -1/+1 hardcodeado en otro lado que pueda desincronizarse: el
  // "los botones del stepper suben y bajan de a uno" de arriba" prueba la
  // función; éste prueba el dato que decide qué botón la llama con qué
  // signo.
  it('el botón "−" resta y el botón "+" suma — el cableado, no sólo la aritmética', async () => {
    const { PASOS_STEPPER } = await import('./punto-de-venta')
    expect(PASOS_STEPPER).toHaveLength(2)
    expect(PASOS_STEPPER[0]).toMatchObject({ verbo: 'Restar', delta: -1 })
    expect(PASOS_STEPPER[1]).toMatchObject({ verbo: 'Sumar', delta: 1 })

    // Y que el render use ese array (paso.delta) para llamar a
    // pasoDeCantidad, en vez de un literal -1/1 escrito aparte: eso es lo que
    // hace que invertir el array sea el ÚNICO lugar donde el signo se puede
    // romper.
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/PASOS_STEPPER\.map\(/)
    expect(fuente).toMatch(/pasoDeCantidad\(x\.cantidad,\s*delta\)/)
  })

  // --- Task 9: unidades identificadas — el IMEI en el lugar del stepper ---

  it('la línea de un artículo con serie muestra el IMEI en lugar del stepper', async () => {
    const html = await renderConCarrito([
      {
        articuloId: 'a1', descripcion: 'iPhone 13', llevaSerie: true,
        unidadId: 'u1', imei: '355000000000001',
      },
    ])
    expect(html).toContain('355000000000001')
    // El stepper no se dibuja para esta línea: su cantidad es 1 y no se
    // puede cambiar, así que no hay botón "Sumar" para ESTE artículo.
    expect(html).not.toContain('aria-label="Sumar una unidad a iPhone 13"')
    expect(html).not.toContain('aria-label="Restar una unidad a iPhone 13"')
  })

  it('la línea de un artículo SIN serie sigue mostrando el stepper', async () => {
    const html = await renderConCarrito([
      { articuloId: 'a2', descripcion: 'Funda', llevaSerie: false, cantidad: '2' },
    ])
    expect(html).toContain('aria-label="Sumar una unidad a Funda"')
    expect(html).toContain('aria-label="Restar una unidad a Funda"')
  })

  // El botón "quitar" (la x) se conserva para una línea con serie: sacarla
  // del carrito sigue siendo posible, aunque su cantidad no se pueda tocar.
  it('la línea con serie conserva el botón de quitar', async () => {
    const html = await renderConCarrito([
      {
        articuloId: 'a1', descripcion: 'iPhone 13', llevaSerie: true,
        unidadId: 'u1', imei: '355000000000001',
      },
    ])
    expect(html).toContain('aria-label="Quitar iPhone 13"')
  })

  // El hallazgo de la review de esta task: nada probaba que el `unidadId` de
  // una línea con serie efectivamente saliera en el `items` que postea el
  // `<form>`. Sacarlo del `.map` de producción dejaba pasar los tres casos de
  // arriba igual —afirman sobre el HTML de la línea, no sobre el JSON
  // escondido—, y el mostrador cobraba UNIDAD_REQUERIDA con el cliente ya en
  // la caja. Se prueba llamando a la función pura, mismo criterio que
  // `pasoDeCantidad`: este archivo no tiene forma de leer el `value` de un
  // `<input type=hidden>` después de un clic, así que llamar la función
  // directo reemplaza esa lectura.
  it('itemsParaCobrar manda el unidadId de una línea con serie', async () => {
    const { itemsParaCobrar } = await import('./punto-de-venta')
    const items = itemsParaCobrar([
      {
        articuloId: 'a1', sku: 'S1', descripcion: 'iPhone 13', precio: '500000',
        moneda: 'ARS', stock: '1', esProducto: true, cantidad: '1',
        llevaSerie: true, unidadId: 'u1', imei: '355000000000001',
      },
    ])
    expect(items).toEqual([{ articuloId: 'a1', cantidad: '1', unidadId: 'u1' }])
  })

  // Y la mitad sin serie del mismo camino: una línea sin unidad no manda
  // `unidadId` de ningún valor (ni `null` ni `''`) — `JSON.stringify`
  // descarta las propiedades `undefined`, que es justo lo que `cobrar`
  // (acciones.ts) espera para "sin unidad" (ver su guard de `esUuid`).
  // Task 7 del ciclo "unidades sin identificar".
  it('el selector muestra UNA sola fila para las sin identificar, con cuántas quedan', async () => {
    // Listar treinta filas idénticas es pedirle a alguien que elija entre
    // cosas indistinguibles: no hay ninguna decisión que tomar ahí. Una sola
    // fila, con el contador, y el motor se lleva la más vieja.
    const html = await renderSelector([
      { id: 'u1', imei: null, ingresadaEn: new Date('2026-09-01T12:00:00Z') },
      { id: 'u2', imei: null, ingresadaEn: new Date('2026-09-01T12:00:00Z') },
      { id: 'u3', imei: '355000000000001', ingresadaEn: new Date('2026-09-01T12:00:00Z') },
    ])
    expect(html.split('sin identificar').length - 1).toBe(1)
    expect(html).toContain('2')
    expect(html).toContain('355000000000001')
  })

  it('con una sola sin identificar, la fila sigue siendo una', async () => {
    const html = await renderSelector([
      { id: 'u1', imei: null, ingresadaEn: new Date('2026-09-01T12:00:00Z') },
    ])
    expect(html.split('sin identificar').length - 1).toBe(1)
  })

  it('sin ninguna sin identificar, el selector no nombra el caso', async () => {
    const html = await renderSelector([
      { id: 'u1', imei: '355000000000001', ingresadaEn: new Date('2026-09-01T12:00:00Z') },
    ])
    expect(html).not.toContain('sin identificar')
  })

  it('itemsParaCobrar manda el imeiCapturado cuando se escaneó al vender', async () => {
    const { itemsParaCobrar } = await import('./punto-de-venta')
    const items = itemsParaCobrar([
      {
        articuloId: 'a1', sku: 'A-1', descripcion: 'iPhone', precio: '1000', moneda: 'ARS',
        stock: '1', esProducto: true, cantidad: '1',
        llevaSerie: true, unidadId: 'u1', imei: null, imeiCapturado: '355000000000009',
      },
    ])
    expect(items[0].imeiCapturado).toBe('355000000000009')
  })

  // `undefined` y no `''`: `JSON.stringify` descarta la clave entera, así que
  // el servidor recibe un ítem sin el campo — que es exactamente "no se
  // escaneó nada", el camino por defecto de este ciclo.
  it('y lo omite cuando no se escaneó nada', async () => {
    const { itemsParaCobrar } = await import('./punto-de-venta')
    const items = itemsParaCobrar([
      {
        articuloId: 'a1', sku: 'A-1', descripcion: 'iPhone', precio: '1000', moneda: 'ARS',
        stock: '1', esProducto: true, cantidad: '1',
        llevaSerie: true, unidadId: 'u1', imei: null,
      },
    ])
    expect(items[0].imeiCapturado).toBeUndefined()
    expect(JSON.stringify(items)).not.toContain('imeiCapturado')
  })

  // La línea del carrito: con la unidad ya identificada muestra su IMEI (el
  // caso que ya existía, más arriba); sin identificar, ofrece capturarlo.
  it('una línea con la unidad sin identificar ofrece escanear el IMEI', async () => {
    const html = await renderConCarrito([
      { llevaSerie: true, unidadId: 'u1', imei: null, descripcion: 'iPhone 13' },
    ])
    expect(html).toContain('name="imeiCapturado"')
  })

  // La leyenda EXACTA, y no un `/opcional/i` suelto: la primera versión de
  // este caso pasaba con la feature sin construir, porque la palabra ya
  // aparecía en otro lado de la pantalla. Un caso que pasa antes de existir lo
  // que prueba no prueba nada.
  it('y avisa que se puede dejar en blanco: el IMEI se ofrece, no se exige', async () => {
    const html = await renderConCarrito([
      { llevaSerie: true, unidadId: 'u1', imei: null, descripcion: 'iPhone 13' },
    ])
    expect(html).toContain('IMEI opcional: podés dejarlo en blanco y cargarlo después')
  })

  it('y esa leyenda NO aparece en una línea con la unidad ya identificada', async () => {
    const html = await renderConCarrito([
      { llevaSerie: true, unidadId: 'u1', imei: '355000000000001', descripcion: 'iPhone 13' },
    ])
    expect(html).not.toContain('IMEI opcional')
  })

  it('una línea con la unidad YA identificada no ofrece capturar nada', async () => {
    const html = await renderConCarrito([
      { llevaSerie: true, unidadId: 'u1', imei: '355000000000001', descripcion: 'iPhone 13' },
    ])
    expect(html).not.toContain('name="imeiCapturado"')
  })

  it('itemsParaCobrar no manda unidadId para una línea sin serie', async () => {
    const { itemsParaCobrar } = await import('./punto-de-venta')
    const items = itemsParaCobrar([
      {
        articuloId: 'a2', sku: 'S2', descripcion: 'Funda', precio: '1000',
        moneda: 'ARS', stock: '5', esProducto: true, cantidad: '2', llevaSerie: false,
      },
    ])
    expect(JSON.stringify(items)).toBe('[{"articuloId":"a2","cantidad":"2"}]')
  })

  // El requisito duro de la task: dos pasadas del lector sobre el mismo
  // equipo son el mismo teléfono, y sumar convertiría eso en dos ventas del
  // mismo IMEI. Probado en las DOS direcciones, como pide la review: una
  // unidad ausente no puede dar falso positivo.
  it('estaEnElCarrito reconoce una unidad ya agregada, y sólo esa', async () => {
    const { estaEnElCarrito } = await import('./punto-de-venta')
    const carrito = [
      {
        articuloId: 'a1', sku: 'S1', descripcion: 'iPhone 13', precio: '500000',
        moneda: 'ARS' as const, stock: '1', esProducto: true, cantidad: '1',
        llevaSerie: true, unidadId: 'u1', imei: '355000000000001',
      },
    ]
    expect(estaEnElCarrito(carrito, 'u1')).toBe(true)
    expect(estaEnElCarrito(carrito, 'u2')).toBe(false)
    expect(estaEnElCarrito([], 'u1')).toBe(false)
  })

  // --- Task 3: la banda del total ---

  // El "$" y el monto son dos <span> con tratamiento tipográfico distinto
  // (24px/500 el signo, 42px/600 el monto — design/arandano.pen, nodos
  // `w06dh` y `T4rEAA`), no la cadena única "$ 103.900,00" que armaba
  // formatearPrecio() para el pie viejo.
  it('el signo y el monto son dos elementos, no una cadena', async () => {
    const html = await render()
    expect(html).toMatch(/>\$<\/span>/)
    expect(html).toMatch(/>0,00<\/span>/)
    expect(
      html,
      'el signo y el monto no pueden viajar concatenados en un solo texto',
    ).not.toMatch(/>\$\s+0,00</)
  })

  // El carrito vacío es el único estado que este harness puede renderizar de
  // verdad (renderToStaticMarkup no ejecuta clics ni tipeo, ver la nota de
  // render() más arriba): con cero líneas, "0 artículos · 0 unidades" es lo
  // único honesto. Mostrar el texto de EJEMPLO de la maqueta ("4 artículos ·
  // 5 unidades", copiado tal cual del .pen) es el error más fácil de cometer
  // acá, y este caso es el que lo atraparía.
  it('con el carrito vacío la banda no miente el conteo', async () => {
    const html = await render()
    expect(html).toContain('0 artículos · 0 unidades')
  })

  // resumenDelCarrito en aislamiento: la pluralización de las dos mitades, en
  // los casos que el carrito vacío del harness no puede alcanzar.
  it('la banda del total muestra cuántos artículos y cuántas unidades', async () => {
    const { resumenDelCarrito, unidadesDelCarrito } = await import('./punto-de-venta')
    expect(resumenDelCarrito(4, 5000)).toBe('4 artículos · 5 unidades')
    expect(resumenDelCarrito(1, 1000)).toBe('1 artículo · 1 unidad')
    expect(resumenDelCarrito(0, 0)).toBe('0 artículos · 0 unidades')
    expect(resumenDelCarrito(2, 2500)).toBe('2 artículos · 2,5 unidades')

    // unidadesDelCarrito en aislamiento — el hallazgo IMPORTANT de la review
    // final: forzada a 0 a mano, escrita inline sin nombre propio, esta
    // cuenta no rompía ningún test de entonces. Una línea NaN suma 0, no
    // envenena el total.
    expect(unidadesDelCarrito([{ cantidadMilesimas: 1000 }, { cantidadMilesimas: 2500 }])).toBe(3500)
    expect(unidadesDelCarrito([{ cantidadMilesimas: 1000 }, { cantidadMilesimas: NaN }])).toBe(1000)
    expect(unidadesDelCarrito([])).toBe(0)

    // Cableado: lineas.length para artículos y la suma de cantidadMilesimas
    // para unidades — no al revés, y no un valor fijo. Mismo motivo que el
    // test de PASOS_STEPPER de arriba: la función pura no prueba de dónde
    // salen sus argumentos.
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/const unidadesMilesimas = unidadesDelCarrito\(enCentavos\)/)
    expect(fuente).toMatch(/resumenDelCarrito\(lineas\.length,\s*unidadesMilesimas\)/)
  })

  // --- Task 9: el carrito con dos totales ---

  // `lineasDeTotal` en aislamiento, y no un render con un carrito mixto: este
  // harness usa `renderToStaticMarkup` (sin clics ni tipeo, ver la nota de
  // render() al principio del archivo) y sólo puede montar el carrito VACÍO
  // —la Task 3 ya lo dejó escrito arriba—, así que un carrito con líneas de
  // las dos monedas no tiene forma de llegar a un render real acá. Mismo
  // criterio que ya usan `resumenDelCarrito`/`unidadesDelCarrito` y
  // `lineasDelPieDeCobro`: la función pura se prueba sola, y el cableado se
  // fija leyendo el fuente (el caso de abajo).
  it('un carrito todo en pesos muestra UNA sola línea de total, igual que antes', async () => {
    const { lineasDeTotal } = await import('./punto-de-venta')
    const lineas = lineasDeTotal({ ars: 150_000, usd: 0 })
    expect(lineas).toHaveLength(1)
    expect(lineas[0]).toEqual({ moneda: 'ARS', signo: '$', monto: '1.500,00' })
  })

  it('un carrito mixto muestra las dos', async () => {
    const { lineasDeTotal } = await import('./punto-de-venta')
    const lineas = lineasDeTotal({ ars: 150_000, usd: 100_000 })
    expect(lineas).toHaveLength(2)
    expect(lineas[0].moneda).toBe('ARS')
    expect(lineas[1]).toEqual({ moneda: 'USD', signo: 'US$', monto: '1.000,00' })
  })

  // El espejo del caso mixto: un carrito TODO en dólares (sin ningún artículo
  // en pesos) también se ve como una sola línea — "una sola moneda con total
  // distinto de cero" no significa "en pesos", significa una sola.
  it('un carrito todo en dólares también muestra UNA sola línea, en dólares', async () => {
    const { lineasDeTotal } = await import('./punto-de-venta')
    const lineas = lineasDeTotal({ ars: 0, usd: 100_000 })
    expect(lineas).toEqual([{ moneda: 'USD', signo: 'US$', monto: '1.000,00' }])
  })

  // El carrito vacío (las dos monedas en $0) es el caso que ya cubre el
  // render real de más arriba ("el signo y el monto son dos elementos"): acá
  // se fija en aislamiento que el ancla cae del lado de los pesos, no que
  // desaparezca.
  it('con las dos monedas en cero, el ancla es la línea de pesos', async () => {
    const { lineasDeTotal } = await import('./punto-de-venta')
    expect(lineasDeTotal({ ars: 0, usd: 0 })).toEqual([{ moneda: 'ARS', signo: '$', monto: '0,00' }])
  })

  // Un NaN en una moneda (una cantidad a medio tipear en ESA línea) muestra
  // "—" ahí sin apagar la otra — la regla que ya documenta `totalesEnCentavos`
  // (lib/ventas/centavos.ts) y que esta función tiene que respetar en vez de
  // esconder la línea entera.
  it('un NaN envenena sólo su moneda, no la banda entera', async () => {
    const { lineasDeTotal } = await import('./punto-de-venta')
    expect(lineasDeTotal({ ars: NaN, usd: 100_000 })).toEqual([
      { moneda: 'ARS', signo: '$', monto: '—' },
      { moneda: 'USD', signo: 'US$', monto: '1.000,00' },
    ])
    // Sola en su moneda (sin nada en pesos) sigue mostrando el "—": el carrito
    // no está vacío, sólo ilegible.
    expect(lineasDeTotal({ ars: NaN, usd: 0 })).toEqual([{ moneda: 'ARS', signo: '$', monto: '—' }])
  })

  // El cableado real: `enCentavos` tiene que llevar la moneda de cada línea
  // (si no, `totalesEnCentavos` no tiene cómo repartir), `totales` tiene que
  // salir de esa lista, `hayCarrito` tiene que mirar las DOS monedas, y la
  // banda tiene que pintar `lineasTotal` —no un total suelto— para que el
  // carrito mixto de verdad llegue a la pantalla.
  it('el carrito arma enCentavos con la moneda de cada línea y hayCarrito mira las dos', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/precioCentavos: aCentavos\(l\.precio\),\s*\n\s*moneda: l\.moneda,/)
    expect(fuente).toMatch(/const totales = totalesEnCentavos\(enCentavos\)/)
    expect(fuente).toMatch(
      /const hayCarrito = lineas\.length > 0 && \(totales\.ars > 0 \|\| totales\.usd > 0\) && !hayLineaInvalida/,
    )
    expect(fuente).toMatch(/const lineasTotal = lineasDeTotal\(totales\)/)
    expect(fuente).toMatch(/\{lineasTotal\.map\(\(l\) => \(/)
    // `agregar()` tiene que copiar la moneda del resultado del buscador a la
    // línea nueva: sin esto, todo artículo agregado quedaría 'ARS' fijo sin
    // importar lo que diga `ArticuloVendible.moneda` (Task 6).
    expect(fuente).toMatch(/descripcion: a\.nombre,\s*\n\s*precio: a\.precio,\s*\n\s*moneda: a\.moneda,/)
  })

  // Los CUATRO lugares donde el punto de venta escribe el precio de un
  // artículo, que hasta la ola final del ciclo formateaban con
  // `formatearPrecio` a secas: el typeahead, la meta del teléfono, la columna
  // "Precio" de escritorio y el subtotal de la línea. Con un iPhone de lista
  // US$ 300 los cuatro decían "$ 300,00" — tres órdenes de magnitud abajo, en
  // la pantalla insignia del ciclo.
  //
  // Por FUENTE y con aserción NEGATIVA, mismo patrón que
  // app/(app)/inventario/page.test.tsx: el harness sólo monta el carrito
  // vacío (ver la nota de `lineasDeTotal`, arriba), así que un render real no
  // llega nunca a una fila con precio; y sin el `not.toContain` el caso
  // pasaría igual con la llamada vieja agregada al lado. Es lo único que
  // impide que vuelva.
  it('los cuatro precios del carrito salen en la moneda de su línea, no en pesos siempre', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')

    // El typeahead y la meta del teléfono.
    expect(fuente).toContain('precioEnSuMoneda(a.precio, a.moneda)')
    expect(fuente).toContain('precioEnSuMoneda(l.precio, l.moneda)')
    expect(fuente).not.toContain('formatearPrecio(a.precio)')
    expect(fuente).not.toContain('formatearPrecio(l.precio)')

    // El subtotal de la línea, que hereda la moneda de la línea porque es
    // cantidad × precio.
    expect(fuente).toMatch(
      /precioEnSuMoneda\(\s*\n\s*deCentavos\(subtotalEnCentavos\(cantidadMilesimas, aCentavos\(l\.precio\)\)\),\s*\n\s*l\.moneda,/,
    )
    expect(fuente).not.toMatch(
      /formatearPrecio\(\s*\n\s*deCentavos\(subtotalEnCentavos\(cantidadMilesimas, aCentavos\(l\.precio\)\)\)/,
    )
  })

  // La SEGUNDA copia del mismo total: el subtítulo del Encabezado en el paso
  // de cobro del teléfono, que reemplaza a la banda de --marca mientras esa
  // banda queda oculta (`hidden lg:flex`). Antes de esta task mostraba sólo
  // pesos con su propia cuenta (`formatearPrecio(deCentavos(totalCentavos))`);
  // ahora arma la lista completa desde `lineasTotal`, la MISMA que pinta la
  // banda — sin este caso, esa segunda copia podía quedarse atrás de la
  // primera sin que ningún test lo note, que es exactamente el modo de falla
  // que CLAUDE.md ya documenta para los controles duplicados de esta
  // pantalla (el bug de las "DOS copias" del ciclo móvil+permisos). No hay
  // forma de renderizarlo de verdad —el harness sólo monta el carrito vacío,
  // y en escritorio `pasoVisible` nunca vale 'cobro'—, así que es una lectura
  // del fuente, igual que el resto del cableado de este bloque.
  it('el subtítulo del cobro móvil sale de lineasTotal, la MISMA lista que la banda', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toContain(
      "? `Venta de ${lineasTotal.map((l) => `${l.signo} ${l.monto}`).join(' + ')}`",
    )
  })

  // --- Task 4: el panel de cobro ---

  // El carrito vacío YA arranca con UN pago en pesos (el ajuste de "seguir el
  // total" que sigue en pie, más abajo en el cuerpo del componente crea la
  // primera fila apenas hay un total que seguir, incluso en $0), así que esto
  // sí es un render real y no una lectura de fuente.
  it('el encabezado cuenta cuántos pagos hay cargados', async () => {
    const html = await render()
    expect(html).toContain('1 pago')
  })

  // entranPesosCentavos en aislamiento: el harness sólo puede mostrar el pago
  // en ARS que arranca solo (ver el test de arriba), así que un pago en
  // USD —y su renglón "Entran $X"— no tiene forma de llegar a
  // renderToStaticMarkup acá.
  it('un pago en dólares muestra cuántos pesos entran', async () => {
    const { entranPesosCentavos } = await import('./punto-de-venta')
    // NO enteros redondos a propósito: con '20' y '1485' (el ejemplo del
    // .pen, nodos `bAHMf`/`xgspX`/`F3H35`) aplicar la escala de centavos a
    // la cotización y la de diezmilésimas al monto —el bug exacto que este
    // caso existe para atrapar— da EL MISMO resultado que la cuenta
    // correcta, porque 100×10000 = 10000×100 cuando las dos cifras son
    // enteras: el test sería ciego por construcción. Con centavos en el
    // monto (,55) y cuatro decimales en la cotización (,7382) las dos
    // cuentas divergen (3.053.192 la correcta, 3.053.175 la de las escalas
    // cambiadas) — verificado invirtiendo las escalas a mano antes de
    // escribir este valor, no supuesto.
    expect(entranPesosCentavos('20,55', '1485,7382')).toBe(3_053_192)

    // Cableado: FilaDePago tiene que llamarla con pago.base y
    // pago.cotizacion, ni al revés ni con otra cosa — es justo la clase de
    // bug que una función pura probada sola no atrapa (ver la nota del
    // encargo sobre el stepper).
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/entranPesosCentavos\(pago\.base,\s*pago\.cotizacion\)/)
  })

  // El hallazgo IMPORTANT de la review final: "Entran $X" era el ÚNICO
  // importe de la pantalla sin guarda de NaN. Se alcanza con sólo borrar el
  // campo Monto para retipearlo (o Cotización, o dejar cualquiera de los dos
  // a medio tipear): `entranPesosCentavos` da NaN, y sin guarda
  // `formatearPrecio` imprimía el cartel sin sentido "Entran $ NaN".
  it('"Entran $X" muestra — y no "$ NaN" con un monto o una cotización a medio tipear', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf("'Base en pesos' : 'Entran'")
    expect(posicion, 'el rótulo "Entran" tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(posicion, posicion + 300)
    expect(
      contexto,
      'el renglón "Entran $X" tiene que guardarse contra NaN, igual que el resto de la plata de la pantalla',
    ).toMatch(/Number\.isNaN\(pesosDelPagoCentavos\)\s*\?\s*'—'/)
  })

  // Ola final del ciclo: con un plan que mueve el número, "Entran $ 445.500"
  // y "A cobrar $ 623.700" convivían pegados en la misma fila, y sólo el
  // segundo es lo que entra al cajón. El renglón no se esconde —el número es
  // el puente entre "Cubre US$ 300" y lo que se cobra— sino que se llama por
  // su nombre. Los DOS renglones se gobiernan con la MISMA condición: si se
  // separaran, volverían a poder contradecirse.
  it('el rótulo de "Entran" y el renglón "A cobrar" salen de la misma condición', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(
      /const elPlanMueveElNumero =\s*\n?\s*!Number\.isNaN\(aCobrarCentavos\) && aCobrarCentavos !== entregadoCentavos/,
    )
    expect(fuente).toContain("{elPlanMueveElNumero ? 'Base en pesos' : 'Entran'}")
    // Las TRES apariciones: la declaración, el rótulo condicional y la guarda
    // del renglón de "A cobrar". Con dos, uno de los dos renglones se quedó
    // atrás. Sobre `SIN_COMENTARIOS` porque los comentarios de esta pantalla
    // nombran la constante en prosa, y ahí un conteo sobre el texto crudo
    // mide la explicación en vez del código.
    expect([...SIN_COMENTARIOS.matchAll(/elPlanMueveElNumero/g)]).toHaveLength(3)
  })

  // El mismo defecto preexistente, del otro lado del cálculo: "Agregar pago"
  // precargaba el campo Monto de la fila nueva con `deCentavos(NaN)` —el
  // string literal "NaN.NaN"— en cuanto una línea del carrito quedaba
  // inválida (el faltante de esa moneda es NaN ahí). Vacío es la salida
  // honesta, mismo criterio que ya usa el resto del archivo para "no se puede
  // calcular": no inventar un cero ni un NaN.
  it('"Agregar pago" no precarga el monto con NaN cuando el carrito tiene una línea inválida', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // El TEXTO del botón, no la primera aparición de la frase: la ronda de
    // arreglos del ciclo móvil sumó un comentario que la nombraba en prosa más
    // arriba en el archivo, y este caso se puso rojo apuntando a ese
    // comentario en vez de al botón. Mismo criterio que ya usaban `>Vuelto<` y
    // `'Faltan'` un poco más abajo.
    const posicion = fuente.search(/Agregar pago\s*<\/Button>/)
    expect(posicion, '"Agregar pago" tiene que existir como texto del botón').toBeGreaterThan(-1)
    const desdeElOnClick = fuente.lastIndexOf('onClick={() =>', posicion)
    expect(desdeElOnClick, 'el botón tiene que traer su onClick').toBeGreaterThan(-1)
    const contexto = fuente.slice(desdeElOnClick, posicion)
    expect(
      contexto,
      'el monto precargado tiene que guardarse contra faltanCentavos en NaN',
    ).toMatch(
      /Number\.isNaN\(faltaEnEseTotal\)\s*\?\s*''\s*:\s*deCentavos\(Math\.max\(0, faltaEnEseTotal\)\)/,
    )
    // Y el pago nuevo va contra el total que TODAVÍA falta, no fijo contra el
    // de pesos: con los pesos ya cubiertos, precargar otra vez el faltante en
    // pesos (cero) daría una fila de monto 0 que el motor rechaza.
    expect(contexto).toMatch(/const cubre = cubrePorDefecto\(faltan\)/)
  })

  it('el vuelto aparece como chip cuando sobra plata', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // >Vuelto< y no sólo 'Vuelto': la palabra sola aparece antes en varios
    // comentarios (empezando por el de puedeMostrarVuelto), y esto busca el
    // texto tal cual lo pinta el JSX, no su primera mención en prosa.
    const posicion = fuente.indexOf('>Vuelto<')
    expect(posicion, 'el rótulo "Vuelto" tiene que existir en el JSX').toBeGreaterThan(-1)
    const contexto = fuente.slice(Math.max(0, posicion - 400), posicion + 400)
    expect(contexto, 'el chip de vuelto tiene que pintarse con el verde tenue').toMatch(
      /bg-ok-soft/,
    )
    expect(contexto, 'el texto del chip de vuelto tiene que ir en --ok').toMatch(/text-ok/)
  })

  it('el faltante aparece como chip cuando falta', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // 'Faltan' (con comillas) y no la palabra suelta: "Faltante" —que
    // aparece antes, en prosa— empieza con las mismas seis letras.
    const posicion = fuente.indexOf("'Faltan'")
    expect(posicion, 'el rótulo "Faltan" tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(Math.max(0, posicion - 600), posicion + 400)
    expect(contexto, 'el chip de faltante sigue mostrándose sólo cuando falta').toMatch(
      /faltanCentavos > 0/,
    )
    expect(contexto, 'el chip de faltante tiene que pintarse con el rojo tenue').toMatch(
      /bg-destructive-soft/,
    )
    expect(contexto, 'el chip de faltante lleva el ícono circle-alert').toMatch(/CircleAlert/)
  })

  // El hallazgo IMPORTANT de la review final: el cartel de faltante/sobrante
  // era un <p role="status"> antes de la Task 3 de este rediseño, y el
  // atributo (con su comentario) se perdió al migrarlo a `Badge` —un <span>
  // pelado, sin ningún rol implícito— sin que ningún test lo reclamara. Sin
  // `role="status"` un lector de pantalla no anuncia el cartel cuando
  // aparece o cambia de texto, y es la única pista de por qué el botón
  // Cobrar sigue apagado.
  it('el chip de faltante/sobrante es un role="status", para que un lector de pantalla lo anuncie', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // <Badge\n  role="status"\n y NO la primera aparición de la cadena: el
    // propio comentario que explica el porqué la menciona en prosa, antes
    // del JSX.
    const posicion = fuente.search(/<Badge\s+role="status"/)
    expect(posicion, 'el <Badge> del chip tiene que llevar role="status"').toBeGreaterThan(-1)
    const contexto = fuente.slice(posicion, posicion + 300)
    expect(
      contexto,
      'role="status" tiene que estar en el MISMO Badge que el chip de faltante/sobrante',
    ).toMatch(/faltanCentavos > 0 \? 'bg-destructive-soft' : 'bg-ok-soft'/)
  })

  // El caso que importa más de lo que parece: vuelto y faltante son estados
  // excluyentes a propósito, y hoy nada lo verificaba. Mostrar "te sobran
  // $X" en UN pago mientras la venta completa sigue corta por OTRO pago le
  // dice al cajero que dé vuelto sobre una venta que en conjunto no cerró.
  it('no muestra vuelto y faltante al mismo tiempo', async () => {
    const { puedeMostrarVuelto, hayFaltanteDeVenta } = await import('./punto-de-venta')
    expect(puedeMostrarVuelto(true, true)).toBe(false)
    expect(puedeMostrarVuelto(true, false)).toBe(true)
    expect(puedeMostrarVuelto(false, false)).toBe(false)
    expect(puedeMostrarVuelto(false, true)).toBe(false)

    // hayFaltanteDeVenta en aislamiento — el hallazgo IMPORTANT de la review
    // final: invertida a mano (`&&` en vez de `||`, o un `!` de más) sobre
    // esta misma cuenta, escrita inline en el cuerpo del componente sin
    // nombre propio, no rompía ningún test de entonces: nada la probaba
    // aislada. Extraerla es lo que hace posible este caso.
    expect(hayFaltanteDeVenta(0)).toBe(false)
    expect(hayFaltanteDeVenta(1)).toBe(true)
    expect(hayFaltanteDeVenta(-1)).toBe(false)
    expect(hayFaltanteDeVenta(NaN)).toBe(true)

    // Cableado: hayFaltante tiene que salir de faltanCentavos > 0 calculado
    // sobre TODOS los pagos, y viajar como prop a cada fila — no puede nacer
    // adentro de FilaDePago, o dejaría de describir "el conjunto", que es la
    // parte que este caso existe para proteger.
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // Sobre las DOS monedas, y con `||`: alcanza con que falte una para que
    // el vuelto se apague. Con `&&` una venta mixta con los pesos cubiertos y
    // los dólares no mostraría vuelto sobre una venta que no cerró.
    expect(fuente).toMatch(
      /const hayFaltante = hayFaltanteDeVenta\(faltan\.ars\) \|\| hayFaltanteDeVenta\(faltan\.usd\)/,
    )
    expect(fuente).toMatch(/hayFaltante=\{hayFaltante\}/)

    // Y el guard que de verdad decide si el chip de Vuelto se pinta tiene
    // que SER esta función, no `esEfectivoArs` solo: la review final
    // encontró que mutar `{puedeMostrarVuelto(esEfectivoArs, hayFaltante) &&`
    // a `{esEfectivoArs &&` dejaba los tests de entonces en verde —
    // `puedeMostrarVuelto` probada aislada (arriba) nunca importa si el JSX
    // la llama de verdad o simplemente ignora `hayFaltante` — y ésa es
    // exactamente la regresión que este caso existe para proteger: "te
    // sobran $X" volvería a aparecer con la venta completa corta.
    expect(fuente).toMatch(/\{puedeMostrarVuelto\(esEfectivoArs, hayFaltante\) &&/)
  })

  /**
   * El vuelto se calcula contra lo que hay que COBRAR por esa fila, no contra
   * su base. Es plata real del cajón, en la única pantalla del producto donde
   * se cuentan billetes: con un plan de efectivo en pesos —el descuento por
   * pago contado, que este producto trata como caso de primera clase— la base
   * y lo que hay que cobrar no coinciden, y restar la base devolvía de MENOS
   * con descuento y de MÁS con recargo.
   *
   * El agujero por el que esto llegó a existir: `planesOfrecidos` sí ofrece
   * planes de EFECTIVO —correctamente, el motor los acepta— pero ningún caso
   * cruzaba el vuelto con un plan elegido.
   */
  describe('el vuelto se calcula contra lo que hay que cobrar, no contra la base', () => {
    it('sin plan, lo que hay que cobrar es la base pelada', async () => {
      const { aCobrarDeLaFilaEnCentavos } = await import('./punto-de-venta')
      expect(
        aCobrarDeLaFilaEnCentavos(enPesos('10000', null), [PLAN_CONTADO]),
      ).toBe(1_000_000)
    })

    it('con un descuento de contado, hay que cobrar MENOS que la base', async () => {
      const { aCobrarDeLaFilaEnCentavos } = await import('./punto-de-venta')
      // −10 % sobre 10.000 = 9.000. Con el bug, quien pagaba con un billete de
      // 10.000 se iba sin su vuelto de 1.000.
      expect(
        aCobrarDeLaFilaEnCentavos(
          enPesos('10000', PLAN_CONTADO.id),
          [PLAN_CONTADO],
        ),
      ).toBe(900_000)
    })

    it('con un recargo, hay que cobrar MÁS que la base', async () => {
      const { aCobrarDeLaFilaEnCentavos } = await import('./punto-de-venta')
      const efectivoConRecargo = { ...PLAN_CONTADO, porcentaje: '40' }
      expect(
        aCobrarDeLaFilaEnCentavos(
          enPesos('10000', efectivoConRecargo.id),
          [efectivoConRecargo],
        ),
      ).toBe(1_400_000)
    })

    it('un plan que no está en la lista no mueve el número', async () => {
      const { aCobrarDeLaFilaEnCentavos } = await import('./punto-de-venta')
      expect(
        aCobrarDeLaFilaEnCentavos(enPesos('10000', 'inexistente'), [
          PLAN_CONTADO,
        ]),
      ).toBe(1_000_000)
    })

    // El cableado, por FUENTE: el harness no llega a montar una fila con plan,
    // así que sin esto la función podría estar perfecta y el JSX seguir
    // restando la base. Las DOS mitades del chip —el guard que decide si se
    // pinta y el importe que muestra— tienen que mirar el mismo número.
    it('el chip resta lo que hay que cobrar, en el guard y en el importe', () => {
      const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
      expect(fuente).toMatch(/const aCobrarCentavos = aCobrarDeLaFilaEnCentavos\(pago, planes\)/)
      expect(
        fuente,
        'el guard del chip compara "con cuánto paga" contra lo que hay que cobrar',
      ).toMatch(/dineroEnCentavos\(pago\.recibido\) > aCobrarCentavos/)
      expect(fuente, 'y el importe resta ESE mismo número').toMatch(
        /dineroEnCentavos\(pago\.recibido\) - aCobrarCentavos/,
      )
      expect(
        fuente,
        'y ya nadie resta la base: era el bug',
      ).not.toMatch(/dineroEnCentavos\(pago\.recibido\)[^)]*dineroEnCentavos\(pago\.base\)/)
    })

    // El pie de la card y el chip de cada fila aplican el porcentaje con la
    // MISMA función: dos cuentas separadas es cómo el pie diría un total y las
    // filas otro.
    it('el pie del cobro reusa la misma función que el chip', () => {
      const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
      expect(fuente).toMatch(/acc \+ recargoDeLaFilaEnCentavos\(pago, planes\)/)
    })

    // "Monto" es la BASE, y con un plan no es lo que hay que pedirle a la
    // persona. Sin este renglón la pantalla no dice en ningún lado cuánto
    // cobrar por esa fila — el pie da el total de la venta, que con pagos
    // partidos entre dos planes no alcanza.
    it('la fila muestra "A cobrar" cuando su plan mueve el número', () => {
      const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
      expect(fuente).toMatch(
        /\{elPlanMueveElNumero && \([\s\S]*?>A cobrar<[\s\S]*?deCentavos\(aCobrarCentavos\)/,
      )
    })
  })

  // --- Task 5: el chip de caja y los atajos de teclado ---

  it('Enter es el atajo que cobra, y ninguna otra tecla lo es', async () => {
    const { esAtajoDeCobro } = await import('./punto-de-venta')
    expect(esAtajoDeCobro('Enter')).toBe(true)
    expect(esAtajoDeCobro('F2')).toBe(false)
    expect(esAtajoDeCobro('Escape')).toBe(false)
    expect(esAtajoDeCobro('enter')).toBe(false)
  })

  it('Esc es el atajo que arma/confirma el vaciado, y ninguna otra tecla lo es', async () => {
    const { esAtajoDeVaciar } = await import('./punto-de-venta')
    expect(esAtajoDeVaciar('Escape')).toBe(true)
    expect(esAtajoDeVaciar('Enter')).toBe(false)
    expect(esAtajoDeVaciar('F2')).toBe(false)
    expect(esAtajoDeVaciar('esc')).toBe(false)
  })

  // El requisito puntual de la task ("Enter en el buscador agrega, no
  // cobra") se resuelve acá SIN un caso especial para el buscador —ver el
  // comentario de la función—: el buscador es un INPUT como cualquier otro,
  // y la regla general es que cualquier control nativo que ya sabe qué
  // hacer con su propio Enter (INPUT, TEXTAREA, SELECT, BUTTON) deja pasar
  // el atajo global en vez de competirle.
  // ALLOW-LIST, no deny-list: el defecto Critical de la revisión final de
  // esta task fue exactamente que la deny-list anterior (negar
  // INPUT/TEXTAREA/SELECT/BUTTON) dejaba pasar 'DIV' — y un `<div
  // role="option">` de Radix con el foco es justo lo que queda resaltado
  // dentro de un `Select` de medio/moneda abierto. Con esa lista, Enter
  // sobre una opción resaltada cobraba la venta con el medio/moneda
  // TODAVÍA no actualizado en React. La regla ahora es la inversa: sólo
  // BODY o ningún foco dejan pasar el atajo, así que 'DIV' —como cualquier
  // otro tagName que no sea BODY— queda afuera.
  it('el atajo global de cobro sólo dispara con el foco en BODY o sin ningún foco', async () => {
    const { puedeDispararCobroDesdeFoco } = await import('./punto-de-venta')
    expect(puedeDispararCobroDesdeFoco('INPUT')).toBe(false)
    expect(puedeDispararCobroDesdeFoco('TEXTAREA')).toBe(false)
    expect(puedeDispararCobroDesdeFoco('SELECT')).toBe(false)
    expect(puedeDispararCobroDesdeFoco('BUTTON')).toBe(false)
    // El caso que antes se colaba: la opción resaltada de un Select de Radix
    // abierto es un <div role="option">, no un <select> ni un <button>.
    expect(puedeDispararCobroDesdeFoco('DIV')).toBe(false)
    // Nada en particular enfocado (el <body>, típicamente): ahí Enter
    // todavía no significa nada, y es el único lugar donde corresponde que
    // el atajo tenga trabajo.
    expect(puedeDispararCobroDesdeFoco(undefined)).toBe(true)
    expect(puedeDispararCobroDesdeFoco('BODY')).toBe(true)
  })

  // Cableado: el atajo global de Enter tiene que respetar la MISMA condición
  // que ya apaga el botón (`disabled={!cierra || cobrando}`) antes de llamar
  // a requestSubmit() — un <form>.requestSubmit() NO respeta por su cuenta
  // que el submit esté disabled, así que sin este chequeo manual el atajo
  // podría cobrar una venta que el botón, al lado, muestra apagada.
  it('el atajo de Enter no cobra si la venta no cierra, mismo criterio que el botón', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('if (esAtajoDeCobro(e.key)) {')
    expect(posicion, 'la rama de Enter tiene que existir en el fuente').toBeGreaterThan(-1)
    // Ventana ACOTADA y en ORDEN (con [\s\S]*? entre cada fragmento), no
    // tres `toMatch` sueltos sobre el archivo entero. El hallazgo IMPORTANT
    // de la review final: sin slice ni orden, esas tres aserciones sólo
    // comprobaban que los tres fragmentos EXISTIERAN en algún lado del
    // archivo, no que estuvieran EN ESTE ORDEN acá — así que borrar el
    // chequeo de foco (Enter cobraría con el foco en el buscador) o mover
    // requestSubmit() ANTES del "if (!cierra || cobrando) return" (cobraría
    // con el botón apagado) dejaban las tres en verde igual.
    const contexto = fuente.slice(posicion, posicion + 700)
    expect(
      contexto,
      'las guardas de Enter tienen que ir en este orden: foco, cierra/cobrando, preventDefault, requestSubmit',
    ).toMatch(
      /if \(!puedeDispararCobroDesdeFoco\(etiqueta\)\) return[\s\S]*?if \(!cierra \|\| cobrando\) return[\s\S]*?e\.preventDefault\(\)[\s\S]*?formularioCobro\.current\?\.requestSubmit\(\)/,
    )
  })

  // La leyenda de los atajos (design/arandano.pen, nodo `k1dDB`), en el
  // único estado que este harness puede renderizar de verdad: el carrito
  // vacío arranca con `vaciadoArmado` en false.
  it('la leyenda de los atajos aparece bajo el botón', async () => {
    const html = await render()
    expect(html).toContain('Enter para cobrar · Esc para vaciar')
  })

  // Esc con el carrito vacío no puede armar la confirmación de vaciado: no
  // hay nada que vaciar, y un cartel de "Esc de nuevo para vaciar" sobre un
  // carrito ya vacío sería un aviso sin sentido.
  it('Esc con el carrito vacío no arma la confirmación de vaciado', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('esAtajoDeVaciar(e.key)')
    expect(posicion, 'el atajo de vaciar tiene que existir en el fuente').toBeGreaterThan(-1)
    // La ventana se ensanchó de 200 a 500 con el ciclo móvil: la rama ganó el
    // comentario que explica por qué este chequeo convive con el de
    // `alternarVaciado`. Sigue acotada a la rama de Escape.
    const contexto = fuente.slice(posicion, posicion + 500)
    expect(
      contexto,
      'nada que vaciar tiene que cortar antes de armar cualquier confirmación',
    ).toMatch(/if \(lineas\.length === 0\) return/)
  })

  // El segundo Esc (con la confirmación ya armada) es el único que de verdad
  // vacía — y tiene que vaciar tanto el carrito como los pagos, no sólo uno
  // de los dos: un pago viejo colgado sobre un carrito nuevo cobraría un
  // total que no es el que se está mirando.
  it('el segundo Esc vacía el carrito Y los pagos', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('if (vaciadoArmado) {')
    expect(posicion, 'la rama de confirmación tiene que existir').toBeGreaterThan(-1)
    const contexto = fuente.slice(posicion, posicion + 350)
    expect(contexto).toMatch(/actualizarCarrito\(\(\) => \[\]\)/)
    expect(contexto).toMatch(/setPagos\(\[\]\)/)
  })

  // El hallazgo IMPORTANT de la review final: borrar el desarme automático
  // (cualquiera de sus dos caminos) dejaba TODOS los tests de entonces en
  // verde — ninguno lo reclamaba. Sin esto, un Esc armado por error (o uno
  // legítimo que la persona no confirma) queda "cargado" para siempre: el
  // PRIMER Esc de la visita siguiente, minutos después y sin relación con
  // el anterior, vaciaría el carrito de un tirón.
  it('un cambio de carrito desarma el timer Y el estado de vaciado armado, no sólo uno de los dos', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('function actualizarCarrito(')
    expect(posicion, 'actualizarCarrito tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(posicion, posicion + 700)
    // En ORDEN y con `[\s\S]*?` entre medio, no tres toMatch sueltos: lo que
    // esta task encontró es que borrar el bloque del timer entero (el `if
    // (desarmarVaciado.current) { clearTimeout(...); ...=null }`) no rompía
    // ninguna aserción existente, porque nada exigía que las dos líneas
    // convivieran con el `setVaciadoArmado` de al lado.
    expect(
      contexto,
      'actualizarCarrito tiene que cortar el timer pendiente Y bajar la bandera de armado',
    ).toMatch(
      /clearTimeout\(desarmarVaciado\.current\)[\s\S]*?desarmarVaciado\.current = null[\s\S]*?setVaciadoArmado\(\(actual\) => \(actual \? false : actual\)\)/,
    )
  })

  it('el primer Esc arma un timer que desarma solo a los 3 segundos', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('setVaciadoArmado(true)')
    expect(posicion, 'el armado del primer Esc tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(posicion, posicion + 200)
    expect(
      contexto,
      'el primer Esc tiene que programar el desarme automático a los 3000ms, no dejar el armado colgado',
    ).toMatch(/desarmarVaciado\.current = setTimeout\(\(\) => setVaciadoArmado\(false\), 3000\)/)
  })

  // El hallazgo de la review de la Task 6 de precios por forma de pago:
  // `hayOverlayDeRadixAbierto` no aparecía en NINGÚN test. Borrar
  // `if (hayOverlayDeRadixAbierto()) return`, o moverlo debajo de la rama de
  // Esc, dejaba los 45 casos de entonces en verde — y es la guarda que existe
  // porque el bug YA SE FUE A PRODUCCIÓN una vez: con un `Select` de Radix
  // abierto, Enter sobre la opción resaltada cobraba la venta con el medio
  // anterior, y dos Esc para cerrar dos dropdowns vaciaban el carrito. La
  // función misma no se puede probar acá (usa `document`, que es DOM real y
  // este repo no corre jsdom, ver su comentario), pero SÍ se puede fijar que
  // el listener la consulte ANTES de cualquier rama.
  //
  // Importa más desde esta task, que suma un TERCER listbox de Radix a la
  // pantalla (el selector de plan) apoyado en esta misma abstención.
  it('el listener de atajos se abstiene antes de mirar ninguna tecla si hay un overlay de Radix abierto', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // El ÚLTIMO `alApretarTecla` y no el primero: el primero es el listener de
    // F2, que no comparte teclas con Radix y no lleva esta guarda.
    const inicio = fuente.lastIndexOf('function alApretarTecla(')
    expect(inicio, 'el listener compartido de Enter/Esc tiene que existir').toBeGreaterThan(-1)
    const hastaLaPrimeraRama = fuente.slice(
      inicio,
      fuente.indexOf('if (esAtajoDeVaciar(e.key))', inicio),
    )
    expect(
      hastaLaPrimeraRama,
      'la abstención por overlay tiene que ir ANTES de la rama de Esc y la de Enter, no adentro de una de ellas',
    ).toMatch(/if \(hayOverlayDeRadixAbierto\(\)\) return/)

    // Y que la abstención siga mirando el `[role="listbox"]` de un Select
    // abierto: es exactamente lo que monta el selector de plan de esta task
    // —verificado en runtime con jsdom—, así que estrechar esta query lo
    // dejaría sin cobertura.
    expect(
      fuente,
      'la guarda tiene que seguir cubriendo listbox, dialog y menu',
    ).toMatch(
      /document\.querySelector\('\[role="listbox"\], \[role="dialog"\], \[role="menu"\]'\)/,
    )
  })

  // --- Task 6: el plan de pago del mostrador ---

  // La promesa explícita del spec: un local que no cargó ningún plan no ve UN
  // SOLO control nuevo. 'Plan' a secas y no 'Plan del pago': la palabra no
  // aparece hoy en ninguna parte del HTML de esta pantalla —verificado sobre
  // el render completo antes de escribir el caso—, así que la aserción amplia
  // atrapa también un rótulo suelto, un placeholder o un encabezado que se
  // cuele.
  it('sin planes cargados no dibuja ningún control de plan', async () => {
    expect(await render({ planes: [] })).not.toContain('Plan')
  })

  // El caso POSITIVO, y no es de adorno: sin él los dos negativos de al lado
  // pasarían igual con el selector borrado del archivo.
  //
  // Mira el `aria-label` del trigger y no el nombre del plan porque es lo
  // único del selector que llega al HTML: Radix monta el contenido del Select
  // sólo mientras está ABIERTO (`<Presence present={open}>`) y `<SelectValue
  // />` pinta el texto del ítem elegido a través de un portal, así que
  // renderToStaticMarkup deja `<span data-slot="select-value"></span>` vacío y
  // ni un solo `SelectItem` renderizado. Es la misma razón por la que ningún
  // caso de este archivo afirma sobre "Efectivo" o "Débito", que son los
  // ítems del selector de medio que ya existía.
  it('con un plan del medio del pago, la fila ofrece el selector', async () => {
    expect(await render({ planes: [PLAN_CONTADO] })).toContain('Plan del pago 1')
  })

  // El select de plan se filtra por el medio del pago: un plan de tarjeta en
  // una fila de efectivo lo rechaza el servidor (PLAN_NO_CORRESPONDE), así que
  // ofrecerlo sería ofrecer un error.
  it('con planes de crédito, el pago en efectivo no ofrece ninguno', async () => {
    expect(await render({ planes: [PLAN_CREDITO] })).not.toContain('Plan del pago')
  })

  // La regla en aislamiento, incluida la mitad que el harness no puede
  // renderizar: un pago en dólares. `planesOfrecidos` está extraída como
  // función pura por el mismo motivo que `hayFaltanteDeVenta` o
  // `unidadesDelCarrito` más arriba — un filtro escrito inline en el JSX se
  // puede invertir sin que ningún caso de render lo note.
  it('un plan se ofrece sólo para su medio y sólo sobre un pago en pesos', async () => {
    const { planesOfrecidos } = await import('./punto-de-venta')
    expect(planesOfrecidos({ medio: 'TARJETA_CREDITO', moneda: 'ARS' }, [PLAN_CREDITO])).toEqual([
      PLAN_CREDITO,
    ])
    expect(planesOfrecidos({ medio: 'EFECTIVO', moneda: 'ARS' }, [PLAN_CREDITO])).toEqual([])
    // PLAN_EN_DOLARES: el motor rechaza CUALQUIER plan sobre un pago que no
    // sea en pesos (lib/ventas/crear.ts), así que en dólares no se ofrece
    // ninguno aunque el medio coincida.
    expect(planesOfrecidos({ medio: 'TARJETA_CREDITO', moneda: 'USD' }, [PLAN_CREDITO])).toEqual([])

    // Cableado: la fila tiene que decidir con esta función y no con un filtro
    // propio, y el selector entero tiene que desaparecer cuando no queda
    // ninguno para ofrecer.
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // `\s*` entre los argumentos por lo mismo que el caso de más abajo: lo que
    // importa es que la fila llame a ESTA función con SU pago y los planes, no
    // que la llamada entre en una línea.
    expect(fuente).toMatch(/const planesDelMedio = planesOfrecidos\(\s*pago,\s*planes,?\s*\)/)
    expect(fuente).toMatch(/\{planesDelMedio\.length > 0 && \(/)
  })

  // Un plan de crédito que sobreviva a un cambio a efectivo es exactamente el
  // PLAN_NO_CORRESPONDE que el servidor rechaza, con la pantalla mostrando
  // algo que se ve válido; el mismo plan sobre un cambio a dólares es
  // PLAN_EN_DOLARES. Los dos cambios tienen que limpiar el plan, no sólo
  // esconder el selector — esconderlo dejaría el `planId` viejo en el estado y
  // viajando en el JSON escondido.
  it('cambiar el medio o la moneda limpia el plan elegido', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    // Acotado al Select de medio y después `planId: null`, y NO la línea
    // entera del `onCambiar` tipeada tal cual: fijar el formato exacto de una
    // sola línea hace que un reformateo de Prettier rompa el caso por algo que
    // no tiene nada que ver con la propiedad que afirma. Es la misma forma que
    // ya usaba la mitad de la moneda, acá abajo (hallazgo de la review de esta
    // task).
    const desdeElMedio = fuente.indexOf('value={pago.medio}')
    expect(desdeElMedio, 'el Select de medio tiene que existir en el fuente').toBeGreaterThan(-1)
    const bloqueDelMedio = fuente.slice(desdeElMedio, fuente.indexOf('<SelectTrigger', desdeElMedio))
    expect(
      bloqueDelMedio,
      'cambiar el medio tiene que limpiar el plan en el MISMO onCambiar',
    ).toMatch(/planId: null/)

    const posicion = fuente.indexOf("const moneda = valor as Pago['moneda']")
    expect(posicion, 'el handler de moneda tiene que existir en el fuente').toBeGreaterThan(-1)
    // Hasta el cierre del handler y no una ventana de N caracteres: el bloque
    // lleva comentarios largos, y un número fijo se queda corto en cuanto
    // alguien agrega una línea de prosa.
    const contexto = fuente.slice(posicion, fuente.indexOf('<SelectTrigger', posicion))
    expect(
      contexto,
      'cambiar la moneda tiene que limpiar el plan en el MISMO onCambiar',
    ).toMatch(/planId: null/)
  })

  // El pie de tres líneas. No se puede afirmar sobre el HTML: el harness sólo
  // renderiza el carrito vacío con su pago inicial sin plan (ver la nota de
  // `render()`), así que un recargo distinto de cero no tiene forma de llegar
  // a renderToStaticMarkup — mismo motivo que ya obliga a probar
  // `resumenDelCarrito` y `entranPesosCentavos` como funciones puras.
  //
  // Los importes se comparan contra `formatearPrecio` y no contra un literal
  // '$ 4.000,00' escrito a mano: el separador que emite Intl es un espacio
  // DURO (U+00A0), así que un literal tipeado con un espacio normal fallaría
  // por una razón que no tiene nada que ver con lo que este caso afirma.
  it('el pie muestra mercadería, recargo y total a cobrar cuando hay plan', async () => {
    const { lineasDelPieDeCobro } = await import('./punto-de-venta')
    const lineas = lineasDelPieDeCobro(
      1_000_000,
      [enPesos('10000', PLAN_CREDITO.id)],
      [PLAN_CREDITO],
      false,
    )
    expect(lineas).toEqual([
      { rotulo: 'Mercadería', monto: formatearPrecio('10000') },
      // El nombre del plan en el rótulo: con un solo plan elegido, "Recargo" a
      // secas no dice de qué recargo habla.
      { rotulo: 'Recargo Crédito 3 cuotas', monto: formatearPrecio('4000') },
      { rotulo: 'Total a cobrar', monto: formatearPrecio('14000') },
    ])
  })

  // El descuento es el otro lado del mismo cálculo, y el que rompe cualquier
  // cuenta que asuma positivos: el importe resta y el total a cobrar queda POR
  // DEBAJO de la mercadería.
  //
  // Y el RÓTULO también cambia — el hallazgo Important de la review de esta
  // task: con la palabra fija en "Recargo", el mostrador leía "Recargo
  // Contado −$ 1.000,00", una línea que se contradice a sí misma en la
  // pantalla que un local mira todo el día. La palabra sale del signo, y bajo
  // "Descuento" el importe va SIN el menos: el rótulo ya dice de qué lado
  // está, y un "−" al lado de la palabra es una doble negación.
  it('un plan con porcentaje negativo descuenta en vez de recargar, y lo dice', async () => {
    const { lineasDelPieDeCobro } = await import('./punto-de-venta')
    const lineas = lineasDelPieDeCobro(
      1_000_000,
      [enPesos('10000', PLAN_CONTADO.id)],
      [PLAN_CONTADO],
      false,
    )
    expect(lineas).toEqual([
      { rotulo: 'Mercadería', monto: formatearPrecio('10000') },
      { rotulo: 'Descuento Contado', monto: formatearPrecio('1000') },
      { rotulo: 'Total a cobrar', monto: formatearPrecio('9000') },
    ])
    // La otra dirección, para que la palabra no pueda quedar fija en ninguna
    // de las dos: el mismo pie con un plan de recargo dice "Recargo" y el
    // total queda POR ENCIMA de la mercadería. (El caso completo del recargo
    // es el de más arriba; acá se afirma el contraste.)
    const conRecargo = lineasDelPieDeCobro(
      1_000_000,
      [enPesos('10000', PLAN_CREDITO.id)],
      [PLAN_CREDITO],
      false,
    )
    expect(conRecargo[1].rotulo).toBe('Recargo Crédito 3 cuotas')
  })

  // Con dos planes distintos el rótulo no puede nombrar a uno solo: sería
  // decir que ese plan cobró un recargo que en realidad es la suma de los dos.
  // Y la palabra la decide el NETO, no el porcentaje de ninguno de los dos —
  // los mismos dos planes cambian de "Recargo" a "Descuento" según cuánto se
  // reparta en cada uno.
  it('con más de un plan elegido el recargo va sin nombre, y la palabra sale del neto', async () => {
    const { lineasDelPieDeCobro } = await import('./punto-de-venta')
    // 40 % de 5.000 = 2.000, −10 % de 5.000 = −500 → neto +1.500.
    const netoPositivo = lineasDelPieDeCobro(
      1_000_000,
      [
        enPesos('5000', PLAN_CREDITO.id),
        enPesos('5000', PLAN_CONTADO.id),
      ],
      [PLAN_CREDITO, PLAN_CONTADO],
      false,
    )
    expect(netoPositivo[1]).toEqual({ rotulo: 'Recargo', monto: formatearPrecio('1500') })

    // 40 % de 1.000 = 400, −10 % de 9.000 = −900 → neto −500.
    const netoNegativo = lineasDelPieDeCobro(
      1_000_000,
      [
        enPesos('1000', PLAN_CREDITO.id),
        enPesos('9000', PLAN_CONTADO.id),
      ],
      [PLAN_CREDITO, PLAN_CONTADO],
      false,
    )
    expect(netoNegativo[1]).toEqual({ rotulo: 'Descuento', monto: formatearPrecio('500') })
    expect(netoNegativo[2]).toEqual({
      rotulo: 'Total a cobrar',
      monto: formatearPrecio('9500'),
    })
  })

  // "Sin recargo el pie no crece": un local con planes cargados que cobra a
  // precio de lista tiene que ver exactamente el pie de siempre.
  it('sin ningún plan elegido el pie no crece: una sola línea, como hoy', async () => {
    const { lineasDelPieDeCobro } = await import('./punto-de-venta')
    expect(
      lineasDelPieDeCobro(1_000_000, [enPesos('10000', null)], [PLAN_CREDITO], false),
    ).toEqual([])
    // Y en la pantalla de verdad, con planes cargados y ninguno elegido.
    expect(await render({ planes: [PLAN_CONTADO] })).not.toContain('Total a cobrar')
  })

  // La regla que este archivo aplica a TODO importe: un monto a medio tipear
  // deja la cuenta en NaN, y `formatearPrecio(NaN)` imprime "$ NaN". El pie
  // no es la excepción — y con un plan elegido sigue apareciendo, porque
  // esconderlo mientras se retipea el monto haría parpadear tres líneas en
  // cada tecla.
  it('el pie muestra — y no "$ NaN" con un monto o una mercadería a medio tipear', async () => {
    const { lineasDelPieDeCobro } = await import('./punto-de-venta')
    const conMontoRoto = lineasDelPieDeCobro(
      1_000_000,
      [enPesos('', PLAN_CREDITO.id)],
      [PLAN_CREDITO],
      false,
    )
    expect(conMontoRoto.map((l) => l.monto)).toEqual([formatearPrecio('10000'), '—', '—'])

    const conCarritoRoto = lineasDelPieDeCobro(
      NaN,
      [enPesos('10000', PLAN_CREDITO.id)],
      [PLAN_CREDITO],
      false,
    )
    expect(conCarritoRoto.map((l) => l.monto)).toEqual(['—', formatearPrecio('4000'), '—'])
  })

  // Cableado del pie: la mercadería que muestra tiene que salir del mismo
  // cálculo de totales que pinta la banda de --marca, y las líneas tienen que
  // salir de la función y no de tres bloques de JSX con su propia cuenta.
  // El agujero que encontró la revisión de esta task: con el `.map` exigido a
  // secas, cambiar el guard a `{false && (` dejaba los casos en verde con el
  // pie BORRADO de la pantalla — ninguno lo reclamaba, porque el harness no
  // puede montar un carrito con plan y el `.map` seguía escrito ahí adentro.
  // Por eso el guard y el `.map` se exigen juntos y EN ORDEN, con `[\s\S]*?`
  // entre medio: es la misma corrección que ya se le había hecho al caso de
  // las guardas de Enter, más arriba.
  //
  // Sobre `mercaderiaEnPesosCentavos` y ya no sobre `totales.ars`: ése era el
  // provisorio que dejó la Task 9, y con un carrito en dólares pagado en pesos
  // hacía que el pie dijera "Mercadería $0" mientras la fila de arriba pedía
  // seiscientos mil.
  it('el pie del cobro sale de lineasDelPieDeCobro sobre la mercadería en pesos', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(
      /const lineasDelPie = lineasDelPieDeCobro\(\s*mercaderiaEnPesosCentavos\(totales, pagos\),\s*pagos,\s*planes,/,
    )
    expect(
      fuente,
      'el pie tiene que dibujarse cuando hay líneas, mapeando ESA lista',
    ).toMatch(/if \(lineas\.length === 0\) return null[\s\S]*?lineas\.map\(/)
  })

  // Las DOS copias del pie, en las dos direcciones (CLAUDE.md, la regla que
  // dejó el merge del ciclo de permisos con el del teléfono): el pie de la
  // card de cobro (escritorio) y `PieDeVenta` (el fijo del teléfono). Un
  // `toContain` solo pasaría igual con una sola de las dos escrita, que es
  // exactamente el modo de falla que esa regla existe para atrapar.
  it('las DOS copias del pie reciben la MISMA lista', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const usos = fuente.match(/<PieDeTotales lineas=\{lineasDelPie\} \/>/g) ?? []
    expect(usos, 'una en el pie de escritorio y otra en PieDeVenta, el del teléfono').toHaveLength(2)
    // Y que la del teléfono llegue de verdad: `PieDeVenta` es otro componente,
    // así que la lista tiene que viajarle como prop desde `PuntoDeVenta`.
    expect(fuente).toMatch(/<PieDeVenta[\s\S]*?lineasDelPie=\{lineasDelPie\}/)
  })

  // El caso que decide si el botón se puede apretar, y el que más duele si
  // sale mal: el faltante se mide contra la MERCADERÍA, no contra lo que
  // entra a la caja. Un carrito de 10.000 con un pago de base 10.000 y 40 %
  // de recargo CIERRA —el motor compara la suma de las bases contra el total
  // de ítems—, así que no puede aparecer el chip "Faltan" ni apagarse
  // "Cobrar". Si el faltante midiera contra los 14.000 que entran, el
  // mostrador no podría cobrar nunca una venta financiada.
  //
  // Es una lectura del FUENTE porque el estado que lo probaría —un carrito
  // con líneas y un pago con plan— no se puede montar en este harness. Lo que
  // fija es que el bloque que decide el faltante no sepa nada del recargo.
  //
  // Y ahora POR MONEDA, que es lo que la Task 9 dejó provisorio: cada pago
  // declara contra qué total va, así que el faltante en pesos se mide contra
  // lo que los pagos cubren en pesos y el de dólares contra lo suyo. Antes,
  // un pago en dólares que cubría exacto la parte en dólares dejaba "Faltan"
  // prendido igual.
  it('el faltante se mide contra la mercadería, no contra lo cobrado, y por moneda', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const desde = fuente.indexOf('const pagadoTotales = totalesDePagosEnCentavos(')
    const hasta = fuente.indexOf('const hayFaltante = hayFaltanteDeVenta(')
    expect(desde, 'el cálculo de lo pagado tiene que existir en el fuente').toBeGreaterThan(-1)
    expect(hasta, 'el cálculo del faltante tiene que existir en el fuente').toBeGreaterThan(desde)
    const bloque = fuente.slice(desde, hasta)
    expect(bloque, 'cada pago viaja con su moneda Y con qué total cubre').toMatch(
      /moneda: p\.moneda,\s*cubre: p\.cubre,/,
    )
    expect(bloque).toMatch(/ars: totales\.ars - pagadoTotales\.ars/)
    expect(bloque).toMatch(/usd: totales\.usd - pagadoTotales\.usd/)
    // Las DOS en cero: una venta mixta no cierra por tener cubierta la mitad
    // en pesos.
    expect(bloque).toMatch(
      /const cierra = hayCarrito && faltan\.ars === 0 && faltan\.usd === 0/,
    )
    expect(
      bloque,
      'ni lo pagado ni el faltante ni "cierra" pueden mirar el recargo: el pago se reparte contra la mercadería',
    ).not.toMatch(/recargo/i)
  })

  // El plan tiene que llegar al servidor con el resto del pago; sin plan, el
  // JSON no puede ganar un campo nuevo (`JSON.stringify` descarta
  // `undefined`), así que un local sin planes manda exactamente lo mismo que
  // antes de esta task.
  it('el plan elegido viaja al servidor junto con el pago', async () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/planId: p\.planId \?\? undefined/)
    expect(await render({ planes: [PLAN_CONTADO] })).not.toContain('planId')
  })

  // La red del bug que el merge con el ciclo del teléfono tuvo que arreglar a
  // mano: ese ciclo reescribió el panel de cobro, y git se quedó con SU versión
  // del JSON escondido, que todavía decía `monto:` —el nombre viejo del campo,
  // de antes de que este ciclo lo renombrara a `base`—. Ni `tsc` ni el lint lo
  // ven: `monto` sigue siendo un nombre válido en un objeto literal que viaja
  // como JSON, y el que se queja es `aDecimal(String(p.base ?? ''))` del
  // servidor, en runtime, en TODA venta.
  //
  // Positivo Y negativo, que es la forma que este repo le exige a las guardas
  // de este tipo: sin el negativo, agregar `monto:` al lado de `base:` pasaría.
  it('el campo del pago viaja como `base`, y el nombre viejo no puede volver', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente, 'el JSON escondido manda `base: p.base`').toMatch(/base: p\.base/)
    expect(fuente, '`monto:` era el nombre de antes del renombre').not.toMatch(/monto: p\./)
  })

  // --- Task 10: el panel de cobro con los dos totales ---
  //
  // Todo lo de acá abajo se prueba como función pura + cableado por FUENTE,
  // por el mismo motivo que el resto del archivo: `render()` monta el carrito
  // VACÍO (renderToStaticMarkup, sin clics ni tipeo), así que una venta con
  // las dos monedas y un pago que las cruza no tiene forma de llegar al HTML.

  // Con una sola moneda no hay nada que elegir, y la fila tiene que quedar
  // EXACTAMENTE como antes de este ciclo: sin selector, sin chip de más. Es la
  // lectura de design/arandano.pen que rige el ciclo entero — la maqueta
  // modela reposo y su silencio no es una instrucción de agregar controles.
  it('el selector Cubre se ofrece sólo cuando la venta tiene los DOS totales', async () => {
    // El cableado: la condición vive en `PuntoDeVenta` (es una propiedad de la
    // VENTA, no del pago) y viaja como prop.
    expect(FUENTE).toMatch(/ofreceCubre=\{totales\.ars > 0 && totales\.usd > 0\}/)
    // Y la fila no lo dibuja sin esa prop.
    expect(FUENTE).toMatch(/\{ofreceCubre && \(/)
    expect(FUENTE).toMatch(/aria-label=\{`Cubre del pago \$\{indice \+ 1\}`\}/)
    // El carrito vacío tiene los dos totales en cero, así que la palabra no
    // puede aparecer en la pantalla: ni el selector ni el rótulo "Cubre US$"
    // del campo de monto, que también es del cruce.
    expect(await render()).not.toContain('Cubre')
  })

  // El pago que nace solo se ENTREGA en la moneda del total que CUBRE. Sin
  // esto, el pago inicial de un carrito de un solo iPhone arrancaba cubriendo
  // un total en pesos que vale cero —la venta no cerraba nunca— y el selector
  // para corregirlo tampoco se dibuja, porque hay una sola moneda.
  it('cubrePorDefecto manda al total que la venta tiene de verdad', async () => {
    const { cubrePorDefecto } = await import('./punto-de-venta')
    expect(cubrePorDefecto({ ars: 1_000_000, usd: 0 })).toBe('ARS')
    expect(cubrePorDefecto({ ars: 0, usd: 30_000 })).toBe('USD')
    // Con las dos, manda pesos: es el default de siempre, y el selector queda
    // para decidir.
    expect(cubrePorDefecto({ ars: 1_000_000, usd: 30_000 })).toBe('ARS')
  })

  it('el pago inicial y el pago nuevo se entregan en la moneda que cubren', () => {
    // `moneda: cubre` en los dos lugares donde nace un pago: así ninguno
    // arranca cruzando, y por lo tanto ninguno arranca pidiendo una cotización
    // que nadie tipeó.
    const inicial = FUENTE.slice(
      FUENTE.indexOf('const cubre = cubrePorDefecto(totales)'),
      FUENTE.indexOf('if (previos.length === 1)'),
    )
    expect(inicial).toMatch(/moneda: cubre,\s*cubre,/)
    expect(inicial, 'no cruza, así que la cotización es 1').toMatch(
      /cotizacion: cotizacionParaElCruce\(cubre, cubre\)/,
    )
  })

  // La cotización NO se precarga nunca: ni con la del local, ni con la del
  // último pago (que era `cotizacionInicial`, borrada en este ciclo), ni con
  // un '1' heredado —que sobre un pago que cruza es un dólar a un peso—.
  it('la cotización arranca vacía y no queda ningún rastro de cotizacionInicial', () => {
    const PAGE = readFileSync('app/(app)/vender/page.tsx', 'utf8')
    expect(FUENTE, 'la prop se borró de toda la cadena').not.toContain('cotizacionInicial={')
    expect(PAGE).not.toContain('cotizacionInicial')
    // El campo se dibuja SÓLO cuando el pago cruza monedas.
    expect(FUENTE).toMatch(/\{cruza \? \(/)
    expect(FUENTE).toMatch(/const cruza = pago\.moneda !== pago\.cubre/)
  })

  it('cotizacionParaElCruce deja el campo vacío al cruzar y lo limpia al dejar de cruzar', async () => {
    const { cotizacionParaElCruce } = await import('./punto-de-venta')
    // Cruza: vacía. Un '1' acá es una venta que cierra por un número que nadie
    // tipeó.
    expect(cotizacionParaElCruce('ARS', 'USD')).toBe('')
    expect(cotizacionParaElCruce('USD', 'ARS')).toBe('')
    // No cruza: '1'. El servidor no usa la cotización en ese caso, pero la
    // exige mayor que cero igual (COTIZACION_INVALIDA), así que la cadena
    // vacía no puede viajar.
    expect(cotizacionParaElCruce('ARS', 'ARS')).toBe('1')
    expect(cotizacionParaElCruce('USD', 'USD')).toBe('1')
  })

  // La cotización MENTIROSA, hallazgo de la review de la Task 3: con
  // `moneda === cubre` el servidor ni mira la cotización, así que tipear 1485
  // con `cubre: 'USD'` y después volver el selector a pesos dejaba ese 1485
  // pegado a un pago que no convierte nada, guardado para siempre en
  // `Pago.cotizacion` sin que ninguna cuenta lo notara. Los DOS selectores que
  // pueden cambiar el cruce tienen que rehacerla.
  it('cambiar la moneda o el total que cubre rehace la cotización', () => {
    const desdeLaMoneda = FUENTE.indexOf("const moneda = valor as Pago['moneda']")
    expect(desdeLaMoneda, 'el handler de moneda tiene que existir').toBeGreaterThan(-1)
    expect(
      FUENTE.slice(desdeLaMoneda, FUENTE.indexOf('<SelectTrigger', desdeLaMoneda)),
    ).toMatch(/cotizacion: cotizacionParaElCruce\(moneda, pago\.cubre\)/)

    const desdeElCubre = FUENTE.indexOf("const cubre = valor as Pago['cubre']")
    expect(desdeElCubre, 'el handler de cubre tiene que existir').toBeGreaterThan(-1)
    expect(
      FUENTE.slice(desdeElCubre, FUENTE.indexOf('<SelectTrigger', desdeElCubre)),
    ).toMatch(/cotizacion: cotizacionParaElCruce\(pago\.moneda, cubre\)/)
  })

  // Igual que cambiar el medio o la moneda: un plan que sobreviva a un cambio
  // que lo vuelve inválido —o que le cambia la base al recargo, que es lo que
  // hace `cubre`— es un error del motor con la pantalla en verde.
  it('cambiar el total que cubre limpia el plan elegido', () => {
    const desde = FUENTE.indexOf("const cubre = valor as Pago['cubre']")
    expect(desde, 'el handler de cubre tiene que existir en el fuente').toBeGreaterThan(-1)
    // Hasta el cierre del handler y no una ventana de N caracteres, mismo
    // criterio que el caso hermano de medio/moneda.
    const contexto = FUENTE.slice(desde, FUENTE.indexOf('<SelectTrigger', desde))
    expect(
      contexto,
      'cambiar el total que cubre tiene que limpiar el plan en el MISMO onCambiar',
    ).toMatch(/planId: null/)
  })

  // El bug de plata que este ciclo NO puede repetir. Un pago en pesos que
  // cubre el total en dólares tiene base 300 —en dólares, porque el pago toca
  // dólares de algún lado— y entrega 445.500 pesos. Aplicarle el 40 % a 300
  // daría un recargo mil veces más chico que el que cobra el motor, y el
  // vuelto saldría de otro planeta.
  it('el recargo y el vuelto salen de los PESOS que entrega la fila, no de la base', async () => {
    const { recargoDeLaFilaEnCentavos, aCobrarDeLaFilaEnCentavos } = await import('./punto-de-venta')
    const enPesosCubriendoUsd = {
      moneda: 'ARS' as const,
      cubre: 'USD' as const,
      base: '300',
      cotizacion: '1485',
      planId: PLAN_CREDITO.id,
    }
    // 300 × 1485 = 445.500 pesos entregados; 40 % de eso son 178.200.
    expect(recargoDeLaFilaEnCentavos(enPesosCubriendoUsd, [PLAN_CREDITO])).toBe(17_820_000)
    // Y lo que hay que cobrar por esa fila son los 623.700 del ejemplo del
    // spec, no 300 ni 420.
    expect(aCobrarDeLaFilaEnCentavos(enPesosCubriendoUsd, [PLAN_CREDITO])).toBe(62_370_000)
  })

  // El cableado del renglón "A cobrar": tiene que comparar contra los pesos
  // ENTREGADOS y no contra la base, que desde este ciclo puede estar en
  // dólares — si comparara contra la base, el renglón aparecería en toda fila
  // que cruce, con plan o sin plan, diciendo dos números en dos monedas
  // distintas como si fueran comparables.
  it('el renglón "A cobrar" se mide contra montoEntregadoEnCentavos, no contra la base', () => {
    expect(FUENTE).toMatch(/montoEntregadoEnCentavos\(\{/)
    expect(FUENTE).toMatch(/const entregadoCentavos = pesosDeLaFilaEnCentavos\(pago\)/)
    expect(FUENTE).toMatch(
      /function pesosDeLaFilaEnCentavos[\s\S]*?return montoEntregadoEnCentavos\(/,
    )
  })

  // El pie sigue siendo un desglose EN PESOS, así que la mercadería contra la
  // que suma el recargo tiene que incluir los pesos con los que se cubre la
  // parte en dólares. Sin esto, un carrito de un solo iPhone pagado en pesos
  // con un plan mostraba "Mercadería $0 / Total a cobrar $178.200" mientras la
  // fila de arriba pedía $623.700.
  it('la mercadería del pie suma los pesos que cubren el total en dólares', async () => {
    const { mercaderiaEnPesosCentavos } = await import('./punto-de-venta')
    const enPesosCubriendoUsd = {
      moneda: 'ARS' as const,
      cubre: 'USD' as const,
      base: '300',
      cotizacion: '1485',
      planId: null,
    }
    // Carrito en dólares solo: la mercadería en pesos es lo que ese pago
    // entrega.
    expect(
      mercaderiaEnPesosCentavos({ ars: 0, usd: 30_000 }, [enPesosCubriendoUsd]),
    ).toBe(44_550_000)
    // Carrito mixto: los pesos del carrito MÁS esos.
    expect(
      mercaderiaEnPesosCentavos({ ars: 1_000_000, usd: 30_000 }, [
        enPesos('10000'),
        enPesosCubriendoUsd,
      ]),
    ).toBe(45_550_000)
    // La parte que se paga EN dólares no suma pesos: no hay pesos que sumar, y
    // el plan tampoco puede tocarla.
    expect(
      mercaderiaEnPesosCentavos({ ars: 1_000_000, usd: 30_000 }, [
        enPesos('10000'),
        { moneda: 'USD', cubre: 'USD', base: '300', cotizacion: '1', planId: null },
      ]),
    ).toBe(1_000_000)
    // Un carrito en pesos con un pago en pesos queda exactamente como antes de
    // este ciclo.
    expect(mercaderiaEnPesosCentavos({ ars: 1_000_000, usd: 0 }, [enPesos('10000')])).toBe(
      1_000_000,
    )
  })

  // Un chip por moneda que la venta tenga: con una sola moneda sale UNO, igual
  // que antes de este ciclo; con las dos salen los dos, y cada uno se mide
  // contra su propio total.
  it('hay un chip de faltante por cada moneda que la venta tenga', async () => {
    const { chipsDeFaltante } = await import('./punto-de-venta')
    expect(chipsDeFaltante({ ars: 1_000_000, usd: 0 }, { ars: 500_000, usd: 0 })).toEqual([
      { moneda: 'ARS', faltanCentavos: 500_000 },
    ])
    expect(chipsDeFaltante({ ars: 0, usd: 30_000 }, { ars: 0, usd: 30_000 })).toEqual([
      { moneda: 'USD', faltanCentavos: 30_000 },
    ])
    expect(chipsDeFaltante({ ars: 1_000_000, usd: 30_000 }, { ars: 0, usd: 30_000 })).toEqual([
      { moneda: 'ARS', faltanCentavos: 0 },
      { moneda: 'USD', faltanCentavos: 30_000 },
    ])
    // El carrito vacío no reserva ningún chip.
    expect(chipsDeFaltante({ ars: 0, usd: 0 }, { ars: 0, usd: 0 })).toEqual([])
    // Una línea a medio tipear deja su moneda en NaN, que también es distinto
    // de cero: el chip sigue reservado y lo apaga `ChipDeFaltante`, que ya
    // trata el NaN.
    expect(chipsDeFaltante({ ars: NaN, usd: 0 }, { ars: NaN, usd: 0 })).toHaveLength(1)
  })

  // Ola final del ciclo: el camino que dejaba "Cobrar" apagado y MUDO. Con
  // DOS pagos —uno por total— sacar del carrito la última línea en pesos deja
  // `totales.ars` en 0 mientras el segundo pago sigue apuntado a pesos con su
  // base vieja; `reapuntarPagoUnico` no corre (sólo re-apunta con UN pago) y
  // `ofreceCubre` tampoco dibuja el selector que permitiría corregirlo. Con
  // la condición vieja (`totales.ars !== 0` a secas) no salía ningún chip:
  // botón deshabilitado, sin cartel y sin control. Ahora sale `Sobran`.
  it('un total que desapareció pero sigue teniendo pagos apuntados igual dibuja su chip', async () => {
    const { chipsDeFaltante } = await import('./punto-de-venta')
    expect(chipsDeFaltante({ ars: 0, usd: 30_000 }, { ars: -1_500_000, usd: 0 })).toEqual([
      { moneda: 'ARS', faltanCentavos: -1_500_000 },
      { moneda: 'USD', faltanCentavos: 0 },
    ])
    // El espejo del otro lado: los dólares desaparecidos con un pago que
    // seguía cubriéndolos.
    expect(chipsDeFaltante({ ars: 1_000_000, usd: 0 }, { ars: 0, usd: -30_000 })).toEqual([
      { moneda: 'ARS', faltanCentavos: 0 },
      { moneda: 'USD', faltanCentavos: -30_000 },
    ])
    // Y la guarda que el `o` NO puede aflojar: sin total y sin faltante no
    // hay nada que decir, así que el carrito vacío sigue sin reservar chips.
    expect(chipsDeFaltante({ ars: 0, usd: 0 }, { ars: 0, usd: 0 })).toEqual([])
  })

  // Las DOS copias, en las dos direcciones (CLAUDE.md, la regla que dejó el
  // merge del ciclo de permisos con el del teléfono): el pie de la card
  // (escritorio) y `PieDeVenta` (el fijo del teléfono) mapean la MISMA lista.
  // Un `toContain` solo pasaría igual con una sola de las dos mapeando y la
  // otra pintando el primer chip.
  it('los DOS pies mapean la misma lista de chips', () => {
    expect([...FUENTE.matchAll(/chipsDelFaltante\.map\(/g)]).toHaveLength(2)
    expect(FUENTE).toMatch(/<PieDeVenta[\s\S]*?chipsDelFaltante=\{chipsDelFaltante\}/)
    // Y el importe de cada chip sale en SU moneda: el de dólares tiene que
    // decir "US$ 300,00" y no "$ 300,00".
    expect(FUENTE).toMatch(
      /precioEnSuMoneda\(deCentavos\(Math\.abs\(faltanCentavos\)\), moneda\)/,
    )
  })

  // El campo que la Task 3 sumó del lado del servidor tiene que llegar hasta
  // ahí. Y la cotización que viaja no puede ser la cadena vacía: cuando el
  // pago NO cruza, el servidor no la usa para ninguna cuenta pero la exige
  // mayor que cero igual (COTIZACION_INVALIDA), así que ahí manda '1'.
  it('cada pago le dice al servidor qué total cubre, y con qué cotización', () => {
    expect(FUENTE, 'el JSON escondido manda `cubre: p.cubre`').toMatch(/cubre: p\.cubre/)
    expect(FUENTE).toMatch(/cotizacion: p\.moneda === p\.cubre \? '1' : p\.cotizacion/)
  })

  // --- Ronda de arreglo 1: el re-apuntado del pago único y el rótulo del pie ---

  /**
   * Un pago del panel de cobro, para los casos del re-apuntado. Inline y no
   * como `const` suelta: `reapuntarPagoUnico` pide los enums literales, y una
   * variable intermedia los ensancharía a `string`.
   */
  function pagoDeMostrador(p: {
    moneda: 'ARS' | 'USD'
    cubre: 'ARS' | 'USD'
    base: string
    cotizacion: string
    planId: string | null
  }) {
    return { medio: 'TARJETA_CREDITO' as const, recibido: '', ...p }
  }

  // El bug Important 1 de la review, con su camino de mostrador exacto: carrito
  // mixto, UN pago en pesos contra el total en pesos con "Crédito 3 cuotas"
  // elegido, y el cliente pide sacar la funda. El pago se re-apunta al total en
  // dólares —hasta ahí, bien— pero el plan viajaba en el spread: el selector de
  // plan no se dibuja para un pago en dólares, así que quedaba puesto y sin
  // control que lo sacara, "Cobrar" se habilitaba, y el motor lo rechazaba con
  // PLAN_EN_DOLARES.
  it('re-apuntar el pago único al total que queda le limpia el plan', async () => {
    const { reapuntarPagoUnico } = await import('./punto-de-venta')
    const reapuntado = reapuntarPagoUnico(
      pagoDeMostrador({
        moneda: 'ARS',
        cubre: 'ARS',
        base: '10000',
        cotizacion: '1',
        planId: PLAN_CREDITO.id,
      }),
      // La funda salió del carrito: sólo queda el iPhone de US$ 300.
      { ars: 0, usd: 30_000 },
    )
    expect(reapuntado.cubre, 'sigue al único total que queda').toBe('USD')
    expect(reapuntado.moneda, 'y se entrega en esa moneda, sin cruzar').toBe('USD')
    expect(reapuntado.cotizacion, 'no cruza, así que 1 y no la vieja').toBe('1')
    expect(reapuntado.base).toBe('300.00')
    expect(
      reapuntado.planId,
      'el plan NO puede sobrevivir: en un pago en dólares no hay selector que lo saque',
    ).toBeNull()
  })

  it('re-apuntar en la otra dirección también limpia, y rehace la cotización', async () => {
    const { reapuntarPagoUnico } = await import('./punto-de-venta')
    // Un pago que CRUZA (pesos contra el total en dólares, con su cotización
    // tipeada) y el iPhone sale del carrito: queda sólo la funda.
    const reapuntado = reapuntarPagoUnico(
      pagoDeMostrador({
        moneda: 'ARS',
        cubre: 'USD',
        base: '300',
        cotizacion: '1485',
        planId: PLAN_CREDITO.id,
      }),
      { ars: 1_000_000, usd: 0 },
    )
    expect(reapuntado.cubre).toBe('ARS')
    expect(reapuntado.moneda).toBe('ARS')
    expect(reapuntado.cotizacion, 'la de 1485 era de un cruce que ya no existe').toBe('1')
    expect(reapuntado.planId).toBeNull()
    expect(reapuntado.base).toBe('10000.00')
  })

  // La otra mitad de la regla, y la que impide "arreglar" el bug de arriba
  // limpiando siempre: mientras la venta tenga las DOS monedas manda lo que la
  // persona eligió, y el plan y la cotización que tipeó tienen que quedarse.
  it('con las dos monedas en la venta no se re-apunta nada: sólo sigue la base', async () => {
    const { reapuntarPagoUnico } = await import('./punto-de-venta')
    const sigueIgual = reapuntarPagoUnico(
      pagoDeMostrador({
        moneda: 'ARS',
        cubre: 'USD',
        base: '300',
        cotizacion: '1485',
        planId: PLAN_CREDITO.id,
      }),
      { ars: 1_000_000, usd: 42_000 },
    )
    expect(sigueIgual.cubre).toBe('USD')
    expect(sigueIgual.moneda).toBe('ARS')
    expect(sigueIgual.cotizacion, 'la cotización tipeada no se toca').toBe('1485')
    expect(sigueIgual.planId, 'ni el plan elegido').toBe(PLAN_CREDITO.id)
    expect(sigueIgual.base, 'lo único que cambia es la base, que sigue a su total').toBe('420.00')
  })

  // El cableado: el ajuste durante el render tiene que DELEGAR en esta función
  // y no volver a escribir la regla adentro del `setPagos`, que es donde la
  // review pudo mutar la condición entera sin que nada se pusiera en rojo.
  it('el pago único se re-apunta desde el ajuste del carrito', () => {
    expect(FUENTE).toMatch(
      /if \(previos\.length === 1\) return \[reapuntarPagoUnico\(previos\[0\], totales\)\]/,
    )
  })

  // El bug Important 2 de la review: el pie es un desglose EN PESOS de punta a
  // punta, así que con una funda con descuento y un iPhone pagado EN dólares
  // decía "Total a cobrar $9.000" sin nombrar los dólares en ningún lado — y el
  // chip de faltante en dólares tampoco los nombra, porque esa parte está
  // cubierta y un chip en cero no se dibuja. El rótulo es lo que lo vuelve
  // cierto.
  it('con un total en dólares, el pie dice que su total es EN PESOS', async () => {
    const { lineasDelPieDeCobro } = await import('./punto-de-venta')
    const conDolares = lineasDelPieDeCobro(
      1_000_000,
      [enPesos('10000', PLAN_CONTADO.id)],
      [PLAN_CONTADO],
      true,
    )
    expect(conDolares[2]).toEqual({
      rotulo: 'Total a cobrar en pesos',
      monto: formatearPrecio('9000'),
    })
    // Y sin dólares en la venta, el pie queda exactamente como estaba.
    const sinDolares = lineasDelPieDeCobro(
      1_000_000,
      [enPesos('10000', PLAN_CONTADO.id)],
      [PLAN_CONTADO],
      false,
    )
    expect(sinDolares[2].rotulo).toBe('Total a cobrar')

    // El cableado: la pantalla tiene que pasarle si la venta tiene un total en
    // dólares, y no un `false` fijo.
    expect(FUENTE).toMatch(
      /lineasDelPieDeCobro\(\s*mercaderiaEnPesosCentavos\(totales, pagos\),\s*pagos,\s*planes,\s*totales\.usd !== 0,?\s*\)/,
    )
  })
})

// --- El ciclo móvil: el cuerpo en un teléfono de 390 px ---
//
// Un solo árbol de marcado, mobile-first, con un único corte en `lg:` (1024,
// hooks/use-mobile.ts). Frames `VaHod` (carrito) y `keRdN` (cobro) de
// design/arandano.pen.

describe('el punto de venta en el teléfono', () => {
  // El carrito de una venta en curso vive en el estado de cliente de este
  // componente: cualquier navegación de Next lo remonta y se lo lleva puesto.
  // Por eso el paso vive en `window.history.pushState` (app/(app)/vender/paso.ts)
  // y no en el router — este caso es la red que impide que alguien "simplifique"
  // el hook a un useSearchParams más adelante.
  it('el paso de cobro no pasa por el router de Next', () => {
    expect(FUENTE).toContain('usePasoDeCobro')
    expect(FUENTE, 'router.push/useSearchParams remontarían el carrito').not.toMatch(
      /useRouter|useSearchParams|next\/navigation/,
    )
  })

  // El <Encabezado> se mudó de page.tsx (servidor) a acá: sus props dependen
  // del paso, y el paso es estado de cliente. Encabezado es JSX puro, sin
  // ninguna API de servidor, así que un componente cliente puede renderizarlo.
  it('el Encabezado lo renderiza este componente, no page.tsx', () => {
    const page = readFileSync('app/(app)/vender/page.tsx', 'utf8')
    expect(
      page,
      'page.tsx ya no puede renderizar el Encabezado: sus props dependen del paso',
    ).not.toMatch(/<Encabezado|from '@\/components\/shell\/encabezado'/)
    expect(FUENTE).toContain('<Encabezado')
  })

  it('el Topbar cambia de título, subtítulo y flecha con el paso', () => {
    expect(FUENTE).toMatch(/titulo=\{pasoVisible === 'cobro' \? 'Cobro' : 'Vender'\}/)
    expect(FUENTE).toMatch(/alVolver=\{pasoVisible === 'cobro' \? volverAlCarrito : undefined\}/)
    // La flecha vuelve por el hook, no por un href: un link a /vender es
    // justamente la navegación que perdería el carrito.
    expect(FUENTE, 'la flecha del cobro no puede ser un href').not.toMatch(/atras=/)
  })

  // "En escritorio `paso` se ignora por completo" (spec §4): las dos columnas
  // se ven siempre y el Topbar no cambia, aunque la URL traiga ?paso=cobro
  // —por ejemplo al agrandar la ventana a mitad de un cobro—.
  it('en escritorio el paso se ignora', () => {
    expect(FUENTE).toMatch(/const pasoVisible = enTelefono \? paso : 'carrito'/)
  })

  it('los dos chips de estado se ven en el cuerpo del teléfono y en el header de escritorio', async () => {
    const html = await render({ caja: { abiertaEn: new Date('2026-08-21T17:32:00Z') } })
    const veces = [...html.matchAll(/Caja abierta/g)].length
    expect(
      veces,
      'el estado de la caja tiene que estar dos veces: el chip interactivo del ' +
        'header (hidden lg:flex) y el de sólo lectura del cuerpo (lg:hidden)',
    ).toBe(2)
    expect(FUENTE).toContain('<ChipsDeEstado')
    expect(FUENTE).toContain('<ChipCaja')
  })

  // Los chips del cuerpo son de sólo lectura (design/arandano.pen no les pone
  // ningún control adentro), así que abrir y cerrar el turno se van a la
  // ranura derecha del Topbar.
  it('la ranura derecha del Topbar lleva el control de caja', () => {
    expect(FUENTE).toMatch(/controlMovil=\{[\s\S]{0,90}<ControlDeCaja/)
  })

  it('la fila de columnas corta en lg, y no queda ningún md: en la pantalla', () => {
    expect(FUENTE).toMatch(/flex flex-col gap-\[18px\] lg:flex-row/)
    expect(
      SIN_COMENTARIOS,
      'el único corte del ciclo móvil es lg: (1024) — ningún md:, sm: ni xl: nuevo',
    ).not.toMatch(/\bmd:/)
  })

  // Mobile-first y NO `max-lg:`: el valor del teléfono va sin prefijo y el de
  // escritorio con `lg:`. En `lg:` las dos columnas terminan en `flex`, sin
  // mirar el paso.
  it('el paso esconde una columna y muestra la otra, sólo en el teléfono', () => {
    expect(FUENTE).toMatch(/paso === 'cobro' \? 'hidden lg:flex' : 'flex'/)
    expect(FUENTE).toMatch(/paso === 'cobro' \? 'flex' : 'hidden lg:flex'/)
    expect(SIN_COMENTARIOS, 'la constraint del ciclo prohíbe max-lg:').not.toMatch(/max-lg:/)
  })

  it('el buscador mide 52 en el teléfono y 58 en escritorio', async () => {
    const html = await render()
    expect(html).toContain('h-[52px]')
    expect(html).toContain('lg:h-[58px]')
  })

  // El chip "F2" promete un atajo de teclado, y un teléfono no tiene teclas de
  // función: en el teléfono es un cartel que no se puede cumplir. `I5IuID` (el
  // buscador de VaHod) tampoco lo dibuja.
  it('el chip F2 no se muestra en un teléfono', async () => {
    const html = await render()
    const chip = html.match(/<span class="([^"]*)"[^>]*>\s*F2\s*<\/span>/)
    expect(chip, 'no se encontró el chip F2').toBeTruthy()
    expect(chip![1]).toContain('hidden')
    expect(chip![1]).toContain('lg:inline-block')
  })

  it('el panel de cobro ocupa todo el ancho del teléfono', async () => {
    const html = await render()
    expect(html).toContain('w-full')
    expect(html).toContain('lg:w-96')
  })

  it('el pie del teléfono repite el botón Cobrar de 54 px y no existe en escritorio', async () => {
    const html = await render()
    const veces = [...html.matchAll(/h-\[54px\]/g)].length
    expect(
      veces,
      'el botón de 54 px tiene que estar dos veces: el pie del teléfono (lg:hidden) ' +
        'y el pie de la card de cobro (hidden lg:flex)',
    ).toBe(2)

    const posicion = FUENTE.indexOf('function PieDeVenta')
    expect(posicion, 'el pie del teléfono tiene que ser su propio componente').toBeGreaterThan(-1)
    const contexto = FUENTE.slice(posicion)
    expect(contexto).toMatch(/lg:hidden/)
    expect(contexto).toMatch(/h-\[54px\]/)
    expect(contexto, 'radio 12, como el nodo f4EIb de VaHod').toMatch(/rounded-\[12px\]/)
  })

  // Dos pantallas, dos botones con el mismo rótulo y trabajos distintos: en el
  // carrito el botón AVANZA al cobro (el frame VaHod lleva a keRdN), y recién
  // en el cobro cobra de verdad.
  it('en el carrito el botón del pie lleva al cobro; en el cobro, cobra', () => {
    const contexto = FUENTE.slice(FUENTE.indexOf('function PieDeVenta'))
    expect(contexto).toMatch(/onClick=\{irACobro\}/)
    expect(contexto).toMatch(/form=\{ID_FORMULARIO_DE_COBRO\}/)
    // Y el <form> del cobro tiene que llevar ese mismo id, o el botón del pie
    // —que vive afuera del form— no dispararía nada.
    expect(FUENTE).toMatch(/id=\{ID_FORMULARIO_DE_COBRO\}/)
  })

  it('el pie del cobro suma la banda de faltante', () => {
    const contexto = FUENTE.slice(FUENTE.indexOf('function PieDeVenta'))
    // `[\s\S]*?` entre el guard y el chip: desde la Task 10 son varios chips
    // —uno por moneda— y el `.map` queda en el medio.
    expect(contexto).toMatch(/paso === 'cobro' &&[\s\S]*?<ChipDeFaltante/)
  })

  // El chip de faltante está en dos lugares (el pie del teléfono y el pie de
  // la card de escritorio) y se define UNA vez: dos copias del mismo JSX es
  // como una se queda atrás sin que nada avise.
  it('el chip de faltante se define una sola vez y se usa en los dos pies', () => {
    expect([...FUENTE.matchAll(/<ChipDeFaltante/g)].length).toBe(2)
    expect([...FUENTE.matchAll(/function ChipDeFaltante/g)].length).toBe(1)
  })


  // --- El vaciado del carrito ---
  //
  // En escritorio esa capacidad la da el doble Esc. En un teléfono no hay Esc,
  // y sin este botón la única forma de deshacer una venta mal armada era
  // borrar ítem por ítem con la ✕. El nodo `L5UIo` de VaHod lo dibuja: un
  // encabezado de card con "Carrito" a la izquierda y "Vaciar" a la derecha.

  it('el carrito del teléfono tiene su encabezado con "Vaciar"', async () => {
    const html = await render()
    const encabezado = html.match(/<div class="([^"]*)"[^>]*><span[^>]*>Carrito<\/span>/)
    expect(encabezado, 'no se encontró el encabezado del carrito').toBeTruthy()
    expect(encabezado![1], 'en escritorio manda la fila de encabezados de la tabla').toContain(
      'lg:hidden',
    )
    // padding [11,14] y borde inferior (nodo `L5UIo`).
    expect(encabezado![1]).toContain('px-[14px]')
    expect(encabezado![1]).toContain('py-[11px]')
    expect(encabezado![1]).toContain('border-b')
    expect(html).toContain('Vaciar')
  })

  // Con el carrito vacío no hay nada que vaciar, y el atajo Esc ya se abstiene
  // en ese caso: el botón tiene que hacer lo mismo o las dos mitades del mismo
  // gesto dirían cosas distintas.
  it('con el carrito vacío el botón de vaciar está apagado', async () => {
    const html = await render()
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Vaciar<\/button>/)
  })

  // LO QUE MÁS IMPORTA DE ESTE BOTÓN: comparte el estado de confirmación con
  // el atajo, no tiene el suyo. Con dos estados separados, armar por Esc y
  // confirmar por botón (o al revés) quedaría desincronizado, y el desarme
  // automático a los 3 segundos sólo bajaría uno de los dos.
  it('el botón Vaciar y el atajo Esc comparten la confirmación en dos pasos', () => {
    // UN solo estado de confirmación, UN solo lugar donde se arma, UNA sola
    // función que decide. Es lo que este caso existe para proteger: con dos
    // estados, armar por Esc y confirmar por botón no se entenderían.
    expect([...FUENTE.matchAll(/\[vaciadoArmado, setVaciadoArmado\] = useState/g)].length).toBe(1)
    expect([...FUENTE.matchAll(/setVaciadoArmado\(true\)/g)].length).toBe(1)
    expect([...FUENTE.matchAll(/const alternarVaciado = useCallback/g)].length).toBe(1)

    // Y los dos caminos entran por ahí: el botón por su onClick, el atajo
    // desde la rama de Escape del listener global.
    expect(FUENTE).toMatch(/onClick=\{alternarVaciado\}/)
    const rama = FUENTE.slice(FUENTE.indexOf('esAtajoDeVaciar(e.key)'))
    expect(rama.slice(0, 500)).toMatch(/alternarVaciado\(\)/)

    // El rótulo cambia con el mismo estado que la leyenda de escritorio, y usa
    // la fórmula "Sí, <verbo>" que ya eligieron AnularVenta y ConfirmarCierre.
    expect(FUENTE).toMatch(/vaciadoArmado \? 'Sí, vaciar' : 'Vaciar'/)
  })

  // Un teléfono no tiene Esc, así que la leyenda de atajos no puede ser la
  // única señal de que hay una confirmación armada: el botón la lleva encima.
  it('el botón armado se pinta con el rojo de "esto no se deshace"', () => {
    const posicion = FUENTE.indexOf("'Sí, vaciar'")
    expect(posicion, 'el rótulo confirmado tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = FUENTE.slice(Math.max(0, posicion - 500), posicion)
    expect(contexto).toMatch(/text-destructive/)
  })

  // Después de cobrar, el carrito y los pagos se vacían y el foco vuelve al
  // buscador para el próximo escaneo. En el teléfono eso no alcanza: la
  // pantalla sigue en el paso de cobro, así que la card del carrito y su banda
  // de total están en `hidden`, y ese escaneo agrega líneas a una tabla que no
  // se ve y a un total que no se ve. Es el flujo NORMAL —venta tras venta—, y
  // ahí se pierde el ancla de la pantalla.
  it('después de cobrar la pantalla vuelve al carrito, y recién ahí devuelve el foco', () => {
    const deps = FUENTE.indexOf('}, [ventaProcesada, paso, descartarElCobro])')
    expect(
      deps,
      'el efecto del fin de venta tiene que depender también del paso y de descartarElCobro',
    ).toBeGreaterThan(-1)
    const cuerpo = FUENTE.slice(FUENTE.lastIndexOf('useEffect(() => {', deps), deps)
    // Y en ESTE orden, con la vuelta cortando la pasada: con el paso todavía
    // en cobro el buscador está en display:none y `focus()` no hace nada, así
    // que el foco tiene que esperar a la pasada siguiente del efecto.
    expect(cuerpo).toMatch(/descartarElCobro\(\)[\s\S]*?return[\s\S]*?buscador\.current\?\.focus\(\)/)
  })

  // La vuelta automática NO puede ser la misma que la de la flecha. Con
  // `volverAlCarrito` (que empuja una entrada), tocar Atrás después de cobrar
  // restauraba `paso='cobro'` con `ventaProcesada` todavía seteado —nadie lo
  // limpia, y no se puede: gatea el cartel de "Venta #N cobrada" y la guarda
  // del ajuste durante el render—, así que el efecto volvía a disparar y a
  // empujar otra entrada. El gesto de volver quedaba muerto en la ventana
  // entre cobrar y escanear el artículo siguiente, o sea después de CADA venta.
  it('la vuelta automática no deja entrada de historial, y la flecha sí', () => {
    const deps = FUENTE.indexOf('}, [ventaProcesada, paso, descartarElCobro])')
    // La existencia, antes del slice: sin esto `indexOf` da -1, el slice sale
    // vacío y el caso pasa sin haber mirado nada — el mismo falso verde que ya
    // apareció dos veces en esta task.
    expect(deps, 'no se encontró el efecto del fin de venta').toBeGreaterThan(-1)
    const cuerpo = FUENTE.slice(FUENTE.lastIndexOf('useEffect(() => {', deps), deps)
    expect(
      cuerpo,
      'la vuelta de después de cobrar no la pidió nadie: no le corresponde una entrada propia',
    ).not.toMatch(/volverAlCarrito\(\)/)
    // Y la flecha del Topbar sigue siendo la vuelta CON entrada: es un gesto
    // de la persona, y ahí Atrás tiene que deshacerlo.
    expect(FUENTE).toMatch(/alVolver=\{pasoVisible === 'cobro' \? volverAlCarrito : undefined\}/)
  })

  // `keRdN` no dibuja el buscador: su Cuerpo es la banda del total, los pagos y
  // el botón que suma uno. Es además lo que vuelve silencioso al defecto de
  // arriba — es lo que permite escanear desde una pantalla donde el carrito no
  // se ve.
  it('el buscador no se ve en el paso de cobro', () => {
    expect(FUENTE).toMatch(/paso === 'cobro' \? 'hidden lg:block' : 'block'/)
  })

  // La constraint más frágil de la task: a 1024 o más, /vender tiene que verse
  // exactamente como antes del ciclo móvil. El padding del cuerpo es la pieza
  // que lo decide —se mudó de page.tsx a acá adentro— y no la fijaba ningún
  // caso.
  it('el cuerpo mide 12/14 en el teléfono y vuelve a p-6 en escritorio', async () => {
    const html = await render()
    const cuerpo = html.match(/<div class="([^"]*lg:p-6[^"]*)"/)?.[1]
    expect(cuerpo, 'no se encontró el cuerpo').toBeTruthy()
    expect(cuerpo).toContain('px-[14px]')
    expect(cuerpo).toContain('py-3')
    expect(cuerpo).toContain('gap-3')
    expect(cuerpo).toContain('lg:gap-[18px]')
  })

  // Los tres atajos de teclado se abstienen mientras haya un overlay de Radix
  // montado, y el selector que los detecta nombra un rol por primitivo. LOS
  // TRES, no uno: la primera versión de este caso afirmaba `role="menu"` —el
  // del DropdownMenu que esta pantalla YA NO USA— mientras se llamaba "con la
  // hoja de caja abierta", así que borrar `[role="dialog"]` del selector lo
  // dejaba en verde y devolvía el bug de cobro que esta pantalla ya tuvo.
  // Que el `Sheet` SEA un dialog de Radix lo verifica caja.test.tsx contra el
  // paquete instalado; que el selector lo BUSQUE se verifica acá.
  it('el selector de overlays nombra los tres roles de Radix, la hoja de caja incluida', () => {
    const posicion = FUENTE.indexOf('function hayOverlayDeRadixAbierto')
    expect(posicion).toBeGreaterThan(-1)
    const cuerpo = FUENTE.slice(posicion, posicion + 300)
    // listbox: los Select de medio y moneda. dialog: la hoja de caja (Sheet).
    // menu: ninguno hoy, y se queda por si vuelve un menú — sacarlo sería
    // gratis de reintroducir mal.
    expect(cuerpo, 'sin listbox, Enter cobra con el medio/moneda anterior').toContain(
      'role="listbox"',
    )
    expect(cuerpo, 'sin dialog, Escape para cerrar la hoja de caja arma el vaciado del carrito').toContain(
      'role="dialog"',
    )
    expect(cuerpo).toContain('role="menu"')
  })

  // El escritorio no puede cambiar de aspecto: el pie de la card de cobro
  // sigue con sus tres piezas, sólo que ahora oculto en el teléfono.
  it('el pie de la card de cobro sigue entero, y sólo se ve en escritorio', () => {
    const inicio = FUENTE.search(/<div className="hidden flex-col[^"]*lg:flex">/)
    expect(inicio, 'el pie de la card tiene que quedar oculto en el teléfono').toBeGreaterThan(-1)
    // Hasta el cierre del <form>, que es donde termina el pie: así el caso
    // afirma que las tres piezas siguen ADENTRO de este bloque y no que
    // existan sueltas en algún otro lado del archivo.
    const contexto = FUENTE.slice(inicio, FUENTE.indexOf('</form>', inicio))
    expect(contexto).toContain('<AvisosDelCobro')
    expect(contexto).toContain('<ChipDeFaltante')
    expect(contexto).toContain('Enter para cobrar · Esc para vaciar')
  })

  // --- Task 4b: la fila del carrito, con el patrón ya estrenado por
  // app/(app)/ventas/page.tsx (`Listado`) ---
  //
  // El carrito arranca vacío en `render()` (no hay prop para precargar
  // líneas), así que ninguno de estos casos puede mirar el HTML de una fila
  // real — igual que "cada fila del carrito muestra el SKU" y "el aviso de
  // stock insuficiente" más arriba, miran el FUENTE.

  it('el carrito ya no es una <Table>: el patrón es grid + role, como en /ventas', () => {
    expect(FUENTE, 'sin <Table>: el nuevo contenedor es un <div role="table">').not.toMatch(/<Table[\s>]/)
    expect(FUENTE).not.toContain("from '@/components/ui/table'")
    expect(FUENTE).toMatch(
      /role="table" className="grid grid-cols-1 lg:grid-cols-\[1fr_104px_110px_130px_28px\]"/,
    )
  })

  // La Task 3 la había escondido del todo (mitigación temporal mientras la
  // fila seguía siendo una <table> sin reflow, ver el comentario que dejó en
  // el <TableHead>). Con el reflow resuelto acá, tiene que volver.
  it('la columna "Precio" vuelve a existir en escritorio', () => {
    expect(FUENTE, 'lg:table-cell era la marca de la Table vieja').not.toMatch(/lg:table-cell/)
    expect(FUENTE).toMatch(/hidden text-foreground-soft lg:block/)
  })

  it('la fila del carrito lleva role="row", lg:contents y group para el hover de escritorio', () => {
    expect(FUENTE).toContain(
      'className="group relative flex flex-col gap-2 border-b p-[11px] px-[14px] last:border-b-0 lg:contents"',
    )
  })

  it('la fila tiene 5 celdas con role="cell", tantas como columnheader', () => {
    const columnas = [...FUENTE.matchAll(/role="columnheader"/g)].length
    const celdas = [...FUENTE.matchAll(/role="cell"/g)].length
    expect(columnas, 'Artículo, Cantidad, Precio, Subtotal y Quitar').toBe(5)
    expect(celdas, 'una celda de datos por columna, escrita una sola vez en el .map').toBe(5)
  })

  // Mismo mecanismo que /ventas: `display:contents` no genera caja pero
  // sigue en la cadena de ancestros para :hover, así que `group` en la fila
  // + `lg:group-hover:bg-muted/50` en cada celda restituye el resaltado que
  // antes daba gratis `hover:bg-muted/50` de <TableRow>. Sin el prefijo
  // `lg:` el resaltado se dispararía también en el teléfono.
  it('el hover de escritorio: group-hover siempre con el prefijo lg:, una vez por celda', () => {
    const total = [...FUENTE.matchAll(/group-hover:bg-muted\/50/g)].length
    const conPrefijo = [...FUENTE.matchAll(/lg:group-hover:bg-muted\/50/g)].length
    expect(total, 'una celda de datos por columna: Artículo, Cantidad, Precio, Subtotal, Quitar').toBe(5)
    expect(conPrefijo, 'group-hover sin lg: dispararía el resaltado también en el teléfono').toBe(total)
  })

  // El agrupador que junta Cantidad, Precio (oculto ahí) y Subtotal en una
  // sola línea del teléfono; disuelto en escritorio.
  it('cantidad y subtotal se agrupan en una línea del teléfono, y se disuelven en escritorio', () => {
    expect(FUENTE).toContain('className="flex items-center gap-[10px] lg:contents"')
  })

  // "Quitar" es la última columna en escritorio, pero en el teléfono tiene
  // que convivir con el NOMBRE (la primera columna) en la misma línea —lejos
  // en el DOM, con Cantidad/Precio/Subtotal en el medio. No se resuelve
  // agrupando (no son columnas adyacentes): se ancla con `absolute` al
  // padding del ítem, independiente de dónde cae en el flujo normal.
  it('"Quitar" se ancla arriba a la derecha en el teléfono, y es celda de grid normal en escritorio', () => {
    expect(FUENTE).toMatch(/role="cell"\s+className="absolute top-\[11px\] right-\[14px\] lg:static/)
  })

  // Ronda de arreglos 1 (Importante 2): sin esto, en escritorio el contenido
  // de las 4 celdas más cortas (Cantidad, Precio, Subtotal, Quitar) quedaría
  // pegado arriba de la fila en vez de centrado contra ella cuando el nombre
  // del artículo ocupa dos líneas — lo que antes daba gratis `align-middle`
  // de <TableCell>, que `display:contents` no tiene forma de heredar.
  //
  // La primera versión de este arreglo usaba `lg:self-center` en la CELDA —
  // la review encontró que eso la achica a su contenido y la despega del
  // fondo real de la fila, así que su propio `border-b` (más abajo) quedaba
  // flotando a mitad de camino en vez de alinear con el de las demás. La
  // celda se queda estirada (el default de Grid); quien centra es un
  // envoltorio interno con `lg:flex lg:h-full lg:items-center` — el
  // `h-full` resuelve al 100% de la celda estirada.
  it('las celdas más cortas se centran con un envoltorio interno, no achicando la celda', () => {
    const envoltorios = [...FUENTE.matchAll(/lg:flex lg:h-full lg:items-center/g)].length
    expect(envoltorios, 'Cantidad, Precio, Subtotal y Quitar: las 4 celdas más cortas que Artículo').toBe(4)
    expect(FUENTE, 'self-center desalinearía el borde inferior del resto de la fila').not.toContain('self-center')
  })

  // Ronda de arreglos 1 (Importante 1): `border-b`/`last:border-b-0` en la
  // FILA no pintan nada en escritorio (`display:contents` no genera caja).
  // Cada celda lleva su propio `lg:border-b`, y `lg:group-last:border-b-0`
  // apaga el de la ÚLTIMA fila — la fila sigue en el DOM aunque no pinte,
  // así que el selector `:last-child` de `group-last` la sigue encontrando.
  it('el borde entre filas vive en cada celda, no sólo en la fila (escritorio)', () => {
    // SIN_COMENTARIOS y no FUENTE: el comentario de la fila (más arriba en
    // el archivo) nombra `lg:border-b` en prosa para explicar la decisión, y
    // eso también matchea la clase — mismo motivo que ya documenta
    // SIN_COMENTARIOS más arriba en este archivo.
    const conBorde = [...SIN_COMENTARIOS.matchAll(/lg:border-b\b/g)].length
    const conGroupLast = [...SIN_COMENTARIOS.matchAll(/lg:group-last:border-b-0/g)].length
    expect(conBorde, 'una por columna: Artículo, Cantidad, Precio, Subtotal, Quitar').toBe(5)
    expect(conGroupLast, 'las 5 celdas apagan su borde en la última fila').toBe(5)
  })

  // Ronda de arreglos 1 (Menor 3): <TableRow> traía `transition-colors` de
  // fábrica; al mudar el hover a cada celda (Task 4b) se copió el color pero
  // no la transición, así que el resaltado aparecía de golpe en vez de
  // fundirse.
  it('el hover funde el color: transition-colors en cada celda', () => {
    const veces = [...FUENTE.matchAll(/lg:transition-colors/g)].length
    expect(veces, 'una por columna: Artículo, Cantidad, Precio, Subtotal, Quitar').toBe(5)
  })
})
