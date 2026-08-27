'use client'

import { useEffect } from 'react'
import { Printer } from 'lucide-react'
import { CLASES_RANURA_MOVIL } from '@/components/shell/encabezado'

/**
 * El botón de imprimir de la ranura derecha del Topbar en el teléfono.
 *
 * Va por `controlMovil` y NO por `accionMovil`, y eso no es preferencia:
 * `accionMovil` es siempre un link a un href, y acá no hay ninguna URL a la
 * que ir — lo que hay que hacer es abrir el diálogo de impresión de la página
 * en la que ya se está. La primera versión de esta pantalla lo puso como
 * `accionMovil` con `href` a su propia URL, y funcionaba de casualidad: el
 * `<a>` pelado forzaba una recarga completa de documento, esa recarga
 * remontaba `ImprimirAlCargar` y su efecto llamaba a `window.print()`. Con
 * `Link` (ver components/shell/encabezado.tsx) Next resuelve la navegación
 * como misma-ruta, no remonta nada y el botón dejaría de hacer nada, sin que
 * ningún test cayera.
 *
 * `tono 'accion'` de la maqueta: el relleno de `--primary`, igual que el
 * `accionMovil` que reemplaza — la geometría la comparte
 * `CLASES_RANURA_MOVIL`, que es lo que impide que las ranuras de dos
 * pantallas se desalineen.
 */
export function BotonImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      aria-label="Imprimir"
      className={`${CLASES_RANURA_MOVIL} bg-primary text-primary-foreground`}
    >
      <Printer aria-hidden="true" className="size-[19px]" />
    </button>
  )
}

/**
 * Abre el diálogo de impresión al cargar.
 *
 * Sin JavaScript el ticket se ve igual y se imprime con Ctrl+P: esto es una
 * comodidad para el mostrador, no el mecanismo. Es la misma regla que el resto
 * de las pantallas — todo funciona sin JS.
 */
export function ImprimirAlCargar() {
  useEffect(() => {
    window.print()
  }, [])
  return null
}
