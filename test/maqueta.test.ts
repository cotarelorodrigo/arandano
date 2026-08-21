import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
// El mismo parser del :root que usan el resto de los tests de diseño, no una
// copia: el arreglo que lo obliga a exigir un único :root de primer nivel se
// hizo en un solo lugar y tiene que seguir así.
import { tokensDelCss } from '@/scripts/tokens.mts'

const PEN = 'design/arandano.pen'

/**
 * Los colores de la maqueta contra los del CSS.
 *
 * `design/arandano.pen` es donde se diseñaron las trece pantallas antes de
 * escribirlas, y sus variables llevan prefijo `ar-` mientras el CSS usa los
 * nombres de shadcn. Son los mismos colores con dos vocabularios, y sin nada
 * que los ate, la maqueta se vuelve en tres meses un archivo que muestra el
 * producto que ya no es — que es exactamente el motivo por el que el `.pen`
 * está en el repo y no en un Figma.
 *
 * **Sólo mira el bloque de variables, nunca la geometría.** Un test que
 * comparara posiciones o textos se rompería con cada movimiento de un frame, y
 * un test que se rompe por moverse es un test que se termina ignorando. Mover
 * una card no cambia un color; cambiar un color sí.
 */
const EQUIVALENCIAS: Record<string, string[]> = {
  'ar-bg': ['--background'],
  'ar-surface': ['--card', '--popover', '--sidebar'],
  'ar-sunken': ['--muted', '--secondary'],
  'ar-ink': [
    '--foreground',
    '--card-foreground',
    '--popover-foreground',
    '--secondary-foreground',
    '--sidebar-foreground',
  ],
  'ar-ink-2': ['--foreground-soft'],
  'ar-ink-3': ['--muted-foreground'],
  'ar-line': ['--border', '--sidebar-border'],
  'ar-line-strong': ['--input'],
  'ar-primary': [
    '--primary',
    '--ring',
    '--accent-foreground',
    '--chart-1',
    '--sidebar-primary',
    '--sidebar-accent-foreground',
    '--sidebar-ring',
  ],
  'ar-primary-deep': ['--marca'],
  'ar-primary-soft': ['--accent', '--sidebar-accent'],
  'ar-on-primary': ['--primary-foreground', '--marca-foreground', '--sidebar-primary-foreground'],
  'ar-ok': ['--ok'],
  'ar-ok-soft': ['--ok-soft'],
  'ar-warn': ['--warn'],
  'ar-warn-soft': ['--warn-soft'],
  'ar-danger': ['--destructive'],
  'ar-danger-soft': ['--destructive-soft'],
}

/**
 * Las variables del `.pen` que NO tienen token equivalente, cada una con su
 * razón. Mismo patrón que RUTAS_SIN_SMOKE en scripts/lib/rutas-comun.sh y
 * SIN_TENANT_ID en test/rls-cobertura.test.ts: una excepción es una decisión
 * visible en el diff, no algo que el test deduzca solo.
 */
const SIN_TOKEN: Record<string, string> = {
  'ar-font':
    'la familia del cuerpo. En el CSS no es un token de color sino la pila del ' +
    'sistema que Tailwind define para font-sans, así que no hay nada en :root ' +
    'contra qué compararla. Ver la sección Tipografía de docs/sistema-de-diseno.md.',
  'ar-display':
    'la cara de display (Archivo). La emite next/font sobre el <html> como ' +
    '--font-archivo, no el bloque :root. Mismo motivo que ar-font.',
}

/**
 * Los tokens del CSS que ninguna variable de la maqueta reproduce, con su razón.
 *
 * La dirección que importa de verdad: un token nuevo en el CSS que la maqueta no
 * conozca significa que se decidió un color escribiendo código, sin pasar por el
 * diseño. Puede ser legítimo —los de abajo lo son— pero tiene que estar dicho.
 */
const SOLO_EN_CSS: Record<string, string> = {
  '--primary-hover':
    'el hover del botón de acción. La maqueta no dibuja estados de hover: son ' +
    'comportamiento, y un frame estático los mostraría como si fueran el estado ' +
    'de reposo.',
  '--marca-soft':
    'texto secundario sobre el paño de marca. En la maqueta está escrito literal ' +
    'como #B6A6E8 en los frames que lo usan, sin variable propia — es el color ' +
    'que más se repite sin variable y el candidato número uno a promoverse.',
  '--marca-dim': 'lo mismo que --marca-soft, un escalón más apagado (#9C8BD6).',
  '--chart-2':
    'la serie de dólares del panel de /ventas. La maqueta dibuja el panel con ' +
    'barras de una sola serie, así que el segundo color se eligió al escribir el ' +
    'CSS, con su contraste medido en docs/sistema-de-diseno.md.',
  '--radius': 'no es un color; la maqueta lleva el radio en cada frame.',
}

describe('la maqueta y el CSS pintan los mismos colores', () => {
  let pen: Map<string, string>
  let css: Map<string, string>

  beforeAll(() => {
    const doc = JSON.parse(readFileSync(PEN, 'utf8'))
    pen = new Map(
      Object.entries(doc.variables ?? {})
        .filter(([, v]) => (v as { type: string }).type === 'color')
        .map(([k, v]) => [k, String((v as { value: unknown }).value).toUpperCase()]),
    )
    css = new Map([...tokensDelCss()].map(([k, v]) => [k, v.toUpperCase()]))
  })

  // La mitad que evita el verde por vacío: dos Maps vacíos son iguales, así que
  // un parser que dejó de matchear daría verde sobre una maqueta rota. Es el
  // mismo modo de falla que ya cierran los casos "no está vacía" de
  // test/sistema-de-diseno.test.ts.
  it('la maqueta declara variables de color', () => {
    expect(
      pen.size,
      `no se parseó ninguna variable de color de ${PEN}. O el archivo cambió de ` +
        `formato, o quedó sin variables.`,
    ).toBeGreaterThan(0)
  })

  it('cada variable de la maqueta tiene el mismo valor que su token', () => {
    for (const [variable, tokens] of Object.entries(EQUIVALENCIAS)) {
      const valor = pen.get(variable)
      expect(valor, `${PEN} no define la variable ${variable}`).toBeDefined()
      for (const token of tokens) {
        expect(
          css.get(token),
          `${PEN} pinta ${variable} de ${valor} y app/globals.css pinta ${token} de ` +
            `${css.get(token) ?? '(nada)'}. Son el mismo color con dos nombres: si ` +
            `cambió, cambialo en los dos archivos y en docs/sistema-de-diseno.md.`,
        ).toBe(valor)
      }
    }
  })

  it('toda variable de la maqueta está mapeada, o exceptuada con su razón', () => {
    const mapeadas = new Set(Object.keys(EQUIVALENCIAS))
    const doc = JSON.parse(readFileSync(PEN, 'utf8'))
    const sueltas = Object.keys(doc.variables ?? {}).filter(
      (v) => !mapeadas.has(v) && !(v in SIN_TOKEN),
    )
    expect(
      sueltas,
      `${PEN} define variables que EQUIVALENCIAS no mapea: ${sueltas.join(', ')}. ` +
        `Si tienen token, agregalas al mapa; si no lo tienen, anotalas en SIN_TOKEN ` +
        `con su razón.`,
    ).toEqual([])
  })

  it('todo token de color del CSS está en la maqueta, o exceptuado con su razón', () => {
    const enMaqueta = new Set(Object.values(EQUIVALENCIAS).flat())
    const sueltos = [...css.keys()].filter((t) => !enMaqueta.has(t) && !(t in SOLO_EN_CSS))
    expect(
      sueltos,
      `app/globals.css define tokens que la maqueta no conoce: ${sueltos.join(', ')}. ` +
        `Un color decidido escribiendo código, sin pasar por el diseño, puede ser ` +
        `legítimo — pero tiene que estar dicho: anotalo en SOLO_EN_CSS con su razón.`,
    ).toEqual([])
  })

  it('no hay excepciones de más', () => {
    // El caso que hace que las dos listas de arriba no se conviertan en un
    // cementerio: una excepción que ya no corresponde es una decisión vieja
    // que sigue pareciendo vigente.
    const doc = JSON.parse(readFileSync(PEN, 'utf8'))
    const inventadas = Object.keys(SIN_TOKEN).filter((v) => !(v in (doc.variables ?? {})))
    expect(
      inventadas,
      `SIN_TOKEN nombra variables que ${PEN} ya no define: ${inventadas.join(', ')}`,
    ).toEqual([])

    const enMaqueta = new Set(Object.values(EQUIVALENCIAS).flat())
    const demas = Object.keys(SOLO_EN_CSS).filter((t) => !css.has(t) || enMaqueta.has(t))
    expect(
      demas,
      `SOLO_EN_CSS nombra tokens que ya no existen o que ahora sí están mapeados: ` +
        `${demas.join(', ')}`,
    ).toEqual([])
  })
})
