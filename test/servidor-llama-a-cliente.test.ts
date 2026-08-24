import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * El bug que este archivo existe para no repetir (ciclo de la UI de
 * categorías, 2026-08-24): `app/(app)/inventario/page.tsx` —un Server
 * Component— hacía `import { categoriaDeQuery } from './panel-categorias'`, y
 * ese archivo lleva `'use client'`. Next sirvió un **500 en cada visita** con
 * "Attempted to call categoriaDeQuery() from the server but categoriaDeQuery
 * is on the client".
 *
 * **Es la dirección INVERSA de lo que cubre `limite-cliente-servidor.test.ts`.**
 * Aquél vigila que un módulo CLIENTE no arrastre `pg` al bundle; éste, que un
 * módulo SERVIDOR no invoque una función que vive del lado del cliente. Son
 * dos bordes distintos del mismo límite, y ninguno de los dos ve el del otro.
 *
 * Por qué ningún otro chequeo lo vio, que es lo que lo hace peligroso:
 * `npm test` importa los módulos en Node, donde no existe la marca
 * `'use client'` y la función se invoca perfectamente; `npx tsc --noEmit` sólo
 * mira tipos, y el import está bien tipado; `npm run lint` no sabe de bordes
 * de React Server Components. **Ni siquiera `npm run build` lo atrapa**: el
 * error es de RUNTIME, cuando el server component se ejecuta. Lo único que lo
 * veía era abrir la pantalla — y la pantalla estaba en verde en los 1316 tests
 * del gate.
 *
 * Qué hace: por cada archivo de `app/` SIN `'use client'`, busca imports de
 * VALOR que vengan de un archivo CON `'use client'`, y falla si alguno de esos
 * identificadores se INVOCA como función. Renderizar un componente cliente sí
 * es legal —es para lo que existen—, así que los identificadores en PascalCase
 * no cuentan: la convención de React alcanza para distinguirlos.
 *
 * **Lo que NO cubre**, dicho para que nadie lo suponga: pasarle una FUNCIÓN
 * como prop a un componente cliente ("Functions cannot be passed directly to
 * Client Components"), que apareció en el mismo ciclo y a los cinco minutos
 * del anterior. Detectarlo estáticamente pide saber qué componente es cliente
 * en cada JSX y qué forma tiene cada prop; la red real para ése sigue siendo
 * abrir la pantalla, o el barrido de `scripts/smoke.sh`.
 */

const RAIZ = path.resolve(import.meta.dirname, '..')

function archivosDe(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada === '.next' || entrada === '.claude') continue
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) salida.push(...archivosDe(completo))
    else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) salida.push(completo)
  }
  return salida
}

const esCliente = (fuente: string) => /^\s*['"]use client['"]/m.test(fuente)

/** Resuelve un especificador relativo o con alias `@/` a un archivo real. */
function resolver(desde: string, especificador: string): string | null {
  let base: string
  if (especificador.startsWith('.')) base = path.resolve(path.dirname(desde), especificador)
  else if (especificador.startsWith('@/')) base = path.join(RAIZ, especificador.slice(2))
  else return null

  for (const candidato of [
    base, `${base}.ts`, `${base}.tsx`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
  ]) {
    try {
      if (statSync(candidato).isFile()) return candidato
    } catch {
      // No existe con esa extensión; se prueba la siguiente.
    }
  }
  return null
}

/** Los nombres importados como VALOR (no como tipo), con su origen. */
function importsDeValor(fuente: string): { nombres: string[]; desde: string }[] {
  const salida: { nombres: string[]; desde: string }[] = []
  const re = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  for (const m of fuente.matchAll(re)) {
    // `import type { ... }` entero no arrastra nada.
    if (m[1]) continue
    const nombres = m[2]
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n !== '' && !n.startsWith('type '))
      // `a as b`: el que se usa en este archivo es el alias.
      .map((n) => (n.includes(' as ') ? n.split(' as ')[1].trim() : n))
    if (nombres.length > 0) salida.push({ nombres, desde: m[3] })
  }
  return salida
}

describe('un Server Component no puede invocar una función de un módulo cliente', () => {
  const archivos = archivosDe(path.join(RAIZ, 'app'))

  it('encuentra archivos que auditar', () => {
    // Sin esto, un cambio en el recorrido dejaría el caso de abajo pasando por
    // vacío — verde sin haber mirado nada.
    expect(archivos.length).toBeGreaterThan(10)
  })

  it('ningún archivo de servidor llama a una función del lado del cliente', () => {
    const problemas: string[] = []

    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, 'utf8')
      if (esCliente(fuente)) continue

      for (const { nombres, desde } of importsDeValor(fuente)) {
        const destino = resolver(archivo, desde)
        if (!destino) continue
        if (!esCliente(readFileSync(destino, 'utf8'))) continue

        for (const nombre of nombres) {
          // PascalCase = componente. Renderizar un componente cliente desde el
          // servidor es exactamente para lo que existen.
          if (/^[A-Z]/.test(nombre)) continue
          // Invocado, no sólo importado: `nombre(` en cualquier parte.
          const invocado = new RegExp(`\\b${nombre}\\s*\\(`).test(fuente)
          if (invocado) {
            problemas.push(
              `${path.relative(RAIZ, archivo)} invoca ${nombre}(), que viene de ` +
                `${path.relative(RAIZ, destino)} — un módulo 'use client'`,
            )
          }
        }
      }
    }

    expect(problemas, problemas.join('\n')).toEqual([])
  })
})
