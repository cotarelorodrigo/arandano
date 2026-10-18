# El arqueo de caja — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que desde la caja se vea cuánto efectivo hay ahora (por moneda), que se puedan registrar ingresos, egresos y retiros del cajón, y que el cierre del día deje registrado el arqueo: esperado, contado, retirado y lo que queda. Más `/caja`, el historial de cierres para el dueño.

**Architecture:** El turno es una ventana de tiempo `[abiertaEn, ahora)` — `Pago` no gana `cajaId`. El efectivo esperado se **deriva** en `lib/caja/efectivo.ts` (apertura + cobrado en efectivo de ventas creadas en la ventana − anulaciones devueltas + ingresos − egresos − retiros, por moneda), agregando con `groupBy`/`findMany` y nunca con `$queryRaw` (la GUC de RLS sólo la setea la extensión en operaciones de modelo). Los movimientos van en una tabla nueva append-only, `movimientos_de_caja` (RLS, `CHECK monto > 0`, `REVOKE UPDATE, DELETE`). El cierre bloquea la fila de la caja con su propio `UPDATE` y recalcula el esperado en la misma transacción. La UI de `/vender` cambia el "¿Seguro?" por un panel (Dialog en escritorio, la hoja `ControlDeCaja` en el teléfono) con el detalle, el registro de movimientos y el formulario de cierre. `/caja` es una pantalla nueva `soloDueno`.

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma 7 sobre PostgreSQL con RLS, vitest contra un Postgres efímero, shadcn/ui (Dialog y Sheet de Radix).

**Spec:** `docs/superpowers/specs/2026-10-18-arqueo-de-caja-design.md`

## Global Constraints

- **Worktree**: `/root/arandano/.claude/worktrees/arqueo-de-caja`, rama `arqueo-de-caja` sobre `cotizacion-del-dolar` (en review: no se toca esa feature).
- **Migración sólo aditiva**: columnas nuevas nullable en `cajas` (más `saldo_inicial_usd` con default 0), tabla y enum nuevos. `migrate diff --exit-code` en 0 contra una shadow descartable (se borra al terminar); ERD regenerado; el chequeo de migraciones destructivas pasa.
- **Append-only también en privilegios**: `REVOKE UPDATE, DELETE` sobre `movimientos_de_caja` en `scripts/setup-db-roles.sh`, como `cotizaciones_del_dolar`. La FK a `cajas` es `RESTRICT`, así que borrar una caja no es puerta de atrás.
- **El POS se opera con teclado**: el panel de la caja es un `Dialog` de Radix (los atajos de `/vender` se abstienen mientras está montado) y al cerrarse no devuelve el foco al chip. Enter dentro de los formularios envía ESE formulario, nunca el cobro.
- **Cualquiera del local** abre, cierra y registra movimientos (decisión 2 del spec); sin permiso nuevo, así que `test/permisos-en-las-dos-copias.test.ts` sigue diciendo "sin guarda" para las dos copias.
- **`/caja` es `soloDueno`**: pestaña, página (`exigirDuenio`) y la pantalla documentada en `docs/pantallas.md`.
- **Tests puntuales mientras se itera**; la suite completa una vez al final. Sólo este agente corre vitest.

---

### Task 1: Spec y plan commiteados

- [x] `docs(caja): spec del arqueo de caja`.
- [x] `docs(caja): plan de implementación del arqueo`.

### Task 2: Schema, migración y privilegios

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261018160000_arqueo_de_caja/`, `scripts/setup-db-roles.sh`, `test/setup-db-roles.test.ts`, `test/rls.test.ts`, `docs/schema.md`.

- [x] `Caja`: `saldoInicialUsd Decimal(12,2) @default(0)`; nullable `esperadoArs/Usd`, `contadoArs/Usd`, `retiradoArs/Usd`, `notaCierre`. Comentario de cabecera actualizado (el arqueo ya no es "la pieza 6").
- [x] `enum TipoMovimientoCaja { INGRESO, EGRESO, RETIRO }` y `MovimientoDeCaja { id, tenantId, cajaId → Caja (Restrict), tipo, moneda, monto, nota?, usuarioId → User (Restrict), creadoEn }`, `@@index([tenantId, cajaId])`.
- [x] SQL a mano: `CHECK (monto > 0)`, CHECKs de no-negativos en las columnas del arqueo, RLS + policy `tenant_aislamiento`.
- [x] `REVOKE UPDATE, DELETE` y casos en `test/setup-db-roles.test.ts`; aislamiento en `test/rls.test.ts`.
- [x] Shadow descartable: `migrate diff --exit-code` en 0. ERD regenerado.

### Task 3: El dominio — efectivo del turno, movimientos y cierre con arqueo

**Files:** `lib/caja/efectivo.ts`, `lib/caja/movimientos.ts`, `lib/caja/abrir-cerrar.ts`, `lib/caja/errores.ts`, `lib/caja/arqueo.ts` (puro, sin Prisma: lo usa el formulario de cierre en vivo), tests de cada uno.

- [x] `efectivoDelTurno(db, caja)`: apertura, cobrado (EFECTIVO por `Pago.moneda`, ventas con `creadoEn` en la ventana y no anuladas), devuelto (creadas antes, anuladas en la ventana), ingresos/egresos/retiros y actual, por moneda.
- [x] `registrarMovimiento`: con caja abierta, monto > 0, egreso con nota; bloquea la fila de la caja para no colarse en un cierre en curso.
- [x] `abrirCaja` con `saldoInicialUsd` opcional; `aperturaSugerida` = queda del último cierre con arqueo.
- [x] `cerrarCaja(tenantId, usuarioId, arqueo?)`: sin arqueo cierra como hoy (formulario cacheado); con arqueo valida contado ≥ 0, retirado ≤ contado, guarda el esperado recalculado en la transacción. La diferencia no bloquea.
- [x] Tests obligatorios del spec, con el ejemplo del pedido exacto.

### Task 4: `/vender` — el chip, el panel, los movimientos y el cierre

**Files:** `app/(app)/vender/acciones.ts`, `app/(app)/vender/caja.tsx`, `app/(app)/vender/page.tsx`, `app/(app)/vender/punto-de-venta.tsx`, `app/(app)/vender/caja.test.tsx`, `app/(app)/vender/acciones.test.ts`, `test/permisos-en-las-dos-copias.test.ts`, `docs/pantallas.md`.

- [x] Actions `registrarMovimientoDesdeVender` y `cerrarCajaDesdeVender` con arqueo; `abrirCajaDesdeVender` con dólares.
- [x] Chip "Caja abierta · $ 55.000" → Dialog con `PanelDeCaja` (detalle, movimientos, registrar, cerrar con arqueo en vivo). Hoja del teléfono con el mismo panel.
- [x] Apertura con "+ dólares" plegado y sugerida desde el último cierre.
- [x] Columna de dólares sólo si el turno tiene algún dólar.

### Task 5: `/caja` — historial de cierres

**Files:** `app/(app)/caja/page.tsx`, `app/(app)/caja/page.test.tsx`, `lib/caja/historial.ts` (+ test), `components/navegacion.tsx`, `components/navegacion.test.tsx`, `docs/pantallas.md`, `docs/correcciones-pendientes-del-pen.md`.

- [x] `exigirDuenio`, filtro desde/hasta (últimos 30 días por defecto), filas con apertura/esperado/contado/diferencia/retirado/queda por moneda, el detalle de movimientos plegado en cada fila (`<details>`, sin ruta dinámica).
- [x] Pestaña `soloDueno`.

### Task 6: Cierre del ciclo

- [x] Ajustes durante la implementación en el spec; entrada en `docs/contexto/proximos-pasos.md` (decisiones, lo que quedó afuera, preguntas para el cliente, verificación manual).
- [x] `prisma generate`, `tsc`, eslint de lo tocado, `scripts/tests/correr-todos.sh`, `npx vitest run` completo.
