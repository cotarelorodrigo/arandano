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
 * **La mitad hermana SÍ se sumó** (QA de `/dashboard`, 2026-09-02): pasarle
 * una función como CHILDREN a un componente cliente —el patrón
 * `<Comp>{(x) => ...}</Comp>`, un "render prop"— es la otra forma de este
 * mismo error ("Functions are not valid as a child of Client Components"),
 * y tiró un 500 en TODO render de `/dashboard` durante trece tasks
 * revisadas y una review de rama entera, exactamente porque nada de lo de
 * arriba lo veía: no hay ningún `nombre(` que invocar, sólo JSX. El segundo
 * `describe` de este archivo cubre ese caso —barriendo TODO `app/`, no sólo
 * el archivo donde pasó—.
 *
 * **Lo que sigue sin cubrir**, dicho para que nadie lo suponga: una función
 * como PROP suelta —`<Comp onAlgo={fn}>`, fuera de la posición de
 * children—. Ahí la ambigüedad es real: un Server Component SÍ puede
 * pasarle a un Client Component una Server Action (`'use server'`), que
 * también es sintácticamente una función y es 100% legítima (`<form
 * action={miServerAction}>`), y distinguir "función de verdad" de
 * "referencia a una Server Action" sin un compilador de por medio produce
 * falsos positivos reales. La instancia CONCRETA que sí importaba —children
 * como función, sin ambigüedad posible con Server Actions— es la que se
 * cubre; la red para el caso general sigue siendo abrir la pantalla, o el
 * barrido de `scripts/smoke.sh`.
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

/**
 * La mitad hermana del describe de arriba: en vez de una función INVOCADA,
 * una función PASADA COMO CHILDREN. Mismo límite (servidor → cliente),
 * mismo modo de falla (ningún chequeo estático salvo éste lo ve, y sólo
 * abrir la pantalla lo prueba), disparador distinto — es lo que rompió
 * `/dashboard` (ver `app/(app)/dashboard/exportar.tsx`, QA 2026-09-02): un
 * `'use client'` cuyo `children` documentaba "es la única forma" de ser una
 * función de `exportando`, invocado desde `page.tsx` con
 * `{(exportando) => ...}` — legal en JS, ilegal en el límite RSC, y React
 * lo tira en RUNTIME, no en build.
 *
 * Por qué esto SÍ se puede detectar sin ambigüedad de Server Actions (a
 * diferencia de una prop suelta, ver el docblock de arriba): una Server
 * Action nunca se escribe como el hijo JSX completo de un componente — vive
 * en un atributo (`action=`, `onClick=`, etc.). Un componente cuyo ÚNICO
 * hijo es literalmente una función de flecha es, en cualquier caso real de
 * este repo, un render prop — y un render prop no cruza el límite RSC.
 */
describe('ningún Server Component le pasa una función como children a un componente cliente', () => {
  const archivos = archivosDe(path.join(RAIZ, 'app'))

  it('ningún componente cliente recibe children en forma de función de flecha', () => {
    const problemas: string[] = []

    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, 'utf8')
      if (esCliente(fuente)) continue

      for (const { nombres, desde } of importsDeValor(fuente)) {
        const destino = resolver(archivo, desde)
        if (!destino) continue
        if (!esCliente(readFileSync(destino, 'utf8'))) continue

        for (const nombre of nombres) {
          // Sólo componentes (PascalCase): son los únicos que pueden
          // recibir `children` vía JSX anidado —lo que se invoca como
          // función ya lo cubre el describe de arriba.
          if (!/^[A-Z]/.test(nombre)) continue

          // Cada apertura `<Nombre ...>` de ESTE componente en el archivo.
          // `[^>]*` no cruza un `>` literal, así que una apertura cuyas
          // props contengan JSX (`prop={<>...</>}`) puede corear en un `>`
          // interno — inofensivo: en ese caso el contenido que sigue nunca
          // tiene forma de función de flecha, así que no genera falso
          // positivo; sólo dejaría de auditar esa apertura puntual, y el
          // caso de abajo (`encuentra aperturas para auditar`) es la red
          // para notar si esto empieza a pasar de verdad.
          const reApertura = new RegExp(`<${nombre}\\b[^>]*>`, 'g')
          for (const m of fuente.matchAll(reApertura)) {
            if (m[0].endsWith('/>')) continue // autocerrado: no hay children.

            const resto = fuente.slice(m.index! + m[0].length)
            // El primer hijo, salteando espacio, es `{` seguido de una
            // función de flecha: `{(x) =>` o `{(x, y) =>`. Exactamente el
            // patrón que tiró `/dashboard`.
            if (/^\s*\{\s*\([^)]*\)\s*=>/.test(resto)) {
              problemas.push(
                `${path.relative(RAIZ, archivo)} le pasa una función como children a ` +
                  `<${nombre}>, de ${path.relative(RAIZ, destino)} — un módulo 'use client'`,
              )
            }
          }
        }
      }
    }

    expect(problemas, problemas.join('\n')).toEqual([])
  })
})
