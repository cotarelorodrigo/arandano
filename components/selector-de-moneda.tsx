'use client'

import { useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

/**
 * En qué moneda está el precio de un artículo.
 *
 * **Un solo componente para el alta y para la ficha**, y no dos controles que
 * haya que acordarse de sincronizar. Es la lección directa del ciclo del
 * 2026-08-28: la categoría vivió cuatro días con dos implementaciones
 * distintas —un par de selectores en el alta y un campo de texto en la
 * ficha—, el gate entero en verde, y lo reportó un cliente antes que un test.
 *
 * Emite por un `<input type="hidden">` porque `Select` de Radix no renderiza
 * ningún `<select>` nativo: el trigger es un `<button>`, y sin el hidden el
 * `FormData` del server action llegaría sin el campo.
 *
 * Cambiar de moneda AVISA y no impide: pasar 300 de dólares a pesos hace que
 * el número diga otra cosa, y ninguna validación puede distinguir eso de un
 * cambio deliberado (recargar el precio real en la otra moneda). La decisión
 * es de quien carga el precio, no del control.
 */
export function SelectorDeMoneda({
  id,
  name,
  valorInicial,
}: {
  id: string
  name: string
  valorInicial: 'ARS' | 'USD'
}) {
  const [moneda, setMoneda] = useState(valorInicial)

  return (
    <div className="flex flex-col gap-1">
      {/* Label visualmente oculta y no `aria-label` en el trigger: el nombre
          accesible sale de un <label> real asociado por `htmlFor`, que es lo
          que ya usa SelectorDeCategoria. `aria-label` funcionaría igual para
          un lector de pantalla, pero rompería la afirmación de FichaDeArticulo
          de que el único `aria-label` de la pantalla es el de "Volver". */}
      <Label htmlFor={id} className="sr-only">
        Moneda del precio
      </Label>
      <div className="flex">
        <Select value={moneda} onValueChange={(v) => setMoneda(v as 'ARS' | 'USD')}>
          <SelectTrigger
            id={id}
            // h-10 y no el h-9 del brief: es la misma altura de 40px que ya
            // usa el SelectTrigger de SelectorDeCategoria (mismo motivo:
            // design/arandano.pen mide los campos del alta a 40px, no al h-8
            // por default de shadcn — hallazgo M2 del barrido final).
            className="h-10 w-[86px] rounded-r-none border-r-0 text-[13px] font-medium"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">$</SelectItem>
            <SelectItem value="USD">US$</SelectItem>
          </SelectContent>
        </Select>
        <input type="hidden" name={name} value={moneda} />
      </div>
      {moneda !== valorInicial && (
        <p className="text-xs text-muted-foreground">
          El precio no se convierte:{' '}
          {valorInicial === 'ARS'
            ? 'lo que estaba en pesos ahora se lee en dólares'
            : 'lo que estaba en dólares ahora se lee en pesos'}
          .
        </p>
      )}
    </div>
  )
}
