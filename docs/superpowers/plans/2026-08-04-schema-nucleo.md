# Schema del núcleo y aislamiento multi-tenant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar la primera migración de Prisma en pie, con cinco modelos del núcleo aislados por Row Level Security que efectivamente aplica, y con tests que lo demuestran.

**Architecture:** Dos roles de Postgres (`arandano_owner` dueño y migrador, `arandano_app` sin privilegios) creados por un script idempotente fuera de las migraciones. Cada tabla con `tenant_id` lleva una policy que compara contra la GUC `arandano.tenant_id`, que la app fija con `set_config(…, true)` dentro de la transacción de cada operación. Prisma se conecta por driver adapter reusando el `pg.Pool` que ya existe en `lib/db.ts`.

**Tech Stack:** Prisma 7.9.1 (`prisma`, `@prisma/client`, `@prisma/adapter-pg`), PostgreSQL 17, Next.js 16, vitest 4, bash.

**Spec:** `docs/superpowers/specs/2026-08-04-schema-nucleo-design.md`

## Global Constraints

- **Versiones exactas:** `prisma@7.9.1`, `@prisma/client@7.9.1`, `@prisma/adapter-pg@7.9.1`. La 7 no tiene query engine nativo y **exige** driver adapter en el constructor del cliente.
- **En Prisma 7 el bloque `datasource` de `schema.prisma` NO lleva `url`.** La URL vive en `prisma.config.ts`, que sólo lee el CLI. Ese archivo **no** carga `.env` por su cuenta.
- **La URL del CLI es `MIGRATE_DATABASE_URL` (rol owner). La de la app es `DATABASE_URL` (rol `arandano_app`).** Nunca al revés, en ningún archivo.
- **Generador:** `provider = "prisma-client"` (no `prisma-client-js`), `output = "../generated/prisma"`, `importFileExtension = ""`.
- **Nombres en la base en snake_case**, vía `@map` / `@@map`. Los nombres de los modelos en TypeScript quedan en PascalCase.
- **IDs `uuid v7`** (`@default(uuid(7)) @db.Uuid`). Plata en `Decimal @db.Decimal(12,2)`, nunca `Float`.
- **Postgres efímero de tests:** `postgres:17-alpine`, `--memory=512m --cpus=0.5`, `--tmpfs /var/lib/postgresql/data:size=320m,mode=1777`, `PGDATA=/var/lib/postgresql/data/pgdata`. Estos valores están medidos, no elegidos: ver el comentario en `scripts/verify-backup.sh:108`.
- **Esperar al Postgres DEFINITIVO**, no al temporal de initdb: la señal es la **segunda** aparición de `database system is ready to accept connections` en los logs. `pg_isready` responde en verde contra los dos.
- **No tocar el `include` de `vitest.config.mts`.** El archivo ya documenta por qué abarca todo el repo.
- **Comentarios, mensajes de commit y salida de los scripts en español.**
- **Cada commit termina con:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Nunca** correr `prisma migrate reset` ni `prisma db push` contra `arandano-prod`.
- **Los pasos que tocan `arandano-dev`, `arandano-prod` o `/srv/arandano/prod/` operan sobre estado compartido de la máquina, no sobre el worktree.** `docker/compose.dev.yml` monta `../:/app`: recrear la app de dev desde un worktree la deja sirviendo el código del worktree, y cuando ese worktree se borre, dev queda con un bind mount a un directorio que ya no existe. Mientras dura el plan es lo que se quiere —dev sirve la rama— pero **después del merge hay que recrear `arandano-dev` desde `/root/arandano`**, y eso está en la verificación final.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `test/postgres-efimero.ts` | Levantar y bajar el Postgres descartable; construir las URLs de cada rol |
| `test/global-setup.ts` | Enganchar lo anterior al ciclo de vida de vitest |
| `test/datos.ts` | Helpers de datos para los tests (`crearTenant`, `limpiarDatos`) |
| `scripts/setup-db-roles.sh` | Crear los dos roles, sus grants y los default privileges. Idempotente |
| `prisma/schema.prisma` | Los cinco modelos y su mapeo a snake_case |
| `prisma.config.ts` | Configuración del CLI: schema, migraciones y URL del owner |
| `prisma/migrations/*/migration.sql` | DDL generado **más** las policies escritas a mano |
| `lib/db.ts` *(modificado)* | Sigue siendo el único pool; ahora también construye el cliente Prisma |
| `lib/tenant/prisma.ts` | `prismaParaTenant(tenantId)`: el cliente extendido |
| `lib/health/checks.ts` *(modificado)* | Suma el check de identidad del rol de conexión |
| `docker/compose.{dev,stage,prod}.yml`, `.env.example` *(modificados)* | Las dos URLs por stack |
| `Dockerfile` *(modificado)* | `prisma generate` en el build y la etapa `migrate` |
| `scripts/verify-infra.sh` *(modificado)* | Comprobar que la app de cada stack no corre como superusuario |

---

### Task 1: Postgres efímero para los tests

Todo lo que sigue se prueba contra una base de verdad: el comportamiento que se está verificando **es** el de Postgres, y un mock no tiene RLS.

**Files:**
- Create: `test/postgres-efimero.ts`
- Create: `test/global-setup.ts`
- Create: `test/postgres-efimero.test.ts`
- Modify: `vitest.config.mts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `CONTENEDOR: string`, `PUERTO: number`, `BASE: string`, `SUPERUSUARIO: string`
  - `urlSuperusuario(): string`, `urlOwner(): string`, `urlApp(): string`
  - `PASSWORD_OWNER: string`, `PASSWORD_APP: string`
  - `levantar(): Promise<void>`, `bajar(): Promise<void>`

- [ ] **Step 1: Escribir el test que falla**

Crear `test/postgres-efimero.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { Client } from 'pg'
import { BASE, urlSuperusuario } from './postgres-efimero'

describe('Postgres efímero de los tests', () => {
  it('acepta conexiones y es la base descartable, no la de dev', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        'SELECT current_database() AS db, current_setting($1) AS version',
        ['server_version'],
      )
      expect(rows[0].db).toBe(BASE)
      // Paranoia deliberada: si esto alguna vez apunta a dev, los tests
      // borrarían trabajo en curso de alguien.
      expect(rows[0].db).not.toBe('arandano_dev')
      expect(rows[0].version.startsWith('17')).toBe(true)
    } finally {
      await cliente.end()
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/postgres-efimero.test.ts`
Expected: FAIL — no existe `./postgres-efimero`.

- [ ] **Step 3: Escribir el helper del contenedor**

Crear `test/postgres-efimero.ts`:

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const ejecutar = promisify(execFile)

export const CONTENEDOR = 'arandano-test-pg'
export const BASE = 'arandano_test'
export const SUPERUSUARIO = 'arandano_test_super'
export const PUERTO = 55432

const PASSWORD_SUPER = 'efimero-no-persiste'
export const PASSWORD_OWNER = 'efimero-owner'
export const PASSWORD_APP = 'efimero-app'

// 127.0.0.1 y no 0.0.0.0: Docker escribe reglas de iptables que se saltean
// ufw, así que el bind explícito es la defensa real. Ver compose.dev.yml.
function url(usuario: string, password: string): string {
  return `postgres://${usuario}:${password}@127.0.0.1:${PUERTO}/${BASE}`
}

export const urlSuperusuario = () => url(SUPERUSUARIO, PASSWORD_SUPER)
export const urlOwner = () => url('arandano_owner', PASSWORD_OWNER)
export const urlApp = () => url('arandano_app', PASSWORD_APP)

async function contadorListo(): Promise<number> {
  try {
    const { stdout, stderr } = await ejecutar('docker', ['logs', CONTENEDOR])
    const salida = stdout + stderr
    return salida.split('database system is ready to accept connections').length - 1
  } catch {
    return 0
  }
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function levantar(): Promise<void> {
  await ejecutar('docker', ['rm', '-f', CONTENEDOR]).catch(() => {})

  // Los valores de memoria y tmpfs están medidos, no elegidos: las páginas de
  // tmpfs cuentan 1:1 contra el límite del cgroup, así que igualarlos hace que
  // el contenedor muera por OOM antes de llenar el tmpfs. Ver el comentario en
  // scripts/verify-backup.sh.
  await ejecutar('docker', [
    'run', '-d', '--name', CONTENEDOR,
    '--memory=512m', '--cpus=0.5',
    '--tmpfs', '/var/lib/postgresql/data:size=320m,mode=1777',
    '-e', `POSTGRES_USER=${SUPERUSUARIO}`,
    '-e', `POSTGRES_PASSWORD=${PASSWORD_SUPER}`,
    '-e', `POSTGRES_DB=${BASE}`,
    '-e', 'PGDATA=/var/lib/postgresql/data/pgdata',
    '-p', `127.0.0.1:${PUERTO}:5432`,
    'postgres:17-alpine',
  ])

  // NO alcanza con el primer pg_isready en verde: el entrypoint levanta un
  // servidor TEMPORAL para correr los scripts de init, lo apaga, y recién ahí
  // arranca el DEFINITIVO. pg_isready contesta igual contra los dos. La señal
  // inequívoca es la SEGUNDA aparición de esta línea de log.
  for (let i = 0; i < 60; i++) {
    if ((await contadorListo()) >= 2) return
    await dormir(1000)
  }
  throw new Error(`el Postgres efímero (${CONTENEDOR}) no levantó en 60s`)
}

export async function bajar(): Promise<void> {
  await ejecutar('docker', ['rm', '-f', CONTENEDOR]).catch(() => {})
}
```

- [ ] **Step 4: Engancharlo a vitest**

Crear `test/global-setup.ts`:

```ts
import { levantar, bajar } from './postgres-efimero'

export async function setup(): Promise<void> {
  await levantar()
}

export async function teardown(): Promise<void> {
  await bajar()
}
```

Modificar `vitest.config.mts`, agregando dentro de `test:` (sin tocar `include`):

```ts
    globalSetup: ['./test/global-setup.ts'],
    // Todos los archivos de test comparten UNA sola base efímera. En paralelo
    // se pisarían los datos entre sí, y peor: los tests de roles cambian
    // atributos del rol que otros archivos están usando en ese momento. El
    // costo es tiempo de pared; la alternativa es intermitencia, que en el gate
    // de deploy se lee como "los tests son flaky" y termina en que se ignoran.
    fileParallelism: false,
    // Levantar el contenedor y esperar al servidor definitivo se lleva la mayor
    // parte de este presupuesto.
    hookTimeout: 120_000,
    testTimeout: 30_000,
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npx vitest run test/postgres-efimero.test.ts`
Expected: PASS. La primera corrida tarda ~20s (baja la imagen si no está).

- [ ] **Step 6: Verificar que la suite completa sigue verde**

Run: `npm test`
Expected: PASS — los tests del healthcheck que ya existían siguen pasando.

- [ ] **Step 7: Commit**

```bash
git add test/ vitest.config.mts
git commit -m "$(cat <<'EOF'
test: Postgres efímero para los tests de integración

Levanta un postgres:17-alpine descartable en el globalSetup de vitest, con
los mismos valores de memoria y tmpfs que verify-backup.sh ya tiene medidos.

Espera a la SEGUNDA aparición de "ready to accept connections": la primera
la emite el servidor temporal que el entrypoint usa para correr los scripts
de init, y cortar ahí es una carrera.

fileParallelism en false porque todos los archivos comparten una sola base.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Los dos roles de Postgres

**Files:**
- Create: `scripts/setup-db-roles.sh`
- Create: `test/setup-db-roles.test.ts`

**Interfaces:**
- Consumes: `urlSuperusuario()` de Task 1.
- Produces: `scripts/setup-db-roles.sh --url=<URL> --owner-password=<P> --app-password=<P> [--con-createdb]`, idempotente. Crea `arandano_owner` y `arandano_app`.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/setup-db-roles.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { urlSuperusuario, urlApp, PASSWORD_OWNER, PASSWORD_APP } from './postgres-efimero'

const ejecutar = promisify(execFile)

async function correrScript(extra: string[] = []) {
  return ejecutar('scripts/setup-db-roles.sh', [
    `--url=${urlSuperusuario()}`,
    `--owner-password=${PASSWORD_OWNER}`,
    `--app-password=${PASSWORD_APP}`,
    ...extra,
  ])
}

async function atributos(rol: string) {
  const cliente = new Client({ connectionString: urlSuperusuario() })
  await cliente.connect()
  try {
    const { rows } = await cliente.query(
      `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolcanlogin
         FROM pg_roles WHERE rolname = $1`,
      [rol],
    )
    return rows[0]
  } finally {
    await cliente.end()
  }
}

describe('setup-db-roles.sh', () => {
  beforeAll(async () => {
    // Dos corridas seguidas: la segunda prueba que es idempotente. Un script
    // de infraestructura que sólo funciona contra una base virgen no sirve
    // para prod, donde el volumen ya existe.
    await correrScript()
    await correrScript()
  })

  it('crea arandano_owner sin superusuario ni bypassrls', async () => {
    const a = await atributos('arandano_owner')
    expect(a).toBeDefined()
    expect(a.rolsuper).toBe(false)
    expect(a.rolbypassrls).toBe(false)
    expect(a.rolcreaterole).toBe(false)
    expect(a.rolcanlogin).toBe(true)
  })

  it('crea arandano_app sin superusuario ni bypassrls', async () => {
    const a = await atributos('arandano_app')
    expect(a.rolsuper).toBe(false)
    expect(a.rolbypassrls).toBe(false)
    expect(a.rolcreatedb).toBe(false)
    expect(a.rolcanlogin).toBe(true)
  })

  it('sin --con-createdb el owner no puede crear bases', async () => {
    await correrScript()
    expect((await atributos('arandano_owner')).rolcreatedb).toBe(false)
  })

  it('con --con-createdb el owner sí puede, para la shadow database', async () => {
    await correrScript(['--con-createdb'])
    expect((await atributos('arandano_owner')).rolcreatedb).toBe(true)
  })

  it('deja los default privileges para que las tablas futuras nazcan visibles', async () => {
    const cliente = new Client({ connectionString: urlSuperusuario() })
    await cliente.connect()
    try {
      const { rows } = await cliente.query(
        `SELECT array_to_string(d.defaclacl, ',') AS acl
           FROM pg_default_acl d
           JOIN pg_roles r ON r.oid = d.defaclrole
          WHERE r.rolname = 'arandano_owner' AND d.defaclobjtype = 'r'`,
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].acl).toContain('arandano_app=arwd')
    } finally {
      await cliente.end()
    }
  })

  it('el rol de la app no puede crear tablas', async () => {
    const cliente = new Client({ connectionString: urlApp() })
    await cliente.connect()
    try {
      await expect(cliente.query('CREATE TABLE intruso (id int)')).rejects.toThrow(
        /permission denied|denegado/i,
      )
    } finally {
      await cliente.end()
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/setup-db-roles.test.ts`
Expected: FAIL — `scripts/setup-db-roles.sh` no existe (ENOENT).

- [ ] **Step 3: Escribir el script**

Crear `scripts/setup-db-roles.sh` (y `chmod +x`):

```bash
#!/usr/bin/env bash
# Crea los dos roles de Postgres del stack y sus permisos.
#
# No puede vivir en una migración de Prisma: las migraciones ya corren COMO
# arandano_owner, así que el rol tiene que existir antes que la primera. Y
# tampoco sirve el docker-entrypoint-initdb.d de la imagen, que sólo corre
# sobre un volumen vacío — el de producción ya existe.
#
# Idempotente a propósito: se corre contra bases que ya tienen los roles.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL=""
OWNER_PASSWORD=""
APP_PASSWORD=""
CON_CREATEDB=false

uso() {
  cat >&2 <<'EOF'
uso: setup-db-roles.sh --url=<URL> --owner-password=<P> --app-password=<P> [--con-createdb]

  --url             cadena de conexión del SUPERUSUARIO del stack. Es el único
                    rol que puede crear otros roles.
  --owner-password  contraseña de arandano_owner (dueño de las tablas, migra).
  --app-password    contraseña de arandano_app (el rol de la app; es el único
                    sobre el que las policies de RLS efectivamente aplican).
  --con-createdb    le da CREATEDB a arandano_owner. Hace falta para la shadow
                    database de `prisma migrate dev`, así que va en dev y en la
                    base de tests. NUNCA en producción: `migrate deploy` no la
                    usa, y un rol de prod con CREATEDB es privilegio regalado.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --url=*)             URL="${arg#*=}" ;;
    --owner-password=*)  OWNER_PASSWORD="${arg#*=}" ;;
    --app-password=*)    APP_PASSWORD="${arg#*=}" ;;
    --con-createdb)      CON_CREATEDB=true ;;
    -h|--help)           uso ;;
    *) echo "argumento desconocido: $arg" >&2; uso ;;
  esac
done

[[ -n "$URL" ]]            || { echo "falta --url" >&2; uso; }
[[ -n "$OWNER_PASSWORD" ]] || { echo "falta --owner-password" >&2; uso; }
[[ -n "$APP_PASSWORD" ]]   || { echo "falta --app-password" >&2; uso; }

if [[ "$CON_CREATEDB" == true ]]; then CREATEDB_SQL="CREATEDB"; else CREATEDB_SQL="NOCREATEDB"; fi

# psql corre dentro de un contenedor efímero porque el host no tiene cliente de
# Postgres instalado, y no hace falta que lo tenga. --network=host para poder
# alcanzar tanto 127.0.0.1 (la base de tests) como las redes de los stacks por
# su puerto publicado.
#
# Las contraseñas viajan como VARIABLES de psql y se interpolan con :'nombre',
# que las emite como literal correctamente entrecomillado. Interpolarlas en el
# texto del SQL con "$VAR" sería una inyección esperando a una contraseña con
# comilla simple.
docker run --rm -i --network=host \
  -e PGCONNECT_TIMEOUT=10 \
  postgres:17-alpine \
  psql "$URL" \
    --set=ON_ERROR_STOP=1 \
    --set=owner_password="$OWNER_PASSWORD" \
    --set=app_password="$APP_PASSWORD" \
    -f - <<EOF
-- CREATE ROLE no tiene IF NOT EXISTS, así que el DO block es la única forma
-- idempotente. Los atributos se fijan aparte con ALTER, que sí es idempotente,
-- para que una corrida sobre un rol preexistente lo deje igual que una sobre
-- uno nuevo.
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arandano_owner') THEN
    CREATE ROLE arandano_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arandano_app') THEN
    CREATE ROLE arandano_app;
  END IF;
END
\$\$;

ALTER ROLE arandano_owner WITH LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS
  $CREATEDB_SQL INHERIT PASSWORD :'owner_password';

ALTER ROLE arandano_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS
  INHERIT PASSWORD :'app_password';

-- En Postgres 15+ el schema public ya no le da CREATE a todo el mundo, así que
-- el owner lo necesita explícito para poder crear las tablas de la migración.
GRANT USAGE, CREATE ON SCHEMA public TO arandano_owner;

-- La app usa el schema pero no crea nada en él.
GRANT USAGE ON SCHEMA public TO arandano_app;
REVOKE CREATE ON SCHEMA public FROM arandano_app;

-- Para las tablas que ya existan cuando esto corra.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO arandano_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO arandano_app;

-- Y esto es lo que evita que se rompa en la migración N+1: sin default
-- privileges, cada tabla nueva nace invisible para la app y alguien tiene que
-- acordarse de escribir el GRANT a mano.
ALTER DEFAULT PRIVILEGES FOR ROLE arandano_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arandano_app;
ALTER DEFAULT PRIVILEGES FOR ROLE arandano_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO arandano_app;
EOF

echo "roles listos (owner con $CREATEDB_SQL)"
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
chmod +x scripts/setup-db-roles.sh
npx vitest run test/setup-db-roles.test.ts
```
Expected: PASS, los seis casos.

- [ ] **Step 5: Dejar los roles creados para las tareas siguientes**

Modificar `test/global-setup.ts` para que después de `levantar()` corra el script con `--con-createdb` (la base de tests necesita la shadow database de `migrate dev`):

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { levantar, bajar, urlSuperusuario, PASSWORD_OWNER, PASSWORD_APP } from './postgres-efimero'

const ejecutar = promisify(execFile)

export async function setup(): Promise<void> {
  await levantar()
  await ejecutar('scripts/setup-db-roles.sh', [
    `--url=${urlSuperusuario()}`,
    `--owner-password=${PASSWORD_OWNER}`,
    `--app-password=${PASSWORD_APP}`,
    '--con-createdb',
  ])
}

export async function teardown(): Promise<void> {
  await bajar()
}
```

- [ ] **Step 6: Correr la suite completa**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/setup-db-roles.sh test/
git commit -m "$(cat <<'EOF'
feat(db): los dos roles de Postgres, y el default privilege que los sostiene

arandano_owner es dueño de las tablas y migra; arandano_app es el rol de la
app y el único sobre el que las policies de RLS aplican. Ninguno es
superusuario: hoy la app se conecta con uno que sí lo es, y con ese rol las
policies se ignorarían en silencio.

El ALTER DEFAULT PRIVILEGES no es un detalle: sin él cada tabla que agregue
una migración futura nace invisible para la app.

Idempotente porque el volumen de producción ya existe, así que esto se va a
correr contra bases que ya tienen los roles.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Prisma, los cinco modelos y la migración inicial

**Files:**
- Modify: `package.json`
- Create: `prisma/schema.prisma`
- Create: `prisma.config.ts`
- Create: `prisma/migrations/<timestamp>_inicial/migration.sql` (generado)
- Create: `test/schema.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `urlOwner()` de Task 1, los roles de Task 2.
- Produces: modelos `Tenant`, `TenantModule`, `User`, `Cliente`, `Articulo`; enums `EstadoTenant`, `Modulo`, `RolUsuario`, `TipoArticulo`; cliente generado importable desde `@/generated/prisma/client`; `npm run generate`.

- [ ] **Step 1: Instalar Prisma**

```bash
npm install --save-exact @prisma/client@7.9.1 @prisma/adapter-pg@7.9.1
npm install --save-dev --save-exact prisma@7.9.1
```

Agregar a `scripts` en `package.json`:

```json
    "generate": "prisma generate",
    "pretest": "npm run generate",
    "prebuild": "npm run generate",
```

`pretest` y `prebuild` existen para que nadie corra tests o un build contra un cliente generado viejo. `generated/` no se commitea, así que en un checkout limpio tampoco existe.

Agregar a `.gitignore`:

```
/generated
```

- [ ] **Step 2: Escribir el schema y la config**

Crear `prisma/schema.prisma`:

```prisma
// En Prisma 7 el bloque datasource NO lleva url: la cadena de conexión vive en
// prisma.config.ts, que sólo lee el CLI. Eso es lo que hace imposible que la
// app se conecte como owner por error — no lee ese archivo.
datasource db {
  provider = "postgresql"
}

generator client {
  provider            = "prisma-client"
  output              = "../generated/prisma"
  // Next.js no resuelve los imports con extensión explícita del generador
  // nuevo; vaciarlo los deja como imports normales.
  importFileExtension = ""
}

enum EstadoTenant {
  TRIAL
  ACTIVO
  SUSPENDIDO

  @@map("estado_tenant")
}

enum Modulo {
  ORDENES_DE_TRABAJO
  TURNOS
  GASTRONOMIA

  @@map("modulo")
}

enum RolUsuario {
  DUENO
  EMPLEADO

  @@map("rol_usuario")
}

enum TipoArticulo {
  PRODUCTO
  SERVICIO

  @@map("tipo_articulo")
}

// La raíz. No tiene tenant_id porque ES el tenant; su policy de RLS compara
// contra id.
model Tenant {
  id            String       @id @default(uuid(7)) @db.Uuid
  subdominio    String       @unique
  nombre        String
  estado        EstadoTenant @default(TRIAL)
  creadoEn      DateTime     @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime     @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  modulos   TenantModule[]
  users     User[]
  clientes  Cliente[]
  articulos Articulo[]

  @@map("tenants")
}

// La activación de un módulo es una fila. Un tenant activa varios: el local de
// celulares es núcleo + órdenes de trabajo.
model TenantModule {
  tenantId   String   @map("tenant_id") @db.Uuid
  modulo     Modulo
  activadoEn DateTime @default(now()) @map("activado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@id([tenantId, modulo])
  @@map("tenant_modules")
}

model User {
  id            String     @id @default(uuid(7)) @db.Uuid
  tenantId      String     @map("tenant_id") @db.Uuid
  nombre        String
  email         String
  rol           RolUsuario @default(EMPLEADO)
  creadoEn      DateTime   @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime   @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  // Por tenant y no global: la misma persona puede trabajar en dos negocios.
  @@unique([tenantId, email])
  @@map("users")
}

model Cliente {
  id            String   @id @default(uuid(7)) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  nombre        String
  telefono      String?
  email         String?
  creadoEn      DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@index([tenantId])
  @@map("clientes")
}

model Articulo {
  id       String       @id @default(uuid(7)) @db.Uuid
  tenantId String       @map("tenant_id") @db.Uuid
  sku      String
  nombre   String
  tipo     TipoArticulo
  // Decimal y nunca Float: un flotante binario no representa 0,10 y el error
  // se acumula en cada suma de una caja.
  precio        Decimal  @db.Decimal(12, 2)
  creadoEn      DateTime @default(now()) @map("creado_en") @db.Timestamptz(3)
  actualizadoEn DateTime @updatedAt @map("actualizado_en") @db.Timestamptz(3)

  tenant Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, sku])
  @@map("articulos")
}
```

Crear `prisma.config.ts`:

```ts
import { defineConfig } from 'prisma/config'

// MIGRATE_DATABASE_URL y no DATABASE_URL: el CLI migra con el rol dueño de las
// tablas. La app nunca lee este archivo — se conecta por el driver adapter con
// el pool de lib/db.ts —, así que no existe la combinación de variables en la
// que la app termine conectada como owner.
//
// El `?? ''` está para que `prisma generate` funcione sin la variable puesta
// (generar no se conecta a nada). Los comandos que sí se conectan fallan con
// una URL vacía, que es un error claro y no un destino equivocado.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.MIGRATE_DATABASE_URL ?? '' },
})
```

- [ ] **Step 3: Escribir el test que falla**

Crear `test/schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'

let cliente: Client

beforeAll(async () => {
  cliente = new Client({ connectionString: urlOwner() })
  await cliente.connect()
})

afterAll(async () => {
  await cliente.end()
})

describe('la migración inicial', () => {
  it('crea las cinco tablas con nombres en snake_case', async () => {
    const { rows } = await cliente.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
    const tablas = rows.map((r) => r.tablename)
    expect(tablas).toEqual(
      expect.arrayContaining(['articulos', 'clientes', 'tenant_modules', 'tenants', 'users']),
    )
  })

  it('nombra las columnas en snake_case', async () => {
    const { rows } = await cliente.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' ORDER BY column_name`,
    )
    const columnas = rows.map((r) => r.column_name)
    expect(columnas).toContain('tenant_id')
    expect(columnas).toContain('creado_en')
    expect(columnas).not.toContain('tenantId')
  })

  it('guarda el precio como numeric(12,2), no como flotante', async () => {
    const { rows } = await cliente.query(
      `SELECT data_type, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='articulos' AND column_name='precio'`,
    )
    expect(rows[0].data_type).toBe('numeric')
    expect(rows[0].numeric_precision).toBe(12)
    expect(rows[0].numeric_scale).toBe(2)
  })

  it('permite el mismo email en dos tenants y lo rechaza dentro del mismo', async () => {
    const a = await crearTenantCrudo('unicidad-a')
    const b = await crearTenantCrudo('unicidad-b')

    await cliente.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Ana', 'ana@ejemplo.com', 'DUENO', now(), now())`,
      [a],
    )
    // El mismo email en OTRO tenant tiene que entrar.
    await expect(
      cliente.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Ana', 'ana@ejemplo.com', 'DUENO', now(), now())`,
        [b],
      ),
    ).resolves.toBeDefined()
    // Repetido dentro del MISMO tenant, no.
    await expect(
      cliente.query(
        `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Otra Ana', 'ana@ejemplo.com', 'EMPLEADO', now(), now())`,
        [a],
      ),
    ).rejects.toThrow(/duplicate key|llave duplicada/i)
  })
})

async function crearTenantCrudo(subdominio: string): Promise<string> {
  const { rows } = await cliente.query(
    `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $1, 'TRIAL', now(), now())
     RETURNING id`,
    [subdominio],
  )
  return rows[0].id
}
```

- [ ] **Step 4: Correr el test y verificar que falla**

Run: `npx vitest run test/schema.test.ts`
Expected: FAIL — no existen las tablas.

- [ ] **Step 5: Generar la migración**

El teardown de vitest baja el contenedor, así que para generar la migración hay que levantarlo suelto, con los mismos parámetros que usa `test/postgres-efimero.ts`:

```bash
docker rm -f arandano-test-pg 2>/dev/null || true
docker run -d --name arandano-test-pg \
  --memory=512m --cpus=0.5 \
  --tmpfs /var/lib/postgresql/data:size=320m,mode=1777 \
  -e POSTGRES_USER=arandano_test_super -e POSTGRES_PASSWORD=efimero-no-persiste \
  -e POSTGRES_DB=arandano_test -e PGDATA=/var/lib/postgresql/data/pgdata \
  -p 127.0.0.1:55432:5432 postgres:17-alpine

until [ "$(docker logs arandano-test-pg 2>&1 | grep -c 'ready to accept connections')" -ge 2 ]; do sleep 1; done

scripts/setup-db-roles.sh \
  --url=postgres://arandano_test_super:efimero-no-persiste@127.0.0.1:55432/arandano_test \
  --owner-password=efimero-owner --app-password=efimero-app --con-createdb

MIGRATE_DATABASE_URL=postgres://arandano_owner:efimero-owner@127.0.0.1:55432/arandano_test \
  npx prisma migrate dev --name inicial
```

Expected: crea `prisma/migrations/<timestamp>_inicial/migration.sql` y genera el cliente en `generated/prisma/`.

- [ ] **Step 6: Aplicar la migración desde el globalSetup**

Modificar `test/global-setup.ts` para correr `prisma migrate deploy` después de crear los roles:

```ts
  await ejecutar('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, MIGRATE_DATABASE_URL: urlOwner() },
  })
```

(agregar `urlOwner` al import de `./postgres-efimero`).

`migrate deploy` y no `migrate dev`: en un entorno que no es el escritorio de nadie, lo que se quiere es aplicar lo que hay, no generar nada nuevo.

- [ ] **Step 7: Correr los tests y verificar que pasan**

```bash
docker rm -f arandano-test-pg
npm test
```
Expected: PASS, incluidos los cuatro casos de `schema.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore prisma/ prisma.config.ts test/
git commit -m "$(cat <<'EOF'
feat(db): Prisma 7 y los cinco modelos del núcleo

Tenant, TenantModule, User, Cliente y Articulo, en snake_case en la base
porque este proyecto escribe bastante SQL crudo y citar camelCase es una
molestia que dura para siempre.

IDs uuid v7: un tenant que se mude a VPC dedicada no puede colisionar, y un
entero secuencial le filtra a cada cliente cuánto factura el resto.

La URL del CLI es MIGRATE_DATABASE_URL y vive en prisma.config.ts, que la
app no lee. No queda combinación de variables en la que la app se conecte
con el rol dueño.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Las policies de RLS

**Files:**
- Modify: `prisma/migrations/<timestamp>_inicial/migration.sql`
- Create: `test/rls.test.ts`
- Create: `test/datos.ts`

**Interfaces:**
- Consumes: las tablas de Task 3, `urlOwner()` y `urlApp()` de Task 1.
- Produces: policy `tenant_aislamiento` en las cinco tablas; `test/datos.ts` con `crearTenant(cliente, subdominio): Promise<string>`.

Se edita la migración inicial en vez de agregar una segunda **porque todavía no está aplicada en ningún lado que importe**: sólo en bases descartables. Es la última vez que esto es legítimo. A partir del primer `migrate deploy` contra dev o prod, una migración aplicada no se toca nunca más.

- [ ] **Step 1: Escribir el test que falla**

Crear `test/datos.ts`:

```ts
import type { Client } from 'pg'

/** Inserta un tenant. Se llama con el cliente del OWNER: el rol de la app no
 *  puede crear tenants, y eso es a propósito — ver el spec. */
export async function crearTenant(owner: Client, subdominio: string): Promise<string> {
  const { rows } = await owner.query(
    `INSERT INTO tenants (id, subdominio, nombre, estado, creado_en, actualizado_en)
     VALUES (gen_random_uuid(), $1, $1, 'TRIAL', now(), now())
     RETURNING id`,
    [subdominio],
  )
  return rows[0].id
}
```

Crear `test/rls.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from './postgres-efimero'
import { crearTenant } from './datos'

let owner: Client
let app: Client
let tenantA: string
let tenantB: string

/** Corre una consulta con la GUC del tenant fijada, dentro de una transacción,
 *  igual que hace la app en producción. */
async function comoTenant<T>(tenantId: string | null, sql: string, params: unknown[] = []) {
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

  tenantA = await crearTenant(owner, 'rls-a')
  tenantB = await crearTenant(owner, 'rls-b')

  for (const [t, nombre] of [[tenantA, 'Cliente de A'], [tenantB, 'Cliente de B']] as const) {
    await owner.query(
      `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, $2, now(), now())`,
      [t, nombre],
    )
  }
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('aislamiento por RLS', () => {
  it('con la GUC del tenant A sólo se ven los clientes de A', async () => {
    const { rows } = await comoTenant(tenantA, 'SELECT nombre FROM clientes')
    expect(rows).toHaveLength(1)
    expect(rows[0].nombre).toBe('Cliente de A')
  })

  it('sin GUC no se ve ninguna fila: falla cerrado', async () => {
    const { rows } = await comoTenant(null, 'SELECT nombre FROM clientes')
    expect(rows).toHaveLength(0)
  })

  it('con la GUC vacía tampoco, y sin reventar en el cast a uuid', async () => {
    const { rows } = await comoTenant('', 'SELECT nombre FROM clientes')
    expect(rows).toHaveLength(0)
  })

  it('rechaza insertar una fila con el tenant_id de otro', async () => {
    await expect(
      comoTenant(
        tenantA,
        `INSERT INTO clientes (id, tenant_id, nombre, creado_en, actualizado_en)
         VALUES (gen_random_uuid(), $1, 'Infiltrado', now(), now())`,
        [tenantB],
      ),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('rechaza mover una fila existente a otro tenant', async () => {
    await expect(
      comoTenant(tenantA, 'UPDATE clientes SET tenant_id = $1', [tenantB]),
    ).rejects.toThrow(/row-level security|seguridad a nivel de fila/i)
  })

  it('un tenant no puede enumerar a los demás', async () => {
    const { rows } = await comoTenant(tenantA, 'SELECT subdominio FROM tenants')
    expect(rows).toHaveLength(1)
    expect(rows[0].subdominio).toBe('rls-a')
  })

  it('aísla también users, articulos y tenant_modules', async () => {
    await owner.query(
      `INSERT INTO articulos (id, tenant_id, sku, nombre, tipo, precio, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'SKU-1', 'Sólo de B', 'PRODUCTO', 100.00, now(), now())`,
      [tenantB],
    )
    await owner.query(
      `INSERT INTO tenant_modules (tenant_id, modulo, activado_en) VALUES ($1, 'TURNOS', now())`,
      [tenantB],
    )
    await owner.query(
      `INSERT INTO users (id, tenant_id, nombre, email, rol, creado_en, actualizado_en)
       VALUES (gen_random_uuid(), $1, 'Beto', 'beto@ejemplo.com', 'DUENO', now(), now())`,
      [tenantB],
    )

    for (const tabla of ['articulos', 'tenant_modules', 'users']) {
      const { rows } = await comoTenant(tenantA, `SELECT 1 FROM ${tabla}`)
      expect(rows, `${tabla} filtró filas de otro tenant`).toHaveLength(0)
    }
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run test/rls.test.ts`
Expected: FAIL — sin policies, el primer caso devuelve las dos filas.

- [ ] **Step 3: Agregar las policies a la migración inicial**

Agregar al final de `prisma/migrations/<timestamp>_inicial/migration.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Row Level Security
--
-- Tres piezas de la expresión, ninguna decorativa:
--   * el segundo argumento `true` de current_setting hace que una GUC sin
--     setear devuelva NULL en vez de tirar error;
--   * el nullif evita que una cadena vacía llegue al cast y lo haga explotar;
--   * como NULL = uuid da NULL, y NULL no es true, SIN GUC NO PASA NINGUNA
--     FILA. Falla cerrado, que es la única forma aceptable de fallar acá.
--
-- El WITH CHECK es lo que impide insertar una fila con el tenant_id de otro y
-- lo que impide que un UPDATE mueva una fila existente a otro tenant.
--
-- Las policies van SIN cláusula TO: nombrar un rol adentro las ataría a que
-- ese rol exista antes que la tabla, y un CREATE POLICY que nombra un rol
-- inexistente hace salir a pg_restore con 1 y deja la policy sin crear. Está
-- reproducido y documentado en scripts/verify-backup.sh.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "tenants" FOR ALL
  USING      ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "tenant_modules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "tenant_modules" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "users" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "clientes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "clientes" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "articulos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "articulos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS, los siete casos de `rls.test.ts`.

Si `rls.test.ts` sigue viendo las dos filas, el problema no son las policies: es que el rol de la app quedó superusuario o dueño de las tablas. Verificar con:

```bash
docker exec arandano-test-pg psql -U arandano_test_super -d arandano_test -Atc \
  "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='arandano_app'"
```

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations test/
git commit -m "$(cat <<'EOF'
feat(db): policies de RLS que fallan cerrado

Una policy por tabla contra la GUC arandano.tenant_id. Sin GUC seteada no
pasa ninguna fila: current_setting con el flag devuelve NULL, el nullif
absorbe la cadena vacía, y NULL = uuid nunca es true.

El WITH CHECK es lo que impide insertar con el tenant_id de otro y mover una
fila existente a otro tenant.

Sin cláusula TO: nombrar un rol ataría la policy a que ese rol exista antes
que la tabla, que es el fallo de restore que verify-backup.sh ya documenta.

Se editó la migración inicial en vez de agregar una segunda porque todavía
no está aplicada en ninguna base que importe. Es la última vez.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: El test de cobertura de RLS

Prisma no genera policies: las escribe una persona a mano en cada migración. Una tabla nueva sin policy queda **completamente desprotegida** y nada lo grita. Este test es la única razón por la que ese riesgo es tolerable.

**Files:**
- Create: `test/rls-cobertura.test.ts`

**Interfaces:**
- Consumes: `urlOwner()` de Task 1, las policies de Task 4.
- Produces: nada que otras tareas usen.

- [ ] **Step 1: Escribir el test**

Crear `test/rls-cobertura.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner } from './postgres-efimero'

// Escrita a mano a propósito: sumarle una entrada tiene que ser una decisión
// visible en el diff, no algo que el check deduzca solo.
const SIN_TENANT_ID: Record<string, string> = {
  tenants: 'es la raíz; se aísla por id en vez de por tenant_id',
  _prisma_migrations: 'metadatos de Prisma; no tiene datos de ningún tenant',
}

let cliente: Client

beforeAll(async () => {
  cliente = new Client({ connectionString: urlOwner() })
  await cliente.connect()
})

afterAll(async () => {
  await cliente.end()
})

async function tablas() {
  const { rows } = await cliente.query(`
    SELECT c.relname AS tabla,
           c.relrowsecurity AS rls,
           EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                AND a.attnum > 0 AND NOT a.attisdropped
           ) AS tiene_tenant_id
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname
  `)
  return rows as { tabla: string; rls: boolean; tiene_tenant_id: boolean }[]
}

describe('cobertura de RLS', () => {
  it('toda tabla con tenant_id tiene RLS habilitada', async () => {
    for (const t of (await tablas()).filter((t) => t.tiene_tenant_id)) {
      expect(t.rls, `${t.tabla} tiene tenant_id pero RLS está apagada`).toBe(true)
    }
  })

  it('toda tabla con tenant_id tiene la policy, con USING y con WITH CHECK', async () => {
    for (const t of (await tablas()).filter((t) => t.tiene_tenant_id)) {
      const { rows } = await cliente.query(
        `SELECT p.polqual IS NOT NULL AS tiene_using,
                p.polwithcheck IS NOT NULL AS tiene_with_check
           FROM pg_policy p
           JOIN pg_class c ON c.oid = p.polrelid
          WHERE c.relname = $1 AND p.polname = 'tenant_aislamiento'`,
        [t.tabla],
      )
      expect(rows, `${t.tabla} no tiene la policy tenant_aislamiento`).toHaveLength(1)
      expect(rows[0].tiene_using, `${t.tabla}: policy sin USING`).toBe(true)
      // Sin WITH CHECK la protección sería sólo de lectura: se podría insertar
      // con el tenant_id de otro.
      expect(rows[0].tiene_with_check, `${t.tabla}: policy sin WITH CHECK`).toBe(true)
    }
  })

  it('toda tabla SIN tenant_id está en la lista blanca, con su razón', async () => {
    // Esta mitad es la que evita que el test pase por vacío cuando alguien se
    // olvidó la COLUMNA en vez de la policy.
    for (const t of (await tablas()).filter((t) => !t.tiene_tenant_id)) {
      expect(
        SIN_TENANT_ID[t.tabla],
        `la tabla ${t.tabla} no tiene tenant_id y no está en la lista blanca: ` +
          `o le falta la columna, o hay que declarar por qué no la necesita`,
      ).toBeDefined()
    }
  })

  it('el rol de la app no es dueño de ninguna tabla, así que no está exento', async () => {
    // El dueño de una tabla está exento de sus propias policies salvo con
    // FORCE ROW LEVEL SECURITY. Este test recién tiene sentido acá, con las
    // tablas ya creadas: en el de setup-db-roles.sh no existía ninguna.
    const { rows } = await cliente.query(`
      SELECT count(*)::int AS n
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_roles r ON r.oid = c.relowner
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'arandano_app'
    `)
    expect(rows[0].n).toBe(0)
  })

  it('tenants está protegida por id, aunque no tenga tenant_id', async () => {
    const { rows } = await cliente.query(
      `SELECT pg_get_expr(p.polqual, p.polrelid) AS using_expr
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'tenants' AND p.polname = 'tenant_aislamiento'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].using_expr).toContain('id')
    expect(rows[0].using_expr).toContain('arandano.tenant_id')
  })
})
```

- [ ] **Step 2: Correr el test y verificar que pasa**

Run: `npx vitest run test/rls-cobertura.test.ts`
Expected: PASS, los cinco casos.

- [ ] **Step 3: Verificar que el test detecta lo que dice detectar**

El test tiene que fallar cuando alguien agrega una tabla sin proteger. Comprobarlo a mano contra el contenedor que quedó arriba:

```bash
docker exec arandano-test-pg psql -U arandano_owner -d arandano_test \
  -c "CREATE TABLE prueba_sin_policy (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)"
npx vitest run test/rls-cobertura.test.ts
```
Expected: FAIL, con el mensaje `prueba_sin_policy tiene tenant_id pero RLS está apagada`.

Limpiar y confirmar que vuelve a verde:

```bash
docker exec arandano-test-pg psql -U arandano_owner -d arandano_test -c "DROP TABLE prueba_sin_policy"
npx vitest run test/rls-cobertura.test.ts
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/rls-cobertura.test.ts
git commit -m "$(cat <<'EOF'
test(db): cobertura de RLS, para que la migración N+1 no abra un agujero

Recorre pg_class y pg_policy: toda tabla con tenant_id tiene que tener RLS
habilitada y su policy con USING y con WITH CHECK, y toda tabla sin
tenant_id tiene que estar en una lista blanca escrita a mano con su razón.

La segunda mitad es la que importa: sin ella el test pasaría por vacío
cuando alguien se olvidó la columna en vez de la policy.

Verificado que falla creando una tabla con tenant_id y sin policy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: El cliente de Prisma por tenant

**Files:**
- Modify: `lib/db.ts`
- Create: `lib/tenant/prisma.ts`
- Create: `lib/tenant/prisma.test.ts`

**Interfaces:**
- Consumes: el cliente generado en `@/generated/prisma/client`, `pool` de `lib/db.ts`.
- Produces:
  - `lib/db.ts`: `export const pool: Pool` (ya existía) y `export const prisma: PrismaClient`
  - `lib/tenant/prisma.ts`: `export function prismaParaTenant(tenantId: string)`

- [ ] **Step 1: Escribir el test que falla**

Crear `lib/tenant/prisma.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from 'pg'
import { urlOwner, urlApp } from '@/test/postgres-efimero'
import { crearTenant } from '@/test/datos'

let owner: Client
let tenantA: string
let tenantB: string
let prismaParaTenant: typeof import('@/lib/tenant/prisma').prismaParaTenant
let prismaBase: typeof import('@/lib/db').prisma

beforeAll(async () => {
  owner = new Client({ connectionString: urlOwner() })
  await owner.connect()
  tenantA = await crearTenant(owner, 'ext-a')
  tenantB = await crearTenant(owner, 'ext-b')

  // El pool de lib/db.ts se construye al importar, leyendo DATABASE_URL: hay
  // que fijarla ANTES del import, no después.
  process.env.DATABASE_URL = urlApp()
  ;({ prismaParaTenant } = await import('@/lib/tenant/prisma'))
  ;({ prisma: prismaBase } = await import('@/lib/db'))
})

afterAll(async () => {
  await owner.end()
})

describe('prismaParaTenant', () => {
  it('autocompleta tenant_id al crear', async () => {
    const db = prismaParaTenant(tenantA)
    const cliente = await db.cliente.create({ data: { nombre: 'Sin tenant explícito' } })
    expect(cliente.tenantId).toBe(tenantA)
  })

  it('no devuelve filas de otro tenant', async () => {
    await prismaParaTenant(tenantB).cliente.create({ data: { nombre: 'De B' } })
    const deA = await prismaParaTenant(tenantA).cliente.findMany()
    expect(deA.map((c) => c.nombre)).not.toContain('De B')
  })

  it('no se contamina entre operaciones consecutivas sobre el mismo pool', async () => {
    // Este es el test que atrapa el bug que arruinaría todo lo demás: si la GUC
    // sobreviviera a la transacción, la segunda llamada leería con el tenant de
    // la primera.
    for (let i = 0; i < 10; i++) {
      const deA = await prismaParaTenant(tenantA).cliente.findMany()
      expect(deA.every((c) => c.tenantId === tenantA)).toBe(true)
      const deB = await prismaParaTenant(tenantB).cliente.findMany()
      expect(deB.every((c) => c.tenantId === tenantB)).toBe(true)
    }
  })

  it('el cliente sin extender no ve nada: falla cerrado', async () => {
    expect(await prismaBase.cliente.findMany()).toHaveLength(0)
  })

  it('rechaza crear con el tenant_id de otro', async () => {
    await expect(
      prismaParaTenant(tenantA).cliente.create({
        data: { nombre: 'Infiltrado', tenantId: tenantB },
      }),
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/tenant/prisma.test.ts`
Expected: FAIL — no existe `@/lib/tenant/prisma`.

- [ ] **Step 3: Construir el cliente Prisma sobre el pool que ya existe**

Agregar al final de `lib/db.ts`:

```ts
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// El adapter acepta un pg.Pool ya construido, así que Prisma NO abre un pool
// propio: el límite de conexiones sigue viviendo en un solo lugar, arriba, que
// es donde está documentado por qué vale 5.
const globalForPrisma = globalThis as unknown as { arandanoPrisma?: PrismaClient }

function crearPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(pool) })
}

export const prisma = globalForPrisma.arandanoPrisma ?? crearPrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.arandanoPrisma = prisma
```

- [ ] **Step 4: Escribir la extensión**

Crear `lib/tenant/prisma.ts`:

```ts
import { prisma } from '@/lib/db'

/** Modelos que llevan tenant_id y por lo tanto se les puede autocompletar. */
const MODELOS_CON_TENANT = new Set(['User', 'Cliente', 'Articulo', 'TenantModule'])

/** Operaciones que escriben filas nuevas. */
const OPERACIONES_DE_ALTA = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert'])

type Args = Record<string, unknown>

function conTenant(dato: unknown, tenantId: string): unknown {
  if (Array.isArray(dato)) return dato.map((d) => conTenant(d, tenantId))
  if (dato && typeof dato === 'object') return { tenantId, ...(dato as object) }
  return dato
}

function completarAlta(operacion: string, args: Args, tenantId: string): Args {
  if (operacion === 'upsert') {
    return { ...args, create: conTenant(args.create, tenantId) }
  }
  return { ...args, data: conTenant(args.data, tenantId) }
}

/**
 * Cliente de Prisma atado a un tenant.
 *
 * Cada operación va en SU PROPIA transacción, y lo primero que corre adentro es
 * el set_config con el tercer argumento en true: eso la hace local a la
 * transacción, así que muere con ella. Ese es el argumento de seguridad
 * completo — una conexión devuelta al pool y reusada por otro request no puede
 * arrastrar el tenant anterior.
 *
 * Una transacción por operación y no una por request: el pool es de 5
 * conexiones, y sostener una transacción mientras dura el request deja al sexto
 * request concurrente esperando. El costo es un ida y vuelta extra por query.
 *
 * La extensión NO inyecta `where` en las lecturas: de eso se encarga la policy,
 * que falla cerrado. Un `where` duplicado no agregaría defensa, agregaría una
 * segunda cosa que se puede desactualizar respecto de la primera.
 */
export function prismaParaTenant(tenantId: string) {
  return prisma.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const argsFinales =
            MODELOS_CON_TENANT.has(model) && OPERACIONES_DE_ALTA.has(operation)
              ? completarAlta(operation, args as Args, tenantId)
              : args

          const [, resultado] = await prisma.$transaction([
            prisma.$executeRaw`SELECT set_config('arandano.tenant_id', ${tenantId}, true)`,
            query(argsFinales),
          ])
          return resultado
        },
      },
    },
  })
}
```

Nota sobre `conTenant`: pone `tenantId` **antes** del spread a propósito. Si quien llama lo pasó explícito, el suyo gana — y si es el de otro tenant, lo rechaza el `WITH CHECK` de la policy, que es exactamente el caso del último test.

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS, los cinco casos de `lib/tenant/prisma.test.ts` más todo lo anterior.

- [ ] **Step 6: Verificar que el typecheck pasa**

Run: `npx tsc --noEmit`
Expected: sin errores. Si se queja de que no encuentra `@/generated/prisma/client`, correr `npm run generate` primero.

- [ ] **Step 7: Commit**

```bash
git add lib/
git commit -m "$(cat <<'EOF'
feat(db): cliente de Prisma atado al tenant

Cada operación va en su propia transacción con set_config(..., true), que es
local a la transacción y muere con ella. Ese es el argumento entero: una
conexión reciclada del pool no puede arrastrar el tenant del request
anterior. Hay un test que corre diez rondas alternadas para probarlo.

Una transacción por operación y no una por request, porque el pool es de 5 y
sostenerla mientras dura el request deja esperando al sexto.

El adapter reusa el pool de lib/db.ts: un solo lugar donde vive el límite de
conexiones.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: El check de identidad del rol en el healthcheck

`lib/health/checks.ts` ya comprueba **contra qué base** habla la app. Este comprueba **con qué rol**, y atrapa la única configuración que apagaría RLS sin hacer ruido.

**Files:**
- Modify: `lib/health/checks.ts`
- Modify: `lib/health/checks.test.ts`

**Interfaces:**
- Consumes: `pool` de `lib/db.ts`.
- Produces: un `HealthCheck` llamado `rol` dentro del array `checks` exportado.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `lib/health/checks.test.ts`, siguiendo el estilo del archivo (mockea el pool; acá interesa qué hace el check con la respuesta, no que haya una base):

```ts
describe('check de identidad del rol', () => {
  beforeEach(() => {
    query.mockReset()
    vi.resetModules()
    process.env.ARANDANO_DB_ESPERADA = 'arandano_prod'
  })

  function respuestaDeRol(fila: Record<string, unknown>) {
    query.mockImplementation((sql: string) => {
      if (String(sql).includes('current_database')) {
        return Promise.resolve({ rows: [{ db: 'arandano_prod' }] })
      }
      return Promise.resolve({ rows: [fila] })
    })
  }

  it('pasa con un rol sin privilegios', async () => {
    respuestaDeRol({ rol: 'arandano_app', super: false, bypassrls: false, es_dueno: false })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    const rol = reporte.checks.find((c) => c.name === 'rol')
    expect(rol?.ok).toBe(true)
    expect(rol?.detail).toBe('rol=arandano_app')
  })

  it('falla si el rol es superusuario, porque RLS se ignoraría en silencio', async () => {
    respuestaDeRol({ rol: 'arandano_dev', super: true, bypassrls: false, es_dueno: false })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    const rol = reporte.checks.find((c) => c.name === 'rol')
    expect(rol?.ok).toBe(false)
    expect(rol?.detail).toMatch(/superusuario/i)
  })

  it('falla si el rol tiene BYPASSRLS', async () => {
    respuestaDeRol({ rol: 'arandano_app', super: false, bypassrls: true, es_dueno: false })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    expect(reporte.checks.find((c) => c.name === 'rol')?.detail).toMatch(/bypassrls/i)
  })

  it('falla si el rol es dueño de las tablas, porque el dueño está exento', async () => {
    respuestaDeRol({ rol: 'arandano_owner', super: false, bypassrls: false, es_dueno: true })
    const { checks } = await import('@/lib/health/checks')
    const reporte = await runChecks(checks)
    expect(reporte.checks.find((c) => c.name === 'rol')?.detail).toMatch(/due/i)
  })
})
```

Los nombres de campo salen de `lib/health/types.ts`: `CheckResult` tiene `name`, `ok` (booleano, **no** `status`), `durationMs` y `detail` opcional. El `detail` de un check que pasa es lo que devuelve su `run()`; el de uno que falla es el mensaje del error.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npx vitest run lib/health/checks.test.ts`
Expected: FAIL — no existe ningún check llamado `rol`.

- [ ] **Step 3: Escribir el check**

Agregar a `lib/health/checks.ts`, antes del `export const checks`:

```ts
/**
 * Con qué rol está hablando la app.
 *
 * El check de arriba comprueba contra QUÉ BASE; éste, con QUÉ ROL. Un
 * DATABASE_URL apuntando al superusuario deja las policies de RLS
 * completamente inertes —Postgres las ignora para superusuarios y para el
 * dueño de la tabla— y no hay ningún síntoma: las queries siguen andando, sólo
 * que devuelven los datos de todos los tenants. Es exactamente la clase de
 * fallo que no se nota hasta que un cliente ve los datos de otro.
 */
const rolCheck: HealthCheck = {
  name: 'rol',
  timeoutMs: 2000,
  run: async () => {
    const res = await pool.query(`
      SELECT r.rolname                AS rol,
             r.rolsuper               AS super,
             r.rolbypassrls           AS bypassrls,
             EXISTS (
               SELECT 1 FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relowner = r.oid
             )                        AS es_dueno
        FROM pg_roles r
       WHERE r.rolname = current_user
    `)

    const fila = res.rows[0]
    if (!fila) throw new Error('no se pudo determinar el rol de conexión')

    if (fila.super) {
      throw new Error(
        `la app está conectada como "${fila.rol}", que es SUPERUSUARIO: ` +
          'Postgres ignora las policies de RLS para ese rol, así que el ' +
          'aislamiento entre tenants no está aplicando',
      )
    }
    if (fila.bypassrls) {
      throw new Error(
        `el rol "${fila.rol}" tiene BYPASSRLS: las policies no se le aplican`,
      )
    }
    if (fila.es_dueno) {
      throw new Error(
        `el rol "${fila.rol}" es DUEÑO de tablas de public: el dueño está exento ` +
          'de sus propias policies salvo con FORCE ROW LEVEL SECURITY. La app ' +
          'tiene que conectarse con arandano_app, no con arandano_owner',
      )
    }

    return `rol=${fila.rol}`
  },
}
```

Y sumarlo al array, actualizando el comentario del pendiente:

```ts
/**
 * ...
 * PENDIENTE — bloqueante antes del primer deploy real (ver CLAUDE.md):
 * falta el check de una query filtrada por tenant, que necesita un tenant
 * conocido al que apuntar (llega con el tenant canario), y el de pg-boss, que
 * espera a que pg-boss se configure.
 */
export const checks: HealthCheck[] = [postgresCheck, rolCheck]
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/health/
git commit -m "$(cat <<'EOF'
feat(health): comprobar con qué rol está conectada la app

El check que ya existía comprueba contra qué base; éste, con qué rol. Un
DATABASE_URL apuntando al superusuario deja las policies de RLS inertes sin
ningún síntoma: las queries siguen andando, sólo que devuelven los datos de
todos los tenants.

También rechaza BYPASSRLS y ser dueño de las tablas, que son las otras dos
formas de quedar exento.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Las dos URLs en cada stack, y dev funcionando

**Files:**
- Modify: `.env.example`
- Modify: `.env.dev` *(no versionado)*
- Modify: `docker/compose.dev.yml`, `docker/compose.stage.yml`, `docker/compose.prod.yml`
- Modify: `scripts/verify-infra.sh`
- Modify: `scripts/setup-host.sh`

**Interfaces:**
- Consumes: `scripts/setup-db-roles.sh` de Task 2, la migración de Tasks 3–4.
- Produces: `DATABASE_URL` (rol `arandano_app`) y `MIGRATE_DATABASE_URL` (rol `arandano_owner`) en los tres stacks.

- [ ] **Step 1: Actualizar `.env.example`**

```bash
# Copiar a .env.dev (nunca commitear el .env real).
# Las credenciales de cada stack son distintas a propósito: evita que una
# cadena de conexión copiada por error apunte a la base equivocada.
POSTGRES_USER=arandano_dev
POSTGRES_PASSWORD=cambiar-en-cada-stack
POSTGRES_DB=arandano_dev

# Los dos roles de la aplicación. POSTGRES_USER es superusuario y sólo se usa
# para crearlos (scripts/setup-db-roles.sh) y para los backups.
ARANDANO_OWNER_PASSWORD=cambiar-en-cada-stack
ARANDANO_APP_PASSWORD=cambiar-en-cada-stack

# La app. arandano_app NO es superusuario ni dueño de las tablas: es el único
# rol sobre el que las policies de RLS efectivamente aplican.
DATABASE_URL=postgres://arandano_app:cambiar-en-cada-stack@postgres:5432/arandano_dev

# El CLI de Prisma, y NADA más. La app no lee esta variable.
MIGRATE_DATABASE_URL=postgres://arandano_owner:cambiar-en-cada-stack@postgres:5432/arandano_dev

ARANDANO_STACK=dev
```

- [ ] **Step 2: Actualizar `.env.dev` con contraseñas propias**

```bash
# Generar dos contraseñas distintas
openssl rand -base64 24
openssl rand -base64 24
```

Editar `.env.dev` con los mismos campos que `.env.example`, usando esas contraseñas y `POSTGRES_PASSWORD` sin tocar.

- [ ] **Step 3: Pasar `MIGRATE_DATABASE_URL` a los compose**

En `docker/compose.dev.yml`, servicio `app`: ya usa `env_file: ../.env.dev`, así que ambas variables llegan solas. Verificar y no duplicarlas en `environment:`.

En `docker/compose.stage.yml`, servicio `app`, agregar junto a `DATABASE_URL`:

```yaml
      DATABASE_URL: postgres://arandano_app:efimero-app@postgres:5432/arandano_stage
      MIGRATE_DATABASE_URL: postgres://arandano_owner:efimero-owner@postgres:5432/arandano_stage
```

y un comentario arriba:

```yaml
      # Los roles de este stack NO existen hasta que deploy.sh corra
      # scripts/setup-db-roles.sh contra este Postgres: es efímero y nace
      # vacío en cada corrida. Hasta que exista deploy.sh, levantar este stack
      # a mano deja la app sin poder conectarse, y es lo esperado.
```

En `docker/compose.prod.yml`: usa `env_file: .env`, así que ambas llegan del `.env` de `/srv/arandano/prod/`. No hace falta cambiar el archivo.

- [ ] **Step 4: Crear los roles y migrar dev**

```bash
set -a; . ./.env.dev; set +a

scripts/setup-db-roles.sh \
  --url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5433/${POSTGRES_DB}" \
  --owner-password="${ARANDANO_OWNER_PASSWORD}" \
  --app-password="${ARANDANO_APP_PASSWORD}" \
  --con-createdb

MIGRATE_DATABASE_URL="postgres://arandano_owner:${ARANDANO_OWNER_PASSWORD}@127.0.0.1:5433/${POSTGRES_DB}" \
  npx prisma migrate deploy
```

El puerto es 5433 y el host 127.0.0.1 porque `compose.dev.yml` publica el Postgres de dev en `100.64.81.63:5433`; desde el propio servidor, 127.0.0.1 también alcanza el puerto publicado.

`--con-createdb` va en dev porque `prisma migrate dev` necesita la shadow database.

- [ ] **Step 5: Recrear la app de dev y verificar**

```bash
docker compose -f docker/compose.dev.yml up -d --force-recreate app
sleep 20
curl -s http://100.64.81.63:3000/api/health | head -40
```
Expected: HTTP 200 y el check `rol` en `ok` con `detail: rol=arandano_app`.

Si el check `rol` falla diciendo "es SUPERUSUARIO", `DATABASE_URL` quedó con `POSTGRES_USER`.

- [ ] **Step 6: Sumar el check a `verify-infra.sh`**

Agregar una suite nueva a `scripts/verify-infra.sh`, con el estilo de las que ya están (`suite_header`, `check_eq`):

```bash
suite_roles_db() {
  suite_header "Base: la app no corre con privilegios"

  local salida
  salida=$(docker exec arandano-dev-postgres-1 psql -U "${POSTGRES_USER:-arandano_dev}" \
    -d "${POSTGRES_DB:-arandano_dev}" -tAc \
    "SELECT rolsuper::text || ',' || rolbypassrls::text FROM pg_roles WHERE rolname='arandano_app'" \
    2>/dev/null | tr -d '[:space:]')

  check_eq "arandano_app existe y no es superusuario ni bypassrls" "false,false" "$salida"

  # RLS apagada en una tabla es indistinguible de "todo bien" mirando la app:
  # las queries siguen andando y devuelven de más.
  local sin_rls
  sin_rls=$(docker exec arandano-dev-postgres-1 psql -U "${POSTGRES_USER:-arandano_dev}" \
    -d "${POSTGRES_DB:-arandano_dev}" -tAc \
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
        AND c.relname <> '_prisma_migrations'" 2>/dev/null | tr -d '[:space:]')

  check_eq "ninguna tabla de dev quedó sin RLS" "0" "$sin_rls"
}
```

Y engancharla en `main()` (`scripts/verify-infra.sh:686`), en los dos lugares: una entrada `roles) suite_roles_db ;;` en el `case`, y `suite_roles_db` al final de la línea de `all)`. Las dos: sin la del `case` no se puede correr sola, y sin la de `all)` no corre nunca en la verificación completa, que es la que se mira.

- [ ] **Step 7: Correr la verificación**

```bash
scripts/verify-infra.sh roles
scripts/verify-infra.sh
```
Expected: la suite nueva en verde en las dos formas, y el resto sin regresiones.

- [ ] **Step 8: Enganchar `setup-db-roles.sh` a `setup-host.sh`**

Hasta acá los roles se crearon a mano. `scripts/setup-host.sh` es lo que deja la máquina configurada y re-ejecutable, así que tiene que saber crearlos: si alguien reconstruye el host desde ese script, los stacks tienen que quedar completos.

Agregar una función que lea `.env.dev` y llame al script con `--con-createdb`, siguiendo el estilo de las funciones que ya están en `setup-host.sh`, y llamarla desde donde el script encadena sus pasos. Producción **no** va acá: su `.env` vive fuera del repo, en `/srv/arandano/prod/`, y sus contraseñas se generan una sola vez (Task 10).

Verificar que sigue siendo idempotente:

```bash
scripts/setup-host.sh
scripts/setup-host.sh
```
Expected: las dos corridas terminan en 0, y la segunda no rompe nada.

- [ ] **Step 9: Commit**

```bash
git add .env.example docker/ scripts/verify-infra.sh scripts/setup-host.sh
git commit -m "$(cat <<'EOF'
feat(infra): las dos URLs de base por stack, y dev corriendo sin privilegios

DATABASE_URL pasa a usar arandano_app y aparece MIGRATE_DATABASE_URL con el
rol dueño, que sólo lee el CLI de Prisma.

verify-infra.sh suma dos comprobaciones: que arandano_app no sea
superusuario ni bypassrls, y que ninguna tabla haya quedado sin RLS. Las dos
fallan en silencio si no se miran a propósito — la app anda igual, sólo que
devuelve datos de más.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: El Dockerfile

**Files:**
- Modify: `Dockerfile`
- Modify: `.dockerignore`

**Interfaces:**
- Consumes: `prisma/schema.prisma`, `prisma.config.ts`, `npm run generate`.
- Produces: la imagen de runtime con el cliente generado adentro, y un target nuevo `migrate` que produce `arandano-migrate:<sha>`.

- [ ] **Step 1: Verificar que `.dockerignore` no deja afuera lo necesario**

`prisma/` y `prisma.config.ts` no están excluidos hoy, y tienen que seguir sin estarlo. Confirmar:

```bash
grep -nE 'prisma|generated' .dockerignore
```
Expected: sin resultados.

Agregar `generated` a `.dockerignore`, para que el build siempre genere el cliente en vez de copiar uno viejo del host:

```
generated
```

- [ ] **Step 2: Agregar `prisma generate` y la etapa `migrate`**

En `Dockerfile`, la etapa `build` ya corre `npm run build`, y el `prebuild` de `package.json` dispara `prisma generate`. Verificar que ocurra dejando el paso explícito antes del build:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Explícito y no sólo vía el prebuild de package.json: si alguien cambia los
# scripts de npm, el build tiene que seguir fallando acá y no producir una
# imagen sin cliente generado.
RUN npx prisma generate
RUN npm run build
```

Y agregar la etapa nueva, después de `runtime`:

```dockerfile
# Imagen de migración: el CLI de Prisma no está en la de runtime, que sale del
# output standalone y no lleva devDependencies. Se buildea del mismo SHA que la
# app, así que las migraciones que corren son exactamente las del código que se
# está promoviendo.
FROM node:24-alpine AS migrate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

ARG GIT_SHA
RUN test -n "$GIT_SHA" || { \
    echo "ERROR: falta --build-arg GIT_SHA=\$(git rev-parse --short HEAD)."; \
    exit 1; \
    }
ENV GIT_SHA=$GIT_SHA

# Sin CMD por defecto a propósito: quien la corre dice qué comando quiere
# (`migrate deploy`, `migrate status`, `migrate diff`), y así una corrida
# accidental sin argumentos no aplica nada.
ENTRYPOINT ["npx", "prisma"]
```

- [ ] **Step 3: Frenar `arandano-dev` antes de buildear**

```bash
docker compose -f docker/compose.dev.yml stop
```

No es opcional y no es cortesía: la aritmética de memoria de CLAUDE.md no cierra de otra forma. Prod 3200 MiB + dev 2304 + el build 2048 + ~1.1 GB de sistema ≈ 8.5 GB sobre una caja de 7.6. Con dev abajo el pico queda en ~7.5 GB. Sin esto, el OOM killer elige víctima durante el build, y puede ser el Postgres de producción.

Es el mismo orden que `deploy.sh` va a tener que respetar (bloqueante #6 de CLAUDE.md): dev abajo desde el primer paso, no antes del smoke test.

- [ ] **Step 4: Buildear las dos imágenes**

```bash
SHA=$(git rev-parse --short HEAD)

docker build --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --target runtime --build-arg GIT_SHA="$SHA" -t "arandano-app:$SHA" .

docker build --cgroup-parent=arandanobuild.slice \
  --resource memory=2g --resource cpu-quota=100000 \
  --target migrate --build-arg GIT_SHA="$SHA" -t "arandano-migrate:$SHA" .
```

Las banderas de recursos son las que efectivamente limitan en este host: `nice`, `--cpuset-cpus` y `--memory` son inertes acá y no avisan que lo son. Ver `docs/runbook-stacks.md`.

`--target runtime` no es opcional: `docker build` sin `--target` buildea la **última** etapa del Dockerfile. Sin él, el día que alguien agregue una etapa al final, `arandano-app:<sha>` pasa a contener otra cosa sin que nada avise. El Dockerfile además deja `runtime` último a propósito, pero las dos defensas van juntas.

Expected: los dos builds terminan en 0.

- [ ] **Step 5: Volver a levantar `arandano-dev`**

```bash
docker compose -f docker/compose.dev.yml up -d
```

- [ ] **Step 6: Verificar que la imagen de migración funciona**

```bash
set -a; . ./.env.dev; set +a
docker run --rm --network arandano-dev_default \
  -e MIGRATE_DATABASE_URL="postgres://arandano_owner:${ARANDANO_OWNER_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  "arandano-migrate:$(git rev-parse --short HEAD)" migrate status
```
Expected: reporta que la base está al día con las migraciones del repo.

- [ ] **Step 7: Verificar que la imagen de la app arranca y ve el cliente generado**

```bash
docker run --rm -d --name arandano-prueba-imagen --network arandano-dev_default \
  -e DATABASE_URL="postgres://arandano_app:${ARANDANO_APP_PASSWORD}@postgres:5432/${POSTGRES_DB}" \
  -e ARANDANO_DB_ESPERADA="${POSTGRES_DB}" \
  -p 127.0.0.1:3099:3000 "arandano-app:$(git rev-parse --short HEAD)"
sleep 20
curl -s http://127.0.0.1:3099/api/health
docker rm -f arandano-prueba-imagen
```
Expected: 200, con los checks `postgres` y `rol` en `ok`.

Si falla con un error de módulo no encontrado sobre `generated/prisma`, el output standalone de Next no arrastró el cliente. Remedio: agregar a la etapa `runtime`, después de las tres copias que ya están:

```dockerfile
COPY --from=build --chown=arandano:arandano /app/generated ./generated
```

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "$(cat <<'EOF'
build: generar el cliente en el build y sumar la imagen de migración

prisma generate va explícito en la etapa de build, no sólo vía el prebuild
de npm: si alguien toca los scripts, el build tiene que fallar en vez de
producir una imagen sin cliente.

La etapa migrate existe porque la imagen de runtime sale del output
standalone y no lleva devDependencies, así que no tiene CLI. Se buildea del
mismo SHA, de modo que las migraciones que corren son las del código que se
está promoviendo.

Sin CMD por defecto: una corrida sin argumentos no aplica nada.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Aplicar a producción

Producción hoy corre con la app conectada como superusuario y con la base sin tablas. Este paso es manual **por única vez**: es justamente el trabajo que `deploy.sh` va a automatizar en el ciclo siguiente. Va con la base vacía y sin ningún tenant, que es el momento más barato posible para hacerlo.

**Files:**
- Modify: `/srv/arandano/prod/.env` *(fuera del repo)*
- Modify: `docs/runbook-stacks.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: producción corriendo con `arandano_app`.

- [ ] **Step 1: Backup antes de tocar nada**

```bash
scripts/backup.sh --motivo=pre-migracion
```
Expected: termina en 0. Es la primera vez que este backup se usa en serio; si falla, **parar acá** y arreglarlo antes de seguir.

- [ ] **Step 2: Crear los roles en producción**

```bash
set -a; . /srv/arandano/prod/.env; set +a

OWNER_PASS=$(openssl rand -base64 24)
APP_PASS=$(openssl rand -base64 24)

docker exec arandano-prod-postgres-1 true   # confirmar que el contenedor está vivo

scripts/setup-db-roles.sh \
  --url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}" \
  --owner-password="$OWNER_PASS" \
  --app-password="$APP_PASS"
```

**Sin `--con-createdb`**: `migrate deploy` no usa shadow database, y un rol de producción con `CREATEDB` es privilegio regalado.

El Postgres de prod no publica puerto al host, así que si `127.0.0.1:5432` no responde, correr el script con `--url` apuntando al nombre del servicio desde dentro de la red:

```bash
--url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@arandano-prod-postgres-1:5432/${POSTGRES_DB}"
```

(el script ya corre psql en un contenedor con `--network=host`; para este caso, cambiarlo por `--network arandano-prod_default` en esa corrida puntual, o publicar el puerto temporalmente).

- [ ] **Step 3: Escribir las dos URLs en el `.env` de producción**

Agregar a `/srv/arandano/prod/.env`, y **cambiar** `DATABASE_URL` para que use `arandano_app`:

```
ARANDANO_OWNER_PASSWORD=<OWNER_PASS>
ARANDANO_APP_PASSWORD=<APP_PASS>
DATABASE_URL=postgres://arandano_app:<APP_PASS>@postgres:5432/arandano_prod
MIGRATE_DATABASE_URL=postgres://arandano_owner:<OWNER_PASS>@postgres:5432/arandano_prod
```

Guardar las contraseñas donde se guardan las de producción antes de cerrar la terminal: se generaron al vuelo y no están en ningún otro lado.

- [ ] **Step 4: Aplicar las migraciones**

```bash
SHA=$(git rev-parse --short HEAD)
set -a; . /srv/arandano/prod/.env; set +a

docker run --rm --network arandano-prod_default \
  -e MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL" \
  "arandano-migrate:$SHA" migrate deploy
```
Expected: aplica la migración inicial.

- [ ] **Step 5: Promover la imagen y recrear la app**

```bash
cd /srv/arandano/prod
IMAGE_TAG=$SHA docker compose up -d --force-recreate app
sleep 30
curl -s http://127.0.0.1/api/health
```
Expected: 200, con `postgres` y `rol` en `ok`, y `rol=arandano_app`.

Si algo falla, el rollback es volver el `DATABASE_URL` anterior en el `.env` y recrear el contenedor: la migración es puramente aditiva sobre una base vacía, así que el código viejo convive con el schema nuevo sin problema. Eso es expand/contract funcionando.

- [ ] **Step 6: Verificar que el backup sigue sirviendo ahora que hay tablas**

Hasta hoy la base de producción tenía 0 tablas, así que la comparación de conteos del restore nunca vio contenido real.

```bash
scripts/verify-backup.sh
```
Expected: termina en 0, y el log muestra las cinco tablas con conteos dentro de la banda. Si la guarda anti-vacío o la banda se quejan, ajustarlas en `scripts/verify-backup.sh` — con las tablas recién creadas y vacías, `0` es un conteo legítimo y la banda tiene que aceptarlo.

- [ ] **Step 7: Actualizar la documentación**

En `CLAUDE.md`, en *Bloqueantes antes del primer tenant real*, reemplazar el punto 1 por:

```markdown
1. **Completar el healthcheck.** El check de identidad del rol de conexión ya
   está (`lib/health/checks.ts`): rechaza superusuario, `BYPASSRLS` y ser dueño
   de las tablas. **Pendiente**: el check de query filtrada por tenant, que
   necesita un tenant conocido al que apuntar y llega con el tenant canario, y
   el de pg-boss, que espera a que pg-boss se configure.
```

Y en *Próximos pasos técnicos*, marcar como hecho lo del schema del núcleo, dejando anotado que `MovimientoStock`, `Venta`, `Pago` y `Factura` quedan para el ciclo de ventas.

En `docs/runbook-stacks.md`, agregar una sección corta sobre los dos roles: cuál usa la app, cuál migra, y que `scripts/setup-db-roles.sh` es idempotente y se puede volver a correr.

- [ ] **Step 8: Commit**

```bash
git add CLAUDE.md docs/runbook-stacks.md scripts/verify-backup.sh
git commit -m "$(cat <<'EOF'
docs: producción corriendo con el rol sin privilegios

El schema del núcleo está aplicado en prod y la app dejó de conectarse como
superusuario, así que las policies de RLS efectivamente aplican.

Actualiza el bloqueante #1 del healthcheck: el check de identidad del rol ya
está; quedan el de query filtrada por tenant (espera al tenant canario) y el
de pg-boss.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verificación final

- [ ] `npm test` — toda la suite en verde, incluidos los tests de integración contra el Postgres efímero.
- [ ] `npx tsc --noEmit` — sin errores.
- [ ] `npm run lint` — sin errores.
- [ ] `scripts/verify-infra.sh` — todas las suites en verde, incluida la nueva.
- [ ] `scripts/verify-backup.sh` — en verde con las tablas reales.
- [ ] `curl -s http://127.0.0.1/api/health` en prod — 200, `rol=arandano_app`.
- [ ] `git log --oneline` — un commit por tarea, ninguno con el árbol sucio detrás.
- [ ] **Después del merge y desde `/root/arandano`**, recrear dev para que su bind mount vuelva a apuntar al workspace principal y no al worktree, que está por desaparecer:

  ```bash
  cd /root/arandano
  docker compose -f docker/compose.dev.yml up -d --force-recreate
  docker inspect arandano-dev-app-1 --format '{{range .Mounts}}{{.Source}}{{"\n"}}{{end}}'
  ```

  Expected: la primera línea es `/root/arandano`. Si dice una ruta bajo `.claude/worktrees/`, el worktree todavía no se borró y dev se rompería al borrarlo.
