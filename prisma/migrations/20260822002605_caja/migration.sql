-- CreateTable
CREATE TABLE "cajas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "abierta_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "abierta_por_id" UUID NOT NULL,
    "saldo_inicial" DECIMAL(12,2) NOT NULL,
    "cerrada_en" TIMESTAMPTZ(3),
    "cerrada_por_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cajas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cajas_tenant_id_abierta_en_idx" ON "cajas"("tenant_id", "abierta_en");

-- AddForeignKey
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_abierta_por_id_fkey" FOREIGN KEY ("abierta_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cajas" ADD CONSTRAINT "cajas_cerrada_por_id_fkey" FOREIGN KEY ("cerrada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Una sola caja abierta por tenant, y esto TIENE que ser un índice y no una
-- validación de aplicación: dos pestañas apretando "Abrir caja" en el mismo
-- segundo pasan las dos por cualquier chequeo previo y abren dos. El índice
-- parcial lo resuelve en la base, que es el único lugar donde la carrera no
-- existe.
CREATE UNIQUE INDEX "cajas_una_abierta_por_tenant"
  ON "cajas" ("tenant_id")
  WHERE "cerrada_en" IS NULL;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "cajas" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "cajas" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
