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
  // `loadDynamicAsset` de next/og —cableado por default— sale a buscar afuera
  // en DOS casos, no uno: un emoji va a jsdelivr, y cualquier code point que
  // la fuente empaquetada (noto-sans-latin, cubre hasta U+00FF) no sepa
  // dibujar va a fonts.googleapis.com — una request por render, en un
  // endpoint público. El techo de 0xFF ataja el segundo caso: ñ, á y ü siguen
  // andando ("Ñandú" da "Ñ"), pero cirílico, griego, hebreo, árabe o CJK
  // —todos por encima de 0xFF, y ninguno hipotético en locales argentinos—
  // caen al fallback antes de llegar a pedir el glifo afuera. `\p{L}|\p{N}`
  // sigue después, para lo que el techo deja pasar y no es letra ni dígito
  // (un emoji del rango Latin-1 no existe, pero un símbolo como "·" sí).
  if (!primero || primero.codePointAt(0)! > 0xff || !/\p{L}|\p{N}/u.test(primero)) return 'A'
  return primero.toUpperCase()
}
