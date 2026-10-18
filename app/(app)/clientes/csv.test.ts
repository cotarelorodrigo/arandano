import { describe, it, expect } from 'vitest'
import { filaCsv } from '@/lib/formato/csv'
import { formatearFechaCorta } from '@/lib/formato/mostrar'
import { ENCABEZADO_CSV_CLIENTES, filaDeCliente } from './csv'

function cliente(over: Partial<Parameters<typeof filaDeCliente>[0]> = {}) {
  return {
    id: 'x',
    nombre: 'Ana Pérez',
    telefono: '11 2233-4455',
    email: 'ana@ejemplo.test',
    notas: null,
    aceptaOfertas: true,
    creadoEn: new Date('2026-10-01T15:00:00Z'),
    compras: 3,
    ultimaCompra: new Date('2026-10-15T15:00:00Z'),
    ...over,
  }
}

describe('ENCABEZADO_CSV_CLIENTES', () => {
  it('las columnas del spec, en su orden', () => {
    expect(ENCABEZADO_CSV_CLIENTES).toEqual([
      'Nombre', 'Teléfono', 'Email', 'Acepta ofertas', 'Fecha de alta',
      'Compras', 'Última compra', 'Notas',
    ])
  })
})

describe('filaDeCliente', () => {
  it('una fila completa, con "Sí" y las fechas cortas', () => {
    expect(filaDeCliente(cliente())).toEqual([
      'Ana Pérez', '11 2233-4455', 'ana@ejemplo.test', 'Sí',
      formatearFechaCorta(new Date('2026-10-01T15:00:00Z')), '3',
      formatearFechaCorta(new Date('2026-10-15T15:00:00Z')), '',
    ])
  })

  it('"No" sin consentimiento, y celdas vacías para lo que falta', () => {
    const f = filaDeCliente(cliente({ aceptaOfertas: false, telefono: null, email: null, compras: 0, ultimaCompra: null }))
    expect(f[1]).toBe('')
    expect(f[2]).toBe('')
    expect(f[3]).toBe('No')
    expect(f[5]).toBe('0')
    expect(f[6]).toBe('')
  })

  // El escapado es el de `filaCsv`; acá se fija que una fila real lo pase: un
  // nombre con coma, una nota con comillas y salto de línea, y un teléfono que
  // arranca con "+" —Excel lo leería como el comienzo de una fórmula—.
  it('escapa coma, comillas, salto de línea y el "+" inicial', () => {
    const linea = filaCsv(
      filaDeCliente(cliente({ nombre: 'Pérez, Ana', telefono: '+54 9 11 2233-4455', notas: 'Dice "a la tarde"\nno antes' })),
    )
    expect(linea).toContain('"Pérez, Ana"')
    expect(linea).toContain("'+54 9 11 2233-4455")
    expect(linea).toContain('"Dice ""a la tarde""\nno antes"')
  })
})
