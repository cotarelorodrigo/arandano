'use client'

import { useActionState, useState } from 'react'
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
      <Alert className="mt-6 max-w-md">
        <AlertDescription>{estado.aviso}</AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={accion} className="mt-6 flex max-w-md flex-col gap-3">
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
        <Button type="button" variant="destructive" onClick={() => setConfirmando(true)}>
          Anular venta
        </Button>
      )}
    </form>
  )
}
