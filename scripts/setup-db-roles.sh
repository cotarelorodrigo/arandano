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
