-- AlterTable
ALTER TABLE "articulos" ADD COLUMN     "moneda" "moneda" NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "cubre" "moneda" NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "venta_items" ADD COLUMN     "moneda" "moneda" NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "ventas" ADD COLUMN     "total_usd" DECIMAL(12,2) NOT NULL DEFAULT 0;
