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
-- que todavía no existen. PUBLIC no es un rol que pueda faltar, así que esta
-- línea corre sobre cualquier base.
REVOKE ALL ON FUNCTION resolver_tenant(text) FROM PUBLIC;

-- Lo que NO va acá es el GRANT a arandano_app: una migración no puede nombrar
-- un rol, porque tiene que poder correr sobre la shadow database del paso 3
-- del gate (un Postgres desnudo con usuario `sombra`, sin arandano_app) y
-- sobre un pg_restore a una base todavía sin roles. Es la misma invariante que
-- ya declara la migración inicial para las policies de RLS. El EXECUTE para
-- arandano_app lo da scripts/setup-db-roles.sh por default privileges.
