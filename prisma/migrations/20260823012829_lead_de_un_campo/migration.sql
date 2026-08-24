-- El formulario de la landing pasa de cinco campos a uno solo ("Tu WhatsApp
-- o tu mail", design/arandano.pen). Ese único valor se clasifica y se guarda
-- en "email" o en "whatsapp" según su forma (app/sitio/acciones.ts), y
-- "nombre"/"rubro" ya no tienen de dónde salir.
--
-- Reversible en las dos direcciones, y por eso es un DROP NOT NULL y no un
-- rename ni un drop de columna:
--   - Rollback (volver al código viejo): el código anterior sigue
--     insertando "nombre", "email" y "rubro" con valores reales en cada
--     alta —el INSERT de 5 campos no cambia de forma—, y una columna
--     nullable acepta un valor no-nulo sin protestar. Nada se rompe.
--   - Forward (el código nuevo): inserta NULL en las tres, y ahora la base
--     lo permite.
-- Lo que hay que revisar no es quién ESCRIBE (los dos escritores conviven
-- sin problema) sino quién LEE: scripts/leads.mts ya no puede asumir que
-- estas columnas vienen con datos, y se actualiza en el mismo commit que
-- esta migración.
--
-- AlterTable
ALTER TABLE "leads" ALTER COLUMN "nombre" DROP NOT NULL,
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "rubro" DROP NOT NULL;
