import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { sesionActual } from '@/lib/auth/sesion'
import { FormularioLogin } from './formulario'

export const dynamic = 'force-dynamic'

export default async function Login() {
  const resolucion = await tenantDelRequest()

  // No hay login en el ápex: entrar es siempre entrar a un local.
  if (resolucion.tipo !== 'tenant') notFound()
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // Ya logueado, esta pantalla no tiene sentido.
  if (await sesionActual()) redirect('/')

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <FormularioLogin nombreDelLocal={resolucion.tenant.nombre} />
    </main>
  )
}
