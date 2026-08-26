'use client'

import { useActionState, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { anular, type EstadoAnulacion } from './acciones'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

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
