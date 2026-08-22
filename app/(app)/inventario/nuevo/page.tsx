import Link from 'next/link'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { FormularioDeAlta } from '../formularios'

export const dynamic = 'force-dynamic'

/**
 * El código que le tocaría al PRÓXIMO artículo autogenerado, sólo para
 * mostrarlo como ayuda (design/arandano.pen, nodo `zYwkC`).
 *
 * Mismo formato que `proximoSku()` en lib/inventario/articulos.ts
 * (`A-0043`), duplicado acá a propósito: esa función vive en el módulo de
 * `lib/inventario/` que este ciclo no toca, corre dentro de una transacción
 * y **incrementa** el correlativo con un `UPDATE … RETURNING` — todo lo
 * contrario de lo que hace falta acá, que es sólo leer un número para
 * mostrarlo.
 */
export function formatearProximoSku(proximo: number): string {
  return `A-${String(proximo).padStart(4, '0')}`
}

export default async function ArticuloNuevo() {
  // El guard va acá además de en la action: la pantalla no se muestra Y la
  // action rechaza. Ninguna de las dos es suficiente sola.
  const sesion = await exigirDuenio()

  const prisma = prismaParaTenant(sesion.tenant.id)
  // Sólo LECTURA: a diferencia de `proximoSku()`, esto no incrementa
  // `proximoSkuArticulo` ni corre dentro de ninguna transacción — es apenas
  // el número que HOY le tocaría al próximo alta, para mostrarlo como ayuda.
  // Si dos personas abren esta pantalla a la vez, las dos ven el mismo
  // número; el que de verdad importa se pide recién al guardar, adentro de
  // `crearArticulo`. Puede haber huecos en la numeración y es a propósito
  // (CLAUDE.md) — este texto se lo dice a quien está cargando el artículo.
  const tenant = await prisma.tenant.findUnique({
    where: { id: sesion.tenant.id },
    select: { proximoSkuArticulo: true },
  })

  return (
    <>
      <Encabezado titulo="Artículo nuevo" subtitulo="Se agrega al catálogo del local" />
      {/* alignItems center (design/arandano.pen, nodo `g9JyG`): el formulario
          queda centrado en un ancho fijo, no ocupa todo el ancho disponible —
          único Cuerpo de las tres pantallas de este ciclo con esta
          propiedad. */}
      <div className="flex flex-col items-center gap-4 p-6">
        <div className="flex w-[760px] flex-col gap-4">
          <Link href="/inventario" className="block text-sm underline">
            ← Inventario
          </Link>
          <FormularioDeAlta proximoSku={formatearProximoSku(tenant?.proximoSkuArticulo ?? 1)} />
        </div>
      </div>
    </>
  )
}
