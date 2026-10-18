-- AlterEnum
--
-- En su propia migración y no junto con la tabla de cotizaciones: un valor de
-- enum recién agregado no se puede USAR en la misma transacción que lo agrega.
-- Mismo criterio que 20261018130000_permiso_canje_valores.
ALTER TYPE "permiso" ADD VALUE 'COTIZACION';
