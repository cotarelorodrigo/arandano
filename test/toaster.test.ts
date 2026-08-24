import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Dónde vive el `<Toaster>`, y por qué no es una preferencia de orden.
 *
 * **El bug** (2026-08-24, reportado por el dueño del producto probando el ABM
 * de categorías): "la notification desaparece al instante y no se llega a
 * leer", con los toasts de error puestos en `duration: Infinity`.
 *
 * **La causa**: el `<Toaster>` de sonner guarda los toasts visibles en un
 * `useState([])` propio y se suscribe al store recién en su `useEffect` —
 * nunca lee los que ya existen. Remontarlo los borra de la pantalla. Y estaba
 * montado en `app/(app)/layout.tsx`, mientras cada acción del ABM termina en
 * `revalidatePath('/inventario')`, que invalida la ruta **con todos sus
 * layouts**: el aviso moría en el mismo refresh que lo disparaba, sin importar
 * su duración.
 *
 * **Por qué hace falta un test y no alcanza el comentario**: el síntoma no
 * apunta al layout por ningún lado. Se ve como un problema de `duration`, y el
 * primer instinto —el mío— es tocar la duración, que es justamente lo único
 * que no tenía nada que ver. Mover el `<Toaster>` "para ordenar" reintroduce
 * el bug entero sin tocar una línea del código que avisa.
 */

const RAIZ = path.resolve(import.meta.dirname, '..')

function archivosDe(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next') continue
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) salida.push(...archivosDe(completo))
    else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) salida.push(completo)
  }
  return salida
}

describe('el Toaster vive en el root layout', () => {
  const ROOT = path.join(RAIZ, 'app/layout.tsx')

  it('el root layout lo monta', () => {
    expect(readFileSync(ROOT, 'utf8')).toMatch(/<Toaster\b/)
  })

  /**
   * Uno solo, y en el layout que ningún `revalidatePath` de pantalla invalida.
   * Dos montados a la vez además dibujarían cada aviso dos veces.
   */
  it('ningún otro archivo lo monta', () => {
    const otros = archivosDe(path.join(RAIZ, 'app'))
      .filter((f) => f !== ROOT)
      .filter((f) => /<Toaster\b/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(RAIZ, f))

    expect(
      otros,
      `estos archivos montan un <Toaster> además del root layout: ${otros.join(', ')}. ` +
        `Un segundo Toaster dibuja cada aviso dos veces, y montarlo en un layout ` +
        `que revalidatePath invalida hace que los avisos desaparezcan al instante ` +
        `— el Toaster arranca con useState([]) y no lee los toasts que ya existen.`,
    ).toEqual([])
  })

  // El root layout tiene que seguir siendo estático: si alguien le pusiera
  // `force-dynamic`, volvería a entrar en el radio de los revalidate.
  it('el root layout no es force-dynamic', () => {
    expect(readFileSync(ROOT, 'utf8')).not.toContain("dynamic = 'force-dynamic'")
  })
})
