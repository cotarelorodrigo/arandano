export type EstadoDeInstalacion = 'oculto' | 'prompt' | 'instrucciones'

/**
 * Si el dispositivo es iOS, donde no existe ningún prompt de instalación.
 *
 * Los puntos de contacto no son de más: desde iPadOS 13 un iPad se anuncia
 * como Macintosh, así que el user agent solo no alcanza para distinguirlo de
 * una Mac de escritorio. Es el único dispositivo donde instalar es siempre a
 * mano, así que confundirlo lo deja sin instrucciones.
 */
export function esIOS(userAgent: string, puntosDeContacto: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && puntosDeContacto > 1
}

/**
 * Qué muestra el botón del pie del sidebar.
 *
 * Vive fuera del componente porque este repo no tiene jsdom: sacada la
 * decisión, los cuatro caminos se prueban sin DOM. Es la misma jugada que ya
 * separó pagosDelPeriodo y datosDelDetalle de sus Server Components.
 */
export function estadoDeInstalacion(entrada: {
  yaInstalada: boolean
  promptDisponible: boolean
  userAgent: string
  puntosDeContacto: number
}): EstadoDeInstalacion {
  // Un botón para instalar lo que ya está instalado es ruido permanente.
  if (entrada.yaInstalada) return 'oculto'
  if (entrada.promptDisponible) return 'prompt'
  if (esIOS(entrada.userAgent, entrada.puntosDeContacto)) return 'instrucciones'
  return 'oculto'
}
