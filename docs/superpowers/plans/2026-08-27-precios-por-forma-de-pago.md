# Precios por forma de pago — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que cada artículo tenga un precio distinto según cómo se pague —crédito en cuotas, débito, efectivo, transferencia— sin duplicar un solo número en la base.

**Architecture:** `Articulo.precio` pasa a ser el precio de **lista** y cada local define una tabla de **planes de pago** (`nombre, medio, cuotas, recargoPorcentaje` con signo). El recargo se aplica **por pago**, sobre la parte de la venta que ese pago cubre: los ítems se siguen congelando al precio de lista y el recargo viaja en su propia columna de `Pago`, congelado. El invariante del motor sigue siendo el de hoy corrido un lugar — los pagos suman el total con **sus bases**, no con sus montos.

**Tech Stack:** Next.js 16 (App Router) + TypeScript, Prisma 7 sobre PostgreSQL con RLS, shadcn/ui sobre Tailwind v4, vitest, sonner para avisos.

**Spec:** `docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md`

## Global Constraints

- **Plata en `Decimal`, nunca `number` con decimales.** En el navegador, enteros (`lib/ventas/centavos.ts`): centavos para plata, milésimas para cantidades y para el porcentaje.
- **Redondeo `ROUND_HALF_UP`, por línea y por pago, antes de sumar.** El navegador y el servidor tienen que dar el mismo número; `lib/ventas/centavos.test.ts` los compara caso por caso.
- **Escalas exactas de las columnas**: dinero `Decimal(12,2)`, cantidad `Decimal(12,3)`, cotización `Decimal(12,4)`, porcentaje `Decimal(6,3)`.
- **Toda tabla con `tenant_id` lleva RLS** con la policy textual de siempre (USING + WITH CHECK contra `arandano.tenant_id`).
- **`PlanDePago` no entra a `MODELOS_CON_TENANT`** (`lib/tenant/prisma.ts`): el `tenantId` va explícito en cada `data`, igual que `Categoria` y `UsuarioPermiso`.
- **Expand/contract**: nada se borra ni se renombra en la base. `Articulo` no se toca.
- **Nombres y comentarios en español**, como todo el repo. Los comentarios explican **por qué**, no qué.
- **Un módulo `'use client'` no puede exportar algo que un Server Component invoque**, ni recibir una función como prop desde uno (`test/servidor-llama-a-cliente.test.ts`).
- **Commits frecuentes**, uno por task como mínimo, con el trailer de coautoría que usa el repo.
- Correr los tests con `npm test` (levanta el Postgres efímero y corre vitest). El typecheck es `npx tsc --noEmit`; el lint, `npm run lint`.

---

### Task 1: El modelo y las dos migraciones

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_planes_de_pago/migration.sql`
- Create: `prisma/migrations/<timestamp>_permiso_planes_pago/migration.sql`
- Modify: `docs/schema.md` (regenerado, no a mano)
- Test: `test/rls.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: el modelo `PlanDePago` (campos `id, tenantId, nombre, medio, cuotas, recargoPorcentaje, orden, desactivadoEn, creadoEn, actualizadoEn`), `Pago.planDePagoId`, `Pago.recargo`, `Venta.recargo`, y el valor `PLANES_PAGO` del enum `permiso`. Todo lo demás depende de estos nombres exactos.

- [ ] **Step 1: Escribir el caso de RLS que falla**

En `test/rls.test.ts`, después del bloque `describe('las categorías', …)`:

```ts
  describe('los planes de pago', () => {
    let planB: string

    beforeAll(async () => {
      const p = await owner.query(
        `INSERT INTO planes_de_pago
           (id, tenant_id, nombre, medio, cuotas, recargo_porcentaje, orden, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Crédito 6 cuotas', 'TARJETA_CREDITO', 6, 40.000, 0, now(), now())
         RETURNING id`,
        [tenantB],
      )
      planB = p.rows[0].id
    })

    it('planes_de_pago: el otro tenant no ve la fila, y su dueño sí', async () => {
      const { rows: deA } = await comoTenant(tenantA, 'SELECT 1 FROM planes_de_pago')
      expect(deA, 'planes_de_pago filtró filas de otro tenant').toHaveLength(0)

      const { rows: deB } = await comoTenant(tenantB, 'SELECT 1 FROM planes_de_pago')
      expect(deB, 'planes_de_pago no es legible por su propio tenant').toHaveLength(1)
    })

    it('planes_de_pago: rechaza insertar con el tenant_id de otro', async () => {
      await expect(
        comoTenant(
          tenantA,
          `INSERT INTO planes_de_pago
             (id, tenant_id, nombre, medio, cuotas, recargo_porcentaje, orden, creado_en, actualizado_en)
           VALUES (gen_random_uuid(), $1, 'Robado', 'TARJETA_CREDITO', 3, 10.000, 0, now(), now())`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
    })

    it('planes_de_pago: A no puede cambiarle el recargo (UPDATE) al plan de B', async () => {
      const { rowCount } = await comoTenant(
        tenantA,
        `UPDATE planes_de_pago SET recargo_porcentaje = 0 WHERE id = $1`,
        [planB],
      )
      expect(rowCount, 'el UPDATE de A afectó una fila que no es suya').toBe(0)

      const { rows } = await owner.query(
        'SELECT recargo_porcentaje FROM planes_de_pago WHERE id = $1',
        [planB],
      )
      expect(Number(rows[0].recargo_porcentaje)).toBe(40)
    })

    it('planes_de_pago: A no puede borrar (DELETE) el plan de B', async () => {
      const { rowCount } = await comoTenant(
        tenantA,
        `DELETE FROM planes_de_pago WHERE id = $1`,
        [planB],
      )
      expect(rowCount, 'el DELETE de A afectó una fila que no es suya').toBe(0)

      const { rows } = await owner.query('SELECT 1 FROM planes_de_pago WHERE id = $1', [planB])
      expect(rows, 'el plan de B desapareció').toHaveLength(1)
    })
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test -- rls`
Expected: FAIL con `relation "planes_de_pago" does not exist`.

- [ ] **Step 3: Escribir el modelo en el schema**

En `prisma/schema.prisma`, agregar el valor al enum:

```prisma
enum Permiso {
  ARTICULOS_CREAR
  ARTICULOS_EDITAR
  COSTOS
  CATEGORIAS
  VENTAS_ANULAR
  ORDENES_ANULAR
  // Editar la tabla de planes de pago del local. Es una palanca de UNA fila que
  // mueve el precio de todo el catálogo a la vez, así que no alcanza con
  // ARTICULOS_EDITAR: con aquél alguien se equivoca en un artículo, con éste en
  // los trescientos.
  PLANES_PAGO

  @@map("permiso")
}
```

El modelo nuevo, junto a `Categoria`:

```prisma
// Las formas de pago del local y cuánto recargan. `Articulo.precio` es el
// precio de LISTA y cada plan deriva el suyo: no hay un segundo precio guardado
// en ningún lado, que es lo que evita que los dos se desincronicen.
model PlanDePago {
  id       String    @id @default(uuid(7)) @db.Uuid
  tenantId String    @map("tenant_id") @db.Uuid
  nombre   String
  // A qué medio aplica. Es lo que hace que elegir "Crédito" en la fila de pago
  // ofrezca sólo los planes de crédito, y lo que le permite al servidor
  // rechazar un plan de tarjeta en un pago en efectivo.
  medio    MedioPago
  // Dato propio y no derivable del nombre: el mostrador necesita decir "6
  // cuotas de $X", y nadie va a parsear "Crédito 6 cuotas" para saberlo.
  cuotas   Int       @default(1)
  // CON SIGNO: +40.000 recarga, -10.000 descuenta (el descuento por efectivo es
  // tan común acá como el recargo por cuotas, y merece el mismo mecanismo y no
  // otro). Tres decimales porque los costos financieros vienen así (13.75 %);
  // (6,3) topea en 999.999, que ya no es un recargo sino un error de tipeo.
  recargoPorcentaje Decimal @map("recargo_porcentaje") @db.Decimal(6, 3)
  // El orden del mostrador, que decide el dueño. Sin esto se ordena por nombre
  // y "Crédito 12 cuotas" queda antes que "Crédito 3 cuotas".
  orden             Int       @default(0)
  // Baja lógica, como Articulo y User: un plan que ya cobró ventas es
  // indestructible por la FK Restrict de `pagos`, así que se desactiva.
  desactivadoEn     DateTime? @map("desactivado_en") @db.Timestamptz(3)
  creadoEn          DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn     DateTime  @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  pagos  Pago[]

  @@unique([tenantId, medio, nombre])
  @@index([tenantId, medio])
  @@map("planes_de_pago")
}
```

En `model Pago`, después de `cotizacion`:

```prisma
  // Con qué plan se cobró. NULL = a precio de lista, que es exactamente lo que
  // son todos los pagos que ya existen: esta columna no necesita backfill.
  planDePagoId String?     @map("plan_de_pago_id") @db.Uuid
  // Cuánto de este pago fue recargo — o descuento, en negativo. En PESOS
  // siempre, porque un pago en dólares no puede llevar plan (ver crear.ts).
  // CONGELADO, por lo mismo que VentaItem congela precio y descripción teniendo
  // articuloId: la venta de marzo tiene que seguir diciendo que se cobró 40 %
  // aunque el plan hoy esté en 45 % o esté dado de baja. La FK sirve para
  // navegar; este número es el que explica la plata.
  recargo      Decimal     @default(0) @db.Decimal(12, 2)
```

y en las relaciones de `Pago`:

```prisma
  // Restrict: un plan que ya cobró no se borra. Por eso el ABM da de baja.
  plan PlanDePago? @relation(fields: [planDePagoId], references: [id], onDelete: Restrict)
```

En `model Venta`, después de `total`:

```prisma
  // La suma de los recargos de sus pagos. Es un CACHÉ, con el mismo criterio y
  // el mismo precedente que Articulo.stock respecto de sus movimientos: existe
  // para que el listado de /ventas no tenga que sumar los pagos de cada fila.
  // `total` NO cambia de significado: sigue siendo la mercadería a precio de
  // lista, así que ninguna venta ya cobrada queda diciendo otra cosa.
  recargo Decimal @default(0) @db.Decimal(12, 2)
```

Y en `model Tenant`, sumar a las relaciones: `planesDePago  PlanDePago[]`.

- [ ] **Step 4: Generar la primera migración SIN aplicarla**

```bash
set -a; . .env.local; set +a
npx prisma migrate dev --create-only --name planes_de_pago
```

`--create-only` no es opcional: sin él Prisma aplica la migración antes de que se pueda editar el SQL, y salir de ahí exige un `migrate reset`, prohibido contra cualquier base que importe.

**Sacar de esta migración el `ALTER TYPE "permiso" ADD VALUE`** si Prisma lo incluyó: va en la migración del Step 6, sola.

Revisar que el SQL **no traiga ningún `DROP`**. Si lo trae, el schema quedó desalineado con las migraciones previas y hay que resolver eso antes de seguir.

- [ ] **Step 5: Editar el SQL a mano para sumar la RLS**

Agregar al final de `prisma/migrations/<timestamp>_planes_de_pago/migration.sql`:

```sql
-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "planes_de_pago" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "planes_de_pago" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 6: Generar la segunda migración, sólo con el valor del enum**

```bash
npx prisma migrate dev --create-only --name permiso_planes_pago
```

El SQL tiene que quedar en una sola línea:

```sql
ALTER TYPE "permiso" ADD VALUE 'PLANES_PAGO';
```

**Va sola y no se usa en esa misma migración.** Postgres deja agregar un valor a un enum dentro de una transacción —que es como corre `prisma migrate deploy`— pero **no** usarlo ahí mismo. Como esta migración no inserta ninguna fila con ese permiso, no hay problema. Precedente: `20260822204141_estado_aprobado`.

- [ ] **Step 7: Aplicar las dos migraciones y regenerar el ERD**

```bash
npx prisma migrate dev
scripts/generar-erd.sh
```

- [ ] **Step 8: Correr los tests y verificar que pasan**

Run: `npm test -- rls`
Expected: PASS, incluidos los cuatro casos nuevos y `test/rls-cobertura.test.ts` (que deriva de la base y toma la tabla nueva sin tocar nada).

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md test/rls.test.ts
git commit -m "feat(precios): la tabla de planes de pago, con su RLS"
```

---

### Task 2: La aritmética del recargo, en las dos puntas

**Files:**
- Modify: `lib/ventas/totales.ts`
- Modify: `lib/ventas/centavos.ts`
- Test: `lib/ventas/totales.test.ts`, `lib/ventas/centavos.test.ts`

**Interfaces:**
- Consumes: `redondearDinero`, `ESCALA_DINERO` (ya existen en `totales.ts`).
- Produces:
  - `recargoDePago(baseEnPesos: Decimal, porcentaje: Decimal): Decimal` — servidor.
  - `ESCALA_PORCENTAJE = 3` — servidor.
  - `recargoEnCentavos(baseEnPesosCentavos: number, porcentajeMilesimas: number): number` — navegador.
  - `porcentajeEnMilesimas(texto: string): number` — navegador, NaN si no se entiende.

- [ ] **Step 1: Escribir los tests que fallan**

En `lib/ventas/totales.test.ts`:

```ts
import { recargoDePago } from './totales'

describe('recargoDePago', () => {
  it('un recargo del 25 % sobre 100.000 son 25.000', () => {
    expect(recargoDePago(d('100000'), d('25')).toString()).toBe('25000')
  })

  it('un descuento del 10 % es negativo', () => {
    expect(recargoDePago(d('10000'), d('-10')).toString()).toBe('-1000')
  })

  it('un porcentaje en cero no recarga', () => {
    expect(recargoDePago(d('9999.99'), d('0')).toString()).toBe('0')
  })

  // ROUND_HALF_UP: 0.005 va para arriba, y para un negativo "arriba" es
  // alejarse del cero. Es lo que hace el resto del motor y lo que la gente
  // espera cuando mira el vuelto.
  it('redondea la mitad alejándose del cero, en los dos signos', () => {
    expect(recargoDePago(d('1'), d('50')).toString()).toBe('0.01')
    expect(recargoDePago(d('1'), d('-50')).toString()).toBe('-0.01')
  })

  it('respeta los tres decimales del porcentaje', () => {
    expect(recargoDePago(d('10000'), d('13.75')).toString()).toBe('1375')
  })
})
```

En `lib/ventas/centavos.test.ts`, sumando al bloque que ya compara las dos aritméticas:

```ts
import { Prisma } from '@/generated/prisma/client'
import { recargoDePago } from './totales'
import { recargoEnCentavos, porcentajeEnMilesimas, aCentavos } from './centavos'

describe('el recargo del navegador espeja al del servidor', () => {
  const CASOS: { base: string; porcentaje: string }[] = [
    { base: '100000', porcentaje: '25' },
    { base: '10000', porcentaje: '-10' },
    { base: '9999.99', porcentaje: '0' },
    { base: '1', porcentaje: '50' },
    // El caso que separa Math.round() del ROUND_HALF_UP de Decimal: para un
    // negativo, Math.round(-0.5) da -0 (redondea hacia +∞) y el servidor da -1.
    { base: '1', porcentaje: '-50' },
    { base: '10000', porcentaje: '13.75' },
    { base: '333.33', porcentaje: '40' },
    { base: '0.01', porcentaje: '999.999' },
  ]

  for (const c of CASOS) {
    it(`base ${c.base} al ${c.porcentaje} %`, () => {
      const servidor = recargoDePago(new Prisma.Decimal(c.base), new Prisma.Decimal(c.porcentaje))
      const navegador = recargoEnCentavos(aCentavos(c.base), porcentajeEnMilesimas(c.porcentaje))
      expect(navegador, `${c.base} al ${c.porcentaje} %`).toBe(aCentavos(servidor.toString()))
    })
  }

  it('un porcentaje que no se entiende da NaN, no cero', () => {
    expect(porcentajeEnMilesimas('')).toBeNaN()
    expect(porcentajeEnMilesimas('cuarenta')).toBeNaN()
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- totales centavos`
Expected: FAIL con `recargoDePago is not a function` / `recargoEnCentavos is not a function`.

- [ ] **Step 3: Implementar el lado del servidor**

En `lib/ventas/totales.ts`, junto a las otras escalas:

```ts
/** El porcentaje de un plan de pago: `Decimal(6, 3)`. */
export const ESCALA_PORCENTAJE = 3
```

y al final del archivo:

```ts
/**
 * Lo que un plan le suma (o le resta) a la parte de la venta que ese pago cubre.
 *
 * Con signo: un plan de -10 % devuelve un negativo, y el llamador lo suma igual.
 *
 * Redondea ACÁ, por pago, antes de que nadie sume — misma regla y mismo motivo
 * que `subtotalItem`: el total del navegador y el del servidor se comparan por
 * igualdad, así que los dos tienen que redondear en el mismo momento.
 */
export function recargoDePago(baseEnPesos: Decimal, porcentaje: Decimal): Decimal {
  return redondearDinero(baseEnPesos.mul(porcentaje).div(100))
}
```

- [ ] **Step 4: Implementar el lado del navegador**

En `lib/ventas/centavos.ts`:

```ts
const DECIMALES_PORCENTAJE = 3

/** Un porcentaje (`"13.75"`, `"-10"`) a milésimas. NaN si no se entiende. */
export function porcentajeEnMilesimas(texto: string): number {
  return tipeadoEnEscala(texto, (canonico) => aEntero(canonico, DECIMALES_PORCENTAJE))
}

/**
 * `Math.round` NO alcanza acá, y es la única función de este archivo donde no
 * alcanza: para positivos es ROUND_HALF_UP, pero para negativos redondea hacia
 * +∞ (`Math.round(-0.5)` da -0) mientras que el `ROUND_HALF_UP` de Decimal se
 * aleja del cero (-1). Los descuentos son negativos, así que ese medio centavo
 * separaría al navegador del servidor y dejaría el botón "Cobrar" habilitado
 * para una venta que el motor rechaza.
 */
function redondearMitadLejosDelCero(v: number): number {
  return v < 0 ? -Math.round(-v) : Math.round(v)
}

/**
 * El recargo de un pago, en centavos. Espeja a `recargoDePago` de totales.ts.
 *
 * centavos × milésimas de porcentaje son 10^-5 de un porcentaje; dividir por
 * 100.000 los deja en centavos.
 */
export function recargoEnCentavos(
  baseEnPesosCentavos: number,
  porcentajeMilesimas: number,
): number {
  return redondearMitadLejosDelCero((baseEnPesosCentavos * porcentajeMilesimas) / 100000)
}
```

`aEntero` ya existe en el archivo y hoy es privada: exportarla no hace falta, `porcentajeEnMilesimas` vive en el mismo módulo.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test -- totales centavos`
Expected: PASS, los ocho casos del espejo incluidos.

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/totales.ts lib/ventas/centavos.ts lib/ventas/totales.test.ts lib/ventas/centavos.test.ts
git commit -m "feat(precios): el recargo, con el navegador y el servidor dando el mismo número"
```

---

### Task 3: Leer y administrar los planes

**Files:**
- Create: `lib/planes/errores.ts`
- Create: `lib/planes/consultar.ts`
- Create: `lib/planes/administrar.ts`
- Create: `lib/planes/precio.ts`
- Test: `lib/planes/administrar.test.ts`, `lib/planes/precio.test.ts`

**Interfaces:**
- Consumes: `prismaParaTenant` (`lib/tenant/prisma.ts`), `recargoDePago` y `ESCALA_PORCENTAJE` (Task 2), `excedeEscala` (`lib/ventas/totales.ts`).
- Produces:
  - `ErrorDePlan` con `codigo: CodigoErrorDePlan`.
  - `PlanVisible = { id, nombre, medio, cuotas, porcentaje: string, orden, desactivadoEn }`.
  - `planesDelTenant(tenantId: string, opciones?: { incluirDesactivados?: boolean }): Promise<PlanVisible[]>`.
  - `crearPlan(e: EntradaDePlan): Promise<{ id: string }>`, `editarPlan(e: EdicionDePlan): Promise<void>`, `desactivarPlan({ tenantId, id }): Promise<void>`, `reactivarPlan({ tenantId, id }): Promise<void>`.
  - `precioConPlan(precio: Decimal, porcentaje: Decimal): Decimal`.

- [ ] **Step 1: Escribir los tests que fallan**

`lib/planes/precio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Prisma } from '@/generated/prisma/client'
import { precioConPlan } from './precio'
import { recargoDePago } from '@/lib/ventas/totales'

const d = (v: string) => new Prisma.Decimal(v)

describe('precioConPlan', () => {
  it('un artículo de 10.000 al 40 % se cobra 14.000', () => {
    expect(precioConPlan(d('10000'), d('40')).toString()).toBe('14000')
  })

  it('con un descuento del 10 % se cobra menos', () => {
    expect(precioConPlan(d('10000'), d('-10')).toString()).toBe('9000')
  })

  // Que sea LA MISMA cuenta que hace el motor no es cosmético: si la ficha del
  // artículo dijera un peso más que lo que después cobra el mostrador, el dato
  // que el cliente pidió ver sería justamente el que no sirve.
  it('es exactamente precio + recargoDePago(precio)', () => {
    for (const [precio, pct] of [['12345.67', '13.75'], ['0.01', '999.999'], ['999.99', '-33.333']]) {
      expect(precioConPlan(d(precio), d(pct)).toString()).toBe(
        d(precio).add(recargoDePago(d(precio), d(pct))).toString(),
      )
    }
  })
})
```

`lib/planes/administrar.test.ts` (contra el Postgres efímero, con el mismo arranque que `lib/permisos/administrar.test.ts` — copiar de ahí el `beforeAll` que crea tenant y usuario):

```ts
describe('crearPlan', () => {
  it('crea el plan y lo devuelve en planesDelTenant', async () => {
    await crearPlan({
      tenantId, nombre: 'Crédito 6 cuotas', medio: 'TARJETA_CREDITO',
      cuotas: 6, recargoPorcentaje: new Prisma.Decimal('40'),
    })
    const planes = await planesDelTenant(tenantId)
    expect(planes.map((p) => p.nombre)).toContain('Crédito 6 cuotas')
    expect(planes[0].porcentaje).toBe('40')
  })

  it('rechaza un porcentaje de -100 o menos: el pago quedaría en cero o negativo', async () => {
    await expect(
      crearPlan({ tenantId, nombre: 'Regalado', medio: 'EFECTIVO', cuotas: 1,
                  recargoPorcentaje: new Prisma.Decimal('-100') }),
    ).rejects.toMatchObject({ codigo: 'PORCENTAJE_INVALIDO' })
  })

  it('rechaza un porcentaje con más de tres decimales', async () => {
    await expect(
      crearPlan({ tenantId, nombre: 'Fino', medio: 'EFECTIVO', cuotas: 1,
                  recargoPorcentaje: new Prisma.Decimal('10.0001') }),
    ).rejects.toMatchObject({ codigo: 'PORCENTAJE_INVALIDO' })
  })

  it('rechaza cuotas menores a 1', async () => {
    await expect(
      crearPlan({ tenantId, nombre: 'Cero', medio: 'TARJETA_CREDITO', cuotas: 0,
                  recargoPorcentaje: new Prisma.Decimal('10') }),
    ).rejects.toMatchObject({ codigo: 'CUOTAS_INVALIDAS' })
  })

  it('rechaza un nombre repetido para el mismo medio', async () => {
    const entrada = { tenantId, nombre: 'Crédito 3 cuotas', medio: 'TARJETA_CREDITO' as const,
                      cuotas: 3, recargoPorcentaje: new Prisma.Decimal('25') }
    await crearPlan(entrada)
    await expect(crearPlan(entrada)).rejects.toMatchObject({ codigo: 'NOMBRE_REPETIDO' })
  })

  it('el mismo nombre en OTRO medio sí se puede', async () => {
    await crearPlan({ tenantId, nombre: 'Contado', medio: 'EFECTIVO', cuotas: 1,
                      recargoPorcentaje: new Prisma.Decimal('-10') })
    await expect(
      crearPlan({ tenantId, nombre: 'Contado', medio: 'TRANSFERENCIA', cuotas: 1,
                  recargoPorcentaje: new Prisma.Decimal('-5') }),
    ).resolves.toBeDefined()
  })
})

describe('desactivarPlan', () => {
  it('lo saca de la lista y lo devuelve con incluirDesactivados', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Viejo', medio: 'EFECTIVO', cuotas: 1,
                                     recargoPorcentaje: new Prisma.Decimal('5') })
    await desactivarPlan({ tenantId, id })
    expect((await planesDelTenant(tenantId)).map((p) => p.id)).not.toContain(id)
    expect(
      (await planesDelTenant(tenantId, { incluirDesactivados: true })).map((p) => p.id),
    ).toContain(id)
  })

  // Idempotente por lo mismo que `otorgar`/`revocar`: la pantalla lo dispara
  // desde un menú y dos clicks rápidos mandan la orden dos veces.
  it('desactivar dos veces no falla', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Dos veces', medio: 'EFECTIVO', cuotas: 1,
                                     recargoPorcentaje: new Prisma.Decimal('5') })
    await desactivarPlan({ tenantId, id })
    await expect(desactivarPlan({ tenantId, id })).resolves.toBeUndefined()
  })
})

describe('editarPlan', () => {
  it('cambia el porcentaje sin tocar las ventas ya cobradas', async () => {
    const { id } = await crearPlan({ tenantId, nombre: 'Editable', medio: 'TARJETA_CREDITO',
                                     cuotas: 3, recargoPorcentaje: new Prisma.Decimal('25') })
    await editarPlan({ tenantId, id, nombre: 'Editable', cuotas: 3,
                       recargoPorcentaje: new Prisma.Decimal('30'), orden: 1 })
    const plan = (await planesDelTenant(tenantId)).find((p) => p.id === id)
    expect(plan?.porcentaje).toBe('30')
  })

  it('sobre un plan de otro tenant no encuentra nada', async () => {
    await expect(
      editarPlan({ tenantId: otroTenantId, id: planDelPrimero, nombre: 'X', cuotas: 1,
                   recargoPorcentaje: new Prisma.Decimal('1'), orden: 0 }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- planes`
Expected: FAIL con `Cannot find module '@/lib/planes/administrar'`.

- [ ] **Step 3: Implementar los cuatro archivos**

`lib/planes/errores.ts`:

```ts
export type CodigoErrorDePlan =
  | 'NOMBRE_VACIO'
  | 'NOMBRE_REPETIDO'
  | 'PORCENTAJE_INVALIDO'
  | 'CUOTAS_INVALIDAS'
  | 'MEDIO_INVALIDO'
  | 'PLAN_INEXISTENTE'

/** Con código y no sólo con mensaje, por lo mismo que `ErrorDeVenta`: la
 *  pantalla tiene que poder distinguir "ese nombre ya está" de "ese porcentaje
 *  no se puede", y parsear el texto es la forma de que eso se rompa la primera
 *  vez que alguien mejore la redacción. */
export class ErrorDePlan extends Error {
  constructor(
    readonly codigo: CodigoErrorDePlan,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDePlan'
  }
}
```

`lib/planes/precio.ts`:

```ts
import type { Prisma } from '@/generated/prisma/client'
import { recargoDePago } from '@/lib/ventas/totales'

type Decimal = Prisma.Decimal

/**
 * Lo que cuesta un artículo pagado con este plan.
 *
 * Se define COMO la suma del recargo y no con una fórmula propia
 * (`precio × (100 + pct) / 100`) a propósito: las dos dan lo mismo hoy, pero
 * dos fórmulas que tienen que coincidir para siempre es exactamente lo que se
 * separa en el primer cambio de redondeo. La ficha del artículo tiene que
 * decir el mismo número que después cobra el mostrador.
 */
export function precioConPlan(precio: Decimal, porcentaje: Decimal): Decimal {
  return precio.add(recargoDePago(precio, porcentaje))
}
```

`lib/planes/consultar.ts`:

```ts
import type { MedioPago } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'

/**
 * Un plan tal como lo miran las pantallas.
 *
 * `porcentaje` es `string` y no `Decimal` por lo mismo que `ArticuloVendible.precio`
 * (`lib/ventas/buscar.ts`): esto cruza a un componente cliente, y el `Decimal`
 * de Prisma no puede viajar sin arrastrar el cliente de Prisma al bundle.
 */
export type PlanVisible = {
  id: string
  nombre: string
  medio: MedioPago
  cuotas: number
  porcentaje: string
  orden: number
  desactivadoEn: Date | null
}

export async function planesDelTenant(
  tenantId: string,
  opciones: { incluirDesactivados?: boolean } = {},
): Promise<PlanVisible[]> {
  const filas = await prismaParaTenant(tenantId).planDePago.findMany({
    where: opciones.incluirDesactivados ? {} : { desactivadoEn: null },
    // Por medio primero: el mostrador ofrece los planes de UN medio por vez, y
    // el `orden` que fija el dueño manda adentro de cada uno. El nombre
    // desempata para que el listado no baile entre dos cargas.
    orderBy: [{ medio: 'asc' }, { orden: 'asc' }, { nombre: 'asc' }],
  })
  return filas.map((f) => ({
    id: f.id,
    nombre: f.nombre,
    medio: f.medio,
    cuotas: f.cuotas,
    porcentaje: f.recargoPorcentaje.toString(),
    orden: f.orden,
    desactivadoEn: f.desactivadoEn,
  }))
}
```

`lib/planes/administrar.ts`:

```ts
import { Prisma } from '@/generated/prisma/client'
import type { MedioPago } from '@/generated/prisma/client'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { excedeEscala, ESCALA_PORCENTAJE } from '@/lib/ventas/totales'
import { ErrorDePlan } from './errores'

/** Exclusivo: en -100 % el pago queda en cero, y por debajo el local pagaría
 *  por vender. Se valida acá, al guardar, y no al cobrar: es donde la persona
 *  tiene el número delante y lo puede corregir. */
const PORCENTAJE_MINIMO = new Prisma.Decimal('-100')
/** Lo que entra en Decimal(6,3). Más que eso no es un recargo, es un typo. */
const PORCENTAJE_MAXIMO = new Prisma.Decimal('999.999')
/** Doce cuotas es lo habitual; 120 es holgura, no un límite pensado. */
const CUOTAS_MAXIMAS = 120

export type EntradaDePlan = {
  tenantId: string
  nombre: string
  medio: MedioPago
  cuotas: number
  recargoPorcentaje: Prisma.Decimal
  orden?: number
}

export type EdicionDePlan = Omit<EntradaDePlan, 'medio'> & { id: string; orden: number }

function validar(e: { nombre: string; cuotas: number; recargoPorcentaje: Prisma.Decimal }) {
  if (e.nombre.trim() === '') {
    throw new ErrorDePlan('NOMBRE_VACIO', 'El plan necesita un nombre.')
  }
  if (!Number.isInteger(e.cuotas) || e.cuotas < 1 || e.cuotas > CUOTAS_MAXIMAS) {
    throw new ErrorDePlan('CUOTAS_INVALIDAS', 'Las cuotas van de 1 a 120.')
  }
  if (
    e.recargoPorcentaje.lessThanOrEqualTo(PORCENTAJE_MINIMO) ||
    e.recargoPorcentaje.greaterThan(PORCENTAJE_MAXIMO)
  ) {
    throw new ErrorDePlan(
      'PORCENTAJE_INVALIDO',
      'El recargo va de -99,999 % a 999,999 %.',
    )
  }
  if (excedeEscala(e.recargoPorcentaje, ESCALA_PORCENTAJE)) {
    throw new ErrorDePlan(
      'PORCENTAJE_INVALIDO',
      'El recargo tiene a lo sumo tres decimales.',
    )
  }
}

/** P2002 = violación de unicidad. Acá sólo puede ser (tenant_id, medio, nombre):
 *  es la única de esta tabla, así que no hace falta mirar qué constraint fue —
 *  y bajo `arandano_app` ese detalle no está disponible de todos modos (ver
 *  `esP2002` en lib/ventas/crear.ts). */
function esRepetido(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

export async function crearPlan(e: EntradaDePlan): Promise<{ id: string }> {
  validar(e)
  try {
    const creado = await prismaParaTenant(e.tenantId).planDePago.create({
      // tenantId explícito: PlanDePago no está en MODELOS_CON_TENANT
      // (lib/tenant/prisma.ts), así que la extensión no lo autocompleta.
      data: {
        tenantId: e.tenantId,
        nombre: e.nombre.trim(),
        medio: e.medio,
        cuotas: e.cuotas,
        recargoPorcentaje: e.recargoPorcentaje,
        orden: e.orden ?? 0,
      },
      select: { id: true },
    })
    return creado
  } catch (err) {
    if (esRepetido(err)) {
      throw new ErrorDePlan('NOMBRE_REPETIDO', `Ya hay un plan que se llama "${e.nombre.trim()}".`)
    }
    throw err
  }
}

export async function editarPlan(e: EdicionDePlan): Promise<void> {
  validar(e)
  try {
    // updateMany y no update: `update` tira P2025 sobre una fila que no existe,
    // pero también sobre una que existe y RLS no deja ver — y ésas son la misma
    // situación para el llamador. `count` cero las cubre a las dos con un solo
    // error propio.
    const { count } = await prismaParaTenant(e.tenantId).planDePago.updateMany({
      where: { id: e.id },
      data: {
        nombre: e.nombre.trim(),
        cuotas: e.cuotas,
        recargoPorcentaje: e.recargoPorcentaje,
        orden: e.orden,
      },
    })
    if (count === 0) throw new ErrorDePlan('PLAN_INEXISTENTE', 'Ese plan no está en este local.')
  } catch (err) {
    if (esRepetido(err)) {
      throw new ErrorDePlan('NOMBRE_REPETIDO', `Ya hay un plan que se llama "${e.nombre.trim()}".`)
    }
    throw err
  }
}

/** Idempotente: `updateMany` sobre cero filas no se queja, y dos clicks
 *  seguidos en el menú mandan la orden dos veces. */
export async function desactivarPlan({ tenantId, id }: { tenantId: string; id: string }): Promise<void> {
  await prismaParaTenant(tenantId).planDePago.updateMany({
    where: { id, desactivadoEn: null },
    data: { desactivadoEn: new Date() },
  })
}

export async function reactivarPlan({ tenantId, id }: { tenantId: string; id: string }): Promise<void> {
  await prismaParaTenant(tenantId).planDePago.updateMany({
    where: { id, desactivadoEn: { not: null } },
    data: { desactivadoEn: null },
  })
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- planes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/planes lib/planes/*.test.ts
git commit -m "feat(precios): leer y administrar los planes de pago del local"
```

---

### Task 4: El motor cobra con recargo

**Files:**
- Modify: `lib/ventas/crear.ts`
- Modify: `lib/ventas/errores.ts`
- Modify: `app/(app)/vender/acciones.ts`
- Modify: `app/(app)/vender/punto-de-venta.tsx` (sólo el renombre `monto` → `base` del estado y del JSON; el selector de plan es la Task 6)
- Test: `test/ventas.test.ts`, `app/(app)/vender/acciones.test.ts`

**Interfaces:**
- Consumes: `recargoDePago` (Task 2), el modelo `PlanDePago` (Task 1).
- Produces: `PagoDeVenta = { medio, moneda, base: Decimal, cotizacion: Decimal, planId?: string }` — la forma que `cobrar` arma y que la Task 6 va a completar con el plan elegido.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/ventas.test.ts` (usar el `beforeAll` que el archivo ya tiene para tenant, usuario y artículo):

```ts
describe('cobrar con un plan de pago', () => {
  it('un plan del 25 % cobra 25 % más, y la venta guarda el recargo', async () => {
    const plan = await crearPlan({
      tenantId, nombre: 'Crédito 3 cuotas', medio: 'TARJETA_CREDITO',
      cuotas: 3, recargoPorcentaje: new Prisma.Decimal('25'),
    })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId, cantidad: d('1') }],           // artículo de 10.000
      pagos: [{ medio: 'TARJETA_CREDITO', moneda: 'ARS', base: d('10000'),
                cotizacion: d('1'), planId: plan.id }],
    })

    const venta = await comoOwner.venta.findUniqueOrThrow({
      where: { id }, include: { pagos: true },
    })
    // La mercadería NO cambia: el margen del artículo se sigue midiendo contra
    // el precio de lista.
    expect(venta.total.toString()).toBe('10000')
    expect(venta.recargo.toString()).toBe('2500')
    expect(venta.pagos[0].monto.toString()).toBe('12500')
    expect(venta.pagos[0].recargo.toString()).toBe('2500')
    expect(venta.pagos[0].planDePagoId).toBe(plan.id)
  })

  it('un plan con porcentaje negativo descuenta', async () => {
    const plan = await crearPlan({
      tenantId, nombre: 'Contado', medio: 'EFECTIVO', cuotas: 1,
      recargoPorcentaje: new Prisma.Decimal('-10'),
    })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'),
                cotizacion: d('1'), planId: plan.id }],
    })
    const venta = await comoOwner.venta.findUniqueOrThrow({ where: { id }, include: { pagos: true } })
    expect(venta.recargo.toString()).toBe('-1000')
    expect(venta.pagos[0].monto.toString()).toBe('9000')
  })

  it('pago partido: el recargo cae SÓLO sobre la parte financiada', async () => {
    const plan = await crearPlan({
      tenantId, nombre: 'Crédito 6 cuotas', medio: 'TARJETA_CREDITO',
      cuotas: 6, recargoPorcentaje: new Prisma.Decimal('40'),
    })
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId, cantidad: d('1') }],           // 10.000 de mercadería
      pagos: [
        { medio: 'EFECTIVO', moneda: 'ARS', base: d('4000'), cotizacion: d('1') },
        { medio: 'TARJETA_CREDITO', moneda: 'ARS', base: d('6000'),
          cotizacion: d('1'), planId: plan.id },
      ],
    })
    const venta = await comoOwner.venta.findUniqueOrThrow({ where: { id }, include: { pagos: true } })
    expect(venta.total.toString()).toBe('10000')
    // 40 % de 6.000, no de 10.000: los 4.000 en efectivo no pagan el costo de
    // la tarjeta.
    expect(venta.recargo.toString()).toBe('2400')
    const enEfectivo = venta.pagos.find((p) => p.medio === 'EFECTIVO')!
    expect(enEfectivo.monto.toString()).toBe('4000')
    expect(enEfectivo.recargo.toString()).toBe('0')
  })

  it('sin plan, todo sigue exactamente como antes', async () => {
    const { id } = await crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'), cotizacion: d('1') }],
    })
    const venta = await comoOwner.venta.findUniqueOrThrow({ where: { id }, include: { pagos: true } })
    expect(venta.recargo.toString()).toBe('0')
    expect(venta.pagos[0].planDePagoId).toBeNull()
  })

  it('rechaza un plan que no existe', async () => {
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [{ articuloId, cantidad: d('1') }],
        pagos: [{ medio: 'TARJETA_CREDITO', moneda: 'ARS', base: d('10000'),
                  cotizacion: d('1'), planId: '00000000-0000-7000-8000-000000000000' }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })

  it('rechaza un plan desactivado', async () => {
    const plan = await crearPlan({ tenantId, nombre: 'Viejo', medio: 'TARJETA_CREDITO',
                                   cuotas: 3, recargoPorcentaje: new Prisma.Decimal('20') })
    await desactivarPlan({ tenantId, id: plan.id })
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [{ articuloId, cantidad: d('1') }],
        pagos: [{ medio: 'TARJETA_CREDITO', moneda: 'ARS', base: d('10000'),
                  cotizacion: d('1'), planId: plan.id }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })

  it('rechaza un plan de OTRO tenant', async () => {
    const ajeno = await crearPlan({ tenantId: otroTenantId, nombre: 'Ajeno',
                                    medio: 'TARJETA_CREDITO', cuotas: 3,
                                    recargoPorcentaje: new Prisma.Decimal('20') })
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [{ articuloId, cantidad: d('1') }],
        pagos: [{ medio: 'TARJETA_CREDITO', moneda: 'ARS', base: d('10000'),
                  cotizacion: d('1'), planId: ajeno.id }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_INEXISTENTE' })
  })

  it('rechaza un plan de crédito en un pago en efectivo', async () => {
    const plan = await crearPlan({ tenantId, nombre: 'Crédito 12 cuotas',
                                   medio: 'TARJETA_CREDITO', cuotas: 12,
                                   recargoPorcentaje: new Prisma.Decimal('60') })
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [{ articuloId, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'),
                  cotizacion: d('1'), planId: plan.id }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_NO_CORRESPONDE' })
  })

  it('rechaza un plan en un pago en dólares', async () => {
    const plan = await crearPlan({ tenantId, nombre: 'Contado dólar', medio: 'EFECTIVO',
                                   cuotas: 1, recargoPorcentaje: new Prisma.Decimal('-10') })
    await expect(
      crearVenta({
        tenantId, usuarioId,
        items: [{ articuloId, cantidad: d('1') }],
        pagos: [{ medio: 'EFECTIVO', moneda: 'USD', base: d('10'),
                  cotizacion: d('1000'), planId: plan.id }],
      }),
    ).rejects.toMatchObject({ codigo: 'PLAN_EN_DOLARES' })
  })
})
```

En `app/(app)/vender/acciones.test.ts`, cambiar el helper `formulario` para que los pagos manden `base` en vez de `monto`, y sumar:

```ts
it('un planId que no es uuid se rechaza como error de dominio, no como 500', async () => {
  const datos = formulario({
    pagos: [{ medio: 'TARJETA_CREDITO', moneda: 'ARS', base: precioArticulo,
              cotizacion: '1', planId: 'no-es-uuid' }],
  })
  const estado = await cobrar(INICIAL, datos)
  expect(estado.error).toMatch(/plan/i)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- ventas acciones`
Expected: FAIL — `base` no existe en `PagoDeVenta` y los códigos nuevos no están en `CodigoErrorDeVenta`.

- [ ] **Step 3: Sumar los tres códigos de error**

En `lib/ventas/errores.ts`, dentro de `CodigoErrorDeVenta`:

```ts
  // Los tres del plan de pago. Separados a propósito, por lo mismo que
  // ARTICULO_DESACTIVADO está separado de ARTICULO_INEXISTENTE: para el que
  // está cobrando son tres situaciones con salidas distintas — buscar otro
  // plan, cambiar el medio, o cobrar los dólares sin plan.
  | 'PLAN_INEXISTENTE'
  | 'PLAN_NO_CORRESPONDE'
  | 'PLAN_EN_DOLARES'
```

- [ ] **Step 4: Cambiar el motor**

En `lib/ventas/crear.ts`, el tipo del pago:

```ts
export type PagoDeVenta = {
  medio: MedioPago
  moneda: Moneda
  /**
   * Lo que este pago cubre de la venta, A PRECIO DE LISTA y en la moneda del
   * pago. NO es lo que entra a la caja: eso es `base + recargo`, y lo calcula
   * el servidor. Que el llamador mande la base y no el monto es lo que hace
   * que el invariante de abajo siga siendo el de siempre —los pagos suman el
   * total— y lo que impide que el navegador decida cuánta plata entró.
   */
  base: Prisma.Decimal
  cotizacion: Prisma.Decimal
  /** El plan con el que se cobra esta parte. Sin plan, precio de lista. */
  planId?: string
}
```

Las validaciones de `monto` pasan a `base` (mismos códigos `MONTO_INVALIDO` y `ESCALA_EXCEDIDA`, mismos mensajes).

Adentro de la transacción, después de `exigirUsuario` y antes de leer los artículos:

```ts
      // Los planes, de una sola consulta y adentro de la transacción del
      // tenant: RLS ya filtra por tenant, así que el plan de otro local
      // simplemente no aparece y cae en PLAN_INEXISTENTE, igual que uno
      // inventado. Son la misma situación para quien está cobrando.
      const idsDePlan = [...new Set(pagos.flatMap((p) => (p.planId ? [p.planId] : [])))]
      const planes = idsDePlan.length
        ? await tx.planDePago.findMany({ where: { id: { in: idsDePlan } } })
        : []
      const planPorId = new Map(planes.map((p) => [p.id, p]))

      const pagosConRecargo = pagos.map((p) => {
        if (p.planId === undefined) {
          return { ...p, recargo: new Prisma.Decimal(0), monto: p.base }
        }
        const plan = planPorId.get(p.planId)
        // Desactivado se trata como inexistente A PROPÓSITO, al revés que con
        // los artículos: un plan dado de baja no se reactiva para cobrar una
        // venta, se elige otro. La distinción no le cambiaría la salida a nadie.
        if (!plan || plan.desactivadoEn) {
          throw new ErrorDeVenta('PLAN_INEXISTENTE', `el plan ${p.planId} no está disponible`)
        }
        if (plan.medio !== p.medio) {
          throw new ErrorDeVenta(
            'PLAN_NO_CORRESPONDE',
            `${plan.nombre} es un plan de ${plan.medio} y el pago es ${p.medio}`,
          )
        }
        // Sin esto, `monto = base + recargo` de abajo mezclaría dólares con
        // pesos. El porqué de no resolverlo dividiendo está en el spec: la
        // división deja ventas que no cierran por un centavo y que nadie puede
        // arreglar desde el mostrador.
        if (p.moneda !== 'ARS') {
          throw new ErrorDeVenta(
            'PLAN_EN_DOLARES',
            'un pago en dólares se cobra sin plan: el recargo va sobre la parte en pesos',
          )
        }
        const recargo = recargoDePago(p.base, plan.recargoPorcentaje)
        return { ...p, recargo, monto: p.base.add(recargo) }
      })
```

El invariante, donde hoy está la comparación:

```ts
      const total = totalDeItems(lineas)
      // Contra las BASES y no contra los montos: el recargo no es mercadería.
      // Es la misma comparación de siempre, corrida un lugar.
      const cubierto = totalDePagos(
        pagosConRecargo.map((p) => ({ monto: p.base, cotizacion: p.cotizacion })),
      )
      if (!cubierto.equals(total)) {
        throw new ErrorDeVenta(
          'PAGOS_NO_CIERRAN',
          `los pagos cubren ${cubierto} y el total es ${total}`,
        )
      }
      const recargoTotal = pagosConRecargo.reduce(
        (acc, p) => acc.add(p.recargo),
        new Prisma.Decimal(0),
      )
```

Y en el `create` de la venta: `recargo: recargoTotal` junto a `total`, y en los pagos, campo por campo como ya están:

```ts
            pagos: {
              create: pagosConRecargo.map((p) => ({
                tenantId,
                medio: p.medio,
                moneda: p.moneda,
                monto: p.monto,
                cotizacion: p.cotizacion,
                planDePagoId: p.planId,
                recargo: p.recargo,
              })),
            },
```

Importar `recargoDePago` de `./totales`.

- [ ] **Step 5: Cambiar el server action y el JSON que manda la pantalla**

En `app/(app)/vender/acciones.ts`, dentro del `map` de pagos:

```ts
      const planId = String(p.planId ?? '').trim()
      // Mismo guard que el articuloId: un uuid mal formado hace que Prisma tire
      // un error sin `codigo` —un 500— en vez del error de dominio que el resto
      // de esta función usa.
      if (planId !== '' && !esUuid(planId)) {
        throw new ErrorDeVenta('PLAN_INEXISTENTE', `no existe el plan ${planId}`)
      }
      return {
        medio: medio as MedioPago,
        moneda: moneda as Moneda,
        base: aDecimal(String(p.base ?? ''), 'el monto del pago'),
        cotizacion: aDecimal(String(p.cotizacion ?? ''), 'la cotización'),
        planId: planId === '' ? undefined : planId,
      }
```

En `app/(app)/vender/punto-de-venta.tsx`, renombrar el campo `monto` del tipo `Pago` y de todos sus usos a `base` —es mecánico— y ajustar el `<input type="hidden" name="pagos">` para que emita `base`. El campo sigue rotulado "Monto" en pantalla: la Task 6 es la que le agrega el plan y el "Cobrás $X".

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS, incluidos `punto-de-venta.test.tsx` (que hay que ajustar donde afirme sobre `monto`).

- [ ] **Step 7: Commit**

```bash
git add lib/ventas app/\(app\)/vender test/ventas.test.ts
git commit -m "feat(precios): el motor cobra el recargo sobre la parte financiada"
```

---

### Task 5: El permiso y la pantalla `/formas-de-pago`

**Files:**
- Modify: `lib/permisos/catalogo.ts`
- Create: `app/(app)/formas-de-pago/page.tsx`
- Create: `app/(app)/formas-de-pago/acciones.ts`
- Create: `app/(app)/formas-de-pago/formularios.tsx`
- Modify: `components/navegacion.tsx`
- Modify: `components/shell/sidebar-arandano.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `docs/pantallas.md`
- Test: `app/(app)/formas-de-pago/acciones.test.ts`, `components/navegacion.test.tsx`

**Interfaces:**
- Consumes: `crearPlan`, `editarPlan`, `desactivarPlan`, `reactivarPlan`, `planesDelTenant`, `precioConPlan`, `ErrorDePlan` (Task 3); `exigirPermiso`, `puedeConSesion` (`lib/permisos/guarda.ts`).
- Produces: `EstadoPlanes = { error: string | null; aviso: string | null }` y las cuatro actions que consume `formularios.tsx`:
  - `altaDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes>` — campos `nombre`, `medio`, `cuotas`, `porcentaje`.
  - `edicionDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes>` — los mismos más `id` y `orden`, sin `medio` (cambiar de medio es dar de baja y crear otro: el `medio` es lo que define contra qué pagos sirve, y moverlo dejaría las ventas viejas apuntando a un plan que ya no describe cómo se cobraron).
  - `bajaDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes>` — campo `id`.
  - `reactivacionDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes>` — campo `id`.

- [ ] **Step 1: Sumar el permiso al catálogo**

En `lib/permisos/catalogo.ts`, después de `CATEGORIAS`:

```ts
  {
    clave: 'PLANES_PAGO',
    nombre: 'Administrar formas de pago',
    ayuda: 'Crear y editar los planes de pago del local y cuánto recarga cada uno.',
  },
```

Y actualizar el JSDoc de arriba del array: "Los siete permisos…", con la línea que explica por qué `PLANES_PAGO` no se pliega sobre `ARTICULOS_EDITAR` (una palanca de una fila mueve todo el catálogo).

- [ ] **Step 2: Correr `test/permisos-catalogo.test.ts` y verificar que falla**

Run: `npm test -- permisos-catalogo`
Expected: FAIL con `PLANES_PAGO no lo exige ni lo consulta nadie fuera de lib/permisos` — el catálogo y el código se atan en las dos direcciones, así que un permiso sin consumidor rompe el build. Lo destraban los Steps 4 y 5.

- [ ] **Step 3: Escribir el test de las actions**

`app/(app)/formas-de-pago/acciones.test.ts` — copiar el arranque de `app/(app)/vender/acciones.test.ts` (sesión mockeada + Postgres efímero):

```ts
it('un empleado sin PLANES_PAGO no puede crear un plan', async () => {
  sesionActual = sesionDeEmpleado({ permisos: [] })
  await expect(altaDePlan(INICIAL, formularioDePlan())).rejects.toThrow()  // forbidden()
})

it('un empleado CON PLANES_PAGO sí puede', async () => {
  sesionActual = sesionDeEmpleado({ permisos: ['PLANES_PAGO'] })
  const estado = await altaDePlan(INICIAL, formularioDePlan())
  expect(estado.error).toBeNull()
  expect(await planesDelTenant(tenantId)).toHaveLength(1)
})

it('el dueño puede sin ninguna fila de permiso', async () => {
  sesionActual = sesionDeDueno()
  const estado = await altaDePlan(INICIAL, formularioDePlan())
  expect(estado.error).toBeNull()
})

it('un porcentaje inválido vuelve como error corregible, no como excepción', async () => {
  sesionActual = sesionDeDueno()
  const estado = await altaDePlan(INICIAL, formularioDePlan({ porcentaje: '-100' }))
  expect(estado.error).toMatch(/recargo va de/i)
})
```

- [ ] **Step 4: Escribir las actions**

`app/(app)/formas-de-pago/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { Prisma } from '@/generated/prisma/client'
import type { MedioPago } from '@/generated/prisma/client'
import { exigirPermiso } from '@/lib/permisos/guarda'
import { crearPlan, editarPlan, desactivarPlan, reactivarPlan } from '@/lib/planes/administrar'
import { ErrorDePlan } from '@/lib/planes/errores'
import { aDecimal, ErrorDeFormato } from '@/lib/formato/numeros'
import { esUuid } from '@/lib/uuid'

export type EstadoPlanes = { error: string | null; aviso: string | null }

// El valor inicial NO vive acá: este archivo es 'use server' y ahí Next
// convierte cada export en un endpoint RPC, así que sólo admite funciones async
// (test/use-server.test.ts lo fija). Vive en formularios.tsx.

const MEDIOS = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO'] as const

function traducir(e: unknown): EstadoPlanes {
  if (e instanceof ErrorDePlan || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

function medioDe(datos: FormData): MedioPago {
  const medio = String(datos.get('medio') ?? '')
  if (!MEDIOS.includes(medio as MedioPago)) {
    throw new ErrorDePlan('MEDIO_INVALIDO', `medio de pago desconocido: ${medio}`)
  }
  return medio as MedioPago
}

function cuotasDe(datos: FormData): number {
  const crudo = String(datos.get('cuotas') ?? '1').trim()
  // Number() y no parseInt: parseInt("3 cuotas") da 3 en silencio, y lo que se
  // quiere acá es rechazar lo que no sea un número entero pelado.
  const cuotas = Number(crudo)
  if (!Number.isInteger(cuotas)) {
    throw new ErrorDePlan('CUOTAS_INVALIDAS', 'Las cuotas van de 1 a 120.')
  }
  return cuotas
}

/** Cada action vuelve a exigir el permiso: que la pantalla no se muestre no es
 *  una defensa, porque una action se puede invocar sin pasar por la pantalla. */
export async function altaDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    const nombre = String(datos.get('nombre') ?? '').trim()
    await crearPlan({
      tenantId: sesion.tenant.id,
      nombre,
      medio: medioDe(datos),
      cuotas: cuotasDe(datos),
      recargoPorcentaje: aDecimal(String(datos.get('porcentaje') ?? ''), 'el recargo'),
      orden: cuotasDe(datos),
    })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: `"${nombre}" quedó disponible en el mostrador.` }
  } catch (e) {
    return traducir(e)
  }
}
```

Las otras tres, con el mismo esqueleto —`exigirPermiso('PLANES_PAGO')` primero, `try/catch` con `traducir`, `revalidatePath('/formas-de-pago')` al final— y cada una con lo suyo:

```ts
export async function edicionDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    const id = String(datos.get('id') ?? '')
    // Mismo guard que en cobrar(): un uuid mal formado hace que Prisma tire un
    // error sin `codigo` —un 500— en vez del error de dominio que el resto de
    // este archivo usa.
    if (!esUuid(id)) throw new ErrorDePlan('PLAN_INEXISTENTE', 'Ese plan no está en este local.')
    const nombre = String(datos.get('nombre') ?? '').trim()
    await editarPlan({
      tenantId: sesion.tenant.id,
      id,
      nombre,
      cuotas: cuotasDe(datos),
      recargoPorcentaje: aDecimal(String(datos.get('porcentaje') ?? ''), 'el recargo'),
      orden: Number(String(datos.get('orden') ?? '0')),
    })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: `"${nombre}" quedó actualizado.` }
  } catch (e) {
    return traducir(e)
  }
}

export async function bajaDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    const id = String(datos.get('id') ?? '')
    if (!esUuid(id)) throw new ErrorDePlan('PLAN_INEXISTENTE', 'Ese plan no está en este local.')
    await desactivarPlan({ tenantId: sesion.tenant.id, id })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: 'El plan ya no se ofrece en el mostrador.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function reactivacionDePlan(_e: EstadoPlanes, datos: FormData): Promise<EstadoPlanes> {
  try {
    const sesion = await exigirPermiso('PLANES_PAGO')
    const id = String(datos.get('id') ?? '')
    if (!esUuid(id)) throw new ErrorDePlan('PLAN_INEXISTENTE', 'Ese plan no está en este local.')
    await reactivarPlan({ tenantId: sesion.tenant.id, id })
    revalidatePath('/formas-de-pago')
    return { error: null, aviso: 'El plan vuelve al mostrador.' }
  } catch (e) {
    return traducir(e)
  }
}
```

**`orden` sale de `cuotas` en el alta** y no de un campo propio: es lo que hace que 3 cuotas salga antes que 12 sin que nadie ordene nada a mano. La edición sí lo deja tocar.

- [ ] **Step 5: Escribir la pantalla**

`app/(app)/formas-de-pago/page.tsx` — Server Component, `export const dynamic = 'force-dynamic'`, `exigirPermiso('PLANES_PAGO')`, `planesDelTenant(tenantId, { incluirDesactivados: true })`, `<Encabezado titulo="Formas de pago" subtitulo={…} acciones={…}/>` y el cuerpo en `formularios.tsx`.

El ejemplo de precio derivado se calcula **en el servidor** con `precioConPlan` sobre un artículo de referencia de $10.000 y se pasa ya formateado:

```tsx
const EJEMPLO = new Prisma.Decimal('10000')
// Un número redondo y fijo, no el precio de un artículo real: sirve para leer
// el porcentaje, no para cotizar nada. Un artículo real haría que el ejemplo
// cambie cuando alguien le toca el precio, sin que este plan haya cambiado.
const filas = planes.map((p) => ({
  ...p,
  ejemplo: formatearPrecio(precioConPlan(EJEMPLO, new Prisma.Decimal(p.porcentaje)).toString()),
}))
```

`formularios.tsx` es `'use client'`: la tabla de planes, el diálogo de alta/edición y los avisos por toast. Reglas que ya dejó escritas el ABM de categorías y que acá valen igual:

- El toast se lanza **en el handler que ejecuta la acción**, con el resultado en la mano — nunca desde un `useEffect` sobre `useActionState`, que revive el aviso en cada re-render y lo mata en cada `revalidatePath`.
- **Los errores no se auto-descartan** (`duration: Infinity`) porque son accionables; los avisos de éxito sí.
- Cada toast lleva **clave estable por acción y por plan** (`id: \`plan-${id}-baja\``), o sonner apila una copia por render.
- El `<Toaster>` ya está montado en el root layout: no montar otro.

- [ ] **Step 6: Sumar la pestaña al sidebar**

En `components/navegacion.tsx`:

```ts
import type { Permiso } from '@/lib/permisos/catalogo'

type Pestana = {
  href: string
  texto: string
  icono: LucideIcon
  soloDueno?: boolean
  /** La pestaña se muestra si la sesión tiene este permiso. Un DUENO los tiene
   *  todos (ver lib/permisos/guarda.ts), así que no necesita una fila. */
  permiso?: Permiso
}
```

con la entrada nueva antes de `Usuarios`:

```ts
  { href: '/formas-de-pago', texto: 'Formas de pago', icono: CreditCard, permiso: 'PLANES_PAGO' },
```

`Navegacion` recibe `permisos: Permiso[]` además de `rol`, y filtra: `!p.permiso || permisos.includes(p.permiso)`. `app/(app)/layout.tsx` los resuelve:

```tsx
// El dueño los tiene todos sin fila, igual que en la guarda: pedirle la tabla
// sería consultar para nada y dejaría la pestaña apagada en un local recién
// creado.
const permisos =
  sesion.usuario.rol === 'DUENO'
    ? [...CLAVES_DE_PERMISO]
    : [...(await permisosDe(sesion.tenant.id, sesion.usuario.id))]
```

y los pasa por `SidebarArandano` hasta `Navegacion`. `permisosDe` está memoizada por request con `cache()`, así que esto no suma una consulta por pantalla más allá de la primera.

Sumar a `components/navegacion.test.tsx` un caso por dirección: un empleado sin el permiso no ve la pestaña, uno con el permiso sí, y el dueño también.

- [ ] **Step 7: Documentar la pantalla**

Sumar la sección `## \`/formas-de-pago\`` a `docs/pantallas.md`, entre los marcadores, con el mismo formato que las demás: qué muestra, sus server actions, y las decisiones no obvias (el ejemplo de $10.000 fijo, `orden` derivado de `cuotas` en el alta, la baja lógica en vez del borrado).

- [ ] **Step 8: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS, `permisos-catalogo` y `pantallas` incluidos.

- [ ] **Step 9: Commit**

```bash
git add lib/permisos/catalogo.ts app/\(app\)/formas-de-pago components docs/pantallas.md
git commit -m "feat(precios): el ABM de formas de pago, detrás de su propio permiso"
```

---

### Task 6: El mostrador elige el plan

**Files:**
- Modify: `app/(app)/vender/page.tsx`
- Modify: `app/(app)/vender/punto-de-venta.tsx`
- Modify: `docs/pantallas.md` (sección `/vender`)
- Test: `app/(app)/vender/punto-de-venta.test.tsx`

**Interfaces:**
- Consumes: `planesDelTenant` (Task 3), `recargoEnCentavos` y `porcentajeEnMilesimas` (Task 2), el campo `planId` del server action (Task 4).
- Produces: nada que consuman tasks posteriores.

- [ ] **Step 1: Escribir los tests que fallan**

En `app/(app)/vender/punto-de-venta.test.tsx`:

```tsx
it('sin planes cargados no dibuja ningún control de plan', () => {
  const html = render({ planes: [] })
  expect(html).not.toContain('Plan')
})

it('con planes de crédito, el pago en efectivo no ofrece ninguno', () => {
  // El select de plan se filtra por el medio del pago: un plan de tarjeta en
  // una fila de efectivo lo rechaza el servidor (PLAN_NO_CORRESPONDE), así que
  // ofrecerlo sería ofrecer un error.
  const html = render({ planes: [PLAN_CREDITO], pagoInicial: { medio: 'EFECTIVO' } })
  expect(html).not.toContain('Crédito 3 cuotas')
})

it('el pie muestra mercadería, recargo y total a cobrar cuando hay plan', () => {
  const html = render({ planes: [PLAN_CREDITO], carrito: [{ precio: '10000', cantidad: '1' }],
                        pagoInicial: { medio: 'TARJETA_CREDITO', planId: PLAN_CREDITO.id } })
  expect(html).toContain('Mercadería')
  expect(html).toContain('Recargo')
  expect(html).toContain('Total a cobrar')
})

it('sin recargo el pie no crece: una sola línea, como hoy', () => {
  const html = render({ planes: [PLAN_CREDITO], carrito: [{ precio: '10000', cantidad: '1' }] })
  expect(html).not.toContain('Total a cobrar')
})
```

Y el caso que decide si el botón se puede apretar, que es el que más duele si sale mal:

```tsx
it('el faltante se mide contra la mercadería, no contra lo cobrado', () => {
  // Carrito de 10.000 y un pago de base 10.000 con 40 %: la venta CIERRA, así
  // que no puede aparecer el chip "Faltan" y el botón tiene que quedar
  // habilitado. Si el faltante se midiera contra los 14.000 que entran, el
  // mostrador no podría cobrar nunca una venta financiada.
  const html = render({
    planes: [PLAN_CREDITO],
    carrito: [{ precio: '10000', cantidad: '1' }],
    pagoInicial: { medio: 'TARJETA_CREDITO', base: '10000', planId: PLAN_CREDITO.id },
  })
  expect(html).not.toContain('Faltan')
  expect(html).not.toContain('Sobran')
  expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\s*Cobrar/)
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- punto-de-venta`
Expected: FAIL — `planes` no es una prop de `PuntoDeVenta`.

- [ ] **Step 3: Pasar los planes desde la página**

En `app/(app)/vender/page.tsx`, junto a la cotización que ya carga:

```tsx
const planes = await planesDelTenant(sesion.tenant.id)
```

y `planes={planes}` en `<PuntoDeVenta …>`. `PlanVisible` cruza a un componente cliente sin problema: sus campos son `string`, `number` y `Date`, no `Decimal` (ver el comentario del tipo).

- [ ] **Step 4: El select de plan en la fila de pago**

En `FilaDePago`, después del select de medio, y sólo si hay planes para ese medio:

```tsx
const planesDelMedio = planes.filter((p) => p.medio === pago.medio)
```

```tsx
{planesDelMedio.length > 0 && (
  <Select
    value={pago.planId ?? SIN_PLAN}
    onValueChange={(v) => onCambiar({ planId: v === SIN_PLAN ? null : v })}
  >
    <SelectTrigger
      aria-label={`Plan del pago ${indice + 1}`}
      className="h-9! flex-1 justify-between rounded-[9px] border-input pr-[11px] pl-[11px] text-[13px] font-medium text-foreground"
    >
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {/* Un valor centinela y no "": Radix reserva la cadena vacía para
          "sin selección" y un SelectItem con value="" tira en runtime. */}
      <SelectItem value={SIN_PLAN}>Precio de lista</SelectItem>
      {planesDelMedio.map((p) => (
        <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>
      ))}
    </SelectContent>
  </Select>
)}
```

**Al cambiar el medio hay que limpiar el plan** (`onCambiar({ medio, planId: null })`): un plan de crédito que sobreviva a un cambio a efectivo es exactamente el `PLAN_NO_CORRESPONDE` que el servidor rechaza, con la pantalla mostrando algo válido.

El JSON escondido suma `planId: p.planId ?? undefined`.

- [ ] **Step 5: El pie del panel de cobro**

Tres líneas cuando `recargoTotalCentavos !== 0`, y la de siempre cuando es cero:

```tsx
const recargoTotalCentavos = pagos.reduce((acc, p) => {
  const plan = planes.find((pl) => pl.id === p.planId)
  if (!plan) return acc
  // Sobre la BASE ya convertida a pesos, igual que el servidor. NaN si el
  // monto está a medio tipear: el guard de abajo lo trata como el resto de
  // los importes de esta pantalla.
  return acc + recargoEnCentavos(entranPesosCentavos(p.base, p.cotizacion), porcentajeEnMilesimas(plan.porcentaje))
}, 0)
```

Mostrar "Mercadería", "Recargo <nombre del plan>" (o "Recargo" si hay más de uno) y "Total a cobrar", con el guard de `Number.isNaN` que el archivo ya aplica por regla a todo importe.

**La banda de `--marca` sigue mostrando la mercadería**: es el ancla de contenido de esta pantalla y es contra ese número que se reparte el pago. El total a cobrar va en el pie del panel de cobro, que es donde se decide cuánta plata entra.

- [ ] **Step 6: Documentar y correr los tests**

Actualizar la sección `/vender` de `docs/pantallas.md` con el selector de plan, el pie de tres líneas y la regla de limpiar el plan al cambiar el medio.

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/vender docs/pantallas.md
git commit -m "feat(precios): el mostrador cobra con el plan elegido"
```

---

### Task 7: La ficha del artículo muestra los precios derivados

**Files:**
- Modify: `app/(app)/inventario/[id]/page.tsx`
- Modify: `docs/pantallas.md` (sección `/inventario/[id]`)
- Test: `app/(app)/inventario/[id]/page.test.ts`

**Interfaces:**
- Consumes: `planesDelTenant`, `precioConPlan` (Task 3).
- Produces: nada.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('el panel lista un precio por plan activo', () => {
  const html = render({ articulo: { precio: '10000' }, planes: [PLAN_40, PLAN_MENOS_10] })
  expect(html).toContain('Precios por forma de pago')
  expect(html).toContain(formatearPrecio('14000'))
  expect(html).toContain(formatearPrecio('9000'))
})

it('sin planes cargados el panel no aparece', () => {
  // Un panel con una sola fila que repite el precio de arriba es ruido: el
  // local que no usa planes no tiene nada que mirar acá.
  const html = render({ articulo: { precio: '10000' }, planes: [] })
  expect(html).not.toContain('Precios por forma de pago')
})

it('el precio derivado es el mismo que cobra el motor', () => {
  // No un número escrito a mano en el test: la cuenta de la ficha y la del
  // cobro tienen que ser la misma función, o la pantalla miente.
  expect(precioConPlan(d('12345.67'), d('13.75')).toString()).toBe(
    d('12345.67').add(recargoDePago(d('12345.67'), d('13.75'))).toString(),
  )
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- inventario`
Expected: FAIL — el texto "Precios por forma de pago" no está en la fuente.

- [ ] **Step 3: Implementar el panel**

En la columna derecha de la ficha, después de "Datos" y antes de "Cómo se movió": una `Card` con una fila por plan activo — nombre, medio y cuotas a la izquierda, precio derivado a la derecha con el rol Importe. Los planes se cargan con `planesDelTenant(tenantId)` (sólo activos) y el precio con `precioConPlan(articulo.precio, new Prisma.Decimal(p.porcentaje))`.

**No lleva permiso**: es de sólo lectura, sobre el precio que la misma pantalla ya muestra arriba, y quien cobra necesita poder decirle el precio en cuotas a un cliente. `COSTOS` sigue tapando el costo y el margen, que son otra cosa.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -- inventario`
Expected: PASS.

- [ ] **Step 5: Documentar y commitear**

Actualizar la sección `/inventario/[id]` de `docs/pantallas.md`.

```bash
git add app/\(app\)/inventario docs/pantallas.md
git commit -m "feat(precios): la ficha del artículo muestra el precio de cada forma de pago"
```

---

### Task 8: Ventas muestran el recargo

**Files:**
- Modify: `app/(app)/ventas/page.tsx`
- Modify: `app/(app)/ventas/[id]/page.tsx`
- Modify: `lib/ventas/buscar.ts` (si el listado arma sus filas ahí)
- Modify: `docs/pantallas.md` (secciones `/ventas` y `/ventas/[id]`)
- Test: `app/(app)/ventas/[id]/page.test.ts`, `lib/ventas/buscar.test.ts`

**Interfaces:**
- Consumes: `Venta.recargo` y `Pago.recargo`/`Pago.plan` (Task 1 y 4).
- Produces: nada.

- [ ] **Step 1: Escribir los tests que fallan**

```ts
it('el listado suma el recargo al total de la fila', () => {
  // Es la plata que entró, que es lo que alguien viene a mirar a /ventas.
  expect(totalCobrado({ total: d('10000'), recargo: d('2500') }).toString()).toBe('12500')
})

it('el tile del período suma lo cobrado, no la mercadería', () => {
  expect(totalDelPeriodo([{ total: d('10000'), recargo: d('2500') },
                          { total: d('5000'), recargo: d('0') }]).toString()).toBe('17500')
})

it('el detalle desglosa mercadería, recargo y cobrado', () => {
  const html = render({ venta: { total: '10000', recargo: '2500' } })
  expect(html).toContain('Mercadería')
  expect(html).toContain('Recargo')
  expect(html).toContain('Cobrado')
})

it('una venta sin recargo no dibuja el desglose', () => {
  const html = render({ venta: { total: '10000', recargo: '0' } })
  expect(html).not.toContain('Recargo')
})

it('cada pago muestra el plan con el que se cobró', () => {
  const html = render({ pagos: [{ medio: 'TARJETA_CREDITO', monto: '12500',
                                  plan: { nombre: 'Crédito 3 cuotas', cuotas: 3 } }] })
  expect(html).toContain('Crédito 3 cuotas')
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -- ventas`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`/ventas`: la columna Total pasa a `total + recargo`, y el tile "Total del período" suma lo mismo. El `select` de la consulta suma `recargo`.

`/ventas/[id]`: el panel de totales pasa a tres líneas **sólo si `recargo` no es cero** —una venta sin recargo no tiene nada que desglosar— y la tabla de pagos suma la columna del plan (`nombre` + "N cuotas" cuando `cuotas > 1`), con `include: { plan: { select: { nombre: true, cuotas: true } } }`.

**El plan puede estar dado de baja y la venta lo sigue mostrando**: la FK es `Restrict` y la baja es lógica, así que la fila sigue ahí. Es exactamente lo que se quiere: la venta de marzo dice con qué se cobró aunque ese plan ya no se ofrezca.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Documentar y commitear**

Actualizar las secciones `/ventas` y `/ventas/[id]` de `docs/pantallas.md`.

```bash
git add app/\(app\)/ventas lib/ventas/buscar.ts docs/pantallas.md
git commit -m "feat(precios): las ventas muestran el recargo y con qué plan se cobró"
```

---

### Task 9: Cerrar el ciclo — documentación y gate completo

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/correcciones-pendientes-del-pen.md`
- Modify: `docs/superpowers/specs/2026-08-27-precios-por-forma-de-pago-design.md` (sólo si la implementación cambió alguna decisión)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Anotar la deuda con la maqueta**

En `docs/correcciones-pendientes-del-pen.md`, tres entradas: `/formas-de-pago` entera (el `.pen` no dibuja la pantalla), el selector de plan de la fila de pago de `/vender`, y el panel "Precios por forma de pago" de `/inventario/[id]`. Con la aclaración de que **no contradicen** al `.pen`: falta, que es distinto — el `.pen` sigue siendo la autoridad donde sí dibuja.

- [ ] **Step 2: Escribir la entrada de `CLAUDE.md`**

En *Próximos pasos técnicos*, una entrada tachada nueva con el mismo formato que las de categorías y permisos: qué pidió el cliente (textual), las cinco decisiones con su alternativa descartada, que `Articulo.precio` pasa a significar **precio de lista**, que el recargo cae sólo sobre la parte financiada, que un pago en dólares no lleva plan y por qué, y qué queda pendiente.

En *Opciones evaluadas y descartadas*, sumar **precio por artículo y por plan** con su disparador para reconsiderarlo (que a un dueño le moleste de verdad no poder pisar el precio de un artículo puntual).

En la tabla de módulos/permisos, actualizar el catálogo cerrado: de seis a **siete**, con la regla que sostiene la asimetría (`PLANES_PAGO` aparte de `ARTICULOS_EDITAR` porque es una palanca de una fila que mueve todo el catálogo).

- [ ] **Step 3: Correr el gate completo**

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

Expected: los cuatro en verde. `npm run build` es el único que ve los errores de borde cliente/servidor que ni los tests ni el typecheck detectan.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs
git commit -m "docs(precios): las decisiones del ciclo, la deuda con la maqueta y el catálogo de siete permisos"
```

- [ ] **Step 5: Pedir la review antes del merge**

Usar `superpowers:requesting-code-review`. Con un solo desarrollador es la única segunda mirada que existe, y `CLAUDE.md` la pone antes del merge, no después.

**Lo que la review tiene que mirar con lupa**, porque es donde este ciclo puede haber metido un bug silencioso:

1. Que el recargo del navegador y el del servidor no se puedan separar (Task 2, el caso del negativo).
2. Que ningún camino deje `Pago.monto` decidido por el cliente.
3. Que `Venta.total` siga siendo mercadería en todos sus lectores — el margen de `/inventario/[id]` se mide contra él.
4. Que el plan se limpie al cambiar el medio en la fila de pago.

- [ ] **Step 6: Deployar en dos pasos, en este orden**

No es una sugerencia: es lo que hace que el rollback automático signifique algo.

1. **Deploy 1 (patch)**: `deploy.sh` sobre un commit que tenga **sólo las dos
   migraciones** de la Task 1 (schema, SQL y `docs/schema.md`). Ningún código
   las lee todavía, así que la imagen anterior sigue sirviendo igual.
2. **Deploy 2 (minor)**: el resto. Si el healthcheck lo rechaza, el rollback
   encuentra la base con columnas de más y ninguna de menos.

**`deploy.sh` buildea `HEAD` y exige el working tree limpio** (`SHA=$(git
rev-parse --short HEAD)`), así que el orden no se elige con un flag: se elige
con el merge. El commit de la Task 1 entra a `main` y se deploya; recién
después entra el resto.

Vale ser preciso sobre por qué, porque es fácil justificarlo mal: como todo
acá es **aditivo**, un solo deploy también sobreviviría al rollback —la imagen
vieja no se rompe por columnas que no mira—. La regla de `CLAUDE.md` ("primero
la migración aditiva, después el código que la usa") vale igual por lo otro
que compra: si el deploy 2 falla el healthcheck, se sabe que fue el código y
no el schema, porque el schema ya estuvo vivo en producción un deploy entero.
Eso es lo que hace que el rollback sea una decisión de dos segundos y no una
investigación.

- [ ] **Step 7: Verificación manual, después del merge**

`arandano-dev` bind-montea `/root/arandano`, no el worktree, así que esto va cuando la rama vuelva a `main`. Sembrar un par de planes (`Crédito 1 pago +10 %`, `Crédito 6 cuotas +40 %`, `Efectivo −10 %`) y mirar, entrando **por el subdominio del tenant** y no por la IP:

1. `/formas-de-pago` con un empleado sin el permiso: la pestaña no está y la ruta da 403.
2. El toast de error del ABM no se va solo; el de éxito sí.
3. En `/vender`, un pago en efectivo no ofrece los planes de crédito.
4. Pago partido: 4.000 en efectivo + resto en 6 cuotas sobre un carrito de 10.000 tiene que cobrar 12.400.
5. El precio que muestra la ficha del artículo es el mismo que termina cobrando el mostrador.
6. Un pago en dólares con plan elegido no se puede armar desde la pantalla.
