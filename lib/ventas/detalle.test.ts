import { describe, it, expect } from 'vitest'
import { TOPE_DETALLE, normalizarDetalle } from './detalle'

describe('normalizarDetalle', () => {
  it('devuelve el texto tal cual cuando ya viene limpio', () => {
    expect(normalizarDetalle('Lo retira el hermano el jueves')).toBe(
      'Lo retira el hermano el jueves',
    )
  })

  it('recorta los espacios de los bordes', () => {
    expect(normalizarDetalle('  avisar al 11 5555-1234  ')).toBe('avisar al 11 5555-1234')
  })

  // Las tres formas de "no se anotó nada" tienen que dar el MISMO resultado:
  // `null`, o sea la ausencia del dato. Un `''` guardado sería una tercera
  // respuesta que ninguna pantalla sabe distinguir de las otras dos.
  it('trata vacío, sólo espacios y ausente como la ausencia del dato', () => {
    expect(normalizarDetalle('')).toBeNull()
    expect(normalizarDetalle('   \n  ')).toBeNull()
    expect(normalizarDetalle(undefined)).toBeNull()
    expect(normalizarDetalle(null)).toBeNull()
  })

  it('corta en el tope en vez de rechazar', () => {
    const largo = 'a'.repeat(TOPE_DETALLE + 50)
    expect(normalizarDetalle(largo)).toHaveLength(TOPE_DETALLE)
  })

  // El corte puede caer justo sobre un espacio, y un detalle que termina en
  // espacio es exactamente lo que el trim de arriba existe para evitar.
  it('el corte no deja un espacio colgando al final', () => {
    const texto = `${'a'.repeat(TOPE_DETALLE - 1)} bcdef`
    const salida = normalizarDetalle(texto)
    expect(salida).toBe('a'.repeat(TOPE_DETALLE - 1))
    expect(salida).not.toMatch(/\s$/)
  })

  // El multilínea se conserva: el control de las dos pantallas es un
  // <textarea>, así que los saltos son parte de lo que la persona escribió.
  it('conserva los saltos de línea internos', () => {
    expect(normalizarDetalle('Retira Ana\nMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
  })

  // Los dos escritores no llegan con el mismo salto de línea: `/vender`
  // postea vía FormData, cuya construcción normaliza a CRLF, y la ficha manda
  // un string de JS por el argumento del server action, que queda en LF. Sin
  // esta normalización la MISMA nota tipeada se guarda distinto según qué
  // pantalla la escribió — y un CRLF cerca del tope corta un carácter de más
  // contra lo que el `maxLength` del cliente prometía, porque ahí un salto
  // ocupa dos.
  it('normaliza CRLF y CR sueltos a LF, para que los dos escritores coincidan', () => {
    expect(normalizarDetalle('Retira Ana\r\nMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
    expect(normalizarDetalle('Retira Ana\rMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
  })

  it('el tope es 500', () => {
    expect(TOPE_DETALLE).toBe(500)
  })
})

describe('el módulo', () => {
  /**
   * De qué módulos arrastra algo el archivo, en cualquiera de las formas en
   * que un bundler lo entiende.
   *
   * Los comentarios se sacan PRIMERO: los docblocks de estos dos archivos
   * hablan justamente de imports y nombran `'use client'` entre comillas, así
   * que un regex que los leyera devolvería módulos que nadie importa.
   *
   * Y después se aplasta el espacio en blanco, que es lo que hace que un
   * import MULTILÍNEA —`import {\n  a,\n} from '@/lib/db'`— cuente como la
   * sentencia que es. Un regex atado al renglón lo ve como una línea sin
   * `from` y lo deja pasar entero, que es el agujero que tenía la primera
   * versión de este caso.
   *
   * Las tres formas que reconoce, y por qué las tres: `import … from '…'`,
   * `export … from '…'` (re-exportar arrastra igual que importar) y el import
   * de EFECTO `import '@/lib/db'`, que no lleva `from` y es el que más fácil
   * se cuela — alcanza para construir el Pool de `pg` aunque no se use ningún
   * nombre.
   */
  const importesDe = async (url: URL) => {
    const { readFileSync } = await import('node:fs')
    const fuente = readFileSync(url, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/\s+/g, ' ')
    const encontrados = [
      ...fuente.matchAll(
        /\bimport\s+'([^']+)'|\b(?:import|export)\b[^'"]*?\bfrom\s+'([^']+)'/g,
      ),
    ].map((m) => m[1] ?? m[2])
    // El `import()` dinámico no tiene `from` ni arranca un renglón, así que
    // ninguna de las tres formas de arriba lo ve. No se intenta parsear: se
    // prohíbe, que en dos archivos de veinte líneas es la respuesta correcta.
    expect(fuente, 'un import() dinámico esquiva este caso: no va acá').not.toMatch(
      /\bimport\s*\(/,
    )
    return encontrados
  }

  // La condición que deja importar TOPE_DETALLE desde un archivo 'use client'
  // sin arrastrar `pg` al bundle del navegador. Lo vigila también
  // test/limite-cliente-servidor.test.ts —que sigue la cadena entera—, pero acá
  // falla al lado de la causa.
  //
  // Era "no importa nada" hasta que la mecánica de normalizar salió a
  // `lib/texto/libre.ts` para compartirla con la nota de una corrección de
  // pagos. La regla nunca fue cero imports: es que ninguna cadena de imports
  // alcance `lib/db.ts`. Por eso el caso pasó a nombrar el único import
  // permitido y a exigir, del otro lado, que ese módulo siga sin importar nada
  // — que es lo que corta la cadena en un solo salto y lo que hace que este
  // caso siga atrapando un `@/lib/db` metido de contrabando en cualquiera de
  // los dos archivos.
  it('sólo importa lib/texto/libre.ts, que a su vez no importa nada', async () => {
    expect(await importesDe(new URL('./detalle.ts', import.meta.url))).toEqual([
      '@/lib/texto/libre',
    ])
    expect(await importesDe(new URL('../texto/libre.ts', import.meta.url))).toEqual([])
  })
})
