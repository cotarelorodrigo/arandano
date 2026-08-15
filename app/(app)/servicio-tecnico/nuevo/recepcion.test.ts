import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Que el buscador de clientes esté ENCHUFADO, no sólo escrito.
 *
 * `buscarClientes` existió durante once tasks sin que lo llamara una sola
 * pantalla: la recepción resolvía el cliente con un desplegable de los primeros
 * 50, y en acciones.test.ts la función estaba mockeada, así que parecía cableada
 * mirando los tests. Un local pasado los 50 clientes no podía elegir nunca a los
 * que ordenan después del corte, y el mostrador les creaba un duplicado en cada
 * visita.
 *
 * Se lee el fuente y no se importa el módulo, por el mismo motivo que
 * test/use-server.test.ts: importarlo es justamente lo que no reproduce el
 * problema. Un mock no puede hacer pasar esto.
 */
function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) fuentes(completo, acumulado)
    else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) acumulado.push(completo)
  }
  return acumulado
}

describe('el buscador de clientes de la recepción', () => {
  const archivos = fuentes('app')

  it('encuentra archivos; si no, el test no prueba nada', () => {
    expect(archivos.length).toBeGreaterThan(0)
  })

  it('alguna pantalla llama a buscarClientes', () => {
    const usan = archivos.filter((f) => /\bbuscarClientes\b/.test(readFileSync(f, 'utf8')))
    expect(
      usan,
      'buscarClientes volvió a quedar sin llamador: el spec pide que el cliente se resuelva ' +
        'BUSCANDO por nombre o teléfono, y un desplegable con los primeros N deja afuera para ' +
        'siempre a los que ordenan después del corte.',
    ).not.toEqual([])
  })

  it('la recepción no vuelve a listar clientes por su cuenta', () => {
    // La otra mitad: sin esto, agregar de nuevo el desplegable al lado del
    // buscador dejaría el test de arriba en verde.
    const recepcion = readFileSync(path.join('app', '(app)', 'servicio-tecnico', 'nuevo', 'page.tsx'), 'utf8')
    expect(recepcion).not.toMatch(/cliente\.findMany/)
  })
})
