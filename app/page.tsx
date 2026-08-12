import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { exigirSesion } from '@/lib/auth/sesion'
import { Contexto } from '@/components/contexto'

// Redundante con el headers() de tenantDelRequest, que ya obliga a render
// dinámico, y puesto igual: si algún día esta página deja de resolver tenant,
// la marca tiene que sobrevivir al cambio. Una página de tenant cacheada y
// servida a otro tenant es una fuga de datos entre clientes.
export const dynamic = 'force-dynamic'

const estilo = { fontFamily: 'system-ui, sans-serif', padding: '3rem' }

function PaginaApex() {
  return (
    <main style={estilo}>
      <h1>Arándano</h1>
      <p>Acá va a vivir el sitio público. Cada negocio entra por su subdominio.</p>
      <Contexto />
    </main>
  )
}

/**
 * `/` no es una pantalla: es la aplicación abierta en la pestaña por defecto.
 *
 * Para un tenant con sesión esto redirige y no renderiza nada. La pantalla que
 * se ve es /vender, y ahí el shell de app/(app)/layout.tsx pone la navegación,
 * la identidad y el contexto.
 *
 * El ápex se queda: llega por DNS y no por path, así que no hay forma de
 * sacarlo a otra ruta. Eso es lo que impide que este archivo viva bajo (app).
 */
export default async function Home() {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'apex') return <PaginaApex />

  // notFound() y forbidden() están tipadas como `never`, así que TypeScript
  // angosta `resolucion` a la variante 'tenant' de acá para abajo solo.
  if (resolucion.tipo !== 'tenant') notFound()

  // ANTES del redirect, y no es cuestión de estilo: un tenant suspendido tiene
  // que ver el 403 y no ser mandado a /vender para que ahí lo rebote otra cosa
  // sin decirle por qué.
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // El guard se llama acá a mano porque esta página no vive bajo (app) — el
  // ápex entra por la misma ruta y no tiene sesión. Está declarada en
  // test/rutas-con-guard.test.ts con esa razón escrita.
  await exigirSesion()

  redirect('/vender')
}
