import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Encabezado } from './encabezado'

describe('el encabezado de pantalla', () => {
  it('el título es el h1 de la pantalla', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Inventario" />)
    expect(html).toMatch(/<h1[^>]*>Inventario<\/h1>/)
  })

  it('sin subtítulo no deja un párrafo vacío', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Vender" />)
    expect(html).not.toContain('<p')
  })

  it('el subtítulo va debajo del título', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Ventas" subtitulo="47 ventas" />)
    expect(html.indexOf('Ventas')).toBeLessThan(html.indexOf('47 ventas'))
  })

  // Cuatro de las diez pantallas ya tienen su botón en la fila del título.
  it('las acciones van a la derecha', () => {
    const html = renderToStaticMarkup(
      <Encabezado titulo="Inventario" acciones={<button>Artículo nuevo</button>} />,
    )
    expect(html).toContain('Artículo nuevo')
    expect(html.indexOf('Inventario')).toBeLessThan(html.indexOf('Artículo nuevo'))
  })

})

/**
 * Las `page.tsx` de `app/(app)/`, barridas del sistema de archivos.
 *
 * Mismo patrón que `test/rutas-con-guard.test.ts` y `test/pantallas.test.ts`:
 * derivada y no una lista a mano, para que una pantalla nueva quede cubierta
 * sin que nadie se acuerde de sumarla.
 */
function paginasDeLaApp(dir = 'app/(app)', acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      paginasDeLaApp(completo, acumulado)
    } else if (/^page\.(tsx|ts|jsx|js)$/.test(entrada)) {
      acumulado.push(completo)
    }
  }
  return acumulado
}

describe('un solo h1 por pantalla', () => {
  // El caso viejo ("nunca hay más de un h1") no podía fallar nunca: Encabezado
  // tiene un <h1> LITERAL en su propio JSX, así que "renderizar Encabezado y
  // contar los <h1>" siempre daba 1, sea lo que sea que le pasaras. El riesgo
  // real no vive acá adentro: vive en los diez page.tsx que consumen
  // Encabezado, cualquiera de los cuales podría sumar su propio <h1> —como de
  // hecho pasaba antes del ciclo del shell— y volver a haber dos landmarks
  // <h1> en la misma pantalla. Este caso mira ahí.
  it('ningún page.tsx de la aplicación dibuja su propio <h1>', () => {
    const paginas = paginasDeLaApp()
    expect(paginas.length, 'no se encontró ningún page.tsx bajo app/(app)/').toBeGreaterThan(0)
    for (const p of paginas) {
      expect(
        readFileSync(p, 'utf8'),
        `${p} tiene un <h1> propio. El único <h1> de la pantalla lo pone ` +
          `<Encabezado> (components/shell/encabezado.tsx) — sacalo de acá.`,
      ).not.toMatch(/<h1[\s>]/)
    }
  })
})
