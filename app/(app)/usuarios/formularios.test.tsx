import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo criterio que app/(app)/inventario/formularios.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real. Acá sólo importa qué renderiza la pantalla. fila-acciones.tsx importa
// el MISMO módulo (misma ruta relativa './acciones', mismo archivo), así que
// este único mock alcanza para todo el árbol de CuerpoUsuarios.
vi.mock('./acciones', () => ({
  altaEmpleado: vi.fn(),
  nuevaClave: vi.fn(),
  baja: vi.fn(),
  alta: vi.fn(),
}))

async function renderAlta() {
  const { AltaDeEmpleado } = await import('./formularios')
  return renderToStaticMarkup(<AltaDeEmpleado onClaveGenerada={() => {}} />)
}

describe('AltaDeEmpleado', () => {
  it('tiene los cuatro campos con sus rótulos', async () => {
    const html = await renderAlta()
    expect(html).toContain('Nombre y apellido')
    expect(html).toContain('Mail')
    expect(html).toContain('Rol')
    expect(html).toContain('Contraseña inicial')
  })

  it('el placeholder de la contraseña inicial pide 8 caracteres', async () => {
    const html = await renderAlta()
    expect(html).toContain('placeholder="mínimo 8 caracteres"')
  })

  it('el botón lleva el ícono user-plus y el texto "Agregar al equipo"', async () => {
    const html = await renderAlta()
    expect(html).toContain('Agregar al equipo')
    expect(html).toContain('<svg')
  })

  // El control segmentado de Rol (design/arandano.pen, nodo `iotGr`): dos
  // pastillas, "Empleado" seleccionado por default. data-state lo pone Radix
  // en el propio render de servidor a partir de `value` — no hace falta
  // simular ningún click para verificar el estado INICIAL.
  it('el rol es un control segmentado con "Empleado" preseleccionado', async () => {
    const html = await renderAlta()
    expect(html).toContain('Empleado')
    expect(html).toContain('Dueño')
    // No hay <select> nativo: la maqueta lo reemplaza por el toggle group.
    expect(html).not.toContain('<select')
    // data-state lo pone Radix a partir del `value` controlado — comprobar
    // que el botón "Empleado" quede en "on" y "Dueño" en "off" (no sólo que
    // los dos textos existan) es lo que de verdad prueba "preseleccionado".
    expect(html).toMatch(/data-state="on"[^>]*>Empleado</)
    expect(html).toMatch(/data-state="off"[^>]*>Dueño</)
  })

  it('el value oculto que viaja al FormData empieza en EMPLEADO', async () => {
    const html = await renderAlta()
    expect(html).toMatch(/name="rol"\s+value="EMPLEADO"/)
  })

  // I3 de la review final: el botón "Agregar persona" del Topbar (page.tsx)
  // apunta a `#alta`. Esta card es su único destino posible, así que el id
  // tiene que estar de verdad en el markup, no sólo en el fuente.
  it('la card lleva id="alta": es el destino del botón del Topbar', async () => {
    const html = await renderAlta()
    expect(html).toContain('id="alta"')
  })
})

describe('CuerpoUsuarios', () => {
  const USUARIOS = [
    {
      id: 'u1',
      nombre: 'Florencia Díaz',
      email: 'flor@celularesflor.com.ar',
      rol: 'DUENO' as const,
      desactivadoEn: null,
    },
    {
      id: 'u4',
      nombre: 'Nahuel Ríos',
      email: 'nahuel@celularesflor.com.ar',
      rol: 'EMPLEADO' as const,
      desactivadoEn: new Date('2026-01-01'),
    },
  ]

  async function render() {
    const { CuerpoUsuarios } = await import('./formularios')
    return renderToStaticMarkup(<CuerpoUsuarios usuarios={USUARIOS} usuarioActualId="u1" />)
  }

  it('arma las cuatro cards: Equipo, Alta y Reglas (el aviso de clave no está sin clave generada)', async () => {
    const html = await render()
    expect(html).toContain('El equipo del local')
    expect(html).toContain('Agregar a alguien')
    expect(html).toContain('Dos reglas que el sistema no deja romper')
    // Sin ningún claveGenerada todavía, el bloque ámbar no se pinta — el
    // componente lo monta condicionalmente (`{claveGenerada && ...}`).
    expect(html).not.toContain('Se muestra una sola vez')
  })

  it('lista a las personas con su chip de rol y de estado', async () => {
    const html = await render()
    expect(html).toContain('Florencia Díaz')
    expect(html).toContain('Nahuel Ríos')
    expect(html).toContain('Activo')
    expect(html).toContain('Desactivado')
  })

  it('las dos reglas del sistema aparecen palabra por palabra', async () => {
    const html = await render()
    expect(html).toContain('Nunca puede quedar el local sin un dueño activo.')
    expect(html).toContain(
      'Resetear una contraseña cierra todas las sesiones de esa persona — incluida la tuya, si te la cambiás a vos.',
    )
  })
})
