/**
 * Los dos tamaños de ícono que declara app/manifest.ts, y ninguno más.
 *
 * Lista blanca y no un rango: generar una imagen del tamaño que pidan es
 * trabajo de CPU gratis para cualquiera que lo descubra, sobre una caja donde
 * dev, stage y producción comparten dos cores.
 *
 * Vive acá y no en la route porque el test lo lee, e importar la route
 * arrastraría next/og —o sea Satori entero— a un test que corre en node.
 */
export const TAMANOS = [192, 512] as const
