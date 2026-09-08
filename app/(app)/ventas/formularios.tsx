'use client'

import { useActionState, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Undo2 } from 'lucide-react'
import { anular, guardarDetalle, type EstadoAnulacion, type EstadoDetalle } from './acciones'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { TOPE_DETALLE } from '@/lib/ventas/detalle'

const INICIAL: EstadoAnulacion = { error: null, aviso: null }

/**
 * Anular, con confirmación en dos pasos sobre el mismo botón.
 *
 * Dos pasos y no un `confirm()` ni un diálogo: anular devuelve stock y da de
 * baja plata cobrada, así que no puede ser un click distraído — y ni el
 * `confirm` del navegador ni una dependencia nueva hacían falta para eso.
 */
export function AnularVenta({ ventaId }: { ventaId: string }) {
  const [estado, accion, anulando] = useActionState(anular, INICIAL)
  const [confirmando, setConfirmando] = useState(false)

  if (estado.aviso) {
    return (
      <Alert>
        <AlertDescription>{estado.aviso}</AlertDescription>
      </Alert>
    )
  }

  return (
    // Sin mt-6: antes este formulario vivía suelto en la pantalla y ese
    // margen lo separaba del párrafo de arriba. Ahora vive DENTRO de la
    // card "Zona de riesgo" (design/arandano.pen, nodo `TIlD3`), que ya pone
    // su propio gap entre hijos — un margen de más acá duplicaría ese
    // espacio.
    <form action={accion} className="flex flex-col gap-3">
      <input type="hidden" name="ventaId" value={ventaId} />
      {estado.error && (
        <Alert variant="destructive">
          <AlertDescription>{estado.error}</AlertDescription>
        </Alert>
      )}
      {confirmando ? (
        <div className="flex gap-3">
          <Button type="submit" variant="destructive" disabled={anulando}>
            {anulando ? 'Anulando…' : 'Sí, anular'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setConfirmando(false)}>
            Cancelar
          </Button>
        </div>
      ) : (
        // El reposo, contra design/arandano.pen (frame `WBV5G`, nodo
        // `EtWF8`): 44px de alto, ancho completo, radio 10, relleno de
        // superficie (`bg-card`) con ícono `undo-2` — no el
        // `bg-destructive/10` de siempre. `lg:` revierte cada uno de esos
        // valores a los de hoy (h-8, ancho automático, `rounded-lg`,
        // `bg-destructive/10`), así que escritorio no cambia — el color del
        // texto SÍ es el mismo en los dos anchos (`text-destructive`, ya lo
        // trae `variant="destructive"`), así que no hace falta revertirlo.
        // El ícono existe sólo en el teléfono (`lg:hidden`): la maqueta de
        // escritorio no lo dibuja.
        //
        // Sólo el reposo cambia de aspecto — la confirmación en dos pasos de
        // más abajo (Sí, anular / Cancelar) sigue exactamente como está: la
        // maqueta no dibuja ese estado, así que no hay de dónde derivarlo.
        <Button
          type="button"
          variant="destructive"
          onClick={() => setConfirmando(true)}
          className="h-11 w-full gap-2 rounded-[10px] bg-card font-semibold hover:bg-card/90 lg:h-8 lg:w-auto lg:gap-1.5 lg:rounded-lg lg:bg-destructive/10 lg:font-medium lg:hover:bg-destructive/20"
        >
          <Undo2 aria-hidden="true" className="size-[15px] lg:hidden" />
          Anular venta
        </Button>
      )}
    </form>
  )
}

/**
 * El detalle de la venta: verlo y editarlo.
 *
 * `useTransition` + toast y no `useActionState` + `<Alert>` inline, siguiendo
 * el precedente más cercano que hay (la card "Lo que el bot sabe del local",
 * app/(app)/bot/formularios.tsx): el aviso se lanza en el MISMO handler que
 * ejecuta la acción, con el resultado en la mano, nunca desde un `useEffect`
 * sobre el estado — un efecto está atado al ciclo de vida del componente, y con
 * cada `revalidatePath` el componente se remonta y se lleva el aviso puesto.
 * La clave del toast es estable, o sonner apila una copia por cada guardado.
 *
 * Los errores no se auto-descartan (dicen qué corregir); los éxitos sí.
 *
 * **Controlado y no `defaultValue`**, al revés de lo que haría un `<form>`:
 * sin form no hay `FormData` de donde sacar el texto, así que el valor tiene
 * que estar en el estado para que el `onClick` lo pueda mandar. Es el mismo
 * patrón, y por el mismo motivo, que la card "Lo que el bot sabe del local".
 */
export function DetalleDeLaVenta({
  ventaId,
  detalle,
}: {
  ventaId: string
  detalle: string | null
}) {
  const [guardando, empezar] = useTransition()
  const [texto, setTexto] = useState(detalle ?? '')

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="detalle-de-la-venta" className="sr-only">
        Detalles
      </Label>
      {/* Sin `name`, a diferencia del de `/vender`: acá no hay `<form>` que lo
          postee —el texto viaja por el estado hasta el `onClick`—, y un
          atributo que no cumple ninguna función es ruido que el próximo lector
          va a interpretar como que algo lo lee. */}
      <Textarea
        id="detalle-de-la-venta"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={TOPE_DETALLE}
        rows={4}
        placeholder="Lo retira el hermano el jueves"
      />
      <Button
        type="button"
        size="sm"
        disabled={guardando}
        className="w-full lg:w-auto lg:self-end"
        onClick={() =>
          empezar(async () => {
            const r: EstadoDetalle = await guardarDetalle({ ventaId, detalle: texto })
            if (r.error) toast.error(r.error, { id: 'detalle-de-venta', duration: Infinity })
            else if (r.aviso) toast.success(r.aviso, { id: 'detalle-de-venta' })
          })
        }
      >
        {guardando ? 'Guardando…' : 'Guardar detalles'}
      </Button>
    </div>
  )
}
