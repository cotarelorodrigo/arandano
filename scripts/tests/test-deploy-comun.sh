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
# El emparejamiento es lo único de esta función que DEJA PASAR algo, así que su
# evidencia tiene que ser DDL de verdad. Un ADD CONSTRAINT que sólo está
# MENCIONADO adentro de un string -el shape plausible es un INSERT a una tabla
# de auditoría de DDL- no recrea ninguna constraint, y sin embargo alcanzaba
# para emparejar un DROP real y que la migración se leyera aditiva.
check_true "un ADD CONSTRAINT mencionado adentro de un literal no empareja un DROP real" \
  migracion_destructiva 'INSERT INTO "auditoria_ddl" ("sql") VALUES ('"'"'ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id")'"'"');
ALTER TABLE "posts" DROP CONSTRAINT "posts_authorId_fkey";'
# Lo mismo desde un cuerpo $$: un EXECUTE de texto tampoco es evidencia.
check_true "un ADD CONSTRAINT adentro de un cuerpo \$\$ tampoco empareja un DROP real" \
  migracion_destructiva 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN EXECUTE '"'"'ALTER TABLE "posts" ADD CONSTRAINT "posts_authorId_fkey" FOREIGN KEY ("a") REFERENCES "u"("id")'"'"'; END $$ LANGUAGE plpgsql;
ALTER TABLE "posts" DROP CONSTRAINT "posts_authorId_fkey";'
# Y el detalle del blanqueo que parece cosmético y no lo es: los literales y los
# cuerpos $$ se reemplazan por '' (DOS COMILLAS), no por un espacio ni por nada.
# Las dos comillas son un token que NO es espacio, así que un literal metido
# entre `ADD CONSTRAINT` y el nombre entre comillas dobles parte esa secuencia y
# el regex de la etapa 2 no la reconoce como un ADD de verdad. Blanqueando con
# " " o con "" el literal se evapora, `ADD CONSTRAINT "posts_authorId_fkey"`
# queda pegado, y ese ADD falso -que no recrea absolutamente nada- empareja el
# DROP real de la línea de arriba: la migración se lee aditiva y el gate la deja
# pasar. Medido con las dos mutaciones aplicadas al perl (ver el reporte de esta
# ronda); sin esta aserción, las dos dejaban la suite en verde.
check_true "un literal entre ADD CONSTRAINT y el nombre no puede emparejar un DROP real" \
  migracion_destructiva 'INSERT INTO "auditoria" ("sql") VALUES ('"'"'nota: ADD CONSTRAINT'"'"');
ALTER TABLE "posts" DROP CONSTRAINT "posts_authorId_fkey";
SELECT ADD CONSTRAINT '"'"'blah'"'"' "posts_authorId_fkey";'
# Y la contracara, que es lo que impide "arreglar" lo de arriba blanqueando los
# dos lados: el lado que EXIGE emparejamiento sigue leyendo el texto entero, así
# que un DROP CONSTRAINT adentro de un cuerpo $$ -DDL que se va a ejecutar de
# verdad- sigue frenando el deploy.
check_true "un DROP CONSTRAINT adentro de un cuerpo \$\$ sigue frenando" \
  migracion_destructiva 'CREATE FUNCTION f() RETURNS void AS $$ BEGIN ALTER TABLE "posts" DROP CONSTRAINT "posts_fkey"; END $$ LANGUAGE plpgsql;'
# El único patrón de la lista que no responde al criterio de rollback: apagar el
# RLS de una tabla no rompe al código anterior -sigue andando perfecto- y por
# eso mismo le devuelve filas de OTROS tenants. No hay DROP en ningún lado.
check_true "DISABLE ROW LEVEL SECURITY apaga el aislamiento y frena el deploy" \
  migracion_destructiva 'ALTER TABLE "clientes" DISABLE ROW LEVEL SECURITY;'
# Y su contracara, que la migración inicial real usa en TODAS las tablas: si
# ENABLE disparara, ninguna migración de este repo pasaría el gate.
check_false "ENABLE ROW LEVEL SECURITY es aditivo" \
  migracion_destructiva 'ALTER TABLE "clientes" ENABLE ROW LEVEL SECURITY;'
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

printf '\n\033[1mpostgres_definitivo_listo\033[0m\n'
LINEA='database system is ready to accept connections'
check_false "sin logs no está listo"                        postgres_definitivo_listo ""
check_false "logs sin la línea no está listo"                postgres_definitivo_listo "algo, algo, LOG:  otra cosa"
# Una sola aparición es el servidor TEMPORAL del init, todavía no el
# definitivo — es exactamente el caso que rompía setup-db-roles.sh antes de
# este fix.
check_false "una sola aparición (servidor temporal) no está listo" \
  postgres_definitivo_listo "LOG:  $LINEA"
check_true  "dos apariciones (temporal + definitivo) sí está listo" \
  postgres_definitivo_listo "LOG:  $LINEA
algo en el medio
LOG:  $LINEA"
# Tres o más (un restart adicional, por ejemplo) sigue siendo "listo": el
# umbral es "al menos dos", no "exactamente dos".
check_true  "tres apariciones también está listo" \
  postgres_definitivo_listo "$LINEA
$LINEA
$LINEA"

printf '\n\033[1mveredicto_migrate_status\033[0m\n'
# Las cinco salidas de abajo son EXACTAMENTE lo que imprimió `prisma migrate
# status` de verdad contra una base real (Postgres 17 descartable, roles
# creados con setup-db-roles.sh, arandano-migrate:1674ca2) en cada uno de
# estos cinco estados — no una paráfrasis del patrón. Ver el reporte de esta
# tarea (ronda 2) para los comandos exactos. La advertencia no es teórica:
# migracion_destructiva ya tuvo un caso (ver el comentario junto a la
# aserción "cambio de tipo" más arriba) donde una aserción escrita a partir
# del patrón, y no de la salida real, no atrapó que el patrón no cubría lo
# que Prisma realmente emite.
SALIDA_PENDIENTE=$(cat <<'EOF'
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "testsuper", schema "public" at "postgres:5432"

1 migration found in prisma/migrations
Following migration have not yet been applied:
20260804205911_inicial

To apply migrations in development run prisma migrate dev.
To apply migrations in production run prisma migrate deploy.
npm notice
npm notice New major version of npm available! 11.17.0 -> 12.0.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
npm notice To update run: npm install -g npm@12.0.2
npm notice
EOF
)
SALIDA_AL_DIA=$(cat <<'EOF'
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "testsuper", schema "public" at "postgres:5432"

1 migration found in prisma/migrations

Database schema is up to date!
npm notice
npm notice New major version of npm available! 11.17.0 -> 12.0.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
npm notice To update run: npm install -g npm@12.0.2
npm notice
EOF
)
SALIDA_FALLIDA=$(cat <<'EOF'
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "testsuper", schema "public" at "postgres:5432"

1 migration found in prisma/migrations
Following migration have failed:
20260804205911_inicial

During development if the failed migration(s) have not been deployed to a production database you can then fix the migration(s) and run prisma migrate dev.

The failed migration(s) can be marked as rolled back or applied:

- If you rolled back the migration(s) manually:
prisma migrate resolve --rolled-back "20260804205911_inicial"

- If you fixed the database manually (hotfix):
prisma migrate resolve --applied "20260804205911_inicial"

Read more about how to resolve migration issues in a production database:
https://pris.ly/d/migrate-resolve
npm notice
npm notice New major version of npm available! 11.17.0 -> 12.0.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
npm notice To update run: npm install -g npm@12.0.2
npm notice
EOF
)
SALIDA_P1000=$(cat <<'EOF'
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "testsuper", schema "public" at "postgres:5432"
Error: P1000: Authentication failed against database server, the provided database credentials for `arandano_owner` are not valid.

Please make sure to provide valid database credentials for the database server at the configured address.
npm notice
npm notice New major version of npm available! 11.17.0 -> 12.0.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
npm notice To update run: npm install -g npm@12.0.2
npm notice
EOF
)
SALIDA_P1001=$(cat <<'EOF'
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "testsuper", schema "public" at "hostquenoexiste:5432"
Error: P1001: Can't reach database server at `hostquenoexiste:5432`

Please make sure your database server is running at `hostquenoexiste:5432`.
npm notice
npm notice New major version of npm available! 11.17.0 -> 12.0.2
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
npm notice To update run: npm install -g npm@12.0.2
npm notice
EOF
)

check_eq "pendiente: rc=1 con 'have not yet been applied' -> pendiente" \
  "pendiente" "$(veredicto_migrate_status "$SALIDA_PENDIENTE" 1)"
check_eq "al día: rc=0 -> al_dia" \
  "al_dia" "$(veredicto_migrate_status "$SALIDA_AL_DIA" 0)"
# El caso que motivó todo este cambio: antes de la ronda 1, esto también
# hubiera fallado bare contra un exit 1 no distinguido de "pendiente".
check_eq "migración fallida: rc=1 con 'have failed' -> inseguro" \
  "inseguro" "$(veredicto_migrate_status "$SALIDA_FALLIDA" 1)"
check_eq "P1000 (credenciales inválidas): rc=1 sin el texto seguro -> inseguro" \
  "inseguro" "$(veredicto_migrate_status "$SALIDA_P1000" 1)"
check_eq "P1001 (host inalcanzable): rc=1 sin el texto seguro -> inseguro" \
  "inseguro" "$(veredicto_migrate_status "$SALIDA_P1001" 1)"
# La razón de ser del `! grep ... have failed` de la función: una salida que
# trae LAS DOS secciones. No hay evidencia de que `migrate status` las mezcle en
# una corrida real -de ahí que esta salida sea armada, y no capturada como las
# cinco de arriba-, y justamente por eso el ancla negativa es lo único que la
# sostiene: sin ella, el `have not yet been applied` de la primera sección
# alcanza para clasificar como `pendiente` una salida que además dice que una
# migración quedó a medio aplicar, y el deploy sigue hasta `migrate deploy`
# contra una base en ese estado. Verificado reemplazando el ancla negativa por
# `true`: sin esta aserción la suite quedaba igual en verde.
SALIDA_PENDIENTE_Y_FALLIDA=$(cat <<'EOF'
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma/schema.prisma.
Datasource "db": PostgreSQL database "testsuper", schema "public" at "postgres:5432"

2 migrations found in prisma/migrations
Following migrations have not yet been applied:
20990101000000_nueva

Following migration have failed:
20260804205911_inicial

The failed migration(s) can be marked as rolled back or applied:

- If you rolled back the migration(s) manually:
prisma migrate resolve --rolled-back "20260804205911_inicial"
EOF
)
check_eq "pendiente Y fallida en la misma salida -> inseguro" \
  "inseguro" "$(veredicto_migrate_status "$SALIDA_PENDIENTE_Y_FALLIDA" 1)"
check_eq "un texto que Prisma nunca dijo, con rc=1, es inseguro" \
  "inseguro" "$(veredicto_migrate_status "esto no es nada que Prisma diga" 1)"
check_eq "un rc que no es ni 0 ni 1 es inseguro aunque el texto sea el seguro" \
  "inseguro" "$(veredicto_migrate_status "$SALIDA_PENDIENTE" 127)"
# La dirección segura es una propiedad de LA FUNCIÓN, no del llamador: hasta
# sin argumentos, sin texto y sin rc, cae del lado de frenar.
check_eq "sin nada, cae del lado de frenar" "inseguro" "$(veredicto_migrate_status)"

printf '\n\033[1mmigraciones_sobrantes\033[0m\n'
check_eq "sin drift: aplicadas == repo, no hay sobrantes" \
  "" "$(migraciones_sobrantes '20260804205911_inicial' '20260804205911_inicial')"
# La fila fantasma real de la ronda 1: un nombre en _prisma_migrations que ya
# no está en prisma/migrations/.
check_eq "una migración aplicada que ya no está en el repo" \
  "20990101000000_fantasma" \
  "$(migraciones_sobrantes '20260804205911_inicial
20990101000000_fantasma' '20260804205911_inicial')"
check_eq "varias migraciones sobrantes, una por línea" \
  "20990101000000_fantasma1
20990102000000_fantasma2" \
  "$(migraciones_sobrantes '20260804205911_inicial
20990101000000_fantasma1
20990102000000_fantasma2' '20260804205911_inicial')"
# El caso normal: el repo trae una migración nueva que TODAVÍA no está
# aplicada. Eso NO es drift — es justo lo que el paso 12 va a aplicar.
# Reportarlo acá convertiría un deploy normal en un abort.
check_eq "sólo-en-repo (pendiente normal) no se reporta como drift" \
  "" \
  "$(migraciones_sobrantes '20260804205911_inicial' '20260804205911_inicial
20990101000000_nueva_todavia_no_aplicada')"
check_eq "base virgen (nada aplicado) contra un repo con una migración: nada sobrante" \
  "" "$(migraciones_sobrantes '' '20260804205911_inicial')"

printf '\n\033[1msecreto_auth_presente\033[0m\n'
# Sin Docker: sólo lee un .env de un directorio temporal, igual que
# token_salud lee el suyo — la diferencia entre las dos es la única razón por
# la que ÉSTA sí tiene test unitario y token_salud no (ver el comentario de
# ambas en deploy-comun.sh).
DIR_CON_SECRETO="$(mktemp -d)"
DIR_SIN_SECRETO="$(mktemp -d)"
DIR_SECRETO_VACIO="$(mktemp -d)"
DIR_SIN_ENV="$(mktemp -d)"
trap 'rm -rf "$DIR_SOLO_PERL" "$DIR_SIN_PERL" "$DIR_SIN_GREP" "$DIR_PERL_MUDO" "$DIR_CON_SECRETO" "$DIR_SIN_SECRETO" "$DIR_SECRETO_VACIO" "$DIR_SIN_ENV"' EXIT

printf 'BETTER_AUTH_SECRET=algo-largo-y-random\n' > "$DIR_CON_SECRETO/.env"
check_true "con la variable presente y no vacía" secreto_auth_presente "$DIR_CON_SECRETO"

printf 'OTRA_COSA=x\n' > "$DIR_SIN_SECRETO/.env"
check_false "sin la variable" secreto_auth_presente "$DIR_SIN_SECRETO"

# El caso real que motiva el chequeo separado de presencia (mismo espíritu
# que el falso verde de check_ne en verify-infra.sh, Task 11): una línea
# `BETTER_AUTH_SECRET=` sin valor no es lo mismo que la variable ausente, y
# los dos tienen que fallar igual.
printf 'BETTER_AUTH_SECRET=\n' > "$DIR_SECRETO_VACIO/.env"
check_false "con la variable vacía" secreto_auth_presente "$DIR_SECRETO_VACIO"

# Sin .env en absoluto: el `|| true` de adentro no deja que esto reviente el
# script, y el resultado es el mismo que "sin la variable".
check_false "sin .env en absoluto" secreto_auth_presente "$DIR_SIN_ENV"

printf '\n\033[1mcompose_del_repo\033[0m\n'
# El compose de cada objetivo se copia a mano a /srv/arandano/<objetivo>/ y,
# hasta el 2026-09-01, el gate no lo miraba — sólo miraba el Caddyfile. Ese
# agujero dejó a producción corriendo 112 líneas contra las 140 del repo: el
# `BOT_HABILITADO_EN: wafflespro` del ciclo del bot nunca llegó, y como esa
# variable falla ABIERTO, el bot quedó habilitado en TODOS los locales en vez
# de en uno. El de ensayo también había driftado, con lo que
# `--objetivo=ensayo` venía ensayando contra una configuración que no era la
# que prod iba a correr.
check_eq "prod"   "docker/compose.prod.yml"   "$(compose_del_repo prod)"
check_eq "ensayo" "docker/compose.ensayo.yml" "$(compose_del_repo ensayo)"
check_false "un objetivo inventado es error" compose_del_repo cualquiera
check_false "sin objetivo es error"          compose_del_repo ''
# Atado al repo y no sólo a la cadena: si alguien renombra o mueve un compose,
# el mapeo tiene que romperse acá y no en el medio de un deploy.
check_true "el compose de prod existe"   test -f "$(compose_del_repo prod)"
check_true "el compose de ensayo existe" test -f "$(compose_del_repo ensayo)"

printf '\n%d ok, %d fallan\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
