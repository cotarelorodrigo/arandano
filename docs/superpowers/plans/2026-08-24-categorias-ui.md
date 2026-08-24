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

- [ ] **Step 1 — tests que fallan.** En `test/categorias.test.ts`: el conteo de
  un rubro suma sus marcas más lo colgado del rubro; el orden es alfabético;
  una categoría sin artículos aparece con 0; `crearCategoria` rechaza el nombre
  vacío y el duplicado (raíz y hija); `moverCategoria` rechaza mover un rubro
  (sería un tercer nivel); `borrarCategoria` rechaza con hijas y con artículos, y
  el error dice **cuántos**; el árbol de un tenant no incluye el de otro.
- [ ] **Step 2** — correr y ver fallar.
- [ ] **Step 3 — implementar.** El árbol con **un solo `groupBy`** sobre
  `categoriaId` más un `findMany` de categorías; los totales de rubro se suman en
  JavaScript. Los errores nuevos van al union de `CodigoErrorDeInventario`.
- [ ] **Step 4** — correr y ver pasar.
- [ ] **Step 5** — commit.

---

### Task 2: el panel y el filtrado

**Files:** `app/(app)/inventario/page.tsx`,
`app/(app)/inventario/panel-categorias.tsx` (nuevo) y su test,
`app/(app)/inventario/page.test.tsx`

- [ ] **Step 1 — tests que fallan.** `construirDonde` con `categoria`: un rubro
  trae sus marcas (`OR` de un nivel), una marca trae sólo la suya, `'sin'` trae
  `categoriaId: null`, `null` no filtra. `hrefListado` con `cat` y **sin `p`**
  (elegir rama vuelve a la página 1). `categoriaDeQuery` cae en `null` con un id
  inventado. Y del panel: un rubro con marcas lleva chevron, uno sin marcas lleva
  el hueco de 14, la marca lleva sangría 24 y su tipografía propia, la fila
  activa pinta `--accent`, el rubro de la rama activa se fuerza abierto, "Sin
  categoría" no se dibuja si no hay ninguno, y el árbol vacío muestra su línea.
- [ ] **Step 2** — correr y ver fallar.
- [ ] **Step 3 — implementar.** El `Contenido` horizontal con `gap-4`, el panel
  de `w-[248px]` y el listado a `flex-1`. El colapso es `useState` con todas
  abiertas; el rubro activo se fuerza. El cuarto mensaje de vacío con el botón
  "Buscar en todo el inventario" que limpia `?cat` y conserva `?q`.
- [ ] **Step 4** — correr y ver pasar.
- [ ] **Step 5** — commit.

---

### Task 3: el ABM

**Files:** `components/ui/dropdown-menu.tsx` (shadcn),
`app/(app)/inventario/acciones.ts`, `panel-categorias.tsx`, sus tests

- [ ] **Step 1** — `npx shadcn@latest add dropdown-menu`.
- [ ] **Step 2 — tests que fallan.** Las cuatro acciones exigen dueño (un
  empleado recibe error y no muta); crear rubro y marca; renombrar; mover una
  marca; los dos rechazos de borrado con su mensaje contando artículos; y que el
  panel **no dibuje** `+` ni `⋯` para un empleado.
- [ ] **Step 3** — correr y ver fallar.
- [ ] **Step 4 — implementar.** Acciones con `comoDuenio`, `revalidatePath`.
  Renombrar in-place: input de alto 30, `Enter` guarda, `Esc` cancela **con
  `stopPropagation`** (la trampa que ya mordió en `/vender`). El `⋯` ocupa el
  lugar de la cuenta al hover, sin correr el texto.
- [ ] **Step 5** — correr y ver pasar.
- [ ] **Step 6** — commit.

---

### Task 4: el alta con selectores

**Files:** `app/(app)/inventario/nuevo/page.tsx`,
`app/(app)/inventario/formularios.tsx`, `app/(app)/inventario/acciones.ts`,
`lib/inventario/articulos.ts`, sus tests

- [ ] **Step 1 — tests que fallan.** El alta acepta `categoriaId` y deja el
  artículo en esa rama con el texto derivado (`textoDeCategoria`); un
  `categoriaId` de otro tenant se rechaza; sin categoría queda todo en null; la
  factura del proveedor termina en la nota del movimiento de stock inicial
  (`'stock inicial · <factura>'`) y sin factura la nota sigue siendo
  `'stock inicial'`; el formulario dibuja los dos `Select` y el de marca sale
  deshabilitado con un rubro sin marcas.
- [ ] **Step 2** — correr y ver fallar.
- [ ] **Step 3 — implementar.** `EntradaCrearArticulo` acepta `categoriaId`
  **además** de `categoria` — el texto libre no se borra, porque
  `sembrar-catalogo-dev.mts` lo usa y el seed no es una pantalla. Cuando llega
  `categoriaId`, gana sobre el texto. Dos columnas (izquierda `flex-1`, derecha
  `w-[420px]`), Marca dependiente del rubro con `useState`, y el link
  "Administrar categorías".
- [ ] **Step 4** — correr y ver pasar.
- [ ] **Step 5** — commit.

---

### Task 5: docs y verificación

- [ ] `docs/pantallas.md`: `/inventario` y `/inventario/nuevo`.
- [ ] `docs/correcciones-pendientes-del-pen.md`: cerrar la entrada 4 (el frame ya
  no está vacío), reescribir la 6 (ya está dibujado; lo que queda pendiente son
  los tres estados no dibujados), y sumar la ficha desactualizada y los dos
  campos fuera de alcance.
- [ ] `CLAUDE.md`: la entrada del ciclo.
- [ ] `npm test`, `npx tsc --noEmit`, `npm run lint`.
- [ ] Verificación manual contra dev con el servidor levantado.
- [ ] Commit.
