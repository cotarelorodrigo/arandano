import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * `Usuarios` (el default export de page.tsx) es un Server Component async que
 * abre sesión con `exigirDuenio()` y consulta Prisma — este repo no tiene el
 * arnés para montarlo fuera de un request real (mismo criterio que
 * app/(app)/ventas/page.test.tsx e inventario/page.test.tsx). Leer el FUENTE
 * como texto es lo que ya usan esos dos archivos para cablear algo que ni
 * jsdom ni una sesión real de este repo pueden ejercitar.
 *
 * I3 de la review final del cierre: el Topbar de esta pantalla no tenía el
 * botón "Agregar persona" que design/arandano.pen dibuja (nodo `tr89h`,
 * consultado en vivo), sin que ninguna nota declarara por qué. Este test ata
 * las dos mitades del cableado —el botón en page.tsx y el ancla que lo
 * recibe en formularios.tsx— para que un futuro refactor que rompa cualquiera
 * de los dos lo note.
 */
describe('el botón "Agregar persona" del Topbar (I3 de la review final)', () => {
  const fuentePagina = readFileSync('app/(app)/usuarios/page.tsx', 'utf8')
  const fuenteFormularios = readFileSync('app/(app)/usuarios/formularios.tsx', 'utf8')

  it('page.tsx pasa `acciones` al <Encabezado>, con el botón apuntando a #alta', () => {
    expect(fuentePagina).toContain('acciones={')
    expect(fuentePagina).toContain('href="#alta"')
    expect(fuentePagina).toContain('Agregar persona')
  })

  it('el href="#alta" tiene un destino real: la card de Alta lleva id="alta"', () => {
    expect(fuenteFormularios).toContain('<CardConEncabezado id="alta" titulo="Agregar a alguien">')
  })
})
