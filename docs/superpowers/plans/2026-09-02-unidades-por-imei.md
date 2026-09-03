# Unidades identificadas por IMEI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que un artículo pueda manejarse por unidad física identificada (IMEI o
número de serie), de modo que el mostrador elija cuál de las unidades en stock
está vendiendo y el local sepa cuál se fue.

**Architecture:** una tabla `unidades_articulo` **encima** del stock escalar que
ya existe. `Articulo.stock` no cambia de naturaleza —sigue siendo el caché de la
suma de sus `MovimientoStock`— y para un artículo con `llevaSerie` se le suma el
invariante `stock = cantidad de unidades libres`. Todo el código que hoy lee
stock sigue funcionando sin tocarse.

**Tech Stack:** Next.js App Router + TypeScript, Prisma 7 sobre PostgreSQL con
RLS por `tenant_id`, vitest contra una base efímera en Docker, shadcn/ui sobre
Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-02-unidades-por-imei-design.md` — leerlo
entero antes de la Task 1. El plan argumenta desde ahí y no repite sus porqués.

## Global Constraints

- **Español en todo**: nombres de archivos, funciones, variables, comentarios,
  mensajes de error y texto de pantalla. El repo entero está en español.
- **Decimal, nunca Float**, para plata y cantidades. `Prisma.Decimal`.
- **Ninguna consulta con `$queryRaw` para datos de tenant** salvo donde ya lo
  hay: la extensión de `lib/tenant/prisma.ts` intercepta operaciones de modelo,
  no raw queries, y un raw sin el `set_config` de RLS devuelve **cero filas en
  silencio** en vez de fallar.
- **Ningún permiso nuevo.** `lib/permisos/catalogo.ts` no se toca. El switch y
  los IMEI del alta viajan con `ARTICULOS_CREAR` / `ARTICULOS_EDITAR`; ingresar
  unidades y darlas de baja van detrás de `conSesion`, como `ingresarMercaderia`
  y `corregirPorConteo` hoy.
- **El bot no ve IMEIs.** Ninguna condición de IMEI entra en el camino
  `porPalabras` de `buscarArticulosVendibles`, y `lib/bot/catalogo.ts` no se
  toca.
- **Mobile-first con un solo corte: `lg:` (1024 px).** El valor del teléfono va
  sin prefijo. Todo control nuevo existe en los dos anchos; una capacidad que
  desaparece del teléfono y no reaparece en ningún lado es un defecto.
- **Las DOS copias.** Todo botón que se duplique (Topbar `hidden lg:flex` + pie
  o `Sheet` `lg:hidden`) se testea contando apariciones **en las dos
  direcciones**: con la condición aparecen las dos, sin ella ninguna. Un
  `not.toContain` solo no alcanza.
- **`npm test` corre todo** (`scripts/tests/correr-todos.sh && vitest run`) contra
  una base efímera compartida, sin paralelismo entre archivos.
- **Commits chicos y frecuentes**, uno por task como mínimo.

---

### Task 1: Schema, migración, RLS y el índice único parcial

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_unidades_por_imei/migration.sql`
- Create: `test/schema-unidades.test.ts`
- Regenerado automáticamente por el hook de pre-commit: `docs/schema.md`

**Interfaces:**
- Consumes: nada.
- Produces: el modelo `UnidadDeArticulo` y el campo `Articulo.llevaSerie`, que
  usan todas las tasks siguientes. Nombres exactos de columna:
  `unidades_articulo(id, tenant_id, articulo_id, imei, ingresada_en,
  ingresada_por_id, venta_id, baja_en, baja_nota, baja_por_id, creado_en)`,
  `articulos.lleva_serie`, `movimientos_stock.unidad_id`.

- [ ] **Step 1: Escribir el modelo en `prisma/schema.prisma`**

En `model Articulo`, junto a `moneda`:

```prisma
  // Si este artículo se maneja por unidad física identificada (IMEI en
  // celulares, número de serie en cualquier otro producto caro). Con `true`,
  // el stock ES la cantidad de unidades libres y vender exige elegir una.
  //
  // El switch es del ARTÍCULO y no hay excepciones por unidad: un artículo con
  // serie donde algunas unidades no tienen IMEI dejaría el stock con dos
  // verdades ("dice 5 y hay 3 cargados") sin ninguna respuesta buena a qué
  // significa el número.
  llevaSerie    Boolean      @default(false) @map("lleva_serie")
```

y en sus relaciones: `unidades UnidadDeArticulo[]`.

En `model MovimientoStock`, junto a `ventaId`:

```prisma
  // Cuál unidad movió este movimiento, cuando el artículo lleva serie. Es lo
  // que deja que el historial diga qué IMEI entró y cuál salió, en vez de un
  // `+1` anónimo.
  //
  // NO es la decisión abierta que CLAUDE.md tiene anotada sobre esta tabla:
  // aquélla es sobre el ORIGEN del movimiento (venta / orden / comanda), ésta
  // sobre su SUJETO. Ejes distintos.
  unidadId      String?          @map("unidad_id") @db.Uuid
```

y en sus relaciones: `unidad UnidadDeArticulo? @relation(fields: [unidadId], references: [id], onDelete: Restrict)`.

El modelo nuevo:

```prisma
/// Una unidad física del catálogo, con identidad propia.
///
/// Un nivel abajo del artículo: `Articulo` modela el MODELO ("iPhone 13 128
/// GB") y esta tabla la unidad concreta que está en la vitrina. `imei` se llama
/// así porque es el nombre del caso que la trajo; en cualquier otro rubro caro
/// es el número de serie, y el modelo es el mismo.
///
/// **"Libre" es `ventaId IS NULL AND bajaEn IS NULL`.** Una unidad no se borra
/// nunca: sale por una de las dos puertas y queda como historia — mismo
/// criterio que `Articulo.desactivadoEn` y `Venta.anuladaEn`. Borrar la fila se
/// llevaría la respuesta a "¿este equipo salió de acá?", que es justo la
/// pregunta que llega con un reclamo de garantía meses después.
model UnidadDeArticulo {
  id             String    @id @default(uuid(7)) @db.Uuid
  tenantId       String    @map("tenant_id") @db.Uuid
  articuloId     String    @map("articulo_id") @db.Uuid
  imei           String
  ingresadaEn    DateTime  @default(now()) @map("ingresada_en") @db.Timestamptz(3)
  ingresadaPorId String    @map("ingresada_por_id") @db.Uuid
  /// La venta que se la llevó. NULL mientras esté en la vitrina.
  ventaId        String?   @map("venta_id") @db.Uuid
  /// La otra puerta de salida: se robó, se rompió, fue a garantía, estaba mal
  /// cargada. Con su nota, que es lo único que después explica el faltante.
  bajaEn         DateTime? @map("baja_en") @db.Timestamptz(3)
  bajaNota       String?   @map("baja_nota")
  bajaPorId      String?   @map("baja_por_id") @db.Uuid
  creadoEn       DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant      Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Restrict, como movimientos_stock y venta_items: borrar un artículo no puede
  // borrar la historia de sus unidades.
  articulo    Articulo @relation(fields: [articuloId], references: [id], onDelete: Restrict)
  ingresadaPor User    @relation("UnidadesIngresadas", fields: [ingresadaPorId], references: [id], onDelete: Restrict)
  bajaPor     User?    @relation("UnidadesDadasDeBaja", fields: [bajaPorId], references: [id], onDelete: Restrict)
  venta       Venta?   @relation(fields: [ventaId], references: [id], onDelete: Restrict)

  movimientos MovimientoStock[]

  // La unicidad REAL del IMEI no está acá: es un índice único PARCIAL —sólo
  // entre las libres— que Prisma no sabe expresar y que vive en el SQL de la
  // migración. Éstos son los de lectura: por artículo (la ficha lista sus
  // unidades libres) y por imei (el escaneo del mostrador).
  @@index([tenantId, articuloId])
  @@index([tenantId, imei])
  @@map("unidades_articulo")
}
```

Y las relaciones inversas: en `Tenant`, `unidades UnidadDeArticulo[]`; en
`User`, `unidadesIngresadas UnidadDeArticulo[] @relation("UnidadesIngresadas")`
y `unidadesDadasDeBaja UnidadDeArticulo[] @relation("UnidadesDadasDeBaja")`; en
`Venta`, `unidades UnidadDeArticulo[]`; en `Articulo` y `MovimientoStock` lo ya
dicho arriba.

- [ ] **Step 2: Generar la migración**

```bash
npx prisma migrate dev --name unidades_por_imei --create-only
```

`--create-only` porque el SQL hay que editarlo a mano antes de aplicarlo: Prisma
no genera ni el índice parcial ni las policies de RLS.

- [ ] **Step 3: Agregar a mano el índice parcial y RLS al final del `migration.sql`**

```sql
-- La unicidad del IMEI es PARCIAL: sólo entre las unidades LIBRES.
--
-- Prisma no sabe expresar un índice parcial, así que va escrito a mano — mismo
-- mecanismo, y por la misma razón, que "una sola caja abierta por tenant" y que
-- las raíces homónimas del árbol de categorías.
--
-- Global sería más estricto y estaría MAL: un local de celulares recompra el
-- equipo que vendió, y ese IMEI tiene que poder volver a entrar. Dos filas con
-- el mismo IMEI en el historial no son un defecto: son el mismo teléfono
-- pasando dos veces por el mismo local, que es exactamente lo que pasó.
--
-- Y tiene que ser un índice y no un chequeo de aplicación: dos pestañas
-- cargando el mismo IMEI en el mismo segundo pasan las dos por cualquier `if`
-- previo. La base es el único lugar donde la carrera no existe.
CREATE UNIQUE INDEX "unidades_articulo_imei_libre"
  ON "unidades_articulo" ("tenant_id", "imei")
  WHERE "venta_id" IS NULL AND "baja_en" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "unidades_articulo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "unidades_articulo" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 4: Escribir el test de schema (falla)**

Crear `test/schema-unidades.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { Prisma } from '@/generated/prisma/client'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

// Import DINÁMICO: `lib/tenant/transaccion.ts` arrastra `lib/db.ts`, que
// construye su Pool de pg AL IMPORTARSE leyendo DATABASE_URL — no seteada
// globalmente en el repo. Mismo patrón que test/schema-usd.test.ts.
let enTransaccionDeTenant: typeof import('@/lib/tenant/transaccion').enTransaccionDeTenant

let owner: Client
let tenantId: string
let usuarioId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ enTransaccionDeTenant } = await import('@/lib/tenant/transaccion'))
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `unidades-schema-${Date.now()}`)
  usuarioId = await crearUsuario(owner, tenantId, 'duenio@unidades-schema.test')
})

afterAll(async () => {
  await owner.end()
})

async function crearArticulo(nombre: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.articulo.create({
      data: {
        tenantId,
        sku: `SKU-${crypto.randomUUID()}`,
        nombre,
        tipo: 'PRODUCTO',
        precio: new Prisma.Decimal('1000'),
      },
    }),
  )
}

async function crearUnidad(articuloId: string, imei: string) {
  return enTransaccionDeTenant(tenantId, (tx) =>
    tx.unidadDeArticulo.create({
      data: { tenantId, articuloId, imei, ingresadaPorId: usuarioId },
    }),
  )
}

describe('schema de unidades', () => {
  it('un artículo nace sin serie: el default de lleva_serie es false', async () => {
    const a = await crearArticulo('Funda genérica')
    expect(a.llevaSerie).toBe(false)
  })

  it('una unidad nace libre: sin venta y sin baja', async () => {
    const a = await crearArticulo('iPhone 13')
    const u = await crearUnidad(a.id, `IMEI-${crypto.randomUUID()}`)
    expect(u.ventaId).toBeNull()
    expect(u.bajaEn).toBeNull()
  })

  it('dos unidades LIBRES con el mismo IMEI chocan contra el índice parcial', async () => {
    const a = await crearArticulo('iPhone 14')
    const imei = `IMEI-${crypto.randomUUID()}`
    await crearUnidad(a.id, imei)
    await expect(crearUnidad(a.id, imei)).rejects.toThrow()
  })

  it('el mismo IMEI vuelve a entrar si la unidad anterior ya salió', async () => {
    // El caso real: el local recompra el equipo que vendió. Dos filas con el
    // mismo IMEI en el historial son el mismo teléfono pasando dos veces.
    const a = await crearArticulo('iPhone 15')
    const imei = `IMEI-${crypto.randomUUID()}`
    const vieja = await crearUnidad(a.id, imei)
    await enTransaccionDeTenant(tenantId, (tx) =>
      tx.unidadDeArticulo.update({
        where: { id: vieja.id },
        data: { bajaEn: new Date(), bajaNota: 'se vendió afuera', bajaPorId: usuarioId },
      }),
    )
    const nueva = await crearUnidad(a.id, imei)
    expect(nueva.id).not.toBe(vieja.id)
  })

  it('el índice parcial existe en la base con la condición exacta', async () => {
    // Sin este caso, borrar el WHERE del índice dejaría los cuatro de arriba
    // en verde salvo uno, y la regresión sería justo la que más cuesta: el
    // local no podría recomprar un equipo que vendió.
    const { rows } = await owner.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'unidades_articulo'
          AND indexname = 'unidades_articulo_imei_libre'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].indexdef).toContain('venta_id IS NULL')
    expect(rows[0].indexdef).toContain('baja_en IS NULL')
  })
})
```

- [ ] **Step 5: Correr el test — tiene que fallar**

```bash
npx vitest run test/schema-unidades.test.ts
```

Esperado: FAIL, `tx.unidadDeArticulo` no existe (la migración todavía no se aplicó).

- [ ] **Step 6: Aplicar la migración y regenerar el cliente**

```bash
npx prisma migrate dev
npm run generate
```

- [ ] **Step 7: Correr los tests — tienen que pasar**

```bash
npx vitest run test/schema-unidades.test.ts test/rls-cobertura.test.ts test/schema.test.ts
```

`rls-cobertura` es el que verifica solo que la tabla nueva tenga `tenant_id` y
RLS habilitado: si el `ENABLE ROW LEVEL SECURITY` se olvidó, falla ahí.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations test/schema-unidades.test.ts docs/schema.md
git commit -m "feat(schema): unidades de artículo identificadas por IMEI"
```

---

### Task 2: `lib/inventario/unidades.ts` — normalizar, listar, prender y apagar

**Files:**
- Create: `lib/inventario/unidades.ts`
- Modify: `lib/inventario/errores.ts` (códigos nuevos)
- Create: `test/unidades.test.ts`

**Interfaces:**
- Consumes: `UnidadDeArticulo` y `Articulo.llevaSerie` (Task 1);
  `enTransaccionDeTenant` y `ClienteTx` de `@/lib/tenant/transaccion`;
  `exigirUsuario` de `@/lib/ventas/pertenencia`.
- Produces:
  ```ts
  export type UnidadLibre = { id: string; imei: string; ingresadaEn: Date }
  export function normalizarImei(crudo: string): string
  export function normalizarLista(imeis: string[]): string[]
  export async function unidadesLibres(tenantId: string, articuloId: string): Promise<UnidadLibre[]>
  export async function crearUnidadesEnTx(tx: ClienteTx, datos: { tenantId: string; articuloId: string; imeis: string[]; usuarioId: string }): Promise<void>
  export async function prenderSerie(entrada: { tenantId: string; articuloId: string; imeis: string[]; usuarioId: string }): Promise<void>
  export async function apagarSerie(entrada: { tenantId: string; articuloId: string }): Promise<void>
  ```
  `crearUnidadesEnTx` la usa la Task 3 desde `ingresarStock`.

- [ ] **Step 1: Agregar los códigos de error**

En `lib/inventario/errores.ts`, dentro de `CodigoErrorDeInventario`:

```ts
  // Los de unidades identificadas. Separados y no un `SERIE_INVALIDA` único
  // porque cada uno se resuelve distinto: uno se arregla tipeando, otro
  // yendo a la card de Unidades, otro es un artículo que no lleva serie.
  | 'IMEI_VACIO'
  | 'IMEI_REPETIDO'
  | 'SERIE_REQUIERE_IMEIS'
  | 'IMEIS_SIN_SERIE'
  | 'SERIE_SIN_CONTEO'
  | 'SERIE_YA_PRENDIDA'
  | 'SERIE_CONTEO_NO_COINCIDE'
  | 'SERIE_STOCK_NO_ENTERO'
  | 'SERIE_CON_UNIDADES_LIBRES'
  | 'UNIDAD_INEXISTENTE'
  | 'UNIDAD_NO_DISPONIBLE'
```

- [ ] **Step 2: Escribir los tests (fallan)**

Crear `test/unidades.test.ts` con el mismo andamiaje de `beforeAll` que
`test/schema-unidades.test.ts` (import dinámico de `enTransaccionDeTenant`,
`crearTenant`, `crearUsuario`), más helpers locales `crearArticulo(nombre,
stock)` que inserte con el stock dado, y estos casos:

```ts
describe('normalizarImei', () => {
  it('recorta espacios de los bordes', () => {
    expect(normalizarImei('  355123456789012  ')).toBe('355123456789012')
  })

  it('colapsa los espacios internos, que es como sale de un lector', () => {
    expect(normalizarImei('3551 2345 6789 012')).toBe('355123456789012')
  })

  it('NO exige quince dígitos: el mismo campo es el número de serie de otro rubro', () => {
    // Un IMEI de celular tiene quince dígitos; el número de serie de una
    // notebook tiene letras. Validar la forma del IMEI cerraría la puerta a la
    // generalización que el pedido original nombra.
    expect(normalizarImei('SN-A45-9931')).toBe('SN-A45-9931')
  })

  it('un IMEI vacío o de puros espacios se rechaza', () => {
    expect(() => normalizarImei('   ')).toThrow(
      expect.objectContaining({ codigo: 'IMEI_VACIO' }),
    )
  })
})

describe('prenderSerie', () => {
  it('con stock 0 prende sin pedir ningún IMEI', async () => {
    const a = await crearArticulo('Cargador', '0')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId })
    const despues = await leerArticulo(a.id)
    expect(despues.llevaSerie).toBe(true)
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(0)
  })

  it('con stock 3 exige exactamente 3 IMEI y crea las 3 unidades', async () => {
    const a = await crearArticulo('iPhone 13', '3')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['A1', 'A2', 'A3'], usuarioId })
    const libres = await unidadesLibres(tenantId, a.id)
    expect(libres.map((u) => u.imei).sort()).toEqual(['A1', 'A2', 'A3'])
  })

  it('con stock 3 y 2 IMEI se rechaza y no crea ninguna unidad', async () => {
    const a = await crearArticulo('iPhone 14', '3')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: ['B1', 'B2'], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_CONTEO_NO_COINCIDE' }))
    // La transacción entera se rollbackea: ni media unidad queda.
    expect(await unidadesLibres(tenantId, a.id)).toHaveLength(0)
    expect((await leerArticulo(a.id)).llevaSerie).toBe(false)
  })

  it('NO toca el stock: prender no es un movimiento del inventario', async () => {
    const a = await crearArticulo('iPhone 15', '2')
    const movimientosAntes = await contarMovimientos(a.id)
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['C1', 'C2'], usuarioId })
    expect((await leerArticulo(a.id)).stock.toString()).toBe('2')
    expect(await contarMovimientos(a.id)).toBe(movimientosAntes)
  })

  it('rechaza un stock fraccionario: medio iPhone no existe', async () => {
    const a = await crearArticulo('Harina', '2.5')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: ['D1', 'D2'], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_STOCK_NO_ENTERO' }))
  })

  it('rechaza un stock negativo: "-2 unidades libres" no se puede construir', async () => {
    // El motor permite stock negativo a propósito (vender no valida que
    // alcance), así que este caso llega de verdad.
    const a = await crearArticulo('Vidrio templado', '-2')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_STOCK_NO_ENTERO' }))
  })

  it('rechaza dos IMEI iguales en la misma lista', async () => {
    const a = await crearArticulo('iPhone 12', '2')
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: ['E1', 'E1'], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEI_REPETIDO' }))
  })

  it('rechaza prender lo que ya está prendido', async () => {
    const a = await crearArticulo('iPhone 11', '0')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId })
    await expect(
      prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_YA_PRENDIDA' }))
  })

  it('rechaza un servicio: un servicio no lleva stock ni unidades', async () => {
    const s = await crearServicio('Cambio de módulo')
    await expect(
      prenderSerie({ tenantId, articuloId: s.id, imeis: [], usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'SERVICIO_SIN_STOCK' }))
  })
})

describe('apagarSerie', () => {
  it('apaga cuando no quedan unidades libres', async () => {
    const a = await crearArticulo('Cable USB', '0')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: [], usuarioId })
    await apagarSerie({ tenantId, articuloId: a.id })
    expect((await leerArticulo(a.id)).llevaSerie).toBe(false)
  })

  it('rechaza apagar con unidades libres: cinco identidades no se vuelven un 5', async () => {
    const a = await crearArticulo('iPhone SE', '1')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['F1'], usuarioId })
    await expect(apagarSerie({ tenantId, articuloId: a.id })).rejects.toThrow(
      expect.objectContaining({ codigo: 'SERIE_CON_UNIDADES_LIBRES' }),
    )
  })
})

describe('unidadesLibres', () => {
  it('no devuelve las vendidas ni las dadas de baja', async () => {
    const a = await crearArticulo('iPhone X', '3')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['G1', 'G2', 'G3'], usuarioId })
    const [g1, g2] = await unidadesLibres(tenantId, a.id)
    await marcarVendida(g1.id)
    await marcarDadaDeBaja(g2.id)
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['G3'])
  })

  it('las devuelve más vieja primero: el mostrador vende lo que entró antes', async () => {
    const a = await crearArticulo('iPhone XR', '2')
    await prenderSerie({ tenantId, articuloId: a.id, imeis: ['H1', 'H2'], usuarioId })
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['H1', 'H2'])
  })
})
```

Los helpers `leerArticulo`, `contarMovimientos`, `crearServicio`,
`marcarVendida` y `marcarDadaDeBaja` se escriben en el mismo archivo, arriba de
los `describe`, usando `enTransaccionDeTenant`. `marcarVendida` necesita una
venta: crearla con `tx.venta.create({ data: { tenantId, numero: <correlativo
local>, usuarioId, total: new Prisma.Decimal('0') } })`, igual que hace
`test/schema-usd.test.ts`.

- [ ] **Step 3: Correr los tests — tienen que fallar**

```bash
npx vitest run test/unidades.test.ts
```

Esperado: FAIL, `Cannot find module '@/lib/inventario/unidades'`.

- [ ] **Step 4: Escribir `lib/inventario/unidades.ts`**

```ts
import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeInventario, traducirErrorDeBase } from './errores'

export type UnidadLibre = { id: string; imei: string; ingresadaEn: Date }

/**
 * El IMEI tal como se guarda.
 *
 * Recorta los bordes y colapsa los espacios internos —un lector de código de
 * barras los mete, y "3551 2345" y "35512345" son el mismo equipo—, y no valida
 * NADA más. En particular NO exige quince dígitos: el mismo campo es el número
 * de serie de una notebook o de un electrodoméstico, que es la generalización
 * que el pedido original nombra. Validar la forma del IMEI cerraría esa puerta
 * a cambio de atajar un error de tipeo que el propio dueño ve al mirar la lista.
 */
export function normalizarImei(crudo: string): string {
  const limpio = crudo.trim().replace(/\s+/g, '')
  if (limpio === '') {
    throw new ErrorDeInventario('IMEI_VACIO', 'el IMEI no puede estar vacío')
  }
  return limpio
}

/** Normaliza la lista entera y rechaza repetidos DENTRO de ella. Exportada
 *  porque la usan los tres escritores de unidades: `prenderSerie` acá,
 *  `ingresarStock` (Task 3) y `crearArticulo` (Task 7). El índice
 *  parcial de la base atrapa el choque contra lo que ya está cargado; esto
 *  atrapa el que ni siquiera llega a la base, que es el más común: la misma
 *  caja escaneada dos veces. */
export function normalizarLista(imeis: string[]): string[] {
  const normalizados = imeis.map(normalizarImei)
  const vistos = new Set<string>()
  for (const i of normalizados) {
    if (vistos.has(i)) {
      throw new ErrorDeInventario('IMEI_REPETIDO', `el IMEI ${i} está dos veces en la lista`)
    }
    vistos.add(i)
  }
  return normalizados
}

/** El artículo, validado para llevar unidades. Interna, como su gemela de
 *  stock.ts: un servicio no tiene stock y por lo tanto no tiene unidades. */
async function exigirArticuloConUnidades(tx: ClienteTx, articuloId: string) {
  const articulo = await tx.articulo.findUnique({ where: { id: articuloId } })
  if (!articulo) {
    throw new ErrorDeInventario(
      'ARTICULO_INEXISTENTE',
      `el artículo ${articuloId} no existe en este tenant`,
    )
  }
  if (articulo.tipo === 'SERVICIO') {
    throw new ErrorDeInventario(
      'SERVICIO_SIN_STOCK',
      `${articulo.nombre} es un servicio y no lleva unidades`,
    )
  }
  return articulo
}

export async function unidadesLibres(
  tenantId: string,
  articuloId: string,
): Promise<UnidadLibre[]> {
  return enTransaccionDeTenant(tenantId, async (tx) => {
    const filas = await tx.unidadDeArticulo.findMany({
      where: { articuloId, ventaId: null, bajaEn: null },
      // Más vieja primero: en un mostrador se vende lo que entró antes, y un
      // orden estable es además lo que hace testeable la lista.
      orderBy: { ingresadaEn: 'asc' },
      select: { id: true, imei: true, ingresadaEn: true },
    })
    return filas
  })
}

/** Crea las unidades dentro de una transacción ya abierta. La usa
 *  `ingresarStock`, que tiene que escribir el movimiento y las unidades juntos
 *  o no escribir nada. */
export async function crearUnidadesEnTx(
  tx: ClienteTx,
  datos: { tenantId: string; articuloId: string; imeis: string[]; usuarioId: string },
): Promise<void> {
  await tx.unidadDeArticulo.createMany({
    data: datos.imeis.map((imei) => ({
      tenantId: datos.tenantId,
      articuloId: datos.articuloId,
      imei,
      ingresadaPorId: datos.usuarioId,
    })),
  })
}

export async function prenderSerie(entrada: {
  tenantId: string
  articuloId: string
  imeis: string[]
  usuarioId: string
}): Promise<void> {
  const { tenantId, articuloId, usuarioId } = entrada
  const imeis = normalizarLista(entrada.imeis)

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)
      const articulo = await exigirArticuloConUnidades(tx, articuloId)

      if (articulo.llevaSerie) {
        throw new ErrorDeInventario(
          'SERIE_YA_PRENDIDA',
          `${articulo.nombre} ya se maneja por IMEI`,
        )
      }

      // El stock se lee ADENTRO de la transacción, no se recibe del llamador:
      // entre que la pantalla se dibuja y alguien aprieta el botón puede haber
      // pasado una venta, y validar contra el número viejo dejaría el artículo
      // prendido con una unidad de menos. Es el mismo cuidado que ya tiene
      // `corregirStock`.
      const stock = articulo.stock
      if (stock.lessThan(0) || !stock.equals(stock.toDecimalPlaces(0))) {
        throw new ErrorDeInventario(
          'SERIE_STOCK_NO_ENTERO',
          `${articulo.nombre} tiene ${stock} en stock: para manejarlo por IMEI el stock ` +
            'tiene que ser un número entero de unidades, y no negativo',
        )
      }
      if (!stock.equals(imeis.length)) {
        throw new ErrorDeInventario(
          'SERIE_CONTEO_NO_COINCIDE',
          `hay ${stock} en stock y llegaron ${imeis.length} IMEI: tienen que ser los mismos`,
        )
      }

      await crearUnidadesEnTx(tx, { tenantId, articuloId, imeis, usuarioId })
      await tx.articulo.update({ where: { id: articuloId }, data: { llevaSerie: true } })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}

export async function apagarSerie(entrada: {
  tenantId: string
  articuloId: string
}): Promise<void> {
  const { tenantId, articuloId } = entrada

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      const articulo = await exigirArticuloConUnidades(tx, articuloId)

      // Apagar con unidades libres significa convertir cinco identidades en un
      // número 5 y tirar los IMEI. Es pérdida silenciosa de datos, y el caso
      // real de arrepentirse —"lo prendí y todavía no cargué nada"— tiene el
      // stock en cero y pasa por acá sin problema.
      const libres = await tx.unidadDeArticulo.count({
        where: { articuloId, ventaId: null, bajaEn: null },
      })
      if (libres > 0) {
        throw new ErrorDeInventario(
          'SERIE_CON_UNIDADES_LIBRES',
          `${articulo.nombre} tiene ${libres} unidades cargadas: dalas de baja antes de ` +
            'dejar de manejarlo por IMEI',
        )
      }

      await tx.articulo.update({ where: { id: articuloId }, data: { llevaSerie: false } })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
```

- [ ] **Step 5: Correr los tests — tienen que pasar**

```bash
npx vitest run test/unidades.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/inventario/unidades.ts lib/inventario/errores.ts test/unidades.test.ts
git commit -m "feat(inventario): prender y apagar el manejo por IMEI de un artículo"
```

---

### Task 3: `ingresarStock` con IMEIs, `corregirStock` apagado, `darDeBajaUnidad`

**Files:**
- Modify: `lib/inventario/stock.ts`
- Modify: `test/inventario.test.ts` (casos nuevos) — o `test/unidades.test.ts`, el
  que corresponda: los de `ingresarStock`/`corregirStock` van con los que ya
  existen en `test/inventario.test.ts`; `darDeBajaUnidad` va en
  `test/unidades.test.ts`.

**Interfaces:**
- Consumes: `crearUnidadesEnTx`, `normalizarImei` (Task 2).
- Produces:
  ```ts
  // ingresarStock cambia de firma: `cantidad` pasa a opcional y aparece `imeis`
  export async function ingresarStock(entrada: {
    tenantId: string; articuloId: string
    cantidad?: Decimal          // artículos SIN serie
    imeis?: string[]            // artículos CON serie
    usuarioId: string; costoUnitario?: Decimal | null; nota?: string
  }): Promise<void>

  export async function darDeBajaUnidad(entrada: {
    tenantId: string; unidadId: string; usuarioId: string; nota?: string
  }): Promise<void>
  ```

- [ ] **Step 1: Escribir los tests (fallan)**

En `test/inventario.test.ts`, junto a los casos de `ingresarStock`:

```ts
it('un artículo con serie ingresa por IMEIs y el stock sube por la longitud de la lista', async () => {
  const a = await crearArticuloConSerie('iPhone 13', ['I1'])   // stock 1
  await ingresarStock({ tenantId, articuloId: a.id, imeis: ['I2', 'I3'], usuarioId })
  expect((await leerArticulo(a.id)).stock.toString()).toBe('3')
  expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['I1', 'I2', 'I3'])
})

it('un artículo con serie rechaza una cantidad suelta', async () => {
  const a = await crearArticuloConSerie('iPhone 14', [])
  await expect(
    ingresarStock({ tenantId, articuloId: a.id, cantidad: d('2'), usuarioId }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_REQUIERE_IMEIS' }))
})

it('un artículo SIN serie rechaza que le manden IMEIs', async () => {
  const a = await crearArticulo('Funda', '0')
  await expect(
    ingresarStock({ tenantId, articuloId: a.id, imeis: ['J1'], usuarioId }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'IMEIS_SIN_SERIE' }))
})

it('ingresar un IMEI que ya está libre choca y NO sube el stock', async () => {
  const a = await crearArticuloConSerie('iPhone 15', ['K1'])
  await expect(
    ingresarStock({ tenantId, articuloId: a.id, imeis: ['K1'], usuarioId }),
  ).rejects.toThrow()
  expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
})

it('corregirStock se rechaza sobre un artículo con serie', async () => {
  const a = await crearArticuloConSerie('iPhone 12', ['L1', 'L2'])
  await expect(
    corregirStock({ tenantId, articuloId: a.id, stockContado: d('1'), usuarioId }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'SERIE_SIN_CONTEO' }))
  // Y no dejó nada a medias: el stock sigue siendo el que era.
  expect((await leerArticulo(a.id)).stock.toString()).toBe('2')
})
```

En `test/unidades.test.ts`:

```ts
describe('darDeBajaUnidad', () => {
  it('baja la unidad, descuenta el stock y deja su movimiento con la nota', async () => {
    const a = await crearArticuloConSerie('iPhone 11', ['M1', 'M2'])
    const [m1] = await unidadesLibres(tenantId, a.id)
    await darDeBajaUnidad({ tenantId, unidadId: m1.id, usuarioId, nota: 'se rompió en el mostrador' })

    expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
    expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['M2'])

    const movimientos = await movimientosDe(a.id)
    const baja = movimientos.find((m) => m.unidadId === m1.id)
    expect(baja?.motivo).toBe('AJUSTE')
    expect(baja?.delta.toString()).toBe('-1')
    expect(baja?.nota).toBe('se rompió en el mostrador')
  })

  it('dar de baja dos veces la misma unidad no descuenta dos veces', async () => {
    // El doble click es más probable que la mala intención, y la condición
    // viaja DENTRO del UPDATE: la segunda pasada no encuentra fila que mover.
    const a = await crearArticuloConSerie('iPhone SE', ['N1'])
    const [n1] = await unidadesLibres(tenantId, a.id)
    await darDeBajaUnidad({ tenantId, unidadId: n1.id, usuarioId })
    await expect(
      darDeBajaUnidad({ tenantId, unidadId: n1.id, usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_NO_DISPONIBLE' }))
    expect((await leerArticulo(a.id)).stock.toString()).toBe('0')
  })

  it('una unidad inexistente da UNIDAD_INEXISTENTE y no un 500', async () => {
    await expect(
      darDeBajaUnidad({ tenantId, unidadId: crypto.randomUUID(), usuarioId }),
    ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_INEXISTENTE' }))
  })
})
```

- [ ] **Step 2: Correr los tests — tienen que fallar**

```bash
npx vitest run test/inventario.test.ts test/unidades.test.ts
```

- [ ] **Step 3: Modificar `ingresarStock`**

Cambiar la firma a `cantidad?: Decimal` + `imeis?: string[]`, y dentro de la
transacción, después de `exigirArticuloConStock`:

```ts
      // Exactamente una de las dos formas, y cuál corresponde lo decide el
      // artículo, no el llamador. Aceptar las dos y elegir una sería dejar que
      // una pantalla desactualizada suba stock sin identidad en un artículo que
      // se maneja por IMEI — el stock diría 6 con 5 unidades cargadas, que es
      // justo la ambigüedad que el switch existe para no tener.
      if (articulo.llevaSerie) {
        if (imeis === undefined) {
          throw new ErrorDeInventario(
            'SERIE_REQUIERE_IMEIS',
            `${articulo.nombre} se maneja por IMEI: cargá el IMEI de cada unidad que entra`,
          )
        }
        if (cantidad !== undefined) {
          throw new ErrorDeInventario(
            'SERIE_REQUIERE_IMEIS',
            `${articulo.nombre} se maneja por IMEI: la cantidad sale de la lista, no se tipea`,
          )
        }
      } else if (imeis !== undefined) {
        throw new ErrorDeInventario(
          'IMEIS_SIN_SERIE',
          `${articulo.nombre} no se maneja por IMEI`,
        )
      }
```

La cantidad efectiva pasa a ser `imeis ? new Prisma.Decimal(imeis.length) :
cantidad`, y las validaciones de `> 0` y de escala se corren **después** de
resolverla (una lista vacía cae en `CANTIDAD_INVALIDA` con el mismo mensaje que
ya existe: ingresar cero unidades no es un ingreso). Con `imeis`, antes de
`aplicarMovimiento`, llamar a `crearUnidadesEnTx` con la lista ya normalizada
por `normalizarLista`, que la Task 2 ya exporta desde `unidades.ts`.

- [ ] **Step 4: Apagar `corregirStock` para artículos con serie**

Dentro de su transacción, apenas se tiene el artículo:

```ts
      if (articulo.llevaSerie) {
        throw new ErrorDeInventario(
          'SERIE_SIN_CONTEO',
          `${articulo.nombre} se maneja por IMEI: no alcanza con decir cuántos quedan, hay ` +
            'que dar de baja las unidades que faltan desde la ficha del artículo',
        )
      }
```

- [ ] **Step 5: Escribir `darDeBajaUnidad` en `stock.ts`**

Va acá y no en `unidades.ts` porque **mueve stock**: escribe un movimiento y
actualiza el caché, que es lo que hace este archivo y para lo que ya tiene
`aplicarMovimiento`.

```ts
/**
 * Una unidad que sale sin venderse: se robó, se rompió, fue a garantía, estaba
 * mal cargada.
 *
 * Reemplaza a la corrección por conteo para artículos con serie: ahí no alcanza
 * con decir "quedan 4", hay que decir CUÁL se fue.
 *
 * La condición viaja DENTRO del UPDATE, no en un `if` sobre lo que devolvió un
 * `findUnique`: leer y después decidir deja una ventana entre las dos
 * sentencias, y bajo READ COMMITTED dos bajas simultáneas de la misma unidad la
 * leen libre las dos y las dos descuentan. Es el mismo recurso que usa
 * `anularVenta` contra su propia carrera.
 */
export async function darDeBajaUnidad(entrada: {
  tenantId: string
  unidadId: string
  usuarioId: string
  nota?: string
}): Promise<void> {
  const { tenantId, unidadId, usuarioId, nota } = entrada

  try {
    await enTransaccionDeTenant(tenantId, async (tx) => {
      await exigirUsuario(tx, usuarioId)

      const unidad = await tx.unidadDeArticulo.findUnique({ where: { id: unidadId } })
      if (!unidad) {
        throw new ErrorDeInventario(
          'UNIDAD_INEXISTENTE',
          `la unidad ${unidadId} no existe en este tenant`,
        )
      }

      const bajadas = await tx.unidadDeArticulo.updateMany({
        where: { id: unidadId, ventaId: null, bajaEn: null },
        data: { bajaEn: new Date(), bajaNota: nota ?? null, bajaPorId: usuarioId },
      })
      if (bajadas.count !== 1) {
        // Cero filas significa que la unidad ya salió: por una venta o por otra
        // baja. Las dos son "ya no está en la vitrina" y se resuelven igual.
        throw new ErrorDeInventario(
          'UNIDAD_NO_DISPONIBLE',
          `el equipo ${unidad.imei} ya no está en stock`,
        )
      }

      await aplicarMovimiento(tx, {
        tenantId,
        articuloId: unidad.articuloId,
        delta: new Prisma.Decimal(-1),
        motivo: 'AJUSTE',
        usuarioId,
        nota,
        unidadId,
      })
    })
  } catch (e) {
    throw traducirErrorDeBase(e)
  }
}
```

`aplicarMovimiento` gana un `unidadId?: string` opcional que pasa tal cual al
`create` del movimiento. Los llamadores que ya existen no cambian.

- [ ] **Step 6: Correr los tests — tienen que pasar**

```bash
npx vitest run test/inventario.test.ts test/unidades.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add lib/inventario/stock.ts lib/inventario/unidades.ts test/inventario.test.ts test/unidades.test.ts
git commit -m "feat(inventario): ingreso por IMEI, baja por unidad y conteo apagado con serie"
```

---

### Task 4: `crearVenta` elige la unidad, y la carrera de dos cajas

**Files:**
- Modify: `lib/ventas/crear.ts`
- Modify: `lib/ventas/errores.ts`
- Modify: `test/ventas.test.ts`

**Interfaces:**
- Consumes: `UnidadDeArticulo`, `Articulo.llevaSerie` (Task 1).
- Produces: `ItemDeVenta` gana `unidadId?: string`. Lo consume la Task 9 (el
  punto de venta) vía el server action `cobrar`.

- [ ] **Step 1: Agregar los códigos de error**

En `lib/ventas/errores.ts`, dentro de `CodigoErrorDeVenta`:

```ts
  // Los de unidades identificadas. Separados por lo mismo que
  // ARTICULO_DESACTIVADO está separado de ARTICULO_INEXISTENTE: para el que
  // está cobrando son situaciones con salidas distintas — elegir otra unidad,
  // recargar la pantalla, o sacar la línea del carrito.
  | 'UNIDAD_REQUERIDA'
  | 'CANTIDAD_CON_SERIE'
  | 'UNIDAD_NO_CORRESPONDE'
  | 'UNIDAD_INEXISTENTE'
  | 'UNIDAD_NO_DISPONIBLE'
  | 'UNIDAD_REPETIDA'
```

- [ ] **Step 2: Escribir los tests (fallan)**

En `test/ventas.test.ts`:

```ts
it('vender un artículo con serie descuenta el stock y marca la unidad', async () => {
  const a = await crearArticuloConSerie('iPhone 13', ['P1', 'P2'], '500000')
  const [p1] = await unidadesLibres(tenantId, a.id)

  const venta = await crearVenta({
    tenantId, usuarioId,
    items: [{ articuloId: a.id, cantidad: d('1'), unidadId: p1.id }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
  })

  expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
  expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['P2'])
  expect((await leerUnidad(p1.id)).ventaId).toBe(venta.id)
})

it('un artículo con serie sin unidadId se rechaza', async () => {
  const a = await crearArticuloConSerie('iPhone 14', ['Q1'], '500000')
  await expect(
    crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: a.id, cantidad: d('1') }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
    }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_REQUERIDA' }))
})

it('un artículo con serie con cantidad 2 se rechaza: dos equipos son dos líneas', async () => {
  const a = await crearArticuloConSerie('iPhone 15', ['R1', 'R2'], '500000')
  const [r1] = await unidadesLibres(tenantId, a.id)
  await expect(
    crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: a.id, cantidad: d('2'), unidadId: r1.id }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000000'), cotizacion: d('1') }],
    }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'CANTIDAD_CON_SERIE' }))
})

it('un artículo SIN serie con unidadId se rechaza, no se ignora', async () => {
  const conSerie = await crearArticuloConSerie('iPhone 12', ['S1'], '500000')
  const [s1] = await unidadesLibres(tenantId, conSerie.id)
  const sinSerie = await crearArticulo('Funda', '10', '10000')
  await expect(
    crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: sinSerie.id, cantidad: d('1'), unidadId: s1.id }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('10000'), cotizacion: d('1') }],
    }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_NO_CORRESPONDE' }))
})

it('una unidad de OTRO artículo se rechaza', async () => {
  const a = await crearArticuloConSerie('iPhone 11', ['T1'], '500000')
  const b = await crearArticuloConSerie('iPhone X', ['U1'], '400000')
  const [u1] = await unidadesLibres(tenantId, b.id)
  await expect(
    crearVenta({
      tenantId, usuarioId,
      items: [{ articuloId: a.id, cantidad: d('1'), unidadId: u1.id }],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
    }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_INEXISTENTE' }))
})

it('la misma unidad dos veces en el mismo carrito se rechaza', async () => {
  const a = await crearArticuloConSerie('iPhone XR', ['V1'], '500000')
  const [v1] = await unidadesLibres(tenantId, a.id)
  await expect(
    crearVenta({
      tenantId, usuarioId,
      items: [
        { articuloId: a.id, cantidad: d('1'), unidadId: v1.id },
        { articuloId: a.id, cantidad: d('1'), unidadId: v1.id },
      ],
      pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('1000000'), cotizacion: d('1') }],
    }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_REPETIDA' }))
})

it('una unidad ya vendida se rechaza', async () => {
  const a = await crearArticuloConSerie('iPhone SE', ['W1'], '500000')
  const [w1] = await unidadesLibres(tenantId, a.id)
  const pagos = [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, base: d('500000'), cotizacion: d('1') }]
  await crearVenta({ tenantId, usuarioId, items: [{ articuloId: a.id, cantidad: d('1'), unidadId: w1.id }], pagos })
  await expect(
    crearVenta({ tenantId, usuarioId, items: [{ articuloId: a.id, cantidad: d('1'), unidadId: w1.id }], pagos }),
  ).rejects.toThrow(expect.objectContaining({ codigo: 'UNIDAD_NO_DISPONIBLE' }))
})

it('DOS CAJAS vendiendo la misma unidad al mismo tiempo: una sola cobra', async () => {
  // Es el caso que justifica el diseño del motor. Un `findFirst` previo lo
  // dejaría en verde estando roto: las dos transacciones leen "libre" antes de
  // que ninguna comitee. Lo que lo cierra es el UPDATE condicional.
  const a = await crearArticuloConSerie('iPhone 13 Pro', ['X1'], '500000')
  const [x1] = await unidadesLibres(tenantId, a.id)
  const items = [{ articuloId: a.id, cantidad: d('1'), unidadId: x1.id }]
  const pagos = [{ medio: 'EFECTIVO' as const, moneda: 'ARS' as const, base: d('500000'), cotizacion: d('1') }]

  const resultados = await Promise.allSettled([
    crearVenta({ tenantId, usuarioId, items, pagos }),
    crearVenta({ tenantId, usuarioId, items, pagos }),
  ])

  expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(resultados.filter((r) => r.status === 'rejected')).toHaveLength(1)
  // Y el stock bajó UNA sola vez.
  expect((await leerArticulo(a.id)).stock.toString()).toBe('0')
})
```

- [ ] **Step 3: Correr los tests — tienen que fallar**

```bash
npx vitest run test/ventas.test.ts
```

- [ ] **Step 4: Implementar en `crear.ts`**

`ItemDeVenta` pasa a:

```ts
export type ItemDeVenta = {
  articuloId: string
  cantidad: Prisma.Decimal
  /**
   * Qué unidad física sale, cuando el artículo se maneja por IMEI. Obligatorio
   * ahí y prohibido en el resto: un artículo sin serie que venga con unidadId
   * se RECHAZA en vez de ignorarse, por lo mismo que `ARTICULO_DESACTIVADO`
   * está separado de `ARTICULO_INEXISTENTE` — ignorar en silencio borra la
   * distinción que hace falta para diagnosticar.
   */
  unidadId?: string
}
```

Antes de la transacción, junto a las otras validaciones de dominio de los ítems:

```ts
  const unidadesPedidas = items.flatMap((i) => (i.unidadId ? [i.unidadId] : []))
  if (new Set(unidadesPedidas).size !== unidadesPedidas.length) {
    throw new ErrorDeVenta(
      'UNIDAD_REPETIDA',
      'el mismo equipo está dos veces en el carrito',
    )
  }
```

Dentro del `map` que arma `lineas`, después del guard de `desactivadoEn`:

```ts
        if (a.llevaSerie) {
          if (i.unidadId === undefined) {
            throw new ErrorDeVenta(
              'UNIDAD_REQUERIDA',
              `${a.nombre} se vende por unidad: elegí cuál equipo sale`,
            )
          }
          if (!i.cantidad.equals(1)) {
            throw new ErrorDeVenta(
              'CANTIDAD_CON_SERIE',
              `${a.nombre} se vende de a una unidad: dos equipos son dos líneas`,
            )
          }
        } else if (i.unidadId !== undefined) {
          throw new ErrorDeVenta(
            'UNIDAD_NO_CORRESPONDE',
            `${a.nombre} no se maneja por IMEI`,
          )
        }
```

y `lineas` arrastra `unidadId: i.unidadId`.

En el bucle de stock, que ya recorre `paraStock` ordenado por `articuloId`:

```ts
      for (const l of paraStock) {
        // La unidad se TOMA con un UPDATE condicional, no se lee y después se
        // escribe. Dos cajas pueden leer "libre" a la vez —ninguna comiteó
        // todavía—, así que un chequeo previo no cierra nada: lo que lo cierra
        // es que el WHERE se evalúe en el momento de escribir. La segunda caja
        // se lleva cero filas y su venta se rechaza entera.
        //
        // `paraStock` ya viene ordenado por articuloId, y con serie hay una
        // línea por unidad, así que los locks de unidad se toman en un orden
        // derivado del mismo orden total que usa todo el motor.
        if (l.unidadId !== undefined) {
          const tomada = await tx.unidadDeArticulo.updateMany({
            where: {
              id: l.unidadId,
              articuloId: l.articuloId,
              ventaId: null,
              bajaEn: null,
            },
            data: { ventaId: venta.id },
          })
          if (tomada.count !== 1) {
            // Cero filas tiene dos causas que el mostrador vive distinto: la
            // unidad no es de este artículo (o no existe), o ya salió. La
            // consulta que las separa va acá y no antes: sólo corre en el
            // camino excepcional.
            const existe = await tx.unidadDeArticulo.findFirst({
              where: { id: l.unidadId, articuloId: l.articuloId },
              select: { imei: true },
            })
            if (!existe) {
              throw new ErrorDeVenta(
                'UNIDAD_INEXISTENTE',
                'ese equipo no es de este artículo. Recargá la pantalla y elegí de nuevo.',
              )
            }
            throw new ErrorDeVenta(
              'UNIDAD_NO_DISPONIBLE',
              `El equipo ${existe.imei} se acaba de vender. Elegí otro.`,
            )
          }
        }

        await tx.movimientoStock.create({
          data: {
            tenantId,
            articuloId: l.articuloId,
            unidadId: l.unidadId,
            delta: l.cantidad.negated(),
            motivo: 'VENTA',
            ventaId: venta.id,
            usuarioId,
          },
        })
        await tx.articulo.update({
          where: { id: l.articuloId },
          data: { stock: { increment: l.cantidad.negated() } },
        })
      }
```

- [ ] **Step 5: Correr los tests — tienen que pasar**

```bash
npx vitest run test/ventas.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/ventas/crear.ts lib/ventas/errores.ts test/ventas.test.ts
git commit -m "feat(ventas): elegir qué unidad sale, tomándola con UPDATE condicional"
```

---

### Task 5: anular una venta devuelve las unidades a la vitrina

**Files:**
- Modify: `lib/ventas/anular.ts`
- Modify: `test/ventas.test.ts`

**Interfaces:**
- Consumes: `MovimientoStock.unidadId` (Task 1), el marcado de unidades de
  `crearVenta` (Task 4).
- Produces: nada nuevo hacia afuera.

- [ ] **Step 1: Escribir los tests (fallan)**

```ts
it('anular devuelve la unidad a la vitrina', async () => {
  const a = await crearArticuloConSerie('iPhone 13 mini', ['Y1'], '500000')
  const [y1] = await unidadesLibres(tenantId, a.id)
  const venta = await crearVenta({
    tenantId, usuarioId,
    items: [{ articuloId: a.id, cantidad: d('1'), unidadId: y1.id }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
  })

  await anularVenta({ tenantId, ventaId: venta.id, usuarioId })

  expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
  expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual(['Y1'])
  expect((await leerUnidad(y1.id)).ventaId).toBeNull()
})

it('el movimiento de anulación anota la unidad', async () => {
  const a = await crearArticuloConSerie('iPhone 14 Plus', ['Z1'], '500000')
  const [z1] = await unidadesLibres(tenantId, a.id)
  const venta = await crearVenta({
    tenantId, usuarioId,
    items: [{ articuloId: a.id, cantidad: d('1'), unidadId: z1.id }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
  })
  await anularVenta({ tenantId, ventaId: venta.id, usuarioId })

  const movimientos = await movimientosDe(a.id)
  const anulacion = movimientos.find((m) => m.motivo === 'ANULACION_VENTA')
  expect(anulacion?.unidadId).toBe(z1.id)
})

it('anular dos veces no devuelve la unidad dos veces', async () => {
  const a = await crearArticuloConSerie('iPhone 15 Pro', ['AA1'], '500000')
  const [aa1] = await unidadesLibres(tenantId, a.id)
  const venta = await crearVenta({
    tenantId, usuarioId,
    items: [{ articuloId: a.id, cantidad: d('1'), unidadId: aa1.id }],
    pagos: [{ medio: 'EFECTIVO', moneda: 'ARS', base: d('500000'), cotizacion: d('1') }],
  })
  await anularVenta({ tenantId, ventaId: venta.id, usuarioId })
  await anularVenta({ tenantId, ventaId: venta.id, usuarioId })
  expect((await leerArticulo(a.id)).stock.toString()).toBe('1')
  expect(await unidadesLibres(tenantId, a.id)).toHaveLength(1)
})
```

- [ ] **Step 2: Correr los tests — tienen que fallar**

```bash
npx vitest run test/ventas.test.ts
```

- [ ] **Step 3: Implementar en `anular.ts`**

El `findMany` de movimientos ya trae `unidadId`. Dentro del bucle que compensa,
antes del `create` del movimiento:

```ts
        // La unidad vuelve a la vitrina. Va DENTRO del mismo bucle que
        // compensa el stock —y no en un update aparte— porque las dos mitades
        // tienen que moverse juntas o no moverse: una unidad libre con el stock
        // sin devolver es exactamente la desincronización que el invariante
        // existe para impedir.
        //
        // Es idempotente por el guard de arriba: si la venta ya estaba anulada,
        // el UPDATE de `ventas` se llevó cero filas y no llegamos acá.
        if (m.unidadId !== null) {
          await tx.unidadDeArticulo.update({
            where: { id: m.unidadId },
            data: { ventaId: null },
          })
        }
```

Y envolver la traducción del choque contra el índice parcial. `anular.ts` NO
importa `Prisma` hoy, así que hay que sumar
`import { Prisma } from '@/generated/prisma/client'`. En el `catch` de
`anularVenta`, antes del `traducirErrorDeBase` que ya está:

```ts
    // El caso de borde real: mientras la venta estuvo viva, el local RECOMPRÓ
    // el mismo equipo y lo cargó de nuevo. Liberar el vendido dejaría dos
    // unidades libres con el mismo IMEI, que es justo lo que el índice parcial
    // impide. Sin esta traducción sale un P2002 crudo —un 500 sin `codigo`— en
    // lugar de un cartel que dice qué pasó.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ErrorDeVenta(
        'UNIDAD_NO_DISPONIBLE',
        'no se puede anular: uno de los equipos de esta venta volvió a cargarse en el ' +
          'stock. Dalo de baja desde la ficha del artículo y anulá de nuevo.',
      )
    }
```

- [ ] **Step 4: Correr los tests — tienen que pasar**

```bash
npx vitest run test/ventas.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/anular.ts test/ventas.test.ts
git commit -m "feat(ventas): anular devuelve la unidad a la vitrina"
```

---

### Task 6: el buscador del mostrador encuentra por IMEI

**Files:**
- Modify: `lib/ventas/buscar.ts`
- Create: `test/buscar-por-imei.test.ts`

**Interfaces:**
- Consumes: `UnidadDeArticulo` (Task 1).
- Produces:
  ```ts
  export type ArticuloVendible = {
    id: string; sku: string; nombre: string
    precio: string; moneda: 'ARS' | 'USD'
    stock: string; esProducto: boolean
    // NUEVO. Presente sólo cuando la búsqueda entró por un IMEI exacto: es la
    // unidad que el escaneo identificó, y es lo que le permite al carrito
    // agregar la línea con la unidad ya elegida.
    unidad?: { id: string; imei: string }
    // NUEVO. Para que el carrito sepa que tiene que pedir una unidad cuando el
    // artículo se agregó por nombre y no por escaneo.
    llevaSerie: boolean
  }
  ```
  Lo consume la Task 9.

- [ ] **Step 1: Escribir los tests (fallan)**

Crear `test/buscar-por-imei.test.ts`, con el andamiaje de base efímera de las
tasks anteriores:

```ts
it('escanear un IMEI devuelve el artículo con esa unidad ya elegida', async () => {
  const a = await crearArticuloConSerie('iPhone 13', ['355123456789012'], '500000')
  const [r] = await buscarArticulosVendibles(tenantId, '355123456789012')
  expect(r.id).toBe(a.id)
  expect(r.unidad?.imei).toBe('355123456789012')
})

it('el match del IMEI es EXACTO: un prefijo no trae media vitrina', async () => {
  // Con `contains`, tipear "355" traería todas las unidades del local, y el
  // índice no se podría usar. Un IMEI se escanea entero.
  await crearArticuloConSerie('iPhone 14', ['355999888777666'], '500000')
  expect(await buscarArticulosVendibles(tenantId, '355')).toHaveLength(0)
})

it('un IMEI ya vendido NO lo encuentra: no está en la vitrina', async () => {
  const a = await crearArticuloConSerie('iPhone 15', ['111222333444555'], '500000')
  const [u] = await unidadesLibres(tenantId, a.id)
  await marcarVendida(u.id)
  expect(await buscarArticulosVendibles(tenantId, '111222333444555')).toHaveLength(0)
})

it('buscar por nombre sigue funcionando y marca llevaSerie', async () => {
  const a = await crearArticuloConSerie('iPhone 12 azul', ['999888777666555'], '500000')
  const [r] = await buscarArticulosVendibles(tenantId, 'iPhone 12 azul')
  expect(r.id).toBe(a.id)
  expect(r.llevaSerie).toBe(true)
  // Sin escaneo NO hay unidad elegida: el carrito la tiene que pedir.
  expect(r.unidad).toBeUndefined()
})

it('un artículo sin serie sale con llevaSerie en false y sin unidad', async () => {
  await crearArticulo('Funda transparente', '5', '10000')
  const [r] = await buscarArticulosVendibles(tenantId, 'Funda transparente')
  expect(r.llevaSerie).toBe(false)
  expect(r.unidad).toBeUndefined()
})

it('EL BOT NO VE IMEIS: con porPalabras, un IMEI no encuentra nada', async () => {
  // La defensa no es el prompt del agente: es que no hay camino de código.
  // `lib/bot/catalogo.ts` llama con porPalabras y nunca sin él.
  await crearArticuloConSerie('iPhone 11', ['123456789012345'], '500000')
  expect(
    await buscarArticulosVendibles(tenantId, '123456789012345', { porPalabras: true }),
  ).toHaveLength(0)
})
```

- [ ] **Step 2: Correr los tests — tienen que fallar**

```bash
npx vitest run test/buscar-por-imei.test.ts
```

- [ ] **Step 3: Implementar en `buscar.ts`**

Agregar `llevaSerie: true` al `SELECT`, mapearlo en el `return`, y en la rama
**sin** `porPalabras` —y sólo ahí— buscar primero por IMEI:

```ts
  } else {
    // El IMEI, PRIMERO y por match EXACTO, y sólo en el camino del mostrador.
    //
    // Exacto y no `contains`, al revés que nombre y SKU: un IMEI son quince
    // dígitos que se escanean enteros, así que un `contains` no mejora nada y
    // en cambio haría que tipear "355" traiga media vitrina — además de no
    // poder usar el índice. Y como el índice único parcial garantiza que no
    // haya dos unidades LIBRES con el mismo IMEI, esto devuelve una o ninguna:
    // nunca hay que desempatar.
    //
    // NO entra en la rama `porPalabras`, que es la que usa el bot: un cliente
    // de WhatsApp no tiene por qué poder preguntar por un IMEI. La defensa es
    // que no exista el camino, no que el prompt lo prohíba.
    const unidad = await prisma.unidadDeArticulo.findFirst({
      where: {
        imei: busqueda,
        ventaId: null,
        bajaEn: null,
        articulo: { desactivadoEn: null },
      },
      select: { id: true, imei: true, articulo: { select: SELECT } },
    })
    if (unidad) {
      return [{ ...aVendible(unidad.articulo), unidad: { id: unidad.id, imei: unidad.imei } }]
    }

    articulos = await prisma.articulo.findMany({ /* … lo que ya estaba … */ })
  }
```

Extraer el `map` final a una función `aVendible(a)` para que las dos salidas
—la del escaneo y la de la búsqueda por texto— compartan una sola conversión.

- [ ] **Step 4: Correr los tests — tienen que pasar**

```bash
npx vitest run test/buscar-por-imei.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add lib/ventas/buscar.ts test/buscar-por-imei.test.ts
git commit -m "feat(vender): el buscador del mostrador encuentra por IMEI exacto"
```

---

### Task 7: el alta de `/inventario/nuevo` carga las unidades

**Files:**
- Modify: `app/(app)/inventario/acciones.ts` (`altaArticulo`)
- Modify: `app/(app)/inventario/formularios.tsx` (`FormularioDeAlta`)
- Create: `app/(app)/inventario/lista-de-imeis.tsx` (`ListaDeImeis`, compartida
  con la Task 8 — vive en su propio archivo justamente para que sea UNA y no
  dos, que es el defecto que el ciclo del 2026-08-28 pagó con un cliente
  reportándolo)
- Modify: `lib/inventario/articulos.ts` (`crearArticulo`)
- Modify: `app/(app)/inventario/formularios.test.tsx`
- Modify: `app/(app)/inventario/acciones.test.ts`

**Interfaces:**
- Consumes: `crearUnidadesEnTx` y `normalizarLista` (Task 2).
- Produces: `ListaDeImeis` (firma abajo, en el Step 5), que la Task 8 instancia
  con `filasFijas`. `EntradaCrearArticulo` gana `llevaSerie?: boolean` e `imeis?:
  string[]`. El formulario postea `llevaSerie` (`'on'` / ausente) e `imeis` (un
  campo por línea, todos con `name="imeis"`).

- [ ] **Step 1: Escribir los tests (fallan)**

En `app/(app)/inventario/formularios.test.tsx`:

```ts
it('el alta ofrece el switch de IMEI', async () => {
  const html = await renderAlta()
  expect(html).toContain('Lleva IMEI o número de serie')
})

it('con el switch prendido, el campo de cantidad se reemplaza por la lista de IMEI', async () => {
  // El switch es interactivo y este test renderiza estático, así que se
  // afirma sobre lo que el marcado declara: los dos bloques existen y el que
  // corresponde se muestra según el estado inicial (apagado).
  const html = await renderAlta()
  expect(html).toContain('name="cantidad"')
})
```

En `app/(app)/inventario/acciones.test.ts`, contra la base real:

```ts
it('el alta con serie crea el artículo, sus unidades y el stock que corresponde', async () => {
  const datos = new FormData()
  datos.set('nombre', 'iPhone 13 128GB')
  datos.set('precio', '500000')
  datos.set('tipo', 'PRODUCTO')
  datos.set('moneda', 'ARS')
  datos.set('llevaSerie', 'on')
  datos.append('imeis', '355000000000001')
  datos.append('imeis', '355000000000002')

  const estado = await altaArticulo(INICIAL, datos)
  expect(estado.error).toBeNull()

  const a = await buscarPorNombre('iPhone 13 128GB')
  expect(a.llevaSerie).toBe(true)
  expect(a.stock.toString()).toBe('2')
  expect((await unidadesLibres(tenantId, a.id)).map((u) => u.imei)).toEqual([
    '355000000000001',
    '355000000000002',
  ])
})

it('el alta con serie y cero IMEI crea el artículo con stock 0 y sin unidades', async () => {
  // Es el caso normal: se carga el modelo antes de que llegue la mercadería.
  const datos = new FormData()
  datos.set('nombre', 'iPhone 14 128GB')
  datos.set('precio', '600000')
  datos.set('tipo', 'PRODUCTO')
  datos.set('moneda', 'ARS')
  datos.set('llevaSerie', 'on')

  await altaArticulo(INICIAL, datos)
  const a = await buscarPorNombre('iPhone 14 128GB')
  expect(a.llevaSerie).toBe(true)
  expect(a.stock.toString()).toBe('0')
})

it('un SERVICIO no puede llevar serie', async () => {
  const datos = new FormData()
  datos.set('nombre', 'Cambio de módulo')
  datos.set('precio', '80000')
  datos.set('tipo', 'SERVICIO')
  datos.set('moneda', 'ARS')
  datos.set('llevaSerie', 'on')

  const estado = await altaArticulo(INICIAL, datos)
  expect(estado.error).toContain('servicio')
})

it('dos IMEI iguales en el alta se rechazan y no crean el artículo', async () => {
  const datos = new FormData()
  datos.set('nombre', 'iPhone 15 repetido')
  datos.set('precio', '700000')
  datos.set('tipo', 'PRODUCTO')
  datos.set('moneda', 'ARS')
  datos.set('llevaSerie', 'on')
  datos.append('imeis', '355111111111111')
  datos.append('imeis', '355111111111111')

  const estado = await altaArticulo(INICIAL, datos)
  expect(estado.error).not.toBeNull()
  await expect(buscarPorNombre('iPhone 15 repetido')).resolves.toBeNull()
})
```

- [ ] **Step 2: Correr los tests — tienen que fallar**

```bash
npx vitest run "app/(app)/inventario"
```

- [ ] **Step 3: Extender `crearArticulo` en `lib/inventario/articulos.ts`**

`EntradaCrearArticulo` gana:

```ts
  /** Si el artículo se maneja por unidad identificada. Sólo PRODUCTO. */
  llevaSerie?: boolean
  /**
   * Los IMEI de las unidades con las que nace. Con `llevaSerie`, el stock
   * inicial es su longitud y `stockInicial` se rechaza — un artículo con serie
   * no tiene un stock que se tipee, tiene unidades que se cargan.
   */
  imeis?: string[]
```

Dentro de la transacción que ya crea el artículo:

- Si `llevaSerie` y `tipo === 'SERVICIO'` → `ErrorDeInventario('SERVICIO_SIN_STOCK', …)`.
- Si `llevaSerie` y `stockInicial` viene → `ErrorDeInventario('SERIE_REQUIERE_IMEIS', …)`.
- Si `!llevaSerie` e `imeis` viene → `ErrorDeInventario('IMEIS_SIN_SERIE', …)`.
- Con `llevaSerie` e `imeis` no vacío: normalizar con `normalizarLista`, crear
  las unidades con `crearUnidadesEnTx`, y crear **un** `MovimientoStock` de
  `motivo: 'INGRESO'` con `delta = imeis.length` y el `costoUnitario` que
  corresponda, más el `stock` del artículo en ese mismo número.

**El bug conocido que NO se arregla acá**: el movimiento con `costoUnitario`
sólo se crea si hay stock inicial, así que cargar un costo sin unidades lo
pierde en silencio. Está anotado en CLAUDE.md como parte de la deuda del costo y
tiene su propio ciclo; este task no lo toca ni lo empeora.

- [ ] **Step 4: Extender `altaArticulo` en `acciones.ts`**

```ts
      const llevaSerie = datos.get('llevaSerie') === 'on'
      // `getAll` y no `get`: el formulario postea un campo por línea, todos con
      // el mismo name. Los vacíos se descartan acá —la lista arranca con una
      // fila en blanco y quien no la usa no debería recibir un IMEI_VACIO.
      const imeis = datos.getAll('imeis').map(String).filter((i) => i.trim() !== '')
```

y pasarlos a `crearArticulo`, con `stockInicial` sólo cuando `!llevaSerie`.

- [ ] **Step 5: Construir el switch y la lista en `FormularioDeAlta`**

Un `Switch` de shadcn (ya está en `components/ui/switch.tsx`) con
`name="llevaSerie"`, deshabilitado cuando el tipo elegido es `SERVICIO`. Con el
switch prendido, en lugar del par "Cantidad / Costo unitario" se muestra la
lista de IMEI; el costo unitario se mantiene.

La lista sale a `app/(app)/inventario/lista-de-imeis.tsx`, porque la Task 8 la
necesita idéntica en dos lugares más —el diálogo de prender el switch y el
ingreso de mercadería— — y dos implementaciones del mismo
control es exactamente el defecto que el ciclo del 2026-08-28 pagó con un
cliente reportándolo cuatro días después:

```tsx
/**
 * La lista de IMEI que se cargan de una: el alta, el ingreso de mercadería y el
 * diálogo de prender el switch usan ESTA, no tres copias.
 *
 * `filas` fijas cuando el llamador sabe cuántas van (prender el switch: son
 * tantas como el stock); libre cuando no (el alta y el ingreso).
 */
export function ListaDeImeis({
  filasFijas,
  etiqueta = 'IMEI o número de serie',
}: {
  filasFijas?: number
  etiqueta?: string
}) {
  const [valores, setValores] = useState<string[]>(
    filasFijas === undefined ? [''] : Array.from({ length: filasFijas }, () => ''),
  )
  const ultimo = useRef<HTMLInputElement>(null)

  // El lector de código de barras emite Enter al final de cada código, así que
  // Enter agrega una fila y la enfoca: eso es lo que hace que cargar diez
  // equipos sean diez escaneos y ningún click. `preventDefault` ANTES de
  // cualquier await —después ya no tiene efecto—, igual que el buscador de
  // /vender. Con `filasFijas` no agrega nada: la cantidad la fija el stock.
  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (filasFijas !== undefined) return
    if (i === valores.length - 1) setValores((v) => [...v, ''])
    queueMicrotask(() => ultimo.current?.focus())
  }

  return (
    <div className="flex flex-col gap-2">
      {valores.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            ref={i === valores.length - 1 ? ultimo : undefined}
            name="imeis"
            value={v}
            aria-label={`${etiqueta} ${i + 1}`}
            onChange={(e) =>
              setValores((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
            }
            onKeyDown={(e) => alTeclear(e, i)}
            className="h-10 rounded-[9px]"
          />
          {filasFijas === undefined && valores.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Quitar ${etiqueta} ${i + 1}`}
              onClick={() => setValores((prev) => prev.filter((_, j) => j !== i))}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      ))}
      {filasFijas === undefined && (
        <Button type="button" variant="outline" onClick={() => setValores((v) => [...v, ''])}>
          Agregar otro
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Correr los tests — tienen que pasar**

```bash
npx vitest run "app/(app)/inventario" test/unidades.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventario" lib/inventario/articulos.ts
git commit -m "feat(inventario): el alta carga las unidades con su IMEI"
```

---

### Task 8: la ficha `/inventario/[id]` administra las unidades

**Files:**
- Modify: `app/(app)/inventario/[id]/page.tsx`
- Modify: `app/(app)/inventario/formularios.tsx` (`FichaDeArticulo`, `MoverStock`)
- Create: `app/(app)/inventario/unidades.tsx` (la card "Unidades" y el diálogo de prender)
- Reusa (NO reimplementa): `app/(app)/inventario/lista-de-imeis.tsx` de la Task 7
- Create: `app/(app)/inventario/unidades.test.tsx`
- Modify: `app/(app)/inventario/acciones.ts` (acciones nuevas)
- Modify: `app/(app)/inventario/acciones.test.ts`

**Interfaces:**
- Consumes: `unidadesLibres`, `prenderSerie`, `apagarSerie` (Task 2);
  `darDeBajaUnidad`, `ingresarStock` con `imeis` (Task 3); `ListaDeImeis`
  (Task 7) — el diálogo de prender la instancia con `filasFijas={stock}` y el
  ingreso de mercadería sin `filasFijas`.
- Produces: tres server actions nuevas, con la misma forma `(_e:
  EstadoInventario, datos: FormData) => Promise<EstadoInventario>` que las que
  ya existen:
  ```ts
  export async function prenderSerieAccion(...)   // campos: articuloId, imeis[]
  export async function apagarSerieAccion(...)    // campos: articuloId
  export async function darDeBajaUnidadAccion(...) // campos: articuloId, unidadId, nota
  ```

- [ ] **Step 1: Escribir los tests de las acciones (fallan)**

En `app/(app)/inventario/acciones.test.ts` — `comoEmpleadoSinPermisos(fn)` es
el helper de sesión que ese archivo ya usa para los casos de permisos;
`articuloConStock`, `articuloConStock3`, `conSerie` y `unidadLibre` se preparan
en el `beforeAll` con `crearArticulo` / `prenderSerie` / `unidadesLibres`:

```ts
it('prenderSerieAccion exige ARTICULOS_EDITAR', async () => {
  // Se delega por lo que la acción mueve: el switch mueve UN artículo, igual
  // que su precio y su moneda. Mismo permiso, ninguno nuevo.
  await comoEmpleadoSinPermisos(async () => {
    const datos = new FormData()
    datos.set('articuloId', articuloConStock.id)
    await expect(prenderSerieAccion(INICIAL, datos)).rejects.toThrow()
  })
})

it('darDeBajaUnidadAccion la puede hacer cualquiera con sesión', async () => {
  // Mismo lugar que ingresarMercaderia y corregirPorConteo: es operación del
  // día, la hace quien está atendiendo, y queda firmada con su usuarioId.
  await comoEmpleadoSinPermisos(async () => {
    const datos = new FormData()
    datos.set('articuloId', conSerie.id)
    datos.set('unidadId', unidadLibre.id)
    datos.set('nota', 'se rompió')
    const estado = await darDeBajaUnidadAccion(INICIAL, datos)
    expect(estado.error).toBeNull()
  })
})

it('prenderSerieAccion con menos IMEI que stock devuelve el error, no un 500', async () => {
  const datos = new FormData()
  datos.set('articuloId', articuloConStock3.id)
  datos.append('imeis', 'AB1')
  const estado = await prenderSerieAccion(INICIAL, datos)
  expect(estado.error).toContain('tienen que ser los mismos')
})
```

En `app/(app)/inventario/unidades.test.tsx` — con `renderCard(unidades)` como
helper local que envuelve `renderToStaticMarkup(<CardDeUnidades articuloId="a1"
unidades={unidades} />)`, y el `vi.mock('./acciones', …)` que ya usa
`formularios.test.tsx` (ese archivo es `'use server'` y su contrato lo prueba
`acciones.test.ts` contra una base real):

```ts
it('la card lista los IMEI libres con su fecha de ingreso', () => {
  const html = renderCard([
    { id: 'u1', imei: '355000000000001', ingresadaEn: new Date('2026-09-01T12:00:00Z') },
  ])
  expect(html).toContain('355000000000001')
})

it('cada unidad ofrece darla de baja', () => {
  const html = renderCard([{ id: 'u1', imei: '355000000000001', ingresadaEn: new Date() }])
  expect(html).toContain('Dar de baja')
})

it('sin unidades, dice qué hacer en vez de mostrar una lista vacía', () => {
  const html = renderCard([])
  expect(html).toContain('Todavía no cargaste ninguna unidad')
})

it('las DOS copias del botón de baja: escritorio y teléfono', () => {
  // La regla del merge del ciclo móvil, contada en las dos direcciones.
  const html = renderCard([{ id: 'u1', imei: 'A', ingresadaEn: new Date() }])
  expect(html.split('Dar de baja').length - 1).toBe(2)
})
```

- [ ] **Step 2: Correr los tests — tienen que fallar**

```bash
npx vitest run "app/(app)/inventario"
```

- [ ] **Step 3: Escribir las tres acciones en `acciones.ts`**

Siguiendo los patrones que ya están en el archivo — `comoPuede('ARTICULOS_EDITAR', …)`
para prender y apagar, `conSesion(…)` para la baja, parseo **adentro** del
closure, `revalidatePath('/inventario')` y `revalidatePath('/inventario/<id>')`,
y `traducir(e)` en el `catch`:

```ts
export async function prenderSerieAccion(
  _e: EstadoInventario,
  datos: FormData,
): Promise<EstadoInventario> {
  try {
    const articuloId = texto(datos, 'articuloId')
    await comoPuede('ARTICULOS_EDITAR', async (tenantId, usuarioId) => {
      // getAll y no get: el diálogo postea un campo por unidad que ya hay.
      const imeis = datos.getAll('imeis').map(String).filter((i) => i.trim() !== '')
      await prenderSerie({ tenantId, articuloId, imeis, usuarioId })
    })
    revalidatePath('/inventario')
    revalidatePath(`/inventario/${articuloId}`)
    return { error: null, aviso: 'Este artículo ahora se maneja por IMEI.' }
  } catch (e) {
    return traducir(e)
  }
}
```

`apagarSerieAccion` y `darDeBajaUnidadAccion` con la misma forma.

- [ ] **Step 4: Escribir `app/(app)/inventario/unidades.tsx`**

Archivo nuevo con `'use client'`, dos componentes exportados:

```tsx
export function CardDeUnidades({
  articuloId,
  unidades,
}: {
  articuloId: string
  // El tipo lo produce `unidadesLibres` (Task 2). Las fechas llegan como Date
  // desde el Server Component; se formatean con `formatearFechaCorta`
  // (@/lib/formato/mostrar), que es lo que ya usa el historial.
  unidades: { id: string; imei: string; ingresadaEn: Date }[]
}): ReactNode

export function SwitchDeSerie({
  articuloId,
  llevaSerie,
  stock,
  puedeEditar,
}: {
  articuloId: string
  llevaSerie: boolean
  // Como STRING y no `Prisma.Decimal`: esto lo consume un componente cliente, y
  // un Decimal no cruza ese borde sin perder el tipo. Mismo criterio que
  // `ArticuloVendible`.
  stock: string
  puedeEditar: boolean
}): ReactNode
```

- `CardDeUnidades` — la lista, con un `Input` de filtro
  cuando `unidades.length > 8`, y por fila el IMEI, la fecha de ingreso y "Dar de
  baja". La baja va con confirmación en dos pasos sobre el mismo botón, que es el
  mecanismo que este repo ya eligió para "irreversible pero frecuente"
  (`AnularVenta` en `app/(app)/ventas/formularios.tsx`, y el doble `Esc` del
  carrito): el primer toque cambia el rótulo a "Confirmar baja" y se desarma
  solo a los 3 segundos.
- `SwitchDeSerie` — el switch; al
  prenderlo con `stock > 0` abre un `Dialog` con `stock` campos de IMEI (mismo
  manejo de Enter que el alta), y al apagarlo postea directo.

**Un archivo propio y no dentro de `formularios.tsx`**: ese archivo ya tiene 734
líneas y esto es una responsabilidad distinta. La ficha lo instancia por
`columnaDerechaExtra` y por `children` de `FichaDeArticulo`.

- [ ] **Step 5: Conectar en `[id]/page.tsx` y en `MoverStock`**

- `page.tsx` consulta `unidadesLibres(tenantId, articulo.id)` **sólo si**
  `articulo.llevaSerie` —para no pagar una consulta que ningún local sin serie
  necesita— y pasa la card a `FichaDeArticulo`.
- **`ingresarMercaderia` (`acciones.ts`) aprende a leer `imeis`**, y esto es de
  esta task aunque el archivo lo haya tocado la Task 7: es acá donde `MoverStock`
  empieza a postearlos. Mismo parseo que `altaArticulo`
  (`datos.getAll('imeis').map(String).filter(…)`), y se le pasa a `ingresarStock`
  **o** `cantidad` **o** `imeis`, nunca los dos — el motor rechaza que vengan
  juntos, así que la pantalla no puede mandar los dos "por las dudas".
- `MoverStock` gana `llevaSerie: boolean`. Con `true`: el campo "Cantidad que
  entra" se reemplaza por la lista de IMEI (`name="imeis"`), y la card "Corregir
  por conteo" se dibuja **deshabilitada** con el texto *"Este artículo se maneja
  por IMEI: para sacar una unidad, dala de baja desde Unidades."* Deshabilitada y
  explicada, no escondida — desaparecer sin decir nada es lo que este repo trata
  como defecto.

- [ ] **Step 6: Correr los tests — tienen que pasar**

```bash
npx vitest run "app/(app)/inventario" test/responsive.test.ts test/pantallas.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventario"
git commit -m "feat(inventario): la ficha administra las unidades y el switch de IMEI"
```

---

### Task 9: `/vender` elige la unidad

**Files:**
- Modify: `app/(app)/vender/punto-de-venta.tsx`
- Modify: `app/(app)/vender/acciones.ts` (`cobrar`)
- Modify: `app/(app)/vender/punto-de-venta.test.tsx`
- Modify: `app/(app)/vender/acciones.test.ts`

**Interfaces:**
- Consumes: `ArticuloVendible.unidad` y `.llevaSerie` (Task 6); `ItemDeVenta.unidadId` (Task 4).
- Produces: el JSON de `items` que postea el formulario gana `unidadId`.

- [ ] **Step 1: Escribir los tests (fallan)**

En `app/(app)/vender/acciones.test.ts`:

```ts
it('cobrar pasa el unidadId al motor', async () => {
  const datos = new FormData()
  datos.set('items', JSON.stringify([{ articuloId: a.id, cantidad: '1', unidadId: u.id }]))
  datos.set('pagos', JSON.stringify([{ medio: 'EFECTIVO', moneda: 'ARS', base: '500000', cotizacion: '1' }]))
  const estado = await cobrar(INICIAL, datos)
  expect(estado.error).toBeNull()
  expect((await leerUnidad(u.id)).ventaId).toBe(estado.venta!.id)
})

it('un unidadId que no es uuid da error de dominio y no un 500', async () => {
  // Mismo guard que el articuloId: desde la pantalla no llega otra cosa, pero
  // un POST armado a mano sí, y Prisma lo rechazaría con un código que
  // `traducir` relanzaría como 500.
  const datos = new FormData()
  datos.set('items', JSON.stringify([{ articuloId: a.id, cantidad: '1', unidadId: 'pepe' }]))
  datos.set('pagos', JSON.stringify([{ medio: 'EFECTIVO', moneda: 'ARS', base: '500000', cotizacion: '1' }]))
  const estado = await cobrar(INICIAL, datos)
  expect(estado.error).toContain('equipo')
})
```

En `app/(app)/vender/punto-de-venta.test.tsx` — `renderConCarrito(lineas)` es
un helper local nuevo: renderiza `<PuntoDeVenta>` con el carrito ya armado,
siguiendo el mismo andamiaje (`SidebarProvider`, `vi.mock('./acciones')`) que
ese archivo ya usa:

```ts
it('la línea de un artículo con serie muestra el IMEI en lugar del stepper', () => {
  const html = renderConCarrito([
    { articuloId: 'a1', descripcion: 'iPhone 13', llevaSerie: true, unidadId: 'u1', imei: '355000000000001', cantidad: '1', /* … */ },
  ])
  expect(html).toContain('355000000000001')
  // El stepper no se dibuja: su cantidad es 1 y no se puede cambiar.
  expect(html).not.toContain('aria-label="Sumar uno"')
})

it('la línea de un artículo SIN serie sigue mostrando el stepper', () => {
  const html = renderConCarrito([
    { articuloId: 'a2', descripcion: 'Funda', llevaSerie: false, cantidad: '2', /* … */ },
  ])
  expect(html).toContain('aria-label="Sumar uno"')
})
```

- [ ] **Step 2: Correr los tests — tienen que fallar**

```bash
npx vitest run "app/(app)/vender"
```

- [ ] **Step 3: Aceptar `unidadId` en `cobrar`**

En el `map` de `items`, junto al guard de `articuloId`:

```ts
      const unidadId = i.unidadId === undefined ? undefined : String(i.unidadId)
      if (unidadId !== undefined && !esUuid(unidadId)) {
        throw new ErrorDeVenta('UNIDAD_INEXISTENTE', 'ese equipo no existe')
      }
```

y devolverlo en el objeto.

- [ ] **Step 4: Llevar la unidad en la línea del carrito**

`type Linea` gana:

```ts
  // Si el artículo se maneja por unidad identificada. Gobierna que la línea
  // muestre el IMEI en vez del stepper y que su cantidad sea siempre 1.
  llevaSerie: boolean
  // La unidad elegida. Presente siempre que `llevaSerie` sea true: una línea
  // con serie sin unidad no se puede cobrar, y el motor la rechaza.
  unidadId?: string
  imei?: string
```

En `agregar(a: ArticuloVendible)`:

- Si `a.unidad` viene (escaneo): si esa unidad **ya está en el carrito**, no
  duplica ni suma — avisa con un toast, porque sumar convertiría dos pasadas del
  lector sobre el mismo equipo en dos ventas del mismo IMEI. Si no está, agrega
  una línea con `cantidad: '1'`.
- Si `a.llevaSerie` y **no** viene `a.unidad` (búsqueda por nombre): abre un
  `Dialog` con las unidades libres de ese artículo. Las trae un server action
  nuevo `unidadesDeArticulo(articuloId)` en `app/(app)/vender/acciones.ts`, que
  envuelve `unidadesLibres` detrás de `exigirSesion()`.
- Si no lleva serie: el camino de hoy, sin cambios (incrementa la cantidad si ya
  está).

En el JSX de la línea, reemplazar el stepper por el IMEI cuando `l.llevaSerie`.
El botón "quitar" (la `x`) **se conserva**: sacar la línea sigue siendo posible.

En el submit, `lineas.map((l) => ({ articuloId: l.articuloId, cantidad:
l.cantidad, unidadId: l.unidadId }))`.

- [ ] **Step 5: El error del motor sale como cartel del mostrador**

`UNIDAD_NO_DISPONIBLE` ya viaja como `ErrorDeVenta`, y `traducir` en
`acciones.ts` lo muestra tal cual — no hace falta código nuevo, pero sí un caso
que lo fije, porque es el que le pasa a la segunda caja:

```ts
it('si otra caja se llevó la unidad, el cartel dice qué pasó', async () => {
  await venderLaUnidad(u.id)                       // la primera caja cobra
  const estado = await cobrar(INICIAL, datosConUnidad(u.id))
  expect(estado.error).toContain('se acaba de vender')
})
```

- [ ] **Step 6: Correr los tests — tienen que pasar**

```bash
npx vitest run "app/(app)/vender" test/responsive.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/vender"
git commit -m "feat(vender): escanear el IMEI o elegir la unidad de una lista"
```

---

### Task 10: el detalle de venta muestra los IMEI, y la documentación

**Files:**
- Modify: `app/(app)/ventas/[id]/page.tsx`
- Modify: `app/(app)/ventas/[id]/page.test.tsx` (o el test que corresponda a esa pantalla)
- Modify: `scripts/sembrar-catalogo-dev.mts`
- Modify: `docs/pantallas.md`
- Modify: `docs/correcciones-pendientes-del-pen.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `Venta.unidades` (Task 1).
- Produces: nada de código hacia afuera.

- [ ] **Step 1: Escribir el test (falla)**

`renderDetalle`, `ventaConUnidades` y `ventaComun` son helpers locales nuevos
del archivo de test: arman la fila de venta contra la base efímera —con y sin
unidades identificadas— y renderizan la pantalla, con el mismo andamiaje que
usan los casos que ya están ahí.

```ts
it('el detalle muestra los IMEI que se llevó la venta', async () => {
  const html = await renderDetalle(ventaConUnidades)
  expect(html).toContain('355000000000001')
})

it('una venta sin unidades identificadas se ve exactamente como antes', async () => {
  // El principio del ciclo: un local que no usa esto no ve ninguna diferencia.
  const html = await renderDetalle(ventaComun)
  expect(html).not.toContain('IMEI')
})
```

- [ ] **Step 2: Correr el test — tiene que fallar**

```bash
npx vitest run "app/(app)/ventas"
```

- [ ] **Step 3: Mostrar los IMEI en el bloque "Qué se vendió"**

La consulta de la venta trae `unidades: { select: { id: true, imei: true, articuloId: true } }`.
Bajo la fila de cada ítem cuyo artículo tenga unidades en esa venta, una línea
con el IMEI. Sin unidades no se dibuja nada — ni el rótulo.

- [ ] **Step 4: Sembrar un artículo con serie en dev**

En `scripts/sembrar-catalogo-dev.mts`, un artículo más: un iPhone con tres
unidades cargadas, con IMEIs de quince dígitos distintos entre sí. Es lo que
permite la verificación manual sin cargar nada a mano — mismo criterio con el
que ese script ya siembra un artículo en dólares.

- [ ] **Step 5: Documentar**

- `docs/pantallas.md`: actualizar las secciones `/inventario/nuevo`,
  `/inventario/[id]`, `/vender` y `/ventas/[id]` con lo que cada una hace ahora
  y las decisiones no obvias (el conteo deshabilitado y por qué; el match exacto
  del IMEI; la línea sin stepper). `test/pantallas.test.ts` ata el archivo a las
  rutas, pero **no puede verificar que el contenido siga siendo cierto**: por eso
  va en este commit y no después.
- `docs/correcciones-pendientes-del-pen.md`: entrada nueva — `design/arandano.pen`
  no dibuja el switch de IMEI, ni la card "Unidades", ni el selector de unidad
  del carrito, ni la línea del carrito sin stepper, en ningún ancho. Todo eso se
  derivó del código con los patrones que ya existen.
- `CLAUDE.md`: entrada nueva en *Próximos pasos técnicos*, con el formato de las
  demás — el feedback textual que lo originó, las cinco decisiones contra su
  alternativa, qué NO hace el ciclo, y la verificación manual pendiente.

- [ ] **Step 6: Correr el gate completo**

```bash
npm test && npm run lint && npx tsc --noEmit && npm run build
```

Los cuatro tienen que pasar. **Ninguno de los cuatro ve** los dos modos de falla
que este repo ya documentó —un Server Component invocando una función de un
módulo `'use client'`, y pasarle una función como prop a un componente cliente—:
el único que los ve es abrir la pantalla, que es el paso siguiente.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/ventas" scripts/sembrar-catalogo-dev.mts docs CLAUDE.md
git commit -m "feat(ventas): el detalle muestra qué equipos se llevó la venta"
```

---

## Verificación manual, después del merge

`arandano-dev` bind-montea `/root/arandano` y no el worktree, así que esto va
**después** del merge, por lo mismo que en los últimos cinco ciclos. Con el
catálogo sembrado:

1. Prender el switch en un artículo que ya tiene stock: tienen que aparecer
   tantos campos como unidades hay, y no queda prendido hasta cargarlos todos.
2. Escanear un IMEI en `/vender`: el artículo entra al carrito con esa unidad
   elegida, y la línea muestra el IMEI en vez del stepper.
3. Escanear dos veces el mismo IMEI: avisa, no duplica.
4. Dar de baja una unidad desde la ficha: el stock baja uno y el historial dice
   cuál se fue, con la nota.
5. Cobrar, anular la venta, y ver que el equipo vuelve a la lista de unidades.
6. A 390 px: la card "Unidades", el "Dar de baja", el diálogo de prender y el
   selector de unidad del carrito. Es el ancho donde más se va a usar, porque
   ahí el lector es la cámara.
7. Un artículo SIN serie tiene que verse **exactamente** como antes: sin switch
   prendido, sin card de Unidades, con su stepper y su corrección por conteo.
