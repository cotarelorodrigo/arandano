# Home y navegación — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `/` deje de ser una pantalla propia y mande a `/vender`, y que la navbar sea la navegación primaria —con pestaña activa— servida desde un solo lugar para todas las pantallas.

**Architecture:** `app/page.tsx` conserva la rama del ápex y, para un tenant con sesión, redirige. El shell (`app/(app)/layout.tsx`) queda como único dueño de la identidad, la navegación y el Stack/Imagen. `components/navegacion.tsx` pasa a componente de cliente para resolver la pestaña activa con `usePathname()`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, shadcn/ui, vitest, bash para el gate.

Spec: `docs/superpowers/specs/2026-08-12-home-y-navegacion-design.md`.

## Global Constraints

- **Escala de espaciado**: sólo los pasos `1, 2, 3, 4, 6, 8, 12` de Tailwind (4, 8, 12, 16, 24, 32, 48 px) en código propio. Un valor fuera de esa lista es señal de que el layout está mal.
- **Tres pesos tipográficos y no más**: 400 texto, 500 etiquetas y botones, 600 títulos.
- **Ningún token de color nuevo.** La pestaña activa usa `--primary`, que el sistema de diseño ya declara para acciones, foco y **selección**.
- **`data-testid="tenant-nombre"` tiene que ser el ÚLTIMO atributo del elemento, con el nombre como texto directo.** `scripts/smoke.sh` busca el `>` pegado al nombre; moverlo rompe todos los casos de pantalla del gate a la vez.
- **Sin JavaScript la aplicación sigue funcionando.** Los links navegan y los formularios postean igual.
- Comentarios y mensajes de commit en español, como el resto del repo.

---

### Task 1: La pestaña activa

**Files:**
- Modify: `components/navegacion.tsx` (reescritura completa, hoy 45 líneas)
- Create: `components/navegacion.test.tsx`

**Interfaces:**
- Consumes: `RolUsuario` de `@/lib/auth/sesion` (`'DUENO' | 'EMPLEADO'`), `cn` de `@/lib/utils`.
- Produces: `Navegacion({ rol }: { rol: RolUsuario })` y `estaActiva(href: string, ruta: string): boolean`. La Task 2 renderiza `<Navegacion>` dentro del shell.

**Nota sobre el spec:** el spec mandaba los dos casos de rol a `layout.test.tsx`. Van acá en cambio, que es donde vive la lógica; el layout los probaría de rebote y con peor mensaje de error.

- [ ] **Step 1: Escribir el test que falla**

Crear `components/navegacion.test.tsx`:

```tsx
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

async function estaActiva() {
  return (await import('@/components/navegacion')).estaActiva
}

describe('estaActiva', () => {
  beforeEach(() => {
    vi.resetModules()
    usePathname.mockReset()
  })

  it('la ruta exacta activa la pestaña', async () => {
    expect((await estaActiva())('/vender', '/vender')).toBe(true)
  })

  // Sin esto, entrar al detalle de una venta apagaría toda la navegación y
  // parecería un bug.
  it('una ruta de detalle activa su pestaña', async () => {
    const activa = await estaActiva()
    expect(activa('/ventas', '/ventas/abc-123')).toBe(true)
    expect(activa('/inventario', '/inventario/nuevo')).toBe(true)
  })

  // El caso que justifica la barra en el prefijo: /vender y /ventas se
  // parecen lo suficiente como para que alguien "arregle" esto algún día.
  it('/ventas NO activa Vender, ni al revés', async () => {
    const activa = await estaActiva()
    expect(activa('/vender', '/ventas')).toBe(false)
    expect(activa('/ventas', '/vender')).toBe(false)
  })

  it('un hermano con prefijo parecido no activa', async () => {
    expect((await estaActiva())('/vender', '/vender-mayorista')).toBe(false)
  })
})

describe('Navegacion', () => {
  beforeEach(() => {
    vi.resetModules()
    usePathname.mockReset()
  })

  // aria-current y no una clase de CSS: es lo que un lector de pantalla
  // anuncia, y de paso es estable frente a un cambio de estilos.
  it('marca la pestaña activa con aria-current', async () => {
    const html = await render('EMPLEADO', '/inventario/nuevo')
    expect(html).toContain('href="/inventario" aria-current="page"')
    expect(html).not.toContain('href="/vender" aria-current="page"')
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
})
```

- [ ] **Step 2: Correr el test y ver que falla**

Run: `npx vitest run components/navegacion.test.tsx`
Expected: FAIL — `estaActiva` no existe y `Navegacion` todavía no llama a `usePathname`.

- [ ] **Step 3: Reescribir el componente**

Reemplazar `components/navegacion.tsx` entero:

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { RolUsuario } from '@/lib/auth/sesion'
import { cn } from '@/lib/utils'

/**
 * Las pestañas de la aplicación, en un solo lugar.
 *
 * Es componente de CLIENTE desde el ciclo del home: la pestaña activa sale de
 * usePathname(), y un layout de servidor no puede saber en qué ruta está. No
 * cuesta nada sin JavaScript — Next renderiza los componentes de cliente en el
 * servidor para el HTML inicial, así que el subrayado sale correcto en la
 * primera carga, y cada navegación sin JS es una carga completa que vuelve a
 * salir correcta.
 *
 * Vivía acá porque tenía dos consumidores (el layout del grupo y app/page.tsx).
 * Desde que `/` redirige a /vender le quedó uno solo, y se queda igual por dos
 * motivos nuevos: es 'use client' —el layout no lo es— y es el punto de
 * extensión que CLAUDE.md promete para el registry de módulos. Cuando exista
 * Órdenes de Trabajo, sus pestañas entran por esta lista.
 */
type Pestana = { href: string; texto: string; soloDueno?: boolean }

const PESTANAS: Pestana[] = [
  { href: '/vender', texto: 'Vender' },
  { href: '/ventas', texto: 'Ventas' },
  { href: '/inventario', texto: 'Inventario' },
  { href: '/usuarios', texto: 'Usuarios', soloDueno: true },
]

/**
 * Por PREFIJO y no por igualdad: /ventas/<id> tiene que dejar Ventas
 * subrayado, o entrar al detalle de una venta apagaría toda la navegación.
 *
 * La barra del segundo caso no es cosmética: sin ella, `/vender-mayorista`
 * activaría Vender. Y es también lo que mantiene separados /vender y /ventas,
 * que se parecen lo suficiente como para tentar a alguien a comparar por los
 * primeros caracteres.
 */
export function estaActiva(href: string, ruta: string): boolean {
  return ruta === href || ruta.startsWith(`${href}/`)
}

export function Navegacion({ rol }: { rol: RolUsuario }) {
  const ruta = usePathname()

  return (
    <nav className="flex items-center gap-1 text-sm">
      {PESTANAS.filter((p) => !p.soloDueno || rol === 'DUENO').map((p) => {
        const activa = estaActiva(p.href, ruta)
        return (
          <Link
            key={p.href}
            href={p.href}
            // aria-current es lo que anuncia un lector de pantalla; el
            // subrayado solo no le dice nada a quien no ve la pantalla.
            aria-current={activa ? 'page' : undefined}
            className={cn(
              'border-b-2 px-3 py-2 font-medium transition-colors',
              activa
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {p.texto}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 4: Correr el test y ver que pasa**

Run: `npx vitest run components/navegacion.test.tsx`
Expected: PASS, 8 casos.

- [ ] **Step 5: Commitear**

```bash
git add components/navegacion.tsx components/navegacion.test.tsx
git commit -m "feat(navegacion): pestaña activa, resuelta por prefijo

Por prefijo y no por igualdad: /ventas/<id> deja Ventas subrayado, o entrar
al detalle de una venta apagaría toda la navegación y parecería un bug. La
barra del prefijo es lo que impide que /vender-mayorista active Vender y lo
que mantiene separados /vender y /ventas.

Pasa a 'use client' porque el estado activo sale de usePathname(), que un
layout de servidor no puede saber. Sin JavaScript sigue andando: Next
renderiza los componentes de cliente en el servidor para el HTML inicial."
```

---

### Task 2: El shell

**Files:**
- Create: `components/contexto.tsx`
- Modify: `app/(app)/layout.tsx` (hoy 55 líneas)
- Modify: `app/(app)/layout.test.tsx` (hoy 45 líneas)

**Interfaces:**
- Consumes: `Navegacion` y su prop `rol` (Task 1).
- Produces: el shell con `data-testid` `tenant-nombre`, `usuario-nombre`, `stack` y `sha`. La Task 3 depende de que `usuario-nombre` viva acá.

- [ ] **Step 1: Escribir los tests que fallan**

Reemplazar `app/(app)/layout.test.tsx` entero:

```tsx
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

  it('renderiza el contenido de adentro', async () => {
    const html = await render()
    expect(html).toContain('contenido')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run "app/(app)/layout.test.tsx"`
Expected: FAIL — faltan `usuario-nombre`, `stack` y `sha` en el layout.

- [ ] **Step 3: Crear el componente de contexto**

Crear `components/contexto.tsx`:

```tsx
/**
 * Qué stack y qué imagen está corriendo.
 *
 * La verificación humana más barata que existe después de un deploy: se abre
 * cualquier pantalla y se lee. El gate compara `info.sha` del healthcheck por
 * su cuenta, así que esto no lo reemplaza — lo complementa para quien está
 * mirando y no quiere abrir una consola.
 *
 * Vive en components/ porque lo usan dos pantallas que no comparten layout: el
 * shell de la aplicación y el placeholder del ápex (app/page.tsx), que no
 * puede estar bajo (app) porque no tiene sesión.
 */
export function Contexto({ className }: { className?: string }) {
  return (
    <p className={className}>
      <span data-testid="stack">{process.env.ARANDANO_STACK ?? 'desconocido'}</span>
      {' · '}
      <span data-testid="sha">{process.env.GIT_SHA ?? 'dev'}</span>
    </p>
  )
}
```

- [ ] **Step 4: Reescribir el shell**

Reemplazar `app/(app)/layout.tsx` entero:

```tsx
import { exigirSesion } from '@/lib/auth/sesion'
import { Button } from '@/components/ui/button'
import { Navegacion } from '@/components/navegacion'
import { Contexto } from '@/components/contexto'
import { salir } from './acciones'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  return (
    <div className="flex min-h-full flex-col">
      {/* Dos filas con trabajos distintos: identidad arriba —de quién es esto,
          quién sos, cómo salir—, navegación abajo. */}
      <header className="border-b">
        <div className="flex items-center justify-between px-6 py-3">
          {/* data-testid, y no una clase ni el texto suelto: es el marcador que
              scripts/smoke.sh busca en CADA pantalla autenticada para distinguir
              una página de verdad de un 200 vacío (Next devuelve 200 sirviendo un
              not-found). Borrarlo hace fallar todos los casos de pantalla del
              gate a la vez, y el atributo tiene que quedar ÚLTIMO: el grep busca
              el `>` pegado al nombre.

              Ya NO es un link. Enlazaba a la home, y por eso la navegación no
              tenía "Inicio"; con la pestaña Vender a la vista, el link
              redundante pasó a ser éste. Queda como identidad y nada más. */}
          <span className="font-medium" data-testid="tenant-nombre">
            {sesion.tenant.nombre}
          </span>
          <div className="flex items-center gap-3">
            {/* Se mudó desde app/page.tsx cuando `/` pasó a redirigir. Acá lo ve
                el barrido del gate en todas las pantallas, no en una sola. */}
            <span className="text-sm text-muted-foreground" data-testid="usuario-nombre">
              {sesion.usuario.nombre} · {sesion.usuario.rol === 'DUENO' ? 'Dueño' : 'Empleado'}
            </span>
            {/* Al lado del nombre, que es donde se lo busca. Un form y no un
                onClick: así el botón funciona igual sin JavaScript, como el
                resto de las pantallas. */}
            <form action={salir}>
              <Button type="submit" variant="ghost" size="sm">
                Salir
              </Button>
            </form>
          </div>
        </div>
        <div className="flex items-center justify-between px-6">
          <Navegacion rol={sesion.usuario.rol} />
          <Contexto className="text-xs text-muted-foreground" />
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `npx vitest run "app/(app)/layout.test.tsx"`
Expected: PASS, 5 casos.

- [ ] **Step 6: Commitear**

```bash
git add components/contexto.tsx "app/(app)/layout.tsx" "app/(app)/layout.test.tsx"
git commit -m "feat(shell): identidad, pestañas y contexto en un solo lugar

Dos filas con trabajos distintos: identidad arriba, navegación abajo. El
Stack/Imagen se va al final de la fila de pestañas, chico, y pasa a verse
desde cualquier pantalla en vez de sólo desde el home.

usuario-nombre se muda acá desde app/page.tsx. Gana cobertura al mudarse:
deja de probarse en una pantalla y pasa a probarse en todas las
autenticadas, porque el barrido del gate lo busca en cada una.

El nombre del local deja de ser un link. Enlazaba a la home, y por eso la
navegación no tenía Inicio; con la pestaña Vender a la vista, el link
redundante pasó a ser éste."
```

---

### Task 3: `/` redirige, y el gate lo sabe

**Files:**
- Modify: `app/page.tsx` (hoy 85 líneas)
- Modify: `app/page.test.tsx:105-152`
- Modify: `app/login/acciones.ts:118` (el `redirect('/')` final)
- Modify: `test/rutas-con-guard.test.ts:9-11` (sólo el texto de la razón)
- Modify: `scripts/smoke.sh` (línea 390, el registro de casos, y el comentario de `caso_login_por_la_pantalla`)

**Interfaces:**
- Consumes: `Contexto` (Task 2), y que `usuario-nombre` viva en el shell (Task 2). **Esta task no se puede hacer antes que la 2**: si `/` deja de renderizar antes de que el marcador se mude, `caso_login_por_la_pantalla` se queda sin qué grepear.
- Produces: el contrato `/` → 307 `/vender`.

- [ ] **Step 1: Escribir los tests que fallan**

En `app/page.test.tsx`, agregar `redirect` al mock de `next/navigation` (hoy sólo tiene `notFound` y `forbidden`):

```tsx
const redirect = vi.fn((destino: string) => {
  throw new Error(`NEXT_REDIRECT:${destino}`)
})
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  forbidden: () => forbidden(),
  redirect: (destino: string) => redirect(destino),
}))
```

Agregar `redirect.mockClear()` al `beforeEach`. Reemplazar los dos casos de tenant (hoy `'con sesión, un tenant en TRIAL resuelve con su nombre y el usuario logueado'` y `'un dueño ve el link a /usuarios'`) por:

```tsx
// El home dejó de ser una pantalla: es la aplicación abierta en la pestaña
// por defecto. Lo que se afirma es el DESTINO, que es el contrato entero.
it('con sesión, un tenant va a /vender', async () => {
  tenantDelRequest.mockResolvedValue({
    tipo: 'tenant',
    tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    subdominio: 'flor',
  })
  exigirSesion.mockResolvedValue({
    usuario: { id: 'u1', nombre: 'Ana', email: 'ana@flor.com', rol: 'EMPLEADO' },
  })
  await expect(render()).rejects.toThrow('NEXT_REDIRECT:/vender')
  expect(redirect).toHaveBeenCalledWith('/vender')
})

// El orden importa: un tenant suspendido tiene que ver el 403 y no ser
// mandado a /vender para que otra cosa lo rebote sin explicar por qué.
it('un tenant suspendido ve el 403, no el redirect', async () => {
  tenantDelRequest.mockResolvedValue({
    tipo: 'tenant',
    tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
    subdominio: 'flor',
  })
  await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
  expect(redirect).not.toHaveBeenCalled()
})
```

En el caso del ápex, cambiar la aserción de `usuario-nombre` (que ya no existe en ninguna rama) por la que sigue valiendo:

```tsx
it('el apex no es 404 ni tenant', async () => {
  tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
  const elemento = await render()
  expect(notFound).not.toHaveBeenCalled()
  expect(forbidden).not.toHaveBeenCalled()
  expect(exigirSesion).not.toHaveBeenCalled()
  expect(redirect).not.toHaveBeenCalled()
  const html = renderToStaticMarkup(elemento)
  expect(html).not.toContain('data-testid="tenant-nombre"')
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — `/` todavía renderiza `PaginaTenant` en vez de redirigir.

- [ ] **Step 3: Reescribir la página raíz**

Reemplazar `app/page.tsx` entero:

```tsx
import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { exigirSesion } from '@/lib/auth/sesion'
import { Contexto } from '@/components/contexto'

// Redundante con el headers() de tenantDelRequest, que ya obliga a render
// dinámico, y puesto igual: si algún día esta página deja de resolver tenant,
// la marca tiene que sobrevivir al cambio. Una página de tenant cacheada y
// servida a otro tenant es una fuga de datos entre clientes.
export const dynamic = 'force-dynamic'

const estilo = { fontFamily: 'system-ui, sans-serif', padding: '3rem' }

function PaginaApex() {
  return (
    <main style={estilo}>
      <h1>Arándano</h1>
      <p>Acá va a vivir el sitio público. Cada negocio entra por su subdominio.</p>
      <Contexto />
    </main>
  )
}

/**
 * `/` no es una pantalla: es la aplicación abierta en la pestaña por defecto.
 *
 * Para un tenant con sesión esto redirige y no renderiza nada. La pantalla que
 * se ve es /vender, y ahí el shell de app/(app)/layout.tsx pone la navegación,
 * la identidad y el contexto.
 *
 * El ápex se queda: llega por DNS y no por path, así que no hay forma de
 * sacarlo a otra ruta. Eso es lo que impide que este archivo viva bajo (app).
 */
export default async function Home() {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'apex') return <PaginaApex />

  // notFound() y forbidden() están tipadas como `never`, así que TypeScript
  // angosta `resolucion` a la variante 'tenant' de acá para abajo solo.
  if (resolucion.tipo !== 'tenant') notFound()

  // ANTES del redirect, y no es cuestión de estilo: un tenant suspendido tiene
  // que ver el 403 y no ser mandado a /vender para que ahí lo rebote otra cosa
  // sin decirle por qué.
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // El guard se llama acá a mano porque esta página no vive bajo (app) — el
  // ápex entra por la misma ruta y no tiene sesión. Está declarada en
  // test/rutas-con-guard.test.ts con esa razón escrita.
  await exigirSesion()

  redirect('/vender')
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `npx vitest run app/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Que el login entre derecho**

En `app/login/acciones.ts`, la última línea de `entrar()`:

```ts
  // redirect() tira una excepción de control de Next, así que va FUERA del
  // try: adentro, el catch la tomaría por un login fallido.
  //
  // A /vender y no a `/`: `/` sólo redirige acá, así que pasar por ahí era un
  // salto de servidor de más en cada login.
  redirect('/vender')
```

Correr `npx vitest run app/login/acciones.test.ts`.
Expected: PASS — ningún caso de ese archivo afirma el destino del redirect (todos miran el estado de error), así que este cambio no los toca.

- [ ] **Step 6: Ajustar la razón de la lista blanca**

En `test/rutas-con-guard.test.ts`, la entrada de `app/page.tsx`:

```ts
  'app/page.tsx':
    'sirve el ápex público y, para un tenant, llama a exigirSesion() por su cuenta ' +
    'antes de redirigir a /vender; no puede estar en (app) porque el ápex no tiene sesión',
```

Run: `npx vitest run test/rutas-con-guard.test.ts`
Expected: PASS.

- [ ] **Step 7: Actualizar el gate**

En `scripts/smoke.sh`:

**7a.** Línea 390, sacar `/` del barrido de 200:

```bash
# `/` NO va acá desde que redirige a /vender: el barrido abre cada ruta sin
# `-L` y exige 200. Su contrato lo fija caso_home_redirige_a_vender, que es
# una aserción más fuerte que la vieja —"algo renderizó con el nombre del
# local"— porque nombra el destino.
RUTAS_APP=()
```

**7b.** Agregar el caso nuevo, al lado de `caso_home_exige_sesion` (misma forma: ya usa `%{redirect_url}`):

```bash
# El home es la aplicación abierta en la pestaña por defecto, así que `/` con
# sesión tiene que mandar a /vender. Se afirma el DESTINO y no sólo que hubo
# un redirect: un rebote a /login también sería un redirect, y significaría
# que el guard se rompió.
caso_home_redirige_a_vender() {
  local destino
  destino=$(curl -s -o /dev/null --max-time 10 -w '%{redirect_url}' \
    -b "$COOKIE_SESION" \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/")
  [[ "$destino" == */vender ]]
}
```

**7c.** Registrarlo en la lista de casos, después de `caso_home_exige_sesion`. Como necesita sesión, va adentro del `if [[ -n "$COOKIE_SESION" ]]`, junto al barrido de pantallas:

```bash
if [[ -n "$COOKIE_SESION" ]]; then
  if caso_home_redirige_a_vender; then ok "/ manda a /vender"; else bad "/ manda a /vender"; fi
  for ruta in "${RUTAS_APP[@]}"; do
```

**No tocar** `caso_home_responde` ni `caso_home_exige_sesion`. Los dos siguen
siendo correctos y siguen pidiendo `/`: el primero comprueba que el ápex no
delate marcadores de tenant, y el segundo que un tenant **sin** sesión rebote a
`/login` — que pasa antes del redirect nuevo, porque `exigirSesion()` corre
primero. Que ahora haya dos casos afirmando redirects distintos sobre la misma
ruta es la intención, no una duplicación: uno cubre la rama con sesión y el
otro la rama sin sesión.

**7d.** Actualizar el comentario de `caso_login_por_la_pantalla`, que hoy dice "el `redirect('/')` del final":

```bash
# POR QUÉ EXISTE. caso_login_devuelve_sesion entra por
# /api/auth/sign-in/email, que es un endpoint común y corriente: nunca pasa
# por app/login/acciones.ts ni por el redirect('/vender') del final. Y ese
# redirect es lo único que ejercita el camino que Next resuelve con un
# fetch() contra sí mismo.
```

- [ ] **Step 8: Correr todo**

```bash
npm test && npx tsc --noEmit && npx eslint
```
Expected: todo verde. El barrido de rutas del gate no corre en `npm test`; se ejercita en el deploy.

- [ ] **Step 9: Commitear**

```bash
git add app/page.tsx app/page.test.tsx app/login/acciones.ts test/rutas-con-guard.test.ts scripts/smoke.sh
git commit -m "feat(home): / manda a /vender, y el login entra derecho

El home deja de ser una pantalla: es la aplicación abierta en la pestaña por
defecto. Para un tenant con sesión, / redirige; el ápex se queda porque llega
por DNS y no por path, que es lo que impide mover este archivo bajo (app).

El login pasa a redirect('/vender'): pasar por / era un salto de servidor de
más en cada entrada.

El orden de app/page.tsx no cambia — forbidden() antes del redirect. Un
tenant suspendido tiene que ver el 403 y no ser mandado a /vender para que
ahí lo rebote otra cosa sin decirle por qué. Hay un test que lo fija.

EL GATE QUEDA MÁS FUERTE. / sale del barrido de 200 —donde sólo probaba que
algo renderizó— y gana caso_home_redirige_a_vender, que nombra el destino: un
rebote a /login también sería un redirect y significaría que el guard se
rompió. Y usuario-nombre, ya mudado al shell, pasa a probarse en todas las
pantallas autenticadas en vez de en una sola."
```

---

## Verificación final

Después de la Task 3, antes de dar el ciclo por cerrado:

- [ ] `npm test` verde (455 casos hoy, más los nuevos).
- [ ] `npx tsc --noEmit` y `npx eslint` limpios.
- [ ] `npm run build` compila.
- [ ] Levantar el stack de dev y comprobar a mano, sobre un tenant real: entrar por `/login` cae en `/vender`; pedir `/` a mano rebota a `/vender`; la pestaña activa se mueve al navegar; `/ventas/<id>` deja **Ventas** subrayado.
- [ ] Lo que ningún test puede juzgar, y queda para una persona: que el subrayado del activo se distinga de un vistazo, y que se distinga también del anillo de foco al navegar con teclado.

**Deploy**: `scripts/deploy.sh --minor`. Es MINOR porque el cliente ve la navegación nueva, y modifica código en uso —el destino del login—, que según CLAUDE.md es la categoría peligrosa. Sin migraciones: el rollback sigue siendo puramente la imagen.
