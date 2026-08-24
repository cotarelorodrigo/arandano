import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Navegacion } from '@/components/navegacion'
import { SidebarProvider } from '@/components/ui/sidebar'

// usePathname sólo existe adentro del router de Next. Acá interesa qué
// renderiza la navegación para una ruta dada, no cómo Next la averigua.
const usePathname = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => usePathname() }))

async function render(rol: 'DUENO' | 'EMPLEADO', ruta: string) {
  usePathname.mockReturnValue(ruta)
  const { Navegacion } = await import('@/components/navegacion')
  // SidebarMenuButton (components/ui/sidebar.tsx) llama a useSidebar(), que
  // tira si no hay un SidebarProvider como ancestro — en la app real ese
  // ancestro lo pone el shell (Task 3), acá lo pone el test. Sin esto,
  // CUALQUIER render de Navegacion explota con "useSidebar must be used
  // within a SidebarProvider", no con una aserción que falle.
  //
  // Y tiene que importarse DINÁMICO, igual que Navegacion: con
  // vi.resetModules() en cada beforeEach, un SidebarProvider importado
  // arriba del archivo (antes del primer reset) queda armado sobre un
  // React.createContext() de una instancia vieja de sidebar.tsx. Navegacion,
  // reimportada después del reset, arrastra su propia instancia nueva del
  // mismo archivo —con su propio SidebarContext—, así que useSidebar() no
  // encuentra el Provider de arriba: son dos Context distintos con el mismo
  // nombre. Importando los dos en la misma llamada quedan atados a la misma
  // instancia del módulo.
  const { SidebarProvider } = await import('@/components/ui/sidebar')
  return renderToStaticMarkup(
    <SidebarProvider>
      <Navegacion rol={rol} />
    </SidebarProvider>,
  )
}

// Import dinámico y no de arriba: el archivo usa vi.resetModules() en cada
// beforeEach, así que un import de módulo quedaría apuntando a una instancia
// vieja. El nombre del helper NO es `estaActiva` a propósito — llamar
// `(await estaActiva())(...)` se lee pésimo y esconde qué se está probando.
async function traerEstaActiva() {
  return (await import('@/components/navegacion')).estaActiva
}

describe('estaActiva', () => {
  beforeEach(() => {
    vi.resetModules()
    usePathname.mockReset()
  })

  it('la ruta exacta activa la pestaña', async () => {
    const activa = await traerEstaActiva()
    expect(activa('/vender', '/vender')).toBe(true)
  })

  // Sin esto, entrar al detalle de una venta apagaría toda la navegación y
  // parecería un bug.
  it('una ruta de detalle activa su pestaña', async () => {
    const activa = await traerEstaActiva()
    expect(activa('/ventas', '/ventas/abc-123')).toBe(true)
    expect(activa('/inventario', '/inventario/nuevo')).toBe(true)
  })

  // El caso que justifica la barra en el prefijo: /vender y /ventas se
  // parecen lo suficiente como para que alguien "arregle" esto algún día.
  it('/ventas NO activa Vender, ni al revés', async () => {
    const activa = await traerEstaActiva()
    expect(activa('/vender', '/ventas')).toBe(false)
    expect(activa('/ventas', '/vender')).toBe(false)
  })

  it('un hermano con prefijo parecido no activa', async () => {
    const activa = await traerEstaActiva()
    expect(activa('/vender', '/vender-mayorista')).toBe(false)
  })
})

describe('Navegacion', () => {
  beforeEach(() => {
    vi.resetModules()
    usePathname.mockReset()
  })

  // aria-current y no una clase de CSS: es lo que un lector de pantalla
  // anuncia, y de paso es estable frente a un cambio de estilos.
  //
  // Se compara por elemento, no por substring de "href=... aria-current=...":
  // next/link (dist/client/app-dir/link.js) saca `href` de las props que
  // recibe y lo vuelve a poner recién al final, después de esparcir el resto
  // de las props — así que en el HTML final `aria-current` termina antes que
  // `href` sin importar en qué orden los escriba el componente. Es un detalle
  // interno de Link en esta versión de Next, no algo que el componente pueda
  // controlar.
  it('marca la pestaña activa con aria-current', async () => {
    const html = await render('EMPLEADO', '/inventario/nuevo')
    const inventario = html.match(/<a[^>]*href="\/inventario"[^>]*>/)?.[0] ?? ''
    const vender = html.match(/<a[^>]*href="\/vender"[^>]*>/)?.[0] ?? ''
    expect(inventario).toContain('aria-current="page"')
    expect(vender).not.toContain('aria-current="page"')
  })

  it('un dueño ve Usuarios', async () => {
    const html = await render('DUENO', '/vender')
    expect(html).toContain('href="/usuarios"')
  })

  it('un empleado no ve Usuarios', async () => {
    const html = await render('EMPLEADO', '/vender')
    expect(html).not.toContain('href="/usuarios"')
  })

  it('están las cuatro pestañas que ve cualquiera', async () => {
    const html = await render('EMPLEADO', '/vender')
    // Vender, Ventas, Inventario y Servicio Técnico. Usuarios no: es del dueño.
    for (const href of ['/vender', '/ventas', '/inventario', '/servicio-tecnico']) {
      expect(html).toContain(`href="${href}"`)
    }
  })

  // El detalle de una orden y el ticket cuelgan de /servicio-tecnico, así que
  // tienen que dejar esa pestaña subrayada, igual que /ventas/<id> con Ventas.
  it('el detalle de una orden deja subrayada Servicio Técnico', async () => {
    const activa = await traerEstaActiva()
    expect(activa('/servicio-tecnico', '/servicio-tecnico/abc-123')).toBe(true)
    // Y el ticket, que cuelga un nivel más abajo.
    expect(activa('/servicio-tecnico', '/servicio-tecnico/abc-123/ticket')).toBe(true)
  })

  // Frágil a propósito, y por eso va con su motivo escrito: las pestañas no
  // tenían focus-visible y quedaban con el outline del navegador, sobre un
  // producto que se opera con teclado en un mostrador. Mide sobre los CINCO
  // <a> reales, no sobre el HTML entero: `focus-visible:ring-2` es parte fija
  // de sidebarMenuButtonVariants (components/ui/sidebar.tsx), así que aparece
  // en el HTML pase lo que pase adentro del botón — un toContain() sobre el
  // string completo pasaría igual aunque `asChild` no forwardeara la clase al
  // ancla, o aunque sólo una de las cinco la tuviera. Contando por elemento es
  // lo único que de verdad impide que el anillo desaparezca en un refactor de
  // estilos sin que nada se queje. Si cambia el nombre de la utilidad de
  // Tailwind, se actualiza acá: ése es el costo y se paga.
  it('cada pestaña lleva anillo de foco propio', async () => {
    const html = await render('DUENO', '/vender')
    const anclas = html.match(/<a\b[^>]*>/g) ?? []
    expect(anclas).toHaveLength(5)
    expect(anclas.filter((a) => a.includes('focus-visible:ring-2'))).toHaveLength(5)
  })

  // Los íconos los nombra design/arandano.pen. No son decoración: en un
  // sidebar de 248 px son lo que hace la entrada reconocible de reojo, que es
  // como se opera un mostrador. Van con aria-hidden porque el rótulo de al lado
  // ya dice lo mismo, y anunciarlo dos veces es peor que no anunciarlo.
  it('cada pestaña lleva su ícono, y el ícono no se anuncia', async () => {
    // El resto de los casos de este describe llaman a render(), que setea
    // este mock y envuelve en SidebarProvider antes de renderizar. Éste llama
    // a renderToStaticMarkup() directo (no le importa la ruta, sólo los
    // íconos), pero Navegacion sigue necesitando las dos cosas: usePathname()
    // devolviendo un string —si no, estaActiva() explota contra
    // `undefined.startsWith`— y un SidebarProvider como ancestro —si no,
    // SidebarMenuButton explota con "useSidebar must be used within a
    // SidebarProvider". Ninguna de las dos es la aserción que el caso quiere
    // probar, así que ninguna se deja como falla de la aserción.
    usePathname.mockReturnValue('/vender')
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <Navegacion rol="DUENO" />
      </SidebarProvider>,
    )
    const svgs = html.match(/<svg[^>]*aria-hidden="true"[^>]*>/g) ?? []
    expect(svgs).toHaveLength(5)
  })
})
