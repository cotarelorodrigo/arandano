import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/** 390 (el ancho de la maqueta) menos los dos paddings de 14 del cuerpo. */
const LIMITE = 362

/**
 * Utilidades de ancho fijo en píxeles: `w-[168px]`, `min-w-[240px]`,
 * `basis-[384px]`. Se mira el token entero —separado por espacios o comillas—
 * para poder preguntar por sus variantes: lo que importa no es el número solo
 * sino si viene con `lg:` adelante.
 *
 * `max-w-` queda AFUERA a propósito, y no es un olvido: un `max-width` sólo
 * topea el ancho, nunca lo ensancha, así que estructuralmente no puede
 * desbordar un contenedor más angosto — a diferencia de `w-`/`min-w-`, que sí
 * fuerzan un ancho mayor al que el padre tiene para dar. Un `max-w-[800px]`
 * suelto en un contenedor de 350px en el teléfono no hace nada: el elemento
 * sigue midiendo 350px, el cap simplemente no se alcanza. Incluirlo acá sólo
 * entrenaría a poner `lg:` por reflejo sin que sea necesario — la Task 12
 * lo hizo con ocho `max-w-` que no cambiaban nada en ningún ancho, y se
 * revirtió cuando quedó claro que ninguno prevenía un desborde real.
 */
const ANCHO = /^(?:[a-z0-9@[\]&>_-]+:)*(?:min-)?(?:w|basis)-\[(\d+)px\]$/

/**
 * Archivos donde un ancho grande sin `lg:` es correcto, con su razón. Un mapa
 * y no una lista: la razón tiene que estar escrita, igual que en SOLO_EN_CSS
 * de test/maqueta.test.ts.
 *
 * Vacío a propósito: las dos excepciones que traía el brief de la Task 12 (la
 * imagen de OpenGraph y el ticket térmico) se revisaron y se sacaron, porque
 * ninguna excluía nada. `app/opengraph-image.tsx` arma la imagen con
 * `style={{ width: ... }}` de Satori, no con clases de Tailwind — no hay
 * ningún `w-[Npx]` en el archivo. El ticket (`.../ticket/cuerpo.tsx`) importa
 * `ticket.module.css` y no usa un solo `className` con corchetes: el ancho de
 * 80mm vive en el `.css`, que este test ni siquiera lee. Dejarlas habría sido
 * la misma mentira que advierte el párrafo de arriba.
 */
const EXCEPCIONES: Record<string, string> = {}

function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) fuentes(completo, acumulado)
    else if (entrada.endsWith('.tsx') && !entrada.endsWith('.test.tsx')) {
      acumulado.push(completo)
    }
  }
  return acumulado
}

describe('ningún ancho fijo desborda un teléfono de 390', () => {
  // components/ui/ queda afuera: son los componentes de shadcn tal como los
  // copia el registry, y sus anchos los fija cada consumidor.
  const archivos = [...fuentes('app'), ...fuentes('components')].filter(
    (f) => !f.startsWith(path.join('components', 'ui')),
  )

  it.each(archivos)('%s', (archivo) => {
    if (archivo in EXCEPCIONES) return
    const culpables = readFileSync(archivo, 'utf8')
      .split(/[\s"'`{}]+/)
      .filter((token) => {
        const m = ANCHO.exec(token)
        return m !== null && Number(m[1]) > LIMITE && !token.includes('lg:')
      })
    expect(
      culpables,
      `${archivo} declara anchos fijos de más de ${LIMITE}px sin prefijo ` +
        `lg:, así que en un teléfono de 390 desbordan y arrastran la página ` +
        `entera al scroll horizontal: ${culpables.join(', ')}. Escribilos ` +
        `mobile-first — el valor del teléfono sin prefijo y el de escritorio ` +
        `con lg: — o anotá el archivo en EXCEPCIONES con su razón.`,
    ).toEqual([])
  })

  it('EXCEPCIONES no nombra archivos que ya no existen', () => {
    const inexistentes = Object.keys(EXCEPCIONES).filter((f) => !archivos.includes(f))
    expect(inexistentes, `EXCEPCIONES nombra archivos que no están: ${inexistentes}`).toEqual([])
  })
})
