'use client'

import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { exportarVentas } from './acciones'
import type { Rango } from '@/lib/dashboard/rango'

/**
 * El botón "Exportar CSV", en sus DOS copias — el `<Button variant="outline">`
 * inerte que Task 10 dejó en el Topbar de escritorio, y la ranura de 38 px del
 * teléfono (`controlMovil`, `components/shell/encabezado.tsx`) que Task 10
 * NO pudo dejar armada porque esa ranura documenta que sólo aloja un control
 * SIN navegación —un `accionMovil` con `href="#"` habría consumido la única
 * entrada de historial del Topbar del teléfono sin bajar ningún archivo—.
 *
 * `reposo` y `enCurso` son DOS nodos, no una función de `exportando` —y esto
 * NO es una preferencia de estilo: `page.tsx` es un Server Component
 * `async`, y un Server Component no puede pasarle una FUNCIÓN a un
 * Client Component. Los elementos de React cruzan el límite RSC porque se
 * serializan; una función, no. La versión anterior de este componente pedía
 * `children: (exportando: boolean) => ReactNode`, y `page.tsx` le pasaba
 * `{(exportando) => (...)}` en las dos copias — eso tira, en tiempo de
 * ejecución y en TODO render, "Functions are not valid as a child of Client
 * Components". `/dashboard` daba 500 siempre: ni `npm test`, ni `tsc`, ni
 * `lint`, ni `npm run build` lo ven —ninguno ejecuta el árbol de React del
 * lado del servidor—, y trece tasks revisadas más la review de rama entera
 * pasaron con esto adentro. Lo único que lo vio fue abrir la pantalla.
 *
 * La restricción real —"el llamador tiene que poder mostrar contenido
 * distinto en reposo y mientras exporta, sin que este archivo sepa si lo
 * dibuja el escritorio o el teléfono"— sigue intacta y resuelta igual, sólo
 * que con dos elementos ya armados en vez de una función: el Topbar pasa
 * texto ("Exportar CSV" → "Exportando…", el mismo patrón que ya usa
 * `BotonExportarCsv` en `app/(app)/inventario/formularios.tsx:697`); la
 * ranura de 38 px sólo tiene lugar para un ícono, así que ahí el llamador
 * arma un spinner en vez de reemplazar el ícono por texto que desbordaría la
 * caja. El componente sólo decide CUÁL de los dos mostrar, con su propio
 * estado (`exportando`) — la decisión de qué es cada uno queda del lado de
 * quien ya sabe si está dibujando el escritorio o el teléfono.
 *
 * `className` en vez de un `variant`/`movil` propios: el llamador ya sabe
 * exactamente qué clase necesita en cada copia (`buttonVariants({...})` para
 * el Topbar, `CLASES_RANURA_MOVIL` para el teléfono), y este componente no
 * tiene que reinventar esa decisión.
 *
 * `rango` como STRING, propagado tal cual a `exportarVentas`: es el mismo
 * `Rango` ya validado que resolvió `page.tsx` para ESTE render, así que no
 * hace falta volver a pasarlo por `rangoValido()` acá —eso ya lo hace la
 * action, por las dos puntas: un valor tipeado a mano en un POST armado a
 * mano, no sólo el que viene de esta pantalla.
 */
export function BotonDeExportar({
  rango,
  className,
  reposo,
  enCurso,
}: {
  rango: Rango
  className?: string
  reposo: ReactNode
  enCurso: ReactNode
}) {
  const [exportando, setExportando] = useState(false)

  async function exportar() {
    setExportando(true)
    try {
      const csv = await exportarVentas(rango)
      // El BOM (\uFEFF) al principio del Blob, no del string que devuelve la
      // action: mismo lugar exacto que `BotonExportarCsv`. Sin él, Excel en
      // Windows abre un CSV con acentos asumiendo Latin-1 y rompe cada
      // "ó"/"ñ" de un nombre de cliente.
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const enlace = document.createElement('a')
      enlace.href = url
      // Determinístico a partir de lo único que este componente tiene a
      // mano (`rango`), igual que `historial-${sku}.csv` sale del único dato
      // que ESE botón tiene a mano: no hace falta que la action devuelva un
      // nombre de archivo aparte para un CSV que ya se distingue solo por
      // cuándo se lo pidió.
      enlace.download = `ventas-${rango}.csv`
      // Insertado en el DOM y no sólo creado: Safari no dispara la descarga
      // de un <a download> al que nunca se le hizo appendChild.
      document.body.appendChild(enlace)
      enlace.click()
      enlace.remove()
      // revokeObjectURL en el siguiente tick: hacerlo sincrónico puede
      // ganarle a la descarga que el navegador todavía no terminó de arrancar.
      setTimeout(() => URL.revokeObjectURL(url), 0)
    } catch {
      // Toast y no un mensaje inline: este botón vive en DOS lugares —el
      // Topbar y una ranura de 38 px sin espacio para un renglón de error
      // al lado—, y `sonner` ya es el mecanismo de aviso global de esta
      // pantalla (`app/(app)/layout.tsx`). `duration: Infinity` porque el
      // mensaje es accionable ("probá de nuevo") y no algo que sobra
      // releer, mismo criterio que ya fija `abm-categorias.tsx` para los
      // errores.
      toast.error('No se pudo exportar. Probá de nuevo.', { duration: Infinity })
    } finally {
      setExportando(false)
    }
  }

  return (
    <button type="button" onClick={exportar} disabled={exportando} className={className}>
      {exportando ? enCurso : reposo}
    </button>
  )
}
