import type { MetadataRoute } from 'next'
import { notFound } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'

/**
 * El manifest es del LOCAL, no del producto.
 *
 * Cada tenant es su propio origen (`flor.arandano.app`), así que el navegador
 * trata cada local como una aplicación distinta: cada dueño instala su negocio
 * con su nombre y su ícono, y el aislamiento lo da la misma frontera de origen
 * que ya usa Better Auth.
 *
 * `force-dynamic` porque el contenido depende del Host, igual que toda página
 * de tenant: un manifest cacheado y servido a otro local diría el nombre
 * equivocado.
 */
export const dynamic = 'force-dynamic'

// Copiados a mano de app/globals.css: un manifest es JSON y no resuelve
// var(--token). test/manifest.test.ts los compara contra los tokens reales,
// así que un repintado de la paleta que se olvide de acá rompe el build.
const MARCA = '#2a1760'
const FONDO = '#f6f5f9'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const resolucion = await tenantDelRequest()

  // El ápex, los reservados, los inexistentes y los ajenos no tienen manifest:
  // la landing se comparte por link, no se instala.
  if (resolucion.tipo !== 'tenant') notFound()

  const nombre = resolucion.tenant.nombre

  return {
    name: nombre,
    short_name: nombre,
    // '/' y no el destino de cada rol: app/page.tsx ya redirige con
    // destinoAlEntrar(). Ver el caso del test que lo explica.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: MARCA,
    background_color: FONDO,
    icons: [
      { src: '/icono/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icono/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icono/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
