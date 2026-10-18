import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { CuerpoValores, FilaEditable, TablaDeValores, CardDeRangos, PREFIJO_VALOR } from './formularios'
import type { ModeloVisible, RangoVisible } from '@/lib/canje/consultar'

const R100: RangoVisible = { id: '00000000-0000-4000-8000-000000000100', minimo: 100, maximo: 100 }
const R85: RangoVisible = { id: '00000000-0000-4000-8000-000000000085', minimo: 85, maximo: 89 }
const R0: RangoVisible = { id: '00000000-0000-4000-8000-000000000000', minimo: 0, maximo: 79 }
const IPHONE_14: ModeloVisible = {
  id: '00000000-0000-4000-8000-0000000000aa',
  nombre: 'iPhone 14',
  valores: { [R100.id]: '520', [R85.id]: '400' },
}

describe('CuerpoValores', () => {
  // Un tenant nuevo: sin rangos ni modelos. Es lo que ve el smoke contra el
  // canario, así que tiene que renderizar sin romper y decir qué hacer.
  it('vacío, ofrece los rangos sugeridos y explica que van primero', () => {
    const html = renderToStaticMarkup(<CuerpoValores moneda="USD" rangos={[]} modelos={[]} />)
    expect(html).toContain('Usar los rangos sugeridos')
    expect(html).toContain('Primero, los rangos de batería')
    expect(html).toContain('dólares')
  })

  // Los sugeridos son para empezar: con rangos cargados el botón no aparece,
  // y la acción igual lo rechazaría (RANGOS_YA_CARGADOS).
  it('con rangos ya no ofrece los sugeridos', () => {
    const html = renderToStaticMarkup(<CuerpoValores moneda="USD" rangos={[R100]} modelos={[]} />)
    expect(html).not.toContain('Usar los rangos sugeridos')
    expect(html).toContain('Agregar modelo')
  })
})

describe('TablaDeValores', () => {
  const html = renderToStaticMarkup(
    <TablaDeValores moneda="USD" rangos={[R100, R85, R0]} modelos={[IPHONE_14]} />,
  )

  it('los rangos son las columnas, con su rótulo', () => {
    for (const rotulo of ['100 %', '85–89 %', 'Menos de 80 %']) expect(html).toContain(rotulo)
  })

  it('cada celda muestra el valor en la moneda de la tabla', () => {
    expect(html).toContain('US$')
    expect(html).toMatch(/520,00/)
    expect(html).toMatch(/400,00/)
  })

  // La celda vacía dice "—" con su explicación: "no se toma", no "falta".
  it('la celda sin valor es un guion que explica que no se toma', () => {
    expect(html).toContain('No se toma ese equipo en ese rango')
  })

  it('en pesos la tabla muestra pesos', () => {
    const pesos = renderToStaticMarkup(<TablaDeValores moneda="ARS" rangos={[R100]} modelos={[IPHONE_14]} />)
    expect(pesos).not.toContain('US$')
    expect(pesos).toMatch(/\$\s*520,00/)
  })
})

describe('FilaEditable', () => {
  const html = renderToStaticMarkup(
    <table>
      <tbody>
        <FilaEditable modelo={IPHONE_14} rangos={[R100, R85, R0]} alTerminar={() => {}} />
      </tbody>
    </table>,
  )

  // La fila se guarda ENTERA: cada input de cada celda tiene que pertenecer al
  // MISMO formulario, por el atributo `form`, aunque viva en otra celda.
  it('todos los campos de la fila apuntan al mismo formulario', () => {
    const idForm = `fila-${IPHONE_14.id}`
    expect(html).toContain(`<form id="${idForm}"`)
    const asociados = html.match(new RegExp(`form="${idForm}"`, 'g')) ?? []
    // El nombre más una celda por rango.
    expect(asociados).toHaveLength(1 + 3)
  })

  it('una celda por rango, con el id del rango en el nombre del campo y el valor cargado', () => {
    expect(html).toContain(`name="${PREFIJO_VALOR}${R100.id}"`)
    expect(html).toMatch(new RegExp(`name="${PREFIJO_VALOR}${R85.id}"[^>]*value="400"|value="400"[^>]*name="${PREFIJO_VALOR}${R85.id}"`))
    expect(html).toContain(`name="${PREFIJO_VALOR}${R0.id}"`)
  })

  it('la edición manda el id del modelo', () => {
    expect(html).toContain(`name="id" value="${IPHONE_14.id}"`)
  })
})

describe('CardDeRangos', () => {
  it('lista los rangos con su rótulo y ofrece agregar otro', () => {
    const html = renderToStaticMarkup(<CardDeRangos rangos={[R100, R85]} />)
    expect(html).toContain('100 %')
    expect(html).toContain('85–89 %')
    expect(html).toContain('Agregar rango')
  })
})

// `acciones.ts` es 'use server' y no puede exportar la constante, así que la
// repite: este caso es lo que impide que las dos copias se separen. Si se
// separan, el servidor no reconoce ninguna celda y la fila se guarda vacía en
// silencio.
it('el prefijo de los campos de valor es el mismo en la pantalla y en la action', () => {
  const fuente = readFileSync('app/(app)/plan-canje/valores/acciones.ts', 'utf8')
  expect(fuente).toContain(`const PREFIJO_VALOR = '${PREFIJO_VALOR}'`)
})
