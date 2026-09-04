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

/**
 * El lado del ícono que pide una URL, o null si no es uno de los declarados.
 *
 * Vive acá y no inline en la route porque es la guarda que impide que
 * cualquiera pida imágenes de cualquier tamaño, y una guarda que ningún test
 * puede llamar es una guarda que se puede borrar sin que nada se ponga en rojo.
 */
export function tamanoDeIconoValido(segmento: string): number | null {
  // Comparación contra el texto canónico y no Number() a secas: '0192', '192.0'
  // y ' 192' son todos 192 para Number, así que el mismo ícono quedaría
  // servido desde infinitas URLs distintas.
  const lado = TAMANOS.find((t) => String(t) === segmento)
  return lado ?? null
}
