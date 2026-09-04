# Instalar el local como app — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño de cada local instale su negocio como app en su celular, con el nombre y el ícono de su local, y que la app instalada muestre una pantalla propia cuando no hay internet.

**Architecture:** Cinco piezas sin migración ni server actions nuevas. Un manifest resuelto por `Host` (`app/manifest.ts`, `force-dynamic` + `notFound()` fuera de un tenant), íconos generados con `ImageResponse`, un service worker de veinte líneas que sólo cachea la pantalla sin conexión, esa pantalla pintada con estilo inline, y un botón en el pie del sidebar que dispara el prompt de Chrome o explica el camino de iOS.

**Tech Stack:** Next 16 App Router (convención `manifest.ts`, `ImageResponse` de `next/og`), vitest sin jsdom (`renderToStaticMarkup` y tests por fuente), shadcn/ui, bash para el smoke.

**Spec:** `docs/superpowers/specs/2026-09-04-pwa-instalable-design.md` — leerlo antes de la Task 1. El plan argumenta desde ahí.

## Global Constraints

- **Sin migración.** Ninguna task toca `prisma/schema.prisma`, ninguna server action, ninguna consulta.
- **Sin permisos nuevos.** `lib/permisos/catalogo.ts` no crece.
- **Los hex se copian de los tokens y quedan atados por test.** Satori y el estilo inline no resuelven `var(--token)`. `--marca` es `#2A1760`, `--marca-foreground` es `#FFFFFF`, `--background` es `#F6F5F9`, `--foreground` es `#171221`. Nunca escribir un hex sin sumarlo al test que lo compara contra `app/globals.css`.
- **Nada de tenant se cachea nunca.** El service worker cachea exactamente una URL, `/sin-conexion`, y esa pantalla no nombra a ningún local.
- **El trabajo va en un worktree**, no sobre `/root/arandano` — es lo que pide CLAUDE.md, *El ciclo de una feature*, punto 1.
- **Los tests corren con `npx vitest run <archivo>`** para un archivo suelto; el gate completo es `npm test`.
- **Los comentarios y los mensajes de commit van en español**, como todo el repo.

---

### Task 1: El manifest

**Files:**
- Create: `app/manifest.ts`
- Create: `test/manifest.test.ts`
- Modify: `scripts/tokens.mts` (sumar `hexDelToken`)
- Modify: `test/opengraph.test.ts` (consumir `hexDelToken` en vez de su copia local)

**Interfaces:**
- Consumes: `tenantDelRequest()` de `@/lib/tenant/desde-request`, que devuelve `{ tipo: 'tenant', tenant: { id, nombre, estado }, subdominio } | { tipo: 'apex' } | { tipo: 'ajeno' } | { tipo: 'reservado', subdominio } | { tipo: 'inexistente', subdominio }`.
- Produces: `hexDelToken(nombre: string): string` exportada desde `scripts/tokens.mts`, que las Tasks 2 y 3 usan. Y el manifest declara los íconos en `/icono/192` y `/icono/512`, que la Task 2 construye.

- [ ] **Step 1: Mover `hexDelToken` a `scripts/tokens.mts`**

Hoy vive como función local en `test/opengraph.test.ts`. Tres archivos de test van a necesitarla en este ciclo, y este repo ya tiene escrito lo que pasa con una regla que vive en más de un lugar. Al final de `scripts/tokens.mts`:

```ts
/**
 * Un token de la paleta, como los seis dígitos hex que necesitan Satori y
 * cualquier estilo inline.
 *
 * Vive acá y no en un test porque tiene tres consumidores —la tarjeta social,
 * los íconos de la PWA y la pantalla sin conexión—, y una copia por consumidor
 * es exactamente el defecto que estos tests existen para impedir.
 */
export function hexDelToken(nombre: string): string {
  const valor = tokensDelCss().get(nombre)
  if (!valor) throw new Error(`app/globals.css no define ${nombre}`)
  return '#' + aRgb(valor).map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

- [ ] **Step 2: Que `test/opengraph.test.ts` la importe**

Borrar la función local y su import de `aRgb`, dejando:

```ts
import { hexDelToken } from '@/scripts/tokens.mts'
```

- [ ] **Step 3: Correr el test que ya existía, para probar que el movimiento no cambió nada**

Run: `npx vitest run test/opengraph.test.ts`
Expected: PASS, los dos casos de siempre.

- [ ] **Step 4: Escribir el test del manifest, que todavía falla**

Crear `test/manifest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hexDelToken } from '@/scripts/tokens.mts'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

// notFound() tira una excepción de control que en producción atrapa Next. Acá
// no hay framework que la atrape, así que se la mockea con una excepción
// reconocible: es la única forma de afirmar que el manifest CORTA, que es la
// mitad del comportamiento que este archivo tiene que fijar.
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
}))

async function manifestPara(resolucion: unknown) {
  tenantDelRequest.mockResolvedValue(resolucion)
  const { default: manifest } = await import('@/app/manifest')
  return manifest()
}

describe('el manifest es del local, no del producto', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
  })

  it('un tenant se instala con el nombre de su local', async () => {
    const m = await manifestPara({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Flor Celulares', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(m.name).toBe('Flor Celulares')
    expect(m.short_name).toBe('Flor Celulares')
  })

  // start_url es '/' y no '/vender' ni '/dashboard' a propósito: app/page.tsx
  // ya redirige por rol con destinoAlEntrar(). Un literal acá sería un CUARTO
  // lugar que puede discrepar de los otros tres, que es justo lo que el
  // docblock de esa función existe para impedir.
  it('abre en / y deja que el destino lo decida el rol', async () => {
    const m = await manifestPara({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(m.start_url).toBe('/')
    expect(m.scope).toBe('/')
    expect(m.display).toBe('standalone')
  })

  it('los colores son los tokens reales y no un hex suelto', async () => {
    const m = await manifestPara({
      tipo: 'tenant',
      tenant: { id: 't1', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    })
    expect(m.theme_color).toBe(hexDelToken('--marca'))
    expect(m.background_color).toBe(hexDelToken('--background'))
  })

  // La otra mitad, y la que pasa desapercibida: un manifest que devuelve 200
  // siempre parece que anda. Las cuatro ramas que no son tenant tienen que
  // cortar — si no, la página de ventas del producto queda instalable como si
  // fuera el producto.
  it.each([
    ['el ápex', { tipo: 'apex' }],
    ['un subdominio reservado', { tipo: 'reservado', subdominio: 'admin' }],
    ['un subdominio inexistente', { tipo: 'inexistente', subdominio: 'nada' }],
    ['un host ajeno', { tipo: 'ajeno' }],
  ])('%s no tiene manifest', async (_nombre, resolucion) => {
    await expect(manifestPara(resolucion)).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
```

- [ ] **Step 5: Correr el test y verificar que falla**

Run: `npx vitest run test/manifest.test.ts`
Expected: FAIL — no existe `@/app/manifest`.

- [ ] **Step 6: Escribir el manifest**

Crear `app/manifest.ts`:

```ts
import type { MetadataRoute } from 'next'
import { notFound } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'

/**
 * El manifest es del LOCAL, no del producto.
 *
 * Cada tenant es su propio origen (`flor.arandano.app`), así que el navegador
 * trata cada local como una aplicación distinta: cada dueño instala su negocio
 * con su nombre y su ícono, y el aislamiento lo da la misma frontera de origen
 * que ya usa Better Auth.
 *
 * `force-dynamic` porque el contenido depende del Host, igual que toda página
 * de tenant: un manifest cacheado y servido a otro local diría el nombre
 * equivocado.
 */
export const dynamic = 'force-dynamic'

// Copiados a mano de app/globals.css: un manifest es JSON y no resuelve
// var(--token). test/manifest.test.ts los compara contra los tokens reales,
// así que un repintado de la paleta que se olvide de acá rompe el build.
const MARCA = '#2A1760'
const FONDO = '#F6F5F9'

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const resolucion = await tenantDelRequest()

  // El ápex, los reservados, los inexistentes y los ajenos no tienen manifest:
  // la landing se comparte por link, no se instala.
  if (resolucion.tipo !== 'tenant') notFound()

  const nombre = resolucion.tenant.nombre

  return {
    name: nombre,
    short_name: nombre,
    // '/' y no el destino de cada rol: app/page.tsx ya redirige con
    // destinoAlEntrar(). Ver el caso del test que lo explica.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: MARCA,
    background_color: FONDO,
    icons: [
      { src: '/icono/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icono/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icono/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

Run: `npx vitest run test/manifest.test.ts test/opengraph.test.ts`
Expected: PASS, todos.

- [ ] **Step 8: Commit**

```bash
git add app/manifest.ts test/manifest.test.ts scripts/tokens.mts test/opengraph.test.ts
git commit -m "feat(pwa): el manifest es del local y no del producto"
```

---

### Task 2: Los íconos

**Files:**
- Create: `lib/marca/inicial.ts`
- Create: `lib/marca/inicial.test.ts`
- Create: `app/icono/[tamano]/route.tsx`
- Create: `test/icono.test.ts`

**Interfaces:**
- Consumes: `hexDelToken` de `@/scripts/tokens.mts` (Task 1); el manifest de la Task 1, para verificar que los tamaños coinciden.
- Produces: `inicialDe(nombre: string): string`; `TAMANOS: readonly [192, 512]` exportada desde `app/icono/[tamano]/route.tsx`.

- [ ] **Step 1: Escribir el test de la inicial**

Crear `lib/marca/inicial.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { inicialDe } from './inicial'

describe('la inicial del local', () => {
  it('es la primera letra, en mayúscula', () => {
    expect(inicialDe('Flor Celulares')).toBe('F')
  })

  it('ignora los espacios de los costados', () => {
    expect(inicialDe('  flor  ')).toBe('F')
  })

  // charAt(0) parte un carácter fuera del plano básico por la mitad y devuelve
  // media unidad de código, que el navegador dibuja como un rombo con un signo
  // de pregunta. Un nombre de local con emoji no es raro.
  it('no parte al medio un carácter fuera del plano básico', () => {
    expect(inicialDe('🍎 Manzana')).toBe('🍎')
  })

  it('con un nombre vacío cae a la marca', () => {
    expect(inicialDe('   ')).toBe('A')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/marca/inicial.test.ts`
Expected: FAIL — no existe `./inicial`.

- [ ] **Step 3: Escribir la función**

Crear `lib/marca/inicial.ts`:

```ts
/**
 * La primera letra del nombre de un local, para el ícono y el avatar.
 *
 * Con spread y no con charAt(0): charAt parte al medio un carácter fuera del
 * plano básico —un emoji, por ejemplo— y devuelve media unidad de código.
 */
export function inicialDe(nombre: string): string {
  const limpio = nombre.trim()
  // 'A' de Arándano: un local sin nombre no existe hoy, pero un ícono vacío
  // sería un cuadrado violeta sin nada adentro, y eso es peor que una letra
  // que no es la suya.
  return [...limpio][0]?.toUpperCase() ?? 'A'
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/marca/inicial.test.ts`
Expected: PASS, los cuatro casos.

- [ ] **Step 5: Escribir el test del ícono**

Crear `test/icono.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { hexDelToken } from '@/scripts/tokens.mts'
import { TAMANOS } from '@/app/icono/[tamano]/route'

const ICONO = 'app/icono/[tamano]/route.tsx'

describe('el ícono del local', () => {
  const fuente = readFileSync(ICONO, 'utf8')

  // Mismo mecanismo que test/opengraph.test.ts: Satori no resuelve
  // var(--marca), así que el hex está duplicado y esto es lo único que impide
  // que un repintado de la paleta deje el ícono con el arándano viejo.
  it('el fondo es exactamente --marca', () => {
    expect(fuente).toContain(`backgroundColor: '${hexDelToken('--marca')}'`)
  })

  it('la letra es exactamente --marca-foreground', () => {
    expect(fuente).toContain(`color: '${hexDelToken('--marca-foreground')}'`)
  })

  // Un endpoint que genera una imagen del tamaño que le pidan es trabajo de
  // CPU gratis para cualquiera que lo descubra, sobre una caja de 2 vCPU
  // compartida con producción. Lista blanca, no rango.
  it('sólo genera los dos tamaños que declara el manifest', () => {
    expect([...TAMANOS]).toEqual([192, 512])
  })
})

// Los dos archivos tienen que decir lo mismo en las DOS direcciones: un tamaño
// declarado en el manifest que el endpoint no genere sirve un ícono roto, y
// uno que el endpoint genere y el manifest no declare es código muerto.
describe('el manifest y el endpoint declaran los mismos tamaños', () => {
  it('coinciden', async () => {
    const manifiesto = readFileSync('app/manifest.ts', 'utf8')
    for (const lado of TAMANOS) {
      expect(manifiesto).toContain(`/icono/${lado}`)
      expect(manifiesto).toContain(`${lado}x${lado}`)
    }
    const declarados = [...manifiesto.matchAll(/\/icono\/(\d+)/g)].map((m) => Number(m[1]))
    expect([...new Set(declarados)].sort((a, b) => a - b)).toEqual([...TAMANOS])
  })
})
```

- [ ] **Step 6: Correr y verificar que falla**

Run: `npx vitest run test/icono.test.ts`
Expected: FAIL — no existe `app/icono/[tamano]/route.tsx`.

- [ ] **Step 7: Escribir el endpoint**

Crear `app/icono/[tamano]/route.tsx`:

```tsx
import { ImageResponse } from 'next/og'
import { notFound } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { inicialDe } from '@/lib/marca/inicial'

/**
 * El ícono que el dueño ve en la pantalla de inicio de su celular: la inicial
 * de su local sobre el arándano.
 *
 * Generado y no un PNG en public/, por la misma razón que
 * app/opengraph-image.tsx: un binario a mano se desincroniza del color de
 * marca sin que nadie se entere.
 */
export const dynamic = 'force-dynamic'

/**
 * Los dos tamaños que declara app/manifest.ts, y ninguno más.
 *
 * Lista blanca y no un rango: generar una imagen del tamaño que pidan es
 * trabajo de CPU gratis para cualquiera que lo descubra, sobre una caja donde
 * dev, stage y producción comparten dos cores.
 */
export const TAMANOS = [192, 512] as const

// Copiados a mano de app/globals.css: Satori no resuelve var(--marca).
// test/icono.test.ts los compara contra los tokens reales.
const MARCA = '#2A1760'
const MARCA_FOREGROUND = '#FFFFFF'

export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ tamano: string }> },
) {
  const { tamano } = await params
  const lado = Number(tamano)
  if (!TAMANOS.includes(lado as (typeof TAMANOS)[number])) notFound()

  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') notFound()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: MARCA,
          color: MARCA_FOREGROUND,
          // La mitad del lado deja la altura de mayúscula en ~35 % del ícono,
          // bien adentro del círculo del 80 % con el que Android recorta la
          // variante maskable. Por eso la misma imagen sirve para las dos.
          fontSize: lado * 0.5,
        }}
      >
        {inicialDe(resolucion.tenant.nombre)}
      </div>
    ),
    { width: lado, height: lado },
  )
}
```

- [ ] **Step 8: Correr y verificar que pasa**

Run: `npx vitest run test/icono.test.ts lib/marca/inicial.test.ts`
Expected: PASS, todos.

- [ ] **Step 9: Mirarlo servido de verdad, que es lo único que prueba que Satori dibuja algo**

Un test por fuente no puede afirmar que la imagen se genere. Con el worktree servido (o desde `arandano-dev` una vez mergeado):

```bash
curl -s -o /tmp/i192.png -w 'HTTP %{http_code} %{content_type} %{size_download}b\n' \
  -H "Host: canario.dev.arandano.app" http://100.64.81.63:3000/icono/192
curl -s -o /dev/null -w 'tamaño no declarado: HTTP %{http_code}\n' \
  -H "Host: canario.dev.arandano.app" http://100.64.81.63:3000/icono/300
```

Expected: `HTTP 200 image/png` con unos pocos KB para el primero, `HTTP 404` para el segundo. Abrir el PNG y ver la "C" blanca sobre violeta.

- [ ] **Step 10: Commit**

```bash
git add lib/marca app/icono test/icono.test.ts
git commit -m "feat(pwa): el ícono del local es su inicial sobre el arándano"
```

---

### Task 3: La pantalla sin conexión

**Files:**
- Create: `app/sin-conexion/page.tsx`
- Create: `app/sin-conexion/page.test.tsx`
- Modify: `test/rutas-con-guard.test.ts` (sumar la entrada a `FUERA_DEL_GRUPO`)
- Modify: `docs/pantallas.md` (sumar la sección, entre los marcadores)

**Interfaces:**
- Consumes: `hexDelToken` de `@/scripts/tokens.mts` (Task 1).
- Produces: la ruta `/sin-conexion`, que la Task 4 cachea desde el service worker.

- [ ] **Step 1: Escribir el test, que todavía falla**

Crear `app/sin-conexion/page.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { hexDelToken } from '@/scripts/tokens.mts'
import SinConexion from './page'

const FUENTE = 'app/sin-conexion/page.tsx'

describe('la pantalla sin conexión', () => {
  const fuente = readFileSync(FUENTE, 'utf8')

  // Es la propiedad de la que depende que el service worker no cachee datos de
  // ningún local. Si esta página resolviera tenant sería dinámica, y lo que
  // quedaría guardado en el celular sería el nombre de un negocio.
  it('no resuelve tenant ni lee headers ni abre sesión', () => {
    expect(fuente).not.toContain('tenantDelRequest')
    expect(fuente).not.toContain('next/headers')
    expect(fuente).not.toContain('exigirSesion')
  })

  // El SW cachea el HTML, no las hojas de estilo, que llevan hash en el nombre
  // y cambian en cada build. Sin conexión, una clase de Tailwind acá se vería
  // como HTML pelado — y nadie lo descubriría en dev, donde la red anda.
  it('se pinta sola, sin depender de ninguna clase', () => {
    expect(fuente).not.toContain('className')
  })

  it('sus colores son los tokens reales', () => {
    expect(fuente).toContain(hexDelToken('--background'))
    expect(fuente).toContain(hexDelToken('--foreground'))
  })

  it('dice qué pasó y no menciona ningún local', () => {
    const html = renderToStaticMarkup(<SinConexion />)
    expect(html).toContain('Sin conexión')
    expect(html).toContain('Arándano')
    expect(html).toContain('style=')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run app/sin-conexion/page.test.tsx`
Expected: FAIL — no existe `./page`.

- [ ] **Step 3: Escribir la pantalla**

Crear `app/sin-conexion/page.tsx`:

```tsx
import type { Metadata } from 'next'

/**
 * Lo que ve el dueño cuando abre la app instalada sin internet.
 *
 * Instalada, la ventana no tiene barra de direcciones, así que el error del
 * navegador se lee como que la aplicación se rompió. Esto es un cartel, no una
 * capacidad: el producto sigue sin funcionar sin conexión.
 *
 * ESTÁTICA A PROPÓSITO, y es load-bearing: el service worker la cachea, así
 * que si resolviera tenant lo que quedaría guardado en el celular sería el
 * nombre de un local. No lee headers, no abre sesión y no nombra al negocio.
 *
 * Y SE PINTA SOLA. El service worker cachea este HTML, no las hojas de estilo
 * —que llevan hash en el nombre y cambian en cada build, así que no hay lista
 * de assets que siga siendo válida después del deploy siguiente—. Con clases
 * de Tailwind, servida desde la caché se vería como HTML pelado. Los hex están
 * copiados de app/globals.css y atados por page.test.tsx.
 */
export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Sin conexión — Arándano',
  robots: { index: false, follow: false },
}

export default function SinConexion() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        backgroundColor: '#F6F5F9',
        color: '#171221',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: '#2A1760',
        }}
      >
        Arándano
      </div>
      <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0 }}>Sin conexión</h1>
      <p style={{ fontSize: 14, margin: 0, color: '#4A4358', maxWidth: 320 }}>
        No hay internet en este momento. Volvé a intentar cuando se recupere la
        conexión.
      </p>
    </main>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run app/sin-conexion/page.test.tsx`
Expected: PASS, los cinco casos.

- [ ] **Step 5: Correr los dos tests que la ruta nueva rompe**

Run: `npx vitest run test/rutas-con-guard.test.ts test/pantallas.test.ts`
Expected: FAIL los dos. El primero porque `/sin-conexion` no está bajo `(app)` ni declarada; el segundo porque no tiene sección en `docs/pantallas.md`. Los dos rojos son correctos — son las redes haciendo su trabajo.

- [ ] **Step 6: Declarar por qué no lleva guard**

En `test/rutas-con-guard.test.ts`, sumar a `FUERA_DEL_GRUPO`:

```ts
  'app/sin-conexion/page.tsx':
    'la cachea el service worker y se sirve a alguien SIN conexión: exigir sesión ' +
    'sería exigir un viaje a la base justo cuando no hay red. No muestra ningún ' +
    'dato: es un cartel estático que no nombra al local',
```

- [ ] **Step 7: Documentar la pantalla**

En `docs/pantallas.md`, dentro de los marcadores `<!-- pantallas:inicio -->` / `<!-- pantallas:fin -->`, después de la sección `` ## `/login` ``:

```markdown
## `/sin-conexion`

El cartel que ve el dueño cuando abre la app instalada y no hay internet. No es
una pantalla que alguien navegue: la sirve el service worker desde su caché
cuando falla una navegación.

**Acciones**: ninguna.

**Qué se puede hacer**

- Leer que no hay conexión. Nada más — el producto no funciona sin internet, y
  esto es un cartel, no una capacidad.

**Decisiones**

- **No lleva guard de sesión**, y está declarada con esa razón en
  `test/rutas-con-guard.test.ts`. Se sirve a alguien sin red: validar una sesión
  ahí es imposible por definición. No muestra ningún dato que proteger.

- **No nombra al local, y eso es load-bearing.** El service worker la cachea; si
  resolviera tenant, lo que quedaría guardado en el celular sería el nombre de
  un negocio. El costo es que dice "Arándano" y no el nombre del local.

- **Se pinta con estilo inline y no con clases.** El service worker cachea este
  HTML, no las hojas de estilo, que llevan hash en el nombre y cambian en cada
  build. Con clases de Tailwind, servida desde la caché se vería como HTML
  pelado — y no se descubriría en dev, donde la red anda. Los hex están copiados
  de `app/globals.css` y atados por `app/sin-conexion/page.test.tsx`.
```

- [ ] **Step 8: Correr los dos tests otra vez**

Run: `npx vitest run test/rutas-con-guard.test.ts test/pantallas.test.ts`
Expected: PASS los dos.

- [ ] **Step 9: Commit**

```bash
git add app/sin-conexion docs/pantallas.md test/rutas-con-guard.test.ts
git commit -m "feat(pwa): la pantalla sin conexión, que se pinta sola"
```

---

### Task 4: El service worker y su registro

**Files:**
- Create: `public/sw.js`
- Create: `test/service-worker.test.ts`
- Create: `components/service-worker.tsx`
- Modify: `app/(app)/layout.tsx` (montar el registro)
- Modify: `docs/runbook-stacks.md` (el deploy de desactivación)

**Interfaces:**
- Consumes: la ruta `/sin-conexion` de la Task 3.
- Produces: `<RegistrarServiceWorker />` exportado desde `components/service-worker.tsx`; el registro en `/sw.js`, del que depende que la Task 5 reciba `beforeinstallprompt`.

- [ ] **Step 1: Escribir el test por fuente, que todavía falla**

No hay forma de ejecutar un service worker en vitest —no existe `ServiceWorkerGlobalScope`—, así que se verifica por fuente. Es el mismo mecanismo que `test/permisos-en-las-dos-copias.test.ts`, que cubre por fuente lo que no se puede renderizar.

Crear `test/service-worker.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SW = 'public/sw.js'

/** Las rutas de la aplicación, derivadas del sistema de archivos. */
function rutasDeLaApp(dir = 'app/(app)', acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) rutasDeLaApp(completo, acumulado)
    else if (/^page\.(tsx|ts|jsx|js)$/.test(entrada)) {
      const partes = path
        .dirname(completo)
        .split(path.sep)
        .slice(1)
        .filter((p) => !(p.startsWith('(') && p.endsWith(')')))
      acumulado.push('/' + partes.join('/'))
    }
  }
  return acumulado
}

describe('el service worker no puede guardar datos de ningún local', () => {
  const fuente = readFileSync(SW, 'utf8')

  // La propiedad central del diseño. Un SW sobrevive al rollback de la imagen,
  // así que lo que cachee mal se queda en el celular del dueño después de que
  // el healthcheck ya revirtió todo lo demás.
  it('la única URL que cachea es la pantalla sin conexión', () => {
    const agregadas = [...fuente.matchAll(/cache\.add(?:All)?\(([^)]*)\)/g)]
    expect(agregadas).toHaveLength(1)
    expect(agregadas[0][1]).toContain('SIN_CONEXION')
    expect(fuente).toContain("const SIN_CONEXION = '/sin-conexion'")
  })

  it('no nombra ninguna pantalla de la aplicación', () => {
    for (const ruta of rutasDeLaApp()) {
      expect(fuente, `${SW} no puede nombrar ${ruta}`).not.toContain(ruta)
    }
  })

  it('no toca la API', () => {
    expect(fuente).not.toContain('/api')
  })

  // Un formulario enviado sin JavaScript es una navegación POST. Devolverle una
  // página cacheada de GET es responder algo que no se pidió.
  it('sólo interviene en navegaciones GET', () => {
    expect(fuente).toContain("pedido.method !== 'GET'")
    expect(fuente).toContain("pedido.mode !== 'navigate'")
  })

  it('borra las cachés de las versiones anteriores', () => {
    expect(fuente).toContain('caches.delete')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run test/service-worker.test.ts`
Expected: FAIL — no existe `public/sw.js`.

- [ ] **Step 3: Escribir el service worker**

Crear `public/sw.js`:

```js
/**
 * El service worker de Arándano. Hace dos cosas y ninguna más.
 *
 * 1. Existe. Chrome ya no exige un service worker para instalar desde el menú
 *    (v108 en Android, v112 en escritorio), pero sí para disparar
 *    `beforeinstallprompt`, que es el evento del que depende el botón
 *    "Instalar" del pie del sidebar. O sea que esto no compra instalabilidad
 *    —eso lo da el manifest— sino descubribilidad.
 * 2. Sirve /sin-conexion cuando falla una navegación.
 *
 * NO CACHEA NADA DE NINGÚN LOCAL, y eso no es prolijidad. Todo lo demás de
 * este repo se revierte revirtiendo la imagen; un service worker no: queda
 * instalado en el navegador del dueño y sobrevive al rollback automático del
 * healthcheck, que es la única red que este proyecto tiene por decisión
 * escrita. Por eso es tan chico que se lee entero de una sentada.
 *
 * PARA DESACTIVARLO no hay rollback: hay un deploy de desactivación, escrito
 * en la sección "Deploy y rollback" de docs/runbook-stacks.md.
 *
 * Ver docs/superpowers/specs/2026-09-04-pwa-instalable-design.md.
 */

// Se sube a mano cuando cambia este archivo: activate borra toda caché que no
// coincida, así que una versión nueva limpia la anterior sola.
const VERSION = 'v1'
const CACHE = `arandano-${VERSION}`
const SIN_CONEXION = '/sin-conexion'

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(SIN_CONEXION))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(nombres.filter((n) => n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const pedido = evento.request

  // Sin respondWith, el navegador hace lo de siempre: la API, los server
  // actions, las imágenes y la fuente pasan sin que este archivo los toque.
  // El filtro por GET no es de más — un formulario enviado sin JavaScript es
  // una navegación POST, y contestarle una página cacheada de GET es responder
  // algo que no se pidió.
  if (pedido.method !== 'GET' || pedido.mode !== 'navigate') return

  evento.respondWith(
    fetch(pedido).catch(() =>
      caches.match(SIN_CONEXION).then((respuesta) => respuesta ?? Response.error()),
    ),
  )
})
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run test/service-worker.test.ts`
Expected: PASS, los cinco casos.

- [ ] **Step 5: Comprobar que el lint no se pelea con el ámbito de service worker**

`public/` no lo cubre `eslint.config.mjs`, pero conviene confirmarlo antes de llegar al gate — `self`, `caches` y `clients` no existen en el ámbito de navegador ni en el de Node.

Run: `npm run lint`
Expected: PASS. Si `public/sw.js` apareciera con errores de globals, ignorar `public/**` en `eslint.config.mjs` con el mismo razonamiento y al lado de la línea de `.agents/skills`.

- [ ] **Step 6: Escribir el componente que lo registra**

Crear `components/service-worker.tsx`:

```tsx
'use client'

import { useEffect } from 'react'

/**
 * Registra el service worker. No dibuja nada.
 *
 * Va montado en app/(app)/layout.tsx y no en el layout raíz a propósito: ese
 * layout también sirve el ápex, y la landing no es una aplicación instalable
 * —app/manifest.ts le devuelve 404 al ápex por la misma razón—.
 *
 * El error se traga: un registro que falla no puede romper la pantalla de
 * cobro. Lo que se pierde si falla es el botón "Instalar" y la pantalla sin
 * conexión, no la capacidad de vender.
 */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return null
}
```

- [ ] **Step 7: Montarlo**

En `app/(app)/layout.tsx`, sumar el import y montarlo dentro del `<SidebarProvider>`, después del `<SidebarInset>`:

```tsx
import { RegistrarServiceWorker } from '@/components/service-worker'
```

```tsx
      <SidebarInset>{children}</SidebarInset>
      {/* No dibuja nada: registra el service worker. Acá y no en el layout
          raíz, que también sirve el ápex — la landing no es una aplicación
          instalable, y app/manifest.ts le devuelve 404 por lo mismo. */}
      <RegistrarServiceWorker />
    </SidebarProvider>
```

Un solo lugar: es un componente que no dibuja nada, así que no tiene copia de escritorio ni de teléfono.

- [ ] **Step 8: Escribir el deploy de desactivación en el runbook**

En `docs/runbook-stacks.md`, en la sección *Deploy y rollback*:

~~~markdown
### Desactivar el service worker

El rollback automático revierte la imagen. **No desinstala el service worker**:
ése ya está en el navegador del dueño y sobrevive a la vuelta atrás. Si hubiera
que sacarlo, no hay rollback — hay un deploy hacia adelante, que pasa el mismo
gate que cualquier otro.

Reemplazar el cuerpo de `public/sw.js` por:

```js
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((nombres) => Promise.all(nombres.map((n) => caches.delete(n))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim()),
  )
})
```

Cada navegador lo levanta en su visita siguiente, borra sus cachés y se da de
baja solo. Está escrito de antemano a propósito: el momento de escribirlo no es
cuando hace falta.
~~~

- [ ] **Step 9: Correr el gate de tests completo, que es la primera vez que vale la pena en este ciclo**

Run: `npm test`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add public/sw.js test/service-worker.test.ts components/service-worker.tsx "app/(app)/layout.tsx" docs/runbook-stacks.md
git commit -m "feat(pwa): un service worker que sólo sabe servir la pantalla sin conexión"
```

---

### Task 5: El botón "Instalar"

**Files:**
- Create: `lib/pwa/instalacion.ts`
- Create: `lib/pwa/instalacion.test.ts`
- Create: `components/shell/instalar.tsx`
- Create: `components/shell/instalar.test.tsx`
- Modify: `components/shell/sidebar-arandano.tsx` (montarlo en el `SidebarFooter`)

**Interfaces:**
- Consumes: el registro del service worker de la Task 4, sin el cual Chrome no dispara `beforeinstallprompt`.
- Produces: `estadoDeInstalacion(entrada): 'oculto' | 'prompt' | 'instrucciones'` y `esIOS(userAgent, puntosDeContacto)`; `<Instalar />` en el pie del sidebar.

- [ ] **Step 1: Escribir el test de la lógica pura**

La decisión de qué mostrar se saca del componente a una función, porque este repo no tiene jsdom y un componente cliente con efectos no se puede renderizar en los tests. Es la misma jugada que ya separó `pagosDelPeriodo` y `datosDelDetalle` de sus Server Components.

Crear `lib/pwa/instalacion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estadoDeInstalacion, esIOS } from './instalacion'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0.0.0'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0.0.0'

describe('detectar iOS', () => {
  it('un iPhone es iOS', () => {
    expect(esIOS(IPHONE, 5)).toBe(true)
  })

  // Desde iPadOS 13 un iPad se anuncia como Macintosh. Sin este caso, el único
  // dispositivo donde la instalación es 100 % manual se quedaría sin
  // instrucciones — que es exactamente el defecto que la regla del ciclo móvil
  // prohíbe: una capacidad que desaparece y no reaparece en ningún lado.
  it('un iPad moderno miente y dice Macintosh, pero tiene pantalla táctil', () => {
    expect(esIOS(IPAD, 5)).toBe(true)
  })

  it('una Mac de escritorio no es iOS', () => {
    expect(esIOS(MAC, 0)).toBe(false)
  })

  it('un Android no es iOS', () => {
    expect(esIOS(ANDROID, 5)).toBe(false)
  })
})

describe('qué muestra el botón', () => {
  it('ya instalada: nada', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: true,
        promptDisponible: true,
        userAgent: ANDROID,
        puntosDeContacto: 5,
      }),
    ).toBe('oculto')
  })

  it('Chrome ofreció el prompt: se dispara', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: false,
        promptDisponible: true,
        userAgent: ANDROID,
        puntosDeContacto: 5,
      }),
    ).toBe('prompt')
  })

  it('iPhone: se explica el camino a mano', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: false,
        promptDisponible: false,
        userAgent: IPHONE,
        puntosDeContacto: 5,
      }),
    ).toBe('instrucciones')
  })

  // Firefox de escritorio, por ejemplo. Inventar instrucciones por navegador
  // sin poder verificarlas es peor que el silencio.
  it('un navegador sin ninguno de los dos caminos: nada', () => {
    expect(
      estadoDeInstalacion({
        yaInstalada: false,
        promptDisponible: false,
        userAgent: MAC,
        puntosDeContacto: 0,
      }),
    ).toBe('oculto')
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run lib/pwa/instalacion.test.ts`
Expected: FAIL — no existe `./instalacion`.

- [ ] **Step 3: Escribir la lógica**

Crear `lib/pwa/instalacion.ts`:

```ts
export type EstadoDeInstalacion = 'oculto' | 'prompt' | 'instrucciones'

/**
 * Si el dispositivo es iOS, donde no existe ningún prompt de instalación.
 *
 * Los puntos de contacto no son de más: desde iPadOS 13 un iPad se anuncia
 * como Macintosh, así que el user agent solo no alcanza para distinguirlo de
 * una Mac de escritorio. Es el único dispositivo donde instalar es siempre a
 * mano, así que confundirlo lo deja sin instrucciones.
 */
export function esIOS(userAgent: string, puntosDeContacto: number): boolean {
  if (/iPad|iPhone|iPod/.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && puntosDeContacto > 1
}

/**
 * Qué muestra el botón del pie del sidebar.
 *
 * Vive fuera del componente porque este repo no tiene jsdom: sacada la
 * decisión, los cuatro caminos se prueban sin DOM. Es la misma jugada que ya
 * separó pagosDelPeriodo y datosDelDetalle de sus Server Components.
 */
export function estadoDeInstalacion(entrada: {
  yaInstalada: boolean
  promptDisponible: boolean
  userAgent: string
  puntosDeContacto: number
}): EstadoDeInstalacion {
  // Un botón para instalar lo que ya está instalado es ruido permanente.
  if (entrada.yaInstalada) return 'oculto'
  if (entrada.promptDisponible) return 'prompt'
  if (esIOS(entrada.userAgent, entrada.puntosDeContacto)) return 'instrucciones'
  return 'oculto'
}
```

- [ ] **Step 4: Correr y verificar que pasa**

Run: `npx vitest run lib/pwa/instalacion.test.ts`
Expected: PASS, los ocho casos.

- [ ] **Step 5: Escribir el componente**

Crear `components/shell/instalar.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import { Download, Share } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { estadoDeInstalacion, type EstadoDeInstalacion } from '@/lib/pwa/instalacion'

/**
 * El evento que Chrome dispara cuando la aplicación se puede instalar. No está
 * en lib.dom.d.ts —no es estándar todavía—, así que se declara lo poco que se
 * usa de él en vez de castear a `any`.
 */
type EventoDeInstalacion = Event & { prompt: () => Promise<void> }

export function Instalar() {
  const [evento, setEvento] = useState<EventoDeInstalacion | null>(null)
  // Arranca en 'oculto' y se calcula recién en el efecto: en el servidor no
  // hay navigator, y renderizar el botón en el HTML para esconderlo al hidratar
  // produciría un parpadeo en cada carga de cada pantalla.
  const [estado, setEstado] = useState<EstadoDeInstalacion>('oculto')

  useEffect(() => {
    function alPoderInstalar(e: Event) {
      // Sin esto Chrome muestra su propia barra abajo de todo, compitiendo con
      // el botón del sidebar por la misma decisión.
      e.preventDefault()
      setEvento(e as EventoDeInstalacion)
    }

    window.addEventListener('beforeinstallprompt', alPoderInstalar)
    return () => window.removeEventListener('beforeinstallprompt', alPoderInstalar)
  }, [])

  useEffect(() => {
    // Safari no soporta la media query y usa esta propiedad suya, que tampoco
    // está tipada: es el único indicador que tiene un iPhone de que la
    // aplicación ya está en la pantalla de inicio.
    const enSafari = (navigator as Navigator & { standalone?: boolean }).standalone === true

    setEstado(
      estadoDeInstalacion({
        yaInstalada: window.matchMedia('(display-mode: standalone)').matches || enSafari,
        promptDisponible: evento !== null,
        userAgent: navigator.userAgent,
        puntosDeContacto: navigator.maxTouchPoints,
      }),
    )
  }, [evento])

  if (estado === 'oculto') return null

  // La misma geometría que el botón de Salir, unas líneas más arriba en el pie:
  // size-auto saca el tamaño fijo de size="icon" y deja que el padding arme la
  // caja, y rounded-md es el token que coincide con el cornerRadius 8 del frame.
  const clases = 'size-auto justify-start rounded-md px-2 py-1.5 text-[13px]'

  if (estado === 'prompt') {
    return (
      <Button
        type="button"
        variant="ghost"
        className={clases}
        onClick={async () => {
          if (!evento) return
          await evento.prompt()
          // Un evento de instalación se consume una sola vez: guardado, el
          // segundo click no abriría nada y el botón parecería roto.
          setEvento(null)
        }}
      >
        <Download aria-hidden="true" />
        Instalar app
      </Button>
    )
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" className={clases}>
          <Download aria-hidden="true" />
          Instalar app
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Instalar en tu iPhone</DialogTitle>
          <DialogDescription>
            Safari no puede instalarla solo, así que son tres pasos a mano. Una vez
            hecho, el local te queda como una app más.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex flex-col gap-3 text-[13px]">
          <li className="flex items-center gap-2">
            <Share aria-hidden="true" className="size-4 shrink-0" />
            Tocá Compartir, abajo de la pantalla.
          </li>
          <li>Elegí &quot;Agregar a inicio&quot;.</li>
          <li>Confirmá con Agregar, arriba a la derecha.</li>
        </ol>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Montarlo en el pie del sidebar**

En `components/shell/sidebar-arandano.tsx`, dentro del `<SidebarFooter>`, entre el `<div>` de la identidad y el `<Contexto />`. **Una sola copia**: `components/ui/sidebar.tsx` renderiza el mismo `{children}` en el `Sheet` del teléfono y en el riel de escritorio, así que la regla de las dos copias no aplica acá — y conviene que el caso del paso siguiente lo deje escrito.

- [ ] **Step 7: Escribir el test del montaje**

Crear `components/shell/instalar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SIDEBAR = 'components/shell/sidebar-arandano.tsx'
const INSTALAR = 'components/shell/instalar.tsx'

describe('el botón de instalar', () => {
  const sidebar = readFileSync(SIDEBAR, 'utf8')
  const instalar = readFileSync(INSTALAR, 'utf8')

  it('está montado en el pie del sidebar', () => {
    expect(sidebar).toContain('<Instalar')
  })

  // Una sola copia, y no por descuido: components/ui/sidebar.tsx renderiza el
  // mismo {children} en el Sheet del teléfono y en el riel de escritorio. Si
  // alguna vez aparece una segunda, tiene que ser una decisión visible en el
  // diff y no un descubrimiento en producción — es la lección que dejó el merge
  // del ciclo móvil con las dos copias de "Anular orden".
  it('aparece una sola vez', () => {
    expect(sidebar.match(/<Instalar/g)).toHaveLength(1)
  })

  // La decisión vive en lib/pwa/instalacion.ts, que sí se puede probar sin DOM.
  // Un componente que la reimplemente por su cuenta deja esos ocho casos
  // probando algo que la pantalla no usa.
  it('no reimplementa la decisión: la importa', () => {
    expect(instalar).toContain('estadoDeInstalacion')
    expect(instalar).not.toContain('/iPad|iPhone|iPod/')
  })

  it('escucha el evento del que depende el camino de Chrome', () => {
    expect(instalar).toContain('beforeinstallprompt')
  })
})
```

- [ ] **Step 8: Correr los tests del componente**

Run: `npx vitest run components/shell/instalar.test.tsx components/shell/sidebar-arandano.test.tsx`
Expected: PASS los dos archivos. Si el segundo falla por un conteo de hijos del pie escrito a mano, actualizarlo — y derivarlo, no volver a escribir el número.

- [ ] **Step 9: Correr el gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS los tres.

- [ ] **Step 10: Commit**

```bash
git add lib/pwa components/shell/instalar.tsx components/shell/instalar.test.tsx components/shell/sidebar-arandano.tsx
git commit -m "feat(pwa): el botón para instalar, y las instrucciones de iOS"
```

---

### Task 6: El smoke, la deuda de la maqueta y el registro del ciclo

**Files:**
- Modify: `scripts/smoke.sh` (dos casos nuevos)
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 32)
- Modify: `CLAUDE.md` (la entrada del ciclo en *Próximos pasos técnicos*)

**Interfaces:**
- Consumes: `app/manifest.ts` de la Task 1; las variables `SUBDOMINIO_CANARIO`, `NOMBRE_CANARIO`, `DOMINIO_BASE` y `URL_BASE`, que `scripts/smoke.sh` ya define.

- [ ] **Step 1: Sumar los dos casos de smoke**

En `scripts/smoke.sh`, junto a los demás `caso_*`:

```bash
# El manifest es lo único de este ciclo que el gate puede verificar contra un
# stack corriendo: el prompt de instalación exige HTTPS y un navegador de
# verdad, y ninguna de las dos cosas hay acá.
caso_manifest_del_tenant() {
  local cuerpo
  cuerpo=$(curl -fsS --max-time 10 \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/manifest.webmanifest") || return 1
  jq -e --arg n "$NOMBRE_CANARIO" '.name == $n and .start_url == "/"' <<<"$cuerpo" >/dev/null 2>&1
}

# La otra mitad, y la que pasa desapercibida: un manifest que devuelve 200
# siempre parece que anda. Sin este caso, dejar la landing instalable como si
# fuera el producto no rompe nada.
caso_manifest_no_existe_en_apex() {
  local codigo
  codigo=$(curl -s -o /dev/null --max-time 10 -w '%{http_code}' \
    -H "Host: ${DOMINIO_BASE}" "$URL_BASE/manifest.webmanifest")
  [[ "$codigo" == 404 ]]
}
```

Y sumarlos a la lista del `for caso in`, después de `caso_tenant_resuelve`:

```bash
  caso_manifest_del_tenant \
  caso_manifest_no_existe_en_apex \
```

- [ ] **Step 2: Correr el smoke contra `arandano-dev`**

Run: `scripts/smoke.sh` con las variables del stack de dev (ver *Deploy y rollback* en `docs/runbook-stacks.md` para la invocación exacta).
Expected: los dos casos nuevos en verde. Si `caso_manifest_del_tenant` falla, mirar primero que el canario de ese stack tenga el nombre que la variable dice.

- [ ] **Step 3: Anotar la deuda con la maqueta**

En `docs/correcciones-pendientes-del-pen.md`, como entrada **32** (las que hay llegan hasta la 31):

```markdown
## 32. La PWA entera se derivó sin frames: el botón del pie, el diálogo de iOS, la pantalla sin conexión y el ícono

`design/arandano.pen` es anterior a este ciclo y no dibuja nada de lo que
construye: el botón "Instalar" del `SidebarFooter`, el diálogo con los tres
pasos de iOS, `/sin-conexion`, ni el ícono del local.

Los cuatro se derivaron de patrones que ya existen —la geometría del pie del
sidebar, el `Dialog` de shadcn, el paño de marca del opengraph—, que es lo que
el ciclo del 2026-09-02 hizo con cuatro controles de los que **tres salieron
bien y uno era justamente el defecto** que el ciclo siguiente tuvo que
rehacer (entrada 28). O sea que derivar no es gratis y esto no está confirmado.

El que más se beneficiaría de un frame es el diálogo de iOS: es la única
pantalla del producto que le explica al dueño cómo usar su propio sistema
operativo, y no hay ningún precedente en el `.pen` de cómo se ve una
instrucción de tres pasos.

Y sigue pendiente de antes que una persona guarde y commitee la maqueta viva
desde Pencil: el MCP lee, no persiste.
```

- [ ] **Step 4: Registrar el ciclo en CLAUDE.md**

En *Próximos pasos técnicos*, sumar la entrada del ciclo con el formato que usan las demás: qué salió, las decisiones con su alternativa descartada, lo que NO hace, y lo que queda pendiente. Cubrir sí o sí, porque es lo que un lector futuro necesita y no está en ningún otro lado:

- **Que cada tenant sea su propio origen es lo que hace esto barato**, y fue una decisión tomada por otro motivo (el cutover del wildcard, 2026-08-10).
- **`start_url` es `/`** porque `destinoAlEntrar()` ya redirige por rol — el manifest no suma un cuarto lugar que pueda discrepar.
- **El service worker entra por descubribilidad y no por instalabilidad**: Chrome ya no lo exige para instalar desde el menú (v108/v112), sólo para disparar el botón propio.
- **El riesgo que contradice el modelo del proyecto**: un SW sobrevive al rollback de la imagen. Sus dos defensas son la trivialidad y el deploy de desactivación escrito de antemano en `docs/runbook-stacks.md`.
- **La pantalla sin conexión se pinta con estilo inline**, porque los assets de Next llevan hash y no hay lista que siga siendo válida después del deploy siguiente.
- **Sin permisos nuevos y sin migración.**
- **Lo que NO hace**: offline real, push, logo cargado, ápex instalable.
- **Lo que queda pendiente**: la verificación manual, que **no se puede hacer en dev** —instalar exige HTTPS y el wildcard `*.arandano.app` no cubre `canario.dev.arandano.app`, porque un wildcard de DNS es de una sola etiqueta—. Se hace contra el canario de producción, después del deploy.

- [ ] **Step 5: Correr el gate completo por última vez**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: PASS los tres. `test/pantallas.test.ts` en particular, que es el que sabe de la pantalla nueva.

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke.sh docs/correcciones-pendientes-del-pen.md CLAUDE.md
git commit -m "docs(pwa): el smoke del manifest, la deuda del pen y el registro del ciclo"
```

---

## Después del plan

El ciclo NO está cerrado cuando pasa el gate. Falta la verificación manual, y este ciclo la tiene bloqueada en dev por una razón estructural: **instalar exige HTTPS**, y `arandano-dev` se sirve por HTTP sobre Tailscale — el wildcard `*.arandano.app` no cubre `canario.dev.arandano.app` porque un wildcard de DNS es de una sola etiqueta.

**En dev sí se puede mirar**: el manifest servido con el nombre del local, los dos íconos, la pantalla `/sin-conexion` y que el botón no aparezca en un navegador de escritorio sin soporte.

**Contra el canario de producción, después del deploy**, con un teléfono en la mano:

- Chrome en Android ofrece instalar, y el ícono de la pantalla de inicio es la inicial del local y no el de Arándano.
- La app abierta desde ese ícono no muestra barra de direcciones, y aterriza en `/dashboard` con un dueño y en `/vender` con un empleado.
- El botón desaparece una vez instalada.
- En un iPhone el botón muestra las instrucciones, y el camino que describen es el que Safari realmente tiene.
- Con el modo avión prendido, la app instalada muestra la pantalla sin conexión **pintada**, no HTML pelado, y no el error del navegador.
- El ícono maskable no queda recortado en un Android con máscara circular.
