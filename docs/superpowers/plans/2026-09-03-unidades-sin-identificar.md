# Unidades sin identificar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un artículo pueda manejarse por IMEI sin exigir que el local
identifique todas sus unidades de una sentada — el IMEI se carga cuando el
equipo aparece, y sobre todo cuando se vende.

**Architecture:** `UnidadDeArticulo.imei` pasa a nullable. Una fila sin IMEI
significa "acá hay un teléfono, todavía no sabemos cuál", y el invariante
—`stock` es exactamente la cantidad de unidades libres— queda intacto porque
cada teléfono sigue siendo una fila. El diálogo de N campos desaparece del
producto; en su lugar hay un campo de captura con contador.

**Tech Stack:** Next.js App Router + TypeScript, Prisma 7 sobre PostgreSQL con
RLS, vitest contra una base efímera en Docker, shadcn/ui sobre Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-03-unidades-sin-identificar-design.md`
— leerlo entero antes de la Task 1.

## Global Constraints

- **Español en todo**: nombres, comentarios, mensajes de error y texto de
  pantalla. Commits en español, estilo conventional-commit.
- **`Decimal`, nunca `Float`**; un `Decimal` no cruza al cliente — se convierte
  a `string` en el borde.
- **Nada de SQL crudo para datos de tenant**: la extensión de
  `lib/tenant/prisma.ts` intercepta operaciones de MODELO, no `$queryRaw`. Un
  raw sin la GUC devuelve **cero filas en silencio** en vez de fallar.
- **Ningún permiso nuevo** (`lib/permisos/catalogo.ts` no se toca) y **ningún
  código de error nuevo** (`IMEI_REPETIDO`, `UNIDAD_NO_DISPONIBLE` e
  `IMEI_VACIO` ya cubren todo). Capturar y corregir van con `conSesion`;
  prender y apagar siguen con `ARTICULOS_EDITAR`.
- **El invariante**: `stock` = cantidad de unidades libres (`ventaId IS NULL AND
  baja_en IS NULL`), identificadas o no. Movimiento, caché de stock y fila de
  unidad se mueven juntos en una transacción o no se mueven.
- **Mobile-first con un solo corte, `lg:` (1024 px)**; el valor del teléfono va
  sin prefijo. `test/responsive.test.ts` marca anchos fijos > 362 px sin
  prefijo.
- **Una capacidad que desaparece del teléfono y no reaparece en ningún lado es
  un defecto**, no una simplificación.
- TDD: test que falla primero, visto fallar por la razón correcta, después la
  implementación.

---

### Task 1: `imei` nullable, y el índice único con nulls de por medio

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_imei_nullable/migration.sql`
- Modify: `test/schema-unidades.test.ts`

**Interfaces:**
- Consumes: el modelo `UnidadDeArticulo` que ya existe.
- Produces: `imei: string | null` en toda lectura de unidad. Lo consumen todas
  las tasks siguientes.

- [ ] **Step 1: Cambiar el schema**

En `model UnidadDeArticulo`, `imei String` pasa a `imei String?`, con el
comentario que explica qué significa un null:

```prisma
  /// NULL significa "acá hay un teléfono, todavía no sabemos cuál". No rompe el
  /// invariante: cada teléfono físico sigue siendo una fila y `stock` sigue
  /// siendo la cantidad de filas libres — lo único que puede faltar es el
  /// identificador.
  ///
  /// El índice único parcial NO necesita excluirlos: en Postgres los NULL no
  /// chocan entre sí en un índice único, así que treinta unidades sin
  /// identificar conviven mientras se sigue prohibiendo que haya dos libres con
  /// el mismo IMEI real. Es la misma propiedad de `NULL <> NULL` que en el
  /// árbol de categorías fue el problema; acá es exactamente lo que se quiere.
  imei           String?
```

- [ ] **Step 2: Generar la migración**

```bash
npx prisma migrate dev --name imei_nullable --create-only
```

El SQL tiene que ser exactamente una sentencia:

```sql
ALTER TABLE "unidades_articulo" ALTER COLUMN "imei" DROP NOT NULL;
```

Sin backfill: las unidades que ya existen tienen su IMEI y no se tocan. **No
tocar el índice `unidades_articulo_imei_libre`** — ver el comentario del schema.

- [ ] **Step 3: Escribir los casos (fallan)**

En `test/schema-unidades.test.ts`, junto a los que ya están:

```ts
it('una unidad puede nacer sin IMEI', async () => {
  const a = await crearArticulo('iPhone sin identificar')
  const u = await enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.create({
      data: { tenantId, articuloId: a.id, ingresadaPorId: usuarioId },
    }),
  )
  expect(u.imei).toBeNull()
})

it('MUCHAS unidades sin identificar conviven: los NULL no chocan entre sí', async () => {
  // Es la propiedad de la que depende todo el ciclo. Si alguien "arreglara" el
  // índice agregándole AND imei IS NOT NULL creyendo que hace falta, este caso
  // seguiría pasando — por eso abajo va también la mitad que sí discrimina.
  const a = await crearArticulo('iPhone 13 lote')
  for (let i = 0; i < 5; i++) {
    await enTransaccionDeTenant(tenantId, (tx) =>
      tx.unidadDeArticulo.create({
        data: { tenantId, articuloId: a.id, ingresadaPorId: usuarioId },
      }),
    )
  }
  expect(await unidadesLibres(tenantId, a.id)).toHaveLength(5)
})

it('y el índice SIGUE frenando dos libres con el mismo IMEI real', async () => {
  const a = await crearArticulo('iPhone 14 lote')
  const imei = `IMEI-${crypto.randomUUID()}`
  await crearUnidad(a.id, imei)
  await expect(crearUnidad(a.id, imei)).rejects.toThrow()
})
```

- [ ] **Step 4: Correr los tests — tienen que fallar**

```bash
npx vitest run test/schema-unidades.test.ts
```

Esperado: FAIL, la columna todavía es `NOT NULL`.

- [ ] **Step 5: Aplicar y regenerar**

```bash
npx prisma migrate dev
npm run generate
```

- [ ] **Step 6: Correr los tests — tienen que pasar**

```bash
npx vitest run test/schema-unidades.test.ts test/rls-cobertura.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations test/schema-unidades.test.ts docs/schema.md
git commit -m "feat(schema): una unidad puede existir sin su IMEI todavía"
```

---

### Task 2: `prenderSerie` sin IMEIs, y `identificarUnidad`

**Files:**
- Modify: `lib/inventario/unidades.ts`
- Modify: `test/unidades.test.ts`

**Interfaces:**
- Consumes: `imei` nullable (Task 1).
- Produces:
  ```ts
  export type UnidadLibre = { id: string; imei: string | null; ingresadaEn: Date }

  // `imeis` acepta null por elemento: null crea una unidad sin identificar.
  export async function crearUnidadesEnTx(
    tx: ClienteTx,
    datos: { tenantId: string; articuloId: string; imeis: (string | null)[]; usuarioId: string },
  ): Promise<void>

  // Sin `imeis`: crea `stock - libresExistentes` unidades sin identificar.
  export async function prenderSerie(entrada: {
    tenantId: string; articuloId: string; usuarioId: string
  }): Promise<void>

  // Carga o CORRIGE el IMEI de una unidad libre.
  export async function identificarUnidad(entrada: {
    tenantId: string; unidadId: string; imei: string; usuarioId: string
  }): Promise<void>
  ```

- [ ] **Step 1: Escribir los casos (fallan)**

En `test/unidades.test.ts`:

```ts
describe('prenderSerie sin IMEIs', () => {
  it('con stock 30 crea 30 unidades sin identificar y no pide nada', async () => {
    const a = await crearArticulo('iPhone 13', '30')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const libres = await unidadesLibres(tenantId, a.id)
    expect(libres).toHaveLength(30)
    expect(libres.every((u) => u.imei === null)).toBe(true)
    expect((await leerArticulo(a.id)).llevaSerie).toBe(true)
  })

  it('crea sólo la DIFERENCIA cuando ya hay unidades libres', async () => {
    // El caso que la review de rama del ciclo anterior encontró como C1: una
    // unidad vuelve por una anulación mientras el switch está apagado.
    const a = await crearArticulo('iPhone 14', '3')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    await apagarSerieForzado(a.id) // helper local: baja las 3 y apaga
    await ingresarStock({ tenantId, articuloId: a.id, cantidad: d('2'), usuarioId })
    await crearUnidadSuelta(a.id) // helper local: una libre, sin serie prendida
    // stock 2, libres 1 -> crea 1
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(2)
    expect((await leerArticulo(a.id)).stock.toString()).toBe('2')
  })

  it('NO toca el stock: prender sigue sin ser un movimiento', async () => {
    const a = await crearArticulo('iPhone 15', '4')
    const antes = await contarMovimientos(a.id)
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    expect((await leerArticulo(a.id)).stock.toString()).toBe('4')
    expect(await contarMovimientos(a.id)).toBe(antes)
  })

  it('rechaza si el stock quedó por DEBAJO de las unidades libres', async () => {
    // No se puede crear una cantidad negativa. La salida es dar de baja las
    // sobrantes desde la card, que ahora se muestra con el switch apagado.
    const a = await crearArticuloConLibresDeMas() // helper local
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_CONTEO_NO_COINCIDE' }))
  })
})

describe('apagarSerie no cambia', () => {
  it('una unidad SIN identificar también frena el apagado: es una unidad libre', async () => {
    // El spec lo dice explícito y ninguna task lo tocaba, así que sin este caso
    // nadie nota si alguien "simplifica" el conteo a las identificadas.
    const a = await crearArticulo('iPhone 13 mini', '3')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    await expect(apagarSerie({ tenantId, articuloId: a.id })).rejects.toThrow(
      expect.objectContaining({ codigo: 'SERIE_CON_UNIDADES_LIBRES' }),
    )
  })
})

describe('identificarUnidad', () => {
  it('carga el IMEI de una unidad sin identificar', async () => {
    const a = await crearArticulo('iPhone 12', '2')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const [u] = await unidadesLibres(tenantId, a.id)
    await identificarUnidad({ tenantId, unidadId: u.id, imei: '355000000000001', usuarioId })
    const despues = await unidadesLibres(tenantId, a.id)
    expect(despues.find((x) => x.id === u.id)?.imei).toBe('355000000000001')
  })

  it('CORRIGE el IMEI de una unidad que ya tenía uno, mientras esté libre', async () => {
    const a = await crearArticuloConSerie('iPhone 11', ['355111111111111'])
    const [u] = await unidadesLibres(tenantId, a.id)
    await identificarUnidad({ tenantId, unidadId: u.id, imei: '355222222222222', usuarioId })
    expect((await leerUnidad(u.id)).imei).toBe('355222222222222')
  })

  it('NO deja corregir una unidad ya vendida', async () => {
    // La otra mitad, que es la que se olvida.
    const a = await crearArticuloConSerie('iPhone X', ['355333333333333'])
    const [u] = await unidadesLibres(tenantId, a.id)
    await venderUnidad(a.id, u.id) // helper local, por el motor
    await expect(
      identificarUnidad({ tenantId, unidadId: u.id, imei: '355444444444444', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_NO_DISPONIBLE' }))
  })

  it('rechaza un IMEI que ya tiene otra unidad libre', async () => {
    const a = await crearArticuloConSerie('iPhone SE', ['355555555555555'])
    await ingresarStock({ tenantId, articuloId: a.id, cantidad: d('1'), usuarioId })
    const sinId = (await unidadesLibres(tenantId, a.id)).find((u) => u.imei === null)!
    await expect(
      identificarUnidad({ tenantId, unidadId: sinId.id, imei: '355555555555555', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEI_REPETIDO' }))
  })

  it('rechaza un IMEI vacío', async () => {
    const a = await crearArticulo('iPhone XR', '1')
    await prenderSerie({ tenantId, articuloId: a.id, usuarioId })
    const [u] = await unidadesLibres(tenantId, a.id)
    await expect(
      identificarUnidad({ tenantId, unidadId: u.id, imei: '   ', usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEI_VACIO' }))
  })
})
```

Los helpers locales (`apagarSerieForzado`, `crearUnidadSuelta`,
`crearArticuloConLibresDeMas`, `venderUnidad`, `leerUnidad`) se escriben en el
mismo archivo, siguiendo los que ya están ahí.

- [ ] **Step 2: Correr — tienen que fallar**

```bash
npx vitest run test/unidades.test.ts
```

- [ ] **Step 3: Implementar**

`crearUnidadesEnTx` acepta `(string | null)[]` y mapea cada elemento a `imei`.
La traducción del `P2002` a `IMEI_REPETIDO` que ya tiene **se mantiene tal
cual**: es la que evita que un choque salga como 500 y que `crearArticulo` lo
culpe al SKU.

`prenderSerie` pierde `imeis` y pasa a:

```ts
      const libresExistentes = await tx.unidadDeArticulo.count({
        where: { articuloId, ventaId: null, bajaEn: null },
      })
      const faltan = stock.minus(libresExistentes)
      if (faltan.lessThan(0)) {
        throw new ErrorDeInventario(
          'SERIE_CONTEO_NO_COINCIDE',
          `${articulo.nombre} tiene ${libresExistentes} unidades cargadas y sólo ` +
            `${stock} en stock: dá de baja las que sobran antes de manejarlo por IMEI`,
        )
      }
      await crearUnidadesEnTx(tx, {
        tenantId, articuloId, usuarioId,
        imeis: Array.from({ length: faltan.toNumber() }, () => null),
      })
```

La validación de stock entero y no negativo **se mantiene**.

`identificarUnidad` nuevo, con el mismo recurso contra la carrera que
`darDeBajaUnidad` — la condición viaja DENTRO del `updateMany`:

```ts
export async function identificarUnidad(entrada: {
  tenantId: string
  unidadId: string
  imei: string
  usuarioId: string
}): Promise<void> {
  const { tenantId, unidadId, usuarioId } = entrada
  const imei = normalizarImei(entrada.imei)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)

      // Sólo mientras esté LIBRE. Una vez vendida o dada de baja el IMEI queda
      // congelado, por lo mismo que VentaItem congela descripción y precio: la
      // venta de marzo tiene que seguir diciendo qué equipo salió.
      //
      // La condición va DENTRO del updateMany y no en un `if` sobre un
      // findUnique: leer y después decidir deja una ventana entre las dos
      // sentencias. Mismo recurso que `darDeBajaUnidad`.
      const tocadas = await tx.unidadDeArticulo.updateMany({
        where: { id: unidadId, ventaId: null, bajaEn: null },
        data: { imei },
      })
      if (tocadas.count !== 1) {
        const existe = await tx.unidadDeArticulo.findUnique({ where: { id: unidadId } })
        if (!existe) {
          throw new ErrorDeInventario(
            'UNIDAD_INEXISTENTE',
            `la unidad ${unidadId} no existe en este tenant`,
          )
        }
        throw new ErrorDeInventario(
          'UNIDAD_NO_DISPONIBLE',
          'ese equipo ya salió del stock: su IMEI no se puede cambiar',
        )
      }
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
```

**El choque contra el índice** al escribir un IMEI que ya tiene otra unidad libre
sale como `P2002` desde este `updateMany`, así que `identificarUnidad` necesita
su propia traducción a `IMEI_REPETIDO` — la de `crearUnidadesEnTx` no lo cubre,
porque ésta no pasa por ahí. Traducir sólo (nunca consultar) dentro del catch: la
violación aborta la transacción.

- [ ] **Step 4: Correr — tienen que pasar**

```bash
npx vitest run test/unidades.test.ts test/inventario.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/unidades.ts test/unidades.test.ts
git commit -m "feat(inventario): prender el switch no pide IMEIs, y una unidad se identifica después"
```

---

### Task 3: el ingreso de mercadería acepta cantidad o IMEIs

**Files:**
- Modify: `lib/inventario/stock.ts`
- Modify: `test/inventario.test.ts`

**Interfaces:**
- Consumes: `crearUnidadesEnTx` con `(string | null)[]` (Task 2).
- Produces: `ingresarStock` acepta `cantidad` **o** `imeis` también en artículos
  con serie; con `cantidad`, las unidades nacen sin identificar.

- [ ] **Step 1: Escribir los casos (fallan)**

```ts
it('un artículo con serie acepta una cantidad suelta: nacen sin identificar', async () => {
  const a = await crearArticuloConSerie('iPhone 13', ['355000000000001'])
  await ingresarStock({ tenantId, articuloId: a.id, cantidad: d('10'), usuarioId })
  expect((await leerArticulo(a.id)).stock.toString()).toBe('11')
  const libres = await unidadesLibres(tenantId, a.id)
  expect(libres).toHaveLength(11)
  expect(libres.filter((u) => u.imei === null)).toHaveLength(10)
})

it('y sigue aceptando la lista, con las unidades identificadas', async () => {
  const a = await crearArticuloConSerie('iPhone 14', [])
  await ingresarStock({ tenantId, articuloId: a.id, imeis: ['A1', 'A2'], usuarioId })
  expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei).sort()).toEqual(['A1', 'A2'])
})

it('pero NO las dos juntas', async () => {
  const a = await crearArticuloConSerie('iPhone 15', [])
  await expect(
    ingresarStock({ tenantId, articuloId: a.id, cantidad: d('2'), imeis: ['B1'], usuarioId }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_REQUIERE_IMEIS' }))
})

it('un artículo SIN serie sigue rechazando IMEIs', async () => {
  const a = await crearArticulo('Funda', '0')
  await expect(
    ingresarStock({ tenantId, articuloId: a.id, imeis: ['C1'], usuarioId }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEIS_SIN_SERIE' }))
})
```

- [ ] **Step 2: Correr — tienen que fallar**

```bash
npx vitest run test/inventario.test.ts
```

- [ ] **Step 3: Implementar**

En la rama `articulo.llevaSerie` de `ingresarStock`, la regla pasa a ser
exactamente una de las dos, no `imeis` obligatorio:

```ts
      if (articulo.llevaSerie) {
        // Decir CUÁNTOS entran es obligatorio; decir CUÁLES son, no. Con la
        // lista nacen identificadas; con la cantidad, sin identificar y se
        // completan cuando aparezcan las cajas —o al venderlas, que es cuando
        // el equipo está en la mano.
        if (imeis !== undefined && cantidad !== undefined) {
          throw new ErrorDeInventario(
            'SERIE_REQUIERE_IMEIS',
            `${articulo.nombre}: mandá la lista de IMEI o la cantidad, no las dos`,
          )
        }
      } else if (imeis !== undefined) {
        throw new ErrorDeInventario(
          'IMEIS_SIN_SERIE',
          `${articulo.nombre} no se maneja por IMEI`,
        )
      }
```

Y donde hoy llama a `crearUnidadesEnTx` con la lista, pasa a llamarlo con la
lista **o** con `Array.from({ length: cantidadEfectiva.toNumber() }, () => null)`
cuando vino `cantidad`.

- [ ] **Step 4: Correr — tienen que pasar**

```bash
npx vitest run test/inventario.test.ts test/unidades.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/inventario/stock.ts test/inventario.test.ts
git commit -m "feat(inventario): recibir mercadería con serie no obliga a escanear"
```

---

### Task 4: vender una unidad sin identificar, y capturar el IMEI al vender

**Files:**
- Modify: `lib/ventas/crear.ts`
- Modify: `lib/ventas/buscar.ts`
- Modify: `test/ventas.test.ts`
- Modify: `test/buscar-por-imei.test.ts`

**Interfaces:**
- Consumes: `imei` nullable (Task 1), `identificarUnidad` (Task 2).
- Produces: `ItemDeVenta` gana `imeiCapturado?: string` — el IMEI que quien
  cobra escaneó en el momento de vender una unidad sin identificar. Lo consume
  la Task 7.

- [ ] **Step 1: Escribir los casos (fallan)**

`crearArticuloConStockSinIdentificar(nombre, cuantas, precio)` y `leerUnidad`
son helpers locales nuevos de `test/ventas.test.ts`: el primero crea el
artículo, le prende la serie y deja N unidades sin identificar; seguí las
convenciones de fixtures que ese archivo ya tiene.

```ts
it('vender una unidad SIN identificar funciona y no registra IMEI', async () => {
  const a = await crearArticuloConStockSinIdentificar('iPhone 13', 2, '500000')
  const [u] = await unidadesLibres(tenantId, a.id)
  const venta = await crearVenta({
    tenantId, usuarioId,
    items: [{ articuloId: a.id, cantidad: d('1'), unidadId: u.id }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
  })
  expect((await leerUnidad(u.id)).ventaId).toBe(venta.id)
  expect((await leerUnidad(u.id)).imei).toBeNull()
  expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
})

it('con imeiCapturado, la unidad queda identificada por la misma venta', async () => {
  const a = await crearArticuloConStockSinIdentificar('iPhone 14', 1, '500000')
  const [u] = await unidadesLibres(tenantId, a.id)
  await crearVenta({
    tenantId, usuarioId,
    items: [{ articuloId: a.id, cantidad: d('1'), unidadId: u.id, imeiCapturado: '355000000000009' }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
  })
  expect((await leerUnidad(u.id)).imei).toBe('355000000000009')
})

it('un imeiCapturado que ya tiene otra unidad libre rechaza la venta entera', async () => {
  // Y no deja media venta: el stock no se movió.
  const a = await crearArticuloConSerie('iPhone 15', ['355777777777777'], '500000')
  await ingresarStock({ tenantId, articuloId: a.id, cantidad: d('1'), usuarioId })
  const sinId = (await unidadesLibres(tenantId, a.id)).find((u) => u.imei === null)!
  const stockAntes = (await leerArticulo(a.id)).stock.toString()
  await expect(
    crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: a.id, cantidad: d('1'), unidadId: sinId.id, imeiCapturado: '355777777777777' }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
    }),
  ).rejects.toThrow()
  expect((await leerArticulo(a.id)).stock.toString()).toBe(stockAntes)
})

it('el buscador por IMEI ignora las unidades sin identificar', async () => {
  // En test/buscar-por-imei.test.ts. Escanear no puede traer una unidad cuyo
  // IMEI no conocemos, y buscar por cadena vacía tampoco.
  const a = await crearArticuloConStockSinIdentificar('iPhone 12', 3, '500000')
  expect(await buscarArticulosVendibles(tenantId, '')).toHaveLength(0)
})
```

- [ ] **Step 2: Correr — tienen que fallar**

```bash
npx vitest run test/ventas.test.ts test/buscar-por-imei.test.ts
```

- [ ] **Step 3: Implementar**

`ItemDeVenta` gana:

```ts
  /**
   * El IMEI que quien cobra escaneó al vender una unidad sin identificar. Es
   * OPCIONAL a propósito: exigirlo convertiría cada venta en un trámite con el
   * cliente esperando, que es la fricción que este ciclo existe para sacar.
   * Sin él, la venta dice honestamente que no se sabe qué equipo salió.
   */
  imeiCapturado?: string
```

En el bucle que ya toma la unidad (`updateMany` condicional), cuando el ítem
trae `imeiCapturado` se escribe **en el mismo `updateMany`** — no en una
sentencia aparte: es la misma fila, la misma transacción y el mismo lock, y
partirlo abriría una ventana entre tomar la unidad e identificarla.

```ts
            data: {
              ventaId: venta.id,
              ...(l.imeiCapturado !== undefined ? { imei: l.imeiCapturado } : {}),
            },
```

El `imeiCapturado` se normaliza con `normalizarImei` **antes** de la
transacción, junto al resto de las validaciones de dominio de los ítems, para
que un valor vacío falle temprano y no a mitad de la venta.

El choque contra el índice sale como `P2002`; `traducirErrorDeBase` de
`lib/ventas/errores.ts` **no lo traduce hoy**, así que hay que sumarlo ahí con
`UNIDAD_NO_DISPONIBLE` y un mensaje que diga que ese IMEI ya está en stock —
mismo criterio que `anularVenta` ya aplica para su propio P2002.

En `lib/ventas/buscar.ts`, la búsqueda por IMEI exacto suma `imei: { not: null }`
al `where`. Sin eso, `buscarArticulosVendibles(tenant, '')` no matchea nada
porque el texto vacío ya retorna temprano — pero la guarda hace explícito que una
unidad sin identificar no es alcanzable por escaneo, que es lo que el caso
afirma.

- [ ] **Step 4: Correr — tienen que pasar**

```bash
npx vitest run test/ventas.test.ts test/buscar-por-imei.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/ventas test/ventas.test.ts test/buscar-por-imei.test.ts
git commit -m "feat(ventas): vender una unidad sin identificar, capturando el IMEI si aparece"
```

---

### Task 5: `ListaDeImeis` pierde `filasFijas`, y el alta se vuelve progresiva

**Files:**
- Modify: `app/(app)/inventario/lista-de-imeis.tsx`
- Modify: `app/(app)/inventario/lista-de-imeis.test.tsx`
- Modify: `app/(app)/inventario/formularios.tsx` (`FormularioDeAlta`)
- Modify: `app/(app)/inventario/acciones.ts` (`altaArticulo`)
- Modify: `lib/inventario/articulos.ts` (`crearArticulo`)
- Modify: `app/(app)/inventario/formularios.test.tsx`, `acciones.test.ts`

**Interfaces:**
- Consumes: `crearUnidadesEnTx` con `(string | null)[]` (Task 2).
- Produces: `ListaDeImeis` sin `filasFijas` — su única firma pasa a ser
  `{ etiqueta?: string }`. La Task 6 la instancia así.

- [ ] **Step 1: Escribir los casos (fallan)**

En `app/(app)/inventario/acciones.test.ts`:

```ts
it('el alta con serie y MENOS IMEIs que stock completa con unidades sin identificar', async () => {
  const datos = new FormData()
  datos.set('nombre', 'iPhone 13 lote')
  datos.set('precio', '500000')
  datos.set('tipo', 'PRODUCTO')
  datos.set('moneda', 'ARS')
  datos.set('llevaSerie', 'on')
  datos.set('stockInicial', '10')
  datos.append('imeis', '355000000000001')
  datos.append('imeis', '355000000000002')

  const estado = await altaArticulo(INICIAL, datos)
  expect(estado.error).toBeNull()

  const a = await buscarPorNombre('iPhone 13 lote')
  expect(a.stock.toString()).toBe('10')
  const libres = await unidadesLibres(tenantId, a.id)
  expect(libres).toHaveLength(10)
  expect(libres.filter((u) => u.imei !== null).map((u) => u.imei).sort()).toEqual([
    '355000000000001',
    '355000000000002',
  ])
})

it('el alta con serie y MÁS IMEIs que stock se rechaza', async () => {
  // El stock inicial es el que manda: no se pueden identificar equipos que
  // no entraron.
  const datos = new FormData()
  datos.set('nombre', 'iPhone 14 lote')
  datos.set('precio', '500000')
  datos.set('tipo', 'PRODUCTO')
  datos.set('moneda', 'ARS')
  datos.set('llevaSerie', 'on')
  datos.set('stockInicial', '1')
  datos.append('imeis', '355000000000003')
  datos.append('imeis', '355000000000004')

  const estado = await altaArticulo(INICIAL, datos)
  expect(estado.error).not.toBeNull()
  await expect(buscarPorNombre('iPhone 14 lote')).resolves.toBeNull()
})
```

En `app/(app)/inventario/lista-de-imeis.test.tsx`, los casos de `filasFijas`
se **borran** y queda fijado por fuente que el modo ya no existe:

```ts
it('no queda ningún rastro del modo de filas fijas', () => {
  // Lo borró el ciclo de unidades sin identificar: ya no hay ningún lugar del
  // producto donde se pidan N campos de una. Con él se fue el avance de foco
  // por índice, que dependía de que la fila tuviera exactamente un input.
  const fuente = readFileSync('app/(app)/inventario/lista-de-imeis.tsx', 'utf8')
  expect(fuente).not.toContain('filasFijas')
  expect(fuente).not.toContain('querySelectorAll')
})
```

- [ ] **Step 2: Correr — tienen que fallar**

```bash
npx vitest run "app/(app)/inventario"
```

- [ ] **Step 3: Sacar `filasFijas` de `ListaDeImeis`**

Queda sólo el modo libre: arranca con una fila, Enter agrega otra y la enfoca,
"Agregar otro" y la `x` por fila siguen igual. Se borran `filasFijas`,
`avanzarFoco`, el `contenedor` ref y todas sus guardas.

- [ ] **Step 4: `crearArticulo` completa la diferencia**

`EntradaCrearArticulo.imeis` pasa a ser **parcial**: con `llevaSerie`, si
`imeis.length < stockInicial` el resto nace sin identificar; si es mayor, se
rechaza con `SERIE_CONTEO_NO_COINCIDE` y un mensaje que diga que el stock
inicial es el que manda. `stockInicial` deja de estar prohibido junto a
`llevaSerie` — pasa a ser el número que gobierna, y sin él la cantidad es la
longitud de la lista.

- [ ] **Step 5: El alta postea las dos cosas**

`altaArticulo` deja de excluir `stockInicial` cuando `llevaSerie`, y sigue
leyendo `imeis` con `getAll`. El formulario muestra, con el switch prendido, el
campo de cantidad **y** la lista progresiva, con la leyenda de que lo que no se
escanee ahora se puede cargar después.

- [ ] **Step 6: Correr — tienen que pasar**

```bash
npx vitest run "app/(app)/inventario" test/responsive.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventario" lib/inventario/articulos.ts
git commit -m "feat(inventario): el alta escanea lo que tiene a mano y completa después"
```

---

### Task 6: la ficha — switch sin diálogo y card con captura

**Files:**
- Modify: `app/(app)/inventario/unidades.tsx`
- Modify: `app/(app)/inventario/unidades.test.tsx`
- Modify: `app/(app)/inventario/acciones.ts`
- Modify: `app/(app)/inventario/acciones.test.ts`
- Modify: `app/(app)/inventario/[id]/page.tsx`

**Interfaces:**
- Consumes: `prenderSerie` sin `imeis` e `identificarUnidad` (Task 2);
  `ListaDeImeis` sin `filasFijas` (Task 5).
- Produces:
  ```ts
  export async function identificarUnidadAccion(
    _e: EstadoInventario, datos: FormData,
  ): Promise<EstadoInventario>   // campos: articuloId, unidadId, imei

  export function CardDeUnidades({
    articuloId,
    unidades,
  }: {
    articuloId: string
    unidades: { id: string; imei: string | null; ingresadaEn: Date }[]
  }): ReactNode

  export function SwitchDeSerie({
    articuloId, llevaSerie, puedeEditar,
  }: { articuloId: string; llevaSerie: boolean; puedeEditar: boolean }): ReactNode
  ```
  `SwitchDeSerie` **pierde `stock`**: ya no dibuja campos, así que no necesita
  saber cuántos son.

- [ ] **Step 1: Escribir los casos (fallan)**

```ts
it('el switch ya no abre ningún diálogo', () => {
  // Es el defecto que originó el ciclo: con 30 unidades el modal no entraba en
  // la pantalla. La respuesta no fue ponerle scroll, fue sacarlo.
  const fuente = readFileSync('app/(app)/inventario/unidades.tsx', 'utf8')
  expect(fuente).not.toContain('DialogContent')
})

it('la card muestra el bloque de captura con el contador', () => {
  const html = renderCard([
    { id: 'u1', imei: null, ingresadaEn: new Date('2026-09-01T12:00:00Z') },
    { id: 'u2', imei: null, ingresadaEn: new Date('2026-09-01T12:00:00Z') },
    { id: 'u3', imei: '355000000000001', ingresadaEn: new Date('2026-09-01T12:00:00Z') },
  ])
  expect(html).toContain('2')            // el contador
  expect(html).toContain('sin identificar')
  expect(html).toContain('355000000000001')
})

it('sin unidades sin identificar, el bloque de captura no se dibuja', () => {
  const html = renderCard([{ id: 'u1', imei: 'A', ingresadaEn: new Date() }])
  expect(html).not.toContain('sin identificar')
})

it('cada unidad identificada ofrece corregir y dar de baja', () => {
  const html = renderCard([{ id: 'u1', imei: 'A', ingresadaEn: new Date() }])
  expect(html).toContain('Corregir')
  expect(html.split('Dar de baja').length - 1).toBe(1)
})

it('la lista tiene tope de alto y scrollea dentro de la card', () => {
  // Con 30 unidades la card no puede empujar la página entera.
  const html = renderCard(Array.from({ length: 30 }, (_, i) => ({
    id: `u${i}`, imei: `IMEI-${i}`, ingresadaEn: new Date(),
  })))
  expect(html).toMatch(/overflow-y-auto/)
})
```

Y en `acciones.test.ts`:

```ts
it('identificarUnidadAccion la puede hacer cualquiera con sesión', async () => {
  await comoEmpleadoSinPermisos(async () => {
    const datos = new FormData()
    datos.set('articuloId', conSerie.id)
    datos.set('unidadId', unidadSinIdentificar.id)
    datos.set('imei', '355000000000123')
    const estado = await identificarUnidadAccion(INICIAL, datos)
    expect(estado.error).toBeNull()
  })
})

it('prenderSerieAccion ya no lee imeis y sigue exigiendo ARTICULOS_EDITAR', async () => {
  await comoEmpleadoSinPermisos(async () => {
    const datos = new FormData()
    datos.set('articuloId', articuloConStock.id)
    await expect(prenderSerieAccion(INICIAL, datos)).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Correr — tienen que fallar**

```bash
npx vitest run "app/(app)/inventario"
```

- [ ] **Step 3: `SwitchDeSerie` pierde el diálogo**

Prender postea directo `prenderSerieAccion` con sólo `articuloId`. Se borran
`dialogoAbierto`, `confirmarDialogo`, `cambiarDialogo`, el `Dialog` entero y la
prop `stock`. El `try/finally` que suelta `enCurso` **se mantiene** — lo puso la
ola de arreglos de la review de rama anterior y sigue haciendo falta.

- [ ] **Step 4: `CardDeUnidades` gana el bloque de captura**

Arriba, cuando hay unidades sin identificar: el contador y **un** input
enfocado que postea contra la más vieja — que la card conoce sin consultar
nada, porque `unidadesLibres` ya viene ordenada de más vieja a más nueva:

```tsx
const sinIdentificar = unidades.filter((u) => u.imei === null)
const proxima = sinIdentificar[0]

{proxima !== undefined && (
  <form action={accionIdentificar} className="flex items-center gap-2">
    <input type="hidden" name="articuloId" value={articuloId} />
    {/* La unidad se fija acá y no la elige nadie: entre unidades sin
        identificar no hay ninguna diferencia que alguien pueda ver, así que
        pedir que elijan sería pedir una decisión que no existe. */}
    <input type="hidden" name="unidadId" value={proxima.id} />
    <Input
      name="imei"
      autoFocus
      aria-label="IMEI o número de serie"
      placeholder="Escaneá o tipeá el IMEI"
      className="h-10 rounded-[9px]"
    />
    <span className="shrink-0 text-sm text-muted-foreground">
      quedan {sinIdentificar.length} sin identificar
    </span>
  </form>
)}
```

Después de cada envío el campo se vacía y vuelve a enfocarse, que es lo que
permite escanear una caja tras otra sin tocar el mouse. Abajo, la lista de
identificadas con Corregir y Dar de baja.

Corregir es el mismo `identificarUnidadAccion` sobre esa unidad, con el campo
prellenado con el IMEI actual.

La lista lleva `max-h-[420px] overflow-y-auto`. El número se deriva y no sale
de la maqueta —el `.pen` no dibuja esta card en ningún ancho—: 420 px son unas
ocho filas, suficiente para que se vea que hay lista y poco para que empuje la
página. En el teléfono no lleva prefijo porque el tope aplica igual en los dos
anchos, y `test/responsive.test.ts` no lo marca: es un `max-h`, y un máximo
nunca puede desbordar. Ese tope es **la respuesta correcta al síntoma
original**, ahora que la causa ya no está.

- [ ] **Step 5: `identificarUnidadAccion` en `acciones.ts`**

Detrás de `conSesion` —no de `comoPuede`—, con el mismo parseo, `revalidatePath`
y `traducir(e)` que las que ya están.

- [ ] **Step 6: `page.tsx` muestra la card sin el switch prendido**

La consulta de `unidadesLibres` deja de estar condicionada a
`articulo.llevaSerie`; la card se renderiza cuando `unidades.length > 0` **o**
`articulo.llevaSerie`. Eso es lo que da la salida al caso huérfano que la review
de rama anterior dejó parked.

- [ ] **Step 7: Correr — tienen que pasar**

```bash
npx vitest run "app/(app)/inventario" test/responsive.test.ts test/pantallas.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/inventario"
git commit -m "feat(inventario): el switch prende sin diálogo y los IMEI se cargan de a uno"
```

---

### Task 7: `/vender` — una fila para las sin identificar, y captura al cobrar

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx`
- Modify: `app/(app)/vender/acciones.ts`
- Modify: `app/(app)/vender/punto-de-venta.test.tsx`, `acciones.test.ts`

**Interfaces:**
- Consumes: `ItemDeVenta.imeiCapturado` (Task 4), `UnidadLibre.imei` nullable.
- Produces: el JSON de `items` gana `imeiCapturado`.

- [ ] **Step 1: Escribir los casos (fallan)**

`renderSelector(unidades)` es un helper local nuevo: renderiza el diálogo del
selector con esas unidades, sobre el mismo andamiaje (`SidebarProvider`,
`vi.mock('./acciones')`) que el archivo ya usa.

```ts
it('el selector muestra UNA sola fila para las sin identificar, con cuántas quedan', () => {
  // Listar treinta filas idénticas es pedirle a alguien que elija entre cosas
  // indistinguibles: no hay ninguna decisión que tomar ahí.
  const html = renderSelector([
    { id: 'u1', imei: null, ingresadaEn: new Date() },
    { id: 'u2', imei: null, ingresadaEn: new Date() },
    { id: 'u3', imei: '355000000000001', ingresadaEn: new Date() },
  ])
  expect(html.split('sin identificar').length - 1).toBe(1)
  expect(html).toContain('2')
  expect(html).toContain('355000000000001')
})

it('itemsParaCobrar manda el imeiCapturado cuando se escaneó al vender', () => {
  const items = itemsParaCobrar([
    { articuloId: 'a1', unidadId: 'u1', imeiCapturado: '355000000000009', cantidad: '1', /* … */ },
  ])
  expect(items[0].imeiCapturado).toBe('355000000000009')
})

it('y lo omite cuando no se escaneó nada', () => {
  const items = itemsParaCobrar([
    { articuloId: 'a1', unidadId: 'u1', cantidad: '1', /* … */ },
  ])
  expect(items[0].imeiCapturado).toBeUndefined()
})
```

Y en `acciones.test.ts`, que `cobrar` lo pasa al motor y que un `imeiCapturado`
que no es texto útil no llega como 500.

- [ ] **Step 2: Correr — tienen que fallar**

```bash
npx vitest run "app/(app)/vender"
```

- [ ] **Step 3: Implementar**

`Linea` gana `imeiCapturado?: string`. El selector agrupa: las identificadas
como filas con su IMEI, más **una** fila "Una sin identificar — quedan N" que
toma la más vieja. Al elegirla, la línea del carrito muestra un campo para
escanear el IMEI, **opcional y saltable**, con la leyenda de que se puede dejar
en blanco.

`itemsParaCobrar` suma `imeiCapturado` al objeto cuando está presente.
`cobrar` lo lee del JSON y lo pasa a `crearVenta`; no necesita `esUuid` —es
texto libre— pero sí el mismo trato que el resto: lo que no sirve tiene que
salir como error de dominio y no como 500.

- [ ] **Step 4: Correr — tienen que pasar**

```bash
npx vitest run "app/(app)/vender" test/responsive.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/vender"
git commit -m "feat(vender): elegir una unidad sin identificar y escanearla al cobrar"
```

---

### Task 8: el detalle, la documentación y el seed

**Files:**
- Modify: `app/(app)/ventas/[id]/page.tsx` y su test
- Modify: `scripts/sembrar-catalogo-dev.mts`
- Modify: `docs/pantallas.md`, `docs/correcciones-pendientes-del-pen.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: `imei` nullable.
- Produces: nada de código hacia afuera.

- [ ] **Step 1: Escribir el caso (falla)**

```ts
it('una venta que se llevó una unidad sin identificar no muestra nada para esa línea', async () => {
  // Ni un rótulo vacío ni "sin identificar": sin dato, no hay nada que decir.
  const html = await renderDetalle(ventaConUnidadSinIdentificar)
  expect(html).not.toContain('IMEI')
})
```

- [ ] **Step 2: Correr — tiene que fallar**

```bash
npx vitest run "app/(app)/ventas"
```

- [ ] **Step 3: Filtrar los nulls en el detalle**

`imeisPorItem` descarta las unidades con `imei === null` antes de aparear. El
docblock del supuesto FIFO se actualiza: ahora la cola puede tener menos
elementos que líneas, y eso es correcto.

- [ ] **Step 4: Sembrar el caso en dev**

En `scripts/sembrar-catalogo-dev.mts`, un artículo con **30 unidades y sólo 3
identificadas** — es el caso exacto que originó el ciclo, y es contra lo que se
va a hacer la verificación visual.

- [ ] **Step 5: Documentar**

- `docs/pantallas.md`: actualizar `/inventario/nuevo`, `/inventario/[id]`,
  `/vender` y `/ventas/[id]`. Lo no obvio que hay que capturar: por qué el
  selector muestra una sola fila para las sin identificar; por qué el IMEI al
  vender se ofrece y no se exige; y que la card de Unidades se muestra aunque el
  switch esté apagado, porque es la salida al caso huérfano.
- `docs/correcciones-pendientes-del-pen.md`: el `.pen` sigue sin dibujar nada de
  esto, y ahora además el diálogo que sí se había derivado ya no existe.
- `CLAUDE.md`: entrada nueva. **Va escrita como reversión** de la decisión 2 del
  ciclo del 2026-09-02, con el motivo —salió de usarlo contra inventario real, no
  de teorizar— y con lo que la hace legítima: el invariante que aquella decisión
  protegía sigue intacto porque cada teléfono sigue siendo una fila. Y la entrada
  del ciclo anterior **no se reescribe**: queda como registro de lo que era cierto
  ese día, con la nueva apuntando a ella.

- [ ] **Step 6: El gate completo**

```bash
npm test && npm run lint && npx tsc --noEmit && npm run build
```

Los cuatro tienen que pasar, y **pasarlos no prueba que la feature ande**: este
ciclo existe porque el anterior pasó el gate entero y el modal no entraba en la
pantalla.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/ventas" scripts/sembrar-catalogo-dev.mts docs CLAUDE.md
git commit -m "feat(ventas): el detalle sólo muestra los equipos que sabemos cuáles son"
```

---

## Verificación manual, y esta vez se hace

`arandano-dev` sirve `main`, así que el obstáculo de los ciclos anteriores ya no
existe. Con el catálogo sembrado:

1. **El caso que originó todo**: prender el switch en el artículo de 30 unidades.
   Tiene que prender al instante, sin ningún modal, y la card tiene que quedar
   con "quedan 30 sin identificar". A 1440 y a 390 px.
2. Escanear tres IMEI seguidos en el campo de captura: el contador baja a 27 y
   las tres aparecen abajo, sin recargar.
3. Cerrar, volver a entrar, y comprobar que sigue en 27 — que es lo que el
   ciclo promete y lo que el diseño anterior no podía dar.
4. Corregir un IMEI ya cargado; vender esa unidad; comprobar que ya no se puede
   corregir.
5. En `/vender`, buscar el artículo por nombre: el selector tiene que mostrar
   las identificadas y **una** fila para las sin identificar.
6. Vender una sin identificar **sin** escanear nada — la venta no se tiene que
   frenar — y otra escaneando, y ver que la segunda queda identificada.
7. Un artículo sin serie: nada de esto se ve.
