import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { destinoAlEntrar } from './destino'

describe('cada rol abre donde trabaja', () => {
  it('el dueño abre en el tablero', () => {
    expect(destinoAlEntrar('DUENO')).toBe('/dashboard')
  })

  it('el empleado abre en el mostrador', () => {
    expect(destinoAlEntrar('EMPLEADO')).toBe('/vender')
  })
})

/**
 * Los DOS lugares que redirigen al entrar, atados a `destinoAlEntrar` en vez
 * de a un literal cada uno — mismo modo de falla que
 * `test/permisos-en-las-dos-copias.test.ts` (el merge del ciclo móvil dejó una
 * de las dos copias de "Anular orden" atada al permiso viejo con el gate en
 * verde), y misma forma de cubrirlo: contar en las DOS direcciones. Con la
 * función, los dos archivos la importan; sin ella, ninguno lleva un
 * `redirect('/vender')` ni un `redirect('/dashboard')` sueltos. Un
 * `not.toContain` solo no alcanzaría: pasaría igual si un solo archivo quedó
 * bien y el otro no.
 */
describe('el destino se deriva en UNA función, no en dos literales', () => {
  const HOME = readFileSync('app/page.tsx', 'utf8')
  const LOGIN = readFileSync('app/login/acciones.ts', 'utf8')

  it('los dos archivos importan destinoAlEntrar', () => {
    expect(HOME).toContain("import { destinoAlEntrar } from '@/lib/auth/destino'")
    expect(LOGIN).toContain("import { destinoAlEntrar } from '@/lib/auth/destino'")
  })

  it('ninguno de los dos contiene un redirect literal a /vender ni a /dashboard', () => {
    for (const fuente of [HOME, LOGIN]) {
      expect(fuente).not.toContain("redirect('/vender')")
      expect(fuente).not.toContain("redirect('/dashboard')")
    }
  })
})
