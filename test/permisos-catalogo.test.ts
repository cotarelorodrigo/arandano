import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PERMISOS, CLAVES_DE_PERMISO } from '@/lib/permisos/catalogo'

const SCHEMA = readFileSync('prisma/schema.prisma', 'utf8')

/** Los valores del enum Permiso tal como los declara el schema. */
function clavesDelSchema(): string[] {
  const bloque = SCHEMA.slice(SCHEMA.indexOf('enum Permiso {'))
  const cuerpo = bloque.slice(bloque.indexOf('{') + 1, bloque.indexOf('}'))
  return cuerpo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l))
}

describe('el catálogo de permisos', () => {
  it('encuentra el enum en el schema; si no, el test no prueba nada', () => {
    expect(clavesDelSchema().length).toBeGreaterThan(0)
  })

  // Las dos direcciones. Una unión escrita a mano que se desincronice del enum
  // deja al servidor aceptando un permiso que la base rechaza, o al revés: un
  // valor de la base que ninguna pantalla ofrece nunca.
  it('tiene exactamente las claves del enum del schema', () => {
    expect([...CLAVES_DE_PERMISO].sort()).toEqual(clavesDelSchema().sort())
  })

  it('cada permiso tiene nombre visible y ayuda, sin repetirse', () => {
    for (const p of PERMISOS) {
      expect(p.nombre.length, `${p.clave} sin nombre`).toBeGreaterThan(0)
      expect(p.ayuda.length, `${p.clave} sin ayuda`).toBeGreaterThan(0)
    }
    expect(new Set(PERMISOS.map((p) => p.nombre)).size).toBe(PERMISOS.length)
  })
})
