import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo criterio que app/(app)/inventario/formularios.test.tsx: acciones.ts es
// 'use server' y su contrato ya lo prueba acciones.test.ts contra una base
// real. Acá sólo importa qué renderiza el formulario.
vi.mock('./acciones', () => ({ entrar: vi.fn() }))

async function render() {
  const { FormularioLogin } = await import('./formulario')
  return renderToStaticMarkup(<FormularioLogin />)
}

describe('FormularioLogin', () => {
  it('el título "Entrar" y su subtítulo (design/arandano.pen, nodo M6mNY)', async () => {
    const html = await render()
    expect(html).toContain('Entrar')
    expect(html).toContain('Usuario y contraseña del local.')
  })

  it('el mail lleva el placeholder de ejemplo', async () => {
    const html = await render()
    expect(html).toContain('placeholder="flor@celularesflor.com.ar"')
  })

  it('arranca con la contraseña oculta: type="password" y el ícono "eye"', async () => {
    const html = await render()
    expect(html).toContain('type="password"')
    expect(html).not.toContain('type="text"')
  })

  it('el botón lleva el ícono arrow-right junto al texto "Entrar"', async () => {
    const html = await render()
    expect(html).toContain('<svg')
    expect(html).toContain('Entrar')
  })

  // El texto de ayuda tiene que decir la VERDAD del producto: no hay
  // proveedor de mail (CLAUDE.md), así que un mail de recupero sería mentira.
  it('la ayuda dice que resetea el dueño y que no se mandan mails de recupero', async () => {
    const html = await render()
    expect(html).toContain('Te la resetea el dueño del local desde Usuarios')
    expect(html).toContain('No mandamos')
    expect(html).toContain('mails de recupero')
  })
})

describe('tipoDelCampoClave — la regla pura detrás del ojo', () => {
  it('mostrar=false da password; mostrar=true da text', async () => {
    const { tipoDelCampoClave } = await import('./formulario')
    expect(tipoDelCampoClave(false)).toBe('password')
    expect(tipoDelCampoClave(true)).toBe('text')
  })
})

describe('CampoClave — los dos estados del ojo, renderizados directo', () => {
  // Este harness no simula clicks (sin jsdom), así que los dos estados se
  // ejercitan pasando `mostrar` directo, en vez de intentar togglear uno
  // solo — la ÚNICA forma de que un test afirme sobre lo RENDERIZADO en cada
  // caso, no sobre la forma del código.
  it('mostrar=false: type="password", ícono "eye", aria-pressed="false"', async () => {
    const { CampoClave } = await import('./formulario')
    const html = renderToStaticMarkup(
      <CampoClave mostrar={false} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    expect(html).toContain('type="password"')
    expect(html).toContain('aria-pressed="false"')
    expect(html).toContain('aria-label="Mostrar la contraseña"')
    // "lucide-eye " (con el espacio) y no "lucide-eye-off": el segundo
    // contiene al primero como prefijo si sólo se busca "lucide-eye".
    expect(html).toContain('lucide-eye ')
    expect(html).not.toContain('lucide-eye-off')
  })

  it('mostrar=true: type="text", ícono "eye-off", aria-pressed="true"', async () => {
    const { CampoClave } = await import('./formulario')
    const html = renderToStaticMarkup(
      <CampoClave mostrar={true} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    expect(html).toContain('type="text"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('aria-label="Ocultar la contraseña"')
    expect(html).toContain('lucide-eye-off ')
  })

  it('los dos estados rinden HTML distinto entre sí', async () => {
    const { CampoClave } = await import('./formulario')
    const oculto = renderToStaticMarkup(
      <CampoClave mostrar={false} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    const visible = renderToStaticMarkup(
      <CampoClave mostrar={true} onAlternar={() => {}} inputRef={{ current: null }} />,
    )
    expect(oculto).not.toBe(visible)
  })
})
