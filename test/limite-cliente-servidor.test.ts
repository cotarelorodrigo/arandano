import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/**
 * El bug que este archivo existe para no repetir (Critical post-review, ciclo
 * del cierre del rediseño, 2026-08-23): `app/(app)/servicio-tecnico/
 * formularios.tsx` lleva `'use client'` y hacía
 * `import { rotuloOrdenesPrevias, type ClienteEncontrado } from
 * '@/lib/clientes/administrar'`. `ClienteEncontrado` es un import de TIPO —no
 * arrastra nada—, pero `rotuloOrdenesPrevias` es un VALOR, así que arrastra el
 * módulo entero: `administrar.ts` importa `enTransaccionDeTenant`
 * (`@/lib/tenant/transaccion`), que importa `@/lib/db`, que importa `pg`. `pg`
 * usa el módulo `dns` de Node, que no existe en el navegador — Turbopack
 * fallaba la compilación del bundle de CLIENTE entera con "Module not found:
 * Can't resolve 'dns'", y se llevaba puestas /vender, /inventario y /usuarios
 * (500 en dev) sin que ninguna de esas tres pantallas tuviera nada que ver con
 * servicio-tecnico ni con clientes.
 *
 * Por qué ningún otro chequeo lo vio: `npm test` renderiza con
 * `renderToStaticMarkup` en Node, donde importar `pg` es perfectamente legal
 * —no hay bundle de cliente en juego—; `npx tsc --noEmit` sólo mira tipos, y
 * el import está bien tipado; `npm run lint` no sabe qué arrastra un import a
 * un bundle. Sólo `npm run build` (Turbopack armando el bundle de verdad) lo
 * atrapa, y nada de este gate lo corría antes de este ciclo. Este test es la
 * red que no depende de que alguien se acuerde de buildear.
 *
 * Qué hace: recorre todo archivo con `'use client'`, junta sus imports (y
 * re-exports) de VALOR, los sigue transitivamente —sólo por lo que un bundler
 * arrastra de verdad— y falla si la cadena llega a alguno de los tres módulos
 * que tocan Postgres a nivel de módulo: `lib/db.ts` (el propio `pg`),
 * `lib/tenant/transaccion.ts` y `lib/tenant/prisma.ts` (los dos importan
 * `lib/db` a nivel de módulo).
 *
 * **I1 de la review final del cierre (2026-08-23): la primera versión de este
 * archivo sólo seguía especificadores con alias `@/`, y el razonamiento
 * escrito acá ("los tres módulos sensibles son siempre internos") no cerraba
 * — lo que tiene que ser interno no es el DESTINO, sino CADA SALTO del
 * camino. El mismo bug exacto, escrito como
 * `import { rotuloOrdenesPrevias } from '../../../lib/clientes/administrar'`
 * en vez de con `@/`, pasaba en verde.** Se corrigieron los tres agujeros que
 * la review encontró leyendo el código, los tres reales una vez mutados a
 * mano:
 *
 * - **Especificadores relativos.** `resolverEspecificador` ahora resuelve
 *   `./foo`/`../foo` contra el directorio del archivo que los escribe, no
 *   sólo `@/…` contra la raíz del repo. Un Client Component que importe
 *   `./helpers`, con `helpers.ts` importando `@/lib/db`, ahora SÍ se sigue —
 *   antes el BFS nunca llegaba a `helpers.ts` porque el especificador que lo
 *   nombraba no arrancaba con `@/`.
 * - **`export … from`.** Un módulo intermedio que re-exporta un valor
 *   sensible (`export { x } from '@/lib/db'`) lo arrastra al bundle exactamente
 *   igual que un `import`, así que ahora cuenta igual. Un `export { A, B }`
 *   SIN `from` (re-exportar nombres locales, patrón real de
 *   `components/ui/card.tsx` y varios más) no tiene módulo que seguir: se
 *   detecta por BALANCE DE LLAVES, no buscando `from` a ciegas — buscarlo a
 *   ciegas repetiría el bug que el comentario de `importsDeValor` ya describe
 *   para imports (cruzar de largo hasta el próximo `from` de OTRO import/export
 *   más abajo).
 * - **Alcance del barrido.** Se suma `lib/` (y `modules/`, si llega a existir)
 *   además de `app/` y `components/`: un `'use client'` ahí quedaba afuera.
 *
 * Lo que este test SIGUE sin hacer: no arma un bundle de verdad ni resuelve
 * imports dinámicos (`import()`) ni paquetes externos (`pg`, `react`, etc.).
 * Sigue habiendo un motivo para correr `npm run build` antes de cerrar un
 * ciclo: este test cubre un modo de falla conocido con imports/re-exports
 * estáticos, no reemplaza al build real.
 */

const RAIZ = path.resolve(import.meta.dirname, '..')

/** Módulos que tocan Postgres a nivel de módulo — llegar a cualquiera desde
 *  un Client Component es el bug. Sin extensión: se resuelven igual que un
 *  import real. */
const SENSIBLES = ['lib/db.ts', 'lib/tenant/transaccion.ts', 'lib/tenant/prisma.ts'].map((p) =>
  path.join(RAIZ, p),
)

const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx']

/** Todos los .ts/.tsx/.js/.jsx del repo, sin node_modules ni directorios
 *  ocultos ni el propio directorio de tests de Playwright/worktrees. */
function fuentesDelRepo(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    if (entrada === 'node_modules' || entrada.startsWith('.')) continue
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      fuentesDelRepo(completo, acumulado)
    } else if (EXTENSIONES.includes(path.extname(entrada)) && !/\.test\.[tj]sx?$/.test(entrada)) {
      acumulado.push(completo)
    }
  }
  return acumulado
}

/** La primera línea no vacía de un archivo, o undefined si está vacío. */
function primeraLinea(ruta: string): string | undefined {
  return readFileSync(ruta, 'utf8')
    .split('\n')
    .find((l) => l.trim() !== '')
    ?.trim()
}

/** Si la primera línea no vacía del archivo declara 'use client'. */
function esUseClient(ruta: string): boolean {
  const primera = primeraLinea(ruta)
  return primera !== undefined && /^['"]use client['"]/.test(primera)
}

/**
 * Si la primera línea no vacía del archivo declara 'use server'.
 *
 * Load-bearing para el BFS de más abajo: un Client Component importando por
 * RUTA RELATIVA a su propio `acciones.ts` (`'use server'`, patrón de TODA
 * pantalla con formulario de este repo) es exactamente el caso que sumar
 * especificadores relativos iba a convertir en un falso positivo masivo —lo
 * fue, en la primera corrida de este fix: ocho Client Components señalados
 * por "arrastrar" `lib/tenant/prisma.ts`/`lib/db.ts` a través de su propio
 * `acciones.ts`. Y es un falso positivo real: Next.js reemplaza, en build,
 * cada función exportada de un archivo `'use server'` por una REFERENCIA
 * serializable — no incluye el cuerpo de la función ni sus imports en el
 * bundle de cliente. Seguir la cadena PASADO un `'use server'` mediría un
 * bundle que Next nunca arma. El BFS trata estos archivos como frontera: los
 * visita (para no volver a encolarlos) pero no sigue sus propios imports.
 */
function esUseServer(ruta: string): boolean {
  const primera = primeraLinea(ruta)
  return primera !== undefined && /^['"]use server['"]/.test(primera)
}

/**
 * Los especificadores de import/export de VALOR —con alias `@/` o
 * relativos (`./`, `../`)— de un archivo fuente.
 *
 * Barrido LÍNEA POR LÍNEA y no una sola regex sobre el archivo entero: la
 * primera versión de esta función usaba `/^import\s+([^;]*?)\s+from\s+.../gm`,
 * y `[^;]` —a diferencia de `.`— SÍ cruza saltos de línea. Sin punto y coma
 * al final de los imports (el estilo de todo este repo), el grupo lazy
 * cruzaba de largo el `from 'react'`/`from 'next/link'`/`from './acciones'`
 * del import siguiente —ninguno empieza con `@/`, así que el regex seguía
 * buscando— hasta enganchar el PRÓXIMO `from '@/...'` que encontrara, aunque
 * perteneciera a un import DISTINTO varias líneas más abajo. El resultado:
 * un `import type { X } from '@/lib/ventas/buscar'` (100% tipo, no debería
 * contar) se leía pegado al `import { Fragment, ... } from 'react'` de más
 * arriba, y como esa mezcla no empezaba con "type", se contaba como VALOR —
 * dos falsos positivos reales en la primera corrida
 * (`app/(app)/vender/punto-de-venta.tsx`, `components/navegacion.tsx`), los
 * dos con el mismo patrón: un import de tipo justo después de uno o más
 * imports de paquetes externos. Acumular línea por línea y cerrar el import
 * apenas aparece un `from '...'` —sin poder cruzar al próximo `import`— es
 * lo que lo evita.
 *
 * `export … from` se suma con el MISMO mecanismo (I1 de la review final),
 * pero con un cierre distinto: un import siempre termina en `from '...'`, así
 * que basta esperarlo. Un `export { A, B }` puede terminar SIN `from`
 * (re-exportar nombres locales — patrón real de `components/ui/card.tsx` y
 * varios más), así que esperar un `from` a ciegas repetiría el bug de arriba:
 * seguiría de largo hasta enganchar el PRÓXIMO `from` del archivo, de un
 * import/export completamente distinto. Un export cierra en cambio cuando el
 * BALANCE DE LLAVES de su propia cláusula vuelve a 0 —recién ahí se sabe si
 * hubo o no un `from` de verdad— salvo el caso `export * from '...'`, que no
 * abre ninguna llave y cierra en su propia línea.
 */
function especificadoresDeValor(ruta: string): string[] {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  const especificadores: string[] = []
  let dentro = false
  let esImport = false
  let buffer = ''
  let profundidad = 0
  for (const linea of lineas) {
    if (!dentro) {
      const t = linea.trim()
      if (/^import\b/.test(t)) {
        dentro = true
        esImport = true
        buffer = linea
        profundidad = 0
      } else if (/^export\s+(type\s+)?[*{]/.test(t)) {
        dentro = true
        esImport = false
        buffer = linea
        profundidad = 0
      } else {
        continue
      }
    } else {
      buffer += '\n' + linea
    }

    for (const caracter of linea) {
      if (caracter === '{') profundidad++
      else if (caracter === '}') profundidad--
    }

    const m = buffer.match(/from\s+['"]([^'"]+)['"]/)
    if (esImport) {
      if (!m) continue // Sigue siendo el mismo import, todavía sin cerrar.
    } else {
      if (profundidad > 0) continue // El export { ... todavía no cerró sus llaves.
    }

    dentro = false
    if (m) {
      const clausula = buffer
        .replace(/^(import|export)\s+/, '')
        .replace(/\s*from[\s\S]*$/, '')
        .trim()
      const especificador = m[1]
      const esRelativo = especificador.startsWith('./') || especificador.startsWith('../')
      if ((especificador.startsWith('@/') || esRelativo) && !/^type\b/.test(clausula)) {
        especificadores.push(especificador)
      }
    }
    // Si no hubo `m`, era un `export { ... }` sin `from` — nombres locales,
    // nada que seguir. Se descarta el buffer entero y se sigue barriendo.
    buffer = ''
    profundidad = 0
  }
  return especificadores
}

/**
 * Un especificador de import/export -> ruta absoluta del archivo, probando
 * extensiones e `index`. Devuelve null si no resuelve a nada (paquete
 * externo, `.css`, etc. — no hay nada que seguir ahí).
 *
 * `actual` es el archivo que ESCRIBE el especificador: imprescindible para
 * los relativos (`./foo`, `../foo`), que se resuelven contra SU directorio,
 * no contra la raíz del repo — a diferencia de `@/...`, que siempre cuelga
 * de `RAIZ` sin importar quién lo escribe.
 */
function resolverEspecificador(especificador: string, actual: string): string | null {
  let base: string
  if (especificador.startsWith('@/')) {
    base = path.join(RAIZ, especificador.replace(/^@\//, ''))
  } else if (especificador.startsWith('.')) {
    base = path.resolve(path.dirname(actual), especificador)
  } else {
    return null // Paquete externo (react, next/link, pg, ...): nada que seguir.
  }
  for (const ext of EXTENSIONES) {
    if (existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONES) {
    if (existsSync(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext)
  }
  return null
}

/**
 * Si desde `rutaInicial` se puede llegar a alguno de `SENSIBLES` siguiendo
 * sólo imports/re-exports de VALOR (alias `@/` o relativos). BFS con
 * visitados para no ciclar.
 */
function arrastraSensible(rutaInicial: string): string | null {
  const visitados = new Set<string>([rutaInicial])
  const cola = [rutaInicial]
  while (cola.length > 0) {
    const actual = cola.shift()!
    for (const especificador of especificadoresDeValor(actual)) {
      const resuelto = resolverEspecificador(especificador, actual)
      if (!resuelto || visitados.has(resuelto)) continue
      if (SENSIBLES.includes(resuelto)) return resuelto
      visitados.add(resuelto)
      if (esUseServer(resuelto)) continue // Frontera: ver el comentario de esUseServer.
      cola.push(resuelto)
    }
  }
  return null
}

// Las cuatro carpetas donde puede vivir un 'use client': app/ y components/
// ya se barrían; lib/ se suma acá (I1 de la review final — un 'use client'
// ahí quedaba afuera) y modules/ queda anotado para cuando exista de verdad
// (CLAUDE.md, "monolito modular con registry") — el filter de abajo lo
// saltea sin romper mientras la carpeta no esté, en vez de que readdirSync
// tire ENOENT el día que se cree con un solo archivo adentro.
const CARPETAS_A_BARRER = ['app', 'components', 'lib', 'modules']
  .map((carpeta) => path.join(RAIZ, carpeta))
  .filter((ruta) => existsSync(ruta))

describe('ningún Client Component arrastra Postgres a su bundle', () => {
  const archivos = CARPETAS_A_BARRER.flatMap((carpeta) => fuentesDelRepo(carpeta))

  it('encuentra archivos; si no, el test no prueba nada', () => {
    expect(archivos.length).toBeGreaterThan(0)
  })

  it('encuentra al menos un archivo "use client"; si no, el barrido está roto', () => {
    expect(archivos.some(esUseClient)).toBe(true)
  })

  it('ningún archivo "use client" alcanza lib/db.ts, lib/tenant/transaccion.ts ni lib/tenant/prisma.ts', () => {
    const rotos: string[] = []
    for (const archivo of archivos) {
      if (!esUseClient(archivo)) continue
      const sensible = arrastraSensible(archivo)
      if (sensible) {
        rotos.push(`${path.relative(RAIZ, archivo)} -> ${path.relative(RAIZ, sensible)}`)
      }
    }
    expect(
      rotos,
      `estos Client Components arrastran un módulo que toca Postgres a nivel de módulo ` +
        `(vía algún import de VALOR, no de tipo): ${rotos.join(', ')}. Eso hace que \`pg\` ` +
        `entre al bundle del navegador, que Turbopack no sepa resolver 'dns' y que la ` +
        `compilación del cliente ENTERA falle — no sólo la pantalla que lo importó. Sacá el ` +
        `valor que arrastra el módulo sensible a un archivo aparte, sin la importación de\n` +
        `transacciones/Prisma a nivel de módulo (ver lib/clientes/rotulos.ts para el ` +
        `precedente), y dejá el import de tipo tal cual está.`,
    ).toEqual([])
  })
})
