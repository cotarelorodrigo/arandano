import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('./acciones', () => ({
  crearCategoriaAccion: vi.fn(),
  renombrarCategoriaAccion: vi.fn(),
  moverCategoriaAccion: vi.fn(),
  borrarCategoriaAccion: vi.fn(),
}))

const FUENTE = readFileSync(new URL('./abm-categorias.tsx', import.meta.url), 'utf8')

async function pintarAlta() {
  const { FilaDeAlta } = await import('./abm-categorias')
  return renderToStaticMarkup(<FilaDeAlta padreId={null} onCerrar={() => {}} sangria="rubro" />)
}

async function pintarEdicion() {
  const { FilaEnEdicion } = await import('./abm-categorias')
  return renderToStaticMarkup(
    <FilaEnEdicion categoriaId="x" nombre="Fundas" esMarca={false} onCerrar={() => {}} />,
  )
}

describe('la fila en edición se puede guardar con el mouse', () => {
  /**
   * La primera versión no tenía ningún botón: el `<form>` sólo se enviaba con
   * Enter. Quien escribiera un nombre y tocara cualquier otra parte de la
   * pantalla perdía lo escrito **sin ninguna señal** — no hay `onBlur` que
   * guarde ni cartel que avise. Y como la maqueta no dibuja este estado, no
   * había nada que dijera que Enter era la única salida.
   */
  it('el alta trae un botón de submit', async () => {
    const html = await pintarAlta()
    expect(html).toMatch(/<button[^>]*type="submit"/)
  })

  it('y la edición también', async () => {
    const html = await pintarEdicion()
    expect(html).toMatch(/<button[^>]*type="submit"/)
  })

  // Escape cancela, pero es tan invisible como Enter: hace falta el botón.
  it('las dos traen un botón de cancelar', async () => {
    for (const html of [await pintarAlta(), await pintarEdicion()]) {
      expect(html).toContain('Cancelar')
    }
  })
})

describe('los avisos van por toast', () => {
  /**
   * Antes el error vivía anclado a la fila, en una columna de 248 px: dos
   * líneas ahí quedan apretadas, y con el panel scrolleado el cartel podía
   * quedar cortado. El dueño del producto pidió toasts (2026-08-24), y eso
   * revierte la decisión escrita en CLAUDE.md — que decía "sin sumar una
   * librería de toasts **sólo para un vaciado deshacible**". Eran seis casos,
   * no uno.
   */
  it('el ABM no dibuja carteles propios', () => {
    expect(FUENTE).not.toContain('role="alert"')
  })

  /**
   * **Los errores NO se auto-descartan.** "Fundas tiene 2 marcas adentro" es
   * accionable: dice qué hacer antes de reintentar, y un toast que se va solo
   * a los cuatro segundos se lleva justamente la instrucción. Los avisos de
   * éxito sí se van — "Categoría creada" no hay que releerlo, y además la
   * categoría apareciendo en el árbol ya es la confirmación.
   */
  it('los errores son persistentes y los éxitos no', () => {
    expect(FUENTE).toContain('duration: Infinity')
    // Y el éxito no arrastra la misma opción.
    const exito = FUENTE.slice(FUENTE.indexOf('toast.success'))
    expect(exito.slice(0, 120)).not.toContain('Infinity')
  })

  it('el error usa toast.error y el aviso toast.success', () => {
    expect(FUENTE).toContain('toast.error')
    expect(FUENTE).toContain('toast.success')
  })
})

describe('los errores del menú no se pierden', () => {
  /**
   * `moverCategoriaAccion` puede fallar de verdad: mover "Samsung" a un rubro
   * que ya tiene una "Samsung" choca contra el índice único. La primera
   * versión descartaba el estado (`const [, ejecutarMovida] = …`), así que ese
   * error no llegaba a ninguna parte: la marca simplemente no se movía y la
   * pantalla no decía por qué.
   */
  it('mover avisa su resultado, igual que borrar', () => {
    // Las dos acciones del menú pasan por el mismo `ejecutar`, que avisa
    // siempre. Una versión anterior descartaba el estado de mover, así que un
    // choque de nombre en el rubro destino no llegaba a ninguna parte.
    expect(FUENTE).toContain('ejecutar(moverCategoriaAccion')
    expect(FUENTE).toContain('ejecutar(borrarCategoriaAccion')
    expect(FUENTE).toMatch(/avisar\(await accion\(/)
  })

  /**
   * `useActionState` retiene su último estado mientras el componente viva, así
   * que un efecto que dispare el toast con `[estado]` como dependencia lo
   * volvería a lanzar en cada render. La clave del toast lo resuelve: sonner
   * reemplaza el que ya está en pantalla en vez de apilar copias.
   */
  /**
   * El bug que costó dos idas y vueltas (2026-08-24): los toasts
   * "desaparecían rápido" sin importar su `duration`. La causa no era sonner
   * —un botón de prueba que lanzaba un toast persistente sin tocar el servidor
   * se quedaba perfecto— sino que el aviso colgaba de un `useEffect` sobre
   * `useActionState`: las filas del árbol se re-renderizan y se desmontan con
   * cada `revalidatePath`, y el efecto se iba con ellas.
   *
   * Ahora el toast se lanza en el mismo handler que ejecuta la acción, una
   * sola vez y con el resultado ya en la mano.
   */
  it('el aviso no cuelga de un efecto ni de useActionState', () => {
    // Sobre los IMPORTS y no sobre el texto del archivo: es la tercera vez en
    // este ciclo que un caso escrito con `toContain` se atrapa con el
    // comentario que documenta el bug — la prosa que explica por qué algo NO
    // se usa contiene, necesariamente, su nombre.
    expect(FUENTE).not.toMatch(/import\s*\{[^}]*\buseActionState\b/)
    expect(FUENTE).not.toMatch(/^\s*useAvisoDeAccion\(/m)
    // El único useEffect que queda es el del foco del campo, que sí es de
    // ciclo de vida.
    expect(FUENTE.match(/useEffect\(/g) ?? []).toHaveLength(1)
  })
})

describe('nada muerto', () => {
  // `CrearRubro` se escribió y quedó sin consumidor: el botón + terminó
  // viviendo en el panel. Un export que nadie usa es una versión paralela
  // esperando a que alguien la use por error.
  it('no exporta un CrearRubro sin consumidor', () => {
    expect(FUENTE).not.toContain('export function CrearRubro')
  })
})
