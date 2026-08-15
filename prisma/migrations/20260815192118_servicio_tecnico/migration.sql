-- CreateEnum
CREATE TYPE "estado_orden" AS ENUM ('RECIBIDO', 'EN_DIAGNOSTICO', 'PRESUPUESTADO', 'EN_REPARACION', 'LISTO', 'ENTREGADO', 'SIN_REPARACION', 'RECHAZADO');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "proximo_numero_orden" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ordenes_de_trabajo" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "clave_idempotencia" TEXT,
    "cliente_id" UUID NOT NULL,
    "recibida_por_id" UUID NOT NULL,
    "estado" "estado_orden" NOT NULL DEFAULT 'RECIBIDO',
    "equipo_marca" TEXT NOT NULL,
    "equipo_modelo" TEXT NOT NULL,
    "equipo_serie" TEXT,
    "clave_desbloqueo" TEXT,
    "falla_declarada" TEXT NOT NULL,
    "accesorios" TEXT,
    "danos_visibles" TEXT,
    "diagnostico" TEXT,
    "monto_estimado" DECIMAL(12,2),
    "anulada_en" TIMESTAMPTZ(3),
    "anulada_por_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ordenes_de_trabajo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_orden" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "orden_id" UUID NOT NULL,
    "desde" "estado_orden",
    "hasta" "estado_orden" NOT NULL,
    "nota" TEXT,
    "usuario_id" UUID NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_orden_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_de_trabajo_tenant_id_estado_creado_en_idx" ON "ordenes_de_trabajo"("tenant_id", "estado", "creado_en");

-- CreateIndex
CREATE INDEX "ordenes_de_trabajo_tenant_id_cliente_id_idx" ON "ordenes_de_trabajo"("tenant_id", "cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_de_trabajo_tenant_id_numero_key" ON "ordenes_de_trabajo"("tenant_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_de_trabajo_tenant_id_clave_idempotencia_key" ON "ordenes_de_trabajo"("tenant_id", "clave_idempotencia");

-- CreateIndex
CREATE INDEX "eventos_orden_tenant_id_orden_id_creado_en_idx" ON "eventos_orden"("tenant_id", "orden_id", "creado_en");

-- AddForeignKey
ALTER TABLE "ordenes_de_trabajo" ADD CONSTRAINT "ordenes_de_trabajo_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_de_trabajo" ADD CONSTRAINT "ordenes_de_trabajo_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_de_trabajo" ADD CONSTRAINT "ordenes_de_trabajo_recibida_por_id_fkey" FOREIGN KEY ("recibida_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes_de_trabajo" ADD CONSTRAINT "ordenes_de_trabajo_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_orden" ADD CONSTRAINT "eventos_orden_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_orden" ADD CONSTRAINT "eventos_orden_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "ordenes_de_trabajo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eventos_orden" ADD CONSTRAINT "eventos_orden_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row Level Security. Misma expresión que las migraciones anteriores, copiada
-- literal y no reinventada: dos formas distintas de escribir el mismo
-- aislamiento son dos cosas que se pueden desincronizar.
--
-- Sin la GUC seteada, current_setting(..., true) devuelve NULL, el nullif evita
-- que una cadena vacía haga explotar el cast, y NULL = uuid da NULL — que no es
-- true. O sea: SIN GUC NO PASA NINGUNA FILA. Falla cerrado.
-- ---------------------------------------------------------------------------

ALTER TABLE "ordenes_de_trabajo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "ordenes_de_trabajo" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

ALTER TABLE "eventos_orden" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "eventos_orden" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
