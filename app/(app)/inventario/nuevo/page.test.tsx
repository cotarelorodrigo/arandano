// Puro: importa sólo formatearProximoSku, nunca el componente de página en
// sí — es un Server Component async que abre sesión y consulta Prisma
// (mismo criterio que app/(app)/ventas/page.test.tsx).
import { describe, it, expect } from 'vitest'
import { formatearProximoSku } from './page'

describe('formatearProximoSku', () => {
  it('arma el código con el prefijo y cuatro dígitos, igual que proximoSku() del alta real', () => {
    expect(formatearProximoSku(43)).toBe('A-0043')
  })

  it('rellena con ceros a la izquierda incluso para el primero', () => {
    expect(formatearProximoSku(1)).toBe('A-0001')
  })

  it('no trunca cuando el correlativo ya tiene cuatro dígitos o más', () => {
    expect(formatearProximoSku(12345)).toBe('A-12345')
  })
})
