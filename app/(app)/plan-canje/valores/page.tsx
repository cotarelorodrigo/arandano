import Link from 'next/link'
import { Encabezado } from '@/components/shell/encabezado'
import { Button } from '@/components/ui/button'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { tablaDeCanje } from '@/lib/canje/consultar'
import { CuerpoValores } from './formularios'

export const dynamic = 'force-dynamic'

/**
 * La tabla del plan canje: cuánto paga el local por cada usado, según el
 * modelo y el rango de batería.
 *
 * La pantalla exige `CANJE_VALORES` además de cada action: sin esto, un
 * vendedor vería la tabla entera con sus botones aunque no pudiera tocar nada.
 * Los vendedores la consultan a través de la calculadora (`/plan-canje`), que
 * muestra un valor por vez y no la tabla.
 *
 * La tabla viaja como texto (`TablaDeCanje`), así que no hay ningún `Decimal`
 * que convertir acá: `tablaDeCanje` ya lo hace en el borde.
 */
export default async function ValoresDelPlanCanje() {
  const sesion = await exigirPermiso('CANJE_VALORES')
  const tabla = await tablaDeCanje(sesion.tenant.id)

  const modelos = tabla.modelos.length
  const rangos = tabla.rangos.length

  return (
    <>
      <Encabezado
        titulo="Valores del plan canje"
        subtitulo={
          <>
            {modelos === 1 ? '1 modelo' : `${modelos} modelos`}
            {' · '}
            {rangos === 1 ? '1 rango de batería' : `${rangos} rangos de batería`}
            {' · en '}
            {tabla.moneda === 'USD' ? 'dólares' : 'pesos'}
          </>
        }
        // Vuelve a la calculadora: esta pantalla es su trastienda, y en el
        // teléfono la ranura izquierda es la flecha en vez del menú.
        atras="/plan-canje"
        // Y en escritorio, donde la ranura izquierda no existe, el mismo
        // camino de vuelta como acción del Topbar.
        acciones={
          <Button asChild variant="outline" size="sm">
            <Link href="/plan-canje">Ir a la calculadora</Link>
          </Button>
        }
      />
      <CuerpoValores moneda={tabla.moneda} rangos={tabla.rangos} modelos={tabla.modelos} />
    </>
  )
}
