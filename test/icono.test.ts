import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { hexDelToken } from '@/scripts/tokens.mts'
import { TAMANOS, tamanoDeIconoValido } from '@/lib/marca/tamanos-de-icono'

const ICONO = 'app/icono/[tamano]/route.tsx'

describe('el ícono del local', () => {
  const fuente = readFileSync(ICONO, 'utf8')

  // Mismo mecanismo que test/opengraph.test.ts: Satori no resuelve
  // var(--marca), así que el hex está duplicado y esto es lo único que impide
  // que un repintado de la paleta deje el ícono con el arándano viejo.
  it('el fondo es exactamente --marca', () => {
    expect(fuente).toContain(`backgroundColor: '${hexDelToken('--marca')}'`)
  })

  it('la letra es exactamente --marca-foreground', () => {
    expect(fuente).toContain(`color: '${hexDelToken('--marca-foreground')}'`)
  })

  // Un endpoint que genera una imagen del tamaño que le pidan es trabajo de
  // CPU gratis para cualquiera que lo descubra, sobre una caja de 2 vCPU
  // compartida con producción. Lista blanca, no rango.
  it('rechaza tamaños no declarados', () => {
    // Los dos válidos
    expect(tamanoDeIconoValido('192')).toBe(192)
    expect(tamanoDeIconoValido('512')).toBe(512)
    // Los inválidos
    expect(tamanoDeIconoValido('300')).toBeNull()
    expect(tamanoDeIconoValido('abc')).toBeNull()
    expect(tamanoDeIconoValido('')).toBeNull()
    expect(tamanoDeIconoValido('192.5')).toBeNull()
    expect(tamanoDeIconoValido('0192')).toBeNull()
    expect(tamanoDeIconoValido('-192')).toBeNull()
  })
})

// Los dos archivos tienen que decir lo mismo en las DOS direcciones: un tamaño
// declarado en el manifest que el endpoint no genere sirve un ícono roto, y
// uno que el endpoint genere y el manifest no declare es código muerto.
describe('el manifest y el endpoint declaran los mismos tamaños', () => {
  it('coinciden', async () => {
    const manifiesto = readFileSync('app/manifest.ts', 'utf8')
    for (const lado of TAMANOS) {
      expect(manifiesto).toContain(`/icono/${lado}`)
      expect(manifiesto).toContain(`${lado}x${lado}`)
    }
    const declarados = [...manifiesto.matchAll(/\/icono\/(\d+)/g)].map((m) => Number(m[1]))
    expect([...new Set(declarados)].sort((a, b) => a - b)).toEqual([...TAMANOS])
  })
})
