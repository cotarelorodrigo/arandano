import type { Metadata } from 'next'
import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { sesionActual } from '@/lib/auth/sesion'
import { FormularioLogin } from './formulario'
import estilos from './persiana.module.css'

export const dynamic = 'force-dynamic'

// El login no cuelga de (app), así que no hereda su noindex: lleva el propio.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function Login() {
  const resolucion = await tenantDelRequest()

  // No hay login en el ápex: entrar es siempre entrar a un local.
  if (resolucion.tipo !== 'tenant') notFound()
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // Ya logueado, esta pantalla no tiene sentido. Directo a /vender y no a /:
  // desde que / redirige a /vender, pasar por ahí sería un salto de más.
  if (await sesionActual()) redirect('/vender')

  return (
    <main className="flex min-h-full flex-col md:flex-row">
      {/* El paño. La jerarquía es la decisión: el nombre del local grande y
          "Arándano" chico arriba. Quien entra acá labura en su negocio, no en
          nuestra plataforma — el cartel es del local y la marca firma abajo. */}
      <section
        className={`${estilos.pano} relative flex flex-col overflow-hidden p-8 md:p-12`}
      >
        <div className={estilos.persiana} aria-hidden="true" />
        <p className={`${estilos.arandano} mb-3`}>Arándano</p>
        {/* El testid lo consume scripts/smoke.sh (caso_tenant_resuelve) para
            verificar que el subdominio resolvió al tenant correcto. Dos cosas
            no se pueden tocar sin mover ese caso en el mismo commit: el
            atributo tiene que ser el ÚLTIMO antes de los hijos —el grep busca
            `data-testid="tenant-nombre">` pegado al nombre— y el nombre tiene
            que ser texto directo, sin un <span> en el medio. */}
        <h1 className={estilos.nombre} data-testid="tenant-nombre">
          {resolucion.tenant.nombre}
        </h1>
      </section>

      {/* Arriba en el teléfono, centrado en escritorio. Centrarlo también en el
          teléfono dejaba medio metro de blanco entre el cartel y el campo de
          mail; en escritorio, en cambio, el centrado es lo que le da al
          formulario el mismo eje vertical que el cartel. */}
      <div className="flex flex-1 items-start justify-center p-6 md:items-center md:p-12">
        <FormularioLogin />
      </div>
    </main>
  )
}
