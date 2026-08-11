import { describe, it, expect } from 'vitest'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Un cable trampa, no una regla de estilo.
 *
 * El barrido autenticado de scripts/smoke.sh distingue una pantalla de verdad
 * de un 200 vacío buscando `data-testid="tenant-nombre"` en el cuerpo. Para las
 * rutas de (app) ese marcador lo emite el LAYOUT del grupo
 * (app/(app)/layout.tsx), no cada página. Eso alcanza hoy por un detalle de
 * cómo Next monta los boundaries: `notFound()` y las excepciones no manejadas
 * suben hasta el boundary de la RAÍZ, que no renderiza el layout de (app), así
 * que el marcador NO sale y el caso da rojo — que es lo que queremos.
 *
 * Lo que rompe eso NO es "boundaries de error": es CUALQUIER COSA QUE PONGA UN
 * LÍMITE POR ENCIMA DE LA PÁGINA, porque entonces el layout se renderiza aunque
 * la página falle. Hay dos formas de conseguirlo y las dos importan:
 *
 * - `error.tsx` / `not-found.tsx` dentro de (app): un boundary de segmento se
 *   monta ADENTRO del layout de su segmento, así que el layout —y el marcador—
 *   salen igual, con 200.
 * - **`loading.tsx` dentro de (app)**, que es el más probable de todos: envuelve
 *   `{children}` en un `<Suspense>`, y con streaming Next flushea el shell
 *   —layout y marcador incluidos— con **200** apenas resuelve el layout. Si la
 *   página tira DESPUÉS, el status ya salió. Es el caso peor: se agrega por UX,
 *   sin ninguna relación mental con el gate.
 *
 * El barrido pasaría en verde sobre una pantalla rota, que es exactamente el
 * modo de falla que este ciclo existe para cerrar (el 2026-08-10 se promovió
 * /usuarios roto con los cuatro chequeos del gate en verde).
 *
 * Este test NO dice "no agregues boundaries". Dice: si agregás uno, el marcador
 * tiene que dejar de vivir en el layout y pasar a cada página, y hay que
 * actualizar el comentario de caso_pantalla en scripts/smoke.sh. Falla para
 * forzar esa decisión en vez de dejar que el gate se apague en silencio.
 *
 * `not-found.tsx`, `forbidden.tsx` y `unauthorized.tsx` quedan en la lista
 * aunque hoy sean redundantes —los tres responden con un código que no es 200 y
 * el `[[ "$codigo" == "200" ]]` de caso_pantalla ya los corta— porque cuestan un
 * string y no dependen de que ese chequeo siga ahí. Los dos últimos no son
 * hipotéticos en este repo: `next.config.ts` habilita `experimental.
 * authInterrupts` y `app/forbidden.tsx` ya existe, así que son idioms vivos.
 */
const BOUNDARIES_QUE_TAPAN_EL_MARCADOR = [
  'error.tsx',
  'not-found.tsx',
  'global-error.tsx',
  'loading.tsx',
  'forbidden.tsx',
  'unauthorized.tsx',
]

const GRUPO = path.join('app', '(app)')

function archivos(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) archivos(completo, acumulado)
    else acumulado.push(completo)
  }
  return acumulado
}

describe('boundaries dentro de app/(app)', () => {
  const encontrados = archivos(GRUPO)

  it('encuentra archivos; si no, el test no prueba nada', () => {
    expect(encontrados.length).toBeGreaterThan(0)
  })

  it('el marcador vive en el layout, así que ningún boundary de segmento puede taparlo', () => {
    const boundaries = encontrados.filter((f) =>
      BOUNDARIES_QUE_TAPAN_EL_MARCADOR.includes(path.basename(f)),
    )
    expect(
      boundaries,
      `estos boundaries se montan ADENTRO de app/(app)/layout.tsx, así que el marcador ` +
        `data-testid="tenant-nombre" saldría igual con 200 y el barrido de scripts/smoke.sh ` +
        `se volvería verde sobre una pantalla rota: ${boundaries.join(', ')}. ` +
        `Antes de agregarlos, mudá el marcador del layout a cada page.tsx y actualizá el ` +
        `comentario de caso_pantalla en scripts/smoke.sh.`,
    ).toEqual([])
  })

  it('el layout que emite el marcador sigue existiendo', () => {
    // Sin esto, borrar app/(app)/layout.tsx dejaría el test de arriba en verde
    // (cero boundaries) mientras el barrido entero se queda sin marcador.
    expect(encontrados).toContain(path.join(GRUPO, 'layout.tsx'))
  })

  it('ningún archivo del grupo envuelve contenido en un límite de Suspense', () => {
    // La otra mitad del mismo agujero, y la que un chequeo por NOMBRE DE
    // ARCHIVO no puede ver: un <Suspense> escrito a mano alrededor de
    // {children} hace exactamente lo mismo que loading.tsx — el shell con el
    // marcador se flushea con 200 antes de que la página resuelva.
    //
    // TODO el grupo y no sólo el layout: un <Suspense> DENTRO de una página
    // deja el encabezado —y el marcador— por encima del límite, así que React
    // flushea el shell con 200 y, si el subárbol suspendido tira, caso_pantalla
    // ve 200 + marcador y reporta la pantalla en verde. Es el mismo agujero que
    // loading.tsx, un directorio más abajo.
    //
    // Lo que este regex NO agarra, escrito para que nadie le confíe de más:
    // un import con alias (`import { Suspense as S }`). Un `<Suspense/>`
    // autocerrado tampoco matchea, pero ése no envuelve nada, así que no
    // reproduce el bug. Un comentario que mencione <Suspense> da falso
    // positivo — molesto, pero falla en la dirección segura.
    const conSuspense = encontrados
      .filter((f) => /\.(tsx|jsx|ts|js)$/.test(f))
      .filter((f) => /<Suspense[\s>]/.test(readFileSync(f, 'utf8')))
    expect(
      conSuspense,
      `estos archivos de app/(app)/ envuelven contenido en un límite de Suspense, así ` +
        `que el marcador data-testid="tenant-nombre" se flushea con 200 aunque lo de ` +
        `adentro falle, y el barrido de scripts/smoke.sh se vuelve verde sobre una ` +
        `pantalla rota: ${conSuspense.join(', ')}. Mudá el marcador a cada page.tsx, ` +
        `adentro del límite, antes de hacer esto.`,
    ).toEqual([])
  })
})
