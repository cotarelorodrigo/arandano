# Servicio Técnico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un local pueda recibir un equipo en el mostrador, seguirlo por sus ocho estados hasta entregarlo, y darle al cliente un ticket térmico con su copia y la del local.

**Architecture:** Dos tablas nuevas con RLS (`ordenes_de_trabajo` y `eventos_orden`, esta última append-only), la lógica de dominio en `lib/ordenes-de-trabajo/` corriendo dentro de `enTransaccionDeTenant`, y cuatro pantallas bajo `app/(app)/servicio-tecnico/` con el mismo reparto que `/inventario` y `/ventas` — página de servidor que consulta con `prismaParaTenant`, server actions que reexigen el rol, formularios `'use client'`. Nada del núcleo se modifica: es todo código nuevo al lado del existente.

**Tech Stack:** Next.js App Router + TypeScript, Prisma 7 sobre PostgreSQL con Row Level Security, vitest contra un Postgres efímero, Tailwind v4 + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-08-15-servicio-tecnico-design.md` — leerlo entero antes de empezar. El plan argumenta desde ahí.

## Global Constraints

Aplican a **todas** las tasks. No se repiten en cada una.

- **Todo en español rioplatense**: nombres de funciones, variables, comentarios, mensajes de error y textos de pantalla. El repo entero está así.
- **Importes con `Prisma.Decimal`, nunca `Float`.** Un flotante binario no representa 0,10.
- **Los server actions reexigen el rol.** Que la UI esconda un botón no es un permiso. `exigirSesion()` para todo, `exigirDuenio()` para anular.
- **En archivos `'use server'` todo export es una función `async`.** Una constante exportada tira abajo la pantalla en runtime con el build en verde. Lo fija `test/use-server.test.ts`. Los valores iniciales de `useActionState` viven en `formularios.tsx`.
- **Toda pantalla nueva va bajo `app/(app)/`**, o `test/rutas-con-guard.test.ts` falla.
- **Toda ruta con `[param]` necesita entrada en `RUTAS_SIN_SMOKE`** (`scripts/lib/rutas-comun.sh`) **con su razón escrita**, o el gate entero no arranca.
- **La migración es aditiva**: ni un `DROP`, ni un `RENAME`. Es lo que mantiene vivo el rollback a la imagen anterior.
- **Los tests que tocan la base importan dinámicamente** todo lo que arrastre `lib/db.ts`, después de setear `process.env.DATABASE_URL = urlApp()`. Ese módulo construye su Pool al importarse. Ver el encabezado de `test/inventario.test.ts`.
- **Los colores salen de los tokens de `app/globals.css`.** La única excepción de este ciclo es el ticket, y va declarada en `docs/sistema-de-diseno.md` con su razón (Task 9).
- **Correr `npm test` antes de cada commit.** Corre `scripts/tests/correr-todos.sh` y después `vitest run`.
- **Un commit por task**, con el mensaje explicando el porqué y no sólo el qué.

---

### Task 1: El schema, la migración y RLS

Las dos tablas, el enum y los dos correlativos. Sin esto no hay nada que probar.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_servicio_tecnico/migration.sql` (lo genera Prisma; se le agrega el bloque de RLS a mano)
- Modify: `docs/schema.md` (lo regenera `scripts/generar-erd.sh`)

**Interfaces:**
- Consumes: nada.
- Produces: los modelos `OrdenDeTrabajo` y `EventoOrden`, el enum `EstadoOrden` con sus ocho valores, `Tenant.proximoNumeroOrden`. Todo lo demás del plan depende de esto.

- [ ] **Step 1: Agregar el enum y los dos modelos a `prisma/schema.prisma`**

El bloque completo, con sus comentarios — el spec explica cada decisión y los comentarios la dejan al lado del código:

```prisma
enum EstadoOrden {
  RECIBIDO
  EN_DIAGNOSTICO
  PRESUPUESTADO
  EN_REPARACION
  LISTO
  ENTREGADO
  SIN_REPARACION
  RECHAZADO

  @@map("estado_orden")
}

model OrdenDeTrabajo {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  // Sin huecos, por tenant: es el número que el cliente lee del ticket y dice
  // por teléfono. Mismo mecanismo que Venta.numero, y la decisión INVERSA a la
  // de proximoSkuArticulo, que sí tolera huecos porque un SKU no se recita.
  numero   Int
  // El doble click acá no cobra dos veces: imprime dos tickets con números
  // distintos para un solo equipo, y el cliente se lleva uno de los dos.
  claveIdempotencia String? @map("clave_idempotencia")

  // NO nullable, al revés que Venta.clienteId: una orden sin cliente no sirve,
  // porque el punto de todo esto es saber a quién llamar.
  clienteId     String      @map("cliente_id") @db.Uuid
  recibidaPorId String      @map("recibida_por_id") @db.Uuid
  estado        EstadoOrden @default(RECIBIDO)

  equipoMarca  String  @map("equipo_marca")
  equipoModelo String  @map("equipo_modelo")
  // IMEI o número de serie. Opcional: hay equipos que entran sin encender.
  equipoSerie  String? @map("equipo_serie")
  // Texto plano y legible a propósito: el técnico tiene que USARLA para probar
  // que el arreglo funcionó, no compararla, así que hashearla no es una opción.
  // NO se imprime nunca, ni en la copia del local — lo asegura un test.
  claveDesbloqueo String? @map("clave_desbloqueo")

  // Lo que dijo el cliente. Obligatorio: es el motivo por el que el equipo
  // está acá, y va impreso en las dos copias.
  fallaDeclarada String  @map("falla_declarada")
  accesorios     String?
  danosVisibles  String? @map("danos_visibles")

  // Lo que encontró el técnico. Se carga después de recibir.
  diagnostico   String?
  // En pesos. Un número, no un documento: alcanza para decirle un precio al
  // cliente y para que el estado PRESUPUESTADO signifique algo.
  montoEstimado Decimal? @map("monto_estimado") @db.Decimal(12, 2)

  // Anular es columna y no estado: como estado pisaría el estado anterior, y
  // se puede anular desde cualquier punto del ciclo. Misma forma que Venta.
  anuladaEn    DateTime? @map("anulada_en") @db.Timestamptz(3)
  anuladaPorId String?   @map("anulada_por_id") @db.Uuid

  creadoEn      DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant      Tenant  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // Restrict: borrar un cliente no puede borrar la historia de sus equipos.
  cliente     Cliente @relation(fields: [clienteId], references: [id], onDelete: Restrict)
  recibidaPor User    @relation("OrdenesRecibidas", fields: [recibidaPorId], references: [id], onDelete: Restrict)
  anuladaPor  User?   @relation("OrdenesAnuladas", fields: [anuladaPorId], references: [id], onDelete: Restrict)

  eventos EventoOrden[]

  @@unique([tenantId, numero])
  @@unique([tenantId, claveIdempotencia])
  // El tablero filtra por estado y ordena por fecha: éste es su índice.
  @@index([tenantId, estado, creadoEn])
  @@index([tenantId, clienteId])
  @@map("ordenes_de_trabajo")
}

// Append-only, como movimientos_stock: nada se edita ni se borra. Es lo que
// responde "hace dos semanas que está acá, ¿qué pasó?".
model EventoOrden {
  id       String @id @default(uuid(7)) @db.Uuid
  tenantId String @map("tenant_id") @db.Uuid
  ordenId  String @map("orden_id") @db.Uuid

  // Null en el evento de apertura, que no viene de ningún estado.
  desde EstadoOrden?
  hasta EstadoOrden
  nota  String?

  usuarioId String   @map("usuario_id") @db.Uuid
  creadoEn  DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)

  tenant  Tenant         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  orden   OrdenDeTrabajo @relation(fields: [ordenId], references: [id], onDelete: Cascade)
  usuario User           @relation(fields: [usuarioId], references: [id], onDelete: Restrict)

  @@index([tenantId, ordenId, creadoEn])
  @@map("eventos_orden")
}
```

- [ ] **Step 2: Agregar el correlativo y las relaciones inversas**

En `model Tenant`, junto a `proximoNumeroVenta` y `proximoSkuArticulo`:

```prisma
  // El tercer correlativo por tenant. Va SIN huecos, como el de ventas.
  proximoNumeroOrden Int @default(1) @map("proximo_numero_orden")
```

Y en la lista de relaciones de `Tenant`:

```prisma
  ordenes      OrdenDeTrabajo[]
  eventosOrden EventoOrden[]
```

En `model Cliente`, junto a `ventas Venta[]`:

```prisma
  ordenes OrdenDeTrabajo[]
```

En `model User`, junto a `ventasHechas` / `ventasAnuladas`:

```prisma
  ordenesRecibidas OrdenDeTrabajo[] @relation("OrdenesRecibidas")
  ordenesAnuladas  OrdenDeTrabajo[] @relation("OrdenesAnuladas")
  eventosOrden     EventoOrden[]
```

- [ ] **Step 3: Generar la migración SIN aplicarla**

Run: `npx prisma migrate dev --create-only --name servicio_tecnico`
Expected: crea `prisma/migrations/<timestamp>_servicio_tecnico/migration.sql` con los `CREATE TABLE`, los índices y las FKs, y **no** lo aplica.

`--create-only` no es opcional: hay que editar el SQL antes de que corra, porque Prisma no sabe nada de RLS.

- [ ] **Step 4: Verificar que la migración no tenga nada destructivo**

Run: `grep -iE 'DROP|RENAME' prisma/migrations/*_servicio_tecnico/migration.sql`
Expected: **cero líneas**. Si aparece algo, el schema quedó mal escrito — sin flags, una migración destructiva deja al rollback sin red.

- [ ] **Step 5: Agregar el bloque de RLS al final del SQL generado**

Al final de `migration.sql`, literal — la misma expresión que las otras migraciones, copiada y no reinventada:

```sql
-- ---------------------------------------------------------------------------
-- Row Level Security. Misma expresión que las migraciones anteriores, copiada
-- literal y no reinventada: dos formas distintas de escribir el mismo
-- aislamiento son dos cosas que se pueden desincronizar.
--
-- Sin la GUC seteada, current_setting(..., true) devuelve NULL, el nullif evita
-- que una cadena vacía haga explotar el cast, y NULL = uuid da NULL — que no es
-- true. O sea: SIN GUC NO PASA NINGUNA FILA. Falla cerrado.
-- ---------------------------------------------------------------------------

ALTER TABLE "ordenes_de_trabajo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "ordenes_de_trabajo" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "eventos_orden" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "eventos_orden" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 6: Aplicar la migración y regenerar el cliente**

Run: `npx prisma migrate dev`
Expected: aplica la migración pendiente contra `arandano-dev` y regenera el cliente en `generated/prisma`.

- [ ] **Step 7: Correr los tests y verificar que RLS quedó cubierta**

Run: `npm test`
Expected: PASS. Interesa especialmente `test/rls-cobertura.test.ts` — levanta las tablas del catálogo de Postgres y falla si alguna con `tenant_id` no tiene RLS con `USING` y `WITH CHECK`. Si el Step 5 se salteó, **ese test es el que lo agarra**, sin que nadie haya agregado las tablas a ninguna lista.

- [ ] **Step 8: Regenerar el diagrama del schema**

Run: `scripts/generar-erd.sh`
Expected: `docs/schema.md` actualizado con las dos tablas nuevas. El hook de pre-commit y el paso 3 de `deploy.sh` fallan si quedó desactualizado.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md
git commit -m "feat(servicio-tecnico): las tablas de la orden y su bitácora

Aditiva y nada más: dos tablas, un enum y un correlativo. Ningún drop ni
rename, así que la imagen anterior sigue corriendo contra este schema y el
rollback automático conserva su red.

La bitácora es append-only por el mismo motivo que movimientos_stock: la
pregunta del cliente que reclama no es en qué estado está, es qué pasó."
```

---

### Task 2: El grafo de estados

Una función pura y su tabla. Va antes que todo lo que toque la base porque es lo que decide qué es una transición legal.

**Files:**
- Create: `lib/ordenes-de-trabajo/estados.ts`
- Test: `lib/ordenes-de-trabajo/estados.test.ts`

**Interfaces:**
- Consumes: el tipo `EstadoOrden` de Task 1.
- Produces: `ESTADOS: readonly EstadoOrden[]`, `TRANSICIONES: Record<EstadoOrden, readonly EstadoOrden[]>`, `puedeTransicionar(desde, hasta): boolean`, `ABIERTOS: readonly EstadoOrden[]`, `NOMBRE_ESTADO: Record<EstadoOrden, string>`.

- [ ] **Step 1: Escribir el test que falla**

`lib/ordenes-de-trabajo/estados.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ESTADOS,
  TRANSICIONES,
  puedeTransicionar,
  ABIERTOS,
  NOMBRE_ESTADO,
} from './estados'

describe('el grafo de estados de una orden', () => {
  it('los ocho estados tienen fila en la tabla de transiciones', () => {
    expect(ESTADOS).toHaveLength(8)
    for (const e of ESTADOS) {
      expect(TRANSICIONES[e], `${e} no tiene fila`).toBeDefined()
    }
  })

  it('ningún estado transiciona a sí mismo', () => {
    // No es cosmético: la anulación se distingue de una transición porque
    // ninguna transición legal deja desde === hasta.
    for (const e of ESTADOS) {
      expect(TRANSICIONES[e], `${e} transiciona a sí mismo`).not.toContain(e)
    }
  })

  it('desde todo estado se llega a ENTREGADO', () => {
    // El test que atrapa el callejón sin salida: si alguien agrega un estado
    // nuevo del que no se puede salir, el equipo queda atrapado en el tablero
    // para siempre y nadie lo nota hasta que pasa con un equipo de verdad.
    for (const inicio of ESTADOS) {
      const vistos = new Set([inicio])
      const cola = [inicio]
      let llega = inicio === 'ENTREGADO'
      while (cola.length > 0 && !llega) {
        for (const siguiente of TRANSICIONES[cola.shift()!]) {
          if (siguiente === 'ENTREGADO') llega = true
          if (!vistos.has(siguiente)) {
            vistos.add(siguiente)
            cola.push(siguiente)
          }
        }
      }
      expect(llega, `desde ${inicio} no se llega a ENTREGADO`).toBe(true)
    }
  })

  it('acepta las transiciones del mostrador', () => {
    expect(puedeTransicionar('RECIBIDO', 'EN_DIAGNOSTICO')).toBe(true)
    // El equipo que se sabe qué tiene no necesita diagnosticarse.
    expect(puedeTransicionar('RECIBIDO', 'EN_REPARACION')).toBe(true)
    // Se abrió y apareció algo más: hay que volver a hablar con el cliente.
    expect(puedeTransicionar('EN_REPARACION', 'PRESUPUESTADO')).toBe(true)
    // No quedó bien y vuelve al banco antes de que el cliente lo retire.
    expect(puedeTransicionar('LISTO', 'EN_REPARACION')).toBe(true)
    // La garantía: el equipo entregado que vuelve.
    expect(puedeTransicionar('ENTREGADO', 'EN_REPARACION')).toBe(true)
    // No se arregló, pero el equipo sigue acá hasta que lo vengan a buscar.
    expect(puedeTransicionar('SIN_REPARACION', 'ENTREGADO')).toBe(true)
    expect(puedeTransicionar('RECHAZADO', 'ENTREGADO')).toBe(true)
  })

  it('rechaza los saltos que no existen', () => {
    expect(puedeTransicionar('RECIBIDO', 'LISTO')).toBe(false)
    expect(puedeTransicionar('RECIBIDO', 'ENTREGADO')).toBe(false)
    expect(puedeTransicionar('ENTREGADO', 'LISTO')).toBe(false)
    expect(puedeTransicionar('SIN_REPARACION', 'EN_REPARACION')).toBe(false)
  })

  it('ABIERTOS es todo menos ENTREGADO', () => {
    expect(ABIERTOS).toHaveLength(7)
    expect(ABIERTOS).not.toContain('ENTREGADO')
  })

  it('todo estado tiene nombre para mostrar', () => {
    for (const e of ESTADOS) {
      expect(NOMBRE_ESTADO[e], `${e} no tiene nombre`).toBeTruthy()
      // En castellano y para una persona: el tablero no muestra EN_DIAGNOSTICO.
      expect(NOMBRE_ESTADO[e]).not.toContain('_')
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/ordenes-de-trabajo/estados.test.ts`
Expected: FAIL — `Failed to resolve import "./estados"`.

- [ ] **Step 3: Escribir `lib/ordenes-de-trabajo/estados.ts`**

```ts
import type { EstadoOrden } from '@/generated/prisma/client'

/**
 * Los ocho estados, en el orden en que se recorren. El orden importa: es el que
 * usa el tablero para ordenar sus contadores.
 */
export const ESTADOS: readonly EstadoOrden[] = [
  'RECIBIDO',
  'EN_DIAGNOSTICO',
  'PRESUPUESTADO',
  'EN_REPARACION',
  'LISTO',
  'ENTREGADO',
  'SIN_REPARACION',
  'RECHAZADO',
]

/**
 * Qué transiciones son legales. Es la fuente de verdad: la pantalla dibuja los
 * botones a partir de esta tabla, pero el server action la vuelve a consultar
 * antes de escribir. Una UI que esconde un botón no es una validación.
 *
 * `SIN_REPARACION` y `RECHAZADO` NO son terminales, y ésa es la decisión que
 * más define el modelo: el equipo sigue en el estante hasta que el cliente lo
 * viene a buscar. El único estado final es ENTREGADO — se entrega arreglado,
 * sin arreglar, o porque el cliente no aceptó el presupuesto. Que se haya
 * entregado sin arreglar sale de la bitácora, que es para lo que existe.
 */
export const TRANSICIONES: Record<EstadoOrden, readonly EstadoOrden[]> = {
  RECIBIDO: ['EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'SIN_REPARACION'],
  EN_DIAGNOSTICO: ['PRESUPUESTADO', 'EN_REPARACION', 'SIN_REPARACION'],
  PRESUPUESTADO: ['EN_REPARACION', 'RECHAZADO', 'SIN_REPARACION'],
  // A PRESUPUESTADO: se abrió el equipo y apareció algo más.
  EN_REPARACION: ['LISTO', 'PRESUPUESTADO', 'SIN_REPARACION'],
  // A EN_REPARACION: no quedó bien, y vuelve al banco antes de que lo retiren.
  LISTO: ['ENTREGADO', 'EN_REPARACION'],
  // A EN_REPARACION: la garantía. Hoy eso es una orden nueva en el cuaderno,
  // que pierde la historia de la anterior.
  ENTREGADO: ['EN_REPARACION'],
  SIN_REPARACION: ['ENTREGADO'],
  RECHAZADO: ['ENTREGADO'],
}

export function puedeTransicionar(desde: EstadoOrden, hasta: EstadoOrden): boolean {
  return TRANSICIONES[desde].includes(hasta)
}

/**
 * Lo que sigue en el local. Es el filtro por defecto del tablero: el equipo
 * entregado ya no es problema de nadie.
 */
export const ABIERTOS: readonly EstadoOrden[] = ESTADOS.filter((e) => e !== 'ENTREGADO')

/** Cómo se lee cada estado en pantalla. Nadie tiene que ver EN_DIAGNOSTICO. */
export const NOMBRE_ESTADO: Record<EstadoOrden, string> = {
  RECIBIDO: 'Recibido',
  EN_DIAGNOSTICO: 'En diagnóstico',
  PRESUPUESTADO: 'Presupuestado',
  EN_REPARACION: 'En reparación',
  LISTO: 'Listo',
  ENTREGADO: 'Entregado',
  SIN_REPARACION: 'Sin reparación',
  RECHAZADO: 'Rechazado',
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npx vitest run lib/ordenes-de-trabajo/estados.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/ordenes-de-trabajo/estados.ts lib/ordenes-de-trabajo/estados.test.ts
git commit -m "feat(servicio-tecnico): el grafo de estados, con su callejón sin salida probado

El test que importa no es el de las transiciones válidas: es el que recorre el
grafo desde cada estado y exige llegar a ENTREGADO. Un estado del que no se
pueda salir deja un equipo atrapado en el tablero, y eso no se nota hasta que
pasa con un equipo de verdad."
```

---

### Task 3: Clientes — buscar y dar de alta al vuelo

La recepción exige cliente, y hoy no hay forma de crear uno desde la aplicación. Esto es lo mínimo para que eso deje de ser cierto: **no** construye la sección `/clientes`.

**Files:**
- Create: `lib/clientes/errores.ts`
- Create: `lib/clientes/administrar.ts`
- Test: `test/clientes.test.ts`

**Interfaces:**
- Consumes: `enTransaccionDeTenant` de `@/lib/tenant/transaccion`.
- Produces:
  - `class ErrorDeCliente extends Error` con `readonly codigo: 'NOMBRE_VACIO'`
  - `crearCliente({ tenantId, nombre, telefono }): Promise<{ id: string; nombre: string }>`
  - `buscarClientes(tenantId: string, texto: string, limite?: number): Promise<{ id: string; nombre: string; telefono: string | null }[]>`

- [ ] **Step 1: Escribir el test que falla**

`test/clientes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeCliente } from '@/lib/clientes/errores'

// Import DINÁMICO de todo lo que arrastre lib/db.ts: ese módulo construye su
// Pool AL IMPORTARSE, leyendo DATABASE_URL, que no está seteada globalmente.
let crearCliente: typeof import('@/lib/clientes/administrar').crearCliente
let buscarClientes: typeof import('@/lib/clientes/administrar').buscarClientes

let owner: Client
let tenantId: string
let otroTenantId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ crearCliente, buscarClientes } = await import('@/lib/clientes/administrar'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `clientes-${Date.now()}`)
  otroTenantId = await crearTenant(owner, `clientes-otro-${Date.now()}`)
})

afterAll(async () => {
  await owner.end()
})

describe('alta de cliente', () => {
  it('crea el cliente y devuelve su id', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Juan Pérez', telefono: '1155667788' })
    expect(c.id).toBeTruthy()
    expect(c.nombre).toBe('Juan Pérez')
  })

  it('rechaza el nombre vacío', async () => {
    await expect(crearCliente({ tenantId, nombre: '   ', telefono: null })).rejects.toThrow(
      ErrorDeCliente,
    )
  })

  it('acepta el teléfono en null: no todo cliente lo deja', async () => {
    const c = await crearCliente({ tenantId, nombre: 'Sin teléfono', telefono: null })
    expect(c.id).toBeTruthy()
  })
})

describe('búsqueda de clientes', () => {
  beforeAll(async () => {
    await crearCliente({ tenantId, nombre: 'Ana Gómez', telefono: '1144332211' })
    await crearCliente({ tenantId, nombre: 'Ana María López', telefono: '1199887766' })
    await crearCliente({ tenantId: otroTenantId, nombre: 'Ana Ajena', telefono: '1100000000' })
  })

  it('encuentra por nombre, sin importar mayúsculas', async () => {
    const r = await buscarClientes(tenantId, 'ana')
    expect(r.length).toBeGreaterThanOrEqual(2)
    expect(r.every((c) => c.nombre.toLowerCase().includes('ana'))).toBe(true)
  })

  it('encuentra por teléfono', async () => {
    const r = await buscarClientes(tenantId, '1144332211')
    expect(r).toHaveLength(1)
    expect(r[0].nombre).toBe('Ana Gómez')
  })

  it('NO ve los clientes de otro tenant', async () => {
    // El corazón del multi-tenant: el nombre existe, y aun así no aparece.
    const r = await buscarClientes(tenantId, 'Ana Ajena')
    expect(r).toHaveLength(0)
  })

  it('con la búsqueda vacía no devuelve nada', async () => {
    // Y NO todos: un buscador que sin texto vuelca la tabla entera es un scan
    // sobre la pantalla más caliente del módulo.
    expect(await buscarClientes(tenantId, '   ')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/clientes.test.ts`
Expected: FAIL — no resuelve `@/lib/clientes/errores`.

- [ ] **Step 3: Escribir `lib/clientes/errores.ts`**

```ts
export type CodigoErrorDeCliente = 'NOMBRE_VACIO'

/**
 * Con código y no sólo con mensaje, igual que ErrorDeInventario y ErrorDeVenta:
 * la pantalla tiene que poder distinguir qué pasó sin parsear strings.
 */
export class ErrorDeCliente extends Error {
  constructor(
    readonly codigo: CodigoErrorDeCliente,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeCliente'
  }
}
```

- [ ] **Step 4: Escribir `lib/clientes/administrar.ts`**

```ts
import { enTransaccionDeTenant } from '@/lib/tenant/transaccion'
import { ErrorDeCliente } from './errores'

export type EntradaCrearCliente = {
  tenantId: string
  nombre: string
  telefono: string | null
}

/**
 * El alta mínima: nombre y teléfono. Existe para el alta AL VUELO desde la
 * recepción de un equipo — la sección /clientes completa (listado, edición,
 * historial) es su propio ciclo y no entra acá.
 */
export async function crearCliente(
  entrada: EntradaCrearCliente,
): Promise<{ id: string; nombre: string }> {
  const nombre = entrada.nombre.trim()
  if (nombre === '') {
    throw new ErrorDeCliente('NOMBRE_VACIO', 'el cliente necesita un nombre')
  }
  const telefono = entrada.telefono?.trim() || null

  return enTransaccionDeTenant(entrada.tenantId, async (tx) => {
    const c = await tx.cliente.create({
      data: { tenantId: entrada.tenantId, nombre, telefono },
      select: { id: true, nombre: true },
    })
    return c
  })
}

/** Cuántos resultados devuelve el buscador. Es una lista para elegir de un
 *  vistazo en el mostrador, no un listado paginado. */
const LIMITE_POR_DEFECTO = 10

/**
 * Busca por nombre o por teléfono.
 *
 * Con el texto vacío devuelve la lista vacía y NO todos los clientes: un
 * buscador que sin texto vuelca la tabla entera es un scan sobre la pantalla
 * que más se abre del módulo.
 */
export async function buscarClientes(
  tenantId: string,
  texto: string,
  limite: number = LIMITE_POR_DEFECTO,
): Promise<{ id: string; nombre: string; telefono: string | null }[]> {
  const busqueda = texto.trim()
  if (busqueda === '') return []

  return enTransaccionDeTenant(tenantId, async (tx) =>
    tx.cliente.findMany({
      where: {
        OR: [
          { nombre: { contains: busqueda, mode: 'insensitive' } },
          { telefono: { contains: busqueda } },
        ],
      },
      orderBy: { nombre: 'asc' },
      take: limite,
      select: { id: true, nombre: true, telefono: true },
    }),
  )
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run test/clientes.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/clientes test/clientes.test.ts
git commit -m "feat(clientes): alta al vuelo y buscador, lo mínimo que la recepción necesita

Deliberadamente NO es la sección /clientes: sin esto no se puede recibir un
equipo, porque la orden exige cliente y hoy no hay forma de crear uno desde la
aplicación. El listado, la edición y el historial son su propio ciclo.

El buscador con texto vacío devuelve vacío y no todo: volcar la tabla entera
es un scan sobre la pantalla más caliente del módulo."
```

---

### Task 4: `crearOrden` — el correlativo, la idempotencia y el primer evento

**Files:**
- Create: `lib/ordenes-de-trabajo/errores.ts`
- Create: `lib/ordenes-de-trabajo/crear.ts`
- Test: `test/ordenes-de-trabajo.test.ts`

**Interfaces:**
- Consumes: `enTransaccionDeTenant` y `ClienteTx` de `@/lib/tenant/transaccion`; `exigirCliente` y `exigirUsuario` de `@/lib/ventas/pertenencia`.
- Produces:
  - `class ErrorDeOrden extends Error` con `readonly codigo: CodigoErrorDeOrden`
  - `crearOrden(entrada: EntradaCrearOrden): Promise<{ id: string; numero: number }>`

- [ ] **Step 1: Escribir el test que falla**

`test/ordenes-de-trabajo.test.ts` (este archivo crece en la Task 5; acá va la primera mitad):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeOrden } from '@/lib/ordenes-de-trabajo/errores'

let crearOrden: typeof import('@/lib/ordenes-de-trabajo/crear').crearOrden
let crearCliente: typeof import('@/lib/clientes/administrar').crearCliente

let owner: Client
let tenantId: string
let usuarioId: string
let clienteId: string
let otroTenantId: string
let clienteAjeno: string

const equipo = {
  equipoMarca: 'Samsung',
  equipoModelo: 'A54',
  fallaDeclarada: 'no carga',
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ crearOrden } = await import('@/lib/ordenes-de-trabajo/crear'))
  ;({ crearCliente } = await import('@/lib/clientes/administrar'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `ordenes-${Date.now()}`)
  otroTenantId = await crearTenant(owner, `ordenes-otro-${Date.now()}`)

  const u = await owner.query(
    `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, 'Técnico', 't@ot.test', 'EMPLEADO', now(), now())
     RETURNING id`,
    [tenantId],
  )
  usuarioId = u.rows[0].id
  clienteId = (await crearCliente({ tenantId, nombre: 'Juan', telefono: '111' })).id
  clienteAjeno = (await crearCliente({ tenantId: otroTenantId, nombre: 'Ajeno', telefono: '2' })).id
})

afterAll(async () => {
  await owner.end()
})

describe('alta de una orden', () => {
  it('numera desde 1 y sigue de a uno, sin huecos', async () => {
    const a = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const b = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    expect(b.numero).toBe(a.numero + 1)
  })

  it('nace en RECIBIDO con su evento de apertura', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const { rows } = await owner.query(
      `SELECT e.desde, e.hasta, e.usuario_id, o.estado
         FROM eventos_orden e JOIN ordenes_de_trabajo o ON o.id = e.orden_id
        WHERE e.orden_id = $1`,
      [o.id],
    )
    expect(rows).toHaveLength(1)
    // desde en null: el alta no viene de ningún estado.
    expect(rows[0].desde).toBeNull()
    expect(rows[0].hasta).toBe('RECIBIDO')
    expect(rows[0].estado).toBe('RECIBIDO')
    expect(rows[0].usuario_id).toBe(usuarioId)
  })

  it('la misma clave de idempotencia devuelve la orden que ya existe', async () => {
    const clave = `clave-${Date.now()}`
    const a = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave })
    const b = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave })
    expect(b.id).toBe(a.id)
    expect(b.numero).toBe(a.numero)
  })

  it('dos altas simultáneas con la misma clave crean UNA sola orden', async () => {
    // La carrera real del doble click. El chequeo previo puede no verlas
    // encontrarse: la defensa que cierra es el índice único de la base.
    const clave = `carrera-${Date.now()}`
    const [a, b] = await Promise.all([
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave }),
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, claveIdempotencia: clave }),
    ])
    expect(b.id).toBe(a.id)
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM ordenes_de_trabajo WHERE clave_idempotencia = $1`,
      [clave],
    )
    expect(rows[0].n).toBe(1)
  })

  it('sin clave, dos altas iguales son dos órdenes distintas', async () => {
    // Correcto y no un defecto: dos clientes pueden traer el mismo modelo con
    // la misma falla el mismo día. La clave la manda la pantalla, no el motor.
    const a = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const b = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    expect(b.id).not.toBe(a.id)
  })

  it('rechaza la falla declarada vacía', async () => {
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, fallaDeclarada: '  ' }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('rechaza marca o modelo vacíos', async () => {
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, equipoMarca: '' }),
    ).rejects.toThrow(ErrorDeOrden)
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId, ...equipo, equipoModelo: '' }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('rechaza un cliente de otro tenant', async () => {
    // Las FKs de Postgres no distinguen tenants: el chequeo es nuestro.
    await expect(
      crearOrden({ tenantId, usuarioId, clienteId: clienteAjeno, ...equipo }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/ordenes-de-trabajo.test.ts`
Expected: FAIL — no resuelve `@/lib/ordenes-de-trabajo/errores`.

- [ ] **Step 3: Escribir `lib/ordenes-de-trabajo/errores.ts`**

```ts
export type CodigoErrorDeOrden =
  | 'TENANT_INEXISTENTE'
  | 'ORDEN_INEXISTENTE'
  | 'MARCA_VACIA'
  | 'MODELO_VACIO'
  | 'FALLA_VACIA'
  | 'TRANSICION_INVALIDA'
  | 'ORDEN_ANULADA'
  | 'MONTO_INVALIDO'

/**
 * Con código y no sólo con mensaje, igual que ErrorDeInventario y ErrorDeVenta:
 * la pantalla distingue "ese salto de estado no existe" de "la falla está
 * vacía" sin parsear strings.
 *
 * `exigirCliente` y `exigirUsuario` (lib/ventas/pertenencia.ts) tiran
 * `ErrorDeVenta` y no esta clase, y se reusan igual: duplicar el chequeo de
 * pertenencia para cambiarle la clase al error sería tener dos chequeos que se
 * pueden desincronizar. Con una sesión válida ninguno de los dos puede saltar
 * —RLS garantiza que el usuario y el cliente son de este tenant—, así que si
 * salta es un bug y tiene que llegar a Sentry como 500, no quedar tapado por
 * un cartel amable. Es el mismo razonamiento que ya está escrito en
 * lib/inventario/errores.ts.
 */
export class ErrorDeOrden extends Error {
  constructor(
    readonly codigo: CodigoErrorDeOrden,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeOrden'
  }
}
```

- [ ] **Step 4: Escribir `lib/ordenes-de-trabajo/crear.ts`**

```ts
import { Prisma } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirCliente, exigirUsuario } from '@/lib/ventas/pertenencia'
import { ErrorDeOrden } from './errores'

export type EntradaCrearOrden = {
  tenantId: string
  usuarioId: string
  // Obligatorio, al revés que en una venta: el punto de una orden es saber a
  // quién llamar cuando el equipo está listo.
  clienteId: string
  equipoMarca: string
  equipoModelo: string
  equipoSerie?: string | null
  claveDesbloqueo?: string | null
  fallaDeclarada: string
  accesorios?: string | null
  danosVisibles?: string | null
  // Opcional: el motor no la inventa. La pantalla sí la manda. Mismo criterio
  // que crearVenta.
  claveIdempotencia?: string
}

const limpio = (v: string | null | undefined): string | null => v?.trim() || null

export async function crearOrden(
  entrada: EntradaCrearOrden,
): Promise<{ id: string; numero: number }> {
  const { tenantId, usuarioId, clienteId, claveIdempotencia } = entrada

  const equipoMarca = entrada.equipoMarca.trim()
  const equipoModelo = entrada.equipoModelo.trim()
  const fallaDeclarada = entrada.fallaDeclarada.trim()

  if (equipoMarca === '') throw new ErrorDeOrden('MARCA_VACIA', 'falta la marca del equipo')
  if (equipoModelo === '') throw new ErrorDeOrden('MODELO_VACIO', 'falta el modelo del equipo')
  if (fallaDeclarada === '') {
    throw new ErrorDeOrden('FALLA_VACIA', 'hay que anotar qué dijo el cliente que le pasa')
  }

  try {
    return await enTransaccionDeTenant(tenantId, async (tx) => {
      // ANTES de tomar el correlativo: si esta clave ya dio de alta una orden,
      // no hay nada que hacer más que devolver la que se creó la primera vez.
      // Es el camino rápido del caso común (el doble click con medio segundo de
      // diferencia); el índice único es el que cierra la carrera exacta.
      if (claveIdempotencia !== undefined) {
        const yaExiste = await tx.ordenDeTrabajo.findFirst({
          where: { claveIdempotencia },
          select: { id: true, numero: true },
        })
        if (yaExiste) return yaExiste
      }

      // Las FKs de Postgres no distinguen tenants. El porqué completo está en
      // lib/ventas/pertenencia.ts.
      await exigirCliente(tx, clienteId)
      await exigirUsuario(tx, usuarioId)

      // Lo más tarde posible: toma el lock de la fila del tenant y lo retiene
      // hasta el commit, o sea que serializa las altas de ese negocio.
      const numero = await proximoNumero(tx, tenantId)

      const orden = await tx.ordenDeTrabajo.create({
        data: {
          tenantId,
          numero,
          claveIdempotencia,
          clienteId,
          recibidaPorId: usuarioId,
          estado: 'RECIBIDO',
          equipoMarca,
          equipoModelo,
          equipoSerie: limpio(entrada.equipoSerie),
          claveDesbloqueo: limpio(entrada.claveDesbloqueo),
          fallaDeclarada,
          accesorios: limpio(entrada.accesorios),
          danosVisibles: limpio(entrada.danosVisibles),
          // El evento de apertura, en la MISMA transacción: una orden sin su
          // primera línea de bitácora es una historia que arranca por la mitad.
          eventos: {
            create: [{ tenantId, desde: null, hasta: 'RECIBIDO', usuarioId }],
          },
        },
        select: { id: true, numero: true },
      })

      return orden
    })
  } catch (e) {
    // El choque de la clave no es una falla: es la respuesta correcta llegando
    // dos veces. ACÁ AFUERA y no adentro del callback, porque una violación de
    // unicidad ABORTA la transacción en Postgres y cualquier consulta posterior
    // sobre esa conexión falla con "current transaction is aborted".
    if (claveIdempotencia !== undefined && esP2002(e)) {
      const yaExiste = await enTransaccionDeTenant(tenantId, async (tx) =>
        tx.ordenDeTrabajo.findFirst({
          where: { claveIdempotencia },
          select: { id: true, numero: true },
        }),
      )
      // Si aparece, el choque era éste. Si no, era el correlativo y relanzar es
      // lo correcto: devolver algo ahí sería inventar.
      if (yaExiste) return yaExiste
    }
    throw e
  }
}

/**
 * No mira QUÉ unicidad chocó, y no es pereza: bajo `arandano_app` Postgres
 * retiene el detalle del error porque la policy de RLS aplica al rol que
 * consulta, así que `constraint.fields` no está disponible. Quién chocó se
 * decide después, buscando la clave.
 */
function esP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * El correlativo por tenant, incrementado dentro de la transacción.
 *
 * Un `UPDATE … RETURNING` y no un `count()`: contar órdenes daría el mismo
 * número a dos altas concurrentes. Esto las serializa —toma el lock de la fila
 * del tenant— y a cambio no hay huecos ni repetidos, que es lo que hace que
 * "la orden 42" sirva para hablar por teléfono.
 */
async function proximoNumero(tx: ClienteTx, tenantId: string): Promise<number> {
  const filas = await tx.$queryRaw<{ proximo_numero_orden: number }[]>`
    UPDATE tenants
       SET proximo_numero_orden = proximo_numero_orden + 1
     WHERE id = ${tenantId}::uuid
    RETURNING proximo_numero_orden - 1 AS proximo_numero_orden
  `
  // Cero filas: el tenant no existe, o existe y RLS no lo deja ver — que para
  // el motor es lo mismo. Sin este guard el llamador recibe un TypeError en vez
  // de un ErrorDeOrden, justo en la única línea que habla SQL crudo.
  if (filas.length === 0) {
    throw new ErrorDeOrden('TENANT_INEXISTENTE', `el tenant ${tenantId} no existe`)
  }
  return filas[0].proximo_numero_orden
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run test/ordenes-de-trabajo.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/ordenes-de-trabajo/errores.ts lib/ordenes-de-trabajo/crear.ts test/ordenes-de-trabajo.test.ts
git commit -m "feat(servicio-tecnico): el alta de una orden, con su correlativo y su idempotencia

El número va sin huecos porque es el que el cliente lee del ticket y dice por
teléfono — decisión inversa a la del SKU, y las dos están bien.

La idempotencia entra ahora, con la tabla vacía: acá el doble submit no cobra
dos veces, imprime dos tickets con números distintos para un solo equipo y el
cliente se lleva uno de los dos. El índice único después es un bloqueo sobre
datos de clientes."
```

---

### Task 5: Las operaciones sobre una orden abierta

Cambiar de estado, guardar el diagnóstico y el presupuesto, y anular.

**Files:**
- Create: `lib/ordenes-de-trabajo/operaciones.ts`
- Modify: `test/ordenes-de-trabajo.test.ts` (se le agregan los describes de abajo)

**Interfaces:**
- Consumes: `puedeTransicionar` de `./estados`, `ErrorDeOrden` de `./errores`, `enTransaccionDeTenant`, `exigirUsuario`.
- Produces:
  - `cambiarEstado({ tenantId, usuarioId, ordenId, hasta, nota? }): Promise<void>`
  - `guardarDiagnostico({ tenantId, usuarioId, ordenId, diagnostico, montoEstimado }): Promise<void>` — `montoEstimado` es `Prisma.Decimal | null`
  - `anularOrden({ tenantId, usuarioId, ordenId }): Promise<void>`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `test/ordenes-de-trabajo.test.ts`, y sumar los imports dinámicos arriba:

```ts
// Junto a los otros `let` del encabezado del archivo:
let cambiarEstado: typeof import('@/lib/ordenes-de-trabajo/operaciones').cambiarEstado
let guardarDiagnostico: typeof import('@/lib/ordenes-de-trabajo/operaciones').guardarDiagnostico
let anularOrden: typeof import('@/lib/ordenes-de-trabajo/operaciones').anularOrden

// Y dentro del beforeAll que ya existe, junto a los otros imports dinámicos:
;({ cambiarEstado, guardarDiagnostico, anularOrden } = await import(
  '@/lib/ordenes-de-trabajo/operaciones'
))
```

```ts
async function estadoDe(ordenId: string): Promise<string> {
  const { rows } = await owner.query(`SELECT estado FROM ordenes_de_trabajo WHERE id = $1`, [
    ordenId,
  ])
  return rows[0].estado
}

describe('cambiar de estado', () => {
  it('avanza y deja su línea en la bitácora', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta: 'EN_DIAGNOSTICO' })

    expect(await estadoDe(o.id)).toBe('EN_DIAGNOSTICO')
    const { rows } = await owner.query(
      `SELECT desde, hasta, nota FROM eventos_orden WHERE orden_id = $1 ORDER BY creado_en`,
      [o.id],
    )
    expect(rows).toHaveLength(2)
    expect(rows[1].desde).toBe('RECIBIDO')
    expect(rows[1].hasta).toBe('EN_DIAGNOSTICO')
  })

  it('guarda la nota del cambio', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await cambiarEstado({
      tenantId,
      usuarioId,
      ordenId: o.id,
      hasta: 'EN_DIAGNOSTICO',
      nota: 'el cliente lo dejó a las 10',
    })
    const { rows } = await owner.query(
      `SELECT nota FROM eventos_orden WHERE orden_id = $1 ORDER BY creado_en DESC LIMIT 1`,
      [o.id],
    )
    expect(rows[0].nota).toBe('el cliente lo dejó a las 10')
  })

  it('rechaza el salto que el grafo no permite, y no toca la orden', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await expect(
      cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta: 'ENTREGADO' }),
    ).rejects.toThrow(ErrorDeOrden)
    // Lo que importa no es el throw: es que la orden siga como estaba.
    expect(await estadoDe(o.id)).toBe('RECIBIDO')
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n FROM eventos_orden WHERE orden_id = $1`,
      [o.id],
    )
    expect(rows[0].n).toBe(1)
  })

  it('deja volver un equipo entregado a reparación: es la garantía', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    for (const hasta of ['EN_REPARACION', 'LISTO', 'ENTREGADO', 'EN_REPARACION'] as const) {
      await cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta })
    }
    expect(await estadoDe(o.id)).toBe('EN_REPARACION')
  })

  it('una orden anulada no cambia más de estado', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await anularOrden({ tenantId, usuarioId, ordenId: o.id })
    await expect(
      cambiarEstado({ tenantId, usuarioId, ordenId: o.id, hasta: 'EN_DIAGNOSTICO' }),
    ).rejects.toThrow(ErrorDeOrden)
  })

  it('no toca una orden de otro tenant', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    // Con el tenant equivocado, RLS no deja ver la fila: es indistinguible de
    // que no exista, y ésa es la respuesta honesta.
    await expect(
      cambiarEstado({
        tenantId: otroTenantId,
        usuarioId,
        ordenId: o.id,
        hasta: 'EN_DIAGNOSTICO',
      }),
    ).rejects.toThrow(ErrorDeOrden)
    expect(await estadoDe(o.id)).toBe('RECIBIDO')
  })
})

describe('diagnóstico y presupuesto', () => {
  it('guarda el diagnóstico y el monto', async () => {
    const { Prisma } = await import('@/generated/prisma/client')
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await guardarDiagnostico({
      tenantId,
      usuarioId,
      ordenId: o.id,
      diagnostico: 'pin de carga suelto',
      montoEstimado: new Prisma.Decimal('35000.00'),
    })
    const { rows } = await owner.query(
      `SELECT diagnostico, monto_estimado FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    expect(rows[0].diagnostico).toBe('pin de carga suelto')
    expect(String(rows[0].monto_estimado)).toBe('35000.00')
  })

  it('NO cambia el estado: cargar el diagnóstico no es una transición', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await guardarDiagnostico({
      tenantId,
      usuarioId,
      ordenId: o.id,
      diagnostico: 'pantalla rota',
      montoEstimado: null,
    })
    expect(await estadoDe(o.id)).toBe('RECIBIDO')
  })

  it('rechaza un monto negativo', async () => {
    const { Prisma } = await import('@/generated/prisma/client')
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await expect(
      guardarDiagnostico({
        tenantId,
        usuarioId,
        ordenId: o.id,
        diagnostico: 'x',
        montoEstimado: new Prisma.Decimal('-1'),
      }),
    ).rejects.toThrow(ErrorDeOrden)
  })
})

describe('anulación', () => {
  it('marca quién y cuándo, y no deja evento', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    const antes = await owner.query(
      `SELECT count(*)::int AS n FROM eventos_orden WHERE orden_id = $1`,
      [o.id],
    )
    await anularOrden({ tenantId, usuarioId, ordenId: o.id })

    const { rows } = await owner.query(
      `SELECT anulada_en, anulada_por_id, estado FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    expect(rows[0].anulada_en).not.toBeNull()
    expect(rows[0].anulada_por_id).toBe(usuarioId)
    // El estado NO se pisa: anular es una columna, no un estado.
    expect(rows[0].estado).toBe('RECIBIDO')

    // Sin evento: EventoOrden registra transiciones, y anular no lo es.
    const despues = await owner.query(
      `SELECT count(*)::int AS n FROM eventos_orden WHERE orden_id = $1`,
      [o.id],
    )
    expect(despues.rows[0].n).toBe(antes.rows[0].n)
  })

  it('anular dos veces no cambia quién la anuló', async () => {
    const o = await crearOrden({ tenantId, usuarioId, clienteId, ...equipo })
    await anularOrden({ tenantId, usuarioId, ordenId: o.id })
    const primera = await owner.query(
      `SELECT anulada_en FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    await expect(anularOrden({ tenantId, usuarioId, ordenId: o.id })).rejects.toThrow(ErrorDeOrden)
    const segunda = await owner.query(
      `SELECT anulada_en FROM ordenes_de_trabajo WHERE id = $1`,
      [o.id],
    )
    expect(String(segunda.rows[0].anulada_en)).toBe(String(primera.rows[0].anulada_en))
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npx vitest run test/ordenes-de-trabajo.test.ts`
Expected: FAIL — no resuelve `@/lib/ordenes-de-trabajo/operaciones`.

- [ ] **Step 3: Escribir `lib/ordenes-de-trabajo/operaciones.ts`**

```ts
import type { Prisma as PrismaTipos, EstadoOrden } from '@/generated/prisma/client'
import { enTransaccionDeTenant, type ClienteTx } from '@/lib/tenant/transaccion'
import { exigirUsuario } from '@/lib/ventas/pertenencia'
import { puedeTransicionar } from './estados'
import { ErrorDeOrden } from './errores'

/**
 * Trae la orden para operar sobre ella, o explica por qué no se puede.
 *
 * "No existe" y "es de otro tenant" dan el MISMO error, a propósito: bajo RLS
 * la fila ajena no es una fila que este código descarte, es una fila que
 * Postgres nunca deja llegar. Inventar una distinción filtraría qué ids
 * existen, que no le sirve a nadie del otro lado.
 */
async function traerAbierta(
  tx: ClienteTx,
  ordenId: string,
): Promise<{ id: string; estado: EstadoOrden }> {
  const orden = await tx.ordenDeTrabajo.findFirst({
    where: { id: ordenId },
    select: { id: true, estado: true, anuladaEn: true },
  })
  if (!orden) {
    throw new ErrorDeOrden('ORDEN_INEXISTENTE', 'la orden no existe en este tenant')
  }
  if (orden.anuladaEn) {
    throw new ErrorDeOrden('ORDEN_ANULADA', 'la orden está anulada')
  }
  return { id: orden.id, estado: orden.estado }
}

export type EntradaCambiarEstado = {
  tenantId: string
  usuarioId: string
  ordenId: string
  hasta: EstadoOrden
  nota?: string | null
}

/**
 * Mueve la orden y deja su línea en la bitácora, en la misma transacción.
 *
 * Revalida el grafo aunque la pantalla ya haya dibujado sólo los botones
 * legales: una UI que esconde un botón no es una validación.
 */
export async function cambiarEstado(entrada: EntradaCambiarEstado): Promise<void> {
  const { tenantId, usuarioId, ordenId, hasta } = entrada
  const nota = entrada.nota?.trim() || null

  await enTransaccionDeTenant(tenantId, async (tx) => {
    await exigirUsuario(tx, usuarioId)
    const orden = await traerAbierta(tx, ordenId)

    if (!puedeTransicionar(orden.estado, hasta)) {
      throw new ErrorDeOrden(
        'TRANSICION_INVALIDA',
        `una orden en ${orden.estado} no puede pasar a ${hasta}`,
      )
    }

    await tx.ordenDeTrabajo.update({ where: { id: orden.id }, data: { estado: hasta } })
    await tx.eventoOrden.create({
      data: { tenantId, ordenId: orden.id, desde: orden.estado, hasta, nota, usuarioId },
    })
  })
}

export type EntradaGuardarDiagnostico = {
  tenantId: string
  usuarioId: string
  ordenId: string
  diagnostico: string
  montoEstimado: PrismaTipos.Decimal | null
}

/**
 * Guarda lo que encontró el técnico y el número que se le dice al cliente.
 *
 * NO cambia el estado y NO deja evento: la bitácora registra transiciones, y
 * cargar un diagnóstico no lo es. Pasar a PRESUPUESTADO es un cambio de estado
 * aparte, que la pantalla ofrece al lado.
 */
export async function guardarDiagnostico(entrada: EntradaGuardarDiagnostico): Promise<void> {
  const { tenantId, usuarioId, ordenId, montoEstimado } = entrada
  const diagnostico = entrada.diagnostico.trim() || null

  if (montoEstimado !== null && montoEstimado.lessThan(0)) {
    throw new ErrorDeOrden('MONTO_INVALIDO', 'el monto estimado no puede ser negativo')
  }

  await enTransaccionDeTenant(tenantId, async (tx) => {
    await exigirUsuario(tx, usuarioId)
    const orden = await traerAbierta(tx, ordenId)
    await tx.ordenDeTrabajo.update({
      where: { id: orden.id },
      data: { diagnostico, montoEstimado },
    })
  })
}

export type EntradaAnularOrden = {
  tenantId: string
  usuarioId: string
  ordenId: string
}

/**
 * Anula, sin tocar el estado.
 *
 * Quién y cuándo viven en la fila, exactamente como en `Venta`, y no en un
 * evento: el evento tendría que decir `desde` y `hasta` el mismo estado, una
 * fila que el grafo no puede producir y que un lector no sabe interpretar.
 *
 * Anular dos veces falla en vez de ser idempotente: la segunda vez es alguien
 * que no vio que ya estaba anulada, y decírselo es más útil que no hacer nada.
 */
export async function anularOrden(entrada: EntradaAnularOrden): Promise<void> {
  const { tenantId, usuarioId, ordenId } = entrada

  await enTransaccionDeTenant(tenantId, async (tx) => {
    await exigirUsuario(tx, usuarioId)
    const orden = await traerAbierta(tx, ordenId)
    await tx.ordenDeTrabajo.update({
      where: { id: orden.id },
      data: { anuladaEn: new Date(), anuladaPorId: usuarioId },
    })
  })
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npx vitest run test/ordenes-de-trabajo.test.ts`
Expected: PASS, 19 tests (8 de la Task 4 más 11 de ésta).

- [ ] **Step 5: Commit**

```bash
git add lib/ordenes-de-trabajo/operaciones.ts test/ordenes-de-trabajo.test.ts
git commit -m "feat(servicio-tecnico): mover, diagnosticar y anular una orden

El grafo se revalida en el servidor aunque la pantalla dibuje sólo los botones
legales: una UI que esconde un botón no es una validación.

Anular no deja evento. EventoOrden registra transiciones, y el evento de una
anulación tendría que decir desde y hasta el mismo estado — una fila que el
grafo no puede producir y que nadie sabe leer. Quién y cuándo van en la fila,
como en Venta."
```

---

### Task 6: El tablero y la pestaña

La primera pantalla. Al terminar esta task, Servicio Técnico existe en la navegación.

**Files:**
- Create: `app/(app)/servicio-tecnico/page.tsx`
- Modify: `components/navegacion.tsx`
- Modify: `components/navegacion.test.tsx`

**Interfaces:**
- Consumes: `exigirSesion` de `@/lib/auth/sesion`, `prismaParaTenant` de `@/lib/tenant/prisma`, `NOMBRE_ESTADO`/`ESTADOS`/`ABIERTOS` de `@/lib/ordenes-de-trabajo/estados`, `formatearFecha` de `@/lib/formato/mostrar`.
- Produces: la ruta `/servicio-tecnico`, y la pestaña en `PESTANAS`.

- [ ] **Step 1: Actualizar el test de navegación primero**

En `components/navegacion.test.tsx`, dos casos hablan de cuántas pestañas hay. Cambiarlos:

```ts
  // El caso de la línea ~90 pasa de "las tres pestañas que ve cualquiera" a:
  it('están las cuatro pestañas que ve cualquiera', async () => {
    // Vender, Ventas, Inventario y Servicio Técnico. Usuarios no: es del dueño.
  })

  // Y el de la línea ~106, que cuenta los anillos de foco:
    expect(pestanas).toHaveLength(5)
```

Agregar además el caso que fija el comportamiento del prefijo para la ruta nueva:

```ts
  it('el detalle de una orden deja subrayada Servicio Técnico', async () => {
    expect(estaActiva('/servicio-tecnico', '/servicio-tecnico/abc-123')).toBe(true)
    // Y el ticket, que cuelga un nivel más abajo.
    expect(estaActiva('/servicio-tecnico', '/servicio-tecnico/abc-123/ticket')).toBe(true)
  })
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run components/navegacion.test.tsx`
Expected: FAIL — 4 pestañas contra 5 esperadas.

- [ ] **Step 3: Agregar la pestaña**

En `components/navegacion.tsx`, dentro de `PESTANAS`, entre Inventario y Usuarios:

```ts
  // Fija y visible en TODO tenant, incluido el que no hace servicio técnico.
  // Es deuda consciente y está escrita en el spec con su vencimiento: cuando
  // exista el registry de módulos, esta entrada sale de TenantModule. El
  // disparador es el primer tenant de un rubro sin servicio técnico.
  { href: '/servicio-tecnico', texto: 'Servicio Técnico' },
```

- [ ] **Step 4: Escribir `app/(app)/servicio-tecnico/page.tsx`**

```tsx
import Link from 'next/link'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatearFecha } from '@/lib/formato/mostrar'
import { ESTADOS, ABIERTOS, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import type { EstadoOrden } from '@/generated/prisma/client'

export const dynamic = 'force-dynamic'

const POR_PAGINA = 50

function esEstado(v: string | undefined): v is EstadoOrden {
  return v !== undefined && (ESTADOS as readonly string[]).includes(v)
}

export default async function ServicioTecnico({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; p?: string; estado?: string }>
}) {
  const sesion = await exigirSesion()
  const { q = '', p = '1', estado } = await searchParams

  const busqueda = q.trim()
  // Truncado y con techo, igual que /inventario: `?p=2.3` daría un skip con
  // decimales y `?p=1e300` uno fuera del rango de un Int, y Prisma rechaza los
  // dos con un error que nadie atrapa — o sea un 500 desde un query string.
  const PAGINA_MAXIMA = 1_000_000
  const pagina = Math.min(Math.max(1, Math.trunc(Number(p)) || 1), PAGINA_MAXIMA)
  const filtro = esEstado(estado) ? estado : null

  const prisma = prismaParaTenant(sesion.tenant.id)
  const donde = {
    anuladaEn: null,
    // Sin filtro explícito, las ABIERTAS: el equipo entregado ya no es problema
    // de nadie, y el tablero es la lista de lo que sigue en el local.
    estado: filtro ? { equals: filtro } : { in: [...ABIERTOS] },
    ...(busqueda
      ? {
          OR: [
            { equipoModelo: { contains: busqueda, mode: 'insensitive' as const } },
            { equipoMarca: { contains: busqueda, mode: 'insensitive' as const } },
            { equipoSerie: { contains: busqueda, mode: 'insensitive' as const } },
            { cliente: { nombre: { contains: busqueda, mode: 'insensitive' as const } } },
            // El número se busca como número, no como texto: `?q=42` tiene que
            // encontrar la orden 42 y no las que contienen un 4 y un 2.
            ...(Number.isInteger(Number(busqueda)) ? [{ numero: Number(busqueda) }] : []),
          ],
        }
      : {}),
  }

  const [ordenes, total, porEstado] = await Promise.all([
    prisma.ordenDeTrabajo.findMany({
      where: donde,
      // La MÁS VIEJA PRIMERO, al revés que /ventas. En ventas lo último es lo
      // que importa; acá lo que duele es el equipo que lleva tres semanas en el
      // estante.
      orderBy: { creadoEn: 'asc' },
      skip: (pagina - 1) * POR_PAGINA,
      take: POR_PAGINA,
      select: {
        id: true,
        numero: true,
        estado: true,
        equipoMarca: true,
        equipoModelo: true,
        creadoEn: true,
        cliente: { select: { nombre: true } },
      },
    }),
    prisma.ordenDeTrabajo.count({ where: donde }),
    // Los contadores hablan de TODAS las abiertas, no de lo que el filtro
    // muestra: si contaran lo filtrado, elegir "Listo" pondría el resto en cero
    // y no se podría volver.
    prisma.ordenDeTrabajo.groupBy({
      by: ['estado'],
      where: { anuladaEn: null, estado: { in: [...ABIERTOS] } },
      _count: { _all: true },
    }),
  ])

  const cuenta = new Map(porEstado.map((f) => [f.estado, f._count._all]))
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  const conParametros = (cambios: { p?: number; estado?: string | null }) => {
    const u = new URLSearchParams()
    if (busqueda) u.set('q', busqueda)
    const e = cambios.estado === undefined ? filtro : cambios.estado
    if (e) u.set('estado', e)
    if (cambios.p && cambios.p > 1) u.set('p', String(cambios.p))
    const s = u.toString()
    return s ? `/servicio-tecnico?${s}` : '/servicio-tecnico'
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Servicio Técnico</h1>
        <Button asChild>
          <Link href="/servicio-tecnico/nuevo">Recibir un equipo</Link>
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href={conParametros({ estado: null, p: 1 })}
          aria-current={filtro === null ? 'true' : undefined}
          className={`rounded-md border px-3 py-1.5 text-sm ${
            filtro === null ? 'border-primary font-semibold' : 'text-muted-foreground'
          }`}
        >
          Todas · {[...cuenta.values()].reduce((a, b) => a + b, 0)}
        </Link>
        {ABIERTOS.map((e) => (
          <Link
            key={e}
            href={conParametros({ estado: e, p: 1 })}
            aria-current={filtro === e ? 'true' : undefined}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              filtro === e ? 'border-primary font-semibold' : 'text-muted-foreground'
            }`}
          >
            {NOMBRE_ESTADO[e]} · {cuenta.get(e) ?? 0}
          </Link>
        ))}
      </div>

      <form className="mt-6 flex gap-2" action="/servicio-tecnico">
        {filtro ? <input type="hidden" name="estado" value={filtro} /> : null}
        <Input name="q" defaultValue={busqueda} placeholder="Número, cliente, modelo o IMEI" />
        <Button type="submit" variant="secondary">
          Buscar
        </Button>
      </form>

      {ordenes.length === 0 ? (
        <p className="mt-8 text-sm text-muted-foreground">
          No hay equipos que mostrar con estos filtros.
        </p>
      ) : (
        <ul className="mt-6 divide-y">
          {ordenes.map((o) => (
            <li key={o.id}>
              <Link href={`/servicio-tecnico/${o.id}`} className="flex gap-4 py-3">
                <span className="w-14 shrink-0 font-mono text-sm">#{o.numero}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {o.equipoMarca} {o.equipoModelo}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {o.cliente.nombre} · desde el {formatearFecha(o.creadoEn)}
                  </span>
                </span>
                <span className="shrink-0 self-center text-sm">{NOMBRE_ESTADO[o.estado]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {paginas > 1 ? (
        <nav className="mt-6 flex gap-3 text-sm">
          {pagina > 1 ? <Link href={conParametros({ p: pagina - 1 })}>Anterior</Link> : null}
          <span className="text-muted-foreground">
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas ? <Link href={conParametros({ p: pagina + 1 })}>Siguiente</Link> : null}
        </nav>
      ) : null}
    </main>
  )
}
```

- [ ] **Step 5: Correr todos los tests**

Run: `npm test`
Expected: PASS. `test/rutas-con-guard.test.ts` toma la pantalla nueva sin excepciones (está bajo `(app)`), y `components/navegacion.test.tsx` pasa con las cinco pestañas.

- [ ] **Step 6: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/servicio-tecnico/page.tsx' components/navegacion.tsx components/navegacion.test.tsx
git commit -m "feat(servicio-tecnico): el tablero, y la pestaña en la navegación

Ordena de la MÁS VIEJA a la más nueva, al revés que /ventas: en ventas lo
último es lo que importa, acá lo que duele es el equipo que lleva tres semanas
en el estante.

Los contadores cuentan todas las abiertas y no lo filtrado: contando lo
filtrado, elegir Listo pondría el resto en cero y no habría cómo volver.

La pestaña es fija en todo tenant. Es deuda con vencimiento escrito en el
spec — el primer tenant de un rubro sin servicio técnico la hace caducar."
```

---

### Task 7: La recepción del equipo

**Files:**
- Create: `app/(app)/servicio-tecnico/nuevo/page.tsx`
- Create: `app/(app)/servicio-tecnico/acciones.ts`
- Create: `app/(app)/servicio-tecnico/formularios.tsx`
- Test: `app/(app)/servicio-tecnico/acciones.test.ts`

**Interfaces:**
- Consumes: `crearOrden`, `crearCliente`, `buscarClientes`, `exigirSesion`, `exigirDuenio`.
- Produces: la ruta `/servicio-tecnico/nuevo`; y de `acciones.ts`, la action `recibirEquipo(estado, datos: FormData): Promise<EstadoServicio>` con `type EstadoServicio = { error: string | null; aviso: string | null }`.

- [ ] **Step 1: Escribir el test de la action**

`app/(app)/servicio-tecnico/acciones.test.ts`, siguiendo el patrón de `app/(app)/inventario/acciones.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Se mockea la sesión y el dominio: lo que este test prueba es el CONTRATO de
// la action —que exija sesión, que traduzca los errores de dominio a cartel y
// relance el resto—, no el motor, que ya tiene su propio test contra la base.
const exigirSesion = vi.fn()
const exigirDuenio = vi.fn()
const crearOrden = vi.fn()
const anularOrden = vi.fn()

vi.mock('@/lib/auth/sesion', () => ({ exigirSesion, exigirDuenio }))
vi.mock('@/lib/ordenes-de-trabajo/crear', () => ({ crearOrden }))
vi.mock('@/lib/ordenes-de-trabajo/operaciones', () => ({
  anularOrden,
  cambiarEstado: vi.fn(),
  guardarDiagnostico: vi.fn(),
}))
vi.mock('@/lib/clientes/administrar', () => ({ crearCliente: vi.fn(), buscarClientes: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

const sesion = {
  tenant: { id: 't-1' },
  usuario: { id: 'u-1', rol: 'EMPLEADO' },
}

beforeEach(() => {
  vi.clearAllMocks()
  exigirSesion.mockResolvedValue(sesion)
  exigirDuenio.mockResolvedValue({ ...sesion, usuario: { id: 'u-1', rol: 'DUENO' } })
})

function formulario(campos: Record<string, string>): FormData {
  const d = new FormData()
  for (const [k, v] of Object.entries(campos)) d.append(k, v)
  return d
}

describe('recibirEquipo', () => {
  it('exige sesión antes de tocar nada', async () => {
    const { recibirEquipo } = await import('./acciones')
    exigirSesion.mockRejectedValueOnce(new Error('sin sesión'))
    await expect(recibirEquipo({ error: null, aviso: null }, formulario({}))).rejects.toThrow()
    expect(crearOrden).not.toHaveBeenCalled()
  })

  it('pasa el tenant y el usuario de la SESIÓN, no del formulario', async () => {
    const { recibirEquipo } = await import('./acciones')
    crearOrden.mockResolvedValue({ id: 'o-1', numero: 7 })
    await recibirEquipo(
      { error: null, aviso: null },
      formulario({
        clienteId: 'c-1',
        equipoMarca: 'Samsung',
        equipoModelo: 'A54',
        fallaDeclarada: 'no carga',
        // Un formulario alterado a mano manda esto; la action tiene que
        // ignorarlo por completo.
        tenantId: 't-ajeno',
        usuarioId: 'u-ajeno',
      }),
    )
    expect(crearOrden).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't-1', usuarioId: 'u-1' }),
    )
  })

  it('muestra el error de dominio como cartel', async () => {
    const { ErrorDeOrden } = await import('@/lib/ordenes-de-trabajo/errores')
    const { recibirEquipo } = await import('./acciones')
    crearOrden.mockRejectedValue(new ErrorDeOrden('FALLA_VACIA', 'falta la falla'))
    const r = await recibirEquipo({ error: null, aviso: null }, formulario({ clienteId: 'c-1' }))
    expect(r.error).toBe('falta la falla')
  })

  it('relanza lo que NO es error de dominio', async () => {
    const { recibirEquipo } = await import('./acciones')
    // Tragarlo lo convertiría en un cartel rojo genérico y el bug no llegaría
    // nunca a Sentry.
    crearOrden.mockRejectedValue(new Error('la base se cayó'))
    await expect(
      recibirEquipo({ error: null, aviso: null }, formulario({ clienteId: 'c-1' })),
    ).rejects.toThrow('la base se cayó')
  })
})

describe('anular', () => {
  it('exige DUEÑO, no sólo sesión', async () => {
    const { anular } = await import('./acciones')
    exigirDuenio.mockRejectedValueOnce(new Error('403'))
    await expect(anular({ error: null, aviso: null }, formulario({ ordenId: 'o-1' }))).rejects.toThrow()
    expect(anularOrden).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run 'app/(app)/servicio-tecnico/acciones.test.ts'`
Expected: FAIL — no resuelve `./acciones`.

- [ ] **Step 3: Escribir `app/(app)/servicio-tecnico/acciones.ts`**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { exigirSesion, exigirDuenio } from '@/lib/auth/sesion'
import { crearOrden } from '@/lib/ordenes-de-trabajo/crear'
import { cambiarEstado, guardarDiagnostico, anularOrden } from '@/lib/ordenes-de-trabajo/operaciones'
import { crearCliente } from '@/lib/clientes/administrar'
import { ErrorDeOrden } from '@/lib/ordenes-de-trabajo/errores'
import { ErrorDeCliente } from '@/lib/clientes/errores'
import { aDecimalOpcional, ErrorDeFormato } from '@/lib/formato/numeros'
import type { EstadoOrden } from '@/generated/prisma/client'
import { ESTADOS } from '@/lib/ordenes-de-trabajo/estados'

export type EstadoServicio = { error: string | null; aviso: string | null }

// El valor inicial NO se exporta desde acá: este archivo es 'use server', y ahí
// Next convierte cada export en un endpoint RPC, así que sólo admite funciones
// async. Vive en formularios.tsx. Lo fija test/use-server.test.ts.

/**
 * Sólo los errores de dominio se muestran; el resto se relanza.
 *
 * Tragar un error desconocido lo convertiría en un cartel rojo genérico y el
 * bug quedaría sin llegar nunca a Sentry ni al log. Los tres que SÍ se muestran
 * son los que la persona puede corregir tipeando distinto.
 */
function traducir(e: unknown): EstadoServicio {
  if (e instanceof ErrorDeOrden || e instanceof ErrorDeCliente || e instanceof ErrorDeFormato) {
    return { error: e.message, aviso: null }
  }
  throw e
}

const texto = (datos: FormData, campo: string) => String(datos.get(campo) ?? '').trim()

function esEstado(v: string): v is EstadoOrden {
  return (ESTADOS as readonly string[]).includes(v)
}

export async function recibirEquipo(
  _e: EstadoServicio,
  datos: FormData,
): Promise<EstadoServicio> {
  const sesion = await exigirSesion()
  let destino: string | null = null
  try {
    // El cliente puede venir elegido de la lista o escrito para crear al vuelo.
    // Nunca los dos: si vino id, se usa ese.
    let clienteId = texto(datos, 'clienteId')
    if (clienteId === '') {
      const creado = await crearCliente({
        tenantId: sesion.tenant.id,
        nombre: texto(datos, 'clienteNombre'),
        telefono: texto(datos, 'clienteTelefono') || null,
      })
      clienteId = creado.id
    }

    const orden = await crearOrden({
      // De la SESIÓN y nunca del formulario, que lo manda el navegador.
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      clienteId,
      equipoMarca: texto(datos, 'equipoMarca'),
      equipoModelo: texto(datos, 'equipoModelo'),
      equipoSerie: texto(datos, 'equipoSerie') || null,
      claveDesbloqueo: texto(datos, 'claveDesbloqueo') || null,
      fallaDeclarada: texto(datos, 'fallaDeclarada'),
      accesorios: texto(datos, 'accesorios') || null,
      danosVisibles: texto(datos, 'danosVisibles') || null,
      claveIdempotencia: texto(datos, 'claveIdempotencia') || undefined,
    })
    revalidatePath('/servicio-tecnico')
    destino = `/servicio-tecnico/${orden.id}/ticket`
  } catch (e) {
    return traducir(e)
  }
  // FUERA del try: redirect() señaliza con una excepción, y adentro del catch
  // `traducir` la relanzaría como si fuera un bug. Es el mismo cuidado que ya
  // tiene app/login/acciones.ts.
  redirect(destino)
}

export async function moverEstado(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio> {
  const sesion = await exigirSesion()
  try {
    const hasta = texto(datos, 'hasta')
    if (!esEstado(hasta)) {
      return { error: 'ese estado no existe', aviso: null }
    }
    await cambiarEstado({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ordenId: texto(datos, 'ordenId'),
      hasta,
      nota: texto(datos, 'nota') || null,
    })
    revalidatePath('/servicio-tecnico')
    return { error: null, aviso: 'Listo, la orden se movió.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function diagnosticar(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio> {
  const sesion = await exigirSesion()
  try {
    await guardarDiagnostico({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ordenId: texto(datos, 'ordenId'),
      diagnostico: texto(datos, 'diagnostico'),
      montoEstimado: aDecimalOpcional(texto(datos, 'montoEstimado'), 'el monto estimado'),
    })
    revalidatePath('/servicio-tecnico')
    return { error: null, aviso: 'Diagnóstico guardado.' }
  } catch (e) {
    return traducir(e)
  }
}

/** Sólo el dueño: anular es lo único destructivo del módulo. Mismo corte que
 *  la anulación de una venta. */
export async function anular(_e: EstadoServicio, datos: FormData): Promise<EstadoServicio> {
  const sesion = await exigirDuenio()
  try {
    await anularOrden({
      tenantId: sesion.tenant.id,
      usuarioId: sesion.usuario.id,
      ordenId: texto(datos, 'ordenId'),
    })
    revalidatePath('/servicio-tecnico')
    return { error: null, aviso: 'Orden anulada.' }
  } catch (e) {
    return traducir(e)
  }
}
```

- [ ] **Step 4: Escribir `app/(app)/servicio-tecnico/formularios.tsx`**

```tsx
'use client'

import { useActionState, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { EstadoServicio } from './acciones'

// Vive acá y no en acciones.ts: ese archivo es 'use server' y no puede exportar
// constantes. Ver el comentario allá y test/use-server.test.ts.
export const INICIAL: EstadoServicio = { error: null, aviso: null }

export function Aviso({ estado }: { estado: EstadoServicio }) {
  if (!estado.error && !estado.aviso) return null
  return (
    <Alert variant={estado.error ? 'destructive' : 'default'} className="mt-4">
      <AlertDescription>{estado.error ?? estado.aviso}</AlertDescription>
    </Alert>
  )
}

export function FormularioRecepcion({
  accion,
  clientes,
  claveIdempotencia,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  clientes: { id: string; nombre: string; telefono: string | null }[]
  claveIdempotencia: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  return (
    <form action={ejecutar} className="mt-6 space-y-6">
      {/* La generó el servidor una vez por carga de la pantalla: es lo que hace
          que el doble click no imprima dos tickets con números distintos para
          un solo equipo. */}
      <input type="hidden" name="claveIdempotencia" value={claveIdempotencia} />

      <fieldset className="space-y-3">
        <legend className="font-medium">Cliente</legend>
        <Label htmlFor={`${id}-cliente`}>Elegir uno ya cargado</Label>
        <select
          id={`${id}-cliente`}
          name="clienteId"
          defaultValue=""
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        >
          <option value="">— cliente nuevo —</option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.telefono ? ` · ${c.telefono}` : ''}
            </option>
          ))}
        </select>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-nombre`}>Nombre (si es nuevo)</Label>
            <Input id={`${id}-nombre`} name="clienteNombre" />
          </div>
          <div>
            <Label htmlFor={`${id}-tel`}>Teléfono</Label>
            <Input id={`${id}-tel`} name="clienteTelefono" inputMode="tel" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-medium">El equipo</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-marca`}>Marca</Label>
            <Input id={`${id}-marca`} name="equipoMarca" required />
          </div>
          <div>
            <Label htmlFor={`${id}-modelo`}>Modelo</Label>
            <Input id={`${id}-modelo`} name="equipoModelo" required />
          </div>
          <div>
            <Label htmlFor={`${id}-serie`}>IMEI o número de serie</Label>
            <Input id={`${id}-serie`} name="equipoSerie" />
          </div>
          <div>
            <Label htmlFor={`${id}-clave`}>Clave de desbloqueo</Label>
            <Input id={`${id}-clave`} name="claveDesbloqueo" />
            {/* Se dice en la pantalla y no sólo en el spec: quien la tipea
                tiene que saber que no va a salir en el papel. */}
            <p className="mt-1 text-xs text-muted-foreground">No se imprime en el ticket.</p>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="font-medium">Qué le pasa</legend>
        <div>
          <Label htmlFor={`${id}-falla`}>Falla declarada por el cliente</Label>
          <textarea
            id={`${id}-falla`}
            name="fallaDeclarada"
            required
            rows={3}
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${id}-acc`}>Accesorios entregados</Label>
            <Input id={`${id}-acc`} name="accesorios" placeholder="cargador, funda, chip" />
          </div>
          <div>
            <Label htmlFor={`${id}-danos`}>Daños visibles</Label>
            <Input id={`${id}-danos`} name="danosVisibles" placeholder="pantalla rayada" />
          </div>
        </div>
      </fieldset>

      <Aviso estado={estado} />

      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Recibir e imprimir'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: Escribir `app/(app)/servicio-tecnico/nuevo/page.tsx`**

```tsx
import { randomUUID } from 'node:crypto'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { recibirEquipo } from '../acciones'
import { FormularioRecepcion } from '../formularios'

export const dynamic = 'force-dynamic'

// Cuántos clientes ofrece el desplegable. Es una lista para elegir de un
// vistazo; el buscador completo es el ciclo de /clientes.
const CLIENTES_A_LA_MANO = 50

export default async function RecibirEquipo() {
  const sesion = await exigirSesion()
  const prisma = prismaParaTenant(sesion.tenant.id)

  const clientes = await prisma.cliente.findMany({
    orderBy: { nombre: 'asc' },
    take: CLIENTES_A_LA_MANO,
    select: { id: true, nombre: true, telefono: true },
  })

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Recibir un equipo</h1>
      {/* La clave se genera EN EL SERVIDOR, una vez por carga de la pantalla:
          si la generara el cliente en cada render, cambiaría con cada
          re-render y no serviría para nada. */}
      <FormularioRecepcion
        accion={recibirEquipo}
        clientes={clientes}
        claveIdempotencia={randomUUID()}
      />
    </main>
  )
}
```

- [ ] **Step 6: Correr los tests**

Run: `npm test`
Expected: PASS. Incluye `test/use-server.test.ts`, que falla si `acciones.ts` exporta algo que no sea una función async.

- [ ] **Step 7: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add 'app/(app)/servicio-tecnico'
git commit -m "feat(servicio-tecnico): la recepción del equipo, con alta de cliente al vuelo

El tenant y el usuario salen de la sesión y nunca del formulario, que lo manda
el navegador. La clave de idempotencia la genera el SERVIDOR una vez por carga:
generada en el cliente cambiaría en cada re-render y no serviría de nada.

El redirect va fuera del try: señaliza con una excepción, y adentro del catch
`traducir` la relanzaría como si fuera un bug."
```

---

### Task 8: El detalle y el seguimiento

**Files:**
- Create: `app/(app)/servicio-tecnico/[id]/page.tsx`
- Modify: `app/(app)/servicio-tecnico/formularios.tsx` (se le suman los formularios del detalle)
- Modify: `scripts/lib/rutas-comun.sh`

**Interfaces:**
- Consumes: `moverEstado`, `diagnosticar`, `anular` de `../acciones`; `TRANSICIONES` y `NOMBRE_ESTADO` de `@/lib/ordenes-de-trabajo/estados`.
- Produces: la ruta `/servicio-tecnico/[id]`.

- [ ] **Step 1: Declarar la ruta con parámetro en `RUTAS_SIN_SMOKE`**

Sin esto el gate entero corta. En `scripts/lib/rutas-comun.sh`, dentro de `declare -A RUTAS_SIN_SMOKE`:

```bash
  ['/servicio-tecnico/[id]']='no hay de dónde sacar un id de orden válido sin recibir un equipo en el gate, y sembrarlo convertiría el smoke en una suite de fixtures. Lo que esta pantalla usa —el guard de sesión, prismaParaTenant, las actions de estado y anulación— ya está cubierto por /servicio-tecnico, por app/(app)/servicio-tecnico/acciones.test.ts y por test/ordenes-de-trabajo.test.ts.'
```

- [ ] **Step 2: Verificar que la derivación de rutas sigue andando**

Run: `bash -c 'source scripts/lib/rutas-comun.sh && rutas_autenticadas "app/(app)"'`
Expected: lista con `/servicio-tecnico` y `/servicio-tecnico/nuevo`, **sin** `/servicio-tecnico/[id]`, y salida exitosa. Si la entrada del Step 1 faltara, el comando falla con "ruta con parámetro sin declarar".

- [ ] **Step 3: Agregar los formularios del detalle a `formularios.tsx`**

```tsx
// El tipo del enum, no `string`: así el compilador atrapa que la pantalla le
// pase un estado que no existe, en vez de que lo descubra el server action en
// runtime. Es un import de tipo, así que no arrastra nada al bundle del cliente.
import type { EstadoOrden } from '@/generated/prisma/client'

export function FormularioEstado({
  accion,
  ordenId,
  siguientes,
  nombres,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  siguientes: readonly EstadoOrden[]
  nombres: Record<EstadoOrden, string>
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  if (siguientes.length === 0) {
    return <p className="text-sm text-muted-foreground">Esta orden no se puede mover más.</p>
  }

  return (
    <form action={ejecutar} className="space-y-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <Label htmlFor={`${id}-nota`}>Nota (opcional)</Label>
        <Input id={`${id}-nota`} name="nota" placeholder="qué pasó" />
      </div>
      {/* Un botón por transición LEGAL, y el valor viaja en el botón: así no
          hay un desplegable donde se pueda elegir un salto que el servidor va
          a rechazar. El servidor lo revalida igual. */}
      <div className="flex flex-wrap gap-2">
        {siguientes.map((s) => (
          <Button key={s} type="submit" name="hasta" value={s} variant="secondary" disabled={pendiente}>
            {nombres[s]}
          </Button>
        ))}
      </div>
      <Aviso estado={estado} />
    </form>
  )
}

export function FormularioDiagnostico({
  accion,
  ordenId,
  diagnostico,
  montoEstimado,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
  diagnostico: string
  montoEstimado: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  const id = useId()

  return (
    <form action={ejecutar} className="space-y-3">
      <input type="hidden" name="ordenId" value={ordenId} />
      <div>
        <Label htmlFor={`${id}-diag`}>Diagnóstico</Label>
        <textarea
          id={`${id}-diag`}
          name="diagnostico"
          rows={3}
          defaultValue={diagnostico}
          className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
        />
      </div>
      <div>
        <Label htmlFor={`${id}-monto`}>Monto estimado</Label>
        <Input id={`${id}-monto`} name="montoEstimado" inputMode="decimal" defaultValue={montoEstimado} />
      </div>
      <Button type="submit" disabled={pendiente}>
        {pendiente ? 'Guardando…' : 'Guardar diagnóstico'}
      </Button>
      <Aviso estado={estado} />
    </form>
  )
}

export function FormularioAnular({
  accion,
  ordenId,
}: {
  accion: (e: EstadoServicio, d: FormData) => Promise<EstadoServicio>
  ordenId: string
}) {
  const [estado, ejecutar, pendiente] = useActionState(accion, INICIAL)
  return (
    <form action={ejecutar}>
      <input type="hidden" name="ordenId" value={ordenId} />
      <Button type="submit" variant="ghost" disabled={pendiente}>
        Anular esta orden
      </Button>
      <Aviso estado={estado} />
    </form>
  )
}
```

- [ ] **Step 4: Escribir `app/(app)/servicio-tecnico/[id]/page.tsx`**

```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { Button } from '@/components/ui/button'
import { formatearFecha, formatearPrecio } from '@/lib/formato/mostrar'
import { TRANSICIONES, NOMBRE_ESTADO } from '@/lib/ordenes-de-trabajo/estados'
import { moverEstado, diagnosticar, anular } from '../acciones'
import { FormularioEstado, FormularioDiagnostico, FormularioAnular } from '../formularios'

export const dynamic = 'force-dynamic'

export default async function DetalleDeOrden({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  const prisma = prismaParaTenant(sesion.tenant.id)

  // findFirst y no findUnique: con un id que no tiene forma de uuid, findUnique
  // tira un error crudo de Prisma —un 500— en vez de no encontrar nada.
  const orden = await prisma.ordenDeTrabajo.findFirst({
    where: { id },
    select: {
      id: true, numero: true, estado: true,
      equipoMarca: true, equipoModelo: true, equipoSerie: true, claveDesbloqueo: true,
      fallaDeclarada: true, accesorios: true, danosVisibles: true,
      diagnostico: true, montoEstimado: true,
      anuladaEn: true, creadoEn: true,
      cliente: { select: { nombre: true, telefono: true } },
      recibidaPor: { select: { nombre: true } },
      anuladaPor: { select: { nombre: true } },
      eventos: {
        orderBy: { creadoEn: 'asc' },
        select: {
          id: true, desde: true, hasta: true, nota: true, creadoEn: true,
          usuario: { select: { nombre: true } },
        },
      },
    },
  })
  if (!orden) notFound()

  const anulada = orden.anuladaEn !== null

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          Orden #{orden.numero} · {NOMBRE_ESTADO[orden.estado]}
        </h1>
        <Button asChild variant="secondary">
          <Link href={`/servicio-tecnico/${orden.id}/ticket`}>Reimprimir ticket</Link>
        </Button>
      </div>

      {anulada ? (
        <p className="mt-3 text-sm">
          Anulada por {orden.anuladaPor?.nombre ?? 'alguien'} el{' '}
          {formatearFecha(orden.anuladaEn!)}.
        </p>
      ) : null}

      <section className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="font-medium">Cliente</h2>
          <p>{orden.cliente.nombre}</p>
          {orden.cliente.telefono ? (
            // tel: y no texto suelto: es el gesto que se hace cuando el equipo
            // queda listo, y desde el teléfono llama con un toque.
            <a href={`tel:${orden.cliente.telefono}`} className="text-sm underline">
              {orden.cliente.telefono}
            </a>
          ) : null}
        </div>
        <div>
          <h2 className="font-medium">Equipo</h2>
          <p>
            {orden.equipoMarca} {orden.equipoModelo}
          </p>
          {orden.equipoSerie ? (
            <p className="font-mono text-sm text-muted-foreground">{orden.equipoSerie}</p>
          ) : null}
          {orden.claveDesbloqueo ? (
            <p className="text-sm">Clave: {orden.claveDesbloqueo}</p>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <h2 className="font-medium">Falla declarada</h2>
          <p className="whitespace-pre-wrap">{orden.fallaDeclarada}</p>
          {orden.accesorios ? <p className="text-sm">Accesorios: {orden.accesorios}</p> : null}
          {orden.danosVisibles ? (
            <p className="text-sm">Daños visibles: {orden.danosVisibles}</p>
          ) : null}
          <p className="mt-2 text-sm text-muted-foreground">
            Recibido por {orden.recibidaPor.nombre} el {formatearFecha(orden.creadoEn)}
          </p>
        </div>
      </section>

      {!anulada ? (
        <>
          <section className="mt-8">
            <h2 className="font-medium">Mover la orden</h2>
            <div className="mt-3">
              <FormularioEstado
                accion={moverEstado}
                ordenId={orden.id}
                siguientes={TRANSICIONES[orden.estado]}
                nombres={NOMBRE_ESTADO}
              />
            </div>
          </section>

          <section className="mt-8">
            <h2 className="font-medium">Diagnóstico y presupuesto</h2>
            <div className="mt-3">
              <FormularioDiagnostico
                accion={diagnosticar}
                ordenId={orden.id}
                diagnostico={orden.diagnostico ?? ''}
                montoEstimado={orden.montoEstimado ? String(orden.montoEstimado) : ''}
              />
            </div>
            {orden.montoEstimado ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Presupuestado: {formatearPrecio(String(orden.montoEstimado))}
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      <section className="mt-8">
        <h2 className="font-medium">Qué pasó</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {orden.eventos.map((e) => (
            <li key={e.id}>
              <span className="text-muted-foreground">{formatearFecha(e.creadoEn)}</span>{' '}
              {e.desde === null
                ? 'Recibido'
                : `${NOMBRE_ESTADO[e.desde]} → ${NOMBRE_ESTADO[e.hasta]}`}{' '}
              <span className="text-muted-foreground">· {e.usuario.nombre}</span>
              {e.nota ? <span className="block text-muted-foreground">{e.nota}</span> : null}
            </li>
          ))}
        </ol>
      </section>

      {/* Sólo el dueño. La action lo reexige con exigirDuenio: esconder el
          botón no es un permiso, es una comodidad. */}
      {sesion.usuario.rol === 'DUENO' && !anulada ? (
        <section className="mt-8 border-t pt-4">
          <FormularioAnular accion={anular} ordenId={orden.id} />
        </section>
      ) : null}
    </main>
  )
}
```

- [ ] **Step 5: Correr todos los tests**

Run: `npm test`
Expected: PASS. `test/boundaries-app.test.ts` sigue en verde porque no se agregó ningún `error.tsx` ni `not-found.tsx` adentro de `(app)`.

- [ ] **Step 6: Verificar el tipado**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add 'app/(app)/servicio-tecnico' scripts/lib/rutas-comun.sh
git commit -m "feat(servicio-tecnico): el detalle, con la bitácora y las transiciones legales

Un botón por transición legal y el valor viaja en el botón: no hay desplegable
donde elegir un salto que el servidor va a rechazar. El servidor lo revalida
igual — esconder un botón no es un permiso.

findFirst y no findUnique: con un id sin forma de uuid, findUnique tira un 500
en vez de un 404.

La ruta con [id] queda declarada en RUTAS_SIN_SMOKE con su razón, o el gate
entero no arranca."
```

---

### Task 9: El ticket térmico

**Files:**
- Create: `app/(app)/servicio-tecnico/[id]/ticket/page.tsx`
- Create: `app/(app)/servicio-tecnico/[id]/ticket/ticket.module.css`
- Create: `app/(app)/servicio-tecnico/[id]/ticket/imprimir.tsx`
- Test: `app/(app)/servicio-tecnico/[id]/ticket/ticket.test.tsx`
- Modify: `scripts/lib/rutas-comun.sh`
- Modify: `docs/sistema-de-diseno.md`

**Interfaces:**
- Consumes: `formatearFecha`, `prismaParaTenant`, `exigirSesion`.
- Produces: la ruta `/servicio-tecnico/[id]/ticket`, y el componente exportado `CuerpoDelTicket` que el test renderiza sin base.

- [ ] **Step 1: Escribir el test del ticket**

`app/(app)/servicio-tecnico/[id]/ticket/ticket.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CuerpoDelTicket } from './page'

const orden = {
  numero: 42,
  equipoMarca: 'Samsung',
  equipoModelo: 'A54',
  equipoSerie: '358240051111110',
  claveDesbloqueo: '1234',
  fallaDeclarada: 'no carga',
  accesorios: 'cargador',
  danosVisibles: 'pantalla rayada',
  creadoEn: new Date('2026-08-15T13:00:00Z'),
  cliente: { nombre: 'Juan Pérez', telefono: '1155667788' },
  recibidaPor: { nombre: 'Ana' },
}

describe('el ticket', () => {
  it('imprime las dos copias, rotuladas', () => {
    render(<CuerpoDelTicket orden={orden} local="Celulares Flor" />)
    expect(screen.getByText(/COPIA CLIENTE/)).toBeTruthy()
    expect(screen.getByText(/COPIA LOCAL/)).toBeTruthy()
  })

  it('el número aparece una vez por copia', () => {
    render(<CuerpoDelTicket orden={orden} local="Celulares Flor" />)
    expect(screen.getAllByText(/#42/)).toHaveLength(2)
  })

  it('NO imprime la clave de desbloqueo, en ninguna de las dos copias', () => {
    // El test que hace que esa decisión no se pueda deshacer sin romper el
    // build. La copia del local queda pegada al equipo en el estante: ahí la
    // clave sería peor que en el bolsillo del cliente.
    const { container } = render(<CuerpoDelTicket orden={orden} local="Celulares Flor" />)
    expect(container.textContent).not.toContain('1234')
  })

  it('imprime lo que cubre al local en un reclamo', () => {
    const { container } = render(<CuerpoDelTicket orden={orden} local="Celulares Flor" />)
    expect(container.textContent).toContain('pantalla rayada')
    expect(container.textContent).toContain('cargador')
    expect(container.textContent).toContain('358240051111110')
  })

  it('aguanta el equipo que entró sin datos opcionales', () => {
    const pelado = {
      ...orden,
      equipoSerie: null,
      claveDesbloqueo: null,
      accesorios: null,
      danosVisibles: null,
      cliente: { nombre: 'Sin teléfono', telefono: null },
    }
    const { container } = render(<CuerpoDelTicket orden={pelado} local="Celulares Flor" />)
    expect(container.textContent).toContain('Sin teléfono')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run 'app/(app)/servicio-tecnico/[id]/ticket/ticket.test.tsx'`
Expected: FAIL — no resuelve `./page`.

- [ ] **Step 3: Escribir `ticket.module.css`**

```css
/* La ÚNICA superficie del producto que no usa los tokens de app/globals.css, y
   está declarada como excepción en docs/sistema-de-diseno.md con su razón: una
   impresora térmica quema un solo color y el fondo es el papel. Un token de
   tema acá no significaría nada. */

.hoja {
  background: #fff;
  color: #000;
  width: 80mm;
  margin: 0 auto;
  padding: 4mm;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  line-height: 1.35;
}

.numero {
  font-size: 22px;
  font-weight: 700;
}

.corte {
  border-top: 1px dashed #000;
  margin: 6mm 0;
  padding-top: 2mm;
  text-align: center;
}

.firma {
  margin-top: 8mm;
  border-top: 1px solid #000;
  padding-top: 1mm;
}

@page {
  /* auto de alto: es un rollo continuo, no una hoja. */
  size: 80mm auto;
  margin: 0;
}

@media print {
  /* El shell de la aplicación no va al papel. :global porque el header y el
     pie los emite app/(app)/layout.tsx, que no conoce este módulo. */
  :global(header),
  :global(footer) {
    display: none;
  }
  .hoja {
    margin: 0;
    padding: 2mm;
  }
}
```

- [ ] **Step 4: Escribir `imprimir.tsx`**

```tsx
'use client'

import { useEffect } from 'react'

/**
 * Abre el diálogo de impresión al cargar.
 *
 * Sin JavaScript el ticket se ve igual y se imprime con Ctrl+P: esto es una
 * comodidad para el mostrador, no el mecanismo. Es la misma regla que el resto
 * de las pantallas — todo funciona sin JS.
 */
export function ImprimirAlCargar() {
  useEffect(() => {
    window.print()
  }, [])
  return null
}
```

- [ ] **Step 5: Escribir `page.tsx`**

```tsx
import { notFound } from 'next/navigation'
import { exigirSesion } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { formatearFecha } from '@/lib/formato/mostrar'
import { ImprimirAlCargar } from './imprimir'
import estilos from './ticket.module.css'

export const dynamic = 'force-dynamic'

type OrdenDelTicket = {
  numero: number
  equipoMarca: string
  equipoModelo: string
  equipoSerie: string | null
  // Está en el tipo aunque no se imprima: que el dato LLEGUE y la decisión de
  // no mostrarlo sea explícita es lo que el test verifica. Si no llegara, el
  // test pasaría por accidente y nadie sabría que la decisión sigue viva.
  claveDesbloqueo: string | null
  fallaDeclarada: string
  accesorios: string | null
  danosVisibles: string | null
  creadoEn: Date
  cliente: { nombre: string; telefono: string | null }
  recibidaPor: { nombre: string }
}

function Copia({
  orden,
  local,
  rotulo,
}: {
  orden: OrdenDelTicket
  local: string
  rotulo: string
}) {
  return (
    <div className={estilos.hoja}>
      <div style={{ textAlign: 'center' }}>
        <strong>{local}</strong>
        <div>Servicio técnico</div>
        <div className={estilos.numero}>#{orden.numero}</div>
        <div>{formatearFecha(orden.creadoEn)}</div>
      </div>

      <div className={estilos.corte}>{rotulo}</div>

      <div>
        <div>Cliente: {orden.cliente.nombre}</div>
        {orden.cliente.telefono ? <div>Tel: {orden.cliente.telefono}</div> : null}
        <div>
          Equipo: {orden.equipoMarca} {orden.equipoModelo}
        </div>
        {orden.equipoSerie ? <div>IMEI/Serie: {orden.equipoSerie}</div> : null}
        <div>Falla: {orden.fallaDeclarada}</div>
        {orden.accesorios ? <div>Accesorios: {orden.accesorios}</div> : null}
        {orden.danosVisibles ? <div>Estado: {orden.danosVisibles}</div> : null}
        <div>Recibió: {orden.recibidaPor.nombre}</div>
      </div>

      {rotulo.includes('LOCAL') ? <div className={estilos.firma}>Firma del cliente</div> : null}
    </div>
  )
}

/**
 * Exportado para el test: se renderiza sin base y sin sesión.
 *
 * Las DOS copias en una sola impresión: sobre un rollo continuo salen una
 * después de la otra, así que es un botón y no dos.
 */
export function CuerpoDelTicket({ orden, local }: { orden: OrdenDelTicket; local: string }) {
  return (
    <>
      <Copia orden={orden} local={local} rotulo="— COPIA CLIENTE —" />
      <Copia orden={orden} local={local} rotulo="— COPIA LOCAL —" />
    </>
  )
}

export default async function Ticket({ params }: { params: Promise<{ id: string }> }) {
  const sesion = await exigirSesion()
  const { id } = await params
  const prisma = prismaParaTenant(sesion.tenant.id)

  const orden = await prisma.ordenDeTrabajo.findFirst({
    where: { id },
    select: {
      numero: true,
      equipoMarca: true, equipoModelo: true, equipoSerie: true, claveDesbloqueo: true,
      fallaDeclarada: true, accesorios: true, danosVisibles: true, creadoEn: true,
      cliente: { select: { nombre: true, telefono: true } },
      recibidaPor: { select: { nombre: true } },
    },
  })
  if (!orden) notFound()

  return (
    <>
      <ImprimirAlCargar />
      <CuerpoDelTicket orden={orden} local={sesion.tenant.nombre} />
    </>
  )
}
```

- [ ] **Step 6: Correr el test del ticket**

Run: `npx vitest run 'app/(app)/servicio-tecnico/[id]/ticket/ticket.test.tsx'`
Expected: PASS, 5 tests.

- [ ] **Step 7: Declarar la ruta en `RUTAS_SIN_SMOKE`**

En `scripts/lib/rutas-comun.sh`:

```bash
  ['/servicio-tecnico/[id]/ticket']='mismo motivo que /servicio-tecnico/[id]: no hay id de orden que pedir sin sembrar datos en el gate. Y lo específico de esta pantalla —que las dos copias salgan y que la clave de desbloqueo NO se imprima— lo cubre app/(app)/servicio-tecnico/[id]/ticket/ticket.test.tsx, que la renderiza sin base.'
```

- [ ] **Step 8: Declarar la excepción en `docs/sistema-de-diseno.md`**

En la sección de excepciones del documento, agregar:

```markdown
### El ticket de servicio técnico no usa tokens

`app/(app)/servicio-tecnico/[id]/ticket/ticket.module.css` es la única
superficie del producto que escribe colores literales: `#000` sobre `#fff`.

**Por qué**: una impresora térmica quema un solo color y el fondo es el papel.
No hay tema claro ni oscuro que aplicar — un token de tema ahí no significaría
nada, y heredar la paleta oscura de la aplicación imprimiría una hoja negra.

**Qué la haría caducar**: que el ticket deje de imprimirse y pase a ser sólo una
pantalla, o que aparezca una impresora a color. Ninguna de las dos está prevista.
```

- [ ] **Step 9: Correr todo el gate local**

Run: `npm test && npx tsc --noEmit`
Expected: PASS. `test/sistema-de-diseno.test.ts` sigue verde: el documento suma prosa, no tokens.

- [ ] **Step 10: Commit**

```bash
git add 'app/(app)/servicio-tecnico' scripts/lib/rutas-comun.sh docs/sistema-de-diseno.md
git commit -m "feat(servicio-tecnico): el ticket térmico, con sus dos copias

Las dos copias en una sola impresión: sobre rollo continuo salen una después de
la otra, así que es un botón y no dos.

La clave de desbloqueo NO se imprime, y hay un test que lo verifica sobre el
texto renderizado — la copia del local queda pegada al equipo en el estante, y
ahí la clave sería peor que en el bolsillo del cliente.

Es la única superficie que escribe colores literales, y la excepción queda
declarada en docs/sistema-de-diseno.md con lo que la haría caducar: una térmica
quema un solo color y el fondo es el papel."
```

---

### Task 10: El sembrador de dev

Sin datos no se puede mirar nada, y lo que hay que mirar es el papel.

**Files:**
- Create: `scripts/sembrar-ordenes-dev.mts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `crearOrden`, `cambiarEstado`, `crearCliente`, `prisma` de `@/lib/db`.
- Produces: el comando `npm run ordenes:sembrar -- <tenantId> <usuarioId>`.

- [ ] **Step 1: Leer el sembrador que ya existe**

Run: `cat scripts/sembrar-ventas-dev.mts`
Expected: es el patrón exacto que se copia — argumentos por `process.argv`, imports con alias `@/`, y `await prisma.$disconnect()` al final. Los ids se pasan a mano porque la app conecta como `arandano_app`, sobre el que RLS aplica: un `findFirst` de tenants sin GUC no devuelve nada.

- [ ] **Step 2: Escribir `scripts/sembrar-ordenes-dev.mts`**

```ts
/**
 * Órdenes de servicio sintéticas para mirar /servicio-tecnico en dev:
 * `npm run ordenes:sembrar -- <tenantId> <usuarioId>`.
 *
 * **Sólo dev.** Escribe equipos de mentira; correrlo contra una base con datos
 * de clientes ensucia el mostrador de alguien.
 *
 * Los equipos tienen nombres y fallas de largo DELIBERADAMENTE disparejo: con
 * datos parejos no se puede ver si el ticket de 80 mm desborda, que es
 * justamente lo que hay que mirar con el papel en la mano. Es la misma lección
 * que dejó el sembrador de ventas con los importes de distinta cantidad de
 * dígitos (anotada en CLAUDE.md al cerrar la verificación visual del punto de
 * venta).
 */
import { crearOrden } from '@/lib/ordenes-de-trabajo/crear'
import { cambiarEstado } from '@/lib/ordenes-de-trabajo/operaciones'
import { crearCliente } from '@/lib/clientes/administrar'
import { prisma } from '@/lib/db'
import type { EstadoOrden } from '@/generated/prisma/client'

// Por argumento y no resueltos acá: la app conecta como `arandano_app`, sobre
// el que RLS aplica, así que un `findFirst` de tenants sin GUC no devuelve
// nada. Los ids salen de psql, que entra con el rol dueño. Mismo criterio que
// scripts/sembrar-ventas-dev.mts.
const [tenantId, usuarioId] = process.argv.slice(2)
if (!tenantId || !usuarioId) {
  throw new Error('uso: sembrar-ordenes-dev.mts <tenantId> <usuarioId>')
}

type Receta = {
  cliente: { nombre: string; telefono: string | null }
  equipoMarca: string
  equipoModelo: string
  equipoSerie: string | null
  claveDesbloqueo: string | null
  fallaDeclarada: string
  accesorios: string | null
  danosVisibles: string | null
  // Cada orden termina en un estado distinto: es lo que hace que los contadores
  // del tablero muestren algo y no una sola columna con todo.
  camino: EstadoOrden[]
}

const RECETAS: Receta[] = [
  // El caso corto: todo entra holgado. Queda en RECIBIDO.
  {
    cliente: { nombre: 'Ana', telefono: '1155667788' },
    equipoMarca: 'Samsung',
    equipoModelo: 'A54',
    equipoSerie: '358240051111110',
    claveDesbloqueo: '1234',
    fallaDeclarada: 'no carga',
    accesorios: 'cargador',
    danosVisibles: null,
    camino: [],
  },
  // El caso largo, que es el que rompe el ticket si algo está mal: nombre de
  // cliente largo, modelo largo, y una falla de cinco renglones.
  {
    cliente: { nombre: 'María Fernanda Gutiérrez de la Serna', telefono: '1144332211' },
    equipoMarca: 'Xiaomi',
    equipoModelo: 'Redmi Note 12 Pro Plus 5G Dual SIM',
    equipoSerie: '860123456789012',
    claveDesbloqueo: 'patrón: L invertida',
    fallaDeclarada:
      'se cayó al agua, prende pero la pantalla queda en negro y a veces vibra sola. ' +
      'El cliente dice que le pasa desde el domingo y que ya probó con otro cargador.',
    accesorios: 'cargador, funda, chip Movistar',
    danosVisibles: 'tapa trasera despegada, marco golpeado en la esquina inferior izquierda',
    camino: ['EN_DIAGNOSTICO', 'PRESUPUESTADO'],
  },
  // Sin IMEI ni accesorios: el equipo que entra sin encender.
  {
    cliente: { nombre: 'Luis Paz', telefono: null },
    equipoMarca: 'Motorola',
    equipoModelo: 'G22',
    equipoSerie: null,
    claveDesbloqueo: null,
    fallaDeclarada: 'pantalla rota',
    accesorios: null,
    danosVisibles: 'vidrio astillado',
    camino: ['EN_REPARACION', 'LISTO'],
  },
  // El que no tuvo arreglo: sigue en el estante hasta que lo vengan a buscar.
  {
    cliente: { nombre: 'Carla Ríos', telefono: '1199887766' },
    equipoMarca: 'Apple',
    equipoModelo: 'iPhone 11',
    equipoSerie: '013948005566771',
    claveDesbloqueo: '0000',
    fallaDeclarada: 'batería dura 2 horas',
    accesorios: 'cable',
    danosVisibles: null,
    camino: ['EN_DIAGNOSTICO', 'SIN_REPARACION'],
  },
]

for (const receta of RECETAS) {
  const cliente = await crearCliente({
    tenantId,
    nombre: receta.cliente.nombre,
    telefono: receta.cliente.telefono,
  })

  const orden = await crearOrden({
    tenantId,
    usuarioId,
    clienteId: cliente.id,
    equipoMarca: receta.equipoMarca,
    equipoModelo: receta.equipoModelo,
    equipoSerie: receta.equipoSerie,
    claveDesbloqueo: receta.claveDesbloqueo,
    fallaDeclarada: receta.fallaDeclarada,
    accesorios: receta.accesorios,
    danosVisibles: receta.danosVisibles,
  })

  for (const hasta of receta.camino) {
    await cambiarEstado({ tenantId, usuarioId, ordenId: orden.id, hasta })
  }

  // La URL del ticket, que es lo que se abre para mirar el papel.
  console.log(`orden #${orden.numero} → /servicio-tecnico/${orden.id}/ticket`)
}

await prisma.$disconnect()
```

- [ ] **Step 3: Agregar el script a `package.json`**

En `"scripts"`, junto a `"ventas:sembrar"`:

```json
    "ordenes:sembrar": "tsx scripts/sembrar-ordenes-dev.mts",
```

`tsx` y no `node` pelado: `node` no resuelve el alias `@/` ni los imports sin extensión del cliente de Prisma. Es la lección de la Task 11 del ciclo de autenticación, y está escrita en `docs/runbook-stacks.md`.

- [ ] **Step 4: Correr el sembrador contra dev**

Sacar los dos ids con psql, que entra con el rol dueño (la app no los puede leer sin GUC):

```sql
SELECT t.id AS tenant, u.id AS usuario
  FROM tenants t JOIN users u ON u.tenant_id = t.id
 WHERE t.subdominio = '<el canario de dev>' LIMIT 1;
```

Run: `npm run ordenes:sembrar -- <tenantId> <usuarioId>`
Expected: cuatro líneas, una por orden, con el número y la URL de su ticket.

- [ ] **Step 5: Commit**

```bash
git add scripts/sembrar-ordenes-dev.mts package.json
git commit -m "chore(servicio-tecnico): sembrador de órdenes para dev

Equipos de largo deliberadamente disparejo: con nombres parejos no se ve si el
ticket desborda los 80 mm, que es justo lo que hay que mirar. Misma lección que
dejó el sembrador de ventas con los importes de distinta cantidad de dígitos.

Cada orden queda en un estado distinto, así los contadores del tablero muestran
algo y no una sola columna con todo."
```

---

### Task 11: Cierre — documentación y verificación con papel

La única task que no la puede terminar un test.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-15-servicio-tecnico-design.md`

- [ ] **Step 1: Correr el gate completo en local**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: todo PASS.

- [ ] **Step 2: Verificar que la migración sigue siendo no destructiva**

Run: `grep -rniE 'DROP |RENAME ' prisma/migrations/*_servicio_tecnico/migration.sql`
Expected: cero líneas.

- [ ] **Step 3: Verificar a ojo contra `arandano-dev`**

Entrando **por el subdominio del tenant**, no por la IP pelada — `http://100.64.81.63:3000` responde 404 desde el cutover de tenants por `Host`, y es correcto que lo haga. La lista, en orden:

1. La pestaña Servicio Técnico aparece y se subraya al entrar.
2. El tablero muestra las cuatro órdenes sembradas, la más vieja arriba, y los contadores por estado suman bien.
3. Filtrar por un estado y volver a "Todas" funciona.
4. Recibir un equipo con cliente nuevo, y otro con cliente elegido de la lista.
5. Doble click en "Recibir e imprimir": **tiene que salir una sola orden**.
6. En el detalle, sólo aparecen los botones de las transiciones legales.
7. Con un usuario EMPLEADO, el botón de anular no está; con DUEÑO, sí.
8. La clave de desbloqueo se ve en el detalle.

- [ ] **Step 4: Imprimir el ticket de verdad, en la térmica**

El paso que ningún test hace. Con papel en la mano:

- ¿El texto entra en los 80 mm o se corta?
- ¿La línea de corte cae entre las dos copias?
- ¿El número se lee de lejos, que es como se busca un equipo en el estante?
- ¿La falla larga del Xiaomi sembrado se lee o se desarma?
- ¿La clave de desbloqueo NO está en ninguna de las dos copias?

Si algo de esto falla, el arreglo va en `ticket.module.css` y vuelve a esta lista.

- [ ] **Step 5: Anotar el resultado en el spec**

En la sección *Cómo se verifica* del spec, reemplazar el párrafo que dice que la verificación con papel "se anota acá cuando se haya hecho" por lo que efectivamente se vio, incluidos los ajustes que haya habido que hacerle al CSS. Es lo que va a leer quien toque el ticket dentro de seis meses.

- [ ] **Step 6: Actualizar `CLAUDE.md`**

En *Próximos pasos técnicos*, tachar el ítem del schema de órdenes de trabajo y dejar en su lugar qué se construyó y qué quedó afuera:

```markdown
- ~~Definir el schema del módulo de órdenes de trabajo.~~ **Hecho**
  (2026-08-15), y **no** en `modules/`: la pestaña es fija y el registry de
  módulos sigue sin existir — decisión consciente, con su vencimiento escrito
  en el spec. `OrdenDeTrabajo` y `EventoOrden` (append-only) con el mismo
  `tenant_id` y las mismas policies de RLS, recepción del equipo, ocho estados
  con su grafo validado en el servidor, bitácora, y ticket térmico de 80 mm con
  las dos copias. Ver
  `docs/superpowers/specs/2026-08-15-servicio-tecnico-design.md`. **Queda para
  los ciclos siguientes**: repuestos que descuenten stock —que es el que cierra
  la decisión abierta de `MovimientoStock`—, el cobro por `crearVentaDesde`,
  las fotos del equipo, el registry de módulos y la sección `/clientes`.
```

Y en *Decisiones abiertas del modelo de datos*, agregar al ítem de
`MovimientoStock` que el módulo ya existe y que la decisión se toma en el ciclo
de repuestos — el que la puede tomar bien.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-08-15-servicio-tecnico-design.md
git commit -m "docs(servicio-tecnico): lo que quedó construido, y lo que la térmica mostró

La verificación con papel es la única que ningún test hace, así que lo que se
vio queda escrito donde lo va a leer quien toque el ticket dentro de seis meses.

CLAUDE.md anota que el módulo existe sin registry y con la pestaña fija: es
deuda con disparador, no un olvido."
```

---

## Después del plan

Cuando las once tasks estén, el ciclo termina con `deploy.sh`, que corre su gate
completo y promueve la imagen. Sube **MINOR**: es una pantalla que el cliente ve.

Y la verificación manual en el canario de producción va inmediatamente después,
como pide `CLAUDE.md` — con la diferencia de que acá esa verificación incluye
imprimir un ticket.
