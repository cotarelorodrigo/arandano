# UI de categorías — plan de implementación

**Goal:** el panel de categorías en `/inventario` (navegar, filtrar, administrar)
y los dos selectores Categoría/Marca en `/inventario/nuevo`.

**Spec:** `docs/superpowers/specs/2026-08-24-categorias-ui-design.md`
**Maqueta:** `design/arandano.pen`, frames `pb32f` y `B4O7t`.

## Global Constraints

- **Las medidas salen de la maqueta, no de la descripción vieja.** Fila alto 30,
  `padding [0,8]`, `radius 8`, `gap 6`; marca con sangría 24 y texto 12.5/normal;
  rubro 13/500; seleccionada `--accent` + `--marca` weight 600.
- **El ABM es sólo del dueño**, igual que el alta de artículo.
- **Nada de `$queryRaw` fuera de una transacción de tenant**: la extensión de
  `lib/tenant/prisma.ts` no setea la GUC en raw queries y RLS devuelve cero filas
  en silencio.
- **Sin migraciones.** El modelo ya está; este ciclo es presentación.
- Español en nombres, comentarios y mensajes.

---

### Task 1: las funciones del árbol

**Files:** `lib/inventario/categorias.ts`, `test/categorias.test.ts` (nuevo)

**Produces:**
- `arbolDeCategorias(tenantId, {verInactivos}): Promise<RamaConHijas[]>` donde
  `RamaConHijas = {id, nombre, cuenta, hijas: {id, nombre, cuenta}[]}`
- `cuentaSinCategoria(tenantId, {verInactivos}): Promise<number>`
- `crearCategoria({tenantId, nombre, padreId})`, `renombrarCategoria`,
  `moverCategoria`, `borrarCategoria`

- [x] **Step 1 — tests que fallan.** En `test/categorias.test.ts`: el conteo de
  un rubro suma sus marcas más lo colgado del rubro; el orden es alfabético;
  una categoría sin artículos aparece con 0; `crearCategoria` rechaza el nombre
  vacío y el duplicado (raíz y hija); `moverCategoria` rechaza mover un rubro
  (sería un tercer nivel); `borrarCategoria` rechaza con hijas y con artículos, y
  el error dice **cuántos**; el árbol de un tenant no incluye el de otro.
- [x] **Step 2** — correr y ver fallar.
- [x] **Step 3 — implementar.** El árbol con **un solo `groupBy`** sobre
  `categoriaId` más un `findMany` de categorías; los totales de rubro se suman en
  JavaScript. Los errores nuevos van al union de `CodigoErrorDeInventario`.
- [x] **Step 4** — correr y ver pasar.
- [x] **Step 5** — commit.

---

### Task 2: el panel y el filtrado

**Files:** `app/(app)/inventario/page.tsx`,
`app/(app)/inventario/panel-categorias.tsx` (nuevo) y su test,
`app/(app)/inventario/page.test.tsx`

- [x] **Step 1 — tests que fallan.** `construirDonde` con `categoria`: un rubro
  trae sus marcas (`OR` de un nivel), una marca trae sólo la suya, `'sin'` trae
  `categoriaId: null`, `null` no filtra. `hrefListado` con `cat` y **sin `p`**
  (elegir rama vuelve a la página 1). `categoriaDeQuery` cae en `null` con un id
  inventado. Y del panel: un rubro con marcas lleva chevron, uno sin marcas lleva
  el hueco de 14, la marca lleva sangría 24 y su tipografía propia, la fila
  activa pinta `--accent`, el rubro de la rama activa se fuerza abierto, "Sin
  categoría" no se dibuja si no hay ninguno, y el árbol vacío muestra su línea.
- [x] **Step 2** — correr y ver fallar.
- [x] **Step 3 — implementar.** El `Contenido` horizontal con `gap-4`, el panel
  de `w-[248px]` y el listado a `flex-1`. El colapso es `useState` con todas
  abiertas; el rubro activo se fuerza. El cuarto mensaje de vacío con el botón
  "Buscar en todo el inventario" que limpia `?cat` y conserva `?q`.
- [x] **Step 4** — correr y ver pasar.
- [x] **Step 5** — commit.

---

### Task 3: el ABM

**Files:** `components/ui/dropdown-menu.tsx` (shadcn),
`app/(app)/inventario/acciones.ts`, `panel-categorias.tsx`, sus tests

- [x] **Step 1** — `npx shadcn@latest add dropdown-menu`.
- [x] **Step 2 — tests que fallan.** Las cuatro acciones exigen dueño (un
  empleado recibe error y no muta); crear rubro y marca; renombrar; mover una
  marca; los dos rechazos de borrado con su mensaje contando artículos; y que el
  panel **no dibuje** `+` ni `⋯` para un empleado.
- [x] **Step 3** — correr y ver fallar.
- [x] **Step 4 — implementar.** Acciones con `comoDuenio`, `revalidatePath`.
  Renombrar in-place: input de alto 30, `Enter` guarda, `Esc` cancela **con
  `stopPropagation`** (la trampa que ya mordió en `/vender`). El `⋯` ocupa el
  lugar de la cuenta al hover, sin correr el texto.
- [x] **Step 5** — correr y ver pasar.
- [x] **Step 6** — commit.

---

### Task 4: el alta con selectores

**Files:** `app/(app)/inventario/nuevo/page.tsx`,
`app/(app)/inventario/formularios.tsx`, `app/(app)/inventario/acciones.ts`,
`lib/inventario/articulos.ts`, sus tests

- [x] **Step 1 — tests que fallan.** El alta acepta `categoriaId` y deja el
  artículo en esa rama con el texto derivado (`textoDeCategoria`); un
  `categoriaId` de otro tenant se rechaza; sin categoría queda todo en null; la
  factura del proveedor termina en la nota del movimiento de stock inicial
  (`'stock inicial · <factura>'`) y sin factura la nota sigue siendo
  `'stock inicial'`; el formulario dibuja los dos `Select` y el de marca sale
  deshabilitado con un rubro sin marcas.
- [x] **Step 2** — correr y ver fallar.
- [x] **Step 3 — implementar.** `EntradaCrearArticulo` acepta `categoriaId`
  **además** de `categoria` — el texto libre no se borra, porque
  `sembrar-catalogo-dev.mts` lo usa y el seed no es una pantalla. Cuando llega
  `categoriaId`, gana sobre el texto. Dos columnas (izquierda `flex-1`, derecha
  `w-[420px]`), Marca dependiente del rubro con `useState`, y el link
  "Administrar categorías".
- [x] **Step 4** — correr y ver pasar.
- [x] **Step 5** — commit.

---

### Task 5: docs y verificación

- [x] `docs/pantallas.md`: `/inventario` y `/inventario/nuevo`.
- [x] `docs/correcciones-pendientes-del-pen.md`: cerrar la entrada 4 (el frame ya
  no está vacío), reescribir la 6 (ya está dibujado; lo que queda pendiente son
  los tres estados no dibujados), y sumar la ficha desactualizada y los dos
  campos fuera de alcance.
- [x] `CLAUDE.md`: la entrada del ciclo.
- [x] `npm test`, `npx tsc --noEmit`, `npm run lint`.
- [x] Verificación manual contra dev con el servidor levantado.
- [x] Commit.

---

## Lo que salió distinto

**Los dos bugs de borde cliente/servidor**, que no estaban previstos en ninguna
tarea y dieron 500 en cada visita a `/inventario` con los 1316 tests del gate en
verde: `page.tsx` invocaba una función de un módulo `'use client'`, y el panel
recibía `href` como prop. El query string se mudó a `consulta.ts` y el panel
pasó a recibir datos. Quedó `test/servidor-llama-a-cliente.test.ts` como red
para el primero; para el segundo no hay red estática razonable.

**El seed de dev fue clave para verificar.** El árbol sembrado —un rubro con
dos marcas hermanas, la misma marca bajo tres rubros, dos rubros sin marca y
uno sin categoría— es lo que hizo que la verificación manual ejercitara los
cuatro casos en vez de siete ramas iguales.

**Tests viejos que cambiaron de significado**, y valen como registro: el que
prohibía `<select>` en el alta pasó a prohibirlo sólo para `name="tipo"` —Radix
renderiza uno oculto para que el valor viaje en un form nativo—, y el que
buscaba `id="marcaId"[^>]*disabled` fallaba porque Radix emite `disabled`
**antes** del `id`: un regex que los pide en orden pasa o falla por casualidad.
