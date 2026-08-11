import Link from 'next/link'
import { exigirDuenio } from '@/lib/auth/sesion'
import { FormularioDeAlta } from '../formularios'

export const dynamic = 'force-dynamic'

export default async function ArticuloNuevo() {
  // El guard va acá además de en la action: la pantalla no se muestra Y la
  // action rechaza. Ninguna de las dos es suficiente sola.
  await exigirDuenio()

  return (
    <main className="p-6">
      <Link href="/inventario" className="text-sm underline">
        ← Inventario
      </Link>
      <h1 className="mt-4 mb-6 text-xl font-medium">Artículo nuevo</h1>
      <FormularioDeAlta />
    </main>
  )
}
