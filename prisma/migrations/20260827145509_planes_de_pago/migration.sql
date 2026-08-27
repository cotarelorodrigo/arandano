-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "plan_de_pago_id" UUID,
ADD COLUMN     "recargo" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "recargo" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "planes_de_pago" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "medio" "medio_pago" NOT NULL,
    "cuotas" INTEGER NOT NULL DEFAULT 1,
    "recargo_porcentaje" DECIMAL(6,3) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "desactivado_en" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "planes_de_pago_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planes_de_pago_tenant_id_medio_idx" ON "planes_de_pago"("tenant_id", "medio");

-- CreateIndex
CREATE UNIQUE INDEX "planes_de_pago_tenant_id_medio_nombre_key" ON "planes_de_pago"("tenant_id", "medio", "nombre");

-- AddForeignKey
ALTER TABLE "planes_de_pago" ADD CONSTRAINT "planes_de_pago_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_plan_de_pago_id_fkey" FOREIGN KEY ("plan_de_pago_id") REFERENCES "planes_de_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "planes_de_pago" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "planes_de_pago" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
