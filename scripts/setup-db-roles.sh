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
NETWORK=host

uso() {
  cat >&2 <<'EOF'
uso: setup-db-roles.sh --url=<URL> --owner-password=<P> --app-password=<P>
                       [--con-createdb] [--network=<RED>]

  --url             cadena de conexión del SUPERUSUARIO del stack. Es el único
                    rol que puede crear otros roles.
  --owner-password  contraseña de arandano_owner (dueño de las tablas, migra).
  --app-password    contraseña de arandano_app (el rol de la app; es el único
                    sobre el que las policies de RLS efectivamente aplican).
  --con-createdb    le da CREATEDB a arandano_owner. Hace falta para la shadow
                    database de `prisma migrate dev`, así que va en dev y en la
                    base de tests. NUNCA en producción: `migrate deploy` no la
                    usa, y un rol de prod con CREATEDB es privilegio regalado.
  --network         red de Docker desde la que se alcanza la base. Por defecto
                    `host`, que sirve para las bases que publican puerto (dev y
                    la de tests). El Postgres de producción NO publica ninguno,
                    así que para esa hay que entrar por su red: pasar
                    `--network=arandano-prod_default` y una URL con el nombre
                    del servicio (`@postgres:5432`) en vez de 127.0.0.1.
EOF
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --url=*)             URL="${arg#*=}" ;;
    --owner-password=*)  OWNER_PASSWORD="${arg#*=}" ;;
    --app-password=*)    APP_PASSWORD="${arg#*=}" ;;
    --con-createdb)      CON_CREATEDB=true ;;
    --network=*)         NETWORK="${arg#*=}" ;;
    -h|--help)           uso ;;
    *) echo "argumento desconocido: $arg" >&2; uso ;;
  esac
done

[[ -n "$URL" ]]            || { echo "falta --url" >&2; uso; }
[[ -n "$OWNER_PASSWORD" ]] || { echo "falta --owner-password" >&2; uso; }
[[ -n "$APP_PASSWORD" ]]   || { echo "falta --app-password" >&2; uso; }

if [[ "$CON_CREATEDB" == true ]]; then CREATEDB_SQL="CREATEDB"; else CREATEDB_SQL="NOCREATEDB"; fi

# psql corre dentro de un contenedor efímero porque el host no tiene cliente de
# Postgres instalado, y no hace falta que lo tenga. El default `host` alcanza
# 127.0.0.1 y cualquier base que publique puerto; la de producción no publica
# ninguno, y para esa está --network (ver `uso`).
#
# Las contraseñas viajan como VARIABLES de psql y se interpolan con :'nombre',
# que las emite como literal correctamente entrecomillado. Interpolarlas en el
# texto del SQL con "$VAR" sería una inyección esperando a una contraseña con
# comilla simple.
#
# CREATEDB_SQL viaja igual, como variable de psql, y no interpolado por bash
# en el texto del heredoc — es lo que permite que el heredoc de acá abajo
# esté ENTRE COMILLAS (<<'EOF'). Con comillas, bash no expande absolutamente
# nada de su contenido: ni variables, ni comillas invertidas, ni $(...). Sin
# ellas (como estaba antes), cualquier backtick que alguien escriba en un
# comentario SQL —no sólo código— se ejecuta como comando en el HOST con los
# privilegios de este script; se encontró exactamente así, con un comentario
# que mencionaba `prisma migrate dev` entre comillas invertidas, y bash
# tratando de correr "prisma" de verdad. Acá :createdb_sql y no :'createdb_sql':
# CREATEDB/NOCREATEDB son palabras clave de ALTER ROLE, no un literal de
# texto, así que hace falta la sustitución CRUDA de psql, sin comillas.
docker run --rm -i --network="$NETWORK" \
  -e PGCONNECT_TIMEOUT=10 \
  postgres:17-alpine \
  psql "$URL" \
    --set=ON_ERROR_STOP=1 \
    --set=owner_password="$OWNER_PASSWORD" \
    --set=app_password="$APP_PASSWORD" \
    --set=createdb_sql="$CREATEDB_SQL" \
    -f - <<'EOF'
-- CREATE ROLE no tiene IF NOT EXISTS, así que el DO block es la única forma
-- idempotente. Los atributos se fijan aparte con ALTER, que sí es idempotente,
-- para que una corrida sobre un rol preexistente lo deje igual que una sobre
-- uno nuevo.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arandano_owner') THEN
    CREATE ROLE arandano_owner;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arandano_app') THEN
    CREATE ROLE arandano_app;
  END IF;
END
$$;

ALTER ROLE arandano_owner WITH LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS
  :createdb_sql INHERIT PASSWORD :'owner_password';

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

-- Las tablas-libro: append-only de verdad, no por comentario.
--
-- prisma/schema.prisma afirma sobre movimientos_stock que "nada se edita ni se
-- borra", y sobre esa afirmación se apoya la promesa de poder responder "por qué
-- tengo 3 y no 5". Medido con el rol real de la app antes de esta línea: un
-- UPDATE afectaba 4 filas y un DELETE otras 4. La afirmación era sólo un
-- comentario. El motor únicamente hace INSERT sobre esa tabla, así que revocar
-- no le saca nada a nadie: lo único que cambia es que ahora la base sostiene lo
-- que el schema promete.
--
-- Va DESPUÉS del GRANT ... ON ALL TABLES de arriba, y no antes, porque el
-- último gana: invertirlos volvería a otorgar lo que acá se saca.
--
-- Es un REVOKE POR TABLA, y el default privilege de más arriba sigue dándole
-- UPDATE y DELETE a toda tabla nueva. O sea: una tabla-libro futura —el libro de
-- caja, los asientos de ARCA— necesita SU PROPIA línea acá. No se hereda. La
-- alternativa (quitar UPDATE/DELETE del default privilege y otorgarlos tabla por
-- tabla) haría nacer mutilada a toda tabla normal, que son la mayoría, y el
-- olvido se pagaría con una app rota en vez de con un libro editable.
--
-- Envuelto en to_regclass porque este script corre también ANTES de la primera
-- migración, cuando la tabla todavía no existe: sin el guard, un REVOKE sobre
-- una tabla inexistente aborta todo el archivo. Es el mismo recurso que usa el
-- grant por nombre de resolver_tenant, más abajo.
DO $$
BEGIN
  IF to_regclass('public.movimientos_stock') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.movimientos_stock FROM arandano_app';
  END IF;
END
$$;

-- eventos_orden: la bitácora de una orden de trabajo, y la tabla-libro que el
-- comentario de arriba anticipaba. prisma/schema.prisma la declara "append-only,
-- como movimientos_stock", y esa afirmación es la JUSTIFICACIÓN ENTERA del
-- diseño de estado-como-columna: la pregunta que se hace cuando el cliente
-- reclama no es "¿en qué estado está?" sino "hace dos semanas que está acá, ¿qué
-- pasó?". Un libro editable no la contesta. Sin esta línea la afirmación era sólo
-- un comentario, exactamente como lo era la de movimientos_stock antes del
-- REVOKE de arriba: el default privilege le da UPDATE y DELETE a toda tabla
-- nueva, y no se hereda.
--
-- Y el DELETE sobre ordenes_de_trabajo, en el mismo bloque porque es el mismo
-- agujero: eventos_orden.orden_id es ON DELETE CASCADE, así que borrar una orden
-- borra su historia entera sin tocar nunca la tabla que acabamos de cerrar.
-- Ningún código borra órdenes —anular es una columna, a propósito—, así que
-- revocarlo no le saca nada a nadie; lo que cambia es que la bitácora deja de
-- tener una puerta de atrás. El UPDATE sobre ordenes_de_trabajo SÍ se conserva:
-- el estado, el diagnóstico y la anulación se escriben ahí, que es justamente
-- lo que la separa de una tabla-libro.
--
-- Mismo guard to_regclass que los otros dos: este script corre también antes de
-- la primera migración, cuando las tablas todavía no existen.
DO $$
BEGIN
  IF to_regclass('public.eventos_orden') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.eventos_orden FROM arandano_app';
  END IF;
  IF to_regclass('public.ordenes_de_trabajo') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON public.ordenes_de_trabajo FROM arandano_app';
  END IF;
END
$$;

-- leads: append-only para la aplicación, y por un motivo distinto al de
-- movimientos_stock. Aquella es un libro y no se corrige; ésta no tiene
-- tenant_id, así que no hay policy que la proteja — sin este REVOKE, cualquier
-- query de la app (o cualquiera que consiga ejecutar una) lee la lista entera
-- de interesados. La app inserta y nada más; se leen con `npm run leads`, que
-- se conecta como owner.
--
-- SELECT también, a diferencia de movimientos_stock: acá el dato no se muestra
-- en ninguna pantalla, así que quitarlo no le saca nada a la aplicación.
--
-- Mismo guard to_regclass que el de arriba: este script corre también antes de
-- la primera migración, cuando la tabla todavía no existe.
DO $$
BEGIN
  IF to_regclass('public.leads') IS NOT NULL THEN
    EXECUTE 'REVOKE SELECT, UPDATE, DELETE ON public.leads FROM arandano_app';
  END IF;
END
$$;

-- Las funciones NO llevan default privilege de EXECUTE, y es deliberado. Una
-- función SECURITY DEFINER es la vía por la que la app lee lo que RLS le esconde
-- por diseño: es la superficie que SALTEA el aislamiento, no una que el
-- aislamiento proteja. Un default privilege que se lo diera a arandano_app haría
-- que toda función futura naciera ejecutable sin que nadie lo decida — fallar
-- abierto justo donde el resto del proyecto falla cerrado.
--
-- Por eso van sólo los REVOKE, y cada función se otorga POR NOMBRE abajo.
-- Sumar una función obliga a sumar su línea acá para que arandano_app la
-- pueda ejecutar; lo que SÍ cierra a PUBLIC en una función nueva no es este
-- REVOKE (ver el comentario de más abajo, es inerte para objetos futuros) sino
-- la próxima corrida de este bloque en bruto contra los objetos existentes.
--
-- Todo este bloque de privilegios de funciones va en una única transacción:
-- sin esto, psql corre en autocommit y hay una ventana real entre el REVOKE
-- de acá y el re-GRANT por nombre de más abajo en la que la imagen VIEJA,
-- que sigue sirviendo mientras este script corre en medio de un deploy, no
-- puede ejecutar la función. BEGIN/COMMIT hace que otra conexión vea el
-- antes o el después, nunca el hueco de en medio.
BEGIN;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
-- Inerte para funciones que todavía no existen, y es sabido: pg_default_acl
-- sólo guarda deltas ADITIVOS sobre el default de Postgres (acldefault), así
-- que un REVOKE que no tiene nada previo que revocar no persiste ninguna
-- fila — se puede medir corriendo este script sobre un postgres:17-alpine
-- virgen y creando después una función SECURITY DEFINER cualquiera como
-- arandano_owner: has_function_privilege(..., 'public', ...) da true. Lo que
-- de verdad cierra una función NUEVA a PUBLIC es el REVOKE EXECUTE ON ALL
-- FUNCTIONS de la línea de arriba, la PRÓXIMA vez que este script corra sobre
-- ella ya creada — en el camino de deploy eso es inmediato gracias al paso 13
-- de deploy.sh, pero en dev no pasa solo después de un `prisma migrate dev`;
-- cada migración de una función SECURITY DEFINER tiene que hacer su propio
-- REVOKE ALL ... FROM PUBLIC, como ya hace
-- prisma/migrations/20260808203015_resolver_tenant/migration.sql. Esta línea
-- queda igual: no hace nada por el futuro, pero sigue cerrando de inmediato
-- cualquier función que ya exista al momento de correr.
ALTER DEFAULT PRIVILEGES FOR ROLE arandano_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Convergencia, no sólo estado inicial. Un ALTER DEFAULT PRIVILEGES es fila
-- guardada en la base, no una declaración que se re-evalúe: sacar el GRANT de
-- este script no le hace nada a una base que ya corrió la versión anterior
-- (Task 5b), que le había dado a arandano_app el default privilege de EXECUTE
-- sobre funciones más el GRANT amplio sobre las que ya existían. Sin este
-- REVOKE, esa base queda con el privilegio amplio para siempre — exactamente
-- lo que este fix existe para sacar — y encima toda función NUEVA seguiría
-- naciendo ejecutable por la app, porque el default privilege viejo sigue
-- activo. Van ANTES del bloque DO: el segundo revoca también resolver_tenant,
-- y el DO se la devuelve por nombre a continuación.
ALTER DEFAULT PRIVILEGES FOR ROLE arandano_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM arandano_app;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM arandano_app;

-- El grant por nombre tolera que la función todavía no exista: este script corre
-- ANTES de las migraciones sobre una base nueva, y otra vez DESPUÉS para que el
-- grant se aplique. to_regprocedure devuelve NULL en vez de tirar error cuando la
-- función no está, así que la misma corrida sirve en los dos momentos.
DO $$
BEGIN
  IF to_regprocedure('public.resolver_tenant(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.resolver_tenant(text) TO arandano_app';
  END IF;
END
$$;

COMMIT;
EOF

echo "roles listos (owner con $CREATEDB_SQL)"
