import { notFound, forbidden } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import type { TenantResuelto } from '@/lib/tenant/resolver'

// Redundante con el headers() de tenantDelRequest, que ya obliga a render
// dinámico, y puesto igual: si algún día esta página deja de resolver tenant,
// la marca tiene que sobrevivir al cambio. Una página de tenant cacheada y
// servida a otro tenant es una fuga de datos entre clientes.
export const dynamic = 'force-dynamic'

const estilo = { fontFamily: 'system-ui, sans-serif', padding: '3rem' }

/** Stack e imagen: la verificación humana más barata que existe después de un
 *  deploy. Estaba en la versión anterior de esta página y se conserva. */
function Contexto() {
  return (
    <dl>
      <dt>Stack</dt>
      <dd data-testid="stack">{process.env.ARANDANO_STACK ?? 'desconocido'}</dd>
      <dt>Imagen</dt>
      <dd data-testid="sha">{process.env.GIT_SHA ?? 'dev'}</dd>
    </dl>
  )
}

function PaginaTenant({ tenant }: { tenant: TenantResuelto }) {
  return (
    <main style={estilo}>
      <h1>{tenant.nombre}</h1>
      <dl>
        <dt>Tenant</dt>
        <dd data-testid="tenant-nombre">{tenant.nombre}</dd>
        <dt>Estado</dt>
        <dd data-testid="tenant-estado">{tenant.estado}</dd>
      </dl>
      <Contexto />
    </main>
  )
}

function PaginaApex() {
  return (
    <main style={estilo}>
      <h1>Arándano</h1>
      <p>Acá va a vivir el sitio público. Cada negocio entra por su subdominio.</p>
      <Contexto />
    </main>
  )
}

export default async function Home() {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'apex') return <PaginaApex />

  // notFound() y forbidden() están tipadas como `never`, así que TypeScript
  // angosta `resolucion` a la variante 'tenant' de acá para abajo solo. Un
  // switch con fallthrough haría lo mismo al costo de un eslint-disable.
  if (resolucion.tipo !== 'tenant') notFound()
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  return <PaginaTenant tenant={resolucion.tenant} />
}
