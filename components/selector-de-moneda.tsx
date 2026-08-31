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
  children,
}: {
  id: string
  name: string
  valorInicial: 'ARS' | 'USD'
  /** El input del precio, que va pegado al selector adentro de la MISMA fila. */
  children: React.ReactNode
}) {
  const [moneda, setMoneda] = useState(valorInicial)

  // Un Fragment y no un contenedor propio, con el aviso HERMANO de la fila —
  // el mismo patrón que SelectorDeCategoria usa para su nota del panel de
  // inventario, y por el mismo motivo. La versión anterior devolvía una
  // COLUMNA (selector arriba, aviso debajo) que las pantallas metían en una
  // fila junto al input: mientras el aviso no se veía todo cerraba, pero
  // apenas aparecía su texto le daba a esa columna un ancho intrínseco mucho
  // mayor que los 86 px del selector, y el input —`flex-1`, que se deja
  // comprimir— quedaba arrinconado contra el borde derecho. El campo se
  // partía al medio justo en el momento en que el aviso tenía algo que decir.
  return (
    <>
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
            // `h-10!` CON el sufijo important, y no `h-10` a secas: la altura
            // del trigger la fija components/ui/select.tsx como una variante
            // de `data-size`, y `.data-[size=default]:h-8[data-size="default"]`
            // le gana por especificidad a cualquier `.h-N` suelto, siempre —
            // no es cuestión del orden del bundle ni del orden de las clases.
            // Sin el `!`, este control medía 32 px mientras el input pegado a
            // su derecha medía 40, y se veía a ojo (2026-08-31). La versión
            // anterior de este comentario afirmaba que medía 40 "igual que
            // SelectorDeCategoria": los dos median 32, y por eso nadie lo
            // notaba — un select solo en su fila no tiene contra qué
            // compararse. design/arandano.pen mide estos campos a 40.
            // test/altura-de-los-select.test.ts lo vigila en todo el repo.
            // El radio va explícito y no por el `rounded-lg` de shadcn (10 px
            // con --radius: 0.625rem): la maqueta mide 9 en las esquinas
            // externas del campo compuesto, igual que los inputs vecinos de
            // estas dos pantallas, que ya lo escriben a mano.
            className="h-10! w-[86px] rounded-l-[9px] rounded-r-none border-r-0 text-[13px] font-medium"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ARS">$</SelectItem>
            <SelectItem value="USD">US$</SelectItem>
          </SelectContent>
        </Select>
        <input type="hidden" name={name} value={moneda} />
        {children}
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
    </>
  )
}
