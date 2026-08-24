-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "cotizacion_usd" DECIMAL(12,2),
ADD COLUMN     "cotizacion_usd_en" TIMESTAMPTZ(3);
