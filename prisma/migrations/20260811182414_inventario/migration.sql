-- AlterTable
ALTER TABLE "articulos" ADD COLUMN     "desactivado_en" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "movimientos_stock" ADD COLUMN     "costo_unitario" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "proximo_sku_articulo" INTEGER NOT NULL DEFAULT 1;
