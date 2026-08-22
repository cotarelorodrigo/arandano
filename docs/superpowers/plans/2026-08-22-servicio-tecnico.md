# Ciclo 6 — Las tres pantallas de Servicio Técnico

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el tablero, la recepción de equipos y la ficha de orden contra sus frames de `design/arandano.pen`, y sumar el estado `APROBADO` que la maqueta muestra y el modelo no tiene.

**Architecture:** Casi todo el ciclo es presentación —cards, chips de estado con color e ícono, el paño de estado, la bitácora como línea de tiempo— salvo una pieza que sí toca el dominio: un estado nuevo en el enum y dos transiciones. Esa parte va primero, en su propia tarea, por expand/contract.

**Tech Stack:** Next.js 16 App Router, Tailwind v4, shadcn, Prisma, vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-maqueta-shell-design.md` (el ciclo 6) y `docs/superpowers/specs/2026-08-15-servicio-tecnico-design.md` (el módulo).

**Relevamiento:** `.superpowers/sdd/2026-08-22-servicio-tecnico/relevamiento.md` — el árbol de los tres cuerpos con ids de nodo, los textos literales y la comparación bloque por bloque. **Es la fuente de las medidas.**

## Global Constraints

- Código, comentarios y mensajes de commit en **español rioplatense con acentos**, explicando POR QUÉ.
- **`design/arandano.pen` es la autoridad.** Consultalo **en vivo**, no te conformes con el relevamiento: en el ciclo anterior eso destapó ocho divergencias que nadie había relevado.
- **Ningún hex crudo**: `color-mix(in srgb, var(--token) N%, transparent)`. La regla está en `app/login/persiana.module.css:18`.
- `--primary-foreground` no puede aparecer fuera de `components/ui/`.
- **No se toca `[id]/ticket/`.** El ticket térmico está fuera del rediseño a propósito — es la única superficie que no usa los tokens del sistema. **Y ojo**: el ciclo del shell ya rompió ese ticket una vez sin tocarlo, al cambiar las etiquetas que su `@media print` ocultaba. Si tu diff cambia la estructura del cuerpo de la ficha, corré `npx vitest run "app/(app)/servicio-tecnico/[id]/ticket"`.
- **`git add` con archivos nombrados, NUNCA `git add -A`.**
- Al terminar: `npm test` en cero fallas, `npm run lint` limpio, `npx tsc --noEmit` limpio.
- **No corras `docker` mientras los tests corren.**
- **Mutá las aserciones de cableado antes de darlas por buenas.** Los tests de componente de este repo son whitebox —regex sobre el texto fuente— y un regex laxo es indistinguible de uno estricto a simple vista. El ciclo anterior perdió tres rondas por eso.

## Las dos decisiones, ya tomadas

**1. El estado `APROBADO` entra al enum, y llena un hueco real del flujo.**

La maqueta lo muestra en tres lugares: el chip del tablero, el chip de la fila y una entrada de bitácora que dice *"Pasó a Aprobado — El cliente aceptó por WhatsApp"*.

Hoy `PRESUPUESTADO` va directo a `EN_REPARACION` (`lib/ordenes-de-trabajo/estados.ts:32`), o sea que **la aprobación del cliente no queda registrada en ningún lado**. En un service eso es justamente lo que hay que poder probar: que el cliente dijo que sí antes de que se gastara un repuesto.

Es aditivo al enum, así que no rompe ninguna orden existente.

Las transiciones que entran: `PRESUPUESTADO → APROBADO` y `APROBADO → EN_REPARACION`. Más `APROBADO → SIN_REPARACION`, porque se abre el equipo y aparece que no tiene arreglo.

**2. El resto del grafo NO se toca, aunque la maqueta muestre otros botones.**

El relevamiento nota que el paño de "Estado actual" dibuja, para `EN_REPARACION`, botones que no coinciden con las transiciones legales de hoy — muestra `Rechazado`, que hoy no sale de ahí, y no muestra `Presupuestado`, que sí.

**No lo cambies.** `PRESUPUESTADO → EN_REPARACION` se mantiene (hay locales donde el cliente aprueba en el mostrador y no hace falta el paso extra), y las transiciones de `EN_REPARACION` quedan como están. El motivo: agregar un estado que falta es llenar un hueco evidente; **cambiar a qué estados se puede ir desde uno existente es rediseñar el flujo del negocio**, y eso lo decide el dueño del producto, no un ciclo de presentación. El spec del módulo definió ese grafo con su porqué escrito.

El paño muestra **las transiciones legales que devuelve `TRANSICIONES`**, no las que dibuja la maqueta. Y **anotá la diferencia** en el reporte, para que quede como pregunta abierta.

---

### Task 1: El estado `APROBADO`

**Files:**
- Modify: `prisma/schema.prisma`, `lib/ordenes-de-trabajo/estados.ts` y sus tests
- Create: la migración

**Interfaces:**
- Produces: `EstadoOrden.APROBADO`, y las tres transiciones nuevas en `TRANSICIONES`

- [ ] **Step 1: Línea de base** — `npm test 2>&1 | tail -4`, anotá el número.
- [ ] **Step 2: Los tests primero.** En los tests de `lib/ordenes-de-trabajo/`: que desde `PRESUPUESTADO` se puede ir a `APROBADO`; que desde `APROBADO` se puede ir a `EN_REPARACION` y a `SIN_REPARACION`; que **no** se puede ir de `RECIBIDO` a `APROBADO` (hay que presupuestar primero); y que `APROBADO` tiene su nombre en castellano en `NOMBRE_ESTADO`.
- [ ] **Step 3:** Velos fallar.
- [ ] **Step 4:** Agregá el valor al enum y las transiciones. **Generá la migración con `--create-only`** (`npx prisma migrate dev --create-only --name estado_aprobado`) y aplicala en un paso aparte: sin eso, si necesitás editarla chocás con el guard de checksum de Prisma, que exige `migrate reset` — prohibido acá.
- [ ] **Step 5:** Regenerá el ERD con `./scripts/generar-erd.sh` — el hook de pre-commit lo verifica.
- [ ] **Step 6:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 2: `textarea`, y el tablero

**Files:**
- Create: `components/ui/textarea.tsx` (lo genera el CLI)
- Modify: `app/(app)/servicio-tecnico/page.tsx` y sus tests

Del relevamiento: los chips de estado con su color e ícono (la lista completa está ahí, con qué lleva cada uno de los nueve estados), el buscador, y el listado dentro de una card con encabezado, filas y paginación.

**Los chips son lo más delicado**: cada estado tiene color e ícono propios y hoy **no existe ningún mapeo estado→ícono→color** en el código. Ponelo en un solo lugar —`lib/ordenes-de-trabajo/estados.ts` es el candidato natural, donde ya viven `NOMBRE_ESTADO` y `TRANSICIONES`— para que el tablero, la fila y la bitácora lean del mismo sitio.

- [ ] **Step 1:** `npx shadcn@latest add textarea`. Si ofrece sobrescribir algo, decí que no. Después `git diff app/globals.css`: si metió tokens, decidí uno por uno.
- [ ] **Step 2:** Tests primero. Mínimo: que cada estado tiene su chip con color e ícono; que el contador de cada chip cuenta lo que dice; que "Abiertas" sigue sin contar las entregadas (es una decisión ya tomada del módulo).
- [ ] **Step 3:** Velos fallar. Implementá. Verde.
- [ ] **Step 4:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 3: Recibir un equipo

**Files:**
- Modify: `app/(app)/servicio-tecnico/nuevo/page.tsx`, `formularios.tsx`, `acciones.ts` y sus tests

Del relevamiento: dos columnas con cuatro cards — Cliente (con el buscador y sus resultados), Equipo, Falla, y "Qué se imprime".

**El buscador de cliente cambia de forma**: hoy es un `<select>` nativo; la maqueta pide cards seleccionables con el nombre, el teléfono y **"N órdenes previas"**. Ese conteo no está en la query de hoy, pero **no hace falta migración**: `Cliente.ordenes` ya es una relación y alcanza con pedir el `_count`.

Ese mismo dato lo pide también la ficha (card Cliente), así que resolvelo en un solo lugar.

- [ ] **Step 1:** Tests primero. Mínimo: que el buscador muestra las órdenes previas de cada cliente; que un cliente sin órdenes previas no muestra un conteo falso; que el cliente nuevo se sigue creando en la misma transacción que la orden (es una decisión del módulo, no la rompas); que la clave de desbloqueo se guarda y **no** se imprime.
- [ ] **Step 2:** Velos fallar. Implementá. Verde.
- [ ] **Step 3:** Corré los tests del ticket: `npx vitest run "app/(app)/servicio-tecnico/[id]/ticket"`.
- [ ] **Step 4:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 4: La ficha — el paño de estado y la bitácora

**Files:**
- Modify: `app/(app)/servicio-tecnico/[id]/page.tsx`, `formularios.tsx` y sus tests

Las dos piezas más grandes del ciclo.

**El paño "ESTADO ACTUAL"** es un bloque de `--marca` (748×183 según el relevamiento) con el rótulo, el estado, el tiempo transcurrido y los botones de transición adentro, con estilo sólido para el camino principal y fantasma para los demás. Hoy el estado es un `<p>` de texto plano que un ciclo anterior bajó al cuerpo **esperando exactamente este paño** — el comentario lo dice.

Los botones muestran **lo que devuelve `TRANSICIONES`**, no lo que dibuja la maqueta (decisión 2). Anotá la diferencia en el reporte.

**La bitácora** pasa a línea de tiempo con ícono por tipo de evento y en orden **más nuevo primero** — hoy es texto plano en orden ascendente. Los íconos salen del mismo mapeo que la Task 2, no de uno nuevo.

- [ ] **Step 1:** Tests primero. Mínimo: que el paño muestra el estado actual y su tiempo; que los botones son exactamente las transiciones legales desde ese estado; que una orden anulada no ofrece transiciones; que la bitácora va de más nueva a más vieja; que cada evento muestra su ícono.
- [ ] **Step 2:** Velos fallar. Implementá. Verde.
- [ ] **Step 3:** Corré los tests del ticket — esta tarea cambia la estructura del cuerpo de la ficha, que es donde el ciclo del shell rompió el ticket la vez pasada.
- [ ] **Step 4:** `npm test && npm run lint && npx tsc --noEmit`, y commit.

---

### Task 5: Cerrar el ciclo

**Files:**
- Modify: `docs/pantallas.md`, `CLAUDE.md`

- [ ] **Step 1:** Actualizá las tres secciones de servicio técnico en `docs/pantallas.md`.
- [ ] **Step 2:** Anotá el ciclo en `CLAUDE.md`. Lo que tiene que quedar: que el estado `APROBADO` entró y **por qué** (la aprobación del cliente no quedaba registrada, y en un service eso es lo que hay que poder probar antes de gastar un repuesto); y **la pregunta abierta** que la decisión 2 deja — que la maqueta dibuja para `EN_REPARACION` botones que no coinciden con el grafo, y que cambiar eso es rediseñar el flujo del negocio, no presentación.
- [ ] **Step 3:** `npm test && npm run lint && npx tsc --noEmit`, y commit.
