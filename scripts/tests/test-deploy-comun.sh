#!/usr/bin/env bash
# Tests unitarios de la lógica pura de deploy-comun.sh.
#
# Acá vive todo lo que decide si un deploy sigue o se frena, así que se prueba
# sin Docker, sin red y sin git: si estos tests necesitaran infraestructura,
# alguien terminaría salteándolos justo el día que importan.
set -uo pipefail
cd "$(dirname "$0")/../.."
source scripts/lib/deploy-comun.sh
# ok/bad/check_eq/check_true/check_false y los contadores PASS/FAIL están en
# lib-asserts.sh, no acá: ver el comentario equivalente en
# test-backup-comun.sh.
source scripts/tests/lib-asserts.sh

printf '\n\033[1mproxima_version\033[0m\n'
check_eq "sin tags arranca en v1.0.0"        "v1.0.0"  "$(proxima_version '' patch)"
check_eq "sin tags, minor también es v1.0.0" "v1.0.0"  "$(proxima_version '' minor)"
check_eq "patch sube el último número"       "v1.0.1"  "$(proxima_version v1.0.0 patch)"
# Sin aritmética de strings: v1.0.9 -> v1.0.10, no v1.0.91 ni v1.1.0.
check_eq "patch cruza la decena"             "v1.0.10" "$(proxima_version v1.0.9 patch)"
check_eq "minor sube y resetea el patch"     "v1.1.0"  "$(proxima_version v1.0.9 minor)"
check_eq "minor cruza la decena"             "v1.10.0" "$(proxima_version v1.9.4 minor)"
check_false "un tag con formato raro es error" proxima_version v2.0.0 patch
check_false "un tipo inventado es error"       proxima_version v1.0.0 cualquiera

printf '\n\033[1mmigracion_destructiva\033[0m\n'
# Exit 0 == encontró algo destructivo. Convención de grep.
check_true  "DROP COLUMN"    migracion_destructiva 'ALTER TABLE "tenants" DROP COLUMN "plan";'
check_true  "DROP TABLE"     migracion_destructiva 'DROP TABLE "clientes";'
check_true  "DROP SCHEMA"    migracion_destructiva 'DROP SCHEMA "viejo";'
check_true  "DROP TYPE"      migracion_destructiva 'DROP TYPE "estado_tenant_old";'
check_true  "DROP INDEX"     migracion_destructiva 'DROP INDEX "clientes_email_idx";'
check_true  "DROP VIEW"      migracion_destructiva 'DROP VIEW "vista_ventas";'
check_true  "DROP DEFAULT"   migracion_destructiva 'ALTER TABLE "clientes" ALTER COLUMN "activo" DROP DEFAULT;'
check_true  "TRUNCATE"       migracion_destructiva 'TRUNCATE "ventas";'
check_true  "RENAME COLUMN"  migracion_destructiva 'ALTER TABLE "users" RENAME COLUMN "mail" TO "email";'
check_true  "RENAME TO (rename de tabla)" migracion_destructiva 'ALTER TABLE "clientes" RENAME TO "customers";'
check_true  "cambio de tipo" migracion_destructiva 'ALTER TABLE "t" ALTER COLUMN "c" TYPE varchar(10);'
check_true  "en minúsculas"  migracion_destructiva 'alter table "t" drop column "c";'
# El caso más común de todos: Prisma emite exactamente esto cada vez que un
# campo opcional pasa a requerido. La imagen vieja sigue insertando filas sin
# esa columna y cada escritura vuela con "null value in column violates
# not-null constraint" — y el rollback revierte la imagen, no la base, así
# que no hay vuelta atrás.
check_true  "SET NOT NULL (campo vuelto obligatorio)" \
  migracion_destructiva 'ALTER TABLE "clientes" ALTER COLUMN "email" SET NOT NULL;'
# ALTER TYPE ... RENAME VALUE angosta un enum (el valor viejo deja de existir
# con ese nombre); es el caso de "ALTER TYPE que angosta" que nombra CLAUDE.md.
check_true  "ALTER TYPE ... RENAME VALUE angosta un enum" \
  migracion_destructiva "ALTER TYPE \"estado_tenant\" RENAME VALUE 'TRIAL' TO 'PRUEBA';"
# Lo aditivo tiene que pasar, o el gate se vuelve inservible y alguien lo apaga.
check_false "ADD COLUMN es aditivo"  migracion_destructiva 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'
check_false "CREATE TABLE"           migracion_destructiva 'CREATE TABLE "t" ("id" TEXT);'
check_false "CREATE TYPE no es ALTER TYPE" migracion_destructiva 'CREATE TYPE "estado" AS ENUM ("TRIAL");'
check_false "CREATE INDEX"           migracion_destructiva 'CREATE INDEX "i" ON "t"("c");'
# Un nombre de tabla o columna que CONTIENE la palabra no debe disparar el
# gate: TRUNCATE necesita límite de palabra, no sólo substring.
check_false "TRUNCATE no dispara por substring" \
  migracion_destructiva 'CREATE TABLE "truncated_log" ("id" TEXT);'
# Un DROP mencionado en un comentario no es un DROP.
check_false "comentario de línea"    migracion_destructiva '-- ojo: acá iba un DROP COLUMN
ALTER TABLE "t" ADD COLUMN "c" TEXT;'
# ...y uno escondido detrás de un comentario de bloque sí lo es.
check_true  "no se esconde tras un bloque" migracion_destructiva '/* nota */ DROP TABLE "t";'
# El patrón real que emite Prisma para CUALQUIER cambio de relación (agregar
# onDelete: Cascade, volver opcional una FK): dropea la constraint vieja y
# agrega una nueva con el MISMO nombre. Es rollback-safe -el código anterior
# no depende de que exista con ese nombre puntual entre medio- y bloquearlo
# es el falso positivo que enseña a saltear el gate.
check_false "DROP CONSTRAINT con su ADD CONSTRAINT correspondiente no frena (recreación de FK)" \
  migracion_destructiva 'ALTER TABLE "posts" DROP CONSTRAINT "posts_authorId_fkey";
ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;'
# Pero un DROP CONSTRAINT SIN su ADD sigue siendo destructivo.
check_true  "DROP CONSTRAINT sin su ADD sigue siendo destructivo" \
  migracion_destructiva 'ALTER TABLE "posts" DROP CONSTRAINT "posts_authorId_fkey";'
# Y uno cuyo nombre no podemos leer entre comillas no se puede verificar, así
# que se trata como destructivo (fallar cerrado, no abierto).
check_true  "DROP CONSTRAINT sin nombre entre comillas se trata como destructivo" \
  migracion_destructiva 'ALTER TABLE "posts" DROP CONSTRAINT posts_authorId_fkey;'
# Regresión con el artefacto real: la migración inicial del núcleo es
# puramente aditiva y NO debe frenar ningún deploy.
check_false "la migración inicial real es aditiva" \
  migracion_destructiva "$(cat prisma/migrations/20260804205911_inicial/migration.sql)"

# Si el pipeline de limpieza de comentarios se rompe (el caso real: `perl`
# ausente del PATH), la función tiene que fallar CERRADO y no dejar pasar
# todo en silencio. Se simula con una función de shell que shadea `perl` y
# devuelve 127 (comando no encontrado), exportada para que el subshell del
# pipeline la vea -sin tocar el PATH real ni romper `sed`/`tr`, que la función
# también necesita y que no son parte de lo que se está probando.
migracion_destructiva_con_perl_roto() {
  local sql="$1"
  (
    perl() { return 127; }
    export -f perl
    migracion_destructiva "$sql"
  )
}
check_true "sin perl en el PATH, una migración no vacía falla cerrado (se trata como destructiva)" \
  migracion_destructiva_con_perl_roto 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'

printf '\n\033[1mmensaje_de_tag / imagen_de_tag\033[0m\n'
MENSAJE="$(mensaje_de_tag 25297f7 20260804205911_inicial)"
check_true "el mensaje nombra la imagen" grep -q "^imagen: arandano-app:25297f7$" <<<"$MENSAJE"
check_true "el mensaje nombra las migraciones" grep -q "^migraciones: 20260804205911_inicial$" <<<"$MENSAJE"
check_eq "sin migraciones lo dice explícito" "migraciones: (ninguna)" \
  "$(mensaje_de_tag abc1234 '' | grep '^migraciones:')"
# La prueba que importa: son inversas. Si alguien cambia el formato de una y
# no de la otra, el rollback manual deja de encontrar a dónde volver.
check_eq "ida y vuelta" "25297f7" "$(imagen_de_tag "$MENSAJE")"
check_eq "ida y vuelta sin migraciones" "abc1234" \
  "$(imagen_de_tag "$(mensaje_de_tag abc1234 '')")"
check_false "un mensaje sin la línea de imagen es error" imagen_de_tag "una nota cualquiera"

printf '\n\033[1mhealth_ok / sha_del_health\033[0m\n'
SANO='{"status":"ok","checks":[{"name":"postgres","ok":true},{"name":"rol","ok":true}],"info":{"sha":"25297f7"}}'
ROTO='{"status":"error","checks":[{"name":"postgres","ok":true},{"name":"rol","ok":false}],"info":{"sha":"25297f7"}}'
MENTIROSO='{"status":"ok","checks":[{"name":"postgres","ok":true},{"name":"rol","ok":false}],"info":{"sha":"25297f7"}}'
VACIO='{"status":"ok","checks":[],"info":{"sha":"25297f7"}}'
check_true  "sano"                          health_ok "$SANO"
check_false "status error"                  health_ok "$ROTO"
# El caso que más importa: status ok con un check en false. Mirar sólo el
# status dejaría pasar un deploy con la app conectada como superusuario.
check_false "status ok con un check caído"  health_ok "$MENTIROSO"
# Cero checks no es salud, es ausencia de evidencia.
check_false "sin ningún check no está sano" health_ok "$VACIO"
check_false "un JSON inválido no está sano" health_ok 'esto no es json'
check_eq "extrae el sha" "25297f7" "$(sha_del_health "$SANO")"
check_false "sin info.sha es error" sha_del_health '{"status":"ok","checks":[{"ok":true}]}'

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
