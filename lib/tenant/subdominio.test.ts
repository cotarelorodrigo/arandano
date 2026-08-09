import { describe, it, expect } from 'vitest'
import {
  subdominioDeHost,
  validarSubdominio,
  SUBDOMINIOS_RESERVADOS,
} from '@/lib/tenant/subdominio'

const BASE = 'arandano.app'

describe('subdominioDeHost', () => {
  it('extrae el subdominio de un host simple', () => {
    expect(subdominioDeHost('flor.arandano.app', BASE)).toEqual({
      tipo: 'tenant',
      subdominio: 'flor',
    })
  })

  // En dev la app escucha en :3000 y el navegador manda el puerto en el Host.
  // Sin sacarlo, `dev.arandano.app:3000` nunca matchea el dominio base.
  it('ignora el puerto', () => {
    expect(subdominioDeHost('flor.dev.arandano.app:3000', 'dev.arandano.app')).toEqual({
      tipo: 'tenant',
      subdominio: 'flor',
    })
  })

  it('normaliza mayúsculas', () => {
    expect(subdominioDeHost('FLOR.Arandano.App', BASE)).toEqual({
      tipo: 'tenant',
      subdominio: 'flor',
    })
  })

  it('distingue el apex de un dominio ajeno', () => {
    expect(subdominioDeHost('arandano.app', BASE)).toEqual({ tipo: 'apex' })
    expect(subdominioDeHost('ejemplo.com', BASE)).toEqual({ tipo: 'ajeno' })
  })

  // El caso que motiva el tipo discriminado: los dos son "no hay subdominio"
  // pero piden respuestas distintas — placeholder uno, 404 el otro.
  it('un host que sólo termina parecido no es del dominio', () => {
    expect(subdominioDeHost('malarandano.app', BASE)).toEqual({ tipo: 'ajeno' })
  })

  it('exige exactamente una etiqueta delante del dominio base', () => {
    expect(subdominioDeHost('a.b.arandano.app', BASE)).toEqual({ tipo: 'ajeno' })
  })

  // Cero etiquetas tampoco son "exactamente una": un punto de más antes del
  // dominio base no puede colar un subdominio vacío como si fuera un tenant.
  it('un punto sin etiqueta delante del dominio base es ajeno, no un subdominio vacío', () => {
    expect(subdominioDeHost('.arandano.app', BASE)).toEqual({ tipo: 'ajeno' })
  })

  // La IP pelada es como se llega hoy a dev, y deja de resolver a propósito:
  // no hay camino de resolución exclusivo de dev.
  it('trata la IP pelada como ajena', () => {
    expect(subdominioDeHost('100.64.81.63:3000', BASE)).toEqual({ tipo: 'ajeno' })
  })

  it('tolera host ausente o vacío', () => {
    expect(subdominioDeHost(null, BASE)).toEqual({ tipo: 'ajeno' })
    expect(subdominioDeHost(undefined, BASE)).toEqual({ tipo: 'ajeno' })
    expect(subdominioDeHost('', BASE)).toEqual({ tipo: 'ajeno' })
  })
})

describe('validarSubdominio', () => {
  it('acepta uno válido', () => {
    expect(validarSubdominio('flor')).toEqual({ ok: true })
    expect(validarSubdominio('flor-celulares-2')).toEqual({ ok: true })
  })

  it('rechaza mayúsculas y espacios', () => {
    expect(validarSubdominio('Flor').ok).toBe(false)
    expect(validarSubdominio(' flor ').ok).toBe(false)
  })

  it('rechaza por longitud', () => {
    expect(validarSubdominio('ab').ok).toBe(false)
    expect(validarSubdominio('a'.repeat(64)).ok).toBe(false)
    expect(validarSubdominio('a'.repeat(63)).ok).toBe(true)
  })

  it('rechaza caracteres fuera de [a-z0-9-]', () => {
    expect(validarSubdominio('flor_celulares').ok).toBe(false)
    expect(validarSubdominio('flor.celulares').ok).toBe(false)
    expect(validarSubdominio('florñ').ok).toBe(false)
  })

  it('rechaza guión al borde', () => {
    expect(validarSubdominio('-flor').ok).toBe(false)
    expect(validarSubdominio('flor-').ok).toBe(false)
  })

  it('rechaza los reservados', () => {
    for (const reservado of SUBDOMINIOS_RESERVADOS) {
      expect(validarSubdominio(reservado).ok).toBe(false)
    }
  })

  // dev y stage están reservados porque los dominios base de esos entornos
  // son dev.arandano.app y stage.arandano.app: un tenant así en producción
  // colisiona de nombre con un entorno interno.
  it('reserva dev y stage explícitamente', () => {
    expect(SUBDOMINIOS_RESERVADOS).toContain('dev')
    expect(SUBDOMINIOS_RESERVADOS).toContain('stage')
  })

  it('da un motivo legible', () => {
    const r = validarSubdominio('www')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('reservado')
  })
})
