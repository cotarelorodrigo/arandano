import Link from 'next/link'
import { Table2 } from 'lucide-react'
import { Encabezado } from '@/components/shell/encabezado'
import { Button } from '@/components/ui/button'
import { exigirSesion } from '@/lib/auth/sesion'
import { puedeConSesion } from '@/lib/permisos/guarda'
import { tablaDeCanje } from '@/lib/canje/consultar'
import { Calculadora } from './calculadora'

export const dynamic = 'force-dynamic'

/**
 * La calculadora del plan canje: cuánto paga el cliente por el equipo nuevo
 * entregando su usado.
 *
 * **Cualquier usuario con sesión**, sin permiso: es la mitad del pedido —el
 * vendedor consulta la tabla sin tener que encontrar al dueño— y no escribe
 * nada. La tabla entera viaja al navegador (es chica: decenas de modelos por
 * cinco rangos) y la cuenta corre allá, con cada tecla.
 *
 * Que la tabla viaje entera no le muestra al vendedor nada que la calculadora
 * no le diría de todos modos probando combinaciones; lo que no tiene es la
 * PANTALLA de la tabla, que es la de editar.
 *
 * El enlace a `/plan-canje/valores` sólo para quien puede editarla: un enlace
 * a una pantalla que responde 403 es una puerta pintada.
 */
export default async function PlanCanje() {
  const sesion = await exigirSesion()
  const [tabla, puedeEditar] = await Promise.all([
    tablaDeCanje(sesion.tenant.id),
    puedeConSesion(sesion, 'CANJE_VALORES'),
  ])

  return (
    <>
      <Encabezado
        titulo="Plan canje"
        subtitulo="Cuánto paga el cliente entregando su usado"
        acciones={
          puedeEditar ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/plan-canje/valores">Editar valores</Link>
            </Button>
          ) : undefined
        }
        accionMovil={
          puedeEditar
            ? { icono: Table2, etiqueta: 'Editar valores', href: '/plan-canje/valores', tono: 'suave' }
            : undefined
        }
      />
      <Calculadora tabla={tabla} puedeEditar={puedeEditar} />
    </>
  )
}
