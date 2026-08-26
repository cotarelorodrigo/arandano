import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { ShoppingCart } from 'lucide-react'
import { SidebarProvider } from '@/components/ui/sidebar'
import { MOBILE_BREAKPOINT } from '@/hooks/use-mobile'
import { Encabezado } from './encabezado'

// Sin atrás, la ranura izquierda SIEMPRE renderiza el SidebarTrigger (nunca
// las dos cosas a la vez, pero siempre una de las dos) — y SidebarTrigger
// llama a useSidebar(), que tira si no hay un SidebarProvider como ancestro.
// En la app real ese ancestro lo pone app/(app)/layout.tsx, envolviendo a
// cada page.tsx entero; acá lo pone este helper, mismo motivo que ya
// documentó components/shell/sidebar-arandano.test.tsx.
function render(props: Partial<Parameters<typeof Encabezado>[0]> = {}) {
  return renderToStaticMarkup(
    <SidebarProvider>
      <Encabezado titulo="Título de prueba" {...props} />
    </SidebarProvider>,
  )
}

describe('el encabezado de pantalla', () => {
  it('el título es el h1 de la pantalla', () => {
    const html = render({ titulo: 'Inventario' })
    expect(html).toMatch(/<h1[^>]*>Inventario<\/h1>/)
  })

  it('sin subtítulo no deja un párrafo vacío', () => {
    const html = render({ titulo: 'Vender' })
    // [ >] y no sólo '<p': desde que la ranura izquierda siempre renderiza un
    // ícono (el SidebarTrigger o la flecha), el HTML trae <svg><path ...>, y
    // 'no contiene <p' daba un falso rojo contra el propio <path>.
    expect(html).not.toMatch(/<p[ >]/)
  })

  it('el subtítulo va debajo del título', () => {
    const html = render({ titulo: 'Ventas', subtitulo: '47 ventas' })
    expect(html.indexOf('Ventas')).toBeLessThan(html.indexOf('47 ventas'))
  })

  // Cuatro de las diez pantallas ya tienen su botón en la fila del título.
  it('las acciones van a la derecha', () => {
    const html = render({ titulo: 'Inventario', acciones: <button>Artículo nuevo</button> })
    expect(html).toContain('Artículo nuevo')
    expect(html.indexOf('Inventario')).toBeLessThan(html.indexOf('Artículo nuevo'))
  })

  // La franja sirve a las dos maquetas con un solo componente: 56 px en
  // kyXe1 (Móvil/Topbar) y 66 px en el Topbar de escritorio. h-14 = 56px.
  it('la franja mide h-14 en el teléfono y 66px en escritorio', () => {
    const html = render()
    const header = html.match(/<header[^>]*>/)?.[0]
    expect(header, 'no se encontró el <header>').toBeTruthy()
    expect(header).toContain('h-14')
    expect(header).toContain('lg:h-[66px]')
    expect(header).toContain('px-4')
    expect(header).toContain('lg:px-7')
  })

  describe('la ranura izquierda', () => {
    it('sin atrás, abre el drawer con el SidebarTrigger, sólo visible en el teléfono', () => {
      const html = render()
      const trigger = html.match(/<button[^>]*data-slot="sidebar-trigger"[^>]*>/)?.[0]
      expect(trigger, 'no se encontró el SidebarTrigger').toBeTruthy()
      expect(trigger).toContain('lg:hidden')
    })

    it('con atrás, vuelve a la pantalla anterior y no muestra el trigger', () => {
      const html = render({ titulo: 'Venta #1042', atras: '/ventas' })
      expect(html).not.toContain('data-slot="sidebar-trigger"')
      const flecha = html.match(/<a[^>]*href="\/ventas"[^>]*>/)?.[0]
      expect(flecha, 'no se encontró el link de volver').toBeTruthy()
      expect(flecha).toContain('aria-label=')
      expect(flecha).toContain('lg:hidden')
    })
  })

  it('acciones sale envuelto en un contenedor con hidden lg:flex', () => {
    const html = render({ titulo: 'Inventario', acciones: <button>Artículo nuevo</button> })
    const contenedor = html.match(/<div class="[^"]*"[^>]*>/g)?.find((tag) => tag.includes('lg:flex'))
    expect(contenedor, 'no se encontró el contenedor de acciones').toBeTruthy()
    expect(contenedor).toContain('hidden')
    expect(contenedor).toContain('lg:flex')
  })

  describe('la acción móvil', () => {
    it('renderiza un link de 38px, redondeado 10px y sólo visible en el teléfono', () => {
      const html = render({
        titulo: 'Inventario',
        accionMovil: { icono: ShoppingCart, etiqueta: 'Vender', href: '/vender' },
      })
      const boton = html.match(/<a[^>]*href="\/vender"[^>]*>/)?.[0]
      expect(boton, 'no se encontró el botón de acción móvil').toBeTruthy()
      expect(boton).toContain('size-[38px]')
      expect(boton).toContain('rounded-[10px]')
      expect(boton).toContain('lg:hidden')
      expect(boton).toContain('aria-label="Vender"')
      expect(html).toContain('size-[19px]')
    })

    it('con tono "accion" (el default) pinta bg-primary', () => {
      const html = render({
        titulo: 'Inventario',
        accionMovil: { icono: ShoppingCart, etiqueta: 'Vender', href: '/vender' },
      })
      const boton = html.match(/<a[^>]*href="\/vender"[^>]*>/)?.[0]
      expect(boton).toContain('bg-primary')
      expect(boton).toContain('text-primary-foreground')
    })

    it('con tono "suave" pinta bg-muted', () => {
      const html = render({
        titulo: 'Vender',
        accionMovil: { icono: ShoppingCart, etiqueta: 'Más', href: '/vender', tono: 'suave' },
      })
      const boton = html.match(/<a[^>]*href="\/vender"[^>]*>/)?.[0]
      expect(boton).toContain('bg-muted')
      expect(boton).toContain('text-foreground')
    })
  })

  // El corte de mobile: no lo declara ningún test propio en hooks/use-mobile.ts
  // (no hay jsdom para ejercitar matchMedia), así que se afirma acá, donde ya
  // hay un import real del módulo.
  it('el corte de mobile es 1024, no los 768 que trae shadcn por default', () => {
    expect(MOBILE_BREAKPOINT).toBe(1024)
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
