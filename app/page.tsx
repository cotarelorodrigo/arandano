import type { Metadata } from 'next'
import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { piezasDeOrigen } from '@/lib/auth/origen'
import { exigirSesion } from '@/lib/auth/sesion'
import { destinoAlEntrar } from '@/lib/auth/destino'
import { Landing } from '@/app/sitio/landing'
import type { BaseDeTenant } from '@/app/sitio/entrar'

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

  const { protocolo, dominioBase, puerto } = await piezasDeOrigen()

  return {
    // Sin esto, Next no puede convertir app/opengraph-image.tsx en una URL
    // absoluta de og:image y cae al fallback http://localhost:3000 — inalcanzable
    // desde afuera del contenedor para WhatsApp, Instagram o cualquier crawler.
    // Confirmado sirviendo esta misma ruta con y sin esta línea: sin ella,
    // og:image sale con el host interno; con ella, con el dominio real.
    //
    // Va en esta rama y no en el layout raíz a propósito: esta base es la del
    // ápex, y una página de tenant vive en un subdominio, así que ahí sería la
    // equivocada. Las páginas de tenant no tienen imagen social ni se indexan
    // (ver la rama de arriba), así que no la necesitan.
    //
    // Sale de piezasDeOrigen() y no de un `https://` cableado con DOMINIO_BASE:
    // es la misma fuente que usa el link de "Ya tengo cuenta" más abajo, y por
    // el mismo motivo. Con el protocolo y el puerto cableados, en dev el
    // og:image resolvía a https://dev.arandano.app/opengraph-image —sin puerto
    // y por HTTPS—, o sea inalcanzable: pegar el ápex de dev en un WhatsApp
    // daba una vista previa rota. En producción no cambia nada, que es lo que
    // se quiere: ahí el protocolo ya es https y PUERTO_PUBLICO no está definida.
    metadataBase: new URL(`${protocolo}://${dominioBase}${puerto}`),
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

// Sincrónico a propósito, con `base` ya resuelto por Home: si esta función
// fuera async, el elemento que devuelve Home dejaría de poder renderizarse con
// renderToStaticMarkup, que es el único método de render que tienen los tests
// de este repo (no hay jsdom). El await vive en Home, que ya era async.
function PaginaApex({ base }: { base: BaseDeTenant }) {

  // Sin default: un wa.me con un número vacío manda a la nada, y un número
  // inventado manda al WhatsApp de un desconocido. Si falta, la landing sale
  // sin el link.
  const whatsapp = process.env.WHATSAPP_CONTACTO ?? ''

  return <Landing base={base} whatsapp={whatsapp} />
}

/**
 * `/` no es una pantalla: es la aplicación abierta en la pestaña por defecto.
 *
 * Para un tenant con sesión esto redirige y no renderiza nada. El destino
 * depende del rol —`destinoAlEntrar`, lib/auth/destino.ts—: un `DUENO` cae en
 * /dashboard, un `EMPLEADO` en /vender. En cualquiera de los dos, el shell de
 * app/(app)/layout.tsx pone la navegación, la identidad y el contexto.
 *
 * El ápex se queda: llega por DNS y no por path, así que no hay forma de
 * sacarlo a otra ruta. Eso es lo que impide que este archivo viva bajo (app).
 */
export default async function Home() {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'apex') {
    // Las tres piezas con las que se direcciona un tenant, de la misma función
    // que arma el baseURL de Better Auth: el link de "Ya tengo cuenta" tiene
    // que llevar el protocolo y el puerto de ESTE entorno, no un https://
    // cableado que en dev apunta a una dirección que no existe.
    //
    // piezasDeOrigen() también tira si falta DOMINIO_BASE, igual que
    // tenantDelRequest(), así que acá no hay ningún caso nuevo que atajar.
    const { protocolo, dominioBase, puerto } = await piezasDeOrigen()
    return <PaginaApex base={{ protocolo, dominio: dominioBase, puerto }} />
  }

  // notFound() y forbidden() están tipadas como `never`, así que TypeScript
  // angosta `resolucion` a la variante 'tenant' de acá para abajo solo.
  if (resolucion.tipo !== 'tenant') notFound()

  // ANTES del redirect, y no es cuestión de estilo: un tenant suspendido tiene
  // que ver el 403 y no ser mandado a su destino habitual para que ahí lo
  // rebote otra cosa sin decirle por qué.
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // El guard se llama acá a mano porque esta página no vive bajo (app) — el
  // ápex entra por la misma ruta y no tiene sesión. Está declarada en
  // test/rutas-con-guard.test.ts con esa razón escrita.
  const sesion = await exigirSesion()

  redirect(destinoAlEntrar(sesion.usuario.rol))
}
