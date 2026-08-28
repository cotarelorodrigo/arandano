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
  // px-3 = 12px (kyXe1 declara "padding":[0,12], NO 16 — un rojo real que
  // dejó pasar la primera ronda de review, con px-4 en su lugar).
  // gap-2.5 = 10px (kyXe1 "gap":10) y lg:gap-4 = 16px, el de siempre.
  it('la franja mide h-14 en el teléfono y 66px en escritorio', () => {
    const html = render()
    const header = html.match(/<header[^>]*>/)?.[0]
    expect(header, 'no se encontró el <header>').toBeTruthy()
    expect(header).toContain('h-14')
    expect(header).toContain('lg:h-[66px]')
    expect(header).toContain('px-3')
    expect(header).toContain('lg:px-7')
    expect(header).toContain('gap-2.5')
    expect(header).toContain('lg:gap-4')
  })

  describe('la ranura izquierda', () => {
    it('sin atrás, abre el drawer con el SidebarTrigger, sólo visible en el teléfono', () => {
      const html = render()
      const trigger = html.match(/<button[^>]*data-slot="sidebar-trigger"[^>]*>/)?.[0]
      expect(trigger, 'no se encontró el SidebarTrigger').toBeTruthy()
      expect(trigger).toContain('lg:hidden')
    })

    // f9BjR pide la misma caja que la variante `atras` de al lado: 38×38,
    // radio 10, ícono 21 — no el size-7/ícono-16 que trae shadcn por
    // default. Segunda ronda de review: la primera dejaba pasar el default.
    it('el SidebarTrigger tiene la misma caja e ícono que la variante con atrás', () => {
      const html = render()
      const trigger = html.match(/<button[^>]*data-slot="sidebar-trigger"[^>]*>/)?.[0]
      expect(trigger).toContain('size-[38px]')
      expect(trigger).toContain('rounded-[10px]')
      // El ícono va con `!` (important): la base de shadcn
      // ([&_svg:not([class*='size-'])]:size-4) tiene más especificidad por
      // el :not(), así que sin `!` el 16px de siempre le gana al 21px nuevo.
      // size-[21px]! a secas (sin el prefijo [&_svg]:, que renderToStaticMarkup
      // escapa como &amp;_svg — mismo criterio que ya usa
      // chip-estado.test.tsx para este mismo patrón).
      expect(html).toContain('size-[21px]!')
    })

    it('con atrás, vuelve a la pantalla anterior y no muestra el trigger', () => {
      const html = render({ titulo: 'Venta #1042', atras: '/ventas' })
      expect(html).not.toContain('data-slot="sidebar-trigger"')
      const flecha = html.match(/<a[^>]*href="\/ventas"[^>]*>/)?.[0]
      expect(flecha, 'no se encontró el link de volver').toBeTruthy()
      expect(flecha).toContain('aria-label=')
      expect(flecha).toContain('lg:hidden')
    })

    // `alVolver` existe por /vender y su paso de cobro: ahí la flecha NO puede
    // ser un link, porque un href a /vender dispara una navegación de Next y
    // eso remonta PuntoDeVenta con el carrito de la venta en curso adentro
    // (ver app/(app)/vender/paso.ts). Misma caja y mismo ícono que la
    // variante `atras`, pero como <button>.
    it('con alVolver, la flecha es un botón y no un link', () => {
      const html = render({ titulo: 'Cobro', alVolver: () => {} })
      expect(html).not.toContain('data-slot="sidebar-trigger"')
      const boton = html.match(/<button[^>]*aria-label="Volver"[^>]*>/)?.[0]
      expect(boton, 'no se encontró el botón de volver').toBeTruthy()
      expect(boton).toContain('size-[38px]')
      expect(boton).toContain('rounded-[10px]')
      expect(boton).toContain('lg:hidden')
      // Y ningún <a> de volver: las dos variantes son excluyentes, o la
      // pantalla mostraría dos flechas pegadas.
      expect(html).not.toMatch(/<a[^>]*aria-label="Volver"/)
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

  // `controlMovil` es la otra forma que puede tomar la ranura derecha del
  // teléfono: `accionMovil` es SIEMPRE un link a un href (un solo toque), y
  // /vender necesita ahí un control con estado propio —la hoja donde se abre y
  // se cierra el turno de caja—. En vez de volver `accionMovil` una unión de
  // dos formas, la ranura acepta un nodo ya armado, y la geometría (38×38,
  // radio 10, lg:hidden) se comparte por CLASES_RANURA_MOVIL, que es lo que
  // evita que el control y el link se desalineen entre pantallas.
  describe('el control móvil', () => {
    it('renderiza el nodo que le pasan en la ranura derecha', () => {
      const html = render({
        titulo: 'Vender',
        controlMovil: <button aria-label="Más acciones">⋮</button>,
      })
      expect(html).toContain('aria-label="Más acciones"')
      // Después del bloque de título, como la ranura derecha que es.
      expect(html.indexOf('Vender')).toBeLessThan(html.indexOf('Más acciones'))
    })

    it('la geometría de la ranura se comparte con la acción móvil', async () => {
      const { CLASES_RANURA_MOVIL } = await import('./encabezado')
      expect(CLASES_RANURA_MOVIL).toContain('size-[38px]')
      expect(CLASES_RANURA_MOVIL).toContain('rounded-[10px]')
      expect(CLASES_RANURA_MOVIL).toContain('lg:hidden')
      // Y el link de `accionMovil` la usa de verdad, en vez de repetir los
      // mismos valores a mano: si no, cambiar la ranura de un lado dejaría el
      // otro atrás sin que nada avise.
      const fuente = readFileSync('components/shell/encabezado.tsx', 'utf8')
      expect(fuente).toMatch(/CLASES_RANURA_MOVIL/)
    })
  })

  // El corte de mobile: no lo declara ningún test propio en hooks/use-mobile.ts
  // (no hay jsdom para ejercitar matchMedia), así que se afirma acá, donde ya
  // hay un import real del módulo.
  it('el corte de mobile es 1024, no los 768 que trae shadcn por default', () => {
    expect(MOBILE_BREAKPOINT).toBe(1024)
  })

  // Vitest corre con `css: false`: importar el módulo CSS da un Proxy que
  // fabrica cualquier clase, exista o no (mismo hallazgo que ya documentó
  // test/tipografia.test.ts sobre importe.module.css) — así que la única
  // forma real de comprobar que el valor está es leer el TEXTO del archivo.
  // kyXe1 > aY2nd > H1 (S2AuWU) declara lineHeight: 1.2; el H1 de escritorio
  // no declara ninguno y no lo tuvo nunca. `line-height` es una propiedad
  // heredada: sin declaración propia en escritorio, el <h1> sigue heredando
  // el 1.5 que node_modules/tailwindcss/preflight.css fija en `html, :host`,
  // igual que antes de este ciclo — un `line-height: normal` ahí (el valor
  // INICIAL, no el heredado) casi entró en una ronda anterior de review y
  // hubiera achicado el interlineado de escritorio en las diez pantallas.
  // Por eso el caso afirma la AUSENCIA de la declaración en el bloque de
  // escritorio: es más honesto que afirmar un valor, porque acá lo que
  // protege es que nadie vuelva a escribir uno.
  it('el título lleva line-height 1.2 en el teléfono, y el escritorio no declara ninguno (hereda el 1.5 del preflight)', () => {
    const css = readFileSync('components/shell/encabezado.module.css', 'utf8')
    const base = css.slice(0, css.indexOf('@media'))
    const escritorio = css.slice(css.indexOf('@media'))
    // Sin comentarios en las DOS mitades, y no sólo en la de escritorio
    // (hallazgo I4 de la review final): el docblock del archivo vive antes
    // del @media, o sea adentro de `base`, y contiene el literal
    // "line-height: 1.2" dos veces en prosa. Así, borrar la declaración real
    // de `.titulo` dejaba este caso en verde — un falso verde sobre el valor
    // que le costó dos rondas a la primera task, incluida una regresión de
    // escritorio en las diez pantallas.
    const baseSinComentarios = base.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(
      baseSinComentarios,
      'el bloque base (mobile-first) no declara line-height: 1.2',
    ).toContain('line-height: 1.2')
    // Sin comentarios: el bloque de escritorio SÍ menciona la palabra
    // "line-height" en prosa (explicando por qué no hay que declararla), y
    // un chequeo ingenuo sobre el texto crudo se dispararía contra ese
    // comentario y no contra una declaración real.
    const escritorioSinComentarios = escritorio.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(
      escritorioSinComentarios,
      'la media query de escritorio declara su propio line-height — eso corta ' +
        'la herencia del 1.5 del preflight y achica el interlineado del H1 de ' +
        'escritorio. No debe declarar ninguno.',
    ).not.toContain('line-height')
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
