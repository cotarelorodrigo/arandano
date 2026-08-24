'use client'

import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from 'lucide-react'

/**
 * Los avisos flotantes del producto.
 *
 * **Sin `next-themes`**, que es lo que trae el componente de shadcn tal cual
 * sale del registry: el producto tiene una sola paleta —clara, desde el
 * rediseño de 2026-08-21— y no hay ningún `ThemeProvider` montado, así que
 * `useTheme()` devolvería `undefined` y caería igual en el default. Arrastrar
 * una dependencia entera para llegar al mismo lugar no se paga.
 *
 * Los colores salen de los tokens del sistema, no de los de sonner: un aviso
 * que no se ve como el resto del producto es un aviso que parece de otra app.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--card)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
          '--error-bg': 'var(--destructive-soft)',
          '--error-text': 'var(--destructive)',
          '--error-border': 'var(--destructive)',
          '--success-bg': 'var(--ok-soft)',
          '--success-text': 'var(--ok)',
          '--success-border': 'var(--ok)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
