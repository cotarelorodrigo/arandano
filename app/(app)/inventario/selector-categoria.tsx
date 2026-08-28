'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { RamaConHijas } from '@/lib/inventario/categorias'

/**
 * Radix no admite un `SelectItem` con `value=""` —lo rechaza en runtime—, así
 * que "sin categoría" necesita un valor propio que nunca pueda ser un uuid.
 * Se traduce a cadena vacía antes de tocar el estado, así que este string no
 * sale nunca del componente.
 */
const SIN = '__sin__'

/**
 * Los dos selectores encadenados Categoría → Marca, compartidos por
 * `/inventario/nuevo` y `/inventario/[id]`.
 *
 * **Existe como componente propio justamente por el defecto que este ciclo
 * arregla**: hasta hoy el alta tenía los dos selectores y la ficha un campo de
 * texto, porque eran dos implementaciones del mismo control y una se quedó
 * atrás (`docs/correcciones-pendientes-del-pen.md`, entrada 7). Con un solo
 * componente, esa divergencia no se puede repetir.
 *
 * **Emite `<input type="hidden">` en vez de apoyarse en el `name` del
 * `<Select>` de Radix.** Con `name`, Radix renderiza un `<select>` oculto y el
 * valor sale de él — alcanza mientras "sin categoría" sea la ausencia de
 * elección, que es el caso del alta, que arranca vacía. En la ficha no alcanza:
 * un artículo que YA tiene rama necesita poder volver a "sin categoría", y para
 * eso hace falta un item explícito, que Radix no deja que valga "". Con inputs
 * propios el centinela se traduce acá adentro y al servidor le llega cadena
 * vacía, como siempre.
 */
export function SelectorDeCategoria({
  arbol,
  categoriaIdInicial = null,
  orientacion = 'fila',
}: {
  arbol: RamaConHijas[]
  categoriaIdInicial?: string | null
  orientacion?: 'fila' | 'columna'
}) {
  const inicial = ramaInicial(arbol, categoriaIdInicial)
  /**
   * El rubro elegido, que es lo que decide qué marcas ofrece el segundo
   * selector. Cambiar de rubro tiene que LIMPIAR la marca: dejarla puesta
   * guardaría una marca que pertenece a otro rubro, y el servidor la aceptaría
   * sin chistar porque el id existe.
   */
  const [rubroId, setRubroId] = useState<string>(inicial.rubroId)
  const [marcaId, setMarcaId] = useState<string>(inicial.marcaId)
  const marcasDelRubro = arbol.find((r) => r.id === rubroId)?.hijas ?? []

  return (
    <>
      <input type="hidden" name="categoriaId" value={rubroId} />
      <input type="hidden" name="marcaId" value={marcaId} />
      <div className={orientacion === 'fila' ? 'flex gap-3' : 'flex flex-col gap-2'}>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="categoriaId">Categoría</Label>
          <Select
            // `value` puede ser cadena vacía y ahí Radix muestra el
            // placeholder — es lo que el alta ya hace hoy. Lo que Radix NO
            // admite es un `SelectItem` con `value=""`, de ahí el centinela.
            // Pasar `undefined` en su lugar convertiría el Select en no
            // controlado y React avisaría del cambio de modo.
            value={rubroId}
            onValueChange={(v) => {
              setRubroId(v === SIN ? '' : v)
              setMarcaId('')
            }}
          >
            <SelectTrigger id="categoriaId" className="h-10 w-full rounded-[9px]">
              <SelectValue placeholder="Sin categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN}>Sin categoría</SelectItem>
              {arbol.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="marcaId">Marca</Label>
          <Select
            value={marcaId}
            onValueChange={(v) => setMarcaId(v === SIN ? '' : v)}
            // Deshabilitado y no vacío-y-clickeable: un selector que se abre
            // para no mostrar nada invita a buscar algo que no está.
            disabled={marcasDelRubro.length === 0}
          >
            <SelectTrigger id="marcaId" className="h-10 w-full rounded-[9px]">
              <SelectValue placeholder={rubroId === '' ? 'Elegí una categoría' : 'Sin marca'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN}>Sin marca</SelectItem>
              {marcasDelRubro.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[11px] leading-[1.4] text-muted-foreground">
        Las categorías se crean y se ordenan en{' '}
        <Link href="/inventario" className="underline">
          el panel de Inventario
        </Link>
        .
      </p>
    </>
  )
}

/**
 * De qué rama cuelga el artículo, traducido a los dos selectores.
 *
 * Un artículo puede colgar de una RAÍZ o de una HOJA, indistinto (CLAUDE.md,
 * ciclo del modelo), así que hay que probar las dos formas. Un id que el árbol
 * no conoce —otra pestaña borró la rama entre que la pantalla se dibujó y
 * alguien la miró— cae en "sin categoría" en vez de dejar los selectores en un
 * estado imposible.
 */
function ramaInicial(
  arbol: RamaConHijas[],
  categoriaId: string | null,
): { rubroId: string; marcaId: string } {
  if (!categoriaId) return { rubroId: '', marcaId: '' }

  const comoRaiz = arbol.find((r) => r.id === categoriaId)
  if (comoRaiz) return { rubroId: comoRaiz.id, marcaId: '' }

  const padre = arbol.find((r) => r.hijas.some((h) => h.id === categoriaId))
  if (padre) return { rubroId: padre.id, marcaId: categoriaId }

  return { rubroId: '', marcaId: '' }
}
