-- CreateTable
CREATE TABLE "ediciones_venta" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "nota" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ediciones_venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos_archivados" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "edicion_id" UUID NOT NULL,
    "medio" "medio_pago" NOT NULL,
    "moneda" "moneda" NOT NULL,
    "cubre" "moneda" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "cotizacion" DECIMAL(12,4) NOT NULL,
    "plan_de_pago_id" UUID,
    "porcentaje" DECIMAL(6,3),
    "recargo" DECIMAL(12,2) NOT NULL,
    "pagado_en" TIMESTAMPTZ(3) NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_archivados_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ediciones_venta_tenant_id_venta_id_creado_en_idx" ON "ediciones_venta"("tenant_id", "venta_id", "creado_en");

-- CreateIndex
CREATE INDEX "pagos_archivados_tenant_id_edicion_id_idx" ON "pagos_archivados"("tenant_id", "edicion_id");

-- AddForeignKey
ALTER TABLE "ediciones_venta" ADD CONSTRAINT "ediciones_venta_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ediciones_venta" ADD CONSTRAINT "ediciones_venta_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ediciones_venta" ADD CONSTRAINT "ediciones_venta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_archivados" ADD CONSTRAINT "pagos_archivados_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_archivados" ADD CONSTRAINT "pagos_archivados_edicion_id_fkey" FOREIGN KEY ("edicion_id") REFERENCES "ediciones_venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos_archivados" ADD CONSTRAINT "pagos_archivados_plan_de_pago_id_fkey" FOREIGN KEY ("plan_de_pago_id") REFERENCES "planes_de_pago"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "ediciones_venta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "ediciones_venta" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "pagos_archivados" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "pagos_archivados" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
