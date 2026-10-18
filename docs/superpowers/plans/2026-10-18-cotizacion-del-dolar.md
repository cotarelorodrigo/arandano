# La cotización del dólar — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el local cargue su cotización del dólar —con historial de quién y cuándo— desde el chip "USD" de `/vender`, y que esa cotización se use donde haga falta convertir entre pesos y dólares **sólo si es de hoy**, diciendo siempre de cuándo es.

**Architecture:** Una tabla append-only con RLS, `cotizaciones_del_dolar`, y un permiso nuevo `COTIZACION`. "Hoy" se mide en hora argentina con una función pura (`esDeHoy`, `lib/formato/fechas.ts`), y las reglas que deciden qué hacer con una cotización (si se precarga, el equivalente en pesos, el margen con monedas cruzadas, el tope de cordura) viven en `lib/cotizacion/reglas.ts`, sin Prisma, porque las consumen componentes `'use client'`. La escritura en `lib/cotizacion/administrar.ts` y la lectura en `lib/cotizacion/consultar.ts`. La action vive con las demás de `/vender`. `Tenant.cotizacionUsd`/`cotizacionUsdEn` quedan sin lector (su `DROP` es un deploy posterior).

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma 7 sobre PostgreSQL con RLS, vitest contra un Postgres efímero (sin jsdom: `renderToStaticMarkup` y casos por fuente), shadcn/ui (Dialog y Sheet de Radix).

**Spec:** `docs/superpowers/specs/2026-10-18-cotizacion-del-dolar-design.md`

## Global Constraints

- **Worktree**: `/root/arandano/.claude/worktrees/cotizacion-del-dolar`, rama `cotizacion-del-dolar` desde `main`.
- **Este ciclo REVIERTE una decisión del 2026-08-29** (la cotización nunca se precarga): cada comentario y documento que enuncia la regla vieja se reescribe con la nueva y apunta al spec nuevo. La entrada del 2026-08-29 en `docs/contexto/proximos-pasos.md` marca la reversión.
- **Migraciones sólo aditivas**: el valor del enum en su propia carpeta; la tabla en otra, con RLS y policy a mano. `migrate diff --exit-code` en 0 contra una shadow descartable; ERD regenerado; el chequeo de migraciones destructivas del hook pasa.
- **Append-only también en privilegios**: `REVOKE UPDATE, DELETE` sobre la tabla para el rol de la app en `scripts/setup-db-roles.sh`, como `ediciones_venta`.
- **`lib/cotizacion/reglas.ts` y `lib/formato/fechas.ts` no importan Prisma ni `lib/db`** (`test/limite-cliente-servidor.test.ts`).
- **El POS se opera con teclado**: el diálogo de la cotización es un `Dialog` de Radix (los atajos se abstienen mientras está montado) y al cerrarse NO devuelve el foco al chip —lo deja en `<body>`, que es donde Enter cobra—.
- **La copia de escritorio y la del teléfono llevan la misma guarda** (`puedeCargarCotizacion`), atadas por `test/permisos-en-las-dos-copias.test.ts`.
- **Tests puntuales mientras se itera**; la suite completa una vez al final. Sólo este agente corre vitest.

---

### Task 1: Spec y plan commiteados

- [x] `docs(cotizacion): spec de la cotización del dólar`.
- [ ] `docs(cotizacion): plan de implementación`.

### Task 2: El permiso `COTIZACION` y la tabla

**Files:** `lib/permisos/catalogo.ts`, `prisma/schema.prisma`, `prisma/migrations/20261018140000_permiso_cotizacion/`, `prisma/migrations/20261018140100_cotizacion_del_dolar/`, `scripts/setup-db-roles.sh`, `test/setup-db-roles.test.ts`, `docs/schema.md`.

- [ ] Permiso en el catálogo ("Actualizar la cotización del dólar") y en el enum, con su porqué.
- [ ] Modelo `CotizacionDelDolar { id, tenantId, valor Decimal(12,2), cargadaPorId → User (Restrict), creadaEn }`, `@@index([tenantId, creadaEn])`. `CHECK (valor > 0)`, RLS + policy.
- [ ] Comentarios de `Tenant.cotizacionUsd`/`cotizacionUsdEn` (sin lector, DROP pendiente) y del índice viejo de `Pago`.
- [ ] REVOKE UPDATE, DELETE + caso en `test/setup-db-roles.test.ts`.
- [ ] `npx vitest run test/permisos-catalogo.test.ts test/rls-cobertura.test.ts test/setup-db-roles.test.ts test/schema.test.ts`.

### Task 3: "Hoy" y las reglas puras

**Interfaces (produce):**
- `diaEnArgentina(d: Date): string`, `esDeHoy(fecha: Date, ahora: Date): boolean` en `lib/formato/fechas.ts`.
- `formatearDiaYMes(d: Date): string` ("15/10"), `formatearCotizacion(v: string): string` ("$ 1.450" / "$ 1.450,50"), `formatearPesosRedondos(v: string)` en `lib/formato/mostrar.ts`.
- `lib/cotizacion/reglas.ts`: `type CotizacionVisible = { valor: string; creadaEn: Date }`; `cotizacionDeHoy(c, ahora): string | null`; `equivalenteEnPesos(precioUsd, c): string`; `margenConCotizacion(...)`; `esSaltoGrande(nueva, vigente): boolean` (> 50 %).
- [ ] Tests de los bordes de medianoche (23:59 y 00:00 ART contra UTC), del tope y de las cuentas.

### Task 4: Cargar y consultar

**Files:** `lib/cotizacion/{administrar,consultar,errores}.ts` + tests; `app/(app)/vender/acciones.ts` (`cargarCotizacionDesdeVender`) + tests.

- [ ] `cargarCotizacion({ tenantId, usuarioId, texto, confirmada })`: gramática de `lib/formato`, > 0, ≤ 2 decimales, entra en `Decimal(12,2)`; salto > 50 % sin confirmar → `ErrorDeCotizacion('SALTO_GRANDE')`.
- [ ] `cotizacionVigente(tenantId)`, `historialDeCotizaciones(tenantId, 10)` con nombre de quien la cargó; desempate por `id`.
- [ ] La action exige `COTIZACION`; matriz: dueño, empleado con y sin permiso (forbidden), aislamiento por tenant, historial con usuario y fecha, la vigente es la última, el salto pide confirmación.
- [ ] El cobro guarda en `Pago.cotizacion` lo tipeado aunque el local tenga otra.

### Task 5: El chip, el diálogo y el cobro de `/vender`

**Files:** `app/(app)/vender/{page,caja,punto-de-venta}.tsx` + tests, `lib/ventas/cruce.ts`, `test/permisos-en-las-dos-copias.test.ts`.

- [ ] `page.tsx` lee vigente + historial + permiso, no `Tenant.cotizacionUsd`.
- [ ] Chip de escritorio → botón que abre un `Dialog` con la vigente, quién/cuándo, el campo (con permiso) y las últimas 10; ámbar si no es de hoy o no hay; con fecha si es vieja. `onCloseAutoFocus` deja el foco en `<body>`.
- [ ] Teléfono: chip ámbar igual y el mismo panel en la hoja de `ControlDeCaja`.
- [ ] `cotizacionParaElCruce(moneda, cubre, deHoy = null)`: precarga la de hoy al cruzar; la vieja nunca. Los dos selectores de la fila la pasan; la corrección de pagos no (es una venta pasada).
- [ ] Sugerencia visible bajo "Cotización" cuando la del local es vieja.

### Task 6: Margen y equivalente en pesos

**Files:** `app/(app)/inventario/[id]/page.tsx`, `app/(app)/inventario/page.tsx` + tests.

- [ ] `textoDeMargen` convierte con la vigente y el pie dice "con el dólar a $ X del dd/mm"; sin cotización, el pie de hoy.
- [ ] "≈ $ …" en el tile "Precio de venta" y en la lista, con la fecha si es vieja.

### Task 7: Plan canje

- [ ] `page.tsx` calcula la de hoy en el servidor y la calculadora arranca con ella.

### Task 8: Documentación y cierre

- [ ] Comentarios de la regla vieja reescritos (grep `nunca se precarga`, `arranca VACÍA`, `ultimaCotizacionUsd`, `Tenant.cotizacionUsd`).
- [ ] `docs/pantallas.md` (`/vender`, `/inventario`, `/inventario/[id]`, `/plan-canje`), `docs/correcciones-pendientes-del-pen.md` si corresponde.
- [ ] `docs/contexto/proximos-pasos.md`: reversión marcada en la entrada del 2026-08-29, entrada nueva con decisiones, lo que queda afuera, preguntas al cliente, contract pendiente y verificación manual.
- [ ] `prisma generate`, `tsc --noEmit`, eslint de lo tocado, `scripts/tests/correr-todos.sh`, vitest completo.
