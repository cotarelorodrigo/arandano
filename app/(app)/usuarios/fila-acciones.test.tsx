import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UsuarioDeFila } from './fila-acciones'

// Mismo criterio que app/(app)/inventario/formularios.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real (login real, cookie real). Acá sólo importa qué renderiza la celda.
vi.mock('./acciones', () => ({
  nuevaClave: vi.fn(),
  baja: vi.fn(),
  alta: vi.fn(),
}))

const DUENA_ACTIVA: UsuarioDeFila = {
  id: 'u1',
  nombre: 'Florencia Díaz',
  email: 'flor@celularesflor.com.ar',
  rol: 'DUENO' as const,
  desactivadoEn: null,
}
const EMPLEADA_ACTIVA: UsuarioDeFila = {
  id: 'u3',
  nombre: 'Camila Ortiz',
  email: 'camila@celularesflor.com.ar',
  rol: 'EMPLEADO' as const,
  desactivadoEn: null,
}
const EMPLEADO_DESACTIVADO: UsuarioDeFila = {
  id: 'u4',
  nombre: 'Nahuel Ríos',
  email: 'nahuel@celularesflor.com.ar',
  rol: 'EMPLEADO' as const,
  desactivadoEn: new Date('2026-01-01'),
}

async function render(usuario: UsuarioDeFila, esUnoMismo: boolean) {
  const { FilaAcciones } = await import('./fila-acciones')
  return renderToStaticMarkup(
    <FilaAcciones usuario={usuario} esUnoMismo={esUnoMismo} onClaveGenerada={() => {}} />,
  )
}

describe('FilaAcciones', () => {
  it('un usuario activo, visto por otra persona, muestra "Cambiar clave" Y "Baja"', async () => {
    const html = await render(EMPLEADA_ACTIVA, false)
    expect(html).toContain('Cambiar clave')
    expect(html).toContain('Baja')
  })

  // Mismo criterio para un dueño: la maqueta sólo dibuja "Cambiar clave" en
  // las dos filas de dueño de su ejemplo, pero esconder "Baja" quitaría una
  // capacidad que ya existe (dar de baja a OTRO dueño) sin que el brief lo
  // pida explícito, y dejaría sin forma de ejercitar desde la pantalla la
  // regla del último dueño — ver el comentario de fila-acciones.tsx.
  it('un DUEÑO activo, visto por otra persona, TAMBIÉN muestra "Baja"', async () => {
    const html = await render(DUENA_ACTIVA, false)
    expect(html).toContain('Cambiar clave')
    expect(html).toContain('Baja')
  })

  it('la propia fila (esUnoMismo) NO ofrece "Baja", sólo "Cambiar clave"', async () => {
    const html = await render(DUENA_ACTIVA, true)
    expect(html).toContain('Cambiar clave')
    expect(html).not.toContain('Baja')
  })

  it('un usuario desactivado sólo ofrece "Reactivar" — ni "Cambiar clave" ni "Baja"', async () => {
    const html = await render(EMPLEADO_DESACTIVADO, false)
    expect(html).toContain('Reactivar')
    expect(html).not.toContain('Cambiar clave')
    expect(html).not.toContain('Baja')
  })

  // Los cuatro casos de arriba tienen que rendir HTML distinto entre sí: si
  // alguien rompiera el condicional y devolviera siempre la misma rama, un
  // test que sólo mirara "contiene Reactivar" en el caso de desactivado
  // seguiría en verde con las otras tres filas rotas.
  it('los cuatro casos rinden HTML distinto entre sí', async () => {
    const casos = await Promise.all([
      render(EMPLEADA_ACTIVA, false),
      render(DUENA_ACTIVA, true),
      render(EMPLEADO_DESACTIVADO, false),
    ])
    expect(new Set(casos).size).toBe(casos.length)
  })
})

describe('ErrorDeFila — I2 de la review final: role="alert" en los tres errores de fila', () => {
  it('lleva role="alert" y el mensaje', async () => {
    const { ErrorDeFila } = await import('./fila-acciones')
    const html = renderToStaticMarkup(<ErrorDeFila mensaje="No podés dar de baja al último dueño activo." />)
    expect(html).toContain('role="alert"')
    expect(html).toContain('No podés dar de baja al último dueño activo.')
  })
})

describe('AvisoDeFila — la confirmación de Baja/Reactivar que antes no se veía', () => {
  it('lleva role="status" y el mensaje, no role="alert" (no es un error)', async () => {
    const { AvisoDeFila } = await import('./fila-acciones')
    const html = renderToStaticMarkup(<AvisoDeFila mensaje="Usuario desactivado." />)
    expect(html).toContain('role="status"')
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('Usuario desactivado.')
  })
})

describe('FormularioCambiarClave', () => {
  it('lleva el input de la nueva contraseña, con el usuarioId y el nombre ocultos', async () => {
    const { FormularioCambiarClave } = await import('./fila-acciones')
    const html = renderToStaticMarkup(
      <FormularioCambiarClave
        usuarioId="u3"
        nombre="Camila Ortiz"
        accion={() => {}}
        pendiente={false}
        onCancelar={() => {}}
      />,
    )
    expect(html).toContain('value="u3"')
    expect(html).toContain('value="Camila Ortiz"')
    expect(html).toContain('placeholder="Nueva contraseña"')
    expect(html).toContain('Guardar')
    expect(html).toContain('Cancelar')
  })

  it('el botón de guardar dice "Guardando…" mientras pendiente', async () => {
    const { FormularioCambiarClave } = await import('./fila-acciones')
    const html = renderToStaticMarkup(
      <FormularioCambiarClave
        usuarioId="u3"
        nombre="Camila Ortiz"
        accion={() => {}}
        pendiente={true}
        onCancelar={() => {}}
      />,
    )
    expect(html).toContain('Guardando…')
    expect(html).not.toContain('>Guardar<')
  })
})
