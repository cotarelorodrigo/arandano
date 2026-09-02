-- AlterTable
ALTER TABLE "venta_items" ADD COLUMN     "costo_unitario" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "costo_ars" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "vendido_con_costo" DECIMAL(12,2) NOT NULL DEFAULT 0;
