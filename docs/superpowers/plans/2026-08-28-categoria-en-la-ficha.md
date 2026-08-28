# La categoría en la ficha del artículo — plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para implementar tarea por tarea. Los pasos usan
> checkbox (`- [ ]`) para el seguimiento.

**Goal:** que el dueño pueda cambiarle la categoría y la marca a un artículo ya
cargado, eligiendo del árbol como en el alta, en vez de tipear texto libre con un
middot que no está en el teclado.

**Architecture:** el par de selectores encadenados que hoy vive adentro de
`FormularioDeAlta` sale a un componente propio (`SelectorDeCategoria`) que usan
las dos pantallas; `editarArticulo` deja de recibir texto y recibe el id de la
rama, resolviéndolo con `ramaElegida` dentro de su transacción; y elegir rama
pasa a pedir `ARTICULOS_EDITAR` en vez de `CATEGORIAS`, que queda significando
sólo administrar el árbol.

**Tech Stack:** Next.js App Router (server actions), React 19, shadcn/ui sobre
Radix, Prisma 7 + Postgres con RLS, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-categoria-en-la-ficha-design.md`

## Global Constraints

- **Sin migración.** Este ciclo no toca `prisma/schema.prisma` ni agrega archivos
  en `prisma/migrations/`. Si algo parece necesitar una, es señal de que se
  entendió mal el plan.
- **`Articulo.categoria` (el texto) se sigue escribiendo**, derivado de la rama.
  Rige el expand/contract del ciclo del modelo: el `DROP COLUMN` es un deploy
  posterior, no éste.
- **El catálogo de permisos no crece**: sigue en siete, los de
  `lib/permisos/catalogo.ts`. Este ciclo cambia *cuál* se pide para elegir rama,
  no agrega ninguno.
- **Nada de `$queryRaw` en código de aplicación** para leer datos de tenant: la
  extensión de `lib/tenant/prisma.ts` intercepta operaciones de modelo, no raw
  queries, así que una consulta cruda sin la GUC choca contra RLS y devuelve cero
  filas en silencio. (En los tests, `owner` sí consulta crudo a propósito: conecta
  como dueño de las tablas, fuera de RLS.)
- **El texto de la aplicación va en español rioplatense**, voseo, como el resto de
  las pantallas ("Elegí una categoría", no "Elige una categoría").
- **Radix no renderiza `SelectContent` ni los `SelectItem` en markup estático** —
  comprobado en este repo con `renderToStaticMarkup`: sale el `<button>` del
  trigger y nada más. Ningún test de estos archivos puede afirmar qué opciones
  ofrece un `Select`. Lo que sí se puede afirmar es el `<input type="hidden">` que
  el componente emite, y ahí es donde van las aserciones.

---

### Task 1: `SelectorDeCategoria`, extraído del alta

Saca el par de selectores de `FormularioDeAlta` a un componente propio, sin
cambiarle nada visible al alta, y le agrega las dos capacidades que la ficha va a
necesitar: precargar una rama existente y volver a "sin categoría".

**Files:**
- Create: `app/(app)/inventario/selector-categoria.tsx`
- Create: `app/(app)/inventario/selector-categoria.test.tsx`
- Modify: `app/(app)/inventario/formularios.tsx` (borra el bloque de categoría de
  `FormularioDeAlta` y lo reemplaza por el componente; saca los imports de
  `Select*` y `Link` si dejan de usarse ahí)
- Modify: `app/(app)/inventario/formularios.test.tsx` (el `describe` "los
  selectores de categoría del alta" se muda al test nuevo)

**Interfaces:**
- Consumes: `RamaConHijas` de `@/lib/inventario/categorias` (ya existe:
  `{ id, nombre, cuenta, hijas: { id, nombre, cuenta }[] }`).
- Produces:
  ```ts
  export function SelectorDeCategoria(props: {
    arbol: RamaConHijas[]
    categoriaIdInicial?: string | null   // default null
    orientacion?: 'fila' | 'columna'     // default 'fila'
  }): React.JSX.Element
  ```
  Emite dos `<input type="hidden">`, `name="categoriaId"` (el rubro) y
  `name="marcaId"` (la marca), con cadena vacía cuando no hay elección. Los ids de
  los triggers son `categoriaId` y `marcaId`, como hoy.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `app/(app)/inventario/selector-categoria.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SelectorDeCategoria } from './selector-categoria'

const ARBOL = [
  { id: 'id-cables', nombre: 'Cables', cuenta: 3, hijas: [] },
  {
    id: 'id-fundas', nombre: 'Fundas', cuenta: 12,
    hijas: [{ id: 'id-apple', nombre: 'Apple', cuenta: 7 }],
  },
]

/**
 * Radix no renderiza `SelectContent` ni sus `SelectItem` en markup estático:
 * sale el `<button>` del trigger y un `<select>` oculto, nada más. Así que lo
 * que este archivo afirma NO son las opciones ofrecidas —no se puede— sino los
 * dos `<input type="hidden">` que el componente emite, que es lo que de verdad
 * viaja al servidor.
 */
function oculto(html: string, nombre: string): string | null {
  const m = html.match(
    new RegExp(`<input type="hidden" name="${nombre}" value="([^"]*)"`),
  )
  return m === null ? null : m[1]
}

function render(categoriaIdInicial: string | null = null) {
  return renderToStaticMarkup(
    <SelectorDeCategoria arbol={ARBOL} categoriaIdInicial={categoriaIdInicial} />,
  )
}

describe('SelectorDeCategoria', () => {
  it('sin rama inicial, los dos campos viajan vacíos', () => {
    const html = render(null)
    expect(oculto(html, 'categoriaId')).toBe('')
    expect(oculto(html, 'marcaId')).toBe('')
  })

  // El caso que la ficha necesita y el alta nunca tuvo: el artículo ya cuelga
  // de una HOJA, así que hay que precargar los DOS selectores — el rubro es el
  // padre de esa hoja, que el componente tiene que deducir del árbol.
  it('con una hoja, precarga el rubro padre y la marca', () => {
    const html = render('id-apple')
    expect(oculto(html, 'categoriaId')).toBe('id-fundas')
    expect(oculto(html, 'marcaId')).toBe('id-apple')
  })

  // "Cables" sin marca es una rama válida (CLAUDE.md, ciclo del modelo): un
  // artículo puede colgar de una RAÍZ, y ahí la marca queda vacía.
  it('con una raíz, precarga sólo el rubro', () => {
    const html = render('id-cables')
    expect(oculto(html, 'categoriaId')).toBe('id-cables')
    expect(oculto(html, 'marcaId')).toBe('')
  })

  // Defensivo, y no teórico: entre que la pantalla se dibuja y alguien la mira,
  // otra pestaña puede haber borrado la rama desde el panel. Un id que el árbol
  // no conoce no puede dejar los selectores en un estado imposible.
  it('un id que no está en el árbol queda como sin categoría', () => {
    const html = render('id-que-ya-no-existe')
    expect(oculto(html, 'categoriaId')).toBe('')
    expect(oculto(html, 'marcaId')).toBe('')
  })

  it('el selector de marca nace deshabilitado sin rubro elegido', () => {
    const html = render(null)
    // El `<button>` del trigger, no un selector de atributos en orden: Radix
    // emite `disabled` ANTES del `id`, así que un regex que los pida en ese
    // orden pasa por casualidad o falla por casualidad.
    const trigger = html.slice(html.lastIndexOf('<button', html.indexOf('id="marcaId"')))
    expect(trigger).toContain('disabled')
  })

  // Con rubro elegido y marcas disponibles, el segundo selector se habilita.
  it('con un rubro que tiene marcas, el selector de marca se habilita', () => {
    const html = render('id-fundas')
    const trigger = html.slice(html.lastIndexOf('<button', html.indexOf('id="marcaId"')))
    const cierre = trigger.indexOf('>')
    expect(trigger.slice(0, cierre)).not.toContain('disabled')
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run app/\(app\)/inventario/selector-categoria.test.tsx`
Expected: FAIL — `Failed to resolve import "./selector-categoria"`.

- [ ] **Step 3: Escribir el componente**

Crear `app/(app)/inventario/selector-categoria.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import type { RamaConHijas } from '@/lib/inventario/categorias'

/**
 * Radix no admite un `SelectItem` con `value=""` —lo rechaza en runtime—, así
 * que "sin categoría" necesita un valor propio que nunca pueda ser un uuid.
 * Se traduce a cadena vacía antes de tocar el estado, así que este string no
 * sale nunca del componente.
 */
const SIN = '__sin__'

/**
 * Los dos selectores encadenados Categoría → Marca, compartidos por
 * `/inventario/nuevo` y `/inventario/[id]`.
 *
 * **Existe como componente propio justamente por el defecto que este ciclo
 * arregla**: hasta hoy el alta tenía los dos selectores y la ficha un campo de
 * texto, porque eran dos implementaciones del mismo control y una se quedó
 * atrás (`docs/correcciones-pendientes-del-pen.md`, entrada 7). Con un solo
 * componente, esa divergencia no se puede repetir.
 *
 * **Emite `<input type="hidden">` en vez de apoyarse en el `name` del
 * `<Select>` de Radix.** Con `name`, Radix renderiza un `<select>` oculto y el
 * valor sale de él — alcanza mientras "sin categoría" sea la ausencia de
 * elección, que es el caso del alta, que arranca vacía. En la ficha no alcanza:
 * un artículo que YA tiene rama necesita poder volver a "sin categoría", y para
 * eso hace falta un item explícito, que Radix no deja que valga "". Con inputs
 * propios el centinela se traduce acá adentro y al servidor le llega cadena
 * vacía, como siempre.
 */
export function SelectorDeCategoria({
  arbol,
  categoriaIdInicial = null,
  orientacion = 'fila',
}: {
  arbol: RamaConHijas[]
  categoriaIdInicial?: string | null
  orientacion?: 'fila' | 'columna'
}) {
  const inicial = ramaInicial(arbol, categoriaIdInicial)
  /**
   * El rubro elegido, que es lo que decide qué marcas ofrece el segundo
   * selector. Cambiar de rubro tiene que LIMPIAR la marca: dejarla puesta
   * guardaría una marca que pertenece a otro rubro, y el servidor la aceptaría
   * sin chistar porque el id existe.
   */
  const [rubroId, setRubroId] = useState<string>(inicial.rubroId)
  const [marcaId, setMarcaId] = useState<string>(inicial.marcaId)
  const marcasDelRubro = arbol.find((r) => r.id === rubroId)?.hijas ?? []

  return (
    <>
      <input type="hidden" name="categoriaId" value={rubroId} />
      <input type="hidden" name="marcaId" value={marcaId} />
      <div className={orientacion === 'fila' ? 'flex gap-3' : 'flex flex-col gap-2'}>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="categoriaId">Categoría</Label>
          <Select
            // `value` puede ser cadena vacía y ahí Radix muestra el
            // placeholder — es lo que el alta ya hace hoy. Lo que Radix NO
            // admite es un `SelectItem` con `value=""`, de ahí el centinela.
            // Pasar `undefined` en su lugar convertiría el Select en no
            // controlado y React avisaría del cambio de modo.
            value={rubroId}
            onValueChange={(v) => {
              setRubroId(v === SIN ? '' : v)
              setMarcaId('')
            }}
          >
            <SelectTrigger id="categoriaId" className="h-10 w-full rounded-[9px]">
              <SelectValue placeholder="Sin categoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN}>Sin categoría</SelectItem>
              {arbol.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <Label htmlFor="marcaId">Marca</Label>
          <Select
            value={marcaId}
            onValueChange={(v) => setMarcaId(v === SIN ? '' : v)}
            // Deshabilitado y no vacío-y-clickeable: un selector que se abre
            // para no mostrar nada invita a buscar algo que no está.
            disabled={marcasDelRubro.length === 0}
          >
            <SelectTrigger id="marcaId" className="h-10 w-full rounded-[9px]">
              <SelectValue placeholder={rubroId === '' ? 'Elegí una categoría' : 'Sin marca'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN}>Sin marca</SelectItem>
              {marcasDelRubro.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[11px] leading-[1.4] text-muted-foreground">
        Las categorías se crean y se ordenan en{' '}
        <Link href="/inventario" className="underline">
          el panel de Inventario
        </Link>
        .
      </p>
    </>
  )
}

/**
 * De qué rama cuelga el artículo, traducido a los dos selectores.
 *
 * Un artículo puede colgar de una RAÍZ o de una HOJA, indistinto (CLAUDE.md,
 * ciclo del modelo), así que hay que probar las dos formas. Un id que el árbol
 * no conoce —otra pestaña borró la rama entre que la pantalla se dibujó y
 * alguien la miró— cae en "sin categoría" en vez de dejar los selectores en un
 * estado imposible.
 */
function ramaInicial(
  arbol: RamaConHijas[],
  categoriaId: string | null,
): { rubroId: string; marcaId: string } {
  if (!categoriaId) return { rubroId: '', marcaId: '' }

  const comoRaiz = arbol.find((r) => r.id === categoriaId)
  if (comoRaiz) return { rubroId: comoRaiz.id, marcaId: '' }

  const padre = arbol.find((r) => r.hijas.some((h) => h.id === categoriaId))
  if (padre) return { rubroId: padre.id, marcaId: categoriaId }

  return { rubroId: '', marcaId: '' }
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run app/\(app\)/inventario/selector-categoria.test.tsx`
Expected: PASS, 6 casos.

- [ ] **Step 5: Usar el componente en el alta**

En `app/(app)/inventario/formularios.tsx`, dentro de `FormularioDeAlta`, borrar
el bloque que va desde el comentario `{/* Dos selectores y no un campo de
texto…` hasta el `</p>` que cierra la nota del panel de Inventario (hoy son el
`<div className="flex gap-3">` con los dos `<Select>` más el `<p>` del link), y
dejar en su lugar:

```tsx
            {/* El par de selectores vive en su propio componente desde el ciclo
                de la categoría en la ficha: la ficha usa el MISMO, que es lo
                que impide que las dos pantallas vuelvan a divergir. */}
            <SelectorDeCategoria arbol={arbol} />
```

Borrar del componente el estado que se mudó — `rubroId`, `marcaId`,
`marcasDelRubro` y sus `useState`— y agregar el import:

```tsx
import { SelectorDeCategoria } from './selector-categoria'
```

Sacar de los imports de `formularios.tsx` lo que quede sin uso. **Comprobarlo,
no asumirlo**: `Link` lo usan también los botones "Cancelar" del alta, y
`Select*` puede seguir usándose en otro lado del archivo. `npm run lint` marca
los que sobren.

- [ ] **Step 6: Mudar el `describe` de los selectores del alta**

En `app/(app)/inventario/formularios.test.tsx`, borrar entero el `describe('los
selectores de categoría del alta', …)`: sus dos casos —que ofrece
`name="categoriaId"`/`name="marcaId"` y no `name="categoria"`, y que la marca
nace deshabilitada— ya están cubiertos, con más casos, en
`selector-categoria.test.tsx`.

**Conservar** en `formularios.test.tsx` el caso `'la categoría es opcional'` del
`describe('FormularioDeAlta')`: afirma que el alta ENTERA sigue dejando guardar
sin categoría, que es sobre el formulario y no sobre el selector. Reescribirlo
para que no dependa del `<select>` oculto de Radix, que ya no existe:

```tsx
  // La categoría se elige, no se tipea, desde que existe el árbol; el detalle
  // del control vive en selector-categoria.test.tsx. Este caso conserva lo
  // único que es del FORMULARIO y no del selector: que sigue siendo OPCIONAL.
  it('la categoría es opcional', async () => {
    const html = await renderAlta()
    expect(html).toContain('name="categoriaId"')
    expect(html).not.toMatch(/name="categoriaId"[^>]*required/)
  })
```

- [ ] **Step 7: Correr el gate y verificar que el alta no cambió**

Run: `npx vitest run app/\(app\)/inventario/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores (en particular, ningún import sin usar en
`formularios.tsx`).

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/inventario/selector-categoria.tsx app/\(app\)/inventario/selector-categoria.test.tsx app/\(app\)/inventario/formularios.tsx app/\(app\)/inventario/formularios.test.tsx
git commit -m "refactor(categoría): el par de selectores sale a su propio componente

El alta no cambia. El componente suma lo que la ficha necesita: precargar
la rama de un artículo que ya la tiene, y una opción explícita para volver
a sin categoría, que con el \`name\` de Radix no se podía expresar."
```

---

### Task 2: el servidor y la ficha

Las dos mitades van en **un solo commit** a propósito: si el servidor pasara a
leer `categoriaId` mientras la ficha todavía manda `categoria`, la ficha
borraría la categoría de todo artículo que alguien guardara en el medio; y al
revés, la ficha mandaría un id que nadie lee. No hay orden en que se puedan
separar dejando el árbol sano.

**Files:**
- Modify: `lib/inventario/articulos.ts` (`editarArticulo`)
- Modify: `app/(app)/inventario/acciones.ts` (`guardarArticulo`)
- Modify: `app/(app)/inventario/formularios.tsx` (`FichaDeArticulo`)
- Modify: `app/(app)/inventario/[id]/page.tsx`
- Test: `test/inventario.test.ts`, `app/(app)/inventario/acciones.test.ts`,
  `app/(app)/inventario/formularios.test.tsx`,
  `app/(app)/inventario/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `SelectorDeCategoria` (Task 1); `ramaElegida(tx, categoriaId)` de
  `@/lib/inventario/categorias`, que ya existe y devuelve
  `Promise<{ id: string; texto: string }>`, tirando `CATEGORIA_INEXISTENTE` si el
  id no resuelve en este tenant; `arbolDeCategorias(tenantId, { verInactivos })`,
  que devuelve `Promise<RamaConHijas[]>`.
- Produces:
  ```ts
  // lib/inventario/articulos.ts
  export async function editarArticulo(entrada: {
    tenantId: string
    articuloId: string
    nombre: string
    sku: string
    precio: Decimal
    categoriaId: string | null   // REQUERIDO, ver el docblock
  }): Promise<void>
  ```
  y `FichaDeArticulo` cambia su prop `categoria: string | null` por
  `arbol: RamaConHijas[]` + `categoriaId: string | null`.

- [ ] **Step 1: Escribir los tests que fallan en `test/inventario.test.ts`**

Agregar arriba, al lado de `categoriaDe` (línea 39), el helper que hace falta
para elegir una rama por id:

```ts
/** El id de la rama de la que cuelga un artículo. Desde que la categoría se
 *  ELIGE en vez de tipearse, los tests necesitan ids, y la forma barata de
 *  conseguir uno es crear la rama con el camino de texto —que sigue vivo para
 *  el seed— y leer a dónde quedó apuntando. */
async function categoriaIdDe(articuloId: string): Promise<string> {
  const { rows } = await owner.query(
    `SELECT categoria_id FROM articulos WHERE id = $1`,
    [articuloId],
  )
  return rows[0].categoria_id
}
```

Reemplazar el caso `'edita la categoría, incluido vaciarla de vuelta a null'`
(línea 556) por:

```ts
  it('edita la categoría eligiendo una rama, incluido vaciarla de vuelta a null', async () => {
    // Las dos ramas se crean por el camino de TEXTO, que sigue siendo el del
    // seed: acá sólo hacen falta para tener ids que elegir.
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Con categoría', tipo: 'PRODUCTO', precio: d('100'),
      categoria: 'Repuestos',
    })
    const destino = await crearArticulo({
      tenantId, usuarioId, nombre: 'Marca el destino', tipo: 'PRODUCTO', precio: d('100'),
      categoria: 'Audio',
    })

    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Con categoría', sku: a.sku, precio: d('100'),
      categoriaId: await categoriaIdDe(destino.id),
    })
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBe('Audio')

    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Con categoría', sku: a.sku, precio: d('100'),
      categoriaId: null,
    })
    const vacia = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(vacia.rows[0].categoria).toBeNull()
  })
```

Reemplazar el caso `'la edición mueve el artículo de rama'` (línea 744) por:

```ts
  it('la edición mueve el artículo a la rama elegida y escribe el texto canónico', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cargador 33W', tipo: 'PRODUCTO', precio: d('12000'),
      categoria: 'Cables',
    })
    const destino = await crearArticulo({
      tenantId, usuarioId, nombre: 'Marca el destino', tipo: 'PRODUCTO', precio: d('12000'),
      categoria: 'Cargadores · Xiaomi',
    })

    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Cargador 33W', sku: a.sku, precio: d('12000'),
      categoriaId: await categoriaIdDe(destino.id),
    })

    expect(await categoriaDe(a.id)).toEqual({ nombre: 'Xiaomi', padre: 'Cargadores' })
    // Y el TEXTO, que sigue vivo hasta el contract, con la forma canónica de la
    // rama y no con lo que alguien haya tipeado.
    const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
    expect(rows[0].categoria).toBe('Cargadores · Xiaomi')
  })
```

Reemplazar el caso `'y vaciar la categoría al editar despeja las dos columnas'`
(línea 760) por su versión con id:

```ts
  // Vaciar despeja las dos columnas a la vez. Dejar `categoria_id` apuntando a
  // la rama vieja con el texto ya en null sería el peor de los dos mundos: la
  // pantalla diría "sin categoría" y el árbol lo seguiría contando adentro de
  // "Cables".
  it('y vaciar la categoría al editar despeja las dos columnas', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Se despeja', tipo: 'PRODUCTO', precio: d('1000'),
      categoria: 'Cables',
    })
    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Se despeja', sku: a.sku, precio: d('1000'),
      categoriaId: null,
    })
    expect(await categoriaDe(a.id)).toBeNull()
    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [a.id],
    )
    expect(rows[0].categoria).toBeNull()
    expect(rows[0].categoria_id).toBeNull()
  })
```

Agregar el caso nuevo que cubre el borde de RLS, en el mismo `describe`:

```ts
  // Una rama de OTRO tenant no resuelve a ninguna fila —RLS la vuelve
  // invisible— así que tiene que salir como error de dominio y no como una FK
  // reventando con un código que nadie atrapa. `ramaElegida` es quien lo
  // decide; este caso fija que `editarArticulo` la use de verdad.
  it('rechaza una rama que no existe en este tenant', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'No se mueve', tipo: 'PRODUCTO', precio: d('100'),
    })
    await expect(
      editarArticulo({
        tenantId, articuloId: a.id, nombre: 'No se mueve', sku: a.sku, precio: d('100'),
        categoriaId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toMatchObject({ codigo: 'CATEGORIA_INEXISTENTE' })
  })
```

Y agregar `categoriaId: null` a las cuatro llamadas de `editarArticulo` que hoy
omiten el campo — líneas 541 (`'cambia nombre, SKU y precio'`), 584
(`'rechaza mover el SKU a uno ya usado'`), 593 (`'rechaza un SKU vacío'`) y 634
(`'un id malformado…'`). Los cuatro artículos se crean sin categoría, así que
`null` no cambia lo que el caso afirma.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `npx vitest run test/inventario.test.ts`
Expected: FAIL — `tsc` dentro de vitest se queja de `categoriaId` no existiendo
en el tipo del parámetro, y los casos nuevos no pasan.

- [ ] **Step 3: Implementar `editarArticulo`**

En `lib/inventario/articulos.ts`, reemplazar el docblock y la firma de
`editarArticulo` (desde el comentario que arranca `/** * El tipo NO está y no es
un olvido…` hasta el cierre de la función) por:

```ts
/**
 * El tipo NO está y no es un olvido: ver el comentario del test.
 *
 * **`categoriaId` es la rama ELEGIDA, y va requerido, no opcional.** Antes este
 * parámetro era `categoria?: string | null` —texto libre— y su `undefined`
 * significaba "no toques la categoría". Esa tri-estado existía por una sola
 * razón: era la forma de que alguien con `ARTICULOS_EDITAR` y sin `CATEGORIAS`
 * no creara ramas al vuelo tipeando. Desde que la categoría se ELIGE de un
 * árbol que ya existe no hay nada que crear, así que la distinción se quedó sin
 * motivo — y dejarla como opcional la traería de vuelta por la ventana: un
 * llamador que omitiera el campo por descuido no daría ningún error y no
 * tocaría la categoría en silencio. Requerido, `tsc` marca al que no lo diga.
 *
 * `null` vacía las dos columnas a la vez. Dejar `categoria_id` apuntando a la
 * rama vieja con el texto ya en null sería el peor de los dos mundos: la
 * pantalla diría "sin categoría" y el árbol lo seguiría contando adentro.
 */
export async function editarArticulo(entrada: {
  tenantId: string
  articuloId: string
  nombre: string
  sku: string
  precio: Decimal
  categoriaId: string | null
}): Promise<void> {
  const { tenantId, articuloId, precio, categoriaId } = entrada

  const nombre = exigirNombre(entrada.nombre)
  exigirPrecio(precio)

  const sku = entrada.sku.trim()
  if (sku === '') {
    // No se autogenera acá: el artículo ya tiene un código, y vaciar el campo
    // es más probablemente un error de la persona que un pedido de uno nuevo.
    throw new ErrorDeInventario('SKU_VACIO', 'el código no puede quedar vacío')
  }

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      // Adentro de la MISMA transacción que el update, igual que en
      // `crearArticulo`: `ramaElegida` valida que la rama exista en este tenant
      // —un id de otro tenant no resuelve a ninguna fila, RLS lo vuelve
      // invisible— y devuelve el texto canónico para la columna que sigue viva
      // hasta el contract.
      const rama: { id: string | null; texto: string | null } = categoriaId
        ? await ramaElegida(tx, categoriaId)
        : { id: null, texto: null }

      // `updateMany` y no `update`: con RLS, un id de otro tenant no existe
      // para esta conexión, y `update` tira P2025 — un error de Prisma sin
      // `codigo`. Contar filas afectadas deja decirlo con el error del módulo.
      const { count } = await tx.articulo.updateMany({
        where: { id: articuloId },
        data: { nombre, sku, precio, categoriaId: rama.id, categoria: rama.texto },
      })
      if (count === 0) {
        throw new ErrorDeInventario(
          'ARTICULO_INEXISTENTE',
          `el artículo ${articuloId} no existe en este tenant`,
        )
      }
    })
  } catch (e) {
    if (esSkuRepetido(e)) {
      throw new ErrorDeInventario('SKU_REPETIDO', `el código ${sku} ya está usado`)
    }
    throw traducirErrorDeBase(e)
  }
}
```

`asegurarCategoria` y `limpiarCategoria` siguen importados y usados por
`crearArticulo`; `ramaElegida` ya está en el import de `'./categorias'`. No hace
falta tocar los imports.

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run test/inventario.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir los tests que fallan en `acciones.test.ts`**

Agregar el helper que consigue un id de rama, al lado de
`crearArticuloDePrueba` (línea 204):

```ts
/** Una rama del árbol de este tenant, creada directo por SQL de dueño. Devuelve
 *  su id, que es lo que la pantalla manda desde que la categoría se elige. */
async function crearCategoriaDePrueba(nombre: string, padreId: string | null = null): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $3, now(), now())
     RETURNING id`,
    [estado.tenantId, nombre, padreId],
  )
  return rows[0].id
}
```

Reemplazar el caso `'un DUEÑO edita la categoría de un artículo, y la ficha la
deja editar'` (línea 437) por:

```ts
  it('un DUEÑO mueve un artículo a la rama elegida, y se escriben las dos columnas', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Para editar categoría')
    const rubro = await crearCategoriaDePrueba('Repuestos')
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Para editar categoría')
    datos.set('sku', 'ACC-CAT-1')
    datos.set('precio', '2500')
    datos.set('categoriaId', rubro)
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [id],
    )
    expect(rows[0].categoria).toBe('Repuestos')
    expect(rows[0].categoria_id).toBe(rubro)
  })

  // La misma regla que ya tiene el alta: la rama más específica es la que el
  // artículo tiene que ocupar. Sin esto, elegir "Fundas" y después "Apple"
  // dejaría el artículo colgado del rubro y la marca elegida se perdería.
  it('la marca gana sobre el rubro cuando llegan las dos', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Rubro y marca')
    const rubro = await crearCategoriaDePrueba('Fundas')
    const marca = await crearCategoriaDePrueba('Apple', rubro)
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Rubro y marca')
    datos.set('sku', 'ACC-CAT-2')
    datos.set('precio', '2500')
    datos.set('categoriaId', rubro)
    datos.set('marcaId', marca)
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [id],
    )
    expect(rows[0].categoria_id).toBe(marca)
    expect(rows[0].categoria).toBe('Fundas · Apple')
  })

  it('los dos campos vacíos dejan el artículo sin categoría', async () => {
    estado.cookie = cookieDuenio
    const id = await crearArticuloDePrueba('Se queda sin rama')
    const rubro = await crearCategoriaDePrueba('Cables')
    await owner.query(
      `UPDATE articulos SET categoria = 'Cables', categoria_id = $2 WHERE id = $1`,
      [id, rubro],
    )
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Se queda sin rama')
    datos.set('sku', 'ACC-CAT-3')
    datos.set('precio', '2500')
    datos.set('categoriaId', '')
    datos.set('marcaId', '')
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(
      `SELECT categoria, categoria_id FROM articulos WHERE id = $1`, [id],
    )
    expect(rows[0].categoria).toBeNull()
    expect(rows[0].categoria_id).toBeNull()
  })
```

Reemplazar el caso `'un EMPLEADO con ARTICULOS_EDITAR y sin CATEGORIAS no puede
crear categorías vía guardarArticulo'` (línea 460) por **los dos** casos que lo
suceden. El caso viejo probaba que sin `CATEGORIAS` la categoría no se tocaba; la
decisión de este ciclo lo invierte, y **una inversión de un test de permisos deja
un agujero si el caso negativo no queda escrito aparte**:

```ts
  /**
   * Este par reemplaza al caso que probaba lo contrario, y la inversión es
   * deliberada (spec 2026-08-28): elegir una rama que YA existe es editar el
   * artículo, no administrar el árbol. `CATEGORIAS` pasa a significar sólo lo
   * segundo — que es lo que su descripción en lib/permisos/catalogo.ts ya
   * decía.
   *
   * El bypass que motivó la guarda vieja era tipear texto libre y que
   * `asegurarCategoria` creara las ramas al vuelo. Con selectores no hay nada
   * que crear, y el caso de abajo lo fija: la mitad positiva sin la negativa
   * sería exactamente el agujero.
   */
  it('un EMPLEADO con ARTICULOS_EDITAR y sin CATEGORIAS SÍ puede mover el artículo a una rama existente', async () => {
    const id = await crearArticuloDePrueba('Lo mueve un empleado')
    const rubro = await crearCategoriaDePrueba('Ya existía')

    estado.cookie = cookieEmpleadoEditarSinCategorias
    const datos = new FormData()
    datos.set('articuloId', id)
    datos.set('nombre', 'Lo mueve un empleado')
    datos.set('sku', 'ACC-SIN-CAT-1')
    datos.set('precio', '2500')
    datos.set('categoriaId', rubro)
    const r = await guardarArticulo(INICIAL, datos)
    expect(r.error).toBeNull()

    const { rows } = await owner.query(`SELECT categoria_id FROM articulos WHERE id = $1`, [id])
    expect(rows[0].categoria_id).toBe(rubro)
  })
```

**La mitad negativa NO se escribe acá**: `acciones-categorias.test.ts` ya tiene
el caso `'las cuatro exigen el permiso CATEGORIAS, no sólo sesión'`, que cubre
`crearCategoriaAccion`, `renombrarCategoriaAccion`, `moverCategoriaAccion` y
`borrarCategoriaAccion` de una. Duplicarlo acá con otro mecanismo sería dos
casos que pueden llegar a afirmar cosas distintas sobre el mismo permiso — que
es peor que tener uno solo. El docblock de arriba es el puntero; **verificar al
escribirlo que ese caso sigue existiendo con ese nombre**, y si cambió, corregir
el puntero en vez de agregar un caso nuevo.

- [ ] **Step 6: Correr y verificar que fallan**

Run: `npx vitest run app/\(app\)/inventario/acciones.test.ts`
Expected: FAIL — `guardarArticulo` todavía lee `categoria` y descarta sin
`CATEGORIAS`.

- [ ] **Step 7: Implementar `guardarArticulo`**

En `app/(app)/inventario/acciones.ts`, reemplazar el cuerpo de la llamada a
`editarArticulo` dentro de `guardarArticulo` (líneas 127-140) por:

```ts
    await comoPuede('ARTICULOS_EDITAR', async (tenantId) =>
      editarArticulo({
        tenantId,
        articuloId,
        nombre: texto(datos, 'nombre'),
        sku: texto(datos, 'sku'),
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        // La marca gana sobre el rubro cuando hay las dos: la rama más
        // específica es la que el artículo tiene que ocupar. Con el rubro
        // solo, el artículo cuelga del rubro, que es un caso válido. Misma
        // línea que `altaArticulo`, a propósito.
        //
        // **Sin guarda de `CATEGORIAS`**, y eso es la decisión de este ciclo
        // (spec 2026-08-28): colgar un artículo de una rama que ya existe es
        // editar el artículo. `CATEGORIAS` guarda el ABM del árbol —crear,
        // renombrar, mover, borrar—, que es lo que su descripción dice. El
        // bypass que motivaba la guarda vieja era el texto libre creando
        // ramas al vuelo, y ese camino ya no existe.
        categoriaId: texto(datos, 'marcaId') || texto(datos, 'categoriaId') || null,
      }),
    )
```

**El bloque que se reemplaza incluye un comentario que miente y que se va con
él**: el actual afirma *"La UI ya no dibuja este campo sin el permiso (ver
`formularios.tsx`)"*, y es falso — `FichaDeArticulo` nunca recibió un prop de ese
permiso y el campo se dibujaba siempre que hubiera `ARTICULOS_EDITAR`. El efecto
visible era que un empleado en esa combinación escribía una categoría, recibía
"Cambios guardados", y no cambiaba nada. El cambio de permiso lo vuelve
inofensivo, pero el comentario se va igual: **un comentario falso sobrevive al
código que describía.**

Si `puede` queda sin usar en el archivo, `npm run lint` lo marca — pero
**comprobar antes de borrar el import**: `altaArticulo` y `ingresarMercaderia`
lo siguen usando para `COSTOS`.

- [ ] **Step 8: Correr y verificar que pasan**

Run: `npx vitest run app/\(app\)/inventario/acciones.test.ts`
Expected: PASS.

- [ ] **Step 9: Escribir los tests que fallan de la ficha**

En `app/(app)/inventario/formularios.test.tsx`, cambiar el helper `renderFicha`
para que reciba la rama en vez del texto:

```tsx
async function renderFicha(
  categoriaId: string | null,
  extra: Partial<{ desactivado: boolean; puedeEditar: boolean }> = {},
) {
  const { FichaDeArticulo } = await import('./formularios')
  return renderToStaticMarkup(
    <SidebarProvider>
      <FichaDeArticulo
        titulo="Vidrio templado 9H"
        subtitulo="SKU 000412 · Producto"
        articuloId="a1"
        nombre="Vidrio templado 9H"
        sku="000412"
        precio="12000"
        arbol={ARBOL}
        categoriaId={categoriaId}
        desactivado={extra.desactivado ?? false}
        puedeEditar={extra.puedeEditar ?? true}
        columnaIzquierda={<div>columna izquierda</div>}
      />
    </SidebarProvider>,
  )
}
```

Reemplazar los dos casos de categoría del `describe('FichaDeArticulo')` (líneas
169-180) por:

```tsx
  /**
   * El defecto que este ciclo cierra: la ficha tenía un campo de TEXTO mientras
   * el alta ya elegía del árbol, así que para ponerle marca a un artículo había
   * que tipear "Fundas · Apple" con un middot que no está en el teclado, y
   * tipear sólo "Apple" creaba un rubro raíz nuevo en silencio.
   */
  it('elige la categoría del árbol y ya no la tipea', async () => {
    const html = await renderFicha('id-apple')
    expect(html).toContain('name="categoriaId"')
    expect(html).toContain('name="marcaId"')
    expect(html).not.toContain('name="categoria"')
  })

  it('precarga la rama del artículo, rubro y marca', async () => {
    const html = await renderFicha('id-apple')
    expect(html).toContain('<input type="hidden" name="categoriaId" value="id-fundas"')
    expect(html).toContain('<input type="hidden" name="marcaId" value="id-apple"')
  })

  // Nullable en el schema: un artículo sin categoría no puede romper el
  // formulario de edición.
  it('sin categoría, los dos campos quedan vacíos y no revienta', async () => {
    const html = await renderFicha(null)
    expect(html).toContain('<input type="hidden" name="categoriaId" value=""')
    expect(html).not.toContain('value="null"')
  })
```

En el caso `'los campos de "Datos" miden 40px (h-10)'` (línea 289), sacar
`'name="categoria"'` de la lista: ya no es un `<input>` de texto. La lista queda
`['name="nombre"', 'name="precio"', 'name="sku"']`, y su `renderFicha('Accesorios')`
pasa a `renderFicha('id-apple')`.

**No hay más llamadas que tocar.** De las 20 llamadas a `renderFicha` del
archivo, sólo dos pasan un string —las de las líneas 169 y 288, las dos dentro
de los casos que estos pasos reescriben—; las otras 18 pasan `null`, que sigue
siendo válido como `categoriaId`. Comprobarlo con
`grep -n "renderFicha(" app/\(app\)/inventario/formularios.test.tsx` antes de dar
el paso por terminado.

- [ ] **Step 10: Correr y verificar que fallan**

Run: `npx vitest run app/\(app\)/inventario/formularios.test.tsx`
Expected: FAIL — `FichaDeArticulo` no acepta `arbol` ni `categoriaId`.

- [ ] **Step 11: Implementar la ficha**

En `app/(app)/inventario/formularios.tsx`, en `FichaDeArticulo`: cambiar en la
lista de props y en su tipo `categoria` por `arbol` y `categoriaId`:

```tsx
  arbol,
  categoriaId,
```

```tsx
  arbol: RamaConHijas[]
  categoriaId: string | null
```

Y reemplazar la fila que hoy comparte Código con el campo de texto (el
`<div className="flex gap-2">` con `e-sku` y `e-categoria`) por:

```tsx
                      <div className="flex flex-col gap-2">
                        <Label htmlFor="e-sku">Código</Label>
                        <Input id="e-sku" name="sku" defaultValue={sku} required className="h-10 rounded-[9px]" />
                      </div>
                      {/* Apilados y no en fila, a diferencia del alta: esta card
                          mide 324 px, y dos selects lado a lado quedan en ~150
                          cada uno, donde "Vidrios templados" no entra. La
                          maqueta no dibuja este control acá — anotado en
                          docs/correcciones-pendientes-del-pen.md, entrada 7. */}
                      <SelectorDeCategoria
                        arbol={arbol}
                        categoriaIdInicial={categoriaId}
                        orientacion="columna"
                      />
```

- [ ] **Step 12: Correr y verificar que pasan**

Run: `npx vitest run app/\(app\)/inventario/formularios.test.tsx`
Expected: PASS.

- [ ] **Step 13: Conectar la pantalla**

En `app/(app)/inventario/[id]/page.tsx`, agregar el import:

```tsx
import { arbolDeCategorias } from '@/lib/inventario/categorias'
```

Sumar el árbol al `Promise.all` existente (hoy
`[movimientos, ultimoConCosto, ventasPorMes, planes]`), como quinto elemento:

```tsx
    // `verInactivos: true` a propósito, igual que en el alta: acá el árbol es
    // una LISTA DE OPCIONES, no un informe. Un rubro cuyos artículos están
    // todos dados de baja sigue siendo una opción válida, y esconderlo
    // obligaría a recrearlo con el mismo nombre — que chocaría contra el índice
    // único. Sólo se consulta si esta persona puede editar: sin
    // `ARTICULOS_EDITAR` la card "Datos" no se renderiza y el árbol no se usa.
    puedeEditar ? arbolDeCategorias(sesion.tenant.id, { verInactivos: true }) : [],
```

Y en el JSX de `<FichaDeArticulo>`, reemplazar `categoria={articulo.categoria}`
por:

```tsx
      arbol={arbol}
      categoriaId={articulo.categoriaId}
```

El `subtitulo` **no se toca**: `articulo.categoria` ya es el texto canónico de la
rama, así que la ficha ya muestra `Vidrios templados · Apple` en el encabezado.

- [ ] **Step 14: Actualizar `docs/pantallas.md` y correr el gate entero**

En `docs/pantallas.md`, sección `/inventario/[id]`: cambiar el bullet "Editar
nombre, categoría, precio y código…" para que diga que la categoría **se elige**
del árbol con dos selectores encadenados, y reemplazar la decisión "El campo de
categoría es texto libre en la pantalla, pero al guardar arma el árbol" por la
nueva — que la ficha usa el mismo componente que el alta, que elegir rama pide
`ARTICULOS_EDITAR` y no `CATEGORIAS`, y por qué. Revisar también la sección
`/inventario/nuevo` por si menciona que los selectores viven en `formularios.tsx`.

Run: `npm test`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: sin errores.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 15: Commit**

```bash
git add lib/inventario/articulos.ts app/\(app\)/inventario/acciones.ts app/\(app\)/inventario/formularios.tsx app/\(app\)/inventario/\[id\]/page.tsx test/inventario.test.ts app/\(app\)/inventario/acciones.test.ts app/\(app\)/inventario/formularios.test.tsx docs/pantallas.md
git commit -m "feat(categoría): la ficha elige la rama del árbol, como el alta

editarArticulo recibe el id de la rama en vez de texto y la resuelve con
ramaElegida adentro de su transacción. Elegir rama pasa a pedir
ARTICULOS_EDITAR: colgar un artículo de una rama que ya existe es editar el
artículo, no administrar el árbol. CATEGORIAS queda guardando el ABM, que es
lo que su descripción decía."
```

---

### Task 3: cerrar el ciclo en la documentación

**Files:**
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 7)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada de código. Es el cierre escrito del ciclo.
- Produces: nada que otro task use.

- [ ] **Step 1: Actualizar la entrada 7 del `.pen`**

En `docs/correcciones-pendientes-del-pen.md`, la entrada 7 pasa a
`## 7. La ficha de artículo quedó atrás del alta — RESUELTA EN CÓDIGO, LA
MAQUETA QUEDA ATRÁS` (**sigue abierta**, como la entrada 2, que ya usa ese
patrón de "resuelta a medias"). Tiene que decir:

- Que el 2026-08-28 el código fue primero, **decidido con el dueño del
  producto**, y que es un cambio de criterio respecto del 2026-08-24, cuando esta
  misma entrada dijo lo contrario ("sin el frame dibujado, habría que inventar el
  tratamiento").
- **Qué cambió para justificarlo**: esta vez no había tratamiento que inventar,
  porque existe en el mismo archivo, en `App / Artículo nuevo` (`B4O7t`).
- **Qué se derivó sin referencia**, que es lo que falta dibujar: los dos
  selectores **apilados** en la card "Datos" de 324 px —el alta no puede
  contestarlo porque su card es más ancha— y el frame `Móvil / Artículo ficha`,
  que tampoco los dibuja.
- Que el subtítulo con la rama completa, la otra mitad que esta entrada pedía, ya
  estaba resuelto desde el ciclo del modelo: `articulo.categoria` es el texto
  canónico.

- [ ] **Step 2: Escribir la entrada del ciclo en `CLAUDE.md`**

En la lista de *Próximos pasos técnicos*, después de la entrada de precios por
forma de pago, agregar la entrada de este ciclo con el patrón del archivo
(`~~título~~` **Hecho** (fecha), el porqué, las decisiones y lo que queda). Tiene
que dejar escrito:

- **De dónde sale**: el feedback textual del dueño, citado —*"el dueño no puede
  agregar marca o categoria a un producto del inventario ya agregado, tampoco
  puede agregarle o modificar el costo de un producto ya agregado"*—, y que la
  primera mitad ya estaba anotada como deuda desde el 2026-08-24 (entrada 7 del
  `.pen`). **La deuda la confirmó un cliente antes que un test.**
- **La causa, que es la que vale para el futuro**: había **dos implementaciones
  del mismo control** —dos selectores en el alta, un campo de texto en la
  ficha— y una se quedó atrás. Ahora es un solo componente, y por eso no se
  puede repetir. Es la misma familia de defecto que el merge del ciclo móvil ya
  documentó con las dos copias de un botón, y la respuesta es la misma:
  **una sola fuente, no dos que haya que acordarse de sincronizar.**
- **Qué se pierde**, dicho explícito: desde la ficha ya no se crea una rama
  tipeando. Es la misma capacidad que el alta perdió el 2026-08-24 y la misma
  mitigación —el link al panel—. **Reaparece en otro lado**, que es lo que la
  regla del ciclo móvil exige para no llamarlo simplificación.
- **La decisión de permisos**: elegir rama es `ARTICULOS_EDITAR`; `CATEGORIAS`
  queda para el ABM del árbol. La regla general que deja: **se delega por lo que
  la acción mueve, no por el sustantivo que nombra** — mover un artículo mueve un
  artículo, tocar el árbol mueve el catálogo entero. El catálogo sigue en siete
  permisos.
- **Que `Articulo.categoria` sigue escribiéndose** y el `DROP COLUMN` sigue
  siendo un deploy posterior.
- **Que la maqueta quedó atrás a propósito**, con el porqué del cambio de
  criterio.
- **La deuda del costo**, que es la mitad del feedback que este ciclo NO
  atiende, con las cuatro causas y el bug de
  `lib/inventario/articulos.ts` —el costo se descarta en silencio cuando la
  cantidad va vacía, porque el movimiento que lo lleva se crea sólo dentro de
  `if (stockInicial && stockInicial.greaterThan(0))`— y con el choque de modelos
  mentales que ese ciclo tiene que resolver primero: el modelo dice que el costo
  es del evento de recepción y el dueño piensa que es del producto.
- **Que la verificación manual queda pendiente**, por lo mismo que en los dos
  ciclos anteriores: `arandano-dev` bind-montea `/root/arandano` y no el
  worktree. Qué hay que mirar: que el selector precargue la rama al abrir la
  ficha, que "Sin categoría" la borre de verdad, que cambiar de rubro limpie la
  marca, y que un empleado con `ARTICULOS_EDITAR` y sin `CATEGORIAS` pueda mover
  el artículo pero no vea el ABM del panel.

- [ ] **Step 3: Correr el gate**

Run: `npm test`
Expected: PASS. (`test/pantallas.test.ts` ata `docs/pantallas.md` a las rutas;
ninguna ruta nueva se agregó, así que sigue en verde.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/correcciones-pendientes-del-pen.md
git commit -m "docs(categoría): las decisiones del ciclo y la deuda del costo

La causa del defecto era tener dos implementaciones del mismo control. Queda
escrito eso, la regla de permisos que deja, por qué la maqueta quedó atrás
esta vez, y la mitad del feedback que este ciclo no atiende."
```

---

## Verificación final del ciclo

Antes de dar el ciclo por cerrado:

- `npm test`, `npx tsc --noEmit`, `npm run lint` en verde.
- **Pedir review** con `superpowers:requesting-code-review` antes del merge: con
  un solo desarrollador es la única segunda mirada que existe (CLAUDE.md).
- **La verificación manual queda pendiente y se declara como tal**, no se da por
  hecha. El obstáculo es conocido: `arandano-dev` bind-montea `/root/arandano`, no
  este worktree, así que mirar a ojo va después del merge.
