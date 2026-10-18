-- AlterEnum
--
-- En su propia migración y no junto con las tablas del plan canje: un valor de
-- enum recién agregado no se puede USAR en la misma transacción que lo agrega,
-- y separarlo deja la próxima migración libre de esa trampa aunque hoy no lo
-- use. Mismo criterio que 20260908120058_permiso_articulos_borrar.
ALTER TYPE "permiso" ADD VALUE 'CANJE_VALORES';
