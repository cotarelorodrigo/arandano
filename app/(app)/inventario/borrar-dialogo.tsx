'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { ResumenDeBorrado } from '@/lib/inventario/articulos'
import { borrarArticuloAccion } from './acciones'

/**
 * Qué se lleva puesto el borrado, en una oración.
 *
 * Exportada y pura para poder probarla: `DialogContent` de Radix sólo se monta
 * cuando el diálogo está abierto, así que un render estático no la ve nunca.
 * Es la misma razón por la que el ABM de categorías separó sus textos.
 *
 * Las líneas que no aplican no se escriben: un artículo sin unidades no dice
 * "y sus 0 unidades".
 */
export function queSeLleva(resumen: ResumenDeBorrado): string {
  const partes: string[] = []
  if (resumen.movimientos > 0) {
    partes.push(
      resumen.movimientos === 1
        ? 'su movimiento de stock'
        : `sus ${resumen.movimientos} movimientos de stock`,
    )
  }
  if (resumen.unidades > 0) {
    partes.push(resumen.unidades === 1 ? 'su unidad' : `sus ${resumen.unidades} unidades`)
  }
  if (partes.length === 0) return 'Se borra el artículo. No se puede deshacer.'
  const lista =
    partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
  return `Se borran el artículo${partes.length === 1 ? ' y ' : ', '}${lista}. No se puede deshacer.`
}

/**
 * Por qué no se puede borrar. Ofrece desactivar sólo si hay algo que ofrecer:
 * en un artículo que YA está desactivado, esa salida no existe — y tampoco si
 * la persona no tiene el botón "Desactivar" a mano: `ARTICULOS_BORRAR` y
 * `ARTICULOS_EDITAR` son permisos independientes (Task 6), así que alguien con
 * el primero y sin el segundo no puede aceptar la salida que este texto le
 * ofrecería.
 */
export function porQueNo(ventas: number, desactivado: boolean, puedeEditar: boolean): string {
  const cuantas = ventas === 1 ? 'se vendió 1 vez' : `se vendió ${ventas} veces`
  const salida =
    desactivado || !puedeEditar
      ? ''
      : ' Podés desactivarlo: deja de ofrecerse y su historial queda intacto.'
  return `Este artículo ${cuantas}: borrarlo se llevaría esas ventas.${salida}`
}

/**
 * El botón "Borrar" de la ficha, con su diálogo.
 *
 * **Se dibuja siempre**, con ventas o sin ellas: quien busca el botón y no lo
 * encuentra asume que la feature no existe, y este diálogo es el único lugar
 * donde la regla se puede explicar en el momento en que importa. Con ventas, el
 * botón de confirmar queda apagado y a la vista —no ausente—, que es lo que ata
 * el mensaje a la acción que la persona vino a hacer.
 *
 * **El toast se lanza en el handler**, con el resultado en la mano, y NO en un
 * `useEffect`: es la lección del ABM de categorías. El componente Toaster vive
 * en el root layout, así que sobrevive a la navegación que sigue.
 *
 * `className` llega al trigger y elige su geometría, igual que cualquier otro
 * botón del pie del teléfono de `formularios.tsx` (`CLASES_BOTON_PIE`): es UN
 * componente instanciado dos veces, no dos implementaciones que haya que
 * acordarse de sincronizar. No es `movil` ni ningún otro booleano propio —
 * `formularios.tsx` importa este archivo, así que importar `CLASES_BOTON_PIE`
 * desde acá para armar la clase adentro sería un import circular; con
 * `className` la única definición de esa geometría sigue viviendo en un solo
 * lugar y este componente no necesita conocerla.
 */
export function DialogoDeBorrado({
  articuloId,
  nombre,
  desactivado,
  puedeEditar,
  resumen,
  className,
}: {
  articuloId: string
  nombre: string
  desactivado: boolean
  /** Si el diálogo puede ofrecer "desactivalo" como salida: sin
   *  `ARTICULOS_EDITAR` esa persona no tiene el botón "Desactivar" en
   *  ninguna de las dos copias, así que ofrecérselo sería prometer algo que
   *  no puede hacer. */
  puedeEditar: boolean
  resumen: ResumenDeBorrado
  className?: string
}) {
  const [abierto, setAbierto] = useState(false)
  const [enCurso, empezar] = useTransition()
  const router = useRouter()
  const sePuede = resumen.ventas === 0

  function borrar() {
    empezar(async () => {
      const datos = new FormData()
      datos.set('articuloId', articuloId)
      const r = await borrarArticuloAccion({ error: null, aviso: null }, datos)
      if (r.error) {
        toast.error(r.error, { id: `borrar-${articuloId}`, duration: Infinity })
        return
      }
      setAbierto(false)
      toast.success(`${nombre} se borró del inventario.`, { id: `borrar-${articuloId}` })
      router.push('/inventario')
    })
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="destructive" className={className}>
          <Trash2 aria-hidden="true" className="size-[15px]" />
          Borrar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {sePuede ? `¿Borrar "${nombre}"?` : `No se puede borrar "${nombre}"`}
          </DialogTitle>
          <DialogDescription>
            {sePuede ? queSeLleva(resumen) : porQueNo(resumen.ventas, desactivado, puedeEditar)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancelar</Button>
          </DialogClose>
          <Button variant="destructive" disabled={!sePuede || enCurso} onClick={borrar}>
            {enCurso ? 'Borrando…' : 'Borrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
