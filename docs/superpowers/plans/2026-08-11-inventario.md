# UI de inventario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un local pueda cargar su catálogo, ver cuánto tiene de cada cosa, recibir mercadería, corregir un faltante y entender por qué el número es el que es — todo desde el navegador, con sesión real.

**Architecture:** Tres pantallas bajo `app/(app)/inventario/`, que heredan el guard de sesión del layout que ya existe. La lógica de dominio vive en `lib/inventario/`, afuera de los server actions, con un error propio que lleva código. Una migración aditiva de tres columnas. `ajustarStock` se muda desde `lib/ventas/anular.ts` y su cuerpo se extrae a un helper transaccional que comparten las tres operaciones de stock.

**Tech Stack:** Next.js 16 (App Router, server actions), React 19 (`useActionState`), Prisma 7 con cliente generado en `generated/prisma`, PostgreSQL 17 con RLS, shadcn/ui sobre Tailwind v4, Vitest 4 contra el Postgres efímero en Docker.

**Spec:** `docs/superpowers/specs/2026-08-11-inventario-design.md`

## Global Constraints

- Todo comentario, mensaje de commit, nombre de variable, etiqueta de UI y texto de error **en español**, explicando el **porqué** y no el qué.
- **Toda la plata y toda cantidad es `Prisma.Decimal`, nunca `number`.** Escalas exactas: dinero `Decimal(12, 2)`, cantidades y stock `Decimal(12, 3)`.
- Ids `uuid(7)`, timestamps `@db.Timestamptz(3)`, columnas en `snake_case` vía `@map`, tablas en plural.
- **El historial no se borra.** Los movimientos son append-only; los artículos se desactivan, no se eliminan.
- **`npm test` corre `scripts/tests/correr-todos.sh && vitest run`**, y `pretest` regenera el cliente de Prisma. Los tests de base usan el Postgres efímero que levanta `test/global-setup.ts`.
- **`docs/schema.md` se regenera con `scripts/generar-erd.sh`** después de cualquier migración. El hook de pre-commit y el paso 3 de `deploy.sh` lo verifican.
- **Espaciado**: sólo los pasos `1, 2, 3, 4, 6, 8, 12` de Tailwind (`docs/sistema-de-diseno.md`, *Espaciado y radio*). Un valor fuera de esa lista en código propio de `app/` es señal de que el layout está mal.
- **`tabular-nums text-right` en toda columna de plata, stock, cantidad o total.** No es estético: sin eso las columnas bailan y comparar dos precios de un vistazo deja de funcionar.
- **No se agregan tokens de color.** El stock negativo usa `text-destructive`, que ya existe y ya tiene el contraste medido. `docs/sistema-de-diseno.md` reserva el ámbar para "stock bajo", que es una feature de umbral que este ciclo **no** construye; un stock negativo no es "bajo", es inconsistente, y el rojo lo dice bien. Agregar un token obligaría a tocar `app/globals.css`, el documento y `scripts/contraste.mts` a la vez, porque `test/sistema-de-diseno.test.ts` los ata en las dos direcciones.
- **El `data-testid="tenant-nombre"` de `app/(app)/layout.tsx` no se toca.** `scripts/smoke.sh` lo busca en cada pantalla autenticada; borrarlo hace fallar todos los casos de pantalla del gate a la vez.
- Los server actions viven en archivos `'use server'`, que **sólo pueden exportar funciones async**. Todo valor inicial de `useActionState` vive en el archivo de formularios. `test/use-server.test.ts` lo fija.

## Una decisión que ajusta el spec

El spec dice que `ajustarStock` se muda "con su firma intacta". Se muda con su **firma de parámetros** intacta, pero pasa a tirar `ErrorDeInventario` en vez de `ErrorDeVenta`: una función que vive en `lib/inventario/` y tira el error de ventas es una costura que confunde a la pantalla, que tendría que atrapar dos clases para una sola operación.

**No rompe nada**, y eso está verificado y no supuesto: los tests existentes assertean con `.rejects.toMatchObject({ codigo: '…' })`, o sea contra el **código** y no contra la clase (`test/ventas.test.ts:748`, `:760`, `:775`, `:793`). Los códigos se conservan uno a uno.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/formato/numeros.ts` *(nuevo)* | Parsear un número escrito por una persona. Puro, sin base de datos. |
| `lib/formato/numeros.test.ts` *(nuevo)* | Sus tests. Corren sin Docker. |
| `prisma/schema.prisma` *(modificado)* | Las tres columnas nuevas. |
| `prisma/migrations/<ts>_inventario/migration.sql` *(nuevo)* | La migración. Sin bloque de RLS: no hay tablas nuevas. |
| `lib/inventario/errores.ts` *(nuevo)* | `ErrorDeInventario` con su `codigo`. |
| `lib/inventario/stock.ts` *(nuevo)* | `ajustarStock` (mudada), `ingresarStock`, `corregirStock`, y el helper que comparten. |
| `lib/inventario/articulos.ts` *(nuevo)* | `crearArticulo`, `editarArticulo`, `desactivarArticulo`, `reactivarArticulo`. |
| `lib/ventas/anular.ts` *(modificado)* | Pierde `ajustarStock` y sus imports muertos. |
| `lib/ventas/errores.ts` *(modificado)* | Pierde `MOTIVO_INVALIDO`, que se va con la función. |
| `test/ventas.test.ts` *(modificado)* | Importa `ajustarStock` del módulo nuevo; su `describe` se muda. |
| `test/inventario.test.ts` *(nuevo)* | Integración del módulo contra el Postgres efímero. |
| `app/(app)/inventario/acciones.ts` *(nuevo)* | Los server actions de las tres pantallas. |
| `app/(app)/inventario/acciones.test.ts` *(nuevo)* | Que cada action reexija su rol con una sesión real. |
| `app/(app)/inventario/formularios.tsx` *(nuevo)* | Los formularios `'use client'`. |
| `app/(app)/inventario/page.tsx` *(nuevo)* | El listado. |
| `app/(app)/inventario/nuevo/page.tsx` *(nuevo)* | El alta. |
| `app/(app)/inventario/[id]/page.tsx` *(nuevo)* | El detalle. |
| `components/navegacion.tsx` *(nuevo)* | Los enlaces, en un solo lugar. Lo usan el layout y la home. |
| `app/(app)/layout.tsx` *(modificado)* | Cuelga la navegación. |
| `app/page.tsx` *(modificado)* | Se le saca el `<a>` suelto a `/usuarios`. |
| `scripts/lib/rutas-comun.sh` *(modificado)* | La primera entrada de `RUTAS_SIN_SMOKE`. |
| `test/schema.test.ts` *(modificado)* | Las tres columnas nuevas, con su tipo. |
| `docs/schema.md` *(regenerado)* | El ERD. |
| `CLAUDE.md` *(modificado)* | Cerrar la decisión abierta del costo del movimiento. |

---

### Task 1: Parsear un número escrito por una persona

**Files:**
- Create: `lib/formato/numeros.ts`
- Test: `lib/formato/numeros.test.ts`

**Interfaces:**
- Consumes: `Prisma.Decimal` de `@/generated/prisma/client`.
- Produces:
  - `class ErrorDeFormato extends Error` con `readonly codigo: 'NUMERO_INVALIDO' | 'NUMERO_AMBIGUO'`
  - `aDecimal(texto: string, campo: string): Prisma.Decimal`
  - `aDecimalOpcional(texto: string, campo: string): Prisma.Decimal | null`

**Por qué existe:** un teclado en el mostrador argentino escribe `1500,50`. Y el borde peligroso no es la coma: es que alguien escriba `850.000` por ochocientos cincuenta mil y una regla ingenua lo lea como `850`. Un celular quedaría cargado a 850 pesos sin que nadie se entere. Este archivo **rechaza lo ambiguo** en vez de adivinar, que es la misma decisión que ya tomó `excedeEscala` en `lib/ventas/totales.ts` y por el mismo motivo.

Vive en `lib/formato/` y no en `lib/inventario/` porque la pantalla de ventas lo va a necesitar igual el ciclo que viene.

- [ ] **Step 1: Escribir el test que falla**

```ts
// lib/formato/numeros.test.ts
import { describe, it, expect } from 'vitest'
import { aDecimal, aDecimalOpcional, ErrorDeFormato } from './numeros'

describe('aDecimal', () => {
  it('acepta un entero', () => {
    expect(aDecimal('1500', 'el precio').toString()).toBe('1500')
  })

  it('acepta la coma decimal, que es como se escribe acá', () => {
    expect(aDecimal('1500,50', 'el precio').toString()).toBe('1500.5')
  })

  it('acepta el punto decimal, que es lo que emite un input numérico', () => {
    expect(aDecimal('1500.50', 'el precio').toString()).toBe('1500.5')
  })

  it('acepta el formato argentino completo, con miles y decimales', () => {
    expect(aDecimal('1.500,50', 'el precio').toString()).toBe('1500.5')
  })

  it('ignora los espacios', () => {
    expect(aDecimal(' 1 500,50 ', 'el precio').toString()).toBe('1500.5')
  })

  // El caso que justifica todo el archivo: un separador seguido de EXACTAMENTE
  // tres dígitos es tan probablemente miles como decimales, y adivinar mal
  // deja un celular cargado a 850 pesos.
  it('rechaza lo ambiguo en vez de adivinar', () => {
    expect(() => aDecimal('850.000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
    expect(() => aDecimal('850,000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
  })

  // Dos o más separadores no son ambiguos: un decimal de verdad nunca lleva
  // dos. Y es el rango de precios de este vertical — un celular de un millón y
  // medio se escribe así.
  it('acepta los miles sin decimales', () => {
    expect(aDecimal('1.500.000', 'el precio').toString()).toBe('1500000')
    expect(aDecimal('12.345.678', 'el precio').toString()).toBe('12345678')
  })

  it('un solo separador sigue siendo ambiguo, que es el punto del módulo', () => {
    expect(() => aDecimal('850.000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
  })

  // Mezclar convenciones es donde se hace daño: no se acepta.
  it('rechaza los miles a la yanqui', () => {
    expect(() => aDecimal('1,500,000', 'el precio')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_INVALIDO' }),
    )
  })

  it('dos decimales no son ambiguos', () => {
    expect(aDecimal('850.00', 'el precio').toString()).toBe('850')
  })

  it('cuatro decimales tampoco: nadie escribe miles con cuatro dígitos', () => {
    // La escala la valida el dominio (excedeEscala), no este archivo.
    expect(aDecimal('1.0005', 'la cantidad').toString()).toBe('1.0005')
  })

  it('rechaza el vacío, el negativo y la basura', () => {
    for (const malo of ['', '   ', '-5', 'abc', '1,5,5', '1..5', '5-']) {
      expect(() => aDecimal(malo, 'el precio'), `aceptó "${malo}"`).toThrowError(
        expect.objectContaining({ codigo: 'NUMERO_INVALIDO' }),
      )
    }
  })

  it('el error nombra el campo, porque es lo que la pantalla va a mostrar', () => {
    expect(() => aDecimal('abc', 'el precio')).toThrowError(/el precio/)
  })

  it('es un ErrorDeFormato, para que el llamador lo distinga de un bug', () => {
    expect(() => aDecimal('abc', 'el precio')).toThrowError(ErrorDeFormato)
  })
})

describe('aDecimalOpcional', () => {
  it('el vacío es null y no un error: el campo es opcional', () => {
    expect(aDecimalOpcional('', 'el costo')).toBeNull()
    expect(aDecimalOpcional('   ', 'el costo')).toBeNull()
  })

  it('lo que no está vacío pasa por las mismas reglas', () => {
    expect(aDecimalOpcional('120,50', 'el costo')?.toString()).toBe('120.5')
    expect(() => aDecimalOpcional('850.000', 'el costo')).toThrowError(
      expect.objectContaining({ codigo: 'NUMERO_AMBIGUO' }),
    )
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/formato/numeros.test.ts`
Expected: FAIL — `Failed to resolve import "./numeros"`.

- [ ] **Step 3: Escribir la implementación**

```ts
// lib/formato/numeros.ts
import { Prisma } from '@/generated/prisma/client'

export type CodigoErrorDeFormato = 'NUMERO_INVALIDO' | 'NUMERO_AMBIGUO'

/**
 * Con código y no sólo con mensaje, igual que `ErrorDeVenta` y
 * `ErrorDeUsuario`: la pantalla tiene que poder distinguir "no es un número"
 * de "no se entiende cuánto es" sin parsear el texto, que es la forma de que
 * eso se rompa en silencio la primera vez que alguien mejore la redacción.
 */
export class ErrorDeFormato extends Error {
  constructor(
    readonly codigo: CodigoErrorDeFormato,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeFormato'
  }
}

const SOLO_DIGITOS = /^\d+$/
// El formato argentino completo: miles con punto y decimales con coma. No es
// ambiguo porque las dos marcas están presentes y cada una dice qué es.
const MILES_Y_DECIMALES = /^\d{1,3}(?:\.\d{3})+,\d+$/
// Miles sin decimales: `1.500.000`. Dos o más separadores NO son ambiguos —un
// decimal de verdad nunca lleva dos—, así que acá no hay nada que adivinar. Un
// solo separador sí lo es, y ese caso lo sigue rechazando `UN_SEPARADOR`.
// `{2,}` y no `+`: con `+`, `850.000` (un solo grupo) matchearía acá y se
// tragaría el chequeo de ambigüedad de más abajo.
const SOLO_MILES = /^\d{1,3}(?:\.\d{3}){2,}$/
const UN_SEPARADOR = /^(\d+)[.,](\d+)$/

/**
 * El texto de un campo, convertido a `Decimal`.
 *
 * No acepta negativos: nada de lo que este parser alimenta —precio, cantidad
 * ingresada, stock contado— puede serlo, y un signo colado es más probablemente
 * un error de tipeo que una intención.
 *
 * **Rechaza lo ambiguo en vez de adivinar.** Un separador seguido de
 * exactamente tres dígitos (`850.000`, `850,000`) es tan probablemente miles
 * como decimales, y las dos lecturas se llevan un factor de mil de diferencia:
 * un celular de ochocientos cincuenta mil pesos quedaría cargado a 850. Es la
 * misma decisión que toma `excedeEscala` en lib/ventas/totales.ts —rechazar en
 * vez de recortar en silencio— y por el mismo motivo: la información sobre qué
 * se quiso escribir la tiene la persona, no el parser.
 */
export function aDecimal(texto: string, campo: string): Prisma.Decimal {
  const limpio = texto.replace(/\s/g, '')

  if (limpio === '') {
    throw new ErrorDeFormato('NUMERO_INVALIDO', `falta ${campo}`)
  }
  if (SOLO_DIGITOS.test(limpio)) {
    return new Prisma.Decimal(limpio)
  }
  if (MILES_Y_DECIMALES.test(limpio)) {
    return new Prisma.Decimal(limpio.replaceAll('.', '').replace(',', '.'))
  }
  if (SOLO_MILES.test(limpio)) {
    return new Prisma.Decimal(limpio.replaceAll('.', ''))
  }

  const partido = UN_SEPARADOR.exec(limpio)
  if (partido) {
    const [, entera, decimales] = partido
    if (decimales.length === 3) {
      throw new ErrorDeFormato(
        'NUMERO_AMBIGUO',
        `no se entiende cuánto es "${texto}" en ${campo}: escribilo como ` +
          `1500,50 o como 1500, sin separador de miles`,
      )
    }
    return new Prisma.Decimal(`${entera}.${decimales}`)
  }

  throw new ErrorDeFormato('NUMERO_INVALIDO', `${campo} no es un número: "${texto}"`)
}

/** Igual, pero el vacío es `null` y no un error: el campo es opcional. */
export function aDecimalOpcional(texto: string, campo: string): Prisma.Decimal | null {
  return texto.replace(/\s/g, '') === '' ? null : aDecimal(texto, campo)
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/formato/numeros.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/formato/numeros.ts lib/formato/numeros.test.ts
git commit -m "feat(formato): parsear números escritos por una persona, rechazando lo ambiguo"
```

---

### Task 2: La migración aditiva

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_inventario/migration.sql` (lo genera Prisma)
- Modify: `test/schema.test.ts`
- Regenerate: `docs/schema.md`

**Interfaces:**
- Produces: `Articulo.desactivadoEn: Date | null`, `MovimientoStock.costoUnitario: Prisma.Decimal | null`, `Tenant.proximoSkuArticulo: number`. Las tres tareas siguientes dependen de estos nombres.

**Sin bloque de RLS a mano**, a diferencia de la migración de ventas: no hay tablas nuevas, y las policies de `articulos`, `movimientos_stock` y `tenants` ya cubren estas columnas. `test/rls-cobertura.test.ts` no cambia.

**Sin índices nuevos.** El listado filtra por `tenantId` y `desactivadoEn` y ordena por `nombre`; `@@unique([tenantId, sku])` ya da el prefijo por tenant, y a la escala de un local —cientos de artículos, no millones— un índice más es peso sin beneficio. Cuando haya un tenant con decenas de miles, es una migración aditiva.

- [ ] **Step 1: Sumar las tres columnas al schema**

En `model Tenant`, debajo de `proximoNumeroVenta`:

```prisma
  // El correlativo del SKU autogenerado, por tenant y con el mismo mecanismo
  // que `proximoNumeroVenta`: un UPDATE … RETURNING dentro de la transacción
  // del alta. Contar artículos daría el mismo A-0007 a dos altas simultáneas,
  // y con `desactivadoEn` en juego llegaría a repetir uno ya usado apenas
  // alguien dé de baja algo.
  proximoSkuArticulo Int          @default(1) @map("proximo_sku_articulo")
```

En `model Articulo`, debajo de `stock`:

```prisma
  // Un artículo que se deja de vender NO se borra: la FK de movimientos_stock
  // y la de venta_items son Restrict a propósito —borrarlo se llevaría la
  // historia de lo que se vendió—, así que se desactiva. Mismo campo y mismo
  // sentido que User.desactivadoEn, que ya sienta el precedente.
  desactivadoEn DateTime?    @map("desactivado_en") @db.Timestamptz(3)
```

En `model MovimientoStock`, debajo de `delta`:

```prisma
  // El costo del momento, no el actual. Es la única puerta de una sola
  // dirección que tenía el modelo: si un artículo se compró a 100 y hoy vale
  // 180, la venta de marzo se midió contra 100, y sin esta columna no hay dato
  // del cual reconstruirlo — todo movimiento creado antes de que exista queda
  // sin costo para siempre.
  //
  // Nullable y sin lector: NADIE la lee todavía. No hay reportes de margen ni
  // costo promedio, y este ciclo no los construye. Sólo el ingreso de
  // mercadería la escribe, y también ahí es opcional. Queda null en las ventas,
  // en las anulaciones y en las correcciones por conteo.
  costoUnitario Decimal?         @map("costo_unitario") @db.Decimal(12, 2)
```

- [ ] **Step 2: Generar la migración**

El stack de dev tiene que estar arriba (`docker compose -f docker/compose.dev.yml up -d`). El `sed` no es opcional: `.env.dev` trae la URL apuntando a `@postgres:5432`, que sólo resuelve desde adentro de la red de Compose — desde el host hay que reescribirla al puerto que dev publica. Es el mismo idiom que documenta `docs/runbook-stacks.md` en *Crear un tenant*.

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL .env.dev | cut -d= -f2- | sed 's/@postgres:5432/@100.64.81.63:5433/')" \
  npx prisma migrate dev --name inventario
```

Expected: crea `prisma/migrations/<timestamp>_inventario/migration.sql` con tres `ALTER TABLE … ADD COLUMN`, lo aplica contra la base de dev y regenera el cliente.

- [ ] **Step 3: Verificar que la migración es aditiva**

Run: `cat prisma/migrations/*_inventario/migration.sql`
Expected: sólo `ALTER TABLE … ADD COLUMN`. **Ningún `DROP`, ningún `RENAME`, ningún `ALTER COLUMN … SET NOT NULL`.** Si aparece alguno, el hook de pre-commit y el paso de migraciones destructivas de `deploy.sh` lo van a frenar, y con razón: el rollback automático revierte la imagen y no la base.

- [ ] **Step 4: Escribir el test de las columnas**

Al final de `test/schema.test.ts`, un `describe` nuevo:

```ts
describe('la migración de inventario', () => {
  it('guarda el costo del movimiento como numeric(12,2) nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT data_type, numeric_precision, numeric_scale, is_nullable
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='movimientos_stock'
          AND column_name='costo_unitario'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].data_type).toBe('numeric')
    expect(rows[0].numeric_precision).toBe(12)
    expect(rows[0].numeric_scale).toBe(2)
    // Nullable a propósito: los movimientos que no son un ingreso no tienen
    // costo, y los que ya existían tampoco.
    expect(rows[0].is_nullable).toBe('YES')
  })

  it('guarda la desactivación del artículo como timestamptz nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='articulos'
          AND column_name='desactivado_en'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].data_type).toBe('timestamp with time zone')
    expect(rows[0].is_nullable).toBe('YES')
  })

  it('arranca el correlativo del SKU en 1 para todo tenant', async () => {
    const { rows } = await cliente.query(
      `SELECT column_default, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tenants'
          AND column_name='proximo_sku_articulo'`,
    )
    expect(rows).toHaveLength(1)
    // Con default y NOT NULL: un tenant que ya existía tiene que quedar en 1,
    // no en null, o la primera alta de ese local explota.
    expect(rows[0].column_default).toBe('1')
    expect(rows[0].is_nullable).toBe('NO')
  })
})
```

- [ ] **Step 5: Correr el test**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS. El Postgres efímero aplica todas las migraciones desde cero en `test/global-setup.ts`, así que esto además prueba que la migración corre sobre una base virgen.

- [ ] **Step 6: Regenerar el ERD**

```bash
scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md
```

Expected: `docs/schema.md` muestra las tres columnas. Sin esto el hook de pre-commit rechaza el commit.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations test/schema.test.ts docs/schema.md
git commit -m "feat(schema): costo del movimiento, baja de artículo y correlativo de SKU"
```

---

### Task 3: El motor de stock del inventario

**Files:**
- Create: `lib/inventario/errores.ts`
- Create: `lib/inventario/stock.ts`
- Modify: `lib/ventas/anular.ts` (pierde `ajustarStock`)
- Modify: `lib/ventas/errores.ts` (pierde `MOTIVO_INVALIDO`)
- Modify: `test/ventas.test.ts` (import y mudanza del `describe`)
- Create: `test/inventario.test.ts`

**Interfaces:**
- Consumes: `enTransaccionDeTenant` y `ClienteTx` de `@/lib/tenant/transaccion`; `excedeEscala`, `ESCALA_CANTIDAD`, `ESCALA_DINERO` de `@/lib/ventas/totales`; `exigirUsuario` de `@/lib/ventas/pertenencia`; `traducirErrorDeBase` de `@/lib/ventas/errores`.
- Produces:
  - `class ErrorDeInventario extends Error` con `readonly codigo: CodigoErrorDeInventario`
  - `type CodigoErrorDeInventario = 'ARTICULO_INEXISTENTE' | 'USUARIO_INEXISTENTE' | 'TENANT_INEXISTENTE' | 'CANTIDAD_INVALIDA' | 'ESCALA_EXCEDIDA' | 'MOTIVO_INVALIDO' | 'SERVICIO_SIN_STOCK' | 'COSTO_INVALIDO' | 'NOMBRE_VACIO' | 'PRECIO_INVALIDO' | 'SKU_REPETIDO' | 'SKU_VACIO'`
  - `ajustarStock(e: { tenantId, articuloId, delta: Decimal, motivo: 'AJUSTE'|'INGRESO', usuarioId, nota? }): Promise<void>`
  - `ingresarStock(e: { tenantId, articuloId, cantidad: Decimal, usuarioId, costoUnitario?: Decimal | null, nota?: string }): Promise<void>`
  - `corregirStock(e: { tenantId, articuloId, stockContado: Decimal, usuarioId, nota?: string }): Promise<void>`
  - `aplicarMovimiento(tx, …)` — **interno, no exportado**. La Task 4 lo usa a través de `crearArticulo`, no directo.

**Dos cosas cambian de comportamiento, y las dos a propósito:**

1. **Ningún camino puede ya mover stock de un `SERVICIO`.** El chequeo va en el helper compartido, así que cubre las tres funciones. Antes `ajustarStock` lo dejaba pasar; nada lo llamaba en producción y ningún test lo ejercita sobre `servicio` (los casos usan `remera` y `recon`, ambos `PRODUCTO`).
2. **`corregirStock` no escribe nada si el delta da cero.** Un conteo que confirma lo que ya había no es un evento del inventario, y ensuciaría el historial que este ciclo construye justamente para poder leerlo.

**Por qué el delta se calcula adentro de la transacción y aun así el `UPDATE` es relativo:** son dos cosas separadas y las dos importan. Leer el stock adentro evita calcular contra un número que la pantalla dibujó hace un minuto. Y el `increment` relativo mantiene correcta la aritmética si una venta comitea entre la lectura y la escritura: si el sistema decía 10, la persona contó 8 y mientras tanto se vendió 1, el resultado es `9 + (-2) = 7`, que es exactamente lo que hay físicamente. Un `SET stock = $contado` absoluto habría escrito 8 y perdido la venta.

- [ ] **Step 1: Escribir el error**

```ts
// lib/inventario/errores.ts
export type CodigoErrorDeInventario =
  | 'ARTICULO_INEXISTENTE'
  // Lo tira `exigirUsuario` (lib/ventas/pertenencia.ts) y lo hace con
  // `ErrorDeVenta`, no con la clase de acá: la función se comparte con el motor
  // de ventas y duplicarla para cambiarle la clase al error sería tener dos
  // chequeos de pertenencia que se pueden desincronizar. El CÓDIGO está en este
  // union porque es un código que este módulo efectivamente hace salir, y los
  // tests assertean por código. Que llegue a la pantalla como 500 y no como
  // cartel rojo es correcto: con una sesión válida no puede pasar —RLS garantiza
  // que el usuario de la sesión es de este tenant—, así que si pasa es un bug y
  // tiene que llegar a Sentry, no quedar tapado por un mensaje amable.
  | 'USUARIO_INEXISTENTE'
  | 'TENANT_INEXISTENTE'
  | 'CANTIDAD_INVALIDA'
  | 'ESCALA_EXCEDIDA'
  | 'MOTIVO_INVALIDO'
  // Un servicio no tiene stock: el motor de ventas ni siquiera le genera
  // movimientos (ver el filtro por `esProducto` en lib/ventas/crear.ts).
  // Dejarle mover stock crearía un número que después nadie descuenta.
  | 'SERVICIO_SIN_STOCK'
  | 'COSTO_INVALIDO'
  | 'NOMBRE_VACIO'
  | 'PRECIO_INVALIDO'
  | 'SKU_REPETIDO'
  | 'SKU_VACIO'

/**
 * Con código y no sólo con mensaje: la pantalla tiene que poder distinguir
 * "ese SKU ya está usado" de "el precio no es válido" sin parsear strings.
 * Mismo patrón que lib/ventas/errores.ts y lib/usuarios/errores.ts.
 */
export class ErrorDeInventario extends Error {
  constructor(
    readonly codigo: CodigoErrorDeInventario,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeInventario'
  }
}
```

- [ ] **Step 2: Escribir el test que falla**

```ts
// test/inventario.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
// Mismo patrón que test/ventas.test.ts.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant
let ajustarStock: typeof import('@/lib/inventario/stock').ajustarStock
let ingresarStock: typeof import('@/lib/inventario/stock').ingresarStock
let corregirStock: typeof import('@/lib/inventario/stock').corregirStock

const d = (v: string) => new Prisma.Decimal(v)

let owner: Client
let tenantId: string
let usuarioId: string
let remera: string
let servicio: string
let otroTenantId: string
let usuarioAjeno: string

async function stockDe(articuloId: string): Promise<string> {
  const { rows } = await owner.query(`SELECT stock FROM articulos WHERE id = $1`, [articuloId])
  return new Prisma.Decimal(rows[0].stock).toString()
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  ;({ ajustarStock, ingresarStock, corregirStock } = await import('@/lib/inventario/stock'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `inventario-${Date.now()}`)

  const u = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Vendedor', 'v@inv.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId],
  )
  usuarioId = u.rows[0].id

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'REM-1', 'Remera', 'PRODUCTO', 1000.00, 0, now(), now()),
            (gen_random_uuid(), $1, 'SRV-1', 'Arreglo', 'SERVICIO', 500.00, 0, now(), now())
     RETURNING id, sku`,
    [tenantId],
  )
  const porSku = (sku: string) => a.rows.find((r: { sku: string }) => r.sku === sku).id
  remera = porSku('REM-1')
  servicio = porSku('SRV-1')

  // El otro negocio. Sus filas existen y las FKs de Postgres las aceptarían
  // —sus triggers corren como dueño de la tabla, exento de RLS—, así que el
  // chequeo de pertenencia tiene que ser del motor.
  otroTenantId = await crearTenant(owner, `inventario-otro-${Date.now()}`)
  const ua = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Ajeno', 'a@inv.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [otroTenantId],
  )
  usuarioAjeno = ua.rows[0].id
})

afterAll(async () => {
  await owner.end()
})

describe('ajustarStock', () => {
  it('un ingreso suma y queda registrado con su nota', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))

    await ajustarStock({
      tenantId,
      articuloId: remera,
      delta: d('25'),
      motivo: 'INGRESO',
      usuarioId,
      nota: 'compra al proveedor',
    })

    expect(await stockDe(remera)).toBe(antes.plus(25).toString())
  })

  it('un ajuste negativo devuelve a cero un stock negativo', async () => {
    await owner.query(`UPDATE articulos SET stock = -5 WHERE id = $1`, [remera])
    await ajustarStock({
      tenantId, articuloId: remera, delta: d('5'), motivo: 'AJUSTE', usuarioId,
    })
    expect(await stockDe(remera)).toBe('0')
  })

  it('rechaza un artículo que no existe', async () => {
    await expect(
      ajustarStock({
        tenantId,
        articuloId: '00000000-0000-7000-8000-000000000000',
        delta: d('1'),
        motivo: 'AJUSTE',
        usuarioId,
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })

  it('rechaza un usuarioId de otro tenant', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: remera, delta: d('1'), motivo: 'AJUSTE', usuarioId: usuarioAjeno }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })
  })

  // El tipo de `motivo` sólo protege a los llamadores tipados. Un body JSON ya
  // parseado pasa 'VENTA' sin que TypeScript se entere, y eso crearía un
  // movimiento VENTA con `ventaId` null — rompiendo la invariante sobre la que
  // está construido el filtro de `anularVenta`. El `as never` emula al
  // llamador sin tipos, que es el único que puede hacerlo.
  it('rechaza un motivo que no le corresponde, como VENTA', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: remera, delta: d('1'), motivo: 'VENTA' as never, usuarioId }),
    ).rejects.toMatchObject({ codigo: 'MOTIVO_INVALIDO' })

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { articuloId: remera, motivo: 'VENTA', ventaId: null } }),
    )
    expect(movs, 'quedó un movimiento VENTA sin venta asociada').toHaveLength(0)
  })

  it('rechaza un delta con más decimales de los que la columna guarda', async () => {
    await expect(
      ajustarStock({ tenantId, articuloId: remera, delta: d('1.0005'), motivo: 'INGRESO', usuarioId }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })
})

describe('ingresarStock', () => {
  it('suma, deja el movimiento con motivo INGRESO y guarda el costo', async () => {
    const antes = new Prisma.Decimal(await stockDe(remera))

    await ingresarStock({
      tenantId,
      articuloId: remera,
      cantidad: d('10'),
      usuarioId,
      costoUnitario: d('620.50'),
      nota: 'factura 0001-00012345',
    })

    expect(await stockDe(remera)).toBe(antes.plus(10).toString())

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'INGRESO' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.delta.toString()).toBe('10')
    expect(mov?.costoUnitario?.toString()).toBe('620.5')
    expect(mov?.nota).toBe('factura 0001-00012345')
    expect(mov?.ventaId).toBeNull()
  })

  it('el costo es opcional: sin él, el movimiento queda con costo null', async () => {
    await ingresarStock({ tenantId, articuloId: remera, cantidad: d('1'), usuarioId })

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'INGRESO' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.costoUnitario).toBeNull()
  })

  it('rechaza una cantidad que no suma nada', async () => {
    for (const mala of ['0', '-3']) {
      await expect(
        ingresarStock({ tenantId, articuloId: remera, cantidad: d(mala), usuarioId }),
        `aceptó ${mala}`,
      ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
    }
  })

  it('rechaza un costo negativo y uno con más decimales de los que se guardan', async () => {
    await expect(
      ingresarStock({ tenantId, articuloId: remera, cantidad: d('1'), usuarioId, costoUnitario: d('-1') }),
    ).rejects.toMatchObject({ codigo: 'COSTO_INVALIDO' })
    await expect(
      ingresarStock({ tenantId, articuloId: remera, cantidad: d('1'), usuarioId, costoUnitario: d('1.005') }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  // Un servicio no tiene stock y el motor de ventas ni siquiera le genera
  // movimientos: darle stock crearía un número que después nadie descuenta.
  it('rechaza mover el stock de un servicio', async () => {
    await expect(
      ingresarStock({ tenantId, articuloId: servicio, cantidad: d('1'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })
})

describe('corregirStock', () => {
  it('lleva el stock a lo que la persona contó, con el delta que falta', async () => {
    await owner.query(`UPDATE articulos SET stock = 12 WHERE id = $1`, [remera])

    await corregirStock({
      tenantId, articuloId: remera, stockContado: d('9'), usuarioId, nota: 'conteo del lunes',
    })

    expect(await stockDe(remera)).toBe('9')

    const mov = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findFirst({
        where: { articuloId: remera, motivo: 'AJUSTE' },
        orderBy: { creadoEn: 'desc' },
      }),
    )
    expect(mov?.delta.toString()).toBe('-3')
    expect(mov?.nota).toBe('conteo del lunes')
    // El costo es del ingreso, no de la corrección: acá no hay factura.
    expect(mov?.costoUnitario).toBeNull()
  })

  it('un conteo que confirma lo que había no escribe ningún movimiento', async () => {
    await owner.query(`UPDATE articulos SET stock = 7 WHERE id = $1`, [remera])
    const { rows: antes } = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [remera],
    )

    await corregirStock({ tenantId, articuloId: remera, stockContado: d('7'), usuarioId })

    const { rows: despues } = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [remera],
    )
    expect(despues[0].n, 'escribió un movimiento de delta cero').toBe(antes[0].n)
    expect(await stockDe(remera)).toBe('7')
  })

  it('un conteo puede subir el stock, no sólo bajarlo', async () => {
    await owner.query(`UPDATE articulos SET stock = 2 WHERE id = $1`, [remera])
    await corregirStock({ tenantId, articuloId: remera, stockContado: d('5'), usuarioId })
    expect(await stockDe(remera)).toBe('5')
  })

  it('rechaza un conteo negativo: no se pueden contar menos de cero unidades', async () => {
    await expect(
      corregirStock({ tenantId, articuloId: remera, stockContado: d('-1'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'CANTIDAD_INVALIDA' })
  })

  it('rechaza corregir el stock de un servicio', async () => {
    await expect(
      corregirStock({ tenantId, articuloId: servicio, stockContado: d('3'), usuarioId }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })
})

// La invariante de todo el motor, ejercitada por las TRES vías de movimiento.
// Si sólo probara una, no distinguiría un bug que afecte a las otras.
describe('la invariante del stock', () => {
  it('el stock del artículo es la suma de sus movimientos', async () => {
    const propio = await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'INV-1', 'Reconciliable', 'PRODUCTO', 100.00, 0, now(), now())
       RETURNING id`,
      [tenantId],
    )
    const articuloId = propio.rows[0].id

    await ingresarStock({ tenantId, articuloId, cantidad: d('40'), usuarioId, costoUnitario: d('50') })
    await corregirStock({ tenantId, articuloId, stockContado: d('37.5'), usuarioId })
    await ajustarStock({ tenantId, articuloId, delta: d('2.25'), motivo: 'INGRESO', usuarioId })

    const { rows } = await owner.query(
      `SELECT coalesce(sum(delta), 0) AS suma FROM movimientos_stock WHERE articulo_id = $1`,
      [articuloId],
    )
    expect(await stockDe(articuloId)).toBe(new Prisma.Decimal(rows[0].suma).toString())
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run test/inventario.test.ts`
Expected: FAIL — no existe `@/lib/inventario/stock`.

- [ ] **Step 4: Escribir el módulo de stock**

```ts
// lib/inventario/stock.ts
import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { excedeEscala, ESCALA_CANTIDAD, ESCALA_DINERO } from '@/lib/ventas/totales'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { traducirErrorDeBase } from '@/lib/ventas/errores'
import { ErrorDeInventario } from './errores'

type Decimal = Prisma.Decimal

/**
 * El artículo, validado para mover stock.
 *
 * Devuelve la fila porque `corregirStock` necesita el stock del momento y
 * leerlo dos veces sería pedirle a Postgres lo mismo con el lock ya tomado.
 *
 * Exportado a nivel de módulo y no público: la Task 4 (`articulos.ts`) escribe
 * su propio camino de alta, que crea el artículo y no lo busca.
 */
async function exigirArticuloConStock(tx: ClienteTx, articuloId: string) {
  const articulo = await tx.articulo.findUnique({ where: { id: articuloId } })
  if (!articulo) {
    throw new ErrorDeInventario(
      'ARTICULO_INEXISTENTE',
      `el artículo ${articuloId} no existe en este tenant`,
    )
  }
  // Un servicio no tiene stock: `lib/ventas/crear.ts` filtra por `esProducto`
  // y no le genera movimientos al venderlo. Darle stock por otra vía crearía
  // un número que después nadie descuenta nunca.
  if (articulo.tipo === 'SERVICIO') {
    throw new ErrorDeInventario(
      'SERVICIO_SIN_STOCK',
      `${articulo.nombre} es un servicio y no lleva stock`,
    )
  }
  return articulo
}

/**
 * Las dos escrituras que todo movimiento hace, juntas y en el mismo orden.
 *
 * Recibe el cliente transaccional en vez de abrir la transacción: es lo que
 * permite que `corregirStock` lea el stock y escriba el movimiento adentro de
 * la misma, que es de donde sale que el delta se calcule contra el número real
 * y no contra el que la pantalla dibujó hace un minuto.
 *
 * El UPDATE es RELATIVO (`increment`) y no absoluto, incluso cuando el llamador
 * conoce el valor final: `SET stock = stock + $1` deja que dos movimientos
 * simultáneos del mismo artículo no se pisen. Un `SET stock = $contado`
 * perdería la venta que haya comiteado en el medio.
 */
async function aplicarMovimiento(
  tx: ClienteTx,
  datos: {
    tenantId: string
    articuloId: string
    delta: Decimal
    motivo: 'AJUSTE' | 'INGRESO'
    usuarioId: string
    nota?: string
    costoUnitario?: Decimal | null
  },
): Promise<void> {
  await tx.movimientoStock.create({
    data: {
      tenantId: datos.tenantId,
      articuloId: datos.articuloId,
      delta: datos.delta,
      motivo: datos.motivo,
      usuarioId: datos.usuarioId,
      nota: datos.nota,
      costoUnitario: datos.costoUnitario ?? null,
    },
  })
  await tx.articulo.update({
    where: { id: datos.articuloId },
    data: { stock: { increment: datos.delta } },
  })
}

/** El costo tiene que ser un número que la columna pueda guardar, o nada. */
function validarCosto(costoUnitario: Decimal | null | undefined): void {
  if (costoUnitario === null || costoUnitario === undefined) return
  if (costoUnitario.lessThan(0)) {
    throw new ErrorDeInventario('COSTO_INVALIDO', 'el costo no puede ser negativo')
  }
  if (excedeEscala(costoUnitario, ESCALA_DINERO)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el costo tiene a lo sumo ${ESCALA_DINERO} decimales`,
    )
  }
}

/**
 * El movimiento crudo, con su delta y su motivo. Mudada desde
 * `lib/ventas/anular.ts`, donde había quedado por ser la misma task que la
 * escribió — no tiene nada que ver con anular una venta.
 *
 * Sigue pública porque es la vía de escape para un movimiento que las dos
 * funciones de arriba no modelan.
 */
export async function ajustarStock(entrada: {
  tenantId: string
  articuloId: string
  delta: Decimal
  motivo: 'AJUSTE' | 'INGRESO'
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, delta, motivo, usuarioId, nota } = entrada

  // El tipo de `motivo` sólo protege a los llamadores tipados. Uno que venga de
  // un body JSON ya parseado pasa 'VENTA' sin que TypeScript se entere, y crea
  // un movimiento con motivo VENTA y `ventaId` null: eso rompe la invariante
  // sobre la que está construido el filtro de `anularVenta`
  // (`{ ventaId, motivo: 'VENTA' }`), que da por hecho que todo movimiento
  // VENTA pertenece a una venta.
  if (motivo !== 'AJUSTE' && motivo !== 'INGRESO') {
    throw new ErrorDeInventario(
      'MOTIVO_INVALIDO',
      `ajustarStock sólo acepta AJUSTE o INGRESO, no ${motivo}`,
    )
  }
  if (excedeEscala(delta, ESCALA_CANTIDAD)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el delta tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
    )
  }

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      await exigirArticuloConStock(tx, articuloId)
      await aplicarMovimiento(tx, { tenantId, articuloId, delta, motivo, usuarioId, nota })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

/** Recibir mercadería. Es el único camino que escribe `costoUnitario`. */
export async function ingresarStock(entrada: {
  tenantId: string
  articuloId: string
  cantidad: Decimal
  usuarioId: string
  costoUnitario?: Decimal | null
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, cantidad, usuarioId, costoUnitario, nota } = entrada

  if (cantidad.lessThanOrEqualTo(0)) {
    throw new ErrorDeInventario(
      'CANTIDAD_INVALIDA',
      'la cantidad que ingresa tiene que ser mayor que cero',
    )
  }
  if (excedeEscala(cantidad, ESCALA_CANTIDAD)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `la cantidad tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
    )
  }
  validarCosto(costoUnitario)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      await exigirArticuloConStock(tx, articuloId)
      await aplicarMovimiento(tx, {
        tenantId, articuloId, delta: cantidad, motivo: 'INGRESO', usuarioId, nota, costoUnitario,
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

/**
 * El recuento: la persona dice cuánto hay, no cuánto falta.
 *
 * El delta se calcula ADENTRO de la transacción. Pedirle el delta al llamador
 * obligaría a leer el stock en la pantalla y restarlo en el navegador, y entre
 * que la pantalla se dibuja y alguien aprieta el botón puede haber pasado una
 * venta: la corrección se calcularía contra un número viejo y dejaría el
 * inventario peor de como estaba.
 */
export async function corregirStock(entrada: {
  tenantId: string
  articuloId: string
  stockContado: Decimal
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, articuloId, stockContado, usuarioId, nota } = entrada

  if (stockContado.lessThan(0)) {
    throw new ErrorDeInventario(
      'CANTIDAD_INVALIDA',
      'no se pueden contar menos de cero unidades',
    )
  }
  if (excedeEscala(stockContado, ESCALA_CANTIDAD)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el conteo tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
    )
  }

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      const articulo = await exigirArticuloConStock(tx, articuloId)

      const delta = stockContado.minus(articulo.stock)
      // Un conteo que confirma lo que ya había no es un evento del inventario.
      // Escribir un movimiento de delta cero ensuciaría el historial que este
      // ciclo construye justamente para poder leerlo.
      if (delta.isZero()) return

      await aplicarMovimiento(tx, {
        tenantId, articuloId, delta, motivo: 'AJUSTE', usuarioId, nota,
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
```

- [ ] **Step 5: Sacar `ajustarStock` de `lib/ventas/anular.ts`**

Borrar la función entera (desde el comentario `/** El ingreso de mercadería…` hasta el cierre del archivo) y limpiar los imports que quedan sin uso. Al terminar, la primera línea del archivo tiene que ser:

```ts
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { exigirUsuario } from './pertenencia'
import { ErrorDeVenta, traducirErrorDeBase } from './errores'
```

(`Prisma`, `excedeEscala` y `ESCALA_CANTIDAD` se van con la función.)

- [ ] **Step 6: Sacar `MOTIVO_INVALIDO` de `lib/ventas/errores.ts`**

Borrar esa línea del union `CodigoErrorDeVenta`. Se va con la única función que lo tiraba. Es un tipo de TypeScript y no una columna, así que expand/contract no aplica: el compilador señala cualquier uso que quedara.

- [ ] **Step 7: Repuntar `test/ventas.test.ts` y mudarle el `describe`**

Tres cambios:

1. Línea 17 — el tipo del import:
```ts
let ajustarStock: typeof import('@/lib/inventario/stock').ajustarStock
```
2. Línea 45 — el import dinámico se parte en dos:
```ts
  ;({ anularVenta } = await import('@/lib/ventas/anular'))
  ;({ ajustarStock } = await import('@/lib/inventario/stock'))
```
3. Borrar el `describe('ajustarStock', …)` entero (desde la línea 698 hasta el final del archivo). Sus seis casos ya están en `test/inventario.test.ts`, escritos en el Step 2.

El test de reconciliación de `test/ventas.test.ts` **se queda ahí** y sigue llamando a `ajustarStock`: prueba que el stock cierra atravesando venta e ingreso, que es la costura entre los dos módulos.

- [ ] **Step 8: Correr los dos archivos**

Run: `npx vitest run test/inventario.test.ts test/ventas.test.ts`
Expected: PASS. `test/inventario.test.ts` con 18 tests; `test/ventas.test.ts` con seis menos que antes y ninguno rojo.

- [ ] **Step 9: Commit**

```bash
git add lib/inventario/ lib/ventas/anular.ts lib/ventas/errores.ts test/inventario.test.ts test/ventas.test.ts
git commit -m "feat(inventario): ingreso de mercadería y corrección por conteo"
```

#### Ajustes hechos durante la ejecución (2026-08-11)

Los bloques de código de arriba son los del plan original. La review de esta
task encontró cuatro cosas y el humano falló que se cerraran, así que el código
commiteado difiere en estos puntos — la fuente de verdad es el código:

1. **`lib/inventario/errores.ts` tiene su propio `traducirErrorDeBase`**, que
   mapea el `P2020` de Prisma a `ErrorDeInventario('FUERA_DE_RANGO')`, y
   `'FUERA_DE_RANGO'` entra en `CodigoErrorDeInventario`. `stock.ts` importa ése
   y no el de `lib/ventas/errores.ts`. El motivo: una cantidad que desborda la
   columna salía como `ErrorDeVenta`, y los server actions de la Task 5 filtran
   con `e instanceof ErrorDeInventario` — o sea que un tipeo largo en el
   formulario de ingreso habría tirado la pantalla abajo con un 500 en vez de
   mostrar un cartel corregible. Sumar el código al union no alcanzaba: la
   clase es lo que la pantalla mira.
2. **`'un ingreso suma y queda registrado con su nota'` volvió a assertear
   `nota` y `ventaId`.** Al mudar el `describe` desde `test/ventas.test.ts`, el
   plan había perdido las dos aserciones y el nombre del test prometía un
   comportamiento que el test no verificaba.
3. **Se sumó el caso de `ajustarStock` contra un `SERVICIO`.** Es la única de
   las tres funciones cuyo comportamiento este ciclo cambia a propósito, y era
   la única sin ese caso.
4. **El JSDoc de `exigirArticuloConStock` decía dos cosas falsas** —que estaba
   exportada, y que releer sería consultar "con el lock ya tomado", cuando
   `findUnique` no toma ningún lock de fila—. En un código cuya regla es que el
   comentario lleva el porqué, un porqué falso es peor que ninguno.

`test/inventario.test.ts` termina con **19** tests, no 18: el plan contaba mal
—su propio código daba 17— y este round sumó dos.

---

### Task 4: El alta y la edición de artículos

**Files:**
- Create: `lib/inventario/articulos.ts`
- Modify: `test/inventario.test.ts`

**Interfaces:**
- Consumes: `ErrorDeInventario` de `./errores`; `enTransaccionDeTenant` y `ClienteTx` de `@/lib/tenant/transaccion`; `excedeEscala`, `ESCALA_DINERO`, `ESCALA_CANTIDAD` de `@/lib/ventas/totales`; `exigirUsuario` de `@/lib/ventas/pertenencia`.
- Produces:
  - `crearArticulo(e: EntradaCrearArticulo): Promise<{ id: string; sku: string }>`
  - `editarArticulo(e: { tenantId, articuloId, nombre, sku, precio: Decimal }): Promise<void>`
  - `desactivarArticulo(e: { tenantId, articuloId }): Promise<void>`
  - `reactivarArticulo(e: { tenantId, articuloId }): Promise<void>`
  - `type EntradaCrearArticulo = { tenantId: string; usuarioId: string; nombre: string; tipo: 'PRODUCTO' | 'SERVICIO'; precio: Decimal; sku?: string; stockInicial?: Decimal | null; costoUnitario?: Decimal | null }`

**El reintento del SKU va AFUERA de la transacción, y eso no es un detalle de estilo.** Una violación de unicidad en Postgres **aborta la transacción**: después del error, ninguna sentencia más funciona sobre esa conexión hasta el rollback. Reintentar adentro del callback fallaría con `current transaction is aborted`. Por eso el bucle envuelve a `enTransaccionDeTenant` entero.

**El stock inicial no se escribe en la columna**: crea un movimiento `INGRESO` en la misma transacción. Es la invariante del motor —el stock es la suma de sus movimientos— y un artículo que nace con 5 sin movimiento que lo explique es exactamente la pregunta que la tabla append-only existe para poder responder.

- [ ] **Step 1: Escribir los tests que fallan**

Primero, en `test/inventario.test.ts`, sumar las cuatro funciones a los `let` de arriba:

```ts
let crearArticulo: typeof import('@/lib/inventario/articulos').crearArticulo
let editarArticulo: typeof import('@/lib/inventario/articulos').editarArticulo
let desactivarArticulo: typeof import('@/lib/inventario/articulos').desactivarArticulo
let reactivarArticulo: typeof import('@/lib/inventario/articulos').reactivarArticulo
```

y al import dinámico del `beforeAll`, debajo del de `stock`:

```ts
  ;({ crearArticulo, editarArticulo, desactivarArticulo, reactivarArticulo } = await import(
    '@/lib/inventario/articulos'
  ))
```

Después, los casos, al final del archivo:

```ts
describe('crearArticulo', () => {
  it('autogenera el SKU correlativo cuando no se escribe uno', async () => {
    const uno = await crearArticulo({
      tenantId, usuarioId, nombre: 'Vidrio templado', tipo: 'PRODUCTO', precio: d('3500'),
    })
    const dos = await crearArticulo({
      tenantId, usuarioId, nombre: 'Funda silicona', tipo: 'PRODUCTO', precio: d('2800'),
    })

    expect(uno.sku).toMatch(/^A-\d{4}$/)
    // Correlativo de verdad: el segundo es el siguiente, no otro al azar.
    const n = (sku: string) => Number(sku.slice(2))
    expect(n(dos.sku)).toBe(n(uno.sku) + 1)
  })

  it('respeta el SKU que se escribe a mano', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cargador 20W', tipo: 'PRODUCTO', precio: d('9000'),
      sku: '7798123456789',
    })
    expect(a.sku).toBe('7798123456789')
  })

  it('rechaza un SKU ya usado en vez de inventar otro', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Auricular', tipo: 'PRODUCTO', precio: d('12000'), sku: 'AUR-1',
    })
    await expect(
      crearArticulo({
        tenantId, usuarioId, nombre: 'Otro auricular', tipo: 'PRODUCTO', precio: d('13000'), sku: 'AUR-1',
      }),
    ).rejects.toMatchObject({ codigo: 'SKU_REPETIDO' })
  })

  // El borde real: alguien tipeó a mano un código con la forma del
  // autogenerado. La unicidad de la base lo atrapa y el alta sigue de largo
  // con el siguiente número, en vez de fallarle a quien no hizo nada malo.
  it('salta el correlativo si alguien ya tipeó ese código a mano', async () => {
    const proximo = await owner.query(
      `SELECT proximo_sku_articulo AS n FROM tenants WHERE id = $1`, [tenantId],
    )
    const ocupado = `A-${String(proximo.rows[0].n).padStart(4, '0')}`
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Ocupa el correlativo', tipo: 'PRODUCTO', precio: d('100'),
      sku: ocupado,
    })

    const siguiente = await crearArticulo({
      tenantId, usuarioId, nombre: 'El que sigue', tipo: 'PRODUCTO', precio: d('100'),
    })
    expect(siguiente.sku).not.toBe(ocupado)
    expect(siguiente.sku).toMatch(/^A-\d{4}$/)
  })

  it('el stock inicial nace como movimiento, no como número suelto', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Pantalla A52', tipo: 'PRODUCTO', precio: d('85000'),
      stockInicial: d('4'), costoUnitario: d('52000'),
    })

    expect(await stockDe(a.id)).toBe('4')

    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { articuloId: a.id } }),
    )
    expect(movs).toHaveLength(1)
    expect(movs[0].motivo).toBe('INGRESO')
    expect(movs[0].delta.toString()).toBe('4')
    expect(movs[0].costoUnitario?.toString()).toBe('52000')
  })

  it('sin stock inicial no escribe ningún movimiento', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Sin stock todavía', tipo: 'PRODUCTO', precio: d('1000'),
    })
    const movs = await enTransaccionDeTenant(tenantId, async (tx) =>
      tx.movimientoStock.findMany({ where: { articuloId: a.id } }),
    )
    expect(movs).toHaveLength(0)
    expect(await stockDe(a.id)).toBe('0')
  })

  it('rechaza stock inicial en un servicio', async () => {
    await expect(
      crearArticulo({
        tenantId, usuarioId, nombre: 'Reparación', tipo: 'SERVICIO', precio: d('15000'),
        stockInicial: d('3'),
      }),
    ).rejects.toMatchObject({ codigo: 'SERVICIO_SIN_STOCK' })
  })

  it('crea un servicio sin stock, que es lo normal', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Cambio de módulo', tipo: 'SERVICIO', precio: d('18000'),
    })
    expect(await stockDe(a.id)).toBe('0')
  })

  it('rechaza un nombre vacío y un precio inválido', async () => {
    await expect(
      crearArticulo({ tenantId, usuarioId, nombre: '   ', tipo: 'PRODUCTO', precio: d('100') }),
    ).rejects.toMatchObject({ codigo: 'NOMBRE_VACIO' })
    await expect(
      crearArticulo({ tenantId, usuarioId, nombre: 'X', tipo: 'PRODUCTO', precio: d('-1') }),
    ).rejects.toMatchObject({ codigo: 'PRECIO_INVALIDO' })
    await expect(
      crearArticulo({ tenantId, usuarioId, nombre: 'X', tipo: 'PRODUCTO', precio: d('1.005') }),
    ).rejects.toMatchObject({ codigo: 'ESCALA_EXCEDIDA' })
  })

  it('no deja crear con el usuario de otro tenant', async () => {
    await expect(
      crearArticulo({
        tenantId, usuarioId: usuarioAjeno, nombre: 'Ajeno', tipo: 'PRODUCTO', precio: d('100'),
      }),
    ).rejects.toMatchObject({ codigo: 'USUARIO_INEXISTENTE' })
  })

  it('el mismo SKU puede existir en dos negocios distintos', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Compartido', tipo: 'PRODUCTO', precio: d('100'), sku: 'DUP-1',
    })
    const ajeno = await owner.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Dueño otro', 'd@otro.test', 'DUENO', now(), now())
       RETURNING id`,
      [otroTenantId],
    )
    await expect(
      crearArticulo({
        tenantId: otroTenantId, usuarioId: ajeno.rows[0].id, nombre: 'Compartido',
        tipo: 'PRODUCTO', precio: d('100'), sku: 'DUP-1',
      }),
    ).resolves.toMatchObject({ sku: 'DUP-1' })
  })
})

describe('editarArticulo, desactivarArticulo y reactivarArticulo', () => {
  it('cambia nombre, SKU y precio', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Nombre viejo', tipo: 'PRODUCTO', precio: d('100'),
    })
    await editarArticulo({
      tenantId, articuloId: a.id, nombre: 'Nombre nuevo', sku: 'NUE-1', precio: d('250.75'),
    })

    const { rows } = await owner.query(
      `SELECT nombre, sku, precio, tipo FROM articulos WHERE id = $1`, [a.id],
    )
    expect(rows[0].nombre).toBe('Nombre nuevo')
    expect(rows[0].sku).toBe('NUE-1')
    expect(new Prisma.Decimal(rows[0].precio).toString()).toBe('250.75')
    // El tipo NO se edita: cambiarlo dejaría stock huérfano que el motor de
    // ventas ya no descuenta ni explica. No hay parámetro para hacerlo.
    expect(rows[0].tipo).toBe('PRODUCTO')
  })

  it('rechaza mover el SKU a uno ya usado', async () => {
    await crearArticulo({
      tenantId, usuarioId, nombre: 'Ocupa', tipo: 'PRODUCTO', precio: d('100'), sku: 'OCU-1',
    })
    const otro = await crearArticulo({
      tenantId, usuarioId, nombre: 'Quiere ocupar', tipo: 'PRODUCTO', precio: d('100'),
    })
    await expect(
      editarArticulo({ tenantId, articuloId: otro.id, nombre: 'Quiere ocupar', sku: 'OCU-1', precio: d('100') }),
    ).rejects.toMatchObject({ codigo: 'SKU_REPETIDO' })
  })

  it('rechaza un SKU vacío: la columna es obligatoria', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Con sku', tipo: 'PRODUCTO', precio: d('100'),
    })
    await expect(
      editarArticulo({ tenantId, articuloId: a.id, nombre: 'Con sku', sku: '  ', precio: d('100') }),
    ).rejects.toMatchObject({ codigo: 'SKU_VACIO' })
  })

  it('desactiva y reactiva sin tocar el historial', async () => {
    const a = await crearArticulo({
      tenantId, usuarioId, nombre: 'Discontinuado', tipo: 'PRODUCTO', precio: d('100'),
      stockInicial: d('2'),
    })

    await desactivarArticulo({ tenantId, articuloId: a.id })
    const baja = await owner.query(`SELECT desactivado_en FROM articulos WHERE id = $1`, [a.id])
    expect(baja.rows[0].desactivado_en).not.toBeNull()

    const movs = await owner.query(
      `SELECT count(*)::int AS n FROM movimientos_stock WHERE articulo_id = $1`, [a.id],
    )
    expect(movs.rows[0].n, 'la baja se llevó puesto el historial').toBe(1)

    await reactivarArticulo({ tenantId, articuloId: a.id })
    const alta = await owner.query(`SELECT desactivado_en FROM articulos WHERE id = $1`, [a.id])
    expect(alta.rows[0].desactivado_en).toBeNull()
  })

  it('rechaza editar un artículo que no existe en este tenant', async () => {
    await expect(
      editarArticulo({
        tenantId,
        articuloId: '00000000-0000-7000-8000-000000000000',
        nombre: 'X', sku: 'X-1', precio: d('1'),
      }),
    ).rejects.toMatchObject({ codigo: 'ARTICULO_INEXISTENTE' })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `npx vitest run test/inventario.test.ts`
Expected: FAIL — `crearArticulo` no está exportada por `@/lib/inventario/articulos`.

- [ ] **Step 3: Escribir el módulo**

```ts
// lib/inventario/articulos.ts
import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { excedeEscala, ESCALA_DINERO, ESCALA_CANTIDAD } from '@/lib/ventas/totales'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeInventario } from './errores'

type Decimal = Prisma.Decimal

export type EntradaCrearArticulo = {
  tenantId: string
  // Quién lo dio de alta. Se usa para firmar el movimiento del stock inicial:
  // `MovimientoStock.usuarioId` es obligatorio, y con razón — un movimiento
  // sin autor no se puede auditar.
  usuarioId: string
  nombre: string
  tipo: 'PRODUCTO' | 'SERVICIO'
  precio: Decimal
  sku?: string
  stockInicial?: Decimal | null
  costoUnitario?: Decimal | null
}

// Cuántas veces se salta el correlativo antes de rendirse. Agotar cinco
// seguidos significa que alguien tipeó a mano una racha de códigos con esta
// misma forma, y ahí el mensaje de error es mejor respuesta que seguir
// contando para siempre.
const INTENTOS_SKU = 5

function exigirNombre(nombre: string): string {
  const limpio = nombre.trim()
  if (limpio === '') {
    throw new ErrorDeInventario('NOMBRE_VACIO', 'el artículo necesita un nombre')
  }
  return limpio
}

function exigirPrecio(precio: Decimal): void {
  if (precio.lessThan(0)) {
    throw new ErrorDeInventario('PRECIO_INVALIDO', 'el precio no puede ser negativo')
  }
  if (excedeEscala(precio, ESCALA_DINERO)) {
    throw new ErrorDeInventario(
      'ESCALA_EXCEDIDA',
      `el precio tiene a lo sumo ${ESCALA_DINERO} decimales`,
    )
  }
}

/**
 * El correlativo del SKU, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()` de artículos: contar les daría el
 * mismo número a dos altas concurrentes, y con `desactivadoEn` en juego
 * llegaría a repetir uno ya usado. Es el mismo mecanismo —y la misma razón—
 * que `proximoNumero` en lib/ventas/crear.ts.
 */
async function proximoSku(tx: ClienteTx, tenantId: string): Promise<string> {
  const filas = await tx.$queryRaw<{ proximo: number }[]>`
    UPDATE tenants
       SET proximo_sku_articulo = proximo_sku_articulo + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_sku_articulo - 1 AS proximo
  `
  // Cero filas significa que el tenant no existe, o que existe y RLS no lo deja
  // ver —que para el motor es lo mismo—. Sin este guard, `filas[0]` es
  // `undefined` y el llamador recibe un TypeError en vez de un
  // ErrorDeInventario, justo en la única línea que habla SQL crudo.
  if (filas.length === 0) {
    throw new ErrorDeInventario('TENANT_INEXISTENTE', `el tenant ${tenantId} no existe`)
  }
  return `A-${String(filas[0].proximo).padStart(4, '0')}`
}

/** Si el error es la unicidad de `(tenant_id, sku)` y no otra cosa. */
function esSkuRepetido(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === 'P2002' &&
    // El target nombra las columnas del índice violado. Sin este chequeo,
    // cualquier otra unicidad futura se leería como un choque de SKU.
    JSON.stringify(e.meta?.target ?? '').includes('sku')
  )
}

/**
 * Alta de artículo, con su stock inicial si lo tiene.
 *
 * **El reintento envuelve a la transacción entera y no vive adentro**, y eso no
 * es estilo: una violación de unicidad ABORTA la transacción en Postgres, así
 * que después del error ninguna sentencia más funciona sobre esa conexión.
 * Reintentar adentro fallaría con "current transaction is aborted".
 *
 * Sólo se reintenta el SKU AUTOGENERADO. Uno tipeado a mano que choca devuelve
 * `SKU_REPETIDO` sin más: cambiarle el código al que lo escribió sería decidir
 * por él.
 */
export async function crearArticulo(
  entrada: EntradaCrearArticulo,
): Promise<{ id: string; sku: string }> {
  const { tenantId, usuarioId, tipo, precio, stockInicial, costoUnitario } = entrada

  const nombre = exigirNombre(entrada.nombre)
  exigirPrecio(precio)

  const skuTipeado = entrada.sku?.trim()

  if (stockInicial !== null && stockInicial !== undefined) {
    if (tipo === 'SERVICIO') {
      throw new ErrorDeInventario(
        'SERVICIO_SIN_STOCK',
        'un servicio no lleva stock: dejá el stock inicial vacío',
      )
    }
    if (stockInicial.lessThan(0)) {
      throw new ErrorDeInventario('CANTIDAD_INVALIDA', 'el stock inicial no puede ser negativo')
    }
    if (excedeEscala(stockInicial, ESCALA_CANTIDAD)) {
      throw new ErrorDeInventario(
        'ESCALA_EXCEDIDA',
        `el stock inicial tiene a lo sumo ${ESCALA_CANTIDAD} decimales`,
      )
    }
  }
  if (costoUnitario !== null && costoUnitario !== undefined) {
    if (costoUnitario.lessThan(0)) {
      throw new ErrorDeInventario('COSTO_INVALIDO', 'el costo no puede ser negativo')
    }
    if (excedeEscala(costoUnitario, ESCALA_DINERO)) {
      throw new ErrorDeInventario(
        'ESCALA_EXCEDIDA',
        `el costo tiene a lo sumo ${ESCALA_DINERO} decimales`,
      )
    }
  }

  for (let intento = 1; intento <= INTENTOS_SKU; intento++) {
    try {
      return await enTransaccionDeTenant(tenantId, async (tx) => {
        await exigirUsuario(tx, usuarioId)

        const sku = skuTipeado && skuTipeado !== ''
          ? skuTipeado
          : await proximoSku(tx, tenantId)

        const articulo = await tx.articulo.create({
          data: { tenantId, sku, nombre, tipo, precio },
        })

        // El stock inicial NO se escribe en la columna: nace como movimiento,
        // en esta misma transacción. La invariante del motor es que el stock
        // es la suma de sus movimientos, y un artículo que nace con 5 sin nada
        // que lo explique es justo la pregunta que la tabla append-only existe
        // para poder responder.
        if (stockInicial && stockInicial.greaterThan(0)) {
          await tx.movimientoStock.create({
            data: {
              tenantId,
              articuloId: articulo.id,
              delta: stockInicial,
              motivo: 'INGRESO',
              usuarioId,
              costoUnitario: costoUnitario ?? null,
              nota: 'stock inicial',
            },
          })
          await tx.articulo.update({
            where: { id: articulo.id },
            data: { stock: { increment: stockInicial } },
          })
        }

        return { id: articulo.id, sku }
      })
    } catch (e) {
      if (!esSkuRepetido(e)) throw e
      // Tipeado a mano: es un choque real y quien lo escribió tiene que verlo.
      if (skuTipeado && skuTipeado !== '') {
        throw new ErrorDeInventario('SKU_REPETIDO', `el código ${skuTipeado} ya está usado`)
      }
      // Autogenerado: alguien tipeó a mano un código con esta forma. Se saltea
      // y se prueba con el siguiente; el contador ya avanzó.
      if (intento === INTENTOS_SKU) {
        throw new ErrorDeInventario(
          'SKU_REPETIDO',
          'no se pudo generar un código libre: escribí uno a mano',
        )
      }
    }
  }
  // Inalcanzable: el for de arriba retorna o tira. Existe para que TypeScript
  // vea un retorno en todos los caminos.
  throw new ErrorDeInventario('SKU_REPETIDO', 'no se pudo generar un código libre')
}

/** El tipo NO está y no es un olvido: ver el comentario del test. */
export async function editarArticulo(entrada: {
  tenantId: string
  articuloId: string
  nombre: string
  sku: string
  precio: Decimal
}): Promise<void> {
  const { tenantId, articuloId, precio } = entrada

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
      // `updateMany` y no `update`: con RLS, un id de otro tenant no existe
      // para esta conexión, y `update` tira P2025 — un error de Prisma sin
      // `codigo`. Contar filas afectadas deja decirlo con el error del módulo.
      const { count } = await tx.articulo.updateMany({
        where: { id: articuloId },
        data: { nombre, sku, precio },
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
    throw e
  }
}

async function marcarBaja(tenantId: string, articuloId: string, valor: Date | null): Promise<void> {
  await enTransaccionDeTenant(tenantId, async (tx) => {
    const { count } = await tx.articulo.updateMany({
      where: { id: articuloId },
      data: { desactivadoEn: valor },
    })
    if (count === 0) {
      throw new ErrorDeInventario(
        'ARTICULO_INEXISTENTE',
        `el artículo ${articuloId} no existe en este tenant`,
      )
    }
  })
}

/** El artículo deja de ofrecerse. Su historial y sus ventas quedan intactos:
 *  las FKs son Restrict a propósito y borrarlo se llevaría lo que se vendió. */
export async function desactivarArticulo(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  await marcarBaja(entrada.tenantId, entrada.articuloId, new Date())
}

export async function reactivarArticulo(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  await marcarBaja(entrada.tenantId, entrada.articuloId, null)
}
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run test/inventario.test.ts`
Expected: PASS, 34 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/articulos.ts test/inventario.test.ts
git commit -m "feat(inventario): alta, edición y baja de artículos con SKU autogenerado"
```

#### Ajustes hechos durante la ejecución (2026-08-11)

El código de arriba es el del plan original. La ejecución encontró **un bug real
del plan** y dos cosas más; la fuente de verdad es el código commiteado:

1. **El bucle de reintento del SKU, tal como el plan lo escribió, nunca
   converge.** El `UPDATE` del contador corre adentro de la misma transacción
   que después falla por unicidad, y Postgres rollbackea la transacción
   **entera** — incluido ese `UPDATE`. O sea que cada reintento volvía a pedir
   el mismo número: `A-0001` cinco veces seguidas, confirmado con logs. El plan
   acertó en que el reintento va afuera de la transacción y erró en dejar el
   contador adentro. `proximoSku` pasó a correr en **su propia transacción
   comiteada**.

   **La consecuencia se acepta a conciencia: la secuencia de SKU puede tener
   huecos**, porque el contador comitea antes del insert y toda alta que falle
   después quema un número. Para un SKU está bien —es un código opaco que nadie
   cuenta— y para `Venta.numero` estaría mal, porque la gente dice "la venta
   123" por teléfono. Por eso `proximoNumero` de `lib/ventas/crear.ts`
   **no** cambia y **no** debe armonizarse con éste: no tiene el defecto,
   justamente porque no reintenta, y ahí el rollback del contador es lo que se
   quiere.

2. **`e.meta.target` no se puebla nunca con `@prisma/adapter-pg`.** Prisma 7
   arma el meta de los errores del adapter como `{ driverAdapterError }`, así
   que el chequeo que el plan escribió no habría discriminado nada. El
   discriminador es `cause.constraint.fields`, **fallando abierto** cuando el
   campo falta.

   Y falta siempre: bajo `arandano_app` —el único rol con el que la app se
   conecta— Postgres retiene el `DETAIL` del error porque la policy de RLS
   aplica al rol que consulta. No es por los `GRANT`: `arandano_app` tiene
   `SELECT`. Así que lo que sostiene la corrección es que `articulos` tiene una
   sola unicidad y `movimientos_stock` ninguna: adentro de esa transacción un
   `P2002` no puede ser otra cosa.

3. **`crearArticulo` y `editarArticulo` pasan por el `traducirErrorDeBase` de
   `lib/inventario/errores.ts`**, por el mismo motivo que `stock.ts` (ver los
   ajustes de la Task 3): un precio o un stock inicial que desborda su columna
   salía como error crudo de Prisma, y los server actions filtran por
   `instanceof ErrorDeInventario`.

`test/inventario.test.ts` termina con **36** tests.

---

### Task 5: Los server actions

**Files:**
- Create: `app/(app)/inventario/acciones.ts`
- Test: `app/(app)/inventario/acciones.test.ts`

**Interfaces:**
- Consumes: todo `lib/inventario/`; `aDecimal` y `aDecimalOpcional` de `@/lib/formato/numeros`; `exigirSesion` y `exigirDuenio` de `@/lib/auth/sesion`.
- Produces (todas `(estadoPrevio, datos: FormData) => Promise<EstadoInventario>`, la forma que pide `useActionState`):
  - `altaArticulo`, `guardarArticulo`, `bajaArticulo`, `reactivarArticuloAccion` — **dueño**
  - `ingresarMercaderia`, `corregirPorConteo` — **cualquiera con sesión**
  - `type EstadoInventario = { error: string | null; aviso: string | null }`

**El valor inicial de `useActionState` no vive acá.** Este archivo es `'use server'`, y ahí Next convierte cada export en un endpoint RPC: sólo admite funciones async. Exportar una constante hace que el módulo falle al evaluarse —en runtime, con el build en verde— y tira abajo la pantalla entera. Vive en `formularios.tsx`, igual que en `usuarios` y en `login`. `test/use-server.test.ts` lo fija.

**Cada action reexige su rol por su cuenta.** Que la pantalla no se muestre no es una defensa: una action se invoca sin pasar por ningún componente.

- [ ] **Step 1: Escribir las actions**

```ts
// app/(app)/inventario/acciones.ts
'use server'

import { revalidatePath } from 'next/cache'
import { exigirSesion, exigirDuenio } from '@/lib/auth/sesion'
import {
  crearArticulo,
  editarArticulo,
  desactivarArticulo,
  reactivarArticulo,
} from '@/lib/inventario/articulos'
import { ingresarStock, corregirStock } from '@/lib/inventario/stock'
import { ErrorDeInventario } from '@/lib/inventario/errores'
import { aDecimal, aDecimalOpcional, ErrorDeFormato } from '@/lib/formato/numeros'

export type EstadoInventario = { error: string | null; aviso: string | null }

/** Sólo el dueño: el precio es plata y el catálogo es decisión del negocio. */
async function comoDuenio<T>(fn: (tenantId: string, usuarioId: string) => Promise<T>) {
  const sesion = await exigirDuenio()
  return fn(sesion.tenant.id, sesion.usuario.id)
}

/**
 * Cualquiera con sesión. Recibir una caja del proveedor y corregir un faltante
 * es operación del día, la hace quien está atendiendo, y no queda anónima:
 * el movimiento se firma con este `usuarioId`.
 */
async function conSesion<T>(fn: (tenantId: string, usuarioId: string) => Promise<T>) {
  const sesion = await exigirSesion()
  return fn(sesion.tenant.id, sesion.usuario.id)
}

/**
 * Sólo los errores de dominio se muestran; el resto se relanza.
 *
 * Tragar un error desconocido lo convertiría en un cartel rojo genérico en la
 * pantalla, y el bug quedaría sin llegar nunca a Sentry ni al log. Los dos que
 * SÍ se muestran son los dos que la persona puede corregir tipeando distinto.
 *
 * `ErrorDeVenta` NO está en la lista, y no es un olvido: el único que puede
 * llegar por acá es el `USUARIO_INEXISTENTE` de `exigirUsuario`, y con una
 * sesión válida no puede pasar —RLS garantiza que el usuario de la sesión es de
 * este tenant—. Si pasa, es un bug y tiene que verse como tal.
 */
function traducir(e: unknown): EstadoInventario {
  if (e instanceof ErrorDeInventario || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim()

export async function altaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const tipo = datos.get('tipo') === 'SERVICIO' ? 'SERVICIO' : 'PRODUCTO'
    const creado = await comoDuenio((tenantId, usuarioId) =>
      crearArticulo({
        tenantId,
        usuarioId,
        nombre: texto(datos, 'nombre'),
        tipo,
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
        sku: texto(datos, 'sku'),
        // Un servicio no lleva stock, y sin JavaScript los campos se ven
        // igual: se ignoran acá en vez de rechazar el alta por algo que la
        // persona no eligió mandar.
        stockInicial:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'stockInicial'), 'el stock inicial') : null,
        costoUnitario:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo') : null,
      }),
    )
    revalidatePath('/inventario')
    return { error: null, aviso: `Artículo creado con el código ${creado.sku}.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function guardarArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoDuenio((tenantId) =>
      editarArticulo({
        tenantId,
        articuloId,
        nombre: texto(datos, 'nombre'),
        sku: texto(datos, 'sku'),
        precio: aDecimal(texto(datos, 'precio'), 'el precio'),
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Cambios guardados.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function bajaArticulo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoDuenio((tenantId) => desactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo desactivado. Su historial queda intacto.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function reactivarArticuloAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoDuenio((tenantId) => reactivarArticulo({ tenantId, articuloId }))
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Artículo reactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function ingresarMercaderia(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    const cantidad = aDecimal(texto(datos, 'cantidad'), 'la cantidad')
    await conSesion((tenantId, usuarioId) =>
      ingresarStock({
        tenantId,
        articuloId,
        cantidad,
        usuarioId,
        costoUnitario: aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo'),
        nota: texto(datos, 'nota') || undefined,
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `Ingresaron ${cantidad.toString()} unidades.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function corregirPorConteo(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    const stockContado = aDecimal(texto(datos, 'stockContado'), 'el conteo')
    await conSesion((tenantId, usuarioId) =>
      corregirStock({
        tenantId,
        articuloId,
        stockContado,
        usuarioId,
        nota: texto(datos, 'nota') || undefined,
      }),
    )
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: `El stock quedó en ${stockContado.toString()}.` }
  } catch (e) {
    return traducir(e)
  }
}
```

- [ ] **Step 2: Escribir el test del rol**

El archivo completo. Los mocks son los mismos cuatro que `app/(app)/usuarios/acciones.test.ts` y por los mismos motivos: `next/headers` para inyectar la cookie de cada caso, `next/navigation` para poder distinguir `forbidden()` de `redirect()` y de cualquier otro fallo, `next/cache` porque `revalidatePath` explota fuera de un request real de Next, y `desde-request` porque no hay `Host` que resolver.

**La sesión es real**: login real contra Better Auth, cookie real, `getSession` real contra Postgres. Mockear `exigirDuenio` asumiría la conclusión que este archivo existe para probar.

```ts
// app/(app)/inventario/acciones.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

const estado = vi.hoisted(() => ({ tenantId: '', subdominio: '', cookie: '' }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => ({
    tipo: 'tenant',
    tenant: { id: estado.tenantId, nombre: 'Inventario acciones test', estado: 'TRIAL' },
    subdominio: estado.subdominio,
  }),
}))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(estado.cookie ? { cookie: estado.cookie } : undefined),
}))

const forbidden = vi.fn(() => {
  throw new Error('FORBIDDEN')
})
const redirect: (a: string) => never = vi.fn(() => {
  throw new Error('REDIRECT')
})
vi.mock('next/navigation', () => ({
  forbidden: () => forbidden(),
  redirect: (a: string) => redirect(a),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

let altaArticulo: typeof import('./acciones').altaArticulo
let guardarArticulo: typeof import('./acciones').guardarArticulo
let bajaArticulo: typeof import('./acciones').bajaArticulo
let reactivarArticuloAccion: typeof import('./acciones').reactivarArticuloAccion
let ingresarMercaderia: typeof import('./acciones').ingresarMercaderia
let corregirPorConteo: typeof import('./acciones').corregirPorConteo
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant
let origenDelRequest: typeof import('@/lib/auth/origen').origenDelRequest

// Propio del test y no importado de acciones.ts: ese archivo es 'use server' y
// sólo puede exportar funciones async.
const INICIAL = { error: null, aviso: null }

const CLAVE = 'clave-mas-que-de-sobra'
const MAIL_EMPLEADO = 'empleado-inventario@ejemplo.test'
const MAIL_DUENO = 'duenia-inventario@ejemplo.test'

let owner: Client
let empleadoId: string
let articuloId: string
let cookieEmpleado: string
let cookieDuenio: string

beforeAll(async () => {
  // lib/auth/para-tenant.ts arrastra lib/db.ts, que arma su Pool leyendo
  // DATABASE_URL al importarse; DOMINIO_BASE lo necesita origenDelRequest.
  process.env.DATABASE_URL = urlApp()
  process.env.DOMINIO_BASE = 'arandano.test'

  ;({
    altaArticulo, guardarArticulo, bajaArticulo,
    reactivarArticuloAccion, ingresarMercaderia, corregirPorConteo,
  } = await import('./acciones'))
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))
  ;({ origenDelRequest } = await import('@/lib/auth/origen'))
  const administrar = await import('@/lib/usuarios/administrar')

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()

  const subdominio = `inventario-acciones-${Date.now()}`
  estado.tenantId = await crearTenant(owner, subdominio)
  estado.subdominio = subdominio

  const origen = await origenDelRequest(subdominio)
  const empleado = await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'Un empleado',
    email: MAIL_EMPLEADO, clave: CLAVE, rol: 'EMPLEADO',
  })
  empleadoId = empleado.id
  await administrar.crearEmpleado({
    tenantId: estado.tenantId, origen, nombre: 'La dueña',
    email: MAIL_DUENO, clave: CLAVE, rol: 'DUENO',
  })

  const a = await owner.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'ACC-1', 'Artículo de prueba', 'PRODUCTO', 1000.00, 0, now(), now())
     RETURNING id`,
    [estado.tenantId],
  )
  articuloId = a.rows[0].id

  cookieEmpleado = await cookieDe(MAIL_EMPLEADO)
  cookieDuenio = await cookieDe(MAIL_DUENO)
})

afterAll(async () => {
  await owner.end()
})

/** Login real contra Better Auth; devuelve la cookie lista para que el mock
 *  de next/headers la sirva. Mismo extracto que test/auth.test.ts. */
async function cookieDe(email: string): Promise<string> {
  const origen = await origenDelRequest(estado.subdominio)
  const r = await authParaTenant(estado.tenantId, origen).api.signInEmail({
    body: { email, password: CLAVE },
    asResponse: true,
  })
  const cookie = r.headers.get('set-cookie')
  if (!cookie) throw new Error('el login no devolvió cookie; el test no probaría nada')
  return cookie.split(';')[0]
}

describe('el rol de cada action de inventario', () => {
  it('un EMPLEADO no puede dar de alta, editar, ni desactivar', async () => {
    estado.cookie = cookieEmpleado
    for (const [nombre, accion] of [
      ['altaArticulo', altaArticulo],
      ['guardarArticulo', guardarArticulo],
      ['bajaArticulo', bajaArticulo],
      ['reactivarArticuloAccion', reactivarArticuloAccion],
    ] as const) {
      const datos = new FormData()
      datos.set('nombre', 'Intento')
      datos.set('precio', '100')
      datos.set('articuloId', articuloId)
      await expect(accion(INICIAL, datos), `${nombre} dejó pasar a un empleado`).rejects.toThrow(
        'FORBIDDEN',
      )
    }
  })

  it('un EMPLEADO SÍ puede mover stock: es operación del día y queda firmada', async () => {
    estado.cookie = cookieEmpleado
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    datos.set('cantidad', '3')
    const r = await ingresarMercaderia(INICIAL, datos)
    expect(r.error).toBeNull()

    // Firmado con QUIEN lo hizo, que es la trazabilidad que reemplaza al
    // permiso denegado.
    const { rows } = await owner.query(
      `SELECT usuario_id FROM movimientos_stock WHERE articulo_id = $1
        ORDER BY creado_en DESC LIMIT 1`,
      [articuloId],
    )
    expect(rows[0].usuario_id).toBe(empleadoId)
  })

  it('sin sesión, mover stock manda al login en vez de escribir', async () => {
    estado.cookie = ''
    const datos = new FormData()
    datos.set('articuloId', articuloId)
    datos.set('cantidad', '3')
    await expect(ingresarMercaderia(INICIAL, datos)).rejects.toThrow('REDIRECT')
  })

  it('un DUEÑO da de alta y el aviso trae el código generado', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Cable USB-C')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '4.500,50')
    const r = await altaArticulo(INICIAL, datos)
    expect(r.error).toBeNull()
    expect(r.aviso).toMatch(/A-\d{4}/)
  })

  // El formato argentino tiene que llegar entero hasta la base: es el camino
  // completo, no sólo el parser.
  it('el precio escrito con coma llega bien a la base', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Con coma')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '85.000,75')
    await altaArticulo(INICIAL, datos)

    const { rows } = await owner.query(
      `SELECT precio FROM articulos WHERE nombre = 'Con coma' AND tenant_id = $1`,
      [estado.tenantId],
    )
    expect(new Prisma.Decimal(rows[0].precio).toString()).toBe('85000.75')
  })

  it('un número ambiguo no se adivina: vuelve como error para la pantalla', async () => {
    estado.cookie = cookieDuenio
    const datos = new FormData()
    datos.set('nombre', 'Ambiguo')
    datos.set('tipo', 'PRODUCTO')
    datos.set('precio', '850.000')
    const r = await altaArticulo(INICIAL, datos)
    expect(r.error).toMatch(/no se entiende/)
  })
})
```

- [ ] **Step 3: Correr el test**

Run: `npx vitest run "app/(app)/inventario/acciones.test.ts"`
Expected: PASS, 6 tests.

- [ ] **Step 4: Verificar que `'use server'` no exporta nada que no sea async**

Run: `npx vitest run test/use-server.test.ts`
Expected: PASS. Si falla, es porque quedó una constante exportada en `acciones.ts`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/inventario/acciones.ts" "app/(app)/inventario/acciones.test.ts"
git commit -m "feat(inventario): server actions con el rol reexigido en cada una"
```

---

### Task 6: El listado, el alta y la navegación

**Files:**
- Create: `app/(app)/inventario/page.tsx`
- Create: `app/(app)/inventario/nuevo/page.tsx`
- Create: `app/(app)/inventario/formularios.tsx`
- Create: `components/navegacion.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: las actions de la Task 5; `prismaParaTenant` de `@/lib/tenant/prisma`; `exigirSesion`/`exigirDuenio` de `@/lib/auth/sesion`; los componentes de `@/components/ui/`.
- Produces: `formatearPrecio`, `formatearCantidad` y `FormularioDeAlta`, que la Task 7 reutiliza desde `./formularios`.

**El barrido del smoke las levanta solas.** `scripts/lib/rutas-comun.sh` deriva las rutas del sistema de archivos, así que `/inventario` y `/inventario/nuevo` entran sin tocar nada. El usuario del canario es `DUENO` (`scripts/crear-tenant.mts:147`), así que `/inventario/nuevo` responde 200 en el gate.

- [ ] **Step 1: Escribir los formularios**

```tsx
// app/(app)/inventario/formularios.tsx
'use client'

import { useActionState, useState } from 'react'
import {
  altaArticulo,
  guardarArticulo,
  bajaArticulo,
  reactivarArticuloAccion,
  ingresarMercaderia,
  corregirPorConteo,
  type EstadoInventario,
} from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

// Acá y no en acciones.ts: aquel archivo es 'use server' y sólo puede exportar
// funciones async. Mismo lugar que en usuarios y en login.
const INICIAL: EstadoInventario = { error: null, aviso: null }

// Los dos formateadores viven acá y se exportan porque las tres pantallas
// muestran los mismos números y una segunda copia se desincroniza.
const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
})
export function formatearPrecio(v: string): string {
  return PESOS.format(Number(v))
}

// Hasta 3 decimales pero sin ceros de relleno: "4" y no "4,000". Medio kilo de
// harina necesita los decimales; una unidad no tiene por qué mostrarlos.
const CANTIDAD = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 })
export function formatearCantidad(v: string): string {
  return CANTIDAD.format(Number(v))
}

function Resultado({ estado }: { estado: EstadoInventario }) {
  if (estado.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{estado.error}</AlertDescription>
      </Alert>
    )
  }
  if (estado.aviso) {
    return (
      <Alert>
        <AlertDescription>{estado.aviso}</AlertDescription>
      </Alert>
    )
  }
  return null
}

/**
 * Alta de artículo.
 *
 * Los campos de stock se ocultan al elegir "servicio" — un servicio no lleva
 * stock. **Sin JavaScript se ven igual**, y por eso `altaArticulo` los ignora
 * cuando el tipo es SERVICIO en vez de rechazar el alta: la pantalla mejora
 * con JS, no depende de él.
 */
export function FormularioDeAlta() {
  const [estado, accion, pendiente] = useActionState(altaArticulo, INICIAL)
  const [tipo, setTipo] = useState<'PRODUCTO' | 'SERVICIO'>('PRODUCTO')

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Artículo nuevo</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" name="nombre" required autoFocus />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="tipo">Tipo</Label>
            {/* h-8 y no h-9: son los 32 px que docs/sistema-de-diseno.md
                declara para input y botón. Mismo caso que el select de rol en
                usuarios/formularios.tsx. */}
            <select
              id="tipo"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as 'PRODUCTO' | 'SERVICIO')}
              className="h-8 rounded-md border px-3 text-sm"
            >
              <option value="PRODUCTO">Producto (lleva stock)</option>
              <option value="SERVICIO">Servicio (sin stock)</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="precio">Precio</Label>
            {/* type="text" con inputMode="decimal" y no type="number": el
                teclado numérico aparece igual en el celular, pero la coma
                llega sin que el navegador la descarte. El parseo lo hace
                lib/formato/numeros.ts. */}
            <Input id="precio" name="precio" inputMode="decimal" placeholder="15000,50" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sku">Código (opcional)</Label>
            <Input id="sku" name="sku" placeholder="Se genera solo si lo dejás vacío" />
          </div>
          {tipo === 'PRODUCTO' && (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="stockInicial">Stock inicial (opcional)</Label>
                <Input id="stockInicial" name="stockInicial" inputMode="decimal" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="costoUnitario">Costo unitario (opcional)</Label>
                <Input id="costoUnitario" name="costoUnitario" inputMode="decimal" />
              </div>
            </>
          )}
          <Resultado estado={estado} />
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Creando…' : 'Crear artículo'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
```

(Los formularios del detalle —`FormularioDeEdicion`, `MoverStock`, `AccionesDeArticulo`— se agregan a este mismo archivo en la Task 7.)

- [ ] **Step 2: Escribir la pantalla de alta**

```tsx
// app/(app)/inventario/nuevo/page.tsx
import Link from 'next/link'
import { exigirDuenio } from '@/lib/auth/sesion'
import { FormularioDeAlta } from '../formularios'

export const dynamic = 'force-dynamic'

export default async function ArticuloNuevo() {
  // El guard va acá además de en la action: la pantalla no se muestra Y la
  // action rechaza. Ninguna de las dos es suficiente sola.
  await exigirDuenio()

  return (
    <main className="p-6">
      <Link href="/inventario" className="text-sm underline">
        ← Inventario
      </Link>
      <h1 className="mt-4 mb-6 text-xl font-medium">Artículo nuevo</h1>
      <FormularioDeAlta />
    </main>
  )
}
```

- [ ] **Step 3: Escribir el listado**

```tsx
// app/(app)/inventario/page.tsx
import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearPrecio, formatearCantidad } from './formularios'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

export default async function Inventario({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; inactivos?: string }>
}) {
  const sesion = await exigirSesion()
  const { q = '', p = '1', inactivos } = await searchParams

  const busqueda = q.trim()
  const pagina = Math.max(1, Number(p) || 1)
  const verInactivos = inactivos === '1'

  const prisma = prismaParaTenant(sesion.tenant.id)
  const donde = {
    // `null` y no `undefined`: undefined le diría a Prisma "no filtres".
    ...(verInactivos ? {} : { desactivadoEn: null }),
    ...(busqueda
      ? {
          OR: [
            { nombre: { contains: busqueda, mode: 'insensitive' as const } },
            { sku: { contains: busqueda, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [articulos, total] = await Promise.all([
    prisma.articulo.findMany({
      where: donde,
      orderBy: { nombre: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true, sku: true, nombre: true, tipo: true, precio: true,
        stock: true, desactivadoEn: true,
      },
    }),
    prisma.articulo.count({ where: donde }),
  ])

  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conParametros = (n: number) => {
    const u = new URLSearchParams()
    if (busqueda) u.set('q', busqueda)
    if (verInactivos) u.set('inactivos', '1')
    if (n > 1) u.set('p', String(n))
    const s = u.toString()
    return s ? `/inventario?${s}` : '/inventario'
  }

  return (
    <main className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-medium">Inventario</h1>
        {sesion.usuario.rol === 'DUENO' && (
          <Button asChild size="sm">
            <Link href="/inventario/nuevo">Artículo nuevo</Link>
          </Button>
        )}
      </div>

      {/* method="get" y no una action: anda sin JavaScript, y la URL con la
          búsqueda adentro se puede compartir o dejar guardada. El buscador
          por código es además lo que habilita un lector de código de barras,
          que tipea y manda Enter. */}
      <form method="get" className="mb-6 flex items-end gap-3">
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar por nombre o código
          </label>
          <Input id="q" name="q" defaultValue={busqueda} />
        </div>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={verInactivos} />
          Ver desactivados
        </label>
        <Button type="submit" size="sm" variant="secondary">
          Buscar
        </Button>
      </form>

      {articulos.length === 0 ? (
        // Un local recién dado de alta llega acá con cero artículos, y ésta es
        // la primera pantalla que ve. En blanco no diría qué hacer.
        <p className="text-sm text-muted-foreground">
          {busqueda
            ? `No hay artículos que coincidan con "${busqueda}".`
            : sesion.usuario.rol === 'DUENO'
              ? 'Todavía no cargaste ningún artículo. Empezá por «Artículo nuevo».'
              : 'Todavía no hay artículos cargados.'}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="py-2">Código</th>
              <th>Nombre</th>
              <th>Tipo</th>
              <th className="text-right">Precio</th>
              <th className="text-right">Stock</th>
            </tr>
          </thead>
          <tbody>
            {articulos.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="py-2">{a.sku}</td>
                <td>
                  <Link href={`/inventario/${a.id}`} className="underline">
                    {a.nombre}
                  </Link>
                  {a.desactivadoEn && (
                    <span className="ml-2 text-muted-foreground">(desactivado)</span>
                  )}
                </td>
                <td>{a.tipo === 'PRODUCTO' ? 'Producto' : 'Servicio'}</td>
                {/* tabular-nums text-right en toda columna de plata o de
                    cantidad: sin eso las columnas bailan y comparar dos
                    precios de un vistazo deja de funcionar. */}
                <td className="text-right tabular-nums">{formatearPrecio(a.precio.toString())}</td>
                <td className="text-right tabular-nums">
                  {a.tipo === 'SERVICIO' ? (
                    // Un guion y NO un 0: el motor no le descuenta stock a un
                    // servicio (lib/ventas/crear.ts filtra por esProducto), así
                    // que un 0 se leería como faltante y alguien saldría a
                    // comprar lo que no existe.
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className={a.stock.lessThan(0) ? 'text-destructive' : undefined}>
                      {formatearCantidad(a.stock.toString())}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {paginas > 1 && (
        <nav className="mt-6 flex items-center gap-4 text-sm">
          {pagina > 1 && (
            <Link href={conParametros(pagina - 1)} className="underline">
              ← Anterior
            </Link>
          )}
          <span className="text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas && (
            <Link href={conParametros(pagina + 1)} className="underline">
              Siguiente →
            </Link>
          )}
        </nav>
      )}
    </main>
  )
}
```

- [ ] **Step 4: Escribir el componente de navegación**

**Un componente compartido y no un `<nav>` inline en el layout, y el motivo es estructural:** `/` **no vive bajo `(app)`** — está en la lista blanca de `test/rutas-con-guard.test.ts` porque el ápex entra por esa misma ruta sin sesión. O sea que la home **no hereda el layout** y no heredaría la nav. Dejar los enlaces sólo en el layout deja huérfana justamente la pantalla donde el usuario aterriza después de entrar.

```tsx
// components/navegacion.tsx
import type { RolUsuario } from '@/lib/auth/sesion'

/**
 * Los enlaces de la aplicación, en un solo lugar.
 *
 * Lo usan DOS consumidores y por eso vive en components/ y no adentro de
 * `app/(app)/`: el layout del grupo, y `app/page.tsx`, que no puede estar bajo
 * ese grupo —el ápex entra por la misma ruta y no tiene sesión— y por lo tanto
 * no hereda su layout. Dos listas de enlaces se desincronizan en cuanto
 * aparezca la cuarta sección.
 *
 * Sin registry de módulos todavía: CLAUDE.md promete la navegación como punto
 * de extensión del núcleo, y ese punto se diseña bien cuando exista Órdenes de
 * Trabajo para tironear de él. Tenerlos centralizados acá es lo que hace barato
 * ese refactor.
 */
export function Navegacion({ rol }: { rol: RolUsuario }) {
  return (
    <nav className="flex items-center gap-4 text-sm">
      <a href="/" className="hover:underline">
        Inicio
      </a>
      <a href="/inventario" className="hover:underline">
        Inventario
      </a>
      {rol === 'DUENO' && (
        <a href="/usuarios" className="hover:underline">
          Usuarios
        </a>
      )}
    </nav>
  )
}
```

- [ ] **Step 5: Colgarlo del layout y de la home**

En `app/(app)/layout.tsx`, importar `Navegacion` de `@/components/navegacion` e insertar `<Navegacion rol={sesion.usuario.rol} />` entre el `<span data-testid="tenant-nombre">` y el `<div>` de la derecha. El `<span data-testid="tenant-nombre">` **no se toca**: `scripts/smoke.sh` lo busca en cada pantalla autenticada.

En `app/page.tsx`, reemplazar el bloque del `<a>` suelto:

```tsx
      {usuario.rol === 'DUENO' && (
        <a className="underline" href="/usuarios">
          Usuarios
        </a>
      )}
```

por:

```tsx
      <Navegacion rol={usuario.rol} />
```

`app/page.test.tsx:126` —"un dueño ve el link a /usuarios; un empleado no"— **tiene que seguir pasando sin tocarlo**: el componente filtra por rol igual que el bloque que reemplaza. Si ese test se pone rojo, el filtro quedó mal.

- [ ] **Step 6: Verificar que el barrido levanta las dos rutas**

```bash
bash -c 'source scripts/lib/rutas-comun.sh && rutas_autenticadas "app/(app)"'
```
Expected: imprime `/inventario`, `/inventario/nuevo` y `/usuarios`. Todavía no `[id]` — esa pantalla llega en la Task 7.

- [ ] **Step 7: Verificar el guard, el typecheck y el lint**

```bash
npx vitest run test/rutas-con-guard.test.ts test/boundaries-app.test.ts
npx tsc --noEmit
npm run lint
```
Expected: PASS los tres. `rutas-con-guard` tiene que pasar **sin** sumar entradas a `FUERA_DEL_GRUPO`: las dos pantallas nuevas viven bajo `(app)`.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/inventario/" components/navegacion.tsx "app/(app)/layout.tsx" app/page.tsx
git commit -m "feat(inventario): listado con buscador, alta de artículo y navegación"
```

---

### Task 7: El detalle y el historial

**Files:**
- Create: `app/(app)/inventario/[id]/page.tsx`
- Modify: `app/(app)/inventario/formularios.tsx`
- Modify: `scripts/lib/rutas-comun.sh`

**Interfaces:**
- Consumes: todo lo de la Task 6, más las actions `guardarArticulo`, `bajaArticulo`, `reactivarArticuloAccion`, `ingresarMercaderia`, `corregirPorConteo`.
- Produces: nada que otra task consuma. Es la última pantalla.

**Orden de los bloques por quién los usa.** Un empleado sólo puede mover stock, así que eso va arriba y la edición abajo.

**La primera entrada de `RUTAS_SIN_SMOKE`.** Esa lista arrancó vacía diciendo *"existe para que la primera sea una decisión y no un olvido"*. `/inventario/[id]` no se puede pedir a ciegas: no hay de dónde sacar un id válido sin sembrar datos, y sembrar datos convertiría al smoke en una suite de fixtures.

- [ ] **Step 1: Declarar la exención del smoke**

En `scripts/lib/rutas-comun.sh`, reemplazar la declaración vacía por:

```bash
declare -A RUTAS_SIN_SMOKE=(
  ['/inventario/[id]']='no hay de dónde sacar un id de artículo válido sin sembrar datos, y sembrarlos convertiría el smoke en una suite de fixtures. Lo que esta pantalla usa —el guard de sesión, prismaParaTenant, las actions— ya está cubierto por /inventario, por app/(app)/inventario/acciones.test.ts y por test/inventario.test.ts.'
)
```

- [ ] **Step 2: Verificar que el barrido sigue sano**

```bash
bash -c 'source scripts/lib/rutas-comun.sh && rutas_autenticadas "app/(app)"'
```
Expected: imprime `/inventario`, `/inventario/nuevo` y `/usuarios`, y **no** falla por la ruta con parámetro (que todavía no existe — este paso confirma que la exención no rompe nada antes de crear la pantalla).

- [ ] **Step 3: Sumar los formularios del detalle**

Al final de `app/(app)/inventario/formularios.tsx`:

```tsx
/** Editar. Sólo se monta para un dueño; la action lo reexige igual. */
export function FormularioDeEdicion({
  articuloId,
  nombre,
  sku,
  precio,
}: {
  articuloId: string
  nombre: string
  sku: string
  precio: string
}) {
  const [estado, accion, pendiente] = useActionState(guardarArticulo, INICIAL)

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Editar</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-col gap-4">
          <input type="hidden" name="articuloId" value={articuloId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-nombre">Nombre</Label>
            <Input id="e-nombre" name="nombre" defaultValue={nombre} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-sku">Código</Label>
            <Input id="e-sku" name="sku" defaultValue={sku} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="e-precio">Precio</Label>
            <Input id="e-precio" name="precio" inputMode="decimal" defaultValue={precio} required />
          </div>
          {/* El tipo no está y no es un olvido: pasar un PRODUCTO con stock y
              movimientos a SERVICIO deja stock huérfano que el motor ya no
              descuenta ni explica. Un artículo mal cargado se desactiva y se
              crea de nuevo. */}
          <Resultado estado={estado} />
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Guardando…' : 'Guardar'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

/** Desactivar o reactivar. Un form y no un onClick, igual que el botón de
 *  salir del layout: así funciona sin JavaScript. */
export function AccionesDeArticulo({
  articuloId,
  desactivado,
}: {
  articuloId: string
  desactivado: boolean
}) {
  const [estado, accion, pendiente] = useActionState(
    desactivado ? reactivarArticuloAccion : bajaArticulo,
    INICIAL,
  )

  return (
    <form action={accion} className="mt-4 flex max-w-md flex-col gap-3">
      <input type="hidden" name="articuloId" value={articuloId} />
      <Resultado estado={estado} />
      <Button type="submit" variant={desactivado ? 'secondary' : 'destructive'} disabled={pendiente}>
        {desactivado ? 'Reactivar artículo' : 'Desactivar artículo'}
      </Button>
    </form>
  )
}

/**
 * Las dos formas de mover stock, una al lado de la otra.
 *
 * El conteo pide CUÁNTO HAY, no cuánto falta: el delta lo calcula el servidor
 * adentro de la transacción, contra el stock de ese momento. Pedirlo acá
 * obligaría a restar en el navegador contra un número que puede tener un
 * minuto y una venta de antigüedad.
 */
export function MoverStock({ articuloId }: { articuloId: string }) {
  const [ingreso, accionIngreso, ingresando] = useActionState(ingresarMercaderia, INICIAL)
  const [conteo, accionConteo, contando] = useActionState(corregirPorConteo, INICIAL)

  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Ingresar mercadería</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accionIngreso} className="flex flex-col gap-4">
            <input type="hidden" name="articuloId" value={articuloId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-cantidad">Cantidad que entra</Label>
              <Input id="i-cantidad" name="cantidad" inputMode="decimal" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-costo">Costo unitario (opcional)</Label>
              <Input id="i-costo" name="costoUnitario" inputMode="decimal" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="i-nota">Nota (opcional)</Label>
              <Input id="i-nota" name="nota" placeholder="Factura, proveedor…" />
            </div>
            <Resultado estado={ingreso} />
            <Button type="submit" disabled={ingresando}>
              {ingresando ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Corregir por conteo</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accionConteo} className="flex flex-col gap-4">
            <input type="hidden" name="articuloId" value={articuloId} />
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-contado">Cuánto hay realmente</Label>
              <Input id="c-contado" name="stockContado" inputMode="decimal" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="c-nota">Nota (opcional)</Label>
              <Input id="c-nota" name="nota" placeholder="Conteo del lunes…" />
            </div>
            <Resultado estado={conteo} />
            <Button type="submit" variant="secondary" disabled={contando}>
              {contando ? 'Corrigiendo…' : 'Corregir'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 4: Escribir la pantalla de detalle**

```tsx
// app/(app)/inventario/[id]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  FormularioDeEdicion,
  AccionesDeArticulo,
  MoverStock,
  formatearPrecio,
  formatearCantidad,
} from '../formularios'

export const dynamic = 'force-dynamic'

const MOVIMIENTOS_VISIBLES = 50

// El servidor está en Ashburn. Sin declarar el huso, un movimiento de las 22:00
// de Buenos Aires aparecería con fecha del día siguiente y el historial de un
// cierre de jornada quedaría partido en dos días.
const FECHA = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

const NOMBRE_DE_MOTIVO: Record<string, string> = {
  VENTA: 'Venta',
  ANULACION_VENTA: 'Anulación de venta',
  AJUSTE: 'Ajuste',
  INGRESO: 'Ingreso',
}

export default async function DetalleDeArticulo({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params

  const prisma = prismaParaTenant(sesion.tenant.id)
  const articulo = await prisma.articulo.findUnique({ where: { id } })
  // RLS ya filtró por tenant, así que "no existe" y "es de otro negocio" son el
  // mismo 404 — y tienen que serlo: distinguirlos filtraría qué ids existen.
  if (!articulo) notFound()

  const movimientos = await prisma.movimientoStock.findMany({
    where: { articuloId: id },
    orderBy: { creadoEn: 'desc' },
    take: MOVIMIENTOS_VISIBLES,
    select: {
      id: true, delta: true, motivo: true, nota: true, creadoEn: true,
      usuario: { select: { nombre: true } },
      venta: { select: { numero: true } },
    },
  })

  const esDuenio = sesion.usuario.rol === 'DUENO'
  const esProducto = articulo.tipo === 'PRODUCTO'

  return (
    <main className="p-6">
      <Link href="/inventario" className="text-sm underline">
        ← Inventario
      </Link>

      <h1 className="mt-4 text-xl font-medium">{articulo.nombre}</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        {articulo.sku} · {esProducto ? 'Producto' : 'Servicio'} ·{' '}
        {formatearPrecio(articulo.precio.toString())}
      </p>

      {articulo.desactivadoEn && (
        <Alert className="mb-6 max-w-md">
          <AlertDescription>
            Este artículo está desactivado: no aparece en el listado ni se puede vender.
          </AlertDescription>
        </Alert>
      )}

      {esProducto && (
        <p className="mb-8 text-2xl tabular-nums">
          <span className={articulo.stock.lessThan(0) ? 'text-destructive' : undefined}>
            {formatearCantidad(articulo.stock.toString())}
          </span>{' '}
          <span className="text-sm text-muted-foreground">en stock</span>
        </p>
      )}

      {/* Mover stock va ARRIBA de editar: para un empleado es lo único que
          puede hacer en esta pantalla. */}
      {esProducto && !articulo.desactivadoEn && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-medium">Mover stock</h2>
          <MoverStock articuloId={articulo.id} />
        </section>
      )}

      {esDuenio && (
        <section className="mb-8">
          <FormularioDeEdicion
            articuloId={articulo.id}
            nombre={articulo.nombre}
            sku={articulo.sku}
            precio={articulo.precio.toString()}
          />
          <AccionesDeArticulo
            articuloId={articulo.id}
            desactivado={articulo.desactivadoEn !== null}
          />
        </section>
      )}

      {/* El bloque que responde "por qué tengo 3 y no 5", que es la pregunta
          que un dueño hace cuando el inventario no le cierra. Es para lo que la
          tabla es append-only. */}
      <section>
        <h2 className="mb-3 text-base font-medium">Historial</h2>
        {movimientos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hubo movimientos de este artículo.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Fecha</th>
                <th>Motivo</th>
                <th className="text-right">Cambio</th>
                <th>Quién</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="py-2">{FECHA.format(m.creadoEn)}</td>
                  <td>{NOMBRE_DE_MOTIVO[m.motivo] ?? m.motivo}</td>
                  <td
                    className={`text-right tabular-nums ${
                      m.delta.lessThan(0) ? 'text-destructive' : ''
                    }`}
                  >
                    {/* El signo explícito en el positivo: la columna se lee de
                        un vistazo como "entró" o "salió". */}
                    {m.delta.greaterThan(0) ? '+' : ''}
                    {formatearCantidad(m.delta.toString())}
                  </td>
                  <td>{m.usuario.nombre}</td>
                  <td className="text-muted-foreground">
                    {m.venta ? `Venta #${m.venta.numero}` : (m.nota ?? '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {movimientos.length === MOVIMIENTOS_VISIBLES && (
          <p className="mt-3 text-sm text-muted-foreground">
            Se muestran los últimos {MOVIMIENTOS_VISIBLES} movimientos.
          </p>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 5: Verificar el barrido con la ruta ya creada**

```bash
bash -c 'source scripts/lib/rutas-comun.sh && rutas_autenticadas "app/(app)"'
```
Expected: imprime las tres rutas sin parámetro y **sale 0**. Si sale 1 con "ruta con parámetro sin declarar", la entrada del Step 1 no coincide exactamente con `/inventario/[id]`.

- [ ] **Step 6: Verificar el guard, el typecheck y el lint**

```bash
npx vitest run test/rutas-con-guard.test.ts test/boundaries-app.test.ts test/use-server.test.ts
npx tsc --noEmit
npm run lint
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventario/" scripts/lib/rutas-comun.sh
git commit -m "feat(inventario): detalle del artículo con historial de movimientos"
```

---

### Task 8: Cierre — suite completa, documentación y verificación a ojo

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correr la suite entera**

Run: `npm test`
Expected: todo en verde. Es donde aparece si el schema nuevo rompió `rls-cobertura`, `schema`, el ERD o el sistema de diseño.

- [ ] **Step 2: Cerrar la decisión abierta del costo en `CLAUDE.md`**

En *Decisiones abiertas del modelo de datos*, reemplazar el primer bullet (el del costo del movimiento) por:

```markdown
- ~~**El costo del movimiento no se puede backfillear.**~~ **Cerrada**
  (2026-08-11, ciclo de inventario). `MovimientoStock.costoUnitario
  Decimal(12,2)?` existe y el ingreso de mercadería lo captura, opcional. Se
  cerró en el ciclo que construyó la pantalla que conoce ese número —el
  momento en que alguien tiene la factura del proveedor en la mano— y no
  después, que es lo que la volvía una puerta de una sola dirección. **Nadie
  la lee todavía**: no hay reportes de margen ni costo promedio, y eso sigue
  siendo su propio ciclo. Lo que cambió es que el dato dejó de tirarse.
```

En *Próximos pasos técnicos*, después del ítem del sistema de diseño, sumar:

```markdown
- ~~Construir la UI de inventario.~~ **Hecho** (2026-08-11). Listado con
  buscador y paginación, alta con SKU autogenerado y stock inicial que nace
  como movimiento, ingreso de mercadería con su costo, corrección por conteo
  —el delta lo calcula el servidor adentro de la transacción, contra el stock
  del momento— e historial por artículo. Baja lógica con `Articulo.desactivadoEn`.
  Ver `docs/superpowers/specs/2026-08-11-inventario-design.md`. **Queda para el
  ciclo siguiente**: la UI de ventas, y con ella la pantalla de clientes.
```

- [ ] **Step 3: Verificar a ojo, que es lo único que ningún test hace**

Con `arandano-dev` arriba y un tenant de prueba (`docs/runbook-stacks.md`, *Crear un tenant*), abrir `http://<subdominio>.dev.arandano.app:3000/inventario` y confirmar:

1. El listado vacío dice qué hacer, no queda en blanco.
2. Un alta sin código genera `A-0001`, y la siguiente `A-0002`.
3. Un precio escrito `85.000,50` queda guardado como 85000,50 — no como 85.
4. `850.000` da el error de ambigüedad y no crea nada.
5. Elegir "Servicio" oculta los campos de stock, y el servicio muestra `—` en la columna de stock del listado.
6. Un ingreso de 5 deja el stock en 5 y una fila en el historial con el signo `+`.
7. Un conteo de 3 sobre un stock de 5 deja `-2` en el historial y el stock en 3.
8. Un conteo que repite el stock actual **no** agrega ninguna fila.
9. Entrando como empleado: la nav no muestra "Usuarios", el botón "Artículo nuevo" no aparece, el bloque de edición tampoco, y los dos formularios de stock sí.
10. Un stock negativo (forzándolo con una venta desde `test/inventario.test.ts` o desde Prisma Studio) se ve en rojo.
11. **El botón se ve azul-violeta y no negro, y el foco del teclado se distingue.** Es la verificación que `docs/sistema-de-diseno.md` dejó anotada como pendiente de una persona al final del documento: ningún test puede juzgarla, y éste es el primer ciclo con pantallas suficientes para hacerla en serio.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: cerrar la decisión del costo del movimiento y anotar la UI de inventario"
```

---

## Lo que este plan no construye

Del spec, repetido acá para que no se lea como olvido:

- **La UI de ventas.** Es la pieza 5 y el ciclo siguiente.
- **Clientes.** No hay pantalla de clientes; la venta la va a necesitar y entra con ella.
- **Costo promedio, valorización del inventario y márgenes.** El costo se guarda; nada lo lee.
- **Alertas de stock mínimo, categorías o rubros, fotos, importación por CSV.**
- **Multi-sucursal.** Sigue rigiendo por omisión "un tenant por local"; `Articulo.stock` sigue siendo un escalar.
- **Reserva de stock.** Ya estaba fuera de alcance en el motor y sigue estándolo.
- **Tokens de color nuevos.** El ámbar de "stock bajo" que `docs/sistema-de-diseno.md` reserva entra con la feature de umbral que lo necesite, no antes.
