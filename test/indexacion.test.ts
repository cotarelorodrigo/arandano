import { describe, it, expect, vi, beforeEach } from 'vitest'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

// metadataBase sale de piezasDeOrigen(), que lee x-forwarded-proto. Se mockea el
// header y no la función, para que el test ejercite la lista blanca de verdad.
const cabeceras = vi.hoisted(() => ({ proto: 'https' }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-proto': cabeceras.proto }),
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
    // Antes este caso no la seteaba y pasaba igual: metadataBase se armaba con
    // `https://${process.env.DOMINIO_BASE}`, y con la variable ausente eso da la
    // URL válida `https://undefined`. Ahora piezasDeOrigen() tira, que es lo que
    // corresponde — es la misma variable sin la cual no se resuelve ni un tenant.
    process.env.DOMINIO_BASE = 'arandano.app'
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

  // El defecto que cerró la review: con el protocolo y el puerto cableados, en
  // dev el og:image resolvía a una dirección inalcanzable y la vista previa de
  // un WhatsApp salía rota. Es el mismo cableado que tenía el link de "Ya tengo
  // cuenta", una función más abajo en el mismo archivo.
  it('y en dev lo trae con el protocolo y el puerto reales', async () => {
    process.env.DOMINIO_BASE = 'dev.arandano.app'
    process.env.PUERTO_PUBLICO = '3000'
    cabeceras.proto = 'http'
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    try {
      const { generateMetadata } = await import('@/app/page')
      const meta = await generateMetadata()
      expect(meta.metadataBase).toEqual(new URL('http://dev.arandano.app:3000'))
    } finally {
      delete process.env.PUERTO_PUBLICO
      cabeceras.proto = 'https'
    }
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
