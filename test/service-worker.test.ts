import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SW = 'public/sw.js'

/**
 * Las rutas de la aplicación, derivadas del sistema de archivos.
 *
 * Filtra la raíz ('/'): si algún día existiera `app/(app)/page.tsx`, `partes`
 * quedaría vacío y el join daría '/', y el caso de abajo
 * (`expect(fuente).not.toContain(ruta)`) fallaría contra CUALQUIER archivo que
 * contenga una barra —o sea, siempre—, con un rojo que no habla de lo que este
 * test verifica. Hoy no hay tal `page.tsx`, así que esto no cambia el
 * comportamiento actual: es una guarda para cuando lo haya.
 */
function rutasDeLaApp(dir = 'app/(app)', acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) rutasDeLaApp(completo, acumulado)
    else if (/^page\.(tsx|ts|jsx|js)$/.test(entrada)) {
      const partes = path
        .dirname(completo)
        .split(path.sep)
        .slice(1)
        .filter((p) => !(p.startsWith('(') && p.endsWith(')')))
      const ruta = '/' + partes.join('/')
      if (ruta.length > 1) acumulado.push(ruta)
    }
  }
  return acumulado
}

describe('el service worker no puede guardar datos de ningún local', () => {
  const fuente = readFileSync(SW, 'utf8')

  // La propiedad central del diseño. Un SW sobrevive al rollback de la imagen,
  // así que lo que cachee mal se queda en el celular del dueño después de que
  // el healthcheck ya revirtió todo lo demás.
  it('la única URL que cachea es la pantalla sin conexión', () => {
    const agregadas = [...fuente.matchAll(/cache\.add(?:All)?\(([^)]*)\)/g)]
    expect(agregadas).toHaveLength(1)
    expect(agregadas[0][1]).toContain('SIN_CONEXION')
    expect(fuente).toContain("const SIN_CONEXION = '/sin-conexion'")
  })

  it('no nombra ninguna pantalla de la aplicación', () => {
    for (const ruta of rutasDeLaApp()) {
      expect(fuente, `${SW} no puede nombrar ${ruta}`).not.toContain(ruta)
    }
  })

  it('no toca la API', () => {
    expect(fuente).not.toContain('/api')
  })

  // Un formulario enviado sin JavaScript es una navegación POST. Devolverle una
  // página cacheada de GET es responder algo que no se pidió.
  it('sólo interviene en navegaciones GET', () => {
    expect(fuente).toContain("pedido.method !== 'GET'")
    expect(fuente).toContain("pedido.mode !== 'navigate'")
  })

  it('borra las cachés de las versiones anteriores', () => {
    expect(fuente).toContain('caches.delete')
  })
})
