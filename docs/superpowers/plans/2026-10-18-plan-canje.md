# Plan canje — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño escriba en el sistema la tabla de cuánto paga por cada usado (modelo × rango de batería) y que el vendedor la consulte en una calculadora que le dice cuánto paga el cliente por el equipo nuevo, sin poder cambiarla.

**Architecture:** Cuatro tablas nuevas con RLS (`rangos_de_bateria`, `modelos_de_canje`, `valores_de_canje`, `configuraciones_de_canje`) y un permiso nuevo `CANJE_VALORES`. La cuenta vive en funciones puras de `lib/canje/calculo.ts` (`leerBateria`, `rangoParaBateria`, `calcularCanje`) que trabajan en centavos enteros sobre `lib/ventas/centavos.ts`, sin importar Prisma, para que la calculadora corra en el navegador y no le pegue al servidor en cada tecla. La escritura vive en `lib/canje/administrar.ts` (rangos con chequeo de solapamiento bajo un lock por tenant, modelos con nombre único sin distinguir mayúsculas, la fila entera de valores en una transacción) y la lectura en `lib/canje/consultar.ts`. Dos pantallas: `/plan-canje` (la calculadora, cualquier sesión) y `/plan-canje/valores` (la tabla, `CANJE_VALORES`).

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma 7 sobre PostgreSQL con RLS por `tenant_id`, vitest contra un Postgres efímero, shadcn/ui sobre Tailwind v4, sonner para los avisos.

**Spec:** `docs/superpowers/specs/2026-10-18-plan-canje-design.md`

## Global Constraints

- **Worktree**: `/root/arandano/.claude/worktrees/plan-canje`, rama `plan-canje`, que sale de `costo-en-usd` (en review). No se toca nada de esa feature.
- **Todo en castellano rioplatense**: identificadores, mensajes, comentarios, copy.
- **Migraciones sólo aditivas.** Dos carpetas: el valor nuevo del enum `permiso` va solo en la suya (un valor de enum no se puede usar en la misma transacción que lo agrega) y las cuatro tablas en otra. Cada tabla con `ENABLE ROW LEVEL SECURITY` y la policy `tenant_aislamiento` escrita a mano. `test/rls-cobertura.test.ts` lo vigila.
- **`prisma migrate diff --from-migrations … --to-schema … --exit-code` en 0** contra una shadow descartable, y el ERD regenerado (`scripts/generar-erd.sh --verificar`).
- **`lib/canje/calculo.ts` y `lib/canje/errores.ts` no importan Prisma ni `lib/db`**: los importa un `'use client'`. `test/limite-cliente-servidor.test.ts` lo vigila.
- **Un archivo `'use server'` sólo exporta funciones async** (`test/use-server.test.ts`).
- **Cada action de la tabla re-exige `CANJE_VALORES`**; las de la calculadora sólo sesión.
- **Mobile-first**, corte `lg:`; sin anchos fijos que pasen 362 px; `SelectTrigger` con alto `!`.
- **`--marca` una sola vez por pantalla**: en `/plan-canje`, la banda de la diferencia. `/plan-canje/valores` no tiene número principal y no la usa.
- **Correr tests puntuales** mientras se itera (`npx vitest run <archivo>`); la suite completa una vez al final.

---

### Task 1: Spec commiteado

- [x] `docs(canje): spec del plan canje`.

### Task 2: El permiso `CANJE_VALORES`

**Files:** `lib/permisos/catalogo.ts`, `prisma/schema.prisma` (enum `Permiso`), `prisma/migrations/20261018130000_permiso_canje_valores/migration.sql`.

- [ ] Agregar la clave al catálogo con nombre "Editar los valores del plan canje" y su ayuda; el porqué en el docblock (por qué no se pliega sobre `ARTICULOS_EDITAR` ni `PLANES_PAGO`).
- [ ] Agregar el valor al enum con su comentario.
- [ ] Migración `ALTER TYPE "permiso" ADD VALUE 'CANJE_VALORES';`.
- [ ] `npx vitest run test/permisos-catalogo.test.ts` en verde.
- [ ] Commit `feat(canje): permiso CANJE_VALORES`.

### Task 3: Las cuatro tablas

**Files:** `prisma/schema.prisma`, `prisma/migrations/20261018130100_plan_canje/migration.sql`, `docs/schema.md`.

- [ ] Modelos `RangoDeBateria`, `ModeloDeCanje`, `ValorDeCanje` (`Decimal(12,2)`, único por `(modeloId, rangoId)`, cascade desde modelo y rango), `ConfiguracionDeCanje` (`tenantId @id`, `moneda Moneda @default(USD)`).
- [ ] Unicidad del nombre sin distinguir mayúsculas: índice único de expresión `(tenant_id, lower(nombre))` en la migración (Prisma no lo sabe expresar, mismo caso que el índice parcial de `categorias`), más el chequeo en la aplicación que da el mensaje.
- [ ] `CHECK` de `0 ≤ minimo ≤ maximo ≤ 100` y de `valor ≥ 0` en la base, como red debajo de la validación.
- [ ] RLS + policy en las cuatro.
- [ ] `migrate diff --exit-code` en 0 contra shadow descartable; ERD regenerado.
- [ ] `npx vitest run test/rls-cobertura.test.ts test/schema.test.ts`.
- [ ] Commit `feat(canje): tablas del plan canje con RLS`.

### Task 4: La cuenta pura (`lib/canje/calculo.ts`)

**Interfaces (produce):**
- `RANGOS_SUGERIDOS: readonly { minimo: number; maximo: number }[]`
- `leerBateria(texto: string): { ok: true; bateria: number } | { ok: false; mensaje: string }`
- `rangoParaBateria<R extends { minimo: number; maximo: number }>(rangos: readonly R[], bateria: number): R | null` (tira `ErrorDeCanje('BATERIA_INVALIDA')` si no es entero 0–100)
- `seSolapan(a, b): boolean`, `rotuloDeRango(r): string`
- `calcularCanje(entrada): ResultadoDeCanje` — unión discriminada `SIN_COTIZACION` / `FALTA_DOLAR` / `CALCULADO`, con montos como texto decimal canónico y `sentido: 'PAGA_EL_CLIENTE' | 'DEVUELVE_EL_LOCAL' | 'NADA'`.

- [ ] Tests primero (`lib/canje/calculo.test.ts`): bordes 100/99/90/89/85/84/80/79/0, hueco, inválidos (88,5, -1, 101, texto), iPhone 16 USD 1000 − iPhone 14 88 % USD 400 = USD 600, sin cotización, usado vale más, monedas distintas con y sin dólar tipeado (en las dos direcciones), dólar ilegible.
- [ ] Implementación sobre `lib/ventas/centavos.ts` (enteros, sin `Prisma.Decimal`).
- [ ] Commit `feat(canje): la cuenta del canje en funciones puras`.

### Task 5: Escritura y lectura (`lib/canje/administrar.ts`, `consultar.ts`, `errores.ts`)

**Interfaces (produce):**
- `crearRango`, `editarRango`, `borrarRango`, `cargarRangosSugeridos`
- `crearModelo`, `renombrarModelo`, `borrarModelo`
- `guardarValoresDeModelo({ tenantId, modeloId, valores: { rangoId, valor: Decimal | null }[] })`
- `cambiarMonedaDeCanje({ tenantId, moneda })`
- `tablaDeCanje(tenantId): Promise<TablaDeCanje>` (moneda, rangos ordenados de mayor a menor, modelos con sus valores como texto)

- [ ] Tests primero contra Postgres efímero: solapamiento rechazado (alta y edición), mínimo > máximo, fuera de 0–100, sugeridos sólo con la tabla de rangos vacía, nombre duplicado sin distinguir mayúsculas (alta y renombre), celda vacía borra, valor negativo / tres decimales rechazado, cascade al borrar modelo y rango, modelo de otro tenant no se puede escribir, RLS de las cuatro tablas entre dos tenants.
- [ ] Commit `feat(canje): administrar la tabla del plan canje`.

### Task 6: Las actions

**Files:** `app/(app)/plan-canje/acciones.ts` (calculadora: `buscarEquipos`) y `app/(app)/plan-canje/valores/acciones.ts` (la tabla, todo con `CANJE_VALORES`).

- [ ] Tests primero con la matriz de permisos: empleado sin permiso busca equipos pero cada action de la tabla da `forbidden`; empleado con permiso edita; dueño edita.
- [ ] Commit `feat(canje): las acciones del plan canje`.

### Task 7: `/plan-canje/valores`

- [ ] `page.tsx` (exige `CANJE_VALORES`), `formularios.tsx` (moneda, card de rangos con sugeridos, tabla modelo × rango con fila editable entera, alta de modelo), `tipografia.module.css`.
- [ ] Tests de render (`page.test.tsx`, `formularios.test.tsx`): vacío sin errores, sugeridos ofrecidos sólo sin rangos, celdas con el valor.
- [ ] Commit `feat(canje): la pantalla de valores del plan canje`.

### Task 8: `/plan-canje`

- [ ] `page.tsx` (sesión; trae la tabla y si puede editar), `calculadora.tsx` (búsqueda con debounce y guarda de respuesta vieja, selector de modelo, batería, banda de `--marca` con la diferencia, campo del dólar sólo con monedas distintas).
- [ ] Tests de render: vacío, el enlace a la tabla sólo para quien puede.
- [ ] Commit `feat(canje): la calculadora del plan canje`.

### Task 9: Navegación, documentación y gate

- [ ] `PESTANAS` + tests de navegación.
- [ ] `docs/pantallas.md` (las dos secciones), `docs/sistema-de-diseno.md` (ancla nueva y título de card), `test/tipografia.test.ts`, `docs/correcciones-pendientes-del-pen.md`.
- [ ] Entrada del ciclo en `docs/contexto/proximos-pasos.md` y "Ajustes durante la implementación" en el spec.
- [ ] `npx prisma generate`, `npx tsc --noEmit`, `npx eslint`, `scripts/tests/correr-todos.sh`, `npx vitest run`.
