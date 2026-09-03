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
 * Los TRES lugares que redirigen al entrar, atados a `destinoAlEntrar` en vez
 * de a un literal cada uno — mismo modo de falla que
 * `test/permisos-en-las-dos-copias.test.ts` (el merge del ciclo móvil dejó una
 * de las dos copias de "Anular orden" atada al permiso viejo con el gate en
 * verde), y misma forma de cubrirlo: contar en las DOS direcciones. Con la
 * función, los tres archivos la importan; sin ella, ninguno lleva un
 * `redirect(` a un path literal suelto. Un `not.toContain` solo no
 * alcanzaría: pasaría igual si alguno de los tres quedó bien y los otros no.
 *
 * Dos capas de fuga que este archivo tiene su propia historia con:
 *
 * 1. Un literal repetido, pero con OTRAS comillas o entre variables
 *    (`redirect("/vender")`, un template literal, o `const d = '/vender';
 *    redirect(d)`) — un `toContain` de un string con comillas simples fijas no
 *    detecta ninguno de los tres. Por eso el chequeo de abajo es una regex
 *    contra `redirect(` seguido de CUALQUIER apertura de string.
 * 2. `destinoAlEntrar('DUENO')` a mano en un call site — importa la función,
 *    no contiene ningún `redirect('/…')` literal, y sin embargo manda a todos
 *    al tablero, dueños y empleados por igual. El primer round de esta task
 *    verificaba que la función se usara, pero no qué se le pasaba: este
 *    archivo llegó a existir con exactamente ese agujero. Por eso el segundo
 *    caso de abajo exige que el argumento venga de `.rol` (una sesión de
 *    verdad) y no sea un string entre comillas.
 */
describe('el destino se deriva en UNA función, no en literales repetidos', () => {
  const HOME = readFileSync('app/page.tsx', 'utf8')
  const LOGIN_ACCION = readFileSync('app/login/acciones.ts', 'utf8')
  const LOGIN_PAGINA = readFileSync('app/login/page.tsx', 'utf8')

  const FUENTES = {
    'app/page.tsx': HOME,
    'app/login/acciones.ts': LOGIN_ACCION,
    'app/login/page.tsx': LOGIN_PAGINA,
  } as const

  it('los tres archivos importan destinoAlEntrar', () => {
    for (const [nombre, fuente] of Object.entries(FUENTES)) {
      expect(fuente, nombre).toContain("import { destinoAlEntrar } from '@/lib/auth/destino'")
    }
  })

  // Contra CUALQUIER path literal, no sólo /vender y /dashboard: no basta con
  // buscar comillas simples fijas — "redirect(\"/vender\")" o un template
  // literal dan el mismo bug con otro carácter de apertura, y una regex atada
  // a los dos destinos de HOY no vería un tercer destino que se agregue
  // mañana como literal en vez de a través de destinoAlEntrar.
  it('ninguno de los tres contiene un redirect a un path literal', () => {
    for (const [nombre, fuente] of Object.entries(FUENTES)) {
      expect(fuente, nombre).not.toMatch(/redirect\(\s*['"`]\//)
    }
  })

  // El caso que el `not.toContain` de arriba no puede ver:
  // `redirect(destinoAlEntrar('DUENO'))` importa la función y no contiene
  // ningún `redirect('/…')` suelto, pero manda a TODOS al mismo destino
  // igual. El argumento de destinoAlEntrar tiene que venir de `.rol` (una
  // sesión real) y no de un string entre comillas.
  it('destinoAlEntrar recibe un rol de sesión, nunca un string entre comillas', () => {
    for (const [nombre, fuente] of Object.entries(FUENTES)) {
      // matchAll y no match: un archivo puede llamar a destinoAlEntrar más de
      // una vez (import más una llamada, o dos llamadas reales), y `.match`
      // sin la bandera global sólo mira la PRIMERA — una segunda llamada con
      // un rol cableado a mano pasaría en verde sin que nada la viera.
      const llamadas = [...fuente.matchAll(/destinoAlEntrar\(([^)]*)\)/g)]
      expect(llamadas.length, `${nombre}: no se encontró ninguna llamada a destinoAlEntrar`).toBeGreaterThan(0)

      for (const llamada of llamadas) {
        const argumento = llamada[1]
        expect(argumento, `${nombre}: el argumento no puede ser un string literal`).not.toMatch(
          /^\s*['"`]/,
        )
        expect(argumento, `${nombre}: el argumento tiene que leer .rol de una sesión`).toContain(
          '.rol',
        )
      }
    }
  })
})
