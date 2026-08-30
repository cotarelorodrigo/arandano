-- CreateEnum
CREATE TYPE "direccion_mensaje" AS ENUM ('ENTRANTE', 'SALIENTE');

-- CreateTable
CREATE TABLE "bots_de_whatsapp" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kapso_customer_id" TEXT,
    "phone_number_id" TEXT,
    "numero_visible" TEXT,
    "waba_id" TEXT,
    "webhook_id" TEXT,
    "webhook_secreto" TEXT,
    "conectado_en" TIMESTAMPTZ(3),
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "instrucciones" TEXT NOT NULL DEFAULT '',
    "tope_mensual" INTEGER NOT NULL DEFAULT 1000,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bots_de_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversaciones_bot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "wa_id" TEXT NOT NULL,
    "kapso_conversacion_id" TEXT,
    "nombre_contacto" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo_mensaje_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversaciones_bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensajes_bot" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversacion_id" UUID NOT NULL,
    "direccion" "direccion_mensaje" NOT NULL,
    "texto" TEXT NOT NULL,
    "wamid" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensajes_bot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bots_de_whatsapp_tenant_id_key" ON "bots_de_whatsapp"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "bots_de_whatsapp_phone_number_id_key" ON "bots_de_whatsapp"("phone_number_id");

-- CreateIndex
CREATE INDEX "conversaciones_bot_tenant_id_ultimo_mensaje_en_idx" ON "conversaciones_bot"("tenant_id", "ultimo_mensaje_en");

-- CreateIndex
CREATE UNIQUE INDEX "conversaciones_bot_tenant_id_wa_id_key" ON "conversaciones_bot"("tenant_id", "wa_id");

-- CreateIndex
CREATE INDEX "mensajes_bot_tenant_id_direccion_creado_en_idx" ON "mensajes_bot"("tenant_id", "direccion", "creado_en");

-- CreateIndex
CREATE INDEX "mensajes_bot_tenant_id_conversacion_id_creado_en_idx" ON "mensajes_bot"("tenant_id", "conversacion_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "mensajes_bot_tenant_id_wamid_key" ON "mensajes_bot"("tenant_id", "wamid");

-- AddForeignKey
ALTER TABLE "bots_de_whatsapp" ADD CONSTRAINT "bots_de_whatsapp_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversaciones_bot" ADD CONSTRAINT "conversaciones_bot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_bot" ADD CONSTRAINT "mensajes_bot_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensajes_bot" ADD CONSTRAINT "mensajes_bot_conversacion_id_fkey" FOREIGN KEY ("conversacion_id") REFERENCES "conversaciones_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "bots_de_whatsapp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "bots_de_whatsapp" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "conversaciones_bot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "conversaciones_bot" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);

-- Mismo aislamiento que el resto: sin la GUC seteada current_setting(…, true)
-- devuelve NULL, el nullif evita que una cadena vacía reviente el cast, y
-- NULL = uuid da NULL, que no es true. Sin GUC no pasa ninguna fila.
ALTER TABLE "mensajes_bot" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_aislamiento" ON "mensajes_bot" FOR ALL
  USING      ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('arandano.tenant_id', true), '')::uuid);
