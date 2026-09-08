import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// acciones.ts es 'use server' y su contrato ya lo prueba acciones.test.ts
// contra una base real. Acá sólo importa qué renderiza el diálogo.
vi.mock('./acciones', () => ({ borrarArticuloAccion: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

async function render(
  resumen: { movimientos: number; unidades: number; ventas: number },
  extra: Partial<{ desactivado: boolean; movil: boolean }> = {},
) {
  const { DialogoDeBorrado } = await import('./borrar-dialogo')
  return renderToStaticMarkup(
    <DialogoDeBorrado
      articuloId="a1"
      nombre="Vidrio templado 9H"
      desactivado={extra.desactivado ?? false}
      resumen={resumen}
      movil={extra.movil ?? false}
    />,
  )
}

// `DialogContent` de Radix sólo se monta cuando el diálogo está abierto, así
// que un render estático ve el TRIGGER y no el contenido. Lo que se afirma acá
// es lo que se puede afirmar sin un navegador: que el disparador existe, cómo
// se rotula y que el texto del cuerpo lo arma la función pura de abajo.
describe('DialogoDeBorrado', () => {
  it('dibuja el disparador con la palabra Borrar', async () => {
    expect(await render({ movimientos: 0, unidades: 0, ventas: 0 })).toContain('Borrar')
  })

  it('lo dibuja también en el teléfono', async () => {
    expect(await render({ movimientos: 0, unidades: 0, ventas: 0 }, { movil: true })).toContain(
      'Borrar',
    )
  })
})

describe('el texto de lo que se lleva', () => {
  it('nombra sólo lo que existe', async () => {
    const { queSeLleva } = await import('./borrar-dialogo')
    expect(queSeLleva({ movimientos: 0, unidades: 0, ventas: 0 })).toBe(
      'Se borra el artículo. No se puede deshacer.',
    )
    expect(queSeLleva({ movimientos: 3, unidades: 0, ventas: 0 })).toBe(
      'Se borran el artículo y sus 3 movimientos de stock. No se puede deshacer.',
    )
    expect(queSeLleva({ movimientos: 3, unidades: 5, ventas: 0 })).toBe(
      'Se borran el artículo, sus 3 movimientos de stock y sus 5 unidades. No se puede deshacer.',
    )
  })

  it('usa el singular cuando es uno solo', async () => {
    const { queSeLleva } = await import('./borrar-dialogo')
    expect(queSeLleva({ movimientos: 1, unidades: 1, ventas: 0 })).toBe(
      'Se borran el artículo, su movimiento de stock y su unidad. No se puede deshacer.',
    )
  })
})

describe('el motivo cuando no se puede', () => {
  it('nombra las ventas y ofrece desactivar', async () => {
    const { porQueNo } = await import('./borrar-dialogo')
    expect(porQueNo(3, false)).toContain('se vendió 3 veces')
    expect(porQueNo(3, false)).toContain('Podés desactivarlo')
  })

  it('no ofrece desactivar un artículo que ya está desactivado', async () => {
    const { porQueNo } = await import('./borrar-dialogo')
    expect(porQueNo(1, true)).toContain('se vendió 1 vez')
    expect(porQueNo(1, true)).not.toContain('desactivarlo')
  })
})
