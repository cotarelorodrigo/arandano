import { describe, it, expect } from 'vitest'
import { numeroDeOrden, condicionesDeBusqueda, filtroDelTablero, NUMERO_MAXIMO } from './buscar'
import { ABIERTOS } from './estados'

// Sin base a propósito: lo que se prueba es qué texto se convierte en un
// candidato a `numero` y qué texto no. El caso que rompía el tablero era un
// IMEI, o sea un string, no una fila.

describe('qué texto es un número de orden', () => {
  it('acepta el número que alguien tipea', () => {
    expect(numeroDeOrden('42')).toBe(42)
    expect(numeroDeOrden('1')).toBe(1)
    // Con ceros adelante sigue siendo la orden 42: el buscador no es un parser
    // estricto, es una caja de texto en un mostrador.
    expect(numeroDeOrden('0042')).toBe(42)
  })

  it('NO acepta un IMEI: es lo que tiraba abajo la pantalla', () => {
    // 15 dígitos, ~166.000 veces el techo de un int4. Prisma lo rechaza con un
    // error crudo, y en un server component eso es un 500. El sembrador de dev
    // escribe IMEIs exactamente así.
    expect(numeroDeOrden('358240051111110')).toBeNull()
  })

  it('NO acepta el primer entero que no entra en un int4', () => {
    expect(numeroDeOrden(String(NUMERO_MAXIMO))).toBe(NUMERO_MAXIMO)
    expect(numeroDeOrden(String(NUMERO_MAXIMO + 1))).toBeNull()
    // El caso que el regex solo dejaba pasar: once dígitos, forma de número.
    expect(numeroDeOrden('99999999999')).toBeNull()
  })

  it('NO acepta lo que Number.isInteger aceptaba y nadie tipea', () => {
    // La otra mitad: sin el regex, todo esto llegaba a la consulta.
    for (const raro of ['1e3', '0x10', ' 42 ', 'Infinity', '-1', '4.0', '', '  ']) {
      expect(numeroDeOrden(raro), raro).toBeNull()
    }
  })
})

describe('las condiciones del buscador', () => {
  it('busca por texto en modelo, marca, IMEI y cliente', () => {
    const c = condicionesDeBusqueda('samsung')
    expect(c).toHaveLength(4)
    expect(JSON.stringify(c)).toContain('samsung')
  })

  it('agrega el número sólo cuando el texto es un número usable', () => {
    expect(condicionesDeBusqueda('42')).toContainEqual({ numero: 42 })
    // El IMEI se sigue buscando como texto contra equipoSerie, que es donde
    // efectivamente está guardado: lo que se cae es el candidato a `numero`.
    const porImei = condicionesDeBusqueda('358240051111110')
    expect(porImei).toHaveLength(4)
    expect(JSON.stringify(porImei)).toContain('358240051111110')
  })
})

describe('qué muestra el tablero', () => {
  it('sin búsqueda ni chip, sólo las abiertas y vivas', () => {
    // El default del spec, que no cambia: el tablero es la lista de lo que
    // sigue en el local.
    expect(filtroDelTablero('', null)).toEqual({
      anuladaEn: null,
      estado: { in: [...ABIERTOS] },
    })
  })

  it('buscando sin chip, alcanza a las entregadas y a las anuladas', () => {
    // El defecto que esto cierra: entregar un equipo lo volvía imposible de
    // encontrar por número, por cliente o por IMEI, y el grafo permite
    // ENTREGADO → EN_REPARACION justamente para la garantía. Una anulada es lo
    // mismo: sigue siendo algo por lo que alguien pregunta.
    const donde = filtroDelTablero('42', null)
    expect(donde.estado).toBeUndefined()
    expect(donde.anuladaEn).toBeUndefined()
    expect(donde.OR).toContainEqual({ numero: 42 })
  })

  it('el chip sí acota, con o sin texto en el buscador', () => {
    // Un chip es una elección explícita, no un default: pedir "Listo" es pedir
    // lo que está listo y no anulado.
    expect(filtroDelTablero('', 'LISTO')).toEqual({
      anuladaEn: null,
      estado: { equals: 'LISTO' },
    })
    const conTexto = filtroDelTablero('samsung', 'ENTREGADO')
    expect(conTexto.estado).toEqual({ equals: 'ENTREGADO' })
    expect(conTexto.anuladaEn).toBeNull()
    expect(conTexto.OR).toHaveLength(4)
  })

  it('el IMEI tampoco llega como número por el camino del tablero', () => {
    // La otra mitad del hallazgo del buscador, medida por donde el tablero la
    // usa de verdad: la búsqueda amplia habría sido un 500 más ancho.
    const donde = filtroDelTablero('358240051111110', null)
    expect(JSON.stringify(donde.OR)).not.toContain('"numero"')
  })
})
