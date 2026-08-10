import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Un archivo `'use server'` sólo puede exportar **funciones async**. Next.js no
 * lo comprueba al compilar: convierte cada export en un endpoint RPC y falla al
 * EVALUAR el módulo, en runtime, tirando abajo toda pantalla que lo importe.
 *
 * Este test existe porque ese agujero ya se pagó en producción: la pantalla de
 * usuarios exportaba una constante (`export { INICIAL }`, un objeto) desde su
 * archivo de actions. `npm test`, `tsc --noEmit`, `eslint` y `npm run build`
 * pasaban los cuatro en verde, y la pantalla no cargaba. Los tests importan el
 * módulo directo bajo vitest, donde el contrato de `'use server'` no rige.
 *
 * Se lee el fuente a propósito, y no se importa el módulo: importarlo es
 * justamente lo que no reproduce el problema.
 */

/** Archivos de página y de actions bajo app/, sin bajar a node_modules. */
function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      fuentes(completo, acumulado)
    } else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) {
      acumulado.push(completo)
    }
  }
  return acumulado
}

/** Los archivos que declaran 'use server' a nivel de módulo, en su primera línea útil. */
function archivosUseServer(): string[] {
  return fuentes('app').filter((f) => {
    const primera = readFileSync(f, 'utf8').split('\n').find((l) => l.trim() !== '')
    return primera !== undefined && /^['"]use server['"]/.test(primera.trim())
  })
}

describe("el contrato de los archivos 'use server'", () => {
  const archivos = archivosUseServer()

  it('encuentra archivos; si no, el test no prueba nada', () => {
    // Sin esta mitad, borrar app/ o romper el detector dejaría el test en verde
    // sin haber mirado un solo archivo.
    expect(archivos.length).toBeGreaterThan(0)
  })

  it('cada export es una función async', () => {
    for (const archivo of archivos) {
      const fuente = readFileSync(archivo, 'utf8')

      for (const [i, linea] of fuente.split('\n').entries()) {
        const texto = linea.trim()
        if (!texto.startsWith('export')) continue

        // `export type` y `export interface` se borran al compilar, así que no
        // llegan a ser exports en runtime y Next.js nunca los ve.
        if (/^export\s+(type|interface)\b/.test(texto)) continue

        expect(
          /^export\s+async\s+function\s/.test(texto),
          `${archivo}:${i + 1} exporta algo que no es una función async:\n` +
            `    ${texto}\n` +
            `  Un archivo 'use server' convierte CADA export en un endpoint RPC. ` +
            `Una constante, un tipo con valor, o una función sincrónica hacen que ` +
            `Next.js tire "A \\"use server\\" file can only export async functions" ` +
            `al evaluar el módulo — en runtime, con el build en verde. ` +
            `Si necesitás compartir un valor, definilo en el componente que lo usa.`,
        ).toBe(true)
      }
    }
  })
})
