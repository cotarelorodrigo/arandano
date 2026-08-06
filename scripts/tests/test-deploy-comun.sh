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
# Las dos formas que Prisma realmente emite para un cambio de tipo de
# columna, confirmadas corriendo `npx prisma migrate diff` de verdad (ver
# task-2-report.md): "SET DATA TYPE" para un cambio de tipo simple, y el
# "TYPE" a secas (sin "SET DATA") dentro del bloque que recrea un enum
# angostado. El primer intento de esta lib sólo cubría la forma sin "SET
# DATA", que Prisma nunca genera; la aserción original (con `varchar(10)` en
# minúsculas) pasaba igual porque estaba escrita a partir del patrón y no del
# SQL real, y por eso no atrapó el hueco.
check_true  "cambio de tipo (SET DATA TYPE, la forma real de Prisma)" \
  migracion_destructiva 'ALTER TABLE "Cliente" ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(20);'
check_true  "cambio de tipo (TYPE a secas, dentro de la recreación de un enum)" \
  migracion_destructiva 'ALTER TABLE "Tenant" ALTER COLUMN "estado" TYPE "Estado_new" USING ("estado"::text::"Estado_new");'
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
# ALTER TYPE ... ADD VALUE agranda un enum: la imagen vieja no conoce el valor
# nuevo pero sigue funcionando, así que es aditivo. Es la contracara de RENAME
# VALUE, y los dos empiezan igual.
check_false "ALTER TYPE ... ADD VALUE agranda un enum y es aditivo" \
  migracion_destructiva "ALTER TYPE \"estado_tenant\" ADD VALUE 'PAUSADO';"
# Una columna que se LLAMA truncated tampoco: mismo motivo que truncated_log,
# distinto lugar de la sentencia.
check_false "una columna llamada truncated no dispara TRUNCATE" \
  migracion_destructiva 'ALTER TABLE "ventas" ADD COLUMN "truncated" BOOLEAN NOT NULL DEFAULT false;'
# Regresión con el artefacto real: la migración inicial del núcleo es
# puramente aditiva y NO debe frenar ningún deploy.
check_false "la migración inicial real es aditiva" \
  migracion_destructiva "$(cat prisma/migrations/20260804205911_inicial/migration.sql)"

# Las dos regresiones con SQL generado por Prisma de verdad, no escrito a mano
# a partir del patrón (que es el error de método que dejó pasar el hueco de
# "SET DATA TYPE" en su momento). Se obtuvieron con
# `npx prisma migrate diff --from-schema a.prisma --to-schema b.prisma --script`
# entre dos schemas mínimos, sin tocar ninguna base; los comandos y la salida
# completa están en task-2-report.md.
ADITIVA_REAL_DE_PRISMA=$(cat <<'SQL'
-- AlterEnum
ALTER TYPE "Estado" ADD VALUE 'NUEVO';

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "telefono" TEXT;

-- CreateTable
CREATE TABLE "Nota" (
    "id" UUID NOT NULL,

    CONSTRAINT "Nota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cliente_nombre_idx" ON "Cliente"("nombre");
SQL
)
check_false "una migración real de Prisma, puramente aditiva, no frena el deploy" \
  migracion_destructiva "$ADITIVA_REAL_DE_PRISMA"

DESTRUCTIVA_REAL_DE_PRISMA=$(cat <<'SQL'
-- AlterEnum
ALTER TYPE "Estado" ADD VALUE 'NUEVO';

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_clienteId_fkey";

-- AlterTable
ALTER TABLE "Cliente" DROP COLUMN "viejo",
ALTER COLUMN "nombre" SET DATA TYPE VARCHAR(20),
ALTER COLUMN "email" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
SQL
)
check_true "una migración real de Prisma con DROP COLUMN + SET NOT NULL frena el deploy" \
  migracion_destructiva "$DESTRUCTIVA_REAL_DE_PRISMA"

# Un `--` DENTRO de un literal de string no abre un comentario. Prisma nunca
# emite eso, pero una migración de datos o una policy de RLS escrita a mano sí
# -y todo el aislamiento entre tenants de este proyecto son policies escritas
# a mano-. Cuando el pelado de comentarios era un `sed -e 's|--.*$||'`, ese
# `--` se comía el resto de la LÍNEA y con él cualquier keyword destructivo que
# viniera después: los cinco casos de acá abajo devolvían "aditiva".
check_true "un -- adentro de un literal no tapa el DROP COLUMN que viene después" \
  migracion_destructiva "INSERT INTO nota (t) VALUES ('ojo -- esto'); ALTER TABLE \"clientes\" DROP COLUMN \"email\";"
check_true "un -- adentro de un literal no tapa el DROP TABLE que viene después" \
  migracion_destructiva "INSERT INTO nota (t) VALUES ('ojo -- esto'); DROP TABLE \"clientes\";"
check_true "un -- adentro de un literal no tapa el SET NOT NULL que viene después" \
  migracion_destructiva "INSERT INTO nota (t) VALUES ('ojo -- esto'); ALTER TABLE \"clientes\" ALTER COLUMN \"email\" SET NOT NULL;"
check_true "un -- adentro de un literal no tapa el DROP CONSTRAINT que viene después" \
  migracion_destructiva "INSERT INTO nota (t) VALUES ('ojo -- esto'); ALTER TABLE \"posts\" DROP CONSTRAINT \"posts_fkey\";"
# El mismo caso pero dentro de UNA sola sentencia: partir el SQL por `;` antes
# de pelar comentarios no alcanzaría acá, porque no hay `;` entre el literal y
# el DROP.
check_true "un -- adentro de un literal no tapa un DROP COLUMN de la MISMA sentencia" \
  migracion_destructiva "ALTER TABLE \"t\" ALTER COLUMN \"c\" SET DEFAULT '-- x', DROP COLUMN \"d\";"
# El control que le da dientes a los cinco de arriba: el mismo literal con `--`
# sobre una migración aditiva tiene que seguir leyéndose aditiva. Sin esto,
# "todo es destructivo" pasaría los cinco.
check_false "un literal con -- sobre una migración aditiva sigue siendo aditivo" \
  migracion_destructiva "INSERT INTO nota (t) VALUES ('ojo -- esto'); ALTER TABLE \"t\" ADD COLUMN \"c\" TEXT;"

# El cuerpo de una función plpgsql va entre $$ y puede tener comentarios y
# comillas adentro. Se lee como código -un DROP ahí adentro es un DROP de
# verdad- y lo que importa es reconocer dónde termina para no desincronizarse
# con el resto del archivo.
check_false "un cuerpo \$\$ con comentarios adentro no dispara solo" \
  migracion_destructiva 'CREATE FUNCTION f() RETURNS void AS $body$ BEGIN -- ojo
  RAISE NOTICE 1; END $body$ LANGUAGE plpgsql;'
check_true "un DROP adentro de un cuerpo \$\$ sí dispara" \
  migracion_destructiva 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN DROP TABLE "t"; END $$ LANGUAGE plpgsql;'
# Y el `--` de adentro del cuerpo no se come lo que viene DESPUÉS del bloque en
# la misma línea: reconocer dónde cierra el $$ es lo que evita eso.
check_true "un -- adentro de un cuerpo \$\$ no tapa lo que viene después del bloque" \
  migracion_destructiva 'CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 -- nota $$ LANGUAGE sql; DROP TABLE "t";'

# SQL que el analizador no puede parsear no es SQL limpio: es SQL desconocido,
# y desconocido frena. Los dos primeros son además SQL inválido, así que frenar
# ahí no le cuesta nada a nadie -esa migración no iba a aplicar de todos modos-.
check_true "un literal sin cerrar se trata como destructivo" \
  migracion_destructiva "INSERT INTO nota (t) VALUES ('abc"
check_true "un comentario de bloque sin cerrar se trata como destructivo" \
  migracion_destructiva '/* nota DROP TABLE "t";'
# El único punto donde el dialecto es ambiguo: un backslash pegado a una
# comilla sólo escapa si standard_conforming_strings está en off, que no es el
# default desde PG 9.1. No se adivina.
check_true "un literal con \\' y sin prefijo E es ambiguo y se trata como destructivo" \
  migracion_destructiva "SELECT 'a\\'b';"
# Con prefijo E sí sabemos que escapa, así que se lee normal.
check_false "con prefijo E el escape se entiende y el literal se lee entero" \
  migracion_destructiva "INSERT INTO nota (t) VALUES (E'a\\'b -- c');"

# Una migración vacía o de puros espacios es aditiva Y silenciosa: un error en
# stderr acá es ruido que enseña a ignorar los errores de esta función.
check_eq "una migración vacía no imprime nada en stderr" "" \
  "$(migracion_destructiva '' 2>&1 >/dev/null)"
check_false "una migración vacía es aditiva" migracion_destructiva ''
check_eq "una migración de puros espacios no imprime nada en stderr" "" \
  "$(migracion_destructiva '
  ' 2>&1 >/dev/null)"
check_false "una migración de puros espacios es aditiva" migracion_destructiva '
  '

# pipefail prendido adentro de la función se le quedaría pegado al script que
# la sourcea (deploy.sh), cambiándole el comportamiento de TODAS sus tuberías
# desde el primer chequeo de migración. Se verifica en un subshell que arranca
# con pipefail apagado a propósito, porque este archivo de test corre con
# pipefail prendido.
pipefail_no_se_filtra() {
  (
    set +o pipefail
    migracion_destructiva 'ALTER TABLE "t" DROP COLUMN "c";' >/dev/null
    [[ ! -o pipefail ]]
  )
}
check_true "migracion_destructiva no le deja pipefail prendido a quien la sourcea" \
  pipefail_no_se_filtra

# El caso que un fail-closed mal puesto confundía con "el pipeline se rompió":
# una migración que es PURAMENTE un comentario queda vacía después de limpiar,
# pero nada falló. Ese texto exacto ("-- This is an empty migration.") es lo
# que escribe `prisma migrate dev --create-only` en una migración vacía, y
# llega acá sin salto de línea final tal como lo entrega `$(cat archivo)` --
# que es justo cómo el test de más arriba le pasa la migración inicial real.
# Tiene que leerse aditiva, no destructiva.
check_false "una migración que sólo tiene un comentario es aditiva" \
  migracion_destructiva '-- This is an empty migration.'

# Qué pasa cuando falta un binario. Se prueba con un PATH que de verdad no lo
# tiene y no shadeando una función de shell: el shadow demuestra que el guard
# reacciona a un 127, pero no que el PATH mínimo alcance para dar la respuesta
# CORRECTA -- que es la mitad que importa, porque la versión que encadenaba
# perl, sed, tr, grep y wc devolvía "aditiva" ante un `grep` ausente, con toda
# la maquinaria intacta salvo esa etapa.
#
# No es un escenario de laboratorio: esta máquina buildea dentro de un slice de
# 2 GiB sobre una caja de 7.6 GB (CLAUDE.md), y un `fork: Cannot allocate
# memory` en cualquier etapa se ve igual que el binario ausente.
DIR_SOLO_PERL="$(mktemp -d)"
DIR_SIN_PERL="$(mktemp -d)"
DIR_SIN_GREP="$(mktemp -d)"
DIR_PERL_MUDO="$(mktemp -d)"
trap 'rm -rf "$DIR_SOLO_PERL" "$DIR_SIN_PERL" "$DIR_SIN_GREP" "$DIR_PERL_MUDO"' EXIT
ln -s "$(command -v perl)" "$DIR_SOLO_PERL/perl"
# Todo lo que usaba la versión encadenada, menos perl. `date` va porque lo usa
# `error` al fallar cerrado, y sin él el mensaje sale con ruido que no es parte
# de lo que se prueba.
for binario in sed tr grep wc cat date; do
  ruta="$(command -v "$binario")" && ln -s "$ruta" "$DIR_SIN_PERL/$binario"
done
# El escenario puntual del hallazgo: TODO presente salvo `grep` y `wc`. Con la
# versión encadenada, un DROP COLUMN acá devolvía "aditiva" -- los `grep -qiE`
# salían 127 y el for los leía como "no matcheó".
for binario in perl sed tr cat date; do
  ruta="$(command -v "$binario")" && ln -s "$ruta" "$DIR_SIN_GREP/$binario"
done

con_path() {
  local dir="$1" sql="$2"
  env -i PATH="$dir" "${BASH:-/bin/bash}" -c '
    set -uo pipefail
    source "$1"
    migracion_destructiva "$2"
  ' _ "$PWD/scripts/lib/deploy-comun.sh" "$sql"
}

check_true "con un PATH sin grep, sed, tr ni wc, un DROP COLUMN sigue leyéndose destructivo" \
  con_path "$DIR_SOLO_PERL" 'ALTER TABLE "clientes" DROP COLUMN "email";'
check_true "con ese mismo PATH, un DROP CONSTRAINT sin su ADD sigue frenando" \
  con_path "$DIR_SOLO_PERL" 'ALTER TABLE "posts" DROP CONSTRAINT "posts_fkey";'
# La otra mitad: que la respuesta correcta sea correcta en las dos direcciones.
# Sin esto, "todo destructivo" pasaría las dos aserciones de arriba.
check_false "con ese mismo PATH, una migración aditiva sigue leyéndose aditiva" \
  con_path "$DIR_SOLO_PERL" 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'
# Sin grep ni wc, con todo lo demás presente: el caso exacto que fallaba
# ABIERTO antes.
check_true "sin grep ni wc en el PATH, un DROP COLUMN sigue leyéndose destructivo" \
  con_path "$DIR_SIN_GREP" 'ALTER TABLE "clientes" DROP COLUMN "email";'
check_false "sin grep ni wc en el PATH, una migración aditiva sigue leyéndose aditiva" \
  con_path "$DIR_SIN_GREP" 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'
# Sin perl no hay análisis posible, y no saber qué trae la migración es motivo
# para frenar el deploy, no para dejarlo pasar.
check_true "sin perl en el PATH, una migración aditiva igual falla cerrado" \
  con_path "$DIR_SIN_PERL" 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'
check_true "sin perl en el PATH, hasta un comentario solo falla cerrado" \
  con_path "$DIR_SIN_PERL" '-- This is an empty migration.'
# Un analizador que sale 0 sin decir nada es lo que dejaría un programa vacío
# (el heredoc llegando en blanco, un `perl -e ""`). Salir 0 significa "encontré
# algo destructivo", así que un 0 mudo no es una respuesta: hay que notarlo y
# decirlo, no imprimir un motivo en blanco y seguir.
printf '#!/bin/sh\nexit 0\n' > "$DIR_PERL_MUDO/perl"
chmod +x "$DIR_PERL_MUDO/perl"
ln -s "$(command -v date)" "$DIR_PERL_MUDO/date"
check_eq "un analizador que sale 0 sin motivo lo dice en vez de imprimir un motivo en blanco" \
  "analizador incoherente (salió 0 sin motivo)" \
  "$(con_path "$DIR_PERL_MUDO" 'ALTER TABLE "t" ADD COLUMN "c" TEXT;' 2>/dev/null)"
check_true "un analizador que sale 0 sin motivo además frena el deploy" \
  con_path "$DIR_PERL_MUDO" 'ALTER TABLE "t" ADD COLUMN "c" TEXT;'

# Fallar cerrado tiene que ser un `return`, no un aborto: deploy.sh corre con
# `set -e`, y si la falla del analizador matara al script en la asignación, el
# gate se caería sin decir por qué. Se prueba llamándola suelta bajo `set -e` y
# mirando que la línea de después igual se ejecute.
llega_despues_de_fallar_cerrado() {
  env -i PATH="$DIR_SIN_PERL" "${BASH:-/bin/bash}" -c '
    set -euo pipefail
    source "$1"
    migracion_destructiva "SELECT 1;" >/dev/null
    printf llegue
  ' _ "$PWD/scripts/lib/deploy-comun.sh" 2>/dev/null
}
check_eq "fallar cerrado devuelve, no aborta al script que corre con set -e" \
  "llegue" "$(llega_despues_de_fallar_cerrado)"

# Y que el mensaje nombre la etapa que se rompió: "falló algo" a las 11 de la
# noche no dice a dónde mirar.
el_error_nombra_el_analizador() {
  con_path "$DIR_SIN_PERL" 'SELECT 1;' 2>&1 >/dev/null | grep -q 'el analizador no corrió'
}
check_true "sin perl, el mensaje de error nombra la etapa que se rompió" \
  el_error_nombra_el_analizador

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
