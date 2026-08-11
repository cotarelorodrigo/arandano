import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
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
 * Un `error.tsx` o un `not-found.tsx` DENTRO de (app) rompe eso: un boundary de
 * segmento se monta ADENTRO del layout de su segmento, así que el layout —y el
 * marcador con él— se renderizarían igual, con 200. El barrido pasaría en verde
 * sobre una pantalla rota, que es exactamente el modo de falla que este ciclo
 * existe para cerrar (el 2026-08-10 se promovió /usuarios roto con los cuatro
 * chequeos del gate en verde).
 *
 * Este test NO dice "no agregues boundaries". Dice: si agregás uno, el marcador
 * tiene que dejar de vivir en el layout y pasar a cada página, y hay que
 * actualizar el comentario de caso_pantalla en scripts/smoke.sh. Falla para
 * forzar esa decisión en vez de dejar que el gate se apague en silencio.
 */
const BOUNDARIES_QUE_TAPAN_EL_MARCADOR = ['error.tsx', 'not-found.tsx', 'global-error.tsx']

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
})
