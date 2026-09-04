/**
 * La primera letra del nombre de un local, para el ícono y el avatar.
 *
 * Con spread y no con charAt(0): charAt parte al medio un carácter fuera del
 * plano básico —un emoji, por ejemplo— y devuelve media unidad de código.
 */
export function inicialDe(nombre: string): string {
  const limpio = nombre.trim()
  // 'A' de Arándano: un local sin nombre no existe hoy, pero un ícono vacío
  // sería un cuadrado violeta sin nada adentro, y eso es peor que una letra
  // que no es la suya.
  return [...limpio][0]?.toUpperCase() ?? 'A'
}
