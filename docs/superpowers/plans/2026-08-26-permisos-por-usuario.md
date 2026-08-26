# Permisos por usuario — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el dueño de cada local decida, empleado por empleado, qué puede hacer — empezando por cargar artículos y por ver los costos.

**Architecture:** una tabla `usuario_permisos` con RLS donde **la fila es el permiso otorgado y su ausencia es la negación**; un catálogo de seis permisos cerrado en código (`lib/permisos/catalogo.ts`) que es la única fuente para el servidor y para la pantalla; y una guarda `exigirPermiso(permiso)` que reemplaza a `exigirDuenio()` en las once guardas delegables. Un `DUENO` da verdadero sin tocar la tabla.

**Tech Stack:** Next.js App Router (Server Components + server actions), Prisma 7 sobre PostgreSQL con Row Level Security, shadcn/ui sobre Radix (paquete paraguas `radix-ui`, ya instalado), sonner para los avisos, vitest contra un Postgres efímero.

**Spec:** `docs/superpowers/specs/2026-08-26-permisos-por-usuario-design.md`

## Global Constraints

- **Todo en español**: nombres de funciones, variables, tipos, comentarios, mensajes de UI y de commit. La única excepción son los identificadores que impone una librería.
- **Nada de enums de Prisma importados**: este repo declara las uniones a mano en `lib/`, con una sola copia (ver `lib/usuarios/resumen.ts:1`). El catálogo es esa copia única, y un test lo ata al `schema.prisma`.
- **La guarda real va en el server action, nunca sólo en la UI.** Esconder un botón es comodidad; un server action es un endpoint y se puede invocar sin pasar por la pantalla.
- **Migraciones con `--create-only`**: `npx prisma migrate dev --create-only --name <nombre>`, editar el SQL, y recién después aplicar. Aplicar y editar después choca con el guard de checksum de Prisma, que exige `migrate reset` — prohibido en este repo.
- **`prismaParaTenant` no autocompleta `tenant_id` para modelos nuevos**: `MODELOS_CON_TENANT` (`lib/tenant/prisma.ts:6`) no incluye `UsuarioPermiso`, así que **todo `create` pasa `tenantId` explícito**, igual que hace `tx.categoria.create` en `lib/inventario/categorias.ts:293`.
- **Los toasts se lanzan en el handler que ejecuta la acción**, nunca en un `useEffect` sobre `useActionState`, y llevan clave estable. Ver el JSDoc de `avisar()` en `app/(app)/inventario/abm-categorias.tsx` para el porqué completo.
- **Errores con `duration: Infinity`; éxitos se auto-descartan.**
- **Componentes de shadcn**: importan del paquete paraguas `radix-ui` (`import { Switch as SwitchPrimitive } from "radix-ui"`), no de `@radix-ui/react-*`. No hace falta instalar ninguna dependencia nueva.
- **Un commit por tarea**, con el footer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Desvío del spec, decidido al planificar

El spec dice que `exigirPermiso` vive en `lib/auth/sesion.ts`. **Va en `lib/permisos/guarda.ts`.** `sesion.ts` responde *quién sos* resolviendo el request; los permisos son *qué podés* y consultan una tabla. Meter la consulta ahí le mete a `sesion.ts` una dependencia de base de datos que hoy no tiene, y deja la puerta abierta al ciclo de imports el día que `lib/permisos/` necesite el tipo `Sesion` (que ya lo necesita). `exigirDuenio()` se queda donde está, guardando `/usuarios`.

## Estructura de archivos

**Se crean:**

| Archivo | Responsabilidad |
|---|---|
| `lib/permisos/catalogo.ts` | Los seis permisos con su nombre visible y su ayuda. Sin imports de base. Única fuente para servidor y pantalla. |
| `lib/permisos/consultar.ts` | `permisosDe(tenantId, usuarioId)` — la lectura, memoizada por request con `cache()`. |
| `lib/permisos/administrar.ts` | `otorgar` / `revocar`, con sus errores de dominio. |
| `lib/permisos/guarda.ts` | `exigirPermiso` (tira 403) y `puede` (devuelve booleano, para pintar). |
| `lib/permisos/errores.ts` | `ErrorDePermiso`, con la misma forma que `ErrorDeInventario`. |
| `components/ui/switch.tsx` | shadcn, sin tocar a mano. |
| `components/ui/dialog.tsx` | shadcn, sin tocar a mano. |
| `app/(app)/usuarios/permisos-dialogo.tsx` | El diálogo con los seis switches. Client Component. |
| `test/permisos.test.ts` | El modelo y las funciones, contra la base efímera. |
| `test/permisos-catalogo.test.ts` | Las dos direcciones: catálogo ↔ schema, catálogo ↔ código, catálogo ↔ pantalla. |
| `app/(app)/usuarios/permisos-dialogo.test.tsx` | El render del diálogo. |

**Se modifican:** `prisma/schema.prisma`, `docs/schema.md` (regenerado), `app/(app)/inventario/acciones.ts`, `app/(app)/inventario/nuevo/page.tsx`, `app/(app)/inventario/page.tsx`, `app/(app)/inventario/[id]/page.tsx`, `app/(app)/inventario/formularios.tsx`, `app/(app)/inventario/historial.tsx`, `app/(app)/ventas/acciones.ts`, `app/(app)/servicio-tecnico/acciones.ts`, `app/(app)/servicio-tecnico/[id]/page.tsx`, `app/(app)/usuarios/acciones.ts`, `app/(app)/usuarios/page.tsx`, `app/(app)/usuarios/formularios.tsx`, `CLAUDE.md`, `docs/pantallas.md`, `docs/correcciones-pendientes-del-pen.md`.

---

### Task 1: El modelo — enum, tabla y RLS

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_permisos_por_usuario/migration.sql`
- Modify: `docs/schema.md` (regenerado, no editado a mano)
- Test: `test/permisos.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: la tabla `usuario_permisos` y el tipo `permiso` de Postgres. El cliente de Prisma expone `prisma.usuarioPermiso` con los campos `tenantId`, `usuarioId`, `permiso`, `otorgadoEn`.

- [ ] **Step 1: Escribí el test que falla**

Creá `test/permisos.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'

let owner: Client
let app: Client
let tenantA: string
let tenantB: string
let empleadoA: string
let empleadoB: string

/** Igual que test/rls.test.ts: la GUC fijada adentro de una transacción, que es
 *  como corre la app en producción. */
async function comoTenant(tenantId: string | null, sql: string, params: unknown[] = []) {
  await app.query('BEGIN')
  try {
    if (tenantId !== null) {
      await app.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
    }
    const res = await app.query(sql, params)
    await app.query('COMMIT')
    return res
  } catch (e) {
    await app.query('ROLLBACK')
    throw e
  }
}

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  app = new Client({ connectionString: urlApp() })
  await owner.connect()
  await app.connect()

  tenantA = await crearTenant(owner, 'permisos-a')
  tenantB = await crearTenant(owner, 'permisos-b')
  empleadoA = await crearUsuario(owner, tenantA, 'empleado@permisos-a.test', 'EMPLEADO')
  empleadoB = await crearUsuario(owner, tenantB, 'empleado@permisos-b.test', 'EMPLEADO')
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('la tabla usuario_permisos', () => {
  it('acepta los seis valores del enum', async () => {
    const claves = [
      'ARTICULOS_CREAR', 'ARTICULOS_EDITAR', 'COSTOS',
      'CATEGORIAS', 'VENTAS_ANULAR', 'ORDENES_ANULAR',
    ]
    for (const clave of claves) {
      await comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, $3, now())`,
        [tenantA, empleadoA, clave],
      )
    }
    const { rows } = await comoTenant(
      tenantA,
      `SELECT count(*)::int AS n FROM usuario_permisos WHERE usuario_id = $1`,
      [empleadoA],
    )
    expect(rows[0].n).toBe(6)
  })

  it('rechaza un permiso que no está en el enum', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, 'BORRAR_TODO', now())`,
        [tenantA, empleadoA],
      ),
    ).rejects.toThrow()
  })

  // La clave primaria compuesta: otorgar dos veces el mismo permiso no puede
  // dejar dos filas, porque "revocar" es un DELETE y una fila duplicada
  // sobreviviría a la revocación.
  it('no deja otorgar dos veces el mismo permiso', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
         VALUES ($1, $2, 'COSTOS', now())`,
        [tenantA, empleadoA],
      ),
    ).rejects.toThrow()
  })

  it('un tenant no ve los permisos de otro', async () => {
    await comoTenant(
      tenantB,
      `INSERT INTO usuario_permisos (tenant_id, usuario_id, permiso, otorgado_en)
       VALUES ($1, $2, 'COSTOS', now())`,
      [tenantB, empleadoB],
    )
    const { rows } = await comoTenant(
      tenantA,
      `SELECT count(*)::int AS n FROM usuario_permisos WHERE usuario_id = $1`,
      [empleadoB],
    )
    expect(rows[0].n).toBe(0)
  })

  // Sin GUC no pasa ninguna fila: la policy falla cerrado, igual que el resto.
  it('sin la GUC seteada no se ve nada', async () => {
    const { rows } = await comoTenant(null, `SELECT count(*)::int AS n FROM usuario_permisos`)
    expect(rows[0].n).toBe(0)
  })
})
```

- [ ] **Step 2: Corré el test y verificá que falla**

Corré: `npx vitest run test/permisos.test.ts`
Esperado: FAIL con `relation "usuario_permisos" does not exist`.

- [ ] **Step 3: Agregá el enum y el modelo al schema**

En `prisma/schema.prisma`, junto a los otros enums (después de `RolUsuario`):

```prisma
/// Lo que un EMPLEADO puede hacer. Un DUENO no necesita ninguna fila: la
/// guarda le devuelve verdadero sin consultar la tabla, que es lo que
/// garantiza que un dueño no pueda quedarse afuera de su propio local.
enum Permiso {
  ARTICULOS_CREAR
  ARTICULOS_EDITAR
  COSTOS
  CATEGORIAS
  VENTAS_ANULAR
  ORDENES_ANULAR

  @@map("permiso")
}
```

Y el modelo, después de `User`:

```prisma
/// Un permiso otorgado a una persona.
///
/// **La fila ES el permiso; su ausencia es la negación.** Sin columna booleana
/// y sin tri-estado: revocar es un DELETE. Eso es lo que hace que la migración
/// no necesite ningún backfill — los usuarios que ya existen quedan
/// exactamente como estaban, porque hoy no pueden nada de esto.
///
/// **Un empleado desactivado conserva sus filas** y vuelve con los mismos
/// permisos si lo reactivan. Es coherente con que la baja acá sea lógica
/// (`User.desactivadoEn`) y con lo que uno espera al readmitir a alguien.
/// Revocar es un acto aparte y explícito.
model UsuarioPermiso {
  tenantId   String   @map("tenant_id") @db.Uuid
  usuarioId  String   @map("usuario_id") @db.Uuid
  permiso    Permiso
  otorgadoEn DateTime @default(now()) @map("otorgado_en") @db.Timestamptz(3)

  tenant  Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  usuario User   @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@id([tenantId, usuarioId, permiso])
  @@map("usuario_permisos")
}
```

Y las dos relaciones inversas: en `model Tenant`, `usuarioPermisos UsuarioPermiso[]`; en `model User`, `permisos UsuarioPermiso[]`.

- [ ] **Step 4: Generá la migración SIN aplicarla**

Corré: `npx prisma migrate dev --create-only --name permisos_por_usuario`
Esperado: crea `prisma/migrations/<timestamp>_permisos_por_usuario/migration.sql` con el `CREATE TYPE` y el `CREATE TABLE`, sin aplicar nada.

- [ ] **Step 5: Agregá la policy de RLS al final de esa migración**

```sql
-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "usuario_permisos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "usuario_permisos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 6: Aplicá la migración y regenerá el cliente**

Corré: `npx prisma migrate dev` y después `npx prisma generate`
Esperado: aplica sin pedir reset.

- [ ] **Step 7: Corré los tests y verificá que pasan**

Corré: `npx vitest run test/permisos.test.ts test/rls-cobertura.test.ts test/schema.test.ts`
Esperado: PASS en los tres. `rls-cobertura` es el que confirma que la policy no se olvidó: enumera las tablas reales de `pg_class`, así que hubiera fallado sin el Step 5.

- [ ] **Step 8: Regenerá el diagrama del schema**

Corré: `scripts/generar-erd.sh`
Esperado: `docs/schema.md` actualizado con la tabla nueva. **No lo edites a mano**: el hook de pre-commit lo verifica contra el DDL y el commit va a fallar.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md test/permisos.test.ts
git commit -m "feat(permisos): la tabla usuario_permisos con su RLS"
```

---

### Task 2: El catálogo

**Files:**
- Create: `lib/permisos/catalogo.ts`
- Test: `test/permisos-catalogo.test.ts`

**Interfaces:**
- Consumes: el enum `Permiso` del `schema.prisma` (por texto, no por import).
- Produces: `PERMISOS` (array de `{ clave, nombre, ayuda }`), el tipo `Permiso` (unión de las seis claves) y `CLAVES_DE_PERMISO: readonly Permiso[]`. **Todo el resto del plan importa el tipo `Permiso` desde acá**, nunca desde `@/generated/prisma/client`.

- [ ] **Step 1: Escribí el test que falla**

Creá `test/permisos-catalogo.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { PERMISOS, CLAVES_DE_PERMISO } from '@/lib/permisos/catalogo'

const SCHEMA = readFileSync('prisma/schema.prisma', 'utf8')

/** Los valores del enum Permiso tal como los declara el schema. */
function clavesDelSchema(): string[] {
  const bloque = SCHEMA.slice(SCHEMA.indexOf('enum Permiso {'))
  const cuerpo = bloque.slice(bloque.indexOf('{') + 1, bloque.indexOf('}'))
  return cuerpo
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l))
}

describe('el catálogo de permisos', () => {
  it('encuentra el enum en el schema; si no, el test no prueba nada', () => {
    expect(clavesDelSchema().length).toBeGreaterThan(0)
  })

  // Las dos direcciones. Una unión escrita a mano que se desincronice del enum
  // deja al servidor aceptando un permiso que la base rechaza, o al revés: un
  // valor de la base que ninguna pantalla ofrece nunca.
  it('tiene exactamente las claves del enum del schema', () => {
    expect([...CLAVES_DE_PERMISO].sort()).toEqual(clavesDelSchema().sort())
  })

  it('cada permiso tiene nombre visible y ayuda, sin repetirse', () => {
    for (const p of PERMISOS) {
      expect(p.nombre.length, `${p.clave} sin nombre`).toBeGreaterThan(0)
      expect(p.ayuda.length, `${p.clave} sin ayuda`).toBeGreaterThan(0)
    }
    expect(new Set(PERMISOS.map((p) => p.nombre)).size).toBe(PERMISOS.length)
  })
})
```

- [ ] **Step 2: Corré el test y verificá que falla**

Corré: `npx vitest run test/permisos-catalogo.test.ts`
Esperado: FAIL con `Cannot find module '@/lib/permisos/catalogo'`.

- [ ] **Step 3: Escribí el catálogo**

Creá `lib/permisos/catalogo.ts`:

```ts
/**
 * Los seis permisos, con lo que la pantalla muestra al lado de cada switch.
 *
 * **Es la única fuente**: el servidor valida contra esta lista y `/usuarios` la
 * renderea, en vez de repetir los seis a mano en el JSX. Agregar un permiso es
 * tocar este archivo, el enum del schema y el lugar que lo exige — nada más.
 *
 * **La unión se escribe acá y no se importa de Prisma**, que es lo que ya hace
 * este repo con `RolUsuario` (ver `lib/usuarios/resumen.ts:1`): una sola copia
 * en `lib/`, atada al schema por `test/permisos-catalogo.test.ts` en las dos
 * direcciones.
 *
 * **`COSTOS` es uno y no dos** (ver / cargar): cargar un costo que no podés ver
 * no es un caso que exista, porque el ingreso de mercadería te muestra lo que
 * acabás de escribir. **`ARTICULOS_CREAR` y `ARTICULOS_EDITAR` sí son dos**, y
 * ésa es la asimetría a propósito: cargar un producto nuevo y cambiarle el
 * precio a uno que se viene vendiendo hace meses no tienen el mismo riesgo.
 */
export const PERMISOS = [
  {
    clave: 'ARTICULOS_CREAR',
    nombre: 'Cargar artículos',
    ayuda: 'Dar de alta productos y servicios nuevos, con su precio de venta.',
  },
  {
    clave: 'ARTICULOS_EDITAR',
    nombre: 'Editar artículos',
    ayuda: 'Cambiar el nombre y el precio de un artículo que ya existe, desactivarlo y reactivarlo.',
  },
  {
    clave: 'COSTOS',
    nombre: 'Ver y cargar costos',
    ayuda: 'Ver el costo de compra y el margen, y cargarlos al recibir mercadería.',
  },
  {
    clave: 'CATEGORIAS',
    nombre: 'Administrar categorías',
    ayuda: 'Crear, renombrar, mover y borrar rubros y marcas del árbol.',
  },
  {
    clave: 'VENTAS_ANULAR',
    nombre: 'Anular ventas',
    ayuda: 'Anular una venta ya cobrada y devolver su stock al inventario.',
  },
  {
    clave: 'ORDENES_ANULAR',
    nombre: 'Anular órdenes de trabajo',
    ayuda: 'Anular una orden de servicio técnico ya abierta.',
  },
] as const

export type Permiso = (typeof PERMISOS)[number]['clave']

export const CLAVES_DE_PERMISO: readonly Permiso[] = PERMISOS.map((p) => p.clave)

/** Si el texto es uno de los seis, lo devuelve tipado; si no, null. Es la
 *  validación de entrada de la acción que otorga y revoca: un `permiso` que
 *  llega por FormData es texto de afuera hasta que pasa por acá. */
export function comoPermiso(texto: string): Permiso | null {
  return (CLAVES_DE_PERMISO as readonly string[]).includes(texto) ? (texto as Permiso) : null
}
```

- [ ] **Step 4: Corré el test y verificá que pasa**

Corré: `npx vitest run test/permisos-catalogo.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permisos/catalogo.ts test/permisos-catalogo.test.ts
git commit -m "feat(permisos): el catálogo de seis permisos, atado al schema"
```

---

### Task 3: Leer, otorgar y revocar

**Files:**
- Create: `lib/permisos/errores.ts`
- Create: `lib/permisos/consultar.ts`
- Create: `lib/permisos/administrar.ts`
- Modify: `test/permisos.test.ts`

**Interfaces:**
- Consumes: `Permiso`, `CLAVES_DE_PERMISO` de `lib/permisos/catalogo.ts`; `prismaParaTenant` de `lib/tenant/prisma.ts`.
- Produces:
  - `permisosDe(tenantId: string, usuarioId: string): Promise<Set<Permiso>>`
  - `otorgar(args: { tenantId: string; usuarioId: string; permiso: Permiso }): Promise<void>`
  - `revocar(args: { tenantId: string; usuarioId: string; permiso: Permiso }): Promise<void>`
  - `class ErrorDePermiso extends Error` con `codigo: 'USUARIO_INEXISTENTE' | 'ES_DUENO'`

- [ ] **Step 1: Escribí los tests que fallan**

Agregá al final de `test/permisos.test.ts`. Ojo con el import dinámico: todo lo que arrastre `lib/db.ts` construye su Pool al importarse leyendo `DATABASE_URL`, que no está seteada globalmente — es el mismo patrón de `test/categorias.test.ts:9`.

```ts
let permisosDe: typeof import('@/lib/permisos/consultar').permisosDe
let otorgar: typeof import('@/lib/permisos/administrar').otorgar
let revocar: typeof import('@/lib/permisos/administrar').revocar
let ErrorDePermiso: typeof import('@/lib/permisos/errores').ErrorDePermiso

describe('otorgar, revocar y leer', () => {
  let duenio: string
  let nuevo: string

  beforeAll(async () => {
    process.env.DATABASE_URL = urlApp()
    ;({ permisosDe } = await import('@/lib/permisos/consultar'))
    ;({ otorgar, revocar } = await import('@/lib/permisos/administrar'))
    ;({ ErrorDePermiso } = await import('@/lib/permisos/errores'))

    duenio = await crearUsuario(owner, tenantA, 'duenio@permisos-a.test', 'DUENO')
    nuevo = await crearUsuario(owner, tenantA, 'nuevo@permisos-a.test', 'EMPLEADO')
  })

  it('un empleado nuevo no tiene ninguno', async () => {
    expect([...(await permisosDe(tenantA, nuevo))]).toEqual([])
  })

  it('otorgar deja el permiso y revocar lo saca', async () => {
    await otorgar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'COSTOS' })
    expect(await permisosDe(tenantA, nuevo)).toEqual(new Set(['COSTOS']))

    await revocar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'COSTOS' })
    expect([...(await permisosDe(tenantA, nuevo))]).toEqual([])
  })

  // Los dos son idempotentes porque la pantalla los dispara desde un switch, y
  // dos clicks rápidos mandan la misma orden dos veces. Otorgar dos veces
  // chocaría contra la clave primaria; revocar algo que no está borraría cero
  // filas y Prisma tiraría P2025.
  it('otorgar dos veces no falla', async () => {
    await otorgar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'CATEGORIAS' })
    await otorgar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'CATEGORIAS' })
    expect(await permisosDe(tenantA, nuevo)).toEqual(new Set(['CATEGORIAS']))
  })

  it('revocar algo que no está no falla', async () => {
    await revocar({ tenantId: tenantA, usuarioId: nuevo, permiso: 'VENTAS_ANULAR' })
    expect(await permisosDe(tenantA, nuevo)).toEqual(new Set(['CATEGORIAS']))
  })

  // Un dueño puede todo por construcción; darle una fila sería dejar dato
  // muerto que además miente si algún día alguien lo lee sin la guarda.
  it('no deja otorgarle a un dueño', async () => {
    await expect(
      otorgar({ tenantId: tenantA, usuarioId: duenio, permiso: 'COSTOS' }),
    ).rejects.toThrow(ErrorDePermiso)
  })

  it('no deja otorgarle a alguien de otro tenant', async () => {
    await expect(
      otorgar({ tenantId: tenantA, usuarioId: empleadoB, permiso: 'COSTOS' }),
    ).rejects.toThrow(ErrorDePermiso)
  })
})
```

- [ ] **Step 2: Corré los tests y verificá que fallan**

Corré: `npx vitest run test/permisos.test.ts`
Esperado: FAIL con `Cannot find module '@/lib/permisos/consultar'`.

- [ ] **Step 3: Escribí los tres módulos**

`lib/permisos/errores.ts`:

```ts
export type CodigoDePermiso = 'USUARIO_INEXISTENTE' | 'ES_DUENO'

/** Mismo molde que ErrorDeInventario: código para el llamador, mensaje para la
 *  persona. Sólo estos dos salen a pantalla; cualquier otra cosa es un bug y
 *  tiene que verse como tal. */
export class ErrorDePermiso extends Error {
  constructor(
    readonly codigo: CodigoDePermiso,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDePermiso'
  }
}
```

`lib/permisos/consultar.ts`:

```ts
import { cache } from 'react'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import type { Permiso } from './catalogo'

/**
 * Los permisos de una persona, como Set.
 *
 * **Memoizada por request con `cache()` de React, y no cargada dentro de
 * `sesionActual()`.** Meterla en la sesión haría que toda pantalla pague esta
 * query, y `sesionActual()` corre en cada layout y en cada página; la mayoría
 * no pregunta nada. Con `cache()` la consulta ocurre a lo sumo una vez por
 * request, y sólo si alguien pregunta.
 *
 * **Nunca se llama para un DUENO**: la guarda corta antes. Ver `guarda.ts`.
 */
export const permisosDe = cache(
  async (tenantId: string, usuarioId: string): Promise<Set<Permiso>> => {
    const filas = await prismaParaTenant(tenantId).usuarioPermiso.findMany({
      where: { usuarioId },
      select: { permiso: true },
    })
    return new Set(filas.map((f) => f.permiso as Permiso))
  },
)
```

`lib/permisos/administrar.ts`:

```ts
import { prismaParaTenant } from '@/lib/tenant/prisma'
import type { Permiso } from './catalogo'
import { ErrorDePermiso } from './errores'

type Args = { tenantId: string; usuarioId: string; permiso: Permiso }

/**
 * Comprueba que el destinatario exista, sea de ESTE tenant y sea empleado.
 *
 * Lo de "este tenant" no lo garantiza el `where`: lo garantiza RLS, porque
 * `prismaParaTenant` fija la GUC y la policy filtra antes. El `findUnique` de
 * un usuario ajeno devuelve null, y por eso el mismo chequeo cubre los dos
 * casos.
 */
async function empleadoDelTenant({ tenantId, usuarioId }: Omit<Args, 'permiso'>) {
  const usuario = await prismaParaTenant(tenantId).user.findUnique({
    where: { id: usuarioId },
    select: { rol: true },
  })
  if (!usuario) {
    throw new ErrorDePermiso('USUARIO_INEXISTENTE', 'Esa persona no está en este local.')
  }
  if (usuario.rol === 'DUENO') {
    throw new ErrorDePermiso('ES_DUENO', 'Un dueño ya puede hacer todo; no hay nada que ajustarle.')
  }
}

/**
 * Otorga un permiso. **Idempotente**: la pantalla lo dispara desde un switch, y
 * dos clicks rápidos mandan la misma orden dos veces — sin el `skipDuplicates`
 * el segundo chocaría contra la clave primaria y la persona vería un error por
 * haber conseguido justamente lo que pidió.
 *
 * `tenantId` explícito en el `data`: `MODELOS_CON_TENANT` (lib/tenant/prisma.ts)
 * no incluye este modelo, así que la extensión no lo autocompleta.
 */
export async function otorgar({ tenantId, usuarioId, permiso }: Args): Promise<void> {
  await empleadoDelTenant({ tenantId, usuarioId })
  await prismaParaTenant(tenantId).usuarioPermiso.createMany({
    data: [{ tenantId, usuarioId, permiso }],
    skipDuplicates: true,
  })
}

/**
 * Revoca un permiso. **Idempotente** por el mismo motivo: `deleteMany` borra
 * cero filas sin quejarse, mientras que `delete` tiraría P2025 al revocar algo
 * que no estaba.
 */
export async function revocar({ tenantId, usuarioId, permiso }: Args): Promise<void> {
  await empleadoDelTenant({ tenantId, usuarioId })
  await prismaParaTenant(tenantId).usuarioPermiso.deleteMany({
    where: { usuarioId, permiso },
  })
}
```

- [ ] **Step 4: Corré los tests y verificá que pasan**

Corré: `npx vitest run test/permisos.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permisos test/permisos.test.ts
git commit -m "feat(permisos): leer, otorgar y revocar, los dos idempotentes"
```

---

### Task 4: La guarda

**Files:**
- Create: `lib/permisos/guarda.ts`
- Test: `test/permisos-guarda.test.ts`

**Interfaces:**
- Consumes: `Sesion`, `exigirSesion` de `lib/auth/sesion.ts`; `permisosDe`; `Permiso`.
- Produces:
  - `puedeConSesion(sesion: Sesion, permiso: Permiso): Promise<boolean>` — la única que se puede testear sin request.
  - `puede(permiso: Permiso): Promise<boolean>` — para pintar la UI en un Server Component.
  - `exigirPermiso(permiso: Permiso): Promise<Sesion>` — 403 si no.

- [ ] **Step 1: Escribí el test que falla**

Creá `test/permisos-guarda.test.ts`. Se testea `puedeConSesion`, que recibe la sesión armada: `puede` y `exigirPermiso` la resuelven del request y no se pueden invocar fuera de uno — de esas dos, lo que hay que fijar es el contrato en el fuente, igual que hace `acciones-categorias.test.ts`.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant, crearUsuario } from './datos'
import type { Sesion } from '@/lib/auth/sesion'

let puedeConSesion: typeof import('@/lib/permisos/guarda').puedeConSesion
let otorgar: typeof import('@/lib/permisos/administrar').otorgar

let owner: Client
let tenantId: string
let duenio: string
let empleado: string

/** Una sesión mínima: la guarda sólo mira tenant.id, usuario.id y usuario.rol. */
function sesionDe(usuarioId: string, rol: 'DUENO' | 'EMPLEADO'): Sesion {
  return {
    tenant: { id: tenantId } as Sesion['tenant'],
    subdominio: 'guarda',
    usuario: { id: usuarioId, nombre: 'x', email: 'x@guarda.test', rol },
  }
}

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ puedeConSesion } = await import('@/lib/permisos/guarda'))
  ;({ otorgar } = await import('@/lib/permisos/administrar'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, 'guarda')
  duenio = await crearUsuario(owner, tenantId, 'duenio@guarda.test', 'DUENO')
  empleado = await crearUsuario(owner, tenantId, 'empleado@guarda.test', 'EMPLEADO')
})

afterAll(async () => {
  await owner.end()
})

describe('la guarda de permisos', () => {
  it('un dueño puede todo, sin tener ninguna fila', async () => {
    for (const p of ['ARTICULOS_CREAR', 'COSTOS', 'VENTAS_ANULAR'] as const) {
      expect(await puedeConSesion(sesionDe(duenio, 'DUENO'), p)).toBe(true)
    }
  })

  it('un empleado sin la fila no puede', async () => {
    expect(await puedeConSesion(sesionDe(empleado, 'EMPLEADO'), 'ARTICULOS_CREAR')).toBe(false)
  })

  it('un empleado con la fila puede, y sólo ese permiso', async () => {
    await otorgar({ tenantId, usuarioId: empleado, permiso: 'ARTICULOS_CREAR' })
    expect(await puedeConSesion(sesionDe(empleado, 'EMPLEADO'), 'ARTICULOS_CREAR')).toBe(true)
    expect(await puedeConSesion(sesionDe(empleado, 'EMPLEADO'), 'COSTOS')).toBe(false)
  })
})

describe('el contrato de exigirPermiso y puede', () => {
  const FUENTE = readFileSync('lib/permisos/guarda.ts', 'utf8')

  // forbidden() y no redirect(): el 403 es lo que ya usa exigirDuenio, y
  // mandar a login a alguien que YA está logueado es un bucle disfrazado.
  it('exigirPermiso tira forbidden(), no redirige', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function exigirPermiso'))
    expect(cuerpo).toContain('forbidden()')
    expect(cuerpo).not.toContain('redirect(')
  })
})
```

- [ ] **Step 2: Corré el test y verificá que falla**

Corré: `npx vitest run test/permisos-guarda.test.ts`
Esperado: FAIL con `Cannot find module '@/lib/permisos/guarda'`.

- [ ] **Step 3: Escribí la guarda**

Creá `lib/permisos/guarda.ts`:

```ts
import { forbidden } from 'next/navigation'
import { exigirSesion, type Sesion } from '@/lib/auth/sesion'
import { permisosDe } from './consultar'
import type { Permiso } from './catalogo'

/**
 * Si esta sesión puede o no.
 *
 * **Un DUENO da verdadero sin tocar la tabla**, y no es un atajo de
 * performance: es lo que garantiza que un dueño no pueda quedarse afuera de su
 * propio local, y lo que hace que dar de alta un tenant no tenga que otorgar
 * nada. El único código que consulta `usuario_permisos` es el que evalúa a un
 * EMPLEADO.
 *
 * Recibe la sesión en vez de resolverla: es la forma testeable de las tres, y
 * la que usan las pantallas que ya tienen la sesión en la mano.
 */
export async function puedeConSesion(sesion: Sesion, permiso: Permiso): Promise<boolean> {
  if (sesion.usuario.rol === 'DUENO') return true
  return (await permisosDe(sesion.tenant.id, sesion.usuario.id)).has(permiso)
}

/** Para pintar: devuelve booleano y no corta el render. */
export async function puede(permiso: Permiso): Promise<boolean> {
  return puedeConSesion(await exigirSesion(), permiso)
}

/**
 * La sesión de alguien que puede, o 403.
 *
 * Reemplaza a `exigirDuenio()` en las once guardas delegables. `exigirDuenio()`
 * sigue existiendo y sigue guardando `/usuarios`: un permiso que habilita a
 * repartir permisos es una escalada de privilegios con pasos de más.
 */
export async function exigirPermiso(permiso: Permiso): Promise<Sesion> {
  const sesion = await exigirSesion()
  if (!(await puedeConSesion(sesion, permiso))) forbidden()
  return sesion
}
```

- [ ] **Step 4: Corré el test y verificá que pasa**

Corré: `npx vitest run test/permisos-guarda.test.ts`
Esperado: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/permisos/guarda.ts test/permisos-guarda.test.ts
git commit -m "feat(permisos): exigirPermiso, con el dueño cortando antes de la tabla"
```

---

### Task 5: Convertir el ABM de artículos y el de categorías

**Files:**
- Modify: `app/(app)/inventario/acciones.ts:35-38` (el helper `comoDuenio`) y sus nueve usos
- Modify: `app/(app)/inventario/nuevo/page.tsx:26`
- Modify: `app/(app)/inventario/page.tsx:331,351,401`
- Modify: `app/(app)/inventario/[id]/page.tsx:150`
- Test: `app/(app)/inventario/acciones.test.ts`, `app/(app)/inventario/acciones-categorias.test.ts`

**Interfaces:**
- Consumes: `exigirPermiso`, `puede` de `lib/permisos/guarda.ts`.
- Produces: `comoPuede(permiso, fn)` en `acciones.ts`, que reemplaza a `comoDuenio` con la misma firma de callback `(tenantId, usuarioId)`.

- [ ] **Step 1: Escribí los tests que fallan**

En `app/(app)/inventario/acciones-categorias.test.ts`, reemplazá el caso `'las cuatro exigen dueño, no sólo sesión'` por:

```ts
  /**
   * El ABM del árbol pasa a ser delegable: un dueño puede dárselo a un
   * empleado. Que el panel no le dibuje los controles no alcanza — un server
   * action es un endpoint y se puede llamar sin pasar por la pantalla.
   */
  it('las cuatro exigen el permiso CATEGORIAS, no sólo sesión', () => {
    for (const accion of ACCIONES) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no pide CATEGORIAS`).toContain("comoPuede('CATEGORIAS'")
      expect(hastaLaSiguiente, `${accion} usa conSesion pelado`).not.toContain('conSesion(')
    }
  })
```

Y agregá a `app/(app)/inventario/acciones.test.ts`:

```ts
describe('los permisos del ABM de artículos', () => {
  const CASOS = [
    ['altaArticulo', 'ARTICULOS_CREAR'],
    ['guardarArticulo', 'ARTICULOS_EDITAR'],
    ['bajaArticulo', 'ARTICULOS_EDITAR'],
    ['reactivarArticuloAccion', 'ARTICULOS_EDITAR'],
  ] as const

  it('cada acción pide su permiso', () => {
    for (const [accion, permiso] of CASOS) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no pide ${permiso}`).toContain(`comoPuede('${permiso}'`)
    }
  })

  // Crear y editar son permisos distintos a propósito: cargar un producto nuevo
  // y cambiarle el precio a uno que se viene vendiendo hace meses no tienen el
  // mismo riesgo.
  it('crear y editar no son el mismo permiso', () => {
    const alta = FUENTE.slice(FUENTE.indexOf('export async function altaArticulo'))
    expect(alta).not.toContain("comoPuede('ARTICULOS_EDITAR'")
  })

  // Ingresar mercadería y corregir por conteo siguen siendo de cualquiera: es
  // operación del día, la hace quien está atendiendo.
  it('ingresar y corregir siguen siendo de cualquiera con sesión', () => {
    for (const accion of ['ingresarMercaderia', 'corregirPorConteo']) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} dejó de ser de cualquiera`).toContain('conSesion(')
    }
  })
})
```

Si `acciones.test.ts` todavía no define `FUENTE`, agregá arriba del archivo:

```ts
import { readFileSync } from 'node:fs'
const FUENTE = readFileSync(new URL('./acciones.ts', import.meta.url), 'utf8')
```

- [ ] **Step 2: Corré los tests y verificá que fallan**

Corré: `npx vitest run "app/(app)/inventario/acciones.test.ts" "app/(app)/inventario/acciones-categorias.test.ts"`
Esperado: FAIL — las acciones todavía dicen `comoDuenio`.

- [ ] **Step 3: Reemplazá el helper en `acciones.ts`**

Borrá `comoDuenio` (líneas 34-38) y poné en su lugar:

```ts
/**
 * Quien tenga el permiso. Reemplaza al viejo `comoDuenio`: el catálogo y el ABM
 * dejaron de ser "cosa del dueño" para pasar a ser algo que el dueño delega —
 * ver `docs/superpowers/specs/2026-08-26-permisos-por-usuario-design.md`.
 */
async function comoPuede<T>(
  permiso: Permiso,
  fn: (tenantId: string, usuarioId: string) => Promise<T>,
) {
  const sesion = await exigirPermiso(permiso)
  return fn(sesion.tenant.id, sesion.usuario.id)
}
```

Cambiá el import de la línea 4 por:

```ts
import { exigirSesion } from '@/lib/auth/sesion'
import { exigirPermiso } from '@/lib/permisos/guarda'
import type { Permiso } from '@/lib/permisos/catalogo'
```

Y reemplazá los nueve usos: `comoDuenio(` pasa a `comoPuede('ARTICULOS_CREAR', ` en `altaArticulo`; a `comoPuede('ARTICULOS_EDITAR', ` en `guardarArticulo`, `bajaArticulo` y `reactivarArticuloAccion`; y a `comoPuede('CATEGORIAS', ` en las cuatro de categorías. Actualizá también el comentario de la línea 361 (`las cuatro por comoDuenio` → `las cuatro por comoPuede('CATEGORIAS')`) y el de la línea 283, que menciona `comoDuenio` al explicar por qué el CSV no lo usa.

- [ ] **Step 4: Cambiá la guarda de `/inventario/nuevo`**

En `app/(app)/inventario/nuevo/page.tsx`, línea 1 y 26:

```ts
import { exigirPermiso } from '@/lib/permisos/guarda'
// …
  const sesion = await exigirPermiso('ARTICULOS_CREAR')
```

- [ ] **Step 5: Cambiá las condicionales de render**

En `app/(app)/inventario/page.tsx`, agregá arriba del `return` (después de resolver `sesion`):

```ts
  // Dos preguntas y no `esDuenio`: el botón de alta y el ABM del árbol son
  // permisos distintos, así que un empleado puede tener uno sin el otro.
  const puedeCrear = await puedeConSesion(sesion, 'ARTICULOS_CREAR')
  const puedeCategorias = await puedeConSesion(sesion, 'CATEGORIAS')
```

Reemplazá `sesion.usuario.rol === 'DUENO'` por `puedeCrear` en las líneas 331 y 401, y `esDuenio={sesion.usuario.rol === 'DUENO'}` por `esDuenio={puedeCategorias}` en la línea 351. Renombrá esa prop de `PanelDeCategorias` de `esDuenio` a `puedeAdministrar` en `panel-categorias.tsx` y en su test, que ahora es lo que significa.

En `app/(app)/inventario/[id]/page.tsx`, línea 150, reemplazá:

```ts
  const esDuenio = sesion.usuario.rol === 'DUENO'
```

por:

```ts
  const puedeEditar = await puedeConSesion(sesion, 'ARTICULOS_EDITAR')
```

y pasá `puedeEditar` donde antes iba `esDuenio` (línea 359). En `formularios.tsx`, renombrá la prop `esDuenio` de `FichaDeArticulo` a `puedeEditar` — es lo que gobierna los botones del Topbar, el `<form>` de baja, los `Resultado` y la card "Datos".

Los imports que hacen falta en las dos páginas:

```ts
import { puedeConSesion } from '@/lib/permisos/guarda'
```

- [ ] **Step 6: Corré los tests y el typecheck**

Corré: `npx vitest run "app/(app)/inventario"` y después `npx tsc --noEmit`
Esperado: PASS y sin errores de tipos.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/inventario"
git commit -m "feat(permisos): el ABM de artículos y el de categorías pasan a permisos"
```

---

### Task 6: `COSTOS` — el tile, la celda compartida y los dos campos

**Corrección al spec, encontrada al planificar.** El spec dice que el CSV "hoy lleva `costoUnitario`" y que sin el permiso "sale sin esa columna". **No hay columna de costo**: `ENCABEZADO_CSV` es `['Fecha', 'Motivo', 'Detalle', 'Cambio', 'Queda', 'Usuario']`, y el costo viaja **adentro de "Detalle"**, que la arma `detalleDeMovimiento()` — una función pura exportada por `historial.tsx` y usada por los **dos** consumidores: la tabla de `[id]/page.tsx:306` y el CSV de `acciones.ts:344`.

Eso simplifica el trabajo: los puntos 2 y 3 del spec son **un solo cambio en una función compartida**, y arreglarla arregla la pantalla y el CSV a la vez. Son cuatro lugares, no cinco. Actualizá esa lista del spec en el Task 10.

**Files:**
- Modify: `app/(app)/inventario/historial.tsx:79-106` (`detalleDeMovimiento`)
- Modify: `app/(app)/inventario/[id]/page.tsx` (el tile "Último costo" y la llamada de la línea 306)
- Modify: `app/(app)/inventario/acciones.ts` (la llamada de la línea 344, más `ingresarMercaderia` y `altaArticulo`)
- Modify: `app/(app)/inventario/formularios.tsx` (los dos campos "Costo unitario")
- Test: `app/(app)/inventario/historial.test.tsx`, `app/(app)/inventario/acciones.test.ts`

**Interfaces:**
- Consumes: `puedeConSesion`, `puede` de `lib/permisos/guarda.ts`.
- Produces: `detalleDeMovimiento(m, mostrarCostos: boolean)` — **segundo parámetro obligatorio, sin default**. Sin default a propósito: un `= true` haría que el consumidor que se olvide de pasarlo siga mostrando el costo, que es exactamente el modo de falla que este permiso existe para evitar. `FichaDeArticulo` y `FormularioDeAlta` (`formularios.tsx`) ganan `puedeCostos: boolean`.

- [ ] **Step 1: Escribí los tests que fallan**

En `app/(app)/inventario/historial.test.tsx`:

```tsx
describe('el costo en la celda Detalle', () => {
  const INGRESO = {
    motivo: 'INGRESO',
    nota: 'Factura A-0001',
    costoUnitario: new Prisma.Decimal('7400'),
    usuario: { nombre: 'Ana' },
    venta: null,
  }

  it('con permiso, el costo va junto a la nota', () => {
    expect(detalleDeMovimiento(INGRESO, true)).toContain('7.400')
    expect(detalleDeMovimiento(INGRESO, true)).toContain('Factura A-0001')
  })

  it('sin permiso, queda la nota y desaparece el costo', () => {
    expect(detalleDeMovimiento(INGRESO, false)).toBe('Factura A-0001')
  })

  // El caso que importa de verdad: sin nota Y sin permiso, la celda no puede
  // quedar vacía. Cae al mismo fallback que ya existe para un ingreso al que
  // nadie le cargó el costo, así que no revela por omisión que hay un costo
  // escondido — se ve idéntico a un ingreso sin costo.
  it('sin nota y sin permiso, cae al fallback de siempre', () => {
    expect(detalleDeMovimiento({ ...INGRESO, nota: null }, false)).toBe('Ingreso · Ana')
  })

  // Los otros motivos no llevan costo, así que el permiso no los toca.
  it('una venta se ve igual con permiso y sin él', () => {
    const venta = {
      motivo: 'VENTA', nota: null, costoUnitario: null,
      usuario: { nombre: 'Ana' }, venta: { numero: 12 },
    }
    expect(detalleDeMovimiento(venta, false)).toBe(detalleDeMovimiento(venta, true))
  })
})
```

En `app/(app)/inventario/acciones.test.ts`:

```ts
describe('el costo detrás del permiso, en el servidor', () => {
  // Los dos campos son un <input name="costoUnitario"> que un curl puede
  // mandar aunque la pantalla no lo dibuje. Esconderlo en la UI no es la
  // defensa: la defensa es que el servidor lo ignore.
  it('el alta y el ingreso consultan el permiso antes de leer el costo', () => {
    for (const accion of ['altaArticulo', 'ingresarMercaderia']) {
      const cuerpo = FUENTE.slice(FUENTE.indexOf(`export async function ${accion}`))
      const hastaLaSiguiente = cuerpo.slice(0, cuerpo.indexOf('\nexport async function', 1) + 1 || undefined)
      expect(hastaLaSiguiente, `${accion} no consulta COSTOS`).toContain("puede('COSTOS')")
    }
  })

  // El CSV es el mismo dato que la tabla, en otro formato: si la pantalla
  // esconde el costo y el CSV lo lleva, el permiso no sirve de nada.
  it('el CSV pasa el permiso a detalleDeMovimiento', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function exportarHistorialCsv'))
    expect(cuerpo).toContain("puede('COSTOS')")
    expect(cuerpo).toContain('detalleDeMovimiento(m, conCostos)')
  })
})
```

- [ ] **Step 2: Corré los tests y verificá que fallan**

Corré: `npx vitest run "app/(app)/inventario/historial.test.tsx" "app/(app)/inventario/acciones.test.ts"`
Esperado: FAIL — `detalleDeMovimiento` todavía recibe un solo argumento.

- [ ] **Step 3: Sumá el parámetro a la función compartida**

En `app/(app)/inventario/historial.tsx`, cambiá la firma y el caso `INGRESO`:

```ts
export function detalleDeMovimiento(
  m: {
    motivo: string
    nota: string | null
    costoUnitario: Prisma.Decimal | null
    usuario: { nombre: string }
    venta: { numero: number } | null
  },
  /**
   * Si esta persona puede ver costos (permiso `COSTOS`).
   *
   * **Sin valor por defecto a propósito.** Un `= true` dejaría que el
   * consumidor que se olvide de pasarlo siga mostrando el costo, que es
   * justamente el modo de falla que el permiso existe para evitar. Obligarlo
   * hace que agregar un tercer consumidor sea un error de tipos y no una
   * filtración silenciosa.
   */
  mostrarCostos: boolean,
): string {
```

y adentro del `case 'INGRESO'`:

```ts
      const costo =
        mostrarCostos && m.costoUnitario
          ? `${formatearPrecio(m.costoUnitario.toString())} c/u`
          : null
```

El resto del `switch` no se toca: ningún otro motivo lleva costo.

- [ ] **Step 4: Actualizá los dos consumidores**

En `app/(app)/inventario/[id]/page.tsx`: calculá `const puedeCostos = await puedeConSesion(sesion, 'COSTOS')` (con `import { puedeConSesion } from '@/lib/permisos/guarda'`) y pasá `detalleDeMovimiento(m, puedeCostos)` en la línea 306.

En `app/(app)/inventario/acciones.ts`, dentro de `exportarHistorialCsv` y antes del `map` de filas:

```ts
    // El CSV es el mismo dato que la tabla en otro formato, así que respeta el
    // mismo permiso. La acción sigue detrás de `conSesion` —exportar lo que la
    // pantalla ya muestra no es una capacidad nueva— pero exporta lo que ESA
    // persona puede ver, no lo que ve un dueño.
    const conCostos = await puede('COSTOS')
```

y cambiá la línea 344 por `detalleDeMovimiento(m, conCostos)`. `ENCABEZADO_CSV` **no se toca**: no tiene columna de costo.

- [ ] **Step 5: Blindá los dos campos en el servidor**

En `acciones.ts`, con `import { puede } from '@/lib/permisos/guarda'`, en `altaArticulo` (línea ~95) reemplazá:

```ts
        costoUnitario:
          tipo === 'PRODUCTO' ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo') : null,
```

por:

```ts
        // El costo se descarta si esta persona no puede cargarlo: el campo no
        // se le dibuja, pero el <input> viaja igual si alguien arma el POST a
        // mano. La UI esconde; esto es lo que autoriza.
        costoUnitario:
          tipo === 'PRODUCTO' && (await puede('COSTOS'))
            ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo')
            : null,
```

Y lo mismo en `ingresarMercaderia` (línea ~177):

```ts
        costoUnitario: (await puede('COSTOS'))
          ? aDecimalOpcional(texto(datos, 'costoUnitario'), 'el costo')
          : null,
```

- [ ] **Step 6: Escondé el tile y los dos campos**

En `app/(app)/inventario/[id]/page.tsx`, envolvé el tile "Último costo" (líneas ~245-252) para que **no se renderee** cuando `puedeCostos` sea `false`. No lo pongas en `'—'`: eso afirma que ningún ingreso cargó el costo, que es una afirmación distinta y falsa. Pasá `puedeCostos` a `FichaDeArticulo`.

En `formularios.tsx`, envolvé los dos bloques de "Costo unitario" (líneas ~296-299 y ~542-545) en `{puedeCostos && (…)}`, con la prop llegando de `[id]/page.tsx` y de `nuevo/page.tsx`.

- [ ] **Step 7: Corré los tests y el typecheck**

Corré: `npx vitest run "app/(app)/inventario"` y después `npx tsc --noEmit`
Esperado: PASS y sin errores. El typecheck es acá la red principal: al no tener default, el parámetro nuevo hace que cualquier consumidor sin actualizar sea un error de compilación.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/inventario"
git commit -m "feat(permisos): el costo y el margen quedan detrás de COSTOS"
```

---

### Task 7: Anular ventas y órdenes de trabajo

**Files:**
- Modify: `app/(app)/ventas/acciones.ts:4,22`
- Modify: `app/(app)/servicio-tecnico/acciones.ts:5,130`
- Modify: `app/(app)/ventas/[id]/page.tsx:29,33`
- Modify: `app/(app)/servicio-tecnico/[id]/page.tsx:373`
- Test: `app/(app)/ventas/acciones.test.ts`, `app/(app)/servicio-tecnico/acciones.test.ts` (creá el archivo si no existe, con el patrón de `acciones-categorias.test.ts`)

**Interfaces:**
- Consumes: `exigirPermiso`, `puedeConSesion`.
- Produces: nada nuevo.

- [ ] **Step 1: Escribí los tests que fallan**

En `app/(app)/ventas/acciones.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FUENTE = readFileSync(new URL('./acciones.ts', import.meta.url), 'utf8')

describe('anular una venta', () => {
  // Anular devuelve el stock y borra plata cobrada del período: sigue siendo
  // peligroso, pero ahora es el dueño quien decide si lo delega, en vez de que
  // lo decida el código.
  it('exige VENTAS_ANULAR, no el rol', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function anular'))
    expect(cuerpo).toContain("exigirPermiso('VENTAS_ANULAR')")
    expect(cuerpo).not.toContain('exigirDuenio()')
  })
})
```

En `app/(app)/servicio-tecnico/acciones.test.ts` (creá el archivo si no existe):

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const FUENTE = readFileSync(new URL('./acciones.ts', import.meta.url), 'utf8')

describe('anular una orden de trabajo', () => {
  it('exige ORDENES_ANULAR, no el rol', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function anular'))
    expect(cuerpo).toContain("exigirPermiso('ORDENES_ANULAR')")
    expect(cuerpo).not.toContain('exigirDuenio()')
  })

  // El resto de las transiciones son operación del día: recibir el equipo,
  // presupuestar, marcar listo. Ésas nunca fueron del dueño y no cambian.
  it('las demás acciones siguen siendo de cualquiera con sesión', () => {
    expect(FUENTE).toContain('exigirSesion')
  })
})
```

Las dos acciones se llaman `anular` (`ventas/acciones.ts:17` y `servicio-tecnico/acciones.ts:129`). En servicio técnico, `anularOrden` es la función de dominio que la action llama, no la action.

- [ ] **Step 2: Corré los tests y verificá que fallan**

Corré: `npx vitest run "app/(app)/ventas/acciones.test.ts" "app/(app)/servicio-tecnico/acciones.test.ts"`
Esperado: FAIL — todavía dicen `exigirDuenio()`.

- [ ] **Step 3: Cambiá las dos acciones**

En `app/(app)/ventas/acciones.ts`, línea 22: `const sesion = await exigirPermiso('VENTAS_ANULAR')`, con el import correspondiente.
En `app/(app)/servicio-tecnico/acciones.ts`, línea 130: `const sesion = await exigirPermiso('ORDENES_ANULAR')`.

- [ ] **Step 4: Cambiá las dos condicionales de render**

En `app/(app)/ventas/[id]/page.tsx`, la función de la línea 29-33 pasa a recibir el booleano ya calculado en vez del rol:

```ts
/** El botón se dibuja sólo si esta persona puede anular Y la venta no está ya
 *  anulada. La guarda real vive en `exigirPermiso` adentro de la action;
 *  esto es comodidad, para no ofrecer lo que va a fallar. */
function seOfreceAnular(puedeAnular: boolean, anuladaEn: Date | null) {
  return puedeAnular && anuladaEn === null
}
```

y el llamador pasa `await puedeConSesion(sesion, 'VENTAS_ANULAR')`.

En `app/(app)/servicio-tecnico/[id]/page.tsx`, línea 373, reemplazá `const esDuenio = sesion.usuario.rol === 'DUENO'` por `const puedeAnular = await puedeConSesion(sesion, 'ORDENES_ANULAR')` y renombrá la prop en `FichaDeOrden` (`formularios.tsx`, ver el comentario de la línea 706, que hay que actualizar: menciona `exigirDuenio` por nombre).

- [ ] **Step 5: Corré los tests y el typecheck**

Corré: `npx vitest run "app/(app)/ventas" "app/(app)/servicio-tecnico"` y después `npx tsc --noEmit`
Esperado: PASS y sin errores.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/ventas" "app/(app)/servicio-tecnico"
git commit -m "feat(permisos): anular venta y anular orden pasan a permisos"
```

---

### Task 8: El test de las dos direcciones

**Files:**
- Modify: `test/permisos-catalogo.test.ts`

**Interfaces:**
- Consumes: `CLAVES_DE_PERMISO`.
- Produces: nada — es la red que impide que el catálogo y el código se separen.

- [ ] **Step 1: Escribí los casos que fallan**

Agregá a `test/permisos-catalogo.test.ts`:

```ts
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

function fuentes(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) fuentes(completo, acumulado)
    else if (/\.tsx?$/.test(entrada) && !/\.test\.tsx?$/.test(entrada)) acumulado.push(completo)
  }
  return acumulado
}

describe('el catálogo y el código, en las dos direcciones', () => {
  // lib/permisos/ queda afuera: el catálogo se nombra a sí mismo ahí, y contarlo
  // haría que ningún permiso pudiera dar cero aunque nada lo exija. Es el mismo
  // punto ciego del grep de tokens que documenta CLAUDE.md.
  const CODIGO = [...fuentes('app'), ...fuentes('lib')]
    .filter((f) => !f.startsWith(path.join('lib', 'permisos')))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n')

  it('encuentra fuentes; si no, el test no prueba nada', () => {
    expect(CODIGO.length).toBeGreaterThan(1000)
  })

  // Un permiso que no destraba nada es un switch que miente: el dueño lo
  // prende, y no pasa nada.
  it('todo permiso del catálogo lo exige o lo consulta alguien', () => {
    for (const clave of CLAVES_DE_PERMISO) {
      expect(CODIGO, `${clave} no lo usa nadie fuera de lib/permisos`).toContain(`'${clave}'`)
    }
  })

  // Y al revés: un literal que parece un permiso y no está en el catálogo es un
  // typo que nunca va a dar verdadero.
  it('todo permiso usado en el código está en el catálogo', () => {
    const usados = [...CODIGO.matchAll(/(?:exigirPermiso|puedeConSesion\([^,]+,|puede|comoPuede)\(\s*'([A-Z_]+)'/g)]
      .map((m) => m[1])
    expect(usados.length, 'el regex no encontró ningún uso; está roto').toBeGreaterThan(0)
    for (const usado of new Set(usados)) {
      expect(CLAVES_DE_PERMISO, `${usado} no está en el catálogo`).toContain(usado)
    }
  })
})
```

- [ ] **Step 2: Corré el test y verificá que pasa**

Corré: `npx vitest run test/permisos-catalogo.test.ts`
Esperado: PASS. Si alguno falla, es un hallazgo real de las tareas 5-7 — arreglá la conversión que falta, no el test.

- [ ] **Step 3: Verificá que atrapa de verdad**

Comentá a mano el `exigirPermiso('ORDENES_ANULAR')` de `app/(app)/servicio-tecnico/acciones.ts`, corré el test, confirmá que **falla**, y revertí el cambio. Un test de cobertura que nunca se vio fallar no es evidencia de nada.

- [ ] **Step 4: Commit**

```bash
git add test/permisos-catalogo.test.ts
git commit -m "test(permisos): el catálogo y el código atados en las dos direcciones"
```

---

### Task 9: La pantalla

**Files:**
- Create: `components/ui/switch.tsx`, `components/ui/dialog.tsx` (por shadcn, sin tocar a mano)
- Create: `app/(app)/usuarios/permisos-dialogo.tsx`
- Test: `app/(app)/usuarios/permisos-dialogo.test.tsx`
- Modify: `app/(app)/usuarios/acciones.ts`, `app/(app)/usuarios/page.tsx`, `app/(app)/usuarios/formularios.tsx`
- Test: `app/(app)/usuarios/acciones.test.ts`

**Interfaces:**
- Consumes: `PERMISOS` del catálogo; `otorgar` / `revocar` de `lib/permisos/administrar.ts`; `EstadoUsuarios` de `acciones.ts`.
- Produces:
  - Server action `cambiarPermiso(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios>`, que lee `usuarioId`, `permiso` y `otorgar` (`'1'` o `'0'`) del FormData.
  - `<PermisosDeUsuario usuario={UsuarioDeFila} permisos={Permiso[]} />`.
  - `page.tsx` pasa a traer los permisos de todos los empleados en una consulta.

- [ ] **Step 1: Sumá los dos componentes de shadcn**

Corré: `npx shadcn@latest add switch dialog`
Esperado: crea `components/ui/switch.tsx` y `components/ui/dialog.tsx`, importando del paquete paraguas `radix-ui`, que ya está instalado (`package.json`, `"radix-ui": "^1.6.7"`). **No los edites**: son código de registry, igual que el resto de `components/ui/`.

- [ ] **Step 2: Escribí el test que falla**

Creá `app/(app)/usuarios/permisos-dialogo.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PermisosDeUsuario } from './permisos-dialogo'
import { PERMISOS } from '@/lib/permisos/catalogo'

const EMPLEADA = {
  id: 'u1', nombre: 'Ana', email: 'ana@local.test',
  rol: 'EMPLEADO' as const, desactivadoEn: null,
}

describe('el diálogo de permisos', () => {
  // Los seis salen del catálogo y no de una lista escrita a mano al lado: si
  // se escribieran dos veces, agregar un permiso dejaría la pantalla vieja.
  it('ofrece los seis permisos del catálogo, con su ayuda', () => {
    const html = renderToStaticMarkup(<PermisosDeUsuario usuario={EMPLEADA} permisos={[]} />)
    for (const p of PERMISOS) {
      expect(html, `falta ${p.clave}`).toContain(p.nombre)
      expect(html, `falta la ayuda de ${p.clave}`).toContain(p.ayuda)
    }
  })

  it('muestra el conteo de los otorgados', () => {
    const html = renderToStaticMarkup(
      <PermisosDeUsuario usuario={EMPLEADA} permisos={['COSTOS', 'CATEGORIAS']} />,
    )
    expect(html).toContain('2 de 6 permisos')
  })

  it('sin ninguno, lo dice en vez de mostrar un cero', () => {
    const html = renderToStaticMarkup(<PermisosDeUsuario usuario={EMPLEADA} permisos={[]} />)
    expect(html).toContain('Sin permisos')
  })
})
```

Y en `app/(app)/usuarios/acciones.test.ts`, el caso que fija que la pantalla NO es delegable — es la regla que más fácil se "completa" sin querer en un ciclo futuro:

```ts
describe('/usuarios no es delegable', () => {
  const FUENTE = readFileSync(new URL('./acciones.ts', import.meta.url), 'utf8')

  // Un permiso que habilita a repartir permisos es una escalada de privilegios
  // con pasos de más: el empleado que puede editar usuarios se otorga los otros
  // cinco y listo. Las cinco guardas de esta pantalla se quedan en DUENO, y que
  // no estén en el catálogo no es un olvido.
  it('las acciones de usuarios siguen exigiendo dueño', () => {
    expect(FUENTE).toContain('exigirDuenio()')
    expect(FUENTE, 'alguna acción de /usuarios pasó a permisos').not.toContain('exigirPermiso(')
  })

  it('cambiarPermiso también, aunque sea la acción nueva', () => {
    const cuerpo = FUENTE.slice(FUENTE.indexOf('export async function cambiarPermiso'))
    expect(cuerpo).toContain('comoDuenio(')
  })
})
```

- [ ] **Step 3: Corré el test y verificá que falla**

Corré: `npx vitest run "app/(app)/usuarios/permisos-dialogo.test.tsx"`
Esperado: FAIL con `Cannot find module './permisos-dialogo'`.

- [ ] **Step 4: Escribí la acción**

En `app/(app)/usuarios/acciones.ts`:

```ts
import { comoPermiso } from '@/lib/permisos/catalogo'
import { otorgar, revocar } from '@/lib/permisos/administrar'
import { ErrorDePermiso } from '@/lib/permisos/errores'

/**
 * Prende o apaga un permiso de un empleado.
 *
 * **Sigue detrás de `comoDuenio`, y eso no es delegable**: un permiso que
 * habilita a repartir permisos es una escalada de privilegios con pasos de
 * más. `/usuarios` entera se queda en DUENO.
 */
export async function cambiarPermiso(
  _e: EstadoUsuarios,
  datos: FormData,
): Promise<EstadoUsuarios> {
  try {
    const usuarioId = String(datos.get('usuarioId') ?? '').trim()
    // El permiso llega por FormData: es texto de afuera hasta que el catálogo
    // lo reconoce. Sin esto, un valor inventado llegaría hasta el enum de
    // Postgres y volvería como 500 en vez de como cartel.
    const permiso = comoPermiso(String(datos.get('permiso') ?? ''))
    if (!permiso) {
      return { error: 'Ese permiso no existe.', aviso: null, claveGenerada: null }
    }
    const prender = datos.get('otorgar') === '1'

    await comoDuenio((tenantId) =>
      prender
        ? otorgar({ tenantId, usuarioId, permiso })
        : revocar({ tenantId, usuarioId, permiso }),
    )
    revalidatePath('/usuarios')
    return {
      error: null,
      aviso: prender ? 'Permiso otorgado.' : 'Permiso revocado.',
      claveGenerada: null,
    }
  } catch (e) {
    if (e instanceof ErrorDePermiso) {
      return { error: e.message, aviso: null, claveGenerada: null }
    }
    return traducir(e)
  }
}
```

- [ ] **Step 5: Escribí el diálogo**

Creá `app/(app)/usuarios/permisos-dialogo.tsx`, un Client Component:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { PERMISOS, type Permiso } from '@/lib/permisos/catalogo'
import { cambiarPermiso } from './acciones'
import type { UsuarioDeFila } from './fila-acciones'

/**
 * Los seis switches de un empleado.
 *
 * **Sin botón "Guardar": cada switch guarda solo**, igual que el ABM de
 * categorías. Un formulario con estado sucio para seis booleanos independientes
 * agrega la pregunta "¿guardé?" a cambio de nada.
 *
 * **El toast se lanza acá, en el handler, con el resultado ya en la mano**, y
 * NO en un `useEffect` sobre `useActionState`. Es la lección que dejó el ABM de
 * categorías: un efecto está atado al ciclo de vida del componente, y este
 * diálogo se re-renderiza con cada `revalidatePath` — el aviso quedaba colgado
 * de un componente que dejaba de existir. Lanzado acá vive en el store de
 * sonner, fuera de React. La clave es estable por usuario y por permiso para
 * que dos clicks no apilen dos copias del mismo aviso.
 */
export function PermisosDeUsuario({
  usuario,
  permisos,
}: {
  usuario: UsuarioDeFila
  permisos: Permiso[]
}) {
  // Estado local además del server: el switch tiene que moverse apenas se lo
  // toca, no cuando vuelva el revalidate. El servidor sigue siendo la verdad —
  // si la acción falla, se revierte.
  const [otorgados, setOtorgados] = useState<Set<Permiso>>(new Set(permisos))
  const [enCurso, empezar] = useTransition()

  function alternar(permiso: Permiso, prender: boolean) {
    const antes = new Set(otorgados)
    const despues = new Set(otorgados)
    if (prender) despues.add(permiso)
    else despues.delete(permiso)
    setOtorgados(despues)

    empezar(async () => {
      const datos = new FormData()
      datos.set('usuarioId', usuario.id)
      datos.set('permiso', permiso)
      datos.set('otorgar', prender ? '1' : '0')
      const r = await cambiarPermiso(
        { error: null, aviso: null, claveGenerada: null },
        datos,
      )
      if (r.error) {
        setOtorgados(antes)
        toast.error(r.error, { id: `permiso-${usuario.id}-${permiso}`, duration: Infinity })
      } else if (r.aviso) {
        toast.success(r.aviso, { id: `permiso-${usuario.id}-${permiso}` })
      }
    })
  }

  const cuenta =
    otorgados.size === 0 ? 'Sin permisos' : `${otorgados.size} de ${PERMISOS.length} permisos`

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <KeyRound aria-hidden="true" className="size-[15px]" />
          {cuenta}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Permisos de {usuario.nombre}</DialogTitle>
          <DialogDescription>
            Lo que no esté prendido acá, {usuario.nombre} no lo puede hacer.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {PERMISOS.map((p) => (
            <div key={p.clave} className="flex items-start gap-3">
              <Switch
                id={`p-${usuario.id}-${p.clave}`}
                checked={otorgados.has(p.clave)}
                disabled={enCurso}
                onCheckedChange={(v) => alternar(p.clave, v)}
              />
              <div className="flex flex-col gap-1">
                <Label htmlFor={`p-${usuario.id}-${p.clave}`}>{p.nombre}</Label>
                <p className="text-sm text-muted-foreground">{p.ayuda}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 6: Traé los permisos en la página y montá el diálogo**

En `app/(app)/usuarios/page.tsx`, después del `findMany` de usuarios:

```ts
  // Una sola consulta para todas las filas, no una por empleado: la tabla ya
  // trajo la lista entera, y N consultas más sobre un pool de 5 conexiones es
  // justo lo que no hay que hacer en una pantalla de listado.
  const filas = await prismaParaTenant(sesion.tenant.id).usuarioPermiso.findMany({
    select: { usuarioId: true, permiso: true },
  })
  // `import type { Permiso } from '@/lib/permisos/catalogo'` arriba del archivo.
  const permisosPorUsuario = new Map<string, Permiso[]>()
  for (const f of filas) {
    permisosPorUsuario.set(f.usuarioId, [
      ...(permisosPorUsuario.get(f.usuarioId) ?? []),
      f.permiso as Permiso,
    ])
  }
```

Pasalo a `CuerpoUsuarios` como `permisosPorUsuario={Object.fromEntries(permisosPorUsuario)}` — **un objeto plano y no un `Map`**: la frontera servidor→cliente serializa con el protocolo de RSC, y aunque hoy soporte `Map`, un objeto es lo que el resto del repo ya pasa.

En `formularios.tsx`, dentro de `CardEquipo`, agregá la celda antes de ACCIONES:

```tsx
              <TableCell className="px-[7px] py-[11px]">
                {/* Un dueño no lleva switches: puede todo por construcción, y
                    un diálogo con los seis prendidos y trabados sería ruido. */}
                {u.rol === 'EMPLEADO' && (
                  <PermisosDeUsuario usuario={u} permisos={permisosPorUsuario[u.id] ?? []} />
                )}
              </TableCell>
```

Agregá también el `<TableHead>` "Permisos" en el `TableHeader`.

- [ ] **Step 7: Corré los tests y el typecheck**

Corré: `npx vitest run "app/(app)/usuarios"` y después `npx tsc --noEmit`
Esperado: PASS y sin errores.

- [ ] **Step 8: Corré el gate completo**

Corré: `npm test && npm run lint && npx tsc --noEmit && npm run build`
Esperado: todo verde. Prestá atención a `test/servidor-llama-a-cliente.test.ts` y `test/limite-cliente-servidor.test.ts`: `page.tsx` es un Server Component y `permisos-dialogo.tsx` lleva `'use client'`, así que la página **no puede invocar** nada exportado de ahí ni pasarle una función como prop — los dos bugs que dejó el ciclo de categorías, con el build en verde y la pantalla en 500.

- [ ] **Step 9: Verificá la pantalla a mano**

Levantá `arandano-dev`, entrá **por el subdominio del tenant canario** (no por la IP pelada: `http://100.64.81.63:3000` responde 404 desde el cutover por `Host`, y es correcto que lo haga), abrí `/usuarios`, prendé "Cargar artículos" a un empleado y confirmá: que el toast aparezca y se vaya solo, que el conteo de la fila cambie, y que ese empleado ahora vea el botón "Artículo nuevo" en `/inventario`. Apagalo y confirmá que desaparece.

- [ ] **Step 10: Commit**

```bash
git add components/ui/switch.tsx components/ui/dialog.tsx "app/(app)/usuarios"
git commit -m "feat(permisos): los switches por empleado en /usuarios"
```

---

### Task 10: La documentación

**Files:**
- Modify: `docs/pantallas.md` (secciones `/usuarios`, `/inventario`, `/inventario/nuevo`, `/inventario/[id]`, `/ventas/[id]`, `/servicio-tecnico/[id]`)
- Modify: `docs/correcciones-pendientes-del-pen.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada.
- Produces: nada.

- [ ] **Step 1: Corregí el spec**

En `docs/superpowers/specs/2026-08-26-permisos-por-usuario-design.md`, sección *`COSTOS`, que toca cinco lugares y no uno*: son **cuatro**, y el punto 3 estaba mal. El CSV no tiene columna de costo — `ENCABEZADO_CSV` es `['Fecha', 'Motivo', 'Detalle', 'Cambio', 'Queda', 'Usuario']` — y el costo viaja adentro de "Detalle", que arma la función compartida `detalleDeMovimiento()`. Fusioná los puntos 2 y 3 en uno solo que diga eso. Corregir el spec y no sólo el plan importa: el spec es lo que alguien va a releer en seis meses.

- [ ] **Step 2: Actualizá `docs/pantallas.md`**

`test/pantallas.test.ts` ata el documento a `app/**/page.tsx` en las dos direcciones, pero **no puede verificar que el contenido siga siendo cierto** — por eso la regla del repo es que la sección va en el mismo commit que el cambio de la pantalla. Cada sección tocada tiene que decir qué permiso gobierna qué control, y `/usuarios` suma el diálogo con su columna.

- [ ] **Step 3: Anotá la deuda con la maqueta**

En `docs/correcciones-pendientes-del-pen.md`, una entrada nueva: `design/arandano.pen` no dibuja el diálogo de permisos ni la columna de la tabla de `/usuarios`; se derivó de lo que la maqueta sí fija para esa pantalla. Mismo precedente que el panel de categorías.

- [ ] **Step 4: Actualizá `CLAUDE.md`**

Una entrada nueva en *Próximos pasos técnicos*, con estas seis cosas y nada más:

1. Que sale del feedback textual de un dueño, y que el pedido del dueño del producto lo convirtió de regla del producto en decisión de cada local.
2. Que el estado previo era **el inverso del pedido en las dos mitades**: el alta de artículos cerrada al empleado, el costo abierto.
3. Las cuatro decisiones que valen para releer: la fila **es** el permiso y su ausencia la negación (por eso no hubo backfill); el dueño corta antes de la tabla (por eso no puede quedarse afuera); `COSTOS` es uno y no dos, pero `ARTICULOS_CREAR`/`ARTICULOS_EDITAR` sí son dos; y `/usuarios` no es delegable, con la regla general — **se delega lo que opera el negocio, no lo que reparte poder**.
4. Que este ciclo **le sacó al empleado** ver y cargar costos, que es una regresión deliberada y gratis sólo porque todavía no hay tenants reales.
5. Que un ingreso hecho por un empleado sin `COSTOS` queda **sin costo para siempre** (`MovimientoStock.costoUnitario` es una puerta de una sola dirección), y que el disparador para construir "el dueño completa el costo después" es que a un dueño le moleste.
6. El disparador de los roles personalizados: que prender seis switches de a uno moleste en un local con muchos empleados — no una cantidad de permisos.

**No toques** la sección *Decisiones abiertas del modelo de datos*: este ciclo no cierra ninguna de las que quedan (stock por sucursal, el origen de `MovimientoStock`, `Venta.numero` como número fiscal).

- [ ] **Step 5: Corré el gate y commiteá**

Corré: `npm test`
Esperado: PASS, incluido `test/pantallas.test.ts`.

```bash
git add docs CLAUDE.md
git commit -m "docs(permisos): pantallas, deuda con la maqueta y las decisiones del ciclo"
```

---

## Verificación final del ciclo

Antes de dar el trabajo por terminado:

- [ ] `npm test && npm run lint && npx tsc --noEmit && npm run build` en verde.
- [ ] La verificación manual del Task 9 Step 9, hecha de verdad y no asumida.
- [ ] Un empleado **sin ningún permiso** puede todavía hacer su trabajo del día: vender, ingresar mercadería, corregir por conteo, abrir y cerrar la caja, recibir un equipo. Si alguno de esos se rompió, la conversión se pasó de largo.
- [ ] `git diff main --stat` no toca nada fuera de lo que lista este plan.
