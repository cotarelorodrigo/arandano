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
  // Sólo hace falta con `filasFijas`: es de ahí que `avanzarFoco` (más abajo)
  // saca el input de la fila siguiente por índice, sin depender de un ref por
  // fila.
  const contenedor = useRef<HTMLDivElement>(null)

  /**
   * Con `filasFijas`, no hay fila que agregar: el lector de código de barras
   * sigue escaneando, así que Enter tiene que avanzar el foco a la PRÓXIMA
   * fila — si se queda en la misma, la segunda lectura pisa a la primera, y
   * escanear N equipos en N campos fijos (el diálogo de prender el switch, el
   * caso que este control existe para servir) deja todo apilado en el primer
   * campo. En la última fila no hay a dónde avanzar: se queda donde está, que
   * es la respuesta razonable —no hay una acción mejor que inventar—.
   */
  function avanzarFoco(i: number) {
    const siguiente = contenedor.current?.querySelectorAll('input')[i + 1] as
      | HTMLInputElement
      | undefined
    siguiente?.focus()
  }

  // El lector de código de barras emite Enter al final de cada código.
  // `preventDefault` ANTES de cualquier otra cosa —después ya no tiene
  // efecto—, igual que el buscador de /vender.
  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (filasFijas !== undefined) {
      avanzarFoco(i)
      return
    }
    // Sin filas fijas (el alta, el ingreso de mercadería): Enter agrega una
    // fila y la enfoca, que es lo que hace que cargar diez equipos sean diez
    // escaneos y ningún click.
    if (i === valores.length - 1) setValores((v) => [...v, ''])
    queueMicrotask(() => ultimo.current?.focus())
  }

  return (
    <div ref={contenedor} className="flex flex-col gap-2">
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
