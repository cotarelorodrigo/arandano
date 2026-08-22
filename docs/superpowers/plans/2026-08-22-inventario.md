# Ciclo 5 — `/inventario`, `/inventario/nuevo` y `/inventario/[id]`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar las tres pantallas de inventario contra sus frames de `design/arandano.pen`, conectar la categoría que el ciclo 2 dejó preparada, y sacar `recharts` del repo.

**Architecture:** El listado gana tabs de tipo y chips de estado; el alta se reordena en tres cards; y la ficha —hoy una sola columna— pasa a dos, con tiles de métrica, el primer lector del costo unitario y un gráfico de barras hecho a mano. Ese último cambio es el que deja al repo sin ningún consumidor de `recharts`.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, shadcn, Prisma, vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-maqueta-shell-design.md` (el ciclo 5 de su tabla).

**Relevamiento:** `.superpowers/sdd/2026-08-22-inventario/relevamiento.md` — el árbol de los tres cuerpos con ids de nodo, los textos literales, la comparación bloque por bloque y los tratamientos tipográficos. **Es la fuente de las medidas.**

## Global Constraints

- Código, comentarios y mensajes de commit en **español rioplatense con acentos**, explicando POR QUÉ.
- **`design/arandano.pen` es la autoridad.** Si un número de este plan no coincide con el `.pen`, gana el `.pen` — decilo y usá el del archivo.
- **La lógica de inventario no se toca.** `lib/inventario/`, los movimientos de stock, el cálculo del delta por conteo: nada cambia. Este ciclo es presentación, salvo lo que se nombra explícitamente.
- Los colores salen de tokens. `--primary-foreground` no puede aparecer fuera de `components/ui/`.
- **`git add` con archivos nombrados, NUNCA `git add -A`.**
- Al terminar: `npm test` en cero fallas, `npm run lint` limpio, `npx tsc --noEmit` limpio.
- **No corras `docker` mientras los tests corren.**

## Las cuatro decisiones, ya tomadas

**1. `Articulo.categoria` se conecta en este ciclo.** El ciclo 2 la agregó al schema y **nadie la lee ni la escribe** — verificado con grep sobre `app/` y `lib/`: cero resultados. Una columna que nace vacía y nadie llena es peor que no tenerla. Entra en el listado (la columna que la maqueta dibuja bajo el nombre), en el alta y en la edición de la ficha.

Ojo con una inconsistencia de la maqueta que ya está anotada desde el ciclo 1: la categoría aparece en el listado y en el subtítulo de la ficha, **pero el formulario de alta de la maqueta no la tiene y el card "Datos" tampoco**. Un campo que se muestra y no se puede cargar nace siempre vacío, así que acá se aparta de la maqueta a propósito: el campo entra en los dos formularios. **Cuando lo hagas, actualizá el `.pen`** — si no, el archivo empieza a describir un producto que no es, que es justo lo que `design/LEEME.md` dice que existe para evitar.

**2. `recharts` se borra en este ciclo.** Su único consumidor era `app/(app)/ventas/grafico.tsx`, que el ciclo anterior reescribió sin la librería. El relevamiento confirmó que "Cómo se movió" de la ficha es **seis `<div>` de alto fijo con las esquinas de arriba redondeadas** — sin eje, tooltip, leyenda ni apilado. Así que tampoco la necesita.

Cuando el último uso se vaya: sacá `recharts` de `package.json`, borrá `components/ui/chart.tsx` si quedó sin consumidores, y **retirá la excepción de jsdom** de `vitest.config.ts` junto con su documentación. Media excepción retirada es peor que ninguna.

**3. "Exportar CSV" entra, y lo más simple posible.** La maqueta lo dibuja en el historial de movimientos. Es una feature nueva de punta a punta, sin ninguna pista en el repo. Se hace con un server action que arma el CSV en memoria y lo devuelve como descarga — sin librería, sin endpoint nuevo, sin streaming. Si el historial de un artículo llegara a ser tan grande que eso no alcance, es un problema que todavía no existe.

**4. La columna "Queda" se reconstruye, no se guarda.** El historial de la maqueta muestra el saldo corriente después de cada movimiento. Se calcula recorriendo los deltas hacia atrás desde el stock actual — **no** hace falta migración ni columna nueva. Escribilo con un comentario que diga eso, porque el próximo que lo lea va a querer guardarlo.

---

### Task 1: `checkbox`, `tabs`, y la categoría conectada

**Files:**
- Create: `components/ui/checkbox.tsx`, `components/ui/tabs.tsx` (los genera el CLI)
- Modify: `app/(app)/inventario/page.tsx`, `formularios.tsx`, `acciones.ts`, `[id]/page.tsx` y sus tests

**Interfaces:**
- Produces: `Checkbox`; `Tabs`/`TabsList`/`TabsTrigger`. Y `Articulo.categoria` leída y escrita de punta a punta.

- [ ] **Step 1: Línea de base** — `npm test 2>&1 | tail -4`, anotá el número.
- [ ] **Step 2:** `npx shadcn@latest add checkbox tabs`. Si ofrece sobrescribir algo, decí que no. Después `git diff app/globals.css`: si el CLI metió tokens, decidí uno por uno si son nuevos o duplicados de los que ya hay — dos tests atan ese archivo en las dos direcciones.
- [ ] **Step 3: Los tests de la categoría, primero.** Mínimo: que el alta la guarda; que la ficha la muestra y la deja editar; que el listado la muestra bajo el nombre; que un artículo sin categoría no rompe nada (es nullable y todos los existentes la tienen vacía).
- [ ] **Step 4:** Velos fallar. Implementá. Verde.
- [ ] **Step 5: Actualizá el `.pen`.** Agregá el campo de categoría al formulario de alta (`B4O7t`) y al card "Datos" de la ficha (`y4tEb`), con el mismo tratamiento que los campos vecinos. Es la decisión 1: si el código lo tiene y la maqueta no, la maqueta queda mintiendo.
- [ ] **Step 6:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 2: El listado

**Files:**
- Modify: `app/(app)/inventario/page.tsx` y sus tests

Del relevamiento: buscador, checkbox "Ver desactivados", **tabs Todos/Productos/Servicios** (que no existen ni como filtro ni como componente), la tabla dentro de una card con `Table` de shadcn, **chips de estado** (`Stock negativo`, `Queda poco`, `Desactivado`) con `Badge`, y paginación con su rango.

Fijate cómo se relacionan las tabs con los filtros que la URL ya maneja: el código tiene `verInactivos` y la paginación por query string. Las tabs son un filtro más, del mismo tipo — no inventes un mecanismo nuevo.

- [ ] **Step 1:** Tests primero. Mínimo: que cada tab filtra por tipo; que la tab activa sale de la URL y sobrevive a recargar; que "Queda poco" aparece con stock bajo y no con stock cero; que el chip de desactivado sólo sale con "Ver desactivados" tildado.
- [ ] **Step 2:** Velos fallar. Implementá contra el relevamiento. Verde.
- [ ] **Step 3:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 3: El alta

**Files:**
- Modify: `app/(app)/inventario/nuevo/page.tsx`, `formularios.tsx` y sus tests

Del relevamiento: tres cards — "Qué estás cargando" (con las dos opciones Producto/Servicio como tarjetas seleccionables, no un `<select>`), "Datos del artículo", y "Stock inicial" con su nota explicando que el stock inicial entra como movimiento.

El texto de ayuda del SKU lo trae el relevamiento literal, y dice algo que ya está decidido en `CLAUDE.md`: que puede haber huecos en la numeración y es a propósito.

- [ ] **Step 1:** Tests primero. Mínimo: que elegir "Servicio" esconde el bloque de stock inicial; que el SKU vacío se autogenera; que el costo unitario es opcional.
- [ ] **Step 2:** Velos fallar. Implementá. Verde.
- [ ] **Step 3:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 4: La ficha — las dos columnas y los tiles

**Files:**
- Modify: `app/(app)/inventario/[id]/page.tsx`, `formularios.tsx` y sus tests

Hoy es **una sola columna de arriba a abajo**; la maqueta es **dos**. A la izquierda: los tres tiles de métrica, las dos cards de acción (ingresar mercadería y corregir por conteo) y el historial. A la derecha: "Datos" y "Cómo se movió".

**El tile "En stock" va pintado con `--marca`.** `docs/sistema-de-diseno.md` ya lo lista entre las anclas de marca del producto y nadie lo construyó — o sea que el código contradice su propio sistema de diseño escrito, igual que pasó con el tile de `/ventas`.

**El tile "Último costo" es el primer lector de `MovimientoStock.costoUnitario`.** `CLAUDE.md` dice que ese campo existe y que "nadie la lee todavía". El relevamiento trae qué pide exactamente la maqueta y con qué fórmula el margen; seguilo. Si el artículo no tiene ningún movimiento con costo, **no inventes un número**: mostrá que no hay dato.

- [ ] **Step 1:** Tests primero. Mínimo: que el tile de stock muestra el stock real; que el último costo sale del movimiento más reciente que lo tenga; que el margen se calcula contra el precio de venta; que un artículo sin costo cargado no muestra un margen falso; que un servicio no muestra tile de stock.
- [ ] **Step 2:** Velos fallar. Implementá. Verde.
- [ ] **Step 3:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 5: El historial, el gráfico y el CSV

**Files:**
- Modify: `app/(app)/inventario/[id]/page.tsx`, `acciones.ts` y sus tests
- Create: el componente del gráfico y su test

De la maqueta: el historial gana una columna **"Queda"** con el saldo corriente (decisión 4), los motivos pasan a chips con ícono, y aparecen **"Cómo se movió"** (seis barras por mes, sin librería — decisión 2) y **"Exportar CSV"** (decisión 3).

- [ ] **Step 1:** Tests primero. Mínimo: que la columna "Queda" cierra contra el stock actual recorriendo los deltas; que el gráfico no rompe con cero movimientos; que el CSV trae una fila por movimiento con sus columnas; que el CSV escapa las comas y las comillas de las notas — un artículo con una nota que diga `Factura A, 0001` parte la fila si nadie lo cuida.
- [ ] **Step 2:** Velos fallar. Implementá. Verde.
- [ ] **Step 3:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 6: Sacar `recharts` y cerrar el ciclo

**Files:**
- Modify: `package.json`, `vitest.config.ts`, `docs/pantallas.md`, `CLAUDE.md`
- Delete: `components/ui/chart.tsx` si quedó sin consumidores

- [ ] **Step 1: Confirmá que no queda ningún uso**

```bash
grep -rn "recharts\|components/ui/chart" app components lib test scripts | grep -v node_modules
```

Esperado: **cero resultados**. Si aparece alguno, **no borres nada** — decímelo: significa que algún ciclo dejó un uso que no estaba relevado.

- [ ] **Step 2:** Sacá `recharts` de `package.json`, **borrá `components/ui/chart.tsx`** —que ya quedó huérfano en el ciclo anterior y es la pieza que de verdad arrastra la librería— y corré `npm install` para actualizar el lock.

  **Y podá `--chart-2` de una vez**: sale de `app/globals.css`, de la tabla de tokens de `docs/sistema-de-diseno.md`, y de `SOLO_EN_CSS` en `test/maqueta.test.ts` — cuya razón, además, describe hoy *"la serie de dólares del panel de /ventas"*, que ya no existe. Los tres archivos están atados por tests que fallan si lo hacés a medias. `--chart-1` es otra cosa: es un alias de `--primary` en `EQUIVALENCIAS` que nunca tuvo consumidor propio, así que decidí vos si vale sacarlo.
- [ ] **Step 3: Retirá la excepción de jsdom.** `grafico.test.tsx` era el único archivo del repo que la necesitaba, y tanto `vitest.config.ts` como el propio archivo tienen su documentación. **Sacá las dos**: una excepción retirada a medias deja al próximo creyendo que sigue vigente.
- [ ] **Step 4:** `npm test && npm run lint && npx tsc --noEmit`. Ojo acá: si algo se rompe, es porque quedaba un consumidor que el grep no vio.
- [ ] **Step 5:** Actualizá las tres secciones de inventario en `docs/pantallas.md`, y anotá el ciclo en `CLAUDE.md` — incluido que `MovimientoStock.costoUnitario` **dejó de ser un dato que nadie lee**, que es una de las decisiones abiertas que ese archivo tiene registradas.
- [ ] **Step 6:** Commit.
