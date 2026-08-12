import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

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

  // Se mudó acá desde app/page.tsx en el ciclo del home. Gana cobertura al
  // mudarse: deja de probarse en UNA pantalla y pasa a probarse en todas las
  // autenticadas, porque el barrido del gate lo busca en cada una.
  it('marca el nombre del usuario, que scripts/smoke.sh busca tras el login', async () => {
    const html = await render()
    expect(html).toContain('data-testid="usuario-nombre"')
    expect(html).toContain('Quien sea')
  })

  it('muestra el stack y la imagen desplegada', async () => {
    const html = await render()
    expect(html).toContain('data-testid="stack"')
    expect(html).toContain('data-testid="sha"')
  })

  it('renderiza la navegación', async () => {
    const html = await render()
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
})
