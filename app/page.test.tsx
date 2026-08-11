import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

// exigirSesion se mockea acá y no se deja correr de verdad: su implementación
// real depende de headers(), de authParaTenant y de Postgres, que son detalle
// de otro módulo (ver lib/auth/sesion.test.ts). Lo único que a esta página le
// importa es: sin sesión redirige, con sesión trae un usuario.
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
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  forbidden: () => forbidden(),
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
  // distintas. Y antes de exigirSesion: un tenant suspendido no llega ni a
  // preguntar si hay sesión.
  it('403 para un tenant suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
    expect(notFound).not.toHaveBeenCalled()
    expect(exigirSesion).not.toHaveBeenCalled()
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

  // toBeTruthy() no alcanza acá: cualquier elemento JSX es truthy, así que un
  // tenant hardcodeado o el equivocado hubiera pasado igual. Se afirma sobre
  // el HTML que realmente sale, para distinguir de verdad PaginaTenant de
  // PaginaApex y confirmar que el nombre que se ve es el del tenant resuelto
  // y el usuario el de la sesión.
  //
  // `tenant-nombre` se había mudado a la pantalla de login en el ciclo de
  // autenticación y volvió acá con el smoke autenticado: `/` es una pantalla
  // de tenant que NO vive bajo (app) —el ápex entra por la misma ruta y no
  // tiene sesión—, así que no hereda el marcador de app/(app)/layout.tsx y
  // tiene que ponerlo por su cuenta o el barrido de scripts/smoke.sh no la
  // puede distinguir de un 200 vacío. La rama del ápex sigue sin marcador, y
  // eso lo cuida caso_home_responde.
  it('con sesión, un tenant en TRIAL resuelve con su nombre y el usuario logueado', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    exigirSesion.mockResolvedValue({
      usuario: { id: 'u1', nombre: 'Ana', email: 'ana@flor.com', rol: 'EMPLEADO' },
    })
    const elemento = await render()
    const html = renderToStaticMarkup(elemento)
    expect(html).toContain('Flor')
    // Con el `>` pegado al nombre, igual que lo busca scripts/smoke.sh: el
    // atributo tiene que quedar ÚLTIMO en el JSX, porque React emite los
    // atributos en el orden en que están escritos.
    expect(html).toContain('data-testid="tenant-nombre">Flor')
    expect(html).toContain('data-testid="usuario-nombre"')
    expect(html).toContain('Hola, Ana')
    // Empleado, no dueño: sin el link a /usuarios.
    expect(html).not.toContain('/usuarios')
  })

  it('un dueño ve el link a /usuarios; un empleado no', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    exigirSesion.mockResolvedValue({
      usuario: { id: 'u1', nombre: 'Ana', email: 'ana@flor.com', rol: 'DUENO' },
    })
    const elemento = await render()
    const html = renderToStaticMarkup(elemento)
    expect(html).toContain('/usuarios')
  })

  // Mismo criterio que caso_home_responde en scripts/smoke.sh tras el fix de
  // review: el apex no sólo tiene que evitar notFound()/forbidden(), el
  // cuerpo tiene que estar libre de los testids de una página de tenant. Un
  // apex que por error resolviera a un tenant hubiera pasado la aserción
  // vieja igual.
  it('el apex no es 404 ni tenant', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    const elemento = await render()
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
    expect(exigirSesion).not.toHaveBeenCalled()
    const html = renderToStaticMarkup(elemento)
    expect(html).not.toContain('data-testid="usuario-nombre"')
  })
})
