import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Mismo patrón que app/(app)/formas-de-pago/page.test.tsx: la sesión y la
// consulta son detalle de otros módulos, y acá sólo importa QUÉ pide y QUÉ
// renderiza la pantalla.
const exigirPermiso = vi.fn()
vi.mock('@/lib/permisos/guarda', () => ({
  exigirPermiso: (permiso: string) => exigirPermiso(permiso),
}))

const tablaDeCanje = vi.fn()
vi.mock('@/lib/canje/consultar', () => ({
  tablaDeCanje: (tenantId: string) => tablaDeCanje(tenantId),
}))

// Ver el comentario de render() en formas-de-pago/page.test.tsx: el
// <Encabezado> necesita el SidebarProvider, importado del MISMO registro.
async function render() {
  const { SidebarProvider } = await import('@/components/ui/sidebar')
  const { default: Valores } = await import('./page')
  return renderToStaticMarkup(<SidebarProvider>{await Valores()}</SidebarProvider>)
}

describe('/plan-canje/valores', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirPermiso.mockReset()
    tablaDeCanje.mockReset()
    exigirPermiso.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'DUENO' },
      subdominio: 'prueba',
    })
    tablaDeCanje.mockResolvedValue({ moneda: 'USD', rangos: [], modelos: [] })
  })

  // La pantalla exige el permiso además de cada action: sin esto, un vendedor
  // vería la tabla con sus botones aunque no pudiera tocar nada.
  it('exige CANJE_VALORES antes de mostrar nada', async () => {
    await render()
    expect(exigirPermiso).toHaveBeenCalledWith('CANJE_VALORES')
    expect(tablaDeCanje).toHaveBeenCalledWith('un-id')
  })

  it('con la tabla vacía renderiza y dice qué hacer primero', async () => {
    const html = await render()
    expect(html).toContain('Valores del plan canje')
    expect(html).toContain('0 modelos · 0 rangos de batería · en dólares')
    expect(html).toContain('Usar los rangos sugeridos')
  })

  it('vuelve a la calculadora', async () => {
    expect(await render()).toContain('href="/plan-canje"')
  })
})
