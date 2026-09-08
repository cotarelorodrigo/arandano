-- DropForeignKey
ALTER TABLE "movimientos_stock" DROP CONSTRAINT "movimientos_stock_articulo_id_fkey";

-- DropForeignKey
ALTER TABLE "movimientos_stock" DROP CONSTRAINT "movimientos_stock_unidad_id_fkey";

-- DropForeignKey
ALTER TABLE "unidades_articulo" DROP CONSTRAINT "unidades_articulo_articulo_id_fkey";

-- AddForeignKey
ALTER TABLE "unidades_articulo" ADD CONSTRAINT "unidades_articulo_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "unidades_articulo"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
