import { describe, it, expect, vi, beforeEach } from 'vitest'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

/**
 * Un local no quiere su punto de venta en Google, y hasta este ciclo nada lo
 * impedía. La regla es simple y este archivo la sostiene: el ápex se indexa,
 * todo lo que sea de un tenant no.
 */
describe('indexación', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
  })

  it('el ápex se indexa y tiene metadata de marketing', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    const { generateMetadata } = await import('@/app/page')
    const meta = await generateMetadata()
    expect(meta.title).toBeTruthy()
    expect(meta.description).toBeTruthy()
    expect(meta.robots).toBeUndefined()
    expect(meta.openGraph).toBeTruthy()
  })

  // Sin metadataBase, Next arma la URL absoluta de og:image contra el
  // fallback http://localhost:3000 — inalcanzable para WhatsApp, Instagram o
  // cualquier crawler leyendo arandano.app desde afuera del contenedor. Esta
  // rama es dinámica (force-dynamic) y no corre en `next build`, así que el
  // build nunca ejercita este valor — este test es lo único que lo verifica.
  it('el ápex trae metadataBase con el dominio del ápex', async () => {
    process.env.DOMINIO_BASE = 'arandano.app'
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    const { generateMetadata } = await import('@/app/page')
    const meta = await generateMetadata()
    expect(meta.metadataBase).toEqual(new URL('https://arandano.app'))
  })

  it('una página de tenant no se indexa', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
      subdominio: 'flor',
    })
    const { generateMetadata } = await import('@/app/page')
    const meta = await generateMetadata()
    expect(meta.robots).toMatchObject({ index: false })
  })

  it('el shell de la aplicación no se indexa', async () => {
    const { metadata } = await import('@/app/(app)/layout')
    expect(metadata.robots).toMatchObject({ index: false })
  })

  it('el login no se indexa', async () => {
    const { metadata } = await import('@/app/login/page')
    expect(metadata.robots).toMatchObject({ index: false })
  })
})
