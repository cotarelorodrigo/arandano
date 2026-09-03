'use client'

import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * La lista de IMEI que se cargan progresivamente: el alta y el ingreso de
 * mercadería usan ESTA, no dos copias.
 *
 * Arranca con una fila y crece con Enter o "Agregar otro" — nunca pide un
 * número fijo de campos. El modo de N campos de una (pensado para el diálogo
 * de prender el switch, que exigía escanear todo de una sentada) lo borró
 * este ciclo: es justo el flujo que la Task 5 vino a reemplazar por la carga
 * progresiva, y con él se fue el avance de foco por índice —que sólo
 * funcionaba porque una fila tenía exactamente un input— y el ref del
 * contenedor que lo sostenía.
 */
export function ListaDeImeis({
  etiqueta = 'IMEI o número de serie',
}: {
  etiqueta?: string
}) {
  const [valores, setValores] = useState<string[]>([''])
  const ultimo = useRef<HTMLInputElement>(null)

  // El lector de código de barras emite Enter al final de cada código.
  // `preventDefault` ANTES de cualquier otra cosa —después ya no tiene
  // efecto—, igual que el buscador de /vender. Enter agrega una fila y la
  // enfoca, que es lo que hace que cargar diez equipos sean diez escaneos y
  // ningún click.
  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
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
          {valores.length > 1 && (
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
      {/* Ancho completo, 38 de alto y con el `plus` de la maqueta (frame
          `B4O7t`, nodo `DPjDh`): es el control que sostiene la carga de a
          muchos, así que ocupa la fila entera en vez de quedar como un botón
          suelto a la izquierda. */}
      <Button
        type="button"
        variant="outline"
        onClick={() => setValores((v) => [...v, ''])}
        className="h-[38px] w-full rounded-[9px]"
      >
        <Plus aria-hidden="true" className="size-[15px]" />
        Agregar otro
      </Button>
      {/* La nota vive ACÁ y no en cada pantalla que instancia la lista. Hasta
          el 2026-09-03 estaba escrita dos veces —el alta y el ingreso de
          mercadería, en formularios.tsx— con el mismo texto copiado, que es
          exactamente la forma en que el alta y la ficha se desincronizaron
          con la categoría (ciclo del 2026-08-28: "una sola fuente, no dos que
          haya que acordarse de sincronizar"). Texto de la maqueta, nodo
          `afXki`. */}
      <p className="text-[11px] leading-[1.4] text-muted-foreground">
        Cargá los que tengas a mano. El resto entra sin identificar y se completa desde la ficha
        cuando aparezca cada equipo.
      </p>
    </div>
  )
}
