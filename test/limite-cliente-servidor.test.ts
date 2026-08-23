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
 * Qué hace: recorre todo archivo con `'use client'`, junta sus imports de
 * VALOR (no de tipo) que empiecen con `@/`, los sigue transitivamente —sólo
 * por imports de valor, que es lo único que un bundler arrastra de verdad— y
 * falla si la cadena llega a alguno de los tres módulos que tocan Postgres a
 * nivel de módulo: `lib/db.ts` (el propio `pg`), `lib/tenant/transaccion.ts` y
 * `lib/tenant/prisma.ts` (los dos importan `lib/db` a nivel de módulo).
 *
 * Lo que este test NO hace: no arma un bundle de verdad ni resuelve imports
 * dinámicos (`import()`) o de paquetes externos (`pg`, `react`, etc.) — sólo
 * seguir `@/...` alcanza para este agujero, porque los tres módulos
 * sensibles son siempre internos. Sigue habiendo un motivo para correr
 * `npm run build` antes de cerrar un ciclo: este test cubre EXACTAMENTE este
 * modo de falla, no reemplaza al build real.
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

/** Si la primera línea no vacía del archivo declara 'use client'. */
function esUseClient(ruta: string): boolean {
  const primera = readFileSync(ruta, 'utf8')
    .split('\n')
    .find((l) => l.trim() !== '')
  return primera !== undefined && /^['"]use client['"]/.test(primera.trim())
}

/**
 * Los especificadores de import de VALOR que empiezan con `@/`, de un
 * archivo fuente.
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
 */
function importsDeValor(ruta: string): string[] {
  const lineas = readFileSync(ruta, 'utf8').split('\n')
  const especificadores: string[] = []
  let dentro = false
  let buffer = ''
  for (const linea of lineas) {
    if (!dentro) {
      if (!/^import\b/.test(linea.trim())) continue
      dentro = true
      buffer = linea
    } else {
      buffer += '\n' + linea
    }
    const m = buffer.match(/from\s+['"]([^'"]+)['"]/)
    if (!m) continue // Sigue siendo el mismo import, todavía sin cerrar.
    const clausula = buffer
      .replace(/^import\s+/, '')
      .replace(/\s*from[\s\S]*$/, '')
      .trim()
    if (m[1].startsWith('@/') && !/^type\b/.test(clausula)) {
      especificadores.push(m[1])
    }
    dentro = false
    buffer = ''
  }
  return especificadores
}

/** `@/lib/foo` -> ruta absoluta del archivo, probando extensiones e
 *  `index`. Devuelve null si no resuelve a nada (paquete externo, .css, etc. —
 *  no hay nada que seguir ahí). */
function resolverEspecificador(especificador: string): string | null {
  const sinAlias = especificador.replace(/^@\//, '')
  const base = path.join(RAIZ, sinAlias)
  for (const ext of EXTENSIONES) {
    if (existsSync(base + ext)) return base + ext
  }
  for (const ext of EXTENSIONES) {
    if (existsSync(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext)
  }
  return null
}

/**
 * Si desde `ruta` se puede llegar a alguno de `SENSIBLES` siguiendo sólo
 * imports de VALOR con alias `@/`. BFS con visitados para no ciclar.
 */
function arrastraSensible(rutaInicial: string): string | null {
  const visitados = new Set<string>([rutaInicial])
  const cola = [rutaInicial]
  while (cola.length > 0) {
    const actual = cola.shift()!
    for (const especificador of importsDeValor(actual)) {
      const resuelto = resolverEspecificador(especificador)
      if (!resuelto || visitados.has(resuelto)) continue
      if (SENSIBLES.includes(resuelto)) return resuelto
      visitados.add(resuelto)
      cola.push(resuelto)
    }
  }
  return null
}

describe('ningún Client Component arrastra Postgres a su bundle', () => {
  const archivos = fuentesDelRepo(path.join(RAIZ, 'app')).concat(
    fuentesDelRepo(path.join(RAIZ, 'components')),
  )

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
