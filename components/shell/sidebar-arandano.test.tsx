import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarArandano } from './sidebar-arandano'
import { SidebarProvider } from '@/components/ui/sidebar'

// Navegacion llama a usePathname(); sin esto se cae el archivo entero y el
// síntoma no la nombra por ningún lado.
vi.mock('next/navigation', () => ({ usePathname: () => '/vender' }))

function render(props: Partial<Parameters<typeof SidebarArandano>[0]> = {}) {
  return renderToStaticMarkup(
    // Tanto <Sidebar> como <Navegacion> llaman a useSidebar() y tiran si no
    // hay un SidebarProvider como ancestro. En la app real ese ancestro lo
    // pone app/(app)/layout.tsx (Task 4), envolviendo a SidebarArandano
    // entero — por eso SidebarArandano no se envuelve a sí mismo. Acá lo pone
    // el test, mismo motivo que ya documentó components/navegacion.test.tsx.
    // A diferencia de ese archivo, éste no usa vi.resetModules() entre casos,
    // así que un import estático alcanza: no hay dos instancias del módulo
    // sidebar.tsx en juego, y por lo tanto un solo SidebarContext.
    <SidebarProvider>
      <SidebarArandano
        nombreLocal="Local de prueba"
        nombreUsuario="Quien sea"
        rol="DUENO"
        alSalir={vi.fn()}
        {...props}
      />
    </SidebarProvider>,
  )
}

describe('el sidebar de Arándano', () => {
  // El marcador que usa scripts/smoke.sh en CADA pantalla autenticada. Cambia
  // de lugar en el DOM y no de nombre; y el atributo va último, porque el grep
  // del smoke busca el `>` pegado al nombre.
  it('marca el nombre del local con data-testid, para el smoke autenticado', () => {
    expect(render()).toContain('data-testid="tenant-nombre">Local de prueba')
  })

  it('el nombre del local lleva el tratamiento de cartel', () => {
    expect(render()).toMatch(/class="[^"]*cartel/)
  })

  it('el nombre completo queda en title, para el que se trunca', () => {
    const html = render({ nombreLocal: 'Un local con un nombre larguísimo' })
    expect(html).toContain('title="Un local con un nombre larguísimo"')
  })

  // No alcanza con el data-testid solo: si mañana el span queda vacío o
  // muestra otra cosa (el rol, por ejemplo), este caso tiene que notarlo. El
  // de layout.test.tsx cubre lo mismo por integración, pero el unitario tiene
  // que sostenerse solo el día que ese otro cambie de forma.
  it('marca el nombre del usuario, que scripts/smoke.sh busca tras el login', () => {
    expect(render()).toContain('data-testid="usuario-nombre"')
    expect(render()).toContain('Quien sea')
  })

  // El ciclo del shell perdió este landmark en silencio al pasar de <nav> con
  // pestañas a <ul> de shadcn, y nadie se enteró hasta la review final. Un
  // lector de pantalla se quedó sin la navegación de las diez pantallas.
  it('la navegación es un landmark, no una lista suelta', () => {
    const html = render()
    expect(html).toMatch(/<nav[^>]*aria-label="[^"]+"/)
  })

  it('traduce el rol al castellano que se lee en el pie', () => {
    expect(render({ rol: 'DUENO' })).toContain('Dueño')
    expect(render({ rol: 'EMPLEADO' })).toContain('Empleado')
  })

  // La inicial y no una foto: el producto no tiene subida de imágenes y no la
  // va a tener por esto. Es lo que la maqueta dibuja.
  it('el avatar muestra la inicial del usuario', () => {
    expect(render({ nombreUsuario: 'Florencia' })).toContain('>F<')
  })

  // El stack y el sha son la verificación humana más barata que hay después de
  // un deploy. Estaban en el footer del layout; la maqueta los pone acá.
  it('muestra el stack y la imagen desplegada al pie', () => {
    const html = render()
    expect(html).toContain('data-testid="stack"')
    expect(html).toContain('data-testid="sha"')
  })
})
