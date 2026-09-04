import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { hexDelToken } from '@/scripts/tokens.mts'
import SinConexion from './page'

const FUENTE = 'app/sin-conexion/page.tsx'

describe('la pantalla sin conexión', () => {
  const fuente = readFileSync(FUENTE, 'utf8')

  // Es la propiedad de la que depende que el service worker no cachee datos de
  // ningún local. Si esta página resolviera tenant sería dinámica, y lo que
  // quedaría guardado en el celular sería el nombre de un negocio.
  it('no resuelve tenant ni lee headers ni abre sesión', () => {
    expect(fuente).not.toContain('tenantDelRequest')
    expect(fuente).not.toContain('next/headers')
    expect(fuente).not.toContain('exigirSesion')
  })

  // El SW cachea el HTML, no las hojas de estilo, que llevan hash en el nombre
  // y cambian en cada build. Sin conexión, una clase de Tailwind acá se vería
  // como HTML pelado — y nadie lo descubriría en dev, donde la red anda.
  it('se pinta sola, sin depender de ninguna clase', () => {
    expect(fuente).not.toContain('className')
  })

  it('sus colores son los tokens reales, y no hay ninguno suelto', () => {
    const esperados = {
      '--background': hexDelToken('--background'),
      '--foreground': hexDelToken('--foreground'),
      '--marca': hexDelToken('--marca'),
      '--foreground-soft': hexDelToken('--foreground-soft'),
    }

    for (const [token, hex] of Object.entries(esperados)) {
      expect(fuente, `${token} tiene que aparecer como ${hex} en ${FUENTE}`).toContain(hex)
    }

    // La otra dirección, que es la que impide que este hueco se vuelva a abrir:
    // sin ella, agregar mañana un quinto hex suelto no rompe nada y la pantalla
    // queda con un color que ningún token de la paleta respalda. Este archivo
    // ya se abrió una vez por atar sólo un subconjunto.
    const usados = [...new Set(fuente.match(/#[0-9a-f]{6}/g) ?? [])]
    expect(usados.sort()).toEqual(Object.values(esperados).sort())
  })

  it('dice qué pasó y no menciona ningún local', () => {
    const html = renderToStaticMarkup(<SinConexion />)
    expect(html).toContain('Sin conexión')
    expect(html).toContain('Arándano')
    expect(html).toContain('style=')
  })
})
