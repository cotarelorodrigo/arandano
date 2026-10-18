import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// La sesión, el permiso y la consulta son de otros módulos; acá sólo importa
// qué pide y qué dibuja la pantalla para cada quien.
const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({ exigirSesion: () => exigirSesion() }))

const puedeConSesion = vi.fn()
vi.mock('@/lib/permisos/guarda', () => ({
  puedeConSesion: (s: unknown, p: string) => puedeConSesion(s, p),
}))

const tablaDeCanje = vi.fn()
vi.mock('@/lib/canje/consultar', () => ({ tablaDeCanje: (t: string) => tablaDeCanje(t) }))

vi.mock('./acciones', () => ({ buscarEquipos: async () => [] }))

async function render() {
  const { SidebarProvider } = await import('@/components/ui/sidebar')
  const { default: PlanCanje } = await import('./page')
  return renderToStaticMarkup(<SidebarProvider>{await PlanCanje()}</SidebarProvider>)
}

describe('/plan-canje', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirSesion.mockReset()
    puedeConSesion.mockReset()
    tablaDeCanje.mockReset()
    exigirSesion.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Un vendedor', rol: 'EMPLEADO' },
      subdominio: 'prueba',
    })
    tablaDeCanje.mockResolvedValue({ moneda: 'USD', rangos: [], modelos: [] })
  })

  // La calculadora es de cualquiera: no exige ningún permiso para mostrarse,
  // sólo lo CONSULTA para decidir el enlace.
  it('un vendedor sin CANJE_VALORES ve la calculadora, sin el enlace a la tabla', async () => {
    puedeConSesion.mockResolvedValue(false)
    const html = await render()
    expect(puedeConSesion).toHaveBeenCalledWith(expect.anything(), 'CANJE_VALORES')
    expect(html).toContain('Plan canje')
    expect(html).toContain('1. El equipo que se lleva')
    expect(html).not.toContain('href="/plan-canje/valores"')
  })

  it('quien puede editar ve el enlace a la tabla', async () => {
    puedeConSesion.mockResolvedValue(true)
    expect(await render()).toContain('href="/plan-canje/valores"')
  })
})
