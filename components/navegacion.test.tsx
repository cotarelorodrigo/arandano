import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// usePathname sólo existe adentro del router de Next. Acá interesa qué
// renderiza la navegación para una ruta dada, no cómo Next la averigua.
const usePathname = vi.fn()
vi.mock('next/navigation', () => ({ usePathname: () => usePathname() }))

async function render(rol: 'DUENO' | 'EMPLEADO', ruta: string) {
  usePathname.mockReturnValue(ruta)
  const { Navegacion } = await import('@/components/navegacion')
  return renderToStaticMarkup(<Navegacion rol={rol} />)
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

  it('están las tres pestañas que ve cualquiera', async () => {
    const html = await render('EMPLEADO', '/vender')
    for (const href of ['/vender', '/ventas', '/inventario']) {
      expect(html).toContain(`href="${href}"`)
    }
  })

  // Frágil a propósito, y por eso va con su motivo escrito: las pestañas no
  // tenían focus-visible y quedaban con el outline del navegador, sobre un
  // producto que se opera con teclado en un mostrador. Esta aserción es lo
  // único que impide que el anillo desaparezca en un refactor de estilos sin
  // que nada se queje. Si cambia el nombre de la utilidad de Tailwind, se
  // actualiza acá: ése es el costo y se paga.
  it('cada pestaña lleva anillo de foco propio', async () => {
    const html = await render('DUENO', '/vender')
    const pestanas = html.match(/<a[^>]*>/g) ?? []
    expect(pestanas).toHaveLength(4)
    for (const pestana of pestanas) {
      expect(pestana).toContain('focus-visible:inset-ring-3')
    }
  })
})
