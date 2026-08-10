import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'

// Lee headers() a través de tenantDelRequest: render dinámico obligatorio. Una
// respuesta de autenticación cacheada y servida a otro tenant sería la peor
// fuga posible.
export const dynamic = 'force-dynamic'

async function atender(request: Request): Promise<Response> {
  const resolucion = await tenantDelRequest()

  // Sin tenant no hay autenticación: entrar es siempre entrar a un local. El
  // ápex no tiene login, y un subdominio inexistente no debe delatar que no
  // existe con un error distinto al de una ruta cualquiera.
  if (resolucion.tipo !== 'tenant') {
    return new Response('no encontrado', { status: 404 })
  }

  // Un local suspendido no deja entrar a nadie, ni siquiera con la clave
  // correcta. Los datos siguen ahí; el acceso no.
  if (resolucion.tenant.estado === 'SUSPENDIDO') {
    return new Response('cuenta suspendida', { status: 403 })
  }

  const origen = await origenDelRequest(resolucion.subdominio)
  return authParaTenant(resolucion.tenant.id, origen).handler(request)
}

export const GET = atender
export const POST = atender
