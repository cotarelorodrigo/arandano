import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('./acciones', () => ({ buscarClientesDelLocal: async () => [] }))

import { ElegirCliente, camposOcultosDelCliente, precargaDelAlta } from './elegir-cliente'

const FUENTE = readFileSync('app/(app)/clientes/elegir-cliente.tsx', 'utf8')

describe('camposOcultosDelCliente', () => {
  // El caso de casi toda venta: sin cliente, los dos campos vacíos, que el
  // cobro lee como "consumidor final" — lo de antes de este ciclo.
  it('sin cliente, los dos vacíos', () => {
    expect(camposOcultosDelCliente(null)).toEqual({ clienteId: '', clienteNuevo: '' })
  })

  it('uno existente manda sólo su id', () => {
    expect(
      camposOcultosDelCliente({ tipo: 'existente', id: 'abc', nombre: 'Ana', telefono: null }),
    ).toEqual({ clienteId: 'abc', clienteNuevo: '' })
  })

  it('uno nuevo manda sólo el JSON, con el consentimiento como booleano', () => {
    const c = camposOcultosDelCliente({ tipo: 'nuevo', nombre: 'Ana', telefono: '11', aceptaOfertas: true })
    expect(c.clienteId).toBe('')
    expect(JSON.parse(c.clienteNuevo)).toEqual({ nombre: 'Ana', telefono: '11', aceptaOfertas: true })
  })
})

describe('precargaDelAlta', () => {
  it('lo que parece un teléfono va al teléfono', () => {
    expect(precargaDelAlta('11 2233-4455')).toEqual({ nombre: '', telefono: '11 2233-4455' })
  })
  it('un nombre va al nombre', () => {
    expect(precargaDelAlta(' Ana Pérez ')).toEqual({ nombre: 'Ana Pérez', telefono: '' })
  })
})

describe('ElegirCliente', () => {
  it('sin cliente, el buscador y "Nuevo"', () => {
    const html = renderToStaticMarkup(<ElegirCliente valor={null} onCambiar={() => {}} />)
    expect(html).toContain('Buscar por nombre o teléfono')
    expect(html).toContain('Nuevo')
    expect(html).toContain('role="combobox"')
  })

  it('con uno elegido, su nombre y teléfono, y cómo sacarlo', () => {
    const html = renderToStaticMarkup(
      <ElegirCliente valor={{ tipo: 'existente', id: 'x', nombre: 'Ana Pérez', telefono: '11 2233-4455' }} onCambiar={() => {}} />,
    )
    expect(html).toContain('Ana Pérez')
    expect(html).toContain('11 2233-4455')
    expect(html).toContain('aria-label="Sacar a Ana Pérez de la venta"')
  })

  it('con uno nuevo, sus campos y el consentimiento destildado', () => {
    const html = renderToStaticMarkup(
      <ElegirCliente valor={{ tipo: 'nuevo', nombre: '', telefono: '', aceptaOfertas: false }} onCambiar={() => {}} />,
    )
    expect(html).toContain('Cliente nuevo')
    expect(html).toContain('Teléfono (opcional)')
    expect(html).toContain('Acepta que le mandemos ofertas')
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/)
  })

  // La regla 1 del docblock, sobre la FUENTE y no sobre el HTML: sin jsdom no
  // hay click que simular, y un botón sin `type` adentro del form del cobro
  // cobraría la venta. Mismo criterio que el caso del pie de /vender (fix
  // 86fc106).
  it('todo <button> del selector es type="button"', () => {
    // Del `<button` a su `</button>`: los atributos llevan flechas (`=>`), así
    // que cortar en el primer `>` partiría la etiqueta por la mitad.
    const botones = [...FUENTE.matchAll(/<button\b[\s\S]*?<\/button>/g)].map((m) => m[0])
    expect(botones.length).toBeGreaterThanOrEqual(4)
    for (const b of botones) expect(b, b).toMatch(/^<button\b[^]*?\btype="button"/)
    expect(FUENTE).not.toMatch(/<Button\b/)
  })

  // La regla 2: Enter nunca dispara el envío implícito del cobro. Cada campo
  // de texto tiene un onKeyDown que lo frena.
  it('todo campo de texto frena el Enter', () => {
    const inputs = [...FUENTE.matchAll(/<Input\b[\s\S]*?\/>/g)].map((m) => m[0])
    expect(inputs.length).toBe(3)
    for (const i of inputs) expect(i).toMatch(/onKeyDown=/)
  })

  // Y cada Enter que el selector atiende corta la propagación, además de
  // frenar el envío implícito: elegir con Enter saca el buscador del DOM en el
  // mismo evento, el foco cae en <body>, y sin el corte el atajo global de
  // /vender cobraría la venta con ese mismo Enter.
  it('cada Enter atendido frena el envío Y corta la propagación', () => {
    const sinComentarios = FUENTE.replace(/^\s*\/\/.*$/gm, '')
    const ramas = [...sinComentarios.matchAll(/if \(e\.key === 'Enter'\) \{([\s\S]*?)\n\s*\}/g)].map((m) => m[1])
    expect(ramas).toHaveLength(2)
    for (const r of ramas) {
      expect(r).toContain('e.preventDefault()')
      expect(r).toContain('e.stopPropagation()')
    }
  })
})
