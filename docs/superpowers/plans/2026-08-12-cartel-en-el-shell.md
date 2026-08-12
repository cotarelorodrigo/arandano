# El cartel en el shell — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Darle al shell de la aplicación la identidad que ya tiene el login —el
nombre del local como cartel, en Archivo expandida, por encima del título de
cada pantalla— usando sólo tipografía, sin tocar ningún archivo de pantalla.

**Architecture:** Tres cambios independientes sobre el shell:
`app/(app)/layout.tsx` (el cartel y el pie), `components/navegacion.tsx` (el
riel de pestañas) y un módulo CSS nuevo (`components/cartel.module.css`) que
consume `var(--font-archivo)` igual que `app/login/persiana.module.css`. La
documentación que dejaría de ser cierta se corrige en la misma task que la
vuelve falsa.

**Tech Stack:** Next.js App Router (React Server Components), Tailwind v4.3.3,
CSS Modules, vitest + `react-dom/server` para render a string.

**Spec:** `docs/superpowers/specs/2026-08-12-cartel-en-el-shell-design.md`

## Global Constraints

Aplican a **todas** las tasks.

- **`data-testid="tenant-nombre"` va SIEMPRE último entre los atributos, y el
  nombre del local es texto directo del elemento**, sin ningún nodo en el
  medio. `scripts/smoke.sh` lo grepea como
  `data-testid="tenant-nombre">${NOMBRE_CANARIO}` (líneas 121, 152 y 371) y en
  el payload RSC como `"tenant-nombre","children":"…"` (línea 330). Romper esta
  forma hace fallar todos los casos de pantalla del gate a la vez.
- **Ningún token cambia de valor y no entra ningún token nuevo**, ni en
  `app/globals.css` ni en `docs/sistema-de-diseno.md`.
- **Ningún color crudo.** Nada de `rgba()`, `#hex` ni `oklch()` inventado en un
  componente: se usan tokens, o `color-mix(in srgb, var(--token) N%, …)` como
  ya hace `app/login/persiana.module.css`.
- **Espaciado**: sólo los pasos `1, 2, 3, 4, 6, 8, 12` de Tailwind (4, 8, 12,
  16, 24, 32 y 48 px) en el código propio.
- **Comentarios en español y explicando el porqué**, no el qué — es el estilo de
  todo el repo, y `docs/sistema-de-diseno.md` es fuente de verdad: si un cambio
  vuelve falso algo que ahí está escrito, se corrige en el mismo commit.
- **No hay modo oscuro.** No se agregan clases `dark:`.
- **Cero archivos de `app/(app)/**/page.tsx`.** Si una task parece necesitar
  tocar una pantalla, está mal planteada: pará y preguntá.

### Cómo correr los tests

- Un archivo suelto: `npx vitest run app/\(app\)/layout.test.tsx`
- La suite de vitest entera: `npx vitest run`
- El gate local completo (tests de shell + vitest): `npm test`

`test/global-setup.ts` levanta un Postgres efímero en contenedor antes de
cualquier corrida de vitest, así que **hasta un test de render tarda** (el
`hookTimeout` es de 120 s). Es esperable, no es que se colgó.

---

### Task 1: El cartel

El nombre del local pasa de `<span class="font-medium">` de 14 px a cartel de
24 px en Archivo expandida, y la documentación que dice que Archivo sólo se
carga en el login deja de decirlo.

**Files:**
- Create: `components/cartel.module.css`
- Modify: `app/(app)/layout.tsx` (fila 1 del header, líneas 19-49)
- Modify: `app/layout.tsx` (comentario de `localFont`, líneas 5-27)
- Modify: `app/globals.css` (comentario de `--font-display`, dentro de `@theme inline`)
- Modify: `docs/sistema-de-diseno.md` (sección *Tipografía*)
- Test: `app/(app)/layout.test.tsx`

**Interfaces:**
- Consumes: `--font-archivo`, la variable que `next/font/local` ya emite sobre
  el `<html>` desde `app/layout.tsx`. No hay que cargar ninguna fuente nueva.
- Produces: `components/cartel.module.css` con la clase `.cartel`, que la
  Task 3 no usa y ninguna otra task modifica.

- [ ] **Step 1: Escribir el test que falla**

En `app/(app)/layout.test.tsx`, agregar estos dos casos **después** del caso
que ya existe (`marca el nombre del local con data-testid…`):

```tsx
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run app/\(app\)/layout.test.tsx`

Expected: los dos casos nuevos FALLAN. `title="Local de prueba"` no está en el
HTML, y no hay ninguna clase que contenga `cartel`.

- [ ] **Step 3: Crear el módulo CSS**

Crear `components/cartel.module.css`:

```css
/*
 * El cartel: el nombre del local en el header de la aplicación.
 *
 * QUÉ ES. En el login la persiana sube una vez y descubre el cartel con el
 * nombre del local (app/login/persiana.module.css). Adentro, ese cartel se
 * queda: misma cara y mismo eje expandido, más chico, y por encima del <h1>
 * de cada pantalla. La inversión de jerarquía es la decisión y no un accidente
 * de tamaños — "Inventario" no es dónde estás, es dónde estás parado adentro
 * de TU local.
 *
 * POR QUÉ UN MÓDULO CSS Y NO UNA UTILIDAD DE TAILWIND. El @theme de
 * app/globals.css es `inline`: inyecta el valor en las utilidades en vez de
 * emitir la variable, así que var(--font-display) no existiría fuera de una
 * clase de Tailwind. Es el mismo motivo que ya está escrito en globals.css y
 * en persiana.module.css. --font-archivo, en cambio, la emite next/font sobre
 * el <html> y se puede usar directo.
 *
 * POR QUÉ 24 PX. A 20 empata con el <h1> de las pantallas y la inversión no se
 * lee. A 32 la fila crece lo suficiente como para pedir que las pestañas suban
 * a la misma fila, que ya es otro diseño. 24 gana contra el <h1> sin obligar a
 * tocar ninguna pantalla.
 *
 * POR QUÉ EL TRACKING NO ES EL DEL LOGIN. Allá es -0.022em sobre una cara de
 * hasta 88 px; acá son 24, y a este tamaño un tracking tan cerrado empasta.
 */
.cartel {
  font-family: var(--font-archivo), ui-sans-serif, system-ui, sans-serif;
  font-weight: 600;
  font-stretch: 112%;
  font-size: 1.5rem;
  line-height: 1.1;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 4: Aplicarlo en el header**

En `app/(app)/layout.tsx`, agregar el import junto a los que ya están:

```tsx
import estilos from '@/components/cartel.module.css'
```

Y reemplazar la primera fila del header (el `<div className="flex items-center
justify-between px-6 py-3">` entero) por:

```tsx
        <div className="flex items-center justify-between gap-6 px-6 py-3">
          {/* data-testid, y no una clase ni el texto suelto: es el marcador que
              scripts/smoke.sh busca en CADA pantalla autenticada para distinguir
              una página de verdad de un 200 vacío (Next devuelve 200 sirviendo un
              not-found). Borrarlo hace fallar todos los casos de pantalla del
              gate a la vez, y el atributo tiene que quedar ÚLTIMO: el grep busca
              el `>` pegado al nombre.

              El cartel, no una etiqueta: es lo más grande de la aplicación, por
              encima del <h1> de cada pantalla (ver components/cartel.module.css).
              Sigue siendo <span> y no <h1> porque cada pantalla tiene el suyo y
              dos <h1> le mienten al outline del documento — pesa más a la vista
              sin pesar más semánticamente.

              min-w-0 es lo que hace que truncate funcione adentro de un flex, y
              con shrink-0 del otro lado el que cede es el cartel y no el botón
              de salir. */}
          <span
            className={`${estilos.cartel} min-w-0 truncate`}
            title={sesion.tenant.nombre}
            data-testid="tenant-nombre"
          >
            {sesion.tenant.nombre}
          </span>
          <div className="flex shrink-0 items-center gap-3">
            {/* Se mudó desde app/page.tsx cuando `/` pasó a redirigir. Acá lo ve
                el barrido del gate en todas las pantallas, no en una sola.

                12 px y no 14: no es que el usuario importe menos, es que a 14
                competía con el nombre del local. --muted-foreground sobre
                --background da 5.17, y el par no cambia por bajar el tamaño. */}
            <span className="text-xs text-muted-foreground" data-testid="usuario-nombre">
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
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run app/\(app\)/layout.test.tsx`

Expected: PASS, los seis casos viejos incluidos — en especial
`data-testid="tenant-nombre">Local de prueba`, que sigue valiendo porque
`className` y `title` van **antes** del `data-testid`.

**Si el caso del `class="…cartel"` falla** con la clase en `undefined` o vacía,
es que esta versión de vitest no resuelve los módulos CSS con el nombre de la
clase. En ese caso, y sólo en ese caso: borrar ese `it` entero y dejar en su
lugar el comentario

```tsx
  // No hay caso para el tratamiento de display: vitest stubea los módulos CSS
  // y `estilos.cartel` no llega al HTML, así que un test acá no probaría nada.
  // Queda en la verificación a ojo de la spec.
```

No inventar un test que pase sin probar nada, y **no** cambiar el componente
para acomodar al test.

- [ ] **Step 6: Corregir lo que quedó mintiendo — `app/layout.tsx`**

En el comentario de `localFont`, reemplazar estas dos frases:

- `Entra en un solo lugar, el nombre del local en la pantalla de login, que es
  el único momento de marca que tiene el producto: lo que sigue después es una
  herramienta.` →
  `Entra en un solo ROL —el nombre del local— y se ve en dos lugares: el cartel
  del login (app/login/persiana.module.css) y el del header de la aplicación
  (components/cartel.module.css). Ningún otro rol la usa: títulos, tablas,
  botones y campos siguen en la pila del sistema.`
- `La descarga ocurre en el login, no en el punto de venta.` →
  `La descarga ocurre en el login y queda cacheada para el resto de la sesión,
  pero una sesión con cookie viva entra derecho a /vender y ahí paga los 90 KB.`

- [ ] **Step 7: Corregir lo que quedó mintiendo — `app/globals.css`**

Reemplazar el comentario que hoy dice *"No hay --font-display ni --color-marca
acá… Si una segunda pantalla los necesita, ahí entran acá"* por:

```css
  /* No hay --font-display ni --color-marca acá, y sigue siendo a propósito.
     --color-marca lo usa una sola pantalla, el login. --font-display lo usan
     DOS —el cartel del login y el del header de la aplicación— y aun así no
     entra: los dos lo consumen desde un módulo CSS con var(--font-archivo)
     directo, porque además de la familia necesitan font-stretch y tracking
     propios, o sea que ninguna utilidad de Tailwind lo referenciaría igual. Un
     token en @theme que ninguna utilidad referencia es un token muerto, que es
     lo que el caso "no quedan tokens de sidebar ni de gráficos" de
     test/sistema-de-diseno.test.ts existe para evitar. */
```

- [ ] **Step 8: Corregir lo que quedó mintiendo — `docs/sistema-de-diseno.md`**

Tres ediciones en la sección *Tipografía*:

1. Después de la línea `` `--font-heading: var(--font-sans)`: los títulos usan
   la misma familia. ``, insertar:

```markdown
### La escala

Los roles, con su cara y su tamaño. Un texto que no encaja en ninguno de estos
cuatro es señal de que falta una decisión, no de que falte un tamaño.

| Rol | Cara | Tamaño | Peso y ancho |
|---|---|---|---|
| **Cartel** — nombre del local | Archivo | 24 px | 600, `font-stretch: 112%`, tracking −0.01em |
| Título de pantalla (`h1`) | sistema | 20 px | 500 |
| Pestaña de navegación | sistema | 14 px | 500; activa 600 |
| Identidad, meta, pie | sistema | 12 px | 400, `--muted-foreground` |

**El cartel pesa más que el título de la pantalla, y es la decisión.** El nombre
del local es lo más grande de la aplicación: siempre estás adentro de tu local,
y `Inventario` es sólo dónde estás parado. Es la misma jerarquía que declara el
login —el negocio del cliente es el héroe, la plataforma no firma—, sostenida
las ocho horas en vez de los ocho segundos.
```

2. Reemplazar `Se usa para **una cosa**: el nombre del local en la pantalla de
   login. Ninguna otra pantalla la carga.` por `Se usa para **una cosa**: el
   nombre del local. Esa cosa se ve en dos lugares y en dos tamaños — el cartel
   del login y el del header de la aplicación (`components/cartel.module.css`).
   Ningún otro rol la usa.`

3. En la tabla de costo, reemplazar la fila
   `| Dónde pesa | En el login. No en el punto de venta ni en inventario |` por
   `| Dónde pesa | En toda pantalla. En la sesión normal viene cacheada del login, pero una sesión con cookie viva entra derecho a `/vender` y ahí paga los 90 KB |`

- [ ] **Step 9: Correr la suite entera**

Run: `npx vitest run`

Expected: PASS. Importa especialmente `test/sistema-de-diseno.test.ts`, que
parsea ese documento: los cambios son de prosa y de una tabla que el test no
lee —sólo lee las que están entre los marcadores `tokens:` y `contraste:`—,
pero eso hay que verlo en verde, no suponerlo.

- [ ] **Step 10: Commit**

```bash
git add components/cartel.module.css app/\(app\)/layout.tsx app/\(app\)/layout.test.tsx app/layout.tsx app/globals.css docs/sistema-de-diseno.md
git commit -m "feat(shell): el nombre del local es un cartel, no una etiqueta"
```

---

### Task 2: El riel de pestañas

La pestaña activa se apoya en el borde del header en vez de flotar un pixel
arriba, el peso hace la mitad del trabajo que hoy hace sólo el subrayado, y las
pestañas ganan un anillo de foco propio.

**Files:**
- Modify: `components/navegacion.tsx` (el `<nav>` y el `<Link>`, líneas 48-70)
- Test: `components/navegacion.test.tsx`

**Interfaces:**
- Consumes: nada de la Task 1. Se puede hacer antes o después.
- Produces: nada que otra task use. `estaActiva` y la firma
  `Navegacion({ rol }: { rol: RolUsuario })` **no cambian**.

- [ ] **Step 1: Escribir el test que falla**

En `components/navegacion.test.tsx`, agregar dentro del `describe('Navegacion')`:

```tsx
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run components/navegacion.test.tsx`

Expected: FAIL — ninguna pestaña contiene `focus-visible:inset-ring-3`.

- [ ] **Step 3: Escribir la implementación**

En `components/navegacion.tsx`, reemplazar el `<nav>` y el `className` del
`<Link>` por:

```tsx
    /* -mb-px: el subrayado de 2 px de la pestaña activa se SOLAPA con el borde
       inferior del <header> en vez de quedar un pixel arriba, que es lo que
       dibujaba dos líneas paralelas. Es lo que la hace leer como una pestaña
       apoyada en el riel.

       overflow-x-auto: hoy sobra lugar con cuatro pestañas, pero este archivo
       es el punto de extensión que CLAUDE.md promete para el registry de
       módulos — cuando Órdenes de Trabajo sume las suyas, o en un teléfono, sin
       esto se rompe. Ahora sale gratis. */
    <nav className="-mb-px flex items-center gap-1 overflow-x-auto text-sm">
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
              'shrink-0 rounded-sm border-b-2 px-3 py-2 transition-colors outline-none',
              // El anillo va INSET, y el motivo es mecánico: overflow-x-auto
              // computa el eje de bloque a `auto` también, así que un anillo
              // dibujado por fuera de la caja se recortaría arriba y abajo y
              // podría sacar una barra de scroll vertical. Uno interior no lo
              // toca el overflow.
              'focus-visible:inset-ring-3 focus-visible:inset-ring-ring/50',
              activa
                // El peso hace la mitad del trabajo: así el subrayado no tiene
                // que hacerlo todo, y de paso la pestaña activa y el anillo de
                // foco no se confunden, porque no comparten forma (una barra
                // recta abajo contra un halo alrededor del texto). Los dos son
                // --primary; lo que los distingue es la forma, no el color.
                ? 'border-primary font-semibold text-foreground'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {p.texto}
          </Link>
        )
      })}
    </nav>
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run components/navegacion.test.tsx app/\(app\)/layout.test.tsx`

Expected: PASS. El caso de `aria-current` que ya existía tiene que seguir en
verde: `aria-current` no se tocó.

- [ ] **Step 5: Verificar que la utilidad existe de verdad**

`inset-ring-*` es de Tailwind v4 y el repo tiene 4.3.3, pero una clase que
Tailwind no reconoce **no rompe nada**: no genera CSS y no avisa. O sea que el
test del Step 1 puede quedar en verde con el foco invisible.

Run: `npx next build`

Después: `grep -r "inset-ring" .next/static/css/ | head`

Expected: aparece al menos una regla con `inset-ring` o el `box-shadow` inset
que Tailwind genera para esa utilidad. **Si no aparece nada**, reemplazar las
dos clases del Step 3 por el equivalente explícito, que no depende de que la
utilidad exista:

```tsx
              'focus-visible:shadow-[inset_0_0_0_3px_color-mix(in_srgb,var(--ring)_50%,transparent)]',
```

...y actualizar el test del Step 1 para que busque `focus-visible:shadow-`
en vez de `focus-visible:inset-ring-3`.

- [ ] **Step 6: Commit**

```bash
git add components/navegacion.tsx components/navegacion.test.tsx
git commit -m "feat(navegacion): la pestaña activa se apoya en el riel, y el foco se ve"
```

---

### Task 3: El pie

`stack · sha` deja de compartir fila con la navegación y baja al pie de la
página.

**Files:**
- Modify: `app/(app)/layout.tsx` (fila 2 del header y el cierre del layout)
- Modify: `docs/sistema-de-diseno.md` (sección *Espaciado y radio*)
- Test: `app/(app)/layout.test.tsx`

**Interfaces:**
- Consumes: `Contexto` de `@/components/contexto`, que ya está importado en
  `app/(app)/layout.tsx` y **no cambia**: sigue siendo
  `Contexto({ className }: { className?: string })` y sigue emitiendo
  `data-testid="stack"` y `data-testid="sha"`.
- Produces: nada.

- [ ] **Step 1: Escribir el test que falla**

En `app/(app)/layout.test.tsx`, reemplazar el caso
`it('muestra el stack y la imagen desplegada', …)` por:

```tsx
  // Mira ORDEN en el documento y no clases ni estilos: es la forma no frágil
  // de afirmar que el stack y el sha bajaron al pie. Compartían fila con las
  // pestañas siendo un artefacto de deploy, y sin este caso alguien los
  // devuelve al header y la suite queda verde.
  it('muestra el stack y la imagen desplegada, al pie y no en el header', async () => {
    const html = await render()
    expect(html).toContain('data-testid="stack"')
    expect(html).toContain('data-testid="sha"')
    expect(html.indexOf('contenido')).toBeLessThan(html.indexOf('data-testid="stack"'))
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run app/\(app\)/layout.test.tsx`

Expected: FAIL en la comparación de índices — hoy el `stack` va en el header,
o sea **antes** del contenido.

- [ ] **Step 3: Escribir la implementación**

En `app/(app)/layout.tsx`, reemplazar la segunda fila del header y el cierre
del layout. Queda así, desde el `</div>` que cierra la primera fila:

```tsx
        <div className="px-6">
          <Navegacion rol={sesion.usuario.rol} />
        </div>
      </header>
      <div className="flex-1">{children}</div>
      {/* El stack y el sha son la verificación humana más barata que hay
          después de un deploy, y tienen que seguir a la vista — pero son un
          artefacto de deploy, no navegación. Compartían fila con las pestañas
          siendo el segundo bloque más ancho del header; acá informan sin
          competir. Los data-testid viajan intactos: los mira
          app/(app)/layout.test.tsx. */}
      <footer className="px-6 py-3">
        <Contexto className="text-right text-xs text-muted-foreground" />
      </footer>
    </div>
  )
}
```

El `<div className="px-6">` pierde el `flex items-center justify-between` que
tenía: ya no hay dos cosas que separar en esa fila, sólo el riel.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run app/\(app\)/layout.test.tsx`

Expected: PASS, los seis casos.

- [ ] **Step 5: Escribir el eje izquierdo en el sistema de diseño**

En `docs/sistema-de-diseno.md`, sección *Espaciado y radio*, después de la
tabla de densidad, agregar:

```markdown
**El eje izquierdo del shell.** Cartel, pestañas, contenido y pie arrancan
todos en el mismo gutter de 24 px (`px-6` en `app/(app)/layout.tsx`, `p-6` en
cada pantalla). Hoy coinciden porque cada pantalla eligió lo mismo por su
cuenta; queda escrito para que la próxima no invente otro y parta la columna.
```

- [ ] **Step 6: Correr la suite entera**

Run: `npx vitest run`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/layout.tsx app/\(app\)/layout.test.tsx docs/sistema-de-diseno.md
git commit -m "feat(shell): el stack y el sha bajan al pie"
```

---

### Task 4: Cierre

Ninguna línea de código nueva: el gate local completo, y la lista de lo que
ningún test puede responder.

**Files:** ninguno que se modifique salvo que algo falle.

**Interfaces:**
- Consumes: las tres tasks anteriores, commiteadas.
- Produces: nada.

- [ ] **Step 1: El gate local**

Run: `npm test`

Expected: PASS. Corre primero `scripts/tests/correr-todos.sh` (los tests de
shell) y después la suite de vitest entera — es la primera etapa del gate de
`deploy.sh`.

- [ ] **Step 2: Lint y typecheck**

Run: `npm run lint && npx tsc --noEmit`

Expected: sin errores. El import de un módulo CSS (`import estilos from
'@/components/cartel.module.css'`) lo tipa `next-env.d.ts`; si `tsc` se queja
de que no encuentra el módulo, es que `next-env.d.ts` no está en el `include`
del `tsconfig.json` — verificarlo antes de agregar un `.d.ts` a mano.

- [ ] **Step 3: Build**

Run: `npx next build`

Expected: build exitoso. Es lo que compila los módulos CSS de verdad; vitest
no los compila.

- [ ] **Step 4: Verificación a ojo, en `arandano-dev`**

Levantar el stack de desarrollo y entrar con el tenant de prueba
(`docs/runbook-stacks.md` tiene los comandos). Esto **no** lo puede responder
ningún test, y es lo que decide si la dirección funcionó:

- [ ] El cartel se lee como un cartel y no como un `<h1>` grande. Es la
      pregunta que decide todo el ciclo.
- [ ] **El salto de fuente**: entrar a `/vender` con la caché vacía y una
      sesión con cookie viva, sin pasar por el login. Con `display: swap` el
      nombre aparece en la pila del sistema y salta a Archivo, y a 24 px eso se
      ve. `adjustFontFallback` ya está activo —es *opt-out* en
      `next/font/local`, no algo que haya que prender—, así que el swap ya
      viene compensado en métricas y lo que se ve es un cambio de forma de
      glifo, no de layout. Si igual molesta, la perilla real es
      `display: 'optional'` o `'block'` en el `localFont` de `app/layout.tsx`
      — **no** bajar el tamaño del cartel.
- [ ] Tabular por las pestañas: que el anillo de foco no se confunda con la
      pestaña activa, y que no aparezca una barra de scroll vertical en el riel.
- [ ] Un nombre de local largo en 360 px de ancho: que trunque el cartel y no
      empuje a Salir fuera de la pantalla.
- [ ] La franja no se ve plana. Si se ve plana, los dos ajustes que la spec
      dejó anotados, en este orden: pintar el header de `--muted`, o la
      persiana enrollada.

- [ ] **Step 5: Anotar lo que la verificación haya encontrado**

Si algo del Step 4 falla, **no** arreglarlo acá sin decirlo: anotarlo y
preguntar. Un ajuste de color o de material sale del alcance que esta spec
eligió (tipografía y nada más) y es una decisión, no un fix.

---

## Notas de deploy

Sale como **PATCH** (`v1.MINOR.PATCH+1`), y la spec deja escrito el juicio: es
visible pero no es pantalla nueva, módulo ni feature. La numeración la deriva
`deploy.sh` del último tag; no se toca a mano.

El riesgo real no es visual sino el grep del gate sobre `tenant-nombre`, y ése
falla ruidoso en `arandano-stage` antes de tocar producción.
