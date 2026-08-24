import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

// Mismo patrón que app/page.test.tsx: exigirSesion depende de headers(), de
// authParaTenant y de Postgres, que son detalle de otro módulo
// (lib/auth/sesion.test.ts). Acá sólo importa qué renderiza el layout con una
// sesión dada.
const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({
  exigirSesion: () => exigirSesion(),
}))

// El layout renderiza <Navegacion>, que desde el ciclo del home llama a
// usePathname(). Sin este mock se cae el archivo entero, y el síntoma no
// nombra a la navegación por ningún lado.
vi.mock('next/navigation', () => ({ usePathname: () => '/vender' }))

// La server action del botón "Salir" no se ejercita acá: es un archivo
// 'use server' y su contrato ya lo fija test/use-server.test.ts.
vi.mock('./acciones', () => ({ salir: vi.fn() }))

async function render() {
  const { default: LayoutApp } = await import('@/app/(app)/layout')
  const elemento = await LayoutApp({ children: <p>contenido</p> })
  return renderToStaticMarkup(elemento)
}

describe('layout de la aplicación', () => {
  beforeEach(() => {
    vi.resetModules()
    exigirSesion.mockReset()
    exigirSesion.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'DUENO' },
      subdominio: 'prueba',
    })
  })

  // El marcador que usa el smoke autenticado (scripts/smoke.sh) para
  // distinguir una pantalla de verdad de un 200 cualquiera. Si esto se rompe,
  // TODOS los casos de pantalla del gate fallan a la vez.
  it('marca el nombre del local con data-testid, para el smoke autenticado', async () => {
    const html = await render()
    expect(html).toContain('data-testid="tenant-nombre">Local de prueba')
  })

  // El cartel recorta y guarda el nombre completo en title: un nombre largo en
  // 360 px de ancho no puede empujar el botón Salir fuera de la pantalla.
  it('el cartel guarda el nombre completo en title', async () => {
    const html = await render()
    expect(html).toContain('title="Local de prueba"')
  })

  // Frágil a propósito, y va con su motivo: es lo único que impide que el
  // tratamiento de display desaparezca en un refactor de estilos sin que nada
  // se queje. Vitest resuelve los módulos CSS devolviendo el nombre de la
  // clase, así que `estilos.cartel` llega al HTML como "cartel".
  it('el nombre del local lleva el tratamiento de cartel', async () => {
    const html = await render()
    expect(html).toMatch(/class="[^"]*cartel/)
  })

  // El pie del sidebar (SidebarArandano) es quien marca el nombre ahora. No
  // alcanza con el data-testid solo: si mañana el span queda vacío o muestra
  // otra cosa (el rol, por ejemplo), este caso tiene que notarlo.
  it('marca el nombre del usuario, que scripts/smoke.sh busca tras el login', async () => {
    const html = await render()
    expect(html).toContain('data-testid="usuario-nombre"')
    expect(html).toContain('Quien sea')
  })

  // Se mudaron del footer al pie del sidebar, que es donde la maqueta los pone.
  it('muestra el stack y la imagen desplegada, en el pie del sidebar', async () => {
    const html = await render()
    expect(html).toContain('data-testid="stack"')
    expect(html).toContain('data-testid="sha"')
  })

  it('renderiza la navegación', async () => {
    const html = await render()
    // href="/vender" y no sólo el texto "Inventario": el texto solo pasaría
    // igual si el link se rompiera y la pestaña quedara sin href, o si sólo se
    // renderizara el rótulo suelto sin el <Link>. El href es lo que prueba que
    // la navegación de verdad se montó, no que la palabra apareció en algún lado.
    expect(html).toContain('href="/vender"')
  })

  // Los casos por rol (qué pestañas ve un dueño vs. un empleado) ya están en
  // components/navegacion.test.tsx — acá sólo importa que el layout CABLEE
  // sesion.usuario.rol hacia <Navegacion>, y no un valor fijo. Sin este caso,
  // un <Navegacion rol="DUENO" /> hardcodeado en el layout pasaría el resto de
  // la suite en verde y le mostraría Usuarios a cualquier empleado.
  it('pasa el rol de la sesión a la navegación, no uno fijo', async () => {
    exigirSesion.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'EMPLEADO' },
      subdominio: 'prueba',
    })
    const html = await render()
    expect(html).not.toContain('href="/usuarios"')
  })

  it('renderiza el contenido de adentro', async () => {
    const html = await render()
    expect(html).toContain('contenido')
  })

  it('el sidebar marca la entrada activa con aria-current', async () => {
    const html = await render()
    expect(html).toContain('aria-current="page"')
  })

  // 248 px, que es lo que dibuja design/arandano.pen. El default de shadcn es
  // 16rem (256) y hay que pisarlo: el ancho del sidebar fija dónde arranca toda
  // la aplicación, así que ocho pixeles de más los arrastran las diez pantallas.
  it('el sidebar mide 15.5rem y no el default de shadcn', async () => {
    const html = await render()
    expect(html).toContain('15.5rem')
  })

  // La maqueta no dibuja un botón de colapsar. El trigger existe sólo para que
  // en un teléfono el sidebar se pueda abrir, y no se ve en el 1440 del diseño.
  it('el trigger de mobile no se muestra en desktop', async () => {
    const html = await render()
    expect(html).toMatch(/class="[^"]*md:hidden/)
  })
})

// C1 de la review final de la rama: ticket.module.css ocultaba `:global(header)`
// y `:global(footer)` al imprimir, apuntando al layout VIEJO — el shell de este
// ciclo no emite ninguno de los dos, así que nada ocultaba el sidebar ni su
// trigger sobre el ticket térmico. Este bloque no vuelve a fijar los selectores
// a mano (eso reintroduciría el mismo modo de falla si algún día no coinciden
// con lo que el CSS realmente oculta): LEE la regla de impresión desde
// ticket.module.css y comprueba que el shell de HOY todavía emite lo que esa
// regla nombra. Un shell que cambie de etiquetas sin tocar el CSS del ticket
// pone esto en rojo, en vez de quedar en silencio hasta que alguien lo note en
// un ticket impreso.
describe('el shell sigue emitiendo lo que el ticket oculta al imprimir', () => {
  // Describe hermano del de arriba: el beforeEach de ESE describe no alcanza
  // hasta acá, así que exigirSesion() necesita su propia sesión resuelta o
  // render() se cae al desestructurar sesion.tenant.
  beforeEach(() => {
    vi.resetModules()
    exigirSesion.mockReset()
    exigirSesion.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'DUENO' },
      subdominio: 'prueba',
    })
  })

  const CSS_TICKET = 'app/(app)/servicio-tecnico/[id]/ticket/ticket.module.css'

  /** Los selectores de la regla `@media print { :global(...), :global(...) { display: none } }`. */
  function selectoresDeImprimir(): string[] {
    const css = readFileSync(CSS_TICKET, 'utf8')
    // Se corta en el primer `{ display: none;` que sigue a `@media print {`:
    // es la regla que oculta el shell, antes de que el bloque siga con .hoja y
    // .corte, que no son selectores :global y no vienen al caso acá.
    const bloque = css.match(/@media print \{([\s\S]*?)\{\s*display: none;/)
    if (!bloque) {
      throw new Error(
        `${CSS_TICKET} ya no tiene una regla "@media print { ... { display: none; }" ` +
          `que oculte el shell. Si la reescribiste, actualizá este parser junto con ella.`,
      )
    }
    return [...bloque[1].matchAll(/:global\(([^)]+)\)/g)].map((m) => m[1].trim())
  }

  /**
   * Si `selector` (un selector CSS simple: una etiqueta o un atributo entre
   * corchetes) aparece en `html`. No intenta ser un motor de selectores CSS:
   * sólo entiende las dos formas que este archivo puede necesitar, y avisa en
   * vez de pasar en silencio si aparece una tercera.
   */
  function apareceEnElShell(selector: string, html: string): boolean {
    const atributo = selector.match(/^\[([a-zA-Z-]+)=['"]([^'"]+)['"]\]$/)
    if (atributo) return html.includes(`${atributo[1]}="${atributo[2]}"`)
    const etiqueta = selector.match(/^[a-zA-Z][a-zA-Z0-9]*$/)
    if (etiqueta) return new RegExp(`<${selector}[\\s>]`).test(html)
    throw new Error(
      `El selector "${selector}" de ${CSS_TICKET} no es una etiqueta ni un atributo ` +
        `simple ([attr="valor"]) — sumá un caso a apareceEnElShell() para poder verificarlo.`,
    )
  }

  it('cada selector del bloque de impresión existe en el HTML que el shell emite', async () => {
    const html = await render()
    const selectores = selectoresDeImprimir()
    // Fail-closed, mismo criterio que "no está vacía" en test/sistema-de-diseno.test.ts:
    // si el parser de arriba dejara de matchear, una lista vacía haría pasar el
    // for-of de abajo sin mirar nada.
    expect(selectores.length).toBeGreaterThan(0)
    for (const selector of selectores) {
      expect(
        apareceEnElShell(selector, html),
        `${CSS_TICKET} oculta "${selector}" al imprimir, pero el shell de hoy no lo ` +
          `emite — ese selector quedó huérfano y lo que debería ocultarse en el ` +
          `ticket térmico (el sidebar, su trigger) ya no se oculta.`,
      ).toBe(true)
    }
  })
})
