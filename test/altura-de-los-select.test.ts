import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

/**
 * Un `h-10` sobre un `SelectTrigger` no hace nada, y hay que escribirlo con
 * el modificador important para que haga algo.
 *
 * **El defecto que este caso fija se descubrió a ojo el 2026-08-31**, en el
 * campo de precio de `/inventario/nuevo`: el selector de moneda se veía 8 px
 * más bajo que el input pegado a su derecha. La causa está en el CSS servido,
 * y es de especificidad, no de orden:
 *
 * ```
 * .h-10                                         → 40px   (0,1,0)
 * .data-\[size\=default\]\:h-8[data-size="default"] → 32px   (0,2,0)  ← gana
 * ```
 *
 * `components/ui/select.tsx` (copiado del registry de shadcn, no se toca)
 * declara la altura del trigger como una variante de `data-size`, y el
 * trigger renderiza `data-size="default"`. Esa regla lleva un atributo
 * además de la clase, así que le gana a cualquier `h-N` suelto **siempre**,
 * sin importar en qué orden salgan del bundle ni en qué orden se escriban las
 * clases en el `className`.
 *
 * Lo que lo vuelve peligroso es que falla en silencio: la clase está escrita,
 * el `className` la lleva, nadie tira un error, y el control simplemente mide
 * otra cosa que la que la maqueta pide. Los cuatro `SelectTrigger` del
 * producto lo tenían, y estuvieron midiendo 32 px donde
 * `design/arandano.pen` mide 40 — sólo se notó cuando uno quedó pegado a un
 * input de 40, porque un select solo en su fila no tiene contra qué
 * compararse.
 *
 * `components/ui/` queda afuera del escaneo a propósito: es código copiado
 * del registry, y es justamente donde vive la variante que gana.
 */
describe('la altura de los SelectTrigger', () => {
  const fuentes = execFileSync(
    'git',
    ['ls-files', '*.tsx'],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((f) => f && !f.startsWith('components/ui/') && !f.endsWith('.test.tsx'))

  it('ningún SelectTrigger pide una altura sin el modificador important', () => {
    const flojos: string[] = []
    for (const archivo of fuentes) {
      const fuente = readFileSync(archivo, 'utf8')
      // Cada apertura de <SelectTrigger …> con su className, incluida la
      // forma multilínea que usa components/selector-de-moneda.tsx.
      // La ventana es generosa (1200) porque entre `<SelectTrigger` y su `>`
      // puede haber comentarios largos: en components/selector-de-moneda.tsx
      // el porqué de la altura y el del radio ocupan más de 400 caracteres, y
      // con una ventana corta ese trigger —el que destapó el defecto— se
      // escapaba del escaneo.
      for (const m of fuente.matchAll(/<SelectTrigger\b[\s\S]{0,1200}?>/g)) {
        const tag = m[0]
        // `h-10` o cualquier `h-N`/`h-[Npx]` suelto: lo que importa no es el
        // número sino que venga sin `!`, que es lo que lo deja sin efecto.
        const alturaFloja = /className="[^"]*(?<![!\w-])h-(\d+|\[[^\]]+\])(?!!)[\s"]/.test(tag)
        if (alturaFloja) {
          const linea = fuente.slice(0, m.index).split('\n').length
          flojos.push(`${archivo}:${linea}`)
        }
      }
    }
    expect(
      flojos,
      'Estos SelectTrigger declaran una altura que el CSS ignora: la variante ' +
        '`data-[size=default]:h-8` de components/ui/select.tsx le gana por ' +
        'especificidad. Escribila con el sufijo important (`h-10!`) o el ' +
        'control va a medir 32 px sin avisar.',
    ).toEqual([])
  })
})
