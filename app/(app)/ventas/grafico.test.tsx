// Sin '@vitest-environment jsdom': fue el único archivo del repo que lo
// necesitaba, y dejó de necesitarlo con este mismo cambio. La razón vieja era
// que recharts no dibuja nada del lado del servidor —el SVG lo arma el
// cliente después de medir el contenedor—, así que las aserciones sobre las
// barras necesitaban un DOM real. Con las barras reescritas como `Progress`
// de shadcn (un `<div>` con el ancho ya calculado en el servidor), no hay
// nada que medir: `renderToStaticMarkup` alcanza para afirmar todo, igual que
// ya alcanzaba para la tabla accesible de la versión anterior. Si esta
// excepción vuelve a hacer falta algún día, se documenta en los DOS lugares
// otra vez: acá y en vitest.config.mts — a medias es peor que no sacarla,
// porque el próximo lector cree que sigue vigente.
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { GraficoDeMedios, porcentajesQueSuman100 } from './grafico'
import type { Composicion } from '@/lib/ventas/medios'

const CUATRO_MEDIOS: Composicion = {
  barras: [
    { medio: 'EFECTIVO', ars: '612400', usd: '0', usdCrudo: '0', total: '612400' },
    { medio: 'TRANSFERENCIA', ars: '389700', usd: '0', usdCrudo: '0', total: '389700' },
    { medio: 'TARJETA_DEBITO', ars: '182400', usd: '0', usdCrudo: '0', total: '182400' },
    { medio: 'TARJETA_CREDITO', ars: '100000', usd: '0', usdCrudo: '0', total: '100000' },
  ],
  total: '1284500',
  hayDolares: false,
}

const UN_MEDIO: Composicion = {
  barras: [{ medio: 'EFECTIVO', ars: '90000', usd: '12000', usdCrudo: '10', total: '102000' }],
  total: '102000',
  hayDolares: true,
}

describe('porcentajesQueSuman100', () => {
  it('reparte enteros que suman exactamente 100', () => {
    // Los mismos montos que la maqueta (design/arandano.pen, nodo `eyqV3`):
    // 48/30/14/8, que además ya suman 100 con el redondeo ingenuo — el caso
    // de abajo es el que de verdad prueba el método del resto mayor.
    const pcts = porcentajesQueSuman100([612400, 389700, 182400, 100000])
    expect(pcts).toEqual([48, 30, 14, 8])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
  })

  it('también suma 100 cuando el redondeo ingenuo NO daría 100', () => {
    // 1/3 de cada uno: redondeando cada tercio por separado da 33+33+33 = 99,
    // no 100. El resto mayor reparte el punto que falta a una de las tres
    // barras — la prueba de que el método hace algo distinto de
    // Math.round(x) en cada elemento.
    const pcts = porcentajesQueSuman100([1, 1, 1])
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100)
    // Las tres partes son iguales, así que el punto de más cae en cualquiera
    // — lo que importa es que ninguna quede en 0 ni en 34+.
    expect(pcts.every((p) => p === 33 || p === 34)).toBe(true)
  })

  it('sin total no divide por cero', () => {
    expect(porcentajesQueSuman100([0, 0])).toEqual([0, 0])
    expect(porcentajesQueSuman100([])).toEqual([])
  })

  it('un total explícito igual a la suma da el mismo resultado que omitirlo', () => {
    // El caso real (GraficoDeMedios le pasa `Number(composicion.total)`, que
    // en la práctica coincide con la suma de las barras) no puede darse contra
    // valores que no sumen ~el total: el propio método del resto mayor asume
    // que `faltan` (100 menos la suma de los pisos) entra en `valores.length`,
    // así que un total muy distinto de la suma no es un caso que este método
    // sostenga — no es el defecto que este parámetro corrige.
    const valores = [612400, 389700, 182400, 100000]
    const suma = valores.reduce((a, b) => a + b, 0)
    expect(porcentajesQueSuman100(valores, suma)).toEqual(porcentajesQueSuman100(valores))
  })

  it('sin el segundo argumento, sigue sumando los valores (compatibilidad)', () => {
    const pcts = porcentajesQueSuman100([1, 1, 2])
    expect(pcts).toEqual([25, 25, 50])
  })
})

// Que el segundo argumento no se agregue y se olvide de pasar: GraficoDeMedios
// tiene que llamarlo con `Number(total)`, el de `composicion` — no con nada
// recalculado a mano. Leer el fuente porque el propio método (resto mayor)
// no puede ejercitarse con un total que difiera de la suma de sus valores
// (ver el test de arriba), así que no hay forma de afirmar esto vía input/
// output sin salirse de lo que el método soporta.
describe('GraficoDeMedios no re-suma el total en float', () => {
  it('llama a porcentajesQueSuman100 con el total ya exacto de la composición', () => {
    const fuente = readFileSync('app/(app)/ventas/grafico.tsx', 'utf8')
    expect(fuente).toContain(
      'porcentajesQueSuman100(barras.map((b) => Number(b.total)), Number(total))',
    )
  })
})

// El contenedor de UNA barra en grafico.tsx: `<div className="flex flex-col
// gap-[7px]">`, con el rótulo, el monto, el `<Progress>` (que emite el ancho
// como `transform:translateX(-N%)`) y el "X% del total", en ese orden. Cortar
// el HTML por ese marcador es lo que permite afirmar que el monto y el
// porcentaje de CADA medio caen en SU propio bloque, y no sólo en algún lugar
// del documento entero — un `toContain` sobre el HTML completo no distingue
// "el 612.400 está en la fila de Efectivo" de "el 612.400 está en cualquier
// fila", y ésa es la brecha que dejaba pasar dos medios con los índices
// cruzados sin que ningún test lo notara (I2 de la review final).
const MARCADOR_DE_BARRA = '<div class="flex flex-col gap-[7px]">'

function bloquesDeBarra(html: string): string[] {
  return html.split(MARCADOR_DE_BARRA).slice(1)
}

describe('el panel de medios de pago', () => {
  it('cada barra queda con SU rótulo, SU monto, SU ancho y SU porcentaje juntos', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={CUATRO_MEDIOS} />)
    const bloques = bloquesDeBarra(html)
    expect(bloques).toHaveLength(4)

    // El mismo orden que declara CUATRO_MEDIOS (48/30/14/8, ver
    // porcentajesQueSuman100 arriba). Si `barras[barras.length - 1 - i]`
    // volviera a colarse en el monto o en el porcentaje, el monto de
    // Efectivo aparecería en el bloque de Crédito y este `forEach` lo
    // atraparía ahí, no en "algún lugar del HTML".
    const esperado = [
      { rotulo: 'Efectivo', monto: '612.400,00', pct: 48 },
      { rotulo: 'Transferencia', monto: '389.700,00', pct: 30 },
      { rotulo: 'Débito', monto: '182.400,00', pct: 14 },
      { rotulo: 'Crédito', monto: '100.000,00', pct: 8 },
    ]

    esperado.forEach((e, i) => {
      const bloque = bloques[i]
      expect(bloque).toContain(e.rotulo)
      expect(bloque).toContain(e.monto)
      expect(bloque).toContain(`${e.pct}% del total`)
      // El ancho REAL de la barra, no el texto de al lado: `Progress` dibuja
      // `value` como `translateX(-(100 - value)%)`, así que la mutación
      // `value={0}` (las cuatro barras en ancho cero) se ve acá como
      // `-100%` para las cuatro, sin que el texto del porcentaje —que no
      // depende de `value`— delate nada.
      expect(bloque).toContain(`translateX(-${100 - e.pct}%)`)
      // `aria-valuenow`: components/ui/progress.tsx destructura `value` para
      // calcular el ancho y por eso deja de viajar en `...props` hacia
      // `ProgressPrimitive.Root` a menos que se reenvíe a mano — sin eso Radix
      // se queda en su default indeterminado y un lector de pantalla anuncia
      // "cargando", no el porcentaje real.
      expect(bloque).toContain(`aria-valuenow="${e.pct}"`)
    })
  })

  it('rotula los medios en castellano y no con el nombre del enum', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).not.toContain('EFECTIVO')
  })

  it('un medio sin pagos no aparece: sólo se dibujan las barras de la composición', () => {
    // componerPorMedio (lib/ventas/composicion.ts) ya excluye los medios sin
    // un solo pago del período — este caso confirma que el componente no
    // agrega de más: con una sola barra en la composición, "Débito" y
    // "Crédito" no tienen ningún texto en el resultado.
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).not.toContain('Débito')
    expect(html).not.toContain('Crédito')
    expect(html).not.toContain('Transferencia')
  })

  it('muestra los dólares en su propia línea, sin convertir', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    // Los pesos del medio y los dólares que entraron, cada uno con su
    // formateador: US$ 10, no los $ 12.000 en los que se convirtieron.
    expect(html).toContain('90.000,00')
    expect(html).toContain('US$')
    expect(html).toContain('10,00')
    expect(html).not.toContain('12.000,00')
  })

  it('sin dólares, ningún medio muestra una segunda línea', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={CUATRO_MEDIOS} />)
    expect(html).not.toContain('US$')
  })

  it('la nota explica que la barra compara en pesos', () => {
    const html = renderToStaticMarkup(<GraficoDeMedios composicion={UN_MEDIO} />)
    expect(html).toContain('Cada moneda dice su propio número.')
    expect(html).toContain('La barra compara todo en pesos, a la cotización de cada pago.')
  })
})
