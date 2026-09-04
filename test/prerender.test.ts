import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * NINGUNA PÁGINA SE PRERENDERIZA, y no es una preferencia de performance: es
 * un acoplamiento con `app/not-found.tsx` que sólo se manifiesta en el build de
 * producción.
 *
 * `not-found.tsx` es el boundary de 404 de TODAS las rutas, no sólo de
 * `/_not-found`, y llama a `piezasDeOrigen()` para armar el link absoluto al
 * ápex. Esa función tira si falta DOMINIO_BASE, que en build time no existe a
 * propósito (ver el bloque largo de ese archivo: hornear el valor daría el
 * dominio del entorno equivocado, porque la imagen se buildea una vez y se
 * promueve de stage a prod).
 *
 * Su `export const dynamic = 'force-dynamic'` lo protege cuando `/_not-found`
 * ES la página, y NO cuando el boundary cuelga del árbol de otra ruta: ese
 * config gobierna al segmento, no al boundary heredado. O sea que cualquier
 * página que Next prerenderice arrastra este componente al build y lo rompe.
 *
 * Ya pasó una vez: `/sin-conexion` nació `force-static` —era la única página
 * estática del repo— y volteó el paso 7 del gate con "Export encountered an
 * error on /sin-conexion/page", con el resto del gate entero en verde.
 *
 * POR QUÉ ESTE TEST Y NO SÓLO EL BUILD, que es lo que `not-found.tsx` decidió
 * para su propio caso: ahí el build alcanzaba porque el archivo protegido era
 * uno solo. Acá la regla alcanza a toda página futura, y el build la atrapa
 * recién en el paso 7 —después de tests, typecheck, lint y de frenar
 * arandano-dev—, con un mensaje que no nombra a not-found.tsx en ningún lado.
 * Este caso falla en el paso 4 y dice por qué.
 */

// Escritas a mano a propósito, como FUERA_DEL_GRUPO en test/rutas-con-guard.ts:
// sumar una excepción tiene que ser una decisión visible en el diff.
const SIN_DECLARAR: Record<string, string> = {
  'app/forbidden.tsx':
    'la renderiza Next ante forbidden(), igual que not-found.tsx ante notFound(): ' +
    'no es una ruta navegable y no tiene segmento propio que prerenderizar',
}

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

describe('ninguna página se prerenderiza', () => {
  const encontradas = paginas('app')

  it('encuentra páginas; si no, el test no prueba nada', () => {
    expect(encontradas.length).toBeGreaterThan(0)
  })

  // La premisa del acoplamiento. El día que not-found.tsx deje de ser dinámica
  // —porque deje de necesitar DOMINIO_BASE— este archivo entero caduca, y tiene
  // que enterarse acá y no quedarse prohibiendo algo que ya no hace daño.
  it('not-found.tsx sigue siendo dinámica, que es lo que obliga al resto', () => {
    const fuente = readFileSync('app/not-found.tsx', 'utf8')
    expect(fuente).toContain("export const dynamic = 'force-dynamic'")
    expect(fuente).toContain('piezasDeOrigen')
  })

  it.each(paginas('app'))('%s declara force-dynamic', (archivo) => {
    const fuente = readFileSync(archivo, 'utf8')
    const razon = SIN_DECLARAR[archivo]

    if (razon) {
      expect(fuente, `${archivo} está exceptuada (${razon}) pero declara dynamic`).not.toContain(
        'export const dynamic',
      )
      return
    }

    expect(
      fuente,
      `${archivo} tiene que declarar force-dynamic. Prerenderizarla arrastra ` +
        'app/not-found.tsx al build, que necesita DOMINIO_BASE y voltea el paso 7 ' +
        'del deploy. Si de verdad tiene que ser estática, la salida no es sacar ' +
        'este caso: es darle a su segmento un not-found.tsx propio que no lea nada.',
    ).toContain("export const dynamic = 'force-dynamic'")
  })

  // La otra dirección: sin esto, una excepción que se quede en la lista después
  // de que el archivo se borre o se renombre pasa desapercibida para siempre.
  it('no sobra ninguna excepción', () => {
    for (const archivo of Object.keys(SIN_DECLARAR)) {
      expect(encontradas, `${archivo} está exceptuada y no existe`).toContain(archivo)
    }
  })
})
