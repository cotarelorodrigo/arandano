import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SIDEBAR = 'components/shell/sidebar-arandano.tsx'
const INSTALAR = 'components/shell/instalar.tsx'

describe('el botón de instalar', () => {
  const sidebar = readFileSync(SIDEBAR, 'utf8')
  const instalar = readFileSync(INSTALAR, 'utf8')

  it('está montado en el pie del sidebar', () => {
    expect(sidebar).toContain('<Instalar')
  })

  // Una sola copia, y no por descuido: components/ui/sidebar.tsx renderiza el
  // mismo {children} en el Sheet del teléfono y en el riel de escritorio. Si
  // alguna vez aparece una segunda, tiene que ser una decisión visible en el
  // diff y no un descubrimiento en producción — es la lección que dejó el merge
  // del ciclo móvil con las dos copias de "Anular orden".
  it('aparece una sola vez', () => {
    expect(sidebar.match(/<Instalar/g)).toHaveLength(1)
  })

  // La decisión vive en lib/pwa/instalacion.ts, que sí se puede probar sin DOM.
  // Un componente que la reimplemente por su cuenta deja esos ocho casos
  // probando algo que la pantalla no usa.
  it('no reimplementa la decisión: la importa', () => {
    expect(instalar).toContain('estadoDeInstalacion')
    expect(instalar).not.toContain('/iPad|iPhone|iPod/')
  })

  it('escucha el evento del que depende el camino de Chrome', () => {
    expect(instalar).toContain('beforeinstallprompt')
  })
})
