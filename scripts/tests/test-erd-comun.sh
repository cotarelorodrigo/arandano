#!/usr/bin/env bash
# Tests unitarios del generador del ERD.
#
# La entrada es el DDL que emite `prisma migrate diff`, no el schema de Prisma.
# Ver docs/superpowers/specs/2026-08-07-diagrama-schema-design.md, sección
# "Por qué esta es la segunda versión": parsear la gramática de Prisma se llevó
# cuatro rondas de review encontrando siempre lo mismo —formas que Prisma acepta
# y el parser leía mal, en silencio y con exit 0— hasta que quedó claro que los
# reviewers usaban `prisma migrate diff` como árbitro. Se genera de ahí.
#
# El DDL de los fixtures NO está escrito a mano: sale de correr Prisma y pegar.
# Un fixture inventado prueba contra lo que uno cree que Prisma emite, que es
# exactamente el error que costó las cuatro rondas.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/tests/lib-asserts.sh
source scripts/lib/erd-comun.sh

# --- Fixture: recorte del DDL real de este repo, generado con
# `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`
DDL=$(cat <<'EOF'
-- CreateEnum
CREATE TYPE "estado_tenant" AS ENUM ('TRIAL', 'ACTIVO', 'SUSPENDIDO');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "subdominio" TEXT NOT NULL,
    "estado" "estado_tenant" NOT NULL DEFAULT 'TRIAL',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "apodo" TEXT,
    "precio" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_modules" (
    "tenant_id" UUID NOT NULL,
    "modulo" TEXT NOT NULL,

    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("tenant_id","modulo")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdominio_key" ON "tenants"("subdominio");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "users_apodo_idx" ON "users"("apodo");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EOF
)

SALIDA=$(erd_desde_ddl "$DDL")

printf '\n\033[1mentidades y columnas\033[0m\n'
check_true "la entidad usa el nombre del CREATE TABLE" grep -qE '^  tenants \{' <<<"$SALIDA"
check_true "las tres tablas están" \
  test "$(grep -cE '^  (tenants|users|tenant_modules) \{' <<<"$SALIDA")" = 3
check_true "una columna sale con su tipo en minúsculas" grep -qE '^    uuid id PK$' <<<"$SALIDA"
check_true "el tipo conserva sus argumentos"            grep -q 'decimal(12,2) precio' <<<"$SALIDA"
check_true "una columna de tipo enum usa el nombre del enum" grep -q 'estado_tenant estado' <<<"$SALIDA"
check_true "timestamptz conserva la precisión"          grep -q 'timestamptz(3) creado_en' <<<"$SALIDA"

printf '\n\033[1mclaves\033[0m\n'
check_true "PK simple"       grep -qE '^    uuid id PK$' <<<"$SALIDA"
check_true "PK compuesta: las dos columnas" \
  test "$(sed -n '/tenant_modules {/,/}/p' <<<"$SALIDA" | grep -c ' PK')" = 2
check_true "FK marcada"      grep -qE 'uuid tenant_id FK' <<<"$SALIDA"
# Un UK pelado afirma que la columna sola es única. Con un índice compuesto eso
# es falso: users_tenant_id_email_key no impide dos filas con el mismo email.
check_true  "índice único de una columna -> UK" grep -qE '^    text subdominio UK$' <<<"$SALIDA"
check_false "índice único compuesto NO da UK a email" grep -qE 'text email[^"]*UK' <<<"$SALIDA"
check_true  "y en cambio lo dice en el comentario"    grep -q 'email "único junto a tenant_id"' <<<"$SALIDA"
check_true  "la otra columna del compuesto también"   grep -q 'tenant_id FK "único junto a email"' <<<"$SALIDA"

printf '\n\033[1mopcionalidad\033[0m\n'
# Mermaid no tiene marcador de nullable: va al comentario. Meterlo en el tipo
# produciría un tipo que no existe en Postgres.
check_true  "sin NOT NULL -> opcional"    grep -q 'text apodo "opcional"' <<<"$SALIDA"
check_false "con NOT NULL no dice nada"   grep -q 'text email "opcional"' <<<"$SALIDA"

printf '\n\033[1mrelaciones\033[0m\n'
check_true "la FK produce una línea de relación" grep -qE '^  tenants \|\|--o\{ users' <<<"$SALIDA"
check_true "con el ON DELETE que dice el DDL"    grep -q 'ON DELETE CASCADE' <<<"$SALIDA"
check_true "y respeta un ON DELETE distinto"     grep -q 'ON DELETE RESTRICT' <<<"$SALIDA"
check_true "una relación por FK, ni más ni menos" \
  test "$(grep -cE '^  \w+ \|[|o]--' <<<"$SALIDA")" = 2

printf '\n\033[1menums e índices\033[0m\n'
check_true  "el enum sale con su nombre y sus etiquetas reales" \
  grep -qE '^\- \*\*estado_tenant\*\*: `TRIAL`, `ACTIVO`, `SUSPENDIDO`$' <<<"$SALIDA"
check_false "el enum NO es una entidad del ERD" grep -qE '^  estado_tenant \{' <<<"$SALIDA"
# Sin esto un lector concluye que users no tiene ningún índice.
check_true  "el índice no único se lista aparte" grep -q 'users_apodo_idx' <<<"$SALIDA"
check_false "y no se confunde con un único"      grep -qE 'text apodo[^"]*UK' <<<"$SALIDA"

printf '\n\033[1msalida estable\033[0m\n'
check_eq "dos corridas idénticas dan lo mismo" \
  "$(erd_desde_ddl "$DDL" | md5sum)" "$(erd_desde_ddl "$DDL" | md5sum)"
check_true "las tablas salen ordenadas" \
  test "$(grep -oE '^  \w+ \{' <<<"$SALIDA" | tr -d ' {')" = "$(grep -oE '^  \w+ \{' <<<"$SALIDA" | tr -d ' {' | sort)"

printf '\n\033[1muno a uno\033[0m\n'
# Una FK cubierta por un índice único es 1-1. Se lee del SQL, no se infiere.
UNO=$(erd_desde_ddl 'CREATE TABLE "perfiles" (
    "user_id" UUID NOT NULL,
    CONSTRAINT "perfiles_pkey" PRIMARY KEY ("user_id")
);
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "perfiles_user_id_key" ON "perfiles"("user_id");
ALTER TABLE "perfiles" ADD CONSTRAINT "perfiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;')
check_true "FK cubierta por un índice único -> uno a uno" grep -qE 'users \|\|--\|\| perfiles' <<<"$UNO"
# La PK compuesta de tenant_modules cubre tenant_id, pero la FK es sólo una de
# sus dos columnas: no es 1-1, y confundirlo afirmaría algo que la base prohíbe.
check_true "una FK que cubre parte de la PK sigue siendo uno a muchos" \
  grep -qE 'tenants \|\|--o\{ tenant_modules' <<<"$SALIDA"

printf '\n\033[1mfalla cerrado\033[0m\n'
check_false "DDL vacío es error"          erd_desde_ddl ""
check_false "DDL sin ninguna tabla es error" erd_desde_ddl 'CREATE SCHEMA IF NOT EXISTS "public";'
# Lo que no se entiende se rechaza. El silencio es la falla que un documento
# regenerado en cada commit no sobrevive: nadie lo contradice después.
check_false "una sentencia desconocida es error" erd_desde_ddl 'CREATE TABLE "a" (
    "id" UUID NOT NULL,
    CONSTRAINT "a_pkey" PRIMARY KEY ("id")
);
CREATE MATERIALIZED VIEW "v" AS SELECT 1;'
check_false "una línea rara adentro de un CREATE TABLE es error" erd_desde_ddl 'CREATE TABLE "a" (
    esto no es una columna,
    CONSTRAINT "a_pkey" PRIMARY KEY ("id")
);'
check_false "un CREATE TABLE sin cerrar es error" erd_desde_ddl 'CREATE TABLE "a" (
    "id" UUID NOT NULL,'
check_false "una FK a una tabla que no existe es error" erd_desde_ddl 'CREATE TABLE "a" (
    "id" UUID NOT NULL,
    CONSTRAINT "a_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "a" ADD CONSTRAINT "a_x_fkey" FOREIGN KEY ("id") REFERENCES "fantasma"("id") ON DELETE CASCADE ON UPDATE CASCADE;'

# Un identificador con un espacio rompe el render de Mermaid, que delimita
# `tipo nombre claves comentario` por espacios. Emitirlo daría una caja roja en
# GitHub, o peor, un diagrama que nombra tablas que no existen.
check_false "un identificador con un espacio se rechaza" erd_desde_ddl 'CREATE TABLE "mi tabla" (
    "id" UUID NOT NULL,
    CONSTRAINT "x_pkey" PRIMARY KEY ("id")
);'

printf '\n\033[1mDEFAULT con caracteres molestos\033[0m\n'
# Un DEFAULT puede traer paréntesis, comillas y comas. Nada de eso puede
# desalinear el parseo de la columna que lo lleva ni de la siguiente.
RAROS=$(erd_desde_ddl 'CREATE TABLE "a" (
    "id" UUID NOT NULL,
    "nota" TEXT NOT NULL DEFAULT '"'"'con (parentesis, y coma'"'"',
    "otra" TEXT NOT NULL DEFAULT '"'"'cierra) rara'"'"',
    "ultima" TEXT NOT NULL,
    CONSTRAINT "a_pkey" PRIMARY KEY ("id")
);')
check_true "las cuatro columnas sobreviven a los DEFAULT raros" \
  test "$(sed -n '/  a {/,/}/p' <<<"$RAROS" | grep -cE '^    \w')" = 4
check_true "la columna posterior al DEFAULT raro está entera" grep -qE 'text ultima$' <<<"$RAROS"

# El NOT NULL se busca ANCLADO al arranque de lo que sigue al tipo, no en toda
# la cola: Prisma emite siempre `TIPO [NOT NULL] [DEFAULT ...]` en ese orden, y
# un DEFAULT puede contener ese mismo texto. Sin el ancla, esta columna
# —nullable, con el literal "NOT NULL" como default— se leería obligatoria.
MENTIROSO=$(erd_desde_ddl 'CREATE TABLE "a" (
    "id" UUID NOT NULL,
    "trampa" TEXT DEFAULT '"'"'NOT NULL'"'"',
    CONSTRAINT "a_pkey" PRIMARY KEY ("id")
);')
check_true "un DEFAULT que dice NOT NULL no vuelve obligatoria a la columna" \
  grep -q 'text trampa "opcional"' <<<"$MENTIROSO"

printf '\n\033[1mel DDL real de este repo\033[0m\n'
# La aserción que atrapa una regresión el día que alguien agregue un modelo con
# una forma que los fixtures no cubren. El DDL se genera acá mismo con Prisma.
REAL_DDL=$(npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script 2>/dev/null)
check_true "prisma migrate diff corrió" test -n "$REAL_DDL"
REAL=$(erd_desde_ddl "$REAL_DDL")
check_true "las cinco tablas del núcleo" \
  test "$(grep -cE '^  (tenants|tenant_modules|users|clientes|articulos) \{' <<<"$REAL")" = 5
check_true "las cuatro relaciones hacia tenants" \
  test "$(grep -cE '^  tenants \|\|--o\{' <<<"$REAL")" = 4
check_true "los cuatro enums"        test "$(grep -cE '^\- \*\*(estado_tenant|modulo|rol_usuario|tipo_articulo)\*\*' <<<"$REAL")" = 4
check_true "tenants no tiene tenant_id" \
  test "$(sed -n '/^  tenants {/,/^  }/p' <<<"$REAL" | grep -c 'tenant_id')" = 0
check_false "email no dice ser único solo" grep -qE 'text email[^"]*UK' <<<"$REAL"
check_true  "y sí dice de qué es parte"    grep -q 'email "único junto a tenant_id"' <<<"$REAL"
check_true  "el índice de clientes se lista" grep -q 'clientes_tenant_id_idx' <<<"$REAL"
# Ningún tipo puede llevar un espacio: Mermaid delimita por espacios y el
# diagrama no renderizaría.
check_false "ningún tipo emitido tiene un espacio" \
  grep -qE '^    [a-z0-9_()]+ [a-z0-9_()]+ [a-z]' <<<"$(grep -E '^    ' <<<"$REAL" | grep -vE '(PK|FK|UK|")')"

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
