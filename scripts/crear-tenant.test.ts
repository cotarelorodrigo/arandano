import { describe, it, expect } from 'vitest'
import { parsearArgumentos } from './crear-tenant.mts'

const BASE = [
  '--subdominio=flor',
  '--nombre=Flor Celulares',
  '--duenio=flor@ejemplo.com',
  '--duenio-nombre=Flor',
]

describe('parsearArgumentos', () => {
  it('acepta el caso mínimo y deja módulos vacío', () => {
    const r = parsearArgumentos(BASE)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.args.subdominio).toBe('flor')
      expect(r.args.nombre).toBe('Flor Celulares')
      expect(r.args.modulos).toEqual([])
      expect(r.args.duenio).toBe('flor@ejemplo.com')
    }
  })

  it('parsea varios módulos separados por coma', () => {
    const r = parsearArgumentos([...BASE, '--modulos=ORDENES_DE_TRABAJO,TURNOS'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.modulos).toEqual(['ORDENES_DE_TRABAJO', 'TURNOS'])
  })

  it('rechaza un módulo que no existe en el enum', () => {
    const r = parsearArgumentos([...BASE, '--modulos=PELUQUERIA'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('PELUQUERIA')
  })

  it('rechaza un subdominio inválido con el motivo de validarSubdominio', () => {
    const r = parsearArgumentos(['--subdominio=WWW', ...BASE.slice(1)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('minúsculas')
  })

  it('rechaza un subdominio reservado', () => {
    const r = parsearArgumentos(['--subdominio=admin', ...BASE.slice(1)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('reservado')
  })

  it('exige los obligatorios', () => {
    for (const faltante of ['--subdominio', '--nombre', '--duenio', '--duenio-nombre']) {
      const r = parsearArgumentos(BASE.filter((a) => !a.startsWith(faltante + '=')))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toContain(faltante)
    }
  })

  it('rechaza un flag desconocido en vez de ignorarlo', () => {
    // Ignorarlo en silencio convierte un `--modulo=` (sin s) en un tenant sin
    // módulos que nadie entiende por qué quedó así.
    const r = parsearArgumentos([...BASE, '--preset=servicio-tecnico'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--preset')
  })
})
