'use client'

import { useEffect } from 'react'

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
