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

describe('los errores del menú no se pierden', () => {
  /**
   * `moverCategoriaAccion` puede fallar de verdad: mover "Samsung" a un rubro
   * que ya tiene una "Samsung" choca contra el índice único. La primera
   * versión descartaba el estado (`const [, ejecutarMovida] = …`), así que ese
   * error no llegaba a ninguna parte: la marca simplemente no se movía y la
   * pantalla no decía por qué.
   */
  it('mover no descarta su estado', () => {
    // Sobre el USO y no sobre la forma del destructuring: la primera versión
    // de este caso buscaba el patrón viejo (`const [, ejecutarMovida]`) con un
    // regex, y se atrapaba a sí misma — el comentario que documenta el bug lo
    // menciona textualmente. Que el error se lea es lo que importa.
    expect(FUENTE).toContain('movida.error')
  })

  it('el mensaje que se muestra cubre las dos acciones del menú', () => {
    // Una sola caja de error para borrar y mover: son las dos acciones del
    // menú que pueden fallar, y dos cajas en una columna de 248 se pisan.
    expect(FUENTE).toContain('errorDelMenu')
  })

  /**
   * `useActionState` no tiene reset: una vez que muestra un error, lo retiene
   * para siempre. Sin apagarlo, el cartel de "tiene 4 artículos" queda pegado
   * bajo la fila aunque después se muevan los artículos y el borrado ya sea
   * posible — diciendo algo que dejó de ser cierto.
   */
  it('el error se apaga al reabrir el menú', () => {
    expect(FUENTE).toContain('onOpenChange')
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
