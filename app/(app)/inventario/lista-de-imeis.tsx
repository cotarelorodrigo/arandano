'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * La lista de IMEI que se cargan de una: el alta, el ingreso de mercadería y el
 * diálogo de prender el switch usan ESTA, no tres copias.
 *
 * `filas` fijas cuando el llamador sabe cuántas van (prender el switch: son
 * tantas como el stock); libre cuando no (el alta y el ingreso).
 */
export function ListaDeImeis({
  filasFijas,
  etiqueta = 'IMEI o número de serie',
}: {
  filasFijas?: number
  etiqueta?: string
}) {
  const [valores, setValores] = useState<string[]>(
    filasFijas === undefined ? [''] : Array.from({ length: filasFijas }, () => ''),
  )
  const ultimo = useRef<HTMLInputElement>(null)

  // El lector de código de barras emite Enter al final de cada código, así que
  // Enter agrega una fila y la enfoca: eso es lo que hace que cargar diez
  // equipos sean diez escaneos y ningún click. `preventDefault` ANTES de
  // cualquier await —después ya no tiene efecto—, igual que el buscador de
  // /vender. Con `filasFijas` no agrega nada: la cantidad la fija el stock.
  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (filasFijas !== undefined) return
    if (i === valores.length - 1) setValores((v) => [...v, ''])
    queueMicrotask(() => ultimo.current?.focus())
  }

  return (
    <div className="flex flex-col gap-2">
      {valores.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            ref={i === valores.length - 1 ? ultimo : undefined}
            name="imeis"
            value={v}
            aria-label={`${etiqueta} ${i + 1}`}
            onChange={(e) =>
              setValores((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
            }
            onKeyDown={(e) => alTeclear(e, i)}
            className="h-10 rounded-[9px]"
          />
          {filasFijas === undefined && valores.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${etiqueta} ${i + 1}`}
              onClick={() => setValores((prev) => prev.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      {filasFijas === undefined && (
        <Button type="button" variant="outline" onClick={() => setValores((v) => [...v, ''])}>
          Agregar otro
        </Button>
      )}
    </div>
  )
}
