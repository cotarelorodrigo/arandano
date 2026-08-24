/** El separador de niveles: el middot que la maqueta ya usa en
 *  "Accesorios · Protección". */
export const SEPARADOR = '·'

/** Cómo se vuelve a escribir un nivel plegado. Con espacios, que es la forma
 *  que se muestra; el parseo tolera las dos. */
const SEPARADOR_VISIBLE = ` ${SEPARADOR} `

export type CategoriaPartida = { raiz: string; hija: string | null }

/**
 * Parte el texto libre de `Articulo.categoria` en los dos niveles del árbol.
 *
 * Una sola regla, sin casos especiales: partir por el separador, trimear cada
 * segmento, **descartar los vacíos**, y de lo que queda el primero es la raíz
 * y el resto —unido de nuevo— es la hija. De ahí salen todos los bordes: un
 * texto sin separador da una raíz sola, `"· Samsung"` da `Samsung` sin hija
 * porque el segmento vacío se cae, y un tercer nivel se pliega adentro de la
 * hija en vez de tirarse.
 *
 * Plegar y no descartar es la decisión que importa: `"A · B · C"` da
 * `A` > `B · C`. Queda feo, pero no borra en silencio algo que alguien
 * escribió — y el modelo tiene dos niveles, no tres.
 */
export function partirCategoria(texto: string | null | undefined): CategoriaPartida | null {
  const segmentos = (texto ?? '')
    .split(SEPARADOR)
    .map((s) => s.trim())
    .filter((s) => s !== '')

  if (segmentos.length === 0) return null

  const [raiz, ...resto] = segmentos
  return { raiz, hija: resto.length > 0 ? resto.join(SEPARADOR_VISIBLE) : null }
}
