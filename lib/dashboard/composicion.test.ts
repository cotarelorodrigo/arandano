import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import {
  agruparPorArticulo, repartirEnGajos, topDeArticulos, gajoMasGrande, MAX_GAJOS, TOP_DE_ARTICULOS,
  ROTULO_OTROS, ROTULO_OTROS_AGRUPADO,
} from './composicion'

const d = (v: string) => new Prisma.Decimal(v)
const fila = (articuloId: string, precio: string, cantidad: string, moneda: 'ARS' | 'USD' = 'ARS') =>
  ({ articuloId, precioUnitario: d(precio), moneda, _sum: { cantidad: d(cantidad) } })

describe('el importe sale del precio en la CLAVE del groupBy', () => {
  // El precio va en la clave y no en un _sum por lo mismo que documenta
  // FilaDePagos: es lo que mantiene el redondeo por grupo y hace que la suma
  // cierre contra los tiles. Un artículo que cambió de precio a mitad de mes
  // llega en dos filas.
  it('suma las filas del mismo artículo a precios distintos', () => {
    const r = agruparPorArticulo(
      [fila('a', '1000', '3'), fila('a', '1200', '2')], 'ars',
    )
    expect(r).toEqual([{ articuloId: 'a', unidades: d('5'), importe: d('5400') }])
  })

  it('descarta lo que no está en la moneda elegida', () => {
    const r = agruparPorArticulo([fila('a', '1000', '1'), fila('b', '300', '1', 'USD')], 'ars')
    expect(r.map((x) => x.articuloId)).toEqual(['a'])
    expect(agruparPorArticulo([fila('a', '1000', '1'), fila('b', '300', '1', 'USD')], 'usd')
      .map((x) => x.articuloId)).toEqual(['b'])
  })

  // Prisma devuelve `_sum: { cantidad: null }` para un grupo vacío; sin la
  // guarda eso explota al construir el Decimal.
  it('un grupo sin cantidad no rompe', () => {
    const r = agruparPorArticulo([{ ...fila('a', '1000', '0'), _sum: { cantidad: null } }], 'ars')
    expect(r).toEqual([])
  })

  it('ordena de mayor a menor importe', () => {
    const r = agruparPorArticulo([fila('a', '100', '1'), fila('b', '900', '1')], 'ars')
    expect(r.map((x) => x.articuloId)).toEqual(['b', 'a'])
  })
})

describe('el anillo agrupa la cola en Otros', () => {
  const cat = (rotulo: string, importe: string) => ({ rotulo, importe: d(importe) })

  it('con más de cinco ramas, la quinta es la suma del resto', () => {
    const g = repartirEnGajos([
      cat('Celulares', '4400'), cat('Servicio técnico', '1900'), cat('Fundas', '1400'),
      cat('Cables', '1200'), cat('Vidrios', '700'), cat('Cargadores', '400'),
    ])
    expect(g).toHaveLength(MAX_GAJOS)
    expect(g[4]).toEqual({ rotulo: 'Otros', importe: d('1100') })
  })

  it('con cinco o menos, ninguna se agrupa', () => {
    const g = repartirEnGajos([cat('Celulares', '4400'), cat('Cables', '1200')])
    expect(g.map((x) => x.rotulo)).toEqual(['Celulares', 'Cables'])
  })

  // Caso de borde, no de colisión: con exactamente seis ramas (una más que el
  // máximo) alcanza para disparar la agrupación, y la cola es sólo la última.
  // Las fixtures 'a'..'f' no tocan la colisión con una rama real "Otros" —esa
  // vive en las dos `it` de más abajo, con su propio comentario.
  it('exactamente seis ramas dejan una sola en Otros', () => {
    const g = repartirEnGajos([
      cat('a', '6'), cat('b', '5'), cat('c', '4'), cat('d', '3'), cat('e', '2'), cat('f', '1'),
    ])
    expect(g[4]).toEqual({ rotulo: 'Otros', importe: d('3') })
  })

  it('sin nada vendido no hay gajos', () => {
    expect(repartirEnGajos([])).toEqual([])
  })

  // "Otros" existente y "Otros" agrupado son dos cosas distintas, y sumarlas
  // en un solo gajo —o dejar que se muestren dos con el mismo nombre— sería
  // mentir sobre una rama que el local nombró así (Ruling N de la review de
  // la Task 9). Colisionan de dos formas: la rama real puede quedar DENTRO
  // del top, o puede caer en la cola — las dos están cubiertas.
  it('una rama real llamada "Otros" en el top no se confunde con el agregado', () => {
    const g = repartirEnGajos([
      cat('Otros', '5000'), cat('Celulares', '4400'), cat('Fundas', '1400'),
      cat('Cables', '1200'), cat('Vidrios', '700'), cat('Cargadores', '400'),
    ])
    expect(g).toHaveLength(MAX_GAJOS)
    // La rama real, intacta, en su lugar del top.
    expect(g[0]).toEqual({ rotulo: 'Otros', importe: d('5000') })
    // El agregado toma un rótulo DISTINTO: dos gajos "Otros" con importes
    // distintos serían indistinguibles para quien mira el anillo.
    expect(g[4]).toEqual({ rotulo: ROTULO_OTROS_AGRUPADO, importe: d('1100') })
  })

  it('una rama real llamada "Otros" en la cola no se funde en silencio con el agregado', () => {
    const g = repartirEnGajos([
      cat('Celulares', '4400'), cat('Servicio técnico', '1900'), cat('Fundas', '1400'),
      cat('Cables', '1200'), cat('Otros', '700'), cat('Cargadores', '400'),
    ])
    expect(g).toHaveLength(MAX_GAJOS)
    // La rama real cayó en la cola —correcto, es "todo lo demás"—, pero el
    // agregado no puede llamarse igual que ella: si lo hiciera, quien lee el
    // anillo no tendría forma de saber que ahí adentro hay una rama que el
    // local nombró "Otros".
    expect(g[4]).toEqual({ rotulo: ROTULO_OTROS_AGRUPADO, importe: d('1100') })
    expect(g.map((x) => x.rotulo)).not.toContain(ROTULO_OTROS)
  })
})

describe('el top de artículos', () => {
  const nombres = new Map([['a', 'iPhone 13 128 GB'], ['b', 'Cambio de módulo']])
  const vendido = [
    { articuloId: 'a', unidades: d('12'), importe: d('2964000') },
    { articuloId: 'b', unidades: d('31'), importe: d('1612000') },
  ]

  it('el ancho de cada barra es el porcentaje del PRIMERO, no del total', () => {
    const t = topDeArticulos(vendido, nombres)
    expect(t[0].ancho).toBe(100)
    expect(t[1].ancho).toBe(54) // 1.612.000 / 2.964.000
  })

  it('corta en cinco', () => {
    const muchos = 'abcdefg'.split('').map((k, i) => ({
      articuloId: k, unidades: d('1'), importe: d(String(100 - i)),
    }))
    expect(topDeArticulos(muchos, new Map())).toHaveLength(TOP_DE_ARTICULOS)
  })

  // Sin esta guarda el ancho sale NaN y React lo escribe crudo en el style.
  it('con el primero en cero ningún ancho divide por cero', () => {
    const t = topDeArticulos([{ articuloId: 'a', unidades: d('1'), importe: d('0') }], nombres)
    expect(t[0].ancho).toBe(0)
  })

  it('un artículo sin nombre conocido no rompe la fila', () => {
    expect(topDeArticulos(vendido, new Map())[0].nombre).toBe('—')
  })
})

describe('el gajo más grande', () => {
  // Minor 3 de la review de Task 11: el gajo "Otros" que agrega
  // repartirEnGajos va al FINAL del array, no reordenado — con muchas ramas
  // chicas puede pesar más que la que quedó primera. Asumir gajos[0] falla
  // exactamente acá.
  it('no es necesariamente el primero de la lista', () => {
    const gajos = [
      { rotulo: 'Celulares', importe: d('1000') },
      { rotulo: ROTULO_OTROS_AGRUPADO, importe: d('4000') },
    ]
    expect(gajoMasGrande(gajos)?.rotulo).toBe(ROTULO_OTROS_AGRUPADO)
  })

  it('con una sola rama, es esa rama', () => {
    const gajos = [{ rotulo: 'Celulares', importe: d('1000') }]
    expect(gajoMasGrande(gajos)?.rotulo).toBe('Celulares')
  })

  it('con la lista vacía no hay gajo más grande', () => {
    expect(gajoMasGrande([])).toBeNull()
  })
})
