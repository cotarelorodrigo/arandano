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

  // El listener de `window` en sí (enganchar keydown, preventDefault, mover
  // el foco de verdad) NO está probado acá: es DOM real y este repo no corre
  // jsdom salvo la excepción puntual de `ticket.test.tsx`. Lo que SÍ se
  // puede probar sin jsdom es la regla pura que decide qué tecla dispara el
  // atajo — y es lo único que un test de este archivo puede afirmar en
  // verdad sin mentir sobre la cobertura.
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
    const { resumenDelCarrito } = await import('./punto-de-venta')
    expect(resumenDelCarrito(4, 5000)).toBe('4 artículos · 5 unidades')
    expect(resumenDelCarrito(1, 1000)).toBe('1 artículo · 1 unidad')
    expect(resumenDelCarrito(0, 0)).toBe('0 artículos · 0 unidades')
    expect(resumenDelCarrito(2, 2500)).toBe('2 artículos · 2,5 unidades')

    // Cableado: lineas.length para artículos y la suma de cantidadMilesimas
    // para unidades — no al revés, y no un valor fijo. Mismo motivo que el
    // test de PASOS_STEPPER de arriba: la función pura no prueba de dónde
    // salen sus argumentos.
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
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

    // Cableado: FilaDePago tiene que llamarla con pago.monto y
    // pago.cotizacion, ni al revés ni con otra cosa — es justo la clase de
    // bug que una función pura probada sola no atrapa (ver la nota del
    // encargo sobre el stepper).
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/entranPesosCentavos\(pago\.monto,\s*pago\.cotizacion\)/)
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

  // El caso que importa más de lo que parece: vuelto y faltante son estados
  // excluyentes a propósito, y hoy nada lo verificaba. Mostrar "te sobran
  // $X" en UN pago mientras la venta completa sigue corta por OTRO pago le
  // dice al cajero que dé vuelto sobre una venta que en conjunto no cerró.
  it('no muestra vuelto y faltante al mismo tiempo', async () => {
    const { puedeMostrarVuelto } = await import('./punto-de-venta')
    expect(puedeMostrarVuelto(true, true)).toBe(false)
    expect(puedeMostrarVuelto(true, false)).toBe(true)
    expect(puedeMostrarVuelto(false, false)).toBe(false)
    expect(puedeMostrarVuelto(false, true)).toBe(false)

    // Cableado: hayFaltante tiene que salir de faltanCentavos > 0 calculado
    // sobre TODOS los pagos, y viajar como prop a cada fila — no puede nacer
    // adentro de FilaDePago, o dejaría de describir "el conjunto", que es la
    // parte que este caso existe para proteger.
    const fuente = readFileSync('app/(app)/vender/punto-de-venta.tsx', 'utf8')
    expect(fuente).toMatch(/hayFaltante=\{hayFaltante\}/)
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
    expect(fuente).toMatch(/esAtajoDeCobro\(e\.key\)/)
    expect(fuente).toMatch(/if \(!cierra \|\| cobrando\) return/)
    expect(fuente).toMatch(/formularioCobro\.current\?\.requestSubmit\(\)/)
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
})
