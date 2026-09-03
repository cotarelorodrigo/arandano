import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

// exigirSesion se mockea acá y no se deja correr de verdad: su implementación
// real depende de headers(), de authParaTenant y de Postgres, que son detalle
// de otro módulo (ver lib/auth/sesion.test.ts). Lo único que a esta página le
// importa es: sin sesión redirige, con sesión sigue de largo hacia /vender —
// el resultado de exigirSesion() ni se lee, así que a esta página le alcanza
// con que la promesa resuelva.
const exigirSesion = vi.fn()
vi.mock('@/lib/auth/sesion', () => ({
  exigirSesion: () => exigirSesion(),
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
const forbidden = vi.fn(() => {
  throw new Error('NEXT_FORBIDDEN')
})
const redirect = vi.fn((destino: string) => {
  throw new Error(`NEXT_REDIRECT:${destino}`)
})
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  forbidden: () => forbidden(),
  redirect: (destino: string) => redirect(destino),
}))

// El formulario de la landing importa el action, y bajo vitest no hay
// servidor de Next para ejecutarlo.
vi.mock('@/app/sitio/acciones', () => ({ enviarLead: vi.fn() }))

// El ápex ahora arma el link de "Ya tengo cuenta" con piezasDeOrigen(), que lee
// x-forwarded-proto para decidir el protocolo. No se mockea piezasDeOrigen sino
// el header: así el test ejercita la función de verdad —incluida su lista
// blanca— y no una versión de mentira que podría divergir de ella.
const cabeceras = vi.hoisted(() => ({ proto: 'https' }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-proto': cabeceras.proto }),
}))

async function render() {
  const { default: Home } = await import('@/app/page')
  return Home()
}

describe('página raíz', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
    exigirSesion.mockReset()
    notFound.mockClear()
    forbidden.mockClear()
    redirect.mockClear()
  })

  it('404 para un dominio ajeno', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'ajeno' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  it('404 para un subdominio reservado', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'reservado', subdominio: 'admin' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  it('404 para un subdominio inexistente', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'inexistente', subdominio: 'nadie' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(exigirSesion).not.toHaveBeenCalled()
  })

  // 403 y no 404, deliberadamente: son mensajes distintos para situaciones
  // distintas. Y antes de exigirSesion Y antes del redirect: un tenant
  // suspendido no llega ni a preguntar si hay sesión, y no puede terminar en
  // /vender para que otra cosa lo rebote sin decir por qué.
  it('403 para un tenant suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
    expect(notFound).not.toHaveBeenCalled()
    expect(exigirSesion).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
  })

  // Con el guard puesto, un tenant sin sesión ya no renderiza nada de la home:
  // exigirSesion() es quien decide, y en la realidad redirige a /login (ver
  // lib/auth/sesion.ts). Acá se simula esa redirección con el mismo patrón que
  // notFound/forbidden más arriba, porque a esta página sólo le importa que
  // delega en exigirSesion antes de renderizar, no cómo exigirSesion redirige.
  it('sin sesión, / delega en exigirSesion (que redirige a /login)', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    exigirSesion.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT:/login')
    })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/login')
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
  })

  // El home dejó de ser una pantalla: es la aplicación abierta en la pestaña
  // por defecto. Lo que se afirma es el DESTINO, que depende del ROL
  // (destinoAlEntrar, lib/auth/destino.ts) y no es un único literal: un DUENO
  // cae en /dashboard y un EMPLEADO en /vender, los dos casos de abajo.
  it('con sesión, un DUENO va a /dashboard', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    exigirSesion.mockResolvedValue({ usuario: { id: 'u1', rol: 'DUENO' } })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/dashboard')
    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })

  it('con sesión, un EMPLEADO va a /vender', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    exigirSesion.mockResolvedValue({ usuario: { id: 'u1', rol: 'EMPLEADO' } })
    await expect(render()).rejects.toThrow('NEXT_REDIRECT:/vender')
    expect(redirect).toHaveBeenCalledWith('/vender')
  })

  // Mismo criterio que caso_home_responde en scripts/smoke.sh tras el fix de
  // review: el apex no sólo tiene que evitar notFound()/forbidden(), el
  // cuerpo tiene que estar libre de los testids de una página de tenant. Un
  // apex que por error resolviera a un tenant hubiera pasado la aserción
  // vieja igual.
  it('el apex renderiza la landing', async () => {
    process.env.DOMINIO_BASE = 'arandano.app'
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    const elemento = await render()
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
    expect(exigirSesion).not.toHaveBeenCalled()
    expect(redirect).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(elemento)
    expect(html).toContain('Todo el local en un solo lugar')
    expect(html).not.toContain('data-testid="tenant-nombre"')
  })

  // El link de "Ya tengo cuenta" lo arma el navegador con las piezas que le baja
  // esta página. Cablearlas fue el defecto: decía siempre https:// y sin puerto,
  // que es correcto en producción y en dev manda a una dirección que no existe.
  // Se afirma acá, en la página, porque es el único lugar donde las piezas se
  // leen del entorno — entrar.test.tsx ya prueba la función pura con las dos.
  it('el ápex baja el protocolo y el puerto del entorno, no https cableado', async () => {
    process.env.DOMINIO_BASE = 'dev.arandano.app'
    process.env.PUERTO_PUBLICO = '3000'
    cabeceras.proto = 'http'
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    try {
      // Se mira el elemento y no el markup: el destino del link lo calcula el
      // navegador recién al enviar el formulario (Entrar es de cliente), así que
      // NO aparece en el HTML estático. Lo que esta página decide, y lo único
      // que puede romper acá, son las piezas que le pasa hacia abajo.
      const elemento = (await render()) as { props: { base: unknown } }
      expect(elemento.props.base).toEqual({
        protocolo: 'http',
        dominio: 'dev.arandano.app',
        puerto: ':3000',
      })
    } finally {
      delete process.env.PUERTO_PUBLICO
      cabeceras.proto = 'https'
    }
  })
})
