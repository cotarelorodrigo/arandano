# Autenticación con Better Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un empleado entre a `flor.arandano.app` con su mail y su contraseña, que su sesión no valga en ningún otro subdominio, y que el dueño pueda darlo de alta, resetearle la clave y desactivarlo desde una pantalla.

**Architecture:** Una instancia de Better Auth **por tenant**, construida sobre el cliente de Prisma que devuelve `prismaParaTenant(tenantId)`. Better Auth nunca se entera de que hay multi-tenancy: sus consultas —incluida la búsqueda por mail del login y la búsqueda por token de la sesión— quedan acotadas por las policies de RLS que ya existen. Su modelo `user` se mapea sobre la tabla `users` que ya está, así que hay una sola fila por persona y `ventas.usuario_id` sigue apuntando a donde ya apunta.

**Tech Stack:** Better Auth (última estable de la línea 1.6) con su `prismaAdapter`, Prisma 7.9.1, PostgreSQL 17 con Row Level Security, Next.js 16 (App Router), Tailwind v4 + shadcn/ui, Vitest 4 contra el Postgres efímero en Docker.

**Spec:** `docs/superpowers/specs/2026-08-10-autenticacion-design.md`

## Lo primero, porque explica todo el resto

Con una cuenta por negocio, `juan@gmail.com` puede existir en **dos** filas de `users`, en dos tenants. Better Auth busca al usuario **por mail** para loguearlo.

Si esa búsqueda no está acotada al tenant, devuelve una fila cualquiera de las dos. No es un bypass —la contraseña se verifica contra la fila encontrada— pero es un **login que rechaza credenciales correctas**, de forma intermitente, y sólo cuando dos locales comparten un empleado.

Todo el diseño existe para que el tenant esté **adentro** de la búsqueda y no chequeado después. Por eso la Task 3 es el corazón del plan y su test es el que justifica la arquitectura entera.

## Global Constraints

- Todo comentario, mensaje de commit, nombre de variable y texto de UI **en español**, explicando el **porqué** y no el qué.
- Toda tabla nueva lleva `tenant_id` y esta policy, **copiada literal** de `prisma/migrations/20260804205911_inicial/migration.sql`:

  ```sql
  ALTER TABLE "<tabla>" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "tenant_aislamiento" ON "<tabla>" FOR ALL
    USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
    WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
  ```

- Ids `uuid(7)`, timestamps `@db.Timestamptz(3)`, columnas en `snake_case` vía `@map`, tablas en plural. Es lo que ya hace el schema.
- **Migraciones sólo aditivas.** Ninguna columna se borra ni se renombra (expand/contract, CLAUDE.md).
- **`npm test` corre `scripts/tests/correr-todos.sh && vitest run`**, y `pretest` regenera el cliente de Prisma.
- Los tests que arrastran `lib/db.ts` **importan dinámicamente** después de setear `process.env.DATABASE_URL = urlApp()`. Ese módulo construye su `Pool` al importarse. Es el patrón de `test/ventas.test.ts`.
- **`docs/schema.md` se regenera con `scripts/generar-erd.sh`** después de cualquier migración. El hook de pre-commit y el paso 3 de `deploy.sh` lo verifican.
- **El secreto de Better Auth (`BETTER_AUTH_SECRET`) es distinto por stack**, como toda credencial (CLAUDE.md). Nunca se commitea.
- **Nunca escribir un hash de contraseña a mano.** Todo pasa por la API de Better Auth, para que el algoritmo viva en un solo lugar.
- Los modelos nuevos usan **los nombres de campo de Better Auth** (`userId`, `expiresAt`, `createdAt`…), con `@map` a `snake_case` para las columnas. Es una excepción deliberada al español del resto del schema: cada renombre sería una entrada más en el `fields:` de la configuración, y una entrada más que puede desincronizarse en silencio. `User` sí se mapea, porque la tabla ya existía en español.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `prisma/schema.prisma` *(mod)* | Tres columnas nuevas en `User`; los modelos `Session`, `Account` y `Verification` |
| `prisma/migrations/<ts>_autenticacion/migration.sql` *(nuevo)* | La migración, con el bloque de RLS agregado a mano |
| `lib/tenant/prisma.ts` *(mod)* | Sumar los tres modelos nuevos a `MODELOS_CON_TENANT` |
| `lib/tenant/desde-request.ts` *(mod)* | La variante `'tenant'` pasa a llevar también el `subdominio` |
| `lib/auth/opciones.ts` *(nuevo)* | La configuración de Better Auth. Pura, sin base: se puede testear sin Docker |
| `lib/auth/para-tenant.ts` *(nuevo)* | `authParaTenant`, con su memoización |
| `lib/auth/origen.ts` *(nuevo)* | El `baseURL` del request, derivado del `Host` y del `x-forwarded-proto` |
| `lib/auth/sesion.ts` *(nuevo)* | `sesionActual` y `exigirSesion`: el guard |
| `lib/usuarios/administrar.ts` *(nuevo)* | `crearEmpleado`, `resetearClave`, `desactivar`, `reactivar` |
| `lib/usuarios/errores.ts` *(nuevo)* | `ErrorDeUsuario` con su código, para que la UI no parsee strings |
| `app/api/auth/[...all]/route.ts` *(nuevo)* | El handler de Better Auth, detrás de la resolución de tenant |
| `app/login/page.tsx` *(nuevo)* | Resuelve el tenant y muestra el nombre del local. Servidor |
| `app/login/formulario.tsx` *(nuevo)* | El formulario. Cliente, porque necesita `useActionState` |
| `app/login/acciones.ts` *(nuevo)* | La server action `entrar` |
| `app/page.tsx` *(mod)* | Ápex público; para un tenant, exige sesión |
| `app/(app)/layout.tsx` *(nuevo)* | El layout con guard que heredan todas las pantallas de adentro |
| `app/(app)/usuarios/page.tsx`, `acciones.ts`, `formularios.tsx` *(nuevos)* | La administración de usuarios del dueño |
| `scripts/definir-clave.mts` *(nuevo)* | `npm run usuario:clave`. Define o resetea una contraseña por la API de Better Auth |
| `test/auth.test.ts` *(nuevo)* | El aislamiento del login y de la sesión |
| `test/usuarios.test.ts` *(nuevo)* | Las reglas de administración |
| `test/rutas-con-guard.test.ts` *(nuevo)* | Que ninguna pantalla quede fuera del grupo con guard |

`opciones.ts` va separado de `para-tenant.ts` a propósito: la configuración es lo único de este ciclo que se puede verificar sin levantar Docker, y mezclarla con la construcción del cliente obligaría a una base para probar que el rate limit del login quedó en 5.

---

### Task 1: El schema y su migración

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_autenticacion/migration.sql`
- Modify: `docs/schema.md` (regenerado, no editado a mano)

**Interfaces:**
- Produces: los modelos `Session`, `Account` y `Verification` de Prisma, y las columnas `emailVerified`, `imagen` y `desactivadoEn` en `User`.

- [ ] **Step 1: Sumar las tres columnas a `User`**

En `prisma/schema.prisma`, dentro de `model User`, después de `rol`:

```prisma
  // Better Auth la exige en su schema core (`emailVerified`, required). Queda
  // siempre en false y nadie la lee: requireEmailVerification va apagado porque
  // en este ciclo no hay proveedor de mail.
  emailVerified Boolean  @default(false) @map("email_verificado")
  // Idem: parte del core de Better Auth, sin uso todavía. El campo lleva el
  // nombre que la librería espera (`image`) y la columna sigue en español: así
  // no hace falta una entrada de mapeo por campo, que es todo el motivo de esta
  // convención. Mismo criterio que `emailVerified` acá arriba.
  image         String?   @map("imagen")
  // Dar de baja a un empleado NO puede ser borrar la fila: ventas.usuario_id es
  // una FK con onDelete: Restrict, así que la fila de quien vendió algo alguna
  // vez es indestructible por diseño. Se desactiva.
  desactivadoEn DateTime? @map("desactivado_en") @db.Timestamptz(3)
```

Y en las relaciones del mismo modelo, después de `movimientos`:

```prisma
  sesiones   Session[]
  cuentas    Account[]
```

- [ ] **Step 2: Agregar los tres modelos**

Al final de `prisma/schema.prisma`:

```prisma
// Las tres tablas que siguen son de Better Auth, y por eso sus campos llevan
// los nombres de la librería y no los del resto del schema: cada renombre sería
// una entrada en su `fields:` que puede desincronizarse en silencio. Los nombres
// de MODELO coinciden con los que Better Auth usa por defecto (`session`,
// `account`, `verification`), así que el adapter encuentra `prisma.session` sin
// una línea de configuración.

model Session {
  id        String   @id @default(uuid(7)) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  // Único global y no por tenant: es un token aleatorio, no un dato del negocio.
  token     String   @unique
  expiresAt DateTime @map("expira_en") @db.Timestamptz(3)
  ipAddress String?  @map("ip")
  userAgent String?  @map("user_agent")
  createdAt DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant  Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  usuario User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId])
  @@map("sessions")
}

// Donde vive el hash de la contraseña. Los campos de OAuth existen porque son
// parte del schema core de Better Auth, no porque se usen: este ciclo sólo
// habilita mail y contraseña.
model Account {
  id                    String    @id @default(uuid(7)) @db.Uuid
  tenantId              String    @map("tenant_id") @db.Uuid
  userId                String    @map("user_id") @db.Uuid
  accountId             String    @map("account_id")
  providerId            String    @map("provider_id")
  accessToken           String?   @map("access_token")
  refreshToken          String?   @map("refresh_token")
  idToken               String?   @map("id_token")
  accessTokenExpiresAt  DateTime? @map("access_token_expira_en") @db.Timestamptz(3)
  refreshTokenExpiresAt DateTime? @map("refresh_token_expira_en") @db.Timestamptz(3)
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now()) @map("creado_en") @db.Timestamptz(3)
  updatedAt             DateTime  @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant  Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  usuario User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tenantId, userId])
  @@map("accounts")
}

// Tokens de verificación. Entra aunque en este ciclo no haya mail: es parte del
// schema core de la librería y su ausencia rompería operaciones internas.
model Verification {
  id         String   @id @default(uuid(7)) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  identifier String
  value      String
  expiresAt  DateTime @map("expira_en") @db.Timestamptz(3)
  createdAt  DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId, identifier])
  @@map("verifications")
}
```

Y en `model Tenant`, junto a las otras relaciones:

```prisma
  sesiones      Session[]
  cuentas       Account[]
  verificaciones Verification[]
```

- [ ] **Step 3: Generar la migración sin aplicarla**

```bash
DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.dev | cut -d= -f2-)" \
MIGRATE_DATABASE_URL="$(grep -m1 '^MIGRATE_DATABASE_URL=' .env.dev | cut -d= -f2-)" \
npx prisma migrate dev --create-only --name autenticacion
```

Esperado: crea `prisma/migrations/<timestamp>_autenticacion/migration.sql` y **no** lo aplica.

- [ ] **Step 4: Agregar el bloque de RLS a la migración, a mano**

Prisma no genera policies. Al final del `migration.sql` recién creado:

```sql
-- ---------------------------------------------------------------------------
-- Row Level Security. Copiado literal de 20260804205911_inicial: las tres
-- tablas nuevas llevan tenant_id, así que entran al mismo régimen que todas.
-- El test test/rls-cobertura.test.ts falla si alguna quedara afuera.
-- ---------------------------------------------------------------------------

ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "sessions" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "accounts" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "verifications" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 5: Correr los tests de RLS, que cubren las tablas nuevas solos**

```bash
npx vitest run test/rls-cobertura.test.ts test/schema.test.ts
```

Esperado: PASS. `rls-cobertura` levanta la base efímera, aplica las migraciones y verifica que **toda** tabla con `tenant_id` tenga RLS y la policy con `USING` y `WITH CHECK`. Si el bloque del Step 4 faltara, este test falla nombrando la tabla.

- [ ] **Step 6: Regenerar el ERD**

```bash
scripts/generar-erd.sh
```

Esperado: `docs/schema.md` modificado, con las tres tablas nuevas.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations docs/schema.md
git commit -m "feat(auth): schema de sesiones, cuentas y verificaciones con RLS"
```

---

### Task 2: Better Auth instalado y configurado

**Files:**
- Modify: `package.json`
- Create: `lib/auth/opciones.ts`
- Test: `lib/auth/opciones.test.ts`
- Modify: `lib/tenant/prisma.ts:4`

**Interfaces:**
- Consumes: los modelos de la Task 1.
- Produces:
  - `OPCIONES_BASE` — el objeto de configuración de Better Auth sin `database` ni `baseURL`.
  - `SEGUNDOS_DE_SESION = 60 * 60 * 12`

- [ ] **Step 1: Instalar la librería**

```bash
npm install better-auth
npx better-auth --version 2>/dev/null || npm ls better-auth
```

Esperado: `better-auth` en `dependencies` (no en `devDependencies`: corre en producción).

- [ ] **Step 2: Escribir los tests que fallan**

Crear `lib/auth/opciones.test.ts`. No toca la base, así que corre sin Docker:

```ts
import { describe, it, expect } from 'vitest'
import { OPCIONES_BASE, SEGUNDOS_DE_SESION } from './opciones'

describe('opciones de Better Auth', () => {
  it('la sesión dura 12 horas', () => {
    expect(SEGUNDOS_DE_SESION).toBe(60 * 60 * 12)
    expect(OPCIONES_BASE.session?.expiresIn).toBe(SEGUNDOS_DE_SESION)
  })

  it('no exige verificación de mail, porque no hay proveedor de mail', () => {
    expect(OPCIONES_BASE.emailAndPassword?.enabled).toBe(true)
    expect(OPCIONES_BASE.emailAndPassword?.requireEmailVerification).toBe(false)
  })

  it('las cookies NO cruzan subdominios', () => {
    // Prenderlo haría válida en otro.arandano.app la cookie de flor.arandano.app.
    // RLS igual lo atajaría, pero una sola capa en el aislamiento es poca.
    // toBe(false) y no not.toBe(true): la segunda pasa también con undefined,
    // o sea que pasaría igual con la configuración borrada — no distinguiría
    // "lo desactivamos a propósito" de "nos olvidamos".
    expect(OPCIONES_BASE.advanced?.crossSubDomainCookies?.enabled).toBe(false)
  })

  it('el rate limit del login es más duro que el general', () => {
    const login = OPCIONES_BASE.rateLimit?.customRules?.['/sign-in/email']
    expect(login, 'no hay regla propia para el login').toBeDefined()
    expect(login && typeof login === 'object' && 'max' in login ? login.max : undefined).toBe(5)
  })

  it('el rate limit vive en memoria, así que no necesita tabla', () => {
    // storage: 'database' agregaría una tabla `rateLimit` SIN tenant_id, que
    // haría fallar test/rls-cobertura.test.ts. Con 'memory' no existe.
    expect(OPCIONES_BASE.rateLimit?.storage).toBe('memory')
  })

  it('los ids los genera Prisma, no Better Auth', () => {
    // El schema declara @default(uuid(7)). Si Better Auth mandara un id, ese
    // default no aplicaría y las filas nuevas quedarían con uuid v4.
    const generar = OPCIONES_BASE.advanced?.database?.generateId
    expect(typeof generar).toBe('function')
    expect(typeof generar === 'function' ? generar({ model: 'user' }) : null).toBe(false)
  })

  it('mapea el modelo user sobre las columnas en español de la tabla que ya existe', () => {
    expect(OPCIONES_BASE.user?.fields?.name).toBe('nombre')
    expect(OPCIONES_BASE.user?.fields?.createdAt).toBe('creadoEn')
    expect(OPCIONES_BASE.user?.fields?.updatedAt).toBe('actualizadoEn')
  })

  it('el rol no se puede setear desde afuera', () => {
    // Sin input:false, un campo de más en el alta convierte a un empleado en dueño.
    expect(OPCIONES_BASE.user?.additionalFields?.rol?.input).toBe(false)
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

```bash
npx vitest run lib/auth/opciones.test.ts
```

Esperado: FAIL, "Failed to resolve import ./opciones".

- [ ] **Step 4: Escribir las opciones**

Crear `lib/auth/opciones.ts`:

```ts
import type { BetterAuthOptions } from 'better-auth'

/**
 * Doce horas: cubre una jornada de comercio entera y obliga a entrar de nuevo
 * al otro día. Es la única defensa contra la máquina del mostrador que queda
 * abierta toda la noche.
 */
export const SEGUNDOS_DE_SESION = 60 * 60 * 12

/**
 * Todo lo que NO depende del tenant. `database` y `baseURL` los pone
 * `authParaTenant`, porque son lo único que cambia entre un local y otro.
 *
 * Está separado del constructor a propósito: es la única parte de este ciclo
 * que se puede verificar sin levantar Postgres.
 */
export const OPCIONES_BASE = {
  emailAndPassword: {
    enabled: true,
    // No hay proveedor de mail en este ciclo (ver el spec). Exigir verificación
    // dejaría a todo el mundo afuera.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: SEGUNDOS_DE_SESION,
    // Cada hora, como mucho, se reescribe la fila para extender la sesión. Sin
    // esto se escribiría en cada request, sobre un pool de 5 conexiones.
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    // En memoria y no en la base: 'database' agregaría una tabla `rateLimit`
    // SIN tenant_id, y test/rls-cobertura.test.ts la rechazaría con razón.
    // Alcanza mientras haya una sola instancia de la aplicación, y hoy la hay.
    storage: 'memory',
    customRules: {
      // El único freno contra la fuerza bruta: Caddy en su build estándar no
      // trae rate limiting y no hay Redis.
      '/sign-in/email': { window: 60, max: 5 },
    },
  },
  user: {
    // El modelo de Prisma se llama `User`, así que `prisma.user` ya es lo que
    // Better Auth busca por defecto: no hace falta modelName. Sí hace falta
    // mapear los campos, porque la tabla es anterior a la librería.
    fields: {
      name: 'nombre',
      createdAt: 'creadoEn',
      updatedAt: 'actualizadoEn',
    },
    additionalFields: {
      rol: {
        type: 'string',
        required: false,
        // input:false es lo que impide que alguien se autoascienda a DUENO
        // mandando un campo de más en el alta.
        input: false,
      },
      desactivadoEn: {
        type: 'date',
        required: false,
        input: false,
      },
    },
  },
  advanced: {
    database: {
      // false = "no generes id, que lo ponga la base". El schema declara
      // @default(uuid(7)) y Prisma lo aplica cuando el create viaja sin id. Si
      // Better Auth generara el suyo, serían uuid v4 en la misma columna.
      generateId: () => false as const,
    },
    // Host-only. Prenderlo haría válida en cualquier subdominio la cookie de
    // uno solo, que es exactamente el agujero que este ciclo evita.
    crossSubDomainCookies: { enabled: false },
  },
} satisfies BetterAuthOptions
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npx vitest run lib/auth/opciones.test.ts
```

Esperado: PASS, 8 tests.

Si el tipo de `generateId` rechazara `false`, la salida es aceptar el `uuid` v4 de la librería (`generateId: 'uuid'`) y ajustar el test — no es un caso nuevo, `scripts/crear-tenant.mts` ya inserta tenants con `gen_random_uuid()` sobre esa misma clase de columna y deja escrito el porqué.

- [ ] **Step 6: Sumar los tres modelos a `MODELOS_CON_TENANT`**

En `lib/tenant/prisma.ts:4`:

```ts
/** Modelos que llevan tenant_id y por lo tanto se les puede autocompletar.
 *  Session, Account y Verification son de Better Auth: la librería no sabe que
 *  existe el tenant, así que el tenant_id de sus filas lo pone esta extensión. */
const MODELOS_CON_TENANT = new Set([
  'User', 'Cliente', 'Articulo', 'TenantModule',
  'Session', 'Account', 'Verification',
])
```

- [ ] **Step 7: Correr la suite entera**

```bash
npm test
```

Esperado: PASS. Todo lo que ya existía sigue verde.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/auth/opciones.ts lib/auth/opciones.test.ts lib/tenant/prisma.ts
git commit -m "feat(auth): configuración de Better Auth, con el rol fuera del alcance del cliente"
```

---

### Task 3: `authParaTenant`, y el test que justifica el diseño

**Files:**
- Create: `lib/auth/para-tenant.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `OPCIONES_BASE` (Task 2), `prismaParaTenant` de `lib/tenant/prisma.ts`.
- Produces:
  - `authParaTenant(tenantId: string, origen: string): ReturnType<typeof betterAuth>`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `test/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

// Import dinámico: `lib/auth/para-tenant.ts` arrastra lib/db.ts, que construye
// su Pool al importarse leyendo DATABASE_URL.
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant

const ORIGEN = 'http://flor.arandano.test'
const MAIL = 'compartido@ejemplo.test'
const CLAVE_A = 'clave-del-local-a'
const CLAVE_B = 'clave-del-local-b'

let owner: Client
let tenantA: string
let tenantB: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  const sufijo = Date.now()
  tenantA = await crearTenant(owner, `auth-a-${sufijo}`)
  tenantB = await crearTenant(owner, `auth-b-${sufijo}`)

  // El MISMO mail en los dos locales, con contraseñas distintas. Es todo el
  // punto del ciclo: `users` lleva @@unique([tenantId, email]), no un unique
  // global, así que esto es un estado legítimo del sistema.
  await authParaTenant(tenantA, ORIGEN).api.signUpEmail({
    body: { email: MAIL, password: CLAVE_A, name: 'Juan del local A' },
  })
  await authParaTenant(tenantB, ORIGEN).api.signUpEmail({
    body: { email: MAIL, password: CLAVE_B, name: 'Juan del local B' },
  })
})

afterAll(async () => {
  await owner.end()
})

async function entrar(tenantId: string, password: string) {
  try {
    const r = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: MAIL, password },
      asResponse: true,
    })
    return r.status
  } catch {
    // Better Auth tira ante credenciales inválidas según la forma de llamada;
    // cualquiera de las dos cuenta como "no entró".
    return 401
  }
}

describe('aislamiento del login entre tenants', () => {
  it('el mismo mail existe como dos filas distintas, una por tenant', async () => {
    const { rows } = await owner.query(
      'SELECT tenant_id FROM users WHERE email = $1 ORDER BY tenant_id',
      [MAIL],
    )
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((f) => f.tenant_id))).toEqual(new Set([tenantA, tenantB]))
  })

  it('entra en el local A con la clave de A', async () => {
    expect(await entrar(tenantA, CLAVE_A)).toBe(200)
  })

  it('entra en el local B con la clave de B', async () => {
    expect(await entrar(tenantB, CLAVE_B)).toBe(200)
  })

  it('NO entra en el local A con la clave de B', async () => {
    // Éste es el test que justifica la arquitectura. Si la búsqueda por mail
    // dejara de estar acotada al tenant, Better Auth podría encontrar la fila
    // de B desde A y este login pasaría.
    expect(await entrar(tenantA, CLAVE_B)).not.toBe(200)
  })

  it('NO entra en el local B con la clave de A', async () => {
    expect(await entrar(tenantB, CLAVE_A)).not.toBe(200)
  })
})

describe('aislamiento de la sesión', () => {
  it('la sesión creada en A no existe para B', async () => {
    const r = await authParaTenant(tenantA, ORIGEN).api.signInEmail({
      body: { email: MAIL, password: CLAVE_A },
      asResponse: true,
    })
    const cookie = r.headers.get('set-cookie')
    expect(cookie, 'el login no devolvió cookie').toBeTruthy()

    const cabeceras = new Headers({ cookie: cookie!.split(';')[0] })

    const enA = await authParaTenant(tenantA, ORIGEN).api.getSession({ headers: cabeceras })
    expect(enA?.user, 'la sesión no vale en su propio tenant').toBeTruthy()

    // Misma cookie, otro local. La fila de `sessions` existe, pero con el
    // tenant_id de A: la policy no la devuelve cuando el GUC dice B.
    const enB = await authParaTenant(tenantB, ORIGEN).api.getSession({ headers: cabeceras })
    expect(enB, 'la cookie de un local sirvió en otro').toBeFalsy()
  })

  it('las filas de sessions llevan el tenant_id que les puso la extensión', async () => {
    const { rows } = await owner.query(
      'SELECT DISTINCT tenant_id FROM sessions WHERE tenant_id = $1',
      [tenantA],
    )
    expect(rows.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
npx vitest run test/auth.test.ts
```

Esperado: FAIL, "Failed to resolve import @/lib/auth/para-tenant".

- [ ] **Step 3: Escribir `authParaTenant`**

Crear `lib/auth/para-tenant.ts`:

```ts
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { OPCIONES_BASE } from './opciones'

type Auth = ReturnType<typeof betterAuth>

/**
 * Tope de la memoización. Una instancia por tenant activo.
 *
 * Desalojar una instancia NO es gratis, y por eso el desalojo es por uso y no
 * por inserción: el contador del rate limit de `/sign-in/email` vive en memoria
 * ADENTRO de la instancia (`storage: 'memory'` en OPCIONES_BASE), así que tirarla
 * reinicia el único freno contra la fuerza bruta que tiene el login. Con
 * desalojo por uso, el local que está siendo atacado se mantiene caliente por el
 * tráfico del propio atacante y su contador no se puede reiniciar por desalojo.
 */
const TOPE = 200

const cache = new Map<string, Auth>()

/**
 * La instancia de Better Auth de un tenant.
 *
 * El truco entero del ciclo está en el `database`: se le entrega un cliente de
 * Prisma que YA está atado al tenant, así que Better Auth nunca se entera de
 * que existe multi-tenancy. Su búsqueda por mail —la del login— y su búsqueda
 * por token —la de la sesión— quedan acotadas por las policies de RLS, en la
 * base. No hay ningún `if` nuestro en ese camino que alguien pueda olvidarse
 * de escribir.
 *
 * `transaction: false` es explícito y NO se deja al default de la librería a
 * propósito. `prismaParaTenant` rechaza `$transaction(fn)` —las operaciones del
 * callback se reagruparían en otra conexión y la atomicidad se perdería en
 * silencio—, así que si una versión futura cambiara ese default, el síntoma
 * sería el guard tirando error en el login. Ruidoso, pero en el peor momento.
 *
 * El `origen` entra en la clave del caché porque el mismo tenant puede
 * atenderse por http en dev y por https en producción, y el baseURL cambia.
 */
export function authParaTenant(tenantId: string, origen: string): Auth {
  const clave = `${tenantId}|${origen}`

  const guardada = cache.get(clave)
  if (guardada) {
    // Reinsertar la mueve al final: es lo que convierte el desalojo en "por uso"
    // en vez de "por orden de inserción". Ver el porqué en el comentario de TOPE.
    cache.delete(clave)
    cache.set(clave, guardada)
    return guardada
  }

  const auth = betterAuth({
    ...OPCIONES_BASE,
    baseURL: origen,
    secret: process.env.BETTER_AUTH_SECRET,
    database: prismaAdapter(prismaParaTenant(tenantId), {
      provider: 'postgresql',
      transaction: false,
    }),
    // Escribe la cookie de sesión cuando el login se llama desde una server
    // action, que es de donde lo llama la pantalla. Sin esto, el login
    // respondería bien y el navegador se quedaría sin cookie: entrarías y
    // seguirías deslogueado. Va acá y no en OPCIONES_BASE para que ese módulo
    // siga siendo verificable sin Next. Tiene que ser el ÚLTIMO del array.
    plugins: [nextCookies()],
  })

  // Desalojo simple: la entrada más vieja primero. Map conserva el orden de
  // inserción, así que la primera clave del iterador es la más antigua.
  if (cache.size >= TOPE) {
    const masVieja = cache.keys().next().value
    if (masVieja !== undefined) cache.delete(masVieja)
  }
  cache.set(clave, auth)

  return auth
}
```

- [ ] **Step 4: Definir el secreto para los tests**

En `vitest.config.mts`, dentro de `test`, agregar:

```ts
    // Better Auth exige un secreto para firmar. En los tests no protege nada
    // real, pero sin él la construcción de la instancia falla.
    env: { BETTER_AUTH_SECRET: 'secreto-solo-para-tests-sin-valor-real' },
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npx vitest run test/auth.test.ts
```

Esperado: PASS, 7 tests. En particular los dos que dicen "NO entra".

- [ ] **Step 6: Romper el aislamiento a propósito y ver que el test lo detecta**

Cambiar temporalmente `prismaParaTenant(tenantId)` por `prisma` (el cliente base, importado de `@/lib/db`) y correr de nuevo.

Esperado: los tests fallan. Con el cliente base no hay GUC, la policy falla cerrado y **ningún** login funciona. Revertir el cambio.

Este paso no es ceremonia: verifica que el test mide el efecto y no la forma.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/para-tenant.ts test/auth.test.ts vitest.config.mts
git commit -m "feat(auth): una instancia por tenant, con la búsqueda por mail acotada por RLS"
```

---

### Task 4: El handler de rutas

**Files:**
- Modify: `lib/tenant/desde-request.ts`
- Modify: `lib/tenant/desde-request.test.ts`
- Create: `lib/auth/origen.ts`
- Create: `app/api/auth/[...all]/route.ts`
- Test: `app/api/auth/ruta.test.ts`

**Interfaces:**
- Consumes: `authParaTenant` (Task 3), `tenantDelRequest`.
- Produces:
  - `ResolucionTenant` con `{ tipo: 'tenant'; tenant: TenantResuelto; subdominio: string }`
  - `origenDelRequest(): Promise<string>`

- [ ] **Step 1: Sumar el `subdominio` a la resolución**

`TenantResuelto` no lo trae —su JSDoc dice que es "lo que devuelve `resolver_tenant`, ni un campo más"— pero `tenantDelRequest` ya lo calculó y lo tira. En `lib/tenant/desde-request.ts`:

```ts
export type ResolucionTenant =
  // El subdominio va acá y NO dentro de `tenant`: TenantResuelto declara ser
  // exactamente lo que devuelve la función de Postgres, y sumarle un campo que
  // no viene de ahí rompería esa garantía. Lo necesita el baseURL de Better Auth.
  | { tipo: 'tenant'; tenant: TenantResuelto; subdominio: string }
  | { tipo: 'apex' }
  | { tipo: 'ajeno' }
  | { tipo: 'reservado'; subdominio: string }
  | { tipo: 'inexistente'; subdominio: string }
```

Y al final de la función:

```ts
  return { tipo: 'tenant', tenant, subdominio: analizado.subdominio }
```

- [ ] **Step 2: Correr los tests existentes**

```bash
npx vitest run lib/tenant/desde-request.test.ts
```

Esperado: PASS. Si alguno construye la variante `'tenant'` a mano, TypeScript lo marca y hay que sumarle el `subdominio`.

- [ ] **Step 3: Escribir `origenDelRequest`**

Crear `lib/auth/origen.ts`:

```ts
import { headers } from 'next/headers'

/**
 * El `baseURL` que Better Auth necesita, derivado del request.
 *
 * No se arma con DOMINIO_BASE: en dev la aplicación se sirve por la IP de
 * Tailscale y por http, así que un baseURL construido a mano quedaría mintiendo
 * justo en el entorno donde se prueba. El Host es lo que el navegador realmente
 * pidió, y `x-forwarded-proto` lo pone Caddy en producción.
 */
export async function origenDelRequest(): Promise<string> {
  const h = await headers()
  const host = h.get('host')
  if (!host) throw new Error('request sin Host: no se puede derivar el baseURL')
  const protocolo = h.get('x-forwarded-proto') ?? 'http'
  return `${protocolo}://${host}`
}
```

- [ ] **Step 4: Escribir el test del handler**

Crear `app/api/auth/ruta.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const resolucion = vi.hoisted(() => ({ valor: null as unknown }))

vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => resolucion.valor,
}))
vi.mock('@/lib/auth/origen', () => ({
  origenDelRequest: async () => 'http://flor.arandano.test',
}))

const handler = vi.hoisted(() => vi.fn(async () => new Response('ok', { status: 200 })))
vi.mock('@/lib/auth/para-tenant', () => ({
  authParaTenant: () => ({ handler }),
}))

const { GET, POST } = await import('./[...all]/route')

const pedir = () => new Request('http://flor.arandano.test/api/auth/sign-in/email')

beforeEach(() => handler.mockClear())

describe('el handler de auth', () => {
  it('no existe en el ápex', async () => {
    resolucion.valor = { tipo: 'apex' }
    expect((await GET(pedir())).status).toBe(404)
    expect(handler, 'se llamó a Better Auth sin tenant').not.toHaveBeenCalled()
  })

  it('no existe para un subdominio inexistente', async () => {
    resolucion.valor = { tipo: 'inexistente', subdominio: 'nadie' }
    expect((await POST(pedir())).status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  it('no existe para un subdominio reservado', async () => {
    resolucion.valor = { tipo: 'reservado', subdominio: 'admin' }
    expect((await GET(pedir())).status).toBe(404)
  })

  it('no existe para un host ajeno', async () => {
    resolucion.valor = { tipo: 'ajeno' }
    expect((await GET(pedir())).status).toBe(404)
  })

  it('delega en Better Auth cuando el tenant resuelve', async () => {
    resolucion.valor = {
      tipo: 'tenant',
      tenant: { id: 'un-uuid', nombre: 'Flor', estado: 'ACTIVO' },
      subdominio: 'flor',
    }
    expect((await POST(pedir())).status).toBe(200)
    expect(handler).toHaveBeenCalledOnce()
  })

  it('un tenant suspendido no puede entrar', async () => {
    resolucion.valor = {
      tipo: 'tenant',
      tenant: { id: 'un-uuid', nombre: 'Flor', estado: 'SUSPENDIDO' },
      subdominio: 'flor',
    }
    expect((await POST(pedir())).status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Correr el test y verificar que falla**

```bash
npx vitest run app/api/auth/ruta.test.ts
```

Esperado: FAIL, no existe `./[...all]/route`.

- [ ] **Step 6: Escribir el handler**

Crear `app/api/auth/[...all]/route.ts`:

```ts
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'

// Lee headers() a través de tenantDelRequest: render dinámico obligatorio. Una
// respuesta de autenticación cacheada y servida a otro tenant sería la peor
// fuga posible.
export const dynamic = 'force-dynamic'

async function atender(request: Request): Promise<Response> {
  const resolucion = await tenantDelRequest()

  // Sin tenant no hay autenticación: entrar es siempre entrar a un local. El
  // ápex no tiene login, y un subdominio inexistente no debe delatar que no
  // existe con un error distinto al de una ruta cualquiera.
  if (resolucion.tipo !== 'tenant') {
    return new Response('no encontrado', { status: 404 })
  }

  // Un local suspendido no deja entrar a nadie, ni siquiera con la clave
  // correcta. Los datos siguen ahí; el acceso no.
  if (resolucion.tenant.estado === 'SUSPENDIDO') {
    return new Response('cuenta suspendida', { status: 403 })
  }

  const origen = await origenDelRequest()
  return authParaTenant(resolucion.tenant.id, origen).handler(request)
}

export const GET = atender
export const POST = atender
```

- [ ] **Step 7: Correr los tests y verificar que pasan**

```bash
npx vitest run app/api/auth/ruta.test.ts lib/tenant/desde-request.test.ts
```

Esperado: PASS, 6 tests del handler.

- [ ] **Step 8: Commit**

```bash
git add lib/tenant/desde-request.ts lib/tenant/desde-request.test.ts lib/auth/origen.ts app/api/auth
git commit -m "feat(auth): el handler no existe fuera de un tenant, y un local suspendido no entra"
```

---

### Task 5: El guard de sesión

**Files:**
- Create: `lib/auth/sesion.ts`
- Test: agregar a `test/auth.test.ts`

**Interfaces:**
- Consumes: `authParaTenant`, `tenantDelRequest`, `origenDelRequest`.
- Produces:
  - `type Sesion = { tenant: TenantResuelto; subdominio: string; usuario: { id: string; nombre: string; email: string; rol: 'DUENO' | 'EMPLEADO' } }`
  - `sesionActual(): Promise<Sesion | null>`
  - `exigirSesion(): Promise<Sesion>` — redirige a `/login` si no hay
  - `exigirDuenio(): Promise<Sesion>` — `forbidden()` si el rol no es `DUENO`

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `test/auth.test.ts` un bloque nuevo. Prueba la **regla**, no el envoltorio de Next:

```ts
describe('la sesión de un usuario desactivado', () => {
  it('deja de valer en el request siguiente', async () => {
    const auth = authParaTenant(tenantA, ORIGEN)

    const r = await auth.api.signInEmail({
      body: { email: MAIL, password: CLAVE_A },
      asResponse: true,
    })
    const cookie = r.headers.get('set-cookie')!.split(';')[0]
    const cabeceras = new Headers({ cookie })

    // Con la sesión viva, Better Auth la devuelve.
    const antes = await auth.api.getSession({ headers: cabeceras })
    expect(antes?.user).toBeTruthy()

    await owner.query(
      'UPDATE users SET desactivado_en = now() WHERE tenant_id = $1 AND email = $2',
      [tenantA, MAIL],
    )

    // Better Auth NO sabe nada de desactivación: la sesión le sigue pareciendo
    // válida. Ésa es exactamente la razón por la que el guard existe, y por la
    // que el chequeo va en cada request y no sólo al entrar: si se hiciera sólo
    // al entrar, echar a un empleado no tendría efecto hasta que se le venciera
    // la sesión.
    const despues = await auth.api.getSession({ headers: cabeceras })
    expect(despues?.user, 'Better Auth ya no devuelve la sesión: el test no prueba nada')
      .toBeTruthy()
    expect((despues!.user as { desactivadoEn?: unknown }).desactivadoEn).toBeTruthy()

    await owner.query(
      'UPDATE users SET desactivado_en = NULL WHERE tenant_id = $1 AND email = $2',
      [tenantA, MAIL],
    )
  })
})
```

- [ ] **Step 2: Correr el test y verificar que pasa**

```bash
npx vitest run test/auth.test.ts
```

Esperado: PASS. `desactivadoEn` viaja en el usuario de la sesión porque la Task 2 lo declaró en `additionalFields`; este test es la comprobación de que ese `additionalFields` efectivamente llega hasta acá.

Si fallara en la aserción de `desactivadoEn`, el arreglo es en `lib/auth/opciones.ts` —el campo no está llegando— y **nunca** relajar el test: sin ese dato el guard no puede distinguir a un empleado activo de uno al que echaron.

- [ ] **Step 3: Escribir el guard**

Crear `lib/auth/sesion.ts`:

```ts
import { redirect, forbidden } from 'next/navigation'
import { headers } from 'next/headers'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'
import type { TenantResuelto } from '@/lib/tenant/resolver'

export type RolUsuario = 'DUENO' | 'EMPLEADO'

export type Sesion = {
  tenant: TenantResuelto
  subdominio: string
  usuario: { id: string; nombre: string; email: string; rol: RolUsuario }
}

/**
 * Quién está usando este request, o null.
 *
 * Los tres chequeos no son redundantes entre sí:
 *
 * 1. Que haya sesión — lo obvio.
 * 2. Que el usuario no esté desactivado — Better Auth no sabe nada de eso, y va
 *    en CADA request: si se chequeara sólo al entrar, echar a un empleado no
 *    tendría efecto hasta que se le venciera la sesión.
 * 3. Que el tenant de la sesión sea el del Host — RLS ya lo garantiza, porque
 *    la fila de `sessions` no aparece con otro GUC. Se chequea igual: una sola
 *    capa en el aislamiento entre clientes es poca, y este `if` es barato.
 */
export async function sesionActual(): Promise<Sesion | null> {
  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') return null
  if (resolucion.tenant.estado === 'SUSPENDIDO') return null

  const origen = await origenDelRequest()
  const auth = authParaTenant(resolucion.tenant.id, origen)

  const sesion = await auth.api.getSession({ headers: await headers() })
  if (!sesion?.user) return null

  const usuario = sesion.user as unknown as {
    id: string
    name: string
    email: string
    rol: RolUsuario | null
    desactivadoEn: Date | string | null
  }

  if (usuario.desactivadoEn) return null

  return {
    tenant: resolucion.tenant,
    subdominio: resolucion.subdominio,
    usuario: {
      id: usuario.id,
      nombre: usuario.name,
      email: usuario.email,
      rol: usuario.rol ?? 'EMPLEADO',
    },
  }
}

/** La sesión, o a la pantalla de login. Es lo que usan los layouts. */
export async function exigirSesion(): Promise<Sesion> {
  const sesion = await sesionActual()
  if (!sesion) redirect('/login')
  return sesion
}

/** La sesión de un dueño, o 403. */
export async function exigirDuenio(): Promise<Sesion> {
  const sesion = await exigirSesion()
  if (sesion.usuario.rol !== 'DUENO') forbidden()
  return sesion
}
```

- [ ] **Step 4: Escribir los tests del guard**

Crear `lib/auth/sesion.test.ts`. Acá se mockean las dependencias porque lo que se
prueba son **las tres reglas**, no la base — el aislamiento real ya lo cubre
`test/auth.test.ts` contra Postgres:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const estado = vi.hoisted(() => ({
  resolucion: null as unknown,
  usuario: null as unknown,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('@/lib/tenant/desde-request', () => ({
  tenantDelRequest: async () => estado.resolucion,
}))
vi.mock('@/lib/auth/origen', () => ({ origenDelRequest: async () => 'http://x.test' }))
vi.mock('@/lib/auth/para-tenant', () => ({
  authParaTenant: () => ({ api: { getSession: async () => (estado.usuario ? { user: estado.usuario } : null) } }),
}))

const redirigido = vi.hoisted(() => vi.fn(() => { throw new Error('REDIRECT') }))
const prohibido = vi.hoisted(() => vi.fn(() => { throw new Error('FORBIDDEN') }))
vi.mock('next/navigation', () => ({ redirect: redirigido, forbidden: prohibido }))

const { sesionActual, exigirSesion, exigirDuenio } = await import('./sesion')

const TENANT = { tipo: 'tenant', tenant: { id: 't1', nombre: 'Flor', estado: 'ACTIVO' }, subdominio: 'flor' }
const ACTIVO = { id: 'u1', name: 'Juan', email: 'j@x.test', rol: 'EMPLEADO', desactivadoEn: null }

beforeEach(() => {
  estado.resolucion = TENANT
  estado.usuario = ACTIVO
  redirigido.mockClear()
  prohibido.mockClear()
})

describe('sesionActual', () => {
  it('devuelve la sesión cuando todo está bien', async () => {
    const s = await sesionActual()
    expect(s?.usuario.email).toBe('j@x.test')
    expect(s?.subdominio).toBe('flor')
  })

  it('es null sin sesión', async () => {
    estado.usuario = null
    expect(await sesionActual()).toBeNull()
  })

  it('es null si el usuario está desactivado', async () => {
    estado.usuario = { ...ACTIVO, desactivadoEn: new Date() }
    expect(await sesionActual()).toBeNull()
  })

  it('es null fuera de un tenant', async () => {
    estado.resolucion = { tipo: 'apex' }
    expect(await sesionActual()).toBeNull()
  })

  it('es null si el local está suspendido', async () => {
    estado.resolucion = { ...TENANT, tenant: { ...TENANT.tenant, estado: 'SUSPENDIDO' } }
    expect(await sesionActual()).toBeNull()
  })
})

describe('exigirSesion', () => {
  it('manda al login cuando no hay sesión', async () => {
    estado.usuario = null
    await expect(exigirSesion()).rejects.toThrow('REDIRECT')
    expect(redirigido).toHaveBeenCalledWith('/login')
  })
})

describe('exigirDuenio', () => {
  it('un EMPLEADO no pasa', async () => {
    // Es lo que impide que un empleado abra /usuarios y se dé de alta a sí
    // mismo como dueño.
    await expect(exigirDuenio()).rejects.toThrow('FORBIDDEN')
    expect(prohibido).toHaveBeenCalled()
  })

  it('un DUENO pasa', async () => {
    estado.usuario = { ...ACTIVO, rol: 'DUENO' }
    expect((await exigirDuenio()).usuario.rol).toBe('DUENO')
    expect(prohibido).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npx vitest run lib/auth/sesion.test.ts
```

Esperado: PASS, 8 tests.

- [ ] **Step 6: Correr la suite entera**

```bash
npm test
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/sesion.ts lib/auth/sesion.test.ts test/auth.test.ts
git commit -m "feat(auth): guard de sesión, con la desactivación chequeada en cada request"
```

---

### Task 6: `npm run usuario:clave`

**Files:**
- Create: `scripts/definir-clave.mts`
- Modify: `package.json`
- Modify: `scripts/crear-tenant.mts:145-148`
- Test: agregar a `test/auth.test.ts`

**Interfaces:**
- Consumes: `authParaTenant`.
- Produces: el comando `npm run usuario:clave -- --subdominio=flor --email=… [--clave=…]`

- [ ] **Step 1: Escribir el test que falla**

Agregar a `test/auth.test.ts`:

```ts
describe('definir-clave', () => {
  it('deja una contraseña con la que efectivamente se entra', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')

    const nueva = 'clave-nueva-del-script'
    await definirClave({ tenantId: tenantB, email: MAIL, clave: nueva, origen: ORIGEN })

    expect(await entrar(tenantB, nueva)).toBe(200)
    // Y la vieja deja de servir: definir una clave la REEMPLAZA.
    expect(await entrar(tenantB, CLAVE_B)).not.toBe(200)
  })

  it('falla claro si el usuario no existe en ese tenant', async () => {
    const { definirClave } = await import('@/scripts/definir-clave.mts')
    await expect(
      definirClave({ tenantId: tenantA, email: 'nadie@ejemplo.test', clave: 'x'.repeat(10), origen: ORIGEN }),
    ).rejects.toThrow(/no existe/)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run test/auth.test.ts -t definir-clave
```

Esperado: FAIL, no existe el módulo.

- [ ] **Step 3: Escribir el script**

Crear `scripts/definir-clave.mts`:

```ts
/**
 * Define o resetea la contraseña de un usuario.
 *
 * Existe porque `crear-tenant.mts` no puede hacerlo: corre como arandano_owner
 * con `pg` pelado y no tiene de dónde sacar el hash en el formato correcto.
 * Calcularlo por su cuenta duplicaría la decisión de qué algoritmo se usa, que
 * es justo lo que este ciclo mantiene en un solo lugar.
 *
 * Es además el recupero del dueño, que no tiene a nadie arriba que le resetee
 * la clave mientras no haya proveedor de mail. No queda como un rincón sin
 * probar: es el camino que se ejercita en CADA alta de tenant.
 *
 * Corre como la aplicación (DATABASE_URL, o sea arandano_app), no como owner:
 * todo pasa por la API de Better Auth y por lo tanto por RLS.
 */
import { randomBytes } from 'node:crypto'
import { authParaTenant } from '../lib/auth/para-tenant.ts'
import { pool } from '../lib/db.ts'

export type ArgsClave = {
  tenantId: string
  email: string
  clave: string
  origen: string
}

/** Una clave legible pero no adivinable, para cuando no se pasa `--clave`. */
export function generarClave(): string {
  return randomBytes(12).toString('base64url')
}

export async function definirClave(args: ArgsClave): Promise<void> {
  const auth = authParaTenant(args.tenantId, args.origen)

  // El id se busca por la API de Better Auth y no con SQL, para que la
  // búsqueda pase por el mismo camino acotado por RLS que el resto.
  const usuarios = await auth.api.listUsers({
    query: { filterField: 'email', filterOperator: 'eq', filterValue: args.email, limit: 1 },
  }).catch(() => null)

  const usuario = usuarios && 'users' in usuarios ? usuarios.users[0] : undefined
  if (!usuario) {
    throw new Error(`no existe un usuario con el mail ${args.email} en ese tenant`)
  }

  await auth.api.setUserPassword({
    body: { newPassword: args.clave, userId: usuario.id },
  })
}
```

Si la versión instalada no expone `listUsers` / `setUserPassword` sin el plugin de admin, la implementación equivalente es: buscar el `id` con `prismaParaTenant(tenantId).user.findFirst({ where: { email } })`, y usar `auth.$context` para obtener el hasher (`ctx.password.hash`) escribiendo el `account` con `providerId: 'credential'`. **La regla que no se negocia es que el hash lo produzca Better Auth**, nunca código nuestro.

- [ ] **Step 4: Sumar el ejecutable y el script de npm**

Al final de `scripts/definir-clave.mts`:

```ts
// Sólo corre cuando se lo invoca como programa, para que el test pueda importar
// definirClave sin ejecutar nada.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const crudos = new Map<string, string>()
  for (const arg of process.argv.slice(2)) {
    const i = arg.indexOf('=')
    if (i === -1) { console.error(`error: ${arg} necesita un valor`); process.exit(2) }
    crudos.set(arg.slice(0, i), arg.slice(i + 1))
  }

  const subdominio = crudos.get('--subdominio')
  const email = crudos.get('--email')
  if (!subdominio || !email) {
    console.error('uso: npm run usuario:clave -- --subdominio=flor --email=flor@ejemplo.com [--clave=…]')
    process.exit(2)
  }

  const { rows } = await pool.query('SELECT id, nombre FROM resolver_tenant($1)', [subdominio])
  if (!rows[0]) { console.error(`error: no existe el tenant "${subdominio}"`); process.exit(1) }

  const clave = crudos.get('--clave') ?? generarClave()
  const dominio = process.env.DOMINIO_BASE ?? 'arandano.app'

  await definirClave({
    tenantId: rows[0].id,
    email,
    clave,
    origen: `https://${subdominio}.${dominio}`,
  })

  console.log(`contraseña definida para ${email} en ${rows[0].nombre}`)
  // Se imprime una sola vez y no se guarda en ningún lado: es el único momento
  // en que existe en texto plano.
  console.log(`  clave: ${clave}`)
  console.log(`  url:   https://${subdominio}.${dominio}/login`)
  await pool.end()
}
```

En `package.json`, junto a `tenant:crear`:

```json
    "usuario:clave": "node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/definir-clave.mts",
```

- [ ] **Step 5: Actualizar el mensaje de `crear-tenant.mts`, que ahora miente**

En `scripts/crear-tenant.mts`, el comentario de la línea 134 dice *"`users` no tiene columna de contraseña todavía"*. Reemplazarlo:

```ts
    // Sin credenciales: el hash lo produce Better Auth, y este script corre como
    // arandano_owner con `pg` pelado. La contraseña se define después, con
    // `npm run usuario:clave` — ver el aviso que se imprime al terminar.
```

Y en la salida, reemplazar la línea del dueño y agregar el aviso:

```ts
    console.log(`  dueño:   ${args.duenioNombre} <${args.duenio}>`)
    console.log(`  módulos: ${args.modulos.length ? args.modulos.join(', ') : '(ninguno)'}`)
    console.log('')
    console.log('FALTA la contraseña del dueño. Sin ella no puede entrar:')
    console.log(
      `  npm run usuario:clave -- --subdominio=${args.subdominio} --email=${args.duenio}`,
    )
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

```bash
npx vitest run test/auth.test.ts
```

Esperado: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/definir-clave.mts scripts/crear-tenant.mts package.json test/auth.test.ts
git commit -m "feat(auth): usuario:clave define la primera contraseña y es el recupero del dueño"
```

---

### Task 7: Administración de usuarios

**Files:**
- Create: `lib/usuarios/errores.ts`
- Create: `lib/usuarios/administrar.ts`
- Test: `test/usuarios.test.ts`

**Interfaces:**
- Consumes: `authParaTenant`, `prismaParaTenant`.
- Produces:
  - `crearEmpleado({ tenantId, origen, nombre, email, clave, rol }): Promise<{ id: string }>`
  - `resetearClave({ tenantId, origen, usuarioId, clave }): Promise<void>`
  - `desactivar({ tenantId, usuarioId }): Promise<void>`
  - `reactivar({ tenantId, usuarioId }): Promise<void>`
  - `class ErrorDeUsuario extends Error { codigo: CodigoErrorDeUsuario }`

- [ ] **Step 1: Escribir los errores**

Crear `lib/usuarios/errores.ts`:

```ts
export type CodigoErrorDeUsuario =
  | 'MAIL_REPETIDO'
  | 'ULTIMO_DUENO'
  | 'NO_EXISTE'
  | 'CLAVE_CORTA'

/**
 * Con código y no sólo con mensaje: la UI tiene que poder decidir qué mostrar
 * sin parsear strings, que es lo que se rompe en silencio al traducir un texto.
 * Mismo patrón que lib/ventas/errores.ts.
 */
export class ErrorDeUsuario extends Error {
  constructor(
    readonly codigo: CodigoErrorDeUsuario,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorDeUsuario'
  }
}
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `test/usuarios.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'
import { ErrorDeUsuario } from '@/lib/usuarios/errores'

let administrar: typeof import('@/lib/usuarios/administrar')
let authParaTenant: typeof import('@/lib/auth/para-tenant').authParaTenant

const ORIGEN = 'http://usuarios.arandano.test'
const CLAVE = 'una-clave-larga'

let owner: Client
let tenantId: string
let duenioId: string

beforeAll(async () => {
  process.env.DATABASE_URL = urlApp()
  administrar = await import('@/lib/usuarios/administrar')
  ;({ authParaTenant } = await import('@/lib/auth/para-tenant'))

  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantId = await crearTenant(owner, `usuarios-${Date.now()}`)

  const { id } = await administrar.crearEmpleado({
    tenantId, origen: ORIGEN,
    nombre: 'La dueña', email: 'duenia@ejemplo.test', clave: CLAVE, rol: 'DUENO',
  })
  duenioId = id
})

afterAll(async () => { await owner.end() })

describe('alta de empleado', () => {
  it('crea el usuario con su rol y su credencial', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Un empleado', email: 'empleado@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })

    const { rows } = await owner.query('SELECT rol FROM users WHERE id = $1', [id])
    expect(rows[0].rol).toBe('EMPLEADO')

    const r = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'empleado@ejemplo.test', password: CLAVE },
      asResponse: true,
    })
    expect(r.status).toBe(200)
  })

  it('rechaza un mail repetido dentro del mismo local', async () => {
    await expect(
      administrar.crearEmpleado({
        tenantId, origen: ORIGEN,
        nombre: 'Otro', email: 'empleado@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
      }),
    ).rejects.toMatchObject({ codigo: 'MAIL_REPETIDO' })
  })

  it('rechaza una clave más corta que 8', async () => {
    await expect(
      administrar.crearEmpleado({
        tenantId, origen: ORIGEN,
        nombre: 'Corto', email: 'corto@ejemplo.test', clave: 'abc', rol: 'EMPLEADO',
      }),
    ).rejects.toBeInstanceOf(ErrorDeUsuario)
  })

  it('el alta NO deja logueado al empleado nuevo', async () => {
    // signUpEmail devuelve una sesión. Si se dejara pasar, el dueño terminaría
    // navegando como el empleado que acaba de crear.
    const antes = await owner.query('SELECT count(*)::int n FROM sessions WHERE tenant_id = $1', [tenantId])
    await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Sin sesión', email: 'sinsesion@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    const despues = await owner.query('SELECT count(*)::int n FROM sessions WHERE tenant_id = $1', [tenantId])
    expect(despues.rows[0].n).toBe(antes.rows[0].n)
  })
})

describe('desactivar', () => {
  it('marca la fila en vez de borrarla', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Se va', email: 'seva@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await administrar.desactivar({ tenantId, usuarioId: id })

    const { rows } = await owner.query('SELECT desactivado_en FROM users WHERE id = $1', [id])
    expect(rows, 'la fila se borró; tiene que sobrevivir por las FK de ventas').toHaveLength(1)
    expect(rows[0].desactivado_en).not.toBeNull()
  })

  it('reactivar la deja como estaba', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Vuelve', email: 'vuelve@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await administrar.desactivar({ tenantId, usuarioId: id })
    await administrar.reactivar({ tenantId, usuarioId: id })

    const { rows } = await owner.query('SELECT desactivado_en FROM users WHERE id = $1', [id])
    expect(rows[0].desactivado_en).toBeNull()
  })

  it('no se puede desactivar al último dueño activo', async () => {
    // Sin esta regla, un local queda sin nadie que pueda administrar usuarios,
    // y el único arreglo es un comando en el servidor.
    await expect(
      administrar.desactivar({ tenantId, usuarioId: duenioId }),
    ).rejects.toMatchObject({ codigo: 'ULTIMO_DUENO' })
  })

  it('desactivar mata las sesiones abiertas de esa persona', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Con sesión', email: 'consesion@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'consesion@ejemplo.test', password: CLAVE }, asResponse: true,
    })
    const antes = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [id])
    expect(antes.rows[0].n).toBeGreaterThan(0)

    await administrar.desactivar({ tenantId, usuarioId: id })

    const despues = await owner.query('SELECT count(*)::int n FROM sessions WHERE user_id = $1', [id])
    expect(despues.rows[0].n).toBe(0)
  })
})

describe('resetear la clave', () => {
  it('la nueva sirve, la vieja no, y las sesiones abiertas se caen', async () => {
    const { id } = await administrar.crearEmpleado({
      tenantId, origen: ORIGEN,
      nombre: 'Olvidadizo', email: 'olvido@ejemplo.test', clave: CLAVE, rol: 'EMPLEADO',
    })
    await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'olvido@ejemplo.test', password: CLAVE }, asResponse: true,
    })

    // El id de LA sesión vieja, capturado antes del reseteo. Contar filas no
    // sirve: el login con la clave nueva crea una, y un conteo no distingue
    // "la vieja murió y nació otra" de "las dos siguen vivas".
    const previa = await owner.query('SELECT id FROM sessions WHERE user_id = $1', [id])
    expect(previa.rows, 'el login no dejó sesión; el test no probaría nada').toHaveLength(1)
    const sesionVieja: string = previa.rows[0].id

    const nueva = 'otra-clave-larga'
    await administrar.resetearClave({ tenantId, origen: ORIGEN, usuarioId: id, clave: nueva })

    // La vieja ya no existe: resetearle la clave a alguien que se fue tiene que
    // sacarlo de donde esté.
    const quedo = await owner.query('SELECT id FROM sessions WHERE id = $1', [sesionVieja])
    expect(quedo.rows, 'la sesión anterior al reseteo sobrevivió').toHaveLength(0)

    // La nueva sirve...
    const conNueva = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'olvido@ejemplo.test', password: nueva }, asResponse: true,
    })
    expect(conNueva.status).toBe(200)

    // ...y la vieja no.
    const conVieja = await authParaTenant(tenantId, ORIGEN).api.signInEmail({
      body: { email: 'olvido@ejemplo.test', password: CLAVE }, asResponse: true,
    }).catch(() => ({ status: 401 }))
    expect(conVieja.status).not.toBe(200)
  })
})
```

- [ ] **Step 3: Correr los tests y verificar que fallan**

```bash
npx vitest run test/usuarios.test.ts
```

Esperado: FAIL, no existe `@/lib/usuarios/administrar`.

- [ ] **Step 4: Escribir el módulo**

Crear `lib/usuarios/administrar.ts`:

```ts
import { authParaTenant } from '@/lib/auth/para-tenant'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { ErrorDeUsuario } from './errores'

const CLAVE_MINIMA = 8

type RolUsuario = 'DUENO' | 'EMPLEADO'

export type EntradaCrearEmpleado = {
  tenantId: string
  origen: string
  nombre: string
  email: string
  clave: string
  rol: RolUsuario
}

/**
 * Alta de una persona con su credencial.
 *
 * Pasa por signUpEmail y no por un insert propio porque el hash tiene que
 * salir de Better Auth: es la única forma de que el algoritmo viva en un solo
 * lugar. El precio es que devuelve una sesión, que se descarta — el dueño no
 * puede terminar navegando como el empleado que acaba de crear.
 *
 * El `rol` se escribe DESPUÉS y no en el alta: está declarado con `input:false`
 * justamente para que no se pueda mandar desde afuera.
 */
export async function crearEmpleado(entrada: EntradaCrearEmpleado): Promise<{ id: string }> {
  if (entrada.clave.length < CLAVE_MINIMA) {
    throw new ErrorDeUsuario('CLAVE_CORTA', `la contraseña necesita al menos ${CLAVE_MINIMA} caracteres`)
  }

  const db = prismaParaTenant(entrada.tenantId)

  // El @@unique([tenantId, email]) es la defensa real; esto sólo traduce a algo
  // legible en vez de dejar salir el error crudo.
  const yaEsta = await db.user.findFirst({ where: { email: entrada.email } })
  if (yaEsta) {
    throw new ErrorDeUsuario('MAIL_REPETIDO', `ya hay alguien con el mail ${entrada.email} en este local`)
  }

  const auth = authParaTenant(entrada.tenantId, entrada.origen)

  let id: string
  try {
    const alta = await auth.api.signUpEmail({
      body: { email: entrada.email, password: entrada.clave, name: entrada.nombre },
    })
    id = alta.user.id
  } catch (e) {
    throw new ErrorDeUsuario('MAIL_REPETIDO', e instanceof Error ? e.message : 'no se pudo dar de alta')
  }

  // La sesión que devolvió el alta se descarta: no es de quien está operando.
  await db.session.deleteMany({ where: { userId: id } })

  await db.user.update({ where: { id }, data: { rol: entrada.rol } })

  return { id }
}

export async function resetearClave(entrada: {
  tenantId: string
  origen: string
  usuarioId: string
  clave: string
}): Promise<void> {
  if (entrada.clave.length < CLAVE_MINIMA) {
    throw new ErrorDeUsuario('CLAVE_CORTA', `la contraseña necesita al menos ${CLAVE_MINIMA} caracteres`)
  }

  const db = prismaParaTenant(entrada.tenantId)
  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  const auth = authParaTenant(entrada.tenantId, entrada.origen)
  await auth.api.setUserPassword({ body: { newPassword: entrada.clave, userId: entrada.usuarioId } })

  // Sin esto, resetearle la clave a alguien que se fue no lo saca de ningún lado.
  await db.session.deleteMany({ where: { userId: entrada.usuarioId } })
}

export async function desactivar(entrada: { tenantId: string; usuarioId: string }): Promise<void> {
  const db = prismaParaTenant(entrada.tenantId)

  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  if (usuario.rol === 'DUENO') {
    const duenosActivos = await db.user.count({ where: { rol: 'DUENO', desactivadoEn: null } })
    if (duenosActivos <= 1) {
      throw new ErrorDeUsuario(
        'ULTIMO_DUENO',
        'es el último dueño activo: dejar el local sin dueño sólo se arregla con un comando en el servidor',
      )
    }
  }

  await db.user.update({ where: { id: entrada.usuarioId }, data: { desactivadoEn: new Date() } })

  // El guard ya lo rechazaría en el request siguiente; borrar las filas hace que
  // no quede una sesión válida esperando a que alguien se olvide del guard.
  await db.session.deleteMany({ where: { userId: entrada.usuarioId } })
}

export async function reactivar(entrada: { tenantId: string; usuarioId: string }): Promise<void> {
  const db = prismaParaTenant(entrada.tenantId)
  const usuario = await db.user.findUnique({ where: { id: entrada.usuarioId } })
  if (!usuario) throw new ErrorDeUsuario('NO_EXISTE', 'ese usuario no existe en este local')

  await db.user.update({ where: { id: entrada.usuarioId }, data: { desactivadoEn: null } })
}
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

```bash
npx vitest run test/usuarios.test.ts
```

Esperado: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/usuarios test/usuarios.test.ts
git commit -m "feat(usuarios): alta, reseteo y baja, sin dejar nunca un local sin dueño"
```

---

### Task 8: Tailwind y shadcn, de verdad

**Files:**
- Modify: `package.json`
- Create: `components.json`
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `components/ui/*` (los genera el CLI)
- Create: `lib/utils.ts` (lo genera el CLI)

**Interfaces:**
- Produces: los componentes `Button`, `Input`, `Label`, `Card` y `Alert` en `components/ui/`.

Esta task no agrega comportamiento: deja la infraestructura de interfaz puesta. Se verifica con el build, que es lo único que puede fallar.

- [ ] **Step 1: Instalar Tailwind v4**

```bash
npm install tailwindcss @tailwindcss/postcss postcss
```

- [ ] **Step 2: Configurar PostCSS**

Crear `postcss.config.mjs`:

```js
// Tailwind v4 se conecta por PostCSS y ya no necesita tailwind.config.js: la
// configuración del tema vive en el CSS, en app/globals.css.
const config = { plugins: { '@tailwindcss/postcss': {} } }
export default config
```

- [ ] **Step 3: Correr el init de shadcn**

```bash
npx shadcn@latest init
```

Responder: estilo por defecto, color base neutral, `app/globals.css` como archivo de CSS, y usar el alias `@/` que ya está en `tsconfig.json`.

Esperado: crea `components.json` y `lib/utils.ts`, y reescribe `app/globals.css` con `@import "tailwindcss"` y las variables de tema.

- [ ] **Step 4: Conservar lo que ya decía `globals.css`**

El init reemplaza el archivo. Volver a poner, al final, lo único que no es de Tailwind y sí importaba:

```css
/* El html/body al 100% sostiene el layout de columna que usan las pantallas.
   Estaba en la versión anterior de este archivo y se conserva. */
html,
body {
  height: 100%;
}
```

- [ ] **Step 5: Agregar los cinco componentes**

```bash
npx shadcn@latest add button input label card alert
```

Esperado: aparecen en `components/ui/`.

**No agregar `form`**: arrastra `react-hook-form` y `zod` para un formulario de dos campos, y la validación va en el servidor igual.

- [ ] **Step 6: Verificar que el build pasa**

```bash
npm run build
```

Esperado: build exitoso.

- [ ] **Step 7: Verificar que los tests siguen pasando**

```bash
npm test
```

Esperado: PASS. `app/page.test.tsx` puede necesitar ajuste si el init tocó el layout.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json postcss.config.mjs components.json components lib/utils.ts app/globals.css app/layout.tsx
git commit -m "feat(ui): Tailwind v4 y shadcn inicializados, con los cinco componentes del login"
```

---

### Task 9: La pantalla de login

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/login/formulario.tsx`
- Create: `app/login/acciones.ts`
- Create: `app/(app)/layout.tsx`
- Modify: `app/page.tsx`
- Test: `test/rutas-con-guard.test.ts`

**Interfaces:**
- Consumes: `exigirSesion`, `sesionActual` (Task 5), `authParaTenant`.
- Produces: la server action `entrar(_estado, datos: FormData)`.

- [ ] **Step 1: Escribir el test de cobertura de rutas**

Crear `test/rutas-con-guard.test.ts`. Mismo idioma que `test/rls-cobertura.test.ts`: una lista blanca escrita a mano, con su razón:

```ts
import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

// Escrita a mano a propósito: sumarle una entrada tiene que ser una decisión
// visible en el diff, no algo que el check deduzca solo. Es el mismo patrón que
// SIN_TENANT_ID en test/rls-cobertura.test.ts.
const FUERA_DEL_GRUPO: Record<string, string> = {
  'app/page.tsx':
    'sirve el ápex público y, para un tenant, llama a exigirSesion() por su cuenta; ' +
    'no puede estar en (app) porque el ápex no tiene sesión',
  'app/login/page.tsx': 'es la pantalla de login: exigir sesión para verla sería un bucle',
  'app/forbidden.tsx': 'la renderiza Next ante forbidden(); no es una ruta navegable',
}

function paginas(dir: string, acumulado: string[] = []): string[] {
  for (const entrada of readdirSync(dir)) {
    const completo = path.join(dir, entrada)
    if (statSync(completo).isDirectory()) {
      paginas(completo, acumulado)
    } else if (entrada === 'page.tsx' || entrada === 'forbidden.tsx') {
      acumulado.push(completo)
    }
  }
  return acumulado
}

describe('cobertura del guard de sesión', () => {
  const encontradas = paginas('app')

  it('encuentra páginas; si no, el test no prueba nada', () => {
    expect(encontradas.length).toBeGreaterThan(0)
  })

  it('toda página está bajo (app) o declarada en la lista blanca con su razón', () => {
    for (const p of encontradas) {
      const bajoElGrupo = p.split(path.sep).includes('(app)')
      expect(
        bajoElGrupo || Object.hasOwn(FUERA_DEL_GRUPO, p),
        `${p} no está bajo app/(app)/ y no está en la lista blanca: o le falta el ` +
          `guard, o hay que declarar por qué no lo necesita`,
      ).toBe(true)
    }
  })

  it('el layout del grupo exige sesión', () => {
    // Sin esto, el grupo existiría y no protegería nada: las páginas de adentro
    // pasarían el test de arriba sin tener guard.
    const layout = readdirSync('app/(app)')
    expect(layout).toContain('layout.tsx')
    const fuente = require('node:fs').readFileSync('app/(app)/layout.tsx', 'utf8')
    expect(fuente).toContain('exigirSesion')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
npx vitest run test/rutas-con-guard.test.ts
```

Esperado: FAIL, no existe `app/(app)`.

- [ ] **Step 3: Escribir la server action del login**

Crear `app/login/acciones.ts`:

```ts
'use server'

import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { authParaTenant } from '@/lib/auth/para-tenant'
import { origenDelRequest } from '@/lib/auth/origen'
import { prismaParaTenant } from '@/lib/tenant/prisma'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

export type EstadoLogin = { error: string | null }

/**
 * Un solo mensaje para "no existe ese mail" y para "la contraseña está mal".
 * Distinguirlos convertiría el login en un oráculo de qué mails trabajan en este
 * local, que es justo lo que no queremos publicar.
 */
const GENERICO = 'Mail o contraseña incorrectos.'

export async function entrar(_estado: EstadoLogin, datos: FormData): Promise<EstadoLogin> {
  const email = String(datos.get('email') ?? '').trim()
  const clave = String(datos.get('clave') ?? '')
  if (!email || !clave) return { error: GENERICO }

  const resolucion = await tenantDelRequest()
  if (resolucion.tipo !== 'tenant') return { error: GENERICO }
  if (resolucion.tenant.estado === 'SUSPENDIDO') {
    return { error: 'Esta cuenta está suspendida.' }
  }

  const origen = await origenDelRequest()
  const auth = authParaTenant(resolucion.tenant.id, origen)

  // SIN asResponse: el plugin nextCookies() de authParaTenant es el que escribe
  // la cookie en la respuesta de la action. Con asResponse habría que propagar
  // el Set-Cookie a mano, y olvidarse de hacerlo da el peor síntoma posible —
  // el login responde bien y el navegador se queda sin sesión.
  try {
    await auth.api.signInEmail({
      body: { email, password: clave },
      headers: await headers(),
    })
  } catch (e) {
    // 429 es rate limit; cualquier otra cosa es credencial inválida y sale por
    // el mensaje genérico.
    const status = e && typeof e === 'object' && 'status' in e ? e.status : undefined
    if (status === 429 || status === 'TOO_MANY_REQUESTS') {
      return { error: 'Demasiados intentos. Esperá un minuto y volvé a probar.' }
    }
    return { error: GENERICO }
  }

  // Recién acá, con la contraseña ya validada, se puede decir que la cuenta está
  // desactivada: quien llegó hasta este punto demostró que la cuenta es suya, así
  // que el mensaje no filtra nada. Y le ahorra media hora pensando que se
  // equivocó de tecla.
  const db = prismaParaTenant(resolucion.tenant.id)
  const usuario = await db.user.findFirst({ where: { email } })
  if (usuario?.desactivadoEn) {
    await db.session.deleteMany({ where: { userId: usuario.id } })
    return { error: 'Tu usuario está desactivado. Pedile al dueño que lo reactive.' }
  }

  // redirect() tira una excepción de control de Next, así que va FUERA del
  // try: adentro, el catch la tomaría por un login fallido.
  redirect('/')
}
```

- [ ] **Step 4: Escribir la pantalla, en dos archivos**

La pantalla se parte en un componente de servidor y uno de cliente, y no es
ceremonia: el formulario necesita `useActionState`, que obliga a `'use client'`,
y el nombre del local sale de `tenantDelRequest()`, que sólo corre en el
servidor.

Además hay una razón operativa. `scripts/smoke.sh` verifica hoy que el tenant
resolvió **al correcto** buscando `data-testid="tenant-nombre">NOMBRE` en la home.
Con el guard puesto, esa home redirige al login y el caso se rompería. Mostrar el
nombre del local acá no sólo conserva esa verificación: la mejora, porque además
es lo que le confirma a un empleado que está entrando a su negocio y no al de al
lado.

Crear `app/login/page.tsx`:

```tsx
import { notFound, forbidden, redirect } from 'next/navigation'
import { tenantDelRequest } from '@/lib/tenant/desde-request'
import { sesionActual } from '@/lib/auth/sesion'
import { FormularioLogin } from './formulario'

export const dynamic = 'force-dynamic'

export default async function Login() {
  const resolucion = await tenantDelRequest()

  // No hay login en el ápex: entrar es siempre entrar a un local.
  if (resolucion.tipo !== 'tenant') notFound()
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // Ya logueado, esta pantalla no tiene sentido.
  if (await sesionActual()) redirect('/')

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <FormularioLogin nombreDelLocal={resolucion.tenant.nombre} />
    </main>
  )
}
```

Crear `app/login/formulario.tsx`:

```tsx
'use client'

import { useActionState } from 'react'
import { entrar, type EstadoLogin } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

const INICIAL: EstadoLogin = { error: null }

export function FormularioLogin({ nombreDelLocal }: { nombreDelLocal: string }) {
  const [estado, accion, pendiente] = useActionState(entrar, INICIAL)

  return (
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* El testid lo consume scripts/smoke.sh para verificar que el
              subdominio resolvió al tenant correcto. Si se saca de acá, hay que
              mover ese caso del gate en el mismo commit. */}
          <CardTitle data-testid="tenant-nombre">{nombreDelLocal}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={accion} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Mail</Label>
              {/* autoFocus: en un mostrador se entra tipeando, sin tocar el mouse. */}
              <Input id="email" name="email" type="email" autoComplete="username" autoFocus required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="clave">Contraseña</Label>
              <Input id="clave" name="clave" type="password" autoComplete="current-password" required />
            </div>

            {estado.error && (
              <Alert variant="destructive">
                <AlertDescription>{estado.error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={pendiente}>
              {pendiente ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>
        </CardContent>
      </Card>
  )
}
```

- [ ] **Step 5: Escribir el layout del grupo**

Crear `app/(app)/layout.tsx`:

```tsx
import { exigirSesion } from '@/lib/auth/sesion'

// Todas las pantallas de adentro heredan este guard: una ruta nueva bajo (app)
// queda protegida sin que nadie se acuerde de nada. test/rutas-con-guard.test.ts
// falla si alguna pantalla queda afuera del grupo sin declarar por qué.
export const dynamic = 'force-dynamic'

export default async function LayoutApp({ children }: { children: React.ReactNode }) {
  const sesion = await exigirSesion()

  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-medium">{sesion.tenant.nombre}</span>
        <span className="text-sm text-muted-foreground">
          {sesion.usuario.nombre} · {sesion.usuario.rol === 'DUENO' ? 'Dueño' : 'Empleado'}
        </span>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  )
}
```

- [ ] **Step 6: Poner `app/page.tsx` detrás de la sesión**

En `app/page.tsx`, reemplazar el cuerpo de `Home`:

```tsx
export default async function Home() {
  const resolucion = await tenantDelRequest()

  if (resolucion.tipo === 'apex') return <PaginaApex />

  if (resolucion.tipo !== 'tenant') notFound()
  if (resolucion.tenant.estado === 'SUSPENDIDO') forbidden()

  // `/` no puede vivir bajo (app): el ápex entra por la misma ruta y no tiene
  // sesión. Por eso el guard se llama acá a mano, y por eso esta página está en
  // la lista blanca de test/rutas-con-guard.test.ts con esa razón escrita.
  const sesion = await exigirSesion()

  return <PaginaTenant tenant={resolucion.tenant} usuario={sesion.usuario} />
}
```

Agregar el import de `exigirSesion` arriba, y reemplazar `PaginaTenant`:

```tsx
function PaginaTenant({
  tenant,
  usuario,
}: {
  tenant: TenantResuelto
  usuario: { nombre: string; rol: 'DUENO' | 'EMPLEADO' }
}) {
  return (
    <main className="p-6">
      <h1 className="mb-2 text-xl font-medium">{tenant.nombre}</h1>
      <p className="mb-6 text-sm text-muted-foreground" data-testid="usuario-nombre">
        Hola, {usuario.nombre}.
      </p>
      {usuario.rol === 'DUENO' && (
        <a className="underline" href="/usuarios">
          Usuarios
        </a>
      )}
      <Contexto />
    </main>
  )
}
```

El `estilo` en línea y el `<dl>` con `tenant-nombre` / `tenant-estado` salen de
acá: eran la verificación humana de un deploy sobre una página sin CSS, y el
`tenant-nombre` **se mudó a la pantalla de login** en el Step 4, que es donde
ahora llega quien no tiene sesión. `Contexto` se queda —el stack y el SHA siguen
siendo la comprobación más barata después de un deploy— y `app/page.test.tsx`
hay que actualizarlo en consecuencia.

- [ ] **Step 7: Correr los tests**

```bash
npx vitest run test/rutas-con-guard.test.ts && npm test
```

Esperado: PASS. `app/page.test.tsx` necesita actualizarse: ahora `/` de un tenant sin sesión redirige.

- [ ] **Step 8: Verificar a mano contra `arandano-dev`**

Levantar el stack de dev, crear un tenant de prueba con `npm run tenant:crear`, definir la clave con `npm run usuario:clave`, y entrar por el navegador desde la IP de Tailscale.

Esperado: sin sesión, `/` redirige a `/login`; con la clave correcta, entra; con una equivocada, un solo mensaje genérico.

- [ ] **Step 9: Commit**

```bash
git add app/login app/\(app\) app/page.tsx app/page.test.tsx test/rutas-con-guard.test.ts
git commit -m "feat(ui): pantalla de login, y un test que no deja quedar una ruta sin guard"
```

---

### Task 10: La pantalla de usuarios

**Files:**
- Create: `app/(app)/usuarios/page.tsx`
- Create: `app/(app)/usuarios/acciones.ts`
- Create: `app/(app)/usuarios/formularios.tsx`

**Interfaces:**
- Consumes: `exigirDuenio` (Task 5), `crearEmpleado`, `resetearClave`, `desactivar`, `reactivar` (Task 7).

- [ ] **Step 1: Escribir las server actions**

Crear `app/(app)/usuarios/acciones.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { exigirDuenio } from '@/lib/auth/sesion'
import { origenDelRequest } from '@/lib/auth/origen'
import { crearEmpleado, resetearClave, desactivar, reactivar } from '@/lib/usuarios/administrar'
import { ErrorDeUsuario } from '@/lib/usuarios/errores'

export type EstadoUsuarios = { error: string | null; aviso: string | null }

const INICIAL: EstadoUsuarios = { error: null, aviso: null }

/** Cada action vuelve a exigir dueño: que la pantalla no se muestre no es una
 *  defensa, porque una action se puede invocar sin pasar por la pantalla. */
async function comoDuenio<T>(fn: (tenantId: string, origen: string) => Promise<T>) {
  const sesion = await exigirDuenio()
  const origen = await origenDelRequest()
  return fn(sesion.tenant.id, origen)
}

function traducir(e: unknown): EstadoUsuarios {
  if (e instanceof ErrorDeUsuario) return { error: e.message, aviso: null }
  throw e
}

export async function altaEmpleado(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    const clave = String(datos.get('clave') ?? '')
    await comoDuenio((tenantId, origen) =>
      crearEmpleado({
        tenantId,
        origen,
        nombre: String(datos.get('nombre') ?? '').trim(),
        email: String(datos.get('email') ?? '').trim(),
        clave,
        rol: datos.get('rol') === 'DUENO' ? 'DUENO' : 'EMPLEADO',
      }),
    )
    revalidatePath('/usuarios')
    // La clave se muestra una sola vez: es el único momento en que existe en
    // texto plano, y el dueño se la tiene que pasar a la persona.
    return { error: null, aviso: `Usuario creado. Su contraseña es: ${clave}` }
  } catch (e) {
    return traducir(e)
  }
}

export async function nuevaClave(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    const clave = String(datos.get('clave') ?? '')
    await comoDuenio((tenantId, origen) =>
      resetearClave({ tenantId, origen, usuarioId: String(datos.get('usuarioId')), clave }),
    )
    revalidatePath('/usuarios')
    return { error: null, aviso: `Contraseña cambiada. La nueva es: ${clave}` }
  } catch (e) {
    return traducir(e)
  }
}

export async function baja(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    await comoDuenio((tenantId) => desactivar({ tenantId, usuarioId: String(datos.get('usuarioId')) }))
    revalidatePath('/usuarios')
    return { error: null, aviso: 'Usuario desactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

export async function alta(_e: EstadoUsuarios, datos: FormData): Promise<EstadoUsuarios> {
  try {
    await comoDuenio((tenantId) => reactivar({ tenantId, usuarioId: String(datos.get('usuarioId')) }))
    revalidatePath('/usuarios')
    return { error: null, aviso: 'Usuario reactivado.' }
  } catch (e) {
    return traducir(e)
  }
}

export { INICIAL }
```

- [ ] **Step 2: Escribir la pantalla**

Crear `app/(app)/usuarios/page.tsx`: un componente de servidor que llama a `exigirDuenio()`, lista los usuarios con `prismaParaTenant(sesion.tenant.id).user.findMany({ orderBy: { nombre: 'asc' } })`, y renderiza una tabla con nombre, mail, rol y estado, más los formularios que invocan las actions del Step 1. Usa `Card`, `Input`, `Label`, `Button` y `Alert`.

```tsx
import { exigirDuenio } from '@/lib/auth/sesion'
import { prismaParaTenant } from '@/lib/tenant/prisma'

export const dynamic = 'force-dynamic'

export default async function Usuarios() {
  const sesion = await exigirDuenio()
  const usuarios = await prismaParaTenant(sesion.tenant.id).user.findMany({
    orderBy: { nombre: 'asc' },
    select: { id: true, nombre: true, email: true, rol: true, desactivadoEn: true },
  })

  return (
    <main className="p-6">
      <h1 className="mb-6 text-xl font-medium">Usuarios</h1>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="py-2">Nombre</th>
            <th>Mail</th>
            <th>Rol</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-2">{u.nombre}</td>
              <td>{u.email}</td>
              <td>{u.rol === 'DUENO' ? 'Dueño' : 'Empleado'}</td>
              <td>{u.desactivadoEn ? 'Desactivado' : 'Activo'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <AltaDeEmpleado />
    </main>
  )
}
```

En la tabla, cada fila suma una celda con sus acciones:

```tsx
            <td>
              <AccionesDeUsuario
                usuarioId={u.id}
                desactivado={u.desactivadoEn !== null}
                esUnoMismo={u.id === sesion.usuario.id}
              />
            </td>
```

Y crear `app/(app)/usuarios/formularios.tsx`, que es donde vive el `'use client'`:

```tsx
'use client'

import { useActionState } from 'react'
import { altaEmpleado, nuevaClave, baja, alta, INICIAL, type EstadoUsuarios } from './acciones'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** El aviso lleva la contraseña en texto plano y es el único momento en que
 *  existe: el dueño la tiene que copiar y pasársela a la persona. */
function Resultado({ estado }: { estado: EstadoUsuarios }) {
  if (estado.error) {
    return <Alert variant="destructive"><AlertDescription>{estado.error}</AlertDescription></Alert>
  }
  if (estado.aviso) {
    return <Alert><AlertDescription>{estado.aviso}</AlertDescription></Alert>
  }
  return null
}

export function AltaDeEmpleado() {
  const [estado, accion, pendiente] = useActionState(altaEmpleado, INICIAL)

  return (
    <Card className="mt-8 max-w-md">
      <CardHeader><CardTitle>Agregar a alguien</CardTitle></CardHeader>
      <CardContent>
        <form action={accion} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nombre">Nombre</Label>
            <Input id="nombre" name="nombre" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Mail</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="clave">Contraseña inicial</Label>
            {/* minLength 8 acompaña al chequeo del servidor, no lo reemplaza:
                la validación del navegador se saltea con dos clicks. */}
            <Input id="clave" name="clave" type="text" minLength={8} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="rol">Rol</Label>
            <select id="rol" name="rol" className="h-9 rounded-md border px-3 text-sm">
              <option value="EMPLEADO">Empleado</option>
              <option value="DUENO">Dueño</option>
            </select>
          </div>
          <Resultado estado={estado} />
          <Button type="submit" disabled={pendiente}>
            {pendiente ? 'Creando…' : 'Crear'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

export function AccionesDeUsuario({
  usuarioId,
  desactivado,
  esUnoMismo,
}: {
  usuarioId: string
  desactivado: boolean
  esUnoMismo: boolean
}) {
  const [estadoClave, accionClave, claveEnCurso] = useActionState(nuevaClave, INICIAL)
  const [estadoEstado, accionEstado, estadoEnCurso] = useActionState(
    desactivado ? alta : baja,
    INICIAL,
  )

  return (
    <div className="flex flex-col gap-2 py-2">
      <form action={accionClave} className="flex items-center gap-2">
        <input type="hidden" name="usuarioId" value={usuarioId} />
        <Input name="clave" type="text" minLength={8} required placeholder="Nueva contraseña" />
        <Button type="submit" variant="outline" disabled={claveEnCurso}>
          Cambiar
        </Button>
      </form>

      {/* Desactivarse a uno mismo no se ofrece: la regla del último dueño ya lo
          impediría en el servidor, pero un botón que siempre falla es peor que
          ningún botón. */}
      {!esUnoMismo && (
        <form action={accionEstado}>
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <Button type="submit" variant="outline" disabled={estadoEnCurso}>
            {desactivado ? 'Reactivar' : 'Desactivar'}
          </Button>
        </form>
      )}

      <Resultado estado={estadoClave} />
      <Resultado estado={estadoEstado} />
    </div>
  )
}
```

Y en `page.tsx`, importar los dos componentes de `./formularios`.

- [ ] **Step 3: Verificar que el build pasa y los tests siguen verdes**

```bash
npm run build && npm test
```

Esperado: PASS. `test/rutas-con-guard.test.ts` acepta la pantalla nueva sin cambios, porque está bajo `(app)`.

- [ ] **Step 4: Verificar a mano contra `arandano-dev`**

Entrar como dueño, crear un empleado, entrar con ese empleado en otra ventana, verificar que **no** ve `/usuarios` (403), desactivarlo desde la ventana del dueño y comprobar que el empleado queda afuera al recargar.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/usuarios
git commit -m "feat(ui): administración de usuarios, con cada action revalidando el rol por su cuenta"
```

---

### Task 11: El gate y la documentación

**Files:**
- Modify: `scripts/smoke.sh`
- Modify: `scripts/verify-infra.sh`
- Modify: `CLAUDE.md`
- Modify: `docs/runbook-stacks.md`
- Modify: `docs/superpowers/specs/2026-08-08-resolucion-tenant-design.md`

- [ ] **Step 1: Arreglar los dos casos que este ciclo rompe, y sumar el del guard**

Éste es el paso más delicado del plan, porque **no es agregar cobertura: es que
el gate deja de pasar si no se toca.** `caso_tenant_resuelve` y
`caso_tenant_no_cacheable` piden `/` con el Host del canario, y con el guard esa
ruta ahora redirige. Los dos apuntan a `/login`, que es la página de tenant que
sirve el mismo propósito: renderiza dinámicamente y muestra el nombre del local.

En `scripts/smoke.sh`, reemplazar `caso_tenant_resuelve`:

```bash
# Contra /login y no contra /: desde el ciclo de autenticación, / exige sesión y
# redirige. /login es ahora la página de tenant que se puede pedir sin
# credenciales, y muestra el nombre del local exactamente por esto. El grep -F
# contra "testid>nombre" y no sólo contra el testid suelto se conserva: una
# regresión que renderizara el tenant equivocado tiene que hacer fallar esto.
caso_tenant_resuelve() {
  curl -fsS --max-time 10 -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/login" \
    | grep -qF "data-testid=\"tenant-nombre\">${NOMBRE_CANARIO}"
}
```

Y en `caso_tenant_no_cacheable`, cambiar `"$URL_BASE/"` por `"$URL_BASE/login"`,
por el mismo motivo: sobre una redirección se estarían midiendo los headers del
307 y no los de una página de tenant.

Después, los dos casos nuevos:

```bash
# Sin sesión, la home de un tenant no puede servir la aplicación: tiene que
# mandar al login. Si esto devolviera 200, el guard no estaría puesto — y sería
# indistinguible de que sí lo está, porque la página renderiza igual.
caso_home_exige_sesion() {
  local destino
  destino=$(curl -s -o /dev/null --max-time 10 -w '%{redirect_url}' \
    -H "Host: ${SUBDOMINIO_CANARIO}.${DOMINIO_BASE}" "$URL_BASE/")
  [[ "$destino" == */login ]]
}

# El ápex no tiene login, y no puede delatar nada distinto de una ruta que no
# existe. CLAUDE.md ya tenía anotado que los casos de login entran acá cuando
# exista el login; éste y el de arriba son los primeros.
caso_login_no_existe_en_apex() {
  local code
  code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' \
    -H "Host: ${DOMINIO_BASE}" "$URL_BASE/login")
  [[ "$code" == "404" ]]
}
```

Y agregar los dos nombres nuevos a la lista del `for caso in \` del final.

- [ ] **Step 2: Sumar `BETTER_AUTH_SECRET` a `verify-infra.sh env`**

Justo después del bloque de `DATABASE_URL` (alrededor de la línea 336), con el
mismo `check_ne` que ya se usa ahí:

```bash
  # Es el secreto con el que se firman las sesiones. Compartido entre dev y
  # prod, una cookie fabricada en dev valdría contra los datos de clientes.
  local secreto_dev secreto_prod
  secreto_dev=$(docker exec arandano-dev-app-1 printenv BETTER_AUTH_SECRET 2>/dev/null || echo '')
  secreto_prod=$(docker exec arandano-prod-app-1 printenv BETTER_AUTH_SECRET 2>/dev/null || echo '')

  # La presencia se chequea aparte y ANTES de compararlos: dos vacíos son
  # distintos de nada y check_ne los daría por buenos, que es exactamente el
  # falso verde que este caso existe para evitar.
  check_cmd "dev tiene BETTER_AUTH_SECRET" test -n "$secreto_dev"
  check_cmd "prod tiene BETTER_AUTH_SECRET" test -n "$secreto_prod"
  check_ne "dev y prod no comparten BETTER_AUTH_SECRET" "$secreto_dev" "$secreto_prod"
```

- [ ] **Step 3: Correr los smoke tests contra dev**

```bash
scripts/smoke.sh http://100.64.81.63:3001 "$(git rev-parse HEAD)" arandano.test canario "Canario"
```

Esperado: los dos casos nuevos en verde. (Ajustar la URL y el dominio al stack de dev real; ver `docs/runbook-stacks.md`.)

- [ ] **Step 4: Corregir CLAUDE.md**

Tres lugares:

1. En la tabla de stack, la fila **Autenticación**: `Better Auth` en lugar de `Auth.js (NextAuth)`, con el motivo — Auth.js no maneja contraseñas en serio, y un magic link en un mostrador significa abrir el mail para entrar a cobrar.
2. En *Próximos pasos técnicos*, tachar `Configurar Auth.js` y reemplazarlo por la línea de hecho, con fecha y con el puntero al spec.
3. En *Opciones evaluadas y descartadas*, sumar **Clerk**: qué lo hacía atractivo, y por qué no — un tercero en el camino de cobrar, US$1 por tenant por mes pasadas las 100 organizaciones contra comercios que pagan en pesos, y el chequeo de pertenencia queda nuestro igual.
4. En la lista de *Próximos pasos*, marcar **shadcn/ui** como inicializado, que era el ítem que decía "hoy está a medias".

- [ ] **Step 5: Actualizar `docs/runbook-stacks.md`**

Sumar `BETTER_AUTH_SECRET` a las variables por stack, y una sección corta con el alta de un usuario:

```bash
npm run tenant:crear -- --subdominio=flor --nombre="Flor Celulares" \
  --duenio=flor@ejemplo.com --duenio-nombre="Flor"
npm run usuario:clave -- --subdominio=flor --email=flor@ejemplo.com
```

Y la nota de que la clave se imprime **una sola vez**.

- [ ] **Step 6: Corregir la mención en el spec anterior**

`docs/superpowers/specs/2026-08-08-resolucion-tenant-design.md` dice que el ciclo siguiente resuelve la identidad "con Auth.js". Cambiarlo por Better Auth, con el puntero al spec de este ciclo.

- [ ] **Step 7: Correr la suite entera y el build**

```bash
npm test && npm run build
```

Esperado: PASS.

- [ ] **Step 8: Commit**

```bash
git add scripts/smoke.sh scripts/verify-infra.sh CLAUDE.md docs/runbook-stacks.md docs/superpowers/specs/2026-08-08-resolucion-tenant-design.md
git commit -m "docs(auth): el gate cubre el login, y CLAUDE.md deja de decir Auth.js"
```

---

## Lo que este plan no construye

Del spec, repetido acá para que no se lea como olvido: recupero por mail, verificación de mail, OAuth, 2FA, PIN de mostrador para el cambio de turno, permisos finos más allá de `DUENO` / `EMPLEADO`, alta self-service de tenants, y cortar sesiones cuando un tenant se suspende (el guard ya rechaza a un tenant `SUSPENDIDO`, pero las filas de `sessions` quedan).

Al terminar, un empleado entra por el navegador a su local, no puede entrar al de al lado, y el dueño lo administra desde una pantalla. El ABM de artículos y el punto de venta son los ciclos que siguen.

## Riesgos que la implementación tiene que confirmar

Están en el spec y se repiten acá porque son decisiones que se toman **durante** las tasks, no antes:

1. **El costo de una instancia de Better Auth por tenant** (Task 3). Si la memoización no alcanza, la salida es `AsyncLocalStorage` con una instancia global.
2. **Si Better Auth emite queries fuera del contexto de un request** (Task 3). Con RLS, esa query no vería nada.
3. **La forma exacta del schema core** en la versión instalada (Task 1). Si difiere de lo que declara este plan, manda la librería.
4. **Cómo se propaga `Set-Cookie` desde una server action** (Task 9). Las dos formas soportadas están escritas ahí; hay que elegir una y borrar la otra.
5. **Si `listUsers` / `setUserPassword` existen sin el plugin de admin** (Task 6). La alternativa está escrita en esa task.
