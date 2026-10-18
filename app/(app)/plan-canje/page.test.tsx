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

const cotizacionVigente = vi.fn()
vi.mock('@/lib/cotizacion/consultar', () => ({ cotizacionVigente: (t: string) => cotizacionVigente(t) }))

// La calculadora, reemplazada por algo que deja ver con qué dólar la arrancó
// la página: su estado interno no se ve en un render estático hasta que hay un
// equipo elegido, y lo que este archivo prueba es la decisión de la página.
vi.mock('./calculadora', () => ({
  Calculadora: ({ dolarInicial }: { dolarInicial: string | null }) => (
    <output data-dolar-inicial={dolarInicial ?? 'ninguno'}>1. El equipo que se lleva</output>
  ),
}))

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
    cotizacionVigente.mockReset()
    cotizacionVigente.mockResolvedValue(null)
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

  // La misma regla que el cobro: sólo la de HOY arranca el campo.
  it('la calculadora arranca con la cotización del local si es de hoy', async () => {
    puedeConSesion.mockResolvedValue(false)
    cotizacionVigente.mockResolvedValue({ valor: '1450', creadaEn: new Date() })
    expect(await render()).toContain('data-dolar-inicial="1450"')
  })

  // Escrita como en el campo, con la coma argentina: "1450,50" y no el
  // "1450.5" del Decimal.
  it('con centavos, la precarga con coma decimal', async () => {
    puedeConSesion.mockResolvedValue(false)
    cotizacionVigente.mockResolvedValue({ valor: '1450.5', creadaEn: new Date() })
    expect(await render()).toContain('data-dolar-inicial="1450,50"')
  })

  it('con una vieja, o sin ninguna, arranca vacía', async () => {
    puedeConSesion.mockResolvedValue(false)
    cotizacionVigente.mockResolvedValue({ valor: '1450', creadaEn: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })
    expect(await render()).toContain('data-dolar-inicial="ninguno"')
    cotizacionVigente.mockResolvedValue(null)
    expect(await render()).toContain('data-dolar-inicial="ninguno"')
  })
})
