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
import { borrarArticuloAccion, bajaArticulo } from './acciones'

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
 * Si el diálogo ofrece el botón "Desactivar", además de mencionarlo en la
 * frase de `porQueNo` (I1, review de la rama). Las MISMAS tres condiciones:
 * hay ventas (si no, la cara del diálogo es la permisiva y no ésta), el
 * artículo no está desactivado todavía, y la persona tiene `ARTICULOS_EDITAR`
 * — el botón y la frase tienen que aparecer y desaparecer juntos.
 *
 * Exportada y pura por la misma razón que `queSeLleva`/`porQueNo`: el botón
 * vive dentro de `DialogContent`, que Radix no monta con el diálogo cerrado,
 * así que un render estático no lo ve nunca.
 */
export function ofreceDesactivar(
  resumen: ResumenDeBorrado,
  desactivado: boolean,
  puedeEditar: boolean,
): boolean {
  return resumen.ventas > 0 && !desactivado && puedeEditar
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
 * **Con ventas, un tercer botón — "Desactivar" — dispara la salida que la
 * frase de `porQueNo` ya menciona**, en vez de dejarla como algo que hay que
 * ir a buscar afuera del diálogo. Aparece con las MISMAS tres condiciones que
 * `porQueNo` usa para mencionarla (`ofreceDesactivar`): hay ventas, el
 * artículo no está desactivado todavía, y la persona tiene `ARTICULOS_EDITAR`
 * — el botón y la frase aparecen y desaparecen juntos. Dispara `bajaArticulo`
 * —la misma acción del servidor que ya usan las dos copias del botón
 * "Desactivar" de la ficha— con su propio `useTransition`, y cierra el
 * diálogo al terminar: `revalidatePath` ya refresca esta misma ficha, así que
 * no hace falta navegar a ningún lado.
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
  const [desactivando, empezarDesactivar] = useTransition()
  const router = useRouter()
  const sePuede = resumen.ventas === 0
  const mostrarDesactivar = ofreceDesactivar(resumen, desactivado, puedeEditar)

  function borrar() {
    empezar(async () => {
      const datos = new FormData()
      datos.set('articuloId', articuloId)
      const r = await borrarArticuloAccion({ error: null, aviso: null }, datos)
      if (r.error) {
        // Se CIERRA, no se refresca (review de la rama, M3): quedarse abierto
        // dejaba el diálogo diciendo "¿Borrar X? Se borran el artículo y sus
        // 3 movimientos…" —la cara permisiva, calculada con el `resumen` de
        // cuando se abrió— mientras el toast, con `duration: Infinity`,
        // contaba lo contrario. Refrescar la cara pediría un segundo viaje al
        // servidor (recalcular `resumenDeBorrado`) sólo para un camino que
        // este mismo módulo ya trata como una carrera excepcional (ver el
        // docblock de `borrarArticulo`, `lib/inventario/articulos.ts`): la
        // base es la que de verdad decide, y el toast —que no se cierra
        // solo— es lo que le queda a la persona para leer el motivo real.
        setAbierto(false)
        toast.error(r.error, { id: `borrar-${articuloId}`, duration: Infinity })
        return
      }
      setAbierto(false)
      toast.success(`${nombre} se borró del inventario.`, { id: `borrar-${articuloId}` })
      router.push('/inventario')
    })
  }

  // Mismo patrón que `borrar()`: `useTransition` propio —no comparte
  // `enCurso`, porque son dos acciones distintas y disparar una no puede
  // dejar la otra con un estado de "en curso" que no le corresponde— y el
  // toast en el handler, con el resultado en la mano. `bajaArticulo` ya hace
  // `revalidatePath` de esta misma ficha, así que alcanza con cerrar el
  // diálogo: no hace falta navegar a ningún lado, el artículo se queda acá.
  function desactivar() {
    empezarDesactivar(async () => {
      const datos = new FormData()
      datos.set('articuloId', articuloId)
      const r = await bajaArticulo({ error: null, aviso: null }, datos)
      if (r.error) {
        setAbierto(false)
        toast.error(r.error, { id: `desactivar-${articuloId}`, duration: Infinity })
        return
      }
      setAbierto(false)
      toast.success(r.aviso ?? 'Artículo desactivado.', { id: `desactivar-${articuloId}` })
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
          {/* La misma salida que `porQueNo` ofrece en prosa, ahora con un
              botón real detrás (I1, review de la rama): antes había que
              cancelar, buscar "Desactivar" en el Topbar o en el pie, y volver
              a decidir. */}
          {mostrarDesactivar && (
            <Button variant="destructive" disabled={desactivando} onClick={desactivar}>
              {desactivando ? 'Desactivando…' : 'Desactivar'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
