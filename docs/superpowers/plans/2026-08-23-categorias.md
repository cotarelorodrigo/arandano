# Categorías de artículo (el modelo) — plan de implementación

> **Para quien ejecute esto:** las tareas van en orden y cada una termina en un
> commit con los tests en verde. Los pasos usan checkbox (`- [ ]`).

**Goal:** que las categorías de artículo dejen de ser texto libre y pasen a ser
un árbol de dos niveles con tabla propia, sin tocar ninguna pantalla.

**Architecture:** tabla `categorias` con auto-relación (`padre_id` NULL = raíz),
`Articulo.categoriaId` como FK nullable que puede apuntar a una raíz o a una
hoja, y `crearArticulo`/`editarArticulo` sincronizando el árbol desde el texto
que ya reciben. El texto (`articulos.categoria`) se sigue escribiendo: es lo que
sostiene el rollback hasta el deploy que lo borre.

**Tech Stack:** Prisma 7 + Postgres 17, vitest contra un Postgres efímero en
Docker (`test/postgres-efimero.ts`), RLS por `tenant_id`.

**Spec:** `docs/superpowers/specs/2026-08-23-categorias-design.md`

## Global Constraints

- **Migración aditiva, sin excepción.** Ni un `DROP`, ni un `ALTER … TYPE`, ni
  un `NOT NULL` sobre columna existente. El hook de pre-commit
  (`.githooks/pre-commit`) frena el commit si aparece uno.
- **La migración se genera con `--create-only`.** Sin ese flag Prisma la aplica
  antes de que se pueda editar el SQL a mano, y salir de ahí exige un
  `migrate reset`, que está prohibido.
- **Toda tabla con `tenant_id` lleva RLS.** `ENABLE ROW LEVEL SECURITY` + policy
  `tenant_aislamiento` con `USING` **y** `WITH CHECK`, usando
  `nullif(current_setting('arandano.tenant_id', true), '')::uuid`.
  `test/rls-cobertura.test.ts` lo verifica solo.
- **Ninguna pantalla cambia.** Ni `app/`, ni `components/`. Si un archivo de
  `app/` aparece en un diff de este plan, algo se salió del alcance.
- **Español en nombres, comentarios y mensajes**, como todo el repo.
- **El separador de categorías es `·`** (U+00B7, middot).

---

### Task 1: `partirCategoria`, la regla de parseo

Función pura, sin base de datos. Es donde vive toda la regla y donde se prueba.

**Files:**
- Create: `lib/inventario/categorias.ts`
- Create: `lib/inventario/categorias.test.ts`

**Interfaces:**
- Produces: `export type CategoriaPartida = { raiz: string; hija: string | null }`
  y `export function partirCategoria(texto: string | null | undefined): CategoriaPartida | null`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/inventario/categorias.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { partirCategoria } from './categorias'

describe('partirCategoria', () => {
  it('parte "raíz · hija" en sus dos niveles', () => {
    expect(partirCategoria('Fundas · Samsung')).toEqual({ raiz: 'Fundas', hija: 'Samsung' })
  })

  // El separador es el `·`, no `" · "`: quien lo escribe pegado quiso decir lo
  // mismo, y castigarlo por no poner espacios sería inventar una regla.
  it('no exige espacios alrededor del separador', () => {
    expect(partirCategoria('Fundas·Samsung')).toEqual({ raiz: 'Fundas', hija: 'Samsung' })
  })

  it('sin separador devuelve una raíz sola', () => {
    expect(partirCategoria('Cables')).toEqual({ raiz: 'Cables', hija: null })
  })

  // El tercer nivel se pliega adentro de la hija en vez de descartarse: es
  // feo, pero no pierde lo que la persona escribió.
  it('pliega el tercer nivel dentro de la hija', () => {
    expect(partirCategoria('Accesorios · Fundas · Samsung')).toEqual({
      raiz: 'Accesorios',
      hija: 'Fundas · Samsung',
    })
  })

  it('descarta los segmentos vacíos, así que una raíz vacía no existe', () => {
    expect(partirCategoria('· Samsung')).toEqual({ raiz: 'Samsung', hija: null })
    expect(partirCategoria('A ·  · B')).toEqual({ raiz: 'A', hija: 'B' })
  })

  it('trimea cada segmento', () => {
    expect(partirCategoria('   Fundas   ·   Samsung   ')).toEqual({
      raiz: 'Fundas',
      hija: 'Samsung',
    })
  })

  // Mismo criterio que `limpiarCategoria` para el texto: vacío y "sólo
  // espacios" son la misma "no hay categoría", y el árbol lo hereda en vez de
  // inventar el suyo.
  it('sin ningún segmento no hay categoría', () => {
    for (const vacio of ['', '   ', '·', ' · · ', null, undefined]) {
      expect(partirCategoria(vacio)).toBeNull()
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/inventario/categorias.test.ts`
Expected: FAIL — no existe el módulo `./categorias`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `lib/inventario/categorias.ts`:

```ts
/** El separador de niveles: el middot que la maqueta ya usa en
 *  "Accesorios · Protección". */
export const SEPARADOR = '·'

/** Cómo se vuelve a escribir un nivel plegado. Con espacios, que es la forma
 *  que se muestra; el parseo tolera las dos. */
const SEPARADOR_VISIBLE = ` ${SEPARADOR} `

export type CategoriaPartida = { raiz: string; hija: string | null }

/**
 * Parte el texto libre de `Articulo.categoria` en los dos niveles del árbol.
 *
 * Una sola regla, sin casos especiales: partir por el separador, trimear cada
 * segmento, **descartar los vacíos**, y de lo que queda el primero es la raíz
 * y el resto —unido de nuevo— es la hija. De ahí salen todos los bordes: un
 * texto sin separador da una raíz sola, `"· Samsung"` da `Samsung` sin hija
 * porque el segmento vacío se cae, y un tercer nivel se pliega adentro de la
 * hija en vez de tirarse.
 *
 * Plegar y no descartar es la decisión que importa: `"A · B · C"` da
 * `A` > `B · C`. Queda feo, pero no borra en silencio algo que alguien
 * escribió — y el modelo tiene dos niveles, no tres.
 */
export function partirCategoria(texto: string | null | undefined): CategoriaPartida | null {
  const segmentos = (texto ?? '')
    .split(SEPARADOR)
    .map((s) => s.trim())
    .filter((s) => s !== '')

  if (segmentos.length === 0) return null

  const [raiz, ...resto] = segmentos
  return { raiz, hija: resto.length > 0 ? resto.join(SEPARADOR_VISIBLE) : null }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/inventario/categorias.test.ts`
Expected: PASS, 7 casos.

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/categorias.ts lib/inventario/categorias.test.ts
git commit -m "feat(categorías): partirCategoria, la regla de parseo"
```

---

### Task 2: la migración estructural

La tabla, la FK, los dos índices de unicidad y la RLS. **Sin el backfill
todavía** — ése es Task 4, y separarlo deja que un reviewer rechace uno sin
rechazar el otro.

**Files:**
- Modify: `prisma/schema.prisma` (modelos `Tenant`, `Articulo`; modelo nuevo `Categoria`)
- Create: `prisma/migrations/<timestamp>_categorias/migration.sql` (lo genera Prisma, se edita a mano)
- Modify: `test/schema.test.ts`
- Modify: `test/rls.test.ts`

**Interfaces:**
- Produces: la tabla `categorias` y `articulos.categoria_id`, que Task 3 usa.

- [ ] **Step 1: Escribir los tests que fallan**

En `test/schema.test.ts`, agregar un `describe` al final del archivo:

```ts
describe('categorias', () => {
  it('la tabla existe con las columnas en snake_case', async () => {
    const { rows } = await cliente.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'categorias'
        ORDER BY column_name`,
    )
    const columnas = rows.map((r) => r.column_name)
    expect(columnas).toEqual(
      ['actualizado_en', 'creado_en', 'id', 'nombre', 'padre_id', 'tenant_id'],
    )
  })

  it('articulos tiene la FK a categorias, nullable', async () => {
    const { rows } = await cliente.query(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='articulos' AND column_name='categoria_id'`,
    )
    expect(rows[0].is_nullable).toBe('YES')
  })

  // Sin el índice PARCIAL, dos raíces homónimas pasan: en Postgres NULL <>
  // NULL, así que el @@unique de Prisma no las alcanza. Este caso es lo único
  // que separa "el árbol tiene una Celulares" de "tiene tres".
  it('rechaza dos raíces con el mismo nombre en el mismo tenant', async () => {
    const t = await crearTenantCrudo('cat-raiz-unica')
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Celulares', now(), now())`,
      [t],
    )
    await expect(
      cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Celulares', now(), now())`,
        [t],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  // La otra mitad del mismo índice: sin `tenant_id` adentro, el local de al
  // lado no podría tener su propia "Celulares".
  it('pero la misma raíz convive en dos tenants distintos', async () => {
    const a = await crearTenantCrudo('cat-raiz-a')
    const b = await crearTenantCrudo('cat-raiz-b')
    for (const t of [a, b]) {
      await cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Fundas', now(), now())`,
        [t],
      )
    }
    const { rows } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias WHERE nombre = 'Fundas'`,
    )
    expect(rows[0].n).toBe(2)
  })

  it('rechaza dos hijas con el mismo nombre bajo el mismo padre', async () => {
    const t = await crearTenantCrudo('cat-hija-unica')
    const { rows } = await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Celulares', now(), now()) RETURNING id`,
      [t],
    )
    const padre = rows[0].id
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Samsung', $2, now(), now())`,
      [t, padre],
    )
    await expect(
      cliente.query(
        `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Samsung', $2, now(), now())`,
        [t, padre],
      ),
    ).rejects.toMatchObject({ code: '23505' })
  })

  // Restrict y no Cascade: borrar "Celulares" no puede llevarse puesto el
  // trabajo de clasificar todas sus marcas.
  it('no deja borrar una categoría con hijas', async () => {
    const t = await crearTenantCrudo('cat-con-hijas')
    const { rows } = await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Celulares', now(), now()) RETURNING id`,
      [t],
    )
    const padre = rows[0].id
    await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Motorola', $2, now(), now())`,
      [t, padre],
    )
    await expect(
      cliente.query(`DELETE FROM categorias WHERE id = $1`, [padre]),
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('no deja borrar una categoría con artículos', async () => {
    const t = await crearTenantCrudo('cat-con-articulos')
    const { rows } = await cliente.query(
      `INSERT INTO categorias (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Cables', now(), now()) RETURNING id`,
      [t],
    )
    const cat = rows[0].id
    await cliente.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, categoria_id, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'A-9001', 'Cable USB-C', 'PRODUCTO', 1000, 0, $2, now(), now())`,
      [t, cat],
    )
    await expect(
      cliente.query(`DELETE FROM categorias WHERE id = $1`, [cat]),
    ).rejects.toMatchObject({ code: '23503' })
  })
})
```

En `test/rls.test.ts`, agregar el caso concreto de aislamiento siguiendo el
patrón que ya tiene el archivo para las otras tablas (leer el archivo primero y
copiar la forma exacta de sus casos, incluido cómo obtiene los clientes de cada
tenant): con la GUC del tenant A, un `SELECT` sobre `categorias` devuelve las
del tenant A y **cero** del tenant B.

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL — `relation "categorias" does not exist`.

- [ ] **Step 3: Agregar los modelos a `prisma/schema.prisma`**

En `model Tenant`, sumar a la lista de relaciones inversas:

```prisma
  categorias Categoria[]
```

En `model Articulo`, después de `categoria String?` (que **se queda**, ver el
comentario), agregar:

```prisma
  // La FK al árbol de categorías. Convive con `categoria` (el texto) a
  // propósito y por un tiempo acotado: expand/contract. Mientras haya código
  // desplegado que lea el texto, el texto se sigue escribiendo — es lo que
  // hace que el rollback a la imagen anterior encuentre el dato. El drop de
  // la columna vieja es un deploy posterior al de la UI, no el siguiente.
  //
  // Apunta a una RAÍZ o a una HOJA, indistinto: "Cables" sin marca es
  // válido, y forzar que todo cuelgue de una hoja obligaría a inventar una
  // marca falsa para cada rubro que no usa marcas.
  categoriaId   String?      @map("categoria_id") @db.Uuid
```

y en el bloque de relaciones de `Articulo`:

```prisma
  categoriaArbol Categoria? @relation(fields: [categoriaId], references: [id], onDelete: Restrict)
```

Y el modelo nuevo, después de `model Articulo`:

```prisma
// El árbol de categorías del local: dos niveles, "Celulares" arriba y la marca
// abajo. `padre_id` NULL es una raíz.
//
// **Dos niveles y no un árbol libre.** La restricción no está en el schema —
// nada acá impide colgar una hija de una hija—, vive en el servidor: en este
// ciclo, estructuralmente (el único escritor, `asegurarCategoria`, busca la
// raíz con padre NULL y cuelga de ella), y con el ABM va a ser una validación
// explícita. Se eligió así sobre dos tablas separadas (`Categoria` y `Marca`)
// porque ésas duplican el ABM entero y convierten "mover Samsung de Celulares
// a Fundas" —un UPDATE de una columna— en un caso especial.
model Categoria {
  id            String   @id @default(uuid(7)) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  nombre        String
  padreId       String?  @map("padre_id") @db.Uuid
  creadoEn      DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Restrict en las dos direcciones: borrar "Celulares" no puede llevarse
  // puestas sus marcas ni dejar artículos apuntando a nada. Una categoría con
  // hijas o con artículos no se borra, y el ABM lo traduce a un mensaje.
  padre  Categoria?  @relation("Jerarquia", fields: [padreId], references: [id], onDelete: Restrict)
  hijas  Categoria[] @relation("Jerarquia")

  articulos Articulo[]

  // NO alcanza solo. En Postgres NULL <> NULL, así que dos RAÍCES homónimas lo
  // pasan sin chistar: la migración suma un índice único PARCIAL
  // (WHERE padre_id IS NULL) que Prisma no sabe expresar acá. Este cubre las
  // hijas; aquél, las raíces.
  @@unique([tenantId, padreId, nombre])
  @@index([tenantId, padreId])
  @@map("categorias")
}
```

- [ ] **Step 4: Generar la migración SIN aplicarla**

```bash
# La URL de dev vive en .env.local, que no se versiona. Se exporta así:
set -a; . .env.local; set +a
npx prisma migrate dev --create-only --name categorias
```

`--create-only` no es opcional: sin él Prisma aplica la migración antes de que
se pueda editar el SQL a mano, y salir de ahí exige un `migrate reset`, que
está prohibido contra cualquier base que importe.

- [ ] **Step 5: Editar el SQL a mano — el índice parcial y la RLS**

Agregar al final de `prisma/migrations/<timestamp>_categorias/migration.sql`:

```sql
-- La otra mitad de la unicidad. El @@unique de Prisma es
-- (tenant_id, padre_id, nombre), y en Postgres NULL <> NULL: dos RAÍCES
-- llamadas "Celulares" en el mismo tenant lo pasan sin chistar. Este índice
-- parcial es lo único que las frena, y tiene que ser un índice y no un
-- chequeo de aplicación por lo mismo que "una sola caja abierta por tenant":
-- dos pestañas creando la misma categoría en el mismo segundo pasan las dos
-- por cualquier `if` previo.
CREATE UNIQUE INDEX "categorias_raiz_unica_por_tenant"
  ON "categorias" ("tenant_id", "nombre")
  WHERE "padre_id" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "categorias" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "categorias" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Revisar que el SQL generado por Prisma **no traiga ningún `DROP`**. Si lo trae,
el schema quedó desalineado con las migraciones previas y hay que resolver eso
antes de seguir.

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npx vitest run test/schema.test.ts test/rls.test.ts test/rls-cobertura.test.ts`
Expected: PASS. `rls-cobertura` es el que confirma solo que la tabla nueva no
se quedó sin policy.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations test/schema.test.ts test/rls.test.ts
git commit -m "feat(categorías): la tabla, con RLS y las dos unicidades"
```

---

### Task 3: `asegurarCategoria` y la sincronización

**Files:**
- Modify: `lib/inventario/categorias.ts`
- Modify: `lib/inventario/articulos.ts`
- Modify: `test/inventario.test.ts`

**Interfaces:**
- Consumes: `partirCategoria` (Task 1), la tabla `categorias` (Task 2).
- Produces: `export async function asegurarCategoria(tx: ClienteTx, tenantId: string, texto: string | null | undefined): Promise<string | null>`

- [ ] **Step 1: Escribir los tests que fallan**

En `test/inventario.test.ts`, dentro del `describe` del alta de artículo (junto
a los casos de categoría que ya existen), agregar. `categoriaDe` es un helper
nuevo al lado de `stockDe`, arriba del archivo:

```ts
async function categoriaDe(articuloId: string): Promise<{ nombre: string; padre: string | null } | null> {
  const { rows } = await owner.query(
    `SELECT c.nombre, p.nombre AS padre
       FROM articulos a
       JOIN categorias c ON c.id = a.categoria_id
       LEFT JOIN categorias p ON p.id = c.padre_id
      WHERE a.id = $1`,
    [articuloId],
  )
  return rows.length === 0 ? null : { nombre: rows[0].nombre, padre: rows[0].padre }
}
```

Los casos:

```ts
it('el alta arma el árbol de categorías desde el texto', async () => {
  const a = await crearArticulo({
    tenantId, usuarioId, nombre: 'Funda Galaxy A52', tipo: 'PRODUCTO', precio: d('9000'),
    categoria: 'Fundas · Samsung',
  })
  expect(await categoriaDe(a.id)).toEqual({ nombre: 'Samsung', padre: 'Fundas' })
})

// El texto NO deja de escribirse, y eso es lo que sostiene el rollback: el
// código de la imagen anterior lee esta columna y encuentra el dato.
it('y sigue escribiendo el texto igual que antes', async () => {
  const a = await crearArticulo({
    tenantId, usuarioId, nombre: 'Funda Moto G54', tipo: 'PRODUCTO', precio: d('8000'),
    categoria: 'Fundas · Motorola',
  })
  const { rows } = await owner.query(`SELECT categoria FROM articulos WHERE id = $1`, [a.id])
  expect(rows[0].categoria).toBe('Fundas · Motorola')
})

it('una categoría sin marca cuelga de la raíz, y eso es válido', async () => {
  const a = await crearArticulo({
    tenantId, usuarioId, nombre: 'Cable USB-C 1m', tipo: 'PRODUCTO', precio: d('4000'),
    categoria: 'Cables',
  })
  expect(await categoriaDe(a.id)).toEqual({ nombre: 'Cables', padre: null })
})

it('sin categoría no crea ninguna fila y categoria_id queda null', async () => {
  const a = await crearArticulo({
    tenantId, usuarioId, nombre: 'Sin clasificar', tipo: 'PRODUCTO', precio: d('1000'),
  })
  expect(await categoriaDe(a.id)).toBeNull()
})

// Dos altas con la misma categoría tienen que REUSAR la fila. Si no, el árbol
// crece una rama por artículo y la pantalla del ciclo siguiente es ilegible.
it('dos artículos de la misma categoría comparten la fila', async () => {
  const uno = await crearArticulo({
    tenantId, usuarioId, nombre: 'Vidrio A52', tipo: 'PRODUCTO', precio: d('5000'),
    categoria: 'Vidrios templados · Samsung',
  })
  const dos = await crearArticulo({
    tenantId, usuarioId, nombre: 'Vidrio A54', tipo: 'PRODUCTO', precio: d('5500'),
    categoria: 'Vidrios templados · Samsung',
  })
  const { rows } = await owner.query(
    `SELECT a.categoria_id FROM articulos a WHERE a.id = ANY($1::uuid[])`,
    [[uno.id, dos.id]],
  )
  expect(rows[0].categoria_id).toBe(rows[1].categoria_id)
  const { rows: cuenta } = await owner.query(
    `SELECT count(*)::int AS n FROM categorias
      WHERE tenant_id = $1 AND nombre = 'Vidrios templados'`,
    [tenantId],
  )
  expect(cuenta[0].n).toBe(1)
})

// La misma marca bajo dos rubros distintos son DOS filas, no una: "Samsung" de
// Fundas y "Samsung" de Vidrios templados no son la misma categoría.
it('la misma marca bajo dos rubros son dos hijas distintas', async () => {
  const { rows } = await owner.query(
    `SELECT c.id, p.nombre AS padre FROM categorias c
       JOIN categorias p ON p.id = c.padre_id
      WHERE c.tenant_id = $1 AND c.nombre = 'Samsung' ORDER BY p.nombre`,
    [tenantId],
  )
  expect(rows.map((r) => r.padre)).toEqual(['Fundas', 'Vidrios templados'])
})

it('la edición mueve el artículo de rama', async () => {
  const a = await crearArticulo({
    tenantId, usuarioId, nombre: 'Cargador 33W', tipo: 'PRODUCTO', precio: d('12000'),
    categoria: 'Cables',
  })
  await editarArticulo({
    tenantId, articuloId: a.id, nombre: 'Cargador 33W', sku: a.sku, precio: d('12000'),
    categoria: 'Cargadores · Xiaomi',
  })
  expect(await categoriaDe(a.id)).toEqual({ nombre: 'Xiaomi', padre: 'Cargadores' })
})

it('y vaciar la categoría al editar deja categoria_id en null', async () => {
  const a = await crearArticulo({
    tenantId, usuarioId, nombre: 'Se despeja', tipo: 'PRODUCTO', precio: d('1000'),
    categoria: 'Cables',
  })
  await editarArticulo({
    tenantId, articuloId: a.id, nombre: 'Se despeja', sku: a.sku, precio: d('1000'),
    categoria: '',
  })
  expect(await categoriaDe(a.id)).toBeNull()
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run test/inventario.test.ts`
Expected: FAIL — `categoriaDe` devuelve `null` donde se espera una rama, porque
nadie escribe `categoria_id` todavía.

- [ ] **Step 3: Escribir `asegurarCategoria`**

Agregar a `lib/inventario/categorias.ts`:

```ts
import type { ClienteTx } from '@/lib/tenant/transaccion'

/**
 * Busca o crea la fila del árbol que corresponde al texto, y devuelve el id de
 * la hoja — o el de la raíz si el texto no trae hija, o `null` si no trae nada.
 *
 * **El INSERT va con `ON CONFLICT DO NOTHING`, y eso es load-bearing.**
 * `crearArticulo` tiene una invariante escrita: adentro de su transacción un
 * P2002 no puede ser otra cosa que el SKU, y `esSkuRepetido` se apoya en eso —
 * bajo `arandano_app` devuelve `true` para CUALQUIER P2002, porque RLS hace que
 * Postgres retenga el DETAIL del error y los nombres de columna nunca lleguen.
 * Un `create` normal de Prisma acá haría que una colisión de categoría se leyera
 * como "SKU repetido": el alta reintentaría cinco veces con SKUs distintos,
 * chocaría siempre por lo mismo, y terminaría diciendo "no se pudo generar un
 * código libre". Con ON CONFLICT nunca se tira P2002 y la invariante sigue en pie.
 *
 * Y resuelve la carrera de paso: bajo READ COMMITTED —el default— el INSERT
 * bloqueado por otra transacción que todavía no comiteó se destraba al commit de
 * esa otra, no inserta nada, y el SELECT posterior sí ve la fila recién comiteada.
 *
 * **Corre adentro de la transacción del artículo, no en una propia.** La
 * alternativa —una transacción separada, como hace `proximoSku`— dejaría
 * categorías fantasma cuando el alta falla después. Un hueco en la secuencia de
 * SKU no se ve nunca; una categoría vacía la ve el dueño al abrir el árbol.
 *
 * El id lo genera `gen_random_uuid()` (v4) y no el `uuid(7)` de Prisma, porque
 * el INSERT es crudo. Nada depende de la versión del uuid: `esUuid` sólo mira la
 * forma, y `test/datos.ts` ya inserta tenants y usuarios así.
 */
export async function asegurarCategoria(
  tx: ClienteTx,
  tenantId: string,
  texto: string | null | undefined,
): Promise<string | null> {
  const partida = partirCategoria(texto)
  if (partida === null) return null

  const raizId = await asegurarFila(tx, tenantId, partida.raiz, null)
  if (partida.hija === null) return raizId
  return asegurarFila(tx, tenantId, partida.hija, raizId)
}

/** Una fila del árbol, buscada o creada. `padreId` null es una raíz. */
async function asegurarFila(
  tx: ClienteTx,
  tenantId: string,
  nombre: string,
  padreId: string | null,
): Promise<string> {
  const insertadas = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${nombre}, ${padreId}::uuid, now(), now())
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  if (insertadas.length > 0) return insertadas[0].id

  // No insertó: ya existía. `IS NOT DISTINCT FROM` y no `=` porque padre_id es
  // NULL en las raíces, y `NULL = NULL` no es true.
  const existentes = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM categorias
     WHERE tenant_id = ${tenantId}::uuid
       AND nombre = ${nombre}
       AND padre_id IS NOT DISTINCT FROM ${padreId}::uuid
     LIMIT 1
  `
  if (existentes.length === 0) {
    // Inalcanzable salvo que la fila se haya borrado entre las dos sentencias,
    // que adentro de una transacción con la fila bloqueada no puede pasar.
    // Explícito igual: un `existentes[0].id` sobre un array vacío sería un
    // TypeError sin nada que lo explique.
    throw new ErrorDeInventario(
      'CATEGORIA_INDETERMINADA',
      `no se pudo resolver la categoría ${nombre}`,
    )
  }
  return existentes[0].id
}
```

Sumar el import de `ErrorDeInventario` desde `./errores` al principio del
archivo. Verificar que `lib/inventario/errores.ts` acepte un código nuevo; si
los códigos son un tipo cerrado, agregar `CATEGORIA_INDETERMINADA` a la unión.

- [ ] **Step 4: Engancharla en `crearArticulo` y `editarArticulo`**

En `lib/inventario/articulos.ts`:

- Importar `asegurarCategoria` desde `./categorias`.
- En `crearArticulo`, adentro de la transacción, **antes** del
  `tx.articulo.create`, resolver el id y pasarlo al `data`:

```ts
        const categoriaId = await asegurarCategoria(tx, tenantId, categoria)

        const articulo = await tx.articulo.create({
          data: { tenantId, sku, nombre, tipo, precio, categoria, categoriaId },
        })
```

- En `editarArticulo`, adentro de la transacción, antes del `updateMany`:

```ts
      const categoriaId = await asegurarCategoria(tx, tenantId, categoria)

      const { count } = await tx.articulo.updateMany({
        where: { id: articuloId },
        data: { nombre, sku, precio, categoria, categoriaId },
      })
```

Actualizar el comentario de `EntradaCrearArticulo.categoria`, que hoy dice
"String libre, sin tabla ni jerarquía": dejó de ser cierto. Sigue llegando como
texto, pero ahora además arma el árbol.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npx vitest run test/inventario.test.ts lib/inventario/categorias.test.ts`
Expected: PASS, incluidos los casos de categoría que ya existían — el texto se
tiene que seguir guardando igual.

- [ ] **Step 6: Commit**

```bash
git add lib/inventario/categorias.ts lib/inventario/articulos.ts test/inventario.test.ts
git commit -m "feat(categorías): el alta y la edición arman el árbol desde el texto"
```

---

### Task 4: el backfill de lo que ya está cargado

**Files:**
- Modify: `prisma/migrations/<timestamp>_categorias/migration.sql`
- Create: `test/categorias-backfill.test.ts`

**Interfaces:**
- Consumes: la tabla de Task 2.

- [ ] **Step 1: Escribir el test que falla**

La base de los tests arranca vacía, así que `migrate deploy` nunca ejercita este
SQL con datos adentro. El test **lee el bloque del archivo de migración y lo
ejecuta** contra artículos sembrados a mano: es el SQL exacto que va a correr en
producción, no una reimplementación paralela que puede diverger. Mismo criterio
que `scripts/definir-clave.binario.test.ts`, que spawnea el binario real.

Crear `test/categorias-backfill.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'
import { crearTenant } from './datos'

const INICIO = '-- >>> BACKFILL'
const FIN = '-- <<< BACKFILL'

/** El bloque de backfill, extraído del archivo de migración real. */
function sqlDelBackfill(): string {
  const base = join(process.cwd(), 'prisma/migrations')
  const dir = readdirSync(base).find((d) => d.endsWith('_categorias'))
  expect(dir, 'no está la migración _categorias').toBeTruthy()
  const sql = readFileSync(join(base, dir!, 'migration.sql'), 'utf8')
  const desde = sql.indexOf(INICIO)
  const hasta = sql.indexOf(FIN)
  expect(desde, 'la migración no tiene el marcador de inicio del backfill').toBeGreaterThan(-1)
  expect(hasta, 'la migración no tiene el marcador de fin del backfill').toBeGreaterThan(desde)
  return sql.slice(desde + INICIO.length, hasta)
}

let cliente: Client
let tenantId: string
let otroId: string

async function sembrar(tenant: string, sku: string, categoria: string | null): Promise<string> {
  const { rows } = await cliente.query(
    `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, stock, categoria, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $2, $2, 'PRODUCTO', 1000, 0, $3, now(), now())
     RETURNING id`,
    [tenant, sku, categoria],
  )
  return rows[0].id
}

async function ramaDe(articuloId: string): Promise<string | null> {
  const { rows } = await cliente.query(
    `SELECT coalesce(p.nombre || ' · ', '') || c.nombre AS rama
       FROM articulos a
       JOIN categorias c ON c.id = a.categoria_id
       LEFT JOIN categorias p ON p.id = c.padre_id
      WHERE a.id = $1`,
    [articuloId],
  )
  return rows.length === 0 ? null : rows[0].rama
}

beforeAll(async () => {
  cliente = new Client({ connectionString: urlOwner() })
  await cliente.connect()
  tenantId = await crearTenant(cliente, 'backfill-uno')
  otroId = await crearTenant(cliente, 'backfill-dos')
})

afterAll(async () => {
  await cliente.end()
})

describe('el backfill de categorías', () => {
  it('convierte el texto libre en el árbol y engancha cada artículo', async () => {
    const conMarca = await sembrar(tenantId, 'B-001', 'Fundas · Samsung')
    const otraMarca = await sembrar(tenantId, 'B-002', 'Fundas · Motorola')
    const hermano = await sembrar(tenantId, 'B-003', 'Fundas · Samsung')
    const sinMarca = await sembrar(tenantId, 'B-004', 'Cables')
    const pegado = await sembrar(tenantId, 'B-005', 'Cargadores·Xiaomi')
    const tresNiveles = await sembrar(tenantId, 'B-006', 'Accesorios · Fundas · Samsung')
    const raizVacia = await sembrar(tenantId, 'B-007', '· Genéricos')
    const sinNada = await sembrar(tenantId, 'B-008', null)
    const soloEspacios = await sembrar(tenantId, 'B-009', '   ')
    // El local de al lado con la MISMA categoría: tiene que quedar con su
    // propia fila, no compartir la del otro.
    const ajeno = await sembrar(otroId, 'B-010', 'Fundas · Samsung')

    await cliente.query(sqlDelBackfill())

    expect(await ramaDe(conMarca)).toBe('Fundas · Samsung')
    expect(await ramaDe(otraMarca)).toBe('Fundas · Motorola')
    expect(await ramaDe(sinMarca)).toBe('Cables')
    expect(await ramaDe(pegado)).toBe('Cargadores · Xiaomi')
    expect(await ramaDe(tresNiveles)).toBe('Accesorios · Fundas · Samsung')
    expect(await ramaDe(raizVacia)).toBe('Genéricos')
    expect(await ramaDe(sinNada)).toBeNull()
    expect(await ramaDe(soloEspacios)).toBeNull()

    // Dos artículos de la misma categoría comparten la fila.
    const { rows: comp } = await cliente.query(
      `SELECT categoria_id FROM articulos WHERE id = ANY($1::uuid[])`,
      [[conMarca, hermano]],
    )
    expect(comp[0].categoria_id).toBe(comp[1].categoria_id)

    // "Fundas" es UNA raíz por tenant, no una por artículo.
    const { rows: raices } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias
        WHERE tenant_id = $1 AND nombre = 'Fundas' AND padre_id IS NULL`,
      [tenantId],
    )
    expect(raices[0].n).toBe(1)

    // ...y el local de al lado tiene la suya, distinta.
    const { rows: ajenas } = await cliente.query(
      `SELECT a.categoria_id AS suya,
              (SELECT categoria_id FROM articulos WHERE id = $2) AS nuestra
         FROM articulos a WHERE a.id = $1`,
      [ajeno, conMarca],
    )
    expect(ajenas[0].suya).not.toBe(ajenas[0].nuestra)
    expect(await ramaDe(ajeno)).toBe('Fundas · Samsung')
  })

  // Idempotente: `deploy.sh` puede reintentar, y el test de arriba ya dejó el
  // árbol armado. Correrlo de nuevo no puede duplicar nada ni mover a nadie.
  it('correrlo dos veces no cambia nada', async () => {
    const { rows: antes } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias`,
    )
    const nuevo = await sembrar(tenantId, 'B-011', 'Fundas · Samsung')

    await cliente.query(sqlDelBackfill())

    const { rows: despues } = await cliente.query(
      `SELECT count(*)::int AS n FROM categorias`,
    )
    expect(despues[0].n).toBe(antes[0].n)
    expect(await ramaDe(nuevo)).toBe('Fundas · Samsung')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/categorias-backfill.test.ts`
Expected: FAIL — "la migración no tiene el marcador de inicio del backfill".

- [ ] **Step 3: Escribir el backfill en la migración**

Agregar al final de `prisma/migrations/<timestamp>_categorias/migration.sql`:

```sql
-- >>> BACKFILL
-- Convierte el texto libre de articulos.categoria en filas del árbol.
--
-- El CTE `nombres` se REPITE en las tres sentencias en vez de materializarse
-- en una tabla temporal, y no es descuido: un `DROP TABLE` acá haría que el
-- analizador de migraciones destructivas (.githooks/pre-commit, y el mismo
-- chequeo en deploy.sh) frene el commit. Un CTE repetido es feo; un hook
-- desactivado con --no-verify para poder commitear es peor.
--
-- La regla de parseo es la misma que `partirCategoria` en
-- lib/inventario/categorias.ts: partir por el middot, trimear, DESCARTAR los
-- vacíos, y de lo que queda el primero es la raíz y el resto —unido de
-- nuevo— es la hija. `WITH ORDINALITY … ORDER BY i` porque el orden de
-- `unnest` no está garantizado sin él, y acá el orden ES el significado.
--
-- Idempotente entero: las dos inserciones van con ON CONFLICT DO NOTHING y el
-- UPDATE toca sólo las filas con categoria_id NULL. Correrlo dos veces no
-- duplica ni mueve nada.

-- Las raíces.
WITH nombres AS (
  SELECT DISTINCT a.tenant_id, s.segs[1] AS raiz
    FROM articulos a
    CROSS JOIN LATERAL (
      SELECT array_remove(
               array(
                 SELECT btrim(t)
                   FROM unnest(string_to_array(a.categoria, '·')) WITH ORDINALITY AS u(t, i)
                  ORDER BY i
               ),
               ''
             ) AS segs
    ) s
   WHERE a.categoria IS NOT NULL
     AND array_length(s.segs, 1) >= 1
)
INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
SELECT gen_random_uuid(), n.tenant_id, n.raiz, NULL, now(), now()
  FROM nombres n
ON CONFLICT DO NOTHING;

-- Las hijas, colgadas de la raíz que la sentencia anterior dejó lista.
WITH nombres AS (
  SELECT DISTINCT
         a.tenant_id,
         s.segs[1] AS raiz,
         nullif(array_to_string(s.segs[2:], ' · '), '') AS hija
    FROM articulos a
    CROSS JOIN LATERAL (
      SELECT array_remove(
               array(
                 SELECT btrim(t)
                   FROM unnest(string_to_array(a.categoria, '·')) WITH ORDINALITY AS u(t, i)
                  ORDER BY i
               ),
               ''
             ) AS segs
    ) s
   WHERE a.categoria IS NOT NULL
     AND array_length(s.segs, 1) >= 1
)
INSERT INTO categorias (id, tenant_id, nombre, padre_id, creado_en, actualizado_en)
SELECT gen_random_uuid(), n.tenant_id, n.hija, p.id, now(), now()
  FROM nombres n
  JOIN categorias p
    ON p.tenant_id = n.tenant_id AND p.nombre = n.raiz AND p.padre_id IS NULL
 WHERE n.hija IS NOT NULL
ON CONFLICT DO NOTHING;

-- Y cada artículo apuntando a su hoja — o a su raíz, si no tiene hija.
WITH nombres AS (
  SELECT DISTINCT
         a.tenant_id,
         a.categoria,
         s.segs[1] AS raiz,
         nullif(array_to_string(s.segs[2:], ' · '), '') AS hija
    FROM articulos a
    CROSS JOIN LATERAL (
      SELECT array_remove(
               array(
                 SELECT btrim(t)
                   FROM unnest(string_to_array(a.categoria, '·')) WITH ORDINALITY AS u(t, i)
                  ORDER BY i
               ),
               ''
             ) AS segs
    ) s
   WHERE a.categoria IS NOT NULL
     AND array_length(s.segs, 1) >= 1
)
UPDATE articulos a
   SET categoria_id = coalesce(h.id, p.id)
  FROM nombres n
  JOIN categorias p
    ON p.tenant_id = n.tenant_id AND p.nombre = n.raiz AND p.padre_id IS NULL
  LEFT JOIN categorias h
    ON h.tenant_id = n.tenant_id AND h.padre_id = p.id AND h.nombre = n.hija
 WHERE a.tenant_id = n.tenant_id
   AND a.categoria = n.categoria
   AND a.categoria_id IS NULL;
-- <<< BACKFILL
```

- [ ] **Step 4: Correr el test y verificar que pasa**

La migración ya se aplicó a la base efímera en la corrida anterior, así que hay
que forzar que se recree: `npx vitest run test/categorias-backfill.test.ts`
levanta el contenedor de cero en el `globalSetup`.

Run: `npx vitest run test/categorias-backfill.test.ts`
Expected: PASS, los dos casos.

- [ ] **Step 5: Verificar que el hook de pre-commit no frena la migración**

Run: `git add prisma/migrations && bash .githooks/pre-commit`
Expected: sale 0. Si frena, el mensaje dice qué patrón lo disparó — resolverlo
sin `--no-verify`.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations test/categorias-backfill.test.ts
git commit -m "feat(categorías): el backfill de lo que ya estaba cargado"
```

---

### Task 5: documentación y verificación final

**Files:**
- Modify: `docs/schema.md` (generado, no se edita a mano)
- Modify: `CLAUDE.md`
- Modify: `docs/pantallas.md`
- Modify: `docs/correcciones-pendientes-del-pen.md`

- [ ] **Step 1: Regenerar el diagrama de la base**

```bash
scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md
```

Verificar después con `--verificar`, que es lo que corre el paso 3 de
`deploy.sh`: sin esto, el gate del deploy falla por un archivo desactualizado.

- [ ] **Step 2: Corregir `CLAUDE.md`**

El documento hoy dice, en *Próximos pasos técnicos*, que `Articulo.categoria`
es **"texto libre, no una tabla — un rubro con veinte artículos no necesita un
catálogo de categorías para mantener, y agregar la tabla más adelante sigue
siendo aditivo si hiciera falta"**. Este ciclo revierte esa decisión, así que
la entrada tiene que decirlo: qué la revirtió (feedback de un cliente pidiendo
ver el stock por rubro y marca), que la puerta que ese párrafo dejaba abierta
se cruzó, y que el ciclo trae el modelo sin UI por expand/contract.

Agregar también la entrada del ciclo con lo que decidió: dos niveles fijos con
auto-relación, un artículo colgando de raíz o de hoja, la unicidad en dos
índices, y que el texto se sigue escribiendo hasta el deploy del contract.

- [ ] **Step 3: Anotar la deuda con la maqueta**

En `docs/correcciones-pendientes-del-pen.md`, agregar una entrada nueva:
`design/arandano.pen` no dibuja ningún panel de categorías, y el ciclo de la UI
va a construir uno. Decir qué frame lo necesita (`pb32f`, `App / Inventario`) y
qué tiene que aparecer, para que quien lo abra en Pencil sepa qué dibujar.

- [ ] **Step 4: Actualizar `docs/pantallas.md`**

Ninguna pantalla cambia de comportamiento visible, así que **no** hay sección
nueva. Sí corresponde una línea en las decisiones de `/inventario/nuevo` y de
`/inventario/[id]`: el campo de categoría sigue siendo texto libre en la
pantalla, pero al guardar arma el árbol por detrás.

Correr `npx vitest run test/pantallas.test.ts` para confirmar que el archivo
sigue atado a `app/**/page.tsx` en las dos direcciones.

- [ ] **Step 5: La suite completa**

Run: `npm test`
Expected: todo verde, tests de bash incluidos.

- [ ] **Step 6: Typecheck y lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: sin errores. Son dos pasos del gate de `deploy.sh`.

- [ ] **Step 7: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs(categorías): el schema, la decisión revertida y la deuda con la maqueta"
```
