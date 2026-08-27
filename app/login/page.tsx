import type { Metadata } from 'next'
import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { sesionActual } from '@/lib/auth/sesion'
import { piezasDeOrigen } from '@/lib/auth/origen'
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

  // Sólo el dominio base: el pie (design/arandano.pen, nodo `y8KkFc`) muestra
  // "flor.arandano.app", sin protocolo ni puerto — es una etiqueta para leer,
  // no un link. piezasDeOrigen() y no DOMINIO_BASE crudo: es la misma fuente
  // que arma el baseURL de Better Auth, y ya vive detrás de la lista blanca de
  // protocolo que ese archivo explica.
  const { dominioBase } = await piezasDeOrigen()
  const dominio = `${resolucion.subdominio}.${dominioBase}`

  return (
    <main className="flex min-h-full flex-col lg:flex-row">
      {/* El paño. La jerarquía es la decisión: el nombre del local grande y
          "Arándano" chico arriba. Quien entra acá labura en su negocio, no en
          nuestra plataforma — el cartel es del local y la marca firma abajo.
          Tres bloques con justify-content: space-between (ver persiana.module.css):
          Marca arriba, el nombre del local + su bajada en el medio, el pie
          abajo.

          Task 11 del ciclo móvil (design/arandano.pen, frame `Móvil / Login`,
          `Kp4Eg`): en el teléfono el paño se acuesta — franja de 300px de
          alto arriba de todo (`h-[300px]`, `gap-4`, padding [26,22]) — y en
          escritorio vuelve a ser la columna de siempre (`lg:h-auto`, sin gap
          propio porque space-between ya reparte el espacio con sólo 2 hijos
          visibles, `lg:p-12`). El PIE (la URL del tenant) NO viaja acá abajo
          en el teléfono: el nodo `eY0BS` lo muda al fondo del formulario, así
          que se oculta en esta mitad (`hidden lg:flex`) y reaparece dentro de
          `FormularioLogin`, con otro color (ver el comentario de ahí) — nunca
          desaparece sin más. */}
      <section
        className={`${estilos.pano} relative flex h-[300px] flex-col gap-4 overflow-hidden p-[26px_22px] lg:h-auto lg:gap-0 lg:p-12`}
      >
        <div className={estilos.persiana} aria-hidden="true" />

        <div className="flex items-center gap-[9px]">
          <span className={estilos.logo} aria-hidden="true" />
          <p className={estilos.arandano}>Arándano</p>
        </div>

        <div className="flex flex-col gap-2 lg:max-w-[560px] lg:gap-[14px]">
          {/* El testid lo consume scripts/smoke.sh (caso_tenant_resuelve) para
              verificar que el subdominio resolvió al tenant correcto. Dos cosas
              no se pueden tocar sin mover ese caso en el mismo commit: el
              atributo tiene que ser el ÚLTIMO antes de los hijos —el grep busca
              `data-testid="tenant-nombre">` pegado al nombre— y el nombre tiene
              que ser texto directo, sin un <span> en el medio. */}
          <h1 className={estilos.nombre} data-testid="tenant-nombre">
            {resolucion.tenant.nombre}
          </h1>
          <p className={estilos.bajada}>
            Ventas, stock, caja y servicio técnico del local. Entrá con tu usuario para empezar el
            día.
          </p>
        </div>

        <div className="hidden flex-col gap-1 lg:flex">
          <p className={estilos.pieUrl}>{dominio}</p>
          <p className={estilos.pieNota}>Cada local entra por su propia dirección.</p>
        </div>
      </section>

      {/* Debajo del paño en el teléfono, centrado en escritorio. En el
          teléfono este envoltorio ya no centra: `FormularioLogin` pasa a
          `flex-1` para ocupar todo el alto que queda y poder empujar su
          propio pie (ver más abajo) hasta el fondo. En escritorio, el
          centrado es lo que le da al formulario el mismo eje vertical que el
          cartel. */}
      <div className="flex flex-1 px-[22px] py-6 lg:items-center lg:justify-center lg:p-12">
        <FormularioLogin dominio={dominio} />
      </div>
    </main>
  )
}
