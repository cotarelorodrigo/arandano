import Link from 'next/link'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirDuenio } from '@/lib/auth/sesion'
import { FormularioDeAlta } from '../formularios'

export const dynamic = 'force-dynamic'

export default async function ArticuloNuevo() {
  // El guard va acá además de en la action: la pantalla no se muestra Y la
  // action rechaza. Ninguna de las dos es suficiente sola.
  await exigirDuenio()

  return (
    <>
      <Encabezado titulo="Artículo nuevo" subtitulo="Se agrega al catálogo del local" />
      <div className="p-6">
        {/* mb-6: el margen inferior que antes traía el título (mt-4 mb-6,
            ahora en el Encabezado) y que el cuerpo sigue necesitando. */}
        <Link href="/inventario" className="mb-6 block text-sm underline">
          ← Inventario
        </Link>
        <FormularioDeAlta />
      </div>
    </>
  )
}
