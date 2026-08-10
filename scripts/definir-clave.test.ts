import { describe, it, expect } from 'vitest'
import { parsearArgumentosCLI } from './definir-clave.mts'

describe('parsearArgumentosCLI', () => {
  it('acepta el caso mínimo, sin --clave', () => {
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email=flor@ejemplo.com'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.args.subdominio).toBe('flor')
      expect(r.args.email).toBe('flor@ejemplo.com')
      expect(r.args.clave).toBeUndefined()
    }
  })

  it('acepta --clave explícita', () => {
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email=flor@ejemplo.com', '--clave=algo-largo'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.clave).toBe('algo-largo')
  })

  it('exige --subdominio y --email', () => {
    expect(parsearArgumentosCLI(['--email=flor@ejemplo.com']).ok).toBe(false)
    expect(parsearArgumentosCLI(['--subdominio=flor']).ok).toBe(false)
  })

  it('rechaza un flag desconocido en vez de generar una clave al azar en silencio', () => {
    // El caso real que motiva esto: un --clve= mal tipeado (falta la 'a') no
    // puede terminar generando una clave al azar sin que el operador se
    // entere — creería que la clave que tipeó es la que quedó puesta.
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email=flor@ejemplo.com', '--clve=algo'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--clve')
  })

  it('rechaza un flag sin valor', () => {
    const r = parsearArgumentosCLI(['--subdominio=flor', '--email'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--email')
  })
})
