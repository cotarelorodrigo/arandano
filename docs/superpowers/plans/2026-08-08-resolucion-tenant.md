# Resolución de tenant por subdominio — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un request a `flor.arandano.app` resuelva al tenant correcto sin abrirle a la aplicación la lista de clientes, que exista un comando versionado para crear tenants, y que el healthcheck verifique que RLS está filtrando de verdad.

**Architecture:** Una función `SECURITY DEFINER` en Postgres es la única puerta que permite leer `tenants` sin tener el `tenant_id` en el GUC — devuelve un tenant por subdominio exacto y no permite enumerar. Del lado de Node, un helper de servidor lee el header `Host`, extrae el subdominio contra `DOMINIO_BASE` y llama a esa función; no hay `middleware.ts` ni header intermediario. El healthcheck usa la misma puerta para resolver un tenant canario y después comprueba las dos mitades del aislamiento: con el GUC correcto ve 1 fila, con un GUC inventado ve 0.

**Tech Stack:** TypeScript, Next.js 16.2.12 (App Router), Prisma 7 con driver adapter sobre `pg`, PostgreSQL 17 con RLS, vitest, bash para el gate de deploy, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-08-08-resolucion-tenant-design.md`

## Global Constraints

- **Ningún camino de resolución exclusivo de dev.** Sin header `X-Tenant`, sin tenant por defecto, sin bypass. El mecanismo es idéntico en los tres entornos; lo único que cambia por entorno es `DOMINIO_BASE`.
- **`DOMINIO_BASE` por entorno**, siempre inline en el compose del stack (versionado), nunca en un `.env` sin versionar: `arandano.app` en prod, `dev.arandano.app` en dev, `stage.arandano.app` en stage y ensayo.
- **`TENANT_CANARIO_SUBDOMINIO` vale `canario`** en los cuatro stacks.
- **Node 24 corre `.ts` y `.mts` directamente**, sin build ni `tsx`. Verificado en `node v24.19.0` local y en `node:24-alpine` (`v24.18.1`), que es la imagen del `Dockerfile`.
- **NO agregar `"type": "module"` a `package.json`.** El `server.js` que Next emite en `.next/standalone` es CommonJS y la imagen de runtime lo corre con `node server.js`; cambiar el tipo de módulo del paquete es un riesgo sobre el artefacto que se promueve a producción, sin beneficio para este ciclo. El ruido de `MODULE_TYPELESS_PACKAGE_JSON` se apaga con `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`, verificado en las dos versiones de Node.
- **Los scripts operativos se conectan con `MIGRATE_DATABASE_URL`** (el rol `arandano_owner`), igual que `prisma.config.ts`. La aplicación nunca.
- **Toda migración es aditiva.** Ninguna columna se borra ni se renombra.
- **Comentarios en castellano**, con el mismo registro que el resto del repo: explican *por qué*, no *qué*. No afirmar propiedades que el código no tiene.
- **Cada tarea deja el gate verde.** `npm test` y `npx tsc --noEmit` pasan al final de cada tarea.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/tenant/subdominio.ts` | Puro, sin I/O: parseo de `Host` a subdominio, lista de reservados, validación de formato |
| `lib/tenant/resolver.ts` | La única llamada a `resolver_tenant()`. Corre fuera de la frontera de tenant, a propósito |
| `lib/tenant/desde-request.ts` | Compone las dos anteriores leyendo `headers()`. Es lo que consumen las rutas |
| `prisma/migrations/<ts>_resolver_tenant/migration.sql` | La función, sus privilegios y su `search_path` |
| `scripts/crear-tenant.mts` | Alta de tenant como `arandano_owner`. Corre en el host y adentro de `arandano-migrate` |
| `lib/health/checks.ts` | Suma el check `tenant` a la lista existente |
| `app/page.tsx` | Rutea según la resolución: tenant, apex, 404 o 403 |
| `app/forbidden.tsx` | La página del 403, requerida por `forbidden()` |
| `scripts/smoke.sh` | Casos nuevos: tenant resuelve, inexistente da 404, host ajeno da 404 |
| `scripts/deploy.sh` | Crea el canario en stage entre `migrate deploy` y el arranque de la app |
| `Dockerfile` | La etapa `migrate` lleva `scripts/` y `lib/` para poder correr el alta |

---

### Task 1: El módulo puro de subdominios

Todo lo que se puede decidir sin tocar la base ni el request. Es la pieza que más casos borde tiene y la que más barato se testea.

**Files:**
- Create: `lib/tenant/subdominio.ts`
- Create: `lib/tenant/subdominio.test.ts`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `SUBDOMINIOS_RESERVADOS: readonly string[]`
  - `type HostAnalizado = { tipo: 'tenant'; subdominio: string } | { tipo: 'apex' } | { tipo: 'ajeno' }`
  - `subdominioDeHost(host: string | null | undefined, dominioBase: string): HostAnalizado`
  - `type ResultadoValidacion = { ok: true } | { ok: false; motivo: string }`
  - `validarSubdominio(subdominio: string): ResultadoValidacion`

- [ ] **Step 1: Habilitar imports con extensión `.ts`**

`scripts/crear-tenant.mts` (Task 4) importa este módulo, y Node exige la extensión explícita en imports relativos. Sin este flag, `npx tsc --noEmit` falla con `TS5097`. Es legal porque `noEmit` ya está en `true`.

En `tsconfig.json`, agregar la línea justo después de `"noEmit": true,`:

```json
    "noEmit": true,
    "allowImportingTsExtensions": true,
```

- [ ] **Step 2: Escribir el test que falla**

Crear `lib/tenant/subdominio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  subdominioDeHost,
  validarSubdominio,
  SUBDOMINIOS_RESERVADOS,
} from '@/lib/tenant/subdominio'

const BASE = 'arandano.app'

describe('subdominioDeHost', () => {
  it('extrae el subdominio de un host simple', () => {
    expect(subdominioDeHost('flor.arandano.app', BASE)).toEqual({
      tipo: 'tenant',
      subdominio: 'flor',
    })
  })

  // En dev la app escucha en :3000 y el navegador manda el puerto en el Host.
  // Sin sacarlo, `dev.arandano.app:3000` nunca matchea el dominio base.
  it('ignora el puerto', () => {
    expect(subdominioDeHost('flor.dev.arandano.app:3000', 'dev.arandano.app')).toEqual({
      tipo: 'tenant',
      subdominio: 'flor',
    })
  })

  it('normaliza mayúsculas', () => {
    expect(subdominioDeHost('FLOR.Arandano.App', BASE)).toEqual({
      tipo: 'tenant',
      subdominio: 'flor',
    })
  })

  it('distingue el apex de un dominio ajeno', () => {
    expect(subdominioDeHost('arandano.app', BASE)).toEqual({ tipo: 'apex' })
    expect(subdominioDeHost('ejemplo.com', BASE)).toEqual({ tipo: 'ajeno' })
  })

  // El caso que motiva el tipo discriminado: los dos son "no hay subdominio"
  // pero piden respuestas distintas — placeholder uno, 404 el otro.
  it('un host que sólo termina parecido no es del dominio', () => {
    expect(subdominioDeHost('malarandano.app', BASE)).toEqual({ tipo: 'ajeno' })
  })

  it('exige exactamente una etiqueta delante del dominio base', () => {
    expect(subdominioDeHost('a.b.arandano.app', BASE)).toEqual({ tipo: 'ajeno' })
  })

  // La IP pelada es como se llega hoy a dev, y deja de resolver a propósito:
  // no hay camino de resolución exclusivo de dev.
  it('trata la IP pelada como ajena', () => {
    expect(subdominioDeHost('100.64.81.63:3000', BASE)).toEqual({ tipo: 'ajeno' })
  })

  it('tolera host ausente o vacío', () => {
    expect(subdominioDeHost(null, BASE)).toEqual({ tipo: 'ajeno' })
    expect(subdominioDeHost(undefined, BASE)).toEqual({ tipo: 'ajeno' })
    expect(subdominioDeHost('', BASE)).toEqual({ tipo: 'ajeno' })
  })
})

describe('validarSubdominio', () => {
  it('acepta uno válido', () => {
    expect(validarSubdominio('flor')).toEqual({ ok: true })
    expect(validarSubdominio('flor-celulares-2')).toEqual({ ok: true })
  })

  it('rechaza mayúsculas y espacios', () => {
    expect(validarSubdominio('Flor').ok).toBe(false)
    expect(validarSubdominio(' flor ').ok).toBe(false)
  })

  it('rechaza por longitud', () => {
    expect(validarSubdominio('ab').ok).toBe(false)
    expect(validarSubdominio('a'.repeat(64)).ok).toBe(false)
    expect(validarSubdominio('a'.repeat(63)).ok).toBe(true)
  })

  it('rechaza caracteres fuera de [a-z0-9-]', () => {
    expect(validarSubdominio('flor_celulares').ok).toBe(false)
    expect(validarSubdominio('flor.celulares').ok).toBe(false)
    expect(validarSubdominio('florñ').ok).toBe(false)
  })

  it('rechaza guión al borde', () => {
    expect(validarSubdominio('-flor').ok).toBe(false)
    expect(validarSubdominio('flor-').ok).toBe(false)
  })

  it('rechaza los reservados', () => {
    for (const reservado of SUBDOMINIOS_RESERVADOS) {
      expect(validarSubdominio(reservado).ok).toBe(false)
    }
  })

  // dev y stage están reservados porque los dominios base de esos entornos
  // son dev.arandano.app y stage.arandano.app: un tenant así en producción
  // colisiona de nombre con un entorno interno.
  it('reserva dev y stage explícitamente', () => {
    expect(SUBDOMINIOS_RESERVADOS).toContain('dev')
    expect(SUBDOMINIOS_RESERVADOS).toContain('stage')
  })

  it('da un motivo legible', () => {
    const r = validarSubdominio('www')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('reservado')
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run lib/tenant/subdominio.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tenant/subdominio"`

- [ ] **Step 4: Escribir la implementación**

Crear `lib/tenant/subdominio.ts`:

```ts
/**
 * Todo lo que se puede decidir sobre un subdominio sin tocar la base ni el
 * request. Está separado de `resolver.ts` a propósito: esto se testea con una
 * tabla de casos y aquello necesita Postgres. Mezclados, ninguno de los dos se
 * testea bien.
 */

/**
 * Subdominios que nunca resuelven a un tenant y que el alta rechaza.
 *
 * `dev` y `stage` no están por prolijidad: los dominios base de esos entornos
 * son `dev.arandano.app` y `stage.arandano.app`, así que un tenant llamado
 * `dev` en producción crea una colisión de nombres con un entorno interno.
 */
export const SUBDOMINIOS_RESERVADOS: readonly string[] = [
  'www', 'api', 'admin', 'app', 'static', 'assets', 'cdn',
  'mail', 'smtp', 'ftp', 'dev', 'stage', 'ensayo',
  'status', 'docs', 'blog', 'help', 'soporte',
]

/**
 * Tipo discriminado y no `string | null`: el apex y un dominio ajeno son los
 * dos "no hay subdominio", pero piden respuestas distintas — placeholder uno,
 * 404 el otro. Un `null` que representa dos situaciones obliga a quien llama a
 * re-derivar cuál es, y ahí es donde se cuela el caso que nadie manejó.
 */
export type HostAnalizado =
  | { tipo: 'tenant'; subdominio: string }
  | { tipo: 'apex' }
  | { tipo: 'ajeno' }

export function subdominioDeHost(
  host: string | null | undefined,
  dominioBase: string,
): HostAnalizado {
  if (!host) return { tipo: 'ajeno' }

  // El Host trae el puerto cuando no es 80/443, y en dev siempre lo trae.
  const limpio = host.trim().toLowerCase().split(':')[0]
  const base = dominioBase.trim().toLowerCase()
  if (!limpio || !base) return { tipo: 'ajeno' }

  if (limpio === base) return { tipo: 'apex' }

  // El punto va en la comparación y no después: sin él, `malarandano.app`
  // pasaría por subdominio de `arandano.app`.
  if (!limpio.endsWith('.' + base)) return { tipo: 'ajeno' }

  const prefijo = limpio.slice(0, limpio.length - base.length - 1)

  // Exactamente una etiqueta. `a.b.arandano.app` no es de nadie: aceptarlo
  // significaría que dos hosts distintos resuelven al mismo tenant, y con
  // cookies de sesión eso es una superficie que no hace falta tener.
  if (prefijo.includes('.')) return { tipo: 'ajeno' }

  return { tipo: 'tenant', subdominio: prefijo }
}

export type ResultadoValidacion = { ok: true } | { ok: false; motivo: string }

/** Reglas de formato del subdominio, aplicadas por el alta antes de tocar la base. */
export function validarSubdominio(subdominio: string): ResultadoValidacion {
  if (subdominio !== subdominio.trim().toLowerCase()) {
    return { ok: false, motivo: 'tiene que estar en minúsculas y sin espacios alrededor' }
  }
  if (subdominio.length < 3 || subdominio.length > 63) {
    return { ok: false, motivo: 'tiene que tener entre 3 y 63 caracteres' }
  }
  if (!/^[a-z0-9-]+$/.test(subdominio)) {
    return { ok: false, motivo: 'sólo puede tener letras minúsculas, números y guiones' }
  }
  if (subdominio.startsWith('-') || subdominio.endsWith('-')) {
    return { ok: false, motivo: 'no puede empezar ni terminar con guión' }
  }
  if (SUBDOMINIOS_RESERVADOS.includes(subdominio)) {
    return { ok: false, motivo: `"${subdominio}" está reservado para uso interno` }
  }
  return { ok: true }
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run lib/tenant/subdominio.test.ts && npx tsc --noEmit`
Expected: todos PASS, tsc sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/tenant/subdominio.ts lib/tenant/subdominio.test.ts tsconfig.json
git commit -m "feat(tenant): parseo y validación de subdominios"
```

---

### Task 2: La función `resolver_tenant` y su migración

La puerta. Es la única forma de leer `tenants` sin tener el `tenant_id`, y su valor está tanto en lo que permite como en lo que sigue impidiendo — por eso los tests negativos pesan más que los positivos.

**Files:**
- Create: `prisma/migrations/<timestamp>_resolver_tenant/migration.sql`
- Create: `test/resolver-tenant.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: la función SQL `resolver_tenant(p_subdominio text) RETURNS TABLE (id uuid, nombre text, estado estado_tenant)`, con `EXECUTE` sólo para `arandano_app`.

- [ ] **Step 1: Crear la migración vacía**

`schema.prisma` no cambia — Prisma no modela funciones —, así que la migración se crea vacía y se escribe a mano:

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL .env.dev | cut -d= -f2-)" \
  npx prisma migrate dev --create-only --name resolver_tenant
```

Verificar que apareció `prisma/migrations/<timestamp>_resolver_tenant/migration.sql` y que está vacía o sólo con comentarios.

- [ ] **Step 2: Escribir el test que falla**

Crear `test/resolver-tenant.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

let owner: Client
let app: Client
let idFlor: string

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  app = new Client({ connectionString: urlApp() })
  await owner.connect()
  await app.connect()
  idFlor = await crearTenant(owner, 'resolver-flor')
  await crearTenant(owner, 'resolver-juan')
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('resolver_tenant', () => {
  it('devuelve el tenant por subdominio exacto, sin GUC puesto', async () => {
    const { rows } = await app.query('SELECT id, nombre, estado FROM resolver_tenant($1)', [
      'resolver-flor',
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(idFlor)
    expect(rows[0].estado).toBe('TRIAL')
  })

  it('devuelve cero filas para un subdominio inexistente', async () => {
    const { rows } = await app.query('SELECT id FROM resolver_tenant($1)', ['no-existe'])
    expect(rows).toHaveLength(0)
  })

  // El caso decisivo: la puerta tiene que ser del ancho del problema. Si esto
  // devolviera filas, la aplicación podría listar todos los clientes.
  it('no habilita a enumerar: tenants sigue cerrada para arandano_app', async () => {
    const { rows } = await app.query('SELECT count(*)::int AS n FROM tenants')
    expect(rows[0].n).toBe(0)
  })

  // El argumento se evalúa como arandano_app, con RLS aplicado, así que la
  // subconsulta devuelve NULL y la función no se puede torcer para enumerar.
  it('no se la puede torcer pasándole una subconsulta sobre tenants', async () => {
    const { rows } = await app.query(
      'SELECT id FROM resolver_tenant((SELECT subdominio FROM tenants LIMIT 1))',
    )
    expect(rows).toHaveLength(0)
  })

  it('es propiedad de arandano_owner', async () => {
    const { rows } = await owner.query(`
      SELECT pg_get_userbyid(p.proowner) AS dueno
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'resolver_tenant'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0].dueno).toBe('arandano_owner')
  })

  it('corre como SECURITY DEFINER con search_path fijado', async () => {
    const { rows } = await owner.query(`
      SELECT p.prosecdef AS secdef, p.proconfig AS config
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'resolver_tenant'
    `)
    expect(rows[0].secdef).toBe(true)
    // Sin search_path fijado, quien llama puede anteponer un esquema propio y
    // hacer que el cuerpo resuelva `tenants` a una tabla suya, ejecutada con
    // los privilegios del dueño.
    expect(rows[0].config).toEqual(['search_path=public, pg_temp'])
  })

  // Postgres otorga EXECUTE a PUBLIC por defecto al crear una función. Sin el
  // REVOKE, la puerta queda abierta para cualquier rol futuro.
  it('no le da EXECUTE a PUBLIC', async () => {
    const { rows } = await owner.query(`
      SELECT has_function_privilege('public', 'resolver_tenant(text)', 'EXECUTE') AS publico,
             has_function_privilege('arandano_app', 'resolver_tenant(text)', 'EXECUTE') AS app
    `)
    expect(rows[0].publico).toBe(false)
    expect(rows[0].app).toBe(true)
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run test/resolver-tenant.test.ts`
Expected: FAIL — `function resolver_tenant(unknown) does not exist`

- [ ] **Step 4: Escribir la migración**

Reemplazar el contenido de `prisma/migrations/<timestamp>_resolver_tenant/migration.sql`:

```sql
-- La puerta de resolución de tenant.
--
-- La policy de `tenants` compara contra el propio id:
--   USING ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
-- así que para resolver `flor` hay que consultar por subdominio, y para ver esa
-- fila hay que tener ya el tenant_id — que es exactamente el dato que se está
-- buscando. No es un bug de la policy: es la policy funcionando. El aislamiento
-- que impide que un tenant vea a otro también impide el paso previo a todo.
--
-- Esta función es la puerta explícita, y su ancho es exactamente el ancho del
-- problema: se puede preguntar "¿existe flor?" —que es lo mismo que revela
-- visitar la URL— pero no "¿quiénes son todos tus clientes?". `SELECT * FROM
-- tenants` como arandano_app sigue devolviendo cero filas, y pasarle a esta
-- función una subconsulta sobre `tenants` tampoco enumera, porque ese argumento
-- se evalúa como el rol que llama, con RLS aplicado.
--
-- Funciona porque arandano_owner no está sujeto a las policies de sus propias
-- tablas: ninguna tiene FORCE ROW LEVEL SECURITY. Si alguna vez se activa FORCE
-- sobre `tenants`, esta función deja de ver la fila y la resolución se rompe en
-- silencio — hay tests en test/resolver-tenant.test.ts que lo atrapan.
CREATE FUNCTION resolver_tenant(p_subdominio text)
RETURNS TABLE (id uuid, nombre text, estado estado_tenant)
LANGUAGE sql
-- STABLE y no VOLATILE: no escribe, y deja que el planner la trate como
-- constante dentro de una misma consulta.
STABLE
SECURITY DEFINER
-- Obligatorio, no cosmético: sin search_path fijado, quien llama puede
-- anteponer un esquema propio y hacer que el cuerpo resuelva `tenants` a una
-- tabla suya, que después se ejecuta con los privilegios del dueño. Es el
-- vector clásico de SECURITY DEFINER.
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.nombre, t.estado
    FROM tenants t
   WHERE t.subdominio = p_subdominio;
$$;

-- Postgres le otorga EXECUTE a PUBLIC por defecto al crear una función. Sin
-- este REVOKE la puerta queda abierta para cualquier rol futuro, incluidos los
-- que todavía no existen.
REVOKE ALL ON FUNCTION resolver_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolver_tenant(text) TO arandano_app;
```

- [ ] **Step 5: Aplicar en dev y correr el test**

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL .env.dev | cut -d= -f2-)" \
  npx prisma migrate deploy
npx vitest run test/resolver-tenant.test.ts
```

Expected: la migración se aplica; todos los tests PASS.

- [ ] **Step 6: Verificar que el gate sigue verde**

Run: `npm test && npx tsc --noEmit && scripts/generar-erd.sh --schema=prisma/schema.prisma --salida=docs/schema.md --verificar`
Expected: todo pasa. El ERD **no cambia**: una función no es una tabla, igual que las policies de RLS que ya viven en migraciones y no en `schema.prisma`.

- [ ] **Step 7: Commit**

```bash
git add prisma/migrations test/resolver-tenant.test.ts
git commit -m "feat(tenant): resolver_tenant, la puerta de resolución por subdominio"
```

---

### Task 3: `resolverTenant` y `tenantDelRequest`

El lado Node de la puerta, y el helper que consumen las rutas.

**Files:**
- Create: `lib/tenant/resolver.ts`
- Create: `lib/tenant/desde-request.ts`
- Create: `lib/tenant/desde-request.test.ts`

**Interfaces:**
- Consumes: `subdominioDeHost`, `SUBDOMINIOS_RESERVADOS` de `lib/tenant/subdominio.ts` (Task 1); la función SQL `resolver_tenant` (Task 2); `pool` de `lib/db.ts`.
- Produces:
  - `type TenantResuelto = { id: string; nombre: string; estado: 'TRIAL' | 'ACTIVO' | 'SUSPENDIDO' }`
  - `resolverTenant(subdominio: string): Promise<TenantResuelto | null>`
  - `type ResolucionTenant = { tipo: 'tenant'; tenant: TenantResuelto } | { tipo: 'apex' } | { tipo: 'ajeno' } | { tipo: 'reservado'; subdominio: string } | { tipo: 'inexistente'; subdominio: string }`
  - `tenantDelRequest(): Promise<ResolucionTenant>`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/tenant/desde-request.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getHeader = vi.fn()
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (n: string) => getHeader(n) }),
}))

const resolverTenant = vi.fn()
vi.mock('@/lib/tenant/resolver', () => ({
  resolverTenant: (s: string) => resolverTenant(s),
}))

async function correr() {
  const { tenantDelRequest } = await import('@/lib/tenant/desde-request')
  return tenantDelRequest()
}

describe('tenantDelRequest', () => {
  const original = process.env.DOMINIO_BASE

  beforeEach(() => {
    vi.resetModules()
    getHeader.mockReset()
    resolverTenant.mockReset()
    process.env.DOMINIO_BASE = 'arandano.app'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.DOMINIO_BASE
    else process.env.DOMINIO_BASE = original
  })

  it('resuelve un tenant existente', async () => {
    getHeader.mockReturnValue('flor.arandano.app')
    resolverTenant.mockResolvedValue({ id: 'abc', nombre: 'Flor', estado: 'ACTIVO' })

    expect(await correr()).toEqual({
      tipo: 'tenant',
      tenant: { id: 'abc', nombre: 'Flor', estado: 'ACTIVO' },
    })
    expect(resolverTenant).toHaveBeenCalledWith('flor')
  })

  it('reporta apex sin consultar la base', async () => {
    getHeader.mockReturnValue('arandano.app')
    expect(await correr()).toEqual({ tipo: 'apex' })
    expect(resolverTenant).not.toHaveBeenCalled()
  })

  it('reporta ajeno para un dominio que no es nuestro', async () => {
    getHeader.mockReturnValue('ejemplo.com')
    expect(await correr()).toEqual({ tipo: 'ajeno' })
    expect(resolverTenant).not.toHaveBeenCalled()
  })

  // Un reservado no llega nunca a la base: si alguien crea a mano una fila con
  // subdominio 'admin', igual no resuelve.
  it('corta los reservados antes de consultar', async () => {
    getHeader.mockReturnValue('admin.arandano.app')
    expect(await correr()).toEqual({ tipo: 'reservado', subdominio: 'admin' })
    expect(resolverTenant).not.toHaveBeenCalled()
  })

  it('distingue inexistente de ajeno', async () => {
    getHeader.mockReturnValue('nadie.arandano.app')
    resolverTenant.mockResolvedValue(null)
    expect(await correr()).toEqual({ tipo: 'inexistente', subdominio: 'nadie' })
  })

  // Sin DOMINIO_BASE no se puede decidir nada, y adivinar sería peor: un
  // default silencioso haría que cualquier host resolviera en algún entorno.
  it('falla ruidosamente si falta DOMINIO_BASE', async () => {
    delete process.env.DOMINIO_BASE
    getHeader.mockReturnValue('flor.arandano.app')
    await expect(correr()).rejects.toThrow(/DOMINIO_BASE/)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/tenant/desde-request.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/tenant/desde-request"`

- [ ] **Step 3: Escribir `resolver.ts`**

Crear `lib/tenant/resolver.ts`:

```ts
import { pool } from '@/lib/db'

/**
 * Lo que devuelve `resolver_tenant`, ni un campo más.
 *
 * A propósito NO es el modelo `Tenant` de Prisma: tiparlo así afirmaría que se
 * leyeron columnas que la función no devuelve, y el primer acceso a una de
 * ellas daría `undefined` en lugar de un error de compilación.
 */
export type TenantResuelto = {
  id: string
  nombre: string
  estado: 'TRIAL' | 'ACTIVO' | 'SUSPENDIDO'
}

/**
 * La única consulta de la aplicación que corre deliberadamente FUERA de la
 * frontera de tenant.
 *
 * Va por `pool` y no por `prismaParaTenant()` porque no puede ir por ahí: ese
 * helper exige un tenantId, que es justo lo que esto está buscando. La
 * seguridad no la da el GUC acá, la da el ancho de la función — devuelve un
 * tenant por subdominio exacto y no permite enumerar.
 */
export async function resolverTenant(subdominio: string): Promise<TenantResuelto | null> {
  const { rows } = await pool.query(
    'SELECT id, nombre, estado FROM resolver_tenant($1)',
    [subdominio],
  )
  const fila = rows[0]
  if (!fila) return null
  return { id: fila.id, nombre: fila.nombre, estado: fila.estado }
}
```

- [ ] **Step 4: Escribir `desde-request.ts`**

Crear `lib/tenant/desde-request.ts`:

```ts
import { headers } from 'next/headers'
import { subdominioDeHost, SUBDOMINIOS_RESERVADOS } from './subdominio'
import { resolverTenant, type TenantResuelto } from './resolver'

export type ResolucionTenant =
  | { tipo: 'tenant'; tenant: TenantResuelto }
  | { tipo: 'apex' }
  | { tipo: 'ajeno' }
  | { tipo: 'reservado'; subdominio: string }
  | { tipo: 'inexistente'; subdominio: string }

/**
 * De qué tenant es este request.
 *
 * Acá vive la resolución y no en un `middleware.ts`, y el motivo está en el
 * spec: el middleware de Next no puede consultar Postgres, así que tendría que
 * pasarle el resultado a la aplicación por un header — y un header del que la
 * aplicación deduce qué tenant servir es una superficie de suplantación que no
 * compra nada, porque el dato del que sale (el Host) la aplicación ya lo lee
 * directo.
 *
 * Que el Host lo elija el cliente está bien: pedir flor.arandano.app ES elegir
 * tenant, igual que tipear la URL. El Host no es una credencial y nunca lo fue.
 * Lo que impide suplantar a otro tenant es que la sesión quede atada a un
 * tenant y se rechace todo request cuyo Host no coincida — eso es trabajo del
 * ciclo de autenticación, y todavía no existe.
 *
 * Leer headers() obliga a Next a renderizar dinámicamente, y eso es un
 * REQUISITO, no un efecto colateral: una página de tenant cacheada y servida a
 * otro tenant es una fuga de datos entre clientes.
 */
export async function tenantDelRequest(): Promise<ResolucionTenant> {
  const dominioBase = process.env.DOMINIO_BASE
  if (!dominioBase) {
    throw new Error(
      'DOMINIO_BASE no está definida: sin ella no se puede decidir qué parte ' +
        'del Host es el subdominio del tenant. Definirla en el compose del stack.',
    )
  }

  const host = (await headers()).get('host')
  const analizado = subdominioDeHost(host, dominioBase)
  if (analizado.tipo !== 'tenant') return analizado

  // Los reservados se cortan acá, antes de la base: si alguien insertara a mano
  // una fila con subdominio 'admin', igual no resolvería.
  if (SUBDOMINIOS_RESERVADOS.includes(analizado.subdominio)) {
    return { tipo: 'reservado', subdominio: analizado.subdominio }
  }

  const tenant = await resolverTenant(analizado.subdominio)
  if (!tenant) return { tipo: 'inexistente', subdominio: analizado.subdominio }

  return { tipo: 'tenant', tenant }
}
```

- [ ] **Step 5: Correr los tests**

Run: `npx vitest run lib/tenant/ && npx tsc --noEmit`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/tenant/resolver.ts lib/tenant/desde-request.ts lib/tenant/desde-request.test.ts
git commit -m "feat(tenant): resolución del tenant del request"
```

---

### Task 4: El script de alta de tenant

Un comando versionado, revisable y repetible. Tiene que correr en dos lados: en el host contra dev o prod, y adentro de un contenedor sobre la red de stage — porque el Postgres de stage no publica puerto.

**Files:**
- Create: `scripts/crear-tenant.mts`
- Create: `scripts/crear-tenant.test.ts`
- Modify: `package.json` (sección `scripts`)
- Modify: `Dockerfile` (etapa `migrate`)

**Interfaces:**
- Consumes: `validarSubdominio` de `lib/tenant/subdominio.ts` (Task 1), importado **con extensión `.ts` explícita** porque Node la exige en imports relativos.
- Produces:
  - `npm run tenant:crear -- --subdominio=… --nombre=… [--modulos=…] --duenio=… --duenio-nombre=…`
  - `parsearArgumentos(argv: string[]): { ok: true; args: ArgsAlta } | { ok: false; motivo: string }`, exportada para poder testear la validación sin base.
  - `type ArgsAlta = { subdominio: string; nombre: string; modulos: string[]; duenio: string; duenioNombre: string }`

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/crear-tenant.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parsearArgumentos } from './crear-tenant.mts'

const BASE = [
  '--subdominio=flor',
  '--nombre=Flor Celulares',
  '--duenio=flor@ejemplo.com',
  '--duenio-nombre=Flor',
]

describe('parsearArgumentos', () => {
  it('acepta el caso mínimo y deja módulos vacío', () => {
    const r = parsearArgumentos(BASE)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.args.subdominio).toBe('flor')
      expect(r.args.nombre).toBe('Flor Celulares')
      expect(r.args.modulos).toEqual([])
      expect(r.args.duenio).toBe('flor@ejemplo.com')
    }
  })

  it('parsea varios módulos separados por coma', () => {
    const r = parsearArgumentos([...BASE, '--modulos=ORDENES_DE_TRABAJO,TURNOS'])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.args.modulos).toEqual(['ORDENES_DE_TRABAJO', 'TURNOS'])
  })

  it('rechaza un módulo que no existe en el enum', () => {
    const r = parsearArgumentos([...BASE, '--modulos=PELUQUERIA'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('PELUQUERIA')
  })

  it('rechaza un subdominio inválido con el motivo de validarSubdominio', () => {
    const r = parsearArgumentos(['--subdominio=WWW', ...BASE.slice(1)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('minúsculas')
  })

  it('rechaza un subdominio reservado', () => {
    const r = parsearArgumentos(['--subdominio=admin', ...BASE.slice(1)])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('reservado')
  })

  it('exige los obligatorios', () => {
    for (const faltante of ['--subdominio', '--nombre', '--duenio', '--duenio-nombre']) {
      const r = parsearArgumentos(BASE.filter((a) => !a.startsWith(faltante + '=')))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.motivo).toContain(faltante)
    }
  })

  it('rechaza un flag desconocido en vez de ignorarlo', () => {
    // Ignorarlo en silencio convierte un `--modulo=` (sin s) en un tenant sin
    // módulos que nadie entiende por qué quedó así.
    const r = parsearArgumentos([...BASE, '--preset=servicio-tecnico'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('--preset')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run scripts/crear-tenant.test.ts`
Expected: FAIL — no existe `./crear-tenant.mts`

- [ ] **Step 3: Escribir el script**

Crear `scripts/crear-tenant.mts`:

```ts
/**
 * Alta de tenant.
 *
 * Conecta con MIGRATE_DATABASE_URL, o sea como arandano_owner, y no como la
 * aplicación. arandano_app tiene INSERT sobre `tenants` y técnicamente podría
 * hacerlo generando el uuid antes y poniendo el GUC en ese valor para que pase
 * el WITH CHECK — se descarta a propósito: crear un tenant es una operación
 * privilegiada, del mismo rango que una migración, y no corresponde ponerla en
 * el camino de menor privilegio de la aplicación hasta que exista un formulario
 * de alta con autenticación detrás.
 *
 * Sin datos demo y sin presets: el formato de los presets de rubro es su propio
 * ciclo. El flag --preset llega con ese ciclo.
 *
 * Es .mts y no .ts para que Node lo trate como ESM sin ambigüedad. Se corre con
 * `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON` (ver package.json): el
 * módulo que importa SÍ es .ts y Node avisa que tuvo que reparsearlo, un aviso
 * que en el camino feliz de un deploy es puro ruido.
 */
import { Client } from 'pg'
import { validarSubdominio } from '../lib/tenant/subdominio.ts'

/** Los valores del enum `modulo` del schema. */
const MODULOS_VALIDOS = ['ORDENES_DE_TRABAJO', 'TURNOS', 'GASTRONOMIA'] as const

export type ArgsAlta = {
  subdominio: string
  nombre: string
  modulos: string[]
  duenio: string
  duenioNombre: string
}

export type ResultadoArgs = { ok: true; args: ArgsAlta } | { ok: false; motivo: string }

const CONOCIDOS = new Set([
  '--subdominio', '--nombre', '--modulos', '--duenio', '--duenio-nombre',
])

export function parsearArgumentos(argv: string[]): ResultadoArgs {
  const crudos = new Map<string, string>()

  for (const arg of argv) {
    const i = arg.indexOf('=')
    const clave = i === -1 ? arg : arg.slice(0, i)
    // Un flag desconocido es un error y no algo que se ignora: ignorarlo
    // convierte un `--modulo=` (sin s) en un tenant sin módulos que después
    // nadie entiende por qué quedó así.
    if (!CONOCIDOS.has(clave)) {
      return { ok: false, motivo: `argumento desconocido: ${clave}` }
    }
    if (i === -1) return { ok: false, motivo: `${clave} necesita un valor: ${clave}=algo` }
    crudos.set(clave, arg.slice(i + 1))
  }

  for (const obligatorio of ['--subdominio', '--nombre', '--duenio', '--duenio-nombre']) {
    if (!crudos.get(obligatorio)) {
      return { ok: false, motivo: `falta ${obligatorio}` }
    }
  }

  const subdominio = crudos.get('--subdominio')!
  const validacion = validarSubdominio(subdominio)
  if (!validacion.ok) {
    return { ok: false, motivo: `subdominio inválido: ${validacion.motivo}` }
  }

  const modulosCrudos = crudos.get('--modulos')
  const modulos = modulosCrudos ? modulosCrudos.split(',').map((m) => m.trim()).filter(Boolean) : []
  for (const modulo of modulos) {
    if (!(MODULOS_VALIDOS as readonly string[]).includes(modulo)) {
      return {
        ok: false,
        motivo: `módulo desconocido: ${modulo}. Los que existen son ${MODULOS_VALIDOS.join(', ')}`,
      }
    }
  }

  return {
    ok: true,
    args: {
      subdominio,
      nombre: crudos.get('--nombre')!,
      modulos,
      duenio: crudos.get('--duenio')!,
      duenioNombre: crudos.get('--duenio-nombre')!,
    },
  }
}

async function crear(args: ArgsAlta): Promise<void> {
  const url = process.env.MIGRATE_DATABASE_URL
  if (!url) {
    throw new Error(
      'MIGRATE_DATABASE_URL no está definida: el alta corre como arandano_owner, ' +
        'igual que las migraciones.',
    )
  }

  const cliente = new Client({ connectionString: url })
  await cliente.connect()
  try {
    await cliente.query('BEGIN')

    // gen_random_uuid() da un uuid v4 y el schema declara @default(uuid(7)).
    // No es una inconsistencia accidental: ese default sólo aplica cuando la
    // fila la crea Prisma, la columna no tiene default en la base, y la versión
    // del uuid no tiene consecuencia funcional sobre una tabla de pocas filas.
    // El helper de tests (test/datos.ts) ya hace lo mismo.
    const { rows } = await cliente.query(
      `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, 'TRIAL', now(), now())
       RETURNING id`,
      [args.subdominio, args.nombre],
    )
    const tenantId: string = rows[0].id

    for (const modulo of args.modulos) {
      await cliente.query(
        `INSERT INTO tenant_modules (tenant_id, modulo, activado_en)
         VALUES ($1, $2::modulo, now())`,
        [tenantId, modulo],
      )
    }

    // Sin credenciales: `users` no tiene columna de contraseña todavía. Eso es
    // trabajo del ciclo de autenticación, que va a necesitar su propia migración.
    await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, $3, 'DUENO', now(), now())`,
      [tenantId, args.duenioNombre, args.duenio],
    )

    await cliente.query('COMMIT')

    const dominio = process.env.DOMINIO_BASE ?? 'arandano.app'
    console.log(`tenant creado: ${args.nombre}`)
    console.log(`  id:      ${tenantId}`)
    console.log(`  url:     https://${args.subdominio}.${dominio}/`)
    console.log(`  dueño:   ${args.duenioNombre} <${args.duenio}> (sin credenciales todavía)`)
    console.log(`  módulos: ${args.modulos.length ? args.modulos.join(', ') : '(ninguno)'}`)
  } catch (err) {
    await cliente.query('ROLLBACK')
    // El @unique de la columna es la defensa real contra el duplicado; acá sólo
    // se traduce a algo legible en vez de dejar salir el error crudo de pg.
    if (err instanceof Error && /tenants_subdominio_key/.test(err.message)) {
      throw new Error(`ya existe un tenant con el subdominio "${args.subdominio}"`)
    }
    throw err
  } finally {
    await cliente.end()
  }
}

// Sólo corre cuando se lo invoca como programa, para que el test pueda
// importar parsearArgumentos sin conectarse a nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const resultado = parsearArgumentos(process.argv.slice(2))
  if (!resultado.ok) {
    console.error(`error: ${resultado.motivo}`)
    console.error(
      '\nuso: npm run tenant:crear -- --subdominio=flor --nombre="Flor Celulares" \\\n' +
        '       [--modulos=ORDENES_DE_TRABAJO,TURNOS] \\\n' +
        '       --duenio=flor@ejemplo.com --duenio-nombre="Flor"',
    )
    process.exit(2)
  }
  await crear(resultado.args).catch((err: unknown) => {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Agregar el script a `package.json`**

En la sección `scripts`, después de `"generate"`:

```json
    "tenant:crear": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/crear-tenant.mts",
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run scripts/crear-tenant.test.ts && npx tsc --noEmit`
Expected: todos PASS.

- [ ] **Step 6: Probarlo de verdad contra dev**

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL .env.dev | cut -d= -f2-)" \
DOMINIO_BASE=dev.arandano.app \
  npm run tenant:crear -- --subdominio=canario --nombre="Canario" \
    --modulos=ORDENES_DE_TRABAJO --duenio=canario@arandano.app --duenio-nombre="Canario"
```

Expected: imprime el id, la URL `https://canario.dev.arandano.app/` y los módulos. Correrlo una segunda vez tiene que decir `ya existe un tenant con el subdominio "canario"` y salir con código 1.

- [ ] **Step 7: Meter el script en la imagen de migración**

El Postgres de `arandano-stage` no publica puerto, así que el alta del canario en el gate corre adentro de un contenedor sobre la red del stack — el mismo patrón que ya usa `docker run --rm --network arandano-stage_default … arandano-migrate:$SHA migrate deploy`.

En `Dockerfile`, en la etapa `migrate`, después de `COPY prisma ./prisma`:

```dockerfile
# scripts/ y lib/ viajan en esta imagen para que el gate pueda correr el alta
# de tenant sobre la red de stage: el Postgres de ese stack no publica puerto,
# así que el script no se puede correr desde el host. `lib/` entra entero y no
# sólo el archivo que se importa: acotarlo obliga a acordarse de ampliarlo cada
# vez que el script comparta un módulo más, y ese olvido rompe el deploy en el
# paso 8 en vez de en el build.
COPY scripts ./scripts
COPY lib ./lib
```

- [ ] **Step 8: Verificar que la imagen puede correr el alta**

```bash
docker build --target migrate --build-arg GIT_SHA=prueba -t arandano-migrate:prueba .
docker run --rm --entrypoint node arandano-migrate:prueba \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/crear-tenant.mts --subdominio=ab
```

Expected: sale con código 2 e imprime `error: subdominio inválido: tiene que tener entre 3 y 63 caracteres` más el uso. Que llegue a validar prueba que el import de `lib/tenant/subdominio.ts` resolvió adentro de la imagen.

Limpieza: `docker rmi arandano-migrate:prueba`

- [ ] **Step 9: Commit**

```bash
git add scripts/crear-tenant.mts scripts/crear-tenant.test.ts package.json Dockerfile
git commit -m "feat(tenant): comando de alta de tenant"
```

---

### Task 5: El canario en el gate de deploy

Antes de que exista el check que lo usa, para que el gate nunca quede rojo entre dos tareas. El orden acá es lo único que importa y es fácil de equivocar: el canario tiene que existir **después** de `migrate deploy` y **antes** de que la app arranque, porque `up -d --wait app` espera al healthcheck y el check del canario llega en la tarea siguiente.

**Files:**
- Modify: `scripts/deploy.sh` (paso 8, entre `migrate deploy` contra stage y `up -d --wait app`)

**Interfaces:**
- Consumes: `scripts/crear-tenant.mts` dentro de `arandano-migrate:$SHA` (Task 4).
- Produces: un tenant `canario` en la base efímera de stage en cada corrida del gate.

- [ ] **Step 1: Insertar el alta del canario en `deploy.sh`**

En `scripts/deploy.sh`, entre el `docker run … migrate deploy` y el `IMAGE_TAG="$SHA" docker compose … up -d --wait app`, agregar:

```bash
# El canario de stage, creado con el MISMO script versionado que crea tenants
# en producción — no con un INSERT a mano. Eso tiene dos efectos: el check de
# tenant del healthcheck tiene a quién apuntar, y el alta queda ejercitada en
# cada deploy contra una base virgen, antes de que nada toque producción.
#
# EL ORDEN IMPORTA: va después de `migrate deploy` (las tablas tienen que
# existir) y ANTES de `up -d --wait app` (el `--wait` espera al healthcheck, y
# el check de tenant falla si el canario no está). Moverlo después del `up`
# hace que todo deploy sano se cuelgue esperando un healthcheck que nunca va a
# dar verde, con un mensaje que habla del canario y no del orden.
#
# --entrypoint node porque el ENTRYPOINT de la imagen es `npx prisma`.
docker run --rm --network arandano-stage_default \
  -e MIGRATE_DATABASE_URL="postgres://arandano_owner:efimero-owner@postgres:5432/arandano_stage" \
  -e DOMINIO_BASE="stage.arandano.app" \
  --entrypoint node "arandano-migrate:$SHA" \
  --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/crear-tenant.mts \
  --subdominio=canario \
  --nombre="Canario de stage" \
  --modulos=ORDENES_DE_TRABAJO \
  --duenio=canario@arandano.app \
  --duenio-nombre="Canario"
```

- [ ] **Step 2: Ensayar el gate completo**

Run: `scripts/deploy.sh --objetivo=ensayo`
Expected: el paso 8 imprime el alta del canario (`tenant creado: Canario de stage`) y el gate llega hasta el final sin crear ni pushear tag.

- [ ] **Step 3: Commit**

```bash
git add scripts/deploy.sh
git commit -m "feat(deploy): el gate crea el tenant canario en stage"
```

---

### Task 6: El check de tenant del healthcheck

El bloqueante 1 de `CLAUDE.md`, implementado pidiéndole más que la versión literal: una query filtrada devuelve datos igual con RLS apagado, así que un check que sólo mire eso pasa cuando el aislamiento está roto.

**Files:**
- Modify: `lib/health/checks.ts`
- Modify: `lib/health/checks.test.ts`
- Modify: `docker/compose.dev.yml`, `docker/compose.stage.yml`, `docker/compose.prod.yml`, `docker/compose.ensayo.yml`
- Modify: `scripts/smoke.sh`

**Interfaces:**
- Consumes: la función SQL `resolver_tenant` (Task 2); el canario de stage (Task 5); `pool` de `lib/db.ts`.
- Produces: un check llamado `tenant` en el array `checks`, con `detail` de la forma `canario=<subdominio>`.

- [ ] **Step 1: Escribir el test que falla**

En `lib/health/checks.test.ts`, el mock actual de `@/lib/db` sólo expone `pool.query`. El check nuevo necesita una conexión dedicada (dos `set_config` sobre la MISMA conexión), así que hay que ampliarlo. Reemplazar la línea del `vi.mock` por:

```ts
const query = vi.fn()
const clienteQuery = vi.fn()
const release = vi.fn()
vi.mock('@/lib/db', () => ({
  pool: {
    query: (...a: unknown[]) => query(...a),
    // El check de tenant necesita la MISMA conexión para las dos mitades:
    // set_config(..., true) es local a la transacción, y pool.query() no
    // garantiza que dos llamadas caigan en el mismo cliente.
    connect: async () => ({
      query: (...a: unknown[]) => clienteQuery(...a),
      release: () => release(),
    }),
  },
}))
```

Y agregar al final del archivo:

```ts
describe('check de tenant', () => {
  const original = process.env.TENANT_CANARIO_SUBDOMINIO

  beforeEach(() => {
    query.mockReset()
    clienteQuery.mockReset()
    release.mockReset()
    vi.resetModules()
    process.env.TENANT_CANARIO_SUBDOMINIO = 'canario'
  })

  afterEach(() => {
    if (original === undefined) delete process.env.TENANT_CANARIO_SUBDOMINIO
    else process.env.TENANT_CANARIO_SUBDOMINIO = original
  })

  async function correrTenantCheck() {
    const { checks } = await import('@/lib/health/checks')
    const check = checks.find((c) => c.name === 'tenant')!
    const { runChecks } = await import('@/lib/health/runChecks')
    return runChecks([check])
  }

  /** Programa las respuestas de la conexión dedicada: BEGIN, set_config,
   *  count propio, set_config, count ajeno, ROLLBACK. */
  function conCuentas(propio: number, ajeno: number) {
    clienteQuery.mockImplementation((sql: string) => {
      if (/count/.test(sql)) {
        const n = clienteQuery.mock.calls.filter((c) => /count/.test(c[0] as string)).length
        return Promise.resolve({ rows: [{ n: n === 1 ? propio : ajeno }] })
      }
      return Promise.resolve({ rows: [] })
    })
  }

  it('pasa cuando el canario existe y RLS filtra en las dos direcciones', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    conCuentas(1, 0)

    const report = await correrTenantCheck()

    expect(report.status).toBe('ok')
    expect(report.checks[0].detail).toBe('canario=canario')
    expect(release).toHaveBeenCalled()
  })

  it('falla si el canario no existe', async () => {
    query.mockResolvedValue({ rows: [] })

    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toContain('canario')
  })

  // La mitad que hace que este check valga algo. Sin ella, el check pasa
  // igual con RLS apagado — que es exactamente el estado que existe para
  // detectar.
  it('falla si con un tenant_id inventado igual ve filas', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    conCuentas(1, 3)

    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toMatch(/RLS/)
  })

  it('falla si con el tenant_id del canario no ve su propia fila', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    conCuentas(0, 0)

    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
  })

  it('falla ruidosamente si falta TENANT_CANARIO_SUBDOMINIO', async () => {
    delete process.env.TENANT_CANARIO_SUBDOMINIO
    const report = await correrTenantCheck()

    expect(report.status).toBe('degraded')
    expect(report.checks[0].detail).toContain('TENANT_CANARIO_SUBDOMINIO')
  })

  it('suelta la conexión aunque falle', async () => {
    query.mockResolvedValue({ rows: [{ id: 'id-del-canario' }] })
    clienteQuery.mockRejectedValue(new Error('se cayó la base'))

    await correrTenantCheck()

    expect(release).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/health/checks.test.ts`
Expected: FAIL — `checks.find(c => c.name === 'tenant')` es `undefined`.

- [ ] **Step 3: Escribir el check**

En `lib/health/checks.ts`, agregar antes de la declaración de `checks`:

```ts
/**
 * Un uuid que no puede ser de ningún tenant: los ids reales son v7
 * (`@default(uuid(7))`) o v4 (`gen_random_uuid()` del alta), y ninguno de los
 * dos genera este patrón de ceros.
 */
const TENANT_INEXISTENTE = '00000000-0000-4000-8000-000000000000'

/**
 * Que el aislamiento entre tenants esté APLICANDO, no sólo que una query
 * filtrada devuelva algo.
 *
 * La versión literal del bloqueante — "una query real filtrada por tenant que
 * devuelva datos" — no alcanza: una query filtrada devuelve datos igual con RLS
 * apagado, así que un check que sólo mire eso pasa exactamente en el estado que
 * existe para detectar. Por eso hay dos mitades, y la que importa es la
 * negativa: con un tenant_id inventado no se puede ver ni una fila.
 *
 * Atrapa un BYPASSRLS otorgado por error, una policy caída en una migración, y
 * la aplicación conectada con un rol exento.
 */
const tenantCheck: HealthCheck = {
  name: 'tenant',
  timeoutMs: 3000,
  run: async () => {
    const subdominio = process.env.TENANT_CANARIO_SUBDOMINIO
    if (!subdominio) {
      throw new Error(
        'TENANT_CANARIO_SUBDOMINIO no está definida: el healthcheck no tiene a qué ' +
          'tenant apuntar, así que no puede comprobar que el aislamiento aplique. ' +
          'Definirla en el compose del stack.',
      )
    }

    // Por la misma puerta que usa la aplicación, así el check también la ejercita.
    const { rows } = await pool.query('SELECT id FROM resolver_tenant($1)', [subdominio])
    const tenantId = rows[0]?.id
    if (!tenantId) {
      throw new Error(
        `el tenant canario "${subdominio}" no existe en esta base: crearlo con ` +
          '`npm run tenant:crear` antes de deployar este código',
      )
    }

    // Una conexión dedicada y no pool.query(): set_config(..., true) es local a
    // la transacción, y dos pool.query() pueden caer en clientes distintos.
    const cliente = await pool.connect()
    try {
      await cliente.query('BEGIN')

      await cliente.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [tenantId])
      const propio = await cliente.query('SELECT count(*)::int AS n FROM tenants')

      // El segundo set_config pisa al primero dentro de la misma transacción.
      await cliente.query(`SELECT set_config('arandano.tenant_id', $1, true)`, [TENANT_INEXISTENTE])
      const ajeno = await cliente.query('SELECT count(*)::int AS n FROM tenants')

      await cliente.query('ROLLBACK')

      if (propio.rows[0].n !== 1) {
        throw new Error(
          `con el tenant_id del canario "${subdominio}" la base devolvió ` +
            `${propio.rows[0].n} filas de tenants y tendría que devolver 1`,
        )
      }
      if (ajeno.rows[0].n !== 0) {
        throw new Error(
          `con un tenant_id inventado la base devolvió ${ajeno.rows[0].n} filas de ` +
            'tenants: RLS no está filtrando y el aislamiento entre tenants no aplica',
        )
      }
    } finally {
      cliente.release()
    }

    return `canario=${subdominio}`
  },
}
```

Y actualizar la lista y su comentario:

```ts
/**
 * La lista de checks del healthcheck.
 *
 * Sólo entra acá lo que puede FALLAR. El SHA y el uptime del proceso son
 * contexto, no señal: se reportan aparte, en `info` (ver `info.ts`).
 *
 * PENDIENTE — ver CLAUDE.md: falta el check de pg-boss, que espera a que
 * pg-boss se configure.
 */
export const checks: HealthCheck[] = [postgresCheck, rolCheck, tenantCheck]
```

- [ ] **Step 4: Correr los tests**

Run: `npx vitest run lib/health/`
Expected: todos PASS, incluidos los de postgres y rol que ya existían.

- [ ] **Step 5: Las variables de entorno en los cuatro composes**

Inline en el `environment:` del servicio `app`, junto a `ARANDANO_DB_ESPERADA` — versionado, no en un `.env` suelto:

`docker/compose.dev.yml`:
```yaml
      DOMINIO_BASE: dev.arandano.app
      TENANT_CANARIO_SUBDOMINIO: canario
```

`docker/compose.stage.yml`:
```yaml
      DOMINIO_BASE: stage.arandano.app
      TENANT_CANARIO_SUBDOMINIO: canario
```

`docker/compose.ensayo.yml`: los mismos valores que stage.

`docker/compose.prod.yml`:
```yaml
      DOMINIO_BASE: arandano.app
      TENANT_CANARIO_SUBDOMINIO: canario
```

- [ ] **Step 6: Sumar el caso al smoke**

En `scripts/smoke.sh`, agregar la función después de `caso_rol_sin_privilegios`:

```bash
# El check que comprueba que RLS está filtrando en las dos direcciones. Si
# falla, el aislamiento entre tenants no aplica.
caso_check_tenant() {
  printf '%s' "$SALUD" | jq -e '
    [.checks[] | select(.name == "tenant")] | length == 1
    and (.[0].ok == true)
  ' >/dev/null 2>&1
}
```

Y agregarla a la lista del `for`, después de `caso_rol_sin_privilegios`:

```bash
  caso_check_tenant \
```

- [ ] **Step 7: Crear el canario en dev y verificar de punta a punta**

El canario de dev se creó en la Task 4, Step 6. Levantar dev con las variables nuevas y consultar el healthcheck:

```bash
docker compose -f docker/compose.dev.yml up -d --wait
curl -s http://100.64.81.63:3000/api/health | jq '.checks[] | select(.name=="tenant")'
```

Expected: `{"name":"tenant","ok":true,"durationMs":<n>,"detail":"canario=canario"}`

- [ ] **Step 8: Ensayar el gate completo**

Run: `scripts/deploy.sh --objetivo=ensayo`
Expected: verde, con `caso_check_tenant` entre los casos que pasan.

- [ ] **Step 9: Commit**

```bash
git add lib/health/checks.ts lib/health/checks.test.ts docker/compose.*.yml scripts/smoke.sh
git commit -m "feat(health): check de aislamiento por tenant contra el canario"
```

---

### Task 7: Las rutas

La parte visible, y la que rompe el smoke existente si se hace sin cuidado: `caso_home_responde` pega a `$URL_BASE/` con el Host puesto en una IP, que a partir de ahora es un dominio ajeno y responde 404. Por eso el arreglo del smoke va en el mismo commit.

**Files:**
- Modify: `next.config.ts`
- Modify: `app/page.tsx`
- Create: `app/forbidden.tsx`
- Create: `app/page.test.tsx`
- Modify: `scripts/smoke.sh`
- Modify: `scripts/deploy.sh` (los argumentos con que invoca `smoke.sh`)

**Interfaces:**
- Consumes: `tenantDelRequest` de `lib/tenant/desde-request.ts` (Task 3); el canario de stage (Task 5).
- Produces: `smoke.sh <url_base> <sha_esperado> <dominio_base> <subdominio_canario>` — dos argumentos nuevos, obligatorios.

- [ ] **Step 1: Habilitar `authInterrupts`**

En `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  // Necesario para la imagen Docker: genera .next/standalone con un
  // server.js autocontenido y sólo las dependencias que se usan.
  output: 'standalone',
  experimental: {
    // Habilita forbidden() de next/navigation, que es lo que permite responder
    // 403 desde un componente de servidor. Un tenant suspendido tiene que
    // recibir 403 y no 404: el 404 le dice que su negocio no existe, el 403 le
    // dice que hay que pagar. Confusión cara, y un llamado de soporte asustado.
    authInterrupts: true,
  },
}
```

- [ ] **Step 2: Escribir el test que falla**

Crear `app/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tenantDelRequest = vi.fn()
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: () => tenantDelRequest(),
}))

const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND')
})
const forbidden = vi.fn(() => {
  throw new Error('NEXT_FORBIDDEN')
})
vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  forbidden: () => forbidden(),
}))

async function render() {
  const { default: Home } = await import('@/app/page')
  return Home()
}

describe('página raíz', () => {
  beforeEach(() => {
    vi.resetModules()
    tenantDelRequest.mockReset()
    notFound.mockClear()
    forbidden.mockClear()
  })

  it('404 para un dominio ajeno', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'ajeno' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404 para un subdominio reservado', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'reservado', subdominio: 'admin' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('404 para un subdominio inexistente', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'inexistente', subdominio: 'nadie' })
    await expect(render()).rejects.toThrow('NEXT_NOT_FOUND')
  })

  // 403 y no 404, deliberadamente: son mensajes distintos para situaciones
  // distintas.
  it('403 para un tenant suspendido', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'SUSPENDIDO' },
    })
    await expect(render()).rejects.toThrow('NEXT_FORBIDDEN')
    expect(notFound).not.toHaveBeenCalled()
  })

  it('un tenant en TRIAL resuelve como cualquier otro', async () => {
    tenantDelRequest.mockResolvedValue({
      tipo: 'tenant',
      tenant: { id: 'x', nombre: 'Flor', estado: 'TRIAL' },
    })
    await expect(render()).resolves.toBeTruthy()
  })

  it('el apex no es 404 ni tenant', async () => {
    tenantDelRequest.mockResolvedValue({ tipo: 'apex' })
    await expect(render()).resolves.toBeTruthy()
    expect(notFound).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npx vitest run app/page.test.tsx`
Expected: FAIL — la página actual no llama a `tenantDelRequest`.

- [ ] **Step 4: Reescribir `app/page.tsx`**

```tsx
import { notFound, forbidden } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import type { TenantResuelto } from '@/lib/tenant/resolver'

// Redundante con el headers() de tenantDelRequest, que ya obliga a render
// dinámico, y puesto igual: si algún día esta página deja de resolver tenant,
// la marca tiene que sobrevivir al cambio. Una página de tenant cacheada y
// servida a otro tenant es una fuga de datos entre clientes.
export const dynamic = 'force-dynamic'

const estilo = { fontFamily: 'system-ui, sans-serif', padding: '3rem' }

/** Stack e imagen: la verificación humana más barata que existe después de un
 *  deploy. Estaba en la versión anterior de esta página y se conserva. */
function Contexto() {
  return (
    <dl>
      <dt>Stack</dt>
      <dd data-testid="stack">{process.env.ARANDANO_STACK ?? 'desconocido'}</dd>
      <dt>Imagen</dt>
      <dd data-testid="sha">{process.env.GIT_SHA ?? 'dev'}</dd>
    </dl>
  )
}

function PaginaTenant({ tenant }: { tenant: TenantResuelto }) {
  return (
    <main style={estilo}>
      <h1>{tenant.nombre}</h1>
      <dl>
        <dt>Tenant</dt>
        <dd data-testid="tenant-nombre">{tenant.nombre}</dd>
        <dt>Estado</dt>
        <dd data-testid="tenant-estado">{tenant.estado}</dd>
      </dl>
      <Contexto />
    </main>
  )
}

function PaginaApex() {
  return (
    <main style={estilo}>
      <h1>Arándano</h1>
      <p>Acá va a vivir el sitio público. Cada negocio entra por su subdominio.</p>
      <Contexto />
    </main>
  )
}

export default async function Home() {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'apex') return <PaginaApex />

  // notFound() y forbidden() están tipadas como `never`, así que TypeScript
  // angosta `resolucion` a la variante 'tenant' de acá para abajo solo. Un
  // switch con fallthrough haría lo mismo al costo de un eslint-disable.
  if (resolucion.tipo !== 'tenant') notFound()
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  return <PaginaTenant tenant={resolucion.tenant} />
}
```

- [ ] **Step 5: Escribir `app/forbidden.tsx`**

```tsx
// La página que Next renderiza cuando un componente de servidor llama a
// forbidden(). Hoy sólo la alcanza un tenant suspendido.
export default function Forbidden() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem' }}>
      <h1>Cuenta suspendida</h1>
      <p>
        Esta cuenta está suspendida y no se puede usar en este momento. Los datos
        están intactos: se reactiva al regularizar el pago.
      </p>
    </main>
  )
}
```

- [ ] **Step 6: Correr los tests**

Run: `npx vitest run app/ && npx tsc --noEmit && npm run lint`
Expected: todos PASS.

- [ ] **Step 7: Arreglar y ampliar el smoke**

En `scripts/smoke.sh`, cambiar la cabecera de argumentos:

```bash
URL_BASE="${1:-}"
SHA_ESPERADO="${2:-}"
DOMINIO_BASE="${3:-}"
SUBDOMINIO_CANARIO="${4:-}"
if [[ -z "$URL_BASE" || -z "$SHA_ESPERADO" || -z "$DOMINIO_BASE" || -z "$SUBDOMINIO_CANARIO" ]]; then
  echo "uso: smoke.sh <url_base> <sha_esperado> <dominio_base> <subdominio_canario>" >&2
  exit 2
fi
```

Reemplazar `caso_home_responde` y agregar los casos nuevos:

```bash
# El Host es obligatorio a partir de la resolución por subdominio: sin él, la
# request llega con la IP:puerto del stack, que es un dominio ajeno y responde
# 404. No es un workaround del test — es el mismo camino que hace un cliente.
caso_home_responde() {
  curl -fsS --max-time 10 -o /dev/null \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/"
}

caso_tenant_resuelve() {
  curl -fsS --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/" \
    | grep -q 'data-testid="tenant-nombre"'
}

caso_subdominio_inexistente_404() {
  local code
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Host: no-existe-jamas.${DOMINIO_BASE}" "$URL_BASE/")
  [[ "$code" == "404" ]]
}

caso_host_ajeno_404() {
  local code
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Host: ejemplo.com" "$URL_BASE/")
  [[ "$code" == "404" ]]
}

# Una página de tenant guardada por una cache compartida y servida a otro
# tenant es una fuga de datos entre clientes — el modo de falla que todo el
# resto de este diseño existe para impedir. Leer headers() ya obliga a Next a
# renderizar dinámicamente; esto verifica que la respuesta que sale por el cable
# lo diga, que es lo único que una cache intermedia va a mirar.
#
# La aserción es "no es cacheable públicamente" y no una comparación literal
# contra el Cache-Control que emite Next hoy: lo que importa es la propiedad, y
# atarse al texto exacto convierte un cambio de wording de Next en un deploy
# rollbackeado sin ninguna regresión real.
caso_tenant_no_cacheable() {
  local cc
  cc=$(curl -sI --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/" \
       | tr -d '\r' | grep -i '^cache-control:' | head -1)
  [[ -n "$cc" ]] \
    && ! grep -qiE 'public|s-maxage' <<<"$cc" \
    && grep -qiE 'no-store|private' <<<"$cc"
}
```

Y en la lista del `for`, después de `caso_home_responde`:

```bash
  caso_tenant_resuelve \
  caso_subdominio_inexistente_404 \
  caso_host_ajeno_404 \
  caso_tenant_no_cacheable
```

- [ ] **Step 8: Pasarle los argumentos nuevos desde `deploy.sh`**

En `scripts/deploy.sh`, paso 9, la invocación de `smoke.sh` pasa a llevar los dos argumentos nuevos. Tienen que coincidir con `DOMINIO_BASE` y `TENANT_CANARIO_SUBDOMINIO` de `docker/compose.stage.yml` y con el `--subdominio` del alta del paso 8:

```bash
scripts/smoke.sh "http://$url_stage" "$SHA" "stage.arandano.app" "canario"
```

- [ ] **Step 9: Verificar en dev con navegador y con curl**

```bash
docker compose -f docker/compose.dev.yml up -d --wait
curl -s -o /dev/null -w 'canario: %{http_code}\n' -H 'Host: canario.dev.arandano.app' http://100.64.81.63:3000/
curl -s -o /dev/null -w 'inexistente: %{http_code}\n' -H 'Host: nadie.dev.arandano.app' http://100.64.81.63:3000/
curl -s -o /dev/null -w 'ajeno: %{http_code}\n' -H 'Host: ejemplo.com' http://100.64.81.63:3000/
curl -s -o /dev/null -w 'reservado: %{http_code}\n' -H 'Host: admin.dev.arandano.app' http://100.64.81.63:3000/
curl -sI -H 'Host: canario.dev.arandano.app' http://100.64.81.63:3000/ | grep -i '^cache-control:'
```

Expected: `canario: 200`, `inexistente: 404`, `ajeno: 404`, `reservado: 404`, y un `Cache-Control` que incluya `no-store` o `private` y no incluya `public` ni `s-maxage`.

Y el 403, suspendiendo el canario en dev y volviéndolo a activar:

```bash
docker exec arandano-dev-postgres-1 sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE tenants SET estado='"'"'SUSPENDIDO'"'"' WHERE subdominio='"'"'canario'"'"'"'
curl -s -o /dev/null -w 'suspendido: %{http_code}\n' -H 'Host: canario.dev.arandano.app' http://100.64.81.63:3000/
docker exec arandano-dev-postgres-1 sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE tenants SET estado='"'"'ACTIVO'"'"' WHERE subdominio='"'"'canario'"'"'"'
```

Expected: `suspendido: 403`.

- [ ] **Step 10: Ensayar el gate completo**

Run: `scripts/deploy.sh --objetivo=ensayo`
Expected: verde, con los cuatro casos nuevos del smoke pasando.

- [ ] **Step 11: Commit**

```bash
git add next.config.ts app/page.tsx app/page.test.tsx app/forbidden.tsx scripts/smoke.sh scripts/deploy.sh
git commit -m "feat(tenant): las rutas resuelven por subdominio"
```

---

### Task 8: Documentación

Los documentos que quedan mintiendo si no se tocan. En este repo eso no es prolijidad: un documento que afirma algo que el código no hace cuesta una ronda de revisión cada vez.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docker/Caddyfile`
- Modify: `docs/runbook-stacks.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada de código.

- [ ] **Step 1: Corregir el comentario del Caddyfile**

En `docker/Caddyfile`, la primera línea del comentario dice *"mientras arandano.app siga apuntando al parking de AWS"*. Eso quedó desmentido: `dig arandano.app` devuelve NXDOMAIN. Reemplazar por:

```
# Certificado interno mientras arandano.app no resuelva. Medido el 2026-08-07
# desde este servidor: `dig arandano.app` devuelve NXDOMAIN, y no se puede
# distinguir desde acá si nunca se registró, si expiró, o si está registrado sin
# zona publicada. El wildcard por DNS-01 entra cuando se apunte el DNS.
```

- [ ] **Step 2: Actualizar la tabla del stack en `CLAUDE.md`**

La fila `Multi-tenancy (app)` pasa a describir lo que hay:

| Multi-tenancy (app) | **Helper de servidor** (`lib/tenant/desde-request.ts`) resuelve subdominio → tenant leyendo el `Host`; extensión de Prisma fuerza filtro por `tenant_id` | Sin `middleware.ts`: el middleware de Next no puede consultar Postgres, así que tendría que pasarle el resultado a la app por un header — y un header del que la app deduce qué tenant servir es superficie de suplantación que no compra nada, porque el `Host` la app ya lo lee directo |

- [ ] **Step 3: Cerrar el bloqueante 1 en `CLAUDE.md`**

En *Bloqueantes antes del primer tenant real*, el punto 1 pasa a:

```markdown
1. **Completar el healthcheck.** El check de identidad del rol de conexión ya
   está (`lib/health/checks.ts`): rechaza superusuario, `BYPASSRLS` y ser dueño
   de las tablas. El check de aislamiento por tenant también (2026-08-08):
   resuelve el tenant canario y comprueba las dos mitades — con su `tenant_id`
   ve 1 fila, con uno inventado ve 0. **Pendiente**: el de pg-boss, que espera a
   que pg-boss se configure.
```

- [ ] **Step 4: Actualizar *Próximos pasos técnicos* en `CLAUDE.md`**

Marcar como hecho el ítem del middleware:

```markdown
- ~~Implementar el middleware de resolución de tenant por subdominio.~~
  **Hecho** (2026-08-08), y no como middleware: la resolución vive en
  `lib/tenant/desde-request.ts`, apoyada en la función `resolver_tenant` de
  Postgres — ver `docs/superpowers/specs/2026-08-08-resolucion-tenant-design.md`.
  Incluye el alta de tenant (`npm run tenant:crear`) y el check de aislamiento
  del healthcheck.
```

- [ ] **Step 5: Documentar en `docs/runbook-stacks.md`**

Agregar esta sección al final del archivo, tal cual:

````markdown
## Tenants y subdominios

Desde el 2026-08-08 la aplicación resuelve el tenant del header `Host` contra
`DOMINIO_BASE`, que cada compose fija: `arandano.app` en prod,
`dev.arandano.app` en dev, `stage.arandano.app` en stage y ensayo.

### La IP pelada dejó de servir la app

`http://100.64.81.63:3000` ahora responde **404**, y es correcto: ese host no
termina en `dev.arandano.app`, así que es un dominio ajeno. No hay —ni va a
haber— un camino de resolución exclusivo de dev; un atajo así se filtra a
producción y ahí es una forma de suplantar tenants.

### Llegar a un tenant desde la terminal

No hace falta DNS:

```bash
curl -H 'Host: canario.dev.arandano.app' http://100.64.81.63:3000/
```

### Llegar a un tenant desde el navegador

Ahí sí hace falta que el nombre resuelva. En el `/etc/hosts` de tu máquina:

```
100.64.81.63  canario.dev.arandano.app
```

Los archivos hosts no tienen wildcards, así que va una línea por subdominio de
prueba. Con dos o tres alcanza. Se evaluó `sslip.io` para tener el wildcard
gratis y se descartó: `100.64.81.63` está en el rango CGNAT, que muchos
resolvers filtran por protección de rebinding, y fallaría de forma intermitente.

### Crear un tenant

`MIGRATE_DATABASE_URL` sale de `.env.dev` porque el alta corre como
`arandano_owner`, igual que las migraciones — la aplicación nunca crea tenants.

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL .env.dev | cut -d= -f2-)" \
DOMINIO_BASE=dev.arandano.app \
  npm run tenant:crear -- --subdominio=flor --nombre="Flor Celulares" \
    --modulos=ORDENES_DE_TRABAJO --duenio=flor@ejemplo.com --duenio-nombre="Flor"
```

El dueño se crea sin credenciales: `users` todavía no tiene columna de
contraseña. Eso llega con el ciclo de autenticación.

### El tenant canario

Es el tenant al que apunta el check `tenant` del healthcheck, y se identifica
con `TENANT_CANARIO_SUBDOMINIO` (vale `canario` en los cuatro stacks). El check
no se conforma con que una query filtrada devuelva datos —eso pasa igual con RLS
apagado—: comprueba que con el `tenant_id` del canario la base devuelva 1 fila
de `tenants` y con uno inventado devuelva 0.

- En **stage** lo crea `deploy.sh` solo, en el paso 8, contra la base efímera.
  Eso deja el script de alta ejercitado en cada deploy, contra una base virgen.
- En **dev** y en **prod** hay que crearlo a mano una vez, con el comando de
  arriba. **En producción, antes del deploy que introduce el check**: si no
  existe, el healthcheck falla y el paso 14 dispara el rollback automático.
````

- [ ] **Step 6: Verificar el gate completo**

Run: `npm test && npx tsc --noEmit && npm run lint && scripts/deploy.sh --objetivo=ensayo`
Expected: todo verde.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docker/Caddyfile docs/runbook-stacks.md
git commit -m "docs: la resolución de tenant, y el bloqueante del healthcheck cerrado"
```

---

### Task 9: Puesta en producción

El único paso que no es código y el más fácil de olvidar. El check de tenant exige que el canario **ya exista** en producción; si no está, el healthcheck falla y el paso 14 dispara el rollback automático.

**Files:** ninguno.

- [ ] **Step 1: Mergear la rama a `main`**

Con review previa — con un solo desarrollador es la única segunda mirada que existe.

- [ ] **Step 2: Crear el canario en producción, ANTES del deploy**

Es el mismo razonamiento de expand/contract aplicado a datos en vez de a columnas: primero el dato, después el código que lo asume.

```bash
MIGRATE_DATABASE_URL="$(grep -m1 MIGRATE_DATABASE_URL /srv/arandano/prod/.env | cut -d= -f2-)" \
DOMINIO_BASE=arandano.app \
  npm run tenant:crear -- --subdominio=canario --nombre="Canario" \
    --modulos=ORDENES_DE_TRABAJO --duenio=canario@arandano.app --duenio-nombre="Canario"
```

Verificar que la fila está:

```bash
docker exec arandano-prod-postgres-1 sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Aqt -c "SELECT subdominio, estado FROM tenants"'
```

Expected: aparece `canario|TRIAL`.

- [ ] **Step 3: Deployar**

Run: `scripts/deploy.sh`

Expected: los 16 pasos en verde y un tag nuevo. La versión sube **MINOR** — hay pantalla nueva que el cliente ve, y ésa es la regla de `CLAUDE.md`.

- [ ] **Step 4: Verificar en producción**

```bash
curl -s http://127.0.0.1/api/health | jq '.checks[] | select(.name=="tenant")'
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: canario.arandano.app' http://127.0.0.1/
```

Expected: el check `tenant` en `ok` con `detail: "canario=canario"`, y `200` para el canario.

Nota: mientras `arandano.app` no resuelva, esto sólo se puede verificar con el `Host` header desde el propio servidor. El acceso real por internet llega con el cutover de DNS, que tiene su propia lista de bloqueantes en `CLAUDE.md`.

---

## Lo que este plan NO hace

Escrito para que nadie lo agregue por su cuenta a mitad de camino:

- **Autenticación, sesiones y login.** Ciclo siguiente, y va a necesitar su propia migración porque `users` no tiene columna de contraseña.
- **El formulario público de alta.** Necesita landing y auth.
- **Los presets de rubro y los datos demo.** Ciclo propio; el flag `--preset` del alta llega con él.
- **El catálogo público.** Es la primera superficie real de cliente y se apoya sobre lo que este ciclo deja.
- **El landing del apex.** Queda un placeholder.
- **El check de pg-boss.** Espera a que pg-boss se configure.
- **El cutover de DNS y el bloque `:80` del Caddyfile.** Tienen su propia lista de bloqueantes en `CLAUDE.md`, incluida la trampa de `URL_SALUD` en `deploy.sh` y `rollback.sh`.
