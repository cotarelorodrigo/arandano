-- CreateEnum
CREATE TYPE "modo_bot" AS ENUM ('APAGADO', 'PRUEBA', 'TODOS');

-- AlterEnum
ALTER TYPE "motivo_sin_respuesta" ADD VALUE 'MODO_PRUEBA';

-- AlterTable
ALTER TABLE "bots_de_whatsapp" ADD COLUMN     "modo" "modo_bot" NOT NULL DEFAULT 'APAGADO';

-- Backfill: el bot que estaba prendido sigue contestándoles a todos. No usa
-- 'MODO_PRUEBA', que no se puede usar en la misma transacción que lo agrega.
UPDATE "bots_de_whatsapp" SET "modo" = 'TODOS' WHERE "activo" = true;

-- CreateTable
CREATE TABLE "numeros_de_prueba_bot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "digitos" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "numeros_de_prueba_bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "numeros_de_prueba_bot_tenant_id_digitos_key" ON "numeros_de_prueba_bot"("tenant_id", "digitos");

-- AddForeignKey
ALTER TABLE "numeros_de_prueba_bot" ADD CONSTRAINT "numeros_de_prueba_bot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "numeros_de_prueba_bot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "numeros_de_prueba_bot" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
