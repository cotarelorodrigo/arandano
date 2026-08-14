import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

// Se mockea el header y no piezasDeOrigen(), igual que en app/page.test.tsx: así
// el test ejercita la función de verdad —incluida su lista blanca de protocolo—
// en vez de una versión de mentira que puede divergir de ella.
const cabeceras = vi.hoisted(() => ({ proto: 'https' }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-proto': cabeceras.proto }),
}))

async function render() {
  const { default: NoEncontrado } = await import('@/app/not-found')
  return renderToStaticMarkup(await NoEncontrado())
}

describe('página 404', () => {
  beforeEach(() => {
    vi.resetModules()
    cabeceras.proto = 'https'
    vi.stubEnv('DOMINIO_BASE', 'arandano.app')
    vi.stubEnv('PUERTO_PUBLICO', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('dice qué pasó sin afirmar nada que sea falso en alguno de los cuatro caminos', async () => {
    // Este boundary es único para todo el árbol: lo alcanzan el subdominio
    // inexistente, el reservado, el host ajeno y también el notFound() de una
    // pantalla de adentro de la aplicación, con un usuario logueado en un local
    // que SÍ existe. Por eso el texto no puede hablar del local: decirle a un
    // dueño que su negocio no existe porque tipeó /inventario/foo es peor que
    // no decirle nada.
    const html = await render()
    expect(html).toContain('No encontramos esta página.')
    expect(html).not.toMatch(/no existe ning[úu]n local/i)
  })

  it('la salida es el ápex en absoluto, con el protocolo y el puerto de ESTE entorno', async () => {
    // Absoluto y no `/`: desde un subdominio que no resuelve, `/` es esta misma
    // página. Y armado con piezasDeOrigen() y no cableado, por lo mismo que el
    // "Ya tengo cuenta" de la landing: la imagen se buildea una vez y se
    // promueve de stage a prod, así que un valor horneado sería el de otro
    // entorno.
    expect(await render()).toContain('href="https://arandano.app"')

    vi.resetModules()
    cabeceras.proto = 'http'
    vi.stubEnv('DOMINIO_BASE', 'dev.arandano.app')
    vi.stubEnv('PUERTO_PUBLICO', '3000')
    expect(await render()).toContain('href="http://dev.arandano.app:3000"')
  })

  it('lleva el marcador que mira scripts/smoke.sh', async () => {
    // caso_subdominio_inexistente_404 afirma el 404 Y este marcador: sin él, el
    // caso pasaría igual con el 404 pelado de Next, o sea que el gate no
    // distinguiría si esta página existe.
    expect(await render()).toContain('data-testid="pagina-404"')
  })

  it('no emite el marcador de pantalla, que volvería verde el barrido del gate', async () => {
    // Un cable trampa, no prolijidad, y es la misma familia de agujero que
    // cierra test/boundaries-app.test.ts por la otra puerta.
    //
    // caso_pantalla de scripts/smoke.sh distingue una pantalla de verdad de un
    // 200 vacío buscando `data-testid="tenant-nombre"`. Ese marcador lo emite
    // app/(app)/layout.tsx, y hoy una pantalla rota da rojo porque notFound()
    // sube hasta ESTE boundary, que no renderiza aquel layout. Si esta página
    // emitiera el mismo marcador, el barrido se volvería verde sobre cada
    // pantalla rota — y encima en silencio, porque Next incluye el payload de
    // este boundary en el cuerpo de TODA página, incluidas las que funcionan
    // (medido: el ápex responde 200 con este árbol adentro).
    expect(await render()).not.toContain('tenant-nombre')
  })

  it('no consulta Postgres', async () => {
    // Estructural y no de comportamiento a propósito: lo que se protege es que
    // un 404 sea barato. Esta página la sirve cualquier bot escaneando
    // subdominios, y el pool de la aplicación es max: 5 — es el mismo
    // amplificador de carga que ya está anotado para el nivel anónimo de
    // /api/health. Resolver el tenant acá sería gratis de escribir y caro de
    // descubrir.
    const fuente = readFileSync('app/not-found.tsx', 'utf8')
    expect(fuente).not.toMatch(/from '@\/lib\/(tenant|db)/)
  })
})
