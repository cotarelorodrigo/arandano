import { notFound, forbidden } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { exigirSesion } from '@/lib/auth/sesion'
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

function PaginaTenant({
  tenant,
  usuario,
}: {
  tenant: TenantResuelto
  usuario: { nombre: string; rol: 'DUENO' | 'EMPLEADO' }
}) {
  return (
    <main className="p-6">
      {/* El mismo marcador que app/(app)/layout.tsx, y acá hace falta ponerlo
          a mano: `/` no puede vivir bajo (app) —ver el comentario de Home— así
          que no hereda ese layout. Sin esto, `pantalla /` del barrido de
          scripts/smoke.sh no tiene con qué distinguir esta página de un 200
          vacío, y falla aunque la home esté sana. El atributo va ÚLTIMO: React
          emite los atributos en el orden del JSX y el grep busca el `>` pegado
          al nombre. La rama del ápex (PaginaApex) NO lo lleva, a propósito:
          caso_home_responde comprueba justamente que ahí no aparezca. */}
      <h1 className="mb-2 text-xl font-medium" data-testid="tenant-nombre">
        {tenant.nombre}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground" data-testid="usuario-nombre">
        Hola, {usuario.nombre}.
      </p>
      {usuario.rol === 'DUENO' && (
        <a className="underline" href="/usuarios">
          Usuarios
        </a>
      )}
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

  // `/` no puede vivir bajo (app): el ápex entra por la misma ruta y no tiene
  // sesión. Por eso el guard se llama acá a mano, y por eso esta página está en
  // la lista blanca de test/rutas-con-guard.test.ts con esa razón escrita.
  const sesion = await exigirSesion()

  return <PaginaTenant tenant={resolucion.tenant} usuario={sesion.usuario} />
}
