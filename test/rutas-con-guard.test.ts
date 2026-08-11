import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Escrita a mano a propósito: sumarle una entrada tiene que ser una decisión
// visible en el diff, no algo que el check deduzca solo. Es el mismo patrón que
// SIN_TENANT_ID en test/rls-cobertura.test.ts.
const FUERA_DEL_GRUPO: Record<string, string> = {
  'app/page.tsx':
    'sirve el ápex público y, para un tenant, llama a exigirSesion() por su cuenta; ' +
    'no puede estar en (app) porque el ápex no tiene sesión',
  'app/login/page.tsx': 'es la pantalla de login: exigir sesión para verla sería un bucle',
  'app/forbidden.tsx': 'la renderiza Next ante forbidden(); no es una ruta navegable',
}

// Las cuatro extensiones que Next resuelve, no sólo .tsx: una página escrita
// como page.ts es una ruta igual de navegable, y si este check no la ve se
// queda sin guard en silencio. Es el mismo supuesto —y el mismo fail-open— que
// el find de scripts/lib/rutas-comun.sh, que la barre para el smoke.
const ES_PAGINA = /^(page|forbidden|unauthorized)\.(tsx|ts|jsx|js)$/

function paginas(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      paginas(completo, acumulado)
    } else if (ES_PAGINA.test(entrada)) {
      acumulado.push(completo)
    }
  }
  return acumulado
}

describe('cobertura del guard de sesión', () => {
  const encontradas = paginas('app')

  it('encuentra páginas; si no, el test no prueba nada', () => {
    expect(encontradas.length).toBeGreaterThan(0)
  })

  it('toda página está bajo (app) o declarada en la lista blanca con su razón', () => {
    for (const p of encontradas) {
      const bajoElGrupo = p.split(path.sep).includes('(app)')
      expect(
        bajoElGrupo || Object.hasOwn(FUERA_DEL_GRUPO, p),
        `${p} no está bajo app/(app)/ y no está en la lista blanca: o le falta el ` +
          `guard, o hay que declarar por qué no lo necesita`,
      ).toBe(true)
    }
  })

  it('el layout del grupo exige sesión', () => {
    // Sin esto, el grupo existiría y no protegería nada: las páginas de adentro
    // pasarían el test de arriba sin tener guard.
    const layout = readdirSync('app/(app)')
    expect(layout).toContain('layout.tsx')
    const fuente = readFileSync('app/(app)/layout.tsx', 'utf8')
    expect(fuente).toContain('exigirSesion')
  })
})
