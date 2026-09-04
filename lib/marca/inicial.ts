/**
 * La primera letra del nombre de un local, para el ícono y el avatar.
 *
 * Con spread y no con charAt(0): charAt parte al medio un carácter fuera del
 * plano básico y devuelve media unidad de código.
 */
export function inicialDe(nombre: string): string {
  // El spread y no charAt(0): charAt parte al medio un carácter fuera del
  // plano básico y devuelve media unidad de código.
  const primero = [...nombre.trim()][0]
  // Y sólo letra o dígito. Un emoji acá haría que ImageResponse (emoji:
  // 'twemoji' por default) salga a buscar el glifo a un CDN externo en cada
  // request de un endpoint público. Un local "24 Horas" sigue mostrando su "2".
  if (!primero || !/\p{L}|\p{N}/u.test(primero)) return 'A'
  return primero.toUpperCase()
}
