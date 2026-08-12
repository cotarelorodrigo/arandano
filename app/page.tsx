import type { Metadata } from 'next'
import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { exigirSesion } from '@/lib/auth/sesion'
import { Landing } from '@/app/sitio/landing'

const TITULO = 'Arándano — el sistema para tu negocio'
const DESCRIPCION =
  'Ventas, stock, caja en pesos y dólares, facturación y un bot que atiende por WhatsApp. ' +
  'Para cualquier negocio argentino, en un solo lugar.'

/**
 * El ápex se indexa; una página de tenant NO.
 *
 * Un local no quiere su punto de venta en Google, y hasta este ciclo nada lo
 * impedía. Se decide acá y no en un robots.txt porque un robots.txt sería el
 * mismo archivo para el ápex y para todos los subdominios — justamente la
 * distinción que hay que hacer. `test/indexacion.test.ts` lo fija.
 */
export async function generateMetadata(): Promise<Metadata> {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo !== 'apex') {
    return { robots: { index: false, follow: false } }
  }

  return {
    title: TITULO,
    description: DESCRIPCION,
    openGraph: { title: TITULO, description: DESCRIPCION, type: 'website' },
  }
}

// Redundante con el headers() de tenantDelRequest, que ya obliga a render
// dinámico, y puesto igual: si algún día esta página deja de resolver tenant,
// la marca tiene que sobrevivir al cambio. Una página de tenant cacheada y
// servida a otro tenant es una fuga de datos entre clientes.
export const dynamic = 'force-dynamic'

function PaginaApex() {
  // DOMINIO_BASE ya es obligatoria: tenantDelRequest() tira si falta, y este
  // render ocurre después de esa llamada. El `!` no esconde un caso posible.
  const dominio = process.env.DOMINIO_BASE!

  // Sin default: un wa.me con un número vacío manda a la nada, y un número
  // inventado manda al WhatsApp de un desconocido. Si falta, la landing sale
  // sin el link.
  const whatsapp = process.env.WHATSAPP_CONTACTO ?? ''

  return <Landing dominio={dominio} whatsapp={whatsapp} />
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
