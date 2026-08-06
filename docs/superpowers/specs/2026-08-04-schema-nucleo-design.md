# Spec: schema del núcleo y aislamiento multi-tenant

Fecha: 2026-08-04

Diseño de la primera migración de Prisma: los modelos del núcleo que sostienen
el patrón multi-tenant, las policies de Row Level Security que los aíslan, y el
mecanismo de la app que hace que esas policies realmente apliquen.

Lo que este ciclo produce no es "unas tablas". Es **el patrón**: cómo toda tabla
lleva `tenant_id`, cómo se escribe su policy, cómo se fija el tenant en la
conexión, y cómo se prueba que un tenant no ve al otro. Los cinco modelos son el
vehículo para ejercitarlo; los que vengan después lo copian.

## Por qué este ciclo, y no `deploy.sh`

El orden de bloqueantes de CLAUDE.md pone `deploy.sh` antes que el schema. Se
invirtió a conciencia: tres de los ocho requisitos de `deploy.sh` son sobre
migraciones (backup pre-migración, drift entre schema y migraciones, y rechazo
de migraciones destructivas), y hoy no hay Prisma en el repo. Escribirlos contra
un Prisma que no existe significa probarlos con fixtures y descubrir en el
primer deploy real qué se asumió mal.

El costo aceptado es que producción sigue sin gate de deploy mientras dure este
ciclo. Es tolerable porque todavía no hay ningún tenant real: lo que se protege
con el gate no existe. Deja de ser tolerable el día que haya uno, y por eso
`deploy.sh` es el ciclo siguiente, sin nada en el medio.

De paso, este ciclo cierra la mitad del bloqueante #1 del healthcheck (ver
*Impacto en lo que ya existe*).

## Estado del que se parte

Verificado sobre el VPS al escribir este spec:

- **No hay Prisma en el repo**: no existe `prisma/`, y `package.json` no lo
  lista ni como dependencia ni como devDependency. La única pieza que habla con
  Postgres es `lib/db.ts`, un pool de `pg` con `max: 5` que usa sólo el
  healthcheck.
- **La app se conecta como superusuario.** En dev, `DATABASE_URL` usa
  `arandano_dev`, que es el `POSTGRES_USER` que crea la imagen de Postgres:
  `usesuper = t`, `rolbypassrls = t`. Con ese rol, las policies de RLS **se
  ignoran en silencio**. Escribirlas sin cambiar esto no protegería nada.
- **El volumen de datos de producción ya existe** (`arandano-prod` corriendo
  desde hace horas), así que el `docker-entrypoint-initdb.d` de la imagen —que
  sólo corre sobre un volumen vacío— no es una vía para crear roles.
- **La base de producción tiene 0 tablas** y pesa 7,5 MB.
- Prisma publicado hoy: **7.9.1**. En la versión 7 el cliente no tiene binarios
  nativos (el compilador de queries va a WebAssembly) y los *driver adapters*
  son la vía normal de conexión. `@prisma/adapter-pg` acepta **un `pg.Pool` ya
  construido**, no sólo una cadena de conexión.

## Alcance

**Entra:** Prisma instalado y configurado; los cinco modelos del núcleo que
ejercitan el patrón; la migración inicial con sus policies de RLS; los dos roles
de Postgres y el script que los crea; la extensión de Prisma que fija el tenant
por operación; y la suite de tests de aislamiento.

**No entra**, y son sus propios ciclos: el middleware que resuelve subdominio →
tenant, Auth.js, y los modelos `MovimientoStock`, `Venta`, `Pago` y `Factura`.
Estos últimos quedan afuera porque su forma se decide junto con el flujo que los
usa —caja en pesos y dólares, relación venta ↔ factura de ARCA—, y adivinarla
desde un ciclo de datos es exactamente lo que después se paga en migraciones.

## Decisiones tomadas

| Decisión | Elección | Razón |
|---|---|---|
| Roles de Postgres | Dos: `arandano_owner` y `arandano_app`, ninguno superusuario | Es la única variante en la que RLS realmente aplica sobre el rol de la app |
| Dónde se crean | `scripts/setup-db-roles.sh`, idempotente, con el superusuario | Son infraestructura, no schema: las migraciones ya corren *como* el owner |
| Fijación del tenant | `set_config('arandano.tenant_id', …, true)` dentro de la transacción de cada operación | Local a la transacción: una conexión reciclada no arrastra el tenant anterior |
| Filtrado de lecturas | Las policies de RLS, no un `where` inyectado | La policy falla cerrado; el `where` sería una segunda cosa que se desactualiza |
| Escrituras | La extensión autocompleta `tenant_id` | Sin eso, `WITH CHECK` sólo rechazaría el insert; el valor hay que ponerlo igual |
| Nombres en la base | snake_case vía `@@map`/`@map` | Se escribe mucho SQL crudo; citar camelCase es una molestia permanente |
| IDs | uuid v7 | Un tenant que se mude a VPC dedicada no puede colisionar; un entero secuencial filtra volumen |
| Pool | Uno solo: Prisma reusa el `pg.Pool` de `lib/db.ts` | Un solo lugar donde vive el límite de conexiones |
| Tests de integración | En la misma suite que el resto, con Postgres efímero en `globalSetup` | Un test salteado dentro del gate de deploy es invisible, no "opcional" |

## Enfoques evaluados y descartados

- **Un solo rol, dueño y app a la vez, con `FORCE ROW LEVEL SECURITY`**
  *(descartado)*. Menos credenciales por stack. Pero ese rol puede correr
  `ALTER TABLE … DISABLE ROW LEVEL SECURITY` y reescribir sus propias policies:
  la segunda capa de defensa queda a merced del mismo código del que protege, y
  un bug la apaga sin que nada avise.
- **Sólo la extensión de Prisma, RLS más adelante** *(descartado)*. Deja el
  aislamiento en una sola capa, que es justo lo que CLAUDE.md descartó al elegir
  RLS ("si algún query se olvida el filtro, la base igual protege el dato"). Y
  cambiar el rol de conexión y el dueño de las tablas con clientes adentro es
  mucho más caro que hacerlo ahora.
- **Una transacción abierta durante todo el request**, con `SET LOCAL` al
  empezar *(descartado)*. Es la forma más obvia de garantizar que la GUC valga
  para todas las queries del request, pero con un pool de 5 conexiones, seis
  requests concurrentes se quedan esperando a que alguno termine.
- **Separar los tests de integración por nombre de archivo** (`*.int.test.ts` y
  su propio script) *(descartado)*. `vitest.config.mts` ya argumenta por qué el
  `include` abarca todo el repo: un glob acotado no hace fallar los tests de
  afuera, los vuelve invisibles. Separarlos reintroduce el mismo problema por
  otra puerta.
- **Los nueve modelos del núcleo de una vez** *(descartado)*. Ver *Alcance*.

## Arquitectura

Cinco piezas, cada una con un propósito único:

| Pieza | Responsabilidad |
|---|---|
| `prisma/schema.prisma` | Los modelos y su mapeo a snake_case |
| `prisma/migrations/…` | DDL generado por Prisma **más** el SQL de las policies, escrito a mano |
| `scripts/setup-db-roles.sh` | Crea los dos roles, sus grants y los default privileges. Idempotente |
| `lib/tenant/prisma.ts` | `prismaParaTenant(tenantId)`: el cliente extendido |
| `lib/db.ts` *(extendido)* | Sigue siendo el único pool; ahora también lo usa Prisma |

## Roles y credenciales

**`arandano_owner`** — dueño de las tablas, corre las migraciones. No es
superusuario, así que no puede saltear RLS por privilegio. Pero como es *dueño*
de las tablas, Postgres lo exime de sus propias policies, que es precisamente lo
que una migración con backfill necesita para poder tocar filas de todos los
tenants.

**`arandano_app`** — el rol de la app. No es dueño de nada, `NOSUPERUSER`,
`NOBYPASSRLS`. Tiene `SELECT`, `INSERT`, `UPDATE` y `DELETE` sobre las tablas y
nada más. Es el único rol sobre el que las policies efectivamente aplican.

`POSTGRES_USER` (el superusuario que crea la imagen) deja de ser el rol de la
app. Queda para lo que ya hace: crear estos dos roles y tomar los backups.

**El grant que evita que esto se rompa en la migración N+1:**

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE arandano_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO arandano_app;
```

Sin esto, cada tabla que agregue una migración futura nace invisible para la
app, y alguien tiene que acordarse de escribir el `GRANT` a mano. Con esto, el
permiso viene solo.

**Dónde viven los roles.** En `scripts/setup-db-roles.sh <stack>`, idempotente,
aplicado con el superusuario del stack. No pueden vivir en una migración de
Prisma: las migraciones ya corren *como* `arandano_owner`, así que el rol tiene
que existir antes de la primera. Lo invoca `setup-host.sh` para dev y prod, y
`deploy.sh` para stage — el Postgres de stage es efímero y nace sin roles en
cada corrida.

**Tres detalles de Postgres 17 que hay que atender explícitamente:**

1. El schema `public` ya no le da `CREATE` a todo el mundo, así que
   `arandano_owner` necesita `GRANT CREATE ON SCHEMA public`.
2. `prisma migrate dev` necesita una *shadow database*, así que en dev
   `arandano_owner` lleva `CREATEDB`. En prod no: `migrate deploy` no la usa, y
   un rol de producción con `CREATEDB` es privilegio regalado.
3. Cada stack suma una segunda variable de entorno, `MIGRATE_DATABASE_URL` (la
   del owner), al lado de `DATABASE_URL` (la de la app).

### Cuál de las dos URLs usa cada cosa

Es la ambigüedad más peligrosa de este diseño, así que se resuelve por
construcción y no por disciplina: **`prisma.config.ts` declara
`datasource: { url: process.env.MIGRATE_DATABASE_URL }`**.

En Prisma 7 la URL de conexión salió de `schema.prisma` —el bloque `datasource`
ya no lleva `url`— y vive en `prisma.config.ts`, que **sólo lee el CLI**. El
cliente en runtime se conecta a través del `pg.Pool` que se le pasa al driver
adapter, y no lee ese archivo en absoluto. Así que no queda ninguna combinación
de variables en la que la app se conecte como owner por error: la app no tiene
forma de enterarse de que `MIGRATE_DATABASE_URL` existe.

`prisma.config.ts` tampoco carga `.env` por su cuenta, y eso también juega a
favor: la URL del owner tiene que estar puesta explícitamente en el entorno del
comando que migra, en vez de aparecer sola porque había un archivo al lado.

## Modelos

Cinco modelos, mapeados a snake_case en la base.

- **`tenants`** — `id` (uuid v7), `subdominio` (único **global**), `nombre`,
  `estado` ∈ {`TRIAL`, `ACTIVO`, `SUSPENDIDO`}, `creado_en`, `actualizado_en`.
  No tiene `tenant_id`: es la raíz.
- **`tenant_modules`** — PK compuesta (`tenant_id`, `modulo`), con `modulo` ∈
  {`ORDENES_DE_TRABAJO`, `TURNOS`, `GASTRONOMIA`} y `activado_en`. La activación
  de un módulo es una fila, como ya decidió CLAUDE.md.
- **`users`** — `nombre`, `email`, `rol` ∈ {`DUENO`, `EMPLEADO`}. Único
  **(`tenant_id`, `email`)**, no global: la misma persona puede trabajar en dos
  negocios distintos.
- **`clientes`** — `nombre`, `telefono?`, `email?`.
- **`articulos`** — único (`tenant_id`, `sku`), `nombre`, `tipo` ∈ {`PRODUCTO`,
  `SERVICIO`}, `precio` como `Decimal(12,2)`.

`Decimal` y nunca `Float` para plata: un flotante binario no representa 0,10 y
los errores se acumulan en cada suma de una caja.

IDs uuid v7 y no autoincrementales, por dos razones: un tenant que se mude de
Postgres compartido a VPC dedicada no puede colisionar con nadie, y un entero
secuencial le filtra a cada cliente cuánto factura el resto. La v7 en particular
mantiene la localidad del índice, cosa que un uuid v4 pierde.

**Omisiones deliberadas**, todas migraciones aditivas baratas cuando llegue su
ciclo: `plan` en `tenants` (llega con la facturación de la plataforma),
`password_hash` en `users` (llega con Auth.js), y cualquier columna de stock en
`articulos` — el stock va a ser el saldo del ledger de `movimientos_stock`, no
una columna que se actualiza.

## Row Level Security

Una policy por tabla, siempre con la misma forma:

```sql
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_aislamiento ON clientes FOR ALL
  USING      (tenant_id = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
```

Las tres piezas de esa expresión importan y ninguna es decorativa:

- El segundo argumento `true` de `current_setting` hace que una GUC sin setear
  devuelva `NULL` en vez de tirar error.
- El `nullif` evita que una cadena vacía llegue al cast y lo haga explotar.
- Como `NULL = uuid` da `NULL`, y `NULL` no es `true`, **sin GUC no pasa ninguna
  fila**. Falla cerrado, que es la única forma aceptable de fallar acá.

El `WITH CHECK` es lo que impide insertar una fila con el `tenant_id` de otro y
lo que impide que un `UPDATE` mueva una fila existente a otro tenant. Se escribe
explícito aunque en estas policies sea redundante: como son `FOR ALL`, Postgres
ya reusa la expresión de `USING` para las escrituras cuando `WITH CHECK` se
omite. Va escrito igual por dos razones — que la intención de la policy se lea
sin tener que recordar esa regla, y que la policy no cambie de significado el día
que alguien la reescriba como policies separadas por comando, donde la omisión
**sí** dejaría la protección en sólo lectura.

En `tenants` la policy compara contra `id` en vez de `tenant_id`, de modo que un
tenant tampoco pueda enumerar a los demás.

Las policies se escriben **sin cláusula `TO`**, así que aplican a cualquier rol
que no esté exento por ser dueño o superusuario. Nombrar un rol adentro de la
policy la ataría a que ese rol exista antes que la tabla, y eso es exactamente el
fallo que `verify-backup.sh` ya documenta haber reproducido: una `CREATE POLICY`
que nombra un rol inexistente hace salir a `pg_restore` con 1 y deja la policy
sin crear. Sin `TO`, el restore no depende del orden.

**Consecuencia que hay que tener presente: `arandano_app` no puede crear
tenants.** El `WITH CHECK` de `tenants` exige que la fila nueva coincida con la
GUC, y al dar de alta un tenant todavía no hay ninguna GUC que poner. El alta es
una operación de la plataforma, no de un tenant, así que va a necesitar un camino
privilegiado propio —el rol owner o una función `SECURITY DEFINER`— que se
diseña en el ciclo de registro. No se resuelve acá, y anotarlo evita que en ese
ciclo se lo confunda con un bug de las policies.

### El guardarraíl de cobertura

Prisma no genera policies: las escribe una persona a mano en el SQL de cada
migración. Una tabla nueva sin policy queda **completamente desprotegida** y
nada lo grita — RLS viene deshabilitada por defecto.

Por eso un test recorre `pg_class` y `pg_policies` y exige dos cosas:

1. Toda tabla del schema `public` que tenga columna `tenant_id` tiene RLS
   habilitada y su policy `tenant_aislamiento` con `USING` y con `WITH CHECK`.
2. Toda tabla que **no** tenga `tenant_id` está en una lista blanca explícita y
   corta, y cada entrada dice por qué está ahí. Hoy son dos: `tenants`, que se
   aísla por `id` porque es la raíz, y `_prisma_migrations`, que no tiene datos
   de ningún tenant.

La segunda mitad es la que evita que el check pase por vacío cuando alguien se
olvidó la columna en vez de la policy. La lista blanca se escribe a mano a
propósito: agregarle una entrada tiene que ser una decisión visible en el diff,
no algo que el check deduzca solo.

## Capa de app

`lib/tenant/prisma.ts` expone `prismaParaTenant(tenantId)`, que devuelve un
cliente extendido. La extensión envuelve **cada operación** en su propia
transacción, y lo primero que corre adentro es:

```sql
SELECT set_config('arandano.tenant_id', $1, true)
```

El tercer argumento `true` la hace local a la transacción: muere cuando la
transacción termina. Ese es el argumento de seguridad completo — una conexión
devuelta al pool y reusada por otro request nunca arrastra el tenant anterior.

Una transacción por operación, y no una por request: el pool es de cinco
conexiones, y una transacción abierta mientras dura el request significa que el
sexto request concurrente espera. El costo asumido es un ida y vuelta extra por
query.

**El reparto entre las dos capas:**

- **RLS filtra las lecturas.** La extensión no inyecta ningún `where`. Es una
  desviación consciente de cómo lo describe CLAUDE.md, y la razón es que la
  policy falla cerrado: cualquier camino que se saltee la extensión —el cliente
  sin extender, o el `pool` de `lib/db.ts` directo— ya devuelve cero filas.
  Inyectar el `where` no agrega defensa, agrega una segunda cosa que puede
  quedar desactualizada respecto de la primera. La defensa real contra una tabla
  sin proteger es el test de cobertura, no un filtro duplicado.
- **La extensión autocompleta `tenant_id`** en `create`, `createMany` y
  `upsert`. Sin eso, `WITH CHECK` sólo rechazaría el insert: el valor hay que
  ponerlo igual, y ponerlo en un solo lugar es mejor que repetirlo en cada punto
  de llamada.

**Un solo pool.** `@prisma/adapter-pg` acepta un `pg.Pool` ya construido, así
que Prisma usa el de `lib/db.ts` en vez de abrir uno propio. El límite de
conexiones queda definido en un único lugar, que es donde ya está documentado
por qué vale 5.

## Testing

Los tests de aislamiento necesitan un Postgres de verdad: nada de esto se puede
probar con mocks, porque lo que se está probando *es* el comportamiento de la
base.

Un `globalSetup` de vitest levanta un Postgres efímero con el mismo patrón que
`verify-backup.sh` ya usa y tiene justificado (`postgres:17-alpine`, tmpfs de
320 MiB bajo un límite de 512 MiB de memoria, `PGDATA` en un subdirectorio),
aplica las migraciones como `arandano_owner`, corre `setup-db-roles.sh` y siembra
dos tenants.

**Si Docker no está disponible, los tests fallan.** No se saltean. Un test
salteado dentro del gate de deploy es el mismo problema de invisibilidad que
`vitest.config.mts` ya documenta para el `include`.

Los casos que tienen que existir:

1. **Cobertura de RLS** (ver arriba): tablas con `tenant_id` protegidas, tablas
   sin `tenant_id` en la lista blanca.
2. **Identidad del rol**: `arandano_app` no es superusuario, no tiene
   `BYPASSRLS`, y no es dueño de ninguna tabla. Si este test falla, todos los
   demás pasan por casualidad, así que vale por sí solo.
3. Con la GUC del tenant A, un `SELECT` no devuelve filas del tenant B — en las
   cuatro tablas que tienen `tenant_id`.
4. Sin GUC seteada, cero filas.
5. Un `INSERT` con el `tenant_id` de otro tenant es rechazado.
6. Un `UPDATE` que intenta mover una fila de A a B es rechazado.
7. El único `(tenant_id, email)` permite el mismo email en dos tenants, y lo
   rechaza dentro del mismo.
8. La extensión autocompleta `tenant_id` en `create`.
9. **Dos operaciones consecutivas con tenants distintos sobre el mismo pool no
   se contaminan.** Es el test que atrapa el bug que arruinaría todo lo demás, y
   la razón de que `set_config` sea local a la transacción.

## Impacto en lo que ya existe

| Pieza | Cambio |
|---|---|
| `.env.example`, `.env.dev`, `/srv/arandano/prod/.env` | Suman `MIGRATE_DATABASE_URL` (owner) al lado de `DATABASE_URL` (app), y esta última pasa a usar `arandano_app`. La app nunca recibe la del owner. |
| `docker/compose.{dev,stage,prod}.yml` | Pasan ambas variables. Stage además necesita que `setup-db-roles.sh` corra al levantar, porque su base es efímera. |
| `lib/db.ts` | Su pool pasa a ser también el de Prisma, vía `PrismaPg`. |
| `lib/health/checks.ts` | Nuevo check de identidad del rol de conexión. |
| `Dockerfile` | `prisma generate` en la etapa de build, y una etapa nueva que produce `arandano-migrate:<sha>`. |
| `scripts/verify-backup.sh` | La base deja de tener 0 tablas: hay que revisar que la banda de conteos del restore siga teniendo sentido con tablas reales. |

### El check nuevo del healthcheck

`lib/health/checks.ts` ya comprueba **contra qué base** está hablando la app. El
check nuevo comprueba **con qué rol**: que `current_user` no sea superusuario, no
tenga `BYPASSRLS`, y no sea dueño de las tablas. Es el complemento exacto del
que ya está, y atrapa la única configuración que apagaría RLS sin hacer ruido —
un `DATABASE_URL` de producción apuntando al rol equivocado.

### El bloqueante #1 queda a mitad, y es a propósito

CLAUDE.md pide dos checks para cerrar el bloqueante #1: uno de query filtrada por
tenant y uno de pg-boss. Este ciclo suma el de identidad del rol, que no estaba
pedido pero es más barato y ataca el mismo riesgo.

El de **query filtrada por tenant que devuelva datos** necesita un tenant
conocido al que apuntar, y en producción todavía no existe ninguno. Inventar uno
para que el check tenga a quién consultar sería peor que dejarlo pendiente:
quedaría una fila fantasma en la base de producción cuyo único propósito es que
un check pase. Cierra cuando exista el tenant canario.

El de **pg-boss** sigue esperando a que pg-boss se configure, que es otro ciclo.

## Contrato con `deploy.sh`

Lo que este spec le deja definido al ciclo siguiente:

- `prisma migrate deploy` corre con `MIGRATE_DATABASE_URL`, **nunca** con
  `DATABASE_URL`. Migrar con el rol de la app falla, y falla ruidosamente,
  porque `arandano_app` no es dueño de nada.
- El CLI de Prisma sale de la imagen `arandano-migrate:<sha>`, construida en el
  mismo build y con el mismo SHA que la imagen de la app. La imagen de runtime no
  tiene devDependencies y por lo tanto no tiene CLI.
- `scripts/setup-db-roles.sh stage` corre antes de migrar en stage, porque el
  Postgres de stage nace vacío en cada deploy.
- El chequeo de drift entre schema y migraciones (bloqueante #9) necesita una
  shadow database. El patrón del Postgres efímero ya existe en
  `verify-backup.sh` y ahora también en el `globalSetup` de los tests: se
  reusa, no se inventa.

## Riesgos asumidos

- **Una tabla futura sin policy queda desprotegida.** Es el riesgo central de
  usar RLS con un ORM que no la genera. Mitigado por el test de cobertura, que
  es la única razón por la que este riesgo es tolerable. Si ese test se debilita
  o se saltea, el riesgo vuelve entero.
- **Un ida y vuelta extra por query.** El `set_config` por operación cuesta un
  round trip. Sobre una base local en el mismo host es sub-milisegundo, y se
  acepta a cambio de no sostener transacciones largas contra un pool de 5. Si
  algún día el volumen lo hace notar, la salida es agrupar operaciones en una
  transacción explícita por request para los caminos calientes, no aflojar el
  mecanismo.
- **Dos credenciales por stack en vez de una.** Más superficie de configuración
  y una variable más que se puede poner mal. El check nuevo del healthcheck
  existe justamente para que ponerla mal se note.
