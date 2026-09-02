-- AlterTable
ALTER TABLE "articulos" ADD COLUMN     "lleva_serie" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "movimientos_stock" ADD COLUMN     "unidad_id" UUID;

-- CreateTable
CREATE TABLE "unidades_articulo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "articulo_id" UUID NOT NULL,
    "imei" TEXT NOT NULL,
    "ingresada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingresada_por_id" UUID NOT NULL,
    "venta_id" UUID,
    "baja_en" TIMESTAMPTZ(3),
    "baja_nota" TEXT,
    "baja_por_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unidades_articulo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unidades_articulo_tenant_id_articulo_id_idx" ON "unidades_articulo"("tenant_id", "articulo_id");

-- CreateIndex
CREATE INDEX "unidades_articulo_tenant_id_imei_idx" ON "unidades_articulo"("tenant_id", "imei");

-- AddForeignKey
ALTER TABLE "unidades_articulo" ADD CONSTRAINT "unidades_articulo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_articulo" ADD CONSTRAINT "unidades_articulo_articulo_id_fkey" FOREIGN KEY ("articulo_id") REFERENCES "articulos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_articulo" ADD CONSTRAINT "unidades_articulo_ingresada_por_id_fkey" FOREIGN KEY ("ingresada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_articulo" ADD CONSTRAINT "unidades_articulo_baja_por_id_fkey" FOREIGN KEY ("baja_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unidades_articulo" ADD CONSTRAINT "unidades_articulo_venta_id_fkey" FOREIGN KEY ("venta_id") REFERENCES "ventas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos_stock" ADD CONSTRAINT "movimientos_stock_unidad_id_fkey" FOREIGN KEY ("unidad_id") REFERENCES "unidades_articulo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La unicidad del IMEI es PARCIAL: sólo entre las unidades LIBRES.
--
-- Prisma no sabe expresar un índice parcial, así que va escrito a mano — mismo
-- mecanismo, y por la misma razón, que "una sola caja abierta por tenant" y que
-- las raíces homónimas del árbol de categorías.
--
-- Global sería más estricto y estaría MAL: un local de celulares recompra el
-- equipo que vendió, y ese IMEI tiene que poder volver a entrar. Dos filas con
-- el mismo IMEI en el historial no son un defecto: son el mismo teléfono
-- pasando dos veces por el mismo local, que es exactamente lo que pasó.
--
-- Y tiene que ser un índice y no un chequeo de aplicación: dos pestañas
-- cargando el mismo IMEI en el mismo segundo pasan las dos por cualquier `if`
-- previo. La base es el único lugar donde la carrera no existe.
CREATE UNIQUE INDEX "unidades_articulo_imei_libre"
  ON "unidades_articulo" ("tenant_id", "imei")
  WHERE "venta_id" IS NULL AND "baja_en" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "unidades_articulo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "unidades_articulo" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
