import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({ exigirSesion: () => exigirSesion() }))

const fichaDeCliente = vi.fn()
vi.mock('@/lib/clientes/consultar', () => ({
  fichaDeCliente: (...a: unknown[]) => fichaDeCliente(...a),
}))

const notFound = vi.fn(() => {
  throw new Error('NOT_FOUND')
})
vi.mock('next/navigation', () => ({ notFound: () => notFound() }))

vi.mock('../acciones', () => ({
  altaDeCliente: async () => ({ error: null, aviso: null }),
  edicionDeCliente: async () => ({ error: null, aviso: null }),
  bajaDeCliente: async () => ({ error: null, aviso: null }),
  exportarClientes: async () => '',
  buscarClientesDelLocal: async () => [],
}))

const ID = '0190a8f2-0000-7000-8000-0000000000aa'

function sesionDe(rol: 'DUENO' | 'EMPLEADO') {
  return {
    tenant: { id: 'tenant-1', nombre: 'Local de prueba', estado: 'ACTIVO' },
    usuario: { id: 'u-1', nombre: 'Alguien', rol },
    subdominio: 'prueba',
  }
}

function ficha(over: { ventas?: number; ordenes?: number } = {}) {
  const compras = [
    { id: 'v1', numero: 41, creadoEn: new Date('2026-10-10T15:00:00Z'), anulada: false, totalFormateado: '$ 1.000,00' },
    { id: 'v2', numero: 40, creadoEn: new Date('2026-10-09T15:00:00Z'), anulada: true, totalFormateado: '$ 500,00' },
  ]
  const ordenes = [
    { id: 'o1', numero: 7, creadoEn: new Date('2026-10-01T15:00:00Z'), estado: 'LISTO', anulada: false, equipo: 'Samsung A15' },
  ]
  const ventas = over.ventas ?? 2
  const nOrdenes = over.ordenes ?? 1
  return {
    cliente: {
      id: ID, nombre: 'Ana Pérez', telefono: '11 2233-4455', email: null, notas: 'Tarde',
      aceptaOfertas: true, creadoEn: new Date('2026-09-01T15:00:00Z'),
    },
    compras: compras.slice(0, ventas),
    ordenes: ordenes.slice(0, nOrdenes),
    historia: { ventas, ordenes: nOrdenes },
  }
}

async function render(id = ID) {
  const { SidebarProvider } = await import('@/components/ui/sidebar')
  const { default: Ficha } = await import('./page')
  return renderToStaticMarkup(
    <SidebarProvider>{await Ficha({ params: Promise.resolve({ id }) })}</SidebarProvider>,
  )
}

describe('/clientes/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirSesion.mockReset()
    fichaDeCliente.mockReset()
    exigirSesion.mockResolvedValue(sesionDe('EMPLEADO'))
  })

  it('un id que no es uuid es 404 sin consultar', async () => {
    await expect(render('foo')).rejects.toThrow('NOT_FOUND')
    expect(fichaDeCliente).not.toHaveBeenCalled()
  })

  it('un cliente que no existe (o es de otro local) es 404', async () => {
    fichaDeCliente.mockResolvedValue(null)
    await expect(render()).rejects.toThrow('NOT_FOUND')
  })

  it('muestra los datos, las compras enlazadas con la anulada marcada, y las órdenes', async () => {
    fichaDeCliente.mockResolvedValue(ficha())
    const html = await render()
    expect(fichaDeCliente).toHaveBeenCalledWith('tenant-1', ID)
    expect(html).toContain('Ana Pérez')
    expect(html).toContain('value="11 2233-4455"')
    expect(html).toContain('href="/ventas/v1"')
    expect(html).toContain('Venta #41')
    expect(html).toContain('href="/ventas/v2"')
    expect(html).toContain('Anulada')
    expect(html).toContain('href="/servicio-tecnico/o1"')
    expect(html).toContain('Orden #7 · Samsung A15')
    expect(html).toContain('Listo')
    // El consentimiento vuelve tildado.
    expect(html).toMatch(/name="aceptaOfertas" checked=""/)
  })

  it('un empleado no ve "Borrar"', async () => {
    fichaDeCliente.mockResolvedValue(ficha({ ventas: 0, ordenes: 0 }))
    expect(await render()).not.toContain('Borrar cliente')
  })

  it('el dueño ve "Borrar" sin historia, y el porqué con historia', async () => {
    exigirSesion.mockResolvedValue(sesionDe('DUENO'))
    fichaDeCliente.mockResolvedValue(ficha({ ventas: 0, ordenes: 0 }))
    const sin = await render()
    expect(sin).toContain('Borrar cliente')
    expect(sin).toContain('Todavía no tiene compras')

    fichaDeCliente.mockResolvedValue(ficha())
    const con = await render()
    expect(con).not.toContain('Borrar cliente')
    expect(con).toContain('Tiene 2 compras y 1 orden: no se puede borrar.')
  })
})
