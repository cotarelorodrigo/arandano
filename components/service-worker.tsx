'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker. No dibuja nada.
 *
 * Va montado en app/(app)/layout.tsx y no en el layout raíz a propósito: ese
 * layout también sirve el ápex, y la landing no es una aplicación instalable
 * —app/manifest.ts le devuelve 404 al ápex por la misma razón—.
 *
 * El error se traga: un registro que falla no puede romper la pantalla de
 * cobro. Lo que se pierde si falla es el botón "Instalar" y la pantalla sin
 * conexión, no la capacidad de vender.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return null
}
