-- CreateEnum
CREATE TYPE "motivo_movimiento" AS ENUM ('VENTA', 'ANULACION_VENTA', 'AJUSTE', 'INGRESO');

-- CreateEnum
CREATE TYPE "medio_pago" AS ENUM ('EFECTIVO', 'TRANSFERENCIA', 'TARJETA_DEBITO', 'TARJETA_CREDITO');

-- CreateEnum
CREATE TYPE "moneda" AS ENUM ('ARS', 'USD');

-- AlterTable
ALTER TABLE "articulos" ADD COLUMN     "stock" DECIMAL(12,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "proximo_numero_venta" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "movimientos_stock" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "articulo_id" UUID NOT NULL,
    "delta" DECIMAL(12,3) NOT NULL,
    "motivo" "motivo_movimiento" NOT NULL,
    "venta_id" UUID,
    "usuario_id" UUID NOT NULL,
    "nota" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "cliente_id" UUID,
    "usuario_id" UUID NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "anulada_en" TIMESTAMPTZ(3),
    "anulada_por_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ventas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venta_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "articulo_id" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precio_unitario" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "venta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "venta_id" UUID NOT NULL,
    "medio" "medio_pago" NOT NULL,
    "moneda" "moneda" NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "cotizacion" DECIMAL(12,4) NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "movimientos_stock_tenant_id_articulo_id_idx" ON "movimientos_stock"("tenant_id", "articulo_id");

-- CreateIndex
CREATE INDEX "movimientos_stock_tenant_id_venta_id_idx" ON "movimientos_stock"("tenant_id", "venta_id");

-- CreateIndex
CREATE INDEX "ventas_tenant_id_creado_en_idx" ON "ventas"("tenant_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "ventas_tenant_id_numero_key" ON "ventas"("tenant_id", "numero");

-- CreateIndex
CREATE INDEX "venta_items_tenant_id_venta_id_idx" ON "venta_items"("tenant_id", "venta_id");

-- CreateIndex
CREATE INDEX "pagos_tenant_id_venta_id_idx" ON "pagos"("tenant_id", "venta_id");

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venta_items" ADD CONSTRAINT "venta_items_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security. Misma expresión que la migración inicial, copiada literal
-- y no reinventada: dos formas distintas de escribir el mismo aislamiento son
-- dos cosas que se pueden desincronizar.
--
-- Sin la GUC seteada, current_setting(..., true) devuelve NULL, el nullif evita
-- que una cadena vacía haga explotar el cast, y NULL = uuid da NULL — que no es
-- true. O sea: SIN GUC NO PASA NINGUNA FILA. Falla cerrado.
-- ---------------------------------------------------------------------------

ALTER TABLE "movimientos_stock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "movimientos_stock" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "ventas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "ventas" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "venta_items" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "venta_items" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "pagos" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "pagos" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
