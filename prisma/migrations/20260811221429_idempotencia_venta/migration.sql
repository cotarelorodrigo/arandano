-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "clave_idempotencia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ventas_tenant_id_clave_idempotencia_key" ON "ventas"("tenant_id", "clave_idempotencia");
