import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
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

function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) fuentes(completo, acumulado)
    else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) acumulado.push(completo)
  }
  return acumulado
}

describe('el catálogo y el código, en las dos direcciones', () => {
  // lib/permisos/ queda afuera: el catálogo se nombra a sí mismo ahí, y contarlo
  // haría que ningún permiso pudiera dar cero aunque nada lo exija. Es el mismo
  // punto ciego del grep de tokens que documenta CLAUDE.md.
  const CODIGO = [...fuentes('app'), ...fuentes('lib')]
    .filter((f) => !f.startsWith(path.join('lib', 'permisos')))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')

  // Las llamadas reales, no cualquier mención entrecomillada: un permiso que
  // sólo aparece en un comentario o un mensaje de error no destraba nada, y
  // "aparece en algún lado del texto" lo dejaría pasar igual. Dos formas, no
  // una: las tres primeras reciben el permiso como PRIMER argumento, y
  // `puedeConSesion` lo recibe como SEGUNDO. Meterlas en una sola alternancia
  // no funciona — la alternativa que consume el `(` deja al resto del patrón
  // buscando un segundo `(` que no existe, y ese caso quedaría sin cubrir sin
  // que nada avise.
  const llamadasPuedeConSesion = [...CODIGO.matchAll(/puedeConSesion\([^,)]+,\s*'([A-Z_]+)'/g)]
  const usados = new Set(
    [
      ...CODIGO.matchAll(/(?:exigirPermiso|comoPuede|puede)\(\s*'([A-Z_]+)'/g),
      ...llamadasPuedeConSesion,
    ].map((m) => m[1]),
  )

  it('encuentra fuentes; si no, el test no prueba nada', () => {
    expect(CODIGO.length).toBeGreaterThan(1000)
  })

  // El caso de puedeConSesion existe de verdad: si ese regex no encuentra
  // nada, la unión de arriba igual podría no estar vacía gracias al primero,
  // y ese camino quedaría sin ejercitar en silencio.
  it('el regex de puedeConSesion encuentra al menos un uso real', () => {
    expect(llamadasPuedeConSesion.length, 'ningún uso de puedeConSesion; el regex no prueba nada').toBeGreaterThan(0)
  })

  // Un permiso que no destraba nada es un switch que miente: el dueño lo
  // prende, y no pasa nada. Por eso se compara contra las llamadas reales
  // (`usados`), no contra el texto crudo del archivo.
  it('todo permiso del catálogo lo exige o lo consulta alguien', () => {
    expect(usados.size, 'el regex no encontró ningún uso; está roto').toBeGreaterThan(0)
    for (const clave of CLAVES_DE_PERMISO) {
      expect(usados, `${clave} no lo exige ni lo consulta nadie fuera de lib/permisos`).toContain(clave)
    }
  })

  // Y al revés: una llamada real con un literal que no está en el catálogo es
  // un typo que nunca va a dar verdadero.
  it('todo permiso usado en el código está en el catálogo', () => {
    for (const usado of usados) {
      expect(CLAVES_DE_PERMISO, `${usado} no está en el catálogo`).toContain(usado)
    }
  })
})
