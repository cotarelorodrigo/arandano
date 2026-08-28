import { Prisma } from '@/generated/prisma/client'
import { Encabezado } from '@/components/shell/encabezado'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { planesDelTenant } from '@/lib/planes/consultar'
import { precioConPlan } from '@/lib/planes/precio'
import { ROTULO_MEDIO } from '@/lib/ventas/medios'
import { formatearPrecio, formatearPorcentaje } from '@/lib/formato/mostrar'
import { CuerpoFormasDePago, DialogoDePlan, type FilaDePlan } from './formularios'

export const dynamic = 'force-dynamic'

/**
 * El artículo de referencia del ejemplo de cada fila.
 *
 * Un número redondo y FIJO, no el precio de un artículo real: sirve para leer
 * el porcentaje, no para cotizar nada. Con un artículo del catálogo, el ejemplo
 * cambiaría cada vez que alguien le toca el precio a ese artículo, sin que el
 * plan haya cambiado en nada — y quien mire la tabla creería que se movió el
 * recargo.
 */
const EJEMPLO = new Prisma.Decimal('10000')

export default async function FormasDePago() {
  // La pantalla exige el permiso además de cada action: sin esto, un empleado
  // sin PLANES_PAGO vería la tabla entera aunque no pudiera tocar nada.
  const sesion = await exigirPermiso('PLANES_PAGO')

  // Con los dados de baja: son parte del historial del local y hay que poder
  // reactivarlos desde acá. El listado los distingue.
  const planes = await planesDelTenant(sesion.tenant.id, { incluirDesactivados: true })

  // El precio derivado se calcula ACÁ, en el servidor, y viaja formateado:
  // `precioConPlan` vive del lado de Prisma (Decimal), que no cruza al bundle
  // de cliente. Es además la misma función que va a usar la ficha del
  // artículo, así que las dos pantallas no pueden decir números distintos.
  const filas: FilaDePlan[] = planes.map((p) => ({
    id: p.id,
    nombre: p.nombre,
    rotuloMedio: ROTULO_MEDIO[p.medio],
    cuotas: p.cuotas,
    porcentaje: p.porcentaje,
    porcentajeMostrado: formatearPorcentaje(p.porcentaje),
    orden: p.orden,
    ejemplo: formatearPrecio(precioConPlan(EJEMPLO, new Prisma.Decimal(p.porcentaje)).toString()),
    desactivado: p.desactivadoEn !== null,
  }))

  const activos = filas.filter((f) => !f.desactivado).length
  const deBaja = filas.length - activos

  return (
    <>
      <Encabezado
        titulo="Formas de pago"
        subtitulo={
          <>
            {activos === 1 ? '1 plan activo' : `${activos} planes activos`}
            {deBaja > 0 && (deBaja === 1 ? ' · 1 dado de baja' : ` · ${deBaja} dados de baja`)}
          </>
        }
        // Un elemento y no una función: pasarle una función como prop a un
        // Client Component es lo que Next rechaza en runtime con el build en
        // verde (ver CLAUDE.md, ciclo de la UI de categorías). Acá `Encabezado`
        // es de servidor y sólo coloca el nodo donde va.
        acciones={<DialogoDePlan />}
        // La copia del teléfono. `controlMovil` y no `accionMovil` porque el
        // alta es un diálogo con estado propio, no una navegación a otra URL
        // — ver el docblock de esas dos props en `Encabezado`.
        controlMovil={<DialogoDePlan movil />}
      />
      <CuerpoFormasDePago planes={filas} ejemploBase={formatearPrecio(EJEMPLO.toString())} />
    </>
  )
}
