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

  // El título, el subtítulo, el layout centrado de 760px y el "Cancelar" que
  // reemplaza al viejo link "← Inventario" viven ahora en FormularioDeAlta:
  // "Guardar artículo" subió al Topbar (design/arandano.pen, frame `B4O7t`) y
  // ese botón necesita el mismo <form> que envuelve el <Encabezado>, así que
  // el componente entero pasó a armar la pantalla completa. Ver su comentario.
  return <FormularioDeAlta proximoSku={formatearProximoSku(tenant?.proximoSkuArticulo ?? 1)} />
}
