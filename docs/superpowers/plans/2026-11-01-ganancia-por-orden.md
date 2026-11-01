# Ganancia por orden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada orden de servicio técnico guarda el costo del repuesto y lo cobrado; la ganancia se ve en el detalle y, por mes, en el tablero con el chip Entregado.

**Architecture:** Tres columnas nullable en `ordenes_de_trabajo` (`costo`, `monto_cobrado`, `entregada_en`). La lógica pura (cuenta de ganancia, nota de bitácora, rango de un mes en hora Argentina) vive en `lib/ordenes-de-trabajo/plata.ts` y `mes.ts`; las escrituras en `operaciones.ts`; las pantallas sólo leen y llaman actions. Los cambios de plata dejan un `EventoOrden` con `desde = hasta`, que es la marca de "evento de plata".

**Tech Stack:** Next.js App Router, Prisma, Postgres (RLS), vitest (`renderToStaticMarkup` para componentes, Postgres efímero para operaciones).

**Spec:** `docs/superpowers/specs/2026-11-01-ganancia-por-orden-design.md` — leerlo entero antes de la Task 1.

## Global Constraints

- Montos en pesos, `Decimal(12, 2)`, no negativos; parseo con `aDecimalOpcional` / `ErrorDeFormato` (`lib/formato/numeros`), igual que `montoEstimado`. Cero es válido; vacío es null.
- Formato en pantalla y en notas: `formatearPrecio` (`lib/formato/mostrar`).
- Todo lo de plata (card, paso de cobro, columnas, totales, notas de eventos de plata) se ve y se escribe sólo con el permiso `COSTOS`. Las actions lo exigen del lado del servidor.
- Mes = fecha de entrega en `America/Argentina/Buenos_Aires` (UTC-3 fijo). Formato en URL `YYYY-MM`.
- Las anuladas no entran en totales ni se pueden editar.
- Migración aditiva únicamente (expand/contract, `docs/contexto/entorno-y-deploy.md`).
- Un solo vitest a la vez (el Postgres de test tiene nombre fijo). Correr `npx vitest run <archivo>` para lo puntual y `npm test` al final.
- Comentarios en español, con el porqué, como el código de alrededor.

## Review Focus

1. **Evento de plata en la misma transacción que la entrega**: `creado_en` es la hora de inicio de la transacción, así que comparte timestamp con el evento de Entregado; el `id` (uuid7) desempata. `diasEnEstado` tiene que seguir tomando el evento de transición, no el de plata → test en Task 5.
2. **Orden reabierta por garantía** (`ENTREGADO → EN_REPARACION`): conserva `entregadaEn` y `montoCobrado`; no aparece en el chip Entregado; al reentregar, `entregadaEn` se pisa con la nueva fecha y el paso precarga el cobrado actual → tests en Task 3 y Task 5.
3. **Empleado sin `COSTOS` que entrega**: el form no manda `montoCobrado`; si un POST armado lo manda igual, la action lo rechaza y no mueve la orden → test en Task 4.
4. **`?mes=` basura** (`2026-13`, `abc`, `9999-01`): cae al mes en curso, nunca un 500 → test en Task 2.
5. **Borde de mes**: una entrega del 31/10 a las 22:30 hora Argentina (01:30 UTC del 1/11) cuenta en octubre → test en Task 2 (rango) y Task 6 (consulta).

---

### Task 1: Schema, migración y permiso

**Files:**
- Modify: `prisma/schema.prisma` (model `OrdenDeTrabajo`, ~línea 1260)
- Create: `prisma/migrations/20261101120000_plata_de_la_orden/migration.sql`
- Modify: `lib/ordenes-de-trabajo/estados.test.ts`
- Modify: `lib/permisos/catalogo.ts:61`
- Modify: `docs/schema.md` (bloque `ordenes_de_trabajo`)

**Interfaces:**
- Produces: campos Prisma `costo: Decimal | null`, `montoCobrado: Decimal | null`, `entregadaEn: Date | null` en `OrdenDeTrabajo`.

- [ ] **Step 1: Test de que el grafo no tiene lazos** en `estados.test.ts`:

```ts
it('ningún estado transiciona a sí mismo: desde === hasta marca un evento de plata', () => {
  for (const e of ESTADOS) expect(TRANSICIONES[e]).not.toContain(e)
})
```

- [ ] **Step 2: Correr** `npx vitest run lib/ordenes-de-trabajo/estados.test.ts` — Expected: PASS (fija una invariante que hoy ya vale; el comentario del test dice por qué importa).

- [ ] **Step 3: Agregar al model**, debajo de `montoEstimado`, con comentarios del porqué (spec decisiones 1–2):
  - `costo Decimal? @map("costo") @db.Decimal(12, 2)` — null = nadie lo cargó, distinto de cero.
  - `montoCobrado Decimal? @map("monto_cobrado") @db.Decimal(12, 2)`
  - `entregadaEn DateTime? @map("entregada_en") @db.Timestamptz(3)` — la ÚLTIMA vez que pasó a ENTREGADO; la escribe `cambiarEstado`. No se borra al reabrir por garantía.
  - Índice `@@index([tenantId, estado, entregadaEn])` (el tablero filtra Entregado por mes).

- [ ] **Step 4: Generar la migración** con `npx prisma migrate dev --name plata_de_la_orden --create-only`, renombrar la carpeta a `20261101120000_plata_de_la_orden` si hace falta, y agregar al final el backfill de `entregada_en` para las órdenes que hoy están en `ENTREGADO`:

```sql
UPDATE ordenes_de_trabajo o
SET entregada_en = e.ultima
FROM (
  SELECT orden_id, max(creado_en) AS ultima
  FROM eventos_orden WHERE hasta = 'ENTREGADO' GROUP BY orden_id
) e
WHERE e.orden_id = o.id AND o.estado = 'ENTREGADO';
```

  Aplicar con `npx prisma migrate dev`. Verificar con `scripts/setup-db-roles.sh` que no hay grants por columna que agregar (no los hay: sólo se revoca DELETE).

- [ ] **Step 5: Actualizar `ayuda` de `COSTOS`** a: `'Ver el costo de compra y el margen, cargarlos al recibir mercadería, y ver y cargar el costo y lo cobrado de cada orden de servicio técnico.'` Actualizar `docs/schema.md` con las tres columnas.

- [ ] **Step 6: Correr** `npx vitest run test/schema.test.ts test/permisos-catalogo.test.ts test/rls-cobertura.test.ts lib/ordenes-de-trabajo/estados.test.ts` y `npx tsc --noEmit` — Expected: PASS.

- [ ] **Step 7: Commit** `feat(servicio-tecnico): columnas de costo, cobrado y fecha de entrega en la orden`

---

### Task 2: Lógica pura — ganancia, nota de plata y mes

**Files:**
- Create: `lib/ordenes-de-trabajo/plata.ts`, `lib/ordenes-de-trabajo/plata.test.ts`
- Create: `lib/ordenes-de-trabajo/mes.ts`, `lib/ordenes-de-trabajo/mes.test.ts`

**Interfaces:**
- Produces (`plata.ts`):
  - `ganancia(cobrado: Prisma.Decimal | null, costo: Prisma.Decimal | null): Prisma.Decimal | null`
  - `type Falta = 'costo' | 'cobrado' | 'ambos'`; `queFalta(cobrado, costo): Falta | null`
  - `fraseDeFalta(f: Falta): string` → `'Falta cargar el costo'` / `'Falta cargar lo cobrado'` / `'Falta cargar el costo y lo cobrado'`
  - `notaDePlata(cambios: { costo?: [Decimal | null, Decimal | null]; cobrado?: [Decimal | null, Decimal | null] }): string | null` — una línea por campo que cambió, `'Costo: $ 25.000,00 → $ 28.000,00'`, `'Cobrado: sin cargar → $ 40.000,00'`, unidas con `' · '`; `null` si nada cambió (comparar con `Decimal.equals`, null == null).
  - `esEventoDePlata(e: { desde: EstadoOrden | null; hasta: EstadoOrden }): boolean` → `e.desde === e.hasta`
  - `precargaDelCobro(o: { montoCobrado: Decimal | null; montoEstimado: Decimal | null }): string` — `montoCobrado` si existe, si no `montoEstimado`, si no `''`; como string sin signo (`montoSinSigno(formatearPrecio(...))`, mismo formato que `CardFallaYDiagnostico` ya precarga).
- Produces (`mes.ts`):
  - `mesEnCurso(ahora: Date): string` → `'2026-11'` (en hora Argentina)
  - `mesValido(v: string | undefined, ahora: Date): string` — `/^\d{4}-(0[1-9]|1[0-2])$/` y no posterior al mes en curso; si no, `mesEnCurso(ahora)`.
  - `rangoDelMes(mes: string): { desde: Date; hasta: Date }` — `desde` = día 1 00:00 −03:00, `hasta` = día 1 del mes siguiente 00:00 −03:00 (exclusivo).
  - `mesAnterior(mes: string): string`, `mesSiguiente(mes: string): string`
  - `nombreDelMes(mes: string): string` → `'noviembre 2026'`

- [ ] **Step 1: Tests de `plata.test.ts`**, con estas aserciones como mínimo:
  - `ganancia(d('40000'), d('28000'))` equals `12000`; `ganancia(d('10000'), d('15000'))` equals `-5000`; `ganancia(null, d('1'))` y `ganancia(d('1'), null)` son `null`; `ganancia(d('0'), d('0'))` equals `0`.
  - `queFalta(null, null) === 'ambos'`, `queFalta(d('1'), null) === 'costo'`, `queFalta(d('0'), d('0')) === null`.
  - `notaDePlata({ costo: [d('25000'), d('28000')] })` === `` `Costo: ${formatearPrecio('25000')} → ${formatearPrecio('28000')}` ``; `notaDePlata({ cobrado: [null, d('40000')] })` empieza con `'Cobrado: sin cargar → '`; `notaDePlata({ costo: [d('5'), d('5.00')], cobrado: [null, null] })` es `null`.
  - `esEventoDePlata({ desde: 'LISTO', hasta: 'LISTO' })` true; `({ desde: null, hasta: 'RECIBIDO' })` false.
  - `precargaDelCobro({ montoCobrado: d('40000'), montoEstimado: d('35000') })` usa 40000; con `montoCobrado: null` usa 35000; con los dos null, `''`.

- [ ] **Step 2: Tests de `mes.test.ts`**:
  - `mesEnCurso(new Date('2026-11-01T02:30:00Z'))` === `'2026-10'` (23:30 del 31/10 en Argentina).
  - `rangoDelMes('2026-10')` → `desde.toISOString() === '2026-10-01T03:00:00.000Z'`, `hasta.toISOString() === '2026-11-01T03:00:00.000Z'`; `rangoDelMes('2026-12').hasta` es `2027-01-01T03:00:00.000Z`.
  - `mesValido` con `'2026-13'`, `'abc'`, `undefined`, `'9999-01'` (futuro) devuelve el mes en curso; con `'2026-09'` devuelve `'2026-09'`.
  - `mesAnterior('2026-01') === '2025-12'`, `mesSiguiente('2026-12') === '2027-01'`.
  - `nombreDelMes('2026-11') === 'noviembre 2026'`.

- [ ] **Step 3: Correr ambos** — Expected: FAIL (módulos inexistentes).

- [ ] **Step 4: Implementar** `plata.ts` y `mes.ts`. Para el mes en hora Argentina, `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit' })` (mismo patrón que `[id]/page.tsx`); para el rango, construir con offset fijo `-03:00` (`new Date(\`${mes}-01T00:00:00-03:00\`)`), con un comentario de que Argentina no tiene horario de verano desde 2009.

- [ ] **Step 5: Correr ambos** — Expected: PASS.

- [ ] **Step 6: Commit** `feat(servicio-tecnico): cuenta de ganancia y rango de un mes en hora argentina`

---

### Task 3: Operaciones — entregar con cobro y guardar la plata

**Files:**
- Modify: `lib/ordenes-de-trabajo/operaciones.ts`
- Modify: `lib/ordenes-de-trabajo/errores.ts`
- Test: `test/ordenes-de-trabajo.test.ts`

**Interfaces:**
- Consumes: `notaDePlata` (Task 2).
- Produces:
  - `EntradaCambiarEstado` suma `montoCobrado?: Prisma.Decimal | null` (sólo admitido con `hasta === 'ENTREGADO'`; `undefined` = no tocar).
  - `guardarPlata(entrada: { tenantId: string; usuarioId: string; ordenId: string; costo: Prisma.Decimal | null; montoCobrado?: Prisma.Decimal | null }): Promise<void>` (`montoCobrado` `undefined` = no tocar).
  - Códigos nuevos en `CodigoErrorDeOrden`: `'SIN_ENTREGAR'` (cobrado en una orden que nunca se entregó) y `'COBRO_FUERA_DE_ENTREGA'` (montoCobrado en una transición que no es a ENTREGADO).

- [ ] **Step 1: Tests en `test/ordenes-de-trabajo.test.ts`**, en un `describe('la plata de la orden')`, contra la base (helpers del archivo; leer `costo`, `monto_cobrado`, `entregada_en` y `eventos_orden` con `owner.query`). Llevar una orden a `LISTO` con `cambiarEstado` para los casos de entrega.
  - `cambiarEstado({ hasta: 'ENTREGADO', montoCobrado: d('40000') })` → `monto_cobrado = 40000`, `entregada_en` no null, y DOS eventos nuevos: el de transición (`desde LISTO, hasta ENTREGADO`, sin montos en `nota`) y uno de plata (`desde = hasta = ENTREGADO`, `nota` = `notaDePlata({ cobrado: [null, d('40000')] })`).
  - `cambiarEstado({ hasta: 'ENTREGADO' })` sin `montoCobrado` → `entregada_en` seteado, `monto_cobrado` null, un solo evento.
  - `cambiarEstado({ hasta: 'LISTO', montoCobrado: d('1') })` → `ErrorDeOrden` con `codigo 'COBRO_FUERA_DE_ENTREGA'`, orden sin cambios.
  - Garantía: entregada con 40000 → `EN_REPARACION` → `LISTO` → `ENTREGADO` con `montoCobrado: d('40000')` → `entregada_en` es posterior al primero, y NO se escribe evento de plata (no cambió nada).
  - `guardarPlata({ costo: d('28000') })` en una orden `EN_REPARACION` → `costo = 28000`, un evento `desde = hasta = EN_REPARACION` con la nota del costo.
  - `guardarPlata` con los mismos valores que ya tiene → ningún evento nuevo.
  - `guardarPlata({ costo: null, montoCobrado: d('1') })` en una orden nunca entregada → `codigo 'SIN_ENTREGAR'`.
  - `guardarPlata` con `costo: d('-1')` → `codigo 'MONTO_INVALIDO'`; en una orden anulada → `'ORDEN_ANULADA'`; desde otro tenant → `'ORDEN_INEXISTENTE'`.

- [ ] **Step 2: Correr** `npx vitest run test/ordenes-de-trabajo.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar.**
  - `traerAbierta` devuelve además `costo`, `montoCobrado`, `entregadaEn`.
  - `cambiarEstado`: validar `COBRO_FUERA_DE_ENTREGA` y monto negativo antes de abrir la transacción; con `hasta === 'ENTREGADO'` escribir `entregadaEn: new Date()` siempre, y `montoCobrado` si vino; crear el evento de transición y DESPUÉS, si `notaDePlata` da no null, el evento de plata (orden de creación = orden de `id`).
  - `guardarPlata`: mismo orden de chequeos que `guardarDiagnostico`; `SIN_ENTREGAR` si viene `montoCobrado` y `entregadaEn` es null; update + evento de plata sólo si `notaDePlata` no es null.
  - Reescribir el docblock de `anularOrden`: sigue sin evento, pero ya no es cierto que "`desde = hasta` es una fila que el grafo no puede producir y nadie sabe leer" — ahora es la marca de un evento de plata; la anulación sigue en la fila por las mismas razones de `Venta`. Agregar un docblock en `guardarPlata` explicando la marca y apuntando al test de lazos de Task 1.

- [ ] **Step 4: Correr** `npx vitest run test/ordenes-de-trabajo.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `feat(servicio-tecnico): la orden guarda costo y cobrado, con su línea en la bitácora`

---

### Task 4: Actions

**Files:**
- Modify: `app/(app)/servicio-tecnico/acciones.ts`
- Test: `app/(app)/servicio-tecnico/acciones.test.ts`

**Interfaces:**
- Consumes: `cambiarEstado` con `montoCobrado`, `guardarPlata` (Task 3); `puedeConSesion`, `exigirPermiso` (`lib/permisos/guarda`).
- Produces:
  - `moverEstado` lee el campo `montoCobrado` del FormData: si el campo **está presente** (`datos.has('montoCobrado')`), exige `COSTOS` con `puedeConSesion(sesion, 'COSTOS')` y, si no lo tiene, devuelve `{ error: 'No tenés permiso para cargar lo cobrado.', aviso: null }` sin llamar a `cambiarEstado`; si lo tiene, pasa `aDecimalOpcional(texto, 'lo cobrado')`. Campo ausente → `montoCobrado: undefined`.
  - `guardarPlataDeOrden(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio>` — `exigirPermiso('COSTOS')`; campos `ordenId`, `costo`, y `montoCobrado` sólo si está presente; aviso `'Listo, se guardó.'`.

- [ ] **Step 1: Tests** (mismo estilo de mocks del archivo; sumar `guardarPlata` al mock de operaciones y `puedeConSesion` al de guarda):
  - `moverEstado` con `hasta=ENTREGADO&montoCobrado=40000` y `puedeConSesion → true` llama a `cambiarEstado` con `montoCobrado` igual a `40000` (Decimal).
  - Mismo POST con `puedeConSesion → false` → devuelve error y `cambiarEstado` no se llama.
  - Sin campo `montoCobrado` → `cambiarEstado` recibe `montoCobrado: undefined` y `puedeConSesion` no se consulta.
  - `guardarPlataDeOrden` exige `COSTOS` (mismo chequeo sobre el fuente que el test de `anular`) y sin campo `montoCobrado` llama a `guardarPlata` con `montoCobrado: undefined`.

- [ ] **Step 2: Correr** `npx vitest run "app/(app)/servicio-tecnico/acciones.test.ts"` — Expected: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** el mismo archivo y `npx vitest run test/use-server.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(servicio-tecnico): actions para cobrar al entregar y guardar la plata, detrás de COSTOS`

---

### Task 5: Detalle de la orden — card "Plata", paso de cobro y bitácora

**Files:**
- Modify: `app/(app)/servicio-tecnico/formularios.tsx` (`PanelEstado`, nuevo `CardPlata`)
- Modify: `app/(app)/servicio-tecnico/[id]/page.tsx` (`tituloDeEvento`, `Bitacora`, `diasEnEstado`, consulta, render)
- Test: `app/(app)/servicio-tecnico/formularios.test.tsx`, `app/(app)/servicio-tecnico/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `ganancia`, `queFalta`, `fraseDeFalta`, `esEventoDePlata`, `precargaDelCobro` (Task 2); `guardarPlataDeOrden`, `moverEstado` (Task 4).
- Produces:
  - `PanelEstado` suma props `cobro: { precarga: string } | null` (null = sin `COSTOS`, el botón Entregado mueve directo como hoy).
  - `CardPlata({ accion, ordenId, costo, montoCobrado, montoEstimado, entregada, anulada })` — montos como `string | null` (ya formateados del lado del server, igual que `CardFallaYDiagnostico`).
  - `tituloDeEvento(e, verPlata: boolean)`; `Bitacora({ eventos, verPlata })`.
  - `ultimoCambioDeEstado(eventos: { desde; hasta; creadoEn }[]): Date | null` exportada desde `[id]/page.tsx` — el primer evento (lista más nuevo primero) que NO es de plata.

- [ ] **Step 1: Tests de `PanelEstado`** en `formularios.test.tsx`:
  - Con `cobro: { precarga: '40.000,00' }` y `siguientes: ['ENTREGADO']`, el HTML inicial NO tiene un `<button type="submit" name="hasta" value="ENTREGADO">`, sí un botón `type="button"` con el texto "Entregado" (el paso se abre en el cliente). Cubrir la apertura del paso con un test que renderice el estado abierto: exportar `PasoDeCobro({ precarga, pendiente })` y asertar que tiene el label `¿Cuánto cobraste?`, un input `name="montoCobrado"` con `value="40.000,00"`, y un submit `name="hasta" value="ENTREGADO"` con texto `Confirmar entrega`.
  - Con `cobro: null`, el botón Entregado es el submit de siempre y no hay `montoCobrado` en el HTML.
  - Con `cobro` y `siguientes: ['LISTO']`, no aparece `montoCobrado`.

- [ ] **Step 2: Tests de `CardPlata`**:
  - Entregada, costo `28.000,00`, cobrado `40.000,00` → muestra la ganancia `formatearPrecio('12000')` y no muestra ninguna frase "Falta".
  - No entregada → no hay input `montoCobrado`; muestra `Presupuesto: ` + el monto estimado.
  - Entregada sin costo → muestra `Falta cargar el costo` y ningún monto de ganancia.
  - Ganancia negativa (cobrado 10000, costo 15000) → muestra `formatearPrecio('-5000')`.
  - `anulada` → ningún `<input>` ni botón de guardar.

- [ ] **Step 3: Tests en `[id]/page.test.tsx`**:
  - `tituloDeEvento({ desde: 'LISTO', hasta: 'LISTO' }, true) === 'Plata actualizada'`; con `false`, `'Se actualizó la plata de la orden'`; los títulos de transición siguen iguales.
  - `Bitacora` con un evento de plata con nota `'Costo: …'` y `verPlata: false` → el HTML no contiene `'Costo:'`; con `verPlata: true` sí.
  - `ultimoCambioDeEstado` con `[plata (más nuevo), transición a ENTREGADO, apertura]` devuelve la fecha de la transición; con sólo la apertura, la de la apertura.
  - El test de la consulta (`describe('la consulta y el armado de la ficha')`) suma que se piden `costo`, `montoCobrado`, `entregadaEn`.

- [ ] **Step 4: Correr** los dos archivos — Expected: FAIL.

- [ ] **Step 5: Implementar.**
  - `PanelEstado`: con `cobro` y `hasta === 'ENTREGADO'`, `BotonDeTransicion` se dibuja como `type="button"` que hace `setCobrando(true)`; con `cobrando`, se reemplazan los botones por `PasoDeCobro` (dentro del mismo `<form>`, así viajan `ordenId` y `nota`) más un botón "Volver".
  - `CardPlata`: card con el mismo esqueleto de `CardFallaYDiagnostico` (título `Plata`), un `<form action>` con `useActionState(guardarPlataDeOrden)`, inputs `costo` y (si `entregada`) `montoCobrado`, fila de Ganancia, botón outline "Guardar".
  - `[id]/page.tsx`: `verPlata = await puedeConSesion(sesion, 'COSTOS')`; `CardPlata` sólo si `verPlata`, debajo de `CardFallaYDiagnostico`; `cobro = verPlata ? { precarga: precargaDelCobro(orden) } : null`; `diasEnEstado` desde `ultimoCambioDeEstado(orden.eventos) ?? orden.creadoEn` (reescribir el comentario de la invariante); `Bitacora` pinta los eventos de plata con ícono `Banknote` de lucide y clase `bg-muted text-foreground-soft`, y oculta la nota cuando `!verPlata`.
  - Si `CardPlata` o el paso de cobro quedan con copia de escritorio y de teléfono, la guarda va en las dos (ver `test/permisos-en-las-dos-copias.test.ts`). Lo esperado es una sola copia responsive.

- [ ] **Step 6: Correr** los dos archivos y `npx vitest run test/permisos-en-las-dos-copias.test.ts test/responsive.test.ts test/sistema-de-diseno.test.ts` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(servicio-tecnico): card de plata y cobro al entregar en el detalle de la orden`

---

### Task 6: Tablero — Entregado por mes, columnas y totales

**Files:**
- Modify: `lib/ordenes-de-trabajo/buscar.ts` (`filtroDelTablero`)
- Create: `lib/ordenes-de-trabajo/totales.ts`
- Modify: `app/(app)/servicio-tecnico/page.tsx`
- Test: `lib/ordenes-de-trabajo/buscar.test.ts`, `test/ordenes-de-trabajo.test.ts`, `app/(app)/servicio-tecnico/page.test.tsx`

**Interfaces:**
- Consumes: `mesValido`, `rangoDelMes`, `mesAnterior`, `mesSiguiente`, `nombreDelMes`, `mesEnCurso` (Task 2); `ganancia`, `queFalta` (Task 2).
- Produces:
  - `filtroDelTablero(busqueda, filtro, rango?: { desde: Date; hasta: Date })` — con `filtro === 'ENTREGADO'`, `busqueda === ''` y `rango`, suma `entregadaEn: { gte: desde, lt: hasta }`. Buscando, el mes NO se aplica (las entregadas viejas se encuentran con la búsqueda).
  - `totalesDelMes(prisma: ReturnType<typeof prismaParaTenant>, rango: { desde: Date; hasta: Date }): Promise<{ cobrado: Decimal; costo: Decimal; ganancia: Decimal; sinDatos: number }>` en `totales.ts` — sobre `estado ENTREGADO, anuladaEn null, entregadaEn en rango`: `cobrado` = suma de las que tienen cobrado, `costo` = suma de las que tienen costo, `ganancia` = suma de (cobrado − costo) sólo de las que tienen los dos, `sinDatos` = cantidad a las que les falta alguno. Dos `aggregate` alcanzan (uno general, uno con los dos no null); tipar el parámetro como `ReturnType<typeof prismaParaTenant>` (no hay un tipo exportado).
  - `hrefTablero` suma `mes?: string`.
  - `FilaDeOrden` suma `plata: { cobrado: string; costo: string; ganancia: string; falta: boolean } | null` (`'—'` para lo que no hay).
  - `Listado` suma props `totales: { cobrado: string; costo: string; ganancia: string; sinDatos: number } | null` (null = sin columnas de plata).
  - `SelectorDeMes({ mes, mesActual, busqueda })` — links "‹" y "›" a `hrefTablero({ estado: 'ENTREGADO', mes })`, el "›" deshabilitado en el mes en curso, y el texto `nombreDelMes(mes)`.

- [ ] **Step 1: Tests de `filtroDelTablero`**: con `('', 'ENTREGADO', rango)` el where tiene `entregadaEn: { gte, lt }`; con `('juan', 'ENTREGADO', rango)` no tiene `entregadaEn`; con `('', 'LISTO', rango)` no tiene `entregadaEn`.

- [ ] **Step 2: Tests de `totalesDelMes`** en `test/ordenes-de-trabajo.test.ts` (tenant propio para no mezclar con otros casos; fijar `entregada_en` con `owner.query`): tres entregadas en octubre (40000/28000, 10000/15000, 20000/sin costo), una anulada en octubre (100000/1), una entregada el `2026-11-01T01:30:00Z` (cuenta en octubre: 22:30 del 31) y una el `2026-11-01T03:30:00Z` (noviembre). Para `rangoDelMes('2026-10')`: `cobrado = 70000 + la de las 01:30`, `costo = 43000 + …`, `ganancia` = suma sólo de las completas, `sinDatos = 1`. Elegir montos para la de las 01:30 y asertar los totales exactos.

- [ ] **Step 3: Tests de componentes** en `page.test.tsx`:
  - `Listado` con `totales` dibuja los encabezados `Cobrado`, `Costo`, `Ganancia` y una fila de totales; con `sinDatos: 3` muestra `3 órdenes sin costo o cobrado no entran en la ganancia` (con `1`, `1 orden sin costo o cobrado no entra en la ganancia`).
  - `Listado` con `totales: null` no tiene `Ganancia` en el HTML.
  - Una fila con `plata.falta` lleva una marca visible (asertar el texto accesible `Faltan datos`).
  - `SelectorDeMes` con `mes === mesActual` no tiene link en "›"; con un mes anterior, sí, apuntando a `?estado=ENTREGADO&mes=<siguiente>`.
  - `hrefTablero({ estado: 'ENTREGADO', mes: '2026-10' })` incluye `mes=2026-10`.

- [ ] **Step 4: Correr** los tres archivos — Expected: FAIL.

- [ ] **Step 5: Implementar en `page.tsx`.**
  - `searchParams` suma `mes`; `const mes = mesValido(mesParam, new Date())`; `rango = rangoDelMes(mes)`; `verPlata = await puedeConSesion(sesion, 'COSTOS')`; `porMes = filtro === 'ENTREGADO' && busqueda === ''`.
  - Con `porMes`: `orderBy: [{ entregadaEn: 'desc' }, { id: 'desc' }]` en vez de `creadoEn asc`; pedir `costo`, `montoCobrado` en el select sólo si `verPlata`; `totalesDelMes` sólo si `porMes && verPlata`.
  - Conteo del chip Entregado: reemplazar el valor de `ENTREGADO` en `cuenta` por el `count` de entregadas no anuladas en el `rango` del mes mostrado (el seleccionado si `porMes`, si no el en curso). Comentario: así el número del chip coincide con la lista que abre.
  - `SelectorDeMes` arriba del `Listado` cuando `porMes` (para todos, tenga o no `COSTOS`). El form del buscador NO manda `mes`: buscando, el mes se ignora.
  - `plata` de cada fila y `totales` sólo cuando `porMes && verPlata`; buscando, aunque el chip sea Entregado, no hay columnas de plata (spec, decisión 7).
  - `rotuloDeRango` / `etiquetaDelConjunto`: con `porMes`, el rótulo dice `órdenes «Entregado» de <nombreDelMes>`; ajustar sus tests.
  - Columnas en escritorio dentro del grid existente; en el teléfono, los tres montos en una línea secundaria de la fila (`Cobró $ X · Costo $ Y · Ganó $ Z`), mismo patrón `lg:hidden` / `hidden lg:block` del archivo.

- [ ] **Step 6: Correr** los tres archivos y `npx vitest run test/responsive.test.ts test/pantallas.test.ts` — Expected: PASS.
- [ ] **Step 7: Commit** `feat(servicio-tecnico): entregadas por mes con lo cobrado, el costo y la ganancia`

---

### Task 7: Cierre — gate completo y documentación del ciclo

**Files:**
- Modify: `docs/contexto/proximos-pasos.md`

- [ ] **Step 1: Correr** `npm test`, `npx tsc --noEmit` y `npm run lint` — Expected: todo verde. Si algo falla, arreglarlo en la task que corresponde, no acá.
- [ ] **Step 2: Entrada en `proximos-pasos.md`** del ciclo, con fecha 2026-11-01: qué se hizo; las decisiones del spec marcadas como llamada propia (un solo costo, cobrado al entregar opcional, reemplazo en garantía, mes por fecha de entrega que filtra la lista para todos, sin dólares); la forma nueva de evento `desde = hasta` y que revierte lo que decía `anularOrden`; que `COSTOS` ahora cubre también las órdenes con aceptación explícita del dueño; y lo que queda afuera (repuestos con stock, cobro por caja vía `crearVentaDesde`, dólares). Pendiente: verificación manual en dev después del merge (dev monta `/root/arandano`).
- [ ] **Step 3: Commit** `docs(servicio-tecnico): cierre del ciclo de ganancia por orden`
