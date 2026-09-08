import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// acciones.ts es 'use server' y su contrato ya lo prueba acciones.test.ts
// contra una base real. Acá sólo importa qué renderiza el diálogo.
vi.mock('./acciones', () => ({ borrarArticuloAccion: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

async function render(
  resumen: { movimientos: number; unidades: number; ventas: number },
  extra: Partial<{ desactivado: boolean; puedeEditar: boolean; className: string }> = {},
) {
  const { DialogoDeBorrado } = await import('./borrar-dialogo')
  return renderToStaticMarkup(
    <DialogoDeBorrado
      articuloId="a1"
      nombre="Vidrio templado 9H"
      desactivado={extra.desactivado ?? false}
      puedeEditar={extra.puedeEditar ?? true}
      resumen={resumen}
      className={extra.className}
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

  // `className` es lo que reemplazó a `movil` (review de la Task 6): antes,
  // `movil ? 'shrink-0' : undefined` era un no-op —`shrink-0` ya está en el
  // string base de `buttonVariants`—, así que el caso anterior no afirmaba
  // ninguna diferencia real entre las dos copias. Ahora sí la hay: la clase
  // que le pasa el llamador (`CLASES_BOTON_PIE` del pie del teléfono, en
  // `formularios.tsx`) tiene que llegar al `<button>`, y sin ella no tiene
  // que estar.
  it('la clase que le pasa el llamador llega al botón, y sin ella no aparece', async () => {
    const conClase = await render(
      { movimientos: 0, unidades: 0, ventas: 0 },
      { className: 'shrink-0 h-[50px] rounded-[12px]' },
    )
    expect(conClase).toContain('h-[50px]')
    expect(conClase).toContain('rounded-[12px]')

    const sinClase = await render({ movimientos: 0, unidades: 0, ventas: 0 })
    expect(sinClase).not.toContain('h-[50px]')
    expect(sinClase).not.toContain('rounded-[12px]')
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
    expect(porQueNo(3, false, true)).toContain('se vendió 3 veces')
    expect(porQueNo(3, false, true)).toContain('Podés desactivarlo')
  })

  it('no ofrece desactivar un artículo que ya está desactivado', async () => {
    const { porQueNo } = await import('./borrar-dialogo')
    expect(porQueNo(1, true, true)).toContain('se vendió 1 vez')
    expect(porQueNo(1, true, true)).not.toContain('desactivarlo')
  })

  // Review de la Task 6: `ARTICULOS_BORRAR` y `ARTICULOS_EDITAR` son permisos
  // independientes, así que alguien con el primero y sin el segundo no tiene
  // el botón "Desactivar" en ninguna de las dos copias de la ficha — ofrecerle
  // esa salida sería prometerle algo que no puede hacer.
  it('no ofrece desactivar a quien no puede editar, aunque el artículo siga activo', async () => {
    const { porQueNo } = await import('./borrar-dialogo')
    expect(porQueNo(2, false, false)).toContain('se vendió 2 veces')
    expect(porQueNo(2, false, false)).not.toContain('desactivarlo')
  })
})
