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
import { GraficoDeMedios } from './grafico'
import type { Composicion, MonedaElegida } from '@/lib/ventas/medios'

// El link de cada opción del selector: en la pantalla real lo arma `page.tsx`
// preservando el resto del query string — acá basta con que sea distinto por
// moneda para poder afirmar sobre el `href`.
const href = (m: MonedaElegida) => `/ventas?moneda=${m}`

const CUATRO_MEDIOS: Composicion = {
  barras: [
    { medio: 'EFECTIVO', monto: '612400' },
    { medio: 'TRANSFERENCIA', monto: '389700' },
    { medio: 'TARJETA_DEBITO', monto: '182400' },
    { medio: 'TARJETA_CREDITO', monto: '100000' },
  ],
  total: '1284500',
}

const UN_MEDIO_ARS: Composicion = { barras: [{ medio: 'EFECTIVO', monto: '90000' }], total: '90000' }
const UN_MEDIO_USD: Composicion = { barras: [{ medio: 'EFECTIVO', monto: '10' }], total: '10' }

describe('GraficoDeMedios: un solo importe, en la moneda de la pila que recibe', () => {
  it('con moneda "ars" formatea en pesos', () => {
    // Sin dólares en el período (hayDolares={false}): sin esto el propio
    // selector dibuja el rótulo "US$", y el `not.toContain` de abajo
    // confundiría ESO con la barra formateando mal.
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={UN_MEDIO_ARS} hayDolares={false} moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).toContain('90.000,00')
    expect(html).not.toContain('US$')
  })

  // El caso del arreglo, visto desde el componente: la pila de dólares ya
  // viene sin convertir desde `componerPorMedio` —acá sólo se verifica que el
  // componente la formatea con `formatearDolares` y no con `formatearPrecio`.
  it('con moneda "usd" formatea en dólares, sin convertir', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={UN_MEDIO_USD} hayDolares moneda="usd" hrefDeMoneda={href} />,
    )
    // `toMatch` sobre los dos juntos, no dos `toContain` sueltos (Hallazgo 8
    // de la review final del ciclo anterior): el `\s` de en medio tolera el
    // espacio duro (NBSP) que `Intl` mete entre el símbolo y la cifra.
    expect(html).toMatch(/US\$\s*10,00/)
  })

  it('un medio sin pagos no aparece: sólo se dibujan las barras de la composición', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={UN_MEDIO_ARS} hayDolares={false} moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).not.toContain('Débito')
    expect(html).not.toContain('Crédito')
    expect(html).not.toContain('Transferencia')
  })

  // Antes de este ciclo, un medio pagado enteramente en dólares mostraba
  // "$ 0,00" como línea principal de la barra de pesos, con la barra al
  // 100 % — un cero al lado de una barra llena se leía como panel roto. Hoy
  // no hay forma de que eso pase: `componerPorMedio` ya excluye al medio de
  // la pila de pesos si no tuvo NINGÚN pago en pesos (ver
  // lib/ventas/composicion.test.ts, "un medio sin un solo pago en esa moneda
  // no aparece en esa pila"), así que este componente nunca recibe una barra
  // en cero para ese medio: directamente no está en la lista.
  it('un medio que sólo cobró en dólares no aparece en la pila de pesos', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={{ barras: [], total: '0' }} hayDolares moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).not.toContain('Efectivo')
    expect(html).not.toContain('$ 0,00')
  })
})

describe('GraficoDeMedios: el selector $ / US$', () => {
  it('no aparece si no hubo dólares en el período', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={CUATRO_MEDIOS} hayDolares={false} moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).not.toContain('US$')
  })

  it('aparece si hubo dólares, con la moneda activa marcada', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={CUATRO_MEDIOS} hayDolares moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).toContain('US$')
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('/ventas?moneda=usd')
  })

  it('son dos links, no un control de cliente: funciona sin JavaScript', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={CUATRO_MEDIOS} hayDolares moneda="usd" hrefDeMoneda={href} />,
    )
    expect(html.match(/<a /g)).toHaveLength(2)
  })
})

// Que el segundo argumento no se agregue y se olvide de pasar: GraficoDeMedios
// tiene que llamarlo con `Number(total)`, el de `composicion` — no con nada
// recalculado a mano. Leer el fuente porque el propio método (resto mayor)
// no puede ejercitarse con un total que difiera de la suma de sus valores
// (ver lib/ventas/porcentajes.test.ts), así que no hay forma de afirmar esto
// vía input/output sin salirse de lo que el método soporta.
describe('GraficoDeMedios no re-suma el total en float', () => {
  it('llama a porcentajesQueSuman100 con el total ya exacto de la composición', () => {
    const fuente = readFileSync('app/(app)/ventas/grafico.tsx', 'utf8')
    expect(fuente).toContain(
      'porcentajesQueSuman100(barras.map((b) => Number(b.monto)), Number(total))',
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
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={CUATRO_MEDIOS} hayDolares={false} moneda="ars" hrefDeMoneda={href} />,
    )
    const bloques = bloquesDeBarra(html)
    expect(bloques).toHaveLength(4)

    // El mismo orden que declara CUATRO_MEDIOS (48/30/14/8, ver
    // lib/ventas/porcentajes.test.ts). Si `barras[barras.length - 1 - i]`
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
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={UN_MEDIO_ARS} hayDolares={false} moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).not.toContain('EFECTIVO')
  })

  it('la nota dice que nada se convierte entre monedas', () => {
    const html = renderToStaticMarkup(
      <GraficoDeMedios composicion={UN_MEDIO_ARS} hayDolares={false} moneda="ars" hrefDeMoneda={href} />,
    )
    expect(html).toContain('Cada moneda dice su propio número.')
    expect(html).toContain(
      'Nada se convierte: no hay tipo de cambio guardado en una venta cobrada en dólares.',
    )
  })
})
