-- AlterTable
ALTER TABLE "articulos" ADD COLUMN     "categoria_id" UUID;

-- CreateTable
CREATE TABLE "categorias" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "padre_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categorias_tenant_id_padre_id_idx" ON "categorias"("tenant_id", "padre_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_tenant_id_padre_id_nombre_key" ON "categorias"("tenant_id", "padre_id", "nombre");

-- CreateIndex
CREATE INDEX "articulos_tenant_id_categoria_id_idx" ON "articulos"("tenant_id", "categoria_id");

-- AddForeignKey
ALTER TABLE "articulos" ADD CONSTRAINT "articulos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_padre_id_fkey" FOREIGN KEY ("padre_id") REFERENCES "categorias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- La otra mitad de la unicidad. El índice que generó Prisma es
-- (tenant_id, padre_id, nombre), y en Postgres NULL <> NULL: dos RAÍCES
-- llamadas "Celulares" en el mismo tenant lo pasan sin chistar, porque su
-- padre_id es NULL en las dos y NULL nunca es igual a nada. Este índice
-- parcial es lo único que las frena.
--
-- Y tiene que ser un índice y no un chequeo de aplicación, por lo mismo que
-- "una sola caja abierta por tenant": dos pestañas creando la misma categoría
-- en el mismo segundo pasan las dos por cualquier `if` previo. La base es el
-- único lugar donde la carrera no existe.
CREATE UNIQUE INDEX "categorias_raiz_unica_por_tenant"
  ON "categorias" ("tenant_id", "nombre")
  WHERE "padre_id" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "categorias" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "categorias" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
