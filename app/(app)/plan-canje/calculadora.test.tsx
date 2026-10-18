import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TablaDeCanje } from '@/lib/canje/consultar'

// La action arrastra la sesión y la base: acá sólo importa qué se dibuja.
vi.mock('./acciones', () => ({ buscarEquipos: async () => [] }))

const { Calculadora, PanelDeResultado, BandaDeDiferencia, SinModelos, textoSinCotizacion } = await import(
  './calculadora'
)

const R100 = { id: '00000000-0000-4000-8000-000000000100', minimo: 100, maximo: 100 }
const R85 = { id: '00000000-0000-4000-8000-000000000085', minimo: 85, maximo: 89 }
const R80 = { id: '00000000-0000-4000-8000-000000000080', minimo: 80, maximo: 84 }
const IPHONE_14 = { id: '00000000-0000-4000-8000-0000000000aa', nombre: 'iPhone 14', valores: { [R85.id]: '400', [R100.id]: '520' } }
const TABLA: TablaDeCanje = { moneda: 'USD', rangos: [R100, R85, R80], modelos: [IPHONE_14] }
const IPHONE_16 = { nombre: 'iPhone 16 128 GB', precio: '1000', moneda: 'USD' as const }

function panel(props: Partial<Parameters<typeof PanelDeResultado>[0]> = {}) {
  return renderToStaticMarkup(
    <PanelDeResultado
      tabla={TABLA}
      equipo={IPHONE_16}
      modelo={IPHONE_14}
      bateriaTexto="88"
      dolar=""
      alCambiarDolar={() => {}}
      {...props}
    />,
  )
}

describe('PanelDeResultado', () => {
  // El ejemplo del pedido, de punta a punta en la pantalla.
  it('iPhone 16 a USD 1000 con un iPhone 14 de 88 %: paga US$ 600', () => {
    const html = panel()
    expect(html).toContain('Paga el cliente')
    expect(html).toMatch(/US\$/)
    expect(html).toContain('600,00')
    expect(html).toContain('iPhone 14, 85–89 % de batería')
  })

  it('sin valor para ese rango: el mensaje de sin cotización, no un error', () => {
    const html = panel({ bateriaTexto: '82' })
    expect(html).toContain(textoSinCotizacion('iPhone 14', 82))
    expect(html).toContain('role="status"')
    expect(html).not.toContain('600,00')
  })

  it('una batería en un hueco de los rangos también es sin cotización', () => {
    expect(panel({ bateriaTexto: '50' })).toContain('Sin cotización cargada para un iPhone 14 con 50 % de batería')
  })

  it('el usado vale más: le devolvés al cliente, en positivo', () => {
    const html = panel({ equipo: { ...IPHONE_16, precio: '300' } })
    expect(html).toContain('Le devolvés al cliente')
    expect(html).toContain('100,00')
    expect(html).not.toMatch(/-\s*100,00|−/)
  })

  // Equipo en pesos y tabla en dólares, sin dólar tipeado: no hay
  // diferencia, aparece el campo y se dice por qué.
  it('monedas distintas sin dólar: pide la cotización y no muestra diferencia', () => {
    const html = panel({ equipo: { ...IPHONE_16, precio: '1500000', moneda: 'ARS' } })
    expect(html).toContain('Cotización del dólar')
    expect(html).toContain('Falta la cotización del dólar')
    expect(html).toContain('—')
  })

  it('monedas distintas con dólar: la diferencia en la moneda del equipo', () => {
    const html = panel({ equipo: { ...IPHONE_16, precio: '1500000', moneda: 'ARS' }, dolar: '1250' })
    expect(html).toContain('1.000.000,00')
    expect(html).toContain('El usado en pesos')
    expect(html).toMatch(/a \$\s*1\.250,00 el dólar/)
  })

  // Con la misma moneda el campo no existe: lo tipeado antes no puede mover
  // ninguna cuenta ni confundir a nadie.
  it('con la misma moneda no hay campo del dólar', () => {
    expect(panel()).not.toContain('Cotización del dólar')
  })

  it('sin nada elegido, la banda está igual y dice qué falta', () => {
    const html = panel({ equipo: null, modelo: null, bateriaTexto: '' })
    expect(html).toContain('var(--marca)')
    expect(html).toContain('Elegí el equipo, el usado y la batería.')
  })
})

describe('la banda de --marca', () => {
  // Una sola superficie de marca por pantalla: la de la diferencia.
  it('la calculadora entera tiene UNA sola superficie de --marca', () => {
    const html = renderToStaticMarkup(<Calculadora tabla={TABLA} puedeEditar={false} dolarInicial={null} />)
    expect(html.match(/background-color:var\(--marca\)/g)).toHaveLength(1)
  })

  it('sin resultado, la banda muestra un guion en vez de un cero', () => {
    const html = renderToStaticMarkup(<BandaDeDiferencia resultado={null} />)
    expect(html).toContain('—')
  })
})

describe('Calculadora', () => {
  // Un tenant nuevo, que es lo que barre el smoke: sin rangos ni modelos.
  it('con la tabla vacía renderiza y dice que no hay valores', () => {
    const html = renderToStaticMarkup(
      <Calculadora tabla={{ moneda: 'USD', rangos: [], modelos: [] }} puedeEditar={false} dolarInicial={null} />,
    )
    expect(html).toContain('Todavía no hay valores cargados')
    expect(html).toContain('Pedile al encargado')
  })

  it('las tres preguntas, en el orden del mostrador', () => {
    const html = renderToStaticMarkup(<Calculadora tabla={TABLA} puedeEditar={false} dolarInicial={null} />)
    const i1 = html.indexOf('1. El equipo que se lleva')
    const i2 = html.indexOf('2. El usado que entrega')
    const i3 = html.indexOf('3. La batería del usado')
    expect(i1).toBeGreaterThan(-1)
    expect(i2).toBeGreaterThan(i1)
    expect(i3).toBeGreaterThan(i2)
  })
})

describe('SinModelos', () => {
  it('a quien puede editar lo manda a la tabla; a quien no, al encargado', () => {
    expect(renderToStaticMarkup(<SinModelos puedeEditar />)).toContain('href="/plan-canje/valores"')
    const vendedor = renderToStaticMarkup(<SinModelos puedeEditar={false} />)
    expect(vendedor).not.toContain('href="/plan-canje/valores"')
    expect(vendedor).toContain('Pedile al encargado')
  })
})

// Ciclo de la cotización del dólar (2026-10-18): el campo arranca con la del
// local si es de hoy —la decide page.tsx— y la pantalla dice de dónde salió el
// número mientras siga siendo ése. La tabla en pesos y el equipo en dólares
// fuerzan el campo.
describe('la cotización del local en la calculadora', () => {
  const EN_PESOS: TablaDeCanje = { ...TABLA, moneda: 'ARS', modelos: [{ ...IPHONE_14, valores: { [R85.id]: '600000' } }] }

  it('arrancada con la de hoy, la cuenta la usa y lo dice', () => {
    const html = panel({ tabla: EN_PESOS, modelo: EN_PESOS.modelos[0], dolar: '1500', dolarDelLocal: '1500' })
    expect(html).toContain('value="1500"')
    expect(html).toContain('Es la cotización del local de hoy')
    // US$ 1000 − $ 600.000 / 1500 = US$ 600.
    expect(html).toContain('600,00')
  })

  it('cambiada a mano, deja de decir que es la del local', () => {
    const html = panel({ tabla: EN_PESOS, modelo: EN_PESOS.modelos[0], dolar: '1200', dolarDelLocal: '1500' })
    expect(html).not.toContain('Es la cotización del local de hoy')
  })

  it('sin una de hoy, el campo arranca vacío y pide el dólar', () => {
    const html = panel({ tabla: EN_PESOS, modelo: EN_PESOS.modelos[0], dolar: '', dolarDelLocal: null })
    expect(html).toContain('Falta la cotización del dólar')
  })

  it('el estado del campo nace de dolarInicial, no vacío fijo', async () => {
    const { readFileSync } = await import('node:fs')
    const FUENTE = readFileSync('app/(app)/plan-canje/calculadora.tsx', 'utf8')
    expect(FUENTE).toContain("const [dolar, setDolar] = useState(dolarInicial ?? '')")
  })
})
