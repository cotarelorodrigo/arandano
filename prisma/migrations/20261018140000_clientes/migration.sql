-- La solapa Clientes (docs/superpowers/specs/2026-10-18-clientes-design.md).
-- Todo aditivo: tres columnas, el relleno de la clave y dos índices comunes.
-- `clientes` ya tiene RLS y la policy tenant_aislamiento desde la migración
-- inicial; las columnas nuevas quedan cubiertas por la misma policy.

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "acepta_ofertas" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notas" TEXT,
ADD COLUMN     "telefono_clave" TEXT;

-- La clave de duplicados para los clientes que ya existen: los últimos 10
-- dígitos del teléfono, o NULL con menos de 10. Es la misma regla que
-- `claveDeTelefono` (lib/clientes/telefono.ts) escrita en SQL, y
-- test/clientes.test.ts fija que las dos dan lo mismo. `acepta_ofertas`
-- queda en false para todos: nadie aceptó nada por haber sido cargado antes.
UPDATE "clientes"
   SET "telefono_clave" = CASE
         WHEN length(regexp_replace("telefono", '\D', '', 'g')) >= 10
         THEN right(regexp_replace("telefono", '\D', '', 'g'), 10)
       END
 WHERE "telefono" IS NOT NULL;

-- CreateIndex
-- Común y no UNIQUE: puede haber repetidos de antes (ver el comentario del
-- modelo en schema.prisma). Los nuevos los frena la aplicación.
CREATE INDEX "clientes_tenant_id_telefono_clave_idx" ON "clientes"("tenant_id", "telefono_clave");

-- CreateIndex
CREATE INDEX "ventas_tenant_id_cliente_id_idx" ON "ventas"("tenant_id", "cliente_id");
