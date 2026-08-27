import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearPrecio } from '@/lib/formato/mostrar'
import type { PlanVisible } from '@/lib/planes/consultar'

// Las dos funciones que el componente importa viven en un archivo 'use server'.
// Su contrato ya lo fija app/(app)/vender/acciones.test.ts; acá sólo importa qué
// renderiza la pantalla, así que se mockean.
vi.mock('./acciones', () => ({
  cobrar: vi.fn(),
  buscarArticulos: vi.fn(async () => []),
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

async function render({ planes = [] }: { planes?: PlanVisible[] } = {}) {
  const { PuntoDeVenta } = await import('./punto-de-venta')
  return renderToStaticMarkup(<PuntoDeVenta cotizacionInicial={null} planes={planes} />)
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
  // `lineasDelPieDeCobro`, no de tres bloques escritos a mano—.
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
        `chip de Faltante/Sobrante, el renglón "Entran $X", y el monto de cada ` +
        `línea del pie del cobro.`,
    ).toBe(9)
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
    const posicion = fuente.indexOf('>Entran<')
    expect(posicion, 'el rótulo "Entran" tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(posicion, posicion + 300)
    expect(
      contexto,
      'el renglón "Entran $X" tiene que guardarse contra NaN, igual que el resto de la plata de la pantalla',
    ).toMatch(/Number\.isNaN\(pesosDelPagoCentavos\)\s*\?\s*'—'/)
  })

  // El mismo defecto preexistente, del otro lado del cálculo: "Agregar pago"
  // precargaba el campo Monto de la fila nueva con `deCentavos(NaN)` —el
  // string literal "NaN.NaN"— en cuanto una línea del carrito quedaba
  // inválida (`faltanCentavos` se calcula sobre `totalCentavos`, que es NaN
  // ahí). Vacío es la salida honesta, mismo criterio que ya usa el resto del
  // archivo para "no se puede calcular": no inventar un cero ni un NaN.
  it('"Agregar pago" no precarga el monto con NaN cuando el carrito tiene una línea inválida', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const posicion = fuente.indexOf('Agregar pago')
    expect(posicion, '"Agregar pago" tiene que existir en el fuente').toBeGreaterThan(-1)
    const contexto = fuente.slice(Math.max(0, posicion - 700), posicion)
    expect(
      contexto,
      'el monto precargado tiene que guardarse contra faltanCentavos en NaN',
    ).toMatch(/Number\.isNaN\(faltanCentavos\)\s*\?\s*''\s*:\s*deCentavos\(Math\.max\(0, faltanCentavos\)\)/)
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
    expect(fuente).toMatch(/const hayFaltante = hayFaltanteDeVenta\(faltanCentavos\)/)
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
    const contexto = fuente.slice(posicion, posicion + 200)
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
      [{ base: '10000', cotizacion: '1', planId: PLAN_CREDITO.id }],
      [PLAN_CREDITO],
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
      [{ base: '10000', cotizacion: '1', planId: PLAN_CONTADO.id }],
      [PLAN_CONTADO],
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
      [{ base: '10000', cotizacion: '1', planId: PLAN_CREDITO.id }],
      [PLAN_CREDITO],
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
        { base: '5000', cotizacion: '1', planId: PLAN_CREDITO.id },
        { base: '5000', cotizacion: '1', planId: PLAN_CONTADO.id },
      ],
      [PLAN_CREDITO, PLAN_CONTADO],
    )
    expect(netoPositivo[1]).toEqual({ rotulo: 'Recargo', monto: formatearPrecio('1500') })

    // 40 % de 1.000 = 400, −10 % de 9.000 = −900 → neto −500.
    const netoNegativo = lineasDelPieDeCobro(
      1_000_000,
      [
        { base: '1000', cotizacion: '1', planId: PLAN_CREDITO.id },
        { base: '9000', cotizacion: '1', planId: PLAN_CONTADO.id },
      ],
      [PLAN_CREDITO, PLAN_CONTADO],
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
      lineasDelPieDeCobro(1_000_000, [{ base: '10000', cotizacion: '1', planId: null }], [PLAN_CREDITO]),
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
      [{ base: '', cotizacion: '1', planId: PLAN_CREDITO.id }],
      [PLAN_CREDITO],
    )
    expect(conMontoRoto.map((l) => l.monto)).toEqual([formatearPrecio('10000'), '—', '—'])

    const conCarritoRoto = lineasDelPieDeCobro(
      NaN,
      [{ base: '10000', cotizacion: '1', planId: PLAN_CREDITO.id }],
      [PLAN_CREDITO],
    )
    expect(conCarritoRoto.map((l) => l.monto)).toEqual(['—', formatearPrecio('4000'), '—'])
  })

  // Cableado del pie: la mercadería que muestra tiene que ser el MISMO
  // `totalCentavos` que pinta la banda de --marca, y las líneas tienen que
  // salir de la función y no de tres bloques de JSX con su propia cuenta.
  // El agujero que encontró la revisión de esta task: con `lineasDelPie.map(`
  // exigido a secas, cambiar el guard del JSX a `{false && (` dejaba los 45
  // casos en verde con el pie BORRADO de la pantalla — ninguno lo reclamaba,
  // porque el harness no puede montar un carrito con plan y el `.map` seguía
  // escrito ahí adentro. Por eso el guard y el `.map` se exigen juntos y EN
  // ORDEN, con `[\s\S]*?` entre medio: es la misma corrección que ya se le
  // había hecho al caso de las guardas de Enter, más arriba.
  it('el pie del cobro sale de lineasDelPieDeCobro sobre el total del carrito', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/const lineasDelPie = lineasDelPieDeCobro\(totalCentavos, pagos, planes\)/)
    expect(
      fuente,
      'el pie tiene que dibujarse cuando lineasDelPie tiene líneas, mapeando ESA lista',
    ).toMatch(/\{lineasDelPie\.length > 0 && \([\s\S]*?lineasDelPie\.map\(/)
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
  it('el faltante se mide contra la mercadería, no contra lo cobrado', () => {
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    const desde = fuente.indexOf('const pagadoCentavos = totalDePagosEnCentavos(')
    const hasta = fuente.indexOf('const hayFaltante = hayFaltanteDeVenta(')
    expect(desde, 'el cálculo de lo pagado tiene que existir en el fuente').toBeGreaterThan(-1)
    expect(hasta, 'el cálculo del faltante tiene que existir en el fuente').toBeGreaterThan(desde)
    const bloque = fuente.slice(desde, hasta)
    expect(bloque).toMatch(/const faltanCentavos = totalCentavos - pagadoCentavos/)
    expect(bloque).toMatch(/const cierra = hayCarrito && faltanCentavos === 0/)
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
})
