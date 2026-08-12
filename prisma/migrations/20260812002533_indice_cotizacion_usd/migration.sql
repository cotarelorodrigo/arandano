-- CreateIndex
CREATE INDEX "pagos_tenant_id_moneda_creado_en_idx" ON "pagos"("tenant_id", "moneda", "creado_en");
