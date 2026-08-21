# El shell de la maqueta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el header horizontal con pestañas por el sidebar de 248 px que dibuja `design/arandano.pen`, y darle a las diez pantallas de aplicación el encabezado de 66 px que comparten.

**Architecture:** El sidebar viene de shadcn (`components/ui/sidebar.tsx`) y se compone en `components/shell/`. `app/(app)/layout.tsx` pasa de `<header>` + `<footer>` a `SidebarProvider > Sidebar + SidebarInset`. Cada `page.tsx` cambia su `<h1>` suelto por `<Encabezado>`. Ninguna línea de lógica ni ningún server action se toca.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4, shadcn (CLI en devDependencies), lucide-react, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-08-21-maqueta-shell-design.md`

## Global Constraints

- **Idioma:** todo el código, los comentarios, los nombres de variables y los mensajes de commit van en **español rioplatense**, con acentos. Es como está escrito el resto del repo.
- **Los `data-testid` no se renombran nunca.** `tenant-nombre`, `usuario-nombre`, `stack` y `sha` los busca `scripts/smoke.sh` en cada pantalla del gate. `tenant-nombre` va **último** en su elemento: el grep del smoke busca el `>` pegado al nombre.
- **Ancho del sidebar: `15.5rem`** (248 px). El default de shadcn es `16rem` y hay que pisarlo.
- **Los colores salen de tokens, nunca de un hex escrito a mano.** `test/sistema-de-diseno.test.ts` prohíbe además el nombre `--primary-foreground` fuera de `components/ui/`.
- **Tests:** `npm test` corre `scripts/tests/correr-todos.sh && vitest run`. Para un archivo solo: `npx vitest run <archivo>`.
- **No se toca `prisma/schema.prisma`.** Las migraciones son el ciclo 2.
- **No se toca `app/(app)/servicio-tecnico/[id]/ticket/`.** El ticket no usa los tokens del sistema, a propósito.
- **Commits chicos**, uno por tarea, con `git add` de los archivos nombrados y nunca `git add -A`: el working tree tiene cambios sin commitear de otro ciclo.

---

### Task 1: Los componentes de shadcn y los ocho tokens

Instala `sidebar` y `avatar`, declara los ocho tokens `--sidebar-*` y arregla los tres tests de diseño que eso rompe.

**Files:**
- Create: `components/ui/sidebar.tsx`, `components/ui/avatar.tsx`, `components/ui/sheet.tsx`, `components/ui/tooltip.tsx`, `components/ui/separator.tsx`, `components/ui/skeleton.tsx`, `hooks/use-mobile.ts` (los genera el CLI)
- Modify: `app/globals.css`, `docs/sistema-de-diseno.md`, `test/maqueta.test.ts`, `test/sistema-de-diseno.test.ts`

**Interfaces:**
- Consumes: nada (primera tarea)
- Produces: los componentes `Sidebar`, `SidebarProvider`, `SidebarInset`, `SidebarHeader`, `SidebarContent`, `SidebarFooter`, `SidebarGroup`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton`, `SidebarTrigger` de `@/components/ui/sidebar`; `Avatar`, `AvatarFallback` de `@/components/ui/avatar`. Los tokens `--sidebar`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-primary-foreground`, `--sidebar-accent`, `--sidebar-accent-foreground`, `--sidebar-border`, `--sidebar-ring` en `:root`, y sus `--color-sidebar-*` en `@theme inline`.

- [ ] **Step 1: Correr los tests de diseño y confirmar que hoy están en verde**

```bash
npx vitest run test/sistema-de-diseno.test.ts test/maqueta.test.ts
```

Esperado: PASS. Es la línea de base — si acá ya hay algo rojo, pará y avisá antes de seguir.

- [ ] **Step 2: Instalar los componentes**

```bash
npx shadcn@latest add sidebar avatar
```

Va a preguntar por sobrescribir `button.tsx` e `input.tsx` si detecta diferencias: **contestá que no**. Esos dos ya están en el repo con ajustes propios.

Verificá qué apareció:

```bash
git status --short components/ hooks/
```

Esperado: `components/ui/sidebar.tsx`, `avatar.tsx`, `sheet.tsx`, `tooltip.tsx`, `separator.tsx`, `skeleton.tsx` y `hooks/use-mobile.ts` como archivos nuevos.

- [ ] **Step 3: Correr los tests de diseño otra vez**

```bash
npx vitest run test/sistema-de-diseno.test.ts test/maqueta.test.ts
```

Esperado: **PASS todavía**. El CLI no toca `:root`, así que los tokens no entraron y nada cambió para estos tests. El paso 4 es el que los rompe.

La excepción: si falla `no aparece en ninguna pantalla ni componente fuera de components/ui/`, es que algún archivo nuevo cayó fuera de `components/ui/` usando `--primary-foreground`. Movelo ahí antes de seguir.

- [ ] **Step 4: Declarar los ocho tokens en `app/globals.css`**

En el bloque `:root`, después del bloque de `--chart-*` y antes de `--radius`:

```css
  /* El sidebar de shadcn los referencia por nombre en sus clases, así que no
     alcanza con que los colores existan bajo otro token: tienen que existir con
     ESTOS nombres o `bg-sidebar` no resuelve a nada.
     Ninguno inventa un color. Cada uno toma el de la variable de
     design/arandano.pen que la maqueta ya usa en ese lugar del paño, y
     test/maqueta.test.ts los ata a esa variable. */
  --sidebar: #FFFFFF;
  --sidebar-foreground: #171221;
  --sidebar-primary: #4A2AA5;
  --sidebar-primary-foreground: #FFFFFF;
  --sidebar-accent: #EDE8FB;
  --sidebar-accent-foreground: #4A2AA5;
  --sidebar-border: #E3E0EC;
  --sidebar-ring: #4A2AA5;
```

Y en `@theme inline`, junto al resto de los `--color-*`:

```css
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
```

- [ ] **Step 5: Correr los tests y verlos fallar por los tokens**

```bash
npx vitest run test/sistema-de-diseno.test.ts test/maqueta.test.ts
```

Esperado: FAIL en tres casos concretos:
- `no quedan tokens de sidebar` — "app/globals.css declara tokens que ningún componente usa"
- `todo token del CSS está documentado` — los ocho no están en `docs/sistema-de-diseno.md`
- `todo token de color del CSS está en la maqueta, o exceptuado con su razón` — los ocho no están en `EQUIVALENCIAS`

Si alguno de los tres NO falla, pará: significa que el token no llegó a `:root` o que el parser no lo ve.

- [ ] **Step 6: Borrar el caso `no quedan tokens de sidebar`**

En `test/sistema-de-diseno.test.ts`, borrar el `it('no quedan tokens de sidebar', …)` entero (líneas 55–74), con su comentario.

En su lugar, dejar esta nota arriba del caso siguiente para que no se pierda por qué existía:

```ts
  // El caso `no quedan tokens de sidebar` vivía acá y se borró el día que entró
  // el sidebar de shadcn, que es exactamente lo que su comentario anticipaba.
  // Lo que sigue cuidando el mismo riesgo es el par de casos de abajo, que
  // compara documento y CSS en las dos direcciones: un --sidebar-* que quede
  // declarado sin usar hay que borrarlo del CSS, y si se borra del CSS sin
  // borrarlo del documento, el caso `la tabla del documento no está vacía` y su
  // hermano fallan igual.
```

- [ ] **Step 7: Mapear los ocho en `test/maqueta.test.ts`**

En `EQUIVALENCIAS`, agregar cada token a la variable que ya tiene ese valor. Las cinco líneas afectadas quedan así:

```ts
  'ar-surface': ['--card', '--popover', '--sidebar'],
  'ar-ink': [
    '--foreground',
    '--card-foreground',
    '--popover-foreground',
    '--secondary-foreground',
    '--sidebar-foreground',
  ],
  'ar-line': ['--border', '--sidebar-border'],
  'ar-primary': [
    '--primary',
    '--ring',
    '--accent-foreground',
    '--chart-1',
    '--sidebar-primary',
    '--sidebar-accent-foreground',
    '--sidebar-ring',
  ],
  'ar-primary-soft': ['--accent', '--sidebar-accent'],
  'ar-on-primary': ['--primary-foreground', '--marca-foreground', '--sidebar-primary-foreground'],
```

Ninguno va a `SOLO_EN_CSS`: un token de sidebar en esa lista significaría que el color se decidió escribiendo código, y no es el caso — los ocho salen del `.pen`.

- [ ] **Step 8: Documentar los ocho en `docs/sistema-de-diseno.md`**

Buscar la tabla de tokens que `test/sistema-de-diseno.test.ts` parsea (la misma que ya lista `--background`, `--card`, etc.) y agregar las ocho filas con el mismo formato que usan las existentes. Antes de la tabla, o en la sección que corresponda, agregar este párrafo:

```markdown
### Los tokens del sidebar

El sidebar de shadcn referencia sus colores por nombre propio: `bg-sidebar`,
`text-sidebar-foreground`, `data-[active=true]:bg-sidebar-accent`. No alcanza
con que el color exista bajo otro token — tiene que existir con **ese** nombre
o la utilidad no resuelve a nada.

Ninguno de los ocho es un color nuevo. Cada uno toma el de la variable de
`design/arandano.pen` que la maqueta ya usa en ese lugar del paño, y
`test/maqueta.test.ts` los ata a esa variable en las dos direcciones. Un
`--sidebar-*` con un valor que la maqueta no tenga rompe el build.

Estos ocho reemplazan al caso `no quedan tokens de sidebar` de
`test/sistema-de-diseno.test.ts`, que existió justamente hasta que hubo un
componente que los usara.
```

- [ ] **Step 9: Correr los tests y verlos pasar**

```bash
npx vitest run test/sistema-de-diseno.test.ts test/maqueta.test.ts
```

Esperado: PASS, los dos archivos completos.

- [ ] **Step 10: Correr la suite entera**

```bash
npm test
```

Esperado: PASS. Si `test/use-server.test.ts` o algún test de rutas se queja de los archivos nuevos de `components/ui/`, revisá que ninguno lleve `'use server'` — no deberían.

- [ ] **Step 11: Commit**

```bash
git add components/ui/sidebar.tsx components/ui/avatar.tsx components/ui/sheet.tsx \
        components/ui/tooltip.tsx components/ui/separator.tsx components/ui/skeleton.tsx \
        hooks/use-mobile.ts app/globals.css docs/sistema-de-diseno.md \
        test/maqueta.test.ts test/sistema-de-diseno.test.ts components.json
git commit -m "feat(shell): el sidebar de shadcn entra, y con él sus ocho tokens"
```

---

### Task 2: La navegación, con íconos y en forma de sidebar

`Navegacion` deja de renderizar pestañas horizontales y pasa a renderizar el menú del sidebar. `estaActiva()` y el filtrado por rol no se tocan.

**Files:**
- Modify: `components/navegacion.tsx`, `components/navegacion.test.tsx`

**Interfaces:**
- Consumes: `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton` de Task 1
- Produces: `Navegacion({ rol }: { rol: RolUsuario })` — igual firma que hoy. `estaActiva(href, ruta)` se exporta igual. El tipo `Pestana` suma `icono: LucideIcon`.

- [ ] **Step 1: Escribir el caso que falla**

En `components/navegacion.test.tsx`, dentro del `describe('Navegacion', …)`:

```tsx
  // Los íconos los nombra design/arandano.pen. No son decoración: en un
  // sidebar de 248 px son lo que hace la entrada reconocible de reojo, que es
  // como se opera un mostrador. Van con aria-hidden porque el rótulo de al lado
  // ya dice lo mismo, y anunciarlo dos veces es peor que no anunciarlo.
  it('cada pestaña lleva su ícono, y el ícono no se anuncia', async () => {
    const html = renderToStaticMarkup(<Navegacion rol="DUENO" />)
    const svgs = html.match(/<svg[^>]*aria-hidden="true"[^>]*>/g) ?? []
    expect(svgs).toHaveLength(5)
  })
```

- [ ] **Step 2: Correr el test y verlo fallar**

```bash
npx vitest run components/navegacion.test.tsx -t "cada pestaña lleva su ícono"
```

Esperado: FAIL con `expected [] to have a length of 5 but got 0`.

- [ ] **Step 3: Sumar el ícono al tipo y a la lista**

En `components/navegacion.tsx`, arriba:

```tsx
import { Package, ReceiptText, ShoppingCart, Users, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
```

El tipo y la lista:

```tsx
type Pestana = { href: string; texto: string; icono: LucideIcon; soloDueno?: boolean }

const PESTANAS: Pestana[] = [
  { href: '/vender', texto: 'Vender', icono: ShoppingCart },
  { href: '/ventas', texto: 'Ventas', icono: ReceiptText },
  { href: '/inventario', texto: 'Inventario', icono: Package },
  // Fija y visible en TODO tenant, incluido el que no hace servicio técnico.
  // Es deuda consciente y está escrita en el spec con su vencimiento: cuando
  // exista el registry de módulos, esta entrada sale de TenantModule. El
  // disparador es el primer tenant de un rubro sin servicio técnico.
  { href: '/servicio-tecnico', texto: 'Servicio Técnico', icono: Wrench },
  { href: '/usuarios', texto: 'Usuarios', icono: Users, soloDueno: true },
]
```

- [ ] **Step 4: Reemplazar el render**

El `<nav>` con las pestañas se va entero (con su comentario largo sobre `-mb-px` y el anillo inset, que dejó de aplicar) y queda:

```tsx
export function Navegacion({ rol }: { rol: RolUsuario }) {
  const ruta = usePathname()

  return (
    <SidebarMenu>
      {PESTANAS.filter((p) => !p.soloDueno || rol === 'DUENO').map((p) => {
        const activa = estaActiva(p.href, ruta)
        return (
          <SidebarMenuItem key={p.href}>
            {/* isActive pinta el fondo y el color; aria-current es lo que un
                lector de pantalla anuncia. Los dos, siempre: el layout viejo ya
                los tenía a los dos y no se pierde nada en la mudanza. */}
            <SidebarMenuButton asChild isActive={activa}>
              <Link href={p.href} aria-current={activa ? 'page' : undefined}>
                <p.icono aria-hidden="true" />
                <span>{p.texto}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      })}
    </SidebarMenu>
  )
}
```

Actualizar el comentario de arriba del componente: la parte que explica el subrayado y el `overflow-x-auto` ya no describe nada. Lo que **sí** hay que conservar es el párrafo de por qué es `'use client'` y el de que es el punto de extensión del registry de módulos.

- [ ] **Step 5: Correr el archivo entero**

```bash
npx vitest run components/navegacion.test.tsx
```

Esperado: PASS los trece casos (los doce que había más el nuevo).

Si falla `cada pestaña lleva anillo de foco propio`, es porque asertaba la clase `focus-visible:inset-ring-3` que se fue con el `<nav>`. Reescribilo contra lo que hace `SidebarMenuButton`, que trae su propio `focus-visible:ring-2`:

```tsx
  it('cada pestaña lleva anillo de foco propio', async () => {
    const html = renderToStaticMarkup(<Navegacion rol="DUENO" />)
    expect(html).toContain('focus-visible:ring-2')
  })
```

Si falla algún caso de `aria-current`, **no** lo toques: significa que el `asChild` no está pasando el atributo y el bug es del render, no del test.

- [ ] **Step 6: Commit**

```bash
git add components/navegacion.tsx components/navegacion.test.tsx
git commit -m "feat(shell): la navegación pasa a menú de sidebar, con los íconos de la maqueta"
```

---

### Task 3: El sidebar de Arándano

Compone los pedazos de shadcn en el paño que dibuja la maqueta: marca arriba, navegación, espaciador, pie con usuario y versión.

**Files:**
- Create: `components/shell/sidebar-arandano.tsx`, `components/shell/sidebar-arandano.test.tsx`
- Modify: `components/cartel.module.css`

**Interfaces:**
- Consumes: `Navegacion` de Task 2; `Sidebar`, `SidebarHeader`, `SidebarContent`, `SidebarGroup`, `SidebarFooter` de Task 1; `Avatar`, `AvatarFallback` de Task 1; `Contexto` de `@/components/contexto`
- Produces:
  ```tsx
  export function SidebarArandano({
    nombreLocal, nombreUsuario, rol, alSalir,
  }: {
    nombreLocal: string
    nombreUsuario: string
    rol: RolUsuario
    alSalir: () => Promise<void>
  })
  ```
  `alSalir` es la server action `salir` de `app/(app)/acciones.ts`, que se le pasa desde el layout.

- [ ] **Step 1: Escribir los tests que fallan**

`components/shell/sidebar-arandano.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SidebarArandano } from './sidebar-arandano'

// Navegacion llama a usePathname(); sin esto se cae el archivo entero y el
// síntoma no la nombra por ningún lado.
vi.mock('next/navigation', () => ({ usePathname: () => '/vender' }))

function render(props: Partial<Parameters<typeof SidebarArandano>[0]> = {}) {
  return renderToStaticMarkup(
    <SidebarArandano
      nombreLocal="Local de prueba"
      nombreUsuario="Quien sea"
      rol="DUENO"
      alSalir={vi.fn()}
      {...props}
    />,
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

  it('marca el nombre del usuario, que scripts/smoke.sh busca tras el login', () => {
    expect(render()).toContain('data-testid="usuario-nombre"')
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
```

- [ ] **Step 2: Correr y ver fallar**

```bash
npx vitest run components/shell/sidebar-arandano.test.tsx
```

Esperado: FAIL — `Cannot find module './sidebar-arandano'`.

- [ ] **Step 3: Escribir el componente**

`components/shell/sidebar-arandano.tsx`:

```tsx
import Link from 'next/link'
import { LogOut } from 'lucide-react'
import type { RolUsuario } from '@/lib/auth/sesion'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from '@/components/ui/sidebar'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Navegacion } from '@/components/navegacion'
import { Contexto } from '@/components/contexto'
import estilos from '@/components/cartel.module.css'

/**
 * El paño de 248 px que envuelve toda la aplicación.
 *
 * La geometría sale de design/arandano.pen (frame `Shell/Sidebar`), no de
 * mirar la captura: marca `pad:[22,20,18,20] gap:2`, nav `pad:[6,12] gap:2`,
 * pie `pad:[16,16,18,16] gap:10`.
 *
 * Es de SERVIDOR aunque `Navegacion` sea de cliente: lo único que necesita
 * saber la ruta es el menú, y meter todo el paño en el cliente arrastraría la
 * server action de salir a un componente que no la puede recibir.
 */
export function SidebarArandano({
  nombreLocal,
  nombreUsuario,
  rol,
  alSalir,
}: {
  nombreLocal: string
  nombreUsuario: string
  rol: RolUsuario
  alSalir: () => Promise<void>
}) {
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-0.5 px-5 pt-[22px] pb-[18px]">
        {/* El producto arriba y el local abajo, y no al revés: adentro del
            sistema, quién sos importa menos que dónde estás parado. Es la misma
            inversión de jerarquía que la persiana del login descubre. */}
        <span className="text-[10px] font-semibold tracking-[0.14em] text-sidebar-primary">
          ARÁNDANO
        </span>
        {/* min-w-0 es lo que hace que truncate funcione adentro de un flex.
            data-testid va ÚLTIMO: el grep de scripts/smoke.sh busca el `>`
            pegado al nombre. */}
        <span
          className={`${estilos.cartel} min-w-0 truncate text-sidebar-foreground`}
          title={nombreLocal}
          data-testid="tenant-nombre"
        >
          {nombreLocal}
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="px-3 py-1.5">
          <Navegacion rol={rol} />
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2.5 px-4 pt-4 pb-[18px]">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-marca text-[13px] text-marca-foreground">
              {nombreUsuario.trim().charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col gap-px">
            <span
              className="truncate text-[13px] text-sidebar-foreground"
              data-testid="usuario-nombre"
            >
              {nombreUsuario}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {rol === 'DUENO' ? 'Dueño' : 'Empleado'}
            </span>
          </div>
          {/* Un form y no un onClick: así el botón funciona igual sin
              JavaScript, como el resto de las pantallas. */}
          <form action={alSalir} className="ml-auto">
            <Button type="submit" variant="ghost" size="icon" aria-label="Salir">
              <LogOut aria-hidden="true" />
            </Button>
          </form>
        </div>
        <Contexto className="text-[10px] text-muted-foreground" />
      </SidebarFooter>
    </Sidebar>
  )
}
```

**Nota:** `bg-marca` y `text-marca-foreground` sólo existen como utilidades si `--color-marca` está en `@theme inline`, y hoy **no está** — `app/globals.css` dice explícitamente que `--marca` se consume con `var(--token)` directo desde módulos de CSS. Corré este paso, y si Tailwind no genera la clase, usá `style={{ backgroundColor: 'var(--marca)', color: 'var(--marca-foreground)' }}` en el `AvatarFallback` y dejá un comentario de una línea explicando por qué, apuntando al comentario de `@theme inline`.

- [ ] **Step 4: Correr y ver pasar**

```bash
npx vitest run components/shell/sidebar-arandano.test.tsx
```

Esperado: PASS los siete casos.

- [ ] **Step 5: Bajar el cartel a 19 px**

En `components/cartel.module.css`, cambiar `font-size: 1.5rem` por `font-size: 1.1875rem` (19 px), y reemplazar el párrafo **POR QUÉ 24 PX** por:

```css
 * POR QUÉ 19 PX. Antes eran 24, y el motivo era que a 20 empataba con el <h1>
 * de la pantalla, que vivía en la MISMA fila. Con el sidebar el <h1> se mudó al
 * encabezado, a 248 px de distancia y en otro eje: ya no hay con qué competir,
 * y 19 es lo que la maqueta dibuja (design/arandano.pen, frame Shell/Sidebar).
 * La inversión de jerarquía se sigue leyendo porque el cartel es lo único que
 * hay en su bloque, no porque sea el número más grande de la pantalla.
```

También hay que actualizar el primer párrafo (**QUÉ ES**), que dice "por encima del `<h1>` de cada pantalla" — ya no es cierto en tamaño. Cambiarlo por "en su propia columna, arriba de la navegación".

- [ ] **Step 6: Correr la suite entera**

```bash
npm test
```

Esperado: PASS. `app/(app)/layout.test.tsx` todavía apunta al header viejo y tiene que seguir pasando: esta tarea no tocó el layout.

- [ ] **Step 7: Commit**

```bash
git add components/shell/sidebar-arandano.tsx components/shell/sidebar-arandano.test.tsx components/cartel.module.css
git commit -m "feat(shell): el paño del sidebar, con la marca, el pie y el cartel a 19 px"
```

---

### Task 4: El layout monta el shell

`app/(app)/layout.tsx` cambia el `<header>` de dos filas y el `<footer>` por `SidebarProvider > SidebarArandano + SidebarInset`.

**Files:**
- Modify: `app/(app)/layout.tsx`, `app/(app)/layout.test.tsx`

**Interfaces:**
- Consumes: `SidebarArandano` de Task 3; `SidebarProvider`, `SidebarInset`, `SidebarTrigger` de Task 1; `salir` de `./acciones`
- Produces: el shell montado. Las pantallas hijas reciben un contenedor sin padding — el padding lo pone cada una hasta la Task 6.

- [ ] **Step 1: Reescribir los tests**

En `app/(app)/layout.test.tsx`, los mocks del encabezado del archivo **no se tocan** (`exigirSesion`, `next/navigation`, `./acciones`). Los nueve casos se reescriben así — los cuatro de `data-testid` cambian de razón pero **no** de string buscado:

```tsx
  it('marca el nombre del local con data-testid, para el smoke autenticado', async () => {
    const html = await render()
    expect(html).toContain('data-testid="tenant-nombre">Local de prueba')
  })

  it('el cartel guarda el nombre completo en title', async () => {
    const html = await render()
    expect(html).toContain('title="Local de prueba"')
  })

  it('el nombre del local lleva el tratamiento de cartel', async () => {
    const html = await render()
    expect(html).toMatch(/class="[^"]*cartel/)
  })

  it('marca el nombre del usuario, que scripts/smoke.sh busca tras el login', async () => {
    const html = await render()
    expect(html).toContain('data-testid="usuario-nombre"')
  })

  // Se mudaron del footer al pie del sidebar, que es donde la maqueta los pone.
  it('muestra el stack y la imagen desplegada, en el pie del sidebar', async () => {
    const html = await render()
    expect(html).toContain('data-testid="stack"')
    expect(html).toContain('data-testid="sha"')
  })

  it('renderiza la navegación', async () => {
    const html = await render()
    expect(html).toContain('Inventario')
  })

  it('pasa el rol de la sesión a la navegación, no uno fijo', async () => {
    exigirSesion.mockResolvedValue({
      tenant: { id: 'un-id', nombre: 'Local de prueba', estado: 'ACTIVO' },
      usuario: { id: 'otro-id', nombre: 'Quien sea', rol: 'EMPLEADO' },
      subdominio: 'prueba',
    })
    const html = await render()
    expect(html).not.toContain('Usuarios')
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
```

- [ ] **Step 2: Correr y ver fallar**

```bash
npx vitest run "app/(app)/layout.test.tsx"
```

Esperado: FAIL en al menos `el sidebar mide 15.5rem`, `el trigger de mobile no se muestra en desktop` y `el sidebar marca la entrada activa con aria-current`.

- [ ] **Step 3: Reescribir el layout**

`app/(app)/layout.tsx` — los tres bloques de arriba (`dynamic`, `metadata` y sus comentarios) **no se tocan**:

```tsx
import type { Metadata } from 'next'
import { exigirSesion } from '@/lib/auth/sesion'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { SidebarArandano } from '@/components/shell/sidebar-arandano'
import { salir } from './acciones'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

// Ninguna pantalla de la aplicación se indexa: son datos de un local. Lo hereda
// todo lo que cuelgue de (app), así que una pantalla nueva nace cubierta.
export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  return (
    // 15.5rem = 248 px, que es lo que dibuja design/arandano.pen. El default de
    // shadcn es 16rem: ocho pixeles que arrastrarían las diez pantallas.
    <SidebarProvider style={{ '--sidebar-width': '15.5rem' } as React.CSSProperties}>
      <SidebarArandano
        nombreLocal={sesion.tenant.nombre}
        nombreUsuario={sesion.usuario.nombre}
        rol={sesion.usuario.rol}
        alSalir={salir}
      />
      <SidebarInset>
        {/* El único control que la maqueta no dibuja, y existe sólo para que en
            un teléfono el paño se pueda abrir. En el 1440 del diseño no se ve. */}
        <SidebarTrigger className="m-2 md:hidden" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  )
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
npx vitest run "app/(app)/layout.test.tsx"
```

Esperado: PASS los once casos.

Si falla `pasa el rol de la sesión a la navegación`, fijate que el `not.toContain('Usuarios')` no esté chocando con la palabra "Usuarios" en otro lado del HTML — si pasa, apretá la aserción a `expect(html).not.toContain('href="/usuarios"')`.

- [ ] **Step 5: Correr la suite entera y mirarlo en el navegador**

```bash
npm test
```

Esperado: PASS.

Y entrar a mirarlo, que es lo que ningún test hace. Por el **subdominio del tenant**, nunca por la IP pelada — `http://100.64.81.63:3000` devuelve 404 desde el cutover de tenants por `Host`, y es correcto que lo haga.

Lo que se mira: las cinco entradas con su ícono, la activa con fondo lila y texto violeta, el cartel arriba, el pie con el avatar redondo violeta profundo y `dev · dev` abajo.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/layout.tsx" "app/(app)/layout.test.tsx"
git commit -m "feat(shell): el layout monta el sidebar y jubila el header horizontal"
```

---

### Task 5: El encabezado de pantalla

El topbar de 66 px que las diez pantallas comparten: título, subtítulo debajo, acciones a la derecha.

**Files:**
- Create: `components/shell/encabezado.tsx`, `components/shell/encabezado.test.tsx`

**Interfaces:**
- Consumes: nada de tareas anteriores
- Produces:
  ```tsx
  export function Encabezado({
    titulo, subtitulo, acciones,
  }: {
    titulo: React.ReactNode
    subtitulo?: React.ReactNode
    acciones?: React.ReactNode
  })
  ```
  Renderiza el `<h1>`. Las pantallas que lo usen **no** deben tener otro `<h1>`.

- [ ] **Step 1: Escribir los tests que fallan**

`components/shell/encabezado.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Encabezado } from './encabezado'

describe('el encabezado de pantalla', () => {
  it('el título es el h1 de la pantalla', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Inventario" />)
    expect(html).toMatch(/<h1[^>]*>Inventario<\/h1>/)
  })

  it('sin subtítulo no deja un párrafo vacío', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Vender" />)
    expect(html).not.toContain('<p')
  })

  it('el subtítulo va debajo del título', () => {
    const html = renderToStaticMarkup(<Encabezado titulo="Ventas" subtitulo="47 ventas" />)
    expect(html.indexOf('Ventas')).toBeLessThan(html.indexOf('47 ventas'))
  })

  // Cuatro de las diez pantallas ya tienen su botón en la fila del título.
  it('las acciones van a la derecha', () => {
    const html = renderToStaticMarkup(
      <Encabezado titulo="Inventario" acciones={<button>Artículo nuevo</button>} />,
    )
    expect(html).toContain('Artículo nuevo')
    expect(html.indexOf('Inventario')).toBeLessThan(html.indexOf('Artículo nuevo'))
  })

  // Un solo h1 por documento: el cartel del sidebar es <span> justamente por
  // esto, y el encabezado no puede romperlo por el otro lado.
  it('nunca hay más de un h1', () => {
    const html = renderToStaticMarkup(
      <Encabezado titulo="Usuarios" subtitulo="4 personas" acciones={<button>Agregar</button>} />,
    )
    expect(html.match(/<h1/g) ?? []).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Correr y ver fallar**

```bash
npx vitest run components/shell/encabezado.test.tsx
```

Esperado: FAIL — `Cannot find module './encabezado'`.

- [ ] **Step 3: Escribir el componente**

`components/shell/encabezado.tsx`:

```tsx
/**
 * La franja de 66 px que abre las diez pantallas de la aplicación.
 *
 * La geometría sale de design/arandano.pen: `Topbar [fill x 66] fill:$ar-surface
 * pad:[0,28]`. Es la misma en las diez, y por eso es un componente y no un
 * bloque copiado: un padding distinto en una pantalla se ve como un salto al
 * navegar entre ellas.
 *
 * Renderiza EL <h1> de la pantalla. La que lo use no puede tener otro.
 */
export function Encabezado({
  titulo,
  subtitulo,
  acciones,
}: {
  titulo: React.ReactNode
  subtitulo?: React.ReactNode
  acciones?: React.ReactNode
}) {
  return (
    <header className="flex h-[66px] shrink-0 items-center justify-between gap-6 border-b bg-card px-7">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-foreground">{titulo}</h1>
        {/* Condicional y no un <p> siempre presente: sin subtítulo, un párrafo
            vacío corre el título hacia arriba y la franja deja de leerse
            centrada. */}
        {subtitulo ? (
          <p className="truncate text-[13px] text-muted-foreground">{subtitulo}</p>
        ) : null}
      </div>
      {acciones ? <div className="flex shrink-0 items-center gap-2">{acciones}</div> : null}
    </header>
  )
}
```

- [ ] **Step 4: Correr y ver pasar**

```bash
npx vitest run components/shell/encabezado.test.tsx
```

Esperado: PASS los cinco casos.

- [ ] **Step 5: Commit**

```bash
git add components/shell/encabezado.tsx components/shell/encabezado.test.tsx
git commit -m "feat(shell): el encabezado de 66 px que abre las diez pantallas"
```

---

### Task 6: Las diez pantallas adoptan el encabezado

Cada `page.tsx` cambia su `<h1>` suelto por `<Encabezado>`. Ninguna cambia lo que dice ni lo que hace.

**Files:**
- Modify: `app/(app)/vender/page.tsx`, `app/(app)/ventas/page.tsx`, `app/(app)/ventas/[id]/page.tsx`, `app/(app)/inventario/page.tsx`, `app/(app)/inventario/nuevo/page.tsx`, `app/(app)/inventario/[id]/page.tsx`, `app/(app)/servicio-tecnico/page.tsx`, `app/(app)/servicio-tecnico/nuevo/page.tsx`, `app/(app)/servicio-tecnico/[id]/page.tsx`, `app/(app)/usuarios/page.tsx`

**Interfaces:**
- Consumes: `Encabezado` de Task 5
- Produces: nada nuevo. Cada pantalla queda con `<Encabezado>` como primer hijo y el resto de su cuerpo en un `<main>`.

**El patrón, igual en las diez.** Antes:

```tsx
  return (
    <main className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-medium">Inventario</h1>
          {total > 0 && <p className="mt-1 text-xs text-muted-foreground">…</p>}
        </div>
        {sesion.usuario.rol === 'DUENO' && (
          <Button asChild size="sm"><Link href="/inventario/nuevo">Artículo nuevo</Link></Button>
        )}
      </div>
      {/* … el resto del cuerpo … */}
    </main>
  )
```

Después:

```tsx
  return (
    <>
      <Encabezado titulo={EL_TITULO} subtitulo={EL_SUBTITULO} acciones={LA_ACCION} />
      <main className="p-6">
        {/* el cuerpo entero, tal cual estaba, menos el bloque del título */}
      </main>
    </>
  )
```

`EL_TITULO`, `EL_SUBTITULO` y `LA_ACCION` salen de la tabla de abajo: son el contenido que la pantalla ya tenía, movido y no reescrito. Los pasos 2 a 6 traen cada uno resuelto.

**La tabla de las diez.** Título, subtítulo y acción salen de lo que la pantalla YA tiene — no se inventa texto nuevo:

| Pantalla | `titulo` | `subtitulo` | `acciones` |
|---|---|---|---|
| `vender/page.tsx` | `"Vender"` | — | — |
| `ventas/page.tsx` | `"Ventas"` | el `<p>` de fecha + conteo, tal cual | el `<Button>` "Vender" |
| `ventas/[id]/page.tsx` | `` `Venta #${venta.numero}` `` | el `<p>` de fecha + usuario | — |
| `inventario/page.tsx` | `"Inventario"` | el `<p>` condicional de conteo | el `<Button>` "Artículo nuevo" (sólo dueño) |
| `inventario/nuevo/page.tsx` | `"Artículo nuevo"` | — | — |
| `inventario/[id]/page.tsx` | `articulo.nombre` | el `<p>` de sku · tipo · precio | — |
| `servicio-tecnico/page.tsx` | `"Servicio Técnico"` | — | el `<Button>` "Recibir un equipo" |
| `servicio-tecnico/nuevo/page.tsx` | `"Recibir un equipo"` | — | — |
| `servicio-tecnico/[id]/page.tsx` | `` `Orden #${orden.numero} · ${NOMBRE_ESTADO[orden.estado]}` `` | — | el `<Button>` "Reimprimir ticket" |
| `usuarios/page.tsx` | `"Usuarios"` | — | — |

**Los links de "volver" se quedan donde están.** Tres pantallas abren con `← Ventas` / `← Inventario` arriba del `<h1>`. Ésos van adentro del `<main>`, arriba del cuerpo: la maqueta los dibuja ahí, debajo de la franja y no dentro de ella.

**Las clases de layout de tres pantallas hay que revisarlas.** `servicio-tecnico/page.tsx` usa `mx-auto max-w-5xl px-6 py-8`, `servicio-tecnico/[id]` usa `max-w-3xl` y `servicio-tecnico/nuevo` `max-w-2xl`. Ese ancho máximo se queda en el `<main>` — no se sube al encabezado, que va de punta a punta.

- [ ] **Step 1: Confirmar la línea de base**

```bash
npm test
```

Esperado: PASS. Anotá el número de tests que pasan; al final tiene que ser el mismo.

- [ ] **Step 2: `vender/page.tsx`** — el caso más simple, para fijar el patrón

```tsx
import { Encabezado } from '@/components/shell/encabezado'
// …
  return (
    <>
      <Encabezado titulo="Vender" />
      <main className="p-6">
        <PuntoDeVenta cotizacionInicial={cotizacionInicial} />
      </main>
    </>
  )
```

Correr: `npm test` — esperado PASS. (Un `vitest run` apuntado a un directorio sin tests aborta con "No test files found", así que en esta tarea conviene la suite entera.)

- [ ] **Step 3: `usuarios/page.tsx` e `inventario/nuevo/page.tsx`** — los otros dos sin subtítulo ni acción

Mismo patrón. En `inventario/nuevo`, el `<Link>` de "← Inventario" queda como primer hijo del `<main>`, y el `<h1>` que tenía `mt-4 mb-6` desaparece — el margen inferior se lo queda el `<main>`.

Correr: `npm test` — esperado PASS.

- [ ] **Step 4: `ventas/page.tsx` e `inventario/page.tsx`** — los dos con subtítulo condicional y acción

El subtítulo es una expresión, no un string. `ventas/page.tsx` queda:

```tsx
      <Encabezado
        titulo="Ventas"
        subtitulo={
          <>
            {dDesde === dHasta ? fechaLarga(dDesde) : `${fechaLarga(dDesde)} — ${fechaLarga(dHasta)}`}
            {/* El conteo sólo si hay algo que contar, igual que el subtítulo de
                /inventario y por la misma razón: un "· 0 ventas" arriba del
                "No hay ventas en ese período" es ruido al lado de un texto de
                vacío que ya lo dice. Dos pantallas del mismo ciclo no pueden
                contestar distinto la misma pregunta. */}
            {total > 0 && (
              <>
                {' · '}
                {total === 1 ? '1 venta' : `${formatearCantidad(String(total))} ventas`}
              </>
            )}
          </>
        }
        acciones={
          <Button asChild size="sm">
            <Link href="/vender">Vender</Link>
          </Button>
        }
      />
```

Y `inventario/page.tsx`:

```tsx
      <Encabezado
        titulo="Inventario"
        subtitulo={
          /* Sólo si hay algo que contar: en un local recién dado de alta, un
             "0 artículos · 0 con stock negativo" es ruido debajo del título
             justo cuando la pantalla ya tiene su propio texto de vacío. */
          total > 0 ? (
            <>
              {total === 1 ? '1 artículo' : `${total} artículos`}
              {verInactivos ? '' : ' activos'}
              {negativos > 0 &&
                ` · ${negativos === 1 ? '1 con stock negativo' : `${negativos} con stock negativo`}`}
            </>
          ) : undefined
        }
        acciones={
          sesion.usuario.rol === 'DUENO' ? (
            <Button asChild size="sm">
              <Link href="/inventario/nuevo">Artículo nuevo</Link>
            </Button>
          ) : undefined
        }
      />
```

Los comentarios viajan con el código. Dicen por qué el conteo es condicional, y esa decisión no cambia por mudarse de archivo.

Correr: `npm test` — esperado PASS.

- [ ] **Step 5: `ventas/[id]` e `inventario/[id]`** — título dinámico y subtítulo de datos

El `<Link>` de volver queda como primer hijo del `<main>`.

Correr: `npm test` — esperado PASS.

- [ ] **Step 6: Las tres de servicio técnico**

Son las que tenían `text-2xl font-semibold`: al pasar por `<Encabezado>` quedan en `text-xl font-semibold`, igual que las otras siete. Es efecto de unificar, no una decisión de esta tarea.

Correr: `npm test` — esperado PASS. **Ojo con `ticket/ticket.test.tsx`**: no debería tocarse. Si falla, revertí — el ticket no lleva encabezado.

- [ ] **Step 7: Verificar que no quedó ningún `<h1>` suelto**

```bash
grep -rn "<h1" "app/(app)" --include=*.tsx
```

Esperado: **cero resultados**. El único `<h1>` de la aplicación vive ahora en `components/shell/encabezado.tsx`.

Si aparece alguno en `ticket/`, está bien y se queda: el ticket no usa el shell.

- [ ] **Step 8: Correr la suite entera**

```bash
npm test
```

Esperado: PASS, con el mismo número de tests del paso 1.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/vender/page.tsx" "app/(app)/ventas/page.tsx" "app/(app)/ventas/[id]/page.tsx" \
        "app/(app)/inventario/page.tsx" "app/(app)/inventario/nuevo/page.tsx" "app/(app)/inventario/[id]/page.tsx" \
        "app/(app)/servicio-tecnico/page.tsx" "app/(app)/servicio-tecnico/nuevo/page.tsx" "app/(app)/servicio-tecnico/[id]/page.tsx" \
        "app/(app)/usuarios/page.tsx"
git commit -m "feat(shell): las diez pantallas abren con el encabezado, y ninguna trae su propio h1"
```

---

### Task 7: La poda de tokens y el cierre

El paso que no se puede saltear: los tokens que ningún archivo referencie se borran.

**Files:**
- Modify: `app/globals.css`, `docs/sistema-de-diseno.md`, `test/maqueta.test.ts` (sólo si algún token se va), `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior
- Produces: el ciclo cerrado

- [ ] **Step 1: Buscar cada token**

```bash
for t in sidebar sidebar-foreground sidebar-primary sidebar-primary-foreground \
         sidebar-accent sidebar-accent-foreground sidebar-border sidebar-ring; do
  n=$(grep -rE "(bg|text|border|ring|fill|stroke|from|to|via)-$t\b|var\(--$t\)" \
       app components --include=*.tsx --include=*.css | wc -l | tr -d ' ')
  printf '%-32s %s\n' "$t" "$n"
done
```

- [ ] **Step 2: Borrar los que den 0**

Para cada token con cero usos: sacarlo de `:root`, sacar su `--color-*` de `@theme inline`, sacar su fila de la tabla de `docs/sistema-de-diseno.md` y sacarlo de `EQUIVALENCIAS` en `test/maqueta.test.ts`.

**Esto es el punto de la tarea, no un detalle.** El caso `no quedan tokens de sidebar` existía porque había ocho tokens declarados que ningún componente usaba. Reintroducir los ocho, usar cinco y haber borrado el test que lo detectaba deja al proyecto peor que antes de empezar.

Si los ocho dan distinto de cero, no se borra ninguno y este paso es un no-op. Anotá el resultado del grep en el mensaje del commit igual: es la evidencia de que la poda se corrió.

- [ ] **Step 3: Correr la suite entera**

```bash
npm test
```

Esperado: PASS. Si `todo token del CSS está documentado` falla, quedó una fila en el documento para un token que ya no existe. Si falla `no hay excepciones de más`, quedó algo en `SOLO_EN_CSS` que sobra.

- [ ] **Step 4: Typecheck y lint**

```bash
npx tsc --noEmit && npm run lint
```

Esperado: sin errores. Son dos de los pasos del gate de `deploy.sh`; que fallen acá es más barato que descubrirlo a las 11 de la noche.

- [ ] **Step 5: Mirarlo en el navegador**

Ningún test juzga si se ve como la maqueta. Entrar por el **subdominio del tenant**, no por `http://100.64.81.63:3000` (404 a propósito desde el cutover por `Host`), y con el catálogo sembrado:

```bash
npm run catalogo:sembrar
```

Con importes de **distinta cantidad de dígitos**: con montos parejos no se ve si las columnas de números bailan.

Lo que se compara contra `design/arandano.pen`:

- [ ] el sidebar mide 248 px y el contenido arranca justo al lado
- [ ] las cinco entradas con su ícono; la activa con fondo lila y texto violeta
- [ ] el cartel arriba, con "ARÁNDANO" en violeta encima
- [ ] el pie con el avatar redondo violeta profundo, nombre, rol y `dev · dev`
- [ ] la franja de 66 px en las diez pantallas, con el título alineado a la misma altura en todas
- [ ] navegar entre pantallas no produce saltos del encabezado

- [ ] **Step 6: Anotar el ciclo en `CLAUDE.md`**

En *Próximos pasos técnicos*, bajo el ítem del sistema de diseño, reemplazar el párrafo **Pendiente** (`nadie miró todavía la paleta nueva en un navegador, y las once pantallas de la maqueta no están construidas`) por:

```markdown
  **El shell ya está construido** (2026-08-21). El sidebar de 248 px de la
  maqueta reemplazó al header horizontal, las diez pantallas de aplicación
  abren con el encabezado de 66 px, y los ocho tokens `--sidebar-*` volvieron
  —con el caso que los prohibía borrado y su razón escrita en su lugar—. Ver
  `docs/superpowers/specs/2026-08-21-maqueta-shell-design.md`. **Queda para los
  ciclos siguientes**: las tres migraciones aditivas (`Articulo.categoria`,
  `Caja`, `Tenant.cotizacionUsd`) y después el cuerpo de cada pantalla, una por
  ciclo, en el orden que fija ese spec.
```

- [ ] **Step 7: Commit**

```bash
git add app/globals.css docs/sistema-de-diseno.md test/maqueta.test.ts CLAUDE.md
git commit -m "chore(shell): la poda de tokens del sidebar, y el ciclo anotado"
```
