# El detalle de una venta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una venta pueda llevar un texto libre —un dato de entrega: a quién se le entregó, una dirección, un teléfono— escrito al cobrar en `/vender` y editable después desde `/ventas/[id]`.

**Architecture:** Una columna nullable `ventas.detalle`, una única función de saneo (`lib/ventas/detalle.ts`) compartida por sus dos escritores (`crearVenta` al cobrar y `guardarDetalle` al editar), un `Textarea` dentro del `<form>` de cobro que ya existe, y una card propia en el detalle de la venta con su server action. El campo no participa de ningún total ni de ninguna validación de plata.

**Tech Stack:** Next.js (App Router) + TypeScript, Prisma sobre PostgreSQL con RLS, shadcn/ui, vitest con base efímera.

**Spec:** `docs/superpowers/specs/2026-09-08-detalle-de-venta-design.md`

## Global Constraints

- **Tope del texto: 500 caracteres.** Vive una sola vez, como `TOPE_DETALLE` en `lib/ventas/detalle.ts`, y lo consumen el motor, la server action y los dos `Textarea`. Nunca se repite el número literal en otro archivo.
- **El texto se corta, no se rechaza.** Pasarse del tope jamás produce un error de dominio.
- **Vacío o sólo espacios se guarda como `NULL`**, nunca como `''`.
- **Sin permiso nuevo.** `lib/permisos/catalogo.ts` **no** crece: sigue en nueve permisos. La server action va detrás de `exigirSesion`.
- **La columna es `detalle` (singular) y el rótulo de pantalla es "Detalles"** (plural), en las dos pantallas.
- **El campo no toca ningún total.** No entra en `totalesDeItems`, ni en `totalesDePagos`, ni en ningún chip de faltante o vuelto.
- **Una migración con SQL escrito a mano va con `--create-only`** (`docs/decisiones-del-rediseno.md`): sin eso `migrate dev` la aplica al generarla y editarla después choca contra el guard de checksum, que exige `migrate reset` — prohibido en este proyecto.
- **`lib/ventas/detalle.ts` no importa nada.** Es la condición para que un archivo `'use client'` pueda importar `TOPE_DETALLE` de valor sin arrastrar `pg` al bundle — lo vigila `test/limite-cliente-servidor.test.ts`. La regla es que ninguna cadena de imports llegue a `lib/db.ts`; acá simplemente no necesitamos importar nada, así que no lo hacemos.
- **Comandos del gate:** `npm test` (levanta la base efímera, corre `prisma migrate deploy` y después vitest), `npx tsc --noEmit`, `npm run lint`.
- **Los tests del motor viven en `test/ventas.test.ts`**, no en `lib/ventas/crear.test.ts` (ese archivo no existe: el motor necesita el arnés de base efímera que sólo está montado en `test/`).

---

### Task 1: `lib/ventas/detalle.ts` — el tope y el saneo

**Files:**
- Create: `lib/ventas/detalle.ts`
- Test: `lib/ventas/detalle.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `export const TOPE_DETALLE = 500`
  - `export function normalizarDetalle(texto: string | null | undefined): string | null`

- [ ] **Step 1: Write the failing test**

Create `lib/ventas/detalle.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TOPE_DETALLE, normalizarDetalle } from './detalle'

describe('normalizarDetalle', () => {
  it('devuelve el texto tal cual cuando ya viene limpio', () => {
    expect(normalizarDetalle('Lo retira el hermano el jueves')).toBe(
      'Lo retira el hermano el jueves',
    )
  })

  it('recorta los espacios de los bordes', () => {
    expect(normalizarDetalle('  avisar al 11 5555-1234  ')).toBe('avisar al 11 5555-1234')
  })

  // Las tres formas de "no se anotó nada" tienen que dar el MISMO resultado:
  // `null`, o sea la ausencia del dato. Un `''` guardado sería una tercera
  // respuesta que ninguna pantalla sabe distinguir de las otras dos.
  it('trata vacío, sólo espacios y ausente como la ausencia del dato', () => {
    expect(normalizarDetalle('')).toBeNull()
    expect(normalizarDetalle('   \n  ')).toBeNull()
    expect(normalizarDetalle(undefined)).toBeNull()
    expect(normalizarDetalle(null)).toBeNull()
  })

  it('corta en el tope en vez de rechazar', () => {
    const largo = 'a'.repeat(TOPE_DETALLE + 50)
    expect(normalizarDetalle(largo)).toHaveLength(TOPE_DETALLE)
  })

  // El corte puede caer justo sobre un espacio, y un detalle que termina en
  // espacio es exactamente lo que el trim de arriba existe para evitar.
  it('el corte no deja un espacio colgando al final', () => {
    const texto = `${'a'.repeat(TOPE_DETALLE - 1)} bcdef`
    const salida = normalizarDetalle(texto)
    expect(salida).toBe('a'.repeat(TOPE_DETALLE - 1))
    expect(salida).not.toMatch(/\s$/)
  })

  // El multilínea se conserva: el control de las dos pantallas es un
  // <textarea>, así que los saltos son parte de lo que la persona escribió.
  it('conserva los saltos de línea internos', () => {
    expect(normalizarDetalle('Retira Ana\nMartes 10 a 12')).toBe('Retira Ana\nMartes 10 a 12')
  })

  it('el tope es 500', () => {
    expect(TOPE_DETALLE).toBe(500)
  })
})

describe('el módulo', () => {
  // La condición que deja importar TOPE_DETALLE desde un archivo 'use client'
  // sin arrastrar `pg` al bundle del navegador. Lo vigila también
  // test/limite-cliente-servidor.test.ts, pero acá falla al lado de la causa.
  it('no importa nada, para poder viajar al bundle del cliente', async () => {
    const { readFileSync } = await import('node:fs')
    const fuente = readFileSync(new URL('./detalle.ts', import.meta.url), 'utf8')
    expect(fuente).not.toMatch(/^\s*import\s/m)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/ventas/detalle.test.ts`
Expected: FAIL — "Failed to resolve import './detalle'".

- [ ] **Step 3: Write minimal implementation**

Create `lib/ventas/detalle.ts`:

```ts
/**
 * El detalle de una venta: texto libre que el local anota sobre ella — a quién
 * se le entregó, una dirección, un teléfono suelto.
 *
 * **No significa nada para el motor.** No participa de ningún total, de ninguna
 * validación de plata ni de ningún invariante: es un campo que alguien lee,
 * nunca uno que el sistema interpreta. Ésa es la propiedad que hace segura la
 * decisión de que se pueda editar una venta ya cobrada — ver el spec del ciclo.
 *
 * **Este módulo no importa nada, a propósito.** `punto-de-venta.tsx` y
 * `formularios.tsx` llevan 'use client' e importan `TOPE_DETALLE` de VALOR; un
 * import que llegue a `lib/db.ts` arrastraría `pg` al bundle del navegador y
 * tiraría abajo la compilación del cliente entera. La regla que impide eso no
 * es "cero imports", es "ninguna cadena de imports que alcance `lib/db.ts`" —
 * `lib/ventas/centavos.ts` importa `@/lib/formato/gramatica`, que es a su vez
 * puro y nunca llega a `lib/db.ts`, así que es seguro para el cliente. Acá
 * simplemente no necesitamos nada, así que no importamos.
 */

/**
 * El tope del texto. Vive UNA sola vez y lo consumen los cuatro lugares que lo
 * necesitan: `crearVenta`, `guardarDetalle` y los dos `Textarea`. El número
 * repetido a mano en un quinto lugar es un número que se desincroniza.
 *
 * 500 porque el campo es para un dato de entrega y no para un cuaderno.
 */
export const TOPE_DETALLE = 500

/**
 * Deja el detalle listo para guardar.
 *
 * **Vacío, sólo espacios y ausente son lo MISMO**: la ausencia del dato, o sea
 * `null`. Un `''` guardado sería una tercera respuesta que ninguna pantalla
 * sabe distinguir de las otras dos. Es el mismo criterio con el que
 * `crearVenta` ya trata un `imeiCapturado` vacío: el camino por defecto —nadie
 * anotó nada— no puede ser un error ni una fila con basura adentro.
 *
 * **Y lo que pasa el tope se CORTA, no se rechaza.** Un cartel rojo en el
 * mostrador por una nota larga sería frenar un cobro por lo único de esa
 * pantalla que no es plata. El `maxLength` de los dos textarea ya impide llegar
 * acá desde la pantalla; este corte es la red para un POST armado a mano.
 *
 * El segundo `trim()` es por el corte: puede caer justo sobre un espacio, y un
 * detalle que termina en espacio es lo que el primero existe para evitar.
 */
export function normalizarDetalle(texto: string | null | undefined): string | null {
  if (texto === null || texto === undefined) return null
  const limpio = texto.trim().slice(0, TOPE_DETALLE).trim()
  return limpio === '' ? null : limpio
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/ventas/detalle.test.ts`
Expected: PASS — 8 casos.

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/detalle.ts lib/ventas/detalle.test.ts
git commit -m "feat(detalle-de-venta): el tope y el saneo, en un modulo puro compartido"
```

---

### Task 2: la columna y el motor

**Files:**
- Modify: `prisma/schema.prisma` (modelo `Venta`)
- Create: `prisma/migrations/<timestamp>_detalle_de_venta/migration.sql`
- Modify: `lib/ventas/crear.ts` (`EntradaCrearVenta`, el destructuring, el `tx.venta.create`)
- Test: `test/schema.test.ts`, `test/ventas.test.ts`

**Interfaces:**
- Consumes: `TOPE_DETALLE`, `normalizarDetalle` de `lib/ventas/detalle.ts` (Task 1).
- Produces:
  - `Venta.detalle` en el schema — `String?`, columna `detalle`.
  - `EntradaCrearVenta.detalle?: string` — opcional; el motor lo normaliza.

- [ ] **Step 1: Write the failing test — el schema**

En `test/schema.test.ts`, al final del archivo, agregar:

```ts
describe('la migración del detalle de venta', () => {
  it('guarda el detalle como texto nullable', async () => {
    const r = await cliente.query(
      `SELECT data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'ventas' AND column_name = 'detalle'`,
    )
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0].data_type).toBe('text')
    // Nullable y SIN default: `NULL` dice "acá no se anotó nada", que es lo que
    // pasa en la enorme mayoría de las ventas. Un `default ''` daría una
    // tercera respuesta indistinguible de las otras dos.
    expect(r.rows[0].is_nullable).toBe('YES')
    expect(r.rows[0].column_default).toBeNull()
  })
})
```

El cliente `pg` de ese archivo se llama `cliente` (no `owner`, que es el nombre que usan los otros archivos de test) — está conectado como el rol dueño en su `beforeAll`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/schema.test.ts -t "detalle de venta"`
Expected: FAIL — `expect(r.rows).toHaveLength(1)` recibe 0.

- [ ] **Step 3: Agregar la columna al schema**

En `prisma/schema.prisma`, dentro de `model Venta`, después de `anuladaPorId` y antes de `creadoEn`:

```prisma
  /// Texto libre que el local anota sobre la venta: a quién se le entregó, una
  /// dirección, un teléfono suelto. NO significa nada para el motor —no entra
  /// en ningún total ni en ninguna validación de plata—, y eso es justamente lo
  /// que hace segura la única escritura que existe sobre una venta ya cobrada
  /// (`guardarDetalle`, app/(app)/ventas/acciones.ts).
  ///
  /// Nullable y sin default, como `MovimientoStock.nota` y
  /// `UnidadDeArticulo.bajaNota`: `NULL` es "acá no se anotó nada". El saneo y
  /// el tope viven en `lib/ventas/detalle.ts`, compartidos por sus dos
  /// escritores.
  detalle           String?
```

- [ ] **Step 4: Generar la migración vacía y escribirle el SQL**

```bash
npx prisma migrate dev --create-only --name detalle_de_venta
```

`--create-only` es obligatorio: la migración lleva comentarios escritos a mano, y sin ese flag `migrate dev` la aplica al generarla — editarla después choca contra el guard de checksum, que exige `migrate reset`, prohibido en este proyecto.

Si el comando no puede conectarse (`MIGRATE_DATABASE_URL` apunta al Postgres del stack `arandano-dev`, que no siempre es alcanzable desde donde se corre), crear la carpeta a mano con el mismo formato de timestamp que las existentes (`prisma/migrations/20260908HHMMSS_detalle_de_venta/migration.sql`) — `npm test` la aplica igual sobre la base efímera con `migrate deploy`, así que el gate la valida de las dos formas.

Contenido de `migration.sql`:

```sql
-- El detalle de una venta: texto libre para el dato de entrega.
--
-- Aditiva e inerte: nullable, sin default, cero DROP y cero renombres. El
-- código anterior no la escribe por ningún camino y no la lee por ninguno, así
-- que la imagen vieja lee cualquier fila que esta migración pueda producir sin
-- enterarse de que la columna existe. Por eso viaja en el mismo deploy que la
-- UI: lo que expand/contract exige no es la migración en un deploy aparte, es
-- que el schema nuevo soporte la versión anterior del código.
ALTER TABLE "ventas" ADD COLUMN "detalle" TEXT;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/schema.test.ts -t "detalle de venta"`
Expected: PASS.

- [ ] **Step 6: Write the failing test — el motor**

En `test/ventas.test.ts`, dentro del `describe('crearVenta', …)`, agregar:

```ts
  it('guarda el detalle, saneado', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
      detalle: '  Lo retira el hermano el jueves  ',
    })

    const venta = await enTransaccionDeTenant(tenantId, (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id } }),
    )
    expect(venta.detalle).toBe('Lo retira el hermano el jueves')
  })

  // El caso por defecto: la enorme mayoría de las ventas no anota nada, y las
  // tres formas de decirlo tienen que llegar a la misma fila.
  it('sin detalle, o con uno vacío, la venta queda en NULL', async () => {
    const sinCampo = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
    })
    const conEspacios = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
      detalle: '   ',
    })

    const ventas = await enTransaccionDeTenant(tenantId, (tx) =>
      tx.venta.findMany({ where: { id: { in: [sinCampo.id, conEspacios.id] } } }),
    )
    expect(ventas).toHaveLength(2)
    for (const v of ventas) expect(v.detalle).toBeNull()
  })

  // Se corta y NO se rechaza: un cartel rojo en el mostrador por una nota
  // larga sería frenar un cobro por lo único de esa pantalla que no es plata.
  it('un detalle larguísimo se corta en el tope y la venta se cobra igual', async () => {
    const { TOPE_DETALLE } = await import('@/lib/ventas/detalle')
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
      detalle: 'x'.repeat(TOPE_DETALLE + 200),
    })

    const venta = await enTransaccionDeTenant(tenantId, (tx) =>
      tx.venta.findUniqueOrThrow({ where: { id } }),
    )
    expect(venta.detalle).toHaveLength(TOPE_DETALLE)
  })
```

`TOPE_DETALLE` va por import dinámico como el resto del archivo, por consistencia; un import estático también funcionaría (el módulo no toca la base), pero el archivo entero usa dinámicos y mezclar confunde.

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/ventas.test.ts -t "detalle"`
Expected: FAIL — `tsc`/vitest rechazan `detalle` porque `EntradaCrearVenta` no lo tiene.

- [ ] **Step 8: Implementar en `crearVenta`**

En `lib/ventas/crear.ts`:

1. Sumar el import, junto a los otros de `./`:

```ts
import { normalizarDetalle } from './detalle'
```

2. En `EntradaCrearVenta`, después de `claveIdempotencia`:

```ts
  /**
   * Texto libre que el local anota sobre la venta. OPCIONAL a propósito, que es
   * lo contrario de lo que este repo decidió para `categoriaId` en
   * `editarArticulo`: allá el dato cruzaba dos pantallas y dos caminos de
   * lectura y olvidárselo fallaba en silencio; acá hay un solo escritor real
   * (`cobrar`) y decenas de llamadores de test y de seed a los que el campo no
   * les dice nada. Lo que cubre el hueco es un caso que va del FormData a la
   * fila (app/(app)/vender/acciones.test.ts).
   */
  detalle?: string
```

3. En el destructuring de la primera línea de `crearVenta`, sumar `detalle`:

```ts
  const { tenantId, usuarioId, clienteId, items, pagos, claveIdempotencia, detalle } = entrada
```

4. Normalizar ANTES de abrir la transacción, junto al resto de las validaciones de dominio — inmediatamente después del bloque que normaliza `imeisCapturados` y antes de `items.forEach(...)`:

```ts
  // Acá y no adentro de la transacción, por lo mismo que los IMEI de arriba:
  // es una regla de dominio sobre la entrada, no algo que dependa de nada que
  // la base tenga que decir. Y en el MOTOR y no en el server action, para que
  // cualquier llamador —pantalla, script, un módulo que llame a
  // `crearVentaDesde`— guarde el campo con la misma forma.
  const detalleGuardado = normalizarDetalle(detalle)
```

5. En `tx.venta.create`, dentro de `data`, después de `claveIdempotencia`:

```ts
          detalle: detalleGuardado,
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/ventas.test.ts`
Expected: PASS — todo el archivo, incluidos los tres casos nuevos y los que ya estaban.

- [ ] **Step 10: Regenerar el ERD y correr el gate**

```bash
npx tsc --noEmit
npm run lint
npm test
```

`docs/schema.md` lo regenera el hook de pre-commit al commitear; si el hook falla porque el archivo quedó desactualizado, correr el script que él usa (`scripts/generar-erd.sh`) y volver a agregar.

Expected: los tres en verde.

- [ ] **Step 11: Commit**

```bash
git add prisma/schema.prisma prisma/migrations lib/ventas/crear.ts test/schema.test.ts test/ventas.test.ts docs/schema.md
git commit -m "feat(detalle-de-venta): la columna y el motor, con la migracion inerte"
```

---

### Task 3: `cobrar` pasa el detalle del formulario al motor

**Files:**
- Modify: `app/(app)/vender/acciones.ts` (la función `cobrar`)
- Test: `app/(app)/vender/acciones.test.ts`

**Interfaces:**
- Consumes: `EntradaCrearVenta.detalle` (Task 2).
- Produces: el campo `detalle` del `FormData` de `/vender` llega a la fila.

- [ ] **Step 1: Write the failing test**

En `app/(app)/vender/acciones.test.ts`, dentro del `describe('cobrar', …)`, agregar:

```ts
  // El caso que cubre el hueco de que `EntradaCrearVenta.detalle` sea opcional:
  // si `cobrar` dejara de pasarlo, `tsc` no diría nada y el dato desaparecería
  // en silencio. Va del FormData a la fila, sin escalas.
  it('el detalle del formulario llega a la fila de la venta', async () => {
    estado.cookie = cookieEmpleado
    const datos = formulario({ clave: `detalle-${crypto.randomUUID()}` })
    datos.set('detalle', '  Lo retira el hermano el jueves  ')

    const r = await cobrar(INICIAL, datos)
    expect(r.error).toBeNull()
    expect(r.venta).not.toBeNull()

    const f = await owner.query(`SELECT detalle FROM ventas WHERE id = $1`, [r.venta!.id])
    expect(f.rows[0].detalle).toBe('Lo retira el hermano el jueves')
  })

  // El camino por defecto del mostrador: nadie escribe nada y el campo ni
  // siquiera viaja. Tiene que dar exactamente lo mismo que antes de este ciclo.
  it('sin el campo, la venta queda sin detalle', async () => {
    estado.cookie = cookieEmpleado
    const r = await cobrar(INICIAL, formulario({ clave: `sin-detalle-${crypto.randomUUID()}` }))
    expect(r.error).toBeNull()

    const f = await owner.query(`SELECT detalle FROM ventas WHERE id = $1`, [r.venta!.id])
    expect(f.rows[0].detalle).toBeNull()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/vender/acciones.test.ts" -t "detalle"`
Expected: FAIL — el primero recibe `null` en vez del texto.

- [ ] **Step 3: Implementar**

En `app/(app)/vender/acciones.ts`, dentro de `cobrar`, junto a la lectura de `clave` y antes del `await crearVenta({...})`:

```ts
    // Sin validar ni cortar acá: el saneo y el tope viven en el motor
    // (`normalizarDetalle`, lib/ventas/detalle.ts), que es el que los aplica
    // para TODOS sus llamadores. Repetirlos acá sería la segunda copia de la
    // misma regla, que es exactamente la forma de defecto que este repo ya pagó
    // con las dos implementaciones del selector de categoría.
    const detalle = String(datos.get('detalle') ?? '')
```

y en la llamada, después de `claveIdempotencia`:

```ts
      detalle,
```

No hace falta traducir `''` a `undefined`: `normalizarDetalle('')` ya devuelve `null`, que es la misma fila que produce no mandar el campo.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(app)/vender/acciones.test.ts"`
Expected: PASS — el archivo entero.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/vender/acciones.ts" "app/(app)/vender/acciones.test.ts"
git commit -m "feat(detalle-de-venta): cobrar pasa el detalle del formulario al motor"
```

---

### Task 4: el campo en `/vender`

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx` (imports, estado, el `<form>` de cobro, el reset tras cobrar)
- Modify: `docs/pantallas.md` (sección `/vender`)
- Test: `app/(app)/vender/punto-de-venta.test.tsx`

**Interfaces:**
- Consumes: `TOPE_DETALLE` de `lib/ventas/detalle.ts` (Task 1); el campo `detalle` que lee `cobrar` (Task 3).
- Produces: nada que otra task consuma.

- [ ] **Step 1: Write the failing test**

En `app/(app)/vender/punto-de-venta.test.tsx`, agregar un `describe` nuevo al final:

```tsx
describe('el detalle de la venta', () => {
  it('el textarea existe, se rotula "Detalles" y viaja con el nombre que lee cobrar', async () => {
    const html = await render()
    expect(html).toContain('Detalles')
    expect(html).toMatch(/<textarea[^>]*name="detalle"/)
  })

  // Adentro del <form> de cobro y no suelto en la card: si quedara afuera, el
  // submit no lo llevaría y el campo no llegaría nunca al servidor — sin que
  // nada fallara, porque `cobrar` lo trata como opcional.
  it('vive DENTRO del <form> de cobro', async () => {
    const html = await render()
    const desdeElForm = html.slice(html.indexOf('<form'))
    const hastaElCierre = desdeElForm.slice(0, desdeElForm.indexOf('</form>'))
    expect(hastaElCierre).toMatch(/<textarea[^>]*name="detalle"/)
  })

  // El tope se lee del módulo compartido, no se escribe a mano acá: es el
  // mismo número que corta el servidor, y dos copias son dos números que se
  // desincronizan.
  it('el maxLength es el tope del servidor', async () => {
    const { TOPE_DETALLE } = await import('@/lib/ventas/detalle')
    const html = await render()
    expect(html).toMatch(new RegExp(`<textarea[^>]*maxlength="${TOPE_DETALLE}"`, 'i'))
    expect(SIN_COMENTARIOS).toContain('TOPE_DETALLE')
    expect(SIN_COMENTARIOS).not.toMatch(/maxLength=\{500\}/)
  })

  // Se limpia al cobrar, junto con el carrito y los pagos: sin esto, el detalle
  // de la venta anterior quedaría pegado a la siguiente — un dato de entrega
  // aplicado a la persona equivocada.
  it('el reset tras cobrar lo vacía junto con el carrito', async () => {
    expect(SIN_COMENTARIOS).toMatch(
      /setVentaProcesada\(estado\.venta\.id\)[\s\S]*?setDetalle\(''\)[\s\S]*?\n\s*\}/,
    )
  })

  // `Enter` con el foco en el textarea NO cobra: la allow-list ya lo cubre
  // (sólo BODY o sin foco disparan), y acá queda fijado contra el modo de falla
  // que este repo ya pagó una vez con los Select de Radix.
  it('Enter con el foco en el textarea no dispara el cobro', async () => {
    const { puedeDispararCobroDesdeFoco } = await import('./punto-de-venta')
    expect(puedeDispararCobroDesdeFoco('TEXTAREA')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx" -t "el detalle de la venta"`
Expected: FAIL — no hay ningún `<textarea name="detalle">`.

- [ ] **Step 3: Implementar — imports y estado**

En `app/(app)/vender/punto-de-venta.tsx`:

1. Sumar a los imports de componentes:

```tsx
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
```

2. Sumar el import de valor del módulo puro, junto al de `centavos`:

```tsx
// De VALOR y no de tipo, y se puede: `lib/ventas/detalle.ts` no importa nada,
// así que no arrastra `pg` al bundle del cliente — la misma condición que
// cumple `lib/ventas/centavos.ts`, unas líneas más arriba.
import { TOPE_DETALLE } from '@/lib/ventas/detalle'
```

3. Junto al resto de los `useState` (al lado de `const [pagos, setPagos] = useState<Pago[]>([])`):

```tsx
  // Controlado y no libre en el DOM: el reset tras cobrar limpia por estado, y
  // un textarea sin controlar se quedaría con el detalle de la venta anterior.
  const [detalle, setDetalle] = useState('')
```

- [ ] **Step 4: Implementar — el reset**

En el bloque `if (estado.venta && estado.venta.id !== ventaProcesada) { … }`, después de `setPagos([])`:

```tsx
    // El detalle es de ESA venta: dejarlo puesto pegaría el dato de entrega de
    // un cliente a la venta del siguiente.
    setDetalle('')
```

- [ ] **Step 5: Implementar — el campo**

Dentro del `<form>` de cobro, inmediatamente después del `</div>` que cierra el bloque de pagos (el `<div className="flex flex-col gap-3 p-4">` que contiene los `<FilaDePago>` y el botón "Agregar pago") y ANTES del espaciador `<div className="flex-1" />`:

```tsx
                {/* El detalle de la venta: texto libre para el dato de entrega
                    —a quién se le entregó, una dirección, un teléfono—. No
                    participa de ningún total ni de ningún chip: un local que no
                    lo use ve el campo vacío y nada más.

                    Va DESPUÉS de los pagos y antes del pie: el pie es lo que se
                    lee de un vistazo justo antes de apretar Cobrar (totales,
                    faltante, botón), y un campo de texto en el medio de eso
                    sería ruido en el único momento en que la pantalla se mira
                    con apuro.

                    `maxLength` con el MISMO tope que corta el servidor, para
                    que el corte no sea una sorpresa. Adentro del <form>, que es
                    lo único que hace que el campo viaje en el submit. */}
                <div className="flex flex-col gap-1.5 px-4 pb-4">
                  <Label htmlFor="detalle-de-la-venta" className="text-xs text-foreground-soft">
                    Detalles (opcional)
                  </Label>
                  <Textarea
                    id="detalle-de-la-venta"
                    name="detalle"
                    value={detalle}
                    onChange={(e) => setDetalle(e.target.value)}
                    maxLength={TOPE_DETALLE}
                    rows={2}
                    placeholder="Lo retira el hermano el jueves"
                  />
                </div>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run "app/(app)/vender/punto-de-venta.test.tsx"`
Expected: PASS — el archivo entero, incluidos los casos de responsive y tipografía que ya estaban.

- [ ] **Step 7: Correr el gate**

```bash
npx tsc --noEmit
npm run lint
npx vitest run test/responsive.test.ts test/limite-cliente-servidor.test.ts test/pantallas.test.ts
```

Expected: verde. `test/limite-cliente-servidor.test.ts` es el que confirma que el import de valor de `TOPE_DETALLE` no arrastró `pg`.

- [ ] **Step 8: Documentar la pantalla**

En `docs/pantallas.md`, sección `## \`/vender\``, agregar bajo las features del panel de cobro:

```markdown
- **Detalles (opcional).** Un textarea de dos filas dentro del `<form>` de cobro,
  entre los pagos y el pie. Texto libre para el dato de entrega —a quién se le
  entregó, una dirección, un teléfono—: no participa de ningún total ni de
  ningún chip, así que un local que no lo use no ve ninguna diferencia. Viaja
  como el campo `detalle` del formulario; el saneo y el tope (500) los aplica el
  motor, una sola vez, en `lib/ventas/detalle.ts`. Se limpia al cobrar junto con
  el carrito: el detalle es de esa venta, no del turno. `Enter` con el foco acá
  no cobra — la allow-list del atajo global sólo dispara con el foco en `<body>`.
```

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/vender/punto-de-venta.tsx" "app/(app)/vender/punto-de-venta.test.tsx" docs/pantallas.md
git commit -m "feat(detalle-de-venta): el campo en el panel de cobro de /vender"
```

---

### Task 5: `guardarDetalle` — la server action

**Files:**
- Modify: `app/(app)/ventas/acciones.ts`
- Test: `app/(app)/ventas/acciones.test.ts`

**Interfaces:**
- Consumes: `normalizarDetalle` de `lib/ventas/detalle.ts` (Task 1); la columna (Task 2).
- Produces:
  - `export type EstadoDetalle = { error: string | null; aviso: string | null }`
  - `export async function guardarDetalle(entrada: { ventaId: string; detalle: string }): Promise<EstadoDetalle>`

**Por qué un objeto y no `(estado, FormData)` como `anular`.** El precedente
directo es `guardarInformacionDelLocal` (`app/(app)/bot/acciones.ts`), que es la
otra card del producto con un textarea que guarda: se invoca desde un handler
con `useTransition` y el resultado se muestra por toast, sin `useActionState` ni
`<form action>` de por medio. `anular` usa `FormData` porque su UI es una
confirmación en dos pasos dentro de un `<form>`; acá no hay form. El costo
aceptado, ya aceptado antes en este repo (los `Select` de Radix): **sin
JavaScript no se puede editar el detalle**. Verlo sí.

- [ ] **Step 1: Write the failing test**

En `app/(app)/ventas/acciones.test.ts`, sumar `guardarDetalle` a los imports dinámicos del `beforeAll` (junto a `anular`):

```ts
let guardarDetalle: typeof import('./acciones').guardarDetalle
```
```ts
  ;({ anular, guardarDetalle } = await import('./acciones'))
```

Sumar al `beforeAll`, después del alta del artículo, el tenant ajeno con su venta — el arnés de este archivo hoy tiene un solo tenant:

```ts
  // Un segundo tenant con una venta suya, para el caso de aislamiento. La venta
  // va por SQL crudo y no por `crearVenta`: no hace falta que tenga
  // movimientos ni que cierre contra nada, sólo existir para que el `update`
  // tenga a qué NO llegar.
  const otro = await crearTenant(owner, `ventas-acciones-ajeno-${Date.now()}`)
  const ua = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Dueño del otro', 'duenio@otro.test', 'DUENO', now(), now())
     RETURNING id`,
    [otro],
  )
  const va = await owner.query(
    `INSERT INTO ventas (id, tenant_id, numero, usuario_id, total, creado_en)
     VALUES (gen_random_uuid(), $1, 1, $2, 1000.00, now())
     RETURNING id`,
    [otro, ua.rows[0].id],
  )
  ventaAjena = va.rows[0].id
```

con `let ventaAjena: string` junto a las otras declaraciones de módulo.

Y el helper, después de `cookieDe`:

```ts
/**
 * Una venta cobrada propia de cada caso, sobre un artículo propio.
 *
 * No se reusa la `ventaId` del `beforeAll`: el describe de `anular` la anula, y
 * un caso que dependa de haber corrido antes o después de ése no prueba lo que
 * dice probar. Artículo nuevo por llamada para no competir por el stock del
 * que usan los otros casos.
 */
async function unaVentaCobrada(): Promise<string> {
  const { crearVenta } = await import('@/lib/ventas/crear')
  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, 'Artículo del detalle', 'PRODUCTO', 1000.00, 5, now(), now())
     RETURNING id`,
    [estado.tenantId, `DET-${crypto.randomUUID().slice(0, 8)}`],
  )
  const v = await crearVenta({
    tenantId: estado.tenantId,
    usuarioId: duenioId,
    items: [{ articuloId: a.rows[0].id, cantidad: new Prisma.Decimal('1') }],
    pagos: [{
      medio: 'EFECTIVO', moneda: 'ARS',
      base: new Prisma.Decimal('1000'), cotizacion: new Prisma.Decimal('1'),
    }],
  })
  return v.id
}

/** El detalle tal como quedó en la base. */
async function detalleDe(ventaId: string): Promise<string | null> {
  const r = await owner.query(`SELECT detalle FROM ventas WHERE id = $1`, [ventaId])
  return r.rows[0].detalle
}
```

Y el describe nuevo, al final del archivo:

```ts
describe('guardarDetalle', () => {
  it('guarda el detalle saneado sobre una venta ya cobrada', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()

    const r = await guardarDetalle({ ventaId, detalle: '  Retira Ana, martes de 10 a 12  ' })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBe('Retira Ana, martes de 10 a 12')
  })

  // Un EMPLEADO también: no hay permiso propio, y el que atiende el mostrador
  // es justamente quien se entera de a quién hay que entregarle.
  it('un EMPLEADO puede, sin permiso propio', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()

    const r = await guardarDetalle({ ventaId, detalle: 'Pasa el martes' })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBe('Pasa el martes')
  })

  // Vaciar tiene que BORRAR el dato, no dejar una cadena vacía: es la única
  // forma de volver al estado "acá no se anotó nada".
  it('vaciar el campo lo deja en NULL', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()
    await guardarDetalle({ ventaId, detalle: 'algo' })

    const r = await guardarDetalle({ ventaId, detalle: '   ' })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBeNull()
  })

  it('corta en el tope en vez de rechazar', async () => {
    const { TOPE_DETALLE } = await import('@/lib/ventas/detalle')
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()

    const r = await guardarDetalle({ ventaId, detalle: 'y'.repeat(TOPE_DETALLE + 100) })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toHaveLength(TOPE_DETALLE)
  })

  // Decisión explícita del ciclo: una venta anulada SÍ se puede detallar. Es el
  // caso que más lo necesita — es justamente aquella sobre la que alguien va a
  // querer dejar escrito qué pasó.
  it('funciona sobre una venta anulada', async () => {
    estado.cookie = cookieEmpleado
    const ventaId = await unaVentaCobrada()
    await owner.query(`UPDATE ventas SET anulada_en = now() WHERE id = $1`, [ventaId])

    const r = await guardarDetalle({
      ventaId,
      detalle: 'El cliente devolvió el equipo con la caja abierta',
    })
    expect(r.error).toBeNull()
    expect(await detalleDe(ventaId)).toBe('El cliente devolvió el equipo con la caja abierta')
  })

  // La venta de otro local no existe para esta sesión: RLS ya filtró, así que
  // el update no alcanza ninguna fila y la acción avisa en vez de romper.
  it('no toca la venta de otro tenant', async () => {
    estado.cookie = cookieEmpleado

    const r = await guardarDetalle({ ventaId: ventaAjena, detalle: 'no debería entrar' })
    expect(r.error).not.toBeNull()
    expect(await detalleDe(ventaAjena)).toBeNull()
  })

  // Un id inventado no puede salir como 500: sin este guard, Prisma rechaza el
  // uuid mal formado con un error que nadie traduce. Y tiene que dar el MISMO
  // mensaje que el de arriba — distinguirlos filtraría qué ids existen.
  it('un id que no es uuid avisa igual que uno ajeno, con el mismo mensaje', async () => {
    estado.cookie = cookieEmpleado

    const malFormado = await guardarDetalle({ ventaId: 'no-soy-un-uuid', detalle: 'x' })
    const ajena = await guardarDetalle({ ventaId: ventaAjena, detalle: 'x' })
    expect(malFormado.error).not.toBeNull()
    expect(malFormado.error).toBe(ajena.error)
  })

  // Sin sesión no se escribe nada: una server action es un endpoint que se
  // invoca sin pasar por ninguna pantalla.
  it('sin sesión, redirige y no escribe', async () => {
    estado.cookie = ''
    const ventaId = await unaVentaCobrada()

    await expect(guardarDetalle({ ventaId, detalle: 'x' })).rejects.toThrow('REDIRECT')
    expect(await detalleDe(ventaId)).toBeNull()
  })
})
```

El último caso espera `REDIRECT` y no `FORBIDDEN`: `exigirSesion` (`lib/auth/sesion.ts`) hace `redirect('/login')` cuando no hay sesión, y el mock de `next/navigation` de este archivo convierte ese `redirect` en un throw con ese texto. `FORBIDDEN` es lo que tiran los guards de permiso, que acá no hay.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/ventas/acciones.test.ts" -t "guardarDetalle"`
Expected: FAIL — `guardarDetalle` no existe.

- [ ] **Step 3: Implementar**

En `app/(app)/ventas/acciones.ts`, sumar los imports que falten y la función:

```ts
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { normalizarDetalle } from '@/lib/ventas/detalle'
import { esUuid } from '@/lib/uuid'

export type EstadoDetalle = { error: string | null; aviso: string | null }

/**
 * Guardar el detalle de una venta ya cobrada.
 *
 * **Es la primera escritura sobre una venta cerrada en todo el producto.** Lo
 * que la hace segura es su alcance: actualiza UNA columna, la de texto libre,
 * filtrada por id y por tenant, y no toca ninguna otra. Nada de lo que el motor
 * de ventas garantiza —que los pagos cierren contra los totales, que el stock
 * haya bajado, que la clave de idempotencia sea única— pasa por esta columna ni
 * puede cambiar por ella.
 *
 * **Sin permiso propio**, detrás de `exigirSesion` como `ingresarMercaderia` y
 * `corregirPorConteo`. La regla de este repo es delegar por lo que la acción
 * MUEVE: `PLANES_PAGO` existe aparte porque mueve el precio de todo el
 * catálogo, `ARTICULOS_BORRAR` porque no se deshace. Esto mueve una columna de
 * texto y se corrige tipeando de nuevo.
 *
 * **Y funciona también sobre una venta anulada**, a propósito: el detalle no es
 * parte de lo que se cobró, y una venta anulada es justamente aquella sobre la
 * que alguien va a querer dejar escrito qué pasó.
 *
 * **Sin rastro de quién editó ni de qué decía antes.** Es un campo, no una
 * tabla-libro: una corrección pisa lo anterior. Está aceptado en el spec del
 * ciclo, con la salida escrita por si algún día hace falta.
 */
export async function guardarDetalle(entrada: {
  ventaId: string
  detalle: string
}): Promise<EstadoDetalle> {
  const sesion = await exigirSesion()
  const { ventaId, detalle } = entrada
  // El mismo guard que el resto de las pantallas con id en la URL: sin esto,
  // Prisma rechaza un uuid mal formado con un error que nadie traduce y la
  // acción sale como 500 en vez de como el aviso que corresponde. El mensaje es
  // EL MISMO que el de la venta ajena, unas líneas más abajo: distinguirlos
  // filtraría qué ids existen.
  if (!esUuid(ventaId)) return { error: NO_EXISTE, aviso: null }

  // `updateMany` y no `update`: RLS ya filtra por tenant, así que la venta de
  // otro local simplemente no aparece — con `update` eso sería una excepción
  // P2025 (un 500), y con `updateMany` es `count === 0`, que es exactamente el
  // mismo caso que un id inventado.
  const { count } = await prismaParaTenant(sesion.tenant.id).venta.updateMany({
    where: { id: ventaId },
    data: { detalle: normalizarDetalle(detalle) },
  })
  if (count === 0) return { error: NO_EXISTE, aviso: null }

  revalidatePath(`/ventas/${ventaId}`)
  return { error: null, aviso: 'Detalles guardados.' }
}
```

`NO_EXISTE` **no puede ser un `export const`**: `acciones.ts` lleva `'use server'` y ahí un export que no sea una función async tira abajo la pantalla en runtime con el build en verde — lo fija `test/use-server.test.ts`. Va como constante privada del módulo:

```ts
/** El mismo texto para el id mal formado y para la venta de otro local: son el
 *  mismo caso para quien mira la pantalla, y distinguirlos filtraría qué ids
 *  existen. */
const NO_EXISTE = 'Esa venta no existe.'
```

Verificar que los nombres importados existan tal cual (`exigirSesion` en `@/lib/auth/sesion`, `prismaParaTenant` en `@/lib/tenant/prisma`, `esUuid` en `@/lib/uuid`) — los tres se usan ya en `app/(app)/ventas/[id]/page.tsx` y en `app/(app)/vender/acciones.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/(app)/ventas/acciones.test.ts"`
Expected: PASS — el archivo entero.

- [ ] **Step 5: Correr los tests transversales**

```bash
npx vitest run test/use-server.test.ts test/permisos-catalogo.test.ts test/rutas-con-guard.test.ts
npx tsc --noEmit
```

Expected: verde. `test/permisos-catalogo.test.ts` confirma que el catálogo sigue en nueve permisos.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/ventas/acciones.ts" "app/(app)/ventas/acciones.test.ts"
git commit -m "feat(detalle-de-venta): guardarDetalle, la primera escritura sobre una venta cerrada"
```

---

### Task 6: la card "Detalles" en `/ventas/[id]`

**Files:**
- Modify: `app/(app)/ventas/formularios.tsx` (componente nuevo `DetalleDeLaVenta`)
- Modify: `app/(app)/ventas/[id]/page.tsx` (`select`, `DatosDelDetalle`, props de `Detalle`, la card y los `order-N`)
- Modify: `docs/pantallas.md` (sección `/ventas/[id]`)
- Test: `app/(app)/ventas/[id]/page.test.tsx`, `test/ventas.test.ts`

**Interfaces:**
- Consumes: `guardarDetalle` / `EstadoDetalle` (Task 5); `TOPE_DETALLE` (Task 1); `Venta.detalle` (Task 2).
- Produces: nada que otra task consuma.

- [ ] **Step 1: Write the failing test — el render**

En `app/(app)/ventas/[id]/page.test.tsx`, agregar `detalle={null}` a los defaults de `renderDetalle` (la prop pasa a ser requerida, así que sin esto no compila ningún caso del archivo) y sumar el describe:

```tsx
describe('la card de detalles', () => {
  it('precarga el detalle guardado', () => {
    const html = renderDetalle({ detalle: 'Retira Ana, martes de 10 a 12' })
    expect(html).toContain('Detalles')
    expect(html).toContain('Retira Ana, martes de 10 a 12')
  })

  // La card se dibuja SIEMPRE, con o sin dato: es el lugar donde el detalle se
  // carga cuando aparece después, así que esconderla vacía sería esconder
  // justamente el caso que este ciclo existe para atender.
  it('se dibuja también sin detalle, con el textarea vacío', () => {
    const html = renderDetalle({ detalle: null })
    expect(html).toContain('Detalles')
    expect(html).toMatch(/<textarea[^>]*id="detalle-de-la-venta"[^>]*>\s*<\/textarea>/)
  })

  it('el maxLength es el tope del servidor', async () => {
    const { TOPE_DETALLE } = await import('@/lib/ventas/detalle')
    const html = renderDetalle({ detalle: null })
    expect(html).toMatch(new RegExp(`<textarea[^>]*maxlength="${TOPE_DETALLE}"`, 'i'))
  })

  // Editable también anulada: es la decisión del ciclo, y el caso la fija para
  // que nadie la "arregle" más adelante creyendo que es un descuido.
  it('se ofrece igual sobre una venta anulada', () => {
    const html = renderDetalle({ detalle: null, anulada: true, notaDeAnulacionTexto: 'Anulada por X' })
    expect(html).toMatch(/<textarea[^>]*id="detalle-de-la-venta"/)
  })

  // El orden de la pila del teléfono: Detalles va cuarta y la Zona de riesgo
  // queda última. Si alguien inserta la card sin renumerar, la acción
  // destructiva se le mete en el medio.
  it('en el teléfono va cuarta, con la zona de riesgo última', () => {
    const html = renderDetalle({ detalle: null })
    const posDetalles = html.indexOf('order-4')
    const posRiesgo = html.indexOf('order-5')
    expect(posDetalles).toBeGreaterThan(-1)
    expect(posRiesgo).toBeGreaterThan(-1)
  })
})
```

Y en `test/ventas.test.ts`, dentro del `describe` de `datosDelDetalle`, agregar:

```ts
  it('trae el detalle de la venta', async () => {
    const { id } = await crearVenta({
      tenantId,
      usuarioId,
      items: [{ articuloId: remera, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000'), cotizacion: d('1') }],
      detalle: 'Retira Ana',
    })

    const datos = await datosDelDetalle(tenantId, id)
    expect(datos?.detalle).toBe('Retira Ana')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/(app)/ventas/[id]/page.test.tsx" -t "card de detalles"`
Expected: FAIL — no existe la prop ni la card.

- [ ] **Step 3: El componente cliente**

En `app/(app)/ventas/formularios.tsx`, sumar a los imports:

```tsx
import { toast } from 'sonner'
import { useTransition } from 'react'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { guardarDetalle, type EstadoDetalle } from './acciones'
import { TOPE_DETALLE } from '@/lib/ventas/detalle'
```

y el componente:

```tsx
/**
 * El detalle de la venta: verlo y editarlo.
 *
 * `useTransition` + toast y no `useActionState` + `<Alert>` inline, siguiendo
 * el precedente más cercano que hay (la card "Lo que el bot sabe del local",
 * app/(app)/bot/formularios.tsx): el aviso se lanza en el MISMO handler que
 * ejecuta la acción, con el resultado en la mano, nunca desde un `useEffect`
 * sobre el estado — un efecto está atado al ciclo de vida del componente, y con
 * cada `revalidatePath` el componente se remonta y se lleva el aviso puesto.
 * La clave del toast es estable, o sonner apila una copia por cada guardado.
 *
 * Los errores no se auto-descartan (dicen qué corregir); los éxitos sí.
 *
 * El textarea es NO controlado (`defaultValue`): no hay ninguna cuenta que
 * dependa de lo que se está tipeando, así que un estado propio sólo agregaría
 * un render por tecla. Al volver del servidor, `revalidatePath` trae el valor
 * nuevo y React remonta con él.
 */
export function DetalleDeLaVenta({
  ventaId,
  detalle,
}: {
  ventaId: string
  detalle: string | null
}) {
  const [guardando, empezar] = useTransition()
  const [texto, setTexto] = useState(detalle ?? '')

  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="detalle-de-la-venta" className="sr-only">
        Detalles
      </Label>
      {/* Sin `name`, a diferencia del de `/vender`: acá no hay `<form>` que lo
          postee —el texto viaja por el estado hasta el `onClick`—, y un
          atributo que no cumple ninguna función es ruido que el próximo lector
          va a interpretar como que algo lo lee. */}
      <Textarea
        id="detalle-de-la-venta"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        maxLength={TOPE_DETALLE}
        rows={4}
        placeholder="Lo retira el hermano el jueves"
      />
      <Button
        type="button"
        size="sm"
        disabled={guardando}
        className="w-full lg:w-auto lg:self-end"
        onClick={() =>
          empezar(async () => {
            const r: EstadoDetalle = await guardarDetalle({ ventaId, detalle: texto })
            if (r.error) toast.error(r.error, { id: 'detalle-de-venta', duration: Infinity })
            else if (r.aviso) toast.success(r.aviso, { id: 'detalle-de-venta' })
          })
        }
      >
        {guardando ? 'Guardando…' : 'Guardar detalles'}
      </Button>
    </div>
  )
}
```

Sumar `useState` al import de React que el archivo ya tiene (`import { useActionState, useState } from 'react'` → agregar `useTransition`).

**Controlado y no `defaultValue`**, al revés de lo que haría un `<form>`: sin form no hay `FormData` de donde sacar el texto, así que el valor tiene que estar en el estado para que el `onClick` lo pueda mandar. Es el mismo patrón, y por el mismo motivo, que la card "Lo que el bot sabe del local".

- [ ] **Step 4: La consulta y las props**

En `app/(app)/ventas/[id]/page.tsx`:

1. En el `select` de `datosDelDetalle`, sumar `detalle` a la primera línea de campos escalares:

```ts
      id: true, numero: true, total: true, recargo: true, creadoEn: true, anuladaEn: true, totalUsd: true,
      // Texto libre del local sobre esta venta. Se muestra y se edita en su
      // propia card; no entra en ningún cálculo.
      detalle: true,
```

2. En el tipo `DatosDelDetalle`, sumar:

```ts
  detalle: string | null
```

3. En el `return` de `datosDelDetalle`, sumar:

```ts
    detalle: venta.detalle,
```

4. En las props de `Detalle`, sumar `detalle: string | null` con su docblock corto, y pasarla desde `DetalleDeVenta` (`detalle={datos.detalle}`).

5. Importar el componente: `import { AnularVenta, DetalleDeLaVenta } from '../formularios'` (ajustar al import que ya exista).

- [ ] **Step 5: La card y los `order-N`**

En la columna derecha (`<div className="contents lg:flex lg:w-[324px] …">`), insertar la card ENTRE el bloque de "Resumen" y el de "Zona de riesgo":

```tsx
          {/* El detalle de la venta (sin frame en design/arandano.pen — ver
              docs/correcciones-pendientes-del-pen.md): card propia y no una
              fila del panel Resumen, que es de sólo lectura con un formato
              fijo. Se dibuja SIEMPRE, con o sin dato: es el lugar donde el
              detalle se carga cuando aparece después, así que esconderla vacía
              sería esconder el caso que este ciclo existe para atender.

              Va pegada al Resumen y por encima de la Zona de riesgo: describe
              la venta, y la acción destructiva se queda última en las dos
              disposiciones. */}
          <div className="order-4 flex flex-col overflow-hidden rounded-2xl border bg-card lg:order-none">
            <div className="border-b px-[14px] py-3 lg:px-[18px] lg:py-[13px]">
              <h2 className={`${estilos.tituloDeCard} text-foreground`}>Detalles</h2>
            </div>
            <div className="p-[14px] lg:p-4">
              <DetalleDeLaVenta ventaId={ventaId} detalle={detalle} />
            </div>
          </div>
```

y **renumerar**: el bloque de Zona de riesgo (las dos ramas del ternario, `<Alert className="order-4 …">` y `<div className="order-4 …">`) pasa a `order-5`. Actualizar también el docblock de `Detalle`, que enumera el orden del teléfono: pasa a ser `1: Resumen, 2: Qué se vendió, 3: Cómo se pagó, 4: Detalles, 5: Zona de riesgo`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run "app/(app)/ventas/[id]/page.test.tsx"
npx vitest run test/ventas.test.ts
```

Expected: PASS los dos.

- [ ] **Step 7: Correr el gate**

```bash
npx tsc --noEmit
npm run lint
npx vitest run test/limite-cliente-servidor.test.ts test/servidor-llama-a-cliente.test.ts test/responsive.test.ts test/toaster.test.ts
```

Expected: verde. `test/servidor-llama-a-cliente.test.ts` confirma que el Server Component sólo RENDERIZA el componente cliente y no invoca ninguna función suya.

- [ ] **Step 8: Documentar la pantalla**

En `docs/pantallas.md`, sección `## \`/ventas/[id]\``, agregar:

```markdown
- **Detalles.** Card propia en la columna derecha, entre Resumen y Zona de
  riesgo, con un textarea y "Guardar detalles" (`guardarDetalle`). Se dibuja
  siempre, con o sin dato: es donde el detalle se carga cuando aparece después
  del cobro. **Es la primera escritura sobre una venta ya cobrada** del
  producto, y actualiza una sola columna filtrada por id y tenant — nada de lo
  que el motor garantiza pasa por ahí. **Se puede editar también una venta
  anulada**, a propósito: el detalle no es parte de lo que se cobró, y una venta
  anulada es justamente sobre la que alguien quiere dejar escrito qué pasó.
  Sin permiso propio (`exigirSesion`) y sin rastro de quién editó: es un campo,
  no una tabla-libro. Aviso por toast, con clave estable, lanzado en el mismo
  handler que ejecuta la acción.
```

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/ventas/formularios.tsx" "app/(app)/ventas/[id]/page.tsx" "app/(app)/ventas/[id]/page.test.tsx" test/ventas.test.ts docs/pantallas.md
git commit -m "feat(detalle-de-venta): la card Detalles en el detalle de la venta"
```

---

### Task 7: la documentación del ciclo

**Files:**
- Modify: `docs/correcciones-pendientes-del-pen.md` (entrada 36)
- Modify: `CLAUDE.md` (entrada del ciclo en "Próximos pasos técnicos")

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: La entrada del `.pen`**

En `docs/correcciones-pendientes-del-pen.md`, antes de la sección `## Cómo agregar una entrada`, sumar:

```markdown
## 36. La maqueta no dibuja el campo de detalles ni su card, en ningún ancho

`design/arandano.pen` es anterior al ciclo del detalle de venta (2026-09-08), así
que no tiene frame para dos piezas que ahora existen:

- **El textarea "Detalles (opcional)"** del panel de cobro de `App / Vender`,
  entre la lista de pagos y el pie. Derivado de los controles que la propia card
  ya dibuja; lo que no tiene referencia es cuánto espacio vertical se le puede
  dar sin empujar el botón Cobrar fuera de la vista en el teléfono, que es
  justamente el punto que la verificación manual del ciclo tiene que mirar.
- **La card "Detalles"** de `App / Venta detalle` y de `Móvil / Venta detalle`,
  entre Resumen y Zona de riesgo. Derivada de las cards con formulario de
  `/inventario/[id]`. La maqueta dibuja cuatro cards en esta pantalla y ahora
  son cinco, así que el reparto de la columna derecha tampoco tiene referencia.

Qué haría falta: los dos frames dibujados, y en particular una decisión sobre
la altura del textarea del cobro en el ancho del teléfono.
```

- [ ] **Step 2: La entrada del ciclo en `CLAUDE.md`**

En `CLAUDE.md`, en la lista de "Y del producto:" de *Próximos pasos técnicos*, después de la entrada del borrado de artículo, sumar una entrada tachada con el mismo formato que las vecinas. Tiene que cubrir, sin repetir el spec entero:

- El origen textual del pedido y la precisión de que el dato es de cliente/entrega.
- Que **el campo no significa nada para el motor**, y que ésa es la propiedad que hace segura la edición de una venta cerrada.
- Que es **la primera escritura sobre una venta ya cobrada** del producto, con su alcance acotado a una columna.
- Que **se edita también anulada**, con el porqué.
- **Sin permiso nuevo** (`lib/permisos/catalogo.ts` sigue en nueve) y el razonamiento de "se delega por lo que la acción mueve".
- **Sin rastro de ediciones**, dicho sin maquillar, con la salida aditiva conocida.
- Que la migración es inerte y viaja en el mismo deploy que la UI.
- Lo que el ciclo NO hace: nada en el listado de `/ventas` (con el disparador para reconsiderarlo), sin campos estructurados de entrega, sin tocar el ticket, el bot no lo lee.
- La verificación manual pendiente, con el punto del teléfono a 390 px.

- [ ] **Step 3: Correr el gate completo**

```bash
npm test
npx tsc --noEmit
npm run lint
```

Expected: los tres en verde. Anotar el número de tests que pasan.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/correcciones-pendientes-del-pen.md
git commit -m "docs(detalle-de-venta): la entrada del ciclo y la deuda con la maqueta"
```

---

## Después del plan

Antes de mergear:

1. **Review de rama** (`superpowers:requesting-code-review`), que con un solo desarrollador es la única segunda mirada que existe.
2. **Verificación manual**, después del merge (`arandano-dev` bind-montea `/root/arandano`, que sirve `main`): los seis puntos de la sección *Verificación manual* del spec. El que ningún test contesta es el 5 — el textarea del panel de cobro a 390 px, y si empuja el botón Cobrar fuera de la vista.
