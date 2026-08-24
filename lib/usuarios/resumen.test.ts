import { describe, it, expect } from 'vitest'
import { contarDuenosActivos } from './resumen'

const u = (rol: 'DUENO' | 'EMPLEADO', desactivadoEn: Date | null = null) => ({ rol, desactivadoEn })

describe('contarDuenosActivos', () => {
  it('cuenta sólo los dueños, no los empleados', () => {
    expect(contarDuenosActivos([u('DUENO'), u('EMPLEADO'), u('EMPLEADO')])).toBe(1)
  })

  // El caso que protege el comentario de resumen.ts: un dueño dado de baja
  // NO es un dueño activo, aunque su fila diga rol: DUENO.
  it('no cuenta a un dueño desactivado', () => {
    expect(contarDuenosActivos([u('DUENO'), u('DUENO', new Date('2026-01-01'))])).toBe(1)
  })

  it('sin usuarios, cero', () => {
    expect(contarDuenosActivos([])).toBe(0)
  })

  it('todos los dueños activos, se cuentan todos', () => {
    expect(contarDuenosActivos([u('DUENO'), u('DUENO'), u('EMPLEADO')])).toBe(2)
  })
})
