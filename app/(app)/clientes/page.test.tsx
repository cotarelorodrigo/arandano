import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// La sesión y la consulta son de otros módulos (y tienen sus tests contra la
// base): acá importa qué pide la pantalla y qué dibuja para cada quien.
const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({ exigirSesion: () => exigirSesion() }))

const clientesDelListado = vi.fn()
vi.mock('@/lib/clientes/consultar', () => ({
  clientesDelListado: (...a: unknown[]) => clientesDelListado(...a),
}))

vi.mock('./acciones', () => ({
  altaDeCliente: async () => ({ error: null, aviso: null }),
  edicionDeCliente: async () => ({ error: null, aviso: null }),
  bajaDeCliente: async () => ({ error: null, aviso: null }),
  exportarClientes: async () => '',
  buscarClientesDelLocal: async () => [],
}))

function sesionDe(rol: 'DUENO' | 'EMPLEADO') {
  return {
    tenant: { id: 'tenant-1', nombre: 'Local de prueba', estado: 'ACTIVO' },
    usuario: { id: 'u-1', nombre: 'Alguien', rol },
    subdominio: 'prueba',
  }
}

const UNO = {
  id: '0190a8f2-0000-7000-8000-000000000001',
  nombre: 'Ana Pérez',
  telefono: '11 2233-4455',
  email: 'ana@ejemplo.test',
  notas: null,
  aceptaOfertas: true,
  creadoEn: new Date('2026-10-01T15:00:00Z'),
  compras: 3,
  ultimaCompra: new Date('2026-10-15T15:00:00Z'),
}

async function render(searchParams: Record<string, string> = {}) {
  const { SidebarProvider } = await import('@/components/ui/sidebar')
  const { default: Clientes } = await import('./page')
  return renderToStaticMarkup(
    <SidebarProvider>{await Clientes({ searchParams: Promise.resolve(searchParams) })}</SidebarProvider>,
  )
}

describe('/clientes', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirSesion.mockReset()
    clientesDelListado.mockReset()
    exigirSesion.mockResolvedValue(sesionDe('EMPLEADO'))
  })

  // El smoke del deploy abre /clientes con el canario recién creado: sin
  // clientes tiene que dibujar, sin errores, lo que dice dónde nacen.
  it('vacío, dibuja el estado sin clientes', async () => {
    clientesDelListado.mockResolvedValue({ clientes: [], total: 0 })
    const html = await render()
    expect(html).toContain('Todavía no hay clientes')
    expect(html).toContain('0 clientes')
  })

  it('una fila por cliente, con su enlace, contacto, compras y el chip de ofertas', async () => {
    clientesDelListado.mockResolvedValue({ clientes: [UNO], total: 1 })
    const html = await render()
    expect(html).toContain(`href="/clientes/${UNO.id}"`)
    expect(html).toContain('Ana Pérez')
    expect(html).toContain('11 2233-4455 · ana@ejemplo.test')
    expect(html).toContain('3 compras')
    expect(html).toContain('Acepta ofertas')
  })

  it('pasa la búsqueda y el filtro de la URL a la consulta, con el tope', async () => {
    clientesDelListado.mockResolvedValue({ clientes: [], total: 0 })
    const { TOPE_DEL_LISTADO } = await import('./page')
    const html = await render({ q: '  ana ', ofertas: '1' })
    expect(clientesDelListado).toHaveBeenCalledWith(
      'tenant-1', { texto: 'ana', soloAceptanOfertas: true }, TOPE_DEL_LISTADO,
    )
    expect(html).toContain('Nadie coincide con la búsqueda.')
    // El checkbox vuelve tildado y el buscador con lo buscado.
    expect(html).toMatch(/name="ofertas" checked=""/)
    expect(html).toContain('value="ana"')
  })

  it('"Exportar CSV" sólo para el dueño', async () => {
    clientesDelListado.mockResolvedValue({ clientes: [UNO], total: 1 })
    expect(await render()).not.toContain('Exportar CSV')
    exigirSesion.mockResolvedValue(sesionDe('DUENO'))
    expect(await render()).toContain('Exportar CSV')
  })

  it('"Cliente nuevo" para cualquiera', async () => {
    clientesDelListado.mockResolvedValue({ clientes: [], total: 0 })
    expect(await render()).toContain('Cliente nuevo')
  })
})

describe('avisoDelListado', () => {
  it('dice cuando el tope cortó la lista', async () => {
    const { avisoDelListado } = await import('./page')
    expect(avisoDelListado({ mostrados: 200, total: 640, filtrando: false })).toBe(
      'Se ven los primeros 200 de 640: buscá para encontrar al resto.',
    )
    expect(avisoDelListado({ mostrados: 3, total: 3, filtrando: true })).toBeNull()
    expect(avisoDelListado({ mostrados: 0, total: 0, filtrando: false })).toBeNull()
  })
})

describe('filaDeCliente', () => {
  it('sin teléfono ni email no inventa un contacto, y una compra va en singular', async () => {
    const { filaDeCliente } = await import('./page')
    const f = filaDeCliente({ ...UNO, telefono: null, email: null, compras: 1, ultimaCompra: null })
    expect(f.contacto).toBeNull()
    expect(f.compras).toBe('1 compra')
    expect(f.alta).toBe('01/10/2026')
  })
})
