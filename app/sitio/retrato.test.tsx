import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { formatearPrecio, formatearCantidad, montoSinSigno } from '@/lib/formato/mostrar'
import { Retrato, RetratoMovil, TOTAL, ARTICULOS, UNIDADES, ITEMS } from './retrato'
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
    //
    // Acotado a `Retrato` (hasta donde empieza `RetratoMovil`, Task 11 del
    // ciclo móvil): éste comparte el mismo archivo y el mismo rol Importe,
    // con su propio conteo en la describe de RetratoMovil más abajo — sumar
    // los dos acá los desincronizaría en cuanto uno de los dos cambie.
    const bloqueRetrato = src.slice(0, src.indexOf('export function RetratoMovil'))
    expect(bloqueRetrato.match(/estilos\.importe/g)).toHaveLength(3)
    expect(bloqueRetrato.match(/estilos\.signo/g)).toHaveLength(1)
    expect(bloqueRetrato.match(/estilos\.total\b/g)).toHaveLength(1)
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

  // I7 de la review final: el plan (Task 3) enumera SEIS piezas que el
  // retrato tiene que mostrar, y las dos de acá no tenían ninguna aserción.
  // Comprobado con la misma mutación que usó el reviewer: reemplazar el
  // stepper por un <span> de texto plano (el carrito ANTERIOR al rediseño,
  // que es literalmente el defecto que esta task existía para arreglar)
  // ponía los 10 casos viejos en verde. Éstos, no.
  it('el stepper existe: un ícono minus y uno plus por línea, no un <span> de texto plano', () => {
    const markup = html()
    expect(markup.match(/lucide-minus /g) ?? []).toHaveLength(ITEMS.length)
    expect(markup.match(/lucide-plus /g) ?? []).toHaveLength(ITEMS.length)
  })

  it('el encabezado hundido: <TableHeader> con sus cuatro rótulos en 10px/700', () => {
    const markup = html()
    expect(markup).toContain('<thead')
    for (const rotulo of ['Artículo', 'Cantidad', 'Precio', 'Subtotal']) {
      // El rótulo tiene que estar DENTRO de un <th> con el par de clases que
      // paga el rol: buscar el texto suelto en cualquier lado del documento
      // no distinguiría un encabezado hundido de un rótulo puesto en
      // cualquier otro lugar de la página.
      const pos = markup.indexOf(`>${rotulo}<`)
      expect(pos, `no se encontró el rótulo "${rotulo}"`).toBeGreaterThan(-1)
      const inicioCelda = markup.lastIndexOf('<th', pos)
      const celda = markup.slice(inicioCelda, pos)
      expect(celda).toContain('text-[10px]')
      expect(celda).toContain('font-bold')
    }
  })

  // El acoplamiento que SÍ se puede afirmar sin importar el módulo cliente
  // (arreglo propuesto por la review): comparar las clases de ANCHO de las
  // columnas Cantidad/Precio/Subtotal contra las de /vender, leyendo los DOS
  // fuentes. Detecta la deriva que motivó esta task en primer lugar —el
  // retrato quedándose atrás de un rediseño de /vender— de una forma que las
  // aserciones de arriba, por construcción, no pueden: ésas sólo miran que
  // ESTE archivo sea internamente consistente, no que siga pareciéndose al
  // real.
  //
  // La Task 4b del ciclo móvil movió /vender de <TableHead> a un grid con
  // `lg:grid-cols-[1fr_Npx_Npx_Npx_Npx]` (display:contents, ver el docblock
  // de `Listado` en app/(app)/ventas/page.tsx) — el retrato NO se tocó en esa
  // task (no es una de las diez pantallas de aplicación, ver CLAUDE.md), así
  // que sigue leyendo su propio <TableHead>. Cada lado lee el ancho con la
  // sintaxis que de verdad usa: `anchosDeRetrato` el atributo `w-[…px]` de
  // cada celda, `anchosDeVender` los tres valores centrales del grid-cols
  // (el primero es `1fr`, de Artículo; el último es Quitar, 28px, que acá no
  // se compara porque el retrato tampoco lo suma en este array).
  it('las columnas Cantidad/Precio/Subtotal miden lo mismo que en /vender (acoplamiento real, leyendo los dos fuentes)', () => {
    const fuenteVender = readFileSync(
      path.join(__dirname, '../(app)/vender/punto-de-venta.tsx'),
      'utf8',
    )
    const anchosDeRetrato = (src: string) =>
      [...src.matchAll(/<TableHead className="[^"]*\b(w-\[\d+px\])[^"]*"/g)].map((m) => m[1])
    const anchosDeVender = (src: string) => {
      const m = src.match(/lg:grid-cols-\[1fr_(\d+)px_(\d+)px_(\d+)px_\d+px\]/)
      expect(m, 'grid-cols de /vender no matchea 1fr_Npx_Npx_Npx_Npx').not.toBeNull()
      return [`w-[${m![1]}px]`, `w-[${m![2]}px]`, `w-[${m![3]}px]`]
    }
    const anchosRetrato = anchosDeRetrato(fuente())
    const anchosVender = anchosDeVender(fuenteVender)
    // Tres columnas con ancho fijo en el encabezado: Cantidad, Precio,
    // Subtotal (Artículo y la de "Quitar" no llevan w-[…px]).
    expect(anchosRetrato).toEqual(['w-[104px]', 'w-[110px]', 'w-[130px]'])
    expect(anchosRetrato).toEqual(anchosVender)
  })
  // La aritmética que se rompió de verdad, y que ninguna de las aserciones de
  // arriba podía ver: el retrato copia de /vender los anchos de columna EN
  // PÍXELES, así que sólo se lee bien si el contenedor le da el ancho que la
  // maqueta le da. El `.pen` (nodo `g5k1vK`) mide la Muestra en 720px y el
  // `Carrito real` (`qjo7l`) en 680; la columna del nombre (`FN5bU`) queda en
  // 216. Cuando la landing vivía en un `max-w-5xl` heredado, esa columna
  // terminaba con ~25px útiles y cada artículo se leía una palabra por
  // renglón — la tabla se veía rota sin que nada estuviera roto.
  //
  // Este caso ata las dos puntas leyendo `secciones.tsx`: si alguien angosta
  // el contenedor o ensancha una columna fija, se pone rojo acá y no en una
  // captura de pantalla tres meses después.
  it('el contenedor le deja a la columna del nombre el ancho que pide la maqueta', () => {
    const fuenteSecciones = readFileSync(path.join(__dirname, './secciones.tsx'), 'utf8')

    const anchoMax = fuenteSecciones.match(/max-w-\[(\d+)px\]/)
    const padding = fuenteSecciones.match(/const ANCHO = '[^']*\bpx-(\d+)\b/)
    expect(anchoMax, 'ANCHO dejó de declarar un max-w en píxeles').not.toBeNull()
    expect(padding, 'ANCHO dejó de declarar un px-N').not.toBeNull()
    // Tailwind: px-N son N × 4px, a cada lado.
    const contenido = Number(anchoMax![1]) - Number(padding![1]) * 4 * 2
    expect(contenido).toBe(1328) // las secciones del .pen miden 1328

    // El Hero reparte ese ancho 7:9 (560:720 en el .pen) con 48px de gap.
    // Task 11 del ciclo móvil migró este breakpoint de md: a lg:.
    const proporcion = fuenteSecciones.match(/lg:grid-cols-\[(\d+)fr_(\d+)fr\]/)
    expect(proporcion, 'el Hero dejó de repartirse en fr').not.toBeNull()
    const [izq, der] = [Number(proporcion![1]), Number(proporcion![2])]
    const muestra = ((contenido - 48) * der) / (izq + der)
    expect(Math.round(muestra)).toBe(720)

    // La Muestra lleva p-5 (20px por lado) y la card, 1px de borde por lado.
    const tabla = muestra - 20 * 2 - 1 * 2
    // Las tres columnas fijas más la de "Quitar" (w-7 = 28px).
    const fijas = [...fuente().matchAll(/<TableHead className="[^"]*\bw-\[(\d+)px\][^"]*"/g)]
      .reduce((total, m) => total + Number(m[1]), 28)
    const nombre = tabla - fijas
    // 216 es lo que pide el .pen; el margen absorbe el borde y el redondeo.
    expect(nombre).toBeGreaterThanOrEqual(216)
  })
})

/**
 * `RetratoMovil` — Task 11 del ciclo móvil (design/arandano.pen, frame
 * `Móvil / Sitio · Landing`, nodo `TVNp5`, "Carrito real" dentro de
 * `Muestra`). El teléfono no colapsa la tabla de `Retrato`: la REDIBUJA como
 * una lista de cards, una por ítem, con el mismo dato (`ITEMS`/`TOTAL`/…) que
 * el desktop — mismo criterio que ya exige `retrato.test.tsx` para `Retrato`:
 * los números salen del formateo real, no de un string a mano.
 */
describe('RetratoMovil — el carrito en cards del teléfono', () => {
  const htmlMovil = () => renderToStaticMarkup(<RetratoMovil />)

  it('muestra "Carrito" y "Vaciar" en el encabezado (nodo CQoIR)', () => {
    expect(htmlMovil()).toContain('Carrito')
    expect(htmlMovil()).toContain('Vaciar')
  })

  it('los precios y subtotales de cada línea salen del formateo real', () => {
    const markup = htmlMovil()
    for (const item of ITEMS) {
      expect(markup).toContain(formatearPrecio(item.precio))
      expect(markup).toContain(formatearPrecio(item.subtotal))
    }
  })

  it('la cantidad de cada línea sale de formatearCantidad', () => {
    const markup = htmlMovil()
    for (const item of ITEMS) {
      expect(markup).toContain(formatearCantidad(item.cantidad))
    }
  })

  it('el total de la banda usa el mismo formateo, sin el signo', () => {
    expect(htmlMovil()).toContain(montoSinSigno(formatearPrecio(TOTAL)))
  })

  it('el resumen "N artículos · N unidades" coincide con las líneas reales', () => {
    const markup = htmlMovil()
    expect(markup).toContain(`${ARTICULOS} artículos · ${UNIDADES} unidades`)
  })

  it('un servicio (sin SKU) muestra "Servicio" en vez de un código', () => {
    expect(htmlMovil()).toContain('Servicio')
  })

  // El aviso es más corto acá ("sin stock", nodo RnB2Y) que en Retrato ("sin
  // stock suficiente"): son textos DISTINTOS a propósito, así que el conteo
  // de "sin stock suficiente" que hace retrato.test.tsx contra <Retrato />
  // sigue en 1 aunque las dos versiones convivan en la misma página.
  it('el aviso de stock dice "sin stock" (más corto que en Retrato), en la línea marcada', () => {
    const markup = htmlMovil()
    const apariciones = markup.match(/sin stock\b/g) ?? []
    expect(apariciones).toHaveLength(1)
    expect(markup).not.toContain('sin stock suficiente')
  })

  it('el stepper existe: un ícono minus y uno plus por línea', () => {
    const markup = htmlMovil()
    expect(markup.match(/lucide-minus /g) ?? []).toHaveLength(ITEMS.length)
    expect(markup.match(/lucide-plus /g) ?? []).toHaveLength(ITEMS.length)
  })

  it('el ícono de quitar (x) existe una vez por línea', () => {
    const markup = htmlMovil()
    expect(markup.match(/lucide-x /g) ?? []).toHaveLength(ITEMS.length)
  })

  it('no es interactivo: es una imagen del producto, no el producto', () => {
    const markup = htmlMovil()
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('<input')
  })

  it('los precios, la cantidad y el total pagan el rol Importe (components/importe.module.css)', () => {
    const src = fuente()
    const bloque = src.slice(src.indexOf('export function RetratoMovil'))
    expect(bloque, 'no se encontró RetratoMovil en el fuente').toBeTruthy()
    // Cantidad y Subtotal (Precio no tiene celda propia en el teléfono: va
    // pegado al SKU en la Meta, sin el rol Importe — mismo criterio que ya
    // usa la fila del teléfono de /vender).
    expect(bloque.match(/estilos\.importe/g)).toHaveLength(2)
    expect(bloque.match(/estilos\.signo/g)).toHaveLength(1)
    expect(bloque.match(/estilos\.total\b/g)).toHaveLength(1)
  })
})
